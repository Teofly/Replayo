// API Configuration
const API_BASE_URL = 'http://localhost:3000/api';

// Global state
let currentPage = 'overview';

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
    document.getElementById(`page-${page}`).classList.add('active');

    // Update page title
    const pageTitles = {
        'overview': 'Overview',
        'matches': 'Create Match',
        'manage-matches': 'Manage Matches',
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
    }
}

// API Status Check
async function checkAPIStatus() {
    const statusEl = document.getElementById('api-status');
    const apiInfoEl = document.getElementById('api-info');

    try {
        const response = await fetch(`${API_BASE_URL}/health`);
        const data = await response.json();

        if (data.status === 'ok') {
            statusEl.textContent = '🟢 API Online';
            statusEl.style.color = 'var(--success)';
            apiInfoEl.innerHTML = `
                <p><strong>Status:</strong> <span style="color: var(--success)">Connected</span></p>
                <p><strong>Database:</strong> ${data.database}</p>
                <p><strong>Storage:</strong> ${data.storage}</p>
                <p><strong>Server Time:</strong> ${new Date(data.timestamp).toLocaleString()}</p>
            `;
        }
    } catch (error) {
        statusEl.textContent = '🔴 API Offline';
        statusEl.style.color = 'var(--danger)';
        apiInfoEl.innerHTML = `
            <p style="color: var(--danger)">⚠️ Unable to connect to API</p>
            <p style="color: var(--text-secondary)">Make sure the backend is running on port 3000</p>
            <p style="color: var(--text-secondary)">Command: <code>node server.js</code></p>
        `;
    }
}

