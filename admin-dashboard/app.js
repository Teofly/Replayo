// API Configuration - detect local vs production
const isLocal = window.location.hostname === 'localhost' ||
                window.location.hostname === '127.0.0.1' ||
                window.location.hostname.startsWith('192.168.');
const API_BASE_URL = isLocal ? 'http://192.168.1.175:3000/api' : 'https://api.teofly.it/api';

// Escape string for use in onclick attributes
function escapeAttr(str) {
    if (!str) return '';
    return String(str).replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

// Sidebar toggle
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const mainContent = document.querySelector('.main-content');
    const toggleBtn = document.getElementById('sidebar-toggle-btn');

    sidebar.classList.toggle('collapsed');
    mainContent.classList.toggle('expanded');
    toggleBtn.classList.toggle('collapsed');

    // Save preference
    const isCollapsed = sidebar.classList.contains('collapsed');
    localStorage.setItem('sidebar_collapsed', isCollapsed);
}

// Restore sidebar state on load
function restoreSidebarState() {
    const isCollapsed = localStorage.getItem('sidebar_collapsed') === 'true';
    if (isCollapsed) {
        document.getElementById('sidebar')?.classList.add('collapsed');
        document.querySelector('.main-content')?.classList.add('expanded');
        document.getElementById('sidebar-toggle-btn')?.classList.add('collapsed');
    }
}

// Auth credentials
let authCredentials = localStorage.getItem('replayo_auth') || null;
let loginResolve = null;

function getAuthHeader() {
    return authCredentials ? { 'Authorization': `Basic ${authCredentials}` } : {};
}

function showLoginModal() {
    return new Promise((resolve) => {
        loginResolve = resolve;
        document.getElementById('login-error').style.display = 'none';
        document.getElementById('login-form').reset();
        document.getElementById('login-modal').style.display = 'flex';
        document.getElementById('login-username').focus();
    });
}

function hideLoginModal() {
    document.getElementById('login-modal').style.display = 'none';
}

function setupLoginForm() {
    document.getElementById('login-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const user = document.getElementById('login-username').value;
        const pass = document.getElementById('login-password').value;

        if (user && pass) {
            authCredentials = btoa(`${user}:${pass}`);
            localStorage.setItem('replayo_auth', authCredentials);
            hideLoginModal();
            if (loginResolve) {
                loginResolve(true);
                loginResolve = null;
            }
        }
    });
}

// Helper function for authenticated API calls
async function apiFetch(url, options = {}) {
    // If no credentials, show login first
    if (!authCredentials) {
        await showLoginModal();
    }

    const headers = {
        ...options.headers,
        ...getAuthHeader()
    };
    const response = await fetch(url, { ...options, headers });

    if (response.status === 401) {
        authCredentials = null;
        localStorage.removeItem('replayo_auth');
        document.getElementById('login-error').textContent = 'Credenziali non valide';
        document.getElementById('login-error').style.display = 'block';
        await showLoginModal();
        // Retry the request with new credentials
        return apiFetch(url, options);
    }
    return response;
}

// Global state
let currentPage = 'bookings';
let currentMonth = new Date().getMonth();
let currentYear = new Date().getFullYear();
let selectedDate = null;
let courtsCache = [];
let playersCache = [];
let bookingsCache = [];
let selectedBookingPlayers = []; // Players selected for current booking
let currentSportFilter = null; // Sport filter for timeline

// Initialize app
document.addEventListener('DOMContentLoaded', async () => {
    restoreSidebarState();
    setupLoginForm();
    setupNavigation();
    setupMobileMenu();
    checkAPIStatus();
    await loadAppConfig(); // Carica configurazioni all'avvio
    navigateTo('bookings');
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
        'matches': 'Videos',
        'partitaes': 'Create Match',
        'manage-partitaes': 'Manage Matches',
        'videos': 'Videos',
        'users': 'Utenti',
        'storage': 'Storage',
        'test': 'Test',
        'club-images': 'InfoClub',
        'settings': 'Impostazioni'
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
        renderCalendar(); // Renderizza calendario e seleziona oggi automaticamente
    } else if (page === 'test') {
        loadMatchesForTest();
        renderCalendar();
    } else if (page === 'courts') {
        loadCourts().then(() => renderCourtsList());
    } else if (page === 'users') {
        loadUnifiedUsers();
        loadUnifiedUsersStats();
    } else if (page === 'club-images') {
        loadClubInfo();
        loadClubImages();
    }
}

// Esegui manualmente il cron video download
function runCronManually() {
    showConfirmDialog(
        'Cron Job',
        'Eseguire il cron job video download ora?',
        'Esegui',
        executeRunCronManually
    );
}

async function executeRunCronManually() {
    try {
        const btn = document.querySelector('[onclick="runCronManually()"]');
        if (btn) {
            btn.textContent = '⏳ Esecuzione...';
            btn.disabled = true;
        }

        const response = await apiFetch(`${API_BASE_URL}/cron/video-download`, {
            method: 'POST'
        });

        const data = await response.json();

        if (data.success) {
            showNotification('Cron job completato!', 'success');
        } else {
            showNotification('Errore: ' + (data.error || 'Sconosciuto'), 'error');
        }

        if (btn) {
            btn.textContent = '▶️ Esegui Cron';
            btn.disabled = false;
        }
        checkAPIStatus();
    } catch (error) {
        showNotification('Errore: ' + error.message, 'error');
    }
}

// API Status Check
async function checkAPIStatus() {
    const statusEl = document.getElementById("api-status");
    const envStatusEl = document.getElementById("env-status");
    try {
        const response = await apiFetch(`${API_BASE_URL}/status/environment`);
        const data = await response.json();
        if (data.success && data.status) {
            const s = data.status;
            statusEl.textContent = "🟢 Sistema Online";
            statusEl.style.color = "var(--success)";
            const uptimeMin = Math.floor(s.server.uptime / 60);
            const uptimeHrs = Math.floor(uptimeMin / 60);
            const uptimeStr = uptimeHrs > 0 ? `${uptimeHrs}h ${uptimeMin % 60}m` : `${uptimeMin}m`;
            const synologyStatus = s.synology?.status === "connected";
            const cronStatus = s.cronVideoDownload?.status === "active";
            const bookingStatus = s.bookingPage?.status === "online";
            envStatusEl.innerHTML = `
                <p><strong>Server:</strong> <span style="color: var(--success)">🟢 Online</span> (uptime: ${uptimeStr})</p>
                <p><strong>API:</strong> <span style="color: var(--success)">🟢 Connesso</span> - <code>${API_BASE_URL}</code></p>
                <p><strong>Database:</strong> <span style="color: ${s.database.status === "connected" ? "var(--success)" : "var(--danger)"}">${s.database.status === "connected" ? "🟢" : "🔴"} ${s.database.status}</span> (${s.database.name || "N/A"})</p>
                <p><strong>NAS Storage:</strong> <span style="color: ${s.nas.status === "mounted" ? "var(--success)" : "var(--danger)"}">${s.nas.status === "mounted" ? "🟢" : "🔴"} ${s.nas.status}</span></p>
                <p><strong>Synology Surveillance:</strong> <span style="color: ${synologyStatus ? "var(--success)" : "var(--danger)"}">${synologyStatus ? "🟢" : "🔴"} ${synologyStatus ? `Connesso (${s.synology.cameras} telecamere)` : (s.synology?.error || "Non connesso")}</span></p>
                <p><strong>Cron Video Download:</strong> <span style="color: ${cronStatus ? "var(--success)" : "var(--warning)"}">${cronStatus ? "🟢" : "🟡"} ${cronStatus ? s.cronVideoDownload.schedule : "Non configurato"}</span> <button onclick="runCronManually()" style="margin-left: 0.5rem; padding: 0.25rem 0.5rem; font-size: 0.75rem; background: #2a2a3e; border: 1px solid #3a3a4e; border-radius: 4px; color: #a0a0a0; cursor: pointer;">Esegui Ora</button></p>
                <p><strong>Booking Page:</strong> <span style="color: ${bookingStatus ? "var(--success)" : "var(--danger)"}">${bookingStatus ? "🟢" : "🔴"} ${bookingStatus ? `Online (porta ${s.bookingPage.port})` : s.bookingPage?.status || "Non disponibile"}</span></p>
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
        const response = await apiFetch(`${API_BASE_URL}/stats/storage`);
        const data = await response.json();

        document.getElementById('total-videos').textContent = data.totalVideos || '0';
        document.getElementById('total-storage').textContent = formatBytes(data.totalSize || 0);
        document.getElementById('total-views').textContent = data.totalViews || '0';
        document.getElementById('total-downloads').textContent = data.totalDownloads || '0';
    } catch (error) {
        console.error('Error loading overview data:', error);
    }
}

async function refreshNasStats() {
    try {
        const response = await apiFetch(`${API_BASE_URL}/stats/storage`);
        const data = await response.json();

        document.getElementById('total-videos').textContent = data.totalVideos || '0';
        document.getElementById('total-storage').textContent = formatBytes(data.totalSize || 0);
        document.getElementById('total-views').textContent = data.totalViews || '0';
        document.getElementById('total-downloads').textContent = data.totalDownloads || '0';
    } catch (error) {
        console.error('Error refreshing stats:', error);
    }
}

function cleanupOrphanedVideos() {
    showConfirmDialog(
        'Cleanup Video',
        'Vuoi eliminare dal database i record dei video che non esistono più sul NAS?',
        'Elimina',
        executeCleanupOrphanedVideos
    );
}

async function executeCleanupOrphanedVideos() {
    try {
        const response = await apiFetch(`${API_BASE_URL}/videos/cleanup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await response.json();

        if (data.success) {
            showNotification(`Cleanup completato! Eliminati: ${data.deleted}, Mantenuti: ${data.kept}`, 'success');
            refreshNasStats();
        } else {
            showNotification('Errore: ' + data.message, 'error');
        }
    } catch (error) {
        console.error('Error cleaning up videos:', error);
        showNotification('Errore durante il cleanup', 'error');
    }
}

// ==========================================
// COURTS MANAGEMENT
// ==========================================
async function loadCourts() {
    try {
        const response = await apiFetch(`${API_BASE_URL}/courts`);
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

function deleteCourt(courtId, courtName) {
    showConfirmDialog(
        'Elimina Campo',
        `Eliminare il campo "${courtName}"?`,
        'Elimina',
        () => executeDeleteCourt(courtId)
    );
}

async function executeDeleteCourt(courtId) {
    try {
        const response = await apiFetch(`${API_BASE_URL}/courts/${courtId}`, {
            method: 'DELETE'
        });
        if (response.ok) {
            await loadCourts();
            loadCalendarCoverage();
            renderCourtsList();
            showNotification('Campo eliminato', 'success');
        }
    } catch (error) {
        showNotification('Errore eliminazione campo: ' + error.message, 'error');
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
        const response = await apiFetch(url);
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
    document.getElementById('player-first-name').value = player.first_name || '';
    document.getElementById('player-last-name').value = player.last_name || '';
    document.getElementById('player-email').value = player.email || '';
    document.getElementById('player-phone').value = player.phone || '';
    document.getElementById('player-notes').value = player.notes || '';

    document.getElementById('player-modal').style.display = 'flex';
}

function deletePlayer(playerId, playerName) {
    showConfirmDialog(
        'Elimina Giocatore',
        `Eliminare "${playerName}" dall'anagrafica?`,
        'Elimina',
        () => executeDeletePlayer(playerId)
    );
}

async function executeDeletePlayer(playerId) {
    try {
        const response = await apiFetch(`${API_BASE_URL}/players/${playerId}`, {
            method: 'DELETE'
        });
        if (response.ok) {
            loadPlayers();
            showNotification('Giocatore eliminato', 'success');
        }
    } catch (error) {
        showNotification('Errore eliminazione giocatore: ' + error.message, 'error');
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
                <span class="day-number">${day}</span>
            </div>
        `;
    }

    grid.innerHTML = html;

    // Seleziona automaticamente oggi SOLO se non c'è già una data selezionata
    // e siamo nel mese corrente
    const now = new Date();
    if (!selectedDate && currentYear === now.getFullYear() && currentMonth === now.getMonth()) {
        const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
        selectDate(todayStr);
    } else if (selectedDate) {
        // Se c'è già una data selezionata, ri-evidenziala nel calendario
        const selectedCell = document.querySelector(`.calendar-day[data-date="${selectedDate}"]`);
        if (selectedCell) {
            selectedCell.classList.add('selected');
        }
    }

    // Load coverage bars after render
    loadCalendarCoverage();
}

function loadCalendarCoverage() {
    const startDate = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-01`;
    // Get last day of month correctly (day 0 of next month = last day of current month)
    const lastDay = new Date(currentYear, currentMonth + 1, 0).getDate();
    const endDate = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    // Remove existing coverage bars first (to allow refresh when filter changes)
    document.querySelectorAll('.day-coverage-bar').forEach(bar => bar.remove());
    document.querySelectorAll('.calendar-day.has-bookings').forEach(day => day.classList.remove('has-bookings'));

    apiFetch(`${API_BASE_URL}/bookings?from_date=${startDate}&to_date=${endDate}`)
        .then(r => r.json())
        .then(data => {
            // Handle different response formats
            let bookings = [];
            if (Array.isArray(data)) {
                bookings = data;
            } else if (data && Array.isArray(data.bookings)) {
                bookings = data.bookings;
            } else if (data && data.success && Array.isArray(data.bookings)) {
                bookings = data.bookings;
            }

            // Filter courts by sport if filter is active
            let filteredCourts = courtsCache.filter(c => c.is_active);
            if (currentSportFilter) {
                filteredCourts = filteredCourts.filter(c => c.sport_type === currentSportFilter);
            }
            const totalMinutes = filteredCourts.length * 14 * 60;

            // Filter bookings by sport filter (directly via sport_type)
            let filteredBookings = bookings;
            if (currentSportFilter) {
                filteredBookings = bookings.filter(b => b.sport_type === currentSportFilter);
            }

            // Calculate coverage per date
            const coverage = {};
            filteredBookings.forEach(b => {
                const d = b.booking_date.split('T')[0];
                coverage[d] = (coverage[d] || 0) + (b.duration_minutes || 90);
            });

            // Add bars to calendar
            Object.keys(coverage).forEach(dateStr => {
                const dayEl = document.querySelector(`.calendar-day[data-date="${dateStr}"]`);
                if (dayEl) {
                    const pct = totalMinutes > 0 ? Math.min(100, Math.round((coverage[dateStr] / totalMinutes) * 100)) : 0;
                    const bar = document.createElement('div');
                    bar.className = 'day-coverage-bar';
                    bar.innerHTML = `<div class="day-coverage-fill" style="width:${pct}%"></div>`;
                    bar.title = `${pct}% prenotato`;
                    dayEl.appendChild(bar);
                    dayEl.classList.add('has-bookings');
                }
            });
        })
        .catch(e => console.error('Coverage load error:', e));
}

async function loadMonthBookings() {
    try {
        const startDate = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-01`;
        const endDate = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-31`;

        const response = await apiFetch(`${API_BASE_URL}/bookings?from_date=${startDate}&to_date=${endDate}`);
        const data = await response.json();
        bookingsCache = data.bookings || data || [];

        // Ensure courts are loaded for coverage calculation
        if (courtsCache.length === 0) {
            await loadCourts();
        loadCalendarCoverage();
        }

        // Calculate total available minutes per day (all active courts)
        const activeCourts = courtsCache.filter(c => c.is_active);
        const openHour = parseInt(appConfig.club_open_hour?.value) || 8;
        const closeHour = parseInt(appConfig.club_close_hour?.value) || 22;
        const hoursPerDay = closeHour - openHour;
        const totalAvailableMinutes = activeCourts.length * hoursPerDay * 60;

        // Group bookings by date and calculate coverage
        const coverageByDate = {};
        bookingsCache.forEach(booking => {
            const bookingDate = booking.booking_date.split('T')[0];
            if (!coverageByDate[bookingDate]) {
                coverageByDate[bookingDate] = 0;
            }
            const duration = booking.duration_minutes || 90;
            coverageByDate[bookingDate] += duration;
        });

        // Update calendar days with coverage bars
        Object.keys(coverageByDate).forEach(dateStr => {
            const dayEl = document.querySelector(`.calendar-day[data-date="${dateStr}"]`);
            if (dayEl) {
                dayEl.classList.add('has-bookings');
                const bookedMinutes = coverageByDate[dateStr];
                const coveragePercent = totalAvailableMinutes > 0
                    ? Math.min(100, Math.round((bookedMinutes / totalAvailableMinutes) * 100))
                    : 0;

                // Remove old bar if exists
                const oldBar = dayEl.querySelector('.day-coverage');
                if (oldBar) oldBar.remove();

                // Create coverage bar container at bottom of day cell
                const barWrapper = document.createElement('div');
                barWrapper.className = 'day-coverage';
                barWrapper.style.cssText = `
                    position: absolute;
                    bottom: 4px;
                    left: 4px;
                    right: 4px;
                    height: 6px;
                    background: rgba(255,255,255,0.1);
                    border-radius: 3px;
                    overflow: hidden;
                `;
                barWrapper.title = `${coveragePercent}% prenotato`;

                // Create the actual bar
                const bar = document.createElement('div');
                bar.style.cssText = `
                    width: ${coveragePercent}%;
                    height: 100%;
                    background: linear-gradient(90deg, #00ff88, #00bcd4);
                    border-radius: 3px;
                    transition: width 0.3s;
                `;

                barWrapper.appendChild(bar);
                dayEl.appendChild(barWrapper);
            }
        });
    } catch (error) {
        console.error('Error loading bookings:', error);
    }
}

function refreshDailyBookings() {
    if (selectedDate) {
        renderDailyTimeline(selectedDate);
    }
}

function goToToday() {
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    selectDate(`${y}-${m}-${d}`);
}

function navigateDay(direction) {
    if (!selectedDate) {
        // If no date selected, use today
        const today = new Date();
        const y = today.getFullYear();
        const m = String(today.getMonth() + 1).padStart(2, '0');
        const d = String(today.getDate()).padStart(2, '0');
        selectedDate = `${y}-${m}-${d}`;
    }

    // Parse the current date
    const [year, month, day] = selectedDate.split('-').map(Number);
    const currentDate = new Date(year, month - 1, day);

    // Add or subtract days
    currentDate.setDate(currentDate.getDate() + direction);

    // Format the new date (avoid timezone issues)
    const newYear = currentDate.getFullYear();
    const newMonth = String(currentDate.getMonth() + 1).padStart(2, '0');
    const newDay = String(currentDate.getDate()).padStart(2, '0');
    const newDateStr = `${newYear}-${newMonth}-${newDay}`;

    // Select the new date
    selectDate(newDateStr);
}

function selectDate(dateStr) {
    selectedDate = dateStr;

    // Parse the selected date
    const [year, month, day] = dateStr.split('-').map(Number);

    // Check if we need to change the calendar month view
    if (year !== currentYear || (month - 1) !== currentMonth) {
        currentYear = year;
        currentMonth = month - 1; // month is 0-indexed in JS
        renderCalendar(); // This will re-render and highlight the selected date
    } else {
        // Same month, just update selected state in calendar
        document.querySelectorAll('.calendar-day').forEach(d => d.classList.remove('selected'));
        const selectedEl = document.querySelector(`.calendar-day[data-date="${dateStr}"]`);
        if (selectedEl) selectedEl.classList.add('selected');
    }

    // Update display - parse date parts to avoid timezone issues
    const displayEl = document.getElementById('selected-date-display');
    if (displayEl) {
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
        const response = await apiFetch(`${API_BASE_URL}/bookings?from_date=${dateStr}&to_date=${dateStr}`);
        const data = await response.json();
        const dayBookings = (data.bookings || data || []).filter(b => b.booking_date.split('T')[0] === dateStr);

        if (courtsCache.length === 0) {
            await loadCourts();
        loadCalendarCoverage();
        }

        // Build timeline from configured opening hours
        const startHour = parseInt(appConfig.club_open_hour?.value) || 8;
        const endHour = parseInt(appConfig.club_close_hour?.value) || 22;
        const hoursCount = endHour - startHour;
        const slotResolution = parseInt(appConfig.slot_interval_minutes?.value) || 30;
        const totalSlots = hoursCount * (60 / slotResolution);

        // Header dinamico basato su ore configurate
        let html = `
            <div class="timeline-header">
                <div class="timeline-court-label">Campo</div>
                <div class="timeline-hours-container" style="grid-template-columns: repeat(${hoursCount}, 1fr);">
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
            html += `<div class="timeline-slots-container" style="grid-template-columns: repeat(${totalSlots}, minmax(0, 1fr));">`;

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
                    <div class="timeline-booking-bar status-${booking.status || "pending"} sport-${court.sport_type || 'other'} source-${booking.booking_source || 'admin'}"
                         style="left: ${leftPercent}%; width: ${widthPercent}%;"
                         data-user-id="${booking.user_id || ''}"
                         data-customer-name="${booking.customer_name || ''}"
                         title="${booking.customer_name} | ${bookingStart} - ${endTime} | ${booking.booking_source === 'app' ? 'Da App' : 'Da Club'}"
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

        // Add current time indicator (only for today) - via DOM manipulation
        const today = new Date();
        const italianTime = new Date(today.toLocaleString('en-US', { timeZone: 'Europe/Rome' }));
        const todayStr = italianTime.toISOString().split('T')[0];

        if (dateStr === todayStr) {
            const currentHour = italianTime.getHours();
            const currentMinute = italianTime.getMinutes();
            const currentTotalMinutes = currentHour * 60 + currentMinute;
            const timelineStartMin = startHour * 60;
            const timelineTotalMin = hoursCount * 60;

            // Only show if current time is within timeline range (8:00-22:00)
            if (currentTotalMinutes >= timelineStartMin && currentTotalMinutes < (endHour * 60)) {
                const leftPercent = ((currentTotalMinutes - timelineStartMin) / timelineTotalMin) * 100;

                // Add indicator to each timeline-slots-container
                const slotsContainers = container.querySelectorAll('.timeline-slots-container');
                slotsContainers.forEach(slotsContainer => {
                    const indicator = document.createElement('div');
                    indicator.className = 'current-time-indicator';
                    indicator.style.left = `${leftPercent}%`;
                    slotsContainer.appendChild(indicator);
                });
            }

            // Update indicator position every minute
            if (window.currentTimeInterval) {
                clearInterval(window.currentTimeInterval);
            }

            window.currentTimeInterval = setInterval(() => {
                const now = new Date();
                const italianNow = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Rome' }));
                const nowStr = italianNow.toISOString().split('T')[0];

                if (dateStr === nowStr) {
                    const hour = italianNow.getHours();
                    const minute = italianNow.getMinutes();
                    const totalMin = hour * 60 + minute;

                    if (totalMin >= timelineStartMin && totalMin < (endHour * 60)) {
                        const newLeftPercent = ((totalMin - timelineStartMin) / timelineTotalMin) * 100;
                        const indicators = container.querySelectorAll('.current-time-indicator');
                        indicators.forEach(indicator => {
                            indicator.style.left = `${newLeftPercent}%`;
                        });
                    }
                } else {
                    clearInterval(window.currentTimeInterval);
                }
            }, 60000);
        } else {
            // Not today, clear any existing interval
            if (window.currentTimeInterval) {
                clearInterval(window.currentTimeInterval);
            }
        }

        // Re-apply sport filter if active
        if (typeof currentSportFilter !== 'undefined' && currentSportFilter !== null) {
            filterBySport(currentSportFilter);
        }

        // Re-apply player filter if active
        if (typeof currentPlayerFilter !== 'undefined' && currentPlayerFilter !== null) {
            applyPlayerFilter();
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
        const response = await apiFetch(`${API_BASE_URL}/bookings/${bookingId}`);
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

        // Check for videos if match_id exists
        let videoCount = 0;
        let matchTitle = '';
        if (booking.match_id) {
            try {
                const videoResponse = await apiFetch(`${API_BASE_URL}/videos/match/${booking.match_id}`);
                const videos = await videoResponse.json();
                videoCount = videos ? videos.length : 0;
                matchTitle = `${courtName} - ${formattedDate}`;
            } catch (videoError) {
                console.error('Error loading videos:', videoError);
            }
        }

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
                ${videoCount > 0 ? `
                <div class="booking-detail-item">
                    <span class="detail-label">Video Disponibili</span>
                    <span class="detail-value" style="color: var(--success); font-weight: 700;">
                        ${videoCount} video
                    </span>
                </div>
                ` : ''}
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

        // Show send email button for confirmed bookings
        const sendEmailBtn = document.getElementById('send-email-btn');
        sendEmailBtn.style.display = booking.status === 'confirmed' ? 'inline-block' : 'none';

        // Show/hide video button based on availability
        const viewVideosBtn = document.getElementById('view-videos-btn');
        if (viewVideosBtn) {
            if (videoCount > 0) {
                viewVideosBtn.style.display = 'inline-block';
                viewVideosBtn.onclick = () => {
                    // Close booking details modal first
                    modal.style.display = 'none';
                    // Then show video modal
                    showMatchVideos(booking.match_id, matchTitle);
                };
            } else {
                viewVideosBtn.style.display = 'none';
            }
        }

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

        const response = await apiFetch(`${API_BASE_URL}/bookings/${currentBookingDetails.id}/confirm`, {
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
        showNotification('Errore: ' + error.message, 'error');
    }
}

function deleteBooking() {
    if (!currentBookingDetails) return;

    const customerName = currentBookingDetails.customer_name || 'questa prenotazione';
    showConfirmDialog(
        'Cancella Prenotazione',
        `Sei sicuro di voler cancellare la prenotazione di "${customerName}"?`,
        'Cancella',
        executeDeleteBooking
    );
}

async function executeDeleteBooking() {
    if (!currentBookingDetails) return;

    try {
        const response = await apiFetch(`${API_BASE_URL}/bookings/${currentBookingDetails.id}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            document.getElementById('booking-details-modal').style.display = 'none';
            if (selectedDate) renderDailyTimeline(selectedDate);
            renderCalendar();
            showNotification('Prenotazione cancellata', 'success');
        } else {
            const data = await response.json();
            throw new Error(data.error || 'Errore eliminazione');
        }
    } catch (error) {
        showNotification('Errore: ' + error.message, 'error');
    }
}

async function sendBookingEmail() {
    if (!currentBookingDetails) return;

    const sendBtn = document.getElementById('send-email-btn');
    const originalText = sendBtn.textContent;
    sendBtn.textContent = 'Invio...';
    sendBtn.disabled = true;

    try {
        const response = await apiFetch(`${API_BASE_URL}/bookings/${currentBookingDetails.id}/send-email`, {
            method: 'POST'
        });

        const data = await response.json();

        if (data.success) {
            showNotification(`Email inviate a ${data.recipients.length} partecipanti`, 'success');
        } else {
            throw new Error(data.error || 'Errore invio email');
        }
    } catch (error) {
        showNotification('Errore: ' + error.message, 'error');
    } finally {
        sendBtn.textContent = originalText;
        sendBtn.disabled = false;
    }
}

function editBookingFromDetails() {
    if (!currentBookingDetails) return;

    const booking = currentBookingDetails;

    // Close details modal
    document.getElementById('booking-details-modal').style.display = 'none';

    // Clear and reload players
    clearSelectedPlayers();
    if (booking.player_names && Array.isArray(booking.player_names)) {
        booking.player_names.forEach(name => {
            addPlayerToBooking(null, name, false);
        });
    }

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
        const response = await apiFetch(`${API_BASE_URL}/bookings/available-slots?court_id=${courtId}&date=${date}`);
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

    // Update info text with selected duration
    updateSelectedSlotInfo();
}

function updateSelectedSlotInfo() {
    const infoEl = document.getElementById('selected-slot-info');
    const timeInput = document.getElementById('booking-time');
    const durationSelect = document.getElementById('booking-duration');
    const courtSelect = document.getElementById('booking-court');

    if (!infoEl || !timeInput.value) {
        if (infoEl) infoEl.textContent = '';
        return;
    }

    const startTime = timeInput.value;
    const court = courtsCache.find(c => String(c.id) === String(courtSelect.value));
    const selectedDuration = parseInt(durationSelect.value) || 0;
    const duration = selectedDuration > 0 ? selectedDuration : (court?.default_duration_minutes || 90);

    // Calculate end time
    const [startHour, startMin] = startTime.split(':').map(Number);
    const endMinutes = startHour * 60 + startMin + duration;
    const endHour = Math.floor(endMinutes / 60);
    const endMin = endMinutes % 60;
    const endTime = `${String(endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}`;

    infoEl.textContent = `Orario: ${startTime} - ${endTime} (${duration} min)`;
}
// ==========================================
// PLAYER SELECTION FOR BOOKINGS
// ==========================================
let selectedSuggestionIndex = -1;

function setupPlayerSearch() {
    const searchInput = document.getElementById('booking-player-search');
    const suggestionsDiv = document.getElementById('player-suggestions');

    if (!searchInput || !suggestionsDiv) return;

    // Search as you type - using unified users API
    searchInput.addEventListener('input', async (e) => {
        const query = e.target.value.trim();
        selectedSuggestionIndex = -1;

        if (query.length < 2) {
            suggestionsDiv.style.display = 'none';
            return;
        }

        try {
            const response = await apiFetch(`${API_BASE_URL}/admin/unified-users?search=${encodeURIComponent(query)}`);
            const data = await response.json();
            const users = data.users || [];

            if (users.length === 0) {
                suggestionsDiv.innerHTML = '<div class="no-results">Nessun risultato - premi Invio per aggiungere</div>';
            } else {
                suggestionsDiv.innerHTML = users.map((u, idx) => `
                    <div class="player-suggestion suggestion-item" data-id="${u.playerId || u.id}" data-name="${u.name}" data-index="${idx}">
                        <span class="suggestion-name">${u.name}</span>
                        ${u.isRegistered ? '<span class="suggestion-badge">App</span>' : ''}
                        <div class="suggestion-detail">${u.email || ''} ${u.phone ? '| ' + u.phone : ''}</div>
                    </div>
                `).join('');

                // Add click handlers
                suggestionsDiv.querySelectorAll('.player-suggestion').forEach(el => {
                    el.addEventListener('click', () => {
                        addPlayerToBooking(el.dataset.id, el.dataset.name, true);
                        searchInput.value = '';
                        suggestionsDiv.style.display = 'none';
                        searchInput.focus();
                    });
                    el.addEventListener('mouseover', () => {
                        selectedSuggestionIndex = parseInt(el.dataset.index);
                        updateSuggestionHighlight(suggestionsDiv);
                    });
                });
            }
            suggestionsDiv.style.display = 'block';
        } catch (error) {
            console.error('Error searching users:', error);
        }
    });

    // Keyboard navigation
    searchInput.addEventListener('keydown', (e) => {
        const suggestions = suggestionsDiv.querySelectorAll('.player-suggestion');

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (suggestions.length > 0) {
                selectedSuggestionIndex = Math.min(selectedSuggestionIndex + 1, suggestions.length - 1);
                updateSuggestionHighlight(suggestionsDiv);
            }
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (suggestions.length > 0) {
                selectedSuggestionIndex = Math.max(selectedSuggestionIndex - 1, 0);
                updateSuggestionHighlight(suggestionsDiv);
            }
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (selectedSuggestionIndex >= 0 && suggestions[selectedSuggestionIndex]) {
                const el = suggestions[selectedSuggestionIndex];
                addPlayerToBooking(el.dataset.id, el.dataset.name, true);
                searchInput.value = '';
                suggestionsDiv.style.display = 'none';
                selectedSuggestionIndex = -1;
                searchInput.focus();
            } else {
                const name = searchInput.value.trim();
                if (name) {
                    addPlayerToBooking(null, name, false);
                    searchInput.value = '';
                    suggestionsDiv.style.display = 'none';
                    searchInput.focus();
                }
            }
        } else if (e.key === 'Escape') {
            suggestionsDiv.style.display = 'none';
            selectedSuggestionIndex = -1;
        }
    });

    // Hide suggestions when clicking outside
    document.addEventListener('click', (e) => {
        if (!searchInput.contains(e.target) && !suggestionsDiv.contains(e.target)) {
            suggestionsDiv.style.display = 'none';
            selectedSuggestionIndex = -1;
        }
    });
}

// Setup customer name autocomplete with auto-fill
function setupCustomerNameSearch() {
    const searchInput = document.getElementById('booking-customer-name');
    const suggestionsDiv = document.getElementById('customer-suggestions');

    if (!searchInput || !suggestionsDiv) return;

    let customerSearchCache = [];
    let customerSelectedIndex = -1;

    // Search as you type
    searchInput.addEventListener('input', async (e) => {
        const query = e.target.value.trim();
        customerSelectedIndex = -1;

        // Clear email and phone when user starts typing a new name
        document.getElementById('booking-customer-email').value = '';
        document.getElementById('booking-customer-phone').value = '';

        if (query.length < 2) {
            suggestionsDiv.style.display = 'none';
            return;
        }

        try {
            const response = await apiFetch(`${API_BASE_URL}/admin/unified-users?search=${encodeURIComponent(query)}`);
            const data = await response.json();
            customerSearchCache = data.users || [];

            if (customerSearchCache.length === 0) {
                suggestionsDiv.innerHTML = '<div class="no-results">Nessun risultato - usa il nome inserito</div>';
            } else {
                suggestionsDiv.innerHTML = customerSearchCache.map((u, idx) => `
                    <div class="suggestion-item" data-index="${idx}">
                        <span class="suggestion-name">${u.name}</span>
                        <span class="suggestion-badges">
                            ${u.isRegistered ? '<span class="suggestion-badge">App</span>' : ''}
                            ${u.isAdmin ? '<span class="suggestion-badge" style="background: rgba(255,170,0,0.2); color: var(--warning);">Admin</span>' : ''}
                        </span>
                        <div class="suggestion-detail">${u.email || '-'} ${u.phone ? '| ' + u.phone : ''}</div>
                    </div>
                `).join('');

                // Add click handlers
                suggestionsDiv.querySelectorAll('.suggestion-item').forEach(el => {
                    el.addEventListener('click', () => {
                        selectCustomer(customerSearchCache[parseInt(el.dataset.index)]);
                        suggestionsDiv.style.display = 'none';
                    });
                    el.addEventListener('mouseover', () => {
                        customerSelectedIndex = parseInt(el.dataset.index);
                        updateCustomerHighlight();
                    });
                });
            }
            suggestionsDiv.style.display = 'block';
        } catch (error) {
            console.error('Error searching customers:', error);
        }
    });

    // Keyboard navigation
    searchInput.addEventListener('keydown', (e) => {
        const items = suggestionsDiv.querySelectorAll('.suggestion-item');

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (items.length > 0) {
                customerSelectedIndex = Math.min(customerSelectedIndex + 1, items.length - 1);
                updateCustomerHighlight();
            }
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (items.length > 0) {
                customerSelectedIndex = Math.max(customerSelectedIndex - 1, 0);
                updateCustomerHighlight();
            }
        } else if (e.key === 'Enter' && suggestionsDiv.style.display === 'block') {
            e.preventDefault();
            if (customerSelectedIndex >= 0 && customerSearchCache[customerSelectedIndex]) {
                selectCustomer(customerSearchCache[customerSelectedIndex]);
                suggestionsDiv.style.display = 'none';
                customerSelectedIndex = -1;
            } else {
                suggestionsDiv.style.display = 'none';
            }
        } else if (e.key === 'Escape') {
            suggestionsDiv.style.display = 'none';
            customerSelectedIndex = -1;
        }
    });

    // Hide suggestions when clicking outside
    document.addEventListener('click', (e) => {
        if (!searchInput.contains(e.target) && !suggestionsDiv.contains(e.target)) {
            suggestionsDiv.style.display = 'none';
            customerSelectedIndex = -1;
        }
    });

    function updateCustomerHighlight() {
        const items = suggestionsDiv.querySelectorAll('.suggestion-item');
        items.forEach((el, idx) => {
            el.classList.toggle('highlighted', idx === customerSelectedIndex);
        });
        // Scroll into view
        if (customerSelectedIndex >= 0 && items[customerSelectedIndex]) {
            items[customerSelectedIndex].scrollIntoView({ block: 'nearest' });
        }
    }

    function selectCustomer(user) {
        // Fill in all customer fields
        document.getElementById('booking-customer-name').value = user.name || '';
        document.getElementById('booking-customer-email').value = user.email || '';
        document.getElementById('booking-customer-phone').value = user.phone || '';
    }
}

function updateSuggestionHighlight(container) {
    const suggestions = container.querySelectorAll('.player-suggestion');
    suggestions.forEach((el, idx) => {
        if (idx === selectedSuggestionIndex) {
            el.style.background = 'rgba(0,255,245,0.2)';
        } else {
            el.style.background = 'transparent';
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
            ${p.name}
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
        selectedDate = null;
        document.getElementById('selected-date-display').textContent = '-';
        document.getElementById('daily-bookings-timeline').innerHTML = '<p style="color: var(--text-secondary); padding: 1rem;">Seleziona una data dal calendario</p>';
        renderCalendar();
    });

    document.getElementById('next-month')?.addEventListener('click', () => {
        currentMonth++;
        if (currentMonth > 11) {
            currentMonth = 0;
            currentYear++;
        }
        selectedDate = null;
        document.getElementById('selected-date-display').textContent = '-';
        document.getElementById('daily-bookings-timeline').innerHTML = '<p style="color: var(--text-secondary); padding: 1rem;">Seleziona una data dal calendario</p>';
        renderCalendar();
    });

    // Date picker - jump to specific date
    document.getElementById('date-picker')?.addEventListener('change', (e) => {
        const dateStr = e.target.value;
        if (dateStr) {
            const [year, month, day] = dateStr.split('-').map(Number);
            currentYear = year;
            currentMonth = month - 1; // month is 0-indexed
            renderCalendar();
            // Select the chosen date after calendar renders
            setTimeout(() => selectDate(dateStr), 100);
        }
    });

    // Today button
    document.getElementById('today-btn')?.addEventListener('click', () => {
        const now = new Date();
        currentYear = now.getFullYear();
        currentMonth = now.getMonth();
        renderCalendar();
        const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
        setTimeout(() => selectDate(todayStr), 100);
    });

    // New booking button - propone data odierna, campo da selezionare
    document.getElementById('new-booking-btn')?.addEventListener('click', () => {
        document.getElementById('booking-form').reset();
        delete document.getElementById('booking-form').dataset.editingId;
        document.getElementById('booking-submit-btn').textContent = 'Crea Prenotazione';
        clearSelectedPlayers();
        populateCourtSelect();

        // Pulisci timeline slot (utente deve scegliere campo prima)
        document.getElementById('booking-timeline-slots').innerHTML = '<p style="color: var(--text-secondary); padding: 1rem;">Seleziona un campo per vedere gli orari disponibili</p>';
        document.getElementById('selected-slot-info').textContent = '';

        document.getElementById('booking-modal').style.display = 'flex';

        // Imposta data odierna con delay per iOS Safari
        setTimeout(() => {
            const today = new Date().toISOString().split('T')[0];
            const dateInput = document.getElementById('booking-date');
            dateInput.value = today;
            dateInput.setAttribute('value', today);
        }, 50);
    });

    // Setup player search for bookings
    setupPlayerSearch();

    // Setup customer name autocomplete
    setupCustomerNameSearch();

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

    // Update slot info when duration changes
    document.getElementById('booking-duration')?.addEventListener('change', updateSelectedSlotInfo);

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

    // New user button (unified users)
    document.getElementById('new-user-btn')?.addEventListener('click', () => {
        openNewUserModal();
    });

    // User form submit (unified users)
    document.getElementById('user-form')?.addEventListener('submit', saveUnifiedUser);

    // Player search - now handled by onPlayerSearchInput() with autocomplete
    // document.getElementById('player-search')?.addEventListener('input', (e) => {
    //     clearTimeout(window.playerSearchTimeout);
    //     window.playerSearchTimeout = setTimeout(() => {
    //         loadPlayers(e.target.value);
    //     }, 300);
    // });

    // Close video modal
    document.getElementById('close-video-modal')?.addEventListener('click', () => {
        document.getElementById('video-player-modal').style.display = 'none';
        document.getElementById('video-player-container').innerHTML = '';
    });

    // Associate NAS video form submit
    document.getElementById('associate-nas-video-form')?.addEventListener('submit', handleAssociateNasVideo);

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
        showNotification('Seleziona campo, data e orario', 'error');
        return;
    }

    // Calculate end_time based on selected duration or court's slot duration
    const court = courtsCache.find(c => String(c.id) === String(courtId));
    const selectedDuration = parseInt(document.getElementById('booking-duration').value) || 0;
    const slotDuration = selectedDuration > 0 ? selectedDuration : (court ? (court.default_duration_minutes || 90) : 90);

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

        const response = await apiFetch(url, {
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
        showNotification('Errore: ' + error.message, 'error');
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

        const response = await apiFetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(formData)
        });

        const data = await response.json();

        if (response.ok && (data.success || data.court || data.id)) {
            document.getElementById('court-modal').style.display = 'none';
            await loadCourts();
        loadCalendarCoverage();
            renderCourtsList();
        } else {
            throw new Error(data.message || data.error || 'Errore salvataggio');
        }
    } catch (error) {
        showNotification('Errore: ' + error.message, 'error');
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

        const response = await apiFetch(url, {
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
        showNotification('Errore: ' + error.message, 'error');
    }
}

// ==========================================
// MATCH VIDEO PLAYER
// ==========================================
// Store current match info for video association
let currentVideoMatchId = null;
let currentVideoMatchTitle = null;

async function showMatchVideos(partitaId, partitaTitle) {
    const modal = document.getElementById('video-player-modal');
    const titleEl = document.getElementById('video-modal-title');
    const listContainer = document.getElementById('video-list-container');
    const playerContainer = document.getElementById('video-player-container');

    // Store for later use
    currentVideoMatchId = partitaId;
    currentVideoMatchTitle = partitaTitle;

    titleEl.textContent = `Video: ${partitaTitle}`;
    listContainer.innerHTML = '<p>Caricamento video...</p>';
    playerContainer.innerHTML = '';
    modal.style.display = 'flex';

    try {
        const response = await apiFetch(`${API_BASE_URL}/videos/match/${partitaId}`);
        const videos = await response.json();

        if (!videos || videos.length === 0) {
            listContainer.innerHTML = '<p style="color: var(--text-secondary);">Nessun video disponibile per questa partita</p>';
            return;
        }

        listContainer.innerHTML = `
            <div style="display: flex; flex-wrap: wrap; gap: 1rem;">
                ${videos.map(video => `
                    <div class="stat-card" style="position: relative; flex: 1; min-width: 200px;">
                        <button
                            onclick="deleteVideo('${video.id}', '${video.title}', '${partitaId}', '${partitaTitle}'); event.stopPropagation();"
                            class="btn btn-danger"
                            style="position: absolute; top: 8px; right: 8px; padding: 4px 8px; font-size: 0.8rem; z-index: 10;"
                            title="Elimina video">
                            🗑️
                        </button>
                        <div style="cursor: pointer;" onclick="playVideo('${video.id}', '${video.title}')">
                            <div class="stat-icon">🎬</div>
                            <div class="stat-info">
                                <h3 style="font-size: 1rem;">${video.title}</h3>
                                <p>${formatDuration(video.duration_seconds)} | ${formatBytes(video.file_size_bytes)}</p>
                            </div>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    } catch (error) {
        listContainer.innerHTML = `<p style="color: var(--danger);">Errore: ${error.message}</p>`;
    }
}

function deleteVideo(videoId, videoTitle, partitaId, partitaTitle) {
    showConfirmDialog(
        'Elimina Video',
        `Sei sicuro di voler eliminare il video "${videoTitle}"?\n\nQuesta azione eliminerà il video sia dal database che dal NAS.`,
        'Elimina',
        () => executeDeleteVideo(videoId, partitaId, partitaTitle)
    );
}

async function executeDeleteVideo(videoId, partitaId, partitaTitle) {
    try {
        const response = await apiFetch(`${API_BASE_URL}/videos/${videoId}`, {
            method: 'DELETE'
        });

        const result = await response.json();

        if (result.success) {
            showNotification('Video eliminato con successo', 'success');
            // Ricarica la lista dei video
            showMatchVideos(partitaId, partitaTitle);
        } else {
            showNotification(`Errore: ${result.error || 'Eliminazione fallita'}`, 'error');
        }
    } catch (error) {
        console.error('Delete video error:', error);
        showNotification(`Errore durante l'eliminazione: ${error.message}`, 'error');
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

async function showAssociateNasVideoModal() {
    document.getElementById('associate-nas-video-modal').style.display = 'flex';

    // Clear form
    document.getElementById('nas-video-path').value = '';
    document.getElementById('nas-video-selected').value = '';
    document.getElementById('nas-video-title').value = '';
    document.getElementById('nas-video-duration').value = '';

    // Load available videos from NAS
    await loadNasVideoList();
}

async function loadNasVideoList() {
    const listContainer = document.getElementById('nas-video-list');
    listContainer.innerHTML = '<p style="color: var(--text-secondary); text-align: center;">Caricamento file...</p>';

    try {
        const response = await apiFetch(`${API_BASE_URL}/videos/list-nas-files`);
        const data = await response.json();

        if (!data.success || !data.files || data.files.length === 0) {
            listContainer.innerHTML = '<p style="color: var(--text-secondary); text-align: center;">Nessun file video trovato</p>';
            return;
        }

        listContainer.innerHTML = data.files.map(file => `
            <div
                onclick="selectNasVideo('${file.path}', '${file.name}', ${file.size})"
                style="
                    padding: 0.75rem;
                    margin-bottom: 0.5rem;
                    border: 1px solid var(--border);
                    border-radius: 6px;
                    cursor: pointer;
                    transition: all 0.2s;
                    background: var(--bg-secondary);
                "
                onmouseover="this.style.background='var(--accent-primary)'; this.style.borderColor='var(--accent-primary)'"
                onmouseout="this.style.background='var(--bg-secondary)'; this.style.borderColor='var(--border)'">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <div style="font-weight: 500; margin-bottom: 0.25rem;">📹 ${file.name}</div>
                        <div style="font-size: 0.85rem; color: var(--text-secondary);">
                            ${formatBytes(file.size)} • ${new Date(file.modified).toLocaleString('it-IT')}
                        </div>
                    </div>
                    <div style="color: var(--accent-primary);">➜</div>
                </div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Error loading NAS video list:', error);
        listContainer.innerHTML = '<p style="color: var(--danger); text-align: center;">Errore nel caricamento dei file</p>';
    }
}

function selectNasVideo(filePath, fileName, fileSize) {
    document.getElementById('nas-video-path').value = filePath;
    document.getElementById('nas-video-selected').value = fileName;

    // Auto-fill title with filename (without extension)
    const titleWithoutExt = fileName.replace(/\.[^/.]+$/, '');
    document.getElementById('nas-video-title').value = titleWithoutExt;

    // Highlight selected file
    const listContainer = document.getElementById('nas-video-list');
    const items = listContainer.querySelectorAll('div[onclick]');
    items.forEach(item => {
        if (item.getAttribute('onclick').includes(filePath)) {
            item.style.background = 'var(--accent-primary)';
            item.style.borderColor = 'var(--accent-primary)';
        } else {
            item.style.background = 'var(--bg-secondary)';
            item.style.borderColor = 'var(--border)';
        }
    });
}

function closeAssociateNasVideoModal() {
    document.getElementById('associate-nas-video-modal').style.display = 'none';
}

async function handleAssociateNasVideo(e) {
    e.preventDefault();

    const filePath = document.getElementById('nas-video-path').value;
    const title = document.getElementById('nas-video-title').value;
    const duration = parseInt(document.getElementById('nas-video-duration').value);

    if (!currentVideoMatchId) {
        showNotification('Errore: nessun match selezionato', 'error');
        return;
    }

    try {
        const response = await apiFetch(`${API_BASE_URL}/videos/associate-from-nas`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                matchId: currentVideoMatchId,
                filePath,
                title,
                durationSeconds: duration
            })
        });

        const result = await response.json();

        if (result.success) {
            showNotification('Video associato con successo', 'success');
            closeAssociateNasVideoModal();
            // Ricarica la lista dei video
            showMatchVideos(currentVideoMatchId, currentVideoMatchTitle);
        } else {
            showNotification(`Errore: ${result.error || 'Associazione fallita'}`, 'error');
        }
    } catch (error) {
        console.error('Associate NAS video error:', error);
        showNotification(`Errore durante l'associazione: ${error.message}`, 'error');
    }
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
        const response = await apiFetch(`${API_BASE_URL}/matches/create`, {
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
    if (authCredentials) {
        xhr.setRequestHeader('Authorization', `Basic ${authCredentials}`);
    }
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
        const response = await apiFetch(`${API_BASE_URL}/matches/search?${params.toString()}`);
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
    // Evita conversione timezone - usa stringa direttamente
    const dateStr = partita.match_date;
    let partitaDate;
    if (typeof dateStr === 'string') {
        // Formato: "2025-11-22T10:00:00.000Z" o "2025-11-22 10:00:00"
        const match = dateStr.match(/(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
        if (match) {
            partitaDate = `${match[3]}/${match[2]}/${match[1]} ${match[4]}:${match[5]}`;
        } else {
            partitaDate = dateStr;
        }
    } else {
        partitaDate = new Date(dateStr).toLocaleString();
    }
    const isActive = partita.is_active;
    const videoCount = partita.video_count || 0;

    return `
        <div class="match-card">
            <div class="match-card-header">
                <div>
                    <h4 class="match-card-title" style="margin-bottom: 0.5rem;">
                        ${partita.booking_code}
                        <button class="btn-copy" onclick="copyToClipboard('${partita.booking_code}', this)" title="Copia codice">📋</button>
                    </h4>
                    <span class="badge ${isActive ? 'badge-active' : 'badge-inactive'}">
                        ${isActive ? 'Active' : 'Inactive'}
                    </span>
                </div>
                <div class="match-card-actions">
                    ${videoCount > 0 ? `<button class="btn btn-secondary btn-small" onclick="showMatchVideos('${partita.id}', '${partita.booking_code}')">▶️ Video (${videoCount})</button>` : ''}
                    <button class="btn btn-success btn-small" onclick="openUploadVideo('${partita.id}', '${partita.booking_code}')">📤 Upload</button>
                    <button class="btn btn-secondary btn-small" onclick="showMatchQRCode('${partita.booking_code}', '${partita.access_password}', '${partita.player_names[0] || 'Giocatore'}')">📱 QR</button>
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
                    <span class="match-detail-value"><code title="${partita.id}">${partita.id.substring(0, 8)}...</code> <button class="btn-copy" onclick="copyToClipboard('${partita.id}', this)" title="Copia ID completo">📋</button></span>
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

// Genera e visualizza QR code per match
function showMatchQRCode(bookingCode, password, playerName) {
    // Formato: idpren|pwd|giocatore
    const qrData = `${bookingCode}|${password}|${playerName}`;

    // Crea modal per QR code
    let modal = document.getElementById('qr-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'qr-modal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 400px; text-align: center;">
                <h3>QR Code Partita</h3>
                <div id="qr-code-container" style="margin: 1.5rem 0; display: flex; justify-content: center;"></div>
                <p style="font-family: monospace; background: var(--bg-secondary); padding: 0.5rem; border-radius: 4px; word-break: break-all;" id="qr-data-display"></p>
                <div style="margin-top: 1rem; display: flex; gap: 0.5rem; justify-content: center;">
                    <button class="btn btn-primary" onclick="downloadQRCode()">📥 Scarica PNG</button>
                    <button class="btn btn-secondary" onclick="document.getElementById('qr-modal').style.display='none'">Chiudi</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }

    // Genera QR code usando l'API di QR Server (gratuita)
    const qrContainer = document.getElementById('qr-code-container');
    const qrDataDisplay = document.getElementById('qr-data-display');

    // Usa Google Charts API per generare QR
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrData)}`;
    qrContainer.innerHTML = `<img id="qr-image" src="${qrUrl}" alt="QR Code" style="border-radius: 8px;">`;
    qrDataDisplay.textContent = qrData;

    // Store data for download
    modal.dataset.qrData = qrData;
    modal.dataset.bookingCode = bookingCode;

    modal.style.display = 'flex';
}

function downloadQRCode() {
    const modal = document.getElementById('qr-modal');
    const qrData = modal.dataset.qrData;
    const bookingCode = modal.dataset.bookingCode;

    // Download usando fetch per convertire in blob
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(qrData)}`;

    fetch(qrUrl)
        .then(response => response.blob())
        .then(blob => {
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `QR_${bookingCode}.png`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            a.remove();
        })
        .catch(err => {
            console.error('Error downloading QR:', err);
            showNotification('Errore nel download del QR code', 'error');
        });
}

async function editMatch(partitaId) {
    try {
        const response = await apiFetch(`${API_BASE_URL}/matches/id/${partitaId}`);
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
        showNotification('Error loading partita: ' + error.message, 'error');
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
        const response = await apiFetch(`${API_BASE_URL}/matches/${partitaId}`, {
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

function deleteMatch(partitaId, bookingCode) {
    showConfirmDialog(
        'Elimina Partita',
        `Eliminare la partita "${bookingCode}"? Verranno eliminati anche tutti i video associati!`,
        'Elimina',
        () => executeDeleteMatch(partitaId)
    );
}

async function executeDeleteMatch(partitaId) {
    try {
        const response = await apiFetch(`${API_BASE_URL}/matches/${partitaId}`, { method: 'DELETE' });
        const data = await response.json();

        if (response.ok && data.success) {
            showNotification('Partita eliminata con successo', 'success');
            refreshMatchSearch();
        }
    } catch (error) {
        showNotification('Errore: ' + error.message, 'error');
    }
}

// Storage Info
async function loadStorageInfo() {
    const storageInfoEl = document.getElementById('storage-info');
    try {
        const response = await apiFetch(`${API_BASE_URL}/stats/storage`);
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
        showNotification('Seleziona un file video', 'error');
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
    if (authCredentials) {
        xhr.setRequestHeader('Authorization', `Basic ${authCredentials}`);
    }

    xhr.upload.onprogress = function(e) {
        if (e.lengthComputable) {
            const percent = Math.round((e.loaded / e.total) * 100);
            document.getElementById('progress-bar').style.width = percent + '%';
            document.getElementById('progress-text').textContent = percent + '%';
        }
    };

    xhr.onload = function() {
        if (xhr.status === 200 || xhr.status === 201) {
            closeUploadModal();
            refreshMatchSearch();
            showNotification('Video caricato con successo', 'success');
        } else {
            showNotification('Errore upload: ' + xhr.responseText, 'error');
        }
    };

    xhr.onerror = function() {
        showNotification('Errore di connessione', 'error');
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
        showNotification('Seleziona un file video', 'error');
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
    if (authCredentials) {
        xhr.setRequestHeader('Authorization', `Basic ${authCredentials}`);
    }

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

    // Update calendar coverage bars for filtered sport
    loadCalendarCoverage();
}

// ==========================================
// PLAYER BOOKINGS SEARCH MODAL
// ==========================================
let playerBookingsSearchTimeout = null;
let playerBookingsSuggestions = [];
let playerBookingsSuggestionIndex = -1;
let selectedPlayerForBookings = null;
let modalSportFilter = null;

function openPlayerBookingsSearch() {
    const modal = document.getElementById('player-bookings-modal');
    modal.style.display = 'flex';

    // Reset state
    document.getElementById('player-search-container').style.display = 'block';
    document.getElementById('player-bookings-search-input').value = '';
    document.getElementById('player-bookings-suggestions').style.display = 'none';
    document.getElementById('selected-player-info').style.display = 'none';
    document.getElementById('player-bookings-results').innerHTML = '';
    selectedPlayerForBookings = null;
    playerBookingsSuggestions = [];
    playerBookingsSuggestionIndex = -1;
    modalSportFilter = null;

    // Reset sport filter buttons
    document.querySelectorAll('.modal-sport-filters .sport-filter-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.sport === 'all') btn.classList.add('active');
    });

    // Focus input
    setTimeout(() => {
        document.getElementById('player-bookings-search-input').focus();
    }, 100);
}

function filterModalBySport(sport) {
    modalSportFilter = sport;

    // Update active button
    document.querySelectorAll('.modal-sport-filters .sport-filter-btn').forEach(btn => {
        btn.classList.remove('active');
        if ((sport === null && btn.dataset.sport === 'all') || btn.dataset.sport === sport) {
            btn.classList.add('active');
        }
    });

    // Filter visible booking items
    document.querySelectorAll('#player-bookings-results .booking-item').forEach(item => {
        const itemSport = item.dataset.sport;

        if (sport === null || itemSport === sport) {
            item.style.display = '';
        } else {
            item.style.display = 'none';
        }
    });

    // Update section counts
    document.querySelectorAll('#player-bookings-results .bookings-section').forEach(section => {
        const visibleItems = section.querySelectorAll('.booking-item:not([style*="display: none"])').length;
        const header = section.querySelector('h4');
        if (header) {
            const baseText = header.textContent.replace(/\(\d+\)/, '').trim();
            header.textContent = `${baseText} (${visibleItems})`;
        }
        // Hide section if no visible items
        section.style.display = visibleItems > 0 ? '' : 'none';
    });
}

function closePlayerBookingsModal() {
    document.getElementById('player-bookings-modal').style.display = 'none';
}

function onPlayerBookingsSearchInput() {
    const input = document.getElementById('player-bookings-search-input');
    const query = input.value.trim();

    clearTimeout(playerBookingsSearchTimeout);

    if (query.length < 2) {
        document.getElementById('player-bookings-suggestions').style.display = 'none';
        playerBookingsSuggestions = [];
        playerBookingsSuggestionIndex = -1;
        return;
    }

    playerBookingsSearchTimeout = setTimeout(async () => {
        await searchPlayersForBookings(query);
    }, 200);
}

async function searchPlayersForBookings(query) {
    try {
        const response = await apiFetch(`${API_BASE_URL}/admin/unified-users?search=${encodeURIComponent(query)}&limit=10`);
        const data = await response.json();

        if (data.success && data.users && data.users.length > 0) {
            playerBookingsSuggestions = data.users;
            playerBookingsSuggestionIndex = -1;
            renderPlayerBookingsSuggestions();
        } else {
            playerBookingsSuggestions = [];
            document.getElementById('player-bookings-suggestions').style.display = 'none';
        }
    } catch (error) {
        console.error('Error searching players:', error);
    }
}

function renderPlayerBookingsSuggestions() {
    const dropdown = document.getElementById('player-bookings-suggestions');

    dropdown.innerHTML = playerBookingsSuggestions.map((user, index) => {
        const name = user.fullName || `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'N/A';
        const details = [user.email, user.phone].filter(Boolean).join(' - ') || '';
        const isSelected = index === playerBookingsSuggestionIndex;

        return `<div class="player-suggestion-item ${isSelected ? 'selected' : ''}"
                     data-index="${index}"
                     onclick="selectPlayerForBookings(${index})">
            <div class="suggestion-name">${name}</div>
            ${details ? `<div class="suggestion-details">${details}</div>` : ''}
        </div>`;
    }).join('');

    dropdown.style.display = 'block';
}

function onPlayerBookingsSearchKeydown(event) {
    const dropdown = document.getElementById('player-bookings-suggestions');

    if (dropdown.style.display === 'none' && event.key !== 'Escape') return;

    switch (event.key) {
        case 'ArrowDown':
            event.preventDefault();
            if (playerBookingsSuggestionIndex < playerBookingsSuggestions.length - 1) {
                playerBookingsSuggestionIndex++;
                renderPlayerBookingsSuggestions();
                scrollSuggestionIntoView();
            }
            break;
        case 'ArrowUp':
            event.preventDefault();
            if (playerBookingsSuggestionIndex > 0) {
                playerBookingsSuggestionIndex--;
                renderPlayerBookingsSuggestions();
                scrollSuggestionIntoView();
            }
            break;
        case 'Enter':
            event.preventDefault();
            if (playerBookingsSuggestionIndex >= 0 && playerBookingsSuggestions[playerBookingsSuggestionIndex]) {
                selectPlayerForBookings(playerBookingsSuggestionIndex);
            }
            break;
        case 'Escape':
            event.preventDefault();
            if (dropdown.style.display !== 'none') {
                dropdown.style.display = 'none';
            } else {
                closePlayerBookingsModal();
            }
            break;
    }
}

function scrollSuggestionIntoView() {
    const dropdown = document.getElementById('player-bookings-suggestions');
    const selectedItem = dropdown.querySelector('.player-suggestion-item.selected');
    if (selectedItem) {
        selectedItem.scrollIntoView({ block: 'nearest' });
    }
}

async function selectPlayerForBookings(index) {
    const user = playerBookingsSuggestions[index];
    if (!user) return;

    selectedPlayerForBookings = user;

    // Update UI - hide search, show selected player
    const name = user.fullName || `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'N/A';
    document.getElementById('selected-player-name').textContent = name;
    document.getElementById('selected-player-info').style.display = 'flex';
    document.getElementById('player-search-container').style.display = 'none';

    // Load bookings for this player
    await loadPlayerBookings(user);
}

function clearSelectedPlayer() {
    selectedPlayerForBookings = null;
    document.getElementById('selected-player-info').style.display = 'none';
    document.getElementById('player-search-container').style.display = 'block';
    document.getElementById('player-bookings-search-input').value = '';
    document.getElementById('player-bookings-results').innerHTML = '';
    document.getElementById('player-bookings-search-input').focus();
}

async function loadPlayerBookings(user) {
    const resultsDiv = document.getElementById('player-bookings-results');
    resultsDiv.innerHTML = '<p style="color: var(--text-secondary); text-align: center; padding: 2rem;">Caricamento prenotazioni...</p>';

    try {
        // Search by customer name - get all bookings
        const searchName = user.fullName || `${user.firstName || ''} ${user.lastName || ''}`.trim();
        const response = await apiFetch(`${API_BASE_URL}/bookings?customer_name=${encodeURIComponent(searchName)}`);
        const data = await response.json();

        let bookings = data.bookings || data || [];

        // Filter bookings that match this customer name (case insensitive)
        bookings = bookings.filter(b => {
            const customerName = (b.customer_name || '').toLowerCase();
            return customerName.includes(searchName.toLowerCase());
        });

        if (bookings.length === 0) {
            resultsDiv.innerHTML = '<p style="color: var(--text-secondary); text-align: center; padding: 2rem;">Nessuna prenotazione trovata per questo giocatore</p>';
            return;
        }

        // Sort by date descending
        bookings.sort((a, b) => {
            const dateA = new Date(a.booking_date + 'T' + a.start_time);
            const dateB = new Date(b.booking_date + 'T' + b.start_time);
            return dateB - dateA;
        });

        // Separate into upcoming and past
        const now = new Date();
        const upcoming = [];
        const past = [];

        bookings.forEach(b => {
            const bookingDateTime = new Date(b.booking_date.split('T')[0] + 'T' + b.start_time);
            if (bookingDateTime >= now) {
                upcoming.push(b);
            } else {
                past.push(b);
            }
        });

        // Sort upcoming by date ascending (nearest first)
        upcoming.sort((a, b) => {
            const dateA = new Date(a.booking_date + 'T' + a.start_time);
            const dateB = new Date(b.booking_date + 'T' + b.start_time);
            return dateA - dateB;
        });

        let html = '';

        // Upcoming bookings
        if (upcoming.length > 0) {
            html += `<div class="bookings-section">
                <h4 style="color: var(--success); margin-bottom: 0.75rem; padding-bottom: 0.5rem; border-bottom: 1px solid var(--border-color);">
                    Prossime Prenotazioni (${upcoming.length})
                </h4>
                <div class="bookings-list">`;

            upcoming.forEach(b => {
                html += renderBookingItem(b, 'upcoming');
            });

            html += '</div></div>';
        }

        // Past bookings
        if (past.length > 0) {
            html += `<div class="bookings-section" style="margin-top: 1.5rem;">
                <h4 style="color: var(--text-secondary); margin-bottom: 0.75rem; padding-bottom: 0.5rem; border-bottom: 1px solid var(--border-color);">
                    Prenotazioni Passate (${past.length})
                </h4>
                <div class="bookings-list">`;

            past.forEach(b => {
                html += renderBookingItem(b, 'past');
            });

            html += '</div></div>';
        }

        resultsDiv.innerHTML = html;

    } catch (error) {
        console.error('Error loading player bookings:', error);
        resultsDiv.innerHTML = '<p style="color: var(--danger); text-align: center; padding: 2rem;">Errore nel caricamento delle prenotazioni</p>';
    }
}

function renderBookingItem(booking, type) {
    const date = new Date(booking.booking_date.split('T')[0]);
    const dateStr = date.toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    const startTime = booking.start_time.substring(0, 5);
    const endTime = booking.end_time ? booking.end_time.substring(0, 5) : '';
    const courtName = booking.court_name || 'Campo';
    const sportType = booking.sport_type || '';
    const status = booking.status || 'pending';

    const statusColors = {
        confirmed: 'var(--success)',
        pending: 'var(--warning)',
        cancelled: 'var(--danger)'
    };

    const statusLabels = {
        confirmed: 'Confermata',
        pending: 'In attesa',
        cancelled: 'Cancellata'
    };

    const isPast = type === 'past';

    // Status element - clickable only if pending
    let statusHtml;
    if (status === 'pending') {
        statusHtml = `<div class="booking-item-status status-clickable"
                           onclick="event.stopPropagation(); quickConfirmBooking('${booking.id}')"
                           style="color: ${statusColors[status]}; cursor: pointer;"
                           title="Clicca per confermare">
            ${statusLabels[status]}
        </div>`;
    } else {
        statusHtml = `<div class="booking-item-status" style="color: ${statusColors[status] || 'var(--text-secondary)'}">
            ${statusLabels[status] || status}
        </div>`;
    }

    return `<div class="booking-item ${isPast ? 'past' : ''}" data-sport="${sportType}" onclick="goToBookingDate('${booking.booking_date.split('T')[0]}', '${booking.id}')" style="cursor: pointer;">
        <div class="booking-item-main">
            <div class="booking-item-date">
                <span class="date-text">${dateStr}</span>
                <span class="time-text">${startTime}${endTime ? ' - ' + endTime : ''}</span>
            </div>
            <div class="booking-item-info">
                <span class="court-name">${courtName}</span>
                ${sportType ? `<span class="sport-badge sport-${sportType}">${sportType}</span>` : ''}
            </div>
        </div>
        ${statusHtml}
    </div>`;
}

async function quickConfirmBooking(bookingId) {
    try {
        const response = await apiFetch(`${API_BASE_URL}/bookings/${bookingId}/confirm`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ payment_status: 'pending' })
        });

        if (response.ok) {
            showNotification('Prenotazione confermata', 'success');
            // Reload player bookings to update the list
            if (selectedPlayerForBookings) {
                await loadPlayerBookings(selectedPlayerForBookings);
            }
            // Also refresh the calendar coverage
            loadCalendarCoverage();
        } else {
            showNotification('Errore nella conferma della prenotazione', 'error');
        }
    } catch (error) {
        console.error('Error confirming booking:', error);
        showNotification('Errore nella conferma della prenotazione', 'error');
    }
}

async function loadAllPendingBookings() {
    const resultsDiv = document.getElementById('player-bookings-results');
    resultsDiv.innerHTML = '<p style="color: var(--text-secondary); text-align: center; padding: 2rem;">Caricamento prenotazioni in attesa...</p>';

    // Hide search container and show a label for pending bookings
    document.getElementById('player-search-container').style.display = 'none';
    document.getElementById('selected-player-info').style.display = 'flex';
    document.getElementById('selected-player-name').textContent = 'Tutte le prenotazioni in attesa';
    selectedPlayerForBookings = { isPendingSearch: true };

    try {
        const response = await apiFetch(`${API_BASE_URL}/bookings?status=pending`);
        const data = await response.json();

        let bookings = data.bookings || data || [];

        // Filter only pending bookings (in case backend doesn't filter)
        bookings = bookings.filter(b => b.status === 'pending');

        if (bookings.length === 0) {
            resultsDiv.innerHTML = '<p style="color: var(--success); text-align: center; padding: 2rem;">Nessuna prenotazione in attesa</p>';
            return;
        }

        // Sort by date ascending (nearest first)
        bookings.sort((a, b) => {
            const dateA = new Date(a.booking_date.split('T')[0] + 'T' + a.start_time);
            const dateB = new Date(b.booking_date.split('T')[0] + 'T' + b.start_time);
            return dateA - dateB;
        });

        // Separate into upcoming and past
        const now = new Date();
        const upcoming = [];
        const past = [];

        bookings.forEach(b => {
            const bookingDateTime = new Date(b.booking_date.split('T')[0] + 'T' + b.start_time);
            if (bookingDateTime >= now) {
                upcoming.push(b);
            } else {
                past.push(b);
            }
        });

        let html = '';

        // Upcoming pending bookings
        if (upcoming.length > 0) {
            html += `<div class="bookings-section">
                <h4 style="color: var(--warning); margin-bottom: 0.75rem; padding-bottom: 0.5rem; border-bottom: 1px solid var(--border-color);">
                    Prossime da Confermare (${upcoming.length})
                </h4>
                <div class="bookings-list">`;

            upcoming.forEach(b => {
                html += renderPendingBookingItem(b, 'upcoming');
            });

            html += '</div></div>';
        }

        // Past pending bookings
        if (past.length > 0) {
            html += `<div class="bookings-section" style="margin-top: 1.5rem;">
                <h4 style="color: var(--text-secondary); margin-bottom: 0.75rem; padding-bottom: 0.5rem; border-bottom: 1px solid var(--border-color);">
                    Passate non Confermate (${past.length})
                </h4>
                <div class="bookings-list">`;

            past.forEach(b => {
                html += renderPendingBookingItem(b, 'past');
            });

            html += '</div></div>';
        }

        resultsDiv.innerHTML = html;

    } catch (error) {
        console.error('Error loading pending bookings:', error);
        resultsDiv.innerHTML = '<p style="color: var(--danger); text-align: center; padding: 2rem;">Errore nel caricamento delle prenotazioni</p>';
    }
}

function renderPendingBookingItem(booking, type) {
    const date = new Date(booking.booking_date.split('T')[0]);
    const dateStr = date.toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    const startTime = booking.start_time.substring(0, 5);
    const endTime = booking.end_time ? booking.end_time.substring(0, 5) : '';
    const courtName = booking.court_name || 'Campo';
    const sportType = booking.sport_type || '';
    const customerName = booking.customer_name || 'N/A';
    const isPast = type === 'past';

    return `<div class="booking-item ${isPast ? 'past' : ''}" data-sport="${sportType}" onclick="goToBookingDate('${booking.booking_date.split('T')[0]}', '${booking.id}')" style="cursor: pointer;">
        <div class="booking-item-main">
            <div class="booking-item-date">
                <span class="date-text">${dateStr}</span>
                <span class="time-text">${startTime}${endTime ? ' - ' + endTime : ''}</span>
            </div>
            <div class="booking-item-info">
                <span class="customer-name" style="color: var(--text-primary); font-weight: 500;">${customerName}</span>
                <span class="court-name">${courtName}</span>
                ${sportType ? `<span class="sport-badge sport-${sportType}">${sportType}</span>` : ''}
            </div>
        </div>
        <div class="booking-item-status status-clickable"
             onclick="event.stopPropagation(); quickConfirmBookingFromPending('${booking.id}')"
             style="color: var(--warning); cursor: pointer;"
             title="Clicca per confermare">
            In attesa
        </div>
    </div>`;
}

async function quickConfirmBookingFromPending(bookingId) {
    try {
        const response = await apiFetch(`${API_BASE_URL}/bookings/${bookingId}/confirm`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ payment_status: 'pending' })
        });

        if (response.ok) {
            showNotification('Prenotazione confermata', 'success');
            // Reload pending bookings list
            await loadAllPendingBookings();
            // Also refresh the calendar coverage
            loadCalendarCoverage();
        } else {
            showNotification('Errore nella conferma della prenotazione', 'error');
        }
    } catch (error) {
        console.error('Error confirming booking:', error);
        showNotification('Errore nella conferma della prenotazione', 'error');
    }
}

function goToBookingDate(dateStr, bookingId) {
    // Close modal
    closePlayerBookingsModal();

    // Navigate to the date
    selectDate(dateStr);

    // After timeline renders, highlight and show the booking
    setTimeout(() => {
        const bookingBar = document.querySelector(`.timeline-booking-bar[onclick*="${bookingId}"]`);
        if (bookingBar) {
            bookingBar.scrollIntoView({ behavior: 'smooth', block: 'center' });
            bookingBar.classList.add('search-highlight');
            setTimeout(() => bookingBar.classList.remove('search-highlight'), 3000);
        }
        // Open booking details
        showBookingDetails(bookingId);
    }, 500);
}

// ==========================================
// BOOKING STATISTICS CHARTS
// ==========================================
let chartSport, chartWeek, chartMonth, chartYear;
let statsPeriodFilter = 'month';
let statsSportFilter = null;
let statsPlayerFilter = null; // { id, name } or null
let statsPlayerSuggestions = [];
let statsPlayerSuggestionIndex = -1;
let statsPlayerSearchTimeout = null;

function getStatsDateRange() {
    const now = new Date();
    const formatDate = (d) => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    };

    let fromDate, toDate;

    switch (statsPeriodFilter) {
        case 'month':
            fromDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
            toDate = formatDate(new Date(now.getFullYear(), now.getMonth() + 1, 0));
            break;
        case '3months':
            const threeMonthsAgo = new Date(now);
            threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
            fromDate = formatDate(threeMonthsAgo);
            toDate = formatDate(now);
            break;
        case '6months':
            const sixMonthsAgo = new Date(now);
            sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
            fromDate = formatDate(sixMonthsAgo);
            toDate = formatDate(now);
            break;
        case 'year':
            const oneYearAgo = new Date(now);
            oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
            fromDate = formatDate(oneYearAgo);
            toDate = formatDate(now);
            break;
        case 'custom':
            fromDate = document.getElementById('stats-from-date')?.value || formatDate(new Date(now.getFullYear(), 0, 1));
            toDate = document.getElementById('stats-to-date')?.value || formatDate(now);
            break;
        default:
            fromDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
            toDate = formatDate(new Date(now.getFullYear(), now.getMonth() + 1, 0));
            break;
    }

    return { fromDate, toDate };
}

function filterStatsByPeriod(period) {
    statsPeriodFilter = period;

    // Update active button
    document.querySelectorAll('.stats-period-filters .sport-filter-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.period === period) {
            btn.classList.add('active');
        }
    });

    // Show/hide custom date inputs
    const customDatesDiv = document.getElementById('stats-custom-dates');
    if (customDatesDiv) {
        customDatesDiv.style.display = period === 'custom' ? 'flex' : 'none';
    }

    // Only load stats if not custom (custom loads on date change)
    if (period !== 'custom') {
        loadBookingStats();
    }
}

function filterStatsBySport(sport) {
    statsSportFilter = sport;

    // Update active button
    document.querySelectorAll('.stats-sport-filters .sport-filter-btn').forEach(btn => {
        btn.classList.remove('active');
        if ((sport === null && btn.dataset.sport === 'all') || btn.dataset.sport === sport) {
            btn.classList.add('active');
        }
    });

    loadBookingStats();
}

function onStatsFilterChange() {
    const periodFilter = document.getElementById('stats-period-filter');
    const customDatesDiv = document.getElementById('stats-custom-dates');

    if (periodFilter && customDatesDiv) {
        customDatesDiv.style.display = periodFilter.value === 'custom' ? 'flex' : 'none';
    }

    loadBookingStats();
}

// ==================== STATS PLAYER FILTER ====================
function openStatsPlayerFilterModal() {
    const modal = document.getElementById('stats-player-filter-modal');
    modal.style.display = 'flex';
    document.getElementById('stats-player-filter-input').value = '';
    document.getElementById('stats-player-filter-suggestions').style.display = 'none';
    statsPlayerSuggestions = [];
    statsPlayerSuggestionIndex = -1;
    setTimeout(() => {
        document.getElementById('stats-player-filter-input').focus();
    }, 100);
}

function closeStatsPlayerFilterModal() {
    document.getElementById('stats-player-filter-modal').style.display = 'none';
}

function onStatsPlayerFilterInput() {
    const input = document.getElementById('stats-player-filter-input');
    const query = input.value.trim();

    clearTimeout(statsPlayerSearchTimeout);

    if (query.length < 2) {
        document.getElementById('stats-player-filter-suggestions').style.display = 'none';
        statsPlayerSuggestions = [];
        statsPlayerSuggestionIndex = -1;
        return;
    }

    statsPlayerSearchTimeout = setTimeout(async () => {
        await searchPlayersForStats(query);
    }, 200);
}

async function searchPlayersForStats(query) {
    try {
        const response = await apiFetch(`${API_BASE_URL}/admin/unified-users?search=${encodeURIComponent(query)}&limit=10`);
        const data = await response.json();

        if (data.success && data.users && data.users.length > 0) {
            statsPlayerSuggestions = data.users;
            statsPlayerSuggestionIndex = -1;
            renderStatsPlayerSuggestions();
        } else {
            statsPlayerSuggestions = [];
            document.getElementById('stats-player-filter-suggestions').style.display = 'none';
        }
    } catch (error) {
        console.error('Error searching players for stats:', error);
    }
}

function renderStatsPlayerSuggestions() {
    const dropdown = document.getElementById('stats-player-filter-suggestions');

    dropdown.innerHTML = statsPlayerSuggestions.map((user, index) => {
        const name = user.fullName || `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'N/A';
        const details = [user.email, user.phone].filter(Boolean).join(' - ') || '';
        const isSelected = index === statsPlayerSuggestionIndex;

        return `<div class="player-suggestion-item ${isSelected ? 'selected' : ''}"
                     data-index="${index}"
                     onclick="selectStatsPlayerFilter(${index})">
            <div class="suggestion-name">${name}</div>
            ${details ? `<div class="suggestion-details">${details}</div>` : ''}
        </div>`;
    }).join('');

    dropdown.style.display = 'block';
}

function onStatsPlayerFilterKeydown(event) {
    const dropdown = document.getElementById('stats-player-filter-suggestions');

    if (dropdown.style.display === 'none' && event.key !== 'Escape') return;

    switch (event.key) {
        case 'ArrowDown':
            event.preventDefault();
            if (statsPlayerSuggestionIndex < statsPlayerSuggestions.length - 1) {
                statsPlayerSuggestionIndex++;
                renderStatsPlayerSuggestions();
                scrollStatsPlayerSuggestionIntoView();
            }
            break;
        case 'ArrowUp':
            event.preventDefault();
            if (statsPlayerSuggestionIndex > 0) {
                statsPlayerSuggestionIndex--;
                renderStatsPlayerSuggestions();
                scrollStatsPlayerSuggestionIntoView();
            }
            break;
        case 'Enter':
            event.preventDefault();
            if (statsPlayerSuggestionIndex >= 0 && statsPlayerSuggestions[statsPlayerSuggestionIndex]) {
                selectStatsPlayerFilter(statsPlayerSuggestionIndex);
            }
            break;
        case 'Escape':
            closeStatsPlayerFilterModal();
            break;
    }
}

function scrollStatsPlayerSuggestionIntoView() {
    const dropdown = document.getElementById('stats-player-filter-suggestions');
    const selected = dropdown.querySelector('.player-suggestion-item.selected');
    if (selected) {
        selected.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
}

function selectStatsPlayerFilter(index) {
    const user = statsPlayerSuggestions[index];
    if (!user) return;

    const name = user.name || user.fullName || `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'N/A';

    statsPlayerFilter = {
        userId: user.userId || null,  // user_id dalla tabella bookings
        name: name,
        customerName: name  // Per matching esatto con customer_name
    };

    console.log('Stats player filter set:', statsPlayerFilter);

    // Update UI stats
    document.getElementById('stats-player-filter-label').textContent = name;
    document.getElementById('stats-player-filter-label').style.display = 'inline';
    document.getElementById('stats-player-filter-clear').style.display = 'inline';
    document.getElementById('stats-player-filter-icon').textContent = '✓';

    // Sincronizza con filtro timeline
    currentPlayerFilter = {
        id: user.userId || user.id,
        name: name,
        customerName: name.toLowerCase()
    };
    updateTimelineFilterUI(name);
    applyPlayerFilter();

    closeStatsPlayerFilterModal();
    loadBookingStats();
}

function clearStatsPlayerFilter() {
    statsPlayerFilter = null;
    document.getElementById('stats-player-filter-label').style.display = 'none';
    document.getElementById('stats-player-filter-clear').style.display = 'none';
    document.getElementById('stats-player-filter-icon').textContent = '👤';

    // Sincronizza: pulisci anche filtro timeline (skipStatsSync=true per evitare loop)
    clearPlayerFilter(true);

    loadBookingStats();
}

async function loadBookingStats() {
    try {
        const { fromDate, toDate } = getStatsDateRange();
        const sportFilter = statsSportFilter || '';

        // Build URL with filters
        let url = `${API_BASE_URL}/stats/bookings?from_date=${fromDate}&to_date=${toDate}`;
        if (sportFilter) {
            url += `&sport_type=${sportFilter}`;
        }
        if (statsPlayerFilter) {
            // Passa entrambi i parametri per catturare prenotazioni con user_id O customer_name
            if (statsPlayerFilter.userId) {
                url += `&user_id=${statsPlayerFilter.userId}`;
            }
            if (statsPlayerFilter.customerName) {
                url += `&customer_name=${encodeURIComponent(statsPlayerFilter.customerName)}`;
            }
        }

        console.log('[loadBookingStats] URL:', url);
        console.log('[loadBookingStats] statsPlayerFilter:', statsPlayerFilter);

        const response = await apiFetch(url);
        const data = await response.json();

        if (data.success) {
            renderStatsSummary(data.summary);
            renderSportChart(data.by_sport);
            renderWeekChart(data.daily_trend);
            renderMonthChart(data.daily_trend);
            renderYearChart(data.monthly_trend);
            renderHeatmap(data.heatmap);
        }
    } catch (error) {
        console.error('Error loading booking stats:', error);
    }
}

function renderStatsSummary(summary) {
    const container = document.getElementById('stats-summary');
    if (!container) return;

    const formatNumber = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

    const bookings = formatNumber(summary.total_bookings);
    const revenue = formatNumber(Math.round(summary.total_revenue));
    const hours = formatNumber(summary.total_hours);

    container.innerHTML = `
        <div style="background: linear-gradient(135deg, #4CAF50, #45a049); padding: 1rem; border-radius: 8px; text-align: center;">
            <div style="font-size: 1.8rem; font-weight: bold;">${bookings}</div>
            <div style="font-size: 0.85rem; opacity: 0.9;">Prenotazioni</div>
        </div>
        <div style="background: linear-gradient(135deg, #FF9800, #f57c00); padding: 1rem; border-radius: 8px; text-align: center;">
            <div style="font-size: 1.8rem; font-weight: bold;">${revenue}€</div>
            <div style="font-size: 0.85rem; opacity: 0.9;">Incasso</div>
        </div>
        <div style="background: linear-gradient(135deg, #2196F3, #1976d2); padding: 1rem; border-radius: 8px; text-align: center;">
            <div style="font-size: 1.8rem; font-weight: bold;">${hours}</div>
            <div style="font-size: 0.85rem; opacity: 0.9;">Ore giocate</div>
        </div>
    `;
}

function renderSportChart(bySport) {
    const ctx = document.getElementById('chart-sport');
    if (!ctx) return;

    const sportColors = { padel: '#4CAF50', tennis: '#FF9800', calcetto: '#2196F3' };
    const labels = bySport.map(s => s.sport_type.charAt(0).toUpperCase() + s.sport_type.slice(1));
    const data = bySport.map(s => s.count);
    const colors = bySport.map(s => sportColors[s.sport_type] || '#999');

    if (chartSport) chartSport.destroy();
    chartSport = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: colors,
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { position: 'bottom', labels: { color: '#fff' } }
            }
        }
    });
}

function renderWeekChart(dailyTrend) {
    const ctx = document.getElementById('chart-week');
    if (!ctx) return;

    // Get last 7 days from daily trend
    const last7 = dailyTrend.slice(-7);
    const days = last7.map(d => {
        const date = new Date(d.date);
        return date.toLocaleDateString('it-IT', { weekday: 'short' });
    });
    const counts = last7.map(d => d.count);

    if (chartWeek) chartWeek.destroy();
    chartWeek = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: days,
            datasets: [{
                label: 'Prenotazioni',
                data: counts,
                backgroundColor: '#00fff5',
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true, ticks: { color: '#a0a0a0' }, grid: { color: 'rgba(255,255,255,0.1)' } },
                x: { ticks: { color: '#a0a0a0' }, grid: { display: false } }
            }
        }
    });
}

function renderMonthChart(dailyTrend) {
    const ctx = document.getElementById('chart-month');
    if (!ctx) return;

    // Get current month data
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    const monthData = dailyTrend.filter(d => {
        const date = new Date(d.date);
        return date.getMonth() === currentMonth && date.getFullYear() === currentYear;
    });

    const days = monthData.map(d => new Date(d.date).getDate());
    const counts = monthData.map(d => d.count);

    if (chartMonth) chartMonth.destroy();
    chartMonth = new Chart(ctx, {
        type: 'line',
        data: {
            labels: days,
            datasets: [{
                label: 'Prenotazioni',
                data: counts,
                borderColor: '#00fff5',
                backgroundColor: 'rgba(0,255,245,0.1)',
                fill: true,
                tension: 0.3
            }]
        },
        options: {
            responsive: true,
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true, ticks: { color: '#a0a0a0' }, grid: { color: 'rgba(255,255,255,0.1)' } },
                x: { ticks: { color: '#a0a0a0', maxTicksLimit: 10 }, grid: { display: false } }
            }
        }
    });
}

function renderYearChart(monthlyTrend) {
    const ctx = document.getElementById('chart-year');
    if (!ctx) return;

    const monthNames = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];
    const counts = Array(12).fill(0);

    monthlyTrend.forEach(m => {
        const date = new Date(m.month);
        const monthIndex = date.getMonth();
        counts[monthIndex] = m.count;
    });

    if (chartYear) chartYear.destroy();
    chartYear = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: monthNames,
            datasets: [{
                label: 'Prenotazioni',
                data: counts,
                backgroundColor: '#7b2cbf',
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true, ticks: { color: '#a0a0a0' }, grid: { color: 'rgba(255,255,255,0.1)' } },
                x: { ticks: { color: '#a0a0a0' }, grid: { display: false } }
            }
        }
    });
}

// Render Heatmap (solo orari con scala colori graduale)
function renderHeatmap(heatmapData) {
    const container = document.getElementById('heatmap-container');
    if (!container) return;

    // Aggrega per ora (somma tutti i giorni)
    const hourTotals = {};
    heatmapData.forEach(item => {
        if (!hourTotals[item.hour]) hourTotals[item.hour] = 0;
        hourTotals[item.hour] += item.count;
    });

    // Trova il massimo
    let maxCount = 0;
    Object.values(hourTotals).forEach(count => {
        if (count > maxCount) maxCount = count;
    });

    // Determina livello heat (0-10) - graduale
    const getHeatLevel = (count) => {
        if (count === 0 || !count) return 0;
        if (maxCount === 0) return 0;
        const ratio = count / maxCount;
        // Scala da 1 a 10 in base alla percentuale
        return Math.min(10, Math.max(1, Math.ceil(ratio * 10)));
    };

    // Build HTML - celle colorate con numero in sovraimpressione (8:00-21:00)
    let html = '';
    for (let h = 8; h <= 21; h++) {
        const count = hourTotals[h] || 0;
        const heatLevel = getHeatLevel(count);

        html += `
            <div class="hour-cell heat-${heatLevel}" title="${h}:00 - ${count} prenotazioni">
                <span class="hour-cell-count">${count}</span>
                <span class="hour-cell-label">${h}:00</span>
            </div>
        `;
    }

    container.innerHTML = html;
}

// Load stats when switching to bookings page
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        if (document.getElementById('chart-sport')) {
            loadBookingStats();
        }
    }, 1000);
});

// ==================== TEST SECTION ====================

async function testSynologyConnection() {
    const host = document.getElementById('test-synology-host').value;
    const port = document.getElementById('test-synology-port').value;
    const user = document.getElementById('test-synology-user').value;
    const pass = document.getElementById('test-synology-pass').value;

    const resultsDiv = document.getElementById('test-results');
    const outputDiv = document.getElementById('test-output');

    if (!host || !port || !user || !pass) {
        outputDiv.innerHTML = '<p style="color: var(--danger);">⚠️ Compila tutti i campi!</p>';
        resultsDiv.style.display = 'block';
        return;
    }

    outputDiv.innerHTML = '<p>🔄 Test connessione in corso...</p>';
    resultsDiv.style.display = 'block';

    try {
        const response = await apiFetch(`${API_BASE_URL}/synology/test-connection`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ host, port, user, pass })
        });

        const data = await response.json();

        if (response.ok && data.success) {
            outputDiv.innerHTML = `
                <p style="color: var(--success);">✅ Connessione riuscita!</p>
                <pre style="background: rgba(0,0,0,0.3); padding: 1rem; border-radius: 8px; overflow-x: auto; margin-top: 1rem;">${JSON.stringify(data, null, 2)}</pre>
            `;
        } else {
            outputDiv.innerHTML = `
                <p style="color: var(--danger);">❌ Connessione fallita</p>
                <p style="color: #a0a0a0;">${data.error || data.message || 'Errore sconosciuto'}</p>
            `;
        }
    } catch (error) {
        outputDiv.innerHTML = `
            <p style="color: var(--danger);">❌ Errore durante il test</p>
            <p style="color: #a0a0a0;">${error.message}</p>
        `;
    }
}

async function loadMatchesForTest() {
    try {
        const response = await apiFetch(`${API_BASE_URL}/matches/search`);
        const data = await response.json();

        const select = document.getElementById('recording-match');
        if (!select) return;

        select.innerHTML = '<option value="">-- Seleziona Match --</option>';

        if (data.matches && data.matches.length > 0) {
            data.matches.forEach(match => {
                const date = new Date(match.match_date).toLocaleDateString('it-IT');
                const players = match.player_names ? match.player_names.join(', ') : 'N/A';
                const option = document.createElement('option');
                option.value = match.id;
                option.textContent = `${match.booking_code} - ${date} - ${players}`;
                select.appendChild(option);
            });
        }
    } catch (error) {
        console.error('Error loading matches:', error);
    }
}

function validateDuration() {
    const date = document.getElementById('recording-date').value;
    const startTime = document.getElementById('recording-start-time').value;
    const endTime = document.getElementById('recording-end-time').value;
    const warningDiv = document.getElementById('duration-warning');

    if (!date || !startTime || !endTime) {
        warningDiv.style.display = 'none';
        return true;
    }

    const start = new Date(`${date}T${startTime}`);
    const end = new Date(`${date}T${endTime}`);
    const durationMinutes = (end - start) / 1000 / 60;

    if (durationMinutes > 90) {
        warningDiv.style.display = 'block';
        return false;
    } else if (durationMinutes <= 0) {
        warningDiv.textContent = '⚠️ L\'ora di fine deve essere successiva all\'ora di inizio!';
        warningDiv.style.display = 'block';
        return false;
    }

    warningDiv.style.display = 'none';
    return true;
}

// Add validation listeners
document.addEventListener('DOMContentLoaded', () => {
    const dateInput = document.getElementById('recording-date');
    const startTimeInput = document.getElementById('recording-start-time');
    const endTimeInput = document.getElementById('recording-end-time');

    if (dateInput) dateInput.addEventListener('change', validateDuration);
    if (startTimeInput) startTimeInput.addEventListener('change', validateDuration);
    if (endTimeInput) endTimeInput.addEventListener('change', validateDuration);
});

async function listCameras() {
    const host = document.getElementById('test-synology-host').value;
    const port = document.getElementById('test-synology-port').value;
    const user = document.getElementById('test-synology-user').value;
    const pass = document.getElementById('test-synology-pass').value;

    if (!host || !port || !user || !pass) {
        showNotification('Compila prima la configurazione Synology!', 'error');
        return;
    }

    const resultsDiv = document.getElementById('test-results');
    const outputDiv = document.getElementById('test-output');

    outputDiv.innerHTML = '<p>Caricamento telecamere...</p>';
    resultsDiv.style.display = 'block';

    try {
        const response = await apiFetch(`${API_BASE_URL}/synology/list-cameras`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ host, port, user, pass })
        });

        const data = await response.json();

        if (response.ok && data.success) {
            let html = `<p style="color: var(--success);">✅ Trovate ${data.count} telecamere</p>`;
            html += '<div style="margin-top: 1rem;">';

            data.cameras.forEach((cam) => {
                html += `
                    <div style="padding: 1rem; background: rgba(0,0,0,0.3); border-radius: 8px; margin-bottom: 0.5rem; cursor: pointer;"
                         onclick="document.getElementById('test-camera-id').value = ${cam.id}; showNotification('Camera ID ${cam.id} selezionata!', 'success')">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <div>
                                <strong style="color: var(--accent-primary);">ID: ${cam.id}</strong>
                                <span style="margin-left: 1rem;">${cam.name}</span>
                            </div>
                            <div style="color: #a0a0a0;">
                                ${cam.model || 'N/A'} - ${cam.vendor || 'N/A'}
                            </div>
                        </div>
                        <small style="color: #a0a0a0; margin-top: 0.5rem; display: block;">
                            Status: ${cam.status} - ${cam.enabled ? 'Abilitata' : 'Disabilitata'} - Clicca per selezionare
                        </small>
                    </div>
                `;
            });

            html += '</div>';
            outputDiv.innerHTML = html;
        } else {
            outputDiv.innerHTML = `
                <p style="color: var(--danger);">❌ Errore</p>
                <p style="color: #a0a0a0;">${data.error || 'Errore sconosciuto'}</p>
            `;
        }
    } catch (error) {
        outputDiv.innerHTML = `
            <p style="color: var(--danger);">❌ Errore durante il caricamento</p>
            <p style="color: #a0a0a0;">${error.message}</p>
        `;
    }
}

async function listAvailableRecordings() {
    const host = document.getElementById('test-synology-host').value;
    const port = document.getElementById('test-synology-port').value;
    const user = document.getElementById('test-synology-user').value;
    const pass = document.getElementById('test-synology-pass').value;
    const cameraId = document.getElementById('test-camera-id').value;

    if (!host || !port || !user || !pass || !cameraId) {
        showNotification('Compila prima la configurazione Synology!', 'error');
        return;
    }

    const listDiv = document.getElementById('recordings-list');
    const outputDiv = document.getElementById('recordings-output');

    outputDiv.innerHTML = '<p>Caricamento registrazioni in corso...</p>';
    listDiv.style.display = 'block';

    try {
        const response = await apiFetch(`${API_BASE_URL}/synology/list-recordings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                host,
                port,
                user,
                pass,
                cameraId: parseInt(cameraId)
            })
        });

        const data = await response.json();

        if (response.ok && data.success) {
            if (data.recordings.length === 0) {
                outputDiv.innerHTML = '<p style="color: #a0a0a0;">Nessuna registrazione trovata nelle ultime 24 ore.</p>';
            } else {
                let html = `<p style="color: var(--success);">✅ Trovate ${data.count} registrazioni (ultime 24 ore)</p>`;

                // Debug: show raw data
                html += '<details style="margin: 1rem 0; padding: 0.5rem; background: rgba(0,0,0,0.2); border-radius: 4px;"><summary style="cursor: pointer; color: #a0a0a0;">🔍 Debug: Mostra dati raw</summary><pre style="overflow-x: auto; font-size: 0.8rem; margin-top: 0.5rem;">' + JSON.stringify(data.recordings, null, 2) + '</pre></details>';

                html += '<div style="margin-top: 1rem;">';

                data.recordings.forEach((rec, index) => {
                    const startDate = new Date(rec.startTime);
                    const endDate = new Date(rec.endTime);
                    const durationMin = Math.floor(rec.duration / 60);
                    const durationSec = rec.duration % 60;

                    // Store raw recording data as JSON string for onclick
                    const recDataJson = JSON.stringify(rec.raw || rec).replace(/"/g, '&quot;');

                    html += `
                        <div style="padding: 1rem; background: rgba(0,0,0,0.3); border-radius: 8px; margin-bottom: 0.5rem; cursor: pointer;"
                             onclick='selectRecordingForDownload(${JSON.stringify(rec.raw || rec)})'>
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <div>
                                    <strong style="color: var(--accent-primary);">#${index + 1} (ID: ${rec.id})</strong>
                                    <span style="margin-left: 1rem;">${startDate.toLocaleString('it-IT')}</span>
                                    <span style="margin-left: 0.5rem;">→</span>
                                    <span style="margin-left: 0.5rem;">${endDate ? endDate.toLocaleTimeString('it-IT') : 'In corso...'}</span>
                                </div>
                                <div style="color: #a0a0a0;">
                                    ${durationMin}m ${durationSec}s
                                </div>
                            </div>
                            <small style="color: #a0a0a0; margin-top: 0.5rem; display: block;">
                                Clicca per scaricare questa registrazione
                            </small>
                        </div>
                    `;
                });

                html += '</div>';
                outputDiv.innerHTML = html;
            }
        } else {
            outputDiv.innerHTML = `
                <p style="color: var(--danger);">❌ Errore</p>
                <p style="color: #a0a0a0;">${data.error || 'Errore sconosciuto'}</p>
            `;
        }
    } catch (error) {
        outputDiv.innerHTML = `
            <p style="color: var(--danger);">❌ Errore durante il caricamento</p>
            <p style="color: #a0a0a0;">${error.message}</p>
        `;
    }
}

let selectedRecording = null;

function selectRecordingForDownload(recordingData) {
    selectedRecording = recordingData;

    // Fill form with recording data
    const startDate = new Date(recordingData.startTime * 1000);
    const endDate = recordingData.stopTime ? new Date(recordingData.stopTime * 1000) : null;

    document.getElementById('recording-date').value = startDate.toISOString().split('T')[0];
    document.getElementById('recording-start-time').value = startDate.toTimeString().split(' ')[0].substring(0,5);
    if (endDate) {
        document.getElementById('recording-end-time').value = endDate.toTimeString().split(' ')[0].substring(0,5);
    }

    // Store recording info in hidden field
    document.getElementById('recording-event-id').value = recordingData.id || recordingData.eventId;

    // Scroll to download section
    document.querySelector('#recording-match').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function fillRecordingTimes(date, startTime, endTime) {
    document.getElementById('recording-date').value = date;
    document.getElementById('recording-start-time').value = startTime;
    document.getElementById('recording-end-time').value = endTime;
    validateDuration();

    // Scroll to download section
    document.querySelector('#recording-date').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function downloadRecording() {
    const matchId = document.getElementById('recording-match').value;
    const compressVideo = document.getElementById('compress-video').checked;

    if (!matchId) {
        showNotification('Seleziona un match!', 'error');
        return;
    }

    if (!selectedRecording) {
        showNotification('Seleziona prima una registrazione dalla lista!', 'error');
        return;
    }

    const progressDiv = document.getElementById('download-progress');
    const outputDiv = document.getElementById('download-output');

    if (compressVideo) {
        outputDiv.innerHTML = '<p>🔄 Download e compressione in corso (può richiedere alcuni minuti)...</p>';
    } else {
        outputDiv.innerHTML = '<p>🔄 Copia file in corso...</p>';
    }
    progressDiv.style.display = 'block';

    try {
        const response = await apiFetch(`${API_BASE_URL}/synology/download-recording-direct`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                recordingData: selectedRecording,
                matchId,
                compress: compressVideo
            })
        });

        const data = await response.json();

        if (response.ok && data.success) {
            outputDiv.innerHTML = `
                <p style="color: var(--success);">✅ Video scaricato con successo!</p>
                <div style="margin-top: 1rem; padding: 1rem; background: rgba(0,0,0,0.3); border-radius: 8px;">
                    <p><strong>File:</strong> ${data.filename || 'N/A'}</p>
                    <p><strong>Dimensione:</strong> ${data.fileSize ? (data.fileSize / 1024 / 1024).toFixed(2) + ' MB' : 'N/A'}</p>
                    <p><strong>Durata:</strong> ${data.duration ? data.duration + ' secondi' : 'N/A'}</p>
                    <p><strong>Match ID:</strong> ${data.matchId}</p>
                    <p><strong>Video ID:</strong> ${data.videoId}</p>
                </div>
            `;
        } else {
            outputDiv.innerHTML = `
                <p style="color: var(--danger);">❌ Download fallito</p>
                <p style="color: #a0a0a0;">${data.error || data.message || 'Errore sconosciuto'}</p>
            `;
        }
    } catch (error) {
        outputDiv.innerHTML = `
            <p style="color: var(--danger);">❌ Errore durante il download</p>
            <p style="color: #a0a0a0;">${error.message}</p>
        `;
    }
}

// ==================== CAMERA-COURT ASSOCIATIONS ====================

let cachedCameras = [];
let cachedCourts = [];

async function loadCameraCourtAssociations() {
    const container = document.getElementById('camera-court-associations');
    if (!container) return;

    container.innerHTML = '<p style="color: #a0a0a0;">Caricamento...</p>';

    try {
        // Carica campi e telecamere in parallelo
        const [courtsRes, camerasRes] = await Promise.all([
            apiFetch(`${API_BASE_URL}/courts/with-cameras`),
            getCachedCameras()
        ]);

        const courtsData = await courtsRes.json();
        if (!courtsData.success) throw new Error('Errore caricamento campi');

        cachedCourts = courtsData.courts;

        // Genera HTML per ogni campo
        let html = '<div style="display: grid; gap: 1rem; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));">';

        cachedCourts.forEach(court => {
            const currentCamera = court.camera_id;
            const cameraName = currentCamera ? (cachedCameras.find(c => c.id === currentCamera)?.name || `Camera ${currentCamera}`) : 'Non assegnata';

            html += `
                <div style="background: rgba(255,255,255,0.05); padding: 1rem; border-radius: 8px; border: 1px solid ${currentCamera ? 'var(--success)' : 'var(--border)'};">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
                        <strong style="color: var(--accent-primary);">${court.name}</strong>
                        <span style="font-size: 0.8rem; color: #a0a0a0;">${court.sport_type}</span>
                    </div>
                    <div style="display: flex; gap: 0.5rem; align-items: center;">
                        <select id="camera-select-${court.id}" style="flex: 1; padding: 0.5rem; border-radius: 4px; background: #1a1a2e; color: #fff; border: 1px solid #333;">
                            <option value="">-- Nessuna telecamera --</option>
                            ${cachedCameras.map(cam => `<option value="${cam.id}" ${cam.id === currentCamera ? 'selected' : ''}>${cam.name} (ID: ${cam.id})</option>`).join('')}
                        </select>
                        <button class="btn btn-primary" style="padding: 0.5rem 1rem;" onclick="saveCameraAssociation('${court.id}')">Salva</button>
                    </div>
                    <small style="color: ${currentCamera ? 'var(--success)' : '#a0a0a0'}; margin-top: 0.5rem; display: block;">
                        ${currentCamera ? `✓ ${cameraName}` : 'Nessuna telecamera associata'}
                    </small>
                </div>
            `;
        });

        html += '</div>';
        container.innerHTML = html;

        // Popola anche il select per il download automatico
        populateAutoDownloadCourtSelect();

    } catch (error) {
        console.error('Error loading associations:', error);
        container.innerHTML = `<p style="color: var(--danger);">Errore: ${error.message}</p>`;
    }
}

async function getCachedCameras() {
    if (cachedCameras.length > 0) {
        return { json: () => ({ success: true }) };
    }

    // Prova a caricare le telecamere da Synology
    try {
        const host = document.getElementById('test-synology-host')?.value || '192.168.1.69';
        const port = document.getElementById('test-synology-port')?.value || '5000';
        const user = document.getElementById('test-synology-user')?.value || 'admin';
        const pass = document.getElementById('test-synology-pass')?.value || 'Druido#00';

        const response = await apiFetch(`${API_BASE_URL}/synology/list-cameras`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ host, port, user, pass })
        });

        const data = await response.json();
        if (data.success && data.cameras) {
            cachedCameras = data.cameras;
        }
    } catch (e) {
        console.error('Error loading cameras:', e);
    }

    return { json: () => ({ success: true }) };
}

async function refreshCamerasForAssociation() {
    const container = document.getElementById('cameras-list-container');
    if (!container) return;

    container.style.display = 'block';
    container.innerHTML = '<p style="color: #a0a0a0;">🔄 Caricamento telecamere da Synology...</p>';

    try {
        const host = document.getElementById('test-synology-host')?.value || '192.168.1.69';
        const port = document.getElementById('test-synology-port')?.value || '5000';
        const user = document.getElementById('test-synology-user')?.value || 'admin';
        const pass = document.getElementById('test-synology-pass')?.value || 'Druido#00';

        const response = await apiFetch(`${API_BASE_URL}/synology/list-cameras`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ host, port, user, pass })
        });

        const data = await response.json();

        if (data.success && data.cameras) {
            cachedCameras = data.cameras;

            let html = `<p style="color: var(--success); margin-bottom: 1rem;">✅ Trovate ${data.cameras.length} telecamere</p>`;
            html += '<div style="display: grid; gap: 0.5rem; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));">';

            data.cameras.forEach(cam => {
                html += `
                    <div style="padding: 0.75rem; background: rgba(0,0,0,0.3); border-radius: 6px; display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <strong style="color: var(--accent-primary);">ID: ${cam.id}</strong>
                            <span style="margin-left: 0.5rem; color: #ccc;">${cam.name}</span>
                        </div>
                        <span style="color: ${cam.enabled ? 'var(--success)' : 'var(--danger)'}; font-size: 0.8rem;">${cam.enabled ? '● Attiva' : '○ Disattiva'}</span>
                    </div>
                `;
            });

            html += '</div>';
            html += '<p style="color: #a0a0a0; font-size: 0.85rem; margin-top: 1rem;">Le telecamere sono state aggiornate. Ricarica le associazioni per usarle.</p>';
            container.innerHTML = html;

            // Ricarica automaticamente le associazioni
            loadCameraCourtAssociations();
        } else {
            container.innerHTML = `<p style="color: var(--danger);">❌ Errore: ${data.error || 'Impossibile caricare le telecamere'}</p>`;
        }
    } catch (error) {
        container.innerHTML = `<p style="color: var(--danger);">❌ Errore: ${error.message}</p>`;
    }
}

