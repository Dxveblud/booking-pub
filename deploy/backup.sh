#!/usr/bin/env bash
# Backup del database e delle foto caricate dai negozi.
# Lo lancia ogni notte il timer booking-backup.timer (vedi setup-vm.sh);
# a mano:  bash ~/booking/deploy/backup.sh
#
# Crea in ~/booking-backups/ (o in BACKUP_DIR):
#   booking-AAAA-MM-GG_HHMM.archive.gz   database (mongodump)
#   uploads-AAAA-MM-GG_HHMM.tar.gz       logo e foto dei negozi
# e cancella quelli più vecchi di BACKUP_KEEP_DAYS giorni (default 14).
#
# Copia fuori dalla VM (consigliata): se BACKUP_RCLONE_REMOTE è impostato
# (es. "gdrive:booking-backups", configurato prima con `rclone config`),
# i file nuovi vengono copiati anche lì.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

# Variabili facoltative da .env (BACKUP_DIR, BACKUP_KEEP_DAYS, BACKUP_RCLONE_REMOTE)
leggi_env() { grep -E "^$1=" .env 2>/dev/null | tail -n1 | cut -d= -f2- | tr -d '"' || true; }
DEST="$(leggi_env BACKUP_DIR)";            DEST="${DEST:-$HOME/booking-backups}"
KEEP="$(leggi_env BACKUP_KEEP_DAYS)";      KEEP="${KEEP:-14}"
REMOTE="$(leggi_env BACKUP_RCLONE_REMOTE)"
UPLOADS="$(leggi_env UPLOAD_DIR)";         UPLOADS="${UPLOADS:-$REPO/uploads}"
DB="$(leggi_env MONGODB_URI | sed -E 's#.*/([^/?]+)(\?.*)?$#\1#')"; DB="${DB:-booking}"

STAMP="$(date +%F_%H%M)"
mkdir -p "$DEST"
chmod 700 "$DEST"

echo "== Database \"$DB\"..."
sudo -n docker exec booking-mongo mongodump --quiet --archive --gzip --db "$DB" > "$DEST/booking-$STAMP.archive.gz.tmp"
mv "$DEST/booking-$STAMP.archive.gz.tmp" "$DEST/booking-$STAMP.archive.gz"

if [ -d "$UPLOADS" ]; then
    echo "== Foto caricate ($UPLOADS)..."
    tar -czf "$DEST/uploads-$STAMP.tar.gz" -C "$(dirname "$UPLOADS")" "$(basename "$UPLOADS")"
fi
chmod 600 "$DEST"/*-"$STAMP".* 2>/dev/null || true

echo "== Elimino i backup più vecchi di $KEEP giorni..."
find "$DEST" -maxdepth 1 -type f \( -name 'booking-*.archive.gz' -o -name 'uploads-*.tar.gz' \) -mtime +"$KEEP" -delete

if [ -n "$REMOTE" ]; then
    if command -v rclone >/dev/null; then
        echo "== Copio su $REMOTE..."
        rclone copy "$DEST" "$REMOTE" --include "*-$STAMP.*"
    else
        echo "== ATTENZIONE: BACKUP_RCLONE_REMOTE è impostato ma rclone non è installato."
    fi
fi

echo "== OK: $(ls -1 "$DEST" | wc -l) file in $DEST"
ls -lh "$DEST"/*-"$STAMP".*
