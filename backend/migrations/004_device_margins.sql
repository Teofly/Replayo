-- Migrazione: Aggiunta margini highlight per dispositivi ESP32
-- Eseguire su replayo_db

-- Aggiungi colonne per margini highlight (in secondi)
ALTER TABLE esp32_devices
ADD COLUMN IF NOT EXISTS margin_before INTEGER DEFAULT 5,
ADD COLUMN IF NOT EXISTS margin_after INTEGER DEFAULT 10;

-- Commento: margin_before = secondi PRIMA della pressione da includere nel clip
--           margin_after = secondi DOPO la pressione da includere nel clip
-- Esempio: margin_before=5, margin_after=10 -> clip di 15 secondi totali

-- Verifica
SELECT 'Colonne margin_before/margin_after aggiunte' as status;
