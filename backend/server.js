const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { Pool } = require('pg');
const fs = require('fs').promises;
const path = require('path');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const app = express();
const PORT = process.env.PORT || 3000;

// ==================== CONFIGURATION ====================

// Storage configuration - can be 'local' or 's3'
const STORAGE_TYPE = process.env.STORAGE_TYPE || 'local';
const LOCAL_STORAGE_PATH = process.env.LOCAL_STORAGE_PATH || '/volume1/RePlayo/videos';
const LOCAL_THUMBNAIL_PATH = process.env.LOCAL_THUMBNAIL_PATH || '/volume1/RePlayo/thumbnails';

// S3 Configuration (if using S3)
const s3Client = STORAGE_TYPE === 's3' ? new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
}) : null;

const S3_BUCKET = process.env.S3_BUCKET || 'replayo-videos';

// Middleware
app.use(cors());
app.use(express.json());

// PostgreSQL Pool
const pool = new Pool({
  host: process.env.DB_HOST || '192.168.1.175',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'replayo_db',
  user: process.env.DB_USER || 'replayo_user',
  password: process.env.DB_PASSWORD || 'replayo_secure_pass_2024',
});

// Test connessione
pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Errore connessione database:', err.stack);
  } else {
    console.log('✅ Connesso a PostgreSQL');
    console.log(`📦 Storage type: ${STORAGE_TYPE}`);
    if (STORAGE_TYPE === 'local') {
      console.log(`📁 Local path: ${LOCAL_STORAGE_PATH}`);
    } else {
      console.log(`☁️  S3 bucket: ${S3_BUCKET}`);
    }
    release();
  }
});

// Multer configuration for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 2 * 1024 * 1024 * 1024, // 2GB max
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['video/mp4', 'video/mpeg', 'video/quicktime', 'video/x-msvideo'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Formato video non supportato. Usa MP4, MPEG, MOV o AVI.'));
    }
  }
});

// ==================== STORAGE HELPERS ====================

async function saveVideoFile(buffer, filename) {
  if (STORAGE_TYPE === 's3') {
    // Upload to S3
    const command = new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: `videos/${filename}`,
      Body: buffer,
      ContentType: 'video/mp4'
    });
    await s3Client.send(command);
    return `s3://${S3_BUCKET}/videos/${filename}`;
  } else {
    // Save locally
    const filepath = path.join(LOCAL_STORAGE_PATH, filename);
    await fs.mkdir(LOCAL_STORAGE_PATH, { recursive: true });
    await fs.writeFile(filepath, buffer);
    return filepath;
  }
}

async function getVideoUrl(filePath) {
  if (STORAGE_TYPE === 's3' && filePath.startsWith('s3://')) {
    // Generate signed URL for S3
    const key = filePath.replace(`s3://${S3_BUCKET}/`, '');
    const command = new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: key
    });
    return await getSignedUrl(s3Client, command, { expiresIn: 3600 }); // 1 hour
  } else {
    // Return local file path
    return filePath;
  }
}

// ==================== ROUTES ====================

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'RePlayo API running',
    database: process.env.DB_NAME || 'replayo_db',
    storage: STORAGE_TYPE,
    timestamp: new Date().toISOString()
  });
});

// ==================== MATCH ROUTES ====================
// IMPORTANT: Specific routes MUST come before dynamic parameter routes
// Otherwise Express will match :bookingCode instead of /search or /id/:matchId

