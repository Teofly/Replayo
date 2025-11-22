const { Pool } = require('pg');

const pool = new Pool({
  host: '192.168.1.175',
  database: 'replayo_db',
  user: 'replayo_user',
  password: 'replayo_secure_pass_2024',
  port: 5432
});

// Coverage based on day of week:
// Weekend (Sat/Sun) = 90%
// Tue/Wed = 40%
// Other days = 50-75%
function getCoverage(day) {
  const date = new Date(2025, 10, day); // November 2025
  const dayOfWeek = date.getDay(); // 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat

  if (dayOfWeek === 0 || dayOfWeek === 6) {
    // Weekend: 90%
    return 0.90;
  } else if (dayOfWeek === 2 || dayOfWeek === 3) {
    // Tuesday/Wednesday: 40%
    return 0.40;
  } else {
    // Mon, Thu, Fri: random 50-75%
    return 0.50 + Math.random() * 0.25;
  }
}

async function generateDemoBookings() {
  const client = await pool.connect();

  try {
    console.log('Starting demo booking generation...');

    // Delete bookings for Nov 22-23
    console.log('Deleting bookings for Nov 22-23...');
    const deleteResult = await client.query(`
      DELETE FROM bookings
      WHERE booking_date >= '2025-11-22' AND booking_date <= '2025-11-23'
    `);
    console.log(`Deleted ${deleteResult.rowCount} bookings`);

    // Get all active courts
    const courtsResult = await client.query(`
      SELECT id, name, sport_type FROM courts WHERE is_active = true
    `);
    const courts = courtsResult.rows;
    console.log(`Found ${courts.length} active courts`);

    // Get all players for customer names
    const playersResult = await client.query(`
      SELECT id, first_name, last_name FROM players WHERE is_active = true LIMIT 50
    `);
    let players = playersResult.rows;
    console.log(`Found ${players.length} players`);

    // If no players, create demo ones
    if (players.length === 0) {
      console.log('No players found. Creating demo players...');
      const demoPlayers = [
        { first: 'Mario', last: 'Rossi' },
        { first: 'Luigi', last: 'Verdi' },
        { first: 'Anna', last: 'Bianchi' },
        { first: 'Paolo', last: 'Neri' },
        { first: 'Sara', last: 'Gialli' },
        { first: 'Marco', last: 'Ferrari' },
        { first: 'Elena', last: 'Romano' },
        { first: 'Luca', last: 'Colombo' }
      ];
      for (const p of demoPlayers) {
        await client.query(`INSERT INTO players (first_name, last_name) VALUES ($1, $2)`, [p.first, p.last]);
      }
      const newPlayersResult = await client.query(`SELECT id, first_name, last_name FROM players`);
      players = newPlayersResult.rows;
      console.log(`Created ${players.length} demo players`);
    }

    // Time slots (8:00 to 22:00, 1 hour each = 14 slots)
    const timeSlots = [];
    for (let hour = 8; hour < 22; hour++) {
      timeSlots.push({
        start: `${String(hour).padStart(2, '0')}:00`,
        end: `${String(hour + 1).padStart(2, '0')}:00`
      });
    }

    // Generate bookings for each day
    for (let day = 1; day <= 30; day++) {
      const coverage = getCoverage(day);
      const dateStr = `2025-11-${String(day).padStart(2, '0')}`;
      const date = new Date(2025, 10, day);
      const dayName = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'][date.getDay()];

      // Delete existing bookings for this day first
      await client.query(`DELETE FROM bookings WHERE booking_date = $1`, [dateStr]);

      // Calculate number of slots to fill
      const totalSlots = courts.length * timeSlots.length;
      const slotsToFill = Math.round(totalSlots * coverage);

      console.log(`Day ${day} (${dayName}): Creating ${slotsToFill}/${totalSlots} bookings (${Math.round(coverage * 100)}%)`);

      // Create a list of all possible slots
      const allSlots = [];
      for (const court of courts) {
        for (const slot of timeSlots) {
          allSlots.push({ court, slot });
        }
      }

      // Shuffle and pick slots to fill
      const shuffled = allSlots.sort(() => Math.random() - 0.5);
      const selectedSlots = shuffled.slice(0, slotsToFill);

      // Create bookings with mix of confirmed and pending
      for (let i = 0; i < selectedSlots.length; i++) {
        const { court, slot } = selectedSlots[i];
        const player = players[Math.floor(Math.random() * players.length)];
        const customerName = `${player.first_name} ${player.last_name}`;
        const numPlayers = court.sport_type === 'calcetto' ? 10 : 4;
        const pricePerPlayer = court.sport_type === 'padel' ? 8 : (court.sport_type === 'tennis' ? 10 : 5);
        const totalPrice = numPlayers * pricePerPlayer;

        // 70% confirmed, 30% pending
        const isConfirmed = Math.random() < 0.70;
        const status = isConfirmed ? 'confirmed' : 'pending';
        const paymentStatus = isConfirmed ? 'paid' : 'pending';

        await client.query(`
          INSERT INTO bookings (
            court_id, booking_date, start_time, end_time,
            duration_minutes, customer_name, num_players,
            total_price, status, payment_status
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `, [court.id, dateStr, slot.start, slot.end, 60, customerName, numPlayers, totalPrice, status, paymentStatus]);
      }
    }

    console.log('\nDemo booking generation completed!');

    // Show summary
    const summaryResult = await client.query(`
      SELECT booking_date, COUNT(*) as count
      FROM bookings
      WHERE booking_date >= '2025-11-01' AND booking_date <= '2025-11-30'
      GROUP BY booking_date
      ORDER BY booking_date
    `);

    console.log('\nBookings summary by day:');
    for (const row of summaryResult.rows) {
      console.log(`  ${row.booking_date.toISOString().split('T')[0]}: ${row.count} bookings`);
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

generateDemoBookings();
