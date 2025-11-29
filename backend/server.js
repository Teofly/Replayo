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
const { setupAuthRoutes } = require('./auth');

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

// Serve static files from public folder (login page, etc.)
app.use(express.static(path.join(__dirname, 'public')));

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
    '/club/info',              // Public: informazioni club
    '/auth/register',          // Public: registrazione utenti
    '/auth/login',             // Public: login utenti
    '/auth/verify-email',      // Public: verifica email
    '/auth/refresh',           // Public: refresh token
    '/auth/resend-verification', // Public: reinvia email verifica
    '/auth/me',                // Public: profilo utente (usa JWT, non Basic)
    '/auth/my-matches',        // Public: partite utente (usa JWT, non Basic)
    '/auth/logout',            // Public: logout utente
    '/auth/recover-password',  // Public: recupero password
    '/auth/reset-password',     // Public: reset password con token
    '/auth/verify-reset-token', // Public: verifica token reset
    '/bookings/my-bookings',    // Public: prenotazioni utente (usa JWT, non Basic)
    '/public/config',           // Public: configurazioni app (no auth)
    '/notifications',           // Public: notifiche utente (usa JWT, non Basic)
    '/user/stats',              // Public: statistiche utente (usa JWT, non Basic)
    '/devices/register',        // Public: ESP32 registrazione
    '/devices/heartbeat',       // Public: ESP32 heartbeat
    '/devices/marker',          // Public: ESP32 marker pulsante
    '/firmware/latest',         // Public: ESP32 check firmware OTA
    '/firmware/download/',      // Public: ESP32 download firmware OTA
  ];
  // Also allow video streaming, download and view endpoints
  // And POST /bookings for user booking requests (will be pending status)
  // And PUT /bookings/:id/user-cancel for user cancellation (uses JWT)
  if (publicPaths.some(p => req.path.startsWith(p)) ||
      req.path.match(/\/videos\/[^/]+\/stream/) ||
      req.path.match(/\/videos\/[^/]+\/download/) ||
      req.path.match(/\/videos\/[^/]+\/view/) ||
      (req.method === 'POST' && req.path === '/bookings') ||
      (req.method === 'PUT' && req.path.match(/\/bookings\/[^/]+\/user-cancel/))) {
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
    // Carica configurazioni all'avvio
    loadAppConfig();
  }
});

// ==================== APP CONFIG HELPER ====================
// Cache configurazioni in memoria
let appConfigCache = {};

// Carica tutte le configurazioni dal database
async function loadAppConfig() {
  try {
    const result = await pool.query('SELECT key, value, type FROM app_config');
    appConfigCache = {};
    result.rows.forEach(row => {
      // Converti il valore in base al tipo
      let value = row.value;
      if (row.type === 'number') {
        value = parseFloat(row.value) || 0;
      } else if (row.type === 'boolean') {
        value = row.value === 'true';
      }
      appConfigCache[row.key] = value;
    });
    console.log(`⚙️  Caricate ${Object.keys(appConfigCache).length} configurazioni`);
  } catch (error) {
    console.error('Errore caricamento configurazioni:', error.message);
  }
}

// Ottieni valore configurazione con default
function getConfig(key, defaultValue) {
  if (appConfigCache.hasOwnProperty(key)) {
    return appConfigCache[key];
  }
  return defaultValue;
}

