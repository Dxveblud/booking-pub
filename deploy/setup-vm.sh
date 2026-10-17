#!/usr/bin/env bash
# Installa booking sulla VM Oracle (Ubuntu), accanto a quello che c'e' gia'.
# Da lanciare UNA VOLTA SOLA, dentro la VM, dalla cartella clonata:
#     bash ~/booking/deploy/setup-vm.sh booking.dxveblud.dev
#
# Cosa fa (ogni passo si salta da solo se e' gia' fatto):
#   1. Node.js 22 e Docker
#   2. MongoDB in un container, raggiungibile solo dalla VM (127.0.0.1)
#   3. dipendenze npm e file .env con segreti generati a caso
#   4. servizio systemd "booking" (riparte da solo se crasha o al riavvio)
#   5. Caddy davanti, con HTTPS automatico (Let's Encrypt) sul dominio
#   6. aggiornamento automatico: ogni 2 minuti controlla GitHub (branch main)
#
# Prima di lanciarlo:
#   - il record DNS del dominio (tipo A) deve puntare all'IP della VM
#   - porte 80 e 443 aperte nella Security List di Oracle
set -e

DOMINIO="$1"
if [ -z "$DOMINIO" ]; then
    echo "Uso: bash $0 booking.tuodominio.com"
    exit 1
fi

REPO="$(cd "$(dirname "$0")/.." && pwd)"
UTENTE="$(id -un)"
PORTA=3100
SERVIZIO=booking

echo "== Cartella: $REPO   utente: $UTENTE   porta interna: $PORTA"

# La porta deve essere libera, a meno che non sia gia' la nostra
if ss -ltn "sport = :$PORTA" | grep -q LISTEN && ! systemctl is-active --quiet "$SERVIZIO"; then
    echo "== ERRORE: la porta $PORTA e' gia' usata da un altro programma. Cambia PORTA in questo script."
    exit 1
fi

# ---------------------------------------------------------------- Node.js
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
    echo "== Installo Node.js 22..."
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - >/dev/null
    sudo apt-get install -y -q nodejs >/dev/null
fi
echo "== Node $(node -v)"

# ---------------------------------------------------------------- MongoDB
if ! command -v docker >/dev/null; then
    echo "== Installo Docker..."
    sudo apt-get update -q >/dev/null
    sudo apt-get install -y -q docker.io >/dev/null
    sudo systemctl enable --now docker >/dev/null
fi

if ! sudo docker ps -a --format '{{.Names}}' | grep -qx booking-mongo; then
    echo "== Avvio MongoDB (container booking-mongo)..."
    # Solo 127.0.0.1: dall'esterno il database non e' raggiungibile.
    # Cache limitata a 256MB, cosi' convive con gli altri servizi della VM.
    sudo docker run -d --name booking-mongo --restart unless-stopped \
        -p 127.0.0.1:27017:27017 -v booking-mongo:/data/db \
        mongo:7 --wiredTigerCacheSizeGB 0.25 >/dev/null
else
    sudo docker start booking-mongo >/dev/null
fi

# ------------------------------------------------------------ App e .env
cd "$REPO"
echo "== Installo le dipendenze..."
npm ci --omit=dev --no-audit --no-fund >/dev/null

PASSWORD_NUOVA=""
if [ ! -f .env ]; then
    echo "== Creo .env con segreti nuovi..."
    PASSWORD_NUOVA="$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-16)"
    cat > .env <<ENV
NODE_ENV=production
PORT=$PORTA
MONGODB_URI=mongodb://127.0.0.1:27017/booking
SESSION_SECRET=$(openssl rand -hex 48)
ADMIN_USERNAME=admin
ADMIN_PASSWORD=$PASSWORD_NUOVA
WIDGET_ALLOWED_ORIGINS=*
BOOKING_RATE_LIMIT=10
ENV
    chmod 600 .env
else
    echo "== .env esiste gia': lo lascio com'e'."
fi

# ------------------------------------------------------- Servizio systemd
echo "== Configuro il servizio $SERVIZIO..."
sudo tee /etc/systemd/system/$SERVIZIO.service >/dev/null <<UNIT
[Unit]
Description=Booking (prenotazioni online)
After=network-online.target docker.service
Wants=network-online.target

[Service]
User=$UTENTE
WorkingDirectory=$REPO
ExecStart=$(command -v node) src/server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable "$SERVIZIO" >/dev/null 2>&1
sudo systemctl restart "$SERVIZIO"

echo "== Aspetto che l'app risponda..."
for _ in $(seq 1 20); do
    curl -fsS "http://127.0.0.1:$PORTA/health" >/dev/null 2>&1 && break
    sleep 2
