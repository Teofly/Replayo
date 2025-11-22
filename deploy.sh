#!/bin/bash

# RePlayo Deployment Script
# Deploys backend and admin dashboard to Linux server

SERVER_USER="teofly"
SERVER_IP="192.168.1.175"
SERVER_PATH="/home/teofly/replayo"

echo "🚀 RePlayo Deployment Script"
echo "================================"
echo "Server: $SERVER_USER@$SERVER_IP"
echo "Path: $SERVER_PATH"
echo ""

# Create deployment archive
echo "📦 Creating deployment archive..."
cd /Users/Teofly/replayo
tar -czf replayo-deploy.tar.gz \
    backend/ \
    admin-dashboard/ \
    --exclude='node_modules' \
    --exclude='.DS_Store'

echo "✅ Archive created"
echo ""

# Copy to server
echo "📤 Uploading to server..."
sshpass -p "druido" scp replayo-deploy.tar.gz $SERVER_USER@$SERVER_IP:/home/teofly/

echo "✅ Files uploaded"
echo ""

# Extract and setup on server
echo "⚙️  Setting up on server..."
sshpass -p "druido" ssh $SERVER_USER@$SERVER_IP << 'ENDSSH'
cd /home/teofly

# Stop existing services
echo "Stopping existing services..."
pm2 stop replayo-api 2>/dev/null || true
pm2 stop replayo-admin 2>/dev/null || true

# Backup old installation
if [ -d "replayo" ]; then
    echo "Backing up old installation..."
    mv replayo replayo-backup-$(date +%Y%m%d-%H%M%S)
fi

# Extract new files
echo "Extracting files..."
mkdir -p replayo
tar -xzf replayo-deploy.tar.gz -C replayo/
rm replayo-deploy.tar.gz

# Setup backend
echo "Setting up backend..."
cd replayo/backend
npm install --production

# Copy production environment
cp .env.production .env

# Setup admin dashboard
echo "Setting up admin dashboard..."
cd ../admin-dashboard
# No dependencies needed (vanilla JS)

# Start services with PM2
echo "Starting services..."
cd /home/teofly/replayo/backend
pm2 start server.js --name replayo-api --env production

cd /home/teofly/replayo/admin-dashboard
pm2 start serve.js --name replayo-admin

# Save PM2 configuration
pm2 save

echo ""
echo "✅ Deployment complete!"
echo "Backend API: http://192.168.1.175:3000"
echo "Admin Dashboard: http://192.168.1.175:8080"
echo ""
echo "Run 'pm2 status' to check services"
ENDSSH

# Cleanup
rm replayo-deploy.tar.gz

echo ""
echo "🎉 Deployment finished successfully!"
echo ""
echo "Next steps:"
echo "1. Test backend: curl http://192.168.1.175:3000/api/health"
echo "2. Access admin dashboard: http://192.168.1.175:8080"
echo "3. Update app API URL to: http://192.168.1.175:3000/api"
