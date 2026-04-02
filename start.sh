#!/bin/bash
# PM2 startup script for POS API Gateway

# Check if .env file exists and is readable
if [ -f .env ] && [ -r .env ]; then
    echo "Loading environment variables from .env file..."
    set -a  # automatically export all variables
    source .env
    set +a  # stop automatically exporting
else
    echo "Warning: .env file not found or not readable. Using system environment variables."
fi

# Start the application with bun
exec bun src/server.ts