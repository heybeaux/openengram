#!/usr/bin/env bash
set -euo pipefail

ENGRAM_DIR="$HOME/projects/agent-memory/engram"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S %Z')

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
error() { log "❌ $*" >&2; }

usage() {
  echo "Usage: $(basename "$0") <worktree-path>"
  echo "Validates agent contributions before merge."
  exit 1
}

[ $# -lt 1 ] && usage

WORKTREE="$1"
[ ! -d "$WORKTREE" ] && { error "Worktree not found: $WORKTREE"; exit 1; }

cd "$WORKTREE"
BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
FAILURES=0
WARNINGS=0

echo "# Contribution Validation Report"
echo "**Date:** $TIMESTAMP"
echo "**Worktree:** $WORKTREE"
echo "**Branch:** $BRANCH"
echo ""

# 1. Tests
echo "## 1. Tests"
if npm test --silent 2>&1 | tail -3; then
  echo "✅ Tests pass"
else
  echo "❌ Tests FAILED"
  FAILURES=$((FAILURES + 1))
fi
echo ""

# 2. Lint
echo "## 2. Lint"
if npm run lint --silent 2>&1; then
  echo "✅ No lint errors"
else
  echo "❌ Lint errors found"
  FAILURES=$((FAILURES + 1))
fi
echo ""

# 3. Build
echo "## 3. Build"
if npm run build --silent 2>&1; then
  echo "✅ Build succeeds"
else
  echo "❌ Build FAILED"
  FAILURES=$((FAILURES + 1))
fi
echo ""

# 4. Untracked files
echo "## 4. Untracked Files"
UNTRACKED=$(git ls-files --others --exclude-standard)
if [ -z "$UNTRACKED" ]; then
  echo "✅ No untracked files"
else
  echo "⚠️  Untracked files:"
  echo "$UNTRACKED" | sed 's/^/  - /'
  WARNINGS=$((WARNINGS + 1))
fi
echo ""

# 5. Commit message format
echo "## 5. Commit Messages"
COMMITS=$(git log --oneline "main..$BRANCH" 2>/dev/null || echo "")
if [ -z "$COMMITS" ]; then
  echo "⚠️  No commits on this branch yet"
  WARNINGS=$((WARNINGS + 1))
else
  CONVENTIONAL_RE='^[a-f0-9]+ (feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\(.+\))?: .+'
  BAD_COMMITS=0
  while IFS= read -r line; do
    if ! echo "$line" | grep -qE "$CONVENTIONAL_RE"; then
      echo "❌ Non-conventional: $line"
      BAD_COMMITS=$((BAD_COMMITS + 1))
    fi
  done <<< "$COMMITS"
  if [ "$BAD_COMMITS" -eq 0 ]; then
    echo "✅ All commits follow conventional format"
  else
    FAILURES=$((FAILURES + 1))
  fi
fi
echo ""

# 6. Up to date with main
echo "## 6. Branch Status"
cd "$ENGRAM_DIR"
git fetch origin main --quiet 2>/dev/null || true
cd "$WORKTREE"
if git merge-base --is-ancestor origin/main HEAD 2>/dev/null; then
  echo "✅ Up to date with main"
else
  BEHIND=$(git rev-list --count HEAD..origin/main 2>/dev/null || echo "?")
  echo "⚠️  Behind main by $BEHIND commit(s) — rebase recommended"
  WARNINGS=$((WARNINGS + 1))
fi
echo ""

# 7. Diff stats
echo "## 7. Diff Stats"
DIFF_STAT=$(git diff --stat "main..$BRANCH" 2>/dev/null || echo "No diff available")
echo '```'
echo "$DIFF_STAT"
echo '```'
echo ""

# Summary
echo "## Summary"
echo "- **Failures:** $FAILURES"
echo "- **Warnings:** $WARNINGS"
echo ""

if [ "$FAILURES" -eq 0 ]; then
  echo "✅ **READY TO MERGE**"
  exit 0
else
  echo "❌ **NEEDS FIXES** ($FAILURES failure(s))"
  exit 1
fi
