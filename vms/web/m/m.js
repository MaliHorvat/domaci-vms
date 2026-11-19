// Pogled kamer za telefon: sličice vseh kamer, dotik za živo sliko, zadnji dogodki.
// Namenoma lahek: sličice se osvežujejo samo za kamere na zaslonu, živa slika teče samo za odprto kamero.
import { h, $, clear, icon, get, ensureLogin, logout, liveEvents, fmtTime, fmtAgo, eventTitle, store } from '../common/core.js';
import { createPlayer } from '../common/player.js';

const S = { me: null, cameras: [], groups: [], group: store.get('m-group', ''), cols: store.get('m-cols', 1), tab: 'cams', events: [], unseen: 0 };
const camById = id => S.cameras.find(c => c.id === Number(id));

// 100.64.0.0/10 je razpon omrežja Tailscale, zasebni razponi pa domače omrežje
function where() {
  const host = location.hostname;
  const m = /^(\d+)\.(\d+)\./.exec(host);
  if (m && +m[1] === 100 && +m[2] >= 64 && +m[2] < 128) return 'vpn';
  if (/\.ts\.net$/.test(host) || (!host.includes('.') && host !== 'localhost')) return 'vpn';
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) || host === 'localhost') return 'home';
  return 'other';
}

let main, tabBtns = {};

async function boot() {
  S.me = await ensureLogin('Kamere', 'Prijava na domači strežnik');
  document.title = S.me.system_name || 'Kamere';
  [S.cameras, S.groups] = await Promise.all([get('/api/cameras'), get('/api/groups')]);
  S.cameras = S.cameras.filter(c => c.enabled);
  if (S.group && !S.groups.some(g => String(g.id) === String(S.group))) S.group = '';
  buildShell();
  render();
  liveEvents({
    event: e => {
      if (!['alarm', 'warning'].includes(e.severity)) return;
      S.events.unshift(e); S.events.length = Math.min(S.events.length, 60);
      if (S.tab !== 'events') { S.unseen++; updateBadge(); }
      else render();
    },
    camera_status: d => { const c = camById(d.id); if (c) { c.status = d.status; document.querySelectorAll(`[data-cam="${d.id}"]`).forEach(markStatus); } },
  });
  get('/api/events?severity=alarm,warning&limit=40').then(r => { S.events = r.items || []; if (S.tab === 'events') render(); }).catch(() => {});
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshVisible(true); });
}

function buildShell() {
  const w = where();
  const conn = w === 'vpn' ? ['Od zunaj (VPN)', 'vpn'] : w === 'home' ? ['Doma', 'home'] : ['Povezano', 'home'];
  const menu = h('div', { class: 'm-menu', hidden: true },
    h('button', { onclick: () => { S.cols = S.cols === 1 ? 2 : 1; store.set('m-cols', S.cols); menu.hidden = true; render(); } }, icon('grid', 18), h('span', {}, 'Velikost sličic')),
    h('a', { href: '/view/' }, icon('monitor', 18), h('span', {}, 'Celoten pogled (View)')),
    h('button', { onclick: logout }, icon('logout', 18), h('span', {}, 'Odjava')));
  const top = h('header', { class: 'm-top' },
    h('div', { class: 'm-title' }, h('span', { class: 'brand-mark' }), h('strong', {}, S.me.system_name || 'Kamere')),
    h('span', { class: `m-conn ${conn[1]}` }, conn[0]),
    h('button', { class: 'm-iconbtn', 'aria-label': 'Meni', onclick: e => { e.stopPropagation(); menu.hidden = !menu.hidden; } }, h('span', { class: 'dots' })),
    menu);
  document.addEventListener('click', e => { if (!menu.contains(e.target)) menu.hidden = true; });

  main = h('main', { class: 'm-main' });
  const tab = (id, label, ic) => (tabBtns[id] = h('button', { 'aria-pressed': String(S.tab === id), onclick: () => { S.tab = id; if (id === 'events') { S.unseen = 0; updateBadge(); } render(); } },
    icon(ic, 22), h('span', {}, label), id === 'events' ? h('i', { class: 'm-badge', hidden: true }) : null));
  const nav = h('nav', { class: 'm-tabs' }, tab('cams', 'Kamere', 'camera'), tab('events', 'Dogodki', 'bell'));
  clear($('#app'), top, main, nav);
}

function updateBadge() {
  const b = tabBtns.events?.querySelector('.m-badge');
  if (!b) return;
  b.hidden = !S.unseen; b.textContent = S.unseen > 9 ? '9+' : String(S.unseen);
}

function render() {
  for (const [id, b] of Object.entries(tabBtns)) b.setAttribute('aria-pressed', String(id === S.tab));
  stopTiles();
  if (S.tab === 'cams') renderCams(); else renderEvents();
  main.scrollTop = 0;
}

// ======================= KAMERE =======================
let io = null;
const tiles = new Map(); // id → { img, timer, visible, busy }

