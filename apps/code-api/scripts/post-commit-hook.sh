#!/usr/bin/env bash
# EC-49: post-commit hook → engram-code webhook.
#
# Install:  ec-hook install [--endpoint URL] [--secret HMAC]
# Or copy into <repo>/.git/hooks/post-commit manually.
#
# Behavior: POSTs a minimal `push`-shaped payload to
# `${ENGRAM_CODE_WEBHOOK}` with `X-GitHub-Event: local-commit` so the
# webhook controller distinguishes hook calls from real GitHub pushes
# in the ledger. When `ENGRAM_CODE_WEBHOOK_SECRET` is set, the script
# HMAC-signs the body so the server's signature check passes.
#
# Designed to fail open: any error (no curl, network down, bad config)
# logs to stderr and exits 0 so a broken hook never blocks `git commit`.

set -u

ENDPOINT="${ENGRAM_CODE_WEBHOOK:-http://localhost:3002/v1/ingest/webhook/github}"
SECRET="${ENGRAM_CODE_WEBHOOK_SECRET:-}"

if ! command -v curl >/dev/null 2>&1; then
  echo "engram-code post-commit: curl not found; skipping" >&2
  exit 0
fi

SHA="$(git rev-parse HEAD 2>/dev/null || echo "")"
REF="$(git symbolic-ref --quiet HEAD 2>/dev/null || echo "")"
REMOTE_URL="$(git config --get remote.origin.url 2>/dev/null || echo "")"
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

if [ -z "$REMOTE_URL" ]; then
  # No remote (fresh repo, detached, etc.) — fall back to a synthetic
  # `file://` URL keyed on the repo path so the server can still
  # uniquely identify the source.
  REMOTE_URL="file://${REPO_ROOT}"
fi

PAYLOAD=$(cat <<EOF
{"ref":"${REF}","after":"${SHA}","repository":{"clone_url":"${REMOTE_URL}"},"head_commit":{"id":"${SHA}"}}
EOF
)

SIG_HEADER=()
if [ -n "$SECRET" ]; then
  if command -v openssl >/dev/null 2>&1; then
    SIG=$(printf '%s' "$PAYLOAD" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $NF}')
    SIG_HEADER=(-H "X-Hub-Signature-256: sha256=${SIG}")
  else
    echo "engram-code post-commit: openssl missing; sending unsigned" >&2
  fi
fi

# `--fail` so a 4xx/5xx surfaces as a non-zero curl exit (which we
# capture and log, but still exit 0 to keep git happy).
RESP=$(curl --silent --show-error --max-time 5 --fail \
  -X POST "$ENDPOINT" \
  -H "Content-Type: application/json" \
  -H "X-GitHub-Event: local-commit" \
  -H "X-GitHub-Delivery: $(date -u +%Y%m%dT%H%M%SZ)-${SHA:0:7}" \
  ${SIG_HEADER[@]+"${SIG_HEADER[@]}"} \
  --data "$PAYLOAD" 2>&1) || {
    echo "engram-code post-commit: webhook call failed: $RESP" >&2
    exit 0
  }

# Quiet success — operators see output only when something goes wrong.
exit 0
