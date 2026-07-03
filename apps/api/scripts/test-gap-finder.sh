#!/usr/bin/env bash
set -euo pipefail

ENGRAM_DIR="$HOME/projects/agent-memory/engram"
DATE=$(date +%Y-%m-%d)
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S %Z')
START_TIME=$(date +%s)
REPORT_DIR="$ENGRAM_DIR/reports/test-gaps"
REPORT="$REPORT_DIR/$DATE.md"
SRC_DIR="$ENGRAM_DIR/src"

mkdir -p "$REPORT_DIR"

cat > "$REPORT" <<EOF
# Test Gap Finder — $DATE

Generated: $TIMESTAMP

EOF

# Collect all testable source files (exclude spec, dto, interface, module, mock)
TOTAL=0
COVERED=0
UNTESTED_FILES=()

while IFS= read -r src_file; do
  TOTAL=$((TOTAL + 1))
  spec_file="${src_file%.ts}.spec.ts"
  if [ -f "$spec_file" ]; then
    COVERED=$((COVERED + 1))
  else
    UNTESTED_FILES+=("$src_file")
  fi
done < <(find "$SRC_DIR" -name '*.ts' \
  ! -name '*.spec.ts' \
  ! -name '*.dto.ts' \
  ! -name '*.interface.ts' \
  ! -name '*.module.ts' \
  ! -name '*.mock.ts' \
  ! -name '*.d.ts' \
  ! -path '*/node_modules/*' 2>/dev/null | sort)

if [ "$TOTAL" -gt 0 ]; then
  PCT=$((COVERED * 100 / TOTAL))
else
  PCT=0
fi

echo "## Summary" >> "$REPORT"
echo "" >> "$REPORT"
echo "- **Total testable files**: $TOTAL" >> "$REPORT"
echo "- **With tests**: $COVERED" >> "$REPORT"
echo "- **Missing tests**: ${#UNTESTED_FILES[@]}" >> "$REPORT"
echo "- **Coverage**: ${PCT}%" >> "$REPORT"
echo "" >> "$REPORT"

# --- Per-module coverage ---
echo "## Coverage by Module" >> "$REPORT"
echo "" >> "$REPORT"
echo "| Module | Testable | Covered | % |" >> "$REPORT"
echo "|--------|----------|---------|---|" >> "$REPORT"

for dir in "$SRC_DIR"/*/; do
  mod=$(basename "$dir")
  mod_total=$(find "$dir" -name '*.ts' ! -name '*.spec.ts' ! -name '*.dto.ts' ! -name '*.interface.ts' ! -name '*.module.ts' ! -name '*.mock.ts' ! -name '*.d.ts' 2>/dev/null | wc -l | tr -d ' ')
  mod_covered=0
  while IFS= read -r f; do
    [ -f "${f%.ts}.spec.ts" ] && mod_covered=$((mod_covered + 1))
  done < <(find "$dir" -name '*.ts' ! -name '*.spec.ts' ! -name '*.dto.ts' ! -name '*.interface.ts' ! -name '*.module.ts' ! -name '*.mock.ts' ! -name '*.d.ts' 2>/dev/null)
  if [ "$mod_total" -gt 0 ]; then
    mod_pct=$((mod_covered * 100 / mod_total))
  else
    mod_pct="-"
  fi
  echo "| $mod | $mod_total | $mod_covered | ${mod_pct}% |" >> "$REPORT"
done
echo "" >> "$REPORT"

# --- Top 10 untested by line count ---
echo "## Top 10 Untested Files (by line count)" >> "$REPORT"
echo '```' >> "$REPORT"
if [ ${#UNTESTED_FILES[@]} -gt 0 ]; then
  for f in "${UNTESTED_FILES[@]}"; do
    wc -l "$f"
  done | sort -rn | head -10 | sed "s|$ENGRAM_DIR/||" >> "$REPORT"
else
  echo "✅ All testable files have tests!" >> "$REPORT"
fi
echo '```' >> "$REPORT"
echo "" >> "$REPORT"

# --- Runtime ---
END_TIME=$(date +%s)
RUNTIME=$((END_TIME - START_TIME))
echo "---" >> "$REPORT"
echo "Runtime: ${RUNTIME}s" >> "$REPORT"

echo "Test gap report written to $REPORT"
