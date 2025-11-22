// API Configuration
const API_BASE_URL = 'https://api.teofly.it/api';

// Global state
let currentPage = 'overview';
let currentCalendarDate = new Date();
let courtsData = [];
let bookingsData = [];

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    setupNavigation();
    checkAPIStatus();
    loadOverviewData();
    setupForms();
});

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
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
        if (item.dataset.page === page) item.classList.add('active');
    });
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const pageEl = document.getElementById('page-' + page);
    if (pageEl) pageEl.classList.add('active');

    const pageTitles = {
        'overview': 'Overview',
        'matches': 'Create Match',
        'manage-matches': 'Manage Matches',
        'bookings': 'Prenotazioni',
        'courts': 'Gestione Campi',
        'players': 'Anagrafica Giocatori',
        'videos': 'Videos',
        'users': 'Users',
        'storage': 'Storage'
    };
    document.getElementById('page-title').textContent = pageTitles[page] || page;
    currentPage = page;

    if (page === 'overview') loadOverviewData();
    else if (page === 'storage') loadStorageInfo();
    else if (page === 'bookings') initBookingsSection();
    else if (page === 'courts') loadCourts();
}

// API Status Check
async function checkAPIStatus() {
    const statusEl = document.getElementById('api-status');
    const apiInfoEl = document.getElementById('api-info');
    try {
        const response = await fetch(API_BASE_URL + '/health');
        const data = await response.json();
        if (data.status === 'ok') {
            statusEl.textContent = '🟢 API Online';
            statusEl.style.color = 'var(--success)';
            apiInfoEl.innerHTML = '<p><strong>Status:</strong> <span style="color: var(--success)">Connected</span></p>' +
                '<p><strong>Database:</strong> ' + data.database + '</p>' +
                '<p><strong>Storage:</strong> ' + data.storage + '</p>';
        }
    } catch (error) {
        statusEl.textContent = '🔴 API Offline';
        statusEl.style.color = 'var(--danger)';
    }
}

// Overview Data
async function loadOverviewData() {
    try {
        const response = await fetch(API_BASE_URL + '/stats/storage');
        const data = await response.json();
        document.getElementById('total-videos').textContent = data.totalVideos || '0';
        document.getElementById('total-storage').textContent = formatBytes(data.totalSizeBytes || 0);
        document.getElementById('total-views').textContent = data.totalViews || '0';
        document.getElementById('total-downloads').textContent = data.totalDownloads || '0';
    } catch (error) {
        console.error('Error loading overview:', error);
    }
}

// Storage Info
async function loadStorageInfo() {
    const storageInfoEl = document.getElementById('storage-info');
    try {
        const response = await fetch(API_BASE_URL + '/stats/storage');
        const data = await response.json();
        storageInfoEl.innerHTML = '<p><strong>Total Videos:</strong> ' + (data.totalVideos || 0) + '</p>' +
            '<p><strong>Total Size:</strong> ' + formatBytes(data.totalSizeBytes || 0) + '</p>';
    } catch (error) {
        storageInfoEl.innerHTML = '<p style="color: var(--danger)">Error loading storage info</p>';
    }
}

// Forms Setup
function setupForms() {
    document.getElementById('create-match-form')?.addEventListener('submit', handleCreateMatch);
    document.getElementById('upload-video-form')?.addEventListener('submit', handleUploadVideo);
    document.getElementById('search-matches-form')?.addEventListener('submit', handleSearchMatches);
    document.getElementById('edit-match-form')?.addEventListener('submit', handleEditMatch);
    document.getElementById('cancel-edit')?.addEventListener('click', () => {
        document.getElementById('edit-modal').style.display = 'none';
    });
    document.getElementById('video-file')?.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const fileInfo = document.getElementById('file-info');
            fileInfo.textContent = 'Selected: ' + file.name + ' (' + formatBytes(file.size) + ')';
        }
    });
}

