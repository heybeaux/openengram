#!/bin/bash
# Start Engram services via launchctl

echo "Starting Engram services..."

# Load engram-embed first (dependency for embeddings)
launchctl load ~/Library/LaunchAgents/com.engram-embed.server.plist 2>/dev/null || \
    launchctl kickstart -k gui/$(id -u)/com.engram-embed.server

echo "✓ engram-embed loading..."

# Wait a moment for embed service to start
sleep 2

# Load engram server
launchctl load ~/Library/LaunchAgents/com.engram.server.plist 2>/dev/null || \
    launchctl kickstart -k gui/$(id -u)/com.engram.server

echo "✓ engram server loading..."

# Wait for services to start
sleep 3

# Check status
echo ""
echo "Service status:"
launchctl list | grep -E "engram|PID" | head -3

echo ""
echo "Testing endpoints..."
curl -s http://localhost:3001/v1/health 2>/dev/null && echo " ✓ Engram server (3001)" || echo " ✗ Engram server not responding"
curl -s http://localhost:8080/health 2>/dev/null && echo " ✓ engram-embed (8080)" || echo " ✗ engram-embed not responding"

echo ""
echo "Logs: /tmp/engram-server.log, /tmp/engram-embed.log"
