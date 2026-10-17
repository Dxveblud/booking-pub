#!/usr/bin/env bash
# Se su GitHub (branch main) c'e' codice piu' nuovo di quello sulla VM,
# lancia deploy.sh; altrimenti non fa nulla.
# Non va eseguito a mano: ci pensa il timer booking-autoupdate.timer.
set -e

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

git fetch --quiet origin main
if [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ]; then
    echo "Gia' aggiornato ($(git rev-parse --short HEAD))."
    exit 0
fi
bash "$REPO/deploy/deploy.sh"
