# Awareness & Signals UI Spec

**Date:** 2026-02-20
**Author:** Kit 🦊
**Status:** Draft — awaiting review
**Depends on:** Backend features HEY-136 (Waking Cycle), HEY-151 (Feedback), HEY-154 (Notifications), HEY-155 (Sources)

---

## 1. Overview

The awareness system is Engram's proactive intelligence layer. It surfaces insights from memory patterns, learns from user feedback, delivers notifications for high-confidence findings, and ingests signals from external sources. This spec defines the dashboard UI for all of it.

---

## 2. User Stories

| # | As a... | I want to... | So that... |
|---|---------|-------------|-----------|
| US1 | Dashboard user | See what insights the Waking Cycle has found | I can act on patterns I didn't notice |
| US2 | Dashboard user | Dismiss irrelevant insights | The system learns what matters to me |
| US3 | Dashboard user | Mark insights as helpful or acted-on | The system surfaces more like it |
| US4 | Dashboard user | Configure when I get notified | I'm not spammed but don't miss critical insights |
| US5 | Dashboard user | See connected signal sources | I know what data is feeding the system |
| US6 | Dashboard user | Connect/disconnect sources | I control what data enters my memory |
| US7 | Dashboard user | See Waking Cycle health | I know if the system is working or broken |
| US8 | Agent operator | Trigger a manual cycle | I can test or force insight generation |
| US9 | Agent operator | See feedback statistics | I can evaluate insight quality over time |

---

## 3. Pages & Components

### 3.1 Insights Page (`/insights`)

**Route:** `/insights`
**Nav:** Sidebar item "Insights" with notification badge (unacknowledged count)

#### Layout

```
┌─────────────────────────────────────────────────┐
│ Insights                          [Run Cycle ▶] │
├──────────────┬──────────────────────────────────┤
│ Filters      │  Insight Feed                    │
│              │                                  │
│ ○ All        │  ┌─────────────────────────────┐ │
│ ○ Actionable │  │ 🔵 Pattern Detected    0.92 │ │
│ ○ Dismissed  │  │ "Agent X has improved..."   │ │
│ ○ Acted On   │  │ 2h ago  [👍] [👎] [✅ Act] │ │
│              │  └─────────────────────────────┘ │
│ Type:        │  ┌─────────────────────────────┐ │
│ □ Pattern    │  │ 🟡 Anomaly           0.78  │ │
│ □ Anomaly    │  │ "Memory volume dropped..."  │ │
│ □ Trend      │  │ 5h ago  [👍] [👎] [✅ Act] │ │
│ □ Suggestion │  └─────────────────────────────┘ │
│              │                                  │
│ Confidence:  │  [Load more...]                  │
│ ■■■■□ 0.7+  │                                  │
├──────────────┴──────────────────────────────────┤
│ Cycle Status: Last run 2h ago │ Next in 1h 43m  │
│ Feedback: 23 helpful │ 8 dismissed │ 5 acted on  │
└─────────────────────────────────────────────────┘
```

#### Components

**`InsightCard`**
- Displays: insight type badge (color-coded), confidence score (0.0-1.0), summary text, relative timestamp
- Actions: 👍 Helpful, 👎 Dismiss, ✅ Acted On
- On action: calls `PATCH /v1/insights/:id/feedback` with `{ action }`, animates card transition (dismissed → fades, acted_on → green flash)
- Expanded state: shows source memory IDs (clickable links to memory detail), full metadata
- Visual states: unacknowledged (bold), acknowledged (normal), dismissed (muted/strikethrough)

**`InsightFilters`**
- Status filter: All / Actionable (unacknowledged) / Dismissed / Acted On
- Type filter: checkboxes for PATTERN_DETECTED, ANOMALY, TREND, SUGGESTION
- Confidence slider: minimum confidence threshold (default 0.0, shows all)
- Filters update URL params for bookmarkability

**`CycleStatusBar`**
- Shows: last cycle run time (relative), next scheduled run, cycle health (healthy/stale/error)
- Stale = last run > 8 hours ago (amber warning)
- Error = last cycle failed (red, show error message)
- "Run Cycle" button: triggers `POST /v1/awareness/cycle`, shows spinner during execution, refreshes feed on completion

**`FeedbackSummary`**
- Aggregated stats: total insights, helpful count, dismissed count, acted_on count
- Trend: feedback ratio this week vs last week (improving/declining indicator)
- Data source: derived from insight metadata aggregation

#### Data Flow

```
GET /v1/awareness/status → cycle status + recent insights
  ↓
InsightCard[] rendered from insights array
  ↓
User clicks feedback action
  ↓
PATCH /v1/insights/:id/feedback { action: 'dismissed' | 'helpful' | 'acted_on' }
  ↓
UI updates card state optimistically, reverts on error
  ↓
POST /v1/awareness/cycle (manual trigger)
  ↓
Poll GET /v1/awareness/status until cycle completes (max 60s)
  ↓
Refresh insight feed
```