async function saveCameraAssociation(courtId) {
    const select = document.getElementById(`camera-select-${courtId}`);
    if (!select) return;

    const cameraId = select.value ? parseInt(select.value) : null;

    try {
        const response = await apiFetch(`${API_BASE_URL}/courts/${courtId}/camera`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ camera_id: cameraId })
        });

        const data = await response.json();
        if (data.success) {
            showNotification('Associazione salvata!', 'success');
            loadCameraCourtAssociations(); // Ricarica per aggiornare UI
        } else {
            showNotification('Errore: ' + (data.error || 'Sconosciuto'), 'error');
        }
    } catch (error) {
        console.error('Error saving association:', error);
        showNotification('Errore: ' + error.message, 'error');
    }
}

// ==================== AUTO DOWNLOAD ====================

function populateAutoDownloadCourtSelect() {
    const select = document.getElementById('auto-download-court');
    if (!select) return;

    select.innerHTML = '<option value="">Tutti i campi con telecamera</option>';
    cachedCourts.filter(c => c.camera_id).forEach(court => {
        select.innerHTML += `<option value="${court.id}">${court.name}</option>`;
    });
}

async function previewAutoDownload() {
    const dateInput = document.getElementById('auto-download-date');
    const courtSelect = document.getElementById('auto-download-court');
    const previewDiv = document.getElementById('auto-download-preview');

    if (!dateInput || !previewDiv) return;

    const date = dateInput.value;
    if (!date) {
        showNotification('Seleziona una data', 'error');
        return;
    }

    previewDiv.style.display = 'block';
    previewDiv.innerHTML = '<p style="color: #a0a0a0;">Caricamento prenotazioni...</p>';

    try {
        let url = `${API_BASE_URL}/bookings/for-video-download?date=${date}`;
        if (courtSelect?.value) {
            url += `&court_id=${courtSelect.value}`;
        }

        const response = await apiFetch(url);
        const data = await response.json();

        if (!data.success) throw new Error(data.error);

        if (data.bookings.length === 0) {
            previewDiv.innerHTML = '<p style="color: var(--warning);">Nessuna prenotazione trovata per questa data con telecamera associata.</p>';
            return;
        }

        let html = `<h4 style="margin-bottom: 1rem;">Prenotazioni trovate: ${data.count}</h4>`;
        html += '<div style="display: grid; gap: 0.75rem;">';

        data.bookings.forEach(b => {
            const statusIcon = b.has_video ? '✅' : '⏳';
            const statusText = b.has_video ? 'Video già presente' : 'Da scaricare';
            const statusColor = b.has_video ? 'var(--success)' : 'var(--warning)';

            html += `
                <div style="background: rgba(255,255,255,0.05); padding: 1rem; border-radius: 8px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem;">
                    <div>
                        <strong>${b.court_name}</strong> - ${b.start_time.slice(0,5)}
                        <br><small style="color: #a0a0a0;">${b.customer_name || 'N/A'} | Camera ID: ${b.camera_id}</small>
                    </div>
                    <div style="text-align: right;">
                        <span style="color: ${statusColor};">${statusIcon} ${statusText}</span>
                        ${!b.has_video ? `<br><button class="btn btn-sm btn-success" style="margin-top: 0.25rem; padding: 0.25rem 0.5rem; font-size: 0.8rem;" onclick="downloadSingleVideo('${b.booking_id}', this)">Scarica</button>` : ''}
                    </div>
                </div>
            `;
        });

        html += '</div>';
        previewDiv.innerHTML = html;

    } catch (error) {
        console.error('Preview error:', error);
        previewDiv.innerHTML = `<p style="color: var(--danger);">Errore: ${error.message}</p>`;
    }
}

