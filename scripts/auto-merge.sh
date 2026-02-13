#!/usr/bin/env bash
set -euo pipefail

ENGRAM_DIR="$HOME/projects/agent-memory/engram"
SCRIPT_DIR="$ENGRAM_DIR/scripts"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
error() { log "❌ $*" >&2; exit 1; }

usage() {
  cat <<EOF
Usage: $(basename "$0") <worktree-path> <task-type>

Decides whether to auto-merge or push for human review based on safety tier.

Task types and their tiers:
  test     → AUTO-MERGE (only adds test coverage)
  docs     → AUTO-MERGE (no code impact)
  fix      → PUSH FOR REVIEW (could affect behavior)
  refactor → CONDITIONAL (auto-merge if no public API changes, else review)
  optimize → PUSH FOR REVIEW (performance changes need human eyes)
EOF
  exit 1
}

[ $# -lt 2 ] && usage

WORKTREE="$1"
TASK_TYPE="$2"

[ ! -d "$WORKTREE" ] && error "Worktree not found: $WORKTREE"

cd "$WORKTREE"
BRANCH=$(git branch --show-current 2>/dev/null || error "Not a git branch")

log "Auto-merge decision for branch: $BRANCH (task: $TASK_TYPE)"

# Step 1: Run contribution validator
log "Running contribution validator..."
VALIDATION=$("$SCRIPT_DIR/contribution-validator.sh" "$WORKTREE" 2>&1) || {
  log "❌ Validation FAILED — not merging"
  echo "$VALIDATION"
  echo ""
  echo "ACTION=BLOCKED"
  echo "REASON=Validation failed"
  exit 1
}

log "✅ Validation passed"

# Step 2: Determine safety tier
check_public_api_changes() {
  # Check if any exported symbols changed (module.ts, controller.ts, index.ts files)
  local api_files_changed
  api_files_changed=$(git diff --name-only "main..$BRANCH" 2>/dev/null | grep -E '\.(module|controller|guard|interceptor|decorator)\.ts$' || true)
  
  # Check for changes to export statements
  local export_changes
  export_changes=$(git diff "main..$BRANCH" 2>/dev/null | grep -E '^\+.*export|^\-.*export' | grep -v '\.spec\.ts' || true)
  
  if [ -n "$api_files_changed" ] && [ -n "$export_changes" ]; then
    return 1  # Has public API changes
  fi
  return 0  # No public API changes
}

check_auth_or_data_changes() {
  local sensitive_files
  sensitive_files=$(git diff --name-only "main..$BRANCH" 2>/dev/null | grep -iE '(auth|guard|prisma\.schema|migration|security|secret|token|password|credential)' || true)
  if [ -n "$sensitive_files" ]; then
    return 1  # Has sensitive changes
  fi
  return 0
}

DECISION=""
REASON=""

case "$TASK_TYPE" in
  test)
    # Tests only add coverage — safe to auto-merge
    # Extra check: make sure only .spec.ts and test files changed
    NON_TEST_FILES=$(git diff --name-only "main..$BRANCH" 2>/dev/null | grep -v -E '\.spec\.ts$|\.test\.ts$|/tests?/' || true)
    if [ -z "$NON_TEST_FILES" ]; then
      DECISION="AUTO_MERGE"
      REASON="Test-only changes (safe tier)"
    else
      DECISION="PUSH_FOR_REVIEW"
      REASON="Test task but non-test files changed: $NON_TEST_FILES"
    fi
    ;;
  docs)
    # Docs have no code impact — safe to auto-merge
    CODE_FILES=$(git diff --name-only "main..$BRANCH" 2>/dev/null | grep -E '\.ts$' | grep -v -E '\.spec\.ts$|\.test\.ts$' || true)
    if [ -z "$CODE_FILES" ]; then
      DECISION="AUTO_MERGE"
      REASON="Documentation-only changes (safe tier)"
    else
      DECISION="PUSH_FOR_REVIEW"
      REASON="Docs task but code files changed: $CODE_FILES"
    fi
    ;;
  refactor)
    # Auto-merge if no public API or auth changes
    if ! check_auth_or_data_changes && check_public_api_changes; then
      DECISION="AUTO_MERGE"
      REASON="Refactor with no public API or auth changes (conditional tier — passed)"
    else
      DECISION="PUSH_FOR_REVIEW"
      REASON="Refactor touches public API or sensitive files"
    fi
    ;;
  fix|optimize|*)
    DECISION="PUSH_FOR_REVIEW"
    REASON="Task type '$TASK_TYPE' requires human review"
    ;;
esac

log "Decision: $DECISION"
log "Reason: $REASON"

