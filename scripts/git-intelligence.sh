#!/bin/bash
# Git Intelligence Pipeline — Full 30-day ingest
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/git-intelligence-core.sh"
run_pipeline "30 days ago" "Full (30 days)"
