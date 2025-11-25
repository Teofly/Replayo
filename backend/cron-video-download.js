#!/usr/bin/env node
/**
 * Cron Job - Download Automatico Video
 * Esegue ogni ora alle x:55 per scaricare i video delle prenotazioni confermate
 *
 * Uso: node cron-video-download.js
 * Cron: 55 * * * * cd /home/teofly/replayo/backend && node cron-video-download.js >> /var/log/replayo-video-cron.log 2>&1
 */

const { Pool } = require('pg');
const axios = require('axios');
const https = require('https');
const fs = require('fs');
const path = require('path');

// Configurazione
const API_BASE_URL = 'http://localhost:3000/api';
const AUTH = Buffer.from('demo:demo').toString('base64');

// Database connection
const pool = new Pool({
  host: process.env.DB_HOST || '192.168.1.175',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'replayo_db',
  user: process.env.DB_USER || 'replayo_user',
  password: process.env.DB_PASSWORD || 'replayo_secure_pass_2024',
});

// Logging con timestamp
function log(message) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
}

function logError(message, error) {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] ERROR: ${message}`, error?.message || error);
}

async function getBookingsForVideoDownload(date) {
  try {
    const response = await axios.get(`${API_BASE_URL}/bookings/for-video-download`, {
      params: { date },
      headers: { 'Authorization': `Basic ${AUTH}` }
    });

    if (response.data.success) {
      return response.data.bookings;
    }
    return [];
  } catch (error) {
    logError('Errore recupero prenotazioni', error);
    return [];
  }
}

async function downloadVideoForBooking(bookingId) {
  try {
    const response = await axios.post(`${API_BASE_URL}/videos/auto-download`,
      { booking_id: bookingId },
      {
        headers: {
          'Authorization': `Basic ${AUTH}`,
          'Content-Type': 'application/json'
        },
        timeout: 300000 // 5 minuti timeout
      }
    );

    return response.data;
  } catch (error) {
    logError(`Errore download video per booking ${bookingId}`, error);
    return { success: false, error: error.message };
  }
}

async function main() {
  log('=== INIZIO CRON JOB VIDEO DOWNLOAD ===');

  // Calcola la data di oggi in ora italiana (Europe/Rome)
  const today = new Date();
  const italianTime = new Date(today.toLocaleString('en-US', { timeZone: 'Europe/Rome' }));
  const dateStr = italianTime.toISOString().split('T')[0];

  // Calcola anche l'ora corrente italiana per capire quali prenotazioni sono già passate
  const currentHour = italianTime.getHours();

  log(`Data: ${dateStr}, Ora corrente italiana: ${currentHour}:55 (UTC: ${today.getUTCHours()}:55)`);

  try {
    // Recupera prenotazioni del giorno che necessitano video
    const bookings = await getBookingsForVideoDownload(dateStr);

    if (bookings.length === 0) {
      log('Nessuna prenotazione da processare');
      await pool.end();
      log('=== FINE CRON JOB ===\n');
      return;
    }

    log(`Trovate ${bookings.length} prenotazioni totali del giorno`);
    const currentMinute = italianTime.getMinutes();

    // Log dettagliato di ogni prenotazione
    bookings.forEach(b => {
      const endTimeParts = b.end_time.split(':');
      const endHour = parseInt(endTimeParts[0]);
      const endMinute = parseInt(endTimeParts[1] || 0);
      const isEnded = endHour < currentHour || (endHour === currentHour && endMinute <= currentMinute);
      const status = b.has_video ? '✓ ha video' : (isEnded ? '⏳ da processare' : '⏰ non terminata');
      log(`  - ${b.court_name} ${b.start_time}-${b.end_time} (${b.customer_name}): ${status}`);
    });

    // Filtra solo le prenotazioni già terminate (end_time <= ora corrente) e senza video
    const bookingsToProcess = bookings.filter(b => {
      const endTimeParts = b.end_time.split(':');
      const endHour = parseInt(endTimeParts[0]);
      const endMinute = parseInt(endTimeParts[1] || 0);

      // Processa solo se:
      // 1. La prenotazione è terminata (end_time <= ora corrente)
      // 2. Non ha già un video
      const isEnded = endHour < currentHour || (endHour === currentHour && endMinute <= currentMinute);
      return isEnded && !b.has_video;
    });

    if (bookingsToProcess.length === 0) {
      log('Nessuna prenotazione terminata senza video da processare');
      await pool.end();
      log('=== FINE CRON JOB ===\n');
      return;
    }

    log(`Prenotazioni da processare: ${bookingsToProcess.length}`);

    let successCount = 0;
    let errorCount = 0;

    for (const booking of bookingsToProcess) {
      log(`Processing: ${booking.court_name} - ${booking.start_time} (${booking.customer_name})`);

      const result = await downloadVideoForBooking(booking.booking_id);

      if (result.success) {
        successCount++;
        log(`  ✓ Video scaricato: ${result.filename} (${Math.round(result.file_size / 1024 / 1024 * 100) / 100} MB)`);
      } else {
        errorCount++;
        logError(`  ✗ Errore: ${result.error}`);
      }

      // Piccola pausa tra i download per non sovraccaricare
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    log(`Completato: ${successCount} successi, ${errorCount} errori`);

  } catch (error) {
    logError('Errore generale nel cron job', error);
  }

  await pool.end();
  log('=== FINE CRON JOB ===\n');
}

// Esegui
main().catch(err => {
  logError('Errore fatale', err);
  process.exit(1);
});