// Aggiorna cache dopo modifica
async function updateConfigCache(key, value, type = 'text') {
  let parsedValue = value;
  if (type === 'number') {
    parsedValue = parseFloat(value) || 0;
  } else if (type === 'boolean') {
    parsedValue = value === 'true' || value === true;
  }
  appConfigCache[key] = parsedValue;
}

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

      const video = result.rows[0];

      // Check for pending highlight markers and process them automatically
      let highlightsGenerated = 0;
      try {
        const pendingMarkers = await pool.query(
          'SELECT * FROM highlight_markers WHERE match_id = $1 AND processed = false ORDER BY start_time',
          [matchId]
        );

        if (pendingMarkers.rows.length > 0) {
          console.log(`🎬 Found ${pendingMarkers.rows.length} pending highlight markers - auto-extracting...`);

          const sourceDir = path.dirname(filePath);
          const sourceBasename = path.basename(filePath, path.extname(filePath));
          const sourceExt = path.extname(filePath);

          const existingCount = await pool.query(
            'SELECT COUNT(*) FROM videos WHERE match_id = $1 AND is_highlight = true',
            [matchId]
          );
          let highlightIndex = parseInt(existingCount.rows[0].count) + 1;

          for (const marker of pendingMarkers.rows) {
            const outputFilename = `${sourceBasename}_HL${highlightIndex}${sourceExt}`;
            const outputFilePath = path.join(sourceDir, outputFilename);
            const duration = marker.end_time - marker.start_time;

            try {
              await new Promise((resolve, reject) => {
                ffmpeg(filePath)
                  .setStartTime(marker.start_time)
                  .setDuration(duration)
                  .outputOptions(['-c', 'copy'])
                  .output(outputFilePath)
                  .on('end', () => resolve())
                  .on('error', (err) => reject(err))
                  .run();
              });

              const hlStats = await fs.stat(outputFilePath);

              await pool.query(
                `INSERT INTO videos (match_id, title, file_path, duration_seconds, file_size_bytes, recorded_at, is_highlight)
                 VALUES ($1, $2, $3, $4, $5, NOW(), true)`,
                [matchId, `Highlight #${highlightIndex}`, outputFilePath, duration, hlStats.size]
              );

              await pool.query('UPDATE highlight_markers SET processed = true WHERE id = $1', [marker.id]);

              console.log(`✅ Highlight #${highlightIndex} estratto: ${outputFilename}`);
              highlightIndex++;
              highlightsGenerated++;
            } catch (hlError) {
              console.error(`❌ Errore estrazione highlight: ${hlError.message}`);
            }
          }
        }
      } catch (hlCheckError) {
        // Tabella highlight_markers potrebbe non esistere ancora
        console.log('Note: highlight_markers table not found or error checking markers');
      }

      res.json({
        success: true,
        message: highlightsGenerated > 0
          ? `Video associato con successo. ${highlightsGenerated} highlight(s) generati automaticamente!`
          : 'Video associato con successo',
        video: video,
        highlightsGenerated: highlightsGenerated
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

// ==================== HIGHLIGHTS EXTRACTION ====================

// POST /api/highlights/extract - Extract highlight clips from a video using FFmpeg
app.post('/api/highlights/extract', async (req, res) => {
    try {
        const { matchId, videoId, markers } = req.body;

        if (!matchId || !videoId || !markers || !Array.isArray(markers) || markers.length === 0) {
            return res.status(400).json({ error: 'Missing required parameters: matchId, videoId, markers[]' });
        }

        // Get source video info
        const videoResult = await pool.query('SELECT * FROM videos WHERE id = $1', [videoId]);
        if (videoResult.rows.length === 0) {
            return res.status(404).json({ error: 'Video not found' });
        }

        const sourceVideo = videoResult.rows[0];
        const sourceFilePath = sourceVideo.file_path;

        // Check if source file exists
        try {
            await fs.access(sourceFilePath);
        } catch (e) {
            return res.status(404).json({ error: `Source video file not found: ${sourceFilePath}` });
        }

        // Get directory of source video
        const sourceDir = path.dirname(sourceFilePath);
        const sourceBasename = path.basename(sourceFilePath, path.extname(sourceFilePath));
        const sourceExt = path.extname(sourceFilePath);

        // Count existing highlights for this match
        const existingCount = await pool.query(
            'SELECT COUNT(*) FROM videos WHERE match_id = $1 AND is_highlight = true',
            [matchId]
        );
        let highlightIndex = parseInt(existingCount.rows[0].count) + 1;

        const createdHighlights = [];

        // Process each marker
        for (const marker of markers) {
            const { startTime, endTime } = marker;

            if (typeof startTime !== 'number' || typeof endTime !== 'number' || endTime <= startTime) {
                console.warn(`Skipping invalid marker: start=${startTime}, end=${endTime}`);
                continue;
            }

            // Generate output filename
            const outputFilename = `${sourceBasename}_HL${highlightIndex}${sourceExt}`;
            const outputFilePath = path.join(sourceDir, outputFilename);

            // Format times for FFmpeg (HH:MM:SS.mmm)
            const startFormatted = formatSecondsToFFmpeg(startTime);
            const duration = endTime - startTime;

            console.log(`🎬 Extracting highlight #${highlightIndex}: ${startFormatted} (${duration}s) -> ${outputFilename}`);

            // Extract clip using FFmpeg
            await new Promise((resolve, reject) => {
                ffmpeg(sourceFilePath)
                    .setStartTime(startTime)
                    .setDuration(duration)
                    .outputOptions(['-c', 'copy']) // Copy streams without re-encoding (fast)
                    .output(outputFilePath)
                    .on('start', (cmd) => {
                        console.log(`FFmpeg command: ${cmd}`);
                    })
                    .on('end', () => {
                        console.log(`✅ Highlight extracted: ${outputFilename}`);
                        resolve();
                    })
                    .on('error', (err) => {
                        console.error(`❌ FFmpeg error: ${err.message}`);
                        reject(err);
                    })
                    .run();
            });

            // Get file size of created highlight
            const hlStats = await fs.stat(outputFilePath);

            // Insert highlight record into database
            const hlResult = await pool.query(
                `INSERT INTO videos (
                    match_id, title, file_path, duration_seconds,
                    file_size_bytes, recorded_at, is_highlight
                ) VALUES ($1, $2, $3, $4, $5, NOW(), true)
                RETURNING *`,
                [
                    matchId,
                    `Highlight #${highlightIndex}`,
                    outputFilePath,
                    duration,
                    hlStats.size
                ]
            );

            createdHighlights.push(hlResult.rows[0]);
            highlightIndex++;
        }

        console.log(`✅ ${createdHighlights.length} highlights created for match ${matchId}`);

        res.json({
            success: true,
            highlightsCreated: createdHighlights.length,
            highlights: createdHighlights
        });

    } catch (error) {
        console.error('Error extracting highlights:', error);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/highlights/markers/:matchId - Get saved markers for a match
app.get('/api/highlights/markers/:matchId', async (req, res) => {
    try {
        const { matchId } = req.params;

        const result = await pool.query(
            'SELECT * FROM highlight_markers WHERE match_id = $1 AND processed = false ORDER BY start_time',
            [matchId]
        );

        res.json({
            success: true,
            markers: result.rows.map(m => ({
                id: m.id,
                startTime: m.start_time,
                endTime: m.end_time,
                margin: m.margin,
                processed: m.processed
            }))
        });
    } catch (error) {
        console.error('Error getting markers:', error);
        // Se la tabella non esiste ancora, restituisci array vuoto
        res.json({ success: true, markers: [] });
    }
});

// POST /api/highlights/markers - Save a highlight marker for later extraction
app.post('/api/highlights/markers', async (req, res) => {
    try {
        const { matchId, startTime, endTime, margin } = req.body;

        if (!matchId || typeof startTime !== 'number' || typeof endTime !== 'number') {
            return res.status(400).json({ error: 'Missing required parameters' });
        }

        const result = await pool.query(
            `INSERT INTO highlight_markers (match_id, start_time, end_time, margin)
             VALUES ($1, $2, $3, $4) RETURNING *`,
            [matchId, startTime, endTime, margin || 2]
        );

        res.json({
            success: true,
            marker: result.rows[0]
        });
    } catch (error) {
        console.error('Error saving marker:', error);
        res.status(500).json({ error: error.message });
    }
});

// DELETE /api/highlights/markers/:markerId - Delete a highlight marker
app.delete('/api/highlights/markers/:markerId', async (req, res) => {
    try {
        const { markerId } = req.params;

        await pool.query('DELETE FROM highlight_markers WHERE id = $1', [markerId]);

        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting marker:', error);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/highlights/process-pending/:matchId - Process all pending markers for a match
app.post('/api/highlights/process-pending/:matchId', async (req, res) => {
    try {
        const { matchId } = req.params;
        const { videoId } = req.body;

        if (!videoId) {
            return res.status(400).json({ error: 'videoId is required' });
        }

        // Get pending markers
        const markersResult = await pool.query(
            'SELECT * FROM highlight_markers WHERE match_id = $1 AND processed = false ORDER BY start_time',
            [matchId]
        );

        if (markersResult.rows.length === 0) {
            return res.json({ success: true, message: 'No pending markers', highlightsCreated: 0 });
        }

        // Get source video
        const videoResult = await pool.query('SELECT * FROM videos WHERE id = $1', [videoId]);
        if (videoResult.rows.length === 0) {
            return res.status(404).json({ error: 'Video not found' });
        }

        const sourceVideo = videoResult.rows[0];
        const sourceFilePath = sourceVideo.file_path;

        try {
            await fs.access(sourceFilePath);
        } catch (e) {
            return res.status(404).json({ error: `Source video file not found` });
        }

        const sourceDir = path.dirname(sourceFilePath);
        const sourceBasename = path.basename(sourceFilePath, path.extname(sourceFilePath));
        const sourceExt = path.extname(sourceFilePath);

        const existingCount = await pool.query(
            'SELECT COUNT(*) FROM videos WHERE match_id = $1 AND is_highlight = true',
            [matchId]
        );
        let highlightIndex = parseInt(existingCount.rows[0].count) + 1;

        const createdHighlights = [];

        for (const marker of markersResult.rows) {
            const outputFilename = `${sourceBasename}_HL${highlightIndex}${sourceExt}`;
            const outputFilePath = path.join(sourceDir, outputFilename);
            const duration = marker.end_time - marker.start_time;

            console.log(`🎬 Auto-extracting highlight #${highlightIndex}: ${marker.start_time}s -> ${marker.end_time}s`);

            await new Promise((resolve, reject) => {
                ffmpeg(sourceFilePath)
                    .setStartTime(marker.start_time)
                    .setDuration(duration)
                    .outputOptions(['-c', 'copy'])
                    .output(outputFilePath)
                    .on('end', () => resolve())
                    .on('error', (err) => reject(err))
                    .run();
            });

            const hlStats = await fs.stat(outputFilePath);

            const hlResult = await pool.query(
                `INSERT INTO videos (match_id, title, file_path, duration_seconds, file_size_bytes, recorded_at, is_highlight)
                 VALUES ($1, $2, $3, $4, $5, NOW(), true) RETURNING *`,
                [matchId, `Highlight #${highlightIndex}`, outputFilePath, duration, hlStats.size]
            );

            // Mark marker as processed
            await pool.query('UPDATE highlight_markers SET processed = true WHERE id = $1', [marker.id]);

            createdHighlights.push(hlResult.rows[0]);
            highlightIndex++;
        }

        console.log(`✅ Auto-processed ${createdHighlights.length} pending markers for match ${matchId}`);

        res.json({
            success: true,
            highlightsCreated: createdHighlights.length,
            highlights: createdHighlights
        });

    } catch (error) {
        console.error('Error processing pending markers:', error);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/highlights/process-esp32/:bookingId - Processa button_markers ESP32 per una prenotazione
// Usa i margini configurati nel dispositivo
app.post('/api/highlights/process-esp32/:bookingId', async (req, res) => {
    try {
        const { bookingId } = req.params;

        // Trova la prenotazione e il video associato
        const bookingResult = await pool.query(`
            SELECT b.*, v.id as video_id, v.file_path, v.recorded_at as video_start_time
            FROM bookings b
            LEFT JOIN videos v ON v.match_id = b.id AND v.is_highlight = false
            WHERE b.id = $1
        `, [bookingId]);

        if (bookingResult.rows.length === 0) {
            return res.status(404).json({ error: 'Prenotazione non trovata' });
        }

        const booking = bookingResult.rows[0];

        if (!booking.video_id || !booking.file_path) {
            return res.status(400).json({ error: 'Nessun video associato a questa prenotazione' });
        }

        // Verifica che il file video esista
        try {
            await fs.access(booking.file_path);
        } catch (e) {
            return res.status(404).json({ error: 'File video non trovato sul server' });
        }

        // Trova i button_markers non processati per questa prenotazione
        const markersResult = await pool.query(`
            SELECT bm.*, d.margin_before, d.margin_after, d.device_name
            FROM button_markers bm
            JOIN esp32_devices d ON bm.device_id = d.device_id
            WHERE bm.booking_id = $1 AND bm.processed = false
            ORDER BY bm.marker_time ASC
        `, [bookingId]);

        if (markersResult.rows.length === 0) {
            return res.json({ success: true, message: 'Nessun marker da processare', highlightsCreated: 0 });
        }

        console.log(`🎮 Processando ${markersResult.rows.length} marker ESP32 per prenotazione ${bookingId}`);

        const sourceDir = path.dirname(booking.file_path);
        const sourceBasename = path.basename(booking.file_path, path.extname(booking.file_path));
        const sourceExt = path.extname(booking.file_path);

        // Conta highlight esistenti
        const existingCount = await pool.query(
            'SELECT COUNT(*) FROM videos WHERE match_id = $1 AND is_highlight = true',
            [bookingId]
        );
        let highlightIndex = parseInt(existingCount.rows[0].count) + 1;

        const createdHighlights = [];
        const videoStartTime = new Date(booking.video_start_time).getTime();

        for (const marker of markersResult.rows) {
            const markerTime = new Date(marker.marker_time).getTime();
            const marginBefore = marker.margin_before || 5;
            const marginAfter = marker.margin_after || 10;

            // Calcola offset nel video (secondi dall'inizio del video)
            const markerOffsetSec = (markerTime - videoStartTime) / 1000;

            // Calcola start e end time nel video
            let startTime = Math.max(0, markerOffsetSec - marginBefore);
            let endTime = markerOffsetSec + marginAfter;
            const duration = endTime - startTime;

            // Skip se il marker è fuori dal video
            if (startTime < 0 || duration <= 0) {
                console.warn(`⚠️ Marker ${marker.id} fuori range video, skip`);
                continue;
            }

            const outputFilename = `${sourceBasename}_HL${highlightIndex}${sourceExt}`;
            const outputFilePath = path.join(sourceDir, outputFilename);

            console.log(`🎬 ESP32 Highlight #${highlightIndex}: ${startTime.toFixed(1)}s -> ${endTime.toFixed(1)}s (${duration.toFixed(1)}s) [device: ${marker.device_name}]`);

            try {
                await new Promise((resolve, reject) => {
                    ffmpeg(booking.file_path)
                        .setStartTime(startTime)
                        .setDuration(duration)
                        .outputOptions(['-c', 'copy'])
                        .output(outputFilePath)
                        .on('end', () => resolve())
                        .on('error', (err) => reject(err))
                        .run();
                });

                const hlStats = await fs.stat(outputFilePath);

                const hlResult = await pool.query(
                    `INSERT INTO videos (match_id, title, file_path, duration_seconds, file_size_bytes, recorded_at, is_highlight)
                     VALUES ($1, $2, $3, $4, $5, NOW(), true) RETURNING *`,
                    [bookingId, `Highlight #${highlightIndex}`, outputFilePath, duration, hlStats.size]
                );

                // Marca il button_marker come processato
                await pool.query('UPDATE button_markers SET processed = true WHERE id = $1', [marker.id]);

                createdHighlights.push(hlResult.rows[0]);
                highlightIndex++;
            } catch (ffmpegError) {
                console.error(`❌ Errore FFmpeg per marker ${marker.id}:`, ffmpegError.message);
            }
        }

        console.log(`✅ Creati ${createdHighlights.length} highlight da marker ESP32`);

        res.json({
            success: true,
            highlightsCreated: createdHighlights.length,
            highlights: createdHighlights
        });

    } catch (error) {
        console.error('Error processing ESP32 markers:', error);
        res.status(500).json({ error: error.message });
    }
});

// Helper: format seconds to FFmpeg time format
function formatSecondsToFFmpeg(totalSeconds) {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

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
    const { from_date, to_date, sport_type, period, user_id, customer_name } = req.query;

    console.log('[Stats] Filtri ricevuti:', { from_date, to_date, sport_type, customer_name });

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
    // Filtro giocatore per customer_name (la tabella bookings non ha user_id)
    if (customer_name) {
      params.push('%' + customer_name + '%');
      whereClause += ' AND LOWER(b.customer_name) LIKE LOWER($' + params.length + ')';
    }

    // Total bookings count
    const totalResult = await pool.query(`
      SELECT COUNT(*) as total,
             SUM(b.total_price) as revenue,
             SUM(b.price_per_player) as user_spent,
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
        user_spent: parseFloat(totalResult.rows[0]?.user_spent || 0),
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

// ==================== CLUB INFO ENDPOINTS ====================

// GET /api/club/info - Ottieni informazioni club (pubblico)
app.get('/api/club/info', async (req, res) => {
  try {
    // Prova a creare la tabella se non esiste
    await pool.query(`
      CREATE TABLE IF NOT EXISTS club_info (
        id INTEGER PRIMARY KEY DEFAULT 1,
        name VARCHAR(255),
        address VARCHAR(500),
        phone VARCHAR(50),
        email VARCHAR(255),
        website VARCHAR(500),
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const result = await pool.query('SELECT * FROM club_info WHERE id = 1');
    if (result.rows.length > 0) {
      res.json({ success: true, info: result.rows[0] });
    } else {
      // Ritorna info di default se non esistono
      res.json({
        success: true,
        info: {
          name: 'Sporty Club',
          address: '',
          phone: '',
          email: '',
          website: ''
        }
      });
    }
  } catch (error) {
    console.error('Error getting club info:', error);
    // In caso di errore, ritorna comunque info di default
    res.json({
      success: true,
      info: {
        name: 'Sporty Club',
        address: '',
        phone: '',
        email: '',
        website: ''
      }
    });
  }
});

// PUT/POST /api/club/info - Aggiorna informazioni club (admin only - richiede basic auth)
const updateClubInfo = async (req, res) => {
  try {
    const { name, address, phone, email, website } = req.body;

    // Crea la tabella se non esiste
    await pool.query(`
      CREATE TABLE IF NOT EXISTS club_info (
        id INTEGER PRIMARY KEY DEFAULT 1,
        name VARCHAR(255),
        address VARCHAR(500),
        phone VARCHAR(50),
        email VARCHAR(255),
        website VARCHAR(500),
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Upsert: inserisce o aggiorna
    const result = await pool.query(`
      INSERT INTO club_info (id, name, address, phone, email, website, updated_at)
      VALUES (1, $1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        address = EXCLUDED.address,
        phone = EXCLUDED.phone,
        email = EXCLUDED.email,
        website = EXCLUDED.website,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `, [name || '', address || '', phone || '', email || '', website || '']);

    res.json({ success: true, info: result.rows[0] });
  } catch (error) {
    console.error('Error updating club info:', error);
    res.status(500).json({ error: error.message });
  }
};
app.put('/api/club/info', updateClubInfo);
app.post('/api/club/info', updateClubInfo);

// ==================== CLUB IMAGES ENDPOINTS ====================

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
      .map(f => {
        const match = f.match(/^(\d+)/);
        return match ? parseInt(match[1], 10) : 0;
      })
      .filter(n => n > 0);
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

// Setup authentication routes
setupAuthRoutes(app, pool);
console.log('🔐 Auth system loaded');

// ==================== NOTIFICATIONS API ====================

// Helper function to create a notification
async function createNotification(userId, type, title, message, bookingId = null, scheduledAt = null) {
  try {
    const result = await pool.query(
      `INSERT INTO notifications (user_id, type, title, message, booking_id, scheduled_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [userId, type, title, message, bookingId, scheduledAt]
    );
    return result.rows[0];
  } catch (error) {
    console.error('Error creating notification:', error);
    return null;
  }
}

// GET /api/notifications - Get notifications for authenticated user
app.get('/api/notifications', async (req, res) => {
  try {
    // Get user from JWT token
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token richiesto' });
    }

    const token = authHeader.split(' ')[1];
    const jwt = require('jsonwebtoken');
    const JWT_SECRET = process.env.JWT_SECRET || 'replayo-jwt-secret-change-in-production-2024';

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ error: 'Token non valido' });
    }

    const userId = decoded.userId;

    // Get unread notifications and upcoming reminders
    const result = await pool.query(
      `SELECT n.*,
              b.booking_date, b.start_time, b.end_time,
              c.name as court_name, c.sport_type
       FROM notifications n
       LEFT JOIN bookings b ON n.booking_id = b.id
       LEFT JOIN courts c ON b.court_id = c.id
       WHERE n.user_id = $1
         AND n.dismissed_at IS NULL
         AND (n.scheduled_at IS NULL OR n.scheduled_at <= NOW() + INTERVAL '7 days')
       ORDER BY COALESCE(n.scheduled_at, n.created_at) DESC
       LIMIT 50`,
      [userId]
    );

    res.json({ success: true, notifications: result.rows });
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/notifications/:id/read - Mark notification as read
app.put('/api/notifications/:id/read', async (req, res) => {
  try {
    const { id } = req.params;

    await pool.query(
      `UPDATE notifications SET read_at = NOW() WHERE id = $1`,
      [id]
    );

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/notifications/:id/dismiss - Dismiss notification
app.put('/api/notifications/:id/dismiss', async (req, res) => {
  try {
    const { id } = req.params;

    await pool.query(
      `UPDATE notifications SET dismissed_at = NOW() WHERE id = $1`,
      [id]
    );

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/notifications/:id - Elimina notifica definitivamente (utente)
app.delete('/api/notifications/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Verifica JWT e che la notifica appartenga all'utente
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token richiesto' });
    }

    const token = authHeader.split(' ')[1];
    const jwt = require('jsonwebtoken');
    const JWT_SECRET = process.env.JWT_SECRET || 'replayo-jwt-secret-change-in-production-2024';

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ error: 'Token non valido' });
    }

    const userId = decoded.userId;

    // Elimina solo se appartiene all'utente
    const result = await pool.query(
      `DELETE FROM notifications WHERE id = $1 AND user_id = $2 RETURNING id`,
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Notifica non trovata' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting notification:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/notifications/mark-all-read - Mark all as read for user
app.post('/api/notifications/mark-all-read', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token richiesto' });
    }

    const token = authHeader.split(' ')[1];
    const jwt = require('jsonwebtoken');
    const JWT_SECRET = process.env.JWT_SECRET || 'replayo-jwt-secret-change-in-production-2024';

    const decoded = jwt.verify(token, JWT_SECRET);
    const userId = decoded.userId;

    await pool.query(
      `UPDATE notifications SET read_at = NOW()
       WHERE user_id = $1 AND read_at IS NULL`,
      [userId]
    );

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== ESP32 DEVICES API ====================

// POST /api/devices/register - ESP32 si registra all'avvio
app.post('/api/devices/register', async (req, res) => {
  try {
    const { device_id, device_name, court_id, firmware_version, ip_address, wifi_ssid } = req.body;

    if (!device_id) {
      return res.status(400).json({ error: 'device_id richiesto' });
    }

    // Upsert: inserisce o aggiorna se esiste già
    const result = await pool.query(
      `INSERT INTO esp32_devices (device_id, device_name, court_id, firmware_version, ip_address, wifi_ssid, is_online, last_heartbeat, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, true, NOW(), NOW())
       ON CONFLICT (device_id) DO UPDATE SET
         device_name = COALESCE($2, esp32_devices.device_name),
         court_id = COALESCE($3, esp32_devices.court_id),
         firmware_version = COALESCE($4, esp32_devices.firmware_version),
         ip_address = $5,
         wifi_ssid = COALESCE($6, esp32_devices.wifi_ssid),
         is_online = true,
         last_heartbeat = NOW(),
         updated_at = NOW()
       RETURNING *`,
      [device_id, device_name, court_id, firmware_version, ip_address, wifi_ssid]
    );

    console.log(`[ESP32] Device registered: ${device_id} (court: ${court_id})`);
    res.json({ success: true, device: result.rows[0] });
  } catch (error) {
    console.error('Error registering device:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/devices/heartbeat - ESP32 segnala che è online
app.post('/api/devices/heartbeat', async (req, res) => {
  try {
    const { device_id, ip_address } = req.body;

    if (!device_id) {
      return res.status(400).json({ error: 'device_id richiesto' });
    }

    const result = await pool.query(
      `UPDATE esp32_devices SET
         is_online = true,
         last_heartbeat = NOW(),
         ip_address = COALESCE($2, ip_address),
         updated_at = NOW()
       WHERE device_id = $1
       RETURNING id, court_id`,
      [device_id, ip_address]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Dispositivo non registrato' });
    }

    // Verifica se c'è un aggiornamento firmware disponibile
    const firmwareResult = await pool.query(
      `SELECT version, filename FROM esp32_firmware WHERE is_latest = true LIMIT 1`
    );

    const currentDevice = await pool.query(
      `SELECT firmware_version FROM esp32_devices WHERE device_id = $1`,
      [device_id]
    );

    let updateAvailable = false;
    let latestVersion = null;

    if (firmwareResult.rows.length > 0 && currentDevice.rows.length > 0) {
      latestVersion = firmwareResult.rows[0].version;
      if (currentDevice.rows[0].firmware_version !== latestVersion) {
        updateAvailable = true;
      }
    }

    res.json({
      success: true,
      update_available: updateAvailable,
      latest_version: latestVersion
    });
  } catch (error) {
    console.error('Error heartbeat:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/devices/marker - Pulsante premuto, salva marker
app.post('/api/devices/marker', async (req, res) => {
  try {
    const { device_id } = req.body;

    if (!device_id) {
      return res.status(400).json({ error: 'device_id richiesto' });
    }

    // Trova il dispositivo e il suo campo
    const deviceResult = await pool.query(
      `SELECT id, court_id FROM esp32_devices WHERE device_id = $1`,
      [device_id]
    );

    if (deviceResult.rows.length === 0) {
      return res.status(404).json({ error: 'Dispositivo non registrato' });
    }

    const courtId = deviceResult.rows[0].court_id;

    if (!courtId) {
      return res.status(400).json({ error: 'Dispositivo non associato a un campo' });
    }

    // Trova la prenotazione attiva in questo momento su questo campo
    const now = new Date();
    const currentTime = now.toTimeString().substring(0, 8);
    const currentDate = now.toISOString().split('T')[0];

    const bookingResult = await pool.query(
      `SELECT id FROM bookings
       WHERE court_id = $1
         AND booking_date = $2
         AND start_time <= $3
         AND end_time > $3
         AND status = 'confirmed'
       LIMIT 1`,
      [courtId, currentDate, currentTime]
    );

    const bookingId = bookingResult.rows.length > 0 ? bookingResult.rows[0].id : null;

    // Salva il marker
    const markerResult = await pool.query(
      `INSERT INTO button_markers (device_id, court_id, marker_time, booking_id)
       VALUES ($1, $2, NOW(), $3)
       RETURNING *`,
      [device_id, courtId, bookingId]
    );

    console.log(`[ESP32] Marker saved: device=${device_id}, court=${courtId}, booking=${bookingId}`);

    res.json({
      success: true,
      marker: markerResult.rows[0],
      booking_id: bookingId
    });
  } catch (error) {
    console.error('Error saving marker:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/devices - Lista dispositivi (admin)
app.get('/api/devices', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT d.*, c.name as court_name, c.sport_type,
              (SELECT COUNT(*) FROM button_markers WHERE device_id = d.device_id) as marker_count
       FROM esp32_devices d
       LEFT JOIN courts c ON d.court_id = c.id
       ORDER BY d.court_id, d.device_name`
    );

    // Aggiorna stato online/offline basato su ultimo heartbeat (offline se > 2 minuti)
    const devices = result.rows.map(device => ({
      ...device,
      is_online: device.last_heartbeat &&
                 (new Date() - new Date(device.last_heartbeat)) < 120000 // 2 minuti
    }));

    res.json({ success: true, devices });
  } catch (error) {
    console.error('Error fetching devices:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/devices/:id - Dettaglio singolo dispositivo
app.get('/api/devices/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT d.*, c.name as court_name, c.sport_type
       FROM esp32_devices d
       LEFT JOIN courts c ON d.court_id = c.id
       WHERE d.id = $1 OR d.device_id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Dispositivo non trovato' });
    }

    // Ultimi 20 marker di questo dispositivo
    const markersResult = await pool.query(
      `SELECT bm.*, b.customer_name
       FROM button_markers bm
       LEFT JOIN bookings b ON bm.booking_id = b.id
       WHERE bm.device_id = $1
       ORDER BY bm.marker_time DESC
       LIMIT 20`,
      [result.rows[0].device_id]
    );

    res.json({
      success: true,
      device: result.rows[0],
      recent_markers: markersResult.rows
    });
  } catch (error) {
    console.error('Error fetching device:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/devices/:id - Aggiorna dispositivo (admin)
app.put('/api/devices/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { device_name, court_id, margin_before, margin_after } = req.body;

    const result = await pool.query(
      `UPDATE esp32_devices SET
         device_name = COALESCE($2, device_name),
         court_id = $3,
         margin_before = COALESCE($4, margin_before),
         margin_after = COALESCE($5, margin_after),
         updated_at = NOW()
       WHERE id = $1 OR device_id = $1
       RETURNING *`,
      [id, device_name, court_id, margin_before, margin_after]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Dispositivo non trovato' });
    }

    res.json({ success: true, device: result.rows[0] });
  } catch (error) {
    console.error('Error updating device:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/devices/:id - Elimina dispositivo (admin)
app.delete('/api/devices/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Prima elimina i marker associati
    await pool.query(
      `DELETE FROM button_markers WHERE device_id = (SELECT device_id FROM esp32_devices WHERE id = $1 OR device_id = $1)`,
      [id]
    );

    const result = await pool.query(
      `DELETE FROM esp32_devices WHERE id = $1 OR device_id = $1 RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Dispositivo non trovato' });
    }

    res.json({ success: true, message: 'Dispositivo eliminato' });
  } catch (error) {
    console.error('Error deleting device:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/devices/markers/recent - Ultimi marker (admin) - DEVE essere prima di :court_id
app.get('/api/devices/markers/recent', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;

    const result = await pool.query(`
      SELECT m.*, c.name as court_name
      FROM button_markers m
      LEFT JOIN courts c ON m.court_id = c.id
      ORDER BY m.marker_time DESC
      LIMIT $1
    `, [limit]);

    res.json({ markers: result.rows });
  } catch (error) {
    console.error('Error loading recent markers:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/devices/markers/:court_id - Marker di un campo in un intervallo
app.get('/api/devices/markers/:court_id', async (req, res) => {
  try {
    const { court_id } = req.params;
    const { from, to, booking_id } = req.query;

    let query = `SELECT * FROM button_markers WHERE court_id = $1`;
    const params = [court_id];

    if (booking_id) {
      params.push(booking_id);
      query += ` AND booking_id = $${params.length}`;
    }

    if (from) {
      params.push(from);
      query += ` AND marker_time >= $${params.length}`;
    }

    if (to) {
      params.push(to);
      query += ` AND marker_time <= $${params.length}`;
    }

    query += ` ORDER BY marker_time ASC`;

    const result = await pool.query(query, params);
    res.json({ success: true, markers: result.rows });
  } catch (error) {
    console.error('Error fetching markers:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== ESP32 FIRMWARE OTA API ====================

// Multer config per upload firmware
const firmwareStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const firmwarePath = path.join(__dirname, 'firmware');
    if (!fsSync.existsSync(firmwarePath)) {
      fsSync.mkdirSync(firmwarePath, { recursive: true });
    }
    cb(null, firmwarePath);
  },
  filename: (req, file, cb) => {
    const version = req.body.version || 'unknown';
    cb(null, `firmware_${version}_${Date.now()}.bin`);
  }
});

const firmwareUpload = multer({
  storage: firmwareStorage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/octet-stream' || file.originalname.endsWith('.bin')) {
      cb(null, true);
    } else {
      cb(new Error('Solo file .bin sono permessi'), false);
    }
  },
  limits: { fileSize: 2 * 1024 * 1024 } // 2MB max
});

// POST /api/firmware/upload - Upload nuovo firmware (admin)
app.post('/api/firmware/upload', firmwareUpload.single('firmware'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'File firmware richiesto' });
    }

    const { version, release_notes } = req.body;

    if (!version) {
      return res.status(400).json({ error: 'Versione richiesta' });
    }

    // Calcola checksum MD5
    const crypto = require('crypto');
    const fileBuffer = fsSync.readFileSync(req.file.path);
    const checksum = crypto.createHash('md5').update(fileBuffer).digest('hex');

    // Imposta tutti gli altri firmware come non-latest
    await pool.query(`UPDATE esp32_firmware SET is_latest = false`);

    // Inserisce nuovo firmware
    const result = await pool.query(
      `INSERT INTO esp32_firmware (version, filename, file_path, file_size, checksum, release_notes, is_latest)
       VALUES ($1, $2, $3, $4, $5, $6, true)
       RETURNING *`,
      [version, req.file.filename, req.file.path, req.file.size, checksum, release_notes]
    );

    console.log(`[Firmware] Uploaded: ${version} (${req.file.filename})`);
    res.json({ success: true, firmware: result.rows[0] });
  } catch (error) {
    console.error('Error uploading firmware:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/firmware - Lista firmware disponibili
app.get('/api/firmware', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, version, filename, file_size, checksum, release_notes, is_latest, created_at
       FROM esp32_firmware
       ORDER BY created_at DESC`
    );

    res.json({ success: true, firmwares: result.rows });
  } catch (error) {
    console.error('Error fetching firmware list:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/firmware/latest - Ultimo firmware (per ESP32 OTA)
app.get('/api/firmware/latest', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM esp32_firmware WHERE is_latest = true LIMIT 1`
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Nessun firmware disponibile' });
    }

    res.json({ success: true, firmware: result.rows[0] });
  } catch (error) {
    console.error('Error fetching latest firmware:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/firmware/download/:version - Download firmware (per ESP32 OTA)
app.get('/api/firmware/download/:version', async (req, res) => {
  try {
    const { version } = req.params;

    const result = await pool.query(
      `SELECT * FROM esp32_firmware WHERE version = $1`,
      [version]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Firmware non trovato' });
    }

    const firmware = result.rows[0];

    if (!fsSync.existsSync(firmware.file_path)) {
      return res.status(404).json({ error: 'File firmware non trovato' });
    }

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename=${firmware.filename}`);
    res.setHeader('X-Firmware-Version', firmware.version);
    res.setHeader('X-Firmware-Checksum', firmware.checksum);

    const fileStream = fsSync.createReadStream(firmware.file_path);
    fileStream.pipe(res);
  } catch (error) {
    console.error('Error downloading firmware:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/firmware/:id/set-latest - Imposta firmware come latest
app.put('/api/firmware/:id/set-latest', async (req, res) => {
  try {
    const { id } = req.params;

    // Reset all to not latest
    await pool.query('UPDATE esp32_firmware SET is_latest = false');

    // Set this one as latest
    const result = await pool.query(
      'UPDATE esp32_firmware SET is_latest = true WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Firmware non trovato' });
    }

    res.json({ success: true, firmware: result.rows[0] });
  } catch (error) {
    console.error('Error setting firmware as latest:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/firmware/:id - Elimina firmware
app.delete('/api/firmware/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'SELECT * FROM esp32_firmware WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Firmware non trovato' });
    }

    const firmware = result.rows[0];

    // Delete file
    try {
      await fs.unlink(firmware.file_path);
    } catch (e) {
      console.log('Could not delete firmware file:', e.message);
    }

    // Delete from DB
    await pool.query('DELETE FROM esp32_firmware WHERE id = $1', [id]);

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting firmware:', error);
    res.status(500).json({ error: error.message });
  }
});

console.log('🎮 ESP32 Devices API loaded');

// Start server
app.listen(PORT, () => {
  console.log(`🚀 RePlayo API server running on http://localhost:${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
  console.log(`📦 Storage: ${STORAGE_TYPE === 's3' ? `S3 (${S3_BUCKET})` : `Local (${LOCAL_STORAGE_PATH})`}`);
});

// ==================== ADMIN USERS API ====================

// GET /api/admin/users - Lista utenti (admin only)
app.get('/api/admin/users', async (req, res) => {
  try {
    const { search, verified, active } = req.query;

    let query = `
      SELECT u.id, u.name, u.email, u.phone_number, u.user_code,
             u.email_verified, u.is_active, u.created_at, u.last_login,
             u.social_provider, u.avatar_url, u.player_id,
             p.first_name || ' ' || p.last_name as player_name
      FROM users u
      LEFT JOIN players p ON u.player_id = p.id
      WHERE 1=1
    `;
    const params = [];
    let paramCount = 0;

    if (search) {
      paramCount++;
      query += ` AND (u.name ILIKE $${paramCount} OR u.email ILIKE $${paramCount} OR u.user_code ILIKE $${paramCount})`;
      params.push(`%${search}%`);
    }

    if (verified !== undefined) {
      paramCount++;
      query += ` AND u.email_verified = $${paramCount}`;
      params.push(verified === 'true');
    }

    if (active !== undefined) {
      paramCount++;
      query += ` AND u.is_active = $${paramCount}`;
      params.push(active === 'true');
    }

    query += ' ORDER BY u.created_at DESC';

    const result = await pool.query(query, params);

    res.json({
      success: true,
      users: result.rows.map(u => ({
        id: u.id,
        name: u.name,
        email: u.email,
        phone: u.phone_number,
        userCode: u.user_code,
        emailVerified: u.email_verified,
        isActive: u.is_active,
        createdAt: u.created_at,
        lastLogin: u.last_login,
        socialProvider: u.social_provider,
        avatarUrl: u.avatar_url,
        playerId: u.player_id,
        playerName: u.player_name
      }))
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/admin/users/:id - Dettaglio singolo utente
app.get('/api/admin/users/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(`
      SELECT id, name, email, phone_number as phone, user_code, email_verified, is_active, created_at
      FROM users
      WHERE id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Utente non trovato' });
    }

    res.json({ success: true, user: result.rows[0] });
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/admin/users/:id - Modifica utente
app.put('/api/admin/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, phone, isActive, emailVerified } = req.body;

    const result = await pool.query(`
      UPDATE users
      SET name = COALESCE($1, name),
          email = COALESCE($2, email),
          phone_number = COALESCE($3, phone_number),
          is_active = COALESCE($4, is_active),
          email_verified = COALESCE($5, email_verified)
      WHERE id = $6
      RETURNING id, name, email, phone_number, user_code, email_verified, is_active
    `, [name, email, phone, isActive, emailVerified, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Utente non trovato' });
    }

    console.log(`[Admin] User updated: ${result.rows[0].email}`);

    res.json({ success: true, user: result.rows[0] });
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/admin/users/:id - Elimina utente
app.delete('/api/admin/users/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const userResult = await pool.query('SELECT email FROM users WHERE id = $1', [id]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Utente non trovato' });
    }

    await pool.query('DELETE FROM users WHERE id = $1', [id]);

    console.log(`[Admin] User deleted: ${userResult.rows[0].email}`);

    res.json({ success: true, message: 'Utente eliminato' });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/admin/users/:id/verify-email - Verifica manuale email
app.post('/api/admin/users/:id/verify-email', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(`
      UPDATE users
      SET email_verified = true,
          email_verification_token = NULL,
          email_verification_expires = NULL
      WHERE id = $1
      RETURNING email
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Utente non trovato' });
    }

    console.log(`[Admin] Email manually verified: ${result.rows[0].email}`);

    res.json({ success: true, message: 'Email verificata' });
  } catch (error) {
    console.error('Error verifying email:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/admin/users/:id/toggle-active - Attiva/Disattiva utente
app.post('/api/admin/users/:id/toggle-active', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(`
      UPDATE users
      SET is_active = NOT is_active
      WHERE id = $1
      RETURNING email, is_active
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Utente non trovato' });
    }

    const user = result.rows[0];
    console.log(`[Admin] User ${user.is_active ? 'activated' : 'deactivated'}: ${user.email}`);

    res.json({
      success: true,
      isActive: user.is_active,
      message: user.is_active ? 'Utente attivato' : 'Utente disattivato'
    });
  } catch (error) {
    console.error('Error toggling user active:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/admin/users-stats - Statistiche utenti
app.get('/api/admin/users-stats', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE email_verified = true) as verified,
        COUNT(*) FILTER (WHERE email_verified = false OR email_verified IS NULL) as pending,
        COUNT(*) FILTER (WHERE is_active = false) as inactive
      FROM users
    `);

    res.json({
      success: true,
      stats: {
        total: parseInt(result.rows[0].total),
        verified: parseInt(result.rows[0].verified),
        pending: parseInt(result.rows[0].pending),
        inactive: parseInt(result.rows[0].inactive)
      }
    });
  } catch (error) {
    console.error('Error fetching user stats:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/admin/users/:id/send-verification - Invia email di verifica
app.post('/api/admin/users/:id/send-verification', async (req, res) => {
  try {
    const { id } = req.params;

    // Get user data
    const userResult = await pool.query(
      'SELECT id, name, email, email_verification_token FROM users WHERE id = $1',
      [id]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Utente non trovato' });
    }

    const user = userResult.rows[0];

    // Generate new token if not exists
    let token = user.email_verification_token;
    if (!token) {
      const crypto = require('crypto');
      token = crypto.randomBytes(32).toString('hex');
      await pool.query(
        `UPDATE users SET
          email_verification_token = $1,
          email_verification_expires = NOW() + INTERVAL '24 hours'
        WHERE id = $2`,
        [token, id]
      );
    }

    // Send email using SMTP settings
    const smtp = global.smtpSettings || {};
    if (!smtp.host || !smtp.user || !smtp.pass) {
      return res.json({ success: false, error: 'SMTP non configurato. Vai in Impostazioni.' });
    }

    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port || 587,
      secure: smtp.secure || false,
      auth: { user: smtp.user, pass: smtp.pass }
    });

    const verifyUrl = `https://api.teofly.it/login.html?verify=${token}`;

    await transporter.sendMail({
      from: `"${smtp.fromName || 'RePlayo'}" <${smtp.from || smtp.user}>`,
      to: user.email,
      subject: 'Conferma il tuo account RePlayo',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #00d9ff 0%, #00b4d8 100%); padding: 30px; text-align: center;">
            <h1 style="color: #ffffff; margin: 0;">RePlayo</h1>
          </div>
          <div style="padding: 30px; background: #f5f5f5;">
            <h2 style="color: #333;">Ciao ${user.name}!</h2>
            <p style="color: #666; font-size: 16px;">
              Per completare la registrazione e attivare il tuo account, clicca sul pulsante qui sotto:
            </p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${verifyUrl}"
                 style="background: #00d9ff; color: #1a1a2e; padding: 15px 30px; text-decoration: none;
                        border-radius: 8px; font-weight: bold; display: inline-block;">
                Conferma Email
              </a>
            </div>
            <p style="color: #999; font-size: 12px;">Il link scade tra 24 ore.</p>
          </div>
        </div>
      `
    });

    console.log(`[Admin] Verification email sent to ${user.email}`);
    res.json({ success: true, message: 'Email inviata' });

  } catch (error) {
    console.error('Error sending verification email:', error);
    res.status(500).json({ success: false, error: error.message });
  }
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
    
    // Durate default per sport da configurazione
    const defaultDurations = {
      padel: getConfig('duration_padel', 90),
      tennis: getConfig('duration_tennis', 60),
      calcetto: getConfig('duration_calcetto', 60)
    };
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

    // Orari club da configurazione
    const CLUB_OPEN = getConfig('club_open_hour', 8);
    const CLUB_CLOSE = getConfig('club_close_hour', 22);
    const SLOT_INTERVAL = getConfig('slot_interval_minutes', 30);

    // Durate default per sport da configurazione
    const DURATIONS = {
      padel: { default: getConfig('duration_padel', 90), fallback: getConfig('duration_padel_fallback', 60) },
      tennis: { default: getConfig('duration_tennis', 60), fallback: null },
      calcetto: { default: getConfig('duration_calcetto', 60), fallback: null }
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

      // Genera tutti gli slot possibili
      for (let startMin = openMinutes; startMin < closeMinutes; startMin += SLOT_INTERVAL) {
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

    // Genera slot da configurazione
    const slots = [];
    const slotInterval = getConfig('slot_interval_minutes', 30);
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

      // Prossimo slot
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
    
    // Calcola prezzo basato su price_per_player * num_players del campo
    const courtNumPlayers = parseInt(court.num_players) || 4;
    const pricePerPlayer = parseFloat(court.price_per_player) || 0;
    const total_price = pricePerPlayer * courtNumPlayers;
    const price_per_player = pricePerPlayer;
    
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
    // Determina fonte della prenotazione
    const booking_source = isAuthenticated ? 'admin' : 'app';

    // Crea prenotazione con player_names
    const bookingResult = await pool.query(
      `INSERT INTO bookings (court_id, booking_date, start_time, end_time, duration_minutes,
         customer_name, customer_email, customer_phone, num_players,
         total_price, price_per_player, status, notes, player_names, booking_source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING *`,
      [court_id, booking_date, start_time, end_time, duration_minutes,
       customer_name, customer_email, customer_phone, num_players || 4,
       total_price, price_per_player, status, notes, playerNames, booking_source]
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

// GET /api/bookings/my-bookings - Le mie prenotazioni (utente loggato)
// IMPORTANTE: Questa route deve essere PRIMA di /api/bookings/:id per evitare conflitti
app.get('/api/bookings/my-bookings', async (req, res) => {
  try {
    // Verifica token JWT direttamente (come fa /auth/me)
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token mancante' });
    }

    const token = authHeader.split(' ')[1];
    const jwt = require('jsonwebtoken');
    const JWT_SECRET = process.env.JWT_SECRET || 'replayo-jwt-secret-change-in-production-2024';

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ error: 'Token non valido o scaduto' });
    }

    const userEmail = decoded.email;
    if (!userEmail) {
      return res.status(401).json({ error: 'Token non valido' });
    }

    console.log(`[my-bookings] Fetching bookings for user: ${userEmail}`);

    // Cerca prenotazioni dove l'utente è il customer (email) o è nei player_names (array)
    const query = `
      SELECT
        b.id, b.booking_date, b.start_time, b.end_time, b.duration_minutes,
        b.match_id, b.customer_name, b.customer_email, b.status, b.player_names,
        c.id as court_id, c.name as court_name, c.sport_type
      FROM bookings b
      JOIN courts c ON b.court_id = c.id
      WHERE (
        b.customer_email = $1
        OR array_to_string(b.player_names, ',') ILIKE $2
      )
      AND b.status IN ('confirmed', 'pending')
      ORDER BY b.booking_date DESC, b.start_time DESC
      LIMIT 100
    `;

    const result = await pool.query(query, [userEmail, `%${userEmail}%`]);

    console.log(`[my-bookings] Found ${result.rows.length} bookings for ${userEmail}`);

    res.json({
      success: true,
      bookings: result.rows
    });

  } catch (error) {
    console.error('Error fetching my bookings:', error);
    res.status(500).json({ error: 'Errore nel recupero delle prenotazioni' });
  }
});

// GET /api/user/stats - Statistiche utente (calcolate lato server)
app.get('/api/user/stats', async (req, res) => {
  try {
    // Verifica token JWT
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token mancante' });
    }

    const token = authHeader.split(' ')[1];
    const jwt = require('jsonwebtoken');
    const JWT_SECRET = process.env.JWT_SECRET || 'replayo-jwt-secret-change-in-production-2024';

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ error: 'Token non valido o scaduto' });
    }

    const userEmail = decoded.email;
    if (!userEmail) {
      return res.status(401).json({ error: 'Token non valido' });
    }

    // Query per tutte le prenotazioni dell'utente (passate e future)
    const bookingsResult = await pool.query(`
      SELECT
        b.id, b.booking_date, b.start_time, b.end_time, b.duration_minutes,
        b.status, b.total_price, b.price_per_player, c.sport_type, c.name as court_name
      FROM bookings b
      JOIN courts c ON b.court_id = c.id
      WHERE (
        b.customer_email = $1
        OR array_to_string(b.player_names, ',') ILIKE $2
      )
      AND b.status IN ('confirmed', 'pending', 'completed')
      ORDER BY b.booking_date DESC, b.start_time DESC
    `, [userEmail, `%${userEmail}%`]);

    const allBookings = bookingsResult.rows;
    const now = new Date();
    const today = now.toISOString().split('T')[0];

    // Separa passate e future
    const pastBookings = allBookings.filter(b => {
      const bookingDate = b.booking_date.toISOString().split('T')[0];
      return bookingDate < today || (bookingDate === today && b.end_time < now.toTimeString().slice(0,5));
    });

    const upcomingBookings = allBookings.filter(b => {
      const bookingDate = b.booking_date.toISOString().split('T')[0];
      return bookingDate > today || (bookingDate === today && b.start_time >= now.toTimeString().slice(0,5));
    });

    // Partite giocate (passate, non cancellate)
    const playedMatches = pastBookings.filter(b =>
      b.status !== 'cancelled' && b.status !== 'annullata'
    );

    // Totale ore
    let totalHours = 0;
    for (const b of playedMatches) {
      const duration = b.duration_minutes || 60;
      totalHours += duration / 60;
    }

    // Totale speso (costo per singolo giocatore, non totale campo)
    let totalSpent = 0;
    for (const b of playedMatches) {
      totalSpent += parseFloat(b.price_per_player) || 0;
    }

    // Statistiche per sport
    const sportStats = {};
    for (const b of playedMatches) {
      const sport = b.sport_type || 'Altro';
      const duration = b.duration_minutes || 60;
      const court = b.court_name || 'Campo';

      if (!sportStats[sport]) {
        sportStats[sport] = { matches: 0, hours: 0, courts: {} };
      }
      sportStats[sport].matches += 1;
      sportStats[sport].hours += duration / 60;
      sportStats[sport].courts[court] = (sportStats[sport].courts[court] || 0) + 1;
    }

    // Giorno preferito della settimana
    const dayCount = {};
    for (const b of playedMatches) {
      const date = new Date(b.booking_date);
      const weekday = date.getDay(); // 0=Dom, 1=Lun, ...
      dayCount[weekday] = (dayCount[weekday] || 0) + 1;
    }
    let favoriteDay = null;
    let maxDayCount = 0;
    for (const [day, count] of Object.entries(dayCount)) {
      if (count > maxDayCount) {
        maxDayCount = count;
        favoriteDay = parseInt(day);
      }
    }

    // Orario preferito
    const hourCount = {};
    for (const b of playedMatches) {
      const hour = parseInt(b.start_time.split(':')[0]);
      hourCount[hour] = (hourCount[hour] || 0) + 1;
    }
    let favoriteHour = null;
    let maxHourCount = 0;
    for (const [hour, count] of Object.entries(hourCount)) {
      if (count > maxHourCount) {
        maxHourCount = count;
        favoriteHour = parseInt(hour);
      }
    }

    res.json({
      success: true,
      stats: {
        totalMatches: playedMatches.length,
        totalHours: Math.round(totalHours * 10) / 10,
        totalSpent: Math.round(totalSpent * 100) / 100,
        upcomingCount: upcomingBookings.length,
        sportStats,
        favoriteDay,
        favoriteHour
      }
    });

  } catch (error) {
    console.error('Error calculating user stats:', error);
    res.status(500).json({ error: 'Errore nel calcolo delle statistiche' });
  }
});

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
    const result = await pool.query(
      `SELECT b.*, c.name as court_name, c.sport_type,
              m.booking_code, m.id as match_id_resolved, m.access_password as match_password
       FROM bookings b
       LEFT JOIN courts c ON b.court_id = c.id
       LEFT JOIN matches m ON b.match_id = m.id
       WHERE b.id = $1`,
      [id]
    );
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

    const updatedBooking = updatedResult.rows[0];

    // Create notifications for the user if we have their user_id
    if (booking.customer_email) {
      // Find user by email
      const userResult = await pool.query(
        `SELECT id FROM users WHERE email = $1`,
        [booking.customer_email]
      );

      if (userResult.rows.length > 0) {
        const userId = userResult.rows[0].id;
        const bookingDate = new Date(booking.booking_date).toLocaleDateString('it-IT');
        const startTime = booking.start_time.substring(0, 5);

        // 1. Immediate notification: booking confirmed
        await createNotification(
          userId,
          'booking_confirmed',
          'Prenotazione Confermata',
          `La tua prenotazione per ${booking.court_name} il ${bookingDate} alle ${startTime} è stata confermata!`,
          id,
          null // immediate
        );

        // 2. Reminder notification: X hours before (using booking_reminder_hours config)
        const reminderHours = parseInt(getConfig('booking_reminder_hours', 2));
        const bookingDateTime = new Date(`${booking.booking_date.toISOString().split('T')[0]}T${booking.start_time}`);
        const reminderTime = new Date(bookingDateTime.getTime() - (reminderHours * 60 * 60 * 1000));

        // Only create reminder if it's in the future
        if (reminderTime > new Date()) {
          await createNotification(
            userId,
            'booking_reminder',
            'Promemoria Partita',
            `Ricorda: hai una partita di ${booking.sport_type} su ${booking.court_name} tra ${reminderHours} ore!`,
            id,
            reminderTime
          );
        }
      }
    }

    res.json(updatedBooking);
  } catch (error) {
    console.error('Error confirming booking:', error);
    res.status(500).json({ error: 'Errore nella conferma della prenotazione' });
  }
});

// PUT /api/bookings/:id/cancel - Cancella prenotazione (admin)
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

// PUT /api/bookings/:id/user-cancel - Cancella prenotazione (utente app - usa JWT)
app.put('/api/bookings/:id/user-cancel', async (req, res) => {
  try {
    const { id } = req.params;

    // Verify JWT token
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token non fornito' });
    }

    const token = authHeader.split(' ')[1];
    let decoded;
    try {
      decoded = require('jsonwebtoken').verify(token, process.env.JWT_SECRET || 'replayo-jwt-secret-change-in-production-2024');
    } catch (err) {
      return res.status(401).json({ error: 'Token non valido o scaduto' });
    }

    // Get user email from token
    const userResult = await pool.query('SELECT email FROM users WHERE id = $1', [decoded.userId]);
    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: 'Utente non trovato' });
    }
    const userEmail = userResult.rows[0].email.toLowerCase();

    // Get booking and verify ownership
    const bookingResult = await pool.query(
      `SELECT b.*, c.name as court_name FROM bookings b
       JOIN courts c ON b.court_id = c.id
       WHERE b.id = $1`,
      [id]
    );

    if (bookingResult.rows.length === 0) {
      return res.status(404).json({ error: 'Prenotazione non trovata' });
    }

    const booking = bookingResult.rows[0];

    // Verify user owns this booking (by email)
    if (booking.customer_email?.toLowerCase() !== userEmail) {
      return res.status(403).json({ error: 'Non puoi cancellare prenotazioni di altri utenti' });
    }

    // Check if booking can be cancelled (not already cancelled/completed)
    if (booking.status === 'cancelled') {
      return res.status(400).json({ error: 'Prenotazione già cancellata' });
    }
    if (booking.status === 'completed') {
      return res.status(400).json({ error: 'Non puoi cancellare una prenotazione completata' });
    }

    // Check booking_cancel_hours limit
    const cancelHours = parseInt(getConfig('booking_cancel_hours', 24));
    const bookingDateTime = new Date(`${booking.booking_date.toISOString().split('T')[0]}T${booking.start_time}`);
    const now = new Date();
    const hoursUntilBooking = (bookingDateTime - now) / (1000 * 60 * 60);

    if (hoursUntilBooking < cancelHours) {
      return res.status(400).json({
        error: `Non puoi cancellare una prenotazione a meno di ${cancelHours} ore dall'inizio`,
        hours_remaining: Math.max(0, Math.floor(hoursUntilBooking))
      });
    }

    // Cancel the booking
    const result = await pool.query(
      `UPDATE bookings SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *`,
      [id]
    );

    // Delete pending reminder notifications for this booking
    await pool.query(
      `UPDATE notifications SET dismissed_at = NOW()
       WHERE booking_id = $1 AND type = 'booking_reminder' AND dismissed_at IS NULL`,
      [id]
    );

    // Create cancellation notification
    const bookingDate = new Date(booking.booking_date).toLocaleDateString('it-IT');
    const startTime = booking.start_time.substring(0, 5);
    await createNotification(
      decoded.userId,
      'booking_cancelled',
      'Prenotazione Cancellata',
      `Hai cancellato la prenotazione per ${booking.court_name} del ${bookingDate} alle ${startTime}.`,
      id,
      null
    );

    console.log(`[User Cancel] Booking ${id} cancelled by user ${userEmail}`);

    res.json({
      success: true,
      message: 'Prenotazione cancellata con successo',
      booking: result.rows[0]
    });
  } catch (error) {
    console.error('Error user-cancelling booking:', error);
    res.status(500).json({ error: 'Errore nella cancellazione' });
  }
});

// DELETE /api/bookings/:id - Elimina prenotazione
app.delete("/api/bookings/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // Prima recupera i dati della prenotazione per la notifica
    const bookingResult = await pool.query(
      `SELECT b.*, c.name as court_name, c.sport_type
       FROM bookings b
       JOIN courts c ON b.court_id = c.id
       WHERE b.id = $1`,
      [id]
    );

    if (bookingResult.rows.length === 0) {
      return res.status(404).json({ error: "Prenotazione non trovata" });
    }

    const booking = bookingResult.rows[0];

    // Elimina la prenotazione
    await pool.query("DELETE FROM bookings WHERE id = $1", [id]);

    // Invia notifica all'utente se ha un'email associata
    if (booking.customer_email) {
      const userResult = await pool.query(
        `SELECT id FROM users WHERE email = $1`,
        [booking.customer_email]
      );

      if (userResult.rows.length > 0) {
        const userId = userResult.rows[0].id;
        const bookingDate = new Date(booking.booking_date).toLocaleDateString('it-IT');
        const startTime = booking.start_time.substring(0, 5);

        await createNotification(
          userId,
          'booking_deleted',
          'Prenotazione Cancellata dal Club',
          `La tua prenotazione per ${booking.court_name} del ${bookingDate} alle ${startTime} è stata cancellata dal club. Per informazioni contatta la segreteria.`,
          null, // booking_id è null perché è stato eliminato
          null
        );

        console.log(`[Admin Delete] Notification sent to user ${booking.customer_email} for deleted booking ${id}`);
      }
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

    // Recupera la prenotazione esistente per avere i valori attuali
    const existingResult = await pool.query('SELECT * FROM bookings WHERE id = $1', [id]);
    if (existingResult.rows.length === 0) {
      return res.status(404).json({ error: 'Prenotazione non trovata' });
    }
    const existing = existingResult.rows[0];

    // Usa i nuovi valori o quelli esistenti
    const finalCourtId = court_id || existing.court_id;
    const finalDate = booking_date || existing.booking_date;
    const finalStartTime = start_time || existing.start_time;
    const finalEndTime = end_time || existing.end_time;

    // Verifica conflitti con altre prenotazioni (escludendo quella corrente)
    const conflictResult = await pool.query(
      `SELECT id FROM bookings
       WHERE court_id = $1 AND booking_date = $2 AND status NOT IN ('cancelled') AND id != $3
       AND ((start_time <= $4 AND end_time > $4) OR (start_time < $5 AND end_time >= $5) OR (start_time >= $4 AND end_time <= $5))`,
      [finalCourtId, finalDate, id, finalStartTime, finalEndTime]
    );

    if (conflictResult.rows.length > 0) {
      return res.status(409).json({ error: 'Slot già prenotato da un\'altra prenotazione' });
    }

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

    // Notifica all'utente se ci sono state modifiche significative (data, ora, campo)
    const hasSignificantChanges =
      (court_id && court_id !== existing.court_id) ||
      (booking_date && booking_date !== existing.booking_date?.toISOString?.()?.split('T')[0] && booking_date !== existing.booking_date) ||
      (start_time && start_time !== existing.start_time) ||
      (end_time && end_time !== existing.end_time);

    if (hasSignificantChanges && existing.customer_email) {
      try {
        const userResult = await pool.query(
          `SELECT id FROM users WHERE email = $1`,
          [existing.customer_email]
        );

        if (userResult.rows.length > 0) {
          const userId = userResult.rows[0].id;

          // Recupera nome campo aggiornato
          const courtResult = await pool.query('SELECT name FROM courts WHERE id = $1', [updatedBooking.court_id]);
          const courtName = courtResult.rows[0]?.name || 'Campo';

          // Formatta date
          const oldDate = new Date(existing.booking_date).toLocaleDateString('it-IT');
          const newDate = new Date(updatedBooking.booking_date).toLocaleDateString('it-IT');
          const oldTime = existing.start_time.substring(0, 5);
          const newTime = updatedBooking.start_time.substring(0, 5);

          let changeDetails = [];
          if (booking_date && oldDate !== newDate) changeDetails.push(`data: ${oldDate} → ${newDate}`);
          if (start_time && oldTime !== newTime) changeDetails.push(`ora: ${oldTime} → ${newTime}`);
          if (court_id && court_id !== existing.court_id) changeDetails.push(`campo: ${courtName}`);

          await createNotification(
            userId,
            'booking_modified',
            'Prenotazione Modificata dal Club',
            `La tua prenotazione è stata modificata: ${changeDetails.join(', ')}. Nuova prenotazione: ${courtName} il ${newDate} alle ${newTime}.`,
            id,
            null
          );

          console.log(`[Admin Update] Notification sent to user ${existing.customer_email} for modified booking ${id}`);
        }
      } catch (notifError) {
        console.error('Error sending modification notification:', notifError);
        // Non bloccare l'operazione se la notifica fallisce
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
// UNIFIED USERS API - Players + Registered Users
// ==========================================

// GET /api/admin/unified-users - Lista unificata utenti e giocatori
app.get('/api/admin/unified-users', async (req, res) => {
  try {
    const { search, type } = req.query;

    // Query per ottenere tutti i players con eventuale collegamento a users
    let query = `
      SELECT
        'player' as source,
        p.id as player_id,
        u.id as user_id,
        COALESCE(u.name, p.first_name || ' ' || p.last_name) as name,
        p.first_name,
        p.last_name,
        COALESCE(u.email, p.email) as email,
        COALESCE(u.phone_number, p.phone) as phone,
        u.user_code,
        u.email_verified,
        u.is_active as user_active,
        p.is_active as player_active,
        COALESCE(u.created_at, p.created_at) as created_at,
        u.last_login,
        u.social_provider,
        u.avatar_url,
        p.notes,
        CASE WHEN u.id IS NOT NULL THEN true ELSE false END as is_registered,
        COALESCE(u.is_admin, false) as is_admin
      FROM players p
      LEFT JOIN users u ON u.player_id = p.id
      WHERE p.is_active = true

      UNION ALL

      SELECT
        'user' as source,
        NULL as player_id,
        u.id as user_id,
        u.name,
        split_part(u.name, ' ', 1) as first_name,
        CASE
          WHEN position(' ' in u.name) > 0 THEN substring(u.name from position(' ' in u.name) + 1)
          ELSE ''
        END as last_name,
        u.email,
        u.phone_number as phone,
        u.user_code,
        u.email_verified,
        u.is_active as user_active,
        true as player_active,
        u.created_at,
        u.last_login,
        u.social_provider,
        u.avatar_url,
        NULL as notes,
        true as is_registered,
        COALESCE(u.is_admin, false) as is_admin
      FROM users u
      WHERE u.player_id IS NULL AND u.is_active = true
    `;

    const params = [];
    let paramCount = 0;

    // Wrap the UNION query in a subquery for filtering
    let fullQuery = `SELECT * FROM (${query}) as combined WHERE 1=1`;

    if (search) {
      paramCount++;
      fullQuery += ` AND (LOWER(name) LIKE LOWER($${paramCount}) OR LOWER(email) LIKE LOWER($${paramCount}) OR LOWER(phone) LIKE LOWER($${paramCount}) OR LOWER(user_code) LIKE LOWER($${paramCount}))`;
      params.push('%' + search + '%');
    }

    if (type === 'registered') {
      fullQuery += ` AND is_registered = true`;
    } else if (type === 'players') {
      fullQuery += ` AND is_registered = false`;
    } else if (type === 'admin') {
      fullQuery += ` AND is_admin = true`;
    }

    fullQuery += ' ORDER BY name ASC';

    const result = await pool.query(fullQuery, params);

    res.json({
      success: true,
      users: result.rows.map(row => ({
        id: row.player_id || row.user_id,
        playerId: row.player_id,
        userId: row.user_id,
        name: row.name,
        firstName: row.first_name,
        lastName: row.last_name,
        email: row.email,
        phone: row.phone,
        userCode: row.user_code,
        emailVerified: row.email_verified,
        isActive: row.user_active !== false && row.player_active !== false,
        createdAt: row.created_at,
        lastLogin: row.last_login,
        socialProvider: row.social_provider,
        avatarUrl: row.avatar_url,
        notes: row.notes,
        isRegistered: row.is_registered,
        isAdmin: row.is_admin,
        source: row.source
      }))
    });
  } catch (error) {
    console.error('Error fetching unified users:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/admin/unified-users-stats - Statistiche unificate
app.get('/api/admin/unified-users-stats', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM players WHERE is_active = true) +
        (SELECT COUNT(*) FROM users WHERE player_id IS NULL AND is_active = true) as total,
        (SELECT COUNT(*) FROM users WHERE is_active = true) as registered,
        (SELECT COUNT(*) FROM players WHERE is_active = true AND id NOT IN (SELECT player_id FROM users WHERE player_id IS NOT NULL)) as players_only,
        (SELECT COUNT(*) FROM users WHERE email_verified = true AND is_active = true) as verified
    `);

    res.json({
      success: true,
      stats: {
        total: parseInt(result.rows[0].total),
        registered: parseInt(result.rows[0].registered),
        playersOnly: parseInt(result.rows[0].players_only),
        verified: parseInt(result.rows[0].verified)
      }
    });
  } catch (error) {
    console.error('Error fetching unified stats:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/admin/users/:id/toggle-admin - Toggle admin status
app.post('/api/admin/users/:id/toggle-admin', async (req, res) => {
  try {
    const { id } = req.params;

    // Get current admin status
    const userResult = await pool.query(
      'SELECT id, email, is_admin FROM users WHERE id = $1',
      [id]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Utente non trovato' });
    }

    const currentAdmin = userResult.rows[0].is_admin;
    const newAdmin = !currentAdmin;

    // Update admin status
    await pool.query(
      'UPDATE users SET is_admin = $1 WHERE id = $2',
      [newAdmin, id]
    );

    console.log(`[Admin] User ${userResult.rows[0].email} admin status: ${newAdmin}`);

    res.json({
      success: true,
      isAdmin: newAdmin,
      message: newAdmin ? 'Utente promosso ad admin' : 'Privilegi admin rimossi'
    });
  } catch (error) {
    console.error('Error toggling admin:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

console.log('👥 Unified users API loaded');

// ==========================================
// ADMIN NOTIFICATIONS API
// ==========================================

// GET /api/admin/notifications - Get all notifications (admin)
app.get('/api/admin/notifications', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT n.*, u.name as user_name, u.email as user_email
      FROM notifications n
      LEFT JOIN users u ON n.user_id = u.id
      ORDER BY n.created_at DESC
      LIMIT 500
    `);
    res.json({ success: true, notifications: result.rows });
  } catch (error) {
    console.error('Error fetching admin notifications:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/admin/notifications - Create notification (admin)
app.post('/api/admin/notifications', async (req, res) => {
  try {
    const { user_id, type, title, message } = req.body;

    if (!user_id || !type || !title || !message) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    const result = await pool.query(
      `INSERT INTO notifications (user_id, type, title, message)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [user_id, type, title, message]
    );

    console.log(`[Admin] Created notification for user ${user_id}: ${title}`);
    res.json({ success: true, notification: result.rows[0] });
  } catch (error) {
    console.error('Error creating notification:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/admin/notifications/:id - Delete notification (admin)
app.delete('/api/admin/notifications/:id', async (req, res) => {
  try {
    const { id } = req.params;

    await pool.query('DELETE FROM notifications WHERE id = $1', [id]);

    console.log(`[Admin] Deleted notification ${id}`);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting notification:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/admin/notifications/stats - Get notification statistics (admin)
app.get('/api/admin/notifications/stats', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN dismissed_at IS NOT NULL THEN 1 END) as dismissed,
        COUNT(CASE WHEN read_at IS NOT NULL AND dismissed_at IS NULL THEN 1 END) as read,
        COUNT(CASE WHEN read_at IS NULL AND dismissed_at IS NULL THEN 1 END) as unread
      FROM notifications
    `);
    res.json({ success: true, stats: result.rows[0] });
  } catch (error) {
    console.error('Error fetching notification stats:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

console.log('🔔 Admin notifications API loaded');

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

// GET /api/public/config - Config pubbliche per app (no auth required)
app.get('/api/public/config', async (req, res) => {
  try {
    // Solo le config necessarie all'app, senza autenticazione
    const publicKeys = [
      'booking_advance_days',
      'booking_cancel_hours',
      'club_open_hour',
      'club_close_hour',
      'slot_interval_minutes'
    ];

    const result = await pool.query(
      'SELECT key, value FROM app_config WHERE key = ANY($1)',
      [publicKeys]
    );

    const config = {};
    result.rows.forEach(row => {
      config[row.key] = row.value;
    });

    res.json({ success: true, config });
  } catch (error) {
    console.error('Error fetching public config:', error);
    res.status(500).json({ error: 'Errore nel recupero configurazione' });
  }
});

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
      // Prova a inserire se non esiste
      const insertResult = await pool.query(
        `INSERT INTO app_config (key, value) VALUES ($1, $2) RETURNING *`,
        [key, value]
      );
      await updateConfigCache(key, value, insertResult.rows[0]?.type || 'text');
      return res.json({ success: true, config: insertResult.rows[0] });
    }

    // Aggiorna cache in memoria
    await updateConfigCache(key, value, result.rows[0]?.type || 'text');
    res.json({ success: true, config: result.rows[0] });
  } catch (error) {
    console.error('Error updating config:', error);
    res.status(500).json({ error: 'Errore nell aggiornamento configurazione' });
  }
});

// POST /api/config/reload - Ricarica configurazioni
app.post('/api/config/reload', async (req, res) => {
  try {
    await loadAppConfig();
    res.json({ success: true, message: 'Configurazioni ricaricate', count: Object.keys(appConfigCache).length });
  } catch (error) {
    console.error('Error reloading config:', error);
    res.status(500).json({ error: 'Errore ricaricamento configurazioni' });
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

// ==================== SMTP SETTINGS API ====================

const nodemailer = require('nodemailer');

// SMTP settings (loaded from DB on startup)
let smtpSettings = {
  host: '',
  port: 587,
  secure: false,
  user: '',
  pass: '',
  from: '',
  fromName: 'RePlayo'
};

// Load SMTP settings from database on startup
async function loadSmtpSettingsFromDB() {
  try {
    const result = await pool.query("SELECT value FROM settings WHERE key = 'smtp'");
    if (result.rows.length > 0 && result.rows[0].value) {
      smtpSettings = JSON.parse(result.rows[0].value);
      global.smtpSettings = smtpSettings;
      console.log('[SMTP] Settings loaded from database:', {
        host: smtpSettings.host,
        port: smtpSettings.port,
        user: smtpSettings.user
      });
    }
  } catch (error) {
    console.error('[SMTP] Error loading settings from DB:', error.message);
  }
}

// Load settings on startup
loadSmtpSettingsFromDB();

// GET /api/settings/smtp - Get SMTP settings (without password)
app.get('/api/settings/smtp', (req, res) => {
  res.json({
    success: true,
    settings: {
      host: smtpSettings.host,
      port: smtpSettings.port,
      secure: smtpSettings.secure,
      user: smtpSettings.user,
      from: smtpSettings.from,
      fromName: smtpSettings.fromName
      // Password not returned for security
    }
  });
});

// POST /api/settings/smtp - Save SMTP settings to database
app.post('/api/settings/smtp', async (req, res) => {
  try {
    const { host, port, secure, user, pass, from, fromName } = req.body;

    smtpSettings = {
      host: host || smtpSettings.host,
      port: port || smtpSettings.port,
      secure: secure !== undefined ? secure : smtpSettings.secure,
      user: user || smtpSettings.user,
      pass: pass || smtpSettings.pass,
      from: from || smtpSettings.from,
      fromName: fromName || smtpSettings.fromName
    };

    // Save to database
    await pool.query(`
      INSERT INTO settings (key, value, updated_at)
      VALUES ('smtp', $1, NOW())
      ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()
    `, [JSON.stringify(smtpSettings)]);

    // Update global for auth.js
    global.smtpSettings = smtpSettings;

    console.log('[SMTP] Settings saved to database:', {
      host: smtpSettings.host,
      port: smtpSettings.port,
      user: smtpSettings.user,
      from: smtpSettings.from
    });

    res.json({ success: true, message: 'Impostazioni SMTP salvate' });
  } catch (error) {
    console.error('Error saving SMTP settings:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/settings/smtp/test - Test SMTP connection
app.get('/api/settings/smtp/test', async (req, res) => {
  try {
    if (!smtpSettings.host || !smtpSettings.user) {
      return res.json({ success: false, error: 'SMTP non configurato' });
    }

    const transporter = nodemailer.createTransport({
      host: smtpSettings.host,
      port: smtpSettings.port,
      secure: smtpSettings.secure,
      auth: {
        user: smtpSettings.user,
        pass: smtpSettings.pass
      }
    });

    await transporter.verify();

    res.json({ success: true, message: 'Connessione SMTP riuscita' });
  } catch (error) {
    console.error('SMTP test error:', error);
    res.json({ success: false, error: error.message });
  }
});

// POST /api/settings/smtp/send-test-emails - Send all test email templates
app.post('/api/settings/smtp/send-test-emails', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, error: 'Email richiesta' });
    }

    if (!smtpSettings.host || !smtpSettings.user) {
      return res.json({ success: false, error: 'SMTP non configurato' });
    }

    const transporter = nodemailer.createTransport({
      host: smtpSettings.host,
      port: smtpSettings.port,
      secure: smtpSettings.secure,
      auth: {
        user: smtpSettings.user,
        pass: smtpSettings.pass
      }
    });

    const fromAddress = `"${smtpSettings.fromName}" <${smtpSettings.from || smtpSettings.user}>`;
    const results = [];

    // 1. Email di conferma account
    try {
      await transporter.sendMail({
        from: fromAddress,
        to: email,
        subject: '[TEST] Conferma il tuo account RePlayo',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 12px; overflow: hidden;">
            <div style="background: linear-gradient(135deg, #00d9ff 0%, #00b4d8 100%); padding: 30px; text-align: center;">
              <h1 style="color: #ffffff; margin: 0; font-size: 32px;">RePlayo</h1>
              <p style="color: #ffffff; margin: 10px 0 0 0; font-size: 14px;">Rivedi le tue partite</p>
            </div>
            <div style="padding: 35px 30px; background: #ffffff;">
              <h2 style="color: #1a1a2e; margin: 0 0 20px 0; font-size: 22px;">Ciao Mario!</h2>
              <p style="color: #444444; font-size: 16px; line-height: 1.6; margin: 0 0 25px 0;">
                Grazie per esserti registrato su RePlayo. Per completare la registrazione e attivare il tuo account,
                clicca sul pulsante qui sotto:
              </p>
              <div style="text-align: center; margin: 30px 0;">
                <a href="#"
                   style="background: linear-gradient(135deg, #00d9ff 0%, #0099cc 100%); color: #ffffff; padding: 16px 40px; text-decoration: none;
                          border-radius: 8px; font-weight: bold; display: inline-block; font-size: 16px; box-shadow: 0 4px 15px rgba(0, 217, 255, 0.3);">
                  Conferma Email
                </a>
              </div>
              <p style="color: #666666; font-size: 14px; line-height: 1.5; margin: 25px 0 10px 0;">
                Se non hai creato tu questo account, puoi ignorare questa email.
              </p>
              <p style="color: #888888; font-size: 13px; margin: 0;">
                Il link scade tra 24 ore.
              </p>
            </div>
            <div style="padding: 20px; text-align: center; background: #f8f9fa; border-top: 1px solid #e0e0e0;">
              <p style="color: #888888; margin: 0; font-size: 12px;">
                © 2024 RePlayo - Tutti i diritti riservati
              </p>
            </div>
          </div>
          <p style="color: #ff9800; text-align: center; margin-top: 20px; font-weight: bold;">⚠️ QUESTA È UNA EMAIL DI TEST</p>
        `
      });
      results.push({ type: 'Conferma Account', success: true });
    } catch (err) {
      results.push({ type: 'Conferma Account', success: false, error: err.message });
    }

    // 2. Email di recupero password (con password temporanea)
    try {
      await transporter.sendMail({
        from: fromAddress,
        to: email,
        subject: '[TEST] Recupero Password RePlayo',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 12px; overflow: hidden;">
            <div style="background: linear-gradient(135deg, #00d9ff 0%, #00b4d8 100%); padding: 30px; text-align: center;">
              <h1 style="color: #ffffff; margin: 0; font-size: 32px;">RePlayo</h1>
              <p style="color: #ffffff; margin: 10px 0 0 0; font-size: 14px;">Recupero Password</p>
            </div>
            <div style="padding: 35px 30px; background: #ffffff;">
              <h2 style="color: #1a1a2e; margin: 0 0 20px 0; font-size: 22px;">Ciao Mario!</h2>
              <p style="color: #444444; font-size: 16px; line-height: 1.6; margin: 0 0 25px 0;">
                Hai richiesto il recupero della password del tuo account RePlayo.
                Abbiamo generato una nuova password temporanea per te:
              </p>
              <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; text-align: center; margin: 20px 0;">
                <p style="color: #666; margin: 0 0 10px 0; font-size: 14px;">La tua nuova password:</p>
                <p style="color: #1a1a2e; font-size: 28px; font-weight: bold; margin: 0; letter-spacing: 3px; font-family: monospace;">AB12CD34</p>
              </div>
              <p style="color: #666666; font-size: 14px; line-height: 1.5; margin: 25px 0 10px 0;">
                Ti consigliamo di cambiare questa password dopo il primo accesso.
              </p>
              <p style="color: #888888; font-size: 13px; margin: 20px 0 0 0;">
                Se non hai richiesto il recupero della password, contatta immediatamente il supporto.
              </p>
            </div>
            <div style="padding: 20px; text-align: center; background: #f8f9fa; border-top: 1px solid #e0e0e0;">
              <p style="color: #888888; margin: 0; font-size: 12px;">
                © 2024 RePlayo - Tutti i diritti riservati
              </p>
            </div>
          </div>
          <p style="color: #ff9800; text-align: center; margin-top: 20px; font-weight: bold;">⚠️ QUESTA È UNA EMAIL DI TEST</p>
        `
      });
      results.push({ type: 'Recupero Password', success: true });
    } catch (err) {
      results.push({ type: 'Recupero Password', success: false, error: err.message });
    }

    // 3. Email di reset password (con link)
    try {
      await transporter.sendMail({
        from: fromAddress,
        to: email,
        subject: '[TEST] Reset Password RePlayo',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 12px; overflow: hidden;">
            <div style="background: linear-gradient(135deg, #00d9ff 0%, #00b4d8 100%); padding: 30px; text-align: center;">
              <h1 style="color: #ffffff; margin: 0; font-size: 32px;">RePlayo</h1>
              <p style="color: #ffffff; margin: 10px 0 0 0; font-size: 14px;">Reset Password</p>
            </div>
            <div style="padding: 35px 30px; background: #ffffff;">
              <h2 style="color: #1a1a2e; margin: 0 0 20px 0; font-size: 22px;">Ciao Mario!</h2>
              <p style="color: #444444; font-size: 16px; line-height: 1.6; margin: 0 0 25px 0;">
                Abbiamo ricevuto una richiesta di reset della password per il tuo account RePlayo.
                Clicca sul pulsante qui sotto per impostare una nuova password:
              </p>
              <div style="text-align: center; margin: 30px 0;">
                <a href="#"
                   style="background: linear-gradient(135deg, #00d9ff 0%, #0099cc 100%); color: #ffffff; padding: 16px 40px; text-decoration: none;
                          border-radius: 8px; font-weight: bold; display: inline-block; font-size: 16px; box-shadow: 0 4px 15px rgba(0, 217, 255, 0.3);">
                  Reimposta Password
                </a>
              </div>
              <p style="color: #666666; font-size: 14px; line-height: 1.5; margin: 25px 0 10px 0;">
                Se il pulsante non funziona, copia e incolla questo link nel browser:
              </p>
              <p style="color: #0099cc; font-size: 12px; word-break: break-all;">
                https://api.teofly.it/reset-password.html?token=example-token
              </p>
              <p style="color: #888888; font-size: 13px; margin: 20px 0 0 0;">
                Il link scade tra 1 ora. Se non hai richiesto il reset della password, ignora questa email.
              </p>
            </div>
            <div style="padding: 20px; text-align: center; background: #f8f9fa; border-top: 1px solid #e0e0e0;">
              <p style="color: #888888; margin: 0; font-size: 12px;">
                © 2024 RePlayo - Tutti i diritti riservati
              </p>
            </div>
          </div>
          <p style="color: #ff9800; text-align: center; margin-top: 20px; font-weight: bold;">⚠️ QUESTA È UNA EMAIL DI TEST</p>
        `
      });
      results.push({ type: 'Reset Password', success: true });
    } catch (err) {
      results.push({ type: 'Reset Password', success: false, error: err.message });
    }

    console.log(`[SMTP] Test emails sent to ${email}:`, results);

    const allSuccess = results.every(r => r.success);
    res.json({
      success: allSuccess,
      results,
      message: allSuccess ? 'Tutte le email di prova inviate con successo' : 'Alcune email non sono state inviate'
    });
  } catch (error) {
    console.error('Send test emails error:', error);
    res.json({ success: false, error: error.message });
  }
});

// POST /api/settings/smtp/send-test - Send test email
app.post('/api/settings/smtp/send-test', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, error: 'Email richiesta' });
    }

    if (!smtpSettings.host || !smtpSettings.user) {
      return res.json({ success: false, error: 'SMTP non configurato' });
    }

    const transporter = nodemailer.createTransport({
      host: smtpSettings.host,
      port: smtpSettings.port,
      secure: smtpSettings.secure,
      auth: {
        user: smtpSettings.user,
        pass: smtpSettings.pass
      }
    });

    await transporter.sendMail({
      from: `"${smtpSettings.fromName}" <${smtpSettings.from || smtpSettings.user}>`,
      to: email,
      subject: 'RePlayo - Email di Test',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h1 style="color: #00d9ff;">RePlayo</h1>
          <p>Questa e' un'email di test.</p>
          <p>Se la ricevi, la configurazione SMTP e' corretta!</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
          <p style="color: #888; font-size: 12px;">
            Inviata il: ${new Date().toLocaleString('it-IT')}
          </p>
        </div>
      `
    });

    console.log(`[SMTP] Test email sent to ${email}`);
    res.json({ success: true, message: 'Email di test inviata' });
  } catch (error) {
    console.error('Send test email error:', error);
    res.json({ success: false, error: error.message });
  }
});
