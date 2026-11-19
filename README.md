# Domači VMS

Videonadzor za domače kamere: strežnik teče na NAS-u ali mini PC-ju, kamere gledate v **namizni aplikaciji** na računalniku in v **pogledu za telefon**, doma in od zunaj.

- **Strežnik** (Docker): živa slika, snemanje, dogodki, nastavitve. Baza je vgrajena.
- **VisionOne Kamere** za Windows: samostojna aplikacija s svojim oknom in ikono, brez brskalnika.
- **Telefon**: lahek pogled kamer, ki ga dodate na začetni zaslon (ni aplikacija iz trgovine).
- **Dostop od zunaj prek zasebnega VPN-ja** (Tailscale ali WireGuard). Strežnik ni objavljen na internetu, na usmerjevalniku ne odpirate nobenih vrat.
- Kamere in snemalniki: **Hikvision**, **Dahua**, **Provision-ISR**, **DVC**, Uniview in vse naprave z **ONVIF** ali **RTSP**.

```
  doma                                         od zunaj
┌──────────────┐   domače omrežje   ┌──────────────────────┐   zasebni VPN    ┌───────────────┐
│ kamere, NVR  │ ─────────────────▶ │  NAS / mini PC       │ ◀═══════════════ │ prenosnik,    │
└──────────────┘                    │  strežnik VMS        │   (Tailscale)    │ telefon       │
                                    │  + go2rtc + baza     │                  └───────────────┘
                                    └──────────────────────┘
```

---

## 1. Namestitev strežnika na NAS ali mini PC

Potrebujete Docker. Na **Synology** je to *Container Manager*, na **QNAP** *Container Station*, na mini PC-ju z Linuxom `docker` in `docker compose`, na Windows mini PC-ju *Docker Desktop*.

1. Prenesite to mapo na NAS (npr. `/volume1/docker/domaci-vms`).
2. Kopirajte `.env.example` v `.env` in vpišite vsaj:
   - `ADMIN_PASSWORD`: geslo skrbnika (kasneje ga spremenite v aplikaciji),
   - `HOST_IP`: IP naslov NAS-a v domačem omrežju (npr. `192.168.1.20`),
   - `RECORDINGS_PATH`: mapa za posnetke (Synology npr. `/volume1/kamere`).
3. Zaženite:
   ```
   ./zagon.sh            (Linux, NAS prek SSH)
   zagon.bat             (Windows mini PC)
   ```
   Na Synologyju lahko v Container Managerju ustvarite *Projekt* in izberete `docker-compose.yml`.
4. Na računalniku doma odprite `http://<HOST_IP>:8080/admin/`, se prijavite kot `admin` in **spremenite geslo** (Sistem → Moj račun).

Posodobitev: `docker compose up -d --build` v isti mapi. Zaustavitev: `docker compose down`.

---

## 2. Dostop od zunaj (zasebni VPN)

Kamer ne odpiramo na internet. Namesto tega vaše naprave (računalnik, telefon) in NAS povežemo v zasebno omrežje. Od zunaj tako strežnik vidijo samo vaše naprave, kot da bi bile doma.

### Možnost A: Tailscale (priporočeno, najlažje)

Brezplačno za osebno uporabo, deluje tudi, če vaš ponudnik interneta nima javnega IP naslova.

