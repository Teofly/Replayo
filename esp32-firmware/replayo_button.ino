/*
 * RePlayo ESP32 Highlight Button
 *
 * Firmware per pulsante fisico che marca momenti salienti durante le partite.
 *
 * Hardware: AZDelivery ESP32 NodeMCU WiFi CP2102
 *
 * Funzionalità:
 * - Captive portal per configurazione WiFi al primo avvio
 * - Registrazione automatica al backend RePlayo
 * - Heartbeat periodico per monitoraggio online/offline
 * - Invio marker al backend quando si preme il pulsante
 * - Aggiornamento OTA del firmware via WiFi
 * - LED di stato per feedback visivo
 *
 * Autore: RePlayo Team
 * Versione: 1.0.0
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiManager.h>      // https://github.com/tzapu/WiFiManager
#include <ArduinoJson.h>      // https://github.com/bblanchon/ArduinoJson
#include <HTTPUpdate.h>
#include <Preferences.h>

// ==================== CONFIGURAZIONE ====================

// Versione firmware (aggiornare ad ogni release)
#define FIRMWARE_VERSION "1.0.0"

// Backend API
#define API_BASE_URL "https://api.teofly.it/api"
#define API_REGISTER "/devices/register"
#define API_HEARTBEAT "/devices/heartbeat"
#define API_MARKER "/devices/marker"
#define API_FIRMWARE_LATEST "/firmware/latest"
#define API_FIRMWARE_DOWNLOAD "/firmware/download"

// Pin configuration
#define BUTTON_PIN 4          // GPIO4 - Pulsante principale
#define LED_BUILTIN_PIN 2     // GPIO2 - LED integrato (la maggior parte degli ESP32)
#define LED_STATUS_PIN 5      // GPIO5 - LED esterno opzionale per stato

// Timing (millisecondi)
#define DEBOUNCE_DELAY 50           // Debounce pulsante
#define HEARTBEAT_INTERVAL 30000    // Heartbeat ogni 30 secondi
#define OTA_CHECK_INTERVAL 300000   // Check OTA ogni 5 minuti
#define WIFI_TIMEOUT 180            // Timeout captive portal (secondi)
#define BUTTON_LONG_PRESS 5000      // Long press per reset WiFi (5 sec)

// ==================== VARIABILI GLOBALI ====================

Preferences preferences;
WiFiManager wifiManager;

// Device info
String deviceId;
String deviceName;

// Stato pulsante
volatile bool buttonPressed = false;
unsigned long lastDebounceTime = 0;
unsigned long buttonPressStart = 0;
bool buttonState = HIGH;
bool lastButtonState = HIGH;

// Timing
unsigned long lastHeartbeat = 0;
unsigned long lastOtaCheck = 0;

// Stato LED
bool ledState = false;
unsigned long lastLedBlink = 0;
int blinkPattern = 0; // 0=off, 1=slow (ok), 2=fast (connecting), 3=solid (error)

// Flag OTA
bool otaUpdateAvailable = false;
String otaLatestVersion = "";

// ==================== SETUP ====================

void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("\n\n================================");
  Serial.println("RePlayo Highlight Button");
  Serial.println("Firmware v" FIRMWARE_VERSION);
  Serial.println("================================\n");

  // Configura pin
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  pinMode(LED_BUILTIN_PIN, OUTPUT);
  pinMode(LED_STATUS_PIN, OUTPUT);

  // LED acceso durante boot
  digitalWrite(LED_BUILTIN_PIN, HIGH);
  digitalWrite(LED_STATUS_PIN, HIGH);

  // Genera Device ID dal MAC address
  deviceId = getDeviceId();
  Serial.println("Device ID: " + deviceId);

  // Carica preferenze salvate
  loadPreferences();

  // Configura WiFi Manager
  setupWiFiManager();

  // Connetti al WiFi
  connectWiFi();

  // Registra dispositivo al backend
  registerDevice();

  // Primo heartbeat
  sendHeartbeat();

  // Check OTA iniziale
  checkOtaUpdate();

  // Setup completato
  Serial.println("\n[SETUP] Completato! In attesa di pressioni pulsante...\n");
  setLedPattern(1); // Blink lento = tutto ok
}

// ==================== LOOP PRINCIPALE ====================

void loop() {
  // Gestione pulsante
  handleButton();

  // Gestione LED
  updateLed();

  // Heartbeat periodico
  if (millis() - lastHeartbeat >= HEARTBEAT_INTERVAL) {
    sendHeartbeat();
    lastHeartbeat = millis();
  }

  // Check OTA periodico
  if (millis() - lastOtaCheck >= OTA_CHECK_INTERVAL) {
    checkOtaUpdate();
    lastOtaCheck = millis();
  }

  // Se c'è un update disponibile e il pulsante non è premuto, aggiorna
  if (otaUpdateAvailable && digitalRead(BUTTON_PIN) == HIGH) {
    performOtaUpdate();
  }

  // Piccola pausa per stabilità
  delay(10);
}

// ==================== WIFI ====================

String getDeviceId() {
  uint8_t mac[6];
  WiFi.macAddress(mac);
  char macStr[18];
  snprintf(macStr, sizeof(macStr), "%02X:%02X:%02X:%02X:%02X:%02X",
           mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
  return String(macStr);
}

void setupWiFiManager() {
  // Reset WiFi se il pulsante è premuto durante il boot
  if (digitalRead(BUTTON_PIN) == LOW) {
    Serial.println("[WIFI] Pulsante premuto durante boot - Reset configurazione WiFi");
    delay(3000); // Aspetta 3 secondi per conferma
    if (digitalRead(BUTTON_PIN) == LOW) {
      wifiManager.resetSettings();
      Serial.println("[WIFI] Configurazione WiFi resettata!");
    }
  }

  // Configura WiFiManager
  wifiManager.setConfigPortalTimeout(WIFI_TIMEOUT);
  wifiManager.setAPCallback(configModeCallback);
  wifiManager.setSaveConfigCallback(saveConfigCallback);

  // Parametri custom (opzionali)
  // WiFiManagerParameter custom_name("name", "Nome dispositivo", "Pulsante Padel", 40);
  // wifiManager.addParameter(&custom_name);
}

void configModeCallback(WiFiManager *myWiFiManager) {
  Serial.println("[WIFI] Modalità configurazione attiva");
  Serial.println("[WIFI] Connettiti alla rete: " + myWiFiManager->getConfigPortalSSID());
  Serial.println("[WIFI] Vai a: 192.168.4.1");
  setLedPattern(2); // Blink veloce = configurazione
}

void saveConfigCallback() {
  Serial.println("[WIFI] Configurazione salvata!");
}

void connectWiFi() {
  Serial.println("[WIFI] Connessione in corso...");
  setLedPattern(2); // Blink veloce

  // Nome AP per configurazione: RePlayo_XXXX (ultime 4 cifre MAC)
  String apName = "RePlayo_" + deviceId.substring(deviceId.length() - 5);
  apName.replace(":", "");

  // Tenta connessione o apre portale
  if (!wifiManager.autoConnect(apName.c_str(), "replayo123")) {
    Serial.println("[WIFI] Connessione fallita - Riavvio...");
    setLedPattern(3); // Solid = errore
    delay(3000);
    ESP.restart();
  }

  Serial.println("[WIFI] Connesso!");
  Serial.println("[WIFI] IP: " + WiFi.localIP().toString());
  Serial.println("[WIFI] SSID: " + WiFi.SSID());
}

// ==================== BACKEND API ====================

void registerDevice() {
  if (WiFi.status() != WL_CONNECTED) return;

  Serial.println("[API] Registrazione dispositivo...");

  HTTPClient http;
  http.begin(String(API_BASE_URL) + API_REGISTER);
  http.addHeader("Content-Type", "application/json");

  // Prepara JSON
  StaticJsonDocument<256> doc;
  doc["device_id"] = deviceId;
  doc["device_name"] = deviceName.length() > 0 ? deviceName : "ESP32 Button";
  doc["firmware_version"] = FIRMWARE_VERSION;
  doc["ip_address"] = WiFi.localIP().toString();
  doc["wifi_ssid"] = WiFi.SSID();

  String jsonString;
  serializeJson(doc, jsonString);

  int httpCode = http.POST(jsonString);

  if (httpCode == 200 || httpCode == 201) {
    String response = http.getString();
    Serial.println("[API] Registrazione OK: " + response);

    // Parse risposta per ottenere info aggiuntive
    StaticJsonDocument<512> responseDoc;
    if (deserializeJson(responseDoc, response) == DeserializationError::Ok) {
      if (responseDoc.containsKey("device") && responseDoc["device"].containsKey("device_name")) {
        deviceName = responseDoc["device"]["device_name"].as<String>();
        savePreferences();
      }
    }
  } else {
    Serial.println("[API] Registrazione fallita: " + String(httpCode));
    Serial.println("[API] Response: " + http.getString());
  }

  http.end();
}

void sendHeartbeat() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[API] WiFi disconnesso - skip heartbeat");
    setLedPattern(3);
    return;
  }

  Serial.println("[API] Invio heartbeat...");

  HTTPClient http;
  http.begin(String(API_BASE_URL) + API_HEARTBEAT);
  http.addHeader("Content-Type", "application/json");

  StaticJsonDocument<128> doc;
  doc["device_id"] = deviceId;
  doc["ip_address"] = WiFi.localIP().toString();
  doc["firmware_version"] = FIRMWARE_VERSION;

  String jsonString;
  serializeJson(doc, jsonString);

  int httpCode = http.POST(jsonString);

  if (httpCode == 200) {
    String response = http.getString();
    Serial.println("[API] Heartbeat OK");

    // Check se c'è update disponibile
    StaticJsonDocument<256> responseDoc;
    if (deserializeJson(responseDoc, response) == DeserializationError::Ok) {
      if (responseDoc["update_available"] == true) {
        otaLatestVersion = responseDoc["latest_version"].as<String>();
        Serial.println("[API] Update disponibile: v" + otaLatestVersion);
        otaUpdateAvailable = true;
      }
    }

    setLedPattern(1); // Tutto ok
  } else {
    Serial.println("[API] Heartbeat fallito: " + String(httpCode));
    setLedPattern(3); // Errore
  }

  http.end();
}

void sendMarker() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[MARKER] WiFi disconnesso - impossibile inviare");
    flashLed(5, 100); // 5 flash veloci = errore
    return;
  }

  Serial.println("[MARKER] *** PULSANTE PREMUTO - Invio marker ***");

  HTTPClient http;
  http.begin(String(API_BASE_URL) + API_MARKER);
  http.addHeader("Content-Type", "application/json");

  StaticJsonDocument<64> doc;
  doc["device_id"] = deviceId;

  String jsonString;
  serializeJson(doc, jsonString);

  int httpCode = http.POST(jsonString);

  if (httpCode == 200 || httpCode == 201) {
    Serial.println("[MARKER] Marker inviato con successo!");
    flashLed(2, 200); // 2 flash = ok
  } else {
    String response = http.getString();
    Serial.println("[MARKER] Errore: " + String(httpCode) + " - " + response);
    flashLed(5, 100); // 5 flash veloci = errore
  }

  http.end();
}

// ==================== OTA UPDATE ====================

void checkOtaUpdate() {
  if (WiFi.status() != WL_CONNECTED) return;

  Serial.println("[OTA] Controllo aggiornamenti...");

  HTTPClient http;
  http.begin(String(API_BASE_URL) + API_FIRMWARE_LATEST);

  int httpCode = http.GET();

  if (httpCode == 200) {
    String response = http.getString();

    StaticJsonDocument<256> doc;
    if (deserializeJson(doc, response) == DeserializationError::Ok) {
      String latestVersion = doc["version"].as<String>();

      if (latestVersion != FIRMWARE_VERSION && latestVersion.length() > 0) {
        Serial.println("[OTA] Nuova versione disponibile: v" + latestVersion);
        otaLatestVersion = latestVersion;
        otaUpdateAvailable = true;
      } else {
        Serial.println("[OTA] Firmware aggiornato (v" FIRMWARE_VERSION ")");
        otaUpdateAvailable = false;
      }
    }
  } else if (httpCode == 404) {
    Serial.println("[OTA] Nessun firmware disponibile sul server");
  } else {
    Serial.println("[OTA] Errore check: " + String(httpCode));
  }

  http.end();
}

void performOtaUpdate() {
  if (!otaUpdateAvailable || otaLatestVersion.length() == 0) return;

  Serial.println("\n[OTA] ========================================");
  Serial.println("[OTA] AVVIO AGGIORNAMENTO FIRMWARE");
  Serial.println("[OTA] Da: v" FIRMWARE_VERSION " -> v" + otaLatestVersion);
  Serial.println("[OTA] ========================================\n");

  setLedPattern(2); // Blink veloce durante update

  String updateUrl = String(API_BASE_URL) + API_FIRMWARE_DOWNLOAD + "/" + otaLatestVersion;
  Serial.println("[OTA] URL: " + updateUrl);

  WiFiClient client;

  // Configura HTTPUpdate
  httpUpdate.setLedPin(LED_BUILTIN_PIN, LOW);
  httpUpdate.rebootOnUpdate(true);

  t_httpUpdate_return ret = httpUpdate.update(client, updateUrl);

  switch (ret) {
    case HTTP_UPDATE_FAILED:
      Serial.println("[OTA] ERRORE: " + httpUpdate.getLastErrorString());
      otaUpdateAvailable = false; // Non ritentare subito
      setLedPattern(3);
      break;

    case HTTP_UPDATE_NO_UPDATES:
      Serial.println("[OTA] Nessun aggiornamento");
      otaUpdateAvailable = false;
      setLedPattern(1);
      break;

    case HTTP_UPDATE_OK:
      Serial.println("[OTA] Aggiornamento completato! Riavvio...");
      // Il dispositivo si riavvia automaticamente
      break;
  }
}

// ==================== GESTIONE PULSANTE ====================

void handleButton() {
  int reading = digitalRead(BUTTON_PIN);

  // Debounce
  if (reading != lastButtonState) {
    lastDebounceTime = millis();
  }

  if ((millis() - lastDebounceTime) > DEBOUNCE_DELAY) {
    if (reading != buttonState) {
      buttonState = reading;

      if (buttonState == LOW) {
        // Pulsante premuto
        buttonPressStart = millis();
        Serial.println("[BTN] Pulsante premuto");
      } else {
        // Pulsante rilasciato
        unsigned long pressDuration = millis() - buttonPressStart;
        Serial.println("[BTN] Rilasciato dopo " + String(pressDuration) + "ms");

        if (pressDuration >= BUTTON_LONG_PRESS) {
          // Long press = reset WiFi
          Serial.println("[BTN] LONG PRESS - Reset WiFi!");
          wifiManager.resetSettings();
          delay(1000);
          ESP.restart();
        } else if (pressDuration >= DEBOUNCE_DELAY) {
          // Short press = invia marker
          sendMarker();
        }
      }
    }
  }

  // Check long press mentre è premuto (feedback LED)
  if (buttonState == LOW) {
    unsigned long pressDuration = millis() - buttonPressStart;
    if (pressDuration >= BUTTON_LONG_PRESS - 1000 && pressDuration < BUTTON_LONG_PRESS) {
      // Ultimo secondo prima del reset - LED lampeggia velocissimo
      if (millis() % 100 < 50) {
        digitalWrite(LED_STATUS_PIN, HIGH);
      } else {
        digitalWrite(LED_STATUS_PIN, LOW);
      }
    }
  }

  lastButtonState = reading;
}

// ==================== LED ====================

void setLedPattern(int pattern) {
  blinkPattern = pattern;
}

void updateLed() {
  unsigned long now = millis();

  switch (blinkPattern) {
    case 0: // Off
      digitalWrite(LED_BUILTIN_PIN, LOW);
      digitalWrite(LED_STATUS_PIN, LOW);
      break;

    case 1: // Blink lento (tutto ok) - 1 sec on, 2 sec off
      if (now - lastLedBlink >= 3000) {
        lastLedBlink = now;
      }
      if (now - lastLedBlink < 1000) {
        digitalWrite(LED_BUILTIN_PIN, HIGH);
        digitalWrite(LED_STATUS_PIN, HIGH);
      } else {
        digitalWrite(LED_BUILTIN_PIN, LOW);
        digitalWrite(LED_STATUS_PIN, LOW);
      }
      break;

    case 2: // Blink veloce (connessione/update) - 200ms
      if (now - lastLedBlink >= 400) {
        lastLedBlink = now;
        ledState = !ledState;
        digitalWrite(LED_BUILTIN_PIN, ledState);
        digitalWrite(LED_STATUS_PIN, ledState);
      }
      break;

    case 3: // Solid (errore)
      digitalWrite(LED_BUILTIN_PIN, HIGH);
      digitalWrite(LED_STATUS_PIN, HIGH);
      break;
  }
}

void flashLed(int times, int delayMs) {
  for (int i = 0; i < times; i++) {
    digitalWrite(LED_BUILTIN_PIN, HIGH);
    digitalWrite(LED_STATUS_PIN, HIGH);
    delay(delayMs);
    digitalWrite(LED_BUILTIN_PIN, LOW);
    digitalWrite(LED_STATUS_PIN, LOW);
    delay(delayMs);
  }
}

// ==================== PREFERENCES ====================

void loadPreferences() {
  preferences.begin("replayo", true); // read-only
  deviceName = preferences.getString("deviceName", "");
  preferences.end();

  Serial.println("[PREF] Device name: " + (deviceName.length() > 0 ? deviceName : "(non impostato)"));
}

void savePreferences() {
  preferences.begin("replayo", false); // read-write
  preferences.putString("deviceName", deviceName);
  preferences.end();

  Serial.println("[PREF] Preferenze salvate");
}