// Create Match Handler
async function handleCreateMatch(e) {
    e.preventDefault();
    const resultEl = document.getElementById('match-result');
    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating...';

    const formData = {
        bookingCode: document.getElementById('booking-code').value,
        sportType: document.getElementById('sport-type').value,
        location: document.getElementById('location').value,
        matchDate: document.getElementById('match-date').value,
        players: document.getElementById('players').value.split(',').map(p => p.trim())
    };

    try {
        const response = await fetch(API_BASE_URL + '/matches/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(formData)
        });
        const data = await response.json();
        if (response.ok && data.success) {
            resultEl.className = 'result success';
            resultEl.innerHTML = '<h4>✅ Match Created!</h4><p><strong>Match ID:</strong> ' + data.match.id + '</p>' +
                '<p><strong>Password:</strong> <code>' + data.match.session_password + '</code></p>';
            e.target.reset();
        } else {
            throw new Error(data.message || 'Failed');
        }
    } catch (error) {
        resultEl.className = 'result error';
        resultEl.innerHTML = '<p>❌ Error: ' + error.message + '</p>';
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Create Match';
    }
}

// Upload Video Handler
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
    formData.append('matchId', document.getElementById('video-match-id').value);
    formData.append('title', document.getElementById('video-title').value);
    formData.append('durationSeconds', document.getElementById('video-duration').value);
    formData.append('isHighlight', document.getElementById('is-highlight').checked);

    try {
        const xhr = new XMLHttpRequest();
        xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) {
                const percent = Math.round((e.loaded / e.total) * 100);
                progressFill.style.width = percent + '%';
                progressText.textContent = percent + '%';
            }
        });
        xhr.addEventListener('load', () => {
            if (xhr.status === 200 || xhr.status === 201) {
                const data = JSON.parse(xhr.responseText);
                resultEl.className = 'result success';
                resultEl.innerHTML = '<h4>✅ Video Uploaded!</h4><p>ID: ' + data.video.id + '</p>';
                e.target.reset();
                loadOverviewData();
            }
        });
        xhr.open('POST', API_BASE_URL + '/videos/upload');
        xhr.send(formData);
    } catch (error) {
        resultEl.className = 'result error';
        resultEl.innerHTML = '<p>❌ Error: ' + error.message + '</p>';
    } finally {
        setTimeout(() => {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Upload Video';
            progressContainer.style.display = 'none';
        }, 2000);
    }
}

// Utility Functions
function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

// Search Matches Handler
async function handleSearchMatches(e) {
    e.preventDefault();
    const resultsEl = document.getElementById('search-results');
    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Searching...';

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
        const response = await fetch(API_BASE_URL + '/matches/search?' + params.toString());
        const data = await response.json();
        if (response.ok && data.success) {
            if (data.matches.length === 0) {
                resultsEl.innerHTML = '<p>No matches found</p>';
            } else {
                resultsEl.innerHTML = '<h3>Found ' + data.count + ' matches</h3>' +
                    data.matches.map(match => renderMatchCard(match)).join('');
            }
        }
    } catch (error) {
        resultsEl.innerHTML = '<p style="color: var(--danger)">Error: ' + error.message + '</p>';
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Search';
    }
}

function renderMatchCard(match) {
    const matchDate = new Date(match.match_date).toLocaleString();
    return '<div class="match-card"><div class="match-card-header"><h4>' + match.booking_code + '</h4>' +
        '<span class="badge ' + (match.is_active ? 'badge-active' : 'badge-inactive') + '">' +
        (match.is_active ? 'Active' : 'Inactive') + '</span></div>' +
        '<div class="match-card-body"><p><strong>Sport:</strong> ' + match.sport_type + '</p>' +
        '<p><strong>Location:</strong> ' + match.location + '</p>' +
        '<p><strong>Date:</strong> ' + matchDate + '</p>' +
        '<p><strong>Password:</strong> <code>' + match.access_password + '</code> ' +
        '<button class="btn-copy" onclick="copyToClipboard(\'' + match.access_password + '\')">📋</button></p></div>' +
        '<div class="match-card-actions">' +
        '<button class="btn btn-success btn-small" onclick="goToUpload(\'' + match.id + '\')">Upload</button>' +
        '<button class="btn btn-primary btn-small" onclick="editMatch(\'' + match.id + '\')">Edit</button>' +
        '<button class="btn btn-danger btn-small" onclick="deleteMatch(\'' + match.id + '\', \'' + match.booking_code + '\')">Delete</button>' +
        '</div></div>';
}

