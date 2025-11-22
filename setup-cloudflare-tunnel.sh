#!/bin/bash
#
# Script di configurazione automatica Cloudflare Tunnel per RePlayo
# Da eseguire sul server Linux (192.168.1.175)
#

set -e  # Exit on error

echo "================================"
echo "Cloudflare Tunnel Setup - RePlayo"
echo "================================"
echo ""

# Variabili
TUNNEL_ID="5c873c0d-b0b6-430d-b854-33d09be7bcf3"
TUNNEL_NAME="replayo"
CONFIG_DIR="/etc/cloudflared"
CREDENTIALS_DIR="/root/.cloudflared"

# Colori per output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Funzioni helper
print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_info() {
    echo -e "${YELLOW}ℹ $1${NC}"
}

# Verifica che lo script sia eseguito come root
if [ "$EUID" -ne 0 ]; then
    print_error "Questo script deve essere eseguito come root"
    echo "Esegui: sudo bash setup-cloudflare-tunnel.sh"
    exit 1
fi

print_info "Inizio configurazione Cloudflare Tunnel..."
echo ""

# Step 1: Installa cloudflared
echo "Step 1/6: Installazione cloudflared"
if command -v cloudflared &> /dev/null; then
    print_success "cloudflared già installato: $(cloudflared --version)"
else
    print_info "Download cloudflared..."

    # Detect architecture
    ARCH=$(uname -m)
    if [ "$ARCH" == "x86_64" ]; then
        URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64"
    elif [ "$ARCH" == "aarch64" ] || [ "$ARCH" == "arm64" ]; then
        URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64"
    else
        print_error "Architettura non supportata: $ARCH"
        exit 1
    fi

    wget -q --show-progress "$URL" -O /tmp/cloudflared
    chmod +x /tmp/cloudflared
    mv /tmp/cloudflared /usr/local/bin/cloudflared

    print_success "cloudflared installato: $(cloudflared --version)"
fi
echo ""

# Step 2: Verifica autenticazione
echo "Step 2/6: Verifica autenticazione Cloudflare"
if [ ! -f "$CREDENTIALS_DIR/${TUNNEL_ID}.json" ]; then
    print_error "Credenziali del tunnel non trovate!"
    print_info "Devi prima autenticare cloudflared con Cloudflare:"
    echo ""
    echo "  1. Esegui: cloudflared tunnel login"
    echo "  2. Segui il link per autenticarti nel browser"
    echo "  3. Poi ri-esegui questo script"
    echo ""
    exit 1
else
    print_success "Credenziali trovate: ${TUNNEL_ID}.json"
fi
echo ""

# Step 3: Crea directory di configurazione
echo "Step 3/6: Creazione directory di configurazione"
mkdir -p "$CONFIG_DIR"
print_success "Directory $CONFIG_DIR creata"
echo ""

# Step 4: Crea file di configurazione
echo "Step 4/6: Creazione file di configurazione"
cat > "$CONFIG_DIR/config.yml" << EOF
tunnel: ${TUNNEL_ID}
credentials-file: ${CREDENTIALS_DIR}/${TUNNEL_ID}.json

# Configurazione logging
loglevel: info

# Ingress rules - definiscono come instradare il traffico
ingress:
  # API Backend (Node.js/Express su porta 3000)
  - hostname: api.teofly.it
    service: http://localhost:3000
    originRequest:
      noTLSVerify: true
      connectTimeout: 30s
      tcpKeepAlive: 30s

  # Frontend Web App (Flutter Web su porta 8081)
  - hostname: replayo.teofly.it
    service: http://localhost:8081
    originRequest:
      noTLSVerify: true
      connectTimeout: 30s
      tcpKeepAlive: 30s

  # Catch-all rule (obbligatoria, deve essere l'ultima)
  - service: http_status:404
EOF

print_success "File di configurazione creato: $CONFIG_DIR/config.yml"
echo ""

# Step 5: Crea servizio systemd
echo "Step 5/6: Creazione servizio systemd"
cat > /etc/systemd/system/cloudflared.service << EOF
[Unit]
Description=Cloudflare Tunnel - RePlayo
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
ExecStart=/usr/local/bin/cloudflared tunnel --config ${CONFIG_DIR}/config.yml run
Restart=on-failure
RestartSec=5s
StandardOutput=journal
StandardError=journal

# Security settings
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

print_success "Servizio systemd creato"
echo ""

# Step 6: Avvia servizio
echo "Step 6/6: Avvio servizio"
systemctl daemon-reload
print_success "systemd daemon ricaricato"

systemctl enable cloudflared
print_success "Servizio cloudflared abilitato all'avvio"

systemctl restart cloudflared
sleep 2

if systemctl is-active --quiet cloudflared; then
    print_success "Servizio cloudflared avviato con successo!"
else
    print_error "Errore nell'avvio del servizio"
    echo ""
    echo "Controlla i log con: journalctl -u cloudflared -n 50"
    exit 1
fi

echo ""
echo "================================"
echo -e "${GREEN}Configurazione completata!${NC}"
echo "================================"
echo ""
echo "URL configurati:"
echo "  • API Backend:  https://api.teofly.it → http://localhost:3000"
echo "  • Web Frontend: https://replayo.teofly.it → http://localhost:8081"
echo ""
echo "Comandi utili:"
echo "  • Stato servizio:    systemctl status cloudflared"
echo "  • Riavvia servizio:  systemctl restart cloudflared"
echo "  • Stop servizio:     systemctl stop cloudflared"
echo "  • Vedi log:          journalctl -u cloudflared -f"
echo "  • Info tunnel:       cloudflared tunnel info ${TUNNEL_ID}"
echo ""
echo -e "${YELLOW}IMPORTANTE:${NC} Configura i record DNS su Cloudflare:"
echo ""
echo "  1. Vai su: https://dash.cloudflare.com"
echo "  2. Seleziona il dominio: teofly.it"
echo "  3. Vai su: DNS → Records"
echo "  4. Aggiungi questi record CNAME (se non esistono):"
echo ""
echo "     Tipo: CNAME"
echo "     Nome: api"
echo "     Target: ${TUNNEL_ID}.cfargotunnel.com"
echo "     Proxy: Attivo (arancione)"
echo ""
echo "     Tipo: CNAME"
echo "     Nome: replayo"
echo "     Target: ${TUNNEL_ID}.cfargotunnel.com"
echo "     Proxy: Attivo (arancione)"
echo ""
echo -e "${GREEN}Setup completato!${NC}"
echo ""
