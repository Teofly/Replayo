# Implementazioni Future RePlayo

## 1. Menu Impostazioni Admin Dashboard

### Stato attuale
Esiste già una pagina "Impostazioni" (`page-settings`) con:
- Configurazione SMTP (email)
- Sezione "Altre Impostazioni" (vuota)

Esiste tabella `app_config` nel database con endpoint:
- `GET /api/config` - legge configurazioni
- `PUT /api/config/:key` - aggiorna configurazione

Esiste tabella `opening_hours` per orari apertura per giorno della settimana.

---

### ANALISI COMPLETA VARIABILI CONFIGURABILI

#### 🕐 SEZIONE 1: Orari Club
**Già esistente**: tabella `opening_hours` con orari per giorno
**Hardcoded in `server.js:2168-2169`**:
```javascript
const CLUB_OPEN = 8;   // 08:00
const CLUB_CLOSE = 22; // 22:00
```
| Variabile | Tipo | Default | Posizione | Descrizione |
|-----------|------|---------|-----------|-------------|
| club_open_hour | number | 8 | server.js:2168 | Ora apertura club |
| club_close_hour | number | 22 | server.js:2169 | Ora chiusura club |
| slot_interval_minutes | number | 30 | server.js:2224,2345 | Intervallo slot prenotazione |

---

#### ⏱️ SEZIONE 2: Durate Default per Sport
**Hardcoded in `server.js:2172-2175` e `server.js:2087`**:
```javascript
const DURATIONS = {
  padel: { default: 90, fallback: 60 },
  tennis: { default: 60, fallback: null },
  calcetto: { default: 60, fallback: null }
};
const defaultDurations = { padel: 90, tennis: 60, calcetto: 60 };
```
| Variabile | Tipo | Default | Posizione | Descrizione |
|-----------|------|---------|-----------|-------------|
| duration_padel | number | 90 | server.js:2087,2173 | Durata default padel (minuti) |
| duration_padel_fallback | number | 60 | server.js:2173 | Durata alternativa padel |
| duration_tennis | number | 60 | server.js:2087,2174 | Durata default tennis |
| duration_calcetto | number | 60 | server.js:2087,2175 | Durata default calcetto |

---

#### 🎬 SEZIONE 3: Video & Compressione
**Hardcoded in `server.js:161-181`**:
```javascript
.videoCodec('libx264')
.size('?x720')           // Risoluzione
.videoBitrate('2000k')   // Bitrate video
.audioBitrate('128k')    // Bitrate audio
'-crf 23'                // Qualità (18-28, più basso = migliore)
```
| Variabile | Tipo | Default | Posizione | Descrizione |
|-----------|------|---------|-----------|-------------|
| video_resolution | select | 720p | server.js:173 | Risoluzione (480p/720p/1080p) |
| video_bitrate | number | 2000 | server.js:174 | Bitrate video (kbps) |
| audio_bitrate | number | 128 | server.js:176 | Bitrate audio (kbps) |
| video_crf | number | 23 | server.js:179 | Qualità CRF (18-28) |
| video_codec | select | h264 | server.js:172 | Codec (h264/h265) |
| video_retention_days | number | 90 | - | Giorni conservazione video |
| video_auto_cleanup | toggle | false | - | Pulizia automatica video vecchi |

---

#### 📁 SEZIONE 4: Storage & Upload
**Hardcoded in `server.js:131` e `server.js:1485`**:
```javascript
fileSize: 2 * 1024 * 1024 * 1024  // 2GB max video
fileSize: 10 * 1024 * 1024        // 10MB max immagini
```
| Variabile | Tipo | Default | Posizione | Descrizione |
|-----------|------|---------|-----------|-------------|
| max_video_size_gb | number | 2 | server.js:131 | Max dimensione video upload (GB) |
| max_image_size_mb | number | 10 | server.js:1485 | Max dimensione immagine (MB) |
| storage_type | select | local | server.js:19-20 | Tipo storage (local/s3) |
| local_storage_path | text | /mnt/nas/replayo/videos | server.js:21 | Path storage locale |

---

#### 🔗 SEZIONE 5: Synology NAS
**Hardcoded in `server.js:297`**:
```javascript
new SynologyService('192.168.1.69', '5000', 'admin', 'Druido#00')
```
| Variabile | Tipo | Default | Posizione | Descrizione |
|-----------|------|---------|-----------|-------------|
| synology_host | text | 192.168.1.69 | server.js:297 | IP/hostname Synology |
| synology_port | number | 5000 | server.js:297 | Porta Synology |
| synology_user | text | admin | server.js:297 | Username Synology |
| synology_password | password | *** | server.js:297 | Password Synology |

