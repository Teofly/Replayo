// API Configuration - detect local vs production
const isLocal = window.location.hostname === 'localhost' ||
                window.location.hostname === '127.0.0.1' ||
                window.location.hostname.startsWith('192.168.');
const API_BASE_URL = isLocal ? 'http://192.168.1.175:3000/api' : 'https://api.teofly.it/api';

// Global state
let currentPage = 'overview';
let currentMonth = new Date().getMonth();
let currentYear = new Date().getFullYear();
let selectedDate = null;
let courtsCache = [];
let playersCache = [];
let bookingsCache = [];
let selectedBookingPlayers = []; // Players selected for current booking
let currentSportFilter = null; // Sport filter for timeline

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    setupNavigation();
    setupMobileMenu();
    checkAPIStatus();
    loadOverviewData();
    setupForms();
    setupModals();
});

// Mobile Menu Setup
function setupMobileMenu() {
    const hamburgerBtn = document.getElementById('hamburger-btn');
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');

    if (hamburgerBtn && sidebar && overlay) {
        hamburgerBtn.addEventListener('click', () => {
            sidebar.classList.toggle('open');
            overlay.classList.toggle('active');
        });

        overlay.addEventListener('click', () => {
            sidebar.classList.remove('open');
            overlay.classList.remove('active');
        });

        // Close sidebar when clicking a nav item on mobile
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', () => {
                if (window.innerWidth <= 834) {
                    sidebar.classList.remove('open');
                    overlay.classList.remove('active');
                }
            });
        });
    }
}

// Navigation
function setupNavigation() {
    const navItems = document.querySelectorAll('.nav-item');

    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const page = item.dataset.page;
            navigateTo(page);
        });
    });
}

function navigateTo(page) {
    // Update nav items
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
        if (item.dataset.page === page) {
            item.classList.add('active');
        }
    });

    // Update pages
    document.querySelectorAll('.page').forEach(p => {
        p.classList.remove('active');
    });
    const pageEl = document.getElementById(`page-${page}`);
    if (pageEl) pageEl.classList.add('active');

    // Update page title
    const pageTitles = {
        'overview': 'Overview',
        'bookings': 'Prenotazioni',
        'courts': 'Gestione Campi',
        'players': 'Anagrafica Giocatori',
        'partitaes': 'Create Match',
        'manage-partitaes': 'Manage Matches',
        'videos': 'Videos',
        'users': 'Users',
        'storage': 'Storage'
    };
    document.getElementById('page-title').textContent = pageTitles[page] || page;

    currentPage = page;

    // Load page-specific data
    if (page === 'overview') {
        loadOverviewData();
    } else if (page === 'storage') {
        loadStorageInfo();
    } else if (page === 'bookings') {
        loadCourts();
        renderCalendar();
    } else if (page === 'courts') {
        loadCourts().then(() => renderCourtsList());
    } else if (page === 'players') {
        loadPlayers();
    }
}

// API Status Check
async function checkAPIStatus() {
    const statusEl = document.getElementById("api-status");
    const envStatusEl = document.getElementById("env-status");
    try {
        const response = await fetch(`${API_BASE_URL}/status/environment`);
        const data = await response.json();
        if (data.success && data.status) {
            const s = data.status;
            statusEl.textContent = "🟢 Sistema Online";
            statusEl.style.color = "var(--success)";
            const uptimeMin = Math.floor(s.server.uptime / 60);
            const uptimeHrs = Math.floor(uptimeMin / 60);
            const uptimeStr = uptimeHrs > 0 ? `${uptimeHrs}h ${uptimeMin % 60}m` : `${uptimeMin}m`;
            envStatusEl.innerHTML = `
                <p><strong>Server:</strong> <span style="color: var(--success)">🟢 Online</span> (uptime: ${uptimeStr})</p>
                <p><strong>API:</strong> <span style="color: var(--success)">🟢 Connesso</span> - <code>${API_BASE_URL}</code></p>
                <p><strong>Database:</strong> <span style="color: ${s.database.status === "connected" ? "var(--success)" : "var(--danger)"}">${s.database.status === "connected" ? "🟢" : "🔴"} ${s.database.status}</span> (${s.database.name || "N/A"})</p>
                <p><strong>NAS Storage:</strong> <span style="color: ${s.nas.status === "mounted" ? "var(--success)" : "var(--danger)"}">${s.nas.status === "mounted" ? "🟢" : "🔴"} ${s.nas.status}</span></p>
                <hr style="border-color: var(--border); margin: 0.5rem 0;">
                <p><strong>Dipendenze:</strong></p>
                <p style="margin-left: 1rem;">• Node.js: ${s.dependencies.nodejs}</p>
                <p style="margin-left: 1rem;">• PM2: ${s.dependencies.pm2}</p>
                <p style="color: var(--text-secondary); font-size: 0.8rem; margin-top: 0.5rem;">Ultimo check: ${new Date(s.timestamp).toLocaleString()}</p>
            `;
        } else { throw new Error("Invalid response"); }
    } catch (error) {
        statusEl.textContent = "🔴 Sistema Offline";
        statusEl.style.color = "var(--danger)";
        envStatusEl.innerHTML = `
            <p style="color: var(--danger)">Impossibile connettersi al sistema</p>
            <p style="color: var(--text-secondary)">URL: ${API_BASE_URL}</p>
            <p style="color: var(--text-secondary)">Errore: ${error.message}</p>
        `;
    }
}
async function loadOverviewData() {
    try {
        const response = await fetch(`${API_BASE_URL}/stats/storage`);
        const data = await response.json();

        document.getElementById('total-videos').textContent = data.totalVideos || '0';
        document.getElementById('total-storage').textContent = formatBytes(data.totalSize || 0);
        document.getElementById('total-views').textContent = data.totalViews || '0';
        document.getElementById('total-downloads').textContent = data.totalDownloads || '0';
    } catch (error) {
        console.error('Error loading overview data:', error);
    }
}

// ==========================================
// COURTS MANAGEMENT
// ==========================================
async function loadCourts() {
    try {
        const response = await fetch(`${API_BASE_URL}/courts`);
        const data = await response.json();
        console.log('Courts API response:', data);

        // API returns 'bookings' key instead of 'courts'
        let rawCourts = data.courts || data.bookings || [];

        // If data itself is an array, use it directly
        if (Array.isArray(data)) {
            rawCourts = data;
        }

        // Ensure rawCourts is an array
        if (!Array.isArray(rawCourts)) {
            console.error('Courts data is not an array:', rawCourts);
            courtsCache = [];
            return [];
        }

        // Map API field names to frontend expected names
        courtsCache = rawCourts.map(c => ({
            ...c,
            default_duration_minutes: c.slot_duration_minutes || c.default_duration_minutes || 90,
            price_per_hour: parseFloat(c.price_per_hour) || 15,
            num_players: parseInt(c.num_players) || 4,
            price_per_player: parseFloat(c.price_per_player) || 0
        }));
        console.log('Mapped courts:', courtsCache);
        return courtsCache;
    } catch (error) {
        console.error('Error loading courts:', error);
        courtsCache = [];
        return [];
    }
}

