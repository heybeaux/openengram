# Lesson Memory: Learning from Mistakes

**Status:** Exploration / Design Proposal  
**Date:** 2026-02-05  
**Author:** Rook + Beaux  
**Triggered by:** Cross-project contamination incident (WhaleHawk → Engram)

---

## The Human Analogy

When a human touches a hot stove, something interesting happens in memory:

1. The event is stored with **high emotional weight** (pain)
2. A **causal model** forms: "touching hot stove → burn"
3. The memory **barely decays** — you remember it decades later
4. It activates **proactively** in similar situations, not just on exact recall
5. Over time, it generalizes: "hot surfaces are dangerous" (not just that specific stove)

Current Engram memory types don't capture this pattern:

| Type | Purpose | Decay | Example |
|------|---------|-------|---------|
| CONSTRAINT | Hard safety rules | Never | "Allergic to peanuts" |
| PREFERENCE | How user likes things | Slow | "Prefers dark mode" |
| FACT | Stable information | Slow | "Lives in Vancouver" |
| TASK | Actionable items | Fast | "Call mom tomorrow" |
| EVENT | Things that happened | Fast | "Had coffee at 9am" |

None of these encode: **"I made a mistake, here's what happened, here's what I should have done, and here's how to recognize when I'm about to make it again."**

## Proposed: LESSON Memory Type

### What Is a Lesson?

A lesson is a memory that encodes:
- **What went wrong** (the mistake/failure)
- **Why it went wrong** (root cause)
- **What should have happened** (correct action)
- **Trigger pattern** (how to recognize similar situations in the future)
- **Severity** (how bad was the outcome?)

### Schema Addition

```prisma
enum MemoryType {
  CONSTRAINT
  PREFERENCE
  FACT
  TASK
  EVENT
  LESSON      // NEW: Mistakes, corrections, learnings
}
```

### Lesson-Specific Metadata

Extend the extraction/metadata to capture lesson structure:

```typescript
interface LessonMetadata {
  // What happened
  mistake: string;          // "Pushed WhaleHawk content to Engram repo"
  rootCause: string;        // "Cross-project memories injected without namespace filtering"
  correctAction: string;    // "Verify all content relates to target repo before committing"
  
  // When to surface this lesson
  triggerPatterns: string[]; // ["committing to git", "working across multiple projects", "push to repo"]
  
  // How bad was it
  severity: 'low' | 'medium' | 'high' | 'critical';
  
  // Did it come from user correction or self-detection?
  source: 'user_correction' | 'error_detection' | 'self_reflection' | 'explicit';
  
  // Has the agent demonstrated learning? (applied the lesson successfully)
  reinforcementCount: number;  // Times the lesson was surfaced AND the agent acted correctly
  lastReinforcedAt: Date | null;
}
```

### Scoring Rules for Lessons

Lessons need special treatment in the `ImportanceScorerService`:

```typescript
// In importance-scorer.service.ts

// Lesson-specific config
const LESSON_CONFIG = {
  // Lessons decay very slowly — like IDENTITY memories
  decayHalfLifeDays: 365,  // 1 year half-life (vs 3 days for TASK, 14 for SESSION)
  
  // High base score — lessons start important
  baseScoreFloor: 0.7,
  
  // Severity multiplier
  severityMultiplier: {
    low: 1.0,
    medium: 1.2,
    high: 1.4,
    critical: 1.6,  // Critical lessons get max visibility
  },
  
  // Reinforcement boost — lessons that have been successfully applied get boosted
  // (positive reinforcement: "I remembered the lesson and avoided the mistake")
  reinforcementBoostPerUse: 0.05,
  maxReinforcementBoost: 0.2,
  
  // Trigger pattern matching boost
  // When current context matches a lesson's trigger patterns, boost it significantly
  triggerMatchBoost: 0.3,
};
```

**Key difference from CONSTRAINT:** Constraints are static rules ("never do X"). Lessons are experiential — they encode the *story* of what went wrong and carry contextual trigger patterns. A constraint says "don't touch the stove." A lesson says "last time you were cooking and reached across the burner, you burned your hand — be careful when reaching near heat sources."

### Capture Mechanisms

How do lessons get created? Four pathways:

#### 1. User Corrections (Highest Signal)

When the user explicitly corrects the agent:

```
User: "No, that's wrong — you pushed WhaleHawk stuff to the Engram repo"
User: "Actually, that command needs sudo"
User: "Stop, you're editing the wrong file"
```

**Detection:** Look for correction signals in user messages:
- "No, that's wrong..."
- "Actually..."
- "That's not right..."
- "Stop..."
- "You're confusing X with Y"
- Explicit negative feedback

