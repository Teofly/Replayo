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

async function autoConfirmPendingBookings(dateStr, twoHoursLater) {
  log('--- AUTO-CONFERMA PRENOTAZIONI PENDING ---');

  try {
    // Query per trovare prenotazioni pending dall'inizio giornata fino a ora+2h
    const query = `
      SELECT
        b.id,
        b.customer_name,
        b.start_time,
        b.end_time,
        c.name as court_name
      FROM bookings b
      JOIN courts c ON b.court_id = c.id
      WHERE b.booking_date = $1
        AND b.status = 'pending'
        AND b.start_time >= '00:00:00'
        AND b.start_time <= $2
      ORDER BY b.start_time ASC
    `;

    const result = await pool.query(query, [dateStr, twoHoursLater]);

    if (result.rows.length === 0) {
      log('Nessuna prenotazione pending da auto-confermare');
      return;
    }

    log(`Trovate ${result.rows.length} prenotazioni pending da auto-confermare:`);

    let confirmedCount = 0;
    let errorCount = 0;

    for (const booking of result.rows) {
      log(`  Confermo: ${booking.court_name} ${booking.start_time}-${booking.end_time} (${booking.customer_name})`);

      try {
        const response = await axios.put(
          `${API_BASE_URL}/bookings/${booking.id}/confirm`,
          {},
          {
            headers: {
              'Authorization': `Basic ${AUTH}`,
              'Content-Type': 'application/json'
            },
            timeout: 10000
          }
        );

        if (response.data) {
          confirmedCount++;
          log(`    ✓ Confermata con successo`);
        }
      } catch (error) {
        errorCount++;
        logError(`    ✗ Errore conferma: ${error.message}`);
      }

      // Piccola pausa tra le conferme
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    log(`Auto-conferma completata: ${confirmedCount} successi, ${errorCount} errori`);

  } catch (error) {
    logError('Errore durante auto-conferma prenotazioni', error);
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
  const currentMinute = italianTime.getMinutes();

  log(`Data: ${dateStr}, Ora corrente italiana: ${currentHour}:${currentMinute} (UTC: ${today.getUTCHours()}:${today.getUTCMinutes()})`);

  // Calcola ora+2h in formato HH:MM per auto-conferma
  const twoHoursLaterDate = new Date(italianTime.getTime() + 2 * 60 * 60 * 1000);
  const twoHoursLater = `${String(twoHoursLaterDate.getHours()).padStart(2, '0')}:${String(twoHoursLaterDate.getMinutes()).padStart(2, '0')}`;

  log(`Finestra auto-conferma: 00:00 → ${twoHoursLater}`);

  try {
    // STEP 1: Auto-conferma prenotazioni pending dall'inizio giornata fino a ora+2h
    await autoConfirmPendingBookings(dateStr, twoHoursLater);

    log('\n--- DOWNLOAD VIDEO ---');

    // STEP 2: Recupera prenotazioni del giorno che necessitano video
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
