// Avtentikacija: gesla (scrypt), seje (podpisani piškotki), API žetoni, TOTP 2FA, vloge in revizijska sled
import crypto from 'node:crypto';
import { q, insert } from './db.js';
import { config } from './config.js';
import { HttpError, parseCookies } from './http-util.js';

export const ROLES = { viewer: 1, operator: 2, admin: 3 };
export const COOKIE = 'v1_session';

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pw), salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}
export function verifyPassword(pw, stored) {
  const [alg, salt, hash] = String(stored || '').split('$');
  if (alg !== 'scrypt') return false;
  const h = crypto.scryptSync(String(pw), Buffer.from(salt, 'hex'), 64);
  return crypto.timingSafeEqual(h, Buffer.from(hash, 'hex'));
}

const b64u = b => Buffer.from(b).toString('base64url');
export function signToken(payload) {
  const body = b64u(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', config.secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}
export function verifyToken(tok) {
  if (!tok || !tok.includes('.')) return null;
  const [body, sig] = tok.split('.');
  const exp = crypto.createHmac('sha256', config.secret).update(body).digest('base64url');
  if (sig.length !== exp.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(exp))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (p.exp && p.exp < Date.now() / 1000) return null;
    return p;
  } catch { return null; }
}

// remember = »Ostani prijavljen na tej napravi« (namizna aplikacija, telefon): seja traja REMEMBER_DAYS dni
export function sessionCookie(user, req, remember = false) {
  const seconds = remember ? config.rememberDays * 86400 : config.sessionHours * 3600;
  const exp = Math.floor(Date.now() / 1000) + seconds;
  const tok = signToken({ uid: user.id, exp, pv: passwordVersion(user) });
  const secure = isHttps(req) ? '; Secure' : '';
  return `${COOKIE}=${tok}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${secure}`;
}
// Ob spremembi gesla postanejo stare (tudi dolgotrajne) seje neveljavne
const passwordVersion = u => crypto.createHash('sha256').update(String(u.password_hash || '')).digest('hex').slice(0, 10);

export const hashApiToken = t => crypto.createHash('sha256').update(t).digest('hex');

// Ugotovi uporabnika iz piškotka ali "Authorization: Bearer"
export function identify(req) {
  const authH = req.headers.authorization || '';
  if (authH.startsWith('Bearer ')) {
    const t = authH.slice(7).trim();
    if (config.aiToken && t === config.aiToken) return { id: 0, username: 'ai-modul', role: 'admin', all_cameras: 1, service: true };
    const row = q.get('SELECT * FROM api_tokens WHERE token_hash=?', hashApiToken(t));
    if (row) {
      q.run('UPDATE api_tokens SET last_used=unixepoch() WHERE id=?', row.id);
      return { id: -row.id, username: `token:${row.name}`, role: row.role, all_cameras: 1, service: true };
    }
    return null;
  }
  const tok = parseCookies(req)[COOKIE];
  const p = verifyToken(tok);
  if (!p) return null;
  const u = q.get('SELECT id, username, full_name, role, all_cameras, enabled, password_hash FROM users WHERE id=?', p.uid);
  if (!u || !u.enabled) return null;
  if (p.pv && p.pv !== passwordVersion(u)) return null;
  delete u.password_hash;
  return u;
}

export const requireRole = role => (req) => {
  if (!req.user) throw new HttpError(401, 'Prijava je potrebna');
  if ((ROLES[req.user.role] || 0) < ROLES[role]) throw new HttpError(403, 'Nimate pravic za to dejanje');
};

// Katere kamere sme uporabnik videti
export function allowedCameraIds(user) {
  if (!user) return [];
  if (user.role === 'admin' || user.all_cameras) return null; // null = vse
  return q.all('SELECT camera_id FROM user_cameras WHERE user_id=?', user.id).map(r => r.camera_id);
}
export function canSeeCamera(user, camId) {
  const ids = allowedCameraIds(user);
  return ids === null || ids.includes(Number(camId));
}
export function assertCamera(user, camId) {
  if (!canSeeCamera(user, camId)) throw new HttpError(403, 'Nimate dostopa do te kamere');
}

export function audit(req, action, target = '', detail = '') {
  insert('audit', {
    username: req?.user?.username || 'sistem',
    ip: req ? clientIp(req) : '',
    action, target: String(target ?? ''), detail: typeof detail === 'string' ? detail : JSON.stringify(detail),
  });
}

// ---------- TOTP (RFC 6238) ----------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32Encode(buf) {
  let bits = 0, val = 0, out = '';
  for (const b of buf) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}
function base32Decode(s) {
  let bits = 0, val = 0; const out = [];
  for (const c of s.replace(/=+$/, '').toUpperCase()) {
    const i = B32.indexOf(c); if (i < 0) continue;
    val = (val << 5) | i; bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
export function totpCode(secret, t = Date.now()) {
  const counter = Math.floor(t / 1000 / 30);
  const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', base32Decode(secret)).update(buf).digest();
  const o = h[h.length - 1] & 15;
  const code = ((h.readUInt32BE(o) & 0x7fffffff) % 1e6).toString().padStart(6, '0');
  return code;
}
export function verifyTotp(secret, code) {
  const c = String(code || '').replace(/\s/g, '');
  return [-1, 0, 1].some(w => totpCode(secret, Date.now() + w * 30000) === c);
}

// Preprosta zaščita pred ugibanjem gesel
const attempts = new Map();
export function checkBruteForce(key) {
  const a = attempts.get(key);
  if (a && a.count >= 8 && Date.now() - a.first < 15 * 60 * 1000) throw new HttpError(429, 'Preveč neuspešnih poskusov. Poskusite čez 15 minut.');
}
export function failedLogin(key) {
  const a = attempts.get(key);
  if (!a || Date.now() - a.first > 15 * 60 * 1000) attempts.set(key, { count: 1, first: Date.now() });
  else a.count++;
}
export const clearAttempts = key => attempts.delete(key);

// Glavam obratnega posrednika verjamemo le, če je tak posrednik res nastavljen (TRUST_PROXY=1).
// Doma prek VPN-ja posrednika ni, zato bi lahko kdorkoli s ponarejeno glavo obšel zaščito pred ugibanjem gesel.
export function isHttps(req) {
  return !!req.socket?.encrypted || (config.trustProxy && req.headers['x-forwarded-proto'] === 'https');
}
export function clientIp(req) {
  const fwd = config.trustProxy ? String(req.headers['x-forwarded-for'] || '').split(',')[0] : '';
  return String(fwd || req.socket?.remoteAddress || '').trim();
}