**Extraction prompt addition:**
```
If the user is correcting a mistake, classify as LESSON and extract:
- What the agent did wrong
- What the correct action should be
- What context/pattern led to the error
```

#### 2. Error Detection (Automated)

When commands fail, APIs return errors, or operations produce unexpected results:

```
$ git push origin main
error: failed to push some refs
```

```
LLM request rejected: messages.12.content.1: unexpected tool_use_id...
```

**Detection:** Monitor for:
- Non-zero exit codes from commands
- API error responses
- File operation failures
- Repeated attempts at the same action (retry loops)

**Auto-capture:** Create a LESSON memory when an error occurs and the agent successfully recovers:
```
Mistake: "Ran git push without pulling first"
Root cause: "Remote had new commits"
Correct action: "Always git pull before push, or use git pull --rebase"
Trigger: ["git push", "pushing to remote"]
```

#### 3. Self-Reflection (Agent-Initiated)

The agent recognizes it made a suboptimal choice:

```
Agent: "Actually, I just realized I should have checked the branch 
before committing. Let me fix that."
```

**Detection:** Look for self-correction language in agent responses:
- "Actually, I should have..."
- "Wait, let me reconsider..."
- "That wasn't the best approach..."
- "I made an error..."

#### 4. Explicit Creation

User explicitly tells the agent to remember a lesson:

```
User: "Remember this: always run tests before pushing to the Engram repo"
User: "Lesson learned: don't mix project contexts when committing"
```

### Retrieval: Context-Aware Lesson Surfacing

This is the most interesting part. Lessons shouldn't just sit in memory waiting for semantic search — they should **proactively surface** when the agent is about to enter a similar situation.

#### Trigger Pattern Matching

At retrieval time, compare current context against stored trigger patterns:

```typescript
async surfaceLessons(currentContext: string, agentId?: string): Promise<Memory[]> {
  // 1. Standard semantic search for relevant lessons
  const semanticMatches = await this.queryMemories({
    query: currentContext,
    memoryType: 'LESSON',
    agentId,
    limit: 10,
  });
  
  // 2. Trigger pattern matching (keyword/pattern based)
  const allLessons = await this.prisma.memory.findMany({
    where: { 
      memoryType: 'LESSON',
      userHidden: false,
      ...(agentId ? { agentId } : {}),
    },
  });
  
  const triggerMatches = allLessons.filter(lesson => {
    const metadata = lesson.metadata as LessonMetadata;
    return metadata?.triggerPatterns?.some(pattern => 
      currentContext.toLowerCase().includes(pattern.toLowerCase())
    );
  });
  
  // 3. Merge and deduplicate, boosting trigger matches
  return mergeAndRank(semanticMatches, triggerMatches);
}
```

#### Injection Format

When lessons are injected into agent context, they should be immediately actionable:

```markdown
## ⚠️ Relevant Lessons (from past mistakes)

**[HIGH] Cross-project memory contamination** (2026-02-05)
When working across multiple projects, memories from other projects can bleed into context. 
Before committing: verify ALL content relates to the target repository.
Trigger: working across repos, committing, pushing
Source: WhaleHawk content was accidentally pushed to Engram repo.

**[MEDIUM] Always pull before push** (2026-02-03)
Remote branches may have new commits. Run `git pull --rebase` before pushing.
Trigger: git push
Source: Push failed due to diverged branches.
```

### Generalization: Lessons That Evolve

Over time, individual lessons should generalize into broader principles — similar to how "don't touch THIS stove" becomes "hot things burn."

```
Individual lessons:
- "Pushed WhaleHawk content to Engram repo" 
- "Used Engram's test config in WhaleHawk deployment"
- "Applied WhaleHawk's lint rules to UltraEdge"

Generalized lesson:
- "When working across projects, always verify which project context you're in 
   before making changes. Cross-project contamination is a recurring risk."
```

**Implementation:** During consolidation (sleep cycle), look for clusters of similar LESSON memories and create a generalized version:

```typescript
// In consolidation service
async consolidateLessons(userId: string): Promise<void> {
  const lessons = await this.getRecentLessons(userId, { days: 30 });
  
  // Cluster by semantic similarity
  const clusters = await this.clusterBySimilarity(lessons, { threshold: 0.8 });
  
  // For clusters with 3+ lessons, generate a generalized lesson
  for (const cluster of clusters.filter(c => c.length >= 3)) {
    const generalized = await this.llm.generateGeneralizedLesson(cluster);
    await this.createMemory({
      content: generalized.content,
      memoryType: 'LESSON',
      layer: 'IDENTITY',  // Generalized lessons are identity-level
      metadata: {
        ...generalized.metadata,
        source: 'consolidation',
        sourceMemoryIds: cluster.map(l => l.id),
      },
    });
  }
}
```