async function editMatch(matchId) {
    try {
        const response = await fetch(API_BASE_URL + '/matches/id/' + matchId);
        const data = await response.json();
        if (response.ok && data.success) {
            const match = data.match;
            document.getElementById('edit-match-id').value = match.id;
            document.getElementById('edit-booking-code').value = match.booking_code;
            document.getElementById('edit-sport-type').value = match.sport_type;
            document.getElementById('edit-location').value = match.location;
            document.getElementById('edit-match-date').value = new Date(match.match_date).toISOString().slice(0, 16);
            document.getElementById('edit-players').value = match.player_ids.join(', ');
            document.getElementById('edit-password').value = match.access_password;
            document.getElementById('edit-is-active').checked = match.is_active;
            document.getElementById('edit-modal').style.display = 'flex';
        }
    } catch (error) {
        alert('Error loading match: ' + error.message);
    }
}

async function handleEditMatch(e) {
    e.preventDefault();
    const resultEl = document.getElementById('edit-result');
    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;

    const matchId = document.getElementById('edit-match-id').value;
    const formData = {
        bookingCode: document.getElementById('edit-booking-code').value,
        sportType: document.getElementById('edit-sport-type').value,
        location: document.getElementById('edit-location').value,
        matchDate: document.getElementById('edit-match-date').value,
        players: document.getElementById('edit-players').value.split(',').map(p => p.trim()),
        accessPassword: document.getElementById('edit-password').value,
        isActive: document.getElementById('edit-is-active').checked
    };

    try {
        const response = await fetch(API_BASE_URL + '/matches/' + matchId, {
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
                document.getElementById('search-matches-form').dispatchEvent(new Event('submit'));
            }, 1500);
        }
    } catch (error) {
        resultEl.className = 'result error';
        resultEl.innerHTML = '<p>Error: ' + error.message + '</p>';
    } finally {
        submitBtn.disabled = false;
    }
}

async function deleteMatch(matchId, bookingCode) {
    if (!confirm('Delete match "' + bookingCode + '"?')) return;
    try {
        const response = await fetch(API_BASE_URL + '/matches/' + matchId, { method: 'DELETE' });
        if (response.ok) {
            alert('Match deleted');
            document.getElementById('search-matches-form').dispatchEvent(new Event('submit'));
        }
    } catch (error) {
        alert('Error: ' + error.message);
    }
}

function copyToClipboard(text) {
    navigator.clipboard.writeText(text).catch(() => {
        const t = document.createElement('textarea');
        t.value = text;
        document.body.appendChild(t);
        t.select();
        document.execCommand('copy');
        document.body.removeChild(t);
    });
}

function goToUpload(matchId) {
    navigateTo('videos');
    document.getElementById('video-match-id').value = matchId;
}

// ==========================================
// BOOKING CALENDAR MANAGEMENT
// ==========================================

function initBookingsSection() {
    loadCourts();
    renderCalendar();
    setupBookingEventListeners();
}

async function loadCourts() {
    try {
        const response = await fetch(API_BASE_URL + '/courts');
        const data = await response.json();
        if (Array.isArray(data)) {
            courtsData = data;
            populateCourtDropdowns();
            renderCourtsGrid();
        }
    } catch (error) {
        console.error('Error loading courts:', error);
    }
}

function populateCourtDropdowns() {
    const filterSelect = document.getElementById('court-filter');
    const bookingSelect = document.getElementById('booking-court');
    
    if (filterSelect) {
        filterSelect.innerHTML = '<option value="">Tutti i campi</option>';
        courtsData.forEach(court => {
            filterSelect.innerHTML += '<option value="' + court.id + '">' + court.name + '</option>';
        });
    }
    
    if (bookingSelect) {
        bookingSelect.innerHTML = '<option value="">Seleziona campo...</option>';
        courtsData.forEach(court => {
            bookingSelect.innerHTML += '<option value="' + court.id + '" data-sport="' + court.sport_type + 
                '" data-duration="' + court.default_duration_minutes + '" data-price="' + court.price_per_hour + 
                '">' + court.name + ' - ' + court.sport_type + '</option>';
        });
    }
}