---

#### ⏰ SEZIONE 6: Cron Jobs & Automazioni
**Hardcoded in `cron-video-download.js`**:
```bash
Cron: 55 * * * * (ogni ora al minuto 55)
timeout: 300000 (5 minuti)
```
| Variabile | Tipo | Default | Posizione | Descrizione |
|-----------|------|---------|-----------|-------------|
| cron_video_minute | number | 55 | crontab | Minuto esecuzione cron |
| cron_video_enabled | toggle | true | - | Abilita cron video download |
| cron_timeout_minutes | number | 5 | server.js:363 | Timeout operazioni cron |
| auto_confirm_enabled | toggle | true | cron | Auto-conferma prenotazioni pending |
| auto_confirm_hours_before | number | 2 | cron:77-98 | Ore prima per auto-conferma |

---

#### 📅 SEZIONE 7: Prenotazioni
| Variabile | Tipo | Default | Posizione | Descrizione |
|-----------|------|---------|-----------|-------------|
| booking_advance_days | number | 14 | - | Giorni max prenotazione in anticipo |
| booking_cancel_hours | number | 24 | - | Ore minime per cancellazione |
| booking_reminder_hours | number | 24 | - | Ore prima per reminder |
| booking_default_players | number | 4 | server.js:2112 | Numero giocatori default |
| booking_source_default | select | admin | - | Fonte prenotazione default |

---

#### 🔐 SEZIONE 8: Sicurezza & Autenticazione
**Hardcoded in `server.js:43-44` e `cron-video-download.js:18`**:
```javascript
const ADMIN_USER = process.env.ADMIN_USER || 'demo';
const ADMIN_PASS = process.env.ADMIN_PASS || 'demo';
```
| Variabile | Tipo | Default | Posizione | Descrizione |
|-----------|------|---------|-----------|-------------|
| admin_username | text | demo | server.js:43 | Username admin dashboard |
| admin_password | password | demo | server.js:44 | Password admin dashboard |
| session_expiry_hours | number | 24 | - | Scadenza sessione (ore) |
| s3_url_expiry_hours | number | 1 | server.js:233 | Scadenza URL firmati S3 |
| password_reset_expiry_hours | number | 24 | server.js:2020 | Scadenza link reset password |

---

#### 📊 SEZIONE 9: Statistiche & Dashboard
**Hardcoded in `server.js:1376-1404`**:
```javascript
// Daily trend (last 30 days)
LIMIT 10 // Top 10 campi
```
| Variabile | Tipo | Default | Posizione | Descrizione |
|-----------|------|---------|-----------|-------------|
| stats_trend_days | number | 30 | server.js:1376 | Giorni trend statistiche |
| stats_top_courts_limit | number | 10 | server.js:1404 | Numero top campi da mostrare |
| cache_ttl_seconds | number | 86400 | server.js:1639 | Cache immagini (secondi) |

---

#### 📧 SEZIONE 10: Email (già parzialmente esistente)
| Variabile | Tipo | Default | Posizione | Descrizione |
|-----------|------|---------|-----------|-------------|
| smtp_host | text | - | DB smtp_settings | Host SMTP |
| smtp_port | number | 587 | DB smtp_settings | Porta SMTP |
| smtp_user | text | - | DB smtp_settings | Username SMTP |
| smtp_password | password | - | DB smtp_settings | Password SMTP |
| smtp_from_name | text | RePlayo | - | Nome mittente |
| smtp_from_email | text | - | - | Email mittente |

---

### RIEPILOGO VARIABILI

| Sezione | N. Variabili | Priorità |
|---------|--------------|----------|
| Orari Club | 3 | Alta |
| Durate Sport | 4 | Alta |
| Video & Compressione | 7 | Media |
| Storage & Upload | 4 | Bassa |
| Synology NAS | 4 | Media |
| Cron Jobs | 5 | Alta |
| Prenotazioni | 5 | Alta |
| Sicurezza | 5 | Media |
| Statistiche | 3 | Bassa |
| Email | 6 | Già esistente |

**TOTALE: ~46 variabili configurabili**

---

### RACCOMANDAZIONE IMPLEMENTAZIONE

**Fase 1 - Priorità Alta (17 variabili)**
- Orari Club (3)
- Durate Sport (4)
- Cron Jobs (5)
- Prenotazioni (5)

