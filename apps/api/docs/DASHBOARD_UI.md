# Engram Dashboard — UI Specification

**Status:** Draft  
**Created:** Saturday, February 1st, 2026  
**Author:** Rook ♜

---

## Overview

The Engram Dashboard is a web UI for developers to:
- Monitor memory usage and health
- Debug extraction quality
- Browse and search memories
- Manage API keys
- View analytics

---

## Navigation Structure

```
┌─────────────────────────────────────────────────────────┐
│  🧠 Engram          [Search...]         [Docs] [Account]│
├─────────────────────────────────────────────────────────┤
│                                                         │
│  📊 Overview                                            │
│  🧠 Memories                                            │
│  👥 Users                                               │
│  🔑 API Keys                                            │
│  ⚙️ Settings                                            │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## 1. Overview Dashboard

The landing page after login. Quick health check and key metrics.

```
┌─────────────────────────────────────────────────────────────────┐
│  Overview                                           Last 7 days │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │   12,847     │  │     342      │  │    98.2%     │          │
│  │  Memories    │  │    Users     │  │   Healthy    │          │
│  │  +1,234 ↑    │  │   +28 ↑      │  │              │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  API Requests (7 days)                                  │   │
│  │  ████████████████████████████████░░░░░░░░░░░░░░░░░░░░░ │   │
│  │  Mon   Tue   Wed   Thu   Fri   Sat   Sun               │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────┐  ┌─────────────────────────┐  │
│  │  Memory by Layer            │  │  Recent Activity        │  │
│  │  ██████████ Identity  18%   │  │  • User created memory  │  │
│  │  ████████████████ Proj 32%  │  │  • Query: "preferences" │  │
│  │  ██████████████████ Sess 45%│  │  • Consolidation ran    │  │
│  │  ███ Task 5%                │  │  • User deleted memory  │  │
│  └─────────────────────────────┘  └─────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Key Metrics:**
- Total memories (with trend)
- Active users (with trend)
- Health score (extraction success rate, query latency)
- API request volume chart
- Memory distribution by layer
- Recent activity feed

---

## 2. Memories Browser

Search, filter, and inspect individual memories.

```
┌─────────────────────────────────────────────────────────────────┐
│  Memories                                        [+ Create Test]│
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  [🔍 Search memories semantically...]                          │
│                                                                 │
│  Filters: [All Users ▼] [All Layers ▼] [Last 30 days ▼]        │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ ● "Beaux prefers tabs over spaces"                      │   │
│  │   User: beaux | Layer: IDENTITY | Score: 0.82      │   │
│  │   Created: 2 hours ago | Retrieved: 5 times             │   │
│  │   [View] [Delete]                                       │   │
│  ├─────────────────────────────────────────────────────────┤   │
│  │ ● "Never deploy on Fridays - learned the hard way"      │   │
│  │   User: beaux | Layer: IDENTITY | Score: 1.0       │   │
│  │   Created: 2 hours ago | Retrieved: 3 times             │   │
│  │   [View] [Delete]                                       │   │
│  ├─────────────────────────────────────────────────────────┤   │
│  │ ● "Working on Engram memory infrastructure project"     │   │
│  │   User: beaux | Layer: PROJECT | Score: 0.65       │   │
│  │   Created: 1 hour ago | Retrieved: 0 times              │   │
│  │   [View] [Delete]                                       │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Showing 1-25 of 12,847          [← Prev] [1] [2] [3] [Next →] │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Features:**
- Semantic search (not just keyword)
- Filter by user, layer, date range
- Sort by importance, date, retrieval count
- Quick actions: view details, delete
- Bulk operations

---

## 3. Memory Detail View

Inspect a single memory with full extraction data.

```
┌─────────────────────────────────────────────────────────────────┐
│  ← Back to Memories                                    [Delete] │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  "Beaux prefers tabs over spaces"                               │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  METADATA                                               │   │
│  │  ─────────────────────────────────────────────────────  │   │
│  │  ID:          mem_abc123xyz                             │   │
│  │  User:        beaux                                │   │
│  │  Layer:       IDENTITY                                  │   │
│  │  Importance:  ████████░░ 0.82                           │   │
│  │  Confidence:  ██████████ 1.0                            │   │
│  │  Created:     Feb 1, 2026 7:12 AM                       │   │
│  │  Retrieved:   5 times (last: 10 min ago)                │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  5W1H EXTRACTION                                        │   │
│  │  ─────────────────────────────────────────────────────  │   │
│  │  WHO:    Beaux                                          │   │
│  │  WHAT:   Prefers tabs over spaces                       │   │
│  │  WHEN:   —                                              │   │
│  │  WHERE:  Coding environment                             │   │
│  │  WHY:    Personal preference                            │   │
│  │  HOW:    —                                              │   │
│  │                                                         │   │
│  │  Topics:   [coding] [preferences]                       │   │
│  │  Entities: [Beaux]                                      │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  MEMORY CHAIN                                           │   │
│  │  ─────────────────────────────────────────────────────  │   │
│  │  No linked memories                                     │   │
│  │                                                         │   │
│  │  [+ Link Memory]                                        │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  EMBEDDING VECTOR (1536 dims)                           │   │
│  │  ─────────────────────────────────────────────────────  │   │
│  │  [0.023, -0.041, 0.087, -0.012, ...]    [Copy] [Visual] │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Features:**
- Full metadata display
- 5W1H extraction visualization
- Memory chain visualization (reasoning traces)
- Raw embedding (with copy/visualize options)
- Edit/delete capabilities