#### Error States

| State | Display |
|-------|---------|
| No insights yet | Empty state: "No insights yet. The Waking Cycle runs every 4 hours to analyze your memories." + "Run Now" button |
| Cycle failed | Red banner: "Last cycle failed: {error}. [Retry]" |
| Feedback save failed | Toast: "Couldn't save feedback. Try again." (revert optimistic update) |
| API unreachable | Full page error with retry button |

#### Definition of Done
- [ ] Insight feed loads from API with pagination (20 per page)
- [ ] All 3 feedback actions work with optimistic UI updates
- [ ] Filters work (status, type, confidence) and persist in URL
- [ ] Cycle status shows accurate timing with stale/error states
- [ ] Manual cycle trigger works with loading state
- [ ] Feedback summary shows aggregate stats
- [ ] Empty state renders correctly
- [ ] Mobile responsive (cards stack, filters collapse)
- [ ] Loading skeletons during data fetch

---

### 3.2 Notification Settings (`/insights/notifications`)

**Route:** `/insights/notifications` (tab or sub-page of insights)

#### Layout

```
┌─────────────────────────────────────────────────┐
│ Notification Settings                           │
├─────────────────────────────────────────────────┤
│                                                 │
│ Enable Notifications        [Toggle: ON/OFF]    │
│                                                 │
│ Confidence Threshold                            │
│ Only notify for insights above this confidence  │
│ ■■■■■■■■■□  0.90                               │
│                                                 │
│ Webhook URL                                     │
│ ┌─────────────────────────────────────────────┐ │
│ │ https://discord.com/api/webhooks/...        │ │
│ └─────────────────────────────────────────────┘ │
│                                                 │
│ HMAC Secret (optional)                          │
│ ┌─────────────────────────────────────────────┐ │
│ │ ••••••••••••••••                            │ │
│ └─────────────────────────────────────────────┘ │
│                                                 │
│ [Test Notification]              [Save Changes] │
│                                                 │
│ Recent Notifications                            │
│ ┌─────────────────────────────────────────────┐ │
│ │ ✅ Delivered  "Pattern detected..."  2h ago │ │
│ │ ❌ Failed     "Anomaly found..."     5h ago │ │
│ │ ✅ Delivered  "Trust score..."       1d ago │ │
│ └─────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

#### Components

**`NotificationToggle`** — Enable/disable with `POST /v1/notifications/configure { enabled }`

**`ConfidenceSlider`** — Range 0.5-1.0, step 0.05, default 0.9. Updates `threshold` on save.

**`WebhookConfig`** — URL input with validation (must be HTTPS). HMAC secret input (password field). Save button calls `POST /v1/notifications/configure`.

**`TestButton`** — Sends a test notification to the configured webhook. Shows success/failure toast.

**`NotificationHistory`** — List of recent notification attempts: status (delivered/failed), insight summary, timestamp, error if failed.

#### Data Flow

```
GET /v1/notifications/config → current settings
  ↓
User edits settings
  ↓
POST /v1/notifications/configure { enabled, threshold, webhookUrl, hmacSecret }
  ↓
Toast: "Settings saved" or error
```

#### Error States

| State | Display |
|-------|---------|
| No webhook URL | Warning: "Set a webhook URL to receive notifications" |
| Invalid URL | Inline validation: "Must be a valid HTTPS URL" |
| Test failed | Toast: "Test notification failed: {error}" |
| Config save failed | Toast: "Couldn't save settings. Try again." |

#### Definition of Done
- [ ] Toggle enables/disables notifications
- [ ] Confidence slider works with visual feedback
- [ ] Webhook URL validates (HTTPS required)
- [ ] HMAC secret field masks input
- [ ] Test notification sends and reports result
- [ ] Settings persist on page reload
- [ ] Notification history shows recent attempts

---

### 3.3 Sources Page (`/sources`)

**Route:** `/sources` (already scaffolded in HEY-155 with placeholder UI)

#### Current State
Basic card layout with Linear, GitHub, Slack placeholders and "Coming soon" modals. Needs to be wired to real functionality.

#### Enhanced Layout

```
┌─────────────────────────────────────────────────┐
│ Signal Sources                                  │
├─────────────────────────────────────────────────┤
│                                                 │
│ ┌──────────────┐ ┌──────────────┐ ┌───────────┐│
│ │ 📋 Linear    │ │ 🐙 GitHub   │ │ 💬 Slack  ││
│ │              │ │              │ │           ││
│ │ ● Connected  │ │ ○ Not setup  │ │ ○ Not set ││
│ │ 142 signals  │ │              │ │           ││
│ │ Last: 2h ago │ │              │ │           ││
│ │              │ │              │ │           ││
│ │ [Configure]  │ │ [Connect]    │ │ [Connect] ││
│ │ [Toggle: ON] │ │              │ │           ││
│ └──────────────┘ └──────────────┘ └───────────┘│
│                                                 │
│ Signal Activity (last 7 days)                   │
│ ┌─────────────────────────────────────────────┐ │
│ │ ▁▂▃▅▇█▇▅▃▂▁▂▃▅▇  142 total signals        │ │
│ └─────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