function renderCourtsList() {
    const container = document.getElementById('courts-list');
    if (!container) return;

    // Ensure courtsCache is an array
    if (!Array.isArray(courtsCache) || courtsCache.length === 0) {
        container.innerHTML = '<p style="color: var(--text-secondary)">Nessun campo configurato</p>';
        return;
    }

    container.innerHTML = courtsCache.map(court => `
        <div class="court-card">
            <div class="court-card-header">
                <div>
                    <h4 style="color: var(--accent-primary); margin-bottom: 0.5rem;">${court.name}</h4>
                    <span class="court-type-badge ${court.sport_type}">${court.sport_type}</span>
                </div>
                <div class="match-card-actions">
                    <button class="btn btn-primary btn-small" onclick="editCourt('${court.id}')">Modifica</button>
                    <button class="btn btn-danger btn-small" onclick="deleteCourt('${court.id}', '${court.name}')">Elimina</button>
                </div>
            </div>
            <div class="match-card-body">
                <div class="match-detail">
                    <span class="match-detail-label">Durata Slot</span>
                    <span class="match-detail-value">${court.default_duration_minutes} min</span>
                </div>
                <div class="match-detail">
                    <span class="match-detail-label">N. Giocatori</span>
                    <span class="match-detail-value">${court.num_players}</span>
                </div>
                <div class="match-detail">
                    <span class="match-detail-label">Prezzo Campo</span>
                    <span class="match-detail-value">${(court.price_per_player * court.num_players).toFixed(2)} EUR</span>
                </div>
                <div class="match-detail">
                    <span class="match-detail-label">Prezzo/Giocatore</span>
                    <span class="match-detail-value">${court.price_per_player.toFixed(2)} EUR</span>
                </div>
                <div class="match-detail">
                    <span class="match-detail-label">Stato</span>
                    <span class="badge ${court.is_active ? 'badge-active' : 'badge-inactive'}">
                        ${court.is_active ? 'Attivo' : 'Disattivo'}
                    </span>
                </div>
            </div>
        </div>
    `).join('');
}

async function editCourt(courtId) {
    const court = courtsCache.find(c => c.id === courtId);
    if (!court) return;

    document.getElementById('court-modal-title').textContent = 'Modifica Campo';
    document.getElementById('court-id').value = court.id;
    document.getElementById('court-name').value = court.name;
    document.getElementById('court-sport-type').value = court.sport_type;
    document.getElementById('court-duration').value = court.default_duration_minutes;
    document.getElementById("court-price").value = court.price_per_player || court.price_per_hour;
    document.getElementById("court-num-players").value = court.num_players || 4;
    document.getElementById('court-description').value = court.description || '';
    document.getElementById('court-is-active').checked = court.is_active;

    document.getElementById('court-modal').style.display = 'flex';
}

async function deleteCourt(courtId, courtName) {
    if (!confirm(`Eliminare il campo "${courtName}"?`)) return;

    try {
        const response = await fetch(`${API_BASE_URL}/courts/${courtId}`, {
            method: 'DELETE'
        });
        if (response.ok) {
            await loadCourts();
            renderCourtsList();
        }
    } catch (error) {
        alert('Errore eliminazione campo: ' + error.message);
    }
}

// ==========================================
// PLAYERS MANAGEMENT
// ==========================================
async function loadPlayers(search = '') {
    try {
        const url = search
            ? `${API_BASE_URL}/players/search?q=${encodeURIComponent(search)}`
            : `${API_BASE_URL}/players`;
        const response = await fetch(url);
        const data = await response.json();
        playersCache = data.players || data || [];
        renderPlayersList();
    } catch (error) {
        console.error('Error loading players:', error);
        playersCache = [];
    }
}

function renderPlayersList() {
    const container = document.getElementById('players-list');
    if (!container) return;

    if (playersCache.length === 0) {
        container.innerHTML = '<p style="color: var(--text-secondary)">Nessun giocatore trovato</p>';
        return;
    }

    container.innerHTML = playersCache.map(player => `
        <div class="player-card">
            <div class="player-avatar">${(player.first_name || '?')[0]}${(player.last_name || '?')[0]}</div>
            <div class="player-info">
                <h4>${player.first_name || ''} ${player.last_name || ''}</h4>
                <p>${player.email || '-'} | ${player.phone || '-'}</p>
            </div>
            <div class="player-actions">
                <button class="btn btn-primary btn-small" onclick="editPlayer('${player.id}')">Modifica</button>
                <button class="btn btn-danger btn-small" onclick="deletePlayer('${player.id}', '${player.first_name} ${player.last_name}')">Elimina</button>
            </div>
        </div>
    `).join('');
}

async function editPlayer(playerId) {
    const player = playersCache.find(p => p.id === playerId);
    if (!player) return;

    document.getElementById('player-modal-title').textContent = 'Modifica Giocatore';
    document.getElementById('player-id').value = player.id;
    document.getElementById('player-first-name').value = player.first_name;
    document.getElementById('player-last-name').value = player.last_name;
    document.getElementById('player-email').value = player.email || '';
    document.getElementById('player-phone').value = player.phone || '';
    document.getElementById('player-notes').value = player.notes || '';

    document.getElementById('player-modal').style.display = 'flex';
}

async function deletePlayer(playerId, playerName) {
    if (!confirm(`Eliminare "${playerName}" dall'anagrafica?`)) return;

    try {
        const response = await fetch(`${API_BASE_URL}/players/${playerId}`, {
            method: 'DELETE'
        });
        if (response.ok) {
            loadPlayers();
        }
    } catch (error) {
        alert('Errore eliminazione giocatore: ' + error.message);
    }
}

// ==========================================
// BOOKINGS & CALENDAR
// ==========================================
function renderCalendar() {
    const grid = document.getElementById('calendar-grid');
    const monthYearEl = document.getElementById('calendar-month-year');
    if (!grid || !monthYearEl) return;

    const months = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
                    'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];
    monthYearEl.textContent = `${months[currentMonth]} ${currentYear}`;

    const firstDay = new Date(currentYear, currentMonth, 1);
    const lastDay = new Date(currentYear, currentMonth + 1, 0);
    const startDay = (firstDay.getDay() + 6) % 7; // Monday = 0

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let html = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom']
        .map(d => `<div class="calendar-day-header">${d}</div>`).join('');

    // Empty cells before first day
    for (let i = 0; i < startDay; i++) {
        html += '<div class="calendar-day" style="opacity: 0.3;"></div>';
    }

    // Days of month
    for (let day = 1; day <= lastDay.getDate(); day++) {
        const date = new Date(currentYear, currentMonth, day);
        const dateStr = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
        const isToday = date.getTime() === today.getTime();
        const isSelected = selectedDate === dateStr;

        html += `
            <div class="calendar-day ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''}"
                 onclick="selectDate('${dateStr}')" data-date="${dateStr}">
                ${day}
            </div>
        `;
    }

    grid.innerHTML = html;
    loadMonthBookings();

    // Seleziona automaticamente oggi se siamo nel mese corrente
    const now = new Date();
    if (currentYear === now.getFullYear() && currentMonth === now.getMonth()) {
        const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
        if (!selectedDate || selectedDate !== todayStr) {
            selectDate(todayStr);
        }
    }
}

async function loadMonthBookings() {
    try {
        const startDate = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-01`;
        const endDate = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-31`;

        const response = await fetch(`${API_BASE_URL}/bookings?from_date=${startDate}&to_date=${endDate}`);
        const data = await response.json();
        bookingsCache = data.bookings || data || [];

        // Mark days with bookings
        bookingsCache.forEach(booking => {
            const bookingDate = booking.booking_date.split('T')[0];
            const dayEl = document.querySelector(`.calendar-day[data-date="${bookingDate}"]`);
            if (dayEl) {
                dayEl.classList.add('has-bookings');
            }
        });
    } catch (error) {
        console.error('Error loading bookings:', error);
    }
}

function selectDate(dateStr) {
    selectedDate = dateStr;

    // Update selected state in calendar
    document.querySelectorAll('.calendar-day').forEach(d => d.classList.remove('selected'));
    const selectedEl = document.querySelector(`.calendar-day[data-date="${dateStr}"]`);
    if (selectedEl) selectedEl.classList.add('selected');

    // Update display - parse date parts to avoid timezone issues
    const displayEl = document.getElementById('selected-date-display');
    if (displayEl) {
        const [year, month, day] = dateStr.split('-').map(Number);
        const date = new Date(year, month - 1, day); // month is 0-indexed
        displayEl.textContent = date.toLocaleDateString('it-IT', {
            weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
        });
    }

    renderDailyTimeline(dateStr);
}

