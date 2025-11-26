/**
 * Authentication Module for RePlayo
 * JWT-based authentication with email verification and social login support
 */

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

// JWT Configuration
const JWT_SECRET = process.env.JWT_SECRET || 'replayo-jwt-secret-change-in-production-2024';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'replayo-refresh-secret-change-in-production-2024';
const ACCESS_TOKEN_EXPIRY = '1h';
const REFRESH_TOKEN_EXPIRY = '30d';

// App URL for email links
const APP_URL = process.env.APP_URL || 'https://api.teofly.it';

// Get email transporter dynamically from global settings
function getEmailTransporter() {
  const smtp = global.smtpSettings || {};

  if (!smtp.host || !smtp.user || !smtp.pass) {
    console.error('[Auth] SMTP not configured - check admin dashboard settings');
    return null;
  }

  return nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port || 587,
    secure: smtp.secure || false,
    auth: {
      user: smtp.user,
      pass: smtp.pass
    }
  });
}

// Generate user code (6 alphanumeric characters)
function generateUserCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Generate tokens
function generateAccessToken(user) {
  return jwt.sign(
    {
      userId: user.id,
      email: user.email,
      userCode: user.user_code,
      name: user.name
    },
    JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_EXPIRY }
  );
}

function generateRefreshToken(user) {
  return jwt.sign(
    { userId: user.id, type: 'refresh' },
    JWT_REFRESH_SECRET,
    { expiresIn: REFRESH_TOKEN_EXPIRY }
  );
}

// Verify access token
function verifyAccessToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
}

// Verify refresh token
function verifyRefreshToken(token) {
  try {
    return jwt.verify(token, JWT_REFRESH_SECRET);
  } catch (error) {
    return null;
  }
}

// Send verification email
async function sendVerificationEmail(email, name, token) {
  const transporter = getEmailTransporter();
  if (!transporter) {
    console.error('[Auth] Cannot send email - SMTP not configured');
    return false;
  }

  const smtp = global.smtpSettings || {};
  const verifyUrl = `${APP_URL}/login.html?verify=${token}`;

  const mailOptions = {
    from: `"${smtp.fromName || 'RePlayo'}" <${smtp.from || smtp.user}>`,
    to: email,
    subject: 'Conferma il tuo account RePlayo',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 12px; overflow: hidden;">
        <div style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 30px; text-align: center;">
          <h1 style="color: #00d9ff; margin: 0; font-size: 32px;">RePlayo</h1>
          <p style="color: #ffffff; margin: 10px 0 0 0; font-size: 14px;">Rivedi le tue partite</p>
        </div>
        <div style="padding: 35px 30px; background: #ffffff;">
          <h2 style="color: #1a1a2e; margin: 0 0 20px 0; font-size: 22px;">Ciao ${name}!</h2>
          <p style="color: #444444; font-size: 16px; line-height: 1.6; margin: 0 0 25px 0;">
            Grazie per esserti registrato su RePlayo. Per completare la registrazione e attivare il tuo account,
            clicca sul pulsante qui sotto:
          </p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${verifyUrl}"
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
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`[Auth] Verification email sent to ${email}`);
    return true;
  } catch (error) {
    console.error('Error sending verification email:', error);
    return false;
  }
}

// Setup auth routes
function setupAuthRoutes(app, pool) {

  // ==================== USER REGISTRATION ====================
  app.post('/api/auth/register', async (req, res) => {
    try {
      const { name, surname, email, password, phone } = req.body;

      // Combine name and surname if both provided
      const fullName = surname ? `${name} ${surname}`.trim() : name;
      const firstName = name || '';
      const lastName = surname || '';

      // Validation
      if (!name || !email || !password) {
        return res.status(400).json({
          success: false,
          error: 'Nome, email e password sono obbligatori'
        });
      }

      if (password.length < 8) {
        return res.status(400).json({
          success: false,
          error: 'La password deve essere di almeno 8 caratteri'
        });
      }

      // Email format validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({
          success: false,
          error: 'Formato email non valido'
        });
      }

      // Check if email already exists
      const existingUser = await pool.query(
        'SELECT id FROM users WHERE email = $1',
        [email.toLowerCase()]
      );

      if (existingUser.rows.length > 0) {
        return res.status(409).json({
          success: false,
          error: 'Email già registrata'
        });
      }

      // Hash password
      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash(password, salt);

      // Generate user code and verification token
      let userCode;
      let codeExists = true;
      while (codeExists) {
        userCode = generateUserCode();
        const codeCheck = await pool.query(
          'SELECT id FROM users WHERE user_code = $1',
          [userCode]
        );
        codeExists = codeCheck.rows.length > 0;
      }

      const verificationToken = crypto.randomBytes(32).toString('hex');
      const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

      // Create user
      const result = await pool.query(
        `INSERT INTO users (name, email, phone_number, password_hash, user_code,
                           email_verification_token, email_verification_expires, email_verified)
         VALUES ($1, $2, $3, $4, $5, $6, $7, false)
         RETURNING id, name, email, user_code, created_at`,
        [fullName, email.toLowerCase(), phone || null, passwordHash, userCode,
         verificationToken, verificationExpires]
      );

      const user = result.rows[0];

      // Create player record linked to user
      const playerResult = await pool.query(
        `INSERT INTO players (first_name, last_name, email, phone)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [firstName, lastName, email.toLowerCase(), phone || null]
      );

      // Link player to user
      await pool.query(
        'UPDATE users SET player_id = $1 WHERE id = $2',
        [playerResult.rows[0].id, user.id]
      );

      // Send verification email
      const emailSent = await sendVerificationEmail(email, name, verificationToken);

      console.log(`[Auth] New user registered: ${email} (${userCode})`);

      res.status(201).json({
        success: true,
        message: emailSent
          ? 'Registrazione completata! Controlla la tua email per confermare l\'account.'
          : 'Registrazione completata! (Email di conferma non inviata - contatta il supporto)',
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          userCode: user.user_code
        }
      });

    } catch (error) {
      console.error('Registration error:', error);
      res.status(500).json({
        success: false,
        error: 'Errore durante la registrazione'
      });
    }
  });

  // ==================== EMAIL VERIFICATION ====================
  app.get('/api/auth/verify-email', async (req, res) => {
    try {
      const { token } = req.query;

      if (!token) {
        return res.status(400).json({
          success: false,
          error: 'Token mancante'
        });
      }

      const result = await pool.query(
        `SELECT id, name, email, user_code, avatar_url, email_verification_expires
         FROM users
         WHERE email_verification_token = $1 AND email_verified = false`,
        [token]
      );

      if (result.rows.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Token non valido o già utilizzato'
        });
      }

      const user = result.rows[0];

      // Check expiration
      if (new Date() > new Date(user.email_verification_expires)) {
        return res.status(400).json({
          success: false,
          error: 'Token scaduto. Richiedi una nuova email di verifica.'
        });
      }

      // Verify email
      await pool.query(
        `UPDATE users
         SET email_verified = true,
             email_verification_token = NULL,
             email_verification_expires = NULL
         WHERE id = $1`,
        [user.id]
      );

      // Generate tokens for auto-login
      const accessToken = generateAccessToken(user);
      const refreshToken = generateRefreshToken(user);

      // Calculate refresh token expiry (30 days)
      const refreshExpires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      // Save refresh token
      await pool.query(
        `UPDATE users
         SET refresh_token = $1, refresh_token_expires = $2, last_login = NOW()
         WHERE id = $3`,
        [refreshToken, refreshExpires, user.id]
      );

      console.log(`[Auth] Email verified and auto-logged in: ${user.email}`);

      res.json({
        success: true,
        message: 'Email verificata con successo!',
        verified: true,
        accessToken,
        refreshToken,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          userCode: user.user_code,
          avatarUrl: user.avatar_url
        }
      });

    } catch (error) {
      console.error('Email verification error:', error);
      res.status(500).json({
        success: false,
        error: 'Errore durante la verifica'
      });
    }
  });

  // ==================== LOGIN ====================
  app.post('/api/auth/login', async (req, res) => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({
          success: false,
          error: 'Email e password sono obbligatori'
        });
      }

      // Find user
      const result = await pool.query(
        `SELECT id, name, email, password_hash, user_code, email_verified,
                is_active, avatar_url, player_id, is_admin
         FROM users
         WHERE email = $1`,
        [email.toLowerCase()]
      );

      if (result.rows.length === 0) {
        return res.status(401).json({
          success: false,
          error: 'Credenziali non valide'
        });
      }

      const user = result.rows[0];

      // Check if account is active
      if (!user.is_active) {
        return res.status(403).json({
          success: false,
          error: 'Account disabilitato. Contatta il supporto.'
        });
      }

      // Check if email is verified
      if (!user.email_verified) {
        return res.status(403).json({
          success: false,
          error: 'Email non verificata. Controlla la tua casella di posta.',
          needsVerification: true
        });
      }

      // Verify password
      const isValidPassword = await bcrypt.compare(password, user.password_hash);
      if (!isValidPassword) {
        return res.status(401).json({
          success: false,
          error: 'Credenziali non valide'
        });
      }

      // Generate tokens
      const accessToken = generateAccessToken(user);
      const refreshToken = generateRefreshToken(user);

      // Calculate refresh token expiry (30 days)
      const refreshExpires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      // Save refresh token
      await pool.query(
        `UPDATE users
         SET refresh_token = $1, refresh_token_expires = $2, last_login = NOW()
         WHERE id = $3`,
        [refreshToken, refreshExpires, user.id]
      );

      console.log(`[Auth] User logged in: ${user.email}`);

      res.json({
        success: true,
        accessToken,
        refreshToken,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          userCode: user.user_code,
          avatarUrl: user.avatar_url,
          isAdmin: user.is_admin === true
        }
      });

    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({
        success: false,
        error: 'Errore durante il login'
      });
    }
  });

  // ==================== REFRESH TOKEN ====================
  app.post('/api/auth/refresh', async (req, res) => {
    try {
      const { refreshToken } = req.body;

      if (!refreshToken) {
        return res.status(400).json({
          success: false,
          error: 'Refresh token mancante'
        });
      }

      // Verify refresh token
      const decoded = verifyRefreshToken(refreshToken);
      if (!decoded) {
        return res.status(401).json({
          success: false,
          error: 'Refresh token non valido'
        });
      }

      // Check if token exists in database and is not expired
      const result = await pool.query(
        `SELECT id, name, email, user_code, refresh_token_expires, is_active, avatar_url
         FROM users
         WHERE id = $1 AND refresh_token = $2`,
        [decoded.userId, refreshToken]
      );

      if (result.rows.length === 0) {
        return res.status(401).json({
          success: false,
          error: 'Sessione non valida'
        });
      }

      const user = result.rows[0];

      // Check expiration
      if (new Date() > new Date(user.refresh_token_expires)) {
        return res.status(401).json({
          success: false,
          error: 'Sessione scaduta. Effettua nuovamente il login.'
        });
      }

      // Check if account is active
      if (!user.is_active) {
        return res.status(403).json({
          success: false,
          error: 'Account disabilitato'
        });
      }

      // Generate new access token
      const accessToken = generateAccessToken(user);

      res.json({
        success: true,
        accessToken,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          userCode: user.user_code,
          avatarUrl: user.avatar_url
        }
      });

    } catch (error) {
      console.error('Refresh token error:', error);
      res.status(500).json({
        success: false,
        error: 'Errore durante il refresh'
      });
    }
  });

  // ==================== LOGOUT ====================
  app.post('/api/auth/logout', async (req, res) => {
    try {
      const authHeader = req.headers.authorization;

      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];
        const decoded = verifyAccessToken(token);

        if (decoded) {
          // Clear refresh token
          await pool.query(
            'UPDATE users SET refresh_token = NULL, refresh_token_expires = NULL WHERE id = $1',
            [decoded.userId]
          );

          console.log(`[Auth] User logged out: ${decoded.email}`);
        }
      }

      res.json({ success: true, message: 'Logout effettuato' });

    } catch (error) {
      console.error('Logout error:', error);
      res.json({ success: true, message: 'Logout effettuato' });
    }
  });

  // ==================== GET CURRENT USER ====================
  app.get('/api/auth/me', async (req, res) => {
    try {
      const authHeader = req.headers.authorization;

      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
          success: false,
          error: 'Token mancante'
        });
      }

      const token = authHeader.split(' ')[1];
      const decoded = verifyAccessToken(token);

      if (!decoded) {
        return res.status(401).json({
          success: false,
          error: 'Token non valido o scaduto'
        });
      }

      const result = await pool.query(
        `SELECT u.id, u.name, u.email, u.phone_number, u.user_code,
                u.avatar_url, u.created_at, u.email_verified, u.player_id
         FROM users u
         WHERE u.id = $1 AND u.is_active = true`,
        [decoded.userId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Utente non trovato'
        });
      }

      const user = result.rows[0];

      res.json({
        success: true,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          phone: user.phone_number,
          userCode: user.user_code,
          avatarUrl: user.avatar_url,
          createdAt: user.created_at,
          emailVerified: user.email_verified,
          playerId: user.player_id
        }
      });

    } catch (error) {
      console.error('Get user error:', error);
      res.status(500).json({
        success: false,
        error: 'Errore nel recupero dati utente'
      });
    }
  });

  // ==================== RESEND VERIFICATION EMAIL ====================
  app.post('/api/auth/resend-verification', async (req, res) => {
    try {
      const { email } = req.body;

      if (!email) {
        return res.status(400).json({
          success: false,
          error: 'Email obbligatoria'
        });
      }

      const result = await pool.query(
        'SELECT id, name, email_verified FROM users WHERE email = $1',
        [email.toLowerCase()]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Email non trovata'
        });
      }

      const user = result.rows[0];

      if (user.email_verified) {
        return res.status(400).json({
          success: false,
          error: 'Email già verificata'
        });
      }

      // Generate new token
      const verificationToken = crypto.randomBytes(32).toString('hex');
      const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

      await pool.query(
        `UPDATE users
         SET email_verification_token = $1, email_verification_expires = $2
         WHERE id = $3`,
        [verificationToken, verificationExpires, user.id]
      );

      // Send email
      const emailSent = await sendVerificationEmail(email, user.name, verificationToken);

      res.json({
        success: true,
        message: emailSent
          ? 'Email di verifica inviata!'
          : 'Impossibile inviare email. Riprova più tardi.'
      });

    } catch (error) {
      console.error('Resend verification error:', error);
      res.status(500).json({
        success: false,
        error: 'Errore nell\'invio email'
      });
    }
  });

  // ==================== PASSWORD RECOVERY ====================
  app.post('/api/auth/recover-password', async (req, res) => {
    try {
      const { email } = req.body;

      if (!email) {
        return res.status(400).json({
          success: false,
          message: 'Email obbligatoria'
        });
      }

      // Find user by email
      const result = await pool.query(
        'SELECT id, name, email, password_hash FROM users WHERE email = $1 AND is_active = true',
        [email.toLowerCase()]
      );

      // Always return success to prevent email enumeration attacks
      if (result.rows.length === 0) {
        console.log(`[Auth] Password recovery requested for non-existent email: ${email}`);
        return res.json({
          success: true,
          message: 'Se l\'indirizzo email è registrato, riceverai a breve un messaggio con la tua password.'
        });
      }

      const user = result.rows[0];

      // Get email transporter
      const transporter = getEmailTransporter();
      if (!transporter) {
        console.error('[Auth] Cannot send recovery email - SMTP not configured');
        return res.status(500).json({
          success: false,
          message: 'Servizio email non configurato. Contatta il supporto.'
        });
      }

      const smtp = global.smtpSettings || {};

      // Note: Sending the actual password is not secure best practice.
      // We need to retrieve the actual password which is hashed.
      // Since we can't decrypt the password, we'll generate a new temporary one.

      // Generate a temporary password
      const tempPassword = crypto.randomBytes(4).toString('hex'); // 8 characters

      // Hash and save the new password
      const salt = await bcrypt.genSalt(10);
      const newPasswordHash = await bcrypt.hash(tempPassword, salt);

      await pool.query(
        'UPDATE users SET password_hash = $1 WHERE id = $2',
        [newPasswordHash, user.id]
      );

      // Send email with the new password
      const mailOptions = {
        from: `"${smtp.fromName || 'RePlayo'}" <${smtp.from || smtp.user}>`,
        to: user.email,
        subject: 'Recupero Password RePlayo',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 12px; overflow: hidden;">
            <div style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 30px; text-align: center;">
              <h1 style="color: #00d9ff; margin: 0; font-size: 32px;">RePlayo</h1>
              <p style="color: #ffffff; margin: 10px 0 0 0; font-size: 14px;">Recupero Password</p>
            </div>
            <div style="padding: 35px 30px; background: #ffffff;">
              <h2 style="color: #1a1a2e; margin: 0 0 20px 0; font-size: 22px;">Ciao ${user.name}!</h2>
              <p style="color: #444444; font-size: 16px; line-height: 1.6; margin: 0 0 25px 0;">
                Hai richiesto il recupero della password del tuo account RePlayo.
                Abbiamo generato una nuova password temporanea per te:
              </p>
              <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; text-align: center; margin: 20px 0;">
                <p style="color: #666; margin: 0 0 10px 0; font-size: 14px;">La tua nuova password:</p>
                <p style="color: #1a1a2e; font-size: 28px; font-weight: bold; margin: 0; letter-spacing: 3px; font-family: monospace;">${tempPassword}</p>
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
        `
      };

      await transporter.sendMail(mailOptions);
      console.log(`[Auth] Password recovery email sent to ${user.email}`);

      res.json({
        success: true,
        message: 'Se l\'indirizzo email è registrato, riceverai a breve un messaggio con la tua password.'
      });

    } catch (error) {
      console.error('Password recovery error:', error);
      res.status(500).json({
        success: false,
        message: 'Errore durante il recupero password'
      });
    }
  });

  // ==================== ADMIN SEND RESET PASSWORD EMAIL ====================
  app.post('/api/admin/users/:userId/send-reset-password', async (req, res) => {
    try {
      const { userId } = req.params;

      // Get user info
      const userResult = await pool.query(
        'SELECT id, name, email FROM users WHERE id = $1 AND is_active = true',
        [userId]
      );

      if (userResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Utente non trovato'
        });
      }

      const user = userResult.rows[0];

      if (!user.email) {
        return res.status(400).json({
          success: false,
          error: 'Utente senza email'
        });
      }

      // Generate reset token (valid for 1 hour)
      const resetToken = crypto.randomBytes(32).toString('hex');
      const resetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      // Save reset token
      await pool.query(
        `UPDATE users SET password_reset_token = $1, password_reset_expires = $2 WHERE id = $3`,
        [resetToken, resetExpires, userId]
      );

      // Get email transporter
      const transporter = getEmailTransporter();
      if (!transporter) {
        return res.status(500).json({
          success: false,
          error: 'Servizio email non configurato'
        });
      }

      const smtp = global.smtpSettings || {};

      // Deep link URL for the app
      const resetUrl = `replayo://reset-password?token=${resetToken}`;
      // Web fallback URL
      const webResetUrl = `${APP_URL}/reset-password.html?token=${resetToken}`;

      // Send email with reset link
      const mailOptions = {
        from: `"${smtp.fromName || 'RePlayo'}" <${smtp.from || smtp.user}>`,
        to: user.email,
        subject: 'Reset Password RePlayo',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 12px; overflow: hidden;">
            <div style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 30px; text-align: center;">
              <h1 style="color: #00d9ff; margin: 0; font-size: 32px;">RePlayo</h1>
              <p style="color: #ffffff; margin: 10px 0 0 0; font-size: 14px;">Reset Password</p>
            </div>
            <div style="padding: 35px 30px; background: #ffffff;">
              <h2 style="color: #1a1a2e; margin: 0 0 20px 0; font-size: 22px;">Ciao ${user.name}!</h2>
              <p style="color: #444444; font-size: 16px; line-height: 1.6; margin: 0 0 25px 0;">
                Abbiamo ricevuto una richiesta di reset della password per il tuo account RePlayo.
                Clicca sul pulsante qui sotto per impostare una nuova password:
              </p>
              <div style="text-align: center; margin: 30px 0;">
                <a href="${resetUrl}"
                   style="background: linear-gradient(135deg, #00d9ff 0%, #0099cc 100%); color: #ffffff; padding: 16px 40px; text-decoration: none;
                          border-radius: 8px; font-weight: bold; display: inline-block; font-size: 16px; box-shadow: 0 4px 15px rgba(0, 217, 255, 0.3);">
                  Reimposta Password
                </a>
              </div>
              <p style="color: #666666; font-size: 14px; line-height: 1.5; margin: 25px 0 10px 0;">
                Se il pulsante non funziona, copia e incolla questo link nel browser:
              </p>
              <p style="color: #0099cc; font-size: 12px; word-break: break-all;">
                ${webResetUrl}
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
        `
      };

      await transporter.sendMail(mailOptions);
      console.log(`[Auth] Password reset email sent to ${user.email} by admin`);

      res.json({
        success: true,
        message: 'Email di reset password inviata'
      });

    } catch (error) {
      console.error('Send reset password error:', error);
      res.status(500).json({
        success: false,
        error: 'Errore durante l\'invio email'
      });
    }
  });

  // ==================== VERIFY RESET TOKEN AND SET NEW PASSWORD ====================
  app.post('/api/auth/reset-password', async (req, res) => {
    try {
      const { token, newPassword } = req.body;

      if (!token || !newPassword) {
        return res.status(400).json({
          success: false,
          error: 'Token e nuova password sono obbligatori'
        });
      }

      if (newPassword.length < 8) {
        return res.status(400).json({
          success: false,
          error: 'La password deve essere di almeno 8 caratteri'
        });
      }

      // Find user with valid reset token
      const result = await pool.query(
        `SELECT id, name, email, password_reset_expires
         FROM users
         WHERE password_reset_token = $1 AND is_active = true`,
        [token]
      );

      if (result.rows.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Token non valido o scaduto'
        });
      }

      const user = result.rows[0];

      // Check if token is expired
      if (new Date() > new Date(user.password_reset_expires)) {
        return res.status(400).json({
          success: false,
          error: 'Token scaduto. Richiedi un nuovo reset password.'
        });
      }

      // Hash new password
      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash(newPassword, salt);

      // Update password and clear reset token
      await pool.query(
        `UPDATE users
         SET password_hash = $1, password_reset_token = NULL, password_reset_expires = NULL
         WHERE id = $2`,
        [passwordHash, user.id]
      );

      console.log(`[Auth] Password reset successfully for ${user.email}`);

      res.json({
        success: true,
        message: 'Password aggiornata con successo! Ora puoi accedere.'
      });

    } catch (error) {
      console.error('Reset password error:', error);
      res.status(500).json({
        success: false,
        error: 'Errore durante il reset della password'
      });
    }
  });

  // ==================== VERIFY RESET TOKEN (check if valid) ====================
  app.get('/api/auth/verify-reset-token', async (req, res) => {
    try {
      const { token } = req.query;

      if (!token) {
        return res.status(400).json({
          success: false,
          error: 'Token mancante'
        });
      }

      // Find user with valid reset token
      const result = await pool.query(
        `SELECT id, name, email, password_reset_expires
         FROM users
         WHERE password_reset_token = $1 AND is_active = true`,
        [token]
      );

      if (result.rows.length === 0) {
        return res.json({
          success: false,
          valid: false,
          error: 'Token non valido'
        });
      }

      const user = result.rows[0];

      // Check if token is expired
      if (new Date() > new Date(user.password_reset_expires)) {
        return res.json({
          success: false,
          valid: false,
          error: 'Token scaduto'
        });
      }

      res.json({
        success: true,
        valid: true,
        email: user.email
      });

    } catch (error) {
      console.error('Verify reset token error:', error);
      res.status(500).json({
        success: false,
        error: 'Errore durante la verifica del token'
      });
    }
  });

  // ==================== GET USER MATCHES/VIDEOS ====================
  app.get('/api/auth/my-matches', async (req, res) => {
    try {
      const authHeader = req.headers.authorization;

      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
          success: false,
          error: 'Token mancante'
        });
      }

      const token = authHeader.split(' ')[1];
      const decoded = verifyAccessToken(token);

      if (!decoded) {
        return res.status(401).json({
          success: false,
          error: 'Token non valido'
        });
      }

      // Get user info including player_id and name
      const userResult = await pool.query(
        'SELECT id, name, email, player_id FROM users WHERE id = $1',
        [decoded.userId]
      );

      if (userResult.rows.length === 0) {
        return res.json({ success: true, matches: [] });
      }

      const user = userResult.rows[0];
      const playerId = user.player_id;
      const userName = user.name || '';
      const userEmail = user.email || '';

      // Extract first name for partial matching
      const firstName = userName.split(' ')[0] || '';

      // Get matches where user is a player - search by multiple criteria
      const matchesResult = await pool.query(
        `SELECT DISTINCT m.id, m.booking_code, m.sport_type, m.location,
                m.match_date, m.players, m.is_active,
                b.start_time, b.end_time, c.name as court_name,
                (SELECT COUNT(*) FROM videos WHERE match_id = m.id) as video_count
         FROM matches m
         LEFT JOIN bookings b ON m.booking_code LIKE '%' || SUBSTRING(b.id::text, 1, 8) || '%'
         LEFT JOIN courts c ON b.court_id = c.id
         LEFT JOIN booking_players bp ON b.id = bp.booking_id
         WHERE
            -- Match by player_id in booking_players
            ($1::int IS NOT NULL AND bp.player_id = $1)
            -- Match by full user name in players field
            OR ($2 != '' AND m.players ILIKE '%' || $2 || '%')
            -- Match by first name only (for partial matches like "matteo")
            OR ($3 != '' AND LENGTH($3) > 2 AND m.players ILIKE '%' || $3 || '%')
            -- Match by player name from players table
            OR ($1::int IS NOT NULL AND m.players ILIKE '%' || (SELECT COALESCE(first_name || ' ' || last_name, first_name) FROM players WHERE id = $1) || '%')
         ORDER BY m.match_date DESC
         LIMIT 50`,
        [playerId, userName, firstName]
      );

      res.json({
        success: true,
        matches: matchesResult.rows
      });

    } catch (error) {
      console.error('Get my matches error:', error);
      res.status(500).json({
        success: false,
        error: 'Errore nel recupero partite'
      });
    }
  });

  // Return middleware for protected routes
  return {
    verifyAccessToken,
    authMiddleware: (req, res, next) => {
      const authHeader = req.headers.authorization;

      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
          success: false,
          error: 'Token mancante'
        });
      }

      const token = authHeader.split(' ')[1];
      const decoded = verifyAccessToken(token);

      if (!decoded) {
        return res.status(401).json({
          success: false,
          error: 'Token non valido o scaduto'
        });
      }

      req.user = decoded;
      next();
    }
  };
}

module.exports = { setupAuthRoutes, generateUserCode };
