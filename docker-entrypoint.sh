#!/bin/sh

echo "Running database migrations..."
npx prisma migrate deploy 2>&1 || echo "WARNING: Migration failed. Continuing startup..."

echo "Starting Engram..."
exec node dist/src/main.js