async function downloadSingleVideo(bookingId, button) {
    if (button) {
        button.disabled = true;
        button.textContent = 'Scaricando...';
    }

    try {
        const response = await apiFetch(`${API_BASE_URL}/videos/auto-download`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ booking_id: bookingId })
        });

        const data = await response.json();

        if (data.success) {
            if (button) {
                button.textContent = '✓ Fatto';
                button.style.background = 'var(--success)';
                button.parentElement.querySelector('span').textContent = '✅ Video scaricato';
                button.parentElement.querySelector('span').style.color = 'var(--success)';
            }
        } else {
            throw new Error(data.error || 'Download fallito');
        }
    } catch (error) {
        console.error('Download error:', error);
        if (button) {
            button.disabled = false;
            button.textContent = 'Riprova';
            button.style.background = 'var(--danger)';
        }
        showNotification('Errore download: ' + error.message, 'error');
    }
}

function startAutoDownload() {
    const dateInput = document.getElementById('auto-download-date');
    const progressDiv = document.getElementById('auto-download-progress');

    if (!dateInput || !progressDiv) return;

    const date = dateInput.value;
    if (!date) {
        showNotification('Seleziona una data', 'error');
        return;
    }

    // Conferma
    showConfirmDialog(
        'Download Automatico',
        'Vuoi avviare il download automatico dei video per tutte le prenotazioni senza video?',
        'Avvia',
        () => executeStartAutoDownload(date, progressDiv)
    );
}