**Fase 2 - Priorità Media (16 variabili)**
- Video & Compressione (7)
- Synology NAS (4)
- Sicurezza (5)

**Fase 3 - Priorità Bassa (7 variabili)**
- Storage & Upload (4)
- Statistiche (3)

---

### Effort stimato aggiornato
- **Fase 1**: ~3 giorni
- **Fase 2**: ~2 giorni
- **Fase 3**: ~1 giorno
- **Totale completo: ~6 giorni**

### Priorità: ALTA
Questa implementazione è propedeutica alle altre (notifiche, email templates) perché crea l'infrastruttura per gestire configurazioni dinamiche

---

## 2. Messaggistica WhatsApp

### Opzione 1: WhatsApp Business API (ufficiale Meta)
**Pro:**
- Soluzione ufficiale, affidabile e conforme ai ToS
- Messaggi template approvati (promozioni, conferme, reminder)
- Alto volume di messaggi

**Contro:**
- Richiede approvazione Meta Business (1-2 settimane)
- Costo per messaggio (~0.05-0.15€ a seconda del tipo)
- Serve un Business Solution Provider (BSP) come Twilio, MessageBird, 360dialog

### Opzione 2: Twilio per WhatsApp
**Pro:**
- Setup più semplice, API ben documentata
- Pay-as-you-go
- Supporto tecnico buono

**Contro:**
- Costo Twilio + costo Meta per messaggio
- Ancora richiede approvazione template per messaggi proattivi

### Opzione 3: Librerie non ufficiali (es. whatsapp-web.js)
**Pro:**
- Gratuito
- Nessuna approvazione richiesta
- Setup veloce

**Contro:**
- **Viola i ToS di WhatsApp** - rischio ban numero
- Instabile (dipende dal web client)
- Non adatto per produzione

### Raccomandazione: Twilio per WhatsApp
Miglior compromesso qualità/costo/tempo:
- ~2-3 giorni per setup tecnico
- ~1 settimana per approvazione template
- Costi contenuti per volumi bassi/medi

### Funzionalità implementabili:
- Conferma prenotazione automatica
- Reminder 24h prima della partita
- Notifica video disponibile
- Promozioni broadcast a lista giocatori
- Risposta automatica a messaggi in arrivo (chatbot base)

---

---

## 2b. Alternativa: Notifiche Push tramite App

### Opzione 1: Firebase Cloud Messaging (FCM)
**Pro:**
- Gratuito (illimitato)
- Supporta Android, iOS, Web
- Ben integrato con Flutter (pacchetto `firebase_messaging`)
- Affidabile, infrastruttura Google

**Contro:**
- Richiede account Firebase e configurazione per ogni piattaforma
- iOS richiede certificato Apple Push (APN)
- Dipendenza da Google

### Opzione 2: OneSignal
**Pro:**
- Gratuito fino a 10.000 utenti
- Dashboard per invio manuale e analytics
- Segmentazione utenti facile
- Setup più semplice di FCM puro

**Contro:**
- Limiti sul piano gratuito
- Ancora usa FCM/APN sotto il cofano

### Opzione 3: Pusher Beams
**Pro:**
- API semplice
- Buona documentazione
- Dashboard analytics

**Contro:**
- Piano gratuito limitato (1.000 dispositivi)
- Costi crescono rapidamente

### Opzione 4: Self-hosted (es. Gotify, ntfy)
**Pro:**
- Completamente gratuito
- Nessuna dipendenza esterna
- Privacy totale

**Contro:**
- Solo Android (no iOS senza workaround)
- Manutenzione server
- Meno affidabile

### Raccomandazione: Firebase Cloud Messaging (FCM)
Scelta migliore per RePlayo:
- **Gratuito** - nessun costo per messaggio
- **Flutter-ready** - pacchetto ufficiale ben mantenuto
- **Funziona offline** - notifiche arrivano quando torna online

### Funzionalità implementabili:
- Conferma prenotazione automatica
- Reminder prima della partita (configurabile)
- Notifica video disponibile
- Promozioni broadcast a tutti o gruppi specifici
- Notifiche silenziose per sync dati in background

### Effort stimato:
- Setup Firebase + Flutter: 1 giorno
- Certificato iOS (APN): 1-2 ore
- Backend per invio notifiche: 1 giorno
- Test e debug: 1 giorno
- **Totale: ~3 giorni**

---

## 3. Personalizzazione Modelli Email
- Sezione per modificare template email esistenti
- Possibilità di aggiungere nuovi modelli email
- Editor visuale o HTML per personalizzazione