async function renderDailyTimeline(dateStr) {
    const container = document.getElementById('daily-bookings-timeline');
    if (!container) return;

    // Reload bookings for this specific date
    try {
        const response = await fetch(`${API_BASE_URL}/bookings?from_date=${dateStr}&to_date=${dateStr}`);
        const data = await response.json();
        const dayBookings = (data.bookings || data || []).filter(b => b.booking_date.split('T')[0] === dateStr);

        if (courtsCache.length === 0) {
            await loadCourts();
        }

        // Build timeline from 8:00 to 22:00
        const startHour = 8;
        const endHour = 22;
        const hoursCount = endHour - startHour;
        const slotResolution = 30; // 30-min slots
        const totalSlots = hoursCount * (60 / slotResolution);

        // Header allineato con 28 slot (ogni ora = 2 slot da 30min)
        let html = `
            <div class="timeline-header">
                <div class="timeline-court-label">Campo</div>
                <div class="timeline-hours-container">
                    ${Array.from({length: hoursCount}, (_, i) =>
                        `<div class="timeline-hour-label">${startHour + i}:00</div>`
                    ).join('')}
                </div>
            </div>
        `;

        courtsCache.forEach(court => {
            const courtBookings = dayBookings.filter(b => b.court_id === court.id);
            const defaultDuration = court.default_duration_minutes || court.default_duration_minutes || 90;

            html += `<div class="timeline-row" data-sport="${court.sport_type || ''}">`;
            html += `<div class="timeline-court-name">${court.name}</div>`;
            html += `<div class="timeline-slots-container">`;

            // Track which slots are occupied
            const occupiedSlots = new Set();

            // First, render all bookings as unified bars
            courtBookings.forEach(booking => {
                const bookingStart = booking.start_time.substring(0, 5);
                const [bStartH, bStartM] = bookingStart.split(':').map(Number);
                const bookingStartMin = bStartH * 60 + bStartM;
                const duration = booking.duration_minutes || defaultDuration;

                // Calculate position and width as percentages
                const timelineStartMin = startHour * 60;
                const timelineTotalMin = hoursCount * 60;

                const leftPercent = ((bookingStartMin - timelineStartMin) / timelineTotalMin) * 100;
                const widthPercent = (duration / timelineTotalMin) * 100;

                // Mark slots as occupied
                for (let m = bookingStartMin; m < bookingStartMin + duration; m += slotResolution) {
                    occupiedSlots.add(m);
                }

                const endTime = (() => {
                    const endMin = bookingStartMin + duration;
                    const h = Math.floor(endMin / 60);
                    const m = endMin % 60;
                    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
                })();

                html += `
                    <div class="timeline-booking-bar status-${booking.status || "pending"} sport-${court.sport_type || 'other'}"
                         style="left: ${leftPercent}%; width: ${widthPercent}%;"
                         title="${booking.customer_name} | ${bookingStart} - ${endTime}"
                         onclick="showBookingDetails('${booking.id}')">
                        <span class="booking-name">${booking.customer_name}</span>
                        <span class="booking-time">${bookingStart}-${endTime}</span>
                    </div>
                `;
            });

            // Render empty slots for clicking
            for (let slot = 0; slot < totalSlots; slot++) {
                const slotMinutes = slot * slotResolution;
                const slotAbsoluteMin = startHour * 60 + slotMinutes;
                const slotHour = Math.floor(slotAbsoluteMin / 60);
                const slotMin = slotAbsoluteMin % 60;
                const slotTime = `${String(slotHour).padStart(2, '0')}:${String(slotMin).padStart(2, '0')}`;

                const isOccupied = occupiedSlots.has(slotAbsoluteMin);

                html += `
                    <div class="timeline-slot ${isOccupied ? 'occupied' : ''}"
                         ${!isOccupied ? `onclick="quickBook('${court.id}', '${dateStr}', '${slotTime}')"` : ''}
                         title="${isOccupied ? 'Prenotato' : `Prenota ${slotTime}`}">
                    </div>
                `;
            }

            html += `</div></div>`;
        });

        container.innerHTML = html;

        // Re-apply sport filter if active
        if (typeof currentSportFilter !== 'undefined' && currentSportFilter !== null) {
            filterBySport(currentSportFilter);
        }

    } catch (error) {
        console.error('Error rendering timeline:', error);
        container.innerHTML = '<p style="color: var(--danger)">Errore caricamento timeline</p>';
    }
}

function quickBook(courtId, date, time) {
    // Reset form e prepara per nuova prenotazione
    document.getElementById('booking-form').reset();
    delete document.getElementById('booking-form').dataset.editingId;
    document.getElementById('booking-submit-btn').textContent = 'Crea Prenotazione';
    clearSelectedPlayers();

    // Popola select campi e imposta il campo cliccato
    populateCourtSelect();
    document.getElementById('booking-court').value = courtId;
    document.getElementById('booking-date').value = date;

    // Carica slot e seleziona quello cliccato
    loadAvailableSlots(courtId, date).then(() => {
        const slotEl = document.querySelector(`.timeline-slot[data-time="${time}"]`);
        if (slotEl) {
            document.querySelectorAll(".timeline-slot.selected").forEach(s => s.classList.remove("selected"));
            slotEl.classList.add("selected");
        }
        document.getElementById('booking-time').value = time;
        document.getElementById('selected-slot-info').textContent = `Orario selezionato: ${time}`;
    });

    document.getElementById('booking-modal').style.display = 'flex';
}

// ==========================================
// BOOKING DETAILS MODAL
// ==========================================
let currentBookingDetails = null;

async function showBookingDetails(bookingId) {
    const modal = document.getElementById('booking-details-modal');
    const contentEl = document.getElementById('booking-details-content');
    const confirmBtn = document.getElementById('confirm-booking-btn');

    contentEl.innerHTML = '<p>Caricamento...</p>';
    modal.style.display = 'flex';

    try {
        const response = await fetch(`${API_BASE_URL}/bookings/${bookingId}`);
        const data = await response.json();
        const booking = data.booking || data;

        if (!booking) {
            contentEl.innerHTML = '<p style="color: var(--danger)">Prenotazione non trovata</p>';
            return;
        }

        currentBookingDetails = booking;

        // Get court name
        const court = courtsCache.find(c => c.id === booking.court_id);
        const courtName = court ? court.name : 'Campo sconosciuto';

        // Format date
        const bookingDate = booking.booking_date.split('T')[0];
        const [year, month, day] = bookingDate.split('-');
        const dateObj = new Date(year, month - 1, day);
        const formattedDate = dateObj.toLocaleDateString('it-IT', {
            weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
        });

        // Status badge
        const statusColors = {
            'pending': 'var(--warning)',
            'confirmed': 'var(--success)',
            'cancelled': 'var(--danger)'
        };
        const statusLabels = {
            'pending': 'In attesa',
            'confirmed': 'Confermata',
            'cancelled': 'Cancellata'
        };

        contentEl.innerHTML = `
            <div class="booking-details-grid">
                <div class="booking-detail-item">
                    <span class="detail-label">Stato</span>
                    <span class="detail-value" style="color: ${statusColors[booking.status] || 'var(--text-primary)'}; font-weight: 700;">
                        ${statusLabels[booking.status] || booking.status}
                    </span>
                </div>
                <div class="booking-detail-item">
                    <span class="detail-label">Campo</span>
                    <span class="detail-value">${courtName}</span>
                </div>
                <div class="booking-detail-item">
                    <span class="detail-label">Data</span>
                    <span class="detail-value">${formattedDate}</span>
                </div>
                <div class="booking-detail-item">
                    <span class="detail-label">Orario</span>
                    <span class="detail-value">${booking.start_time?.substring(0, 5)} - ${booking.end_time?.substring(0, 5)}</span>
                </div>
                <div class="booking-detail-item">
                    <span class="detail-label">Cliente</span>
                    <span class="detail-value">${booking.customer_name || '-'}</span>
                </div>
                <div class="booking-detail-item">
                    <span class="detail-label">Email</span>
                    <span class="detail-value">${booking.customer_email || '-'}</span>
                </div>
                <div class="booking-detail-item">
                    <span class="detail-label">Telefono</span>
                    <span class="detail-value">${booking.customer_phone || '-'}</span>
                </div>
                <div class="booking-detail-item">
                    <span class="detail-label">Giocatori</span>
                    <span class="detail-value">${booking.num_players || '-'}</span>
                </div>
                <div class="booking-detail-item">
                    <span class="detail-label">Prezzo Totale</span>
                    <span class="detail-value">${booking.total_price ? booking.total_price + ' EUR' : '-'}</span>
                </div>
                ${booking.notes ? `
                <div class="booking-detail-item" style="grid-column: 1 / -1;">
                    <span class="detail-label">Note</span>
                    <span class="detail-value">${booking.notes}</span>
                </div>
                ` : ''}
            </div>
        `;

        // Show confirm button only for pending bookings
        confirmBtn.style.display = booking.status === 'pending' ? 'inline-block' : 'none';

    } catch (error) {
        console.error('Error loading booking details:', error);
        contentEl.innerHTML = '<p style="color: var(--danger)">Errore caricamento dettagli</p>';
    }
}