async function executeStartAutoDownload(date, progressDiv) {
    const courtSelect = document.getElementById('auto-download-court');
    progressDiv.style.display = 'block';
    progressDiv.innerHTML = '<p style="color: var(--accent-primary);">Recupero prenotazioni...</p>';

    try {
        // Recupera prenotazioni
        let url = `${API_BASE_URL}/bookings/for-video-download?date=${date}`;
        if (courtSelect?.value) {
            url += `&court_id=${courtSelect.value}`;
        }

        const response = await apiFetch(url);
        const data = await response.json();

        if (!data.success) throw new Error(data.error);

        // Filtra solo quelle senza video
        const toDownload = data.bookings.filter(b => !b.has_video);

        if (toDownload.length === 0) {
            progressDiv.innerHTML = '<p style="color: var(--success);">✓ Tutti i video sono già stati scaricati!</p>';
            return;
        }

        progressDiv.innerHTML = `<p>Scaricamento ${toDownload.length} video in corso...</p><div id="download-log" style="max-height: 300px; overflow-y: auto; margin-top: 1rem;"></div>`;
        const logDiv = document.getElementById('download-log');

        let success = 0;
        let failed = 0;

        for (const booking of toDownload) {
            logDiv.innerHTML += `<p style="color: #a0a0a0;">⏳ ${booking.court_name} - ${booking.start_time.slice(0,5)}...</p>`;

            try {
                const dlResponse = await apiFetch(`${API_BASE_URL}/videos/auto-download`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ booking_id: booking.booking_id })
                });

                const dlData = await dlResponse.json();

                if (dlData.success) {
                    logDiv.lastElementChild.innerHTML = `<span style="color: var(--success);">✓ ${booking.court_name} - ${booking.start_time.slice(0,5)} scaricato</span>`;
                    success++;
                } else {
                    throw new Error(dlData.error);
                }
            } catch (err) {
                logDiv.lastElementChild.innerHTML = `<span style="color: var(--danger);">✗ ${booking.court_name} - ${booking.start_time.slice(0,5)}: ${err.message}</span>`;
                failed++;
            }
        }

        progressDiv.querySelector('p').innerHTML = `<span style="color: var(--success);">Download completato: ${success} ok, ${failed} falliti</span>`;

        // Aggiorna preview
        previewAutoDownload();

    } catch (error) {
        console.error('Auto download error:', error);
        progressDiv.innerHTML = `<p style="color: var(--danger);">Errore: ${error.message}</p>`;
    }
}

// Inizializza data di default per auto-download
document.addEventListener('DOMContentLoaded', () => {
    const dateInput = document.getElementById('auto-download-date');
    if (dateInput && !dateInput.value) {
        dateInput.value = new Date().toISOString().split('T')[0];
    }
});


// ==================== CLUB INFO MANAGEMENT ====================

async function loadClubInfo() {
    try {
        const response = await apiFetch(`${API_BASE_URL}/club/info`);
        const data = await response.json();

        if (data.success && data.info) {
            document.getElementById('club-name').value = data.info.name || '';
            document.getElementById('club-address').value = data.info.address || '';
            document.getElementById('club-phone').value = data.info.phone || '';
            document.getElementById('club-email').value = data.info.email || '';
            document.getElementById('club-website').value = data.info.website || '';
            document.getElementById('club-hours').value = data.info.hours || '';
        }
    } catch (e) {
        console.log('Club info not found, using defaults');
    }
}

async function saveClubInfo(event) {
    event.preventDefault();

    const statusEl = document.getElementById('club-info-status');
    statusEl.style.display = 'block';
    statusEl.className = 'info-box';
    statusEl.innerHTML = '<p>Salvataggio in corso...</p>';

    const info = {
        name: document.getElementById('club-name').value,
        address: document.getElementById('club-address').value,
        phone: document.getElementById('club-phone').value,
        email: document.getElementById('club-email').value,
        website: document.getElementById('club-website').value,
        hours: document.getElementById('club-hours').value
    };

    try {
        const response = await apiFetch(`${API_BASE_URL}/club/info`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(info)
        });

        const data = await response.json();

        if (data.success) {
            statusEl.style.background = 'rgba(76, 175, 80, 0.2)';
            statusEl.innerHTML = '<p style="color: #4caf50;">✓ Informazioni salvate con successo!</p>';
        } else {
            throw new Error(data.error || 'Errore nel salvataggio');
        }
    } catch (e) {
        statusEl.style.background = 'rgba(244, 67, 54, 0.2)';
        statusEl.innerHTML = `<p style="color: #f44336;">✗ ${e.message}</p>`;
    }

    setTimeout(() => {
        statusEl.style.display = 'none';
    }, 3000);
}

// ==================== CLUB IMAGES MANAGEMENT ====================

async function loadClubImages() {
    const grid = document.getElementById('club-images-grid');
    const empty = document.getElementById('club-images-empty');
    
    if (!grid) return;
    
    grid.innerHTML = '<p style="color: #a0a0a0; text-align: center; grid-column: 1/-1;">Caricamento...</p>';
    empty.style.display = 'none';
    
    try {
        const response = await apiFetch(`${API_BASE_URL}/club/images`);
        const data = await response.json();
        
        if (!data.success) throw new Error(data.error);
        
        if (data.images.length === 0) {
            grid.innerHTML = '';
            empty.style.display = 'block';
            return;
        }
        
        grid.innerHTML = data.images.map(img => `
            <div class="club-image-card" style="position: relative; border-radius: 12px; overflow: hidden; aspect-ratio: 1; background: #1a1a2e;">
                <img src="${API_BASE_URL}/club/images/${img.filename}" 
                     alt="${img.filename}" 
                     style="width: 100%; height: 100%; object-fit: cover; cursor: pointer;"
                     onclick="previewClubImage('${img.filename}')">
                <div style="position: absolute; bottom: 0; left: 0; right: 0; padding: 0.5rem; background: rgba(0,0,0,0.7); display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-size: 0.8rem; color: #fff;">${img.filename}</span>
                    <button class="btn btn-danger" style="padding: 0.25rem 0.5rem; font-size: 0.75rem;" 
                            onclick="deleteClubImage('${img.filename}')">🗑️</button>
                </div>
            </div>
        `).join('');
        
    } catch (error) {
        console.error('Error loading club images:', error);
        grid.innerHTML = `<p style="color: var(--danger); text-align: center; grid-column: 1/-1;">Errore: ${error.message}</p>`;
    }
}

async function uploadClubImages(input) {
    if (!input.files || input.files.length === 0) return;

    const files = Array.from(input.files);
    const totalFiles = files.length;
    let successCount = 0;
    let errorCount = 0;
    const errors = [];

    // Validate all files first
    for (const file of files) {
        if (file.size > 10 * 1024 * 1024) {
            errors.push(`${file.name}: troppo grande (max 10MB)`);
            errorCount++;
        }
    }

    const validFiles = files.filter(f => f.size <= 10 * 1024 * 1024);

    if (validFiles.length === 0) {
        showNotification('Nessuna immagine valida da caricare! ' + errors.join(', '), 'error');
        input.value = '';
        return;
    }

    // Show progress
    const progressText = totalFiles > 1 ? `Caricamento ${totalFiles} immagini...` : 'Caricamento immagine...';
    const grid = document.getElementById('club-images-grid');
    const originalContent = grid.innerHTML;
    grid.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; padding: 2rem;">
        <p style="font-size: 2rem; margin-bottom: 1rem;">⏳</p>
        <p id="upload-progress-text">${progressText}</p>
        <div style="background: #333; border-radius: 4px; height: 8px; margin-top: 1rem; overflow: hidden;">
            <div id="upload-progress-bar" style="background: var(--success); height: 100%; width: 0%; transition: width 0.3s;"></div>
        </div>
    </div>`;

    // Upload each file
    for (let i = 0; i < validFiles.length; i++) {
        const file = validFiles[i];
        const formData = new FormData();
        formData.append('image', file);

        try {
            const response = await fetch(`${API_BASE_URL}/club/images`, {
                method: 'POST',
                headers: getAuthHeader(),
                body: formData
            });

            const data = await response.json();

            if (!response.ok || !data.success) {
                throw new Error(data.error || 'Errore upload');
            }

            successCount++;
        } catch (error) {
            console.error(`Error uploading ${file.name}:`, error);
            errors.push(`${file.name}: ${error.message}`);
            errorCount++;
        }

        // Update progress
        const progress = Math.round(((i + 1) / validFiles.length) * 100);
        const progressBar = document.getElementById('upload-progress-bar');
        const progressTextEl = document.getElementById('upload-progress-text');
        if (progressBar) progressBar.style.width = progress + '%';
        if (progressTextEl) progressTextEl.textContent = `Caricamento ${i + 1}/${validFiles.length}...`;
    }

    // Show result
    if (errorCount > 0) {
        showNotification(`Caricamento: ${successCount} successi, ${errorCount} errori`, 'warning');
    } else {
        showNotification(`${successCount} immagini caricate con successo`, 'success');
    }

    loadClubImages();
    input.value = '';
}

function deleteClubImage(filename) {
    showConfirmDialog(
        'Elimina Immagine',
        `Eliminare l'immagine ${filename}?`,
        'Elimina',
        () => executeDeleteClubImage(filename)
    );
}

async function executeDeleteClubImage(filename) {
    try {
        const response = await apiFetch(`${API_BASE_URL}/club/images/${filename}`, {
            method: 'DELETE'
        });

        const data = await response.json();

        if (!data.success) throw new Error(data.error);

        showNotification('Immagine eliminata', 'success');
        loadClubImages();

    } catch (error) {
        console.error('Error deleting club image:', error);
        showNotification('Errore eliminazione: ' + error.message, 'error');
    }
}

function previewClubImage(filename) {
    const url = `${API_BASE_URL}/club/images/${filename}`;
    window.open(url, '_blank');
}

// Load club images when navigating to the page
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            if (item.dataset.page === 'club-images') {
                setTimeout(loadClubImages, 100);
            }
            if (item.dataset.page === 'settings') {
                setTimeout(() => { loadSmtpSettings(); loadAppConfig(); }, 100);
            }
            if (item.dataset.page === 'users') {
                setTimeout(() => { loadUsers(); loadUsersStats(); }, 100);
            }
        });
    });
});

