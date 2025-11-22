# RePlayo Admin Dashboard - COMPLETED

## What Was Created

A complete web-based admin dashboard for managing the RePlayo backend system.

## Files Created

```
/Users/Teofly/replayo/admin-dashboard/
├── index.html      ✅ Complete HTML structure with 5 sections
├── style.css       ✅ Dark/neon theme matching RePlayo app
├── app.js          ✅ Full API integration and functionality
├── serve.js        ✅ HTTP server for serving dashboard
├── package.json    ✅ NPM configuration with start scripts
└── README.md       ✅ Complete documentation
```

## Backend Updates

**File**: `/Users/Teofly/replayo/backend/server.js`

**Added**: `POST /api/matches/create` endpoint (server.js:146-205)
- Creates new match with auto-generated 8-character password
- Inserts match into database
- Registers all players
- Returns match details with session password

## How to Access

### 1. Start Backend API (if not already running)
```bash
cd /Users/Teofly/replayo/backend
node server.js
```
**Running on**: http://localhost:3000

### 2. Start Admin Dashboard
```bash
cd /Users/Teofly/replayo/admin-dashboard
node serve.js
# OR
npm start
```
**Running on**: http://localhost:8080

### 3. Open in Browser
Navigate to: **http://localhost:8080**

## Dashboard Features

### 📊 Overview Page
- **Real-time Statistics**:
  - Total videos count
  - Storage used (formatted in GB/MB)
  - Total views
  - Total downloads
- **API Status Indicator**:
  - Green 🟢 = Connected
  - Red 🔴 = Disconnected
- **Auto-refresh** every 30 seconds

### 🎾 Matches Page
- **Create New Match Form**:
  - Booking code (e.g., PADEL2024)
  - Sport type dropdown (Padel, Tennis, Soccer)
  - Location (e.g., Centro Sportivo Milano)
  - Match date/time picker
  - Players list (comma-separated)
- **Auto-generates** 8-character session password
- **Displays** password after creation (important to save!)

### 📹 Videos Page
- **Upload Video Form**:
  - Match ID input (UUID)
  - Video title
  - Duration in seconds
  - File picker (max 2GB)
  - "Mark as Highlight" checkbox
- **Real-time Upload Progress**:
  - Progress bar with percentage
  - Upload speed and size tracking
- **File Size Validation**:
  - Green ✅ = Valid file size
  - Red ❌ = File too large

### 👥 Users Page
- Database connection instructions
- Example psql commands
- Direct database query interface guidance

### 💾 Storage Page
- **Current Configuration**:
  - Storage type (Local/S3)
  - Total videos and size
  - Average video size
  - Storage path or S3 bucket
- **Environment Variables** reference for configuration

## UI Theme

**Design**: Dark/Neon futuristic (matching RePlayo app)

**Colors**:
- Background: Dark navy (`#0a0e27`)
- Cards: Darker navy (`#1a1f3a`)
- Primary accent: Cyan (`#00fff5`)
- Secondary accent: Purple (`#7b2cbf`)
- Success: Green (`#00ff88`)
- Warning: Orange (`#ffaa00`)
- Danger: Red (`#ff3366`)

**Features**:
- Glassmorphism effects
- Smooth transitions
- Hover animations
- Responsive grid layout
- Custom scrollbars

## API Integration

All dashboard functions connect to the backend REST API:

| Function | Endpoint | Method |
|----------|----------|--------|
| Health check | `/api/health` | GET |
| Create match | `/api/matches/create` | POST |
| Get statistics | `/api/stats/storage` | GET |
| Upload video | `/api/videos/upload` | POST |

## Testing the Dashboard

### Test 1: Check API Connection
1. Open dashboard: http://localhost:8080
2. Look at header: should show "🟢 API Online"
3. Overview page should load statistics

### Test 2: Create a Match
1. Go to "Matches" page
2. Fill in form:
   - Booking Code: `TEST2024`
   - Sport: `Padel`
   - Location: `Test Center`
   - Date: Select any future date
   - Players: `John Doe, Jane Smith`
