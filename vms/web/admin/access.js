// VisionOne Admin – dostop z naprav: namizna aplikacija in telefon, doma in od zunaj (prek zasebnega VPN-ja)
import { h, clear, icon, get, put, toast, toastErr, field } from '../common/core.js';
import qrcode from '../common/qrcode.mjs';
import { go, pageHead } from './admin.js';

const DESKTOP_DOWNLOAD = 'https://github.com/MaliHorvat/domaci-vms/releases/latest';

const cleanUrl = v => {
  v = String(v || '').trim().replace(/\/+$/, '');
  if (!v) return '';
  if (!/^https?:\/\//i.test(v)) v = `http://${v}`;
  try { const u = new URL(v); if (!u.port && u.protocol === 'http:') u.port = location.port || '8080'; return `${u.protocol}//${u.host}`; } catch { return null; }
};

/** Koda, ki jo prilepite v namizno aplikacijo: oba naslova v eni vrstici. */
export const connectionCode = (name, lan, remote) =>
  'V1-' + btoa(unescape(encodeURIComponent(JSON.stringify({ n: name, l: lan || '', r: remote || '' })))).replace(/=+$/, '');

function copyBtn(text, label = 'Kopiraj') {
  return h('button', { class: 'btn btn-sm', onclick: async () => {
    try { await navigator.clipboard.writeText(text); toast('Kopirano'); } catch { toast('Kopiranje ni uspelo – označite besedilo in ga kopirajte ročno', 'warn'); }
  } }, label);
}

function qrImg(text) {
  const qr = qrcode(0, 'M'); qr.addData(text); qr.make();
  return h('div', { class: 'qr', html: qr.createImgTag(4, 8) });
}

export async function pageAccess(page) {
  const a = await get('/api/system/access');
  const lan = h('input', { value: a.lan || '', placeholder: `npr. 192.168.1.20:${a.port}`, spellcheck: false });
  const remote = h('input', { value: a.remote || '', placeholder: `npr. domaci-vms:${a.port} ali 100.101.102.103:${a.port}`, spellcheck: false });

  const save = async () => {
    const l = cleanUrl(lan.value), r = cleanUrl(remote.value);
    if (l === null || r === null) return toast('Naslov ni veljaven. Vpišite IP ali ime in vrata, npr. 192.168.1.20:8080', 'warn');
    try { await put('/api/settings', { lan_url: l || null, remote_url: r || null }); toast('Shranjeno'); go('access'); } catch (e) { toastErr(e); }
  };

  const L = a.lan, R = a.remote;
  const phoneUrl = `${R || L || location.origin}/m/`;
  const code = connectionCode(a.system_name, L, R);

  clear(page,
    pageHead('Dostop z naprav', 'Namizna aplikacija na računalniku in pogled na telefonu, doma in od zunaj.'),
    h('div', { class: 'grid-2' },
      h('div', { class: 'panel' }, h('h2', {}, 'Naslova strežnika'),
        field('Doma (lokalno omrežje)', lan, 'IP naslov NAS-a ali mini PC-ja v domačem omrežju in vrata.'),
        field('Od zunaj (zasebni VPN)', remote, 'Naslov strežnika v omrežju Tailscale ali WireGuard. Brez VPN-ja strežnik od zunaj ni dosegljiv.'),
        h('button', { class: 'btn btn-primary', onclick: save }, 'Shrani')),
      h('div', { class: 'panel' }, h('h2', {}, 'Kako deluje dostop od zunaj'),
        h('p', {}, 'Strežnik ni objavljen na internetu: na usmerjevalniku ni odprtih vrat in ni spletne strani, ki bi jo lahko kdo našel.'),
        h('p', {}, 'Računalnik in telefon se z domom povežeta prek zasebnega VPN-ja (Tailscale ali WireGuard). Tako se kamere vidijo kot doma, a samo z vaših naprav.'),
        h('p', { class: 'muted', style: { fontSize: '12.5px' } }, 'Namestitev VPN-ja je opisana v navodilih (README), poglavje »Dostop od zunaj«.')),

      h('div', { class: 'panel' }, h('h2', {}, icon('monitor', 18), ' Namizna aplikacija (Windows)'),
        h('ol', { class: 'steps' },
          h('li', {}, 'Prenesite in zaženite namestitveni program ', h('a', { href: DESKTOP_DOWNLOAD, target: '_blank', rel: 'noopener' }, 'VisionOne-Kamere-Setup.exe'), '.'),
          h('li', {}, 'Ob prvem zagonu prilepite spodnjo kodo za povezavo ali vpišite oba naslova.'),
          h('li', {}, 'Aplikacija sama izbere domači naslov, kadar ste doma, in VPN naslov, kadar niste.')),
        L || R
          ? h('div', { class: 'code-box' }, h('code', { class: 'mono' }, code), copyBtn(code, 'Kopiraj kodo'))
          : h('p', { class: 'muted' }, 'Najprej vpišite in shranite naslova strežnika.')),

      h('div', { class: 'panel panel-wide' }, h('h2', {}, icon('phone', 18), ' Telefon'),
        h('div', { class: 'phone-grid' },
          qrImg(phoneUrl),
          h('div', {},
            h('ol', { class: 'steps' },
              h('li', {}, 'Na telefonu namestite aplikacijo Tailscale (ali WireGuard) in se prijavite z istim računom.'),
              h('li', {}, 'S kamero telefona skenirajte kodo QR in odprite pogled kamer.'),
              h('li', {}, 'iPhone: Deli → Dodaj na začetni zaslon. Android: meni ⋮ → Dodaj na začetni zaslon.')),
            h('div', { class: 'code-box' }, h('code', { class: 'mono' }, phoneUrl), copyBtn(phoneUrl)),
            !R ? h('p', { class: 'muted', style: { fontSize: '12.5px' } }, 'Brez naslova VPN koda QR deluje samo v domačem omrežju.') : null)))));
}