// ==================== UNIFIED USERS MANAGEMENT ====================

let unifiedUsersCache = [];
let unifiedUsersSearchTimeout = null;

// Load unified users stats
async function loadUnifiedUsersStats() {
    try {
        const response = await apiFetch(`${API_BASE_URL}/admin/unified-users-stats`);
        const data = await response.json();

        if (data.success && data.stats) {
            document.getElementById('users-total').textContent = data.stats.total || 0;
            document.getElementById('users-registered').textContent = data.stats.registered || 0;
            document.getElementById('users-players-only').textContent = data.stats.playersOnly || 0;
            document.getElementById('users-verified').textContent = data.stats.verified || 0;
            document.getElementById('users-admin').textContent = data.stats.admin || 0;
        }
    } catch (error) {
        console.error('Error loading unified users stats:', error);
    }
}

// Load unified users list
async function loadUnifiedUsers() {
    const search = document.getElementById('users-search')?.value || '';
    const type = currentUserTypeFilter || '';

    let url = `${API_BASE_URL}/admin/unified-users?`;
    if (search) url += `search=${encodeURIComponent(search)}&`;
    if (type) url += `type=${type}&`;

    try {
        const response = await apiFetch(url);
        const data = await response.json();

        const container = document.getElementById('users-list');

        if (!data.success || !data.users || data.users.length === 0) {
            container.innerHTML = '<p style="color: var(--text-secondary); text-align: center; padding: 2rem;">Nessun utente trovato</p>';
            return;
        }

        unifiedUsersCache = data.users;
        renderUnifiedUsersList();

    } catch (error) {
        console.error('Error loading unified users:', error);
        document.getElementById('users-list').innerHTML =
            '<p style="color: var(--danger); text-align: center; padding: 2rem;">Errore caricamento utenti</p>';
    }
}

// Render unified users as cards (stile Anagrafica)
function renderUnifiedUsersList() {
    const container = document.getElementById('users-list');
    if (!container) return;

    if (unifiedUsersCache.length === 0) {
        container.innerHTML = '<p style="color: var(--text-secondary); text-align: center; padding: 2rem;">Nessun utente trovato</p>';
        return;
    }

    container.innerHTML = unifiedUsersCache.map(user => {
        const initials = getInitials(user.firstName, user.lastName, user.name);
        const badges = [];

        // Badge Admin (priorità alta)
        if (user.isAdmin) {
            badges.push(`<span class="user-badge admin">Admin</span>`);
        }

        if (user.isRegistered) {
            badges.push(`<span class="user-badge registered">App</span>`);
            if (user.emailVerified) {
                badges.push(`<span class="user-badge verified">Verificato</span>`);
            }
        }

        const userCode = user.userCode ? `<span class="user-code-badge">${user.userCode}</span>` : '';

        // Bottone toggle admin (solo per utenti registrati con userId)
        const adminToggleBtn = user.userId ? `<button class="btn ${user.isAdmin ? 'btn-warning' : 'btn-secondary'} btn-small btn-admin-toggle" onclick="toggleUserAdmin('${escapeAttr(user.playerId)}', '${escapeAttr(user.userId)}', ${user.isAdmin}, '${escapeAttr(user.email)}')">${user.isAdmin ? 'Rimuovi Admin' : 'Rendi Admin'}</button>` : '';

        return `
            <div class="user-card ${user.isAdmin ? 'is-admin' : ''}" data-id="${user.id}" data-player-id="${escapeAttr(user.playerId)}" data-user-id="${escapeAttr(user.userId)}">
                <div class="user-avatar">${initials}</div>
                <div class="user-info">
                    <div class="user-name-row">
                        <h4>${user.name || '-'}</h4>
                        ${userCode}
                        <div class="user-badges">${badges.join('')}</div>
                    </div>
                    <p class="user-contact">
                        ${user.email ? `<span>${user.email}</span>` : ''}
                        ${user.email && user.phone ? ' | ' : ''}
                        ${user.phone ? `<span>${user.phone}</span>` : ''}
                    </p>
                    ${user.notes ? `<p class="user-notes">${user.notes}</p>` : ''}
                </div>
                <div class="user-actions">
                    ${adminToggleBtn}
                    <button class="btn btn-secondary btn-small" onclick="viewUserStats('${escapeAttr(user.userId || user.playerId)}', '${escapeAttr(user.name)}')">📊 Statistiche</button>
                    <button class="btn btn-primary btn-small" onclick="editUnifiedUser('${escapeAttr(user.playerId)}', '${escapeAttr(user.userId)}')">Modifica</button>
                    ${user.isRegistered && !user.emailVerified ? `<button class="btn btn-success btn-small" onclick="verifyUserManually('${escapeAttr(user.userId)}')">Verifica</button>` : ''}
                    <button class="btn btn-danger btn-small" onclick="deleteUnifiedUser('${escapeAttr(user.playerId)}', '${escapeAttr(user.userId)}', '${escapeAttr(user.name)}')">Elimina</button>
                </div>
            </div>
        `;
    }).join('');
}

// View user stats - navigates to bookings page with player filter applied
function viewUserStats(userId, userName) {
    // Set stats player filter
    statsPlayerFilter = {
        userId: userId,
        name: userName,
        customerName: userName
    };

    // Set timeline player filter too
    currentPlayerFilter = {
        id: userId,
        name: userName,
        customerName: userName.toLowerCase()
    };

    // Navigate to bookings page
    navigateTo('bookings');

    // Update UI for both filters after navigation
    setTimeout(() => {
        // Update stats filter UI
        updateStatsFilterUI(userName);

        // Update timeline filter UI
        updateTimelineFilterUI(userName);
        applyPlayerFilter();

        // Load stats with filter
        loadBookingStats();

        // Scroll to statistics section
        const statsSection = document.querySelector('#page-bookings .section:nth-child(3)');
        if (statsSection) {
            statsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }, 100);
}

// Get initials from name
function getInitials(firstName, lastName, fullName) {
    if (firstName && lastName) {
        return (firstName[0] || '?') + (lastName[0] || '');
    }
    if (fullName) {
        const parts = fullName.trim().split(' ');
        if (parts.length >= 2) {
            return (parts[0][0] || '?') + (parts[parts.length - 1][0] || '');
        }
        return (fullName[0] || '?').toUpperCase();
    }
    return '?';
}

// Search dropdown state
let usersSearchDropdownIndex = -1;
let usersSearchResults = [];

// Search input handler - shows dropdown with suggestions
function onUnifiedUsersSearchInput() {
    clearTimeout(unifiedUsersSearchTimeout);
    const searchValue = document.getElementById('users-search').value.trim();
    const clearBtn = document.getElementById('clear-users-search');

    // Show/hide clear button
    if (clearBtn) {
        clearBtn.style.display = searchValue.length > 0 ? 'block' : 'none';
    }

    if (searchValue.length < 2) {
        hideUsersSearchDropdown();
        // Still load/filter the main list
        unifiedUsersSearchTimeout = setTimeout(() => {
            loadUnifiedUsers();
        }, 300);
        return;
    }

    unifiedUsersSearchTimeout = setTimeout(async () => {
        await showUsersSearchDropdown(searchValue);
        loadUnifiedUsers();
    }, 300);
}

// Clear users search
function clearUsersSearch() {
    const searchInput = document.getElementById('users-search');
    const clearBtn = document.getElementById('clear-users-search');

    if (searchInput) searchInput.value = '';
    if (clearBtn) clearBtn.style.display = 'none';

    hideUsersSearchDropdown();
    loadUnifiedUsers();
}

// Show dropdown with search results
async function showUsersSearchDropdown(search) {
    try {
        const response = await apiFetch(`${API_BASE_URL}/admin/unified-users?search=${encodeURIComponent(search)}&limit=10`);
        const data = await response.json();

        if (data.success && data.users && data.users.length > 0) {
            usersSearchResults = data.users;
            usersSearchDropdownIndex = -1;

            const dropdown = document.getElementById('users-search-dropdown');
            dropdown.innerHTML = usersSearchResults.map((user, index) => {
                const name = user.fullName || `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'N/A';
                const details = [user.email, user.phone].filter(Boolean).join(' • ') || '';
                const badges = [];
                if (user.isAdmin) badges.push('👑 Admin');
                if (user.isRegistered) badges.push('📱');

                return `<div class="search-dropdown-item" data-index="${index}" onclick="selectUserFromDropdown(${index})">
                    <div class="name">${name} ${badges.join(' ')}</div>
                    ${details ? `<div class="details">${details}</div>` : ''}
                </div>`;
            }).join('');

            dropdown.style.display = 'block';
        } else {
            hideUsersSearchDropdown();
        }
    } catch (error) {
        console.error('Error fetching search results:', error);
        hideUsersSearchDropdown();
    }
}

// Hide dropdown
function hideUsersSearchDropdown() {
    const dropdown = document.getElementById('users-search-dropdown');
    if (dropdown) {
        dropdown.style.display = 'none';
    }
    usersSearchResults = [];
    usersSearchDropdownIndex = -1;
}

// Select user from dropdown
function selectUserFromDropdown(index) {
    if (usersSearchResults[index]) {
        const user = usersSearchResults[index];
        const name = user.fullName || `${user.firstName || ''} ${user.lastName || ''}`.trim();
        document.getElementById('users-search').value = name;
        hideUsersSearchDropdown();
        loadUnifiedUsers();
    }
}

// Keyboard navigation for dropdown
function onUnifiedUsersSearchKeydown(event) {
    const dropdown = document.getElementById('users-search-dropdown');
    const isDropdownVisible = dropdown && dropdown.style.display !== 'none';

    if (event.key === 'ArrowDown') {
        event.preventDefault();
        if (isDropdownVisible && usersSearchResults.length > 0) {
            usersSearchDropdownIndex = Math.min(usersSearchDropdownIndex + 1, usersSearchResults.length - 1);
            updateDropdownSelection();
        }
    } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (isDropdownVisible && usersSearchResults.length > 0) {
            usersSearchDropdownIndex = Math.max(usersSearchDropdownIndex - 1, 0);
            updateDropdownSelection();
        }
    } else if (event.key === 'Enter') {
        event.preventDefault();
        if (isDropdownVisible && usersSearchDropdownIndex >= 0) {
            selectUserFromDropdown(usersSearchDropdownIndex);
        } else {
            clearTimeout(unifiedUsersSearchTimeout);
            hideUsersSearchDropdown();
            loadUnifiedUsers();
        }
    } else if (event.key === 'Escape') {
        hideUsersSearchDropdown();
    }
}

// Update visual selection in dropdown
function updateDropdownSelection() {
    const items = document.querySelectorAll('#users-search-dropdown .search-dropdown-item');
    items.forEach((item, index) => {
        item.classList.toggle('selected', index === usersSearchDropdownIndex);
        if (index === usersSearchDropdownIndex) {
            item.scrollIntoView({ block: 'nearest' });
        }
    });
}

// Close dropdown when clicking outside
document.addEventListener('click', function(event) {
    const container = document.querySelector('.users-search-container');
    if (container && !container.contains(event.target)) {
        hideUsersSearchDropdown();
    }
});

// Current user type filter
let currentUserTypeFilter = '';

// Filter users by type (button click)
function filterUsersByType(type) {
    currentUserTypeFilter = type;

    // Update button states
    document.querySelectorAll('.user-filter-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.type === type);
    });

    loadUnifiedUsers();
}

// Open modal for new user
function openNewUserModal() {
    document.getElementById('user-modal-title').textContent = 'Nuovo Utente';
    document.getElementById('user-edit-id').value = '';
    document.getElementById('user-edit-type').value = 'new';
    document.getElementById('user-first-name').value = '';
    document.getElementById('user-last-name').value = '';
    document.getElementById('user-email').value = '';
    document.getElementById('user-phone').value = '';
    document.getElementById('user-notes').value = '';
    document.getElementById('reset-password-btn').style.display = 'none';
    document.getElementById('user-modal').style.display = 'flex';
}

// Edit unified user
async function editUnifiedUser(playerId, userId) {
    const user = unifiedUsersCache.find(u =>
        (playerId && u.playerId == playerId) || (userId && u.userId == userId)
    );

    if (!user) {
        showNotification('Utente non trovato', 'error');
        return;
    }

    document.getElementById('user-modal-title').textContent = 'Modifica Utente';
    document.getElementById('user-edit-id').value = playerId || userId;
    document.getElementById('user-edit-type').value = playerId ? 'player' : 'user';
    document.getElementById('user-first-name').value = user.firstName || '';
    document.getElementById('user-last-name').value = user.lastName || '';
    document.getElementById('user-email').value = user.email || '';
    document.getElementById('user-phone').value = user.phone || '';
    document.getElementById('user-notes').value = user.notes || '';

    // Show reset password button only for registered users with email
    const resetBtn = document.getElementById('reset-password-btn');
    if (user.userId && user.email) {
        resetBtn.style.display = 'inline-block';
        resetBtn.dataset.userId = user.userId;
        resetBtn.dataset.userEmail = user.email;
    } else {
        resetBtn.style.display = 'none';
    }

    document.getElementById('user-modal').style.display = 'flex';
}

// Save user (create or update)
async function saveUnifiedUser(event) {
    event.preventDefault();

    const id = document.getElementById('user-edit-id').value;
    const type = document.getElementById('user-edit-type').value;
    const firstName = document.getElementById('user-first-name').value.trim();
    const lastName = document.getElementById('user-last-name').value.trim();
    const email = document.getElementById('user-email').value.trim();
    const phone = document.getElementById('user-phone').value.trim();
    const notes = document.getElementById('user-notes').value.trim();

    if (!firstName) {
        showNotification('Il nome è obbligatorio', 'error');
        return;
    }

    try {
        let response;

        if (type === 'new' || type === 'player' || !id) {
            // Create or update player
            const url = id && type === 'player'
                ? `${API_BASE_URL}/players/${id}`
                : `${API_BASE_URL}/players`;

            response = await apiFetch(url, {
                method: id && type === 'player' ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    first_name: firstName,
                    last_name: lastName,
                    email: email || null,
                    phone: phone || null,
                    notes: notes || null
                })
            });
        } else if (type === 'user') {
            // Update registered user
            response = await apiFetch(`${API_BASE_URL}/admin/users/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: `${firstName} ${lastName}`.trim(),
                    email: email || null,
                    phone: phone || null
                })
            });
        }

        const data = await response.json();

        if (data.success || data.player || data.user) {
            document.getElementById('user-modal').style.display = 'none';
            loadUnifiedUsers();
            loadUnifiedUsersStats();
            showNotification('Utente salvato con successo', 'success');
        } else {
            showNotification('Errore: ' + (data.error || 'Operazione fallita'), 'error');
        }
    } catch (error) {
        showNotification('Errore: ' + error.message, 'error');
    }
}

// Delete unified user
function deleteUnifiedUser(playerId, userId, name) {
    showConfirmDialog(
        'Elimina Utente',
        `Sei sicuro di voler eliminare "${name}"?`,
        'Elimina',
        () => executeDeleteUnifiedUser(playerId, userId, name)
    );
}

async function executeDeleteUnifiedUser(playerId, userId, name) {
    try {
        // If has player_id, delete the player (soft delete)
        if (playerId) {
            const response = await apiFetch(`${API_BASE_URL}/players/${playerId}`, {
                method: 'DELETE'
            });
            const data = await response.json();

            if (data.success) {
                loadUnifiedUsers();
                loadUnifiedUsersStats();
                showNotification('Utente eliminato', 'success');
                return;
            }
        }

        // If only user (no player linked), delete user
        if (userId && !playerId) {
            const response = await apiFetch(`${API_BASE_URL}/admin/users/${userId}`, {
                method: 'DELETE'
            });
            const data = await response.json();

            if (data.success) {
                loadUnifiedUsers();
                loadUnifiedUsersStats();
                showNotification('Utente eliminato', 'success');
                return;
            }
        }

        showNotification('Errore durante l\'eliminazione', 'error');
    } catch (error) {
        showNotification('Errore: ' + error.message, 'error');
    }
}

// Send password reset email to user
function sendPasswordResetEmail() {
    const resetBtn = document.getElementById('reset-password-btn');
    const userId = resetBtn.dataset.userId;
    const userEmail = resetBtn.dataset.userEmail;

    if (!userId || !userEmail) {
        showNotification('Utente non valido per il reset password', 'error');
        return;
    }

    showConfirmDialog(
        'Reset Password',
        `Inviare email di reset password a ${userEmail}?`,
        'Invia',
        () => executeSendPasswordResetEmail(userId, resetBtn)
    );
}

async function executeSendPasswordResetEmail(userId, resetBtn) {
    try {
        resetBtn.disabled = true;
        resetBtn.textContent = 'Invio...';

        const response = await apiFetch(`${API_BASE_URL}/admin/users/${userId}/send-reset-password`, {
            method: 'POST'
        });

        const data = await response.json();

        if (data.success) {
            showNotification('Email di reset password inviata con successo!', 'success');
        } else {
            showNotification('Errore: ' + (data.error || 'Invio fallito'), 'error');
        }
    } catch (error) {
        showNotification('Errore: ' + error.message, 'error');
    } finally {
        resetBtn.disabled = false;
        resetBtn.textContent = 'Reset Password';
    }
}

// Verify user manually (for registered users)
function verifyUserManually(userId) {
    showConfirmDialog(
        'Verifica Utente',
        'Verificare manualmente questo utente?',
        'Verifica',
        () => executeVerifyUserManually(userId)
    );
}

async function executeVerifyUserManually(userId) {
    try {
        const response = await apiFetch(`${API_BASE_URL}/admin/users/${userId}/verify-email`, {
            method: 'POST'
        });
        const data = await response.json();

        if (data.success) {
            showNotification('Utente verificato!', 'success');
            loadUnifiedUsers();
            loadUnifiedUsersStats();
        } else {
            showNotification('Errore: ' + (data.error || 'Verifica fallita'), 'error');
        }
    } catch (error) {
        showNotification('Errore: ' + error.message, 'error');
    }
}

// Toggle admin status for any user (registered or player-only)
async function toggleUserAdmin(playerId, userId, currentAdmin, email) {
    try {
        if (!userId) {
            showNotification('Errore: Utente non registrato, impossibile modificare stato admin', 'error');
            return;
        }
        const response = await apiFetch(`${API_BASE_URL}/admin/users/${userId}/toggle-admin`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await response.json();

        if (data.success) {
            loadUnifiedUsers();
            showNotification('Stato admin aggiornato', 'success');
        } else {
            showNotification('Errore: ' + (data.error || 'Operazione fallita'), 'error');
        }
    } catch (error) {
        showNotification('Errore: ' + error.message, 'error');
    }
}

// ==================== PLAYERS AUTOCOMPLETE ====================

let playersAutocompleteData = [];
let playersAutocompleteIndex = -1;
let playersSearchTimeout = null;

function onPlayerSearchInput() {
    clearTimeout(playersSearchTimeout);
    const search = document.getElementById('player-search').value.trim();

    if (search.length < 1) {
        hidePlayersAutocomplete();
        loadPlayers();
        return;
    }

    // API requires at least 2 chars
    if (search.length < 2) {
        const dropdown = document.getElementById('players-autocomplete');
        dropdown.innerHTML = '<div class="autocomplete-item" style="color: #888;">Digita almeno 2 caratteri...</div>';
        dropdown.style.display = 'block';
        return;
    }

    playersSearchTimeout = setTimeout(() => {
        searchPlayersAutocomplete(search);
    }, 150);
}

async function searchPlayersAutocomplete(search) {
    try {
        const response = await apiFetch(`${API_BASE_URL}/players/search?q=${encodeURIComponent(search)}`);
        const data = await response.json();

        // API returns { players: [...] } without success field
        if (data.players) {
            playersAutocompleteData = data.players;
            showPlayersAutocomplete(data.players);
        }
    } catch (error) {
        console.error('Players autocomplete error:', error);
        hidePlayersAutocomplete();
    }
}

function showPlayersAutocomplete(players) {
    const dropdown = document.getElementById('players-autocomplete');

    if (players.length === 0) {
        dropdown.innerHTML = '<div class="autocomplete-item" style="color: #888;">Nessun giocatore trovato</div>';
        dropdown.style.display = 'block';
        return;
    }

    dropdown.innerHTML = players.slice(0, 10).map((player, index) => `
        <div class="autocomplete-item ${index === playersAutocompleteIndex ? 'selected' : ''}"
             onclick="selectPlayerFromAutocomplete(${index})"
             data-index="${index}">
            <div class="user-avatar-sm">${((player.first_name || 'G').charAt(0) + (player.last_name || '').charAt(0)).toUpperCase()}</div>
            <div class="user-info-ac">
                <div class="user-name-ac">${player.first_name || ''} ${player.last_name || ''}</div>
                <div class="user-email-ac">${player.email || player.phone || '-'}</div>
            </div>
        </div>
    `).join('');

    dropdown.style.display = 'block';
    playersAutocompleteIndex = -1;
}

function hidePlayersAutocomplete() {
    const dropdown = document.getElementById('players-autocomplete');
    if (dropdown) {
        dropdown.style.display = 'none';
    }
    playersAutocompleteIndex = -1;
}

function selectPlayerFromAutocomplete(index) {
    const player = playersAutocompleteData[index];
    if (player) {
        const fullName = `${player.first_name || ''} ${player.last_name || ''}`.trim();
        document.getElementById('player-search').value = fullName;
        hidePlayersAutocomplete();
        loadPlayers(fullName);
    }
}

function onPlayerSearchKeydown(event) {
    const dropdown = document.getElementById('players-autocomplete');
    const items = dropdown.querySelectorAll('.autocomplete-item[data-index]');

    if (event.key === 'ArrowDown') {
        event.preventDefault();
        playersAutocompleteIndex = Math.min(playersAutocompleteIndex + 1, items.length - 1);
        updatePlayersAutocompleteSelection(items);
    } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        playersAutocompleteIndex = Math.max(playersAutocompleteIndex - 1, 0);
        updatePlayersAutocompleteSelection(items);
    } else if (event.key === 'Enter') {
        event.preventDefault();
        if (playersAutocompleteIndex >= 0 && playersAutocompleteData[playersAutocompleteIndex]) {
            selectPlayerFromAutocomplete(playersAutocompleteIndex);
        } else {
            hidePlayersAutocomplete();
            loadPlayers(document.getElementById('player-search').value);
        }
    } else if (event.key === 'Escape') {
        hidePlayersAutocomplete();
    }
}