function renderCalendar() {
    const calendarGrid = document.getElementById('calendar-grid');
    const monthYearEl = document.getElementById('current-month-year');
    if (!calendarGrid || !monthYearEl) return;
    
    const year = currentCalendarDate.getFullYear();
    const month = currentCalendarDate.getMonth();
    
    const monthNames = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
                        'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];
    monthYearEl.textContent = monthNames[month] + ' ' + year;
    
    calendarGrid.innerHTML = '';
    
    const dayNames = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];
    dayNames.forEach(day => {
        calendarGrid.innerHTML += '<div class="calendar-day-header">' + day + '</div>';
    });
    
    const firstDay = new Date(year, month, 1);
    let startDay = firstDay.getDay() - 1;
    if (startDay < 0) startDay = 6;
    
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    
    for (let i = 0; i < startDay; i++) {
        calendarGrid.innerHTML += '<div class="calendar-day other-month"></div>';
    }
    
    const today = new Date();
    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
        const isToday = year === today.getFullYear() && month === today.getMonth() && day === today.getDate();
        
        calendarGrid.innerHTML += '<div class="calendar-day' + (isToday ? ' today' : '') + 
            '" data-date="' + dateStr + '" onclick="selectCalendarDay(\'' + dateStr + '\')">' +
            '<span class="day-number">' + day + '</span></div>';
    }
    
    loadMonthBookings(year, month + 1);
}

async function loadMonthBookings(year, month) {
    const courtFilter = document.getElementById('court-filter')?.value || '';
    try {
        let url = API_BASE_URL + '/bookings?year=' + year + '&month=' + month;
        if (courtFilter) url += '&court_id=' + courtFilter;
        
        const response = await fetch(url);
        const data = await response.json();
        if (response.ok && data.success) {
            bookingsData = data.bookings;
            updateCalendarWithBookings();
        }
    } catch (error) {
        console.error('Error loading bookings:', error);
    }
}

function updateCalendarWithBookings() {
    document.querySelectorAll('.calendar-day[data-date]').forEach(dayEl => {
        const dateStr = dayEl.dataset.date;
        const bookings = bookingsData.filter(b => b.booking_date.split('T')[0] === dateStr);
        
        const existingCount = dayEl.querySelector('.booking-count');
        if (existingCount) existingCount.remove();
        
        if (bookings.length > 0) {
            const countEl = document.createElement('span');
            countEl.className = 'booking-count';
            countEl.textContent = bookings.length;
            dayEl.appendChild(countEl);
        }
    });
}

function prevMonth() {
    currentCalendarDate.setMonth(currentCalendarDate.getMonth() - 1);
    renderCalendar();
}

function nextMonth() {
    currentCalendarDate.setMonth(currentCalendarDate.getMonth() + 1);
    renderCalendar();
}

function selectCalendarDay(dateStr) {
    document.querySelectorAll('.calendar-day').forEach(d => d.classList.remove('selected'));
    document.querySelector('.calendar-day[data-date="' + dateStr + '"]')?.classList.add('selected');
    loadDayBookings(dateStr);
}

async function loadDayBookings(dateStr) {
    const bookingsList = document.getElementById('bookings-list');
    if (!bookingsList) return;
    
    try {
        const response = await fetch(API_BASE_URL + '/bookings?date=' + dateStr);
        const data = await response.json();
        
        if (response.ok && data.success) {
            if (data.bookings.length === 0) {
                bookingsList.innerHTML = '<div class="no-bookings"><p>Nessuna prenotazione per ' + 
                    formatDateIT(dateStr) + '</p><button class="btn btn-primary" onclick="openNewBookingModal(\'' + 
                    dateStr + '\')">+ Nuova Prenotazione</button></div>';
            } else {
                bookingsList.innerHTML = '<div class="bookings-header"><h3>Prenotazioni - ' + formatDateIT(dateStr) + 
                    '</h3><button class="btn btn-primary" onclick="openNewBookingModal(\'' + dateStr + 
                    '\')">+ Nuova</button></div>' + data.bookings.map(b => renderBookingCard(b)).join('');
            }
        }
    } catch (error) {
        bookingsList.innerHTML = '<p style="color: var(--danger)">Errore caricamento</p>';
    }
}

