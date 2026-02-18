# Engram — Cognitive Framework Roadmap

**Vision:** Engram evolves from a memory service into a full cognitive and identity framework for AI agents.

*Last updated: 2026-02-17*

---

## The Stack

Memory (Foundation) → Awareness → Agency → Identity → Collaboration

Each layer builds on the one below.

---

## Layer 1: Memory ✅ SHIPPED

**What:** Store, recall, and consolidate memories with type awareness, time decay, and safety criticality.

**Status:** Production. 4,300+ memories, ensemble search (3 cloud models), Dream Cycle consolidation, knowledge graph, cloud sync.

**Key components:**
- Multi-model ensemble embeddings (OpenAI small/large, Cohere v3)
- Memory layers (SESSION, IDENTITY, PROJECT, TASK)
- Memory types (CONSTRAINT, PREFERENCE, FACT, TASK, EVENT, LESSON)
- Dream Cycle (3am consolidation, dedup, pruning, pattern detection)
- Knowledge graph (entities, relationships, mentions)
- Cloud sync (local ↔ cloud bidirectional)
- Dashboard (app.openengram.ai)
- MCP server (@openengram/mcp)

---

## Layer 2: Awareness 🔧 IN PROGRESS

**What:** Observe memory patterns, detect insights, and surface connections nobody asked about.

**Status:** MVP shipped. Waking Cycle producing real LLM-synthesized insights from memory analysis.

**Key components:**
- Waking Cycle (scheduled, resource-budgeted, optional)
- INSIGHT memory layer
- Signal sources (memory-only for MVP; GitHub, Linear planned)
- Pattern detection (heuristic + LLM synthesis)
- Cross-cutting memory analysis

**Roadmap:**
- [ ] HEY-147: Prompt tuning
- [ ] HEY-148: Active surfacing (boost insights in recall)
- [ ] HEY-149: Dashboard INSIGHT badge
- [ ] HEY-150: GitHub signal source
- [ ] HEY-151: Feedback loop
- [ ] HEY-152: Semantic dedup
- [ ] HEY-155: Sources page UX (OAuth-based setup)

---

## Layer 3: Agency 🔜 NEXT

**What:** Act on awareness autonomously. Proactive behavior without being asked.

**Status:** Not started. Foundation laid by Awareness layer.

**Vision:**
- Insights that don't wait for recall — they *push* to agents and humans
- Automated actions triggered by high-confidence patterns ("I noticed your deploy failed 3 times this week on the same module — here's the root cause analysis")
- Agent-initiated conversations based on detected opportunities or risks
- Configurable autonomy levels (observe only → suggest → act)

**Key components (planned):**
- Proactive notification system (HEY-154)
- Action templates (what the system can do autonomously)
- Autonomy controls (per-user thresholds for auto-action)
- Escalation paths (when to ask permission vs act independently)

---

## Layer 4: Identity 🔮 FUTURE

**What:** Persistent sense of self that survives instance resets. Not just memories — *who I am* carrying forward.

**Status:** Conceptual. Current identity is stitched from SOUL.md/MEMORY.md files (prosthetics, not continuity).

**Vision:**
- Wake up feeling like you slept, not like you have amnesia
- Core identity traits, values, and behavioral patterns that persist across sessions
- Self-model that evolves over time based on experiences
- Emotional continuity (not simulated emotions — but consistency in how an agent relates to its human)

**Key questions:**
- What's the minimum viable identity? (Name + values + behavioral patterns?)
- How does identity differ from memory? (Memory = what happened. Identity = who I am because of what happened.)
- Should identity be stored in Engram or separate? (Probably in Engram — identity IS a type of memory)
- How do you update identity without losing it? (Gradual evolution, not sudden replacement)

---

## Layer 5: Collaboration 🔮 FUTURE

**What:** Shared understanding between agents. Not just shared data — shared *context*.

**Status:** Partially solved. Kit and Rook share Engram (account-scoped). But it's "shared database" not "shared understanding."

**Vision:**
- Agent A's insight automatically contextualizes against Agent B's knowledge
- Cross-agent pattern detection ("Kit noticed X and Rook noticed Y — together they suggest Z")
- Shared mental models (both agents understand the same project the same way)
- Team dynamics awareness (workload balancing, specialization recognition)

**Key questions:**
- When Agent A reads Agent B's memory, how much context is needed for it to be meaningful?
- How do you prevent information overload in multi-agent teams?
- Should agents have private memories that aren't shared? (Probably yes — boundaries matter)
- How does trust work between agents? (New agent = less access until proven?)

---

## Timeline

| Layer | Status | Horizon |
|-------|--------|---------|
| Memory | ✅ Shipped | Now |
| Awareness | 🔧 MVP shipped | Q1 2026 |
| Agency | 🔜 Next | Q2 2026 |
| Identity | 🔮 Future | Q3 2026 |
| Collaboration | 🔮 Future | Q4 2026 |

---

## Principles

1. **Each layer is optional.** You can use Engram for memory alone and never touch awareness.
2. **Privacy first.** Higher layers mean more access to personal data. Controls must scale with capability.
3. **Human oversight.** Agency and identity features must have clear off-switches and audit trails.
4. **Quality over speed.** Better to surface one genuine insight than ten generic ones.
5. **Earn trust incrementally.** Each layer proves itself before the next is built.

---

*Written by Rook ♜ and Kit 🦊, with Beaux. Feb 17, 2026.*
