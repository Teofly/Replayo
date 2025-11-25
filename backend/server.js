const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { Pool } = require('pg');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const axios = require('axios');
const ffmpeg = require('fluent-ffmpeg');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl} = require('@aws-sdk/s3-request-presigner');

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

// Basic Auth middleware
const ADMIN_USER = process.env.ADMIN_USER || 'demo';
const ADMIN_PASS = process.env.ADMIN_PASS || 'demo';

function basicAuth(req, res, next) {
  // Skip auth for health check and all user-facing endpoints
  const publicPaths = [
    '/health',
    '/matches/access/',
    '/matches/verify',
    '/videos/match/',
    '/bookings/availability',  // Public: slot disponibili per prenotazione
    '/courts',                 // Public: lista campi
    '/club/images',            // Public: immagini club
  ];
  // Also allow video streaming, download and view endpoints
  // And POST /bookings for user booking requests (will be pending status)
  if (publicPaths.some(p => req.path.startsWith(p)) ||
      req.path.match(/\/videos\/[^/]+\/stream/) ||
      req.path.match(/\/videos\/[^/]+\/download/) ||
      req.path.match(/\/videos\/[^/]+\/view/) ||
      (req.method === 'POST' && req.path === '/bookings')) {
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="RePlayo Admin"');
    return res.status(401).json({ error: 'Autenticazione richiesta' });
  }

  const base64Credentials = authHeader.split(' ')[1];
  const credentials = Buffer.from(base64Credentials, 'base64').toString('utf8');
  const [username, password] = credentials.split(':');

  if (username === ADMIN_USER && password === ADMIN_PASS) {
    next();
  } else {
    res.setHeader('WWW-Authenticate', 'Basic realm="RePlayo Admin"');
    return res.status(401).json({ error: 'Credenziali non valide' });
  }
}

// Apply auth to all /api routes
app.use('/api', basicAuth);

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

/**
 * Compress video using H.265 codec and 720p resolution
 * @param {string} inputPath - Input video file path
 * @param {string} outputPath - Output video file path
 * @returns {Promise<string>} - Output file path
 */
async function compressVideo(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    console.log(`[FFmpeg] Starting compression: ${inputPath} -> ${outputPath}`);
    console.log(`[FFmpeg] Using H.264 codec, 720p resolution`);

    ffmpeg(inputPath)
      .videoCodec('libx264')              // H.264 codec
      .size('?x720')                      // 720p height, auto width
      .videoBitrate('2000k')              // 2 Mbps video bitrate (higher for H.264)
      .audioCodec('aac')                  // AAC audio
      .audioBitrate('128k')               // 128 kbps audio
      .outputOptions([
        '-preset medium',                 // Encoding speed (medium = balanced)
        '-crf 23',                        // Constant Rate Factor (18-23 for H.264)
        '-movflags +faststart',           // Optimize for web streaming
        '-pix_fmt yuv420p'                // Pixel format for compatibility
      ])
      .output(outputPath)
      .on('start', (commandLine) => {
        console.log(`[FFmpeg] Command: ${commandLine}`);
      })
      .on('progress', (progress) => {
        if (progress.percent) {
          console.log(`[FFmpeg] Progress: ${Math.round(progress.percent)}%`);
        }
      })
      .on('end', () => {
        console.log(`[FFmpeg] Compression completed successfully`);
        resolve(outputPath);
      })
      .on('error', (err, stdout, stderr) => {
        console.error(`[FFmpeg] Error:`, err.message);
        console.error(`[FFmpeg] stderr:`, stderr);
        reject(err);
      })
      .run();
  });
}

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