done
curl -fsS "http://127.0.0.1:$PORTA/health" >/dev/null 2>&1 || {
    echo "== ERRORE: l'app non parte. Log:"; journalctl -u "$SERVIZIO" -n 40 --no-pager; exit 1; }
echo "== App OK su 127.0.0.1:$PORTA"

# ------------------------------------------------------- Firewall e Caddy
echo "== Apro le porte 80 e 443 nel firewall della VM..."
for porta in 80 443; do
    sudo iptables -C INPUT -p tcp --dport "$porta" -j ACCEPT 2>/dev/null \
        || sudo iptables -I INPUT 1 -p tcp --dport "$porta" -j ACCEPT
done
sudo netfilter-persistent save >/dev/null 2>&1 || true

if ! command -v caddy >/dev/null; then
    echo "== Installo Caddy..."
    sudo apt-get install -y -q debian-keyring debian-archive-keyring apt-transport-https curl gpg >/dev/null
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
        | sudo gpg --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
        | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
    sudo apt-get update -q >/dev/null
    sudo apt-get install -y -q caddy >/dev/null
fi

# Ogni sito ha il suo file in /etc/caddy/sites/: cosi' non tocco i siti gia'
# configurati (es. la verifica del bot) e il Caddyfile principale li importa.
echo "== Configuro Caddy per $DOMINIO..."
sudo mkdir -p /etc/caddy/sites
sudo touch /etc/caddy/Caddyfile
sudo grep -q '^import /etc/caddy/sites/\*' /etc/caddy/Caddyfile \
    || echo 'import /etc/caddy/sites/*.caddy' | sudo tee -a /etc/caddy/Caddyfile >/dev/null
sudo tee /etc/caddy/sites/$SERVIZIO.caddy >/dev/null <<CADDY
$DOMINIO {
    encode gzip
    reverse_proxy 127.0.0.1:$PORTA
}
CADDY
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
sudo systemctl enable --now caddy >/dev/null 2>&1
sudo systemctl reload caddy

# ------------------------------------------------ Aggiornamento automatico
echo "== Attivo l'aggiornamento automatico da GitHub..."
chmod +x "$REPO/deploy/deploy.sh" "$REPO/deploy/autoupdate.sh"
echo "$UTENTE ALL=(ALL) NOPASSWD: /bin/systemctl restart $SERVIZIO, /usr/bin/systemctl restart $SERVIZIO" \
    | sudo tee /etc/sudoers.d/$SERVIZIO-restart >/dev/null
sudo chmod 440 /etc/sudoers.d/$SERVIZIO-restart

sudo tee /etc/systemd/system/$SERVIZIO-autoupdate.service >/dev/null <<UNIT
[Unit]
Description=Aggiorna booking dall'ultimo codice su GitHub
After=network-online.target

[Service]
Type=oneshot
User=$UTENTE
WorkingDirectory=$REPO
ExecStart=/usr/bin/bash $REPO/deploy/autoupdate.sh
UNIT
sudo tee /etc/systemd/system/$SERVIZIO-autoupdate.timer >/dev/null <<UNIT
[Unit]
Description=Controlla GitHub ogni 2 minuti per aggiornare booking

[Timer]
OnBootSec=2min
OnUnitActiveSec=2min
Unit=$SERVIZIO-autoupdate.service

[Install]
WantedBy=timers.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable --now $SERVIZIO-autoupdate.timer >/dev/null 2>&1

# --------------------------------------------------------------- Verifica
echo "== Aspetto il certificato HTTPS..."
OK=""
for _ in $(seq 1 12); do
    if curl -fsS --max-time 5 "https://$DOMINIO/health" >/dev/null 2>&1; then OK=1; break; fi
    sleep 5
done

echo
if [ -n "$OK" ]; then
    echo "============================================================"
    echo "  FATTO:  https://$DOMINIO"
    echo "  Admin:  https://$DOMINIO/admin"
else
    echo "== L'app gira, ma https://$DOMINIO non risponde ancora. Controlla:"
    echo "   - il record DNS di $DOMINIO punta all'IP della VM"
    echo "   - le porte 80 e 443 sono aperte nella Security List di Oracle"
    echo "   Log di Caddy:  journalctl -u caddy -n 30 --no-pager"
fi
if [ -n "$PASSWORD_NUOVA" ]; then
    echo
    echo "  Login admin:  utente  admin"
    echo "                password $PASSWORD_NUOVA"
    echo "  (salvala: e' anche in $REPO/.env)"
fi
echo "============================================================"
echo "  Log app:       journalctl -u $SERVIZIO -f"
echo "  Aggiornamenti: automatici entro 2 minuti da ogni push su main"