// Overview Data
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
        document.getElementById('total-videos').textContent = 'Error';
        document.getElementById('total-storage').textContent = 'Error';
        document.getElementById('total-views').textContent = 'Error';
        document.getElementById('total-downloads').textContent = 'Error';
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
            <p><strong>Average Video Size:</strong> ${formatBytes(data.averageSize || 0)}</p>
            ${data.storageType === 'local' ?
                `<p><strong>Storage Path:</strong> <code>${data.storagePath || 'N/A'}</code></p>` :
                `<p><strong>S3 Bucket:</strong> <code>${data.bucket || 'N/A'}</code></p>`
            }
        `;
    } catch (error) {
        storageInfoEl.innerHTML = `<p style="color: var(--danger)">Error loading storage info</p>`;
    }
}

// Forms Setup
function setupForms() {
    // Create Match Form
    document.getElementById('create-match-form').addEventListener('submit', handleCreateMatch);

    // Upload Video Form
    document.getElementById('upload-video-form').addEventListener('submit', handleUploadVideo);

    // Search Matches Form
    document.getElementById('search-matches-form').addEventListener('submit', handleSearchMatches);

    // Edit Match Form
    document.getElementById('edit-match-form').addEventListener('submit', handleEditMatch);

    // Cancel Edit
    document.getElementById('cancel-edit').addEventListener('click', () => {
        document.getElementById('edit-modal').style.display = 'none';
    });

    // File input info
    document.getElementById('video-file').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const fileInfo = document.getElementById('file-info');
            fileInfo.textContent = `Selected: ${file.name} (${formatBytes(file.size)})`;

            if (file.size > 2 * 1024 * 1024 * 1024) {
                fileInfo.style.color = 'var(--danger)';
                fileInfo.textContent += ' - File too large (max 2GB)';
            } else {
                fileInfo.style.color = 'var(--success)';
            }
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
        const response = await fetch(`${API_BASE_URL}/matches/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(formData)
        });

        const data = await response.json();

        if (response.ok && data.success) {
            resultEl.className = 'result success';
            resultEl.innerHTML = `
                <h4>✅ Match Created Successfully!</h4>
                <p><strong>Match ID:</strong> ${data.match.id}</p>
                <p><strong>Booking Code:</strong> ${data.match.booking_code}</p>
                <p><strong>Password:</strong> <code style="font-size: 1.2em; color: var(--accent-primary)">${data.match.session_password}</code></p>
                <p style="margin-top: 1rem; color: var(--warning)">⚠️ Save this password! It will be needed to access the match.</p>
            `;
            e.target.reset();
        } else {
            throw new Error(data.message || 'Failed to create match');
        }
    } catch (error) {
        resultEl.className = 'result error';
        resultEl.innerHTML = `<p>❌ Error: ${error.message}</p>`;
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

    if (file.size > 2 * 1024 * 1024 * 1024) {
        resultEl.className = 'result error';
        resultEl.textContent = 'File too large. Maximum size is 2GB.';
        return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Uploading...';
    progressContainer.style.display = 'block';
    resultEl.style.display = 'none';

    const formData = new FormData();
    formData.append('video', file);
    formData.append('matchId', document.getElementById('video-match-id').value);
    formData.append('title', document.getElementById('video-title').value);
    formData.append('durationSeconds', document.getElementById('video-duration').value);
    formData.append('isHighlight', document.getElementById('is-highlight').checked);

    try {
        const xhr = new XMLHttpRequest();

        // Progress tracking
        xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) {
                const percent = Math.round((e.loaded / e.total) * 100);
                progressFill.style.width = percent + '%';
                progressText.textContent = `${percent}% (${formatBytes(e.loaded)} / ${formatBytes(e.total)})`;
            }
        });

        // Upload complete
        xhr.addEventListener('load', () => {
            if (xhr.status === 200 || xhr.status === 201) {
                const data = JSON.parse(xhr.responseText);
                resultEl.className = 'result success';
                resultEl.innerHTML = `
                    <h4>✅ Video Uploaded Successfully!</h4>
                    <p><strong>Video ID:</strong> ${data.video.id}</p>
                    <p><strong>Title:</strong> ${data.video.title}</p>
                    <p><strong>Size:</strong> ${formatBytes(data.video.file_size_bytes)}</p>
                `;
                e.target.reset();
                document.getElementById('file-info').textContent = '';
                loadOverviewData(); // Refresh stats
            } else {
                throw new Error('Upload failed');
            }
        });

        // Upload error
        xhr.addEventListener('error', () => {
            throw new Error('Network error during upload');
        });

        xhr.open('POST', `${API_BASE_URL}/videos/upload`);
        xhr.send(formData);

    } catch (error) {
        resultEl.className = 'result error';
        resultEl.innerHTML = `<p>❌ Error: ${error.message}</p>`;
    } finally {
        setTimeout(() => {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Upload Video';
            progressContainer.style.display = 'none';
            progressFill.style.width = '0%';
            progressText.textContent = '0%';
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
        const response = await fetch(`${API_BASE_URL}/matches/search?${params.toString()}`);
        const data = await response.json();

        if (response.ok && data.success) {
            if (data.matches.length === 0) {
                resultsEl.innerHTML = '<p style="color: var(--text-secondary)">No matches found</p>';
            } else {
                resultsEl.innerHTML = `
                    <h3>Found ${data.count} match${data.count > 1 ? 'es' : ''}</h3>
                    ${data.matches.map(match => renderMatchCard(match)).join('')}
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

// Render Match Card
function renderMatchCard(match) {
    const matchDate = new Date(match.match_date).toLocaleString();
    const createdDate = new Date(match.created_at).toLocaleString();
    const isActive = match.is_active;

    return `
        <div class="match-card">
            <div class="match-card-header">
                <div>
                    <h4 class="match-card-title">${match.booking_code}</h4>
                    <span class="badge ${isActive ? 'badge-active' : 'badge-inactive'}">
                        ${isActive ? 'Active' : 'Inactive'}
                    </span>
                </div>
                <div class="match-card-actions">
                    <button class="btn btn-primary btn-small" onclick="editMatch('${match.id}')">Edit</button>
                    <button class="btn btn-danger btn-small" onclick="deleteMatch('${match.id}', '${match.booking_code}')">Delete</button>
                </div>
            </div>
            <div class="match-card-body">
                <div class="match-detail">
                    <span class="match-detail-label">Sport</span>
                    <span class="match-detail-value">${match.sport_type}</span>
                </div>
                <div class="match-detail">
                    <span class="match-detail-label">Location</span>
                    <span class="match-detail-value">${match.location}</span>
                </div>
                <div class="match-detail">
                    <span class="match-detail-label">Match Date</span>
                    <span class="match-detail-value">${matchDate}</span>
                </div>
                <div class="match-detail">
                    <span class="match-detail-label">Players</span>
                    <span class="match-detail-value">${match.player_names.join(', ')}</span>
                </div>
                <div class="match-detail">
                    <span class="match-detail-label">Videos</span>
                    <span class="match-detail-value">${match.video_count || 0}</span>
                </div>
                <div class="match-detail">
                    <span class="match-detail-label">Password</span>
                    <span class="match-detail-value"><code>${match.access_password}</code></span>
                </div>
            </div>
        </div>
    `;
}

// Edit Match
async function editMatch(matchId) {
    try {
        const response = await fetch(`${API_BASE_URL}/matches/id/${matchId}`);
        const data = await response.json();

        if (response.ok && data.success) {
            const match = data.match;

            // Populate form
            document.getElementById('edit-match-id').value = match.id;
            document.getElementById('edit-booking-code').value = match.booking_code;
            document.getElementById('edit-sport-type').value = match.sport_type;
            document.getElementById('edit-location').value = match.location;
            document.getElementById('edit-match-date').value = new Date(match.match_date).toISOString().slice(0, 16);
            document.getElementById('edit-players').value = match.player_names.join(', ');
            document.getElementById('edit-password').value = match.access_password;
            document.getElementById('edit-is-active').checked = match.is_active;

            // Show modal
            document.getElementById('edit-modal').style.display = 'flex';
        } else {
            throw new Error('Failed to load match');
        }
    } catch (error) {
        alert('Error loading match: ' + error.message);
    }
}

// Handle Edit Match Submit
async function handleEditMatch(e) {
    e.preventDefault();

    const resultEl = document.getElementById('edit-result');
    const submitBtn = e.target.querySelector('button[type="submit"]');

    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving...';

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
        const response = await fetch(`${API_BASE_URL}/matches/${matchId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(formData)
        });

        const data = await response.json();

        if (response.ok && data.success) {
            resultEl.className = 'result success';
            resultEl.innerHTML = '<p>Match updated successfully!</p>';

            setTimeout(() => {
                document.getElementById('edit-modal').style.display = 'none';
                resultEl.innerHTML = '';
                // Refresh search results
                document.getElementById('search-matches-form').dispatchEvent(new Event('submit'));
            }, 1500);
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

// Delete Match
async function deleteMatch(matchId, bookingCode) {
    if (!confirm(`Are you sure you want to delete match "${bookingCode}"? This will also delete all associated videos!`)) {
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/matches/${matchId}`, {
            method: 'DELETE'
        });

        const data = await response.json();

        if (response.ok && data.success) {
            alert('Match deleted successfully');
            // Refresh search results
            document.getElementById('search-matches-form').dispatchEvent(new Event('submit'));
        } else {
            throw new Error(data.message || 'Delete failed');
        }
    } catch (error) {
        alert('Error deleting match: ' + error.message);
    }
}

// Auto-refresh stats every 30 seconds
setInterval(() => {
    if (currentPage === 'overview') {
        loadOverviewData();
    }
}, 30000);
