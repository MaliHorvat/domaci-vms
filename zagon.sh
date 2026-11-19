#!/bin/sh
# Domači VMS – zagon na NAS-u ali mini PC-ju (Linux)
cd "$(dirname "$0")"
[ -f .env ] || { cp .env.example .env; echo "Ustvarjena datoteka .env – vpišite geslo, HOST_IP in po želji TS_AUTHKEY, nato zaženite znova."; exit 0; }
PROFILI=""
grep -Eq '^TS_AUTHKEY=.+' .env && PROFILI="--profile vpn"
grep -Eq '^AI_TOKEN=.+' .env && PROFILI="$PROFILI --profile ai"
docker compose $PROFILI up -d --build
IP=$(grep -E '^HOST_IP=' .env | cut -d= -f2)
PORT=$(grep -E '^VMS_PORT=' .env | cut -d= -f2)
echo
echo "Strežnik teče. Doma:  http://${IP:-localhost}:${PORT:-8080}/admin/  (nastavitve)"
[ -n "$PROFILI" ] && echo "Od zunaj prek VPN-ja: http://$(grep -E '^VPN_HOST=' .env | cut -d= -f2):${PORT:-8080}/"
