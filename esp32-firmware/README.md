# RePlayo ESP32 Highlight Button - Firmware

Firmware per pulsante fisico ESP32 che marca momenti salienti durante le partite.

## Hardware Richiesto

- **Board**: AZDelivery ESP32 NodeMCU WiFi CP2102
- **Pulsante**: Momentaneo (normalmente aperto)
- **LED** (opzionale): Per feedback visivo aggiuntivo
- **Alimentazione**: USB 5V

### Schema Collegamenti

```
ESP32 GPIO4  ----[PULSANTE]---- GND
ESP32 GPIO5  ----[LED+]---[220Ω]---- GND  (opzionale)
ESP32 GPIO2  = LED integrato sulla board
```

## Setup Arduino IDE

### 1. Installa supporto ESP32

1. Apri Arduino IDE
2. **File → Preferences**
3. In "Additional Board Manager URLs" aggiungi:
   ```
   https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
   ```
4. **Tools → Board → Boards Manager**
5. Cerca "esp32" e installa **"ESP32 by Espressif Systems"**

### 2. Installa Librerie

**Tools → Manage Libraries**, cerca e installa:

- **WiFiManager** by tzapu (versione >= 2.0.0)
- **ArduinoJson** by Benoit Blanchon (versione >= 6.0.0)

### 3. Configura Board

- **Tools → Board**: "ESP32 Dev Module"
- **Tools → Upload Speed**: 921600
- **Tools → CPU Frequency**: 240MHz
- **Tools → Flash Mode**: QIO
- **Tools → Flash Size**: 4MB (32Mb)
- **Tools → Partition Scheme**: "Default 4MB with spiffs (1.2MB APP/1.5MB SPIFFS)"
- **Tools → Port**: Seleziona la porta COM dell'ESP32

### 4. Primo Upload (USB)

1. Collega ESP32 via USB
2. Apri `replayo_button.ino`
3. Clicca **Upload** (freccia →)
4. Quando vedi "Connecting..." premi il pulsante **BOOT** sull'ESP32
5. Attendi completamento upload

## Primo Avvio

1. L'ESP32 crea una rete WiFi: **RePlayo_XXXX** (password: `replayo123`)
2. Connettiti con telefono/PC a questa rete
3. Si apre automaticamente il captive portal (o vai a `192.168.4.1`)
4. Seleziona la tua rete WiFi e inserisci la password
5. L'ESP32 si riavvia e si connette
6. Il dispositivo appare automaticamente nella Admin Dashboard

## LED Stati

| Pattern | Significato |
|---------|-------------|
| Blink lento (1s on, 2s off) | Tutto OK, in attesa |
| Blink veloce (200ms) | Connessione in corso / Update OTA |
| Sempre acceso | Errore (WiFi disconnesso, API non raggiungibile) |
| 2 flash | Marker inviato con successo |
| 5 flash veloci | Errore invio marker |

## Funzionamento

### Pressione Breve (< 5 sec)
Invia un **marker highlight** al backend. Il marker viene associato alla prenotazione attiva sul campo collegato.

### Pressione Lunga (> 5 sec)
**Reset configurazione WiFi**. Il dispositivo si riavvia e riapre il captive portal per configurare una nuova rete.

### Reset Durante Boot
Tieni premuto il pulsante durante l'accensione per 3 secondi → Reset WiFi

## Aggiornamenti OTA

Il firmware si aggiorna automaticamente via WiFi:

1. Carica il nuovo firmware (.bin) dalla **Admin Dashboard → Dispositivi → Upload Firmware**
2. Imposta come "Latest"
3. I dispositivi controllano ogni 5 minuti se c'è un nuovo firmware
4. L'update avviene automaticamente quando il pulsante non è premuto

### Generare file .bin

In Arduino IDE: **Sketch → Export compiled Binary**

Il file `.bin` viene salvato nella cartella del progetto.

## Configurazione Admin Dashboard

Dopo che il dispositivo si è registrato:

1. Vai su **administrator.teofly.it → Dispositivi**
2. Clicca **⚙️ Config** sul dispositivo
3. Imposta:
   - **Nome**: es. "Pulsante Padel 1"
   - **Campo**: Seleziona il campo da associare
4. Salva

## API Endpoints Utilizzati

| Endpoint | Metodo | Descrizione |
|----------|--------|-------------|
| `/api/devices/register` | POST | Registrazione dispositivo |
| `/api/devices/heartbeat` | POST | Heartbeat (ogni 30s) |
| `/api/devices/marker` | POST | Invio marker pulsante |
| `/api/firmware/latest` | GET | Check ultimo firmware |
| `/api/firmware/download/:version` | GET | Download firmware OTA |

## Troubleshooting

### Il dispositivo non si connette al WiFi
- Tieni premuto il pulsante durante l'avvio per resettare le credenziali WiFi
- Verifica che la rete WiFi sia 2.4GHz (ESP32 non supporta 5GHz)

### Il marker non viene inviato
- Verifica che il dispositivo sia associato a un campo nella Dashboard
- Controlla che ci sia una prenotazione attiva sul campo

### L'OTA non funziona
- Verifica che il firmware sia stato caricato come "Latest" nella Dashboard
- Il dispositivo deve essere online (LED blink lento)
- L'update avviene solo quando il pulsante non è premuto

### LED sempre acceso (errore)
- Verifica connessione WiFi
- Controlla che il server API sia raggiungibile
- Riavvia il dispositivo

## Versioning

Ogni aggiornamento firmware deve incrementare la versione in:
```cpp
#define FIRMWARE_VERSION "1.0.0"
```

Usa semantic versioning: MAJOR.MINOR.PATCH
- MAJOR: Cambiamenti incompatibili
- MINOR: Nuove funzionalità retrocompatibili
- PATCH: Bug fix
