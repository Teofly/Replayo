#!/bin/bash
#
# Script per fixare il tunnel Cloudflare che si blocca
#

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}================================${NC}"
echo -e "${YELLOW}Fix Cloudflare Tunnel${NC}"
echo -e "${YELLOW}================================${NC}"
echo ""

# Verifica di essere root
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}✗ Questo script deve essere eseguito come root${NC}"
    echo "Esegui: sudo bash fix-tunnel.sh"
    exit 1
fi

echo "1. Stop servizio cloudflared..."
systemctl stop cloudflared
sleep 2
echo -e "${GREEN}✓ Servizio fermato${NC}"
echo ""

echo "2. Aggiornamento configurazione con timeout più lunghi..."
cat > /etc/cloudflared/config.yml << 'EOF'
tunnel: 5c873c0d-b0b6-430d-b854-33d09be7bcf3
credentials-file: /root/.cloudflared/5c873c0d-b0b6-430d-b854-33d09be7bcf3.json

# Logging
loglevel: info

# Protocol optimization
protocol: quic

# Ingress rules
ingress:
  # API Backend
  - hostname: api.teofly.it
    service: http://localhost:3000
    originRequest:
      noTLSVerify: true
      connectTimeout: 60s
      tcpKeepAlive: 60s
      keepAliveTimeout: 90s
      keepAliveConnections: 100
      httpHostHeader: api.teofly.it

  # Frontend Web App
  - hostname: replayo.teofly.it
    service: http://localhost:8081
    originRequest:
      noTLSVerify: true
      connectTimeout: 60s
      tcpKeepAlive: 60s
      keepAliveTimeout: 90s
      keepAliveConnections: 100
      httpHostHeader: replayo.teofly.it

  # Catch-all
  - service: http_status:404
EOF

echo -e "${GREEN}✓ Configurazione aggiornata${NC}"
echo ""

echo "3. Aggiornamento servizio systemd..."
cat > /etc/systemd/system/cloudflared.service << 'EOF'
[Unit]
Description=Cloudflare Tunnel - RePlayo
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
ExecStart=/usr/local/bin/cloudflared tunnel --config /etc/cloudflared/config.yml run

# Restart automatico aggressivo
Restart=always
RestartSec=5s
StartLimitInterval=0

# Timeout
TimeoutStartSec=60
TimeoutStopSec=30

# Restart ogni 12 ore per evitare memory leaks
RuntimeMaxSec=43200

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=cloudflared

# Security
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

echo -e "${GREEN}✓ Servizio systemd aggiornato${NC}"
echo ""

echo "4. Reload systemd..."
systemctl daemon-reload
echo -e "${GREEN}✓ Systemd ricaricato${NC}"
echo ""

echo "5. Avvio servizio..."
systemctl start cloudflared
sleep 3

if systemctl is-active --quiet cloudflared; then
    echo -e "${GREEN}✓ Servizio avviato con successo${NC}"
else
    echo -e "${RED}✗ Errore nell'avvio del servizio${NC}"
    echo "Vedi log: journalctl -u cloudflared -n 50"
    exit 1
fi

echo ""
echo "6. Test connessione..."
sleep 5

if curl -s --max-time 10 https://api.teofly.it/api/health > /dev/null 2>&1; then
    echo -e "${GREEN}✓ API risponde correttamente!${NC}"
    echo ""
    echo "Risposta completa:"
    curl -s https://api.teofly.it/api/health | jq . 2>/dev/null || curl -s https://api.teofly.it/api/health
else
    echo -e "${YELLOW}⚠ API non risponde ancora (potrebbe richiedere qualche secondo)${NC}"
    echo "Riprova tra 10-15 secondi con: curl https://api.teofly.it/api/health"
fi

echo ""
echo -e "${GREEN}================================${NC}"
echo -e "${GREEN}Fix completato!${NC}"
echo -e "${GREEN}================================${NC}"
echo ""
echo "Comandi utili:"
echo "  • Stato:    systemctl status cloudflared"
echo "  • Log live: journalctl -u cloudflared -f"
echo "  • Restart:  systemctl restart cloudflared"
echo ""
echo "Il servizio ora si riavvierà automaticamente in caso di problemi."
echo ""
