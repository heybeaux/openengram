# Contributing to Engram

Thanks for wanting to help. Seriously.

Engram is built by a small team (currently a solo developer + an AI agent), so every contribution matters.

## Quick Start

```bash
# Fork and clone
git clone https://github.com/YOUR_USERNAME/engram
cd engram

# Install dependencies
pnpm install

# Set up your environment
cp .env.example .env
# Edit .env with your database URL and LLM provider keys

# Start PostgreSQL (if not already running)
# macOS: brew services start postgresql
# Docker: docker-compose up -d postgres

# Run migrations
pnpm prisma migrate dev

# Start the dev server
pnpm start:dev

# Run tests
pnpm test
```

## What We're Looking For

### Good First Issues

Look for issues tagged [`good-first-issue`](https://github.com/heybeaux/engram/labels/good-first-issue). These are scoped, well-described, and don't require deep context.

### High-Impact Areas

- **Python SDK** — We only have TypeScript right now. A Python client would unlock a huge audience.
- **Integration guides** — LangChain, AutoGen, CrewAI, Haystack, etc.
- **New LLM/vector providers** — Cohere, Voyage AI, Weaviate, Qdrant
- **Extraction improvements** — Better prompts, more languages, confidence calibration
- **Documentation** — Always welcome. Typo fixes to full guides.
- **Tests** — We have good coverage but always want more.

### Things We'd Love Help With

- Benchmarking extraction quality across different LLMs
- Memory deduplication edge cases
- Multi-language support for extraction prompts
- Performance optimization for large memory sets (10k+)
- Dashboard UI improvements

## How to Contribute

### 1. Pick something

Check the [issues](https://github.com/heybeaux/engram/issues) or just scratch your own itch.

If it's a big change, open an issue first so we can discuss the approach.

### 2. Branch

```bash
git checkout -b feat/your-feature
# or
git checkout -b fix/your-bugfix
```

### 3. Code

- **TypeScript** — We use strict mode. No `any` unless absolutely necessary.
- **Tests** — Add tests for new features. Update tests for changed behavior.
- **Linting** — Run `pnpm lint` before committing.

### 4. Commit

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add Cohere embedding provider
fix: temporal parser handles "last 2 weeks"
docs: add LangChain integration guide
test: add consolidation edge case tests
```

### 5. PR

- Fill out the PR template
- Link the issue if there is one
- Keep PRs focused — one feature or fix per PR
- Be ready for feedback (we review everything)

## Code Structure

```
src/
├── common/          # Guards, decorators, utilities
├── dashboard/       # Dashboard API controller
├── llm/             # LLM provider abstraction
├── memory/          # Core memory engine
│   ├── temporal/    # Temporal query parsing
│   ├── intelligence/# Safety detection, importance scoring
│   ├── dto/         # Request/response types
│   └── *.service.ts # Business logic
├── prisma/          # Database client
└── utils/           # Shared utilities

prisma/
├── schema.prisma    # Database schema
└── migrations/      # Migration history

docs/                # Documentation
public/              # Static files (graph visualization)
```

## Testing

```bash
# Run all tests
pnpm test

# Run specific test file
pnpm test -- extraction.service.spec

# Run with coverage
pnpm test:cov

# Run in watch mode
pnpm test:watch
```

## Style Guide

- Prefer clarity over cleverness
- Document non-obvious decisions with comments
- Use descriptive variable names
- Keep functions focused — if it's doing too much, split it
- Log meaningfully — `[Module] Action: { context }` format

## Community

- **Issues** — Bug reports, feature requests, questions
- **Discussions** — Ideas, architecture debates, show-and-tell
- **PRs** — Code contributions

## License

By contributing, you agree that your contributions will be licensed under the Apache License 2.0.

---

*Questions? Open an issue or reach out to [@heybeaux](https://github.com/heybeaux).*
