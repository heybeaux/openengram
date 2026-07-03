#!/bin/bash
API_KEY="eng_9d3397a876f0aae9895a44fde10559bcfeb70b44fd323ed0"
API_URL="https://api.openengram.ai"
USER_ID="pax-channel-test"

recall() {
  local label="$1"
  local query="$2"
  local tags="$3"
  
  echo "### $label"
  echo "Query: \"$query\""
  echo "Tags: $tags"
  echo ""
  
  curl -s -X POST "$API_URL/v1/recall" \
    -H "Content-Type: application/json" \
    -H "X-AM-API-Key: $API_KEY" \
    -H "X-AM-User-ID: $USER_ID" \
    -d "{
      \"query\": \"$query\",
      \"filter\": { \"tags\": $tags },
      \"limit\": 5
    }" | python3 -c "
import json,sys
d=json.load(sys.stdin)
mems = d.get('memories',[])
print(f'Results: {len(mems)}')
for i,m in enumerate(mems):
  raw = m.get('raw') or m.get('content','')
  print(f'  [{i+1}] {raw[:150]}')
print()
"
}

echo "# Engram Channel Intelligence — Phase 1 Test Report"
echo "# Date: $(date '+%Y-%m-%d %H:%M %Z')"
echo "# Account: pax+channel-test@heybeaux.dev (SCALE)"
echo "# Dataset: MAP International Google Ads (Feb 7 - Mar 6, 2026)"
echo "# Memories ingested: 299"
echo ""
echo "---"
echo ""

# Spec success criteria queries
echo "## 1. Spec Success Criteria"
echo ""

recall "Q1: Best performing campaign" \
  "What is MAP International's best performing campaign highest conversion rate" \
  '["client:map-international", "channel:google-ads"]'

recall "Q2: Which device converts best" \
  "which device converts best for MAP International" \
  '["client:map-international", "record-type:device"]'

recall "Q3: Audience demographics" \
  "What audience demographics respond best to MAP International ads" \
  '["client:map-international"]'

recall "Q4: Best time of day" \
  "What time of day should MAP International schedule campaigns" \
  '["client:map-international", "record-type:hourly"]'

recall "Q5: Competitor analysis" \
  "How is MAP International performing vs competitors impression share" \
  '["client:map-international", "record-type:competitor"]'

recall "Q6: Campaign pause" \
  "When did MAP International campaigns go dark and why" \
  '["client:map-international", "channel:google-ads"]'

recall "Q7: Brand vs General comparison" \
  "Compare Brand vs General campaign performance conversion rate" \
  '["client:map-international", "record-type:ad-group"]'

recall "Q8: Day of week performance" \
  "Which day of the week gets the most impressions" \
  '["client:map-international", "record-type:dow"]'

echo "## 2. Tag Isolation Tests"
echo ""

recall "Isolation: client only" \
  "campaign performance" \
  '["client:map-international"]'

recall "Isolation: client + channel" \
  "campaign performance" \
  '["client:map-international", "channel:google-ads"]'

recall "Isolation: client + record-type" \
  "campaign performance" \
  '["client:map-international", "record-type:campaign"]'

recall "Isolation: search keywords" \
  "top keywords by cost" \
  '["client:map-international", "record-type:keyword"]'

recall "Isolation: networks" \
  "which network gets the most clicks" \
  '["client:map-international", "record-type:network"]'

recall "Isolation: period comparison" \
  "biggest changes in spend between periods" \
  '["client:map-international", "record-type:period-comparison"]'

recall "Isolation: search queries" \
  "most popular search terms" \
  '["client:map-international", "record-type:search-query"]'

recall "Isolation: time series" \
  "daily performance trend" \
  '["client:map-international", "record-type:time-series"]'

recall "Isolation: demographics gender" \
  "male vs female audience" \
  '["client:map-international", "record-type:audience-gender"]'

recall "Isolation: demographics age" \
  "which age group has the most impressions" \
  '["client:map-international", "record-type:audience-age"]'

