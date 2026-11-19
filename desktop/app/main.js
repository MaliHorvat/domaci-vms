// VisionOne Kamere – namizna aplikacija za domači VMS.
// Odpre se v svojem oknu (brez brskalnika), sama izbere domači ali VPN naslov strežnika
// in ob izgubi povezave samodejno preklopi ali počaka, da se strežnik vrne.
const { app, BrowserWindow, Menu, ipcMain, shell, net, powerMonitor, powerSaveBlocker, session, dialog, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const APP_NAME = 'VisionOne Kamere';
app.setName(APP_NAME);
if (process.platform === 'win32') app.setAppUserModelId('si.visionone.kamere');
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

// ---------------- nastavitve ----------------
const cfgFile = () => path.join(app.getPath('userData'), 'nastavitve.json');
const DEFAULTS = { name: '', lan: '', remote: '', autostart: false, fullscreen: false, keepAwake: false, bounds: null, maximized: true };
let cfg = { ...DEFAULTS };
function loadCfg() { try { cfg = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(cfgFile(), 'utf8')) }; } catch { cfg = { ...DEFAULTS }; } }
function saveCfg() { try { fs.mkdirSync(path.dirname(cfgFile()), { recursive: true }); fs.writeFileSync(cfgFile(), JSON.stringify(cfg, null, 2)); } catch (e) { console.error(e); } }

/** »192.168.1.20:8080« → »http://192.168.1.20:8080«; neveljaven naslov → null */
function normUrl(v) {
  v = String(v || '').trim().replace(/\/+$/, '');
  if (!v) return '';
  if (!/^https?:\/\//i.test(v)) v = `http://${v}`;
  try { const u = new URL(v); return `${u.protocol}//${u.host}`; } catch { return null; }
}

/** Koda za povezavo iz Admin → Dostop z naprav (V1-…) */
function decodeCode(code) {
  const s = String(code || '').trim().replace(/^V1-/i, '');
  try {
    const o = JSON.parse(Buffer.from(s, 'base64').toString('utf8'));
    return { name: String(o.n || ''), lan: normUrl(o.l) || '', remote: normUrl(o.r) || '' };
  } catch { return null; }
}

// ---------------- povezava s strežnikom ----------------
async function probe(base, ms = 2500) {
  if (!base) return false;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await net.fetch(`${base}/health`, { signal: ctl.signal, cache: 'no-store' });
    if (!r.ok) return false;
    const j = await r.json().catch(() => ({}));
    return !!j.ok;
  } catch { return false; } finally { clearTimeout(t); }
}

/** Najprej domači naslov (hitrejši), nato VPN. Oba preverimo hkrati. */
async function pickServer() {
  const [lanOk, remOk] = await Promise.all([probe(cfg.lan), probe(cfg.remote)]);
  if (lanOk) return { url: cfg.lan, via: 'lan' };
  if (remOk) return { url: cfg.remote, via: 'remote' };
  return null;
}

let win = null;
let current = null;           // { url, via }
let watchTimer = null;
let retryTimer = null;
let awakeId = null;
let connecting = false;

const connectPage = path.join(__dirname, 'connect.html');
const isConnectPage = url => url.startsWith('file:');
const sameServer = url => { try { return current && new URL(url).origin === new URL(current.url).origin; } catch { return false; } };

function setTitle() {
  const where = current ? (current.via === 'lan' ? 'domače omrežje' : 'od zunaj (VPN)') : 'ni povezave';
  win?.setTitle(`${cfg.name || APP_NAME} – ${where}`);
}

function showConnect(reason = '') {
  clearTimeout(retryTimer);
  current = null; setTitle();
  win.loadFile(connectPage, { query: { reason } });
}

async function connect({ silent = false } = {}) {
  if (connecting) return;
  connecting = true;
  clearTimeout(retryTimer);
  try {
    if (!cfg.lan && !cfg.remote) return showConnect('setup');
    if (!silent && (!win.webContents.getURL() || isConnectPage(win.webContents.getURL()))) win.webContents.send('status', 'iščem');
    const s = await pickServer();
    if (!s) {
      if (isConnectPage(win.webContents.getURL())) win.webContents.send('status', 'offline');
      else showConnect('offline');
      retryTimer = setTimeout(() => connect({ silent: true }), 10000);
      return;
    }
    const changed = !current || current.url !== s.url;
    current = s; setTitle();
    if (changed || isConnectPage(win.webContents.getURL())) await win.loadURL(`${s.url}/view/`).catch(() => {});
  } finally { connecting = false; }
}

