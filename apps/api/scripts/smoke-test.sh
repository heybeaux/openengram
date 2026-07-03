#!/bin/bash
# Automated staging smoke test
set -euo pipefail

BASE_URL="${1:-https://staging-api.openengram.ai}"
PASS=0
FAIL=0

check() {
  local name="$1" path="$2" expected="${3:-200}"
  status=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL$path")
  if [ "$status" = "$expected" ]; then
    echo "✅ $name ($status)"
    PASS=$((PASS + 1))
  else
    echo "❌ $name — expected $expected, got $status"
    FAIL=$((FAIL + 1))
  fi
}

echo "Smoke testing $BASE_URL"
echo "========================"

check "Health"         "/v1/health"
check "Memories"       "/v1/memories"        200
check "Agents"         "/v1/agents"          200
check "Identities"     "/v1/identities"      200
check "Contracts"      "/v1/contracts"       200
check "Challenges"     "/v1/challenges"      200
check "Teams"          "/v1/teams"           200
check "Trust Profiles" "/v1/trust-profiles"  200
check "Sync Status"    "/v1/sync/status"     200

echo "========================"
echo "Passed: $PASS  Failed: $FAIL"

if [ "$FAIL" -gt 0 ]; then
  echo "⚠️  Some checks failed!"
  exit 1
fi

echo "✅ All checks passed"