1. Ustvarite račun na [tailscale.com](https://tailscale.com).
2. **NAS**:
   - **Synology**: v *Centru za pakete* namestite *Tailscale* in se prijavite. Ali
   - **Docker**: na [login.tailscale.com → Settings → Keys](https://login.tailscale.com/admin/settings/keys) ustvarite *Auth key*, ga vpišite v `.env` kot `TS_AUTHKEY` in zaženite znova (`zagon.sh` sam vklopi profil `vpn`).
3. V nadzorni plošči Tailscale preberite naslov NAS-a (`100.x.y.z`) in ga vpišite v `.env` kot `VPN_HOST`. Zaženite znova.
4. Na **računalniku** in **telefonu** namestite aplikacijo Tailscale in se prijavite z istim računom.

### Možnost B: WireGuard na usmerjevalniku ali NAS-u

Če vaš usmerjevalnik (npr. FRITZ!Box, MikroTik, UniFi, ASUS) ali NAS že ponuja WireGuard VPN, ga lahko uporabite namesto Tailscala. V `.env` vpišite `VPN_HOST` kot naslov NAS-a, ki ga vidite skozi VPN (pri usmerjevalniku je to običajno kar domači naslov, npr. `192.168.1.20`). Potrebujete javni IP naslov in eno odprto vrata za WireGuard (to je zaščiteno s ključi, kamere niso izpostavljene).

### Nato

V Admin → **Dostop z naprav** preverite oba naslova (*Doma* in *Od zunaj*) in ju shranite. Tam najdete kodo za namizno aplikacijo in kodo QR za telefon.

---

## 3. Namizna aplikacija za Windows

1. Na GitHubu odprite **Releases** tega repozitorija in prenesite `VisionOne-Kamere-Setup.exe`.
2. Zaženite ga. Ker program ni digitalno podpisan, Windows SmartScreen morda prikaže opozorilo: *Več informacij → Vseeno zaženi*.
3. Ob prvem zagonu prilepite **kodo za povezavo** iz Admin → Dostop z naprav (ali vpišite oba naslova).
4. Prijavite se. Kljukica *Ostani prijavljen na tej napravi* je v aplikaciji vklopljena (seja traja 60 dni, `REMEMBER_DAYS`).

Kaj aplikacija naredi sama:
- doma uporablja domači naslov, zunaj samodejno preklopi na VPN (preverja vsakih 30 s in ob prebujanju računalnika),
- ob izpadu strežnika pokaže, kaj preveriti, in se poveže znova, ko je strežnik spet dosegljiv,
- zapomni si velikost okna in celozaslonski način (F11).

Meni *Aplikacija*: nastavitve povezave (Ctrl+,), nastavitve sistema (Admin), zagon ob prijavi v Windows, »zaslon naj ne ugasne« za stenski monitor. Meni *Pogled*: Živo, Predvajanje, Dogodki, Pametno iskanje (Ctrl+1–4).

Namestitveni program se zgradi samodejno na GitHubu (Actions → *Namizna aplikacija*) ob vsaki spremembi mape `desktop/`. Novo različico izdate tako, da v `desktop/package.json` povečate `version`.

---

## 4. Telefon

1. Na telefonu vklopite Tailscale (ali WireGuard).
2. S kamero telefona skenirajte kodo QR v Admin → Dostop z naprav, ali odprite `http://<VPN_HOST>:8080/`. Telefon se samodejno odpre v pogledu za telefon.
3. **iPhone** (Safari): Deli → *Dodaj na začetni zaslon*. **Android** (Chrome): ⋮ → *Dodaj na začetni zaslon*.

Pogled za telefon: sličice vseh kamer (osvežujejo se samo tiste na zaslonu, da ne porabite preveč prenosa podatkov), dotik odpre živo sliko čez cel zaslon (SD/HD, poteg levo/desno za drugo kamero, povečava s prsti, dvojni dotik), zavihek *Dogodki* z zadnjimi alarmi. V zgornjem desnem kotu vidite, ali ste povezani doma ali prek VPN-ja.

---

## 5. Baza podatkov

Zunanje baze **ne potrebujete**: strežnik ima vgrajeno bazo SQLite v mapi `data/vms`. V Admin → **Sistem → Baza podatkov** vidite velikost in stanje baze, jo lahko prenesete kot eno datoteko ali optimizirate.

Varnostna kopija: shranite mapo `data/` (npr. s Hyper Backup na Synologyju) ali v Admin → Sistem → *Prenesi kopijo* (samo nastavitve). Posnetki so v ločeni mapi `RECORDINGS_PATH`.

---

## 6. Dodajanje kamer (Admin)

**Dodajanje snemalnika (NVR/DVR) z vsemi kamerami** – Snemalniki → Dodaj snemalnik. Vpišete IP, uporabnika in geslo; strežnik samodejno prepozna proizvajalca, prebere vse kanale z imeni in stanjem, diske snemalnika ter jih uvozi kot kamere.

| Proizvajalec | Uvoz kanalov | Imena kamer | Stanje diskov | Predvajanje s snemalnika | Časovnica posnetkov | PTZ |
|---|---|---|---|---|---|---|
| Hikvision / HiLook / HiWatch (ISAPI) | da | da | da | da | da | da |
| Dahua / Imou / Lorex (CGI) | da | da | da | da | – | da |
| Uniview | da (ONVIF) | da | – | da | – | ONVIF |
| Drugi (ONVIF) | da | da | – | – | – | ONVIF |
| Ročna predloga RTSP | da | – | – | – | – | – |

**Kje se snema – za vsako kamero posebej** (Kamere → Uredi → Snemanje):
- **Na snemalnik** – NVR snema kot doslej, VisionOne posnetke predvaja z njega.
- **Na strežnik** – VisionOne snema na diske v strežniku (1-minutne MP4 datoteke).
- **Oboje** – dvojna varnost.
- **Ne snemaj** – samo živa slika.

Načini snemanja: stalno, ob dogodku (s pred- in po-snemanjem) ali po tedenskem urniku. Rok hrambe se nastavi po kameri; ko je disk poln, se brišejo najstarejši nezaklenjeni posnetki.

**Več diskov v strežniku**: v `docker-compose.yml` dodajte vrstico, npr. `- /volume2/kamere:/recordings/disk2`, ponovno zaženite in disk dodajte v Snemanje in diski. Za vsak disk lahko nastavite kvoto in najmanjši prosti prostor.

**Iskanje naprav** – vpišite območje lokalnega omrežja (npr. `192.168.1.0/24`). Docker Desktop na Windows/macOS ne prepušča ONVIF multicasta, zato VisionOne vsak naslov preveri posebej (ONVIF unicast + vrata 80, 554, 8000, 37777).

Ostalo: skupine kamer, tlorisi z razporeditvijo kamer, pravila in alarmi (resnost, pojavno okno, zvok, push obvestila ntfy, webhook, MQTT, zaklep posnetka, premik PTZ), uporabniki z vlogami in dostopom do posameznih kamer, revizijska sled (GDPR), API žetoni, varnostna kopija nastavitev.


**Provision-ISR** in **DVC**: dodajte jih kot snemalnik z izbiro *ONVIF* ali kot posamezno kamero prek ONVIF. Če ONVIF ni vklopljen, ga vklopite v nastavitvah kamere/snemalnika (Omrežje → ONVIF) ali uporabite *Ročno predlogo RTSP*.

## 7. Kaj zna namizna aplikacija (View)

- mreže 1, 4, 6, 9, 12, 16, 25, 36; povleci in spusti; shranjeni in skupni pogledi; samodejno kroženje
- dvoklik poveča kamero (glavni tok), v mreži se uporablja podtok
- digitalni zoom (kolešček), posnetek zaslona, takojšnje predvajanje zadnjih 30 s
- PTZ z hitrostjo in prednastavljenimi položaji, ročni alarm, zvok, dvosmerni zvok (potrebuje HTTPS in WebRTC)
- predvajanje do 4 kamer sinhrono, časovnica s posnetki strežnika in snemalnika ter dogodki, hitrost do 16×, skok na dogodke
- izvoz MP4 z vodnim žigom in kontrolno vsoto SHA-256, zaznamki in zaklepanje posnetkov
- dogodki v živo, potrjevanje alarmov s komentarjem, pojavna okna
- **pametno iskanje** v slovenščini: »oseba včeraj med 14 in 16«, »rdeč avto ponoči«, »oseba dvorišče«
- statistika (osebe, vozila, štetje na linijah), tloris s kamerami


## 8. Zaznavanje oseb in vozil (neobvezno)

Zaženite z `docker compose --profile ai up -d --build`, nato pri kameri vklopite **Pametne funkcije**:
- zaznava oseb, vozil, koles, živali (model YOLO, deluje na procesorju)
- vstop v območje, prečkanje linije s smerjo (štetje noter/ven), zadrževanje v območju
- prevladujoča barva (za iskanje »rdeč avto«)
- sabotaža: prekrita, zamegljena ali premaknjena kamera
- sličica z označenim objektom pri vsakem dogodku

Obremenitev: približno 1 procesorsko jedro za 4–6 kamer pri 2 analizah na sekundo. Brez AI modula strežnik še vedno sprejema dogodke kamer prek ONVIF (gibanje, linija, vdor, sabotaža).


## 9. Home Assistant

Admin → Integracije → MQTT: vpišite IP Home Assistanta (Mosquitto dodatek), uporabnika in geslo. Za vsako kamero se v HA pojavijo senzorji *gibanje, oseba, vozilo, povezava, sabotaža* in *zadnji dogodek*. Teme: `visionone/events`, `visionone/camera/<id>/...`.

Sliko kamere v HA dobite z naslovom `http://<strežnik>:8080/api/cameras/<id>/snapshot` in API žetonom ali z RTSP restreamom (odkomentirajte vrata 8554 v `docker-compose.yml`).


## 10. Varnost

- Strežnika **ne odpirajte neposredno v internet** (posredovanje vrat 8080 na usmerjevalniku). Za dostop od zunaj uporabite VPN (poglavje 2).
- Ob spremembi gesla se vse druge naprave odjavijo.
- Vklopite dvofaktorsko prijavo za skrbnika (Admin → Sistem).
- Za gledanje uporabljajte uporabnika z vlogo *Opazovalec* (Admin → Uporabniki), skrbniški račun pa samo za nastavitve.

## 11. Razvoj

- Strežnik: `cd vms && DATA_DIR=./data RECORDINGS_ROOT=./rec node src/index.js` (Node 22.13+, brez zunanjih knjižnic; živa slika potrebuje go2rtc).
- Namizna aplikacija: `cd desktop && npm install && npm start`.

## 12. Omejitve in kaj preveriti

- **Kodeki v brskalniku**: H.264 deluje povsod. H.265 (HEVC) predvajajo Chrome, Edge in Safari na novejši strojni opremi; za starejše računalnike nastavite podtok kamere na H.264.
- **Predvajanje s snemalnika Hikvision** uporablja lokalni čas snemalnika; strežnik in snemalnik naj imata isti časovni pas (NTP).
- Prepoznava registrskih tablic še ni vključena.
- Maske zasebnosti delujejo v živi sliki View, ne pa v posnetkih in izvozih.


## Zgradba

```
domaci-vms/
├── docker-compose.yml      strežnik, go2rtc, Tailscale (profil vpn), AI (profil ai)
├── .env.example            nastavitve
├── go2rtc/go2rtc.yaml      pretvorba slike kamer za živo sliko
├── vms/                    strežnik (Node.js, brez zunanjih knjižnic)
│   ├── src/                API, ONVIF, snemalniki, snemanje, dogodki, baza
│   └── web/                admin/ (nastavitve), view/ (celoten pogled), m/ (telefon), common/
├── desktop/                namizna aplikacija VisionOne Kamere (Electron)
│   └── app/                okno, povezovalni zaslon, samodejna izbira naslova
├── .github/workflows/      gradnja namestitvenega programa za Windows
└── ai/                     zaznavanje oseb in vozil (Python, YOLO)
```

Uporabljeni odprtokodni projekti: [go2rtc](https://github.com/AlexxIT/go2rtc) (MIT), [Electron](https://www.electronjs.org) (MIT), [Tailscale](https://github.com/tailscale/tailscale) (BSD-3), [Ultralytics YOLO](https://github.com/ultralytics/ultralytics) (AGPL-3.0), [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) (MIT), FFmpeg (LGPL/GPL).