function renderBookingCard(booking) {
    const statusLabels = { 'pending': 'In Attesa', 'confirmed': 'Confermata', 'cancelled': 'Annullata' };
    const paymentLabels = { 'pending': 'Da Pagare', 'paid': 'Pagato', 'partial': 'Parziale' };
    
    return '<div class="booking-card"><div class="booking-header">' +
        '<span class="booking-time">' + booking.start_time.slice(0, 5) + ' - ' + booking.end_time.slice(0, 5) + '</span>' +
        '<span class="status-badge status-' + booking.status + '">' + statusLabels[booking.status] + '</span></div>' +
        '<div class="booking-body"><p><strong>' + (booking.court_name || 'Campo') + '</strong></p>' +
        '<p>👤 ' + booking.customer_name + '</p>' +
        '<p>📞 ' + (booking.customer_phone || '-') + '</p>' +
        '<p>👥 ' + booking.num_players + ' giocatori</p>' +
        '<p>💰 €' + parseFloat(booking.total_price).toFixed(2) + ' (' + paymentLabels[booking.payment_status] + ')</p>' +
        (booking.match_id ? '<p>🎥 Match collegato</p>' : '') + '</div>' +
        '<div class="booking-actions">' +
        (booking.status === 'pending' ? '<button class="btn btn-success btn-small" onclick="confirmBooking(\'' + 
            booking.id + '\')">Conferma</button><button class="btn btn-danger btn-small" onclick="cancelBooking(\'' + 
            booking.id + '\')">Annulla</button>' : '') + '</div></div>';
}

function openNewBookingModal(dateStr) {
    const modal = document.getElementById('booking-modal');
    if (!modal) return;
    document.getElementById('booking-form')?.reset();
    document.getElementById('booking-date').value = dateStr || new Date().toISOString().split('T')[0];
    document.getElementById('available-slots').innerHTML = '<p>Seleziona campo e data</p>';
    modal.style.display = 'flex';
}

function closeBookingModal() {
    document.getElementById('booking-modal').style.display = 'none';
}

async function loadAvailableSlots() {
    const courtId = document.getElementById('booking-court').value;
    const date = document.getElementById('booking-date').value;
    const slotsContainer = document.getElementById('available-slots');
    
    if (!courtId || !date) {
        slotsContainer.innerHTML = '<p>Seleziona campo e data</p>';
        return;
    }
    
    try {
        const response = await fetch(API_BASE_URL + '/bookings/available-slots?court_id=' + courtId + '&date=' + date);
        const data = await response.json();
        
        if (response.ok && data.slots) {
            if (data.slots.length === 0) {
                slotsContainer.innerHTML = '<p>Nessuno slot disponibile</p>';
            } else {
                slotsContainer.innerHTML = data.slots.map(slot => 
                    '<button type="button" class="slot-btn ' + (slot.is_available ? '' : 'unavailable') + 
                    '" ' + (slot.is_available ? 'onclick="selectSlot(\'' + slot.start_time + '\',' + 
                    slot.duration_minutes + ',' + slot.price + ')"' : 'disabled') + '>' +
                    slot.start_time + '<br><small>€' + slot.price + '</small></button>'
                ).join('');
            }
        }
    } catch (error) {
        slotsContainer.innerHTML = '<p style="color: var(--danger)">Errore caricamento slot</p>';
    }
}

