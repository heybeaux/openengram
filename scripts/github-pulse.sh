#!/usr/bin/env bash
set -euo pipefail

ENGRAM_DIR="$HOME/projects/agent-memory/engram"
DATE=$(date +%Y-%m-%d)
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S %Z')
START_TIME=$(date +%s)
REPORT_DIR="$ENGRAM_DIR/reports/github-pulse"
REPORT="$REPORT_DIR/$DATE.md"
REPOS=("heybeaux/engram" "heybeaux/engram-dashboard" "accelintel/salesforce-microservice")

mkdir -p "$REPORT_DIR"

cat > "$REPORT" <<EOF
# GitHub Pulse — $DATE

Generated: $TIMESTAMP

EOF

if ! command -v gh &>/dev/null; then
  echo "❌ \`gh\` CLI not found. Install with \`brew install gh\`." >> "$REPORT"
  echo "gh CLI not found"
  exit 1
fi

for REPO in "${REPOS[@]}"; do
  echo "## $REPO" >> "$REPORT"
  echo "" >> "$REPORT"

  # Open PRs
  echo "### Open Pull Requests" >> "$REPORT"
  PRS=$(gh pr list -R "$REPO" --state open --limit 20 2>&1) || PRS="(error fetching PRs)"
  if [ -z "$PRS" ]; then
    echo "None" >> "$REPORT"
  else
    echo '```' >> "$REPORT"
    echo "$PRS" >> "$REPORT"
    echo '```' >> "$REPORT"
  fi
  echo "" >> "$REPORT"

  # CI Status
  echo "### CI Status (default branch)" >> "$REPORT"
  CI=$(gh run list -R "$REPO" --limit 5 2>&1) || CI="(error fetching CI runs)"
  echo '```' >> "$REPORT"
  echo "$CI" >> "$REPORT"
  echo '```' >> "$REPORT"
  echo "" >> "$REPORT"

  # Stale Branches (>7 days)
  echo "### Stale Branches (>7 days)" >> "$REPORT"
  STALE_CUTOFF=$(date -v-7d +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -d "7 days ago" --iso-8601=seconds 2>/dev/null || echo "")
  if [ -n "$STALE_CUTOFF" ]; then
    BRANCHES=$(gh api "repos/$REPO/branches" --paginate --jq '.[].name' 2>&1) || BRANCHES=""
    STALE_COUNT=0
    if [ -n "$BRANCHES" ]; then
      while IFS= read -r branch; do
        LAST_COMMIT=$(gh api "repos/$REPO/branches/$branch" --jq '.commit.commit.committer.date' 2>/dev/null || echo "")
        if [ -n "$LAST_COMMIT" ] && [[ "$LAST_COMMIT" < "$STALE_CUTOFF" ]]; then
          echo "- \`$branch\` — last commit: $LAST_COMMIT" >> "$REPORT"
          STALE_COUNT=$((STALE_COUNT + 1))
        fi
      done <<< "$BRANCHES"
    fi
    if [ "$STALE_COUNT" -eq 0 ]; then
      echo "None" >> "$REPORT"
    fi
  else
    echo "(could not compute cutoff date)" >> "$REPORT"
  fi
  echo "" >> "$REPORT"

  # Recent Issues
  echo "### Recent Issues" >> "$REPORT"
  ISSUES=$(gh issue list -R "$REPO" --state open --limit 10 2>&1) || ISSUES="(error fetching issues)"
  if [ -z "$ISSUES" ]; then
    echo "None" >> "$REPORT"
  else
    echo '```' >> "$REPORT"
    echo "$ISSUES" >> "$REPORT"
    echo '```' >> "$REPORT"
  fi
  echo "" >> "$REPORT"
done

# --- Runtime ---
END_TIME=$(date +%s)
RUNTIME=$((END_TIME - START_TIME))
echo "---" >> "$REPORT"
echo "Runtime: ${RUNTIME}s" >> "$REPORT"

echo "GitHub pulse report written to $REPORT"
