# Engram Monetization Strategy

*Last Updated: 2026-02-04*

## Model: Open Core

The core memory engine is open source (Apache 2.0). Revenue comes from a hosted cloud service, enterprise features, and support.

**Playbook:** Supabase, PostHog, GitLab — open core with managed cloud.

---

## What's Open Source (Free Forever)

Everything a developer needs to self-host a production-quality memory system:

- **Core Memory Engine** — Store, recall, query, correct memories
- **5W1H Extraction Pipeline** — Automatic structure from raw text
- **Memory Intelligence v2** — Type classification (CONSTRAINT/PREFERENCE/FACT/TASK/EVENT)
- **effectiveScore** — Decay, novelty, usage-based scoring
- **Safety-Critical Detection** — 16 patterns, never-evict guarantee
- **Field-Level Confidence Scores** — Per-field extraction confidence (0.0-1.0)
- **Temporal Memory** — Time-aware recall ("What happened yesterday?")
- **Sleep Consolidation** — LLM-based duplicate compression and pattern promotion
- **Memory Layers** — IDENTITY/PROJECT/SESSION/TASK with configurable lifespans
- **Multi-LLM Support** — OpenAI, Anthropic, Ollama, LM Studio
- **Multi-Vector Support** — pgvector (local) or Pinecone (cloud)
- **Auto-Mode** — Passive conversation observation and extraction
- **REST API** — Full CRUD, query, context loading, health endpoint
- **D3 Graph Visualization** — Interactive memory network explorer
- **Basic Dashboard** — Memory browser, graph, settings
- **Agent Self-Memories** — Agents can store memories about themselves
- **OpenClaw Integration** — Hooks for automatic memory capture
- **Docker Compose** — One-command self-hosting

## What's Cloud-Only (Paid)

Features that require infrastructure, operational overhead, or ongoing investment:

### Tier 1: Cloud Essentials
- **Managed hosting** — We run it, you use it
- **Automatic backups** — Daily snapshots, point-in-time recovery
- **Auto-scaling** — Memory grows with your agent, no capacity planning
- **Dashboard Pro** — Advanced analytics, usage trends, memory health monitoring
- **Uptime SLA** — 99.9% availability guarantee
- **Email support** — Response within 24 hours

### Tier 2: Cloud Pro
- **Multi-agent** — Multiple agents sharing or isolating memory pools
- **Team collaboration** — Invite teammates to manage memories and review extractions
- **Webhook events** — Real-time notifications (memory created, contradiction detected, pattern found)
- **Memory Analytics** — Extraction quality trends, recall performance, type distribution over time
- **Priority support** — Response within 4 hours
- **Custom retention policies** — Per-layer retention rules, automated archival

### Tier 3: Enterprise
- **SSO/SAML** — Okta, Azure AD, Google Workspace
- **HIPAA compliance** — BAA, encryption at rest/transit, audit logs, data residency
- **SOC 2 Type II** — Certified compliance
- **Dedicated infrastructure** — Single-tenant deployment option
- **On-premises deployment** — Run Engram Cloud on your own infra with our management plane
- **Custom SLA** — 99.99% with dedicated support engineer
- **White-label** — Your branding on the dashboard
- **Bulk pricing** — Volume discounts for high-memory workloads
- **Professional services** — Integration consulting, custom extraction pipelines

---

## Pricing

| Tier | Price | Agents | Memories | Support |
|------|-------|--------|----------|---------|
| **Free (Self-Hosted)** | $0 | Unlimited | Unlimited | Community (GitHub) |
| **Cloud Starter** | $29/mo | 1 | 10,000 | Email (24h) |
| **Cloud Pro** | $99/mo | 5 | 100,000 | Priority (4h) |
| **Cloud Team** | $249/mo | 20 | 500,000 | Priority + Slack |
| **Enterprise** | Custom | Unlimited | Unlimited | Dedicated engineer |

**Overage:** $5 per additional 10,000 memories/month.

**Annual discount:** 20% off monthly pricing (2 months free).

### Why This Pricing

- **Starter at $29** — Low enough for indie developers and hobbyists building personal agents. One agent, plenty of headroom.
- **Pro at $99** — Sweet spot for startups and small teams with multiple agents. 100k memories covers most production use cases for months.
- **Team at $249** — For companies building agent platforms. 20 agents, half a million memories, Slack support.
- **Enterprise is custom** — Healthcare, finance, legal — they need compliance, dedicated infra, and custom contracts.

### Competitor Comparison

| Feature | Engram | Mem0 | Zep | LangChain Memory |
|---------|--------|------|-----|------------------|
| Open Source Core | ✅ Apache 2.0 | ✅ | ✅ | ✅ |
| Type Classification | ✅ LLM-based | ❌ | ❌ | ❌ |
| Safety-Critical Detection | ✅ Never-evict | ❌ | ❌ | ❌ |
| Temporal Recall | ✅ Time-aware | ❌ | Partial | ❌ |
| effectiveScore | ✅ Multi-signal | Basic | Basic | ❌ |
| Sleep Consolidation | ✅ LLM gist | ❌ | ❌ | ❌ |
| Confidence Scores | ✅ Per-field | ❌ | ❌ | ❌ |
| Self-Hosting | ✅ Docker | ✅ | ✅ | N/A |
| Graph Visualization | ✅ D3 | ❌ | ❌ | ❌ |
| Multi-LLM | ✅ 4 providers | OpenAI only | OpenAI only | Varies |
| Agent Self-Memory | ✅ | ❌ | ❌ | ❌ |