#### Source Card States

| State | Visual | Actions Available |
|-------|--------|-------------------|
| Not connected | Gray border, "Connect" button | Connect (opens OAuth or config modal) |
| Connected + Enabled | Green dot, signal count, last sync time, toggle ON | Configure, Disable, Disconnect |
| Connected + Disabled | Amber dot, "Paused", toggle OFF | Enable, Configure, Disconnect |
| Error | Red dot, error message | Retry, Configure, Disconnect |

#### Configure Modal (per source)

**Linear:**
- Workspace selection (from OAuth)
- Team filter (which teams to watch)
- Signal types: ticket staleness, blocker detection, workload patterns (checkboxes)
- Polling interval (default: 4h, aligned with Waking Cycle)

**GitHub:** (future — placeholder for now)
- Repository selection
- Signal types: PR staleness, CI failures, review bottlenecks

**Slack:** (future — placeholder for now)
- Workspace + channel selection
- Signal types: unanswered questions, sentiment shifts

#### Data Flow

```
Page load → GET /v1/awareness/sources (list configured sources)
  ↓
Source cards rendered with status
  ↓
Connect → OAuth flow or API key input modal
  ↓
POST /v1/awareness/sources { type: 'linear', config: {...} }
  ↓
Toggle → PATCH /v1/awareness/sources/:id { enabled: true/false }
  ↓
Configure → modal with source-specific settings
  ↓
Disconnect → DELETE /v1/awareness/sources/:id (confirmation dialog)
```

**Note:** The backend Linear signal source (HEY-153) already exists. The UI needs to wire to it. GitHub and Slack are future — show the cards with "Coming Soon" badge.

#### Error States

| State | Display |
|-------|---------|
| OAuth failed | Toast: "Connection failed. Try again." |
| Source fetch error | Card shows red dot + "Connection error" + retry button |
| No sources connected | Empty state: "Connect a signal source to get proactive insights from your tools." |

#### Definition of Done
- [ ] Source cards show correct status for each state
- [ ] Linear source can be connected via API key (OAuth is future work)
- [ ] Toggle enable/disable works
- [ ] Configure modal opens with source-specific settings
- [ ] Disconnect with confirmation dialog
- [ ] Signal activity chart renders (sparkline or bar chart)
- [ ] GitHub and Slack show "Coming Soon" badge
- [ ] Mobile responsive

---

## 4. Shared Components

**`ConfidenceBadge`** — Renders confidence score with color: green (≥0.8), amber (0.6-0.8), red (<0.6). Used across insights, challenges, capabilities.

**`InsightTypeBadge`** — Color-coded badge: PATTERN_DETECTED (blue), ANOMALY (yellow), TREND (purple), SUGGESTION (green).

**`FeedbackActions`** — Reusable button group: 👍 Helpful, 👎 Dismiss, ✅ Acted On. Handles optimistic updates.

**`StatusDot`** — Small colored dot: green (connected/healthy), amber (warning/paused), red (error/failed), gray (inactive).

---

## 5. Task Breakdown

| # | Task | Est | Dependencies |
|---|------|-----|-------------|
| A1 | InsightCard + InsightFilters components | 2h | — |
| A2 | Insights page with feed, cycle status, feedback summary | 2.5h | A1 |
| A3 | Feedback action handlers with optimistic UI | 1h | A1 |
| A4 | Manual cycle trigger with polling | 1h | A2 |
| A5 | Notification settings page | 2h | — |
| A6 | Test notification flow | 0.5h | A5 |
| A7 | Wire Sources page to Linear backend | 2h | — |
| A8 | Source configure modal (Linear) | 1.5h | A7 |
| A9 | Signal activity chart | 1h | A7 |
| A10 | Shared components (badges, status dots) | 1h | — |
| A11 | Vitest tests for insight + notification components | 1.5h | A1-A6 |
| A12 | Navigation badge (unacknowledged insight count) | 0.5h | A2 |

**Total: ~16.5 hours**

---

## 6. Open Questions

1. **Notification channels:** Currently webhook-only. Should we add Discord bot / email as first-class notification channels?
2. **Insight retention:** How long do we keep dismissed insights? 30 days? Forever?
3. **Source polling:** Should sources poll independently or align with the Waking Cycle schedule?
4. **Insight grouping:** Should related insights (e.g., same pattern over multiple days) be grouped or shown individually?

---

*Spec authored by Kit 🦊. Ready for review.*
