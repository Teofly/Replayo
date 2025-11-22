# RePlayo REST API

API backend per permettere all'app web di accedere al database PostgreSQL.

## Setup

```bash
cd backend
npm install
npm start
```

## Endpoints

### Health Check
```
GET /api/health
```

### Verify Match Access
```
POST /api/matches/verify
Body: {
  "bookingCode": "PADEL2024",
  "password": "DEMO1234",
  "playerName": "Mario Rossi"
}
```

### Get Videos by Match
```
GET /api/videos/match/:matchId
```

### Increment View Count
```
POST /api/videos/:videoId/view
```

### Increment Download Count
```
POST /api/videos/:videoId/download
```

## Test

```bash
# Health check
curl http://localhost:3000/api/health

# Verify access
curl -X POST http://localhost:3000/api/matches/verify \
  -H "Content-Type: application/json" \
  -d '{"bookingCode":"PADEL2024","password":"DEMO1234","playerName":"Mario Rossi"}'
```

## Deploy

Puoi deployare su:
- Heroku
- Vercel
- Railway
- DigitalOcean
- AWS/Azure/GCP

O direttamente sul server Linux:
```bash
# Sul server 192.168.1.175
cd /home/teofly/replayo-api
npm install
npm install -g pm2
pm2 start server.js --name replayo-api
pm2 startup
pm2 save
```