function renderCams() {
  const groups = S.groups.filter(g => S.cameras.some(c => c.group_id === g.id));
  const list = S.cameras.filter(c => !S.group || String(c.group_id) === String(S.group));
  const chips = groups.length > 1 ? h('div', { class: 'm-chips', role: 'tablist' },
    [{ id: '', name: 'Vse' }, ...groups].map(g => h('button', { 'aria-pressed': String(String(S.group) === String(g.id)), onclick: () => { S.group = g.id; store.set('m-group', g.id); render(); } }, g.name))) : null;
  if (!S.cameras.length) {
    clear(main, h('div', { class: 'm-empty' }, h('strong', {}, 'Ni dodanih kamer'), h('p', {}, 'Kamere dodate na računalniku v Admin → Kamere ali Snemalniki.')));
    return;
  }
  const grid = h('div', { class: `m-grid cols-${S.cols}` }, list.map(tile));
  clear(main, chips, grid);
  io = new IntersectionObserver(entries => {
    for (const en of entries) {
      const t = tiles.get(Number(en.target.dataset.cam)); if (!t) continue;
      t.visible = en.isIntersecting;
      if (t.visible) loadFrame(t);
    }
  }, { rootMargin: '120px 0px' });
  grid.querySelectorAll('.m-tile').forEach(el => io.observe(el));
}

function tile(c) {
  const img = h('img', { alt: '', decoding: 'async' });
  const el = h('button', { class: 'm-tile', 'data-cam': c.id, onclick: () => openLive(c.id) },
    h('div', { class: 'm-frame' }, img, h('span', { class: 'm-wait' }, 'Nalagam sliko …')),
    h('div', { class: 'm-cap' }, h('span', { class: 'dot' }), h('span', { class: 'name' }, c.name), c.recording ? h('span', { class: 'rec' }, 'REC') : null));
  markStatus(el);
  const t = { id: c.id, el, img, timer: null, visible: false, busy: false, fails: 0 };
  img.onload = () => { t.busy = false; t.fails = 0; el.classList.add('ok'); el.classList.remove('err'); schedule(t); };
  img.onerror = () => { t.busy = false; t.fails++; el.classList.add('err'); el.querySelector('.m-wait').textContent = 'Slika ni na voljo'; schedule(t, Math.min(20000, 4000 * t.fails)); };
  tiles.set(c.id, t);
  return el;
}

function markStatus(el) {
  const c = camById(el.dataset.cam);
  el.classList.toggle('offline', c?.status === 'offline');
}

const interval = () => (S.cols === 1 ? 3000 : 5000);
function schedule(t, ms = interval()) { clearTimeout(t.timer); t.timer = setTimeout(() => loadFrame(t), ms); }
function loadFrame(t) {
  if (!t.visible || t.busy || document.visibilityState !== 'visible' || $('.m-live')) return;
  t.busy = true;
  t.img.src = `/api/cameras/${t.id}/snapshot?t=${Date.now()}`;
}
function refreshVisible(now) { for (const t of tiles.values()) if (t.visible) { t.busy = false; if (now) loadFrame(t); } }
function stopTiles() {
  io?.disconnect(); io = null;
  for (const t of tiles.values()) { clearTimeout(t.timer); t.img.onload = t.img.onerror = null; t.img.removeAttribute('src'); }
  tiles.clear();
}

