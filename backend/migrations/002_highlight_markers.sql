-- Migrazione: Tabella per Highlight Markers
-- Eseguire su replayo_db

-- Crea tabella highlight_markers per salvare i marker prima dell'associazione video
CREATE TABLE IF NOT EXISTS highlight_markers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    start_time INTEGER NOT NULL,  -- tempo inizio in secondi
    end_time INTEGER NOT NULL,    -- tempo fine in secondi
    margin INTEGER DEFAULT 2,     -- margine applicato in secondi
    processed BOOLEAN DEFAULT false,  -- true se già estratto come highlight
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indice per ricerca per match_id
CREATE INDEX IF NOT EXISTS idx_highlight_markers_match_id ON highlight_markers(match_id);

-- Indice per marker non processati
CREATE INDEX IF NOT EXISTS idx_highlight_markers_unprocessed ON highlight_markers(match_id, processed) WHERE processed = false;

-- Verifica creazione
SELECT 'highlight_markers table created' AS status;
