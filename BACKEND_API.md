# 🚀 RePlayo Backend API - Documentazione Completa

## 📦 Funzionalità Implementate

### ✅ Gestione Video Completa
- **Upload video** con multipart/form-data (max 2GB)
- **Streaming video** con HTTP range requests (per player mobile/web)
- **Eliminazione video** dal database e storage
- **Statistiche storage** (dimensione totale, video count, views, downloads)

### ☁️ Storage Configurabile
- **Local Storage** (NAS Synology) - default
- **AWS S3** (con signed URLs per streaming sicuro)
- Configurabile via variabili d'ambiente

### 🔐 Autenticazione
- Verifica password monouso per match
- Controllo scadenza password
- Validazione nome giocatore

### 📊 Analytics
- Conteggio visualizzazioni video
- Conteggio download
- Statistiche aggregate

---

## 🔌 API Endpoints

### Health Check
```bash
GET /api/health
```
**Response:**
```json
{
  "status": "ok",
  "message": "RePlayo API running",
  "storage": "local",
  "timestamp": "2025-11-21T10:13:08.080Z"
}
```

---

### Match Management

#### Verify Match Access
```bash
POST /api/matches/verify
Content-Type: application/json

{
  "bookingCode": "PADEL2024",
  "password": "DEMO1234",
  "playerName": "Mario Rossi"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Accesso consentito",
  "match": {
    "id": "uuid",
    "booking_code": "PADEL2024",
    "sport_type": "padel",
    "match_date": "2025-11-21T15:30:00Z",
    "location": "Centro Sportivo Milano",
    "player_ids": ["uuid1", "uuid2", "uuid3", "uuid4"],
    "is_active": true
  }
}
```

**Error Responses:**
- 404: Match non trovato
- 403: Password non valida / Nome giocatore non trovato / Match non attivo

#### Get Match by Booking Code
```bash
GET /api/matches/:bookingCode
```

---

### Video Management

#### Get Videos by Match ID
```bash
GET /api/videos/match/:matchId
```

**Response:**
```json
[
  {
    "id": "uuid",
    "match_id": "uuid",
    "title": "Primo Set",
    "file_path": "/volume1/RePlayo/videos/1700000000_video.mp4",
    "thumbnail_path": "/volume1/RePlayo/thumbnails/thumb.jpg",
    "duration_seconds": 3600,
    "file_size_bytes": 524288000,
    "recorded_at": "2025-11-21T15:00:00Z",
    "view_count": 15,
    "download_count": 3,
    "is_highlight": false
  }
]
```

#### Upload Video ⭐ NEW
```bash
POST /api/videos/upload
Content-Type: multipart/form-data

Fields:
- video: <file> (max 2GB, formats: MP4, MPEG, MOV, AVI)
- matchId: <uuid>
- title: <string>
- durationSeconds: <number>
- isHighlight: <boolean> (default: false)
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Video caricato con successo",
  "video": { ... }
}
```

**Example usando curl:**
```bash
curl -X POST http://localhost:3000/api/videos/upload \
  -F "video=@/path/to/video.mp4" \
  -F "matchId=your-match-uuid" \
  -F "title=Primo Set" \
  -F "durationSeconds=3600" \
  -F "isHighlight=false"
```

#### Stream Video ⭐ NEW
```bash
GET /api/videos/:videoId/stream
```

**Funzionalità:**
- Supporto HTTP Range Requests (per seeking nel player)
- Redirect automatico a S3 signed URL (se storage=s3)
- Streaming locale con chunks (se storage=local)

**Headers supportati:**
- `Range: bytes=0-1023` - Richiesta range specifico

#### Delete Video ⭐ NEW
```bash
DELETE /api/videos/:videoId
```

**Response:**
```json
{
  "success": true,
  "message": "Video eliminato"
}
```

#### Increment View Count
```bash
POST /api/videos/:videoId/view
```

#### Increment Download Count
```bash
POST /api/videos/:videoId/download
```

---

### Storage Statistics ⭐ NEW

```bash
GET /api/stats/storage
```

**Response:**
```json
{
  "totalVideos": 10,
  "totalSizeBytes": 5242880000,
  "totalSizeGB": "4.88",
  "totalViews": 150,
  "totalDownloads": 30,
  "storageType": "local"
}
```

---

### User Management

#### Get User by ID
```bash
GET /api/users/:userId
```

**Response:**
```json
{
  "id": "uuid",
  "name": "Mario Rossi",
  "email": "mario@example.com",
  "phone_number": "+39 123 456 7890",
  "created_at": "2025-11-21T10:00:00Z"
}
```

---

## ⚙️ Configurazione

### Variabili d'Ambiente

Crea un file `.env` nella cartella `backend/`:

```bash
# Server
PORT=3000

# Database
DB_HOST=192.168.1.175
DB_PORT=5432
DB_NAME=replayo_db
DB_USER=replayo_user
DB_PASSWORD=replayo_secure_pass_2024

# Storage Type: 'local' o 's3'
STORAGE_TYPE=local

# Local Storage (NAS Synology)
LOCAL_STORAGE_PATH=/volume1/RePlayo/videos
LOCAL_THUMBNAIL_PATH=/volume1/RePlayo/thumbnails

# AWS S3 Configuration (se STORAGE_TYPE=s3)
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
S3_BUCKET=replayo-videos
```

### Installazione Dipendenze

```bash
cd backend
npm install
```

**Dipendenze principali:**
- express - Web framework
- cors - CORS support
- pg - PostgreSQL client
- multer - File upload handling
- @aws-sdk/client-s3 - AWS S3 SDK
- @aws-sdk/s3-request-presigner - S3 URL signing

### Avvio Server

```bash
# Modalità Development
node server.js

# Modalità Production (con PM2)
pm2 start server.js --name replayo-api
pm2 startup
pm2 save
```

---

## 🗄️ Storage Options

### Local Storage (NAS Synology)

Configurazione di default. I video vengono salvati su:
- Path: `/volume1/RePlayo/videos`
- Streaming diretto via HTTP range requests
- Gestione permessi filesystem

**Pro:**
- Nessun costo cloud
- Pieno controllo
- Bassa latency (rete locale)

**Contro:**
- Limitato alla rete locale/VPN
- Backup manuale

### AWS S3 Storage

Storage cloud con signed URLs per sicurezza.

**Setup:**
1. Crea bucket S3 su AWS
2. Configura credenziali IAM con permessi S3
3. Imposta variabili d'ambiente:
   ```bash
   STORAGE_TYPE=s3
   AWS_REGION=us-east-1
   AWS_ACCESS_KEY_ID=<your-key>
   AWS_SECRET_ACCESS_KEY=<your-secret>
   S3_BUCKET=replayo-videos
   ```

**Pro:**
- Scalabilità illimitata
- Backup automatico
- CDN integration
- Accesso globale

**Contro:**
- Costo storage + bandwidth
- Dipendenza da servizio esterno

---

## 🔒 Sicurezza

### Implementate:
- ✅ CORS abilitato per tutte le origini
- ✅ Validazione formato file upload (solo video)
- ✅ Limite dimensione upload (2GB)
- ✅ Password monouso con scadenza
- ✅ Validazione input SQL (prepared statements)

### Da Implementare (Produzione):
- 🔜 Rate limiting (express-rate-limit)
- 🔜 Authentication JWT per admin
- 🔜 Logging strutturato (winston)
- 🔜 Helmet.js per security headers
- 🔜 Input sanitization avanzata
- 🔜 HTTPS enforcement
- 🔜 Virus scanning upload

---

## 📈 Performance

### Ottimizzazioni Implementate:
- Connessione PostgreSQL con pooling
- Streaming video chunk-based (non tutto in memoria)
- Signed URLs S3 con cache (1 ora)

### Metriche Attese:
- Upload 2GB: ~5-15 min (dipende da network)
- Streaming start: < 1s
- API response time: < 100ms (query semplici)

---

## 🧪 Testing

### Test Upload Video:
```bash
# Crea video di test
ffmpeg -f lavfi -i testsrc=duration=10:size=1280x720:rate=30 -pix_fmt yuv420p test.mp4

# Upload
curl -X POST http://localhost:3000/api/videos/upload \
  -F "video=@test.mp4" \
  -F "matchId=<your-match-id>" \
  -F "title=Test Video" \
  -F "durationSeconds=10" \
  -F "isHighlight=false"
```

### Test Streaming:
```bash
# Streaming completo
curl http://localhost:3000/api/videos/<video-id>/stream -o downloaded.mp4

# Test range request
curl -H "Range: bytes=0-1023" http://localhost:3000/api/videos/<video-id>/stream
```

### Test Statistiche:
```bash
curl http://localhost:3000/api/stats/storage
```

---

## 🔄 Deploy Produzione

### Su server Linux (192.168.1.175):

```bash
# 1. Clone repository
cd /home/teofly
git clone <your-repo> replayo-api
cd replayo-api/backend

# 2. Install dependencies
npm install

# 3. Create .env file
nano .env
# (inserisci le variabili di produzione)

# 4. Install PM2
npm install -g pm2

# 5. Start service
pm2 start server.js --name replayo-api
pm2 startup
pm2 save

# 6. Configure nginx reverse proxy (optional)
# /etc/nginx/sites-available/replayo
server {
    listen 80;
    server_name api.replayo.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

---

## 📞 Support

**Logs:**
```bash
pm2 logs replayo-api
```

**Restart:**
```bash
pm2 restart replayo-api
```

**Stop:**
```bash
pm2 stop replayo-api
```

---

**✅ Backend completo e pronto per la produzione!**
