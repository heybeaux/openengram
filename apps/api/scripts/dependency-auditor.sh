#!/usr/bin/env bash
set -euo pipefail

ENGRAM_DIR="$HOME/projects/agent-memory/engram"
DATE=$(date +%Y-%m-%d)
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S %Z')
START_TIME=$(date +%s)
REPORT_DIR="$ENGRAM_DIR/reports/dependency-audit"
REPORT="$REPORT_DIR/$DATE.md"

mkdir -p "$REPORT_DIR"
cd "$ENGRAM_DIR"

cat > "$REPORT" <<EOF
# Dependency Audit — $DATE

Generated: $TIMESTAMP

EOF

# --- npm audit ---
echo "## Security Audit" >> "$REPORT"
AUDIT_JSON=$(npm audit --json 2>/dev/null) || true

if [ -n "$AUDIT_JSON" ]; then
  CRITICAL=$(echo "$AUDIT_JSON" | jq '.metadata.vulnerabilities.critical // 0' 2>/dev/null || echo "?")
  HIGH=$(echo "$AUDIT_JSON" | jq '.metadata.vulnerabilities.high // 0' 2>/dev/null || echo "?")
  MODERATE=$(echo "$AUDIT_JSON" | jq '.metadata.vulnerabilities.moderate // 0' 2>/dev/null || echo "?")
  LOW=$(echo "$AUDIT_JSON" | jq '.metadata.vulnerabilities.low // 0' 2>/dev/null || echo "?")

  echo "| Severity | Count |" >> "$REPORT"
  echo "|----------|-------|" >> "$REPORT"
  echo "| Critical | $CRITICAL |" >> "$REPORT"
  echo "| High     | $HIGH |" >> "$REPORT"
  echo "| Moderate | $MODERATE |" >> "$REPORT"
  echo "| Low      | $LOW |" >> "$REPORT"
  echo "" >> "$REPORT"

  if [ "$CRITICAL" != "0" ] && [ "$CRITICAL" != "?" ] || [ "$HIGH" != "0" ] && [ "$HIGH" != "?" ]; then
    echo "⚠️ **Critical/High vulnerabilities detected!**" >> "$REPORT"
    echo "" >> "$REPORT"
    echo '```json' >> "$REPORT"
    echo "$AUDIT_JSON" | jq '.vulnerabilities | to_entries[] | select(.value.severity == "critical" or .value.severity == "high") | {name: .key, severity: .value.severity, via: .value.via, fixAvailable: .value.fixAvailable}' 2>/dev/null >> "$REPORT" || true
    echo '```' >> "$REPORT"
  fi
else
  echo "Could not run npm audit." >> "$REPORT"
fi
echo "" >> "$REPORT"

# --- npm outdated ---
echo "## Outdated Packages" >> "$REPORT"
OUTDATED_JSON=$(npm outdated --json 2>/dev/null) || true

if [ -n "$OUTDATED_JSON" ] && [ "$OUTDATED_JSON" != "{}" ]; then
  echo "" >> "$REPORT"
  echo "| Package | Current | Wanted | Latest |" >> "$REPORT"
  echo "|---------|---------|--------|--------|" >> "$REPORT"
  echo "$OUTDATED_JSON" | jq -r 'to_entries[] | "| \(.key) | \(.value.current // "-") | \(.value.wanted // "-") | \(.value.latest // "-") |"' 2>/dev/null >> "$REPORT" || echo "(parse error)" >> "$REPORT"
else
  echo "✅ All packages up to date." >> "$REPORT"
fi
echo "" >> "$REPORT"

# --- Compare to last week ---
echo "## Comparison to Last Week" >> "$REPORT"
LAST_WEEK=$(date -v-7d +%Y-%m-%d 2>/dev/null || date -d "7 days ago" +%Y-%m-%d 2>/dev/null || echo "")
PREV_REPORT="$REPORT_DIR/$LAST_WEEK.md"

if [ -n "$LAST_WEEK" ] && [ -f "$PREV_REPORT" ]; then
  PREV_CRITICAL=$(grep -oP 'Critical \| \K[0-9]+' "$PREV_REPORT" 2>/dev/null || echo "?")
  echo "- Last week critical: $PREV_CRITICAL → This week: $CRITICAL" >> "$REPORT"
  echo "- Last week report: $LAST_WEEK" >> "$REPORT"
else
  echo "No report from last week for comparison." >> "$REPORT"
fi
echo "" >> "$REPORT"

# --- Runtime ---
END_TIME=$(date +%s)
RUNTIME=$((END_TIME - START_TIME))
echo "---" >> "$REPORT"
echo "Runtime: ${RUNTIME}s" >> "$REPORT"

echo "Dependency audit report written to $REPORT"
