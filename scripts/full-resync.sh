#!/bin/bash
# Full resync script: get preview, then push local-only memories in batches
AUTH="Authorization: Bearer eng_5a7845e6035da07459793f39b2d19903278814e602b6ae16"
BASE="http://localhost:3001"

echo "Step 1: Getting reconciliation preview..."
PREVIEW=$(curl -s "$BASE/v1/cloud/reconcile/preview" -X POST -H "$AUTH" --max-time 180)

if echo "$PREVIEW" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('summary',{}).get('localOnlyCount','ERROR'))" 2>/dev/null | grep -q "ERROR"; then
    echo "Preview failed: $PREVIEW"
    exit 1
fi

echo "$PREVIEW" | python3 -c "import sys,json; d=json.load(sys.stdin); print(json.dumps(d['summary'], indent=2))"

# Extract local-only IDs
LOCAL_IDS=$(echo "$PREVIEW" | python3 -c "
import sys,json
d=json.load(sys.stdin)
ids = [m['localId'] for m in d.get('localOnly',[]) if m.get('localId')]
print('\n'.join(ids))
")

COUNT=$(echo "$LOCAL_IDS" | wc -l | tr -d ' ')
echo "Step 2: Found $COUNT local-only memories to push"

# Now trigger regular sync - it should pick up unsynced memories
# First, let's ensure cloudSyncedAt is null for local-only memories
echo "$LOCAL_IDS" | head -5
echo "..."

# Trigger sync which should push all memories with null cloudSyncedAt
echo "Step 3: Triggering sync..."
curl -s "$BASE/v1/cloud/sync" -X POST -H "$AUTH" -H "Content-Type: application/json" --max-time 600 | python3 -m json.tool

echo "Step 4: Checking counts..."
curl -s "$BASE/v1/health" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'Local: {d[\"dependencies\"][\"database\"][\"memoryCount\"]}')"
curl -s "https://api.openengram.ai/v1/health" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'Cloud: {d[\"dependencies\"][\"database\"][\"memoryCount\"]}')"
