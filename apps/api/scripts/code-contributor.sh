#!/usr/bin/env bash
set -euo pipefail

ENGRAM_DIR="$HOME/projects/agent-memory/engram"
SCRIPT_DIR="$ENGRAM_DIR/scripts"
TIMESTAMP=$(date '+%Y%m%d-%H%M%S')
DATE_HUMAN=$(date '+%Y-%m-%d %H:%M:%S %Z')

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
error() { log "❌ $*" >&2; exit 1; }

usage() {
  cat <<EOF
Usage: $(basename "$0") <task-type> <task-description> [additional-context]

task-type: refactor | test | docs | fix | optimize

Sets up an isolated worktree for autonomous code contributions.
The calling agent makes the actual code changes.
EOF
  exit 1
}

[ $# -lt 2 ] && usage

TASK_TYPE="$1"
TASK_DESC="$2"
TASK_CONTEXT="${3:-}"

# Validate task type
case "$TASK_TYPE" in
  refactor|test|docs|fix|optimize) ;;
  *) error "Invalid task type: $TASK_TYPE. Must be: refactor | test | docs | fix | optimize" ;;
esac

# Generate branch name
BRANCH="agent/${TASK_TYPE}-${TIMESTAMP}"

log "Setting up code contribution environment..."
log "Task: $TASK_TYPE — $TASK_DESC"
log "Branch: $BRANCH"

# Create worktree
log "Creating worktree..."
OUTPUT=$("$SCRIPT_DIR/worktree-manager.sh" create "$BRANCH")
WORKTREE_PATH=$(echo "$OUTPUT" | grep "^WORKTREE_PATH=" | cut -d= -f2)

if [ -z "$WORKTREE_PATH" ] || [ ! -d "$WORKTREE_PATH" ]; then
  error "Failed to create worktree"
fi

# Write TASK.md
cat > "$WORKTREE_PATH/TASK.md" <<EOF
# Agent Task: ${TASK_TYPE^}

**Created:** $DATE_HUMAN
**Branch:** $BRANCH
**Type:** $TASK_TYPE

## Description
$TASK_DESC

## Additional Context
${TASK_CONTEXT:-None provided.}

## Checklist
- [ ] Changes implemented
- [ ] Tests pass (\`npm test\`)
- [ ] No lint errors (\`npm run lint\`)
- [ ] Committed with conventional commit message
- [ ] Validated with \`scripts/contribution-validator.sh\`
EOF

log "TASK.md written to worktree"

# Run baseline tests
log "Running baseline tests..."
cd "$WORKTREE_PATH"
if npm test --silent 2>&1 | tail -5; then
  log "✅ Baseline tests pass"
else
  log "⚠️  Some baseline tests failing — check before contributing"
fi

# Output for calling agent
echo ""
echo "========================================="
echo "WORKTREE_PATH=$WORKTREE_PATH"
echo "BRANCH=$BRANCH"
echo "TASK_TYPE=$TASK_TYPE"
echo "========================================="
echo ""
log "✅ Environment ready. Make changes in: $WORKTREE_PATH"
log "When done, validate with: $SCRIPT_DIR/contribution-validator.sh $WORKTREE_PATH"