### Reinforcement: Positive Feedback Loop

When the agent encounters a trigger situation and **successfully avoids** the mistake, that's reinforcement:

```typescript
// Agent is about to push to a repo
// Lesson surfaces: "verify which project context you're in"
// Agent checks and confirms correct repo
// → Increment reinforcementCount on that lesson

async reinforceLesson(lessonId: string): Promise<void> {
  await this.prisma.memory.update({
    where: { id: lessonId },
    data: {
      metadata: {
        // ... existing metadata
        reinforcementCount: { increment: 1 },
        lastReinforcedAt: new Date(),
      },
      usedCount: { increment: 1 },
    },
  });
}
```

Well-reinforced lessons could eventually "graduate" — their trigger patterns are so ingrained that the agent naturally avoids the mistake without needing the explicit reminder. At that point, the lesson's injection priority could decrease (but never disappear — the memory stays, just less aggressively surfaced).

## Priority vs Existing Types

Where LESSON fits in the priority stack:

```
Priority 1: CONSTRAINT  (safety — never violate)
Priority 1: LESSON      (mistakes — avoid repeating)  ← NEW, same tier as CONSTRAINT
Priority 2: PREFERENCE  (how user likes things)
Priority 2: TASK        (things to do)
Priority 3: FACT        (stable information)
Priority 4: EVENT       (things that happened)
```

Lessons are priority 1 because **the cost of ignoring a lesson is a repeated mistake**, which is one of the most frustrating experiences for a user. "I already told you about this" is the fastest way to erode trust.

## Open Questions

1. **Lesson vs Constraint boundary:** When does "I learned not to do X" become "Never do X" (CONSTRAINT)? Should lessons auto-promote to constraints after enough reinforcement?

2. **Lesson expiry:** Some lessons become irrelevant (e.g., "don't use deprecated API v1" — if v1 is removed, the lesson is moot). How do we detect and retire stale lessons?

3. **Agent-specific vs user-specific lessons:** If a user has multiple agents, should lessons transfer between them? A lesson learned by Agent A might save Agent B from the same mistake.

4. **Lesson overload:** Too many active lessons could cause the same "brain fog" problem as too many memories. Need a lesson budget per context injection.

5. **False lessons:** Agent or user might create a lesson based on a misunderstanding. How do we handle lesson correction/deletion?

6. **Lesson triggering accuracy:** If trigger patterns are too broad, lessons fire too often ("git" triggering every git-related lesson). Too narrow, and they miss. Needs tuning.

## Implementation Phases

### Phase 1: Type + Schema (This Sprint)
- [ ] Add `LESSON` to MemoryType enum
- [ ] Add lesson metadata fields (mistake, rootCause, correctAction, triggerPatterns, severity, source)
- [ ] Set LESSON priority to 1 (same as CONSTRAINT)
- [ ] Set LESSON decay to 365-day half-life
- [ ] Update extraction prompt to detect and classify lessons

### Phase 2: Capture Mechanisms (Next Sprint)
- [ ] User correction detection in extraction service
- [ ] Error detection integration (hook into command failures)
- [ ] Explicit lesson creation via API endpoint
- [ ] Self-reflection detection (lower priority — hardest to get right)

### Phase 3: Smart Retrieval (Sprint +2)
- [ ] Trigger pattern matching at retrieval time
- [ ] Lesson-specific injection format (⚠️ warnings in context)
- [ ] Context-aware lesson surfacing (not just semantic similarity)

### Phase 4: Generalization + Reinforcement (Future)
- [ ] Lesson clustering during consolidation
- [ ] Generalized lesson generation
- [ ] Reinforcement tracking
- [ ] Lesson graduation (reduced surfacing after sustained correct behavior)

## Success Metrics

- **Repeat mistake rate:** After a lesson is created, does the agent make the same mistake again? Target: <10% recurrence.
- **Lesson surfacing accuracy:** When a lesson fires, was it actually relevant? Target: >80% precision.
- **User correction frequency:** Over time, user corrections should decrease as lessons accumulate. Track corrections per week.
- **Trust signal:** User stops needing to say "remember when I told you..." — because the agent already does.

---

*"The only real mistake is the one from which we learn nothing." — Henry Ford*

*"The only real mistake for an AI is making the same one twice." — Beaux, probably*