**Engram's moat:** Intelligence features. Every competitor does store-and-retrieve. Engram does store, classify, score, protect, decay, consolidate, and temporally recall. That's the differentiation.

---

## Revenue Projections (Conservative)

### Year 1 (2026)

| Metric | Q1 | Q2 | Q3 | Q4 |
|--------|----|----|----|----|
| GitHub Stars | 200 | 800 | 2,000 | 4,000 |
| Self-Hosted Users | 50 | 200 | 500 | 1,000 |
| Cloud Starter | 0 | 10 | 30 | 60 |
| Cloud Pro | 0 | 3 | 10 | 25 |
| Cloud Team | 0 | 0 | 2 | 5 |
| Enterprise | 0 | 0 | 0 | 1 |
| **MRR** | **$0** | **$587** | **$2,067** | **$5,485** |

### Year 1 Total: ~$25k ARR by end of year

### Year 2 (2027) — Target: $120k ARR

Growth drivers:
- Word-of-mouth from OSS community
- Blog content + conference talks
- Integration partnerships (OpenClaw, LangChain, AutoGen)
- First enterprise contracts
- SDK for Python (expanding beyond TypeScript)

---

## Go-To-Market

### Phase 1: Launch (February 2026)
1. Make repo public
2. Blog post: "Teaching AI to Remember When" (done)
3. LinkedIn announcement
4. Post to Hacker News, Reddit r/MachineLearning, r/LocalLLaMA
5. Discord community setup
6. Product Hunt launch (schedule for a Tuesday)

### Phase 2: Community (March-April 2026)
1. Weekly blog posts about agent memory (technical deep-dives)
2. Integration guides (OpenClaw, LangChain, AutoGen, CrewAI)
3. Python SDK
4. "Memory Patterns" cookbook — common recipes
5. Contributor program (first 10 contributors get free Cloud Pro)

### Phase 3: Cloud Beta (May 2026)
1. Launch Engram Cloud beta (invite-only)
2. Free tier for beta users
3. Iterate on dashboard analytics
4. Webhook system

### Phase 4: General Availability (July 2026)
1. Engram Cloud GA
2. Stripe billing integration
3. SOC 2 Type II audit start
4. First enterprise pilot

---

## Technical Architecture: Cloud vs Self-Hosted

```
Self-Hosted (OSS)                    Cloud (Paid)
┌─────────────────┐                 ┌──────────────────────────┐
│  Your Server    │                 │  Engram Cloud            │
│  ┌───────────┐  │                 │  ┌────────────────────┐  │
│  │  Engram   │  │                 │  │  Management Plane  │  │
│  │  Server   │  │                 │  │  (multi-tenant)    │  │
│  └─────┬─────┘  │                 │  └────────┬───────────┘  │
│        │        │                 │           │              │
│  ┌─────▼─────┐  │                 │  ┌────────▼───────────┐  │
│  │ PostgreSQL│  │                 │  │  Shared/Dedicated  │  │
│  │ + pgvector│  │                 │  │  PostgreSQL + pgv  │  │
│  └───────────┘  │                 │  └────────────────────┘  │
│                 │                 │                          │
│  You manage:    │                 │  We manage:              │
│  - Backups      │                 │  - Backups               │
│  - Scaling      │                 │  - Scaling               │
│  - Updates      │                 │  - Updates               │
│  - Monitoring   │                 │  - Monitoring            │
│  - Security     │                 │  - Security + Compliance │
└─────────────────┘                 │  - Analytics             │
                                    │  - SSO/SAML              │
                                    │  - Webhooks              │
                                    └──────────────────────────┘
```

### What Stays in the OSS Repo (Gated)

Some cloud features live in the same repo but are gated behind configuration:

```typescript
// src/cloud/cloud.module.ts — only loaded when ENGRAM_CLOUD=true
if (process.env.ENGRAM_CLOUD === 'true') {
  // Multi-tenant middleware
  // Usage metering
  // Webhook delivery
  // Analytics pipeline
}
```

This keeps one codebase, simplifies contributions, and avoids the "open core fork" maintenance nightmare.

### What Lives in a Separate Repo (Private)

- `engram-cloud` — Management plane (billing, provisioning, tenant management)
- `engram-enterprise` — SSO/SAML, HIPAA compliance tooling, audit exports
- `engram-infra` — Terraform/Pulumi for cloud infrastructure

---

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| AWS/GCP launches competing managed service | Feature moat (intelligence, not just storage). Community loyalty. |
| Competitor copies our features | Ship faster. Stay close to users. OSS community is our moat. |
| Self-hosted cannibalize cloud revenue | Self-hosted users become evangelists. Enterprise always wants managed. |
| Low conversion from free to paid | Focus on operational pain (backups, scaling, monitoring). Make self-hosting work but make cloud effortless. |
| Pricing too high | Start low, increase with value. Starter at $29 is cheaper than most SaaS. |
| Pricing too low | Enterprise tier is custom. Pro/Team have clear upgrade paths. |

---

## Key Metrics to Track

- **GitHub stars** — Community health signal
- **Docker pulls** — Self-hosted adoption
- **API calls/month** — Usage intensity
- **Cloud signups** — Conversion funnel
- **MRR** — Revenue
- **Churn rate** — Retention
- **NPS** — User satisfaction
- **Time to first memory** — Onboarding friction

---

*This is a living document. Review monthly and adjust based on market feedback.*