function selectSlot(startTime, duration, price) {
    document.querySelectorAll('.slot-btn').forEach(btn => btn.classList.remove('selected'));
    event.target.closest('.slot-btn').classList.add('selected');
    document.getElementById('booking-time').value = startTime;
    
    const parts = startTime.split(':');
    const endDate = new Date(2000, 0, 1, parseInt(parts[0]), parseInt(parts[1]) + duration);
    document.getElementById('booking-end-time').value = 
        String(endDate.getHours()).padStart(2, '0') + ':' + String(endDate.getMinutes()).padStart(2, '0');
    
    document.getElementById('booking-total-price').value = price.toFixed(2);
    calculateBookingPrice();
}

function calculateBookingPrice() {
    const totalPrice = parseFloat(document.getElementById('booking-total-price').value) || 0;
    const numPlayers = parseInt(document.getElementById('booking-players').value) || 4;
    if (totalPrice > 0) {
        document.getElementById('price-per-player').textContent = '€' + (totalPrice / numPlayers).toFixed(2) + ' a giocatore';
    }
}

async function submitBooking(e) {
    e.preventDefault();
    
    var bookingTime = document.getElementById("booking-time").value;
    var bookingEndTime = document.getElementById("booking-end-time").value;
    
    if (!bookingTime || !bookingEndTime) {
        alert("Seleziona uno slot orario");
        return;
    }
    
    var formData = {
        court_id: document.getElementById("booking-court").value,
        booking_date: document.getElementById("booking-date").value,
        start_time: bookingTime,
        end_time: bookingEndTime,
        customer_name: document.getElementById("booking-customer-name").value,
        customer_email: document.getElementById("booking-customer-email").value || "",
        customer_phone: document.getElementById("booking-customer-phone").value || "",
        num_players: parseInt(document.getElementById("booking-players").value) || 4,
        notes: document.getElementById("booking-notes").value || ""
    };
    
    try {
        var response = await fetch(API_BASE_URL + "/bookings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(formData)
        });
        var data = await response.json();
        
        if (response.ok) {
            alert("Prenotazione creata!");
            closeBookingModal();
            renderCalendar();
            loadDayBookings(formData.booking_date);
        } else {
            throw new Error(data.error || data.message || "Errore");
        }
    } catch (error) {
        alert("Errore: " + error.message);
    }
}

async function confirmBooking(bookingId) {
    if (!confirm('Confermare la prenotazione?')) return;
    
    try {
        const response = await fetch(API_BASE_URL + '/bookings/' + bookingId + '/confirm', { method: 'PUT' });
        const data = await response.json();
        
        if (response.ok && data.success) {
            alert('Prenotazione confermata! Match creato.');
            renderCalendar();
            const selectedDay = document.querySelector('.calendar-day.selected');
            if (selectedDay) loadDayBookings(selectedDay.dataset.date);
        } else {
            throw new Error(data.message || 'Errore');
        }
    } catch (error) {
        alert('Errore: ' + error.message);
    }
}

async function cancelBooking(bookingId) {
    if (!confirm('Annullare la prenotazione?')) return;
    
    try {
        const response = await fetch(API_BASE_URL + '/bookings/' + bookingId + '/cancel', { method: 'PUT' });
        const data = await response.json();
        
        if (response.ok && data.success) {
            alert('Prenotazione annullata');
            renderCalendar();
            const selectedDay = document.querySelector('.calendar-day.selected');
            if (selectedDay) loadDayBookings(selectedDay.dataset.date);
        }
    } catch (error) {
        alert('Errore: ' + error.message);
    }
}

function formatDateIT(dateStr) {
    const parts = dateStr.split('-');
    return parts[2] + '/' + parts[1] + '/' + parts[0];
}

function setupBookingEventListeners() {
    document.getElementById('court-filter')?.addEventListener('change', renderCalendar);
    document.getElementById('booking-court')?.addEventListener('change', () => {
        loadAvailableSlots();
        calculateBookingPrice();
    });
    document.getElementById('booking-date')?.addEventListener('change', loadAvailableSlots);
    document.getElementById('booking-players')?.addEventListener('change', calculateBookingPrice);
    document.getElementById('booking-form')?.addEventListener('submit', submitBooking);
}

// ==========================================
// COURTS MANAGEMENT
// ==========================================

