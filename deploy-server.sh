#!/bin/bash
# Server deployment script for POS API Gateway

echo "🚀 Deploying POS API Gateway Service..."

# Ensure we're in the right directory
cd "$(dirname "$0")"

# Check if bun is installed
if ! command -v bun &> /dev/null; then
    echo "❌ Bun is not installed. Please install Bun first."
    echo "Run: curl -fsSL https://bun.sh/install | bash"
    exit 1
fi

# Check if PM2 is installed
if ! command -v pm2 &> /dev/null; then
    echo "❌ PM2 is not installed. Installing PM2..."
    npm install -g pm2
fi

# Install dependencies
echo "📦 Installing dependencies..."
bun install

# Create logs directory
mkdir -p logs

# Stop any existing instance
echo "🛑 Stopping any existing instances..."
pm2 delete pos-api-gateway 2>/dev/null || true

# Start the application
echo "🚀 Starting application with PM2..."
pm2 start ecosystem.config.cjs --env production

# Save PM2 configuration
echo "💾 Saving PM2 configuration..."
pm2 save

# Show status
echo "📊 PM2 Status:"
pm2 status

echo "✅ Deployment complete!"
echo ""
echo "Useful commands:"
echo "  pm2 logs pos-api-gateway     - View application logs"
echo "  pm2 status                   - Check application status"
echo "  pm2 restart pos-api-gateway  - Restart the application"
echo "  pm2 stop pos-api-gateway     - Stop the application"
echo ""
echo "To make PM2 start on boot, run: pm2 startup"