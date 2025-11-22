#!/bin/bash

# RePlayo Web App Deployment Script
set -e

echo "🚀 Deploying RePlayo Web App..."
echo "================================"

SERVER="teofly@192.168.1.175"
REMOTE_PATH="/home/teofly/replayo-web"

# Create tar file
echo "📦 Creating web archive..."
cd build
tar -czf web.tar.gz web/
cd ..

# Upload web app
echo "📤 Uploading web app..."
sshpass -p 'druido' scp build/web.tar.gz $SERVER:$REMOTE_PATH/

# Deploy on server
echo "⚙️  Deploying on server..."
sshpass -p 'druido' ssh $SERVER << 'ENDSSH'
cd /home/teofly/replayo-web

# Stop the service
pm2 stop replayo-web-app || true

# Backup and extract
rm -rf build/web.backup
mv build/web build/web.backup 2>/dev/null || true
tar -xzf web.tar.gz -C build/
rm web.tar.gz

# Restart service
pm2 restart replayo-web-app || pm2 start "python3 -m http.server 8081" --name replayo-web-app --cwd /home/teofly/replayo-web/build/web
pm2 save

echo "✅ Web app deployed successfully!"
ENDSSH

# Clean up local tar
rm build/web.tar.gz

echo ""
echo "✅ Deployment complete!"
echo "Web App: http://192.168.1.175:8081"
echo ""
echo "🎉 Done!"
