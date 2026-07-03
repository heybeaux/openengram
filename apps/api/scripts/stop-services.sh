#!/bin/bash
# Stop Engram services via launchctl

echo "Stopping Engram services..."

# Unload engram server
launchctl unload ~/Library/LaunchAgents/com.engram.server.plist 2>/dev/null && \
    echo "✓ engram server stopped" || echo "- engram server was not running"

# Unload engram-embed
launchctl unload ~/Library/LaunchAgents/com.engram-embed.server.plist 2>/dev/null && \
    echo "✓ engram-embed stopped" || echo "- engram-embed was not running"

echo ""
echo "All services stopped."