// Vsakih 30 s in ob prebujanju računalnika preverimo, ali je izbrani naslov še dosegljiv
// (npr. prenosnik je zapustil dom → preklop na VPN, ob vrnitvi domov nazaj na domači naslov).
function startWatch() {
  clearInterval(watchTimer);
  watchTimer = setInterval(async () => {
    if (!current || connecting) return;
    if (current.via === 'remote' && cfg.lan && await probe(cfg.lan)) return connect({ silent: true });
    if (!await probe(current.url, 4000)) connect({ silent: true });
  }, 30000);
}

// ---------------- okno ----------------
function createWindow() {
  const b = cfg.bounds || { width: 1440, height: 900 };
  win = new BrowserWindow({
    ...b, minWidth: 900, minHeight: 600,
    title: APP_NAME,
    backgroundColor: '#12171d',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    show: false,
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      spellcheck: false, backgroundThrottling: false,
    },
  });
  if (cfg.maximized && !cfg.fullscreen) win.maximize();
  if (cfg.fullscreen) win.setFullScreen(true);
  win.once('ready-to-show', () => win.show());

  const remember = () => {
    if (!win || win.isDestroyed()) return;
    cfg.maximized = win.isMaximized();
    cfg.fullscreen = win.isFullScreen();
    if (!cfg.maximized && !cfg.fullscreen) cfg.bounds = win.getBounds();
    saveCfg();
  };
  win.on('resize', debounce(remember, 600)); win.on('move', debounce(remember, 600));
  win.on('maximize', remember); win.on('unmaximize', remember);
  win.on('enter-full-screen', remember); win.on('leave-full-screen', remember);
  win.on('close', remember);
  win.on('page-title-updated', e => { e.preventDefault(); setTitle(); });

  const wc = win.webContents;
  // samo strani našega strežnika in lokalni povezovalni zaslon; vse ostalo v privzetem brskalniku
  wc.on('will-navigate', (e, url) => {
    if (isConnectPage(url) || sameServer(url)) return;
    e.preventDefault();
    if (/^https?:/.test(url)) shell.openExternal(url);
  });
  wc.setWindowOpenHandler(({ url }) => {
    if (sameServer(url)) return { action: 'allow', overrideBrowserWindowOptions: { width: 1280, height: 850, backgroundColor: '#12171d', autoHideMenuBar: true, icon: path.join(__dirname, '..', 'build', 'icon.png'), webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true } } };
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('did-fail-load', (_e, code, _desc, url, isMain) => {
    if (!isMain || code === -3 /* prekinjeno */ || isConnectPage(url)) return;
    connect({ silent: true });
  });
  wc.on('render-process-gone', () => setTimeout(() => connect({ silent: true }), 1000));
  wc.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
    if (input.key === 'Escape' && win.isFullScreen() && !input.control) { /* View sam zapira povečano kamero */ }
  });

  buildMenu();
  connect();
  startWatch();
}

function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

function goView(mode) { if (current) win.loadURL(`${current.url}/view/#${mode}`); }
function openAdmin() {
  if (!current) return;
  const w = new BrowserWindow({ width: 1280, height: 860, title: `${APP_NAME} – nastavitve sistema`, backgroundColor: '#12171d', autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'build', 'icon.png'), webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true } });
  const origin = new URL(current.url).origin;
  w.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(origin)) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });
  w.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  w.loadURL(`${current.url}/admin/`);
}

function setKeepAwake(on) {
  cfg.keepAwake = on; saveCfg();
  if (on && awakeId == null) awakeId = powerSaveBlocker.start('prevent-display-sleep');
  if (!on && awakeId != null) { powerSaveBlocker.stop(awakeId); awakeId = null; }
}
function setAutostart(on) {
  cfg.autostart = on; saveCfg();
  app.setLoginItemSettings({ openAtLogin: on, args: ['--ob-prijavi'] });
}

