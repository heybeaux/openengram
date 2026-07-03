#!/usr/bin/env bash
set -euo pipefail

ENGRAM_DIR="$HOME/projects/agent-memory/engram"
WORKTREE_DIR="$ENGRAM_DIR/worktrees"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S %Z')

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
error() { log "❌ $*" >&2; exit 1; }

usage() {
  cat <<EOF
Usage: $(basename "$0") <command> [args]

Commands:
  create <branch-name> [base-branch]  Create a worktree (default base: main)
  cleanup <branch-name> [--delete-branch]  Remove a worktree
  list                                 List active worktrees
  prune                                Clean up all merged worktrees
EOF
  exit 1
}

cmd_create() {
  local branch="${1:?Branch name required}"
  local base="${2:-main}"

  cd "$ENGRAM_DIR"

  # Check if branch already exists
  if git show-ref --verify --quiet "refs/heads/$branch" 2>/dev/null; then
    error "Branch '$branch' already exists"
  fi

  # Check if worktree already exists
  if [ -d "$WORKTREE_DIR/$branch" ]; then
    error "Worktree '$WORKTREE_DIR/$branch' already exists"
  fi

  # Fetch latest
  log "Fetching latest from origin..."
  git fetch origin "$base" --quiet 2>/dev/null || log "⚠️  Could not fetch origin/$base, using local"

  # Create worktree
  mkdir -p "$WORKTREE_DIR"
  log "Creating worktree: $WORKTREE_DIR/$branch (from $base)"
  git worktree add -b "$branch" "$WORKTREE_DIR/$branch" "origin/$base" 2>/dev/null \
    || git worktree add -b "$branch" "$WORKTREE_DIR/$branch" "$base"

  # Copy .env if it exists
  if [ -f "$ENGRAM_DIR/.env" ]; then
    cp "$ENGRAM_DIR/.env" "$WORKTREE_DIR/$branch/.env"
    log "Copied .env to worktree"
  fi

  # Install dependencies
  log "Installing dependencies..."
  cd "$WORKTREE_DIR/$branch"
  if ! npm ci --quiet 2>&1; then
    log "⚠️  npm ci failed, trying npm install..."
    npm install --quiet 2>&1 || error "npm install failed"
  fi

  # Generate Prisma client
  log "Generating Prisma client..."
  npx prisma generate 2>&1 || error "Prisma generate failed"

  log "✅ Worktree ready: $WORKTREE_DIR/$branch"
  echo "WORKTREE_PATH=$WORKTREE_DIR/$branch"
  echo "BRANCH=$branch"
}

cmd_cleanup() {
  local branch="${1:?Branch name required}"
  local delete_branch="${2:-}"

  cd "$ENGRAM_DIR"

  if [ ! -d "$WORKTREE_DIR/$branch" ]; then
    error "Worktree '$WORKTREE_DIR/$branch' does not exist"
  fi

  log "Removing worktree: $branch"
  git worktree remove "$WORKTREE_DIR/$branch" --force 2>/dev/null || {
    log "⚠️  Force removing directory..."
    rm -rf "$WORKTREE_DIR/$branch"
    git worktree prune
  }

  if [ "$delete_branch" = "--delete-branch" ]; then
    log "Deleting branch: $branch"
    git branch -D "$branch" 2>/dev/null || log "⚠️  Branch '$branch' not found or already deleted"
  fi

  log "✅ Worktree cleaned up: $branch"
}

cmd_list() {
  cd "$ENGRAM_DIR"
  echo "# Active Worktrees — $TIMESTAMP"
  echo ""
  git worktree list
  echo ""

  # Show agent worktrees specifically
  if [ -d "$WORKTREE_DIR" ] && [ "$(ls -A "$WORKTREE_DIR" 2>/dev/null)" ]; then
    echo "Agent worktrees in $WORKTREE_DIR:"
    for dir in "$WORKTREE_DIR"/*/; do
      [ -d "$dir" ] || continue
      local name=$(basename "$dir")
      local branch=$(cd "$dir" && git branch --show-current 2>/dev/null || echo "unknown")
      local commits=$(cd "$dir" && git log --oneline "main..$branch" 2>/dev/null | wc -l | tr -d ' ')
      echo "  - $name (branch: $branch, commits ahead: $commits)"
    done
  else
    echo "No agent worktrees."
  fi
}

cmd_prune() {
  cd "$ENGRAM_DIR"

  if [ ! -d "$WORKTREE_DIR" ] || [ -z "$(ls -A "$WORKTREE_DIR" 2>/dev/null)" ]; then
    log "No worktrees to prune."
    return
  fi

  local pruned=0
  for dir in "$WORKTREE_DIR"/*/; do
    [ -d "$dir" ] || continue
    local name=$(basename "$dir")
    local branch=$(cd "$dir" && git branch --show-current 2>/dev/null || echo "")

    if [ -z "$branch" ]; then
      log "Pruning orphaned worktree: $name"
      rm -rf "$dir"
      pruned=$((pruned + 1))
      continue
    fi

    # Check if branch is merged into main
    cd "$ENGRAM_DIR"
    if git branch --merged main 2>/dev/null | grep -q "$branch"; then
      log "Pruning merged worktree: $name (branch: $branch)"
      git worktree remove "$dir" --force 2>/dev/null || rm -rf "$dir"
      git branch -d "$branch" 2>/dev/null || true
      pruned=$((pruned + 1))
    fi
  done

  git worktree prune
  log "✅ Pruned $pruned worktree(s)"
}

# Main
[ $# -lt 1 ] && usage

case "$1" in
  create)   shift; cmd_create "$@" ;;
  cleanup)  shift; cmd_cleanup "$@" ;;
  list)     cmd_list ;;
  prune)    cmd_prune ;;
  *)        usage ;;
esac