async function confirmBooking() {
    if (!currentBookingDetails) return;

    try {
        // Prepara player_names dal booking (usa customer_name come fallback)
        const playerNames = currentBookingDetails.player_names ||
            (currentBookingDetails.players ? currentBookingDetails.players.map(p => p.player_name || p.name) : null) ||
            [currentBookingDetails.customer_name];

        const response = await fetch(`${API_BASE_URL}/bookings/${currentBookingDetails.id}/confirm`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ player_names: playerNames })
        });

        const data = await response.json();

        if (response.ok) {
            document.getElementById('booking-details-modal').style.display = 'none';
            if (selectedDate) renderDailyTimeline(selectedDate);
        } else {
            throw new Error(data.error || 'Errore conferma');
        }
    } catch (error) {
        alert('Errore: ' + error.message);
    }
}

async function deleteBooking() {
    if (!currentBookingDetails) return;

    try {
        const response = await fetch(`${API_BASE_URL}/bookings/${currentBookingDetails.id}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            document.getElementById('booking-details-modal').style.display = 'none';
            if (selectedDate) renderDailyTimeline(selectedDate);
            renderCalendar();
        } else {
            const data = await response.json();
            throw new Error(data.error || 'Errore eliminazione');
        }
    } catch (error) {
        alert('Errore: ' + error.message);
    }
}

function editBookingFromDetails() {
    if (!currentBookingDetails) return;

    const booking = currentBookingDetails;

    // Close details modal
    document.getElementById('booking-details-modal').style.display = 'none';

    // First populate court select
    populateCourtSelect();

    // Set the court first
    document.getElementById('booking-court').value = booking.court_id;
    document.getElementById('booking-date').value = booking.booking_date.split('T')[0];
    document.getElementById('booking-customer-name').value = booking.customer_name || '';
    document.getElementById('booking-customer-email').value = booking.customer_email || '';
    document.getElementById('booking-customer-phone').value = booking.customer_phone || '';
    document.getElementById('booking-num-players').value = booking.num_players || 4;
    document.getElementById('booking-notes').value = booking.notes || '';

    // Load slots and select the current time in timeline
    const startTime = booking.start_time?.substring(0, 5);
    loadAvailableSlots(booking.court_id, booking.booking_date.split('T')[0]).then(() => {
        document.getElementById('booking-time').value = startTime;
        // Select the slot visually in the timeline
        const slotEl = document.querySelector(`.timeline-slot[data-time="${startTime}"]`);
        if (slotEl) {
            document.querySelectorAll('.timeline-slot.selected').forEach(s => s.classList.remove('selected'));
            slotEl.classList.add('selected');
        }
    });

    // Mark form as editing existing booking
    document.getElementById('booking-form').dataset.editingId = booking.id;
    document.getElementById('booking-submit-btn').textContent = 'Modifica Prenotazione';

    document.getElementById('booking-modal').style.display = 'flex';
}

async function loadAvailableSlots(courtId, date) {
    const slotsContainer = document.getElementById('booking-timeline-slots');
    const timeInput = document.getElementById('booking-time');
    
    if (!slotsContainer) {
        console.error('booking-timeline-slots container not found');
        return;
    }

    slotsContainer.innerHTML = '<div class="loading-slots">Caricamento orari...</div>';

    try {
        const response = await fetch(`${API_BASE_URL}/bookings/available-slots?court_id=${courtId}&date=${date}`);
        const data = await response.json();
        const slots = data.slots || data || [];

        if (!Array.isArray(slots) || slots.length === 0) {
            slotsContainer.innerHTML = '<div class="no-slots">Nessuno slot disponibile per questa data</div>';
            return;
        }

        let html = '<div class="timeline-grid">';
        slots.forEach(slot => {
            const startTime = typeof slot === 'object' ? slot.start_time : slot;
            const endTime = typeof slot === 'object' ? slot.end_time : '';
            const price = typeof slot === 'object' ? slot.price : '';
            const isAvailable = typeof slot === 'object' ? slot.is_available !== false : true;
            
            const statusClass = isAvailable ? 'available' : 'occupied';
            const priceLabel = price ? `€${price}` : '';
            
            html += `
                <div class="timeline-slot ${statusClass}" onclick="selectBookingSlot(this, '${startTime}')" data-time="${startTime}">
                    <span class="slot-time">${startTime}</span>
                    ${endTime ? `<span class="slot-end">- ${endTime}</span>` : ''}
                    ${priceLabel ? `<span class="slot-price">${priceLabel}</span>` : ''}
                </div>
            `;
        });
        html += '</div>';
        
        slotsContainer.innerHTML = html;
    } catch (error) {
        console.error('Error loading slots:', error);
        slotsContainer.innerHTML = '<div class="error-slots">Errore nel caricamento degli orari</div>';
    }
}

function selectBookingSlot(el, time) {
    if (el.classList.contains('occupied')) {
        return;
    }
    
    // Remove previous selection
    document.querySelectorAll('.timeline-slot.selected').forEach(s => s.classList.remove('selected'));
    
    // Add selection to clicked slot
    el.classList.add('selected');
    
    // Set hidden input value
    const timeInput = document.getElementById('booking-time');
    if (timeInput) {
        timeInput.value = time;
    }
}
// ==========================================
// PLAYER SELECTION FOR BOOKINGS
// ==========================================
function setupPlayerSearch() {
    const searchInput = document.getElementById('booking-player-search');
    const suggestionsDiv = document.getElementById('player-suggestions');

    if (!searchInput || !suggestionsDiv) return;

    // Search as you type
    searchInput.addEventListener('input', async (e) => {
        const query = e.target.value.trim();
        if (query.length < 2) {
            suggestionsDiv.style.display = 'none';
            return;
        }

        try {
            const response = await fetch(`${API_BASE_URL}/players/search?q=${encodeURIComponent(query)}`);
            const data = await response.json();
            const players = data.players || data || [];

            if (players.length === 0) {
                suggestionsDiv.innerHTML = '<div style="padding: 0.75rem; color: var(--text-secondary);">Nessun risultato - premi Invio per aggiungere</div>';
            } else {
                suggestionsDiv.innerHTML = players.map(p => `
                    <div class="player-suggestion" data-id="${p.id}" data-name="${p.first_name} ${p.last_name}"
                         style="padding: 0.75rem; cursor: pointer; border-bottom: 1px solid rgba(0,255,245,0.1);"
                         onmouseover="this.style.background='rgba(0,255,245,0.1)'"
                         onmouseout="this.style.background='transparent'">
                        <strong>${p.first_name} ${p.last_name}</strong>
                        <small style="color: var(--text-secondary); margin-left: 0.5rem;">${p.email || p.phone || ''}</small>
                    </div>
                `).join('');

                // Add click handlers
                suggestionsDiv.querySelectorAll('.player-suggestion').forEach(el => {
                    el.addEventListener('click', () => {
                        addPlayerToBooking(el.dataset.id, el.dataset.name, true);
                        searchInput.value = '';
                        suggestionsDiv.style.display = 'none';
                    });
                });
            }
            suggestionsDiv.style.display = 'block';
        } catch (error) {
            console.error('Error searching players:', error);
        }
    });

    // Press Enter to add free-form name
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const name = searchInput.value.trim();
            if (name) {
                addPlayerToBooking(null, name, false);
                searchInput.value = '';
                suggestionsDiv.style.display = 'none';
            }
        }
    });

    // Hide suggestions when clicking outside
    document.addEventListener('click', (e) => {
        if (!searchInput.contains(e.target) && !suggestionsDiv.contains(e.target)) {
            suggestionsDiv.style.display = 'none';
        }
    });
}

function addPlayerToBooking(playerId, playerName, isRegistered) {
    // Check if already added
    if (selectedBookingPlayers.some(p => p.name === playerName)) {
        return;
    }

    selectedBookingPlayers.push({
        id: playerId,
        name: playerName,
        isRegistered: isRegistered
    });

    renderSelectedPlayers();
    updateNumPlayers();
}

function removePlayerFromBooking(playerName) {
    selectedBookingPlayers = selectedBookingPlayers.filter(p => p.name !== playerName);
    renderSelectedPlayers();
    updateNumPlayers();
}

function renderSelectedPlayers() {
    const container = document.getElementById('selected-players');
    if (!container) return;

    container.innerHTML = selectedBookingPlayers.map(p => `
        <span style="display: inline-flex; align-items: center; gap: 0.5rem;
                     background: ${p.isRegistered ? 'rgba(0,255,245,0.2)' : 'rgba(255,170,0,0.2)'};
                     color: ${p.isRegistered ? 'var(--accent-primary)' : 'var(--warning)'};
                     padding: 0.25rem 0.75rem; border-radius: 20px; font-size: 0.85rem;">
            ${p.isRegistered ? '✓' : '?'} ${p.name}
            <button type="button" onclick="removePlayerFromBooking('${p.name}')"
                    style="background: none; border: none; color: inherit; cursor: pointer; font-size: 1rem;">×</button>
        </span>
    `).join('');
}

function updateNumPlayers() {
    const numPlayersInput = document.getElementById('booking-num-players');
    if (numPlayersInput && selectedBookingPlayers.length > 0) {
        numPlayersInput.value = selectedBookingPlayers.length;
    }
}

function clearSelectedPlayers() {
    selectedBookingPlayers = [];
    renderSelectedPlayers();
}

// ==========================================
// MODALS SETUP
// ==========================================
function setupModals() {
    // Calendar navigation
    document.getElementById('prev-month')?.addEventListener('click', () => {
        currentMonth--;
        if (currentMonth < 0) {
            currentMonth = 11;
            currentYear--;
        }
        renderCalendar();
    });

    document.getElementById('next-month')?.addEventListener('click', () => {
        currentMonth++;
        if (currentMonth > 11) {
            currentMonth = 0;
            currentYear++;
        }
        renderCalendar();
    });

    // New booking button - propone data odierna, campo da selezionare
    document.getElementById('new-booking-btn')?.addEventListener('click', () => {
        document.getElementById('booking-form').reset();
        delete document.getElementById('booking-form').dataset.editingId;
        document.getElementById('booking-submit-btn').textContent = 'Crea Prenotazione';
        clearSelectedPlayers();
        populateCourtSelect();

        // Imposta data odierna
        const today = new Date().toISOString().split('T')[0];
        document.getElementById('booking-date').value = today;

        // Pulisci timeline slot (utente deve scegliere campo prima)
        document.getElementById('booking-timeline-slots').innerHTML = '<p style="color: var(--text-secondary); padding: 1rem;">Seleziona un campo per vedere gli orari disponibili</p>';
        document.getElementById('selected-slot-info').textContent = '';

        document.getElementById('booking-modal').style.display = 'flex';
    });

    // Setup player search for bookings
    setupPlayerSearch();

    // Cancel booking
    document.getElementById('cancel-booking')?.addEventListener('click', () => {
        document.getElementById('booking-modal').style.display = 'none';
    });

    // Booking form submit
    document.getElementById('booking-form')?.addEventListener('submit', handleBookingSubmit);

    // Booking court/date change
    document.getElementById('booking-court')?.addEventListener('change', () => {
        const courtId = document.getElementById('booking-court').value;
        const date = document.getElementById('booking-date').value;
        if (courtId && date) loadAvailableSlots(courtId, date);
    });

    document.getElementById('booking-date')?.addEventListener('change', () => {
        const courtId = document.getElementById('booking-court').value;
        const date = document.getElementById('booking-date').value;
        if (courtId && date) loadAvailableSlots(courtId, date);
    });

    // New court button
    document.getElementById('new-court-btn')?.addEventListener('click', () => {
        document.getElementById('court-form').reset();
        document.getElementById('court-id').value = '';
        document.getElementById('court-modal-title').textContent = 'Nuovo Campo';
        document.getElementById('court-is-active').checked = true;
        document.getElementById('court-modal').style.display = 'flex';
    });

    // Cancel court
    document.getElementById('cancel-court')?.addEventListener('click', () => {
        document.getElementById('court-modal').style.display = 'none';
    });

    // Court form submit
    document.getElementById('court-form')?.addEventListener('submit', handleCourtSubmit);

    // New player button
    document.getElementById('new-player-btn')?.addEventListener('click', () => {
        document.getElementById('player-form').reset();
        document.getElementById('player-id').value = '';
        document.getElementById('player-modal-title').textContent = 'Nuovo Giocatore';
        document.getElementById('player-modal').style.display = 'flex';
    });

    // Cancel player
    document.getElementById('cancel-player')?.addEventListener('click', () => {
        document.getElementById('player-modal').style.display = 'none';
    });

    // Player form submit
    document.getElementById('player-form')?.addEventListener('submit', handlePlayerSubmit);

    // Player search
    document.getElementById('player-search')?.addEventListener('input', (e) => {
        clearTimeout(window.playerSearchTimeout);
        window.playerSearchTimeout = setTimeout(() => {
            loadPlayers(e.target.value);
        }, 300);
    });

    // Close video modal
    document.getElementById('close-video-modal')?.addEventListener('click', () => {
        document.getElementById('video-player-modal').style.display = 'none';
        document.getElementById('video-player-container').innerHTML = '';
    });

    // Booking details modal buttons
    document.getElementById('close-booking-details')?.addEventListener('click', () => {
        document.getElementById('booking-details-modal').style.display = 'none';
    });

    document.getElementById('confirm-booking-btn')?.addEventListener('click', confirmBooking);
    document.getElementById('delete-booking-btn')?.addEventListener('click', deleteBooking);
    document.getElementById('edit-booking-btn')?.addEventListener('click', editBookingFromDetails);
}

function populateCourtSelect() {
    const select = document.getElementById('booking-court');
    if (!select) return;

    select.innerHTML = '<option value="">Seleziona campo...</option>' +
        courtsCache.filter(c => c.is_active).map(court =>
            `<option value="${court.id}">${court.name} (${court.sport_type})</option>`
        ).join('');
}

async function handleBookingSubmit(e) {
    e.preventDefault();

    const courtId = document.getElementById('booking-court').value;
    const date = document.getElementById('booking-date').value;
    const time = document.getElementById('booking-time').value;

    if (!courtId || !date || !time) {
        alert('Seleziona campo, data e orario');
        return;
    }

    // Calculate end_time based on court's slot duration
    const court = courtsCache.find(c => String(c.id) === String(courtId));
    const slotDuration = court ? (court.default_duration_minutes || court.default_duration_minutes || 90) : 90;

    // Parse start time and add duration
    const [startHour, startMin] = time.split(':').map(Number);
    const startMinutes = startHour * 60 + startMin;
    const endMinutes = startMinutes + slotDuration;
    const endHour = Math.floor(endMinutes / 60);
    const endMin = endMinutes % 60;
    const endTime = `${String(endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}`;

    const formData = {
        court_id: courtId,
        booking_date: date,
        start_time: time,
        end_time: endTime,
        customer_name: document.getElementById('booking-customer-name').value,
        customer_email: document.getElementById('booking-customer-email').value,
        customer_phone: document.getElementById('booking-customer-phone').value,
        num_players: parseInt(document.getElementById('booking-num-players').value) || 4,
        notes: document.getElementById('booking-notes').value,
        players: selectedBookingPlayers.map(p => ({
            player_id: p.id,
            player_name: p.name,
            is_registered: p.isRegistered
        }))
    };

    try {
        // Check if editing existing booking
        const editingId = document.getElementById('booking-form').dataset.editingId;
        const url = editingId ? `${API_BASE_URL}/bookings/${editingId}` : `${API_BASE_URL}/bookings`;
        const method = editingId ? 'PUT' : 'POST';

        const response = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(formData)
        });

        const data = await response.json();

        if (response.ok && (data.success || data.booking)) {
            document.getElementById('booking-modal').style.display = 'none';
            document.getElementById('booking-form').reset();
delete document.getElementById('booking-form').dataset.editingId;        document.getElementById('booking-submit-btn').textContent = 'Crea Prenotazione';
            delete document.getElementById('booking-form').dataset.editingId;
            clearSelectedPlayers();
            renderCalendar();
            if (selectedDate) renderDailyTimeline(selectedDate);
            
        } else {
            throw new Error(data.message || data.error || 'Errore salvataggio prenotazione');
        }
    } catch (error) {
        alert('Errore: ' + error.message);
    }
}

async function handleCourtSubmit(e) {
    e.preventDefault();

    const courtId = document.getElementById('court-id').value;
    const formData = {
        name: document.getElementById('court-name').value,
        sport_type: document.getElementById('court-sport-type').value,
        default_duration_minutes: parseInt(document.getElementById('court-duration').value),
        price_per_player: parseFloat(document.getElementById("court-price").value),
        num_players: parseInt(document.getElementById("court-num-players").value),
        description: document.getElementById('court-description').value,
        is_active: document.getElementById("court-is-active").checked,
        has_video_recording: true
    };

    try {
        const url = courtId ? `${API_BASE_URL}/courts/${courtId}` : `${API_BASE_URL}/courts`;
        const method = courtId ? 'PUT' : 'POST';

        const response = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(formData)
        });

        const data = await response.json();

        if (response.ok && (data.success || data.court || data.id)) {
            document.getElementById('court-modal').style.display = 'none';
            await loadCourts();
            renderCourtsList();
        } else {
            throw new Error(data.message || data.error || 'Errore salvataggio');
        }
    } catch (error) {
        alert('Errore: ' + error.message);
    }
}

async function handlePlayerSubmit(e) {
    e.preventDefault();

    const playerId = document.getElementById('player-id').value;
    const formData = {
        first_name: document.getElementById('player-first-name').value,
        last_name: document.getElementById('player-last-name').value,
        email: document.getElementById('player-email').value,
        phone: document.getElementById('player-phone').value,
        notes: document.getElementById('player-notes').value
    };

    try {
        const url = playerId ? `${API_BASE_URL}/players/${playerId}` : `${API_BASE_URL}/players`;
        const method = playerId ? 'PUT' : 'POST';

        const response = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(formData)
        });

        const data = await response.json();

        if (response.ok && (data.success || data.player || data.id)) {
            document.getElementById('player-modal').style.display = 'none';
            loadPlayers();
        } else {
            throw new Error(data.message || data.error || 'Errore salvataggio');
        }
    } catch (error) {
        alert('Errore: ' + error.message);
    }
}

// ==========================================
// MATCH VIDEO PLAYER
// ==========================================
async function showMatchVideos(partitaId, partitaTitle) {
    const modal = document.getElementById('video-player-modal');
    const titleEl = document.getElementById('video-modal-title');
    const listContainer = document.getElementById('video-list-container');
    const playerContainer = document.getElementById('video-player-container');

    titleEl.textContent = `Video: ${partitaTitle}`;
    listContainer.innerHTML = '<p>Caricamento video...</p>';
    playerContainer.innerHTML = '';
    modal.style.display = 'flex';

    try {
        const response = await fetch(`${API_BASE_URL}/videos/match/${partitaId}`);
        const videos = await response.json();

        if (!videos || videos.length === 0) {
            listContainer.innerHTML = '<p style="color: var(--text-secondary);">Nessun video disponibile per questa partita</p>';
            return;
        }

        listContainer.innerHTML = `
            <div style="display: flex; flex-wrap: wrap; gap: 1rem;">
                ${videos.map(video => `
                    <div class="stat-card" style="cursor: pointer; flex: 1; min-width: 200px;" onclick="playVideo('${video.id}', '${video.title}')">
                        <div class="stat-icon">🎬</div>
                        <div class="stat-info">
                            <h3 style="font-size: 1rem;">${video.title}</h3>
                            <p>${formatDuration(video.duration_seconds)} | ${formatBytes(video.file_size_bytes)}</p>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    } catch (error) {
        listContainer.innerHTML = `<p style="color: var(--danger);">Errore: ${error.message}</p>`;
    }
}

function playVideo(videoId, title) {
    const playerContainer = document.getElementById('video-player-container');
    const streamUrl = `${API_BASE_URL}/videos/${videoId}/stream`;

    playerContainer.innerHTML = `
        <h4 style="margin-bottom: 1rem; color: var(--accent-primary);">In riproduzione: ${title}</h4>
        <video controls autoplay style="width: 100%; max-height: 500px; border-radius: 8px; background: #000;">
            <source src="${streamUrl}" type="video/mp4">
            Il tuo browser non supporta il video HTML5.
        </video>
    `;
}

function formatDuration(seconds) {
    if (!seconds) return '-';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m ${s}s`;
}

// ==========================================
// EXISTING FORMS (from original app.js)
// ==========================================
function setupForms() {
    // Create Match Form
    document.getElementById('create-match-form')?.addEventListener('submit', handleCreateMatch);

    // Upload Video Form
    document.getElementById('upload-video-form')?.addEventListener('submit', handleUploadVideo);

    // Cerca Partite Form
    document.getElementById('search-matches-form')?.addEventListener('submit', handleSearchMatches);

    // Edit Match Form
    document.getElementById('edit-match-form')?.addEventListener('submit', handleEditMatch);

    // Cancel Edit
    document.getElementById('cancel-edit')?.addEventListener('click', () => {
        document.getElementById('edit-modal').style.display = 'none';
    });

    // File input info
    document.getElementById('video-file')?.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const fileInfo = document.getElementById('file-info');
            fileInfo.textContent = `Selected: ${file.name} (${formatBytes(file.size)})`;
            fileInfo.style.color = file.size > 2 * 1024 * 1024 * 1024 ? 'var(--danger)' : 'var(--success)';
        }
    });
}

async function handleCreateMatch(e) {
    e.preventDefault();
    const resultEl = document.getElementById('partita-result');
    const submitBtn = e.target.querySelector('button[type="submit"]');

    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating...';

    const formData = {
        bookingCode: document.getElementById('booking-code').value,
        sportType: document.getElementById('sport-type').value,
        location: document.getElementById('location').value,
        partitaDate: document.getElementById('partita-date').value,
        players: document.getElementById('players').value.split(',').map(p => p.trim())
    };

    try {
        const response = await fetch(`${API_BASE_URL}/matches/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(formData)
        });

        const data = await response.json();

        if (response.ok && data.success) {
            resultEl.className = 'result success';
            resultEl.innerHTML = `
                <h4>Match Created!</h4>
                <p><strong>ID:</strong> ${data.match_id}</p>
                <p><strong>Code:</strong> ${data.partita.booking_code}</p>
                <p><strong>Password:</strong> <code>${data.partita.session_password}</code></p>
            `;
            e.target.reset();
        } else {
            throw new Error(data.message || 'Failed');
        }
    } catch (error) {
        resultEl.className = 'result error';
        resultEl.innerHTML = `<p>Error: ${error.message}</p>`;
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Create Match';
    }
}

async function handleUploadVideo(e) {
    e.preventDefault();
    const resultEl = document.getElementById('upload-result');
    const submitBtn = document.getElementById('upload-btn');
    const progressContainer = document.getElementById('upload-progress');
    const progressFill = document.getElementById('progress-fill');
    const progressText = document.getElementById('progress-text');

    const file = document.getElementById('video-file').files[0];
    if (!file) {
        resultEl.className = 'result error';
        resultEl.textContent = 'Please select a video file';
        return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Uploading...';
    progressContainer.style.display = 'block';

    const formData = new FormData();
    formData.append('video', file);
    formData.append('partitaId', document.getElementById('video-match-id').value);
    formData.append('title', document.getElementById('video-title').value);
    formData.append('durationSeconds', document.getElementById('video-duration').value);
    formData.append('isHighlight', document.getElementById('is-highlight').checked);

    const xhr = new XMLHttpRequest();
    xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
            const percent = Math.round((e.loaded / e.total) * 100);
            progressFill.style.width = percent + '%';
            progressText.textContent = `${percent}%`;
        }
    });

    xhr.addEventListener('load', () => {
        if (xhr.status === 200 || xhr.status === 201) {
            const data = JSON.parse(xhr.responseText);
            resultEl.className = 'result success';
            resultEl.innerHTML = `<h4>Upload Complete!</h4><p>Video ID: ${data.video.id}</p>`;
            e.target.reset();
            loadOverviewData();
        } else {
            resultEl.className = 'result error';
            resultEl.innerHTML = '<p>Upload failed</p>';
        }
        submitBtn.disabled = false;
        submitBtn.textContent = 'Upload Video';
        progressContainer.style.display = 'none';
    });

    xhr.open('POST', `${API_BASE_URL}/videos/upload`);
    xhr.send(formData);
}

async function handleSearchMatches(e) {
    e.preventDefault();
    const resultsEl = document.getElementById('search-results');
    const submitBtn = e.target.querySelector('button[type="submit"]');

    submitBtn.disabled = true;
    submitBtn.textContent = 'Ricerca...';

    const params = new URLSearchParams();
    const bookingCode = document.getElementById('search-booking-code').value.trim();
    const location = document.getElementById('search-location').value.trim();
    const sportType = document.getElementById('search-sport-type').value;
    const dateFrom = document.getElementById('search-date-from').value;

    if (bookingCode) params.append('bookingCode', bookingCode);
    if (location) params.append('location', location);
    if (sportType) params.append('sportType', sportType);
    if (dateFrom) params.append('dateFrom', dateFrom);

    try {
        const response = await fetch(`${API_BASE_URL}/matches/search?${params.toString()}`);
        const data = await response.json();

        if (response.ok && data.success) {
            if (data.matches.length === 0) {
                resultsEl.innerHTML = '<p style="color: var(--text-secondary)">Nessuna partita trovata</p>';
            } else {
                resultsEl.innerHTML = `
                    <h3>Trovate ${data.count} partite</h3>
                    ${data.matches.map(partita => renderMatchCard(partita)).join('')}
                `;
            }
        } else {
            throw new Error(data.error || 'Search failed');
        }
    } catch (error) {
        resultsEl.innerHTML = `<p style="color: var(--danger)">Error: ${error.message}</p>`;
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Search';
    }
}

function refreshMatchSearch() {
    const form = document.getElementById("search-matches-form");
    if (form) {
        const fakeEvent = { preventDefault: () => {}, target: form };
        handleSearchMatches(fakeEvent);
    }
}

function renderMatchCard(partita) {
    const partitaDate = new Date(partita.match_date).toLocaleString();
    const isActive = partita.is_active;
    const videoCount = partita.video_count || 0;

    return `
        <div class="match-card">
            <div class="match-card-header">
                <div>
                    <h4 class="match-card-title">${partita.booking_code}</h4>
                    <span class="badge ${isActive ? 'badge-active' : 'badge-inactive'}">
                        ${isActive ? 'Active' : 'Inactive'}
                    </span>
                </div>
                <div class="match-card-actions">
                    ${videoCount > 0 ? `<button class="btn btn-secondary btn-small" onclick="showMatchVideos('${partita.id}', '${partita.booking_code}')">▶️ Video (${videoCount})</button>` : ''}
                    <button class="btn btn-success btn-small" onclick="openUploadVideo('${partita.id}', '${partita.booking_code}')">📤 Upload</button>
                    <button class="btn btn-primary btn-small" onclick="editMatch('${partita.id}')">Edit</button>
                    <button class="btn btn-danger btn-small" onclick="deleteMatch('${partita.id}', '${partita.booking_code}')">Delete</button>
                </div>
            </div>
            <div class="match-card-body">
                <div class="match-detail">
                    <span class="match-detail-label">Sport</span>
                    <span class="match-detail-value">${partita.sport_type}</span>
                </div>
                <div class="match-detail">
                    <span class="match-detail-label">Location</span>
                    <span class="match-detail-value">${partita.location}</span>
                </div>
                <div class="match-detail">
                    <span class="match-detail-label">Match Date</span>
                    <span class="match-detail-value">${partitaDate}</span>
                </div>
                <div class="match-detail">
                    <span class="match-detail-label">Players</span>
                    <span class="match-detail-value">${partita.player_names.join(', ')}</span>
                </div>
                <div class="match-detail">
                    <span class="match-detail-label">Match ID</span>
                    <span class="match-detail-value"><code>${partita.id}</code> <button class="btn-copy" onclick="copyToClipboard('${partita.id}', this)" title="Copia ID">📋</button></span>
                </div>
                <div class="match-detail">
                    <span class="match-detail-label">Password</span>
                    <span class="match-detail-value"><code>${partita.access_password}</code> <button class="btn-copy" onclick="copyToClipboard('${partita.access_password}', this)" title="Copia Password">📋</button></span>
                </div>
            </div>
        </div>
    `;
}

function copyToClipboard(text, btn) {
    navigator.clipboard.writeText(text).then(() => {
        const original = btn.textContent;
        btn.textContent = '✓';
        setTimeout(() => btn.textContent = original, 1000);
    });
}

async function editMatch(partitaId) {
    try {
        const response = await fetch(`${API_BASE_URL}/matches/id/${partitaId}`);
        const data = await response.json();

        if (response.ok && data.success) {
            const partita = data.match || data.partita;
            document.getElementById('edit-match-id').value = partitaId;
            document.getElementById('edit-booking-code').value = partita.booking_code;
            document.getElementById('edit-sport-type').value = partita.sport_type;
            document.getElementById('edit-location').value = partita.location;
            document.getElementById('edit-match-date').value = new Date(partita.match_date).toISOString().slice(0, 16);
            document.getElementById('edit-players').value = partita.player_names.join(', ');
            document.getElementById('edit-password').value = partita.access_password;
            document.getElementById('edit-is-active').checked = partita.is_active;

            document.getElementById('edit-result').innerHTML = '';
            document.getElementById('edit-result').className = 'result';
            document.getElementById('edit-modal').style.display = 'flex';
        }
    } catch (error) {
        alert('Error loading partita: ' + error.message);
    }
}

async function handleEditMatch(e) {
    e.preventDefault();
    const resultEl = document.getElementById('edit-result');
    const submitBtn = e.target.querySelector('button[type="submit"]');

    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving...';

    const partitaId = document.getElementById('edit-match-id').value;
    const formData = {
        bookingCode: document.getElementById('edit-booking-code').value,
        sportType: document.getElementById('edit-sport-type').value,
        location: document.getElementById('edit-location').value,
        partitaDate: document.getElementById('edit-match-date').value,
        players: document.getElementById('edit-players').value.split(',').map(p => p.trim()),
        accessPassword: document.getElementById('edit-password').value,
        isActive: document.getElementById('edit-is-active').checked
    };

    try {
        const response = await fetch(`${API_BASE_URL}/matches/${partitaId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(formData)
        });

        const data = await response.json();

        if (response.ok && data.success) {
            resultEl.className = 'result success';
            resultEl.innerHTML = '<p>Match updated!</p>';
            setTimeout(() => {
                document.getElementById('edit-modal').style.display = 'none';
                refreshMatchSearch();
            }, 1000);
        } else {
            throw new Error(data.message || 'Update failed');
        }
    } catch (error) {
        resultEl.className = 'result error';
        resultEl.innerHTML = `<p>Error: ${error.message}</p>`;
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Save Changes';
    }
}

async function deleteMatch(partitaId, bookingCode) {
    if (!confirm(`Delete partita "${bookingCode}"? This will also delete all videos!`)) return;

    try {
        const response = await fetch(`${API_BASE_URL}/matches/${partitaId}`, { method: 'DELETE' });
        const data = await response.json();

        if (response.ok && data.success) {
            refreshMatchSearch();
        }
    } catch (error) {
        alert('Error: ' + error.message);
    }
}

// Storage Info
async function loadStorageInfo() {
    const storageInfoEl = document.getElementById('storage-info');
    try {
        const response = await fetch(`${API_BASE_URL}/stats/storage`);
        const data = await response.json();
        storageInfoEl.innerHTML = `
            <p><strong>Storage Type:</strong> ${data.storageType || 'Unknown'}</p>
            <p><strong>Total Videos:</strong> ${data.totalVideos || 0}</p>
            <p><strong>Total Size:</strong> ${formatBytes(data.totalSize || 0)}</p>
        `;
    } catch (error) {
        storageInfoEl.innerHTML = `<p style="color: var(--danger)">Error loading storage info</p>`;
    }
}

// Utility
function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

// Auto-refresh stats
setInterval(() => {
    if (currentPage === 'overview') loadOverviewData();
}, 30000);

// === FUNZIONI VIDEO UPLOAD ===
function openUploadVideo(partitaId, bookingCode) {
    document.getElementById('upload-match-id').value = partitaId;
    document.getElementById('upload-match-info').textContent = 'Match: ' + bookingCode;
    document.getElementById('upload-video-modal').style.display = 'flex';
}

function closeUploadModal() {
    document.getElementById('upload-video-modal').style.display = 'none';
    document.getElementById('upload-progress').style.display = 'none';
    document.getElementById('progress-bar').style.width = '0%';
    document.getElementById('progress-text').textContent = '0%';
}

// Upload video form handler
document.getElementById('upload-video-form-modal')?.addEventListener('submit', async function(e) {
    e.preventDefault();
    
    const partitaId = document.getElementById('upload-match-id').value;
    const fileInput = document.getElementById('video-file-input');
    const title = document.getElementById('video-title').value;
    
    if (!fileInput.files[0]) {
        alert('Seleziona un file video');
        return;
    }
    
    const formData = new FormData();
    formData.append('video', fileInput.files[0]);
    formData.append('matchId', partitaId);
    formData.append('title', title || fileInput.files[0].name);
    formData.append('durationSeconds', 0);
    
    document.getElementById('upload-progress').style.display = 'block';
    
    const xhr = new XMLHttpRequest();
    xhr.open('POST', API_BASE_URL + '/videos/upload');
    
    xhr.upload.onprogress = function(e) {
        if (e.lengthComputable) {
            const percent = Math.round((e.loaded / e.total) * 100);
            document.getElementById('progress-bar').style.width = percent + '%';
            document.getElementById('progress-text').textContent = percent + '%';
        }
    };
    
    xhr.onload = function() {
        if (xhr.status === 200 || xhr.status === 201) {
            // Video caricato - aggiorna lista
            closeUploadModal();
            refreshMatchSearch();
        } else {
            alert('Errore upload: ' + xhr.responseText);
        }
    };
    
    xhr.onerror = function() {
        alert('Errore di connessione');
    };
    
    xhr.send(formData);
});

// === DIRECT UPLOAD VIDEO ===
document.getElementById('direct-upload-form')?.addEventListener('submit', async function(e) {
    e.preventDefault();
    
    const title = document.getElementById('direct-video-title').value;
    const partitaId = document.getElementById('direct-match-id').value;
    const fileInput = document.getElementById('direct-video-file');
    
    if (!fileInput.files[0]) {
        alert('Seleziona un file video');
        return;
    }
    
    const formData = new FormData();
    formData.append('video', fileInput.files[0]);
    formData.append('title', title);
    if (partitaId) formData.append('match_id', partitaId);
    formData.append('durationSeconds', 0);
    
    document.getElementById('direct-upload-progress').style.display = 'block';
    document.getElementById('direct-upload-result').innerHTML = '';
    
    const xhr = new XMLHttpRequest();
    xhr.open('POST', API_BASE_URL + '/videos/upload');
    
    xhr.upload.onprogress = function(e) {
        if (e.lengthComputable) {
            const percent = Math.round((e.loaded / e.total) * 100);
            document.getElementById('direct-progress-bar').style.width = percent + '%';
            document.getElementById('direct-progress-text').textContent = percent + '%';
        }
    };
    
    xhr.onload = function() {
        if (xhr.status === 200 || xhr.status === 201) {
            document.getElementById('direct-upload-result').innerHTML = '<p style="color: var(--success);">✅ Video caricato con successo!</p>';
            document.getElementById('direct-upload-form').reset();
            setTimeout(() => {
                document.getElementById('direct-upload-progress').style.display = 'none';
                document.getElementById('direct-progress-bar').style.width = '0%';
            }, 2000);
        } else {
            document.getElementById('direct-upload-result').innerHTML = '<p style="color: var(--error);">❌ Errore: ' + xhr.responseText + '</p>';
        }
    };
    
    xhr.onerror = function() {
        document.getElementById('direct-upload-result').innerHTML = '<p style="color: var(--error);">❌ Errore di connessione</p>';
    };

    xhr.send(formData);
});

// Sport filter for timeline
function filterBySport(sport) {
    currentSportFilter = sport;

    // Update active button
    document.querySelectorAll('.sport-filter-btn').forEach(btn => {
        btn.classList.remove('active');
        if ((sport === null && btn.dataset.sport === 'all') || btn.dataset.sport === sport) {
            btn.classList.add('active');
        }
    });

    // Filter timeline rows
    document.querySelectorAll('.timeline-row').forEach(row => {
        const rowSport = row.dataset.sport;
        if (sport === null || rowSport === sport) {
            row.style.display = '';
        } else {
            row.style.display = 'none';
        }
    });
}
