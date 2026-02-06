#!/bin/bash
# Check status of Engram services

echo "=== Engram Services Status ==="
echo ""

# Check launchctl status
echo "LaunchAgent Status:"
echo "-------------------"

ENGRAM_STATUS=$(launchctl list 2>/dev/null | grep "com.engram.server" || echo "not loaded")
EMBED_STATUS=$(launchctl list 2>/dev/null | grep "com.engram-embed.server" || echo "not loaded")

if [[ "$ENGRAM_STATUS" == "not loaded" ]]; then
    echo "engram server: NOT LOADED"
else
    PID=$(echo "$ENGRAM_STATUS" | awk '{print $1}')
    if [[ "$PID" == "-" ]]; then
        echo "engram server: LOADED (not running)"
    else
        echo "engram server: RUNNING (PID: $PID)"
    fi
fi

if [[ "$EMBED_STATUS" == "not loaded" ]]; then
    echo "engram-embed:  NOT LOADED"
else
    PID=$(echo "$EMBED_STATUS" | awk '{print $1}')
    if [[ "$PID" == "-" ]]; then
        echo "engram-embed:  LOADED (not running)"
    else
        echo "engram-embed:  RUNNING (PID: $PID)"
    fi
fi

echo ""
echo "Endpoint Health:"
echo "----------------"

# Check engram server
ENGRAM_HEALTH=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/v1/health 2>/dev/null)
if [[ "$ENGRAM_HEALTH" == "200" ]]; then
    echo "engram server (3001): ✓ healthy"
else
    echo "engram server (3001): ✗ not responding (HTTP: $ENGRAM_HEALTH)"
fi

# Check engram-embed
EMBED_HEALTH=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/health 2>/dev/null)
if [[ "$EMBED_HEALTH" == "200" ]]; then
    echo "engram-embed (8080):  ✓ healthy"
else
    echo "engram-embed (8080):  ✗ not responding (HTTP: $EMBED_HEALTH)"
fi

echo ""
echo "Recent Logs:"
echo "------------"
echo "engram server (last 3 lines):"
tail -3 /tmp/engram-server.log 2>/dev/null || echo "  (no log file)"
echo ""
echo "engram-embed (last 3 lines):"
tail -3 /tmp/engram-embed.log 2>/dev/null || echo "  (no log file)"
