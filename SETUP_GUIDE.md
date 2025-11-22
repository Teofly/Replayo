# Guida Setup RePlayo

## 📋 Riepilogo Progetto

**RePlayo** è ora pronto per l'uso! Ecco cosa è stato creato:

### ✅ Struttura Completa
```
replayo/
├── lib/
│   ├── config/
│   │   ├── app_theme.dart           # Tema dark/neon con colori personalizzati
│   │   └── database_config.dart     # Configurazione dual-IP per PostgreSQL
│   ├── models/
│   │   ├── user.dart                # Model utente
│   │   ├── match.dart               # Model partita (padel/tennis/calcetto)
│   │   └── video.dart               # Model video con metadati
│   ├── services/
│   │   ├── database_service.dart    # Servizio PostgreSQL completo
│   │   └── auth_service.dart        # Autenticazione con password monouso
│   ├── screens/
│   │   ├── splash_screen.dart       # Splash animato con effetti neon
│   │   ├── home_screen.dart         # Home con glassmorphism
│   │   ├── match_access_screen.dart # QR scanner + inserimento manuale
│   │   ├── match_videos_screen.dart # Lista video con filtri
│   │   └── video_player_screen.dart # Player con download/share
│   └── main.dart
└── README.md
```

### 🎨 Plugin UI Installati
- ✅ flutter_animate - Animazioni avanzate
- ✅ glassmorphism - Effetti vetro
- ✅ animated_text_kit - Testo animato
- ✅ google_fonts - Font Orbitron, Rajdhani, Roboto
- ✅ shimmer - Effetti loading
- ✅ lottie & rive - Animazioni complesse

### 🔌 Plugin Funzionali
- ✅ postgres - Database PostgreSQL
- ✅ qr_code_scanner - Scanner QR
- ✅ qr_flutter - Generatore QR
- ✅ video_player + chewie - Player video
- ✅ share_plus - Condivisione social
- ✅ fl_chart - Grafici analytics

## 🚀 Avvio Rapido

### 1. Configurare Database

**Sul server PostgreSQL (192.168.1.175 / 2.47.34.88):**

```bash
# Installa PostgreSQL se necessario
sudo apt-get update
sudo apt-get install postgresql postgresql-contrib

# Crea database
sudo -u postgres psql
CREATE DATABASE replayo_db;
CREATE USER replayo_user WITH PASSWORD 'replayo_secure_pass_2024';
GRANT ALL PRIVILEGES ON DATABASE replayo_db TO replayo_user;
\q

# Configura accesso remoto
sudo nano /etc/postgresql/14/main/postgresql.conf
# Modifica: listen_addresses = '*'

sudo nano /etc/postgresql/14/main/pg_hba.conf
# Aggiungi: host all all 0.0.0.0/0 md5

# Riavvia
sudo systemctl restart postgresql

# Apri porta firewall
sudo ufw allow 5432/tcp
```

### 2. Configurare NAS Synology

```bash
# Crea cartella condivisa
# Control Panel > Shared Folder > Create
# Nome: RePlayo
# Path: /volume1/RePlayo/videos

# Imposta permessi di lettura/scrittura
```

### 3. Eseguire App

```bash
cd /Users/Teofly/replayo

# Debug su Chrome/Edge (Web)
export PATH="$HOME/flutter/bin:$PATH"
flutter run -d chrome

# Debug su dispositivo Android/iOS
flutter run

# Build release Android
flutter build apk --release
# Output: build/app/outputs/flutter-apk/app-release.apk

# Build release iOS (su macOS)
flutter build ios --release

# Build Web
flutter build web --release
# Output: build/web/
```

## 🎯 Test dell'App

### Creare un Match di Test

**Script SQL da eseguire:**
```sql
-- Crea utenti test
INSERT INTO users (id, name) VALUES 
  ('550e8400-e29b-41d4-a716-446655440001', 'Mario Rossi'),
  ('550e8400-e29b-41d4-a716-446655440002', 'Luigi Verdi');

-- Crea match di test
INSERT INTO matches (
  id, booking_code, sport_type, match_date, location, 
  player_ids, access_password, password_expiry
) VALUES (
  '660e8400-e29b-41d4-a716-446655440001',
  'BOOK123',
  'padel',
  CURRENT_TIMESTAMP,
  'Tennis Club Milano',
  ARRAY['550e8400-e29b-41d4-a716-446655440001', '550e8400-e29b-41d4-a716-446655440002'],
  'ABC12345',
  CURRENT_TIMESTAMP + INTERVAL '48 hours'
);

-- Crea video di test
INSERT INTO videos (
  match_id, title, file_path, duration_seconds, 
  file_size_bytes, recorded_at, is_highlight
) VALUES (
  '660e8400-e29b-41d4-a716-446655440001',
  'Partita Completa - Set 1',
  'match_123/video_full.mp4',
  3600,
  524288000,
  CURRENT_TIMESTAMP,
  false
);
```

### Testare Accesso

1. Apri RePlayo
2. Scegli "Inserisci Codice"
3. Inserisci:
   - Codice: `BOOK123`
   - Password: `ABC12345`
   - Nome: `Mario Rossi`
4. Dovresti vedere i video del match

### Generare QR Code

**In Python:**
```python
import qrcode

qr_data = "REPLAYO:BOOK123:ABC12345"
qr = qrcode.make(qr_data)
qr.save("match_qr.png")
```

**Online:**
- Vai su https://www.qr-code-generator.com/
- Inserisci: `REPLAYO:BOOK123:ABC12345`
- Scarica il QR

## 🎨 Colori Tema

```dart
// Colori Neon Principali
neonBlue:    #00F0FF  // Blu elettrico
neonPurple:  #8B5CF6  // Viola neon
neonPink:    #FF006E  // Rosa shocking
neonGreen:   #00FF41  // Verde fluo
neonYellow:  #FFEA00  // Giallo neon

// Background
darkBg:      #0A0A0F  // Nero profondo
darkCard:    #1A1A2E  // Blu scurissimo
```

## 📱 Prossimi Passi

1. **Test sul campo**: Usa l'app con dati reali
2. **Personalizza**: Modifica colori e layout secondo preferenze
3. **Deploy**: Pubblica su Play Store / App Store
4. **Analytics**: Implementa dashboard statistiche
5. **Notifiche**: Aggiungi push notifications

## 🔧 Troubleshooting

**L'app non si connette al DB:**
- Verifica che PostgreSQL sia in esecuzione: `sudo systemctl status postgresql`
- Controlla firewall: `sudo ufw status`
- Testa connessione: `psql -h 192.168.1.175 -U replayo_user -d replayo_db`

**Video non si caricano:**
- Verifica path NAS in `lib/config/database_config.dart`
- Controlla permessi cartella sul NAS
- Per test usa URL pubblico nel video player

**QR scanner non funziona:**
- Concedi permessi fotocamera
- Su iOS: Modifica `Info.plist` e aggiungi `NSCameraUsageDescription`
- Su Android: Permessi già configurati in `AndroidManifest.xml`

## 📞 Supporto

Problemi o domande? Controlla:
1. README.md - Documentazione principale
2. Codice sorgente - Tutti i file sono commentati
3. Flutter Doctor: `flutter doctor -v`

---

**App creata e pronta all'uso! 🚀**
