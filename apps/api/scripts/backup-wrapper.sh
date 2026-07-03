#!/bin/bash
# Wrapper for LaunchAgent — ensures logging works and script never hangs
export PATH="/Applications/Postgres.app/Contents/Versions/latest/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export HOME="/Users/clawdbot"
export GIT_TERMINAL_PROMPT=0

LOG="/Users/clawdbot/clawd/logs/engram-backup.log"
echo "=== Backup run started: $(date) ===" >> "$LOG"
/bin/bash /Users/clawdbot/projects/agent-memory/engram/scripts/backup-verified.sh >> "$LOG" 2>&1
EXIT_CODE=$?
echo "=== Backup run finished: $(date), exit: $EXIT_CODE ===" >> "$LOG"
exit $EXIT_CODE
