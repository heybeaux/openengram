#!/usr/bin/env bash
set -euo pipefail

ENGRAM_DIR="$HOME/projects/agent-memory/engram"
DATE=$(date +%Y-%m-%d)
REPORT_DIR="$ENGRAM_DIR/reports/tech-debt"
REPORT="$REPORT_DIR/$DATE.md"
SRC_DIR="$ENGRAM_DIR/src"

mkdir -p "$REPORT_DIR"

cat > "$REPORT" <<EOF
# Engram Tech Debt Scan — $DATE

Generated: $(date '+%Y-%m-%d %H:%M:%S %Z')

EOF

# --- 1. TODO/FIXME/HACK counts ---
echo "## Annotation Markers" >> "$REPORT"
echo "" >> "$REPORT"

TODO_COUNT=$(grep -rn 'TODO' "$SRC_DIR" --include='*.ts' 2>/dev/null | wc -l | tr -d ' ')
FIXME_COUNT=$(grep -rn 'FIXME' "$SRC_DIR" --include='*.ts' 2>/dev/null | wc -l | tr -d ' ')
HACK_COUNT=$(grep -rn 'HACK' "$SRC_DIR" --include='*.ts' 2>/dev/null | wc -l | tr -d ' ')

echo "| Marker | Count |" >> "$REPORT"
echo "|--------|-------|" >> "$REPORT"
echo "| TODO   | $TODO_COUNT |" >> "$REPORT"
echo "| FIXME  | $FIXME_COUNT |" >> "$REPORT"
echo "| HACK   | $HACK_COUNT |" >> "$REPORT"
echo "| **Total** | **$((TODO_COUNT + FIXME_COUNT + HACK_COUNT))** |" >> "$REPORT"
echo "" >> "$REPORT"

# Top files with markers
echo "### Top files with markers" >> "$REPORT"
echo '```' >> "$REPORT"
grep -rn 'TODO\|FIXME\|HACK' "$SRC_DIR" --include='*.ts' 2>/dev/null | cut -d: -f1 | sort | uniq -c | sort -rn | head -10 >> "$REPORT" || echo "(none)" >> "$REPORT"
echo '```' >> "$REPORT"
echo "" >> "$REPORT"

# --- 2. Large files (>500 lines) ---
echo "## Large Files (>500 lines)" >> "$REPORT"
echo '```' >> "$REPORT"
find "$SRC_DIR" -name '*.ts' -exec wc -l {} + 2>/dev/null | sort -rn | awk '$1 > 500 && !/total$/' | head -20 >> "$REPORT" || echo "(none)" >> "$REPORT"
echo '```' >> "$REPORT"
echo "" >> "$REPORT"

# --- 3. Missing test files ---
echo "## Missing Test Coverage" >> "$REPORT"
echo "" >> "$REPORT"
echo "Source files without corresponding .spec.ts:" >> "$REPORT"
echo '```' >> "$REPORT"

MISSING=0
while IFS= read -r src_file; do
  spec_file="${src_file%.ts}.spec.ts"
  if [ ! -f "$spec_file" ]; then
    rel=$(echo "$src_file" | sed "s|$ENGRAM_DIR/||")
    echo "  $rel" >> "$REPORT"
    MISSING=$((MISSING + 1))
  fi
done < <(find "$SRC_DIR" -name '*.ts' ! -name '*.spec.ts' ! -name '*.d.ts' ! -path '*/node_modules/*' 2>/dev/null)

if [ "$MISSING" -eq 0 ]; then
  echo "  (all files have tests)" >> "$REPORT"
fi
echo '```' >> "$REPORT"
echo "**$MISSING files missing tests**" >> "$REPORT"
echo "" >> "$REPORT"

# --- 4. Controllers/Services without tests ---
echo "## Controllers & Services Without Tests" >> "$REPORT"
echo '```' >> "$REPORT"
for pattern in controller service; do
  find "$SRC_DIR" -name "*.$pattern.ts" ! -name '*.spec.ts' 2>/dev/null | while read -r f; do
    spec="${f%.ts}.spec.ts"
    [ ! -f "$spec" ] && echo "  $(echo "$f" | sed "s|$ENGRAM_DIR/||")"
  done
done >> "$REPORT" || true
echo '```' >> "$REPORT"
echo "" >> "$REPORT"

# --- 5. console.log usage ---
echo "## console.log Statements (should use structured logging)" >> "$REPORT"
CL_COUNT=$(grep -rn 'console\.log' "$SRC_DIR" --include='*.ts' 2>/dev/null | grep -v '.spec.ts' | wc -l | tr -d ' ')
echo "" >> "$REPORT"
echo "**$CL_COUNT occurrences** in non-test source files" >> "$REPORT"
echo '```' >> "$REPORT"
grep -rn 'console\.log' "$SRC_DIR" --include='*.ts' 2>/dev/null | grep -v '.spec.ts' | sed "s|$ENGRAM_DIR/||" | head -20 >> "$REPORT" || true
echo '```' >> "$REPORT"

echo ""
echo "Tech debt report written to $REPORT"
