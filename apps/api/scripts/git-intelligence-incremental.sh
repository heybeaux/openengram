#!/bin/bash
# Git Intelligence Pipeline — Incremental (last 24 hours)
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/git-intelligence-core.sh"
run_pipeline "24 hours ago" "Incremental (24h)"
