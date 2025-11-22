# RePlayo 🎾

**RePlayo** è un'applicazione multipiattaforma per la gestione e visualizzazione di video di partite sportive (Padel, Tennis, Calcetto). Permette ai giocatori di accedere ai video delle proprie partite tramite QR code o codice prenotazione.

## 🎨 Caratteristiche

### UI Dark/Neon Futuristica
- Design moderno con tema scuro e accenti neon (blu, viola, rosa)
- Animazioni fluide con flutter_animate
- Effetti glassmorphism per un look premium
- Font custom con Google Fonts (Orbitron, Rajdhani, Roboto)

### Funzionalità Principali
- Autenticazione con password monouso per sessione di gioco
- Accesso tramite QR code o codice manuale
- Streaming e download video
- Condivisione highlights sui social
- Database PostgreSQL con dual-IP (rete locale/internet)
- Storage video configurabile (NAS Synology)
- Supporto multipiattaforma (Android, iOS, Web, Windows, macOS, Linux)

## 🚀 Setup e Installazione

### Prerequisiti
1. Flutter SDK (versione 3.0+)
2. PostgreSQL (versione 12+)
3. Dart (incluso con Flutter)

### Configurazione Database
```bash
# Crea database
createdb replayo_db
createuser replayo_user

# Imposta password
psql -c "ALTER USER replayo_user WITH PASSWORD 'replayo_secure_pass_2024';"
```

### Installazione App
```bash
# Clona e installa dipendenze
cd replayo
flutter pub get

# Configura database in lib/config/database_config.dart
# Aggiorna IP e credenziali

# Run app
flutter run
```

## 📱 Build Piattaforme

```bash
flutter build apk          # Android
flutter build ios          # iOS  
flutter build web          # Web
flutter build windows      # Windows
flutter build macos        # macOS
flutter build linux        # Linux
```

## 🎯 Utilizzo

1. Ricevi QR code o credenziali dopo la partita
2. Apri RePlayo
3. Scansiona QR o inserisci codice manualmente
4. Inserisci il tuo nome
5. Visualizza, scarica e condividi i tuoi video

## 📂 Struttura Progetto

```
lib/
├── config/          # Configurazioni tema e DB
├── models/          # Data models
├── services/        # Business logic
├── screens/         # UI screens
└── main.dart        # Entry point
```

## 🔐 Sicurezza

- Password monouso (valide 48h)
- Verifica nome giocatore
- Dual-IP (locale/pubblica)
- Connessione PostgreSQL sicura

## 🌐 Network

- Rete locale: 192.168.1.175
- Rete pubblica: 2.47.34.88
- Fallback automatico

Per supporto: support@replayo.com