// ======================= ŽIVA SLIKA =======================
function openLive(id) {
  const order = S.cameras.filter(c => !S.group || String(c.group_id) === String(S.group));
  let idx = Math.max(0, order.findIndex(c => c.id === id));
  let hq = store.get('m-hq', false);
  let player = null;

  const stage = h('div', { class: 'm-stage' });
  const msg = h('div', { class: 'm-msg' }, 'Povezujem …');
  const name = h('strong', {});
  const hqBtn = h('button', { class: 'm-pill', 'aria-pressed': String(hq), onclick: () => { hq = !hq; store.set('m-hq', hq); hqBtn.setAttribute('aria-pressed', String(hq)); hqBtn.textContent = hq ? 'HD' : 'SD'; start(); } }, hq ? 'HD' : 'SD');
  const prev = h('button', { class: 'm-iconbtn', 'aria-label': 'Prejšnja kamera', onclick: () => step(-1) }, icon('left', 22));
  const next = h('button', { class: 'm-iconbtn', 'aria-label': 'Naslednja kamera', onclick: () => step(1) }, icon('right', 22));
  const pos = h('span', { class: 'm-pos' });
  const ov = h('div', { class: 'm-live', role: 'dialog', 'aria-modal': 'true' },
    h('header', {}, h('button', { class: 'm-iconbtn', 'aria-label': 'Nazaj', onclick: close }, icon('x', 22)), name, hqBtn),
    stage, msg,
    h('footer', {}, prev, pos, next));

  function start() {
    player?.remove();
    const cam = order[idx];
    name.textContent = cam.name;
    pos.textContent = `${idx + 1} / ${order.length}`;
    prev.disabled = next.disabled = order.length < 2;
    msg.hidden = false; msg.textContent = 'Povezujem …';
    player = createPlayer(`cam_${cam.id}${hq ? '' : '_sub'}`);
    player.addEventListener('state', e => {
      msg.hidden = e.detail === 'live';
      if (e.detail === 'reconnect') msg.textContent = 'Povezava je prekinjena, ponovno povezujem …';
    });
    resetZoom();
    stage.replaceChildren(player);
    player.start();
  }
  function step(d) { if (order.length < 2) return; idx = (idx + d + order.length) % order.length; start(); }
  function close() { player?.remove(); ov.remove(); document.removeEventListener('keydown', onKey); history.state?.mLive && history.back(); refreshVisible(true); }
  const onKey = e => { if (e.key === 'Escape') close(); if (e.key === 'ArrowLeft') step(-1); if (e.key === 'ArrowRight') step(1); };
  document.addEventListener('keydown', onKey);
  // gumb Nazaj na Androidu zapre živo sliko namesto aplikacije
  history.pushState({ mLive: true }, '');
  window.addEventListener('popstate', function pop() { window.removeEventListener('popstate', pop); if (document.body.contains(ov)) { player?.remove(); ov.remove(); document.removeEventListener('keydown', onKey); refreshVisible(true); } }, { once: true });

  // ---- povečava s prsti, dvojni dotik, poteg levo/desno za drugo kamero ----
  let z = 1, tx = 0, ty = 0, pinch = null, pan = null, lastTap = 0, swipe = null;
  const apply = () => { stage.style.transform = `translate(${tx}px, ${ty}px) scale(${z})`; };
  function resetZoom() { z = 1; tx = ty = 0; apply(); }
  const clampPan = () => {
    const r = stage.parentElement.getBoundingClientRect();
    const mx = (r.width * (z - 1)) / 2, my = (r.height * (z - 1)) / 2;
    tx = Math.max(-mx, Math.min(mx, tx)); ty = Math.max(-my, Math.min(my, ty));
  };
  const dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  ov.addEventListener('touchstart', e => {
    if (e.target.closest('header, footer')) return;
    if (e.touches.length === 2) { pinch = { d: dist(e.touches), z }; swipe = null; }
    else if (e.touches.length === 1) {
      const t = e.touches[0];
      if (z > 1) pan = { x: t.clientX - tx, y: t.clientY - ty }; else swipe = { x: t.clientX, y: t.clientY, t: Date.now() };
      const now = Date.now();
      if (now - lastTap < 280) { if (z > 1) resetZoom(); else { z = 2.5; apply(); } lastTap = 0; swipe = null; } else lastTap = now;
    }
  }, { passive: true });
  ov.addEventListener('touchmove', e => {
    if (pinch && e.touches.length === 2) { z = Math.max(1, Math.min(6, pinch.z * dist(e.touches) / pinch.d)); clampPan(); apply(); e.preventDefault(); }
    else if (pan && e.touches.length === 1) { tx = e.touches[0].clientX - pan.x; ty = e.touches[0].clientY - pan.y; clampPan(); apply(); e.preventDefault(); }
  }, { passive: false });
  ov.addEventListener('touchend', e => {
    if (swipe && e.changedTouches.length) {
      const t = e.changedTouches[0], dx = t.clientX - swipe.x, dy = t.clientY - swipe.y;
      if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5 && Date.now() - swipe.t < 600) step(dx < 0 ? 1 : -1);
    }
    if (e.touches.length < 2) pinch = null;
    if (!e.touches.length) { pan = null; swipe = null; if (z < 1.05) resetZoom(); }
  });

  document.body.append(ov);
  start();
}

// ======================= DOGODKI =======================
function renderEvents() {
  if (!S.events.length) {
    clear(main, h('div', { class: 'm-empty' }, h('strong', {}, 'Ni alarmov'), h('p', {}, 'Tu se prikažejo zaznave in opozorila kamer, ko se zgodijo.')));
    return;
  }
  const day = ts => new Date(ts * 1000).toLocaleDateString('sl-SI', { weekday: 'long', day: 'numeric', month: 'long' });
  let lastDay = '';
  const rows = [];
  for (const e of S.events) {
    const d = day(e.ts);
    if (d !== lastDay) { rows.push(h('h3', { class: 'm-day' }, d)); lastDay = d; }
    const cam = camById(e.camera_id);
    rows.push(h('button', { class: `m-event sev-${e.severity}`, onclick: () => cam && openLive(cam.id) },
      e.snapshot ? h('img', { src: `/api/events/${e.id}/snapshot`, alt: '', loading: 'lazy' }) : h('span', { class: 'm-noimg' }, icon('bell', 20)),
      h('div', {}, h('strong', {}, eventTitle(e)), h('span', {}, cam?.name || 'Sistem')),
      h('time', { title: fmtAgo(e.ts) }, fmtTime(e.ts).slice(0, 5))));
  }
  clear(main, h('div', { class: 'm-events' }, rows));
}

boot().catch(e => { clear($('#app'), h('div', { class: 'm-empty' }, h('strong', {}, 'Strežnik ni dosegljiv'), h('p', {}, e.message || String(e)), h('button', { class: 'btn btn-primary', onclick: () => location.reload() }, 'Poskusi znova'))); });
