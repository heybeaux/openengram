#!/usr/bin/env bash
set -euo pipefail

blocked=(
  "AGENTS.md"
  "BOOTSTRAP.md"
  "HEARTBEAT.md"
  "IDENTITY.md"
  "MEMORY.md"
  "MEMORY_CONTEXT.md"
  "MEMORY_INSTRUCTIONS.md"
  "SOUL.md"
  "TOOLS.md"
  "USER.md"
  ".openclaw"
)

found=0
for path in "${blocked[@]}"; do
  if git ls-files --error-unmatch "$path" >/dev/null 2>&1; then
    echo "Blocked local workspace file is tracked: $path" >&2
    found=1
  fi
done

if [[ "$found" -ne 0 ]]; then
  echo "Remove OpenClaw/agent workspace files from the product repo." >&2
  exit 1
fi
