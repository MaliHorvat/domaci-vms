// Povezovalni zaslon: prvi zagon, nastavitve povezave in čakanje na strežnik
const $ = id => document.getElementById(id);
const api = window.v1desktop;
const reason = new URLSearchParams(location.search).get('reason') || 'setup';

function show(id) { for (const s of ['offline', 'settings', 'searching']) $(s).hidden = s !== id; }

async function init() {
  const c = await api.getConfig();
  $('ver').textContent = `Različica ${c.version}`;
  $('lan').value = (c.lan || '').replace(/^http:\/\//, '');
  $('remote').value = (c.remote || '').replace(/^http:\/\//, '');
  $('autostart').checked = c.autostart; $('keepAwake').checked = c.keepAwake;
  const configured = !!(c.lan || c.remote);
  $('cancel').hidden = !configured;
  if (reason === 'offline') {
    show('offline');
    $('tried').textContent = `Preverjeno: ${[c.lan && `doma ${c.lan.replace(/^https?:\/\//, '')}`, c.remote && `od zunaj ${c.remote.replace(/^https?:\/\//, '')}`].filter(Boolean).join(', ')}`;
  } else {
    show('settings');
    if (!configured) { $('setTitle').textContent = 'Dobrodošli'; $('code').focus(); }
    checkAll();
  }
}

// sprotno preverjanje, ali je naslov dosegljiv
const timers = {};
async function check(inputId, stId) {
  const v = $(inputId).value.trim(); const st = $(stId);
  if (!v) { st.textContent = ''; st.className = 'st'; return; }
  st.className = 'st'; st.textContent = 'preverjam';
  const ok = await api.probe(v);
  if ($(inputId).value.trim() !== v) return;
  st.className = `st ${ok ? 'ok' : 'no'}`; st.textContent = ok ? 'dosegljiv' : 'ni dosegljiv';
}
function checkAll() { check('lan', 'stLan'); check('remote', 'stRemote'); }
for (const [i, s] of [['lan', 'stLan'], ['remote', 'stRemote']]) {
  $(i).addEventListener('input', () => { clearTimeout(timers[i]); timers[i] = setTimeout(() => check(i, s), 600); });
}

$('code').addEventListener('input', async () => {
  const v = $('code').value.trim();
  if (!v) return;
  const d = await api.decode(v);
  if (!d) { $('err').textContent = 'Koda ni veljavna. Kopirajte jo znova iz Admin → Dostop z naprav.'; return; }
  $('err').textContent = '';
  $('lan').value = d.lan.replace(/^http:\/\//, ''); $('remote').value = d.remote.replace(/^http:\/\//, '');
  $('form').dataset.name = d.name;
  checkAll();
});

$('form').addEventListener('submit', async e => {
  e.preventDefault();
  $('err').textContent = '';
  const r = await api.save({ lan: $('lan').value, remote: $('remote').value, name: $('form').dataset.name || '', autostart: $('autostart').checked, keepAwake: $('keepAwake').checked });
  if (r?.error) { $('err').textContent = r.error; return; }
  show('searching');
});
$('cancel').addEventListener('click', () => { show('searching'); api.back(); });
$('retry').addEventListener('click', () => { show('searching'); api.back(); });
$('toSettings').addEventListener('click', () => { show('settings'); checkAll(); });
api.onStatus(async s => {
  if (s !== 'offline' || !$('settings').hidden) return; // med urejanjem nastavitev ne prekinjamo
  const c = await api.getConfig();
  $('tried').textContent = `Preverjeno: ${[c.lan && `doma ${c.lan.replace(/^https?:\/\//, '')}`, c.remote && `od zunaj ${c.remote.replace(/^https?:\/\//, '')}`].filter(Boolean).join(', ')}`;
  show('offline');
});

init();
