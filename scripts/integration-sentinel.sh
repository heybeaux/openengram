#!/usr/bin/env bash
set -euo pipefail

ENGRAM_DIR="$HOME/projects/agent-memory/engram"
DATE=$(date +%Y-%m-%d)
HOUR=$(date +%H)
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S %Z')
START_TIME=$(date +%s)
REPORT_DIR="$ENGRAM_DIR/reports/sentinel"
REPORT="$REPORT_DIR/${DATE}-${HOUR}.json"

mkdir -p "$REPORT_DIR"

ANY_DOWN=false

check_service() {
  local name="$1" url="$2" status="up" response="" error=""
  if response=$(curl -sf --max-time 10 "$url" 2>&1); then
    status="up"
  else
    status="down"
    error="$response"
    ANY_DOWN=true
  fi
  echo "{\"name\":\"$name\",\"url\":\"$url\",\"status\":\"$status\",\"error\":$(echo "$error" | jq -Rs .)}"
}

ENGRAM=$(check_service "engram-api" "http://localhost:3001/v1/health")
EMBED=$(check_service "embed-service" "http://127.0.0.1:8080/health")
CODESEARCH=$(check_service "code-search" "http://localhost:3002/v1/health")
DASHBOARD=$(check_service "dashboard" "http://localhost:3000")

END_TIME=$(date +%s)
RUNTIME=$((END_TIME - START_TIME))

cat > "$REPORT" <<EOF
{
  "timestamp": "$TIMESTAMP",
  "runtime_seconds": $RUNTIME,
  "all_healthy": $([ "$ANY_DOWN" = true ] && echo false || echo true),
  "services": [
    $ENGRAM,
    $EMBED,
    $CODESEARCH,
    $DASHBOARD
  ]
}
EOF

echo "Sentinel report written to $REPORT"

if [ "$ANY_DOWN" = true ]; then
  echo "⚠️  One or more services are DOWN"
  exit 1
fi

echo "✅ All services healthy"
