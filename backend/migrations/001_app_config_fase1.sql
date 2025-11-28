-- Migrazione Fase 1: Impostazioni Admin Dashboard
-- Eseguire su replayo_db

-- Crea tabella app_config se non esiste
CREATE TABLE IF NOT EXISTS app_config (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT,
    description TEXT,
    category VARCHAR(50),
    type VARCHAR(20) DEFAULT 'text',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- SEZIONE 1: Orari Club (3 variabili)
-- =====================================================
INSERT INTO app_config (key, value, description, category, type) VALUES
('club_open_hour', '8', 'Ora apertura club (0-23)', 'orari', 'number'),
('club_close_hour', '22', 'Ora chiusura club (0-23)', 'orari', 'number'),
('slot_interval_minutes', '30', 'Intervallo slot prenotazione (minuti)', 'orari', 'number')
ON CONFLICT (key) DO NOTHING;

-- =====================================================
-- SEZIONE 2: Durate Default per Sport (4 variabili)
-- =====================================================
INSERT INTO app_config (key, value, description, category, type) VALUES
('duration_padel', '90', 'Durata default partita padel (minuti)', 'durate', 'number'),
('duration_padel_fallback', '60', 'Durata alternativa padel (minuti)', 'durate', 'number'),
('duration_tennis', '60', 'Durata default partita tennis (minuti)', 'durate', 'number'),
('duration_calcetto', '60', 'Durata default partita calcetto (minuti)', 'durate', 'number')
ON CONFLICT (key) DO NOTHING;

-- =====================================================
-- SEZIONE 3: Cron Jobs & Automazioni (5 variabili)
-- =====================================================
INSERT INTO app_config (key, value, description, category, type) VALUES
('cron_video_minute', '55', 'Minuto esecuzione cron video download (0-59)', 'cron', 'number'),
('cron_video_enabled', 'true', 'Abilita cron video download', 'cron', 'boolean'),
('cron_timeout_minutes', '5', 'Timeout operazioni cron (minuti)', 'cron', 'number'),
('auto_confirm_enabled', 'true', 'Abilita auto-conferma prenotazioni pending', 'cron', 'boolean'),
('auto_confirm_hours_before', '2', 'Ore prima della partita per auto-conferma', 'cron', 'number')
ON CONFLICT (key) DO NOTHING;

-- =====================================================
-- SEZIONE 4: Prenotazioni (5 variabili)
-- =====================================================
INSERT INTO app_config (key, value, description, category, type) VALUES
('booking_advance_days', '14', 'Giorni massimi prenotazione in anticipo', 'prenotazioni', 'number'),
('booking_cancel_hours', '24', 'Ore minime per cancellazione gratuita', 'prenotazioni', 'number'),
('booking_reminder_hours', '24', 'Ore prima per invio reminder', 'prenotazioni', 'number'),
('booking_default_players', '4', 'Numero giocatori default', 'prenotazioni', 'number'),
('booking_require_payment', 'false', 'Richiedi pagamento anticipato', 'prenotazioni', 'boolean')
ON CONFLICT (key) DO NOTHING;

-- Verifica inserimento
SELECT key, value, category, type FROM app_config ORDER BY category, key;
