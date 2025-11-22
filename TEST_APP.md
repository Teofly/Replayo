# 🎉 Database RePlayo Configurato!

## ✅ Configurazione Completata

### Database PostgreSQL su server 192.168.1.175
- ✅ Database: **replayo_db** creato
- ✅ Utente: **replayo_user** con password configurata
- ✅ Tabelle create: users, matches, videos
- ✅ Accesso remoto configurato (porta 5432 aperta)
- ✅ Dati di test inseriti

### 🧪 Dati di Test Disponibili

**Match di Test:**
- Codice Prenotazione: `PADEL2024`
- Password: `DEMO1234`
- Sport: Padel
- Location: Tennis Club Milano - Campo 3

**Giocatori (puoi usare uno di questi nomi):**
- Mario Rossi
- Luigi Verdi
- Giovanni Bianchi
- Paolo Neri

**Video disponibili:**
1. Partita Completa - Set 1 (30 min)
2. Partita Completa - Set 2 (27 min)
3. Highlights - Miglior Punti (3 min) ⭐

## 🚀 Come Testare l'App

### 1. Avvia l'app
```bash
cd /Users/Teofly/replayo
export PATH="$HOME/flutter/bin:$PATH"

# Su Web (consigliato per test rapido)
flutter run -d chrome

# Su macOS
flutter run -d macos

# Su Android (se hai device connesso)
flutter run
```

### 2. Testa l'accesso

**Opzione A - Inserimento Manuale:**
1. Nella home, clicca "Inserisci Codice"
2. Inserisci:
   - Codice Prenotazione: `PADEL2024`
   - Password: `DEMO1234`
   - Nome Giocatore: `Mario Rossi` (o uno degli altri)
3. Clicca ACCEDI

**Opzione B - QR Code:**
1. Genera QR con testo: `REPLAYO:PADEL2024:DEMO1234`
2. Nella home, clicca "Scansiona QR Code"
3. Scansiona il QR
4. Inserisci nome: `Mario Rossi`

### 3. Cosa aspettarsi

✅ **Se funziona:**
- Vedrai la lista dei 3 video del match
- Potrai filtrare tra "MATCH COMPLETO" e "HIGHLIGHTS"
- Cliccando su un video si aprirà il player
- Potrai scaricare e condividere i video

⚠️ **Note:**
- I video useranno URL di esempio (Big Buck Bunny)
- Per usare video reali, carica i file sul NAS e aggiorna i path

## 📊 Query Database Utili

**Verifica connessione dal Mac:**
```bash
PGPASSWORD='replayo_secure_pass_2024' psql -h 192.168.1.175 -U replayo_user -d replayo_db -c "SELECT COUNT(*) FROM matches;"
```

**Vedi tutti i match:**
```bash
PGPASSWORD='replayo_secure_pass_2024' psql -h 192.168.1.175 -U replayo_user -d replayo_db -c "SELECT booking_code, sport_type, location, access_password FROM matches;"
```

**Vedi tutti i video:**
```bash
PGPASSWORD='replayo_secure_pass_2024' psql -h 192.168.1.175 -U replayo_user -d replayo_db -c "SELECT title, duration_seconds, is_highlight FROM videos;"
```

## 🎨 Personalizzazioni

### Cambia Colori Neon
Modifica `/Users/Teofly/replayo/lib/config/app_theme.dart`:
```dart
static const Color neonBlue = Color(0xFF00F0FF);    // Il tuo blu
static const Color neonPurple = Color(0xFF8B5CF6);  // Il tuo viola
static const Color neonPink = Color(0xFFFF006E);    // Il tuo rosa
```

### Aggiungi Nuovo Match
```sql
INSERT INTO matches (booking_code, sport_type, match_date, location, player_ids, access_password, password_expiry)
VALUES (
  'TUOCODICE',
  'tennis',  -- o 'padel', 'soccer'
  CURRENT_TIMESTAMP,
  'Il tuo centro sportivo',
  ARRAY['uuid_giocatore_1', 'uuid_giocatore_2'],
  'TUAPASSWORD',
  CURRENT_TIMESTAMP + INTERVAL '48 hours'
);
```

## 🐛 Problemi Comuni

**App non si connette al DB:**
```bash
# Verifica che PostgreSQL sia attivo
ssh teofly@192.168.1.175
sudo systemctl status postgresql

# Testa connessione
ping 192.168.1.175
```

**Password errata:**
- Verifica in `lib/config/database_config.dart`
- Password corretta: `replayo_secure_pass_2024`

**Porta bloccata:**
```bash
ssh teofly@192.168.1.175
sudo ufw status | grep 5432
# Dovrebbe mostrare: 5432/tcp ALLOW Anywhere
```

## 📱 Build Release

**Android APK:**
```bash
flutter build apk --release
# Output: build/app/outputs/flutter-apk/app-release.apk
```

**macOS:**
```bash
flutter build macos --release
# Output: build/macos/Build/Products/Release/replayo.app
```

**Web:**
```bash
flutter build web --release
# Output: build/web/
# Deploy su hosting (Netlify, Vercel, Firebase Hosting)
```

---

**Tutto pronto! L'app è completamente funzionale. Buon test! 🎾**