function renderCourtsGrid() {
    const courtsGrid = document.getElementById('courts-grid');
    if (!courtsGrid) return;
    
    if (courtsData.length === 0) {
        courtsGrid.innerHTML = '<p>Nessun campo configurato</p>';
        return;
    }
    
    courtsGrid.innerHTML = courtsData.map(court => 
        '<div class="court-card"><div class="court-header"><h3>' + court.name + '</h3>' +
        '<span class="sport-badge sport-' + court.sport_type.toLowerCase() + '">' + court.sport_type + '</span></div>' +
        '<div class="court-details"><p>⏱️ Durata: ' + court.default_duration_minutes + ' min</p>' +
        '<p>💰 Prezzo: €' + parseFloat(court.price_per_hour).toFixed(2) + '/ora</p>' +
        '<p>🎥 Video: ' + (court.has_video_recording ? 'Sì' : 'No') + '</p></div>' +
        '<div class="court-actions"><button class="btn btn-primary btn-small" onclick="editCourt(\'' + 
        court.id + '\')">Modifica</button><button class="btn btn-danger btn-small" onclick="deleteCourt(\'' + 
        court.id + '\')">Elimina</button></div></div>'
    ).join('');
}

function openNewCourtModal() {
    const modal = document.getElementById('court-modal');
    if (!modal) return;
    document.getElementById('court-form')?.reset();
    document.getElementById('court-modal-title').textContent = 'Nuovo Campo';
    document.getElementById('court-id').value = '';
    modal.style.display = 'flex';
}

function closeCourtModal() {
    document.getElementById('court-modal').style.display = 'none';
}

function editCourt(courtId) {
    const court = courtsData.find(c => c.id === courtId);
    if (!court) return;
    
    document.getElementById('court-modal-title').textContent = 'Modifica Campo';
    document.getElementById('court-id').value = court.id;
    document.getElementById('court-name').value = court.name;
    document.getElementById('court-sport-type').value = court.sport_type;
    document.getElementById('court-duration').value = court.default_duration_minutes;
    document.getElementById('court-price').value = court.price_per_hour;
    document.getElementById('court-video').checked = court.has_video_recording;
    document.getElementById('court-modal').style.display = 'flex';
}

async function submitCourt(e) {
    e.preventDefault();
    const courtId = document.getElementById("court-id").value;
    const formData = {
        name: document.getElementById("court-name").value,
        sport_type: document.getElementById("court-sport-type").value,
        description: "",
        default_duration_minutes: parseInt(document.getElementById("court-duration").value),
        price_per_hour: parseFloat(document.getElementById("court-price").value),
        is_active: true,
        has_video_recording: document.getElementById("court-video").checked
    };
    try {
        const url = courtId ? API_BASE_URL + "/courts/" + courtId : API_BASE_URL + "/courts";
        const method = courtId ? "PUT" : "POST";
        const response = await fetch(url, {
            method: method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(formData)
        });
        const data = await response.json();
        if (response.ok) {
            alert(courtId ? "Campo aggiornato!" : "Campo creato!");
            closeCourtModal();
            loadCourts();
        } else {
            throw new Error(data.error || data.message || "Errore");
        }
    } catch (error) {
        alert("Errore: " + error.message);
    }
}

async function deleteCourt(courtId) {
    if (!confirm('Eliminare questo campo?')) return;
    
    try {
        const response = await fetch(API_BASE_URL + '/courts/' + courtId, { method: 'DELETE' });
        const data = await response.json();
        
        if (response.ok && data.success) {
            alert('Campo eliminato');
            loadCourts();
        }
    } catch (error) {
        alert('Errore: ' + error.message);
    }
}

document.getElementById('court-form')?.addEventListener('submit', submitCourt);

// Auto-refresh stats every 30 seconds
setInterval(() => {
    if (currentPage === 'overview') loadOverviewData();
}, 30000);

// ==========================================
// MOBILE SIDEBAR TOGGLE
// ==========================================

function toggleSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.querySelector('.sidebar-overlay');
    
    sidebar.classList.toggle('open');
    overlay.classList.toggle('active');
}

