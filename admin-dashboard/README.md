# RePlayo Admin Dashboard

Web-based admin interface for managing RePlayo matches, videos, users, and storage.

## Features

- **Overview Dashboard**: Real-time statistics for videos, storage, views, and downloads
- **Match Management**: Create new matches with booking codes and auto-generated passwords
- **Video Upload**: Upload videos with progress tracking (up to 2GB)
- **User Management**: View and manage users via database queries
- **Storage Configuration**: Monitor storage usage and configuration

## Prerequisites

- Node.js installed
- Backend API running on port 3000

## Installation

```bash
cd /Users/Teofly/replayo/admin-dashboard
npm install
```

## Usage

### Start the Dashboard

```bash
npm start
```

The dashboard will be available at: **http://localhost:8080**

### Make sure Backend is Running

```bash
cd /Users/Teofly/replayo/backend
node server.js
```

Backend should be running on: **http://localhost:3000**

## Pages

### 1. Overview
- Total videos count
- Storage usage
- Total views and downloads
- API connection status

### 2. Matches
- Create new match with:
  - Booking code
  - Sport type (Padel, Tennis, Soccer)
  - Location
  - Match date/time
  - Players list
- Automatically generates 8-character session password

### 3. Videos
- Upload videos to matches
- Drag-and-drop support
- Real-time upload progress
- Supports files up to 2GB
- Mark videos as highlights

### 4. Users
- Database connection info
- SQL queries for user management

### 5. Storage
- Current storage configuration (Local NAS or S3)
- Environment variables reference
- Storage statistics

## API Endpoints Used

- `GET /api/health` - Check API status
- `POST /api/matches/create` - Create new match
- `POST /api/matches/verify` - Verify match access
- `GET /api/videos/match/:id` - Get videos by match
- `POST /api/videos/upload` - Upload video
- `GET /api/stats/storage` - Get storage statistics

## Technology Stack

- **Frontend**: Vanilla HTML, CSS, JavaScript
- **Styling**: Custom CSS with dark/neon theme
- **Server**: Node.js HTTP server
- **Backend**: Express.js REST API

## Project Structure

```
admin-dashboard/
├── index.html      # Main HTML structure
├── style.css       # Dark/neon theme styling
├── app.js          # Frontend logic and API calls
├── serve.js        # Simple HTTP server
├── package.json    # NPM configuration
└── README.md       # This file
```

## Development

The dashboard uses vanilla JavaScript with no build step required. Simply edit the files and refresh the browser.

### Customization

- **Colors**: Edit CSS variables in `style.css` (`:root` section)
- **API URL**: Change `API_BASE_URL` in `app.js`
- **Port**: Modify `PORT` in `serve.js`

## Troubleshooting

### Dashboard shows "API Offline"
1. Check backend is running: `lsof -i :3000`
2. Start backend if needed: `cd /Users/Teofly/replayo/backend && node server.js`
3. Check browser console for CORS errors

### Video upload fails
1. Check file size is under 2GB
2. Verify match ID is correct (UUID format)
3. Check backend logs for errors

### Port 8080 already in use
```bash
# Find process using port 8080
lsof -ti :8080 | xargs kill -9

# Start dashboard
npm start
```

## Production Deployment

For production, consider using:
- **Nginx** as reverse proxy
- **PM2** for process management
- **HTTPS** with SSL certificate
- **Environment variables** for API URL

Example with PM2:
```bash
pm2 start serve.js --name replayo-admin
pm2 startup
pm2 save
```

## Security Notes

- This dashboard has **NO authentication** currently
- Add authentication before production deployment
- Restrict access via firewall or VPN
- Use HTTPS in production
- Consider rate limiting for API endpoints

## License

ISC