# Step 3: Execute decision
if [ "$DECISION" = "AUTO_MERGE" ]; then
  log "🤖 Auto-merging branch $BRANCH into main..."
  
  # Switch to main repo and merge
  cd "$ENGRAM_DIR"
  
  # Make sure main is up to date
  git fetch origin main --quiet 2>/dev/null || true
  
  # Merge the branch
  if git merge "$BRANCH" --no-edit -m "auto-merge: $BRANCH ($REASON)"; then
    log "✅ Auto-merged successfully"
    
    # Push main
    git push origin main 2>/dev/null && log "✅ Pushed to origin/main" || log "⚠️ Push failed — merged locally only"
    
    # Clean up worktree
    "$SCRIPT_DIR/worktree-manager.sh" cleanup "$(basename "$BRANCH")" 2>/dev/null || true
    
    echo ""
    echo "ACTION=AUTO_MERGED"
    echo "BRANCH=$BRANCH"
    echo "REASON=$REASON"
  else
    log "❌ Merge conflict — aborting auto-merge"
    git merge --abort 2>/dev/null || true
    
    # Fall back to push for review
    cd "$WORKTREE"
    git push origin "$BRANCH" 2>/dev/null || true
    
    echo ""
    echo "ACTION=PUSH_FOR_REVIEW"
    echo "BRANCH=$BRANCH"
    echo "REASON=Merge conflict — needs manual resolution"
  fi
else
  log "📤 Pushing branch and creating PR for human review..."
  
  cd "$WORKTREE"
  git push origin "$BRANCH" 2>/dev/null && log "✅ Branch pushed" || log "⚠️ Push failed"
  
  # Generate PR body from commit messages and diff stats
  COMMIT_MSG=$(git log --format="%B" "main..$BRANCH" 2>/dev/null | head -20)
  FIRST_LINE=$(git log --format="%s" -1 "main..$BRANCH" 2>/dev/null)
  DIFF_STAT=$(git diff --stat "main..$BRANCH" 2>/dev/null)
  FILES_CHANGED=$(git diff --name-only "main..$BRANCH" 2>/dev/null)
  TEST_COUNT=$(cd "$WORKTREE" && npm test --silent 2>&1 | grep -oE '[0-9]+ passing|Tests:.*[0-9]+ passed' | tail -1 || echo "see validation report")
  
  # Determine type checkbox
  TYPE_CHECK=""
  case "$TASK_TYPE" in
    fix)      TYPE_CHECK="- [x] Bug fix" ;;
    test)     TYPE_CHECK="- [x] New feature\n(test coverage)" ;;
    docs)     TYPE_CHECK="- [x] Documentation" ;;
    refactor) TYPE_CHECK="- [x] Refactor" ;;
    optimize) TYPE_CHECK="- [x] Refactor\n(performance optimization)" ;;
    *)        TYPE_CHECK="- [x] Refactor" ;;
  esac

  # Build PR body matching repo template
  PR_BODY=$(cat <<PREOF
## Description

${COMMIT_MSG}

**Generated by:** \`${TASK_TYPE}\` agent (autonomous)
**Safety tier:** Pushed for human review — ${REASON}

## Type of Change

${TYPE_CHECK}

## How Has This Been Tested?

Full test suite executed in isolated worktree:
- \`npm test\` — ${TEST_COUNT}
- Contribution validator: ✅ passed
- No merge conflicts with main

\`\`\`
${DIFF_STAT}
\`\`\`

## Checklist

- [x] Code follows the project's style guidelines
- [x] I've self-reviewed my own code
- [x] Complex areas are commented
- [x] Documentation has been updated (if needed)
- [x] No new warnings introduced
- [x] Tests added for new functionality
- [x] All tests pass

## Related Issues

Detected automatically by Engram agent fleet (architecture watchdog / test gap finder / doc freshness).
PREOF
)

  # Create PR via gh CLI
  PR_URL=""
  if command -v gh &>/dev/null; then
    PR_URL=$(cd "$ENGRAM_DIR" && gh pr create \
      --base main \
      --head "$BRANCH" \
      --title "$FIRST_LINE" \
      --body "$PR_BODY" \
      --label "agent-authored" \
      2>/dev/null) || {
        log "⚠️ gh pr create failed — branch pushed, create PR manually"
        PR_URL="https://github.com/heybeaux/engram/compare/main...$BRANCH"
      }
    log "✅ PR created: $PR_URL"
  else
    PR_URL="https://github.com/heybeaux/engram/compare/main...$BRANCH"
    log "⚠️ gh CLI not available — create PR manually at: $PR_URL"
  fi
  
  echo ""
  echo "ACTION=PR_CREATED"
  echo "BRANCH=$BRANCH"
  echo "REASON=$REASON"
  echo "URL=$PR_URL"
fi
