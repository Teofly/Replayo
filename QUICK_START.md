# 🚀 RePlayo - Quick Start Guide

## 🎉 Tutto è GIÀ ATTIVO!

### Servizi Running:
1. ✅ **API REST**: http://localhost:3000 (Node.js + PostgreSQL)
2. ✅ **Flutter App**: Chrome aperto e running
3. ✅ **Database**: PostgreSQL su 192.168.1.175

## 🎯 TEST IMMEDIATO

### Nell'app su Chrome:

1. **Clicca "Inserisci Codice"**

2. **Compila il form:**
   ```
   Codice Prenotazione: PADEL2024
   Password: DEMO1234
   Nome Giocatore: Mario Rossi
   ```

3. **Clicca "ACCEDI"**

### Cosa Succede:
- L'app chiama → API REST (localhost:3000)
- API verifica → Database PostgreSQL (192.168.1.175)  
- Torna → Lista 3 video del match

## 📊 Monitoring

### Vedi richieste API in tempo reale:
Guarda il terminale dove gira Node.js per vedere le chiamate HTTP.

### Test API manualmente:
```bash
# Health check
curl http://localhost:3000/api/health

# Verify match
curl -X POST http://localhost:3000/api/matches/verify \
  -H "Content-Type: application/json" \
  -d '{"bookingCode":"PADEL2024","password":"DEMO1234","playerName":"Mario Rossi"}'
```

## 🔥 Hot Reload

Se modifichi il codice Flutter:
- Premi `r` nel terminale dove gira flutter
- Oppure salva il file (hot reload automatico)

## 📱 Test su Mobile

```bash
# Android (device connesso)
flutter run

# iOS (su macOS con simulator)
flutter run -d ios

# macOS app
flutter run -d macos
```

## 🐛 Troubleshooting

**App non si connette all'API:**
```bash
# Verifica API attiva
curl http://localhost:3000/api/health
# Se non risponde, riavvia:
cd backend && node server.js
```

**Database error:**
```bash
# Test connessione DB
PGPASSWORD='replayo_secure_pass_2024' psql -h 192.168.1.175 -U replayo_user -d replayo_db -c "SELECT COUNT(*) FROM matches;"
```

## 🎨 Personalizza

**Colori tema:**
- File: `lib/config/app_theme.dart`
- Modifica le costanti: `neonBlue`, `neonPurple`, `neonPink`

**API URL:**
- File: `lib/services/api_service.dart`
- Cambia `baseUrl` per produzione

**Icona:**
```bash
# Sostituisci icon.png e rigenera
dart run flutter_launcher_icons
```

## 🚀 Build Release

```bash
# Android APK
flutter build apk --release

# Web
flutter build web --release

# macOS
flutter build macos --release
```

---

**🎾 L'app è pronta! Vai su Chrome e testa!**