function buildMenu() {
  const tpl = [
    { label: 'Aplikacija', submenu: [
      { label: 'Nastavitve povezave …', accelerator: 'CmdOrCtrl+,', click: () => showConnect('settings') },
      { label: 'Nastavitve sistema (Admin)', accelerator: 'CmdOrCtrl+Shift+A', click: openAdmin },
      { type: 'separator' },
      { label: 'Zaženi ob prijavi v Windows', type: 'checkbox', checked: cfg.autostart, click: m => setAutostart(m.checked) },
      { label: 'Zaslon naj ne ugasne', type: 'checkbox', checked: cfg.keepAwake, click: m => setKeepAwake(m.checked) },
      { type: 'separator' },
      { label: 'Izhod', role: 'quit' },
    ] },
    { label: 'Pogled', submenu: [
      { label: 'Živo', accelerator: 'CmdOrCtrl+1', click: () => goView('live') },
      { label: 'Predvajanje', accelerator: 'CmdOrCtrl+2', click: () => goView('playback') },
      { label: 'Dogodki', accelerator: 'CmdOrCtrl+3', click: () => goView('events') },
      { label: 'Pametno iskanje', accelerator: 'CmdOrCtrl+4', click: () => goView('search') },
      { type: 'separator' },
      { label: 'Celozaslonsko', accelerator: 'F11', click: () => win.setFullScreen(!win.isFullScreen()) },
      { label: 'Osveži', accelerator: 'F5', click: () => (current ? win.webContents.reload() : connect()) },
      { type: 'separator' },
      { label: 'Povečaj', role: 'zoomIn' }, { label: 'Pomanjšaj', role: 'zoomOut' }, { label: 'Privzeta velikost', role: 'resetZoom' },
      ...(app.isPackaged ? [] : [{ type: 'separator' }, { role: 'toggleDevTools' }]),
    ] },
    { label: 'Pomoč', submenu: [
      { label: 'O aplikaciji', click: () => dialog.showMessageBox(win, {
        type: 'info', title: APP_NAME, icon: nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'icon.png')),
        message: `${APP_NAME} ${app.getVersion()}`,
        detail: `Povezava: ${current ? `${current.url} (${current.via === 'lan' ? 'domače omrežje' : 'VPN'})` : 'ni povezave'}\nDoma: ${cfg.lan || '–'}\nOd zunaj: ${cfg.remote || '–'}`,
      }) },
    ] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

// ---------------- komunikacija s povezovalnim zaslonom ----------------
// Nastavitve lahko bere in spreminja samo lokalni povezovalni zaslon, ne pa strani s strežnika.
const fromConnect = e => isConnectPage(e.senderFrame?.url || e.sender.getURL());
ipcMain.handle('cfg:get', e => (fromConnect(e) ? { name: cfg.name, lan: cfg.lan, remote: cfg.remote, autostart: cfg.autostart, keepAwake: cfg.keepAwake, version: app.getVersion() } : null));
ipcMain.handle('cfg:decode', (e, code) => (fromConnect(e) ? decodeCode(code) : null));
ipcMain.handle('cfg:probe', async (e, url) => (fromConnect(e) ? probe(normUrl(url)) : false));
ipcMain.handle('cfg:save', async (e, v) => {
  if (!fromConnect(e)) return { error: 'Ni dovoljeno' };
  const lan = normUrl(v.lan), remote = normUrl(v.remote);
  if (lan === null) return { error: 'Domači naslov ni veljaven. Primer: 192.168.1.20:8080' };
  if (remote === null) return { error: 'Naslov od zunaj ni veljaven. Primer: 100.88.12.7:8080' };
  if (!lan && !remote) return { error: 'Vpišite vsaj en naslov strežnika.' };
  Object.assign(cfg, { lan, remote, name: String(v.name || cfg.name || '').slice(0, 60) });
  saveCfg();
  setAutostart(!!v.autostart); setKeepAwake(!!v.keepAwake); buildMenu();
  current = null;
  connect();
  return { ok: true };
});
ipcMain.handle('cfg:back', e => { if (fromConnect(e) && (cfg.lan || cfg.remote)) connect(); });

// ---------------- zagon ----------------
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
app.whenReady().then(() => {
  loadCfg();
  // mikrofon (dvosmerni zvok) in celozaslonski način samo za naš strežnik
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb, details) => {
    const ok = ['media', 'fullscreen', 'clipboard-sanitized-write'].includes(perm) && sameServer(details.requestingUrl || wc.getURL());
    cb(ok);
  });
  if (cfg.keepAwake) setKeepAwake(true);
  createWindow();
  powerMonitor.on('resume', () => setTimeout(() => connect({ silent: true }), 3000));
});
app.on('window-all-closed', () => app.quit());
