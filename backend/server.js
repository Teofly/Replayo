const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { Pool } = require('pg');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const app = express();
const PORT = process.env.PORT || 3000;

// ==================== CONFIGURATION ====================

// Storage configuration - can be 'local' or 's3'
const STORAGE_TYPE = process.env.STORAGE_TYPE || 'local';
const LOCAL_STORAGE_PATH = process.env.LOCAL_STORAGE_PATH || '/mnt/nas/replayo/videos';
const LOCAL_THUMBNAIL_PATH = process.env.LOCAL_THUMBNAIL_PATH || '/mnt/nas/replayo/videos';

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
    console.log('📤 Upload file:', file.originalname, 'mimetype:', file.mimetype);
    const allowedTypes = [
      'video/mp4', 
      'video/mpeg', 
      'video/quicktime', 
      'video/x-msvideo',
      'video/webm',
      'video/x-matroska',  // MKV
      'video/3gpp',
      'video/x-m4v',
      'application/octet-stream'  // Fallback per file non riconosciuti
    ];
    // Controlla anche estensione file
    const allowedExtensions = ['.mp4', '.mov', '.avi', '.mpeg', '.mpg', '.webm', '.mkv', '.m4v', '.3gp'];
    const ext = file.originalname.toLowerCase().slice(file.originalname.lastIndexOf('.'));
    if (allowedTypes.includes(file.mimetype) || allowedExtensions.includes(ext)) {
      cb(null, true);
    } else {
      console.error('❌ Formato non supportato:', file.mimetype, 'ext:', ext);
      cb(new Error('Formato video non supportato. Usa MP4, MPEG, MOV, AVI, WebM o MKV.'));
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
      let playerNames = [];
      
      // Se ha players (array di stringhe dai match creati da booking)
      if (match.players && Array.isArray(match.players)) {
        playerNames = match.players;
      }
      // Se ha player_ids (array)
      else if (match.player_ids && Array.isArray(match.player_ids) && match.player_ids.length > 0) {
        // Controlla se sono UUID o nomi
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        const firstItem = match.player_ids[0];
        
        if (uuidRegex.test(firstItem)) {
          // Sono UUID, cerca i nomi nella tabella users
          for (const playerId of match.player_ids) {
            try {
              const userResult = await pool.query('SELECT name FROM users WHERE id = $1', [playerId]);
              if (userResult.rows.length > 0) {
                playerNames.push(userResult.rows[0].name);
              }
            } catch (e) {
              // Se fallisce, usa l'ID stesso
              playerNames.push(playerId);
            }
          }
        } else {
          // Non sono UUID, sono già nomi
          playerNames = match.player_ids;
        }
      }
      
      return {
        ...match,
        player_names: playerNames,
        video_count: parseInt(match.video_count) || 0
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
    let playerNames = [];
    if (match.player_ids && Array.isArray(match.player_ids) && match.player_ids.length > 0) {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const firstItem = match.player_ids[0];
      
      if (uuidRegex.test(firstItem)) {
        // Sono UUID, cerca i nomi nella tabella users
        for (const playerId of match.player_ids) {
          try {
            const userResult = await pool.query('SELECT name FROM users WHERE id = $1', [playerId]);
            if (userResult.rows.length > 0) {
              playerNames.push(userResult.rows[0].name);
            }
          } catch (e) {
            playerNames.push(playerId);
          }
        }
      } else {
        // Non sono UUID, sono già nomi
        playerNames = match.player_ids;
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

    res.json({ success: true, court: result.rows[0] });
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
        'SELECT name FROM users WHERE id = $1$1',
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

    const matchId = req.body.matchId || req.body.match_id;
    const title = req.body.title || req.file.originalname;
    const { durationSeconds, isHighlight } = req.body;

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
        parseInt(durationSeconds) || 0,
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

    res.json({ success: true, court: result.rows[0] });
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

// DELETE match by ID
app.delete('/api/matches/:matchId', async (req, res) => {
    try {
        const { matchId } = req.params;
        
        // First delete associated videos
        const videos = await pool.query('SELECT id, file_path FROM videos WHERE match_id = $1', [matchId]);
        
        for (const video of videos.rows) {
            // Delete video file
            if (video.file_path && fsSync.existsSync(video.file_path)) {
                fsSync.unlinkSync(video.file_path);
            }
        }
        
        // Delete videos from database
        await pool.query('DELETE FROM videos WHERE match_id = $1', [matchId]);
        
        // Delete match
        const result = await pool.query('DELETE FROM matches WHERE id = $1 RETURNING *', [matchId]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Match not found' });
        }
        
        res.json({ success: true, message: 'Match and associated videos deleted successfully' });
    } catch (error) {
        console.error('Error deleting match:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// UPDATE match by ID
// UPDATE match by ID
app.put('/api/matches/:matchId', async (req, res) => {
    try {
        const { matchId } = req.params;
        // Accept both camelCase (frontend) and snake_case
        const sport_type = req.body.sportType || req.body.sport_type;
        const location = req.body.location;
        const match_date = req.body.matchDate || req.body.match_date;
        const players = req.body.players || req.body.player_ids || [];
        const access_password = req.body.accessPassword || req.body.access_password;
        const is_active = req.body.isActive !== undefined ? req.body.isActive : req.body.is_active;
        
        // Filter empty names
        const playerNames = Array.isArray(players) ? players.filter(p => p && p.trim() !== '') : [];
        
        const result = await pool.query(
            `UPDATE matches 
             SET sport_type = COALESCE($1, sport_type),
                 location = COALESCE($2, location),
                 match_date = COALESCE($3, match_date),
                 player_ids = COALESCE($4, player_ids),
                 access_password = COALESCE($5, access_password),
                 is_active = COALESCE($6, is_active)
             WHERE id = $7
             RETURNING *`,
            [sport_type, location, match_date, playerNames, access_password, is_active, matchId]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Match not found' });
        }
        
        res.json({ success: true, match: result.rows[0] });
    } catch (error) {
        console.error('Error updating match:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/api/stats/storage', async (req, res) => {
  try {
    // Get stats from database
    const result = await pool.query(`
      SELECT
        COUNT(*) as total_videos,
        SUM(file_size_bytes) as total_size,
        SUM(view_count) as total_views,
        SUM(download_count) as total_downloads
      FROM videos
    `);
    const stats = result.rows[0];

    // Calculate actual NAS storage
    let nasStorageBytes = 0;
    const getDirectorySize = (dirPath) => {
      let total = 0;
      try {
        const files = fsSync.readdirSync(dirPath);
        for (const file of files) {
          const filePath = path.join(dirPath, file);
          const stat = fsSync.statSync(filePath);
          if (stat.isDirectory()) {
            total += getDirectorySize(filePath);
          } else {
            total += stat.size;
          }
        }
      } catch (e) {}
      return total;
    };

    if (STORAGE_TYPE === 'local' && LOCAL_STORAGE_PATH) {
      nasStorageBytes = getDirectorySize(LOCAL_STORAGE_PATH);
    }

    // Conta file video reali dal NAS
    let nasVideoCount = 0;
    try {
      const files = fsSync.readdirSync(LOCAL_STORAGE_PATH);
      nasVideoCount = files.filter(f => !f.startsWith(".")).length;
    } catch (e) {}

    res.json({
      totalVideos: nasVideoCount,
      totalSize: nasStorageBytes || parseInt(stats.total_size || 0),
      totalSizeBytes: nasStorageBytes || parseInt(stats.total_size || 0),
      totalSizeGB: ((nasStorageBytes || parseInt(stats.total_size || 0)) / 1024 / 1024 / 1024).toFixed(2),
      totalViews: parseInt(stats.total_views || 0),
      totalDownloads: parseInt(stats.total_downloads || 0),
      storageType: STORAGE_TYPE,
      storagePath: LOCAL_STORAGE_PATH
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

// ==================== BOOKING SYSTEM API ====================

// Helper: genera password casuale per match
function generatePassword(length = 6) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Helper: genera codice prenotazione
function generateBookingCode() {
  const date = new Date();
  const prefix = date.getFullYear().toString().slice(-2) + 
                 (date.getMonth() + 1).toString().padStart(2, '0') +
                 date.getDate().toString().padStart(2, '0');
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return prefix + '-' + random;
}

// GET /api/courts - Lista campi
app.get('/api/courts', async (req, res) => {
  try {
    const { sport_type, active_only } = req.query;
    let query = 'SELECT * FROM courts WHERE 1=1';
    const params = [];
    
    if (sport_type) {
      params.push(sport_type);
      query += ' AND sport_type = $' + params.length;
    }
    if (active_only === 'true') {
      query += ' AND is_active = true';
    }
    query += ' ORDER BY sport_type, name';
    
    const result = await pool.query(query, params);
    res.json({ success: true, courts: result.rows });
  } catch (error) {
    console.error('Error fetching courts:', error);
    res.status(500).json({ error: 'Errore nel recupero dei campi' });
  }
});

// POST /api/courts - Crea campo
app.post('/api/courts', async (req, res) => {
  try {
    const { name, sport_type, description, price_per_hour, default_duration_minutes, has_video_recording } = req.body;
    
    // Durate default per sport
    const defaultDurations = { padel: 90, tennis: 60, calcetto: 60 };
    const duration = default_duration_minutes || defaultDurations[sport_type] || 60;
    
    const result = await pool.query(
      `INSERT INTO courts (name, sport_type, description, price_per_hour, default_duration_minutes, has_video_recording)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [name, sport_type, description, price_per_hour || 0, duration, has_video_recording !== false]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating court:', error);
    res.status(500).json({ error: 'Errore nella creazione del campo' });
  }
});

// PUT /api/courts/:id - Aggiorna campo
app.put('/api/courts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, sport_type, description, price_per_hour, default_duration_minutes, is_active, has_video_recording } = req.body;
    
    const result = await pool.query(
      `UPDATE courts SET name = $1, sport_type = $2, description = $3, price_per_hour = $4, 
       default_duration_minutes = $5, is_active = $6, has_video_recording = $7, updated_at = CURRENT_TIMESTAMP
       WHERE id = $8 RETURNING *`,
      [name, sport_type, description, price_per_hour, default_duration_minutes, is_active, has_video_recording, id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Campo non trovato' });
    }
    res.json({ success: true, court: result.rows[0] });
  } catch (error) {
    console.error('Error updating court:', error);
    res.status(500).json({ error: 'Errore nell aggiornamento del campo' });
  }
});

// DELETE /api/courts/:id - Elimina campo
app.delete('/api/courts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM courts WHERE id = $1', [id]);
    res.json({ success: true, message: "Campo eliminato" });
  } catch (error) {
    console.error('Error deleting court:', error);
    res.status(500).json({ error: 'Errore nell eliminazione del campo' });
  }
});

// GET /api/opening-hours - Orari apertura
app.get('/api/opening-hours', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM opening_hours ORDER BY day_of_week');
    res.json({ success: true, hours: result.rows });
  } catch (error) {
    console.error('Error fetching opening hours:', error);
    res.status(500).json({ error: 'Errore nel recupero degli orari' });
  }
});

// GET /api/bookings/available-slots - Slot disponibili per data e campo
app.get('/api/bookings/available-slots', async (req, res) => {
  try {
    const { court_id, date } = req.query;

    if (!court_id || !date) {
      return res.status(400).json({ error: 'court_id e date sono obbligatori' });
    }

    // Prendi info campo
    const courtResult = await pool.query('SELECT * FROM courts WHERE id = $1', [court_id]);
    if (courtResult.rows.length === 0) {
      return res.status(404).json({ error: 'Campo non trovato' });
    }
    const court = courtResult.rows[0];

    // Prendi giorno della settimana
    const dateObj = new Date(date);
    const dayOfWeek = dateObj.getDay();

    // Prendi orari apertura
    const hoursResult = await pool.query(
      'SELECT * FROM opening_hours WHERE day_of_week = $1 AND is_active = true',
      [dayOfWeek]
    );

    if (hoursResult.rows.length === 0) {
      return res.json({ slots: [], message: 'Chiuso in questo giorno' });
    }

    const openHours = hoursResult.rows[0];

    // Prendi prenotazioni esistenti per quella data e campo (ordinate per orario)
    const bookingsResult = await pool.query(
      `SELECT start_time, end_time FROM bookings
       WHERE court_id = $1 AND booking_date = $2 AND status NOT IN ('cancelled')
       ORDER BY start_time`,
      [court_id, date]
    );

    const existingBookings = bookingsResult.rows.map(b => ({
      start: b.start_time.slice(0, 5),
      end: b.end_time.slice(0, 5)
    }));

    // Helper: converti HH:MM in minuti
    const toMinutes = (time) => {
      const [h, m] = time.split(':').map(Number);
      return h * 60 + m;
    };
    const toTime = (mins) => {
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    };

    const openMin = toMinutes(openHours.open_time.slice(0, 5));
    const closeMin = toMinutes(openHours.close_time.slice(0, 5));
    const defaultDuration = court.default_duration_minutes;
    const pricePerHour = parseFloat(court.price_per_hour);

    // Trova i "buchi" liberi
    const slots = [];
    let currentMin = openMin;

    // Itera ogni 30 minuti
    while (currentMin < closeMin) {
      const slotStart = toTime(currentMin);

      // Trova la prossima prenotazione che inizia dopo o durante questo slot
      const nextBooking = existingBookings.find(b => toMinutes(b.start) > currentMin);
      const currentBooking = existingBookings.find(b =>
        toMinutes(b.start) <= currentMin && toMinutes(b.end) > currentMin
      );

      if (currentBooking) {
        // Slot occupato
        slots.push({
          start_time: slotStart,
          end_time: currentBooking.end,
          duration_minutes: toMinutes(currentBooking.end) - currentMin,
          is_available: false,
          price: 0
        });
        currentMin += 30;
      } else {
        // Slot libero - calcola quanto spazio c'è fino alla prossima prenotazione o chiusura
        const maxEnd = nextBooking ? Math.min(toMinutes(nextBooking.start), closeMin) : closeMin;
        const gapMinutes = maxEnd - currentMin;

        // Determina la durata effettiva dello slot (preferisci durata standard, ma usa il gap se più piccolo)
        let actualDuration;
        if (gapMinutes >= defaultDuration) {
          actualDuration = defaultDuration;
        } else if (gapMinutes >= 60) {
          actualDuration = 60;
        } else if (gapMinutes >= 30) {
          actualDuration = 30;
        } else {
          // Gap troppo piccolo, skip
          currentMin += 30;
          continue;
        }

        const slotEnd = toTime(currentMin + actualDuration);

        slots.push({
          start_time: slotStart,
          end_time: slotEnd,
          duration_minutes: actualDuration,
          is_available: true,
          price: Math.round(pricePerHour * (actualDuration / 60)),
          gap_minutes: gapMinutes  // Info extra sul buco disponibile
        });

        currentMin += 30;
      }
    }

    res.json({
      court,
      date,
      slots,
      opening: openHours.open_time,
      closing: openHours.close_time
    });
  } catch (error) {
    console.error('Error fetching available slots:', error);
    res.status(500).json({ error: 'Errore nel recupero degli slot disponibili' });
  }
});

// GET /api/bookings - Lista prenotazioni
app.get('/api/bookings', async (req, res) => {
  try {
    const { date, court_id, status, from_date, to_date } = req.query;
    
    let query = `
      SELECT b.*, c.name as court_name, c.sport_type 
      FROM bookings b 
      JOIN courts c ON b.court_id = c.id 
      WHERE 1=1`;
    const params = [];
    
    if (date) {
      params.push(date);
      query += ' AND b.booking_date = $' + params.length;
    }
    if (from_date) {
      params.push(from_date);
      query += ' AND b.booking_date >= $' + params.length;
    }
    if (to_date) {
      params.push(to_date);
      query += ' AND b.booking_date <= $' + params.length;
    }
    if (court_id) {
      params.push(court_id);
      query += ' AND b.court_id = $' + params.length;
    }
    if (status) {
      params.push(status);
      query += ' AND b.status = $' + params.length;
    }
    
    query += ' ORDER BY b.booking_date, b.start_time';
    
    const result = await pool.query(query, params);
    res.json({ success: true, bookings: result.rows });
  } catch (error) {
    console.error('Error fetching bookings:', error);
    res.status(500).json({ error: 'Errore nel recupero delle prenotazioni' });
  }
});

// POST /api/bookings - Crea prenotazione
app.post('/api/bookings', async (req, res) => {
  try {
    const { 
      court_id, booking_date, start_time, end_time,
      customer_name, customer_email, customer_phone, num_players,
      notes, auto_confirm
    } = req.body;
    
    // Verifica campo
    const courtResult = await pool.query('SELECT * FROM courts WHERE id = $1', [court_id]);
    if (courtResult.rows.length === 0) {
      return res.status(404).json({ error: 'Campo non trovato' });
    }
    const court = courtResult.rows[0];
    
    // Calcola durata
    const startDate = new Date(`2000-01-01T${start_time}`);
    const endDate = new Date(`2000-01-01T${end_time}`);
    const duration_minutes = (endDate - startDate) / 60000;
    
    // Calcola prezzo
    const total_price = parseFloat(court.price_per_hour) * (duration_minutes / 60);
    const price_per_player = total_price / (num_players || 4);
    
    // Verifica slot libero
    const conflictResult = await pool.query(
      `SELECT id FROM bookings 
       WHERE court_id = $1 AND booking_date = $2 AND status NOT IN ('cancelled')
       AND ((start_time <= $3 AND end_time > $3) OR (start_time < $4 AND end_time >= $4) OR (start_time >= $3 AND end_time <= $4))`,
      [court_id, booking_date, start_time, end_time]
    );
    
    if (conflictResult.rows.length > 0) {
      return res.status(409).json({ error: 'Slot già prenotato' });
    }
    
    // Determina stato iniziale
    const status = auto_confirm ? 'confirmed' : 'pending';
    
    // Crea prenotazione
    const bookingResult = await pool.query(
      `INSERT INTO bookings (court_id, booking_date, start_time, end_time, duration_minutes,
         customer_name, customer_email, customer_phone, num_players, 
         total_price, price_per_player, status, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
      [court_id, booking_date, start_time, end_time, duration_minutes,
       customer_name, customer_email, customer_phone, num_players || 4,
       total_price, price_per_player, status, notes]
    );
    
    const booking = bookingResult.rows[0];
    
    // Se auto_confirm, crea subito il match
    if (auto_confirm && court.has_video_recording) {
      const matchResult = await createMatchFromBooking(booking, court);
      if (matchResult) {
        booking.match_id = matchResult.id;
        booking.match_booking_code = matchResult.booking_code;
        booking.match_password = matchResult.password;
      }
    }
    
    res.status(201).json({ success: true, booking: booking });
  } catch (error) {
    console.error('Error creating booking:', error);
    res.status(500).json({ error: 'Errore nella creazione della prenotazione' });
  }
});

// Helper: Crea match da prenotazione
async function createMatchFromBooking(booking, court) {
  try {
    const bookingCode = generateBookingCode();
    const password = generatePassword();
    
    // Gestisci booking_date che potrebbe essere Date o string
    let dateStr = booking.booking_date;
    if (booking.booking_date instanceof Date) {
      dateStr = booking.booking_date.toISOString().split('T')[0];
    } else if (typeof booking.booking_date === 'string' && booking.booking_date.includes('T')) {
      dateStr = booking.booking_date.split('T')[0];
    }
    const matchDatetime = new Date(`${dateStr}T${booking.start_time}`);
    
    console.log('Creating match:', { bookingCode, dateStr, start_time: booking.start_time, matchDatetime });
    
    const matchResult = await pool.query(
      `INSERT INTO matches (booking_code, sport_type, location, match_date, access_password, player_ids)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [bookingCode, court.sport_type, court.name, matchDatetime, password, []]
    );
    
    const match = matchResult.rows[0];
    
    // Aggiorna booking con match_id
    await pool.query(
      'UPDATE bookings SET match_id = $1 WHERE id = $2',
      [match.id, booking.id]
    );
    
    console.log(`Match creato per booking ${booking.id}: ${bookingCode}`);
    return match;
  } catch (error) {
    console.error('Error creating match from booking:', error);
    return null;
  }
}

// GET /api/bookings/:id - Get single booking
app.get('/api/bookings/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT * FROM bookings WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Prenotazione non trovata' });
    }
    res.json({ booking: result.rows[0] });
  } catch (error) {
    console.error('Error fetching booking:', error);
    res.status(500).json({ error: 'Errore nel recupero della prenotazione' });
  }
});


// GET /api/bookings/:id - Get single booking
app.get('/api/bookings/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT * FROM bookings WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Prenotazione non trovata' });
    }
    res.json({ booking: result.rows[0] });
  } catch (error) {
    console.error('Error fetching booking:', error);
    res.status(500).json({ error: 'Errore nel recupero della prenotazione' });
  }
});
// PUT /api/bookings/:id/confirm - Conferma prenotazione e crea match
app.put('/api/bookings/:id/confirm', async (req, res) => {
  try {
    const { id } = req.params;
    const { payment_status, payment_method } = req.body;
    
    // Prendi prenotazione con info campo
    const bookingResult = await pool.query(
      `SELECT b.*, c.name as court_name, c.sport_type, c.has_video_recording
       FROM bookings b JOIN courts c ON b.court_id = c.id WHERE b.id = $1`,
      [id]
    );
    
    if (bookingResult.rows.length === 0) {
      return res.status(404).json({ error: 'Prenotazione non trovata' });
    }
    
    const booking = bookingResult.rows[0];
    
    if (booking.status === 'confirmed') {
      return res.status(400).json({ error: 'Prenotazione già confermata' });
    }
    
    // Aggiorna stato
    await pool.query(
      `UPDATE bookings SET status = 'confirmed', payment_status = $1, payment_method = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3`,
      [payment_status || 'paid', payment_method, id]
    );
    
    // Crea match se il campo ha registrazione video
    let match = null;
    if (!booking.match_id) {  // Crea sempre match alla conferma
      match = await createMatchFromBooking(booking, {
        name: booking.court_name,
        sport_type: booking.sport_type
      });
    }
    
    // Ricarica booking
    const updatedResult = await pool.query(
      `SELECT b.*, c.name as court_name, c.sport_type, m.booking_code as match_booking_code, m.access_password as match_password
       FROM bookings b 
       JOIN courts c ON b.court_id = c.id 
       LEFT JOIN matches m ON b.match_id = m.id
       WHERE b.id = $1`,
      [id]
    );
    
    res.json(updatedResult.rows[0]);
  } catch (error) {
    console.error('Error confirming booking:', error);
    res.status(500).json({ error: 'Errore nella conferma della prenotazione' });
  }
});

// PUT /api/bookings/:id/cancel - Cancella prenotazione
app.put('/api/bookings/:id/cancel', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(
      `UPDATE bookings SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *`,
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Prenotazione non trovata' });
    }
    
    res.json({ success: true, court: result.rows[0] });
  } catch (error) {
    console.error('Error cancelling booking:', error);
    res.status(500).json({ error: 'Errore nella cancellazione' });
  }
});

// DELETE /api/bookings/:id - Elimina prenotazione
app.delete('/api/bookings/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(
      'DELETE FROM bookings WHERE id = $1 RETURNING *',
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Prenotazione non trovata' });
    }
    
    res.json({ success: true, deleted: result.rows[0] });
  } catch (error) {
    console.error('Error deleting booking:', error);
    res.status(500).json({ error: 'Errore nell eliminazione della prenotazione' });
  }
});

// PUT /api/bookings/:id - Aggiorna prenotazione
app.put('/api/bookings/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { court_id, booking_date, start_time, end_time, customer_name, customer_email, customer_phone, num_players, notes, payment_status } = req.body;

    // Calcola duration_minutes se abbiamo start_time e end_time
    let duration_minutes = null;
    if (start_time && end_time) {
      const [sh, sm] = start_time.split(':').map(Number);
      const [eh, em] = end_time.split(':').map(Number);
      duration_minutes = (eh * 60 + em) - (sh * 60 + sm);
    }

    const result = await pool.query(
      `UPDATE bookings SET
       court_id = COALESCE($1, court_id),
       booking_date = COALESCE($2, booking_date),
       start_time = COALESCE($3, start_time),
       end_time = COALESCE($4, end_time),
       duration_minutes = COALESCE($5, duration_minutes),
       customer_name = COALESCE($6, customer_name),
       customer_email = COALESCE($7, customer_email),
       customer_phone = COALESCE($8, customer_phone),
       num_players = COALESCE($9, num_players),
       notes = COALESCE($10, notes),
       payment_status = COALESCE($11, payment_status),
       updated_at = CURRENT_TIMESTAMP
       WHERE id = $12 RETURNING *`,
      [court_id, booking_date, start_time, end_time, duration_minutes, customer_name, customer_email, customer_phone, num_players, notes, payment_status, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Prenotazione non trovata' });
    }

    res.json({ success: true, booking: result.rows[0] });
  } catch (error) {
    console.error('Error updating booking:', error);
    res.status(500).json({ error: 'Errore nell aggiornamento' });
  }
});

// GET /api/bookings/calendar - Vista calendario (per mese)
app.get('/api/bookings/calendar', async (req, res) => {
  try {
    const { year, month } = req.query;
    
    if (!year || !month) {
      return res.status(400).json({ error: 'year e month sono obbligatori' });
    }
    
    const startDate = `${year}-${month.padStart(2, '0')}-01`;
    const endDate = new Date(year, month, 0).toISOString().slice(0, 10);
    
    const result = await pool.query(
      `SELECT b.booking_date, b.status, COUNT(*) as count, 
              array_agg(json_build_object('id', b.id, 'start_time', b.start_time, 'end_time', b.end_time, 
                'court_name', c.name, 'customer_name', b.customer_name, 'status', b.status)) as bookings
       FROM bookings b
       JOIN courts c ON b.court_id = c.id
       WHERE b.booking_date >= $1 AND b.booking_date <= $2
       GROUP BY b.booking_date, b.status
       ORDER BY b.booking_date`,
      [startDate, endDate]
    );
    
    res.json({ success: true, bookings: result.rows });
  } catch (error) {
    console.error('Error fetching calendar:', error);
    res.status(500).json({ error: 'Errore nel recupero del calendario' });
  }
});

console.log('📅 Booking system API loaded');


// ==========================================
// PLAYERS API - Anagrafica Giocatori
// ==========================================

// GET /api/players - Lista giocatori con ricerca
app.get('/api/players', async (req, res) => {
  try {
    const { search, limit = 50 } = req.query;
    
    let query = 'SELECT * FROM players WHERE is_active = true';
    const params = [];
    
    if (search) {
      query += " AND (LOWER(first_name || ' ' || last_name) LIKE LOWER($1) OR LOWER(email) LIKE LOWER($1) OR phone LIKE $1)";
      params.push('%' + search + '%');
    }
    
    query += ' ORDER BY first_name, last_name LIMIT $' + (params.length + 1);
    params.push(parseInt(limit));
    
    const result = await pool.query(query, params);
    res.json({ success: true, players: result.rows });
  } catch (error) {
    console.error('Error fetching players:', error);
    res.status(500).json({ error: 'Errore nel recupero giocatori' });
  }
});

// GET /api/players/search - Ricerca veloce per autocompletamento
app.get('/api/players/search', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 2) {
      return res.json({ players: [] });
    }
    
    const result = await pool.query(
      "SELECT id, first_name, last_name, email, phone FROM players WHERE is_active = true AND (LOWER(first_name || ' ' || last_name) LIKE LOWER($1)) ORDER BY first_name LIMIT 10",
      ['%' + q + '%']
    );
    
    res.json({ players: result.rows });
  } catch (error) {
    console.error('Error searching players:', error);
    res.status(500).json({ error: 'Errore ricerca' });
  }
});

// POST /api/players - Crea nuovo giocatore
app.post('/api/players', async (req, res) => {
  try {
    const { first_name, last_name, email, phone, notes } = req.body;
    
    if (!first_name || !last_name) {
      return res.status(400).json({ error: 'Nome e cognome obbligatori' });
    }
    
    const result = await pool.query(
      'INSERT INTO players (first_name, last_name, email, phone, notes) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [first_name.trim(), last_name.trim(), email || null, phone || null, notes || null]
    );
    
    res.status(201).json({ success: true, player: result.rows[0] });
  } catch (error) {
    console.error('Error creating player:', error);
    res.status(500).json({ error: 'Errore creazione giocatore' });
  }
});

// PUT /api/players/:id - Aggiorna giocatore
app.put('/api/players/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { first_name, last_name, email, phone, notes, is_active } = req.body;
    
    const result = await pool.query(
      'UPDATE players SET first_name = $1, last_name = $2, email = $3, phone = $4, notes = $5, is_active = $6, updated_at = CURRENT_TIMESTAMP WHERE id = $7 RETURNING *',
      [first_name, last_name, email, phone, notes, is_active !== false, id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Giocatore non trovato' });
    }
    
    res.json({ success: true, player: result.rows[0] });
  } catch (error) {
    console.error('Error updating player:', error);
    res.status(500).json({ error: 'Errore aggiornamento' });
  }
});

// DELETE /api/players/:id - Disattiva giocatore (soft delete)
app.delete('/api/players/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('UPDATE players SET is_active = false WHERE id = $1', [id]);
    res.json({ success: true, message: 'Giocatore disattivato' });
  } catch (error) {
    console.error('Error deleting player:', error);
    res.status(500).json({ error: 'Errore eliminazione' });
  }
});

// POST /api/players/quick-add - Aggiunta rapida da nome completo
app.post('/api/players/quick-add', async (req, res) => {
  try {
    const { full_name, phone, email } = req.body;
    
    if (!full_name || full_name.trim().length < 2) {
      return res.status(400).json({ error: 'Nome obbligatorio' });
    }
    
    // Separa nome e cognome
    const parts = full_name.trim().split(' ');
    const first_name = parts[0];
    const last_name = parts.slice(1).join(' ') || '';
    
    const result = await pool.query(
      'INSERT INTO players (first_name, last_name, email, phone) VALUES ($1, $2, $3, $4) RETURNING *',
      [first_name, last_name, email || null, phone || null]
    );
    
    res.status(201).json({ success: true, player: result.rows[0] });
  } catch (error) {
    console.error('Error quick-adding player:', error);
    res.status(500).json({ error: 'Errore aggiunta rapida' });
  }
});
