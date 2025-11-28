-- Migrazione: Tabella dispositivi ESP32 per pulsanti highlights
-- Eseguire su replayo_db

-- Prima droppa le tabelle se esistono (per ricrearle corrette)
DROP TABLE IF EXISTS button_markers CASCADE;
DROP TABLE IF EXISTS esp32_devices CASCADE;

-- Tabella dispositivi ESP32
CREATE TABLE esp32_devices (
    id SERIAL PRIMARY KEY,
    device_id VARCHAR(50) UNIQUE NOT NULL,  -- MAC address o ID univoco
    device_name VARCHAR(100),                -- Nome descrittivo (es. "Pulsante Padel 1")
    court_id UUID REFERENCES courts(id),     -- Campo associato (UUID)
    firmware_version VARCHAR(20),            -- Versione firmware attuale
    ip_address VARCHAR(45),                  -- Ultimo IP conosciuto
    is_online BOOLEAN DEFAULT false,         -- Stato online/offline
    last_heartbeat TIMESTAMP,                -- Ultimo heartbeat ricevuto
    wifi_ssid VARCHAR(100),                  -- SSID configurato
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabella per log marker pulsante (timestamp quando premuto)
CREATE TABLE button_markers (
    id SERIAL PRIMARY KEY,
    device_id VARCHAR(50) NOT NULL,          -- Riferimento al dispositivo
    court_id UUID REFERENCES courts(id),     -- Campo (UUID)
    marker_time TIMESTAMP NOT NULL,          -- Quando è stato premuto
    booking_id UUID REFERENCES bookings(id),    -- Prenotazione attiva in quel momento (opzionale)
    processed BOOLEAN DEFAULT false,         -- Se è stato elaborato per highlight
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabella per firmware OTA
CREATE TABLE IF NOT EXISTS esp32_firmware (
    id SERIAL PRIMARY KEY,
    version VARCHAR(20) NOT NULL,
    filename VARCHAR(255) NOT NULL,
    file_path VARCHAR(500) NOT NULL,
    file_size INTEGER,
    checksum VARCHAR(64),                    -- MD5 o SHA256 per verifica
    release_notes TEXT,
    is_latest BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indici per performance
CREATE INDEX IF NOT EXISTS idx_button_markers_court ON button_markers(court_id);
CREATE INDEX IF NOT EXISTS idx_button_markers_time ON button_markers(marker_time);
CREATE INDEX IF NOT EXISTS idx_button_markers_booking ON button_markers(booking_id);
CREATE INDEX IF NOT EXISTS idx_esp32_devices_court ON esp32_devices(court_id);

-- Verifica
SELECT 'Tabelle ESP32 create con successo' as status;
