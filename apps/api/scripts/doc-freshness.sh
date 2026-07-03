#!/usr/bin/env bash
set -euo pipefail

ENGRAM_DIR="$HOME/projects/agent-memory/engram"
DATE=$(date +%Y-%m-%d)
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S %Z')
START_TIME=$(date +%s)
REPORT_DIR="$ENGRAM_DIR/reports/doc-freshness"
REPORT="$REPORT_DIR/$DATE.md"
SRC_DIR="$ENGRAM_DIR/src"

mkdir -p "$REPORT_DIR"
cd "$ENGRAM_DIR"

cat > "$REPORT" <<EOF
# Documentation Freshness — $DATE

Generated: $TIMESTAMP

EOF

# Get actual modules
ACTUAL_MODULES=()
for dir in "$SRC_DIR"/*/; do
  ACTUAL_MODULES+=("$(basename "$dir")")
done

echo "## Actual Modules (${#ACTUAL_MODULES[@]})" >> "$REPORT"
echo "" >> "$REPORT"

# --- Check README.md ---
echo "## README.md Coverage" >> "$REPORT"
echo "" >> "$REPORT"
MISSING_IN_README=0
if [ -f README.md ]; then
  for mod in "${ACTUAL_MODULES[@]}"; do
    if ! grep -qi "$mod" README.md 2>/dev/null; then
      echo "- ❌ \`$mod\` — not mentioned in README.md" >> "$REPORT"
      MISSING_IN_README=$((MISSING_IN_README + 1))
    fi
  done
  if [ "$MISSING_IN_README" -eq 0 ]; then
    echo "✅ All modules mentioned in README.md" >> "$REPORT"
  else
    echo "" >> "$REPORT"
    echo "**$MISSING_IN_README modules missing from README.md**" >> "$REPORT"
  fi
else
  echo "⚠️ README.md not found" >> "$REPORT"
fi
echo "" >> "$REPORT"

# --- Check ARCHITECTURE.md ---
echo "## ARCHITECTURE.md Coverage" >> "$REPORT"
echo "" >> "$REPORT"
MISSING_IN_ARCH=0
if [ -f ARCHITECTURE.md ]; then
  for mod in "${ACTUAL_MODULES[@]}"; do
    if ! grep -qi "$mod" ARCHITECTURE.md 2>/dev/null; then
      echo "- ❌ \`$mod\` — not mentioned in ARCHITECTURE.md" >> "$REPORT"
      MISSING_IN_ARCH=$((MISSING_IN_ARCH + 1))
    fi
  done
  if [ "$MISSING_IN_ARCH" -eq 0 ]; then
    echo "✅ All modules mentioned in ARCHITECTURE.md" >> "$REPORT"
  else
    echo "" >> "$REPORT"
    echo "**$MISSING_IN_ARCH modules missing from ARCHITECTURE.md**" >> "$REPORT"
  fi
else
  echo "⚠️ ARCHITECTURE.md not found" >> "$REPORT"
fi
echo "" >> "$REPORT"

# --- Doc file age vs code age ---
echo "## Doc Staleness" >> "$REPORT"
echo "" >> "$REPORT"
echo "| Doc File | Last Modified | Related Module Last Code Change | Stale? |" >> "$REPORT"
echo "|----------|---------------|--------------------------------|--------|" >> "$REPORT"

for doc in README.md ARCHITECTURE.md CLAUDE.md CHANGELOG.md docs/*.md; do
  [ -f "$doc" ] || continue
  DOC_AGE=$(git log -1 --format='%ai' -- "$doc" 2>/dev/null || echo "unknown")
  DOC_DATE=$(echo "$DOC_AGE" | cut -d' ' -f1)

  # Try to find related module from filename
  DOC_BASE=$(basename "$doc" .md | tr '[:upper:]' '[:lower:]')
  RELATED_DIR=""
  for mod in "${ACTUAL_MODULES[@]}"; do
    if echo "$DOC_BASE" | grep -qi "$mod"; then
      RELATED_DIR="src/$mod"
      break
    fi
  done

  if [ -n "$RELATED_DIR" ] && [ -d "$RELATED_DIR" ]; then
    CODE_AGE=$(git log -1 --format='%ai' -- "$RELATED_DIR" 2>/dev/null || echo "unknown")
    CODE_DATE=$(echo "$CODE_AGE" | cut -d' ' -f1)
    if [ "$DOC_DATE" != "unknown" ] && [ "$CODE_DATE" != "unknown" ] && [[ "$CODE_DATE" > "$DOC_DATE" ]]; then
      STALE="⚠️ Yes"
    else
      STALE="✅ No"
    fi
  else
    CODE_DATE="-"
    STALE="-"
  fi

  echo "| $doc | $DOC_DATE | $CODE_DATE | $STALE |" >> "$REPORT"
done
echo "" >> "$REPORT"

# --- Runtime ---
END_TIME=$(date +%s)
RUNTIME=$((END_TIME - START_TIME))
echo "---" >> "$REPORT"
echo "Runtime: ${RUNTIME}s" >> "$REPORT"

echo "Doc freshness report written to $REPORT"