// Close sidebar when clicking a nav item on mobile
document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
        if (window.innerWidth <= 768) {
            const sidebar = document.querySelector('.sidebar');
            const overlay = document.querySelector('.sidebar-overlay');
            sidebar.classList.remove('open');
            overlay.classList.remove('active');
        }
    });
});

// Close sidebar on window resize to desktop
window.addEventListener('resize', () => {
    if (window.innerWidth > 768) {
        const sidebar = document.querySelector('.sidebar');
        const overlay = document.querySelector('.sidebar-overlay');
        sidebar.classList.remove('open');
        overlay.classList.remove('active');
    }
});

// ==========================================
// PLAYERS MANAGEMENT - Anagrafica
// ==========================================

let playersData = [];

async function loadPlayers(search = '') {
    try {
        let url = API_BASE_URL + '/players';
        if (search) url += '?search=' + encodeURIComponent(search);
        
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.success) {
            playersData = data.players;
            renderPlayersGrid();
        }
    } catch (error) {
        console.error('Error loading players:', error);
    }
}

function renderPlayersGrid() {
    const container = document.getElementById('players-list');
    if (!container) return;
    
    if (playersData.length === 0) {
        container.innerHTML = '<p class="empty-state">Nessun giocatore in anagrafica</p>';
        return;
    }
    
    container.innerHTML = playersData.map(player => 
        '<div class="player-card">' +
        '<div class="player-info">' +
        '<h4>' + player.first_name + ' ' + player.last_name + '</h4>' +
        '<p>' + (player.email || '-') + '</p>' +
        '<p>' + (player.phone || '-') + '</p>' +
        '</div>' +
        '<div class="player-actions">' +
        '<button class="btn btn-primary btn-small" onclick="editPlayer(\'' + player.id + '\')">Modifica</button>' +
        '<button class="btn btn-danger btn-small" onclick="deletePlayer(\'' + player.id + '\')">Elimina</button>' +
        '</div>' +
        '</div>'
    ).join('');
}

function searchPlayers() {
    const search = document.getElementById('player-search').value;
    loadPlayers(search);
}

function openNewPlayerModal() {
    document.getElementById('player-form').reset();
    document.getElementById('player-modal-title').textContent = 'Nuovo Giocatore';
    document.getElementById('player-id').value = '';
    document.getElementById('player-modal').style.display = 'flex';
}

function closePlayerModal() {
    document.getElementById('player-modal').style.display = 'none';
}

function editPlayer(playerId) {
    const player = playersData.find(p => p.id === playerId);
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

async function submitPlayer(e) {
    e.preventDefault();
    
    const playerId = document.getElementById('player-id').value;
    const formData = {
        first_name: document.getElementById('player-first-name').value,
        last_name: document.getElementById('player-last-name').value,
        email: document.getElementById('player-email').value || null,
        phone: document.getElementById('player-phone').value || null,
        notes: document.getElementById('player-notes').value || null
    };
    
    try {
        const url = playerId ? API_BASE_URL + '/players/' + playerId : API_BASE_URL + '/players';
        const method = playerId ? 'PUT' : 'POST';
        
        const response = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(formData)
        });
        const data = await response.json();
        
        if (response.ok) {
            alert(playerId ? 'Giocatore aggiornato!' : 'Giocatore creato!');
            closePlayerModal();
            loadPlayers();
        } else {
            throw new Error(data.error || 'Errore');
        }
    } catch (error) {
        alert('Errore: ' + error.message);
    }
}

async function deletePlayer(playerId) {
    if (!confirm('Rimuovere questo giocatore dall\'anagrafica?')) return;
    
    try {
        const response = await fetch(API_BASE_URL + '/players/' + playerId, { method: 'DELETE' });
        if (response.ok) {
            alert('Giocatore rimosso');
            loadPlayers();
        }
    } catch (error) {
        alert('Errore: ' + error.message);
    }
}

document.getElementById('player-form')?.addEventListener('submit', submitPlayer);

// Update navigateTo for players page
var origNav = navigateTo;
navigateTo = function(page) {
    origNav(page);
    if (page === 'players') {
        loadPlayers();
    }
};