---

## 4. Users List

View all users and their memory stats.

```
┌─────────────────────────────────────────────────────────────────┐
│  Users                                                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  [🔍 Search users...]                                          │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │  User ID       │ Memories │ Last Active │ Actions         │ │
│  ├───────────────────────────────────────────────────────────┤ │
│  │  beaux    │   847    │ 2 min ago   │ [View] [Export] │ │
│  │  user_alex     │   234    │ 1 hour ago  │ [View] [Export] │ │
│  │  user_sam      │   156    │ Yesterday   │ [View] [Export] │ │
│  │  user_jordan   │    42    │ 3 days ago  │ [View] [Export] │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Features:**
- User search
- Memory count per user
- Last activity
- Export user data (GDPR compliance)
- Delete user data

---

## 5. API Keys Management

Create and manage API keys.

```
┌─────────────────────────────────────────────────────────────────┐
│  API Keys                                          [+ Create]   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │  Name          │ Key Hint   │ Created     │ Actions       │ │
│  ├───────────────────────────────────────────────────────────┤ │
│  │  Production    │ ...a7f9    │ Jan 15      │ [Revoke]      │ │
│  │  Development   │ ...2345    │ Feb 1       │ [Revoke]      │ │
│  │  Testing       │ ...x8k2    │ Feb 1       │ [Revoke]      │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ⚠️ API keys are shown only once when created. Store securely. │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 6. Settings

Configure agent settings.

```
┌─────────────────────────────────────────────────────────────────┐
│  Settings                                                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  GENERAL                                                        │
│  ─────────────────────────────────────────────────────────────  │
│  Agent Name:     [My AI Agent          ]                        │
│                                                                 │
│  LLM CONFIGURATION                                              │
│  ─────────────────────────────────────────────────────────────  │
│  Provider:       [OpenAI ▼]                                     │
│  Model:          [gpt-4o-mini ▼]                                │
│  Embedding:      [text-embedding-3-small ▼]                     │
│                                                                 │
│  VECTOR STORAGE                                                 │
│  ─────────────────────────────────────────────────────────────  │
│  Provider:       [pgvector ▼]                                   │
│  ○ pgvector (local, free)                                       │
│  ○ Pinecone (cloud, scales to billions)                         │
│                                                                 │
│  WEBHOOKS                                                       │
│  ─────────────────────────────────────────────────────────────  │
│  Endpoint:       [https://myapp.com/webhooks/engram]            │
│  Events:         [✓] Proactive Surface  [✓] Contradiction      │
│                  [ ] Pattern Detected   [✓] Consolidation       │
│                                                                 │
│                                              [Save Changes]     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Tech Stack (Dashboard)

| Component | Tech |
|-----------|------|
| Framework | Next.js 14 (App Router) |
| Styling | Tailwind CSS |
| Components | shadcn/ui |
| Charts | Recharts |
| Auth | NextAuth.js |
| API | tRPC or REST |

---

## Implementation Priority

**Phase 1 (MVP):**
1. Overview dashboard with key metrics
2. Memories browser with search
3. Memory detail view
4. API keys management

**Phase 2:**
1. Users list with export
2. Settings page
3. Webhook configuration

**Phase 3:**
1. Memory chain visualization
2. Embedding visualizer (t-SNE/UMAP)
3. Advanced analytics

---

## User Flow

```
Login
  │
  ▼
Overview Dashboard
  │
  ├──► Memories Browser ──► Memory Detail
  │
  ├──► Users List ──► User Detail
  │
  ├──► API Keys ──► Create Key
  │
  └──► Settings
```

---

*Document created: Saturday, February 1st, 2026*
*Ready for implementation when you are.*
