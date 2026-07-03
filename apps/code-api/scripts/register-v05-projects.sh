#!/bin/bash
# Register v0.5 projects in engram-code
# Run this when the engram-code server is running (default: http://localhost:3210)

BASE_URL="${ENGRAM_CODE_URL:-http://localhost:3210}"

echo "Registering projects at $BASE_URL..."

# Engram (core agent memory)
curl -s -X POST "$BASE_URL/projects" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Engram",
    "rootPath": "/Users/clawdbot/projects/agent-memory/engram/src",
    "languages": ["typescript"]
  }' | jq .

echo ""

# Engram Dashboard
curl -s -X POST "$BASE_URL/projects" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Engram Dashboard",
    "rootPath": "/Users/clawdbot/projects/agent-memory/engram-dashboard/src",
    "languages": ["typescript"]
  }' | jq .

echo ""

# OpenClaw
curl -s -X POST "$BASE_URL/projects" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "OpenClaw",
    "rootPath": "/Users/clawdbot/projects/openclaw-fork/src",
    "languages": ["typescript"]
  }' | jq .

echo ""
echo "Done. Run 'curl $BASE_URL/projects' to verify."
