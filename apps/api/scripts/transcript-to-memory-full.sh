#!/bin/bash
set -euo pipefail
# Full backfill version - processes ALL transcripts
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$SCRIPT_DIR/transcript-to-memory.sh" --full