function updatePlayersAutocompleteSelection(items) {
    items.forEach((item, i) => {
        item.classList.toggle('selected', i === playersAutocompleteIndex);
    });

    // Scroll selected into view
    if (playersAutocompleteIndex >= 0 && items[playersAutocompleteIndex]) {
        items[playersAutocompleteIndex].scrollIntoView({ block: 'nearest' });
    }
}


// ==================== APP CONFIG SETTINGS ====================

let appConfig = {};

async function loadAppConfig() {
    try {
        const response = await apiFetch(`${API_BASE_URL}/config`);
        const data = await response.json();

        if (data.success && data.config) {
            appConfig = data.config;
            populateConfigFields();
        }
    } catch (error) {
        console.error('Error loading app config:', error);
    }
}

function populateConfigFields() {
    // Orari Club
    setSelectValue('config-club-open', appConfig.club_open_hour?.value || '8');
    setSelectValue('config-club-close', appConfig.club_close_hour?.value || '22');
    setSelectValue('config-slot-interval', appConfig.slot_interval_minutes?.value || '30');

    // Durate Sport
    setInputValue('config-duration-padel', appConfig.duration_padel?.value || '90');
    setInputValue('config-duration-padel-fallback', appConfig.duration_padel_fallback?.value || '60');
    setInputValue('config-duration-tennis', appConfig.duration_tennis?.value || '60');
    setInputValue('config-duration-calcetto', appConfig.duration_calcetto?.value || '60');

    // Cron Jobs
    setSelectValue('config-cron-video-enabled', appConfig.cron_video_enabled?.value || 'true');
    setInputValue('config-cron-video-minute', appConfig.cron_video_minute?.value || '55');
    setInputValue('config-cron-timeout', appConfig.cron_timeout_minutes?.value || '5');
    setSelectValue('config-auto-confirm-enabled', appConfig.auto_confirm_enabled?.value || 'true');
    setInputValue('config-auto-confirm-hours', appConfig.auto_confirm_hours_before?.value || '2');

    // Prenotazioni
    setInputValue('config-booking-advance', appConfig.booking_advance_days?.value || '14');
    setInputValue('config-booking-cancel', appConfig.booking_cancel_hours?.value || '24');
    setInputValue('config-booking-reminder', appConfig.booking_reminder_hours?.value || '24');
    setInputValue('config-booking-players', appConfig.booking_default_players?.value || '4');
    setSelectValue('config-booking-payment', appConfig.booking_require_payment?.value || 'false');
}

function setSelectValue(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value;
}

function setInputValue(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value;
}

async function saveConfig(key, value) {
    try {
        const response = await apiFetch(`${API_BASE_URL}/config/${key}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ value: String(value) })
        });

        const data = await response.json();

        if (data.success) {
            showNotification(`Configurazione "${key}" salvata`, 'success');
            // Aggiorna cache locale
            if (!appConfig[key]) appConfig[key] = {};
            appConfig[key].value = String(value);
        } else {
            showNotification('Errore: ' + (data.error || 'Salvataggio fallito'), 'error');
        }
    } catch (error) {
        showNotification('Errore: ' + error.message, 'error');
    }
}

// ==================== SMTP SETTINGS ====================

async function loadSmtpSettings() {
    try {
        const response = await apiFetch(`${API_BASE_URL}/settings/smtp`);
        const data = await response.json();

        if (data.success && data.settings) {
            document.getElementById('smtp-host').value = data.settings.host || '';
            document.getElementById('smtp-port').value = data.settings.port || '';
            document.getElementById('smtp-secure').value = data.settings.secure ? 'true' : 'false';
            document.getElementById('smtp-user').value = data.settings.user || '';
            document.getElementById('smtp-from').value = data.settings.from || '';
            document.getElementById('smtp-from-name').value = data.settings.fromName || '';
            // Password is not returned for security
        }
    } catch (error) {
        console.error('Error loading SMTP settings:', error);
    }
}

async function saveSmtpSettings(event) {
    event.preventDefault();

    const settings = {
        host: document.getElementById('smtp-host').value,
        port: parseInt(document.getElementById('smtp-port').value) || 587,
        secure: document.getElementById('smtp-secure').value === 'true',
        user: document.getElementById('smtp-user').value,
        pass: document.getElementById('smtp-pass').value,
        from: document.getElementById('smtp-from').value,
        fromName: document.getElementById('smtp-from-name').value
    };

    try {
        const response = await apiFetch(`${API_BASE_URL}/settings/smtp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings)
        });

        const data = await response.json();

        const statusEl = document.getElementById('smtp-status');
        statusEl.style.display = 'block';

        if (data.success) {
            statusEl.innerHTML = '<p style="color: #4caf50;">✅ Impostazioni SMTP salvate con successo!</p>';
            document.getElementById('smtp-pass').value = ''; // Clear password field
        } else {
            statusEl.innerHTML = `<p style="color: #f44336;">❌ Errore: ${data.error}</p>`;
        }
    } catch (error) {
        const statusEl = document.getElementById('smtp-status');
        statusEl.style.display = 'block';
        statusEl.innerHTML = `<p style="color: #f44336;">❌ Errore di connessione: ${error.message}</p>`;
    }
}

async function testSmtpConnection() {
    const statusEl = document.getElementById('smtp-status');
    statusEl.style.display = 'block';
    statusEl.innerHTML = '<p style="color: #00d9ff;">⏳ Test connessione in corso...</p>';

    try {
        const response = await apiFetch(`${API_BASE_URL}/settings/smtp/test`);
        const data = await response.json();

        if (data.success) {
            statusEl.innerHTML = '<p style="color: #4caf50;">✅ Connessione SMTP riuscita!</p>';
        } else {
            statusEl.innerHTML = `<p style="color: #f44336;">❌ Connessione fallita: ${data.error}</p>`;
        }
    } catch (error) {
        statusEl.innerHTML = `<p style="color: #f44336;">❌ Errore: ${error.message}</p>`;
    }
}

async function sendTestEmails() {
    const emailInput = document.getElementById('test-email-address');
    const resultsEl = document.getElementById('test-email-results');
    const btn = document.getElementById('send-test-emails-btn');
    const email = emailInput.value.trim();

    if (!email || !email.includes('@')) {
        resultsEl.innerHTML = '<p style="color: #f44336;">❌ Inserisci un indirizzo email valido</p>';
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Invio in corso...';
    resultsEl.innerHTML = '<p style="color: #00d9ff;">⏳ Invio email di prova in corso...</p>';

    try {
        const response = await apiFetch(`${API_BASE_URL}/settings/smtp/send-test-emails`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });

        const data = await response.json();

        if (data.success) {
            let html = '<div style="color: #4caf50; margin-bottom: 0.5rem;">✅ Email inviate con successo!</div>';
            html += '<ul style="list-style: none; padding: 0; margin: 0;">';
            data.results.forEach(r => {
                const icon = r.success ? '✅' : '❌';
                const color = r.success ? '#4caf50' : '#f44336';
                html += `<li style="color: ${color}; padding: 0.25rem 0;">${icon} ${r.type}: ${r.success ? 'Inviata' : r.error}</li>`;
            });
            html += '</ul>';
            resultsEl.innerHTML = html;
        } else {
            resultsEl.innerHTML = `<p style="color: #f44336;">❌ Errore: ${data.error}</p>`;
        }
    } catch (error) {
        resultsEl.innerHTML = `<p style="color: #f44336;">❌ Errore di connessione: ${error.message}</p>`;
    } finally {
        btn.disabled = false;
        btn.textContent = 'Invia Email di Prova';
    }
}

// ==================== TEST EMAIL MODAL ====================
function openTestEmailModal() {
    document.getElementById('test-email-modal').style.display = 'flex';
    document.getElementById('test-email-input').value = '';
    document.getElementById('test-email-modal-status').innerHTML = '';
    setTimeout(() => {
        document.getElementById('test-email-input').focus();
    }, 100);
}

function closeTestEmailModal() {
    document.getElementById('test-email-modal').style.display = 'none';
}

async function confirmSendTestEmail() {
    const emailInput = document.getElementById('test-email-input');
    const statusEl = document.getElementById('test-email-modal-status');
    const email = emailInput.value.trim();

    if (!email || !email.includes('@')) {
        statusEl.innerHTML = '<p style="color: #f44336;">❌ Inserisci un indirizzo email valido</p>';
        return;
    }

    statusEl.innerHTML = '<p style="color: #00d9ff;">⏳ Invio email di test in corso...</p>';

    try {
        const response = await apiFetch(`${API_BASE_URL}/settings/smtp/send-test`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });

        const data = await response.json();

        if (data.success) {
            statusEl.innerHTML = `<p style="color: #4caf50;">✅ Email di test inviata a ${email}!</p>`;
            setTimeout(() => {
                closeTestEmailModal();
            }, 2000);
        } else {
            statusEl.innerHTML = `<p style="color: #f44336;">❌ Invio fallito: ${data.error}</p>`;
        }
    } catch (error) {
        statusEl.innerHTML = `<p style="color: #f44336;">❌ Errore: ${error.message}</p>`;
    }
}

// ==================== CONFIRM DIALOG MODAL ====================
let confirmDialogCallback = null;

function showConfirmDialog(title, message, buttonText, callback) {
    document.getElementById('confirm-dialog-title').textContent = title;
    document.getElementById('confirm-dialog-message').textContent = message;
    document.getElementById('confirm-dialog-yes').textContent = buttonText || 'Conferma';
    confirmDialogCallback = callback;
    document.getElementById('confirm-dialog-yes').onclick = () => {
        const cb = confirmDialogCallback;
        closeConfirmDialog();
        if (cb) cb();
    };
    document.getElementById('confirm-dialog-modal').style.display = 'flex';
}

function closeConfirmDialog() {
    document.getElementById('confirm-dialog-modal').style.display = 'none';
    confirmDialogCallback = null;
}

// ==================== NOTIFICATION TOAST ====================
function showNotification(message, type = 'info') {
    // Remove existing notification if any
    const existing = document.querySelector('.toast-notification');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'toast-notification';
    toast.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        padding: 1rem 1.5rem;
        border-radius: 8px;
        color: white;
        font-weight: 500;
        z-index: 10000;
        animation: slideIn 0.3s ease;
        max-width: 350px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    `;

    if (type === 'success') {
        toast.style.background = '#4caf50';
    } else if (type === 'error') {
        toast.style.background = '#f44336';
    } else {
        toast.style.background = '#00d9ff';
    }

    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ==================== FILTER PLAYER CALENDAR ====================
let currentPlayerFilter = null;
let filterPlayerSuggestions = [];
let filterPlayerSuggestionIndex = -1;
let filterPlayerSearchTimeout = null;

function openFilterPlayerModal() {
    const modal = document.getElementById('filter-player-modal');
    modal.style.display = 'flex';

    // Reset state
    document.getElementById('filter-player-search-input').value = '';
    document.getElementById('filter-player-suggestions').style.display = 'none';
    filterPlayerSuggestions = [];
    filterPlayerSuggestionIndex = -1;

    // Focus input
    setTimeout(() => {
        document.getElementById('filter-player-search-input').focus();
    }, 100);
}

function closeFilterPlayerModal() {
    document.getElementById('filter-player-modal').style.display = 'none';
}

function onFilterPlayerSearchInput() {
    const input = document.getElementById('filter-player-search-input');
    const query = input.value.trim();

    clearTimeout(filterPlayerSearchTimeout);

    if (query.length < 2) {
        document.getElementById('filter-player-suggestions').style.display = 'none';
        filterPlayerSuggestions = [];
        filterPlayerSuggestionIndex = -1;
        return;
    }

    filterPlayerSearchTimeout = setTimeout(async () => {
        await searchPlayersForFilter(query);
    }, 200);
}

async function searchPlayersForFilter(query) {
    try {
        const response = await apiFetch(`${API_BASE_URL}/admin/unified-users?search=${encodeURIComponent(query)}&limit=10`);
        const data = await response.json();

        if (data.success && data.users && data.users.length > 0) {
            filterPlayerSuggestions = data.users;
            filterPlayerSuggestionIndex = -1;
            renderFilterPlayerSuggestions();
        } else {
            filterPlayerSuggestions = [];
            document.getElementById('filter-player-suggestions').style.display = 'none';
        }
    } catch (error) {
        console.error('Error searching players for filter:', error);
    }
}

function renderFilterPlayerSuggestions() {
    const dropdown = document.getElementById('filter-player-suggestions');

    dropdown.innerHTML = filterPlayerSuggestions.map((user, index) => {
        const name = user.fullName || `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'N/A';
        const details = [user.email, user.phone].filter(Boolean).join(' - ') || '';
        const isSelected = index === filterPlayerSuggestionIndex;

        return `<div class="player-suggestion-item ${isSelected ? 'selected' : ''}"
                     data-index="${index}"
                     onclick="selectPlayerForFilter(${index})">
            <div class="suggestion-name">${name}</div>
            ${details ? `<div class="suggestion-details">${details}</div>` : ''}
        </div>`;
    }).join('');

    dropdown.style.display = 'block';
}

function onFilterPlayerSearchKeydown(event) {
    const dropdown = document.getElementById('filter-player-suggestions');

    if (dropdown.style.display === 'none' && event.key !== 'Escape') return;

    switch (event.key) {
        case 'ArrowDown':
            event.preventDefault();
            if (filterPlayerSuggestionIndex < filterPlayerSuggestions.length - 1) {
                filterPlayerSuggestionIndex++;
                renderFilterPlayerSuggestions();
                scrollFilterSuggestionIntoView();
            }
            break;
        case 'ArrowUp':
            event.preventDefault();
            if (filterPlayerSuggestionIndex > 0) {
                filterPlayerSuggestionIndex--;
                renderFilterPlayerSuggestions();
                scrollFilterSuggestionIntoView();
            }
            break;
        case 'Enter':
            event.preventDefault();
            if (filterPlayerSuggestionIndex >= 0 && filterPlayerSuggestions[filterPlayerSuggestionIndex]) {
                selectPlayerForFilter(filterPlayerSuggestionIndex);
            }
            break;
        case 'Escape':
            closeFilterPlayerModal();
            break;
    }
}

function scrollFilterSuggestionIntoView() {
    const dropdown = document.getElementById('filter-player-suggestions');
    const selected = dropdown.querySelector('.player-suggestion-item.selected');
    if (selected) {
        selected.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
}

function selectPlayerForFilter(index) {
    const user = filterPlayerSuggestions[index];
    if (!user) return;

    const name = user.fullName || `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'N/A';

    // Set the current filter
    currentPlayerFilter = {
        id: user.id,
        name: name,
        // Also match by customer_name for bookings without user_id
        customerName: name.toLowerCase()
    };

    // Close modal
    closeFilterPlayerModal();

    // Update UI - show clear button and update filter button text
    const filterBtn = document.getElementById('filter-player-btn');
    const clearBtn = document.getElementById('clear-filter-btn');

    filterBtn.innerHTML = `👤 ${name}`;
    filterBtn.classList.remove('btn-secondary');
    filterBtn.classList.add('btn-primary');
    clearBtn.style.display = 'inline-block';

    // Sincronizza con filtro statistiche
    statsPlayerFilter = {
        userId: user.id,
        name: name,
        customerName: name
    };
    updateStatsFilterUI(name);

    // Apply filter to current timeline
    applyPlayerFilter();

    // Ricarica statistiche con il nuovo filtro
    loadBookingStats();
}

function applyPlayerFilter() {
    if (!currentPlayerFilter) return;

    const bookingBars = document.querySelectorAll('.timeline-booking-bar');

    bookingBars.forEach(bar => {
        const userId = bar.dataset.userId;
        const customerName = (bar.dataset.customerName || '').toLowerCase();

        // Match by user_id or by customer name (for bookings without user_id)
        const isMatch = (userId && userId == currentPlayerFilter.id) ||
                        (customerName && customerName.includes(currentPlayerFilter.customerName));

        if (isMatch) {
            bar.style.opacity = '1';
            bar.style.filter = 'none';
        } else {
            bar.style.opacity = '0.15';
            bar.style.filter = 'grayscale(100%)';
        }
    });
}

function clearPlayerFilter(skipStatsSync = false) {
    currentPlayerFilter = null;

    // Reset UI
    const filterBtn = document.getElementById('filter-player-btn');
    const clearBtn = document.getElementById('clear-filter-btn');

    if (filterBtn) {
        filterBtn.innerHTML = '👤 Filtra Giocatore';
        filterBtn.classList.remove('btn-primary');
        filterBtn.classList.add('btn-secondary');
    }
    if (clearBtn) {
        clearBtn.style.display = 'none';
    }

    // Remove filter from timeline - restore all booking bars
    const bookingBars = document.querySelectorAll('.timeline-booking-bar');
    bookingBars.forEach(bar => {
        bar.style.opacity = '1';
        bar.style.filter = 'none';
    });

    // Sincronizza: pulisci anche filtro stats (evita loop)
    if (!skipStatsSync && statsPlayerFilter) {
        statsPlayerFilter = null;
        const label = document.getElementById('stats-player-filter-label');
        const statsClearBtn = document.getElementById('stats-player-filter-clear');
        const icon = document.getElementById('stats-player-filter-icon');
        if (label) label.style.display = 'none';
        if (statsClearBtn) statsClearBtn.style.display = 'none';
        if (icon) icon.textContent = '👤';

        // Ricarica statistiche senza filtro
        loadBookingStats();
    }
}

// Helper per aggiornare UI filtro timeline senza triggerare eventi
function updateTimelineFilterUI(name) {
    const filterBtn = document.getElementById('filter-player-btn');
    const clearBtn = document.getElementById('clear-filter-btn');
    if (filterBtn) {
        filterBtn.innerHTML = `👤 ${name}`;
        filterBtn.classList.remove('btn-secondary');
        filterBtn.classList.add('btn-primary');
    }
    if (clearBtn) {
        clearBtn.style.display = 'inline-block';
    }
}

// Helper per aggiornare UI filtro stats senza triggerare eventi
function updateStatsFilterUI(name) {
    const label = document.getElementById('stats-player-filter-label');
    const clearBtn = document.getElementById('stats-player-filter-clear');
    const icon = document.getElementById('stats-player-filter-icon');
    if (label) {
        label.textContent = name;
        label.style.display = 'inline';
    }
    if (clearBtn) {
        clearBtn.style.display = 'inline';
    }
    if (icon) {
        icon.textContent = '✓';
    }
}