3. Click "Create Match"
4. Should see success message with generated password
5. **SAVE THE PASSWORD** - you'll need it to access the match

### Test 3: Upload Video (requires Match ID from Test 2)
1. Go to "Videos" page
2. Fill in form:
   - Match ID: (copy from Test 2 result)
   - Title: `Test Video`
   - Duration: `600` (10 minutes)
   - Select a video file (any MP4, max 2GB)
   - Optional: check "Mark as Highlight"
3. Click "Upload Video"
4. Watch progress bar fill
5. Should see success message when complete

## Current Status

✅ **Dashboard**: Running on port 8080
✅ **Backend API**: Running on port 3000
✅ **All Features**: Implemented and functional
✅ **Documentation**: Complete

## Next Steps

### For iPad Testing (as requested)

To test the RePlayo Flutter app on iPad:

1. **Connect iPad** to your Mac via USB
2. **Enable Developer Mode** on iPad:
   - Settings → Privacy & Security → Developer Mode → ON
   - iPad will restart
3. **Trust your Mac** when prompted
4. **Update API URL** for testing on iPad:

```dart
// lib/services/api_service.dart
// Change from:
static const String baseUrl = 'http://localhost:3000/api';

// To (use your Mac's local IP):
static const String baseUrl = 'http://192.168.1.XXX:3000/api';
```

5. **Run on iPad**:
```bash
flutter devices  # Find iPad device ID
flutter run -d <ipad-device-id>
```

### For Production

1. **Add Authentication** to admin dashboard:
   - Implement login system
   - Add session management
   - Protect all admin routes

2. **Deploy Backend** to Linux server (192.168.1.175):
```bash
# On server
cd /home/teofly
git clone <repo> replayo
cd replayo/backend
npm install
pm2 start server.js --name replayo-api
pm2 startup
pm2 save
```

3. **Deploy Admin Dashboard**:
```bash
# On server
cd replayo/admin-dashboard
pm2 start serve.js --name replayo-admin
```

4. **Configure Nginx** as reverse proxy:
```nginx
# API
location /api {
    proxy_pass http://localhost:3000;
}

# Admin Dashboard
location /admin {
    proxy_pass http://localhost:8080;
}
```

5. **Setup SSL** with Let's Encrypt

## Troubleshooting

### Dashboard shows "API Offline"
```bash
# Check if backend is running
lsof -i :3000

# If not running, start it
cd /Users/Teofly/replayo/backend
node server.js
```

### Port 8080 already in use
```bash
# Kill existing process
lsof -ti :8080 | xargs kill -9

# Restart dashboard
cd /Users/Teofly/replayo/admin-dashboard
npm start
```

### Upload fails
1. Check file size < 2GB
2. Verify match ID is valid UUID
3. Check backend logs for errors
4. Ensure storage path is accessible

## File Locations Reference

```
/Users/Teofly/replayo/
├── admin-dashboard/        ← NEW! Admin interface
│   ├── index.html
│   ├── style.css
│   ├── app.js
│   ├── serve.js
│   ├── package.json
│   └── README.md
├── backend/
│   └── server.js          ← UPDATED with /api/matches/create
├── lib/                   ← Flutter app
├── BACKEND_API.md
├── FINALIZZAZIONE.md
└── ADMIN_DASHBOARD_COMPLETE.md  ← This file
```

## Quick Commands Reference

```bash
# Start everything
cd /Users/Teofly/replayo/backend && node server.js &
cd /Users/Teofly/replayo/admin-dashboard && npm start &

# Check what's running
lsof -i :3000  # Backend API
lsof -i :8080  # Admin Dashboard

# Stop everything
lsof -ti :3000 :8080 | xargs kill -9

# Test API health
curl http://localhost:3000/api/health

# Access dashboard
open http://localhost:8080
```

## Summary

✅ **Admin dashboard is COMPLETE and RUNNING**
✅ **Backend updated with match creation endpoint**
✅ **Full documentation provided**
✅ **Ready for iPad testing** (just need to update API URL)

The dashboard provides a professional, user-friendly interface for managing all aspects of the RePlayo system.
