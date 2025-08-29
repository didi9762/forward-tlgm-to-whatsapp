#!/bin/bash

# Create logs directory if it doesn't exist
mkdir -p logs

# Install PM2 globally if not installed
if ! command -v pm2 &> /dev/null; then
    echo "Installing PM2..."
    npm install -g pm2
fi

# Start the application with PM2
echo "Starting bot-tlgrm-wsp with PM2..."
pm2 start ecosystem.config.js

# Setup PM2 startup (optional - runs on system boot)
echo "Setting up PM2 startup..."
pm2 startup
pm2 save

echo "Application started! Visit http://localhost:3000 to configure."
echo "Use 'pm2 logs bot-tlgrm-wsp' to view logs"
echo "Use 'pm2 restart bot-tlgrm-wsp' to restart"
echo "Use 'pm2 stop bot-tlgrm-wsp' to stop"
