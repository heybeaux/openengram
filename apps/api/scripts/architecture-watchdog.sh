#!/usr/bin/env bash
set -euo pipefail

ENGRAM_DIR="$HOME/projects/agent-memory/engram"
DATE=$(date +%Y-%m-%d)
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S %Z')
START_TIME=$(date +%s)
REPORT_DIR="$ENGRAM_DIR/reports/architecture"
REPORT="$REPORT_DIR/$DATE.md"
SRC_DIR="$ENGRAM_DIR/src"

mkdir -p "$REPORT_DIR"
cd "$ENGRAM_DIR"

cat > "$REPORT" <<EOF
# Architecture Watchdog — $DATE

Generated: $TIMESTAMP

EOF

# --- 1. Circular Dependencies ---
echo "## Circular Dependencies" >> "$REPORT"
echo '```' >> "$REPORT"
CIRCULAR=$(npx madge --circular --extensions ts src/ 2>&1) || true
if echo "$CIRCULAR" | grep -q "No circular"; then
  echo "✅ No circular dependencies found" >> "$REPORT"
else
  echo "$CIRCULAR" >> "$REPORT"
fi
echo '```' >> "$REPORT"
echo "" >> "$REPORT"

# --- 2. Large Files (>300 lines) ---
echo "## Files Over 300 Lines" >> "$REPORT"
echo '```' >> "$REPORT"
LARGE=$(find src -name '*.ts' ! -name '*.spec.ts' -exec wc -l {} + 2>/dev/null | sort -rn | awk '$1 > 300 && !/total$/' | sed "s|$ENGRAM_DIR/||" || true)
if [ -n "$LARGE" ]; then
  echo "$LARGE" >> "$REPORT"
else
  echo "✅ No files over 300 lines" >> "$REPORT"
fi
echo '```' >> "$REPORT"
echo "" >> "$REPORT"

# --- 3. Module Count & Size ---
echo "## Module Overview" >> "$REPORT"
echo "" >> "$REPORT"
MODULE_COUNT=$(find src -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')
echo "**$MODULE_COUNT modules** in src/" >> "$REPORT"
echo "" >> "$REPORT"
echo '```' >> "$REPORT"
for dir in src/*/; do
  mod=$(basename "$dir")
  files=$(find "$dir" -name '*.ts' 2>/dev/null | wc -l | tr -d ' ')
  lines=$(find "$dir" -name '*.ts' -exec cat {} + 2>/dev/null | wc -l | tr -d ' ')
  printf "%-25s %3s files  %6s lines\n" "$mod" "$files" "$lines" >> "$REPORT"
done
echo '```' >> "$REPORT"
echo "" >> "$REPORT"

# --- 4. Modules Without Tests ---
echo "## Modules Without Test Files" >> "$REPORT"
echo '```' >> "$REPORT"
MISSING_TESTS=0
for dir in src/*/; do
  mod=$(basename "$dir")
  spec_count=$(find "$dir" -name '*.spec.ts' 2>/dev/null | wc -l | tr -d ' ')
  if [ "$spec_count" -eq 0 ]; then
    echo "  ❌ $mod — no .spec.ts files" >> "$REPORT"
    MISSING_TESTS=$((MISSING_TESTS + 1))
  fi
done
if [ "$MISSING_TESTS" -eq 0 ]; then
  echo "  ✅ All modules have test files" >> "$REPORT"
fi
echo '```' >> "$REPORT"
echo "" >> "$REPORT"

# --- 5. Cross-Module Imports ---
echo "## Cross-Module Boundary Imports" >> "$REPORT"
echo "" >> "$REPORT"
echo "Files importing from \`../other-module/\` instead of through module exports:" >> "$REPORT"
echo '```' >> "$REPORT"
CROSS=$(grep -rn "from '\.\./[^']*/" src/ --include='*.ts' 2>/dev/null | grep -v node_modules | grep -v '.spec.ts' | sed "s|$ENGRAM_DIR/||" | head -30 || true)
if [ -n "$CROSS" ]; then
  echo "$CROSS" >> "$REPORT"
else
  echo "✅ No cross-module boundary violations found" >> "$REPORT"
fi
echo '```' >> "$REPORT"
echo "" >> "$REPORT"

# --- Runtime ---
END_TIME=$(date +%s)
RUNTIME=$((END_TIME - START_TIME))
echo "---" >> "$REPORT"
echo "Runtime: ${RUNTIME}s" >> "$REPORT"

echo "Architecture watchdog report written to $REPORT"
