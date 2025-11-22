#!/bin/bash
#
# Script di monitoraggio e auto-restart per Cloudflare Tunnel
# Controlla ogni 30 secondi se il tunnel è attivo e lo riavvia se necessario
#

TUNNEL_ID="5c873c0d-b0b6-430d-b854-33d09be7bcf3"
CHECK_INTERVAL=30
LOG_FILE="/var/log/tunnel-monitor.log"

# Colori
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

check_tunnel() {
    # Check se il servizio systemd è attivo
    if ! systemctl is-active --quiet cloudflared; then
        return 1
    fi

    # Check se l'API risponde
    if curl -s --max-time 5 https://api.teofly.it/api/health > /dev/null 2>&1; then
        return 0
    else
        return 1
    fi
}

restart_tunnel() {
    log "${YELLOW}Riavvio tunnel in corso...${NC}"

    systemctl stop cloudflared
    sleep 2
    systemctl start cloudflared
    sleep 3

    if systemctl is-active --quiet cloudflared; then
        log "${GREEN}✓ Tunnel riavviato con successo${NC}"
        return 0
    else
        log "${RED}✗ Errore nel riavvio del tunnel${NC}"
        return 1
    fi
}

# Main loop
log "Monitor tunnel avviato"

while true; do
    if check_tunnel; then
        echo -ne "[$(date '+%H:%M:%S')] Tunnel OK\r"
    else
        log "${RED}✗ Tunnel DOWN - Tentativo di riavvio${NC}"
        restart_tunnel
    fi

    sleep "$CHECK_INTERVAL"
done
