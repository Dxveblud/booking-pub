#!/usr/bin/env bash
# Aggiorna booking sulla VM: scarica l'ultimo codice da GitHub, aggiorna le
# dipendenze se servono e riavvia il servizio.
# Uso (dentro la VM):  bash ~/booking/deploy/deploy.sh
set -e

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

PRIMA="$(git rev-parse HEAD)"
echo "== Scarico gli aggiornamenti da GitHub..."
git fetch --quiet origin main
git reset --quiet --hard origin/main
echo "== $(git rev-parse --short "$PRIMA") -> $(git rev-parse --short HEAD)"

# Dipendenze solo se package-lock.json e' cambiato
if ! git diff --quiet "$PRIMA" HEAD -- package-lock.json; then
    echo "== Dipendenze cambiate: npm ci..."
    npm ci --omit=dev --no-audit --no-fund >/dev/null
fi

echo "== Riavvio il servizio..."
sudo -n systemctl restart booking

PORTA="$(grep -E '^PORT=' .env | cut -d= -f2)"
for _ in $(seq 1 15); do
    if curl -fsS "http://127.0.0.1:${PORTA:-3100}/health" >/dev/null 2>&1; then
        echo "== OK: booking e' online."
        exit 0
    fi
    sleep 2
done
echo "== ERRORE: booking non risponde. Ultimi log:"
journalctl -u booking -n 30 --no-pager
exit 1