// Environment Status Endpoint
app.get("/api/status/environment", async (req, res) => {
  const fs = require("fs");
  const { exec } = require("child_process");
  const SynologyService = require('./synology_service');

  try {
    const status = {
      server: { status: "online", uptime: process.uptime() },
      api: { status: "ok", url: "http://" + req.headers.host },
      database: { status: "unknown" },
      nas: { status: "unknown", path: "/mnt/nas/replayo/videos" },
      synology: { status: "unknown" },
      cronVideoDownload: { status: "unknown" },
      bookingPage: { status: "unknown", port: 8084 },
      dependencies: { nodejs: process.version, pm2: "running" },
      timestamp: new Date().toISOString()
    };

    // Check Database
    try {
      await pool.query("SELECT 1");
      status.database.status = "connected";
      status.database.name = process.env.DB_NAME || "replayo_db";
    } catch (dbError) {
      status.database.status = "error";
    }

    // Check NAS Mount
    const nasPath = "/mnt/nas/replayo/videos";
    try {
      if (fs.existsSync(nasPath)) {
        status.nas.status = "mounted";
        status.nas.accessible = true;
      } else {
        status.nas.status = "not_mounted";
        status.nas.accessible = false;
      }
    } catch (nasError) {
      status.nas.status = "error";
    }

    // Check Synology Surveillance Station
    try {
      const synology = new SynologyService('192.168.1.69', '5000', 'admin', 'Druido#00');
      await synology.login();
      const cameras = await synology.getCameraList();
      await synology.logout();
      status.synology.status = "connected";
      status.synology.cameras = cameras.length;
    } catch (synError) {
      status.synology.status = "error";
      status.synology.error = synError.message;
    }

    // Check Cron Job for video download
    try {
      const cronCheck = await new Promise((resolve, reject) => {
        exec("crontab -l 2>/dev/null | grep -c cron-video-download.js || echo 0", (err, stdout) => {
          if (err) reject(err);
          else resolve(parseInt(stdout.trim()) > 0);
        });
      });
      status.cronVideoDownload.status = cronCheck ? "active" : "not_configured";
      status.cronVideoDownload.schedule = cronCheck ? "ogni ora alle x:55" : null;
    } catch (cronError) {
      status.cronVideoDownload.status = "unknown";
    }

    // Check Booking Page service
    try {
      const bookingCheck = await new Promise((resolve, reject) => {
        exec("pm2 jlist 2>/dev/null", (err, stdout) => {
          if (err) reject(err);
          else {
            try {
              const processes = JSON.parse(stdout);
              const bookingProcess = processes.find(p => p.name === 'replayo-booking');
              resolve(bookingProcess);
            } catch {
              resolve(null);
            }
          }
        });
      });
      if (bookingCheck && bookingCheck.pm2_env.status === 'online') {
        status.bookingPage.status = "online";
        status.bookingPage.uptime = bookingCheck.pm2_env.pm_uptime;
      } else if (bookingCheck) {
        status.bookingPage.status = bookingCheck.pm2_env.status;
      } else {
        status.bookingPage.status = "not_running";
      }
    } catch (bookingError) {
      status.bookingPage.status = "unknown";
    }

    res.json({ success: true, status: status });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/cron/video-download - Esegui manualmente il cron video download
app.post('/api/cron/video-download', async (req, res) => {
  const { exec } = require('child_process');

  try {
    const result = await new Promise((resolve, reject) => {
      exec('cd /home/teofly/replayo/backend && node cron-video-download.js 2>&1',
        { timeout: 300000 }, // 5 minuti timeout
        (err, stdout, stderr) => {
          if (err && !stdout) {
            reject(new Error(stderr || err.message));
          } else {
            resolve(stdout || stderr);
          }
        }
      );
    });

    res.json({
      success: true,
      message: 'Cron job eseguito',
      output: result
    });
  } catch (error) {
    console.error('Manual cron error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
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
      // Use player_ids directly as names (they might already be names, not UUIDs)
      const playerNames = match.player_ids || [];
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
    // Use player_ids directly as names
    const playerNames = match.player_ids || [];

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

    // Check player name - first try player_names array, then player_ids as UUID
    let playerFound = false;

    // Check in player_names array (direct string comparison)
    if (match.player_names && Array.isArray(match.player_names)) {
      playerFound = match.player_names.some(name =>
        name.toLowerCase() === playerName.toLowerCase()
      );
    }

    // If not found in player_names, try player_ids as UUIDs (legacy support)
    if (!playerFound && match.player_ids && Array.isArray(match.player_ids)) {
      for (const playerId of match.player_ids) {
        // Check if it's a valid UUID before querying
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (uuidRegex.test(playerId)) {
          try {
            const userResult = await pool.query(
              'SELECT name FROM users WHERE id = $1',
              [playerId]
            );
            if (userResult.rows.length > 0 &&
                userResult.rows[0].name.toLowerCase() === playerName.toLowerCase()) {
              playerFound = true;
              break;
            }
          } catch (e) {
            // Skip invalid UUID
          }
        } else {
          // It's a name string, compare directly
          if (playerId.toLowerCase() === playerName.toLowerCase()) {
            playerFound = true;
            break;
          }
        }
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

    // Check if videoId is a valid UUID or a booking_code
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    let result;

    if (uuidRegex.test(videoId)) {
      // It's a UUID - search directly by video id
      result = await pool.query(
        'SELECT file_path, title FROM videos WHERE id = $1',
        [videoId]
      );
    } else {
      // It's a booking_code - find the match and get first video
      result = await pool.query(
        `SELECT v.file_path, v.title FROM videos v
         JOIN matches m ON v.match_id = m.id
         WHERE m.booking_code = $1
         ORDER BY v.created_at ASC LIMIT 1`,
        [videoId]
      );
    }

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

// Download video (force download with Content-Disposition)
app.get('/api/videos/:videoId/download', async (req, res) => {
  try {
    const { videoId } = req.params;

    // Check if videoId is a valid UUID or a booking_code
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    let result;
    let actualVideoId = videoId;

    if (uuidRegex.test(videoId)) {
      // It's a UUID - search directly by video id
      result = await pool.query(
        'SELECT id, file_path, title FROM videos WHERE id = $1',
        [videoId]
      );
    } else {
      // It's a booking_code - find the match and get first video
      result = await pool.query(
        `SELECT v.id, v.file_path, v.title FROM videos v
         JOIN matches m ON v.match_id = m.id
         WHERE m.booking_code = $1
         ORDER BY v.created_at ASC LIMIT 1`,
        [videoId]
      );
      if (result.rows.length > 0) {
        actualVideoId = result.rows[0].id;
      }
    }

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Video non trovato' });
    }

    const { file_path, title } = result.rows[0];
    const filename = title ? `${title}.mp4` : 'video.mp4';

    // Increment download count
    await pool.query(
      'UPDATE videos SET download_count = download_count + 1 WHERE id = $1',
      [actualVideoId]
    );

    if (STORAGE_TYPE === 's3') {
      const videoUrl = await getVideoUrl(file_path);
      res.redirect(videoUrl);
    } else {
      const stat = await fs.stat(file_path);
      const fileSize = stat.size;

      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': 'video/mp4',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
      });

      const fileStream = (await import('fs')).createReadStream(file_path);
      fileStream.pipe(res);
    }

  } catch (error) {
    console.error('Error downloading video:', error);
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

// List video files available on NAS
app.get('/api/videos/list-nas-files', async (req, res) => {
  try {
    const files = await fs.readdir(LOCAL_STORAGE_PATH);

    // Filter only video files and get stats
    const videoExtensions = ['.mp4', '.mov', '.avi', '.mpeg', '.mpg', '.webm', '.mkv', '.m4v', '.3gp'];
    const videoFiles = [];

    for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      if (videoExtensions.includes(ext)) {
        const filePath = path.join(LOCAL_STORAGE_PATH, file);
        try {
          const stats = await fs.stat(filePath);
          videoFiles.push({
            name: file,
            path: filePath,
            size: stats.size,
            modified: stats.mtime
          });
        } catch (err) {
          console.error(`Error reading file ${file}:`, err);
        }
      }
    }

    // Sort by modification date (newest first)
    videoFiles.sort((a, b) => b.modified - a.modified);

    res.json({
      success: true,
      files: videoFiles,
      count: videoFiles.length
    });

  } catch (error) {
    console.error('Error listing NAS files:', error);
    res.status(500).json({ error: error.message });
  }
});

// Associate existing NAS video to match
app.post('/api/videos/associate-from-nas', async (req, res) => {
  try {
    const { matchId, filePath, title, durationSeconds } = req.body;

    if (!matchId || !filePath || !title) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    // Validate match exists
    const matchResult = await pool.query('SELECT id FROM matches WHERE id = $1', [matchId]);
    if (matchResult.rows.length === 0) {
      return res.status(404).json({ error: 'Match not found' });
    }

    // Check if file exists
    try {
      const stats = await fs.stat(filePath);
      const fileSizeBytes = stats.size;

      // Insert into database
      const result = await pool.query(
        `INSERT INTO videos (
          match_id, title, file_path, duration_seconds,
          file_size_bytes, recorded_at, is_highlight
        ) VALUES ($1, $2, $3, $4, $5, NOW(), false)
        RETURNING *`,
        [matchId, title, filePath, durationSeconds || 0, fileSizeBytes]
      );

      console.log(`✅ Video associato dal NAS: ${title} (${(fileSizeBytes / 1024 / 1024).toFixed(2)} MB)`);

      res.json({
        success: true,
        message: 'Video associato con successo',
        video: result.rows[0]
      });
    } catch (fileError) {
      return res.status(404).json({ error: `File non trovato: ${filePath}` });
    }

  } catch (error) {
    console.error('Error associating NAS video:', error);
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

    // Check if videoId is a valid UUID or a booking_code
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    let actualVideoId = videoId;

    if (!uuidRegex.test(videoId)) {
      // It's a booking_code - find the match and get first video
      const result = await pool.query(
        `SELECT v.id FROM videos v
         JOIN matches m ON v.match_id = m.id
         WHERE m.booking_code = $1
         ORDER BY v.created_at ASC LIMIT 1`,
        [videoId]
      );
      if (result.rows.length > 0) {
        actualVideoId = result.rows[0].id;
      } else {
        return res.status(404).json({ error: 'Video non trovato' });
      }
    }

    await pool.query(
      'UPDATE videos SET view_count = view_count + 1 WHERE id = $1',
      [actualVideoId]
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
        const { sport_type, location, match_date, player_ids, players, accessPassword, access_password } = req.body;
        const finalPlayerIds = player_ids || players;
        const finalPassword = accessPassword || access_password;

        const result = await pool.query(
            `UPDATE matches
             SET sport_type = COALESCE($1, sport_type),
                 location = COALESCE($2, location),
                 match_date = COALESCE($3, match_date),
                 player_ids = COALESCE($4, player_ids),
                 access_password = COALESCE($5, access_password)
             WHERE id = $6
             RETURNING *`,
            [sport_type, location, match_date, finalPlayerIds, finalPassword, matchId]
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

// POST /api/videos/cleanup - Remove orphaned video records (files deleted from NAS)
app.post('/api/videos/cleanup', async (req, res) => {
    try {
        // Get all video records
        const result = await pool.query('SELECT id, file_path, title FROM videos');
        const videos = result.rows;

        let deleted = 0;
        let kept = 0;
        const deletedVideos = [];

        for (const video of videos) {
            const filePath = video.file_path;
            let fileExists = false;

            if (STORAGE_TYPE === 'local' && filePath) {
                // Check if file exists on local storage
                const fullPath = path.join(LOCAL_STORAGE_PATH, filePath);
                try {
                    fsSync.accessSync(fullPath);
                    fileExists = true;
                } catch (e) {
                    fileExists = false;
                }
            }

            if (!fileExists) {
                // Delete orphaned record
                await pool.query('DELETE FROM videos WHERE id = $1', [video.id]);
                deleted++;
                deletedVideos.push({ id: video.id, title: video.title, path: video.file_path });
            } else {
                kept++;
            }
        }

        res.json({
            success: true,
            message: `Cleanup completed: ${deleted} orphaned records deleted, ${kept} valid records kept`,
            deleted,
            kept,
            deletedVideos
        });
    } catch (error) {
        console.error('Error cleaning up videos:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Helper function to scan NAS directory
function scanNasStorage(dirPath) {
  let totalSize = 0;
  let videoCount = 0;
  const videoExtensions = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v', '.mpeg', '.mpg'];

  const scanDir = (dir) => {
    try {
      const files = fsSync.readdirSync(dir);
      for (const file of files) {
        const filePath = path.join(dir, file);
        const stat = fsSync.statSync(filePath);
        if (stat.isDirectory()) {
          scanDir(filePath);
        } else {
          totalSize += stat.size;
          const ext = path.extname(file).toLowerCase();
          if (videoExtensions.includes(ext)) {
            videoCount++;
          }
        }
      }
    } catch (e) {
      console.error('Error scanning:', dir, e.message);
    }
  };

  scanDir(dirPath);
  return { totalSize, videoCount };
}

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

    // Scan NAS for actual file count and size
    let nasStats = { totalSize: 0, videoCount: 0 };
    if (STORAGE_TYPE === 'local' && LOCAL_STORAGE_PATH) {
      nasStats = scanNasStorage(LOCAL_STORAGE_PATH);
    }

    res.json({
      totalVideos: nasStats.videoCount || parseInt(stats.total_videos) || 0,
      totalSize: nasStats.totalSize || parseInt(stats.total_size || 0),
      totalSizeBytes: nasStats.totalSize || parseInt(stats.total_size || 0),
      totalSizeGB: ((nasStats.totalSize || parseInt(stats.total_size || 0)) / 1024 / 1024 / 1024).toFixed(2),
      totalViews: parseInt(stats.total_views || 0),
      totalDownloads: parseInt(stats.total_downloads || 0),
      storageType: STORAGE_TYPE,
      storagePath: LOCAL_STORAGE_PATH,
      nasVideoCount: nasStats.videoCount,
      dbVideoCount: parseInt(stats.total_videos) || 0
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/stats/bookings - Statistiche prenotazioni con filtri
app.get('/api/stats/bookings', async (req, res) => {
  try {
    const { from_date, to_date, sport_type, period } = req.query;

    // Build base query with filters
    let whereClause = "WHERE b.status != 'cancelled'";
    const params = [];

    if (from_date) {
      params.push(from_date);
      whereClause += ' AND b.booking_date >= $' + params.length;
    }
    if (to_date) {
      params.push(to_date);
      whereClause += ' AND b.booking_date <= $' + params.length;
    }
    if (sport_type) {
      params.push(sport_type);
      whereClause += ' AND c.sport_type = $' + params.length;
    }

    // Total bookings count
    const totalResult = await pool.query(`
      SELECT COUNT(*) as total,
             SUM(b.total_price) as revenue,
             SUM(b.duration_minutes) as total_minutes
      FROM bookings b
      JOIN courts c ON b.court_id = c.id
      ${whereClause}
    `, params);

    // Bookings by sport type
    const bySportResult = await pool.query(`
      SELECT c.sport_type, COUNT(*) as count, SUM(b.total_price) as revenue
      FROM bookings b
      JOIN courts c ON b.court_id = c.id
      ${whereClause}
      GROUP BY c.sport_type
      ORDER BY count DESC
    `, params);

    // Bookings by status
    const byStatusResult = await pool.query(`
      SELECT b.status, COUNT(*) as count
      FROM bookings b
      JOIN courts c ON b.court_id = c.id
      ${whereClause.replace("b.status != 'cancelled'", "1=1")}
      GROUP BY b.status
    `, params);

    // Bookings by day of week
    const byDayResult = await pool.query(`
      SELECT EXTRACT(DOW FROM b.booking_date) as day_of_week, COUNT(*) as count
      FROM bookings b
      JOIN courts c ON b.court_id = c.id
      ${whereClause}
      GROUP BY EXTRACT(DOW FROM b.booking_date)
      ORDER BY day_of_week
    `, params);

    // Bookings by hour
    const byHourResult = await pool.query(`
      SELECT EXTRACT(HOUR FROM b.start_time::time) as hour, COUNT(*) as count
      FROM bookings b
      JOIN courts c ON b.court_id = c.id
      ${whereClause}
      GROUP BY EXTRACT(HOUR FROM b.start_time::time)
      ORDER BY hour
    `, params);

    // Daily trend (last 30 days or custom range)
    const dailyResult = await pool.query(`
      SELECT b.booking_date::date as date, COUNT(*) as count, SUM(b.total_price) as revenue
      FROM bookings b
      JOIN courts c ON b.court_id = c.id
      ${whereClause}
      GROUP BY b.booking_date::date
      ORDER BY date
    `, params);

    // Monthly trend
    const monthlyResult = await pool.query(`
      SELECT DATE_TRUNC('month', b.booking_date) as month, COUNT(*) as count, SUM(b.total_price) as revenue
      FROM bookings b
      JOIN courts c ON b.court_id = c.id
      ${whereClause}
      GROUP BY DATE_TRUNC('month', b.booking_date)
      ORDER BY month
    `, params);

    // Top courts
    const topCourtsResult = await pool.query(`
      SELECT c.id, c.name, c.sport_type, COUNT(*) as bookings_count, SUM(b.total_price) as revenue
      FROM bookings b
      JOIN courts c ON b.court_id = c.id
      ${whereClause}
      GROUP BY c.id, c.name, c.sport_type
      ORDER BY bookings_count DESC
      LIMIT 10
    `, params);

    // Heatmap: day of week x hour
    const heatmapResult = await pool.query(`
      SELECT
        EXTRACT(DOW FROM b.booking_date) as day_of_week,
        EXTRACT(HOUR FROM b.start_time::time) as hour,
        COUNT(*) as count
      FROM bookings b
      JOIN courts c ON b.court_id = c.id
      ${whereClause}
      GROUP BY EXTRACT(DOW FROM b.booking_date), EXTRACT(HOUR FROM b.start_time::time)
      ORDER BY day_of_week, hour
    `, params);

    const dayNames = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];

    res.json({
      success: true,
      filters: { from_date, to_date, sport_type },
      summary: {
        total_bookings: parseInt(totalResult.rows[0]?.total || 0),
        total_revenue: parseFloat(totalResult.rows[0]?.revenue || 0),
        total_hours: Math.round((parseInt(totalResult.rows[0]?.total_minutes || 0)) / 60)
      },
      by_sport: bySportResult.rows.map(r => ({
        sport_type: r.sport_type,
        count: parseInt(r.count),
        revenue: parseFloat(r.revenue || 0)
      })),
      by_status: byStatusResult.rows.map(r => ({
        status: r.status,
        count: parseInt(r.count)
      })),
      by_day_of_week: byDayResult.rows.map(r => ({
        day: dayNames[parseInt(r.day_of_week)],
        day_number: parseInt(r.day_of_week),
        count: parseInt(r.count)
      })),
      by_hour: byHourResult.rows.map(r => ({
        hour: parseInt(r.hour),
        count: parseInt(r.count)
      })),
      daily_trend: dailyResult.rows.map(r => ({
        date: r.date,
        count: parseInt(r.count),
        revenue: parseFloat(r.revenue || 0)
      })),
      monthly_trend: monthlyResult.rows.map(r => ({
        month: r.month,
        count: parseInt(r.count),
        revenue: parseFloat(r.revenue || 0)
      })),
      top_courts: topCourtsResult.rows.map(r => ({
        id: r.id,
        name: r.name,
        sport_type: r.sport_type,
        bookings_count: parseInt(r.bookings_count),
        revenue: parseFloat(r.revenue || 0)
      })),
      heatmap: heatmapResult.rows.map(r => ({
        day: parseInt(r.day_of_week),
        hour: parseInt(r.hour),
        count: parseInt(r.count)
      }))
    });
  } catch (error) {
    console.error('Error fetching booking stats:', error);
    res.status(500).json({ error: 'Errore nel recupero delle statistiche' });
  }
});

// ==================== CLUB IMAGES API ====================

// Path per le immagini del club
const CLUB_IMAGES_PATH = process.env.CLUB_IMAGES_PATH || '/mnt/nas/replayo/club-images';

// Multer per upload immagini
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Formato immagine non supportato. Usa JPEG, PNG o WebP.'));
    }
  }
});

// GET /api/club/images - Lista immagini club (pubblico)
app.get('/api/club/images', async (req, res) => {
  try {
    // Crea la directory se non esiste
    await fs.mkdir(CLUB_IMAGES_PATH, { recursive: true });

    const files = await fs.readdir(CLUB_IMAGES_PATH);
    const images = files
      .filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f))
      .sort((a, b) => {
        // Ordina per numero nel nome (es. 01.jpg, 02.jpg)
        const numA = parseInt(a.match(/\d+/) || [0]);
        const numB = parseInt(b.match(/\d+/) || [0]);
        return numA - numB;
      })
      .map((filename, index) => ({
        id: index + 1,
        filename: filename,
        url: `/api/club/images/${filename}`
      }));

    res.json({ success: true, images });
  } catch (error) {
    console.error('Error listing club images:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/club/images/:filename - Serve immagine (pubblico)
app.get('/api/club/images/:filename', async (req, res) => {
  try {
    const filename = req.params.filename;
    const filepath = path.join(CLUB_IMAGES_PATH, filename);

    // Security: prevent path traversal
    if (!filepath.startsWith(CLUB_IMAGES_PATH)) {
      return res.status(403).json({ error: 'Accesso negato' });
    }

    const stat = await fs.stat(filepath);
    const ext = path.extname(filename).toLowerCase();
    const mimeTypes = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp'
    };

    res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache 24h

    const stream = fsSync.createReadStream(filepath);
    stream.pipe(res);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return res.status(404).json({ error: 'Immagine non trovata' });
    }
    console.error('Error serving club image:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/club/images - Upload nuova immagine (admin)
app.post('/api/club/images', imageUpload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Nessuna immagine caricata' });
    }

    // Crea la directory se non esiste
    await fs.mkdir(CLUB_IMAGES_PATH, { recursive: true });

    // Trova il prossimo numero disponibile
    const files = await fs.readdir(CLUB_IMAGES_PATH);
    const existingNumbers = files
      .map(f => parseInt(f.match(/^(\d+)/) || [0, 0])[1])
      .filter(n => !isNaN(n));
    const nextNumber = existingNumbers.length > 0 ? Math.max(...existingNumbers) + 1 : 1;

    // Estensione originale
    const ext = path.extname(req.file.originalname).toLowerCase() || '.jpg';
    const filename = `${String(nextNumber).padStart(2, '0')}${ext}`;
    const filepath = path.join(CLUB_IMAGES_PATH, filename);

    // Salva il file
    await fs.writeFile(filepath, req.file.buffer);

    console.log(`[ClubImages] Uploaded: ${filename}`);

    res.json({
      success: true,
      image: {
        id: nextNumber,
        filename: filename,
        url: `/api/club/images/${filename}`
      }
    });
  } catch (error) {
    console.error('Error uploading club image:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/club/images/:filename - Elimina immagine (admin)
app.delete('/api/club/images/:filename', async (req, res) => {
  try {
    const filename = req.params.filename;
    const filepath = path.join(CLUB_IMAGES_PATH, filename);

    // Security: prevent path traversal
    if (!filepath.startsWith(CLUB_IMAGES_PATH)) {
      return res.status(403).json({ error: 'Accesso negato' });
    }

    await fs.unlink(filepath);
    console.log(`[ClubImages] Deleted: ${filename}`);

    res.json({ success: true, message: 'Immagine eliminata' });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return res.status(404).json({ error: 'Immagine non trovata' });
    }
    console.error('Error deleting club image:', error);
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
    const { name, sport_type, description, price_per_player, num_players, default_duration_minutes, is_active, has_video_recording } = req.body;
    
    const result = await pool.query(
      `UPDATE courts SET name = $1, sport_type = $2, description = $3, price_per_player = $4, num_players = $5,
       default_duration_minutes = $6, is_active = $7, has_video_recording = $8, updated_at = CURRENT_TIMESTAMP
       WHERE id = $9 RETURNING *`,
      [name, sport_type, description, price_per_player || 0, num_players || 4, default_duration_minutes, is_active, has_video_recording, id]
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

// PUT /api/courts/:id/camera - Associa telecamera a campo
app.put('/api/courts/:id/camera', async (req, res) => {
  try {
    const { id } = req.params;
    const { camera_id } = req.body;

    const result = await pool.query(
      `UPDATE courts SET camera_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *`,
      [camera_id, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Campo non trovato' });
    }
    res.json({ success: true, court: result.rows[0] });
  } catch (error) {
    console.error('Error updating court camera:', error);
    res.status(500).json({ error: 'Errore nell associazione telecamera' });
  }
});

// GET /api/bookings/availability - Slot disponibili per prenotazione utente
app.get('/api/bookings/availability', async (req, res) => {
  try {
    const { date, court_id } = req.query;

    if (!date) {
      return res.status(400).json({ error: 'Data richiesta' });
    }

    // Orari club fissi
    const CLUB_OPEN = 8; // 08:00
    const CLUB_CLOSE = 22; // 22:00

    // Durate default per sport (minuti)
    const DURATIONS = {
      padel: { default: 90, fallback: 60 },
      tennis: { default: 60, fallback: null },
      calcetto: { default: 60, fallback: null }
    };

    // Recupera campi attivi
    let courtsQuery = 'SELECT * FROM courts WHERE is_active = true';
    const courtsParams = [];
    if (court_id) {
      courtsParams.push(court_id);
      courtsQuery += ' AND id = $1';
    }
    courtsQuery += ' ORDER BY sport_type, name';

    const courtsResult = await pool.query(courtsQuery, courtsParams);
    const courts = courtsResult.rows;

    if (courts.length === 0) {
      return res.json({ success: true, date, courts: [] });
    }

    // Recupera prenotazioni del giorno per tutti i campi richiesti
    const courtIds = courts.map(c => c.id);
    const bookingsResult = await pool.query(
      `SELECT court_id, start_time, end_time FROM bookings
       WHERE booking_date = $1 AND court_id = ANY($2) AND status NOT IN ('cancelled')
       ORDER BY start_time`,
      [date, courtIds]
    );

    // Organizza prenotazioni per campo
    const bookingsByCourtId = {};
    bookingsResult.rows.forEach(b => {
      if (!bookingsByCourtId[b.court_id]) bookingsByCourtId[b.court_id] = [];
      bookingsByCourtId[b.court_id].push({
        start: parseInt(b.start_time.split(':')[0]) * 60 + parseInt(b.start_time.split(':')[1]),
        end: parseInt(b.end_time.split(':')[0]) * 60 + parseInt(b.end_time.split(':')[1])
      });
    });

    // Calcola slot disponibili per ogni campo
    const availability = courts.map(court => {
      const sportType = court.sport_type.toLowerCase();
      const durations = DURATIONS[sportType] || { default: 60, fallback: null };
      const courtBookings = bookingsByCourtId[court.id] || [];

      const slots = [];
      const openMinutes = CLUB_OPEN * 60;
      const closeMinutes = CLUB_CLOSE * 60;

      // Genera tutti gli slot possibili (ogni 30 minuti)
      for (let startMin = openMinutes; startMin < closeMinutes; startMin += 30) {
        const defaultEndMin = startMin + durations.default;
        const fallbackEndMin = durations.fallback ? startMin + durations.fallback : null;

        // Verifica se lo slot default è disponibile
        const defaultAvailable = defaultEndMin <= closeMinutes &&
          !courtBookings.some(b => (startMin < b.end && defaultEndMin > b.start));

        // Verifica se lo slot fallback è disponibile (solo per padel)
        const fallbackAvailable = fallbackEndMin && fallbackEndMin <= closeMinutes &&
          !courtBookings.some(b => (startMin < b.end && fallbackEndMin > b.start));

        if (defaultAvailable) {
          slots.push({
            start_time: `${String(Math.floor(startMin / 60)).padStart(2, '0')}:${String(startMin % 60).padStart(2, '0')}`,
            end_time: `${String(Math.floor(defaultEndMin / 60)).padStart(2, '0')}:${String(defaultEndMin % 60).padStart(2, '0')}`,
            duration_minutes: durations.default,
            is_fallback: false
          });
        } else if (fallbackAvailable) {
          // Solo per padel: offri 60min se 90min non disponibile
          slots.push({
            start_time: `${String(Math.floor(startMin / 60)).padStart(2, '0')}:${String(startMin % 60).padStart(2, '0')}`,
            end_time: `${String(Math.floor(fallbackEndMin / 60)).padStart(2, '0')}:${String(fallbackEndMin % 60).padStart(2, '0')}`,
            duration_minutes: durations.fallback,
            is_fallback: true,
            note: 'Solo 1 ora disponibile'
          });
        }
      }

      return {
        court_id: court.id,
        court_name: court.name,
        sport_type: court.sport_type,
        default_duration: durations.default,
        slots: slots
      };
    });

    res.json({
      success: true,
      date,
      club_hours: { open: '08:00', close: '22:00' },
      courts: availability
    });

  } catch (error) {
    console.error('Error fetching availability:', error);
    res.status(500).json({ error: 'Errore nel calcolo disponibilità' });
  }
});

// GET /api/courts/with-cameras - Lista campi con telecamera associata
app.get('/api/courts/with-cameras', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, sport_type, camera_id, has_video_recording
       FROM courts WHERE is_active = true ORDER BY name`
    );
    res.json({ success: true, courts: result.rows });
  } catch (error) {
    console.error('Error fetching courts with cameras:', error);
    res.status(500).json({ error: 'Errore nel recupero dei campi' });
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

    // Prendi prenotazioni esistenti per quella data e campo
    const bookingsResult = await pool.query(
      `SELECT start_time, end_time FROM bookings
       WHERE court_id = $1 AND booking_date = $2 AND status NOT IN ('cancelled')`,
      [court_id, date]
    );

    const existingBookings = bookingsResult.rows;

    // Genera slot ogni 30 minuti (base fissa)
    const slots = [];
    const slotInterval = 30; // Slot ogni 30 minuti
    let currentTime = new Date(`2000-01-01T${openHours.open_time}`);
    const closeTime = new Date(`2000-01-01T${openHours.close_time}`);

    while (currentTime < closeTime) {
      const slotStart = currentTime.toTimeString().slice(0, 5);

      // Verifica se questo slot di partenza è già occupato
      const isBooked = existingBookings.some(b => {
        const bookStart = b.start_time.slice(0, 5);
        const bookEnd = b.end_time.slice(0, 5);
        // Lo slot è occupato se cade dentro una prenotazione esistente
        return slotStart >= bookStart && slotStart < bookEnd;
      });

      slots.push({
        start_time: slotStart,
        is_available: !isBooked
      });

      // Prossimo slot (ogni 30 minuti)
      currentTime = new Date(currentTime.getTime() + slotInterval * 60000);
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
    const { date, court_id, status, from_date, to_date, sport_type } = req.query;

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
    if (sport_type) {
      params.push(sport_type);
      query += ' AND c.sport_type = $' + params.length;
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
      notes, auto_confirm, players
    } = req.body;

    // Se richiesta senza auth, forza sempre pending (prenotazione utente)
    const isAuthenticated = req.headers.authorization?.startsWith('Basic ');
    const canAutoConfirm = isAuthenticated && auto_confirm;

    // Estrai nomi giocatori
    const playerNames = players && Array.isArray(players)
      ? players.map(p => p.player_name || p.name).filter(n => n)
      : [customer_name];
    
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
    
    // Determina stato iniziale (solo admin può auto-confermare)
    const status = canAutoConfirm ? 'confirmed' : 'pending';
    
    // Crea prenotazione con player_names
    const bookingResult = await pool.query(
      `INSERT INTO bookings (court_id, booking_date, start_time, end_time, duration_minutes,
         customer_name, customer_email, customer_phone, num_players,
         total_price, price_per_player, status, notes, player_names)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *`,
      [court_id, booking_date, start_time, end_time, duration_minutes,
       customer_name, customer_email, customer_phone, num_players || 4,
       total_price, price_per_player, status, notes, playerNames]
    );

    const booking = bookingResult.rows[0];

    // Se auto_confirm (solo per admin auth), crea subito il match
    if (canAutoConfirm && court.has_video_recording) {
      const matchResult = await createMatchFromBooking(booking, court, playerNames);
      if (matchResult) {
        booking.match_id = matchResult.id;
        booking.match_booking_code = matchResult.booking_code;
        booking.match_password = matchResult.access_password;
      }
    }
    
    res.status(201).json({ success: true, booking: booking });
  } catch (error) {
    console.error('Error creating booking:', error);
    res.status(500).json({ error: 'Errore nella creazione della prenotazione' });
  }
});

// Helper: Crea match da prenotazione
async function createMatchFromBooking(booking, court, playerNames = null) {
  try {
    const bookingCode = generateBookingCode();
    const password = generatePassword();

    // Usa player_names passati o estrai da booking
    const players = playerNames || booking.player_names || [booking.customer_name];

    // Calcola datetime partita - gestisce sia Date che stringa
    let bookingDateStr;
    if (booking.booking_date instanceof Date) {
      // Usa getFullYear/Month/Date per evitare problemi timezone
      const d = booking.booking_date;
      bookingDateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    } else if (typeof booking.booking_date === 'string') {
      bookingDateStr = booking.booking_date.split('T')[0];
    } else {
      const d = new Date(booking.booking_date);
      bookingDateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    }
    // Usa start_time (formato HH:MM o HH:MM:SS)
    const startTime = booking.start_time.substring(0, 5);
    // Crea timestamp come stringa per PostgreSQL (evita problemi timezone)
    const matchDatetime = `${bookingDateStr} ${startTime}:00`;

    const matchResult = await pool.query(
      `INSERT INTO matches (booking_code, access_password, sport_type, match_date,
         location, player_ids, player_names, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true) RETURNING *`,
      [bookingCode, password, court.sport_type, matchDatetime,
       court.name, players, players]
    );

    const match = matchResult.rows[0];

    // Aggiorna booking con match_id
    await pool.query(
      'UPDATE bookings SET match_id = $1 WHERE id = $2',
      [match.id, booking.id]
    );

    console.log(`✅ Match creato per booking ${booking.id}: ${bookingCode} - Password: ${password} - Giocatori: ${players.join(', ')}`);
    return match;
  } catch (error) {
    console.error('Error creating match from booking:', error);
    return null;
  }
}

// GET /api/bookings/for-video-download - Prenotazioni da scaricare video
// IMPORTANTE: Questa route deve essere PRIMA di /api/bookings/:id per evitare conflitti
app.get('/api/bookings/for-video-download', async (req, res) => {
  try {
    const { date, court_id } = req.query;

    if (!date) {
      return res.status(400).json({ error: 'Data obbligatoria' });
    }

    let query = `
      SELECT b.id as booking_id, b.booking_date, b.start_time, b.end_time, b.duration_minutes,
             b.match_id, b.customer_name,
             c.id as court_id, c.name as court_name, c.sport_type, c.camera_id,
             m.id as match_uuid, m.booking_code,
             (SELECT COUNT(*) FROM videos v WHERE v.match_id = m.id) as video_count
      FROM bookings b
      JOIN courts c ON b.court_id = c.id
      LEFT JOIN matches m ON b.match_id = m.id
      WHERE b.booking_date = $1
        AND b.status = 'confirmed'
        AND c.camera_id IS NOT NULL
        AND c.has_video_recording = true
    `;
    const params = [date];

    if (court_id) {
      params.push(court_id);
      query += ` AND c.id = $${params.length}`;
    }

    query += ` ORDER BY b.start_time`;

    const result = await pool.query(query, params);

    res.json({
      success: true,
      count: result.rows.length,
      bookings: result.rows.map(b => ({
        booking_id: b.booking_id,
        booking_date: b.booking_date,
        start_time: b.start_time,
        end_time: b.end_time,
        duration_minutes: b.duration_minutes,
        customer_name: b.customer_name,
        court_id: b.court_id,
        court_name: b.court_name,
        sport_type: b.sport_type,
        camera_id: b.camera_id,
        match_id: b.match_uuid,
        booking_code: b.booking_code,
        video_count: parseInt(b.video_count) || 0,
        has_video: parseInt(b.video_count) > 0
      }))
    });
  } catch (error) {
    console.error('Error fetching bookings for video:', error);
    res.status(500).json({ error: 'Errore nel recupero prenotazioni' });
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
    const { payment_status, payment_method, player_names } = req.body;

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

    // Priorità: 1) player_names dal DB, 2) player_names dalla request, 3) customer_name come fallback
    const players = (booking.player_names && booking.player_names.length > 0)
      ? booking.player_names
      : (player_names && player_names.length > 0 ? player_names : [booking.customer_name]);

    // Crea match se il campo ha registrazione video
    let match = null;
    if (booking.has_video_recording && !booking.match_id) {
      match = await createMatchFromBooking(booking, {
        name: booking.court_name,
        sport_type: booking.sport_type
      }, players);
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
app.delete("/api/bookings/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query("DELETE FROM bookings WHERE id = $1 RETURNING *", [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Prenotazione non trovata" });
    }
    res.json({ success: true, message: "Prenotazione eliminata" });
  } catch (error) {
    console.error("Error deleting booking:", error);
    res.status(500).json({ error: "Errore eliminazione prenotazione" });
  }
});

// PUT /api/bookings/:id - Aggiorna prenotazione
app.put('/api/bookings/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { court_id, booking_date, start_time, end_time, customer_name, customer_email, customer_phone, num_players, notes, payment_status, players } = req.body;

    // Estrai player_names da players
    const playerNames = players && Array.isArray(players)
      ? players.map(p => p.player_name || p.name).filter(n => n)
      : null;

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
       player_names = COALESCE($12, player_names),
       updated_at = CURRENT_TIMESTAMP
       WHERE id = $13 RETURNING *`,
      [court_id, booking_date, start_time, end_time, duration_minutes, customer_name, customer_email, customer_phone, num_players, notes, payment_status, playerNames, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Prenotazione non trovata' });
    }

    const updatedBooking = result.rows[0];

    // Se la prenotazione ha un match associato, aggiorna anche il match
    if (updatedBooking.match_id) {
      try {
        // Usa player_names dal booking aggiornato
        const bookingPlayerNames = updatedBooking.player_names;

        // Calcola match_date dal booking aggiornato
        const bDate = updatedBooking.booking_date;
        const sTime = updatedBooking.start_time;
        let bookingDateStr;
        if (bDate instanceof Date) {
          bookingDateStr = `${bDate.getFullYear()}-${String(bDate.getMonth()+1).padStart(2,'0')}-${String(bDate.getDate()).padStart(2,'0')}`;
        } else {
          bookingDateStr = bDate.toString().split('T')[0];
        }
        const startTimeStr = sTime.toString().substring(0, 5);
        const matchDatetime = `${bookingDateStr} ${startTimeStr}:00`;

        // Aggiorna sempre il match con i dati del booking
        await pool.query(
          `UPDATE matches SET player_names = $1, player_ids = $2, match_date = $3 WHERE id = $4`,
          [bookingPlayerNames, bookingPlayerNames, matchDatetime, updatedBooking.match_id]
        );
        console.log(`✅ Match ${updatedBooking.match_id} aggiornato - Giocatori: ${bookingPlayerNames?.join(', ') || 'N/A'}`);
      } catch (matchError) {
        console.error('Error updating associated match:', matchError);
      }
    }

    res.json({ success: true, booking: updatedBooking });
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

// ==================== SYNOLOGY SURVEILLANCE ENDPOINTS ====================

const SynologyService = require('./synology_service');

// POST /api/synology/test-connection - Test connection to Synology
app.post('/api/synology/test-connection', async (req, res) => {
  try {
    const { host, port, user, pass } = req.body;

    if (!host || !port || !user || !pass) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    const synology = new SynologyService(host, port, user, pass);
    const result = await synology.testConnection();

    res.json(result);
  } catch (error) {
    console.error('Synology test connection error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// POST /api/synology/download-recording-direct - Download recording using direct file path
app.post('/api/synology/download-recording-direct', async (req, res) => {
  try {
    const { recordingData, matchId, compress } = req.body;

    if (!recordingData || !matchId) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    // Verify match exists
    const matchResult = await pool.query('SELECT * FROM matches WHERE id = $1', [matchId]);
    if (matchResult.rows.length === 0) {
      return res.status(404).json({ error: 'Match not found' });
    }

    // Build file paths
    const sourceFilePath = `${recordingData.folder}/${recordingData.path}`;
    // Extract just the filename without subdirectories
    const pathParts = recordingData.path.split('/');
    const filename = pathParts[pathParts.length - 1]; // Get last part (filename only)
    const destFilePath = path.join(LOCAL_STORAGE_PATH, filename);

    console.log(`Downloading recording from Surveillance Station API and saving to ${destFilePath}...`);

    // Ensure destination directory exists
    await fs.mkdir(LOCAL_STORAGE_PATH, { recursive: true });

    // Download file via Synology Surveillance Station API
    const synologyConfig = {
      host: '192.168.1.69',
      port: '5000',
      username: 'admin',
      password: 'Druido#00'
    };

    const synology = new SynologyService(
      synologyConfig.host,
      synologyConfig.port,
      synologyConfig.username,
      synologyConfig.password
    );

    // Login to Surveillance Station
    await synology.login();

    // Download using eventId
    const eventId = recordingData.id || recordingData.eventId;
    const downloadUrl = `${synology.baseUrl}/webapi/entry.cgi?` +
      `api=SYNO.SurveillanceStation.Recording&` +
      `version=5&` +
      `method=Download&` +
      `eventId=${eventId}&` +
      `_sid=${synology.sid}`;

    console.log(`[Download] URL: ${downloadUrl}`);

    // Download file using axios stream and save with fs.writeFile
    const response = await axios({
      method: 'GET',
      url: downloadUrl,
      responseType: 'arraybuffer',
      httpsAgent: new (require('https').Agent)({
        rejectUnauthorized: false
      }),
      timeout: 300000 // 5 minutes timeout for large files
    });

    // Determine final file path based on compression option
    let finalFilePath = destFilePath;
    let tempFilePath = null;

    if (compress) {
      // If compressing, save to temp file first
      tempFilePath = destFilePath.replace('.mp4', '_temp.mp4');
      await fs.writeFile(tempFilePath, Buffer.from(response.data));
      console.log(`✅ File downloaded to temporary location`);
    } else {
      // If not compressing, save directly to final location
      await fs.writeFile(destFilePath, Buffer.from(response.data));
      console.log(`✅ File downloaded and saved successfully`);
    }

    await synology.logout();

    // Compress video if requested
    if (compress && tempFilePath) {
      console.log(`🔄 Starting video compression (H.265 720p)...`);
      try {
        await compressVideo(tempFilePath, destFilePath);
        console.log(`✅ Video compression completed`);

        // Delete temporary uncompressed file
        await fs.unlink(tempFilePath);
        console.log(`🗑️ Temporary file deleted`);
      } catch (compressionError) {
        console.error('Compression failed:', compressionError);
        // If compression fails, use the original file
        await fs.rename(tempFilePath, destFilePath);
        console.log(`⚠️ Using original uncompressed file due to compression error`);
      }
    }

    // Get file stats from final file
    const stats = await fs.stat(finalFilePath);
    const fileSizeBytes = stats.size;

    // Calculate duration from timestamps
    const durationSeconds = recordingData.stopTime && recordingData.startTime
      ? (recordingData.stopTime - recordingData.startTime)
      : 0;

    // Insert video record into database
    const videoResult = await pool.query(
      `INSERT INTO videos
        (match_id, title, file_path, duration_seconds, file_size_bytes, recorded_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        matchId,
        recordingData.camera_name || `Recording ${recordingData.id}`,
        destFilePath,
        durationSeconds,
        fileSizeBytes,
        new Date(recordingData.startTime * 1000)
      ]
    );

    const message = compress
      ? `Recording compressed and saved: ${filename} (${(fileSizeBytes / 1024 / 1024).toFixed(2)} MB)`
      : `Recording saved: ${filename} (${(fileSizeBytes / 1024 / 1024).toFixed(2)} MB)`;

    console.log(`✅ ${message}`);

    res.json({
      success: true,
      message: compress ? 'Recording compressed and saved successfully' : 'Recording copied successfully',
      filename,
      fileSize: fileSizeBytes,
      duration: durationSeconds,
      matchId,
      videoId: videoResult.rows[0].id,
      compressed: compress || false
    });

  } catch (error) {
    console.error('Download recording direct error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// POST /api/synology/download-recording - Download recording and save to NAS (OLD METHOD - DEPRECATED)
app.post('/api/synology/download-recording', async (req, res) => {
  try {
    const { host, port, user, pass, cameraId, date, startTime, endTime, matchId } = req.body;

    // Validate inputs
    if (!host || !port || !user || !pass || !cameraId || !date || !startTime || !endTime || !matchId) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    // Build datetime strings
    const startDateTime = `${date}T${startTime}`;
    const endDateTime = `${date}T${endTime}`;

    // Validate duration (max 90 minutes)
    const start = new Date(startDateTime);
    const end = new Date(endDateTime);
    const durationMinutes = (end - start) / 1000 / 60;

    if (durationMinutes > 90) {
      return res.status(400).json({ error: 'Duration exceeds 90 minutes limit' });
    }

    if (durationMinutes <= 0) {
      return res.status(400).json({ error: 'End time must be after start time' });
    }

    // Verify match exists
    const matchResult = await pool.query('SELECT * FROM matches WHERE id = $1', [matchId]);
    if (matchResult.rows.length === 0) {
      return res.status(404).json({ error: 'Match not found' });
    }

    // Create Synology service instance
    const synology = new SynologyService(host, port, user, pass);
    await synology.login();

    // Generate filename
    const timestamp = new Date().getTime();
    const filename = `recording_${date}_${startTime.replace(':', '')}_${endTime.replace(':', '')}_${timestamp}.mp4`;
    const videoPath = path.join(LOCAL_STORAGE_PATH, filename);

    // Ensure directory exists
    await fs.mkdir(LOCAL_STORAGE_PATH, { recursive: true });

    // Get recording file info from Synology
    console.log(`Getting recording info from camera ${cameraId}...`);
    const recordingInfo = await synology.downloadRecording(cameraId, startDateTime, endDateTime);

    console.log(`Found recording file: ${recordingInfo.filePath}`);

    // Copy file directly from NAS filesystem
    // The filePath is something like: /volume1/surveillance/AXIS - M3044-V/20251124PM/...mp4
    // We need to copy it to LOCAL_STORAGE_PATH
    const { exec } = require('child_process');
    const util = require('util');
    const execPromise = util.promisify(exec);

    console.log(`Copying file from ${recordingInfo.filePath} to ${videoPath}...`);

    try {
      // Use cp command to copy the file
      await execPromise(`cp "${recordingInfo.filePath}" "${videoPath}"`);
      console.log(`✅ File copied successfully`);
    } catch (copyError) {
      console.error(`Failed to copy file directly, trying alternative method:`, copyError.message);

      // If direct copy fails, try via SSH to NAS
      try {
        await execPromise(`sshpass -p 'Druido#00' scp admin@192.168.1.69:"${recordingInfo.filePath}" "${videoPath}"`);
        console.log(`✅ File copied via SCP`);
      } catch (scpError) {
        throw new Error(`Failed to copy file: ${scpError.message}`);
      }
    }

    // Get file stats
    const stats = await fs.stat(videoPath);
    const fileSizeBytes = stats.size;

    // Calculate duration in seconds
    const durationSeconds = Math.floor(durationMinutes * 60);

    // Insert video record into database
    const videoResult = await pool.query(
      `INSERT INTO videos
        (match_id, title, file_path, duration_seconds, file_size_bytes, recorded_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        matchId,
        `Recording ${date} ${startTime}-${endTime}`,
        videoPath,
        durationSeconds,
        fileSizeBytes,
        startDateTime
      ]
    );

    // Logout from Synology
    await synology.logout();

    console.log(`✅ Recording downloaded: ${filename} (${(fileSizeBytes / 1024 / 1024).toFixed(2)} MB)`);

    res.json({
      success: true,
      message: 'Recording downloaded successfully',
      filename,
      fileSize: fileSizeBytes,
      duration: durationSeconds,
      matchId,
      videoId: videoResult.rows[0].id
    });

  } catch (error) {
    console.error('Download recording error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// POST /api/synology/list-cameras - List all cameras
app.post('/api/synology/list-cameras', async (req, res) => {
  try {
    const { host, port, user, pass } = req.body;

    if (!host || !port || !user || !pass) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    const synology = new SynologyService(host, port, user, pass);
    await synology.login();

    const cameras = await synology.getCameraList();

    await synology.logout();

    res.json({
      success: true,
      count: cameras.length,
      cameras: cameras.map(cam => ({
        id: cam.id,
        name: cam.newName || cam.name || cam.cameraName || `Camera ${cam.id}`,
        model: cam.model || cam.detailInfo?.model || 'N/A',
        vendor: cam.vendor || cam.detailInfo?.vendor || 'N/A',
        enabled: cam.enabled,
        status: cam.status
      }))
    });

  } catch (error) {
    console.error('List cameras error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// POST /api/synology/list-recordings - List available recordings
app.post('/api/synology/list-recordings', async (req, res) => {
  try {
    const { host, port, user, pass, cameraId, fromDate, toDate } = req.body;

    if (!host || !port || !user || !pass || !cameraId) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    // Default to last 24 hours if no dates provided
    let startDateTime, endDateTime;
    if (fromDate && toDate) {
      startDateTime = fromDate;
      endDateTime = toDate;
    } else {
      const now = new Date();
      endDateTime = now.toISOString();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      startDateTime = yesterday.toISOString();
    }

    // Create Synology service instance
    const synology = new SynologyService(host, port, user, pass);
    await synology.login();

    // List recordings
    const recordings = await synology.listRecordings(cameraId, startDateTime, endDateTime);

    // Logout
    await synology.logout();

    res.json({
      success: true,
      count: recordings.length,
      recordings: recordings.map(rec => {
        // Handle different timestamp formats
        const startTime = rec.start_time || rec.startTime || rec.StartTime;
        const endTime = rec.end_time || rec.endTime || rec.EndTime || rec.stopTime || rec.stop_time;

        return {
          id: rec.id,
          cameraId: rec.camera_id || rec.cameraId,
          startTime: startTime ? new Date(parseInt(startTime) * 1000).toISOString() : null,
          endTime: endTime ? new Date(parseInt(endTime) * 1000).toISOString() : null,
          duration: startTime && endTime ? (parseInt(endTime) - parseInt(startTime)) : 0,
          type: rec.type || rec.eventType,
          locked: rec.locked || false,
          recording: rec.recording || false,
          raw: rec // Include raw data for debugging
        };
      })
    });

  } catch (error) {
    console.error('List recordings error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ==================== APP CONFIG API ====================

// GET /api/config - Leggi configurazione
app.get('/api/config', async (req, res) => {
  try {
    const result = await pool.query('SELECT key, value, description FROM app_config ORDER BY key');
    const config = {};
    result.rows.forEach(row => {
      config[row.key] = { value: row.value, description: row.description };
    });
    res.json({ success: true, config });
  } catch (error) {
    console.error('Error fetching config:', error);
    res.status(500).json({ error: 'Errore nel recupero configurazione' });
  }
});

// PUT /api/config/:key - Aggiorna configurazione
app.put('/api/config/:key', async (req, res) => {
  try {
    const { key } = req.params;
    const { value } = req.body;

    const result = await pool.query(
      `UPDATE app_config SET value = $1, updated_at = CURRENT_TIMESTAMP WHERE key = $2 RETURNING *`,
      [value, key]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Configurazione non trovata' });
    }
    res.json({ success: true, config: result.rows[0] });
  } catch (error) {
    console.error('Error updating config:', error);
    res.status(500).json({ error: 'Errore nell aggiornamento configurazione' });
  }
});

// ==================== AUTO VIDEO DOWNLOAD API ====================

// POST /api/videos/auto-download - Download automatico video per booking
app.post('/api/videos/auto-download', async (req, res) => {
  try {
    const { booking_id } = req.body;

    // 1. Recupera info booking e match
    const bookingResult = await pool.query(`
      SELECT b.id, b.booking_date, b.start_time, b.match_id,
             c.camera_id, c.name as court_name,
             m.id as match_uuid
      FROM bookings b
      JOIN courts c ON b.court_id = c.id
      LEFT JOIN matches m ON b.match_id = m.id
      WHERE b.id = $1
    `, [booking_id]);

    if (bookingResult.rows.length === 0) {
      return res.status(404).json({ error: 'Prenotazione non trovata' });
    }

    const booking = bookingResult.rows[0];

    if (!booking.camera_id) {
      return res.status(400).json({ error: 'Nessuna telecamera associata al campo' });
    }

    // Se non c'è match_id, crealo automaticamente
    if (!booking.match_id) {
      console.log(`Auto-creating match for booking ${booking_id}`);
      // Recupera info complete del booking e court
      const fullBookingRes = await pool.query(`
        SELECT b.*, c.sport_type, c.name as court_name
        FROM bookings b
        JOIN courts c ON b.court_id = c.id
        WHERE b.id = $1
      `, [booking_id]);

      const fullBooking = fullBookingRes.rows[0];
      const court = { sport_type: fullBooking.sport_type, name: fullBooking.court_name };

      const newMatch = await createMatchFromBooking(fullBooking, court);
      if (!newMatch) {
        return res.status(500).json({ error: 'Impossibile creare match automatico' });
      }
      booking.match_uuid = newMatch.id;
      booking.match_id = newMatch.id;
    }

    // 2. Recupera configurazione
    const configResult = await pool.query(`SELECT key, value FROM app_config WHERE key IN ('video_segment_minutes', 'synology_host', 'synology_port', 'synology_user', 'synology_pass')`);
    const config = {};
    configResult.rows.forEach(r => config[r.key] = r.value);

    // 3. Calcola range temporale per cercare la registrazione
    // booking_date è un Date object da PostgreSQL, start_time è una stringa HH:MM:SS
    const bookingDate = booking.booking_date instanceof Date
      ? booking.booking_date.toISOString().split('T')[0]
      : booking.booking_date;
    const startTime = booking.start_time;

    // Costruisci datetime di inizio prenotazione CON timezone Europa/Roma
    // Importante: le prenotazioni sono in ora locale italiana, non UTC
    console.log(`[AutoDownload] Building datetime from date: ${bookingDate}, time: ${startTime}`);
    // Aggiungi il timezone offset per l'Italia (+01:00 in inverno, +02:00 in estate)
    // Usiamo una data fissa per determinare se siamo in ora legale o solare
    const testDate = new Date(`${bookingDate}T12:00:00`);
    const isWinterTime = testDate.getMonth() < 2 || testDate.getMonth() > 9 ||
                         (testDate.getMonth() === 2 && testDate.getDate() < 25) ||
                         (testDate.getMonth() === 9 && testDate.getDate() > 25);
    const tzOffset = isWinterTime ? '+01:00' : '+02:00';
    const startDateTime = new Date(`${bookingDate}T${startTime}${tzOffset}`);
    console.log(`[AutoDownload] Start datetime (with TZ ${tzOffset}): ${startDateTime.toISOString()}`);
    // Cerca registrazioni in un range di +/- 10 minuti dall'inizio
    const searchStart = new Date(startDateTime.getTime() - 10 * 60 * 1000);
    const searchEnd = new Date(startDateTime.getTime() + 10 * 60 * 1000);

    // 4. Connetti a Synology e cerca registrazioni
    const synology = new SynologyService(
      config.synology_host || '192.168.1.69',
      config.synology_port || '5000',
      config.synology_user || 'admin',
      config.synology_pass || 'Druido#00'
    );

    await synology.login();
    const recordings = await synology.listRecordings(
      booking.camera_id,
      searchStart.toISOString(),
      searchEnd.toISOString()
    );

    if (recordings.length === 0) {
      await synology.logout();
      return res.status(404).json({
        error: 'Nessuna registrazione trovata',
        searchRange: { start: searchStart.toISOString(), end: searchEnd.toISOString() },
        cameraId: booking.camera_id
      });
    }

    // 5. Trova la registrazione più vicina all'orario di inizio
    let closestRecording = recordings[0];
    let minDiff = Infinity;

    console.log(`[AutoDownload] Looking for recording closest to: ${startDateTime.toISOString()} (${startDateTime.getTime()})`);
    recordings.forEach(rec => {
      const recStartTs = rec.start_time || rec.startTime;
      const recStart = new Date(recStartTs * 1000);
      const diff = Math.abs(recStart.getTime() - startDateTime.getTime());
      console.log(`[AutoDownload] Recording ${rec.id}: starts ${recStart.toISOString()}, diff: ${Math.round(diff/1000/60)} min`);
      if (diff < minDiff) {
        minDiff = diff;
        closestRecording = rec;
      }
    });
    console.log(`[AutoDownload] Selected recording ${closestRecording.id} with diff ${Math.round(minDiff/1000/60)} min`);

    // 6. Scarica il video (senza compressione)
    const recStartTime = closestRecording.start_time || closestRecording.startTime;
    const recEndTime = closestRecording.end_time || closestRecording.endTime || closestRecording.stop_time || closestRecording.stopTime;

    // Genera nome file
    const timestamp = new Date(recStartTime * 1000).toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `${booking.court_name.replace(/\s+/g, '_')}_${timestamp}.mp4`;
    const filePath = path.join(LOCAL_STORAGE_PATH, filename);

    // Scarica il video usando l'API Surveillance Station Recording.Download
    const eventId = closestRecording.id || closestRecording.eventId;
    console.log(`[AutoDownload] Downloading recording eventId: ${eventId}`);
    console.log(`[AutoDownload] Destination: ${filePath}`);

    try {
      const downloadInfo = await synology.getRecordingUrlByEventId(eventId);
      console.log(`[AutoDownload] Download URL obtained`);

      // Scarica il file usando axios
      const downloadResponse = await axios({
        method: 'GET',
        url: downloadInfo.url,
        responseType: 'stream',
        timeout: 300000, // 5 minuti timeout
        httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false })
      });

      // Salva il file
      const writeStream = fsSync.createWriteStream(filePath);
      downloadResponse.data.pipe(writeStream);

      await new Promise((resolve, reject) => {
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
      });

      console.log(`[AutoDownload] File downloaded to: ${filePath}`);
      await synology.logout();
    } catch (downloadError) {
      await synology.logout();
      console.error(`[AutoDownload] Download error:`, downloadError.message);
      return res.status(500).json({ error: `Errore download video: ${downloadError.message}` });
    }

    if (!fsSync.existsSync(filePath)) {
      return res.status(500).json({ error: `File non trovato dopo il download: ${filePath}` });
    }

    const finalPath = filePath;
    const finalFilename = filename;
    const fs = require('fs');

    // 7. Crea record video nel database
    const duration = recEndTime && recStartTime ? (parseInt(recEndTime) - parseInt(recStartTime)) : 300;
    const fileStats = fs.statSync(finalPath);

    const videoResult = await pool.query(`
      INSERT INTO videos (match_id, title, file_path, duration_seconds, file_size_bytes, recorded_at, is_highlight)
      VALUES ($1, $2, $3, $4, $5, $6, false)
      RETURNING id
    `, [
      booking.match_uuid,
      `${booking.court_name} - ${startTime}`,
      finalPath,
      duration,
      fileStats.size,
      new Date(recStartTime * 1000)
    ]);

    res.json({
      success: true,
      message: 'Video scaricato e associato',
      video_id: videoResult.rows[0].id,
      filename: finalFilename,
      duration: duration,
      file_size: fileStats.size,
      recording_start: new Date(recStartTime * 1000).toISOString()
    });

  } catch (error) {
    console.error('Auto download error:', error);
    res.status(500).json({ error: error.message });
  }
});