// Search matches (with optional filters) - MUST BE BEFORE :bookingCode
app.get('/api/matches/search', async (req, res) => {
  try {
    const { bookingCode, location, sportType, dateFrom, dateTo } = req.query;

    let query = 'SELECT m.*, COUNT(v.id) as video_count FROM matches m LEFT JOIN videos v ON m.id = v.match_id WHERE 1=1';
    const params = [];
    let paramIndex = 1;

    if (bookingCode) {
      query += ` AND m.booking_code ILIKE $${paramIndex}`;
      params.push(`%${bookingCode}%`);
      paramIndex++;
    }

    if (location) {
      query += ` AND m.location ILIKE $${paramIndex}`;
      params.push(`%${location}%`);
      paramIndex++;
    }

    if (sportType) {
      query += ` AND m.sport_type = $${paramIndex}`;
      params.push(sportType);
      paramIndex++;
    }

    if (dateFrom) {
      query += ` AND m.match_date >= $${paramIndex}`;
      params.push(dateFrom);
      paramIndex++;
    }

    if (dateTo) {
      query += ` AND m.match_date <= $${paramIndex}`;
      params.push(dateTo);
      paramIndex++;
    }

    query += ' GROUP BY m.id ORDER BY m.match_date DESC';

    const result = await pool.query(query, params);

    // Get player names for each match
    const matches = await Promise.all(result.rows.map(async (match) => {
      const playerNames = [];
      for (const playerId of match.player_ids) {
        const userResult = await pool.query('SELECT name FROM users WHERE id = $1', [playerId]);
        if (userResult.rows.length > 0) {
          playerNames.push(userResult.rows[0].name);
        }
      }
      return {
        ...match,
        player_names: playerNames,
        video_count: parseInt(match.video_count)
      };
    }));

    res.json({
      success: true,
      count: matches.length,
      matches: matches
    });

  } catch (error) {
    console.error('Error searching matches:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get match by ID (for editing) - MUST BE BEFORE :bookingCode
app.get('/api/matches/id/:matchId', async (req, res) => {
  try {
    const { matchId } = req.params;
    const result = await pool.query(
      'SELECT * FROM matches WHERE id = $1',
      [matchId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Match non trovato'
      });
    }

    const match = result.rows[0];

    // Get player names
    const playerNames = [];
    for (const playerId of match.player_ids) {
      const userResult = await pool.query('SELECT name FROM users WHERE id = $1', [playerId]);
      if (userResult.rows.length > 0) {
        playerNames.push(userResult.rows[0].name);
      }
    }

    res.json({
      success: true,
      match: {
        ...match,
        player_names: playerNames
      }
    });

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get match by booking code - MUST BE AFTER specific routes
app.get('/api/matches/:bookingCode', async (req, res) => {
  try {
    const { bookingCode } = req.params;
    const result = await pool.query(
      'SELECT * FROM matches WHERE booking_code = $1',
      [bookingCode]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Match non trovato' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create new match
app.post('/api/matches/create', async (req, res) => {
  try {
    const { bookingCode, sportType, location, matchDate, players } = req.body;

    // Generate secure session password (8 characters)
    const generatePassword = () => {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      let password = '';
      for (let i = 0; i < 8; i++) {
        password += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      return password;
    };

    const sessionPassword = generatePassword();

    // Insert/get players first to get their IDs
    const playerIds = [];
    for (const playerName of players) {
      // Check if user exists
      let result = await pool.query(
        `SELECT id FROM users WHERE name = $1`,
        [playerName.trim()]
      );

      if (result.rows.length > 0) {
        // User exists, use existing ID
        playerIds.push(result.rows[0].id);
      } else {
        // User doesn't exist, create new
        result = await pool.query(
          `INSERT INTO users (name) VALUES ($1) RETURNING id`,
          [playerName.trim()]
        );
        playerIds.push(result.rows[0].id);
      }
    }

    // Insert match with player IDs
    const matchResult = await pool.query(
      `INSERT INTO matches (booking_code, sport_type, location, match_date, access_password, player_ids)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [bookingCode, sportType, location, matchDate, sessionPassword, playerIds]
    );

    const match = matchResult.rows[0];

    res.status(201).json({
      success: true,
      message: 'Match created successfully',
      match: {
        id: match.id,
        booking_code: match.booking_code,
        sport_type: match.sport_type,
        location: match.location,
        match_date: match.match_date,
        session_password: sessionPassword,
        created_at: match.created_at
      }
    });

  } catch (error) {
    console.error('Error creating match:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating match',
      error: error.message
    });
  }
});

// Verify match access
app.post('/api/matches/verify', async (req, res) => {
  try {
    const { bookingCode, password, playerName } = req.body;

    // Get match
    const matchResult = await pool.query(
      'SELECT * FROM matches WHERE booking_code = $1',
      [bookingCode]
    );

    if (matchResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Match non trovato con questo codice prenotazione'
      });
    }

    const match = matchResult.rows[0];

    // Check active
    if (!match.is_active) {
      return res.status(403).json({
        success: false,
        message: 'Questo match non è più attivo'
      });
    }

    // Check password
    if (match.access_password !== password) {
      return res.status(403).json({
        success: false,
        message: 'Password non valida'
      });
    }

    // Check expiry
    if (match.password_expiry && new Date(match.password_expiry) < new Date()) {
      return res.status(403).json({
        success: false,
        message: 'Password scaduta. Contatta il gestore del campo.'
      });
    }

    // Check player name
    let playerFound = false;
    for (const playerId of match.player_ids) {
      const userResult = await pool.query(
        'SELECT name FROM users WHERE id = $1',
        [playerId]
      );
      if (userResult.rows.length > 0 &&
          userResult.rows[0].name.toLowerCase() === playerName.toLowerCase()) {
        playerFound = true;
        break;
      }
    }

    if (!playerFound) {
      return res.status(403).json({
        success: false,
        message: 'Nome giocatore non trovato in questo match'
      });
    }

    res.json({
      success: true,
      message: 'Accesso consentito',
      match: match
    });

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== VIDEO ROUTES ====================
// Get videos by match ID - FIXED: convert numbers properly
app.get('/api/videos/match/:matchId', async (req, res) => {
  try {
    const { matchId } = req.params;
    const result = await pool.query(
      'SELECT * FROM videos WHERE match_id = $1 ORDER BY recorded_at DESC',
      [matchId]
    );

    // Convert numeric fields from string to number
    const videos = result.rows.map(row => ({
      ...row,
      duration_seconds: parseInt(row.duration_seconds),
      file_size_bytes: parseInt(row.file_size_bytes),
      view_count: parseInt(row.view_count),
      download_count: parseInt(row.download_count)
    }));

    res.json(videos);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Upload video
app.post('/api/videos/upload', upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Nessun file caricato' });
    }

    const { matchId, title, durationSeconds, isHighlight } = req.body;

    // Validate match exists
    const matchResult = await pool.query(
      'SELECT id FROM matches WHERE id = $1',
      [matchId]
    );

    if (matchResult.rows.length === 0) {
      return res.status(404).json({ error: 'Match non trovato' });
    }

    // Generate unique filename
    const filename = `${Date.now()}_${req.file.originalname}`;
    const filePath = await saveVideoFile(req.file.buffer, filename);

    // Insert into database
    const result = await pool.query(
      `INSERT INTO videos (
        match_id, title, file_path, duration_seconds,
        file_size_bytes, recorded_at, is_highlight
      ) VALUES ($1, $2, $3, $4, $5, NOW(), $6)
      RETURNING *`,
      [
        matchId,
        title,
        filePath,
        parseInt(durationSeconds),
        req.file.size,
        isHighlight === 'true'
      ]
    );

    console.log(`✅ Video caricato: ${title} (${(req.file.size / 1024 / 1024).toFixed(2)} MB)`);

    res.json({
      success: true,
      message: 'Video caricato con successo',
      video: result.rows[0]
    });

  } catch (error) {
    console.error('Error uploading video:', error);
    res.status(500).json({ error: error.message });
  }
});

// Stream video
app.get('/api/videos/:videoId/stream', async (req, res) => {
  try {
    const { videoId } = req.params;

    // Get video info
    const result = await pool.query(
      'SELECT file_path, title FROM videos WHERE id = $1',
      [videoId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Video non trovato' });
    }

    const { file_path } = result.rows[0];
    const videoUrl = await getVideoUrl(file_path);

    if (STORAGE_TYPE === 's3') {
      // Redirect to signed S3 URL
      res.redirect(videoUrl);
    } else {
      // Stream local file with range support
      const stat = await fs.stat(file_path);
      const fileSize = stat.size;
      const range = req.headers.range;

      if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunksize = (end - start) + 1;

        const fileStream = (await import('fs')).createReadStream(file_path, { start, end });

        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunksize,
          'Content-Type': 'video/mp4',
        });

        fileStream.pipe(res);
      } else {
        res.writeHead(200, {
          'Content-Length': fileSize,
          'Content-Type': 'video/mp4',
        });

        const fileStream = (await import('fs')).createReadStream(file_path);
        fileStream.pipe(res);
      }
    }

  } catch (error) {
    console.error('Error streaming video:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete video
app.delete('/api/videos/:videoId', async (req, res) => {
  try {
    const { videoId } = req.params;

    // Get video file path
    const result = await pool.query(
      'SELECT file_path FROM videos WHERE id = $1',
      [videoId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Video non trovato' });
    }

    const { file_path } = result.rows[0];

    // Delete from storage
    if (STORAGE_TYPE === 's3' && file_path.startsWith('s3://')) {
      // Delete from S3 (implement if needed)
      console.log('S3 deletion not implemented yet');
    } else {
      // Delete local file
      try {
        await fs.unlink(file_path);
      } catch (err) {
        console.error('Error deleting file:', err);
      }
    }

    // Delete from database
    await pool.query('DELETE FROM videos WHERE id = $1', [videoId]);

    res.json({ success: true, message: 'Video eliminato' });

  } catch (error) {
    console.error('Error deleting video:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get user by ID
app.get('/api/users/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const result = await pool.query(
      'SELECT * FROM users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Utente non trovato' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Increment video view count
app.post('/api/videos/:videoId/view', async (req, res) => {
  try {
    const { videoId } = req.params;
    await pool.query(
      'UPDATE videos SET view_count = view_count + 1 WHERE id = $1',
      [videoId]
    );
    res.json({ success: true });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Increment video download count
app.post('/api/videos/:videoId/download', async (req, res) => {
  try {
    const { videoId } = req.params;
    await pool.query(
      'UPDATE videos SET download_count = download_count + 1 WHERE id = $1',
      [videoId]
    );
    res.json({ success: true });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get storage statistics
app.get('/api/stats/storage', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*) as total_videos,
        SUM(file_size_bytes) as total_size,
        SUM(view_count) as total_views,
        SUM(download_count) as total_downloads
      FROM videos
    `);

    const stats = result.rows[0];

    res.json({
      totalVideos: parseInt(stats.total_videos),
      totalSizeBytes: parseInt(stats.total_size || 0),
      totalSizeGB: (parseInt(stats.total_size || 0) / 1024 / 1024 / 1024).toFixed(2),
      totalViews: parseInt(stats.total_views || 0),
      totalDownloads: parseInt(stats.total_downloads || 0),
      storageType: STORAGE_TYPE
    });

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 RePlayo API server running on http://localhost:${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
  console.log(`📦 Storage: ${STORAGE_TYPE === 's3' ? `S3 (${S3_BUCKET})` : `Local (${LOCAL_STORAGE_PATH})`}`);
});
