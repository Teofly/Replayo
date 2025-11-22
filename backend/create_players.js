const { Pool } = require('pg');

const pool = new Pool({
  host: '192.168.1.175',
  port: 5432,
  database: 'replayo_db',
  user: 'replayo_user',
  password: 'replayo_secure_pass_2024'
});

async function createTables() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS players (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        first_name VARCHAR(100) NOT NULL,
        last_name VARCHAR(100) NOT NULL,
        email VARCHAR(255),
        phone VARCHAR(50),
        notes TEXT,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('Players table created');
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS booking_players (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
        player_id UUID REFERENCES players(id) ON DELETE SET NULL,
        player_name VARCHAR(200) NOT NULL,
        is_registered BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('Booking_players table created');
    
    await pool.query('CREATE INDEX IF NOT EXISTS idx_players_name ON players(first_name, last_name)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_booking_players_booking ON booking_players(booking_id)');
    
    console.log('All tables created successfully!');
    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

createTables();
