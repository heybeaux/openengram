# Task: Update Documentation

## Trigger
Doc Freshness agent detects stale docs

## Input
- Which docs are stale
- What modules are undocumented

## Instructions
1. Query engram-code for module exports and API surface:
   `POST http://localhost:3002/v1/search {"query": "module exports public API", "projectId": "af22c027-7495-46d7-9c4d-d0d89e07a1bb", "limit": 10}`
2. Read existing docs to understand style/format
3. Update ARCHITECTURE.md with new/changed modules
4. Update README.md if features are missing
5. Update CLAUDE.md if new patterns/conventions exist

## Constraints
- Match existing doc style
- Keep ARCHITECTURE.md factual, not aspirational
- Don't remove existing content unless it's wrong
- Keep CLAUDE.md under ~100 lines (table of contents, not encyclopedia)
