/**
 * Phase 2 eval fixtures (EC-29).
 *
 * Two hand-crafted target codebases plus their associated LoD card sets and
 * eval questions. These are deliberately small, deterministic, and committed
 * to the repo so the exit-gate harness can run without standing up the full
 * indexing pipeline (Prisma + Postgres + OpenRouter) in CI.
 *
 * Card shapes mirror what Pass 6 (synthesis) produces:
 *   - `repository` card at `<repoId>/repository` with all four LoD bodies
 *   - `subsystem` cards at `<repoId>/<subsystem>`
 *   - `module` cards at the file's slash-path (no extension)
 *
 * The eval questions are the "where would I add X" architectural questions
 * an agent has to answer using only the cards (no source access). Ground
 * truth is a set of concept paths that any correct answer must mention.
 */

import type { Card } from '../../src/v2/writers/markdown/types';

export interface EvalQuestion {
  /** Stable id used in result reports. */
  id: string;
  /** Natural-language question fed to the agent. */
  prompt: string;
  /**
   * Concept paths whose mention in the answer indicates a correct response.
   * The scorer treats the answer as correct if it references at least one
   * `mustInclude` path.
   */
  mustInclude: string[];
  /**
   * Optional concept paths a strong answer also mentions. Tracked for
   * partial-credit reporting; does not affect pass/fail.
   */
  shouldInclude?: string[];
}

export interface EvalRepoFixture {
  /** Repo id, used as the conceptPath prefix for the `repository` card. */
  repoId: string;
  /** Short human-readable description, used in report headers. */
  description: string;
  /** All cards to materialize on disk under `<artifactsRoot>/cards/`. */
  cards: Card[];
  /** 5 questions per spec §EC-29. */
  questions: EvalQuestion[];
}

// ─── Repo 1: engram-code itself (self-eval) ─────────────────────────────

const ENGRAM_CODE_REPO_ID = 'engram-code';

function makeCard(
  conceptPath: string,
  kind: Card['kind'],
  lod: Card['lod'],
  sources: string[] = [],
): Card {
  return {
    conceptPath,
    kind,
    lod,
    metadata: {
      generated_at: '2026-05-25T00:00:00.000Z',
      model: 'fixture',
      repo_id: conceptPath.split('/')[0],
      sources,
    },
  };
}

const ENGRAM_CODE_CARDS: Card[] = [
  makeCard(
    `${ENGRAM_CODE_REPO_ID}/repository`,
    'repository',
    {
      index: 'engram-code: multi-pass codebase understanding pipeline (TS/Python/Go).',
      summary:
        'engram-code generates level-of-detail (LoD) markdown cards from source repos via a six-pass pipeline (structure, intent, contracts, subsystem detection, gotchas, repository synthesis). Cards live under `.engram/artifacts/cards/`. A NestJS API exposes cards, map, concept search, and subsystem listing.',
      standard: [
        'engram-code is the codebase-understanding side of the Engram memory system.',
        '',
        'Pipeline:',
        '- Pass 1 (structure): tree-sitter walks + per-language extractors → structural graph.',
        '- Pass 2 (intent): per-module LLM synthesis of *what this code is for*.',
        '- Pass 3 (contracts): mechanical extraction of public exports + LLM annotation.',
        '- Pass 4 (subsystem): Louvain community detection over the structure+intent graph.',
        '- Pass 5 (gotchas): comment + convention-aware anomaly detection.',
        '- Pass 6 (synthesis): produces LoD cards at module, subsystem, and repository levels.',
        '',
        'Subsystems: parsers, passes, writers, api, cli, llm, config.',
        '',
        'Query layer: NestJS controllers under `src/v2/api/` — `cards`, `map`, `search`, `subsystems`.',
      ].join('\n'),
      deep: 'Full pipeline detail; see subsystem cards for the breakdown.',
    },
  ),

  makeCard(
    `${ENGRAM_CODE_REPO_ID}/parsers`,
    'subsystem',
    {
      index: 'Language extractors built on tree-sitter (TS, Python, Go).',
      summary:
        'Per-language structural extractors that turn source files into `ParseResult` (nodes + edges). New languages are added by registering an extractor with the parser registry.',
      standard: [
        'Subsystem responsible for Pass 1 structural extraction.',
        '',
        'Files:',
        '- `src/v2/parsers/registry.ts` — central extractor registry.',
        '- `src/v2/parsers/typescript.extractor.ts` — TS/JS extractor.',
        '- `src/v2/parsers/python.extractor.ts` — Python extractor.',
        '- `src/v2/parsers/go.extractor.ts` — Go extractor.',
        '- `src/v2/parsers/types.ts` — `ParseResult`, `StructureNode`, `StructureEdge`.',
        '',
        'To add a new language: implement an extractor against `types.ts`, register it via `registerXxxExtractor()` (called from `cli.ts::ensureExtractorsRegistered`).',
      ].join('\n'),
      deep: 'Per-language detail; see individual module cards.',
    },
  ),

  makeCard(
    `${ENGRAM_CODE_REPO_ID}/passes`,
    'subsystem',
    {
      index: 'Six synthesis passes that produce LoD cards from structural input.',
      summary:
        'The pipeline phases: structure → intent → contracts → subsystem → gotchas → repository synthesis. Each pass lives in its own directory under `src/v2/passes/` with `orchestrator.ts`, `prompt.ts`, `writer.ts`, and tests.',
      standard: [
        'Subsystem implementing the six-pass codebase synthesis pipeline.',
        '',
        'Files:',
        '- `src/v2/passes/structure/orchestrator.ts` — Pass 1 (tree-sitter walk).',
        '- `src/v2/passes/intent/orchestrator.ts` — Pass 2 (LLM intent synthesis).',
        '- `src/v2/passes/contracts/orchestrator.ts` — Pass 3 (public surface extraction).',
        '- `src/v2/passes/subsystem/orchestrator.ts` — Pass 4 (Louvain clustering).',
        '- `src/v2/passes/gotchas/orchestrator.ts` — Pass 5 (anomaly detection).',
        '- `src/v2/passes/repository/orchestrator.ts` — Pass 6 (repository synthesis).',
        '- `src/v2/passes/synthesis.pass.ts` — module-level LoD generation.',
      ].join('\n'),
      deep: 'Per-pass detail; see individual orchestrator cards.',
    },
  ),

  makeCard(
    `${ENGRAM_CODE_REPO_ID}/api`,
    'subsystem',
    {
      index: 'NestJS HTTP API exposing cards, map, search, and subsystems.',
      summary:
        'Public query surface over the materialized card artifacts. Four controllers: `cards`, `map` (tree of cards under a conceptPath), `search/concept` (TF-IDF over LoD bodies), `subsystems` (list).',
      standard: [
        'Subsystem implementing the read-side HTTP API.',
        '',
        'Files:',
        '- `src/v2/api/cards.controller.ts` — GET /v1/cards/:conceptPath?lod=...',
        '- `src/v2/api/map.controller.ts` — GET /v1/map?root=...&depth=...',
        '- `src/v2/api/search.controller.ts` — POST /v1/search/concept (TF-IDF ranker).',
        '- `src/v2/api/subsystems.controller.ts` — GET /v1/subsystems.',
        '- `src/v2/api/services/cards-fs.service.ts` — filesystem-backed cards repo.',
        '',
        'To add a new endpoint: create a controller under `src/v2/api/`, register it in `cards.module.ts`, add DTOs under `src/v2/api/dto/`.',
      ].join('\n'),
      deep: 'Per-endpoint detail.',
    },
  ),

  makeCard(
    `${ENGRAM_CODE_REPO_ID}/cli`,
    'subsystem',
    {
      index: 'Command-line entry point: `index`, `cards`, `config`.',
      summary:
        'The `engram-code` CLI exposes three commands. `index` runs Pass 1 + stub synthesis and writes cards to `.engram/artifacts/`. `cards` reads a card off disk. `config` shows resolved `.engram/config.yaml`.',
      standard: [
        'Subsystem implementing the CLI surface.',
        '',
        'Files:',
        '- `src/v2/cli/cli.ts` — entry point, command dispatch, arg parsing.',
        '- `bin/engram-code.ts` — node bin shim.',
        '',
        'Add a new command by adding a case to the `switch (command)` block in `cli.ts::run` and a matching `runXxx` handler.',
      ].join('\n'),
      deep: 'CLI behavior reference.',
    },
  ),

  makeCard(
    `${ENGRAM_CODE_REPO_ID}/writers`,
    'subsystem',
    {
      index: 'Markdown card writer + repo INDEX.md writer.',
      summary:
        'Persists `Card` objects to `<rootDir>/cards/<conceptPath>.md` with YAML frontmatter. Round-trippable via `readCard`. Also writes a top-level `INDEX.md` listing all cards.',
      standard: [
        'Subsystem responsible for on-disk card persistence.',
        '',
        'Files:',
        '- `src/v2/writers/markdown/writer.ts` — `writeCard` / `readCard` / `cardFilePath`.',
        '- `src/v2/writers/markdown/types.ts` — `Card`, `CardKind`, `LoDContent`.',
        '- `src/v2/writers/markdown/index-writer.ts` — INDEX.md generator.',
        '',
        'The on-disk format is the source of truth; the Postgres `cards` table is rebuildable from these files.',
      ].join('\n'),
      deep: 'Writer format reference.',
    },
  ),

  makeCard(
    `${ENGRAM_CODE_REPO_ID}/llm`,
    'subsystem',
    {
      index: 'OpenRouter chat-completions client with retry + fallback.',
      summary:
        'Minimal dependency-free LLM client used by every LLM-backed pass. Routes by model slug ("anthropic/claude-opus-4-7", "google/gemini-2.5-flash"), retries once on 5xx/timeout, falls back to a secondary model when configured.',
      standard: [
        'Subsystem encapsulating the single outbound LLM call shape.',
        '',
        'Files:',
        '- `src/v2/llm/openrouter.ts` — `callOpenRouter`, `LLMClient` interface.',
        '',
        'All passes accept an `llm?: LLMClient` override so tests can stub. Production code wires `callOpenRouter` from this module.',
      ].join('\n'),
      deep: 'OpenRouter client reference.',
    },
  ),

  makeCard(
    `${ENGRAM_CODE_REPO_ID}/config`,
    'subsystem',
    {
      index: 'Per-repo `.engram/config.yaml` loader.',
      summary:
        'Loads optional per-codebase configuration (model overrides, ignore patterns, pass enablement). Defaults are baked in; the loader merges user overrides on top.',
      standard: [
        'Subsystem implementing the per-codebase config surface.',
        '',
        'Files:',
        '- `src/v2/config/index.ts` — `loadConfig`, `ConfigError`, defaults.',
        '',
        'Config lives at `<repo>/.engram/config.yaml`. Schema: see `src/v2/config/schema.ts`.',
      ].join('\n'),
      deep: 'Config schema reference.',
    },
  ),
];

const ENGRAM_CODE_QUESTIONS: EvalQuestion[] = [
  {
    id: 'engram-code-1-add-language',
    prompt:
      'Where would I add support for a new source language (e.g. Rust) so it gets picked up by the indexing pipeline?',
    mustInclude: [`${ENGRAM_CODE_REPO_ID}/parsers`],
    shouldInclude: [`${ENGRAM_CODE_REPO_ID}/cli`],
  },
  {
    id: 'engram-code-2-add-endpoint',
    prompt:
      'Where would I add a new HTTP endpoint that returns gotchas for a given concept path?',
    mustInclude: [`${ENGRAM_CODE_REPO_ID}/api`],
  },
  {
    id: 'engram-code-3-add-pass',
    prompt:
      'Where would I add a new synthesis pass — say, a "test-coverage" pass that summarizes test density per module?',
    mustInclude: [`${ENGRAM_CODE_REPO_ID}/passes`],
  },
  {
    id: 'engram-code-4-add-llm-provider',
    prompt:
      'Where would I swap or extend the LLM provider — e.g. add a direct Anthropic SDK backend alongside OpenRouter?',
    mustInclude: [`${ENGRAM_CODE_REPO_ID}/llm`],
  },
  {
    id: 'engram-code-5-add-cli-command',
    prompt:
      'Where would I add a new CLI subcommand, e.g. `engram-code subsystems` that lists detected subsystems?',
    mustInclude: [`${ENGRAM_CODE_REPO_ID}/cli`],
  },
];

// ─── Repo 2: payments-app (the canonical "payment provider" eval) ──────

const PAYMENTS_APP_REPO_ID = 'payments-app';

const PAYMENTS_APP_CARDS: Card[] = [
  makeCard(
    `${PAYMENTS_APP_REPO_ID}/repository`,
    'repository',
    {
      index: 'payments-app: small TypeScript checkout service with pluggable payment providers.',
      summary:
        'A checkout/billing service. HTTP API accepts payment intents, dispatches to a configured provider (Stripe, Adyen, etc.), persists transactions, and emits webhooks. New providers are added under `src/payments/providers/` and registered in the provider registry.',
      standard: [
        'A TypeScript billing service with a pluggable provider model.',
        '',
        'Subsystems:',
        '- `payments` — payment intents, providers, provider registry.',
        '- `webhooks` — outbound webhook delivery for provider callbacks.',
        '- `api` — Express HTTP surface.',
        '- `db` — transaction persistence (Postgres via Prisma).',
        '- `config` — env-driven configuration (provider keys, currencies).',
        '',
        'The "where do I add a payment provider" answer lives under the `payments` subsystem.',
      ].join('\n'),
      deep: 'Full topology; see subsystem cards.',
    },
  ),

  makeCard(
    `${PAYMENTS_APP_REPO_ID}/payments`,
    'subsystem',
    {
      index: 'Payment intents, provider abstraction, and the provider registry.',
      summary:
        'Core payments subsystem. Owns the `PaymentProvider` interface, the registry that maps provider ids → implementations, and the dispatch service that picks the right provider for a payment intent.',
      standard: [
        'Subsystem owning the payment-provider abstraction.',
        '',
        'Files:',
        '- `src/payments/types.ts` — `PaymentProvider` interface, `PaymentIntent`, `PaymentResult`.',
        '- `src/payments/registry.ts` — provider id → implementation registry.',
        '- `src/payments/dispatcher.ts` — picks a provider from the registry and invokes `charge`.',
        '- `src/payments/providers/stripe.ts` — Stripe implementation.',
        '- `src/payments/providers/adyen.ts` — Adyen implementation.',
        '- `src/payments/providers/index.ts` — registers all built-in providers on import.',
        '',
        'To add a new provider: implement `PaymentProvider` in a new file under `src/payments/providers/`, register it in `src/payments/providers/index.ts`, and add the provider id to the `PROVIDER_IDS` enum in `src/payments/types.ts`.',
      ].join('\n'),
      deep: 'Per-provider implementation detail.',
    },
  ),

  makeCard(
    `${PAYMENTS_APP_REPO_ID}/webhooks`,
    'subsystem',
    {
      index: 'Outbound webhook delivery for provider callbacks.',
      summary:
        'Receives provider callback events (e.g. Stripe `payment_intent.succeeded`), normalizes them into internal events, and signs+delivers webhooks to merchant endpoints with retry.',
      standard: [
        'Subsystem for delivering provider events out to merchant webhooks.',
        '',
        'Files:',
        '- `src/webhooks/receiver.ts` — inbound provider callback endpoint.',
        '- `src/webhooks/normalizer.ts` — provider event → internal event.',
        '- `src/webhooks/dispatcher.ts` — signed delivery with retry.',
        '',
        'Not where providers themselves are added — that is the `payments` subsystem.',
      ].join('\n'),
      deep: 'Webhook delivery semantics.',
    },
  ),

  makeCard(
    `${PAYMENTS_APP_REPO_ID}/api`,
    'subsystem',
    {
      index: 'Express HTTP surface for checkout + admin.',
      summary:
        'Public API routes for creating payment intents, fetching transaction status, and admin operations. Delegates all provider logic to the `payments` subsystem.',
      standard: [
        'Subsystem for HTTP routing.',
        '',
        'Files:',
        '- `src/api/server.ts` — Express bootstrap.',
        '- `src/api/routes/checkout.ts` — POST /checkout — creates a payment intent.',
        '- `src/api/routes/transactions.ts` — GET /transactions/:id.',
        '- `src/api/routes/admin.ts` — admin operations (refunds, voids).',
        '',
        'API routes do not implement providers — they call `payments/dispatcher.ts`.',
      ].join('\n'),
      deep: 'Per-route detail.',
    },
  ),

  makeCard(
    `${PAYMENTS_APP_REPO_ID}/db`,
    'subsystem',
    {
      index: 'Postgres persistence via Prisma — transactions, payment intents.',
      summary:
        'Database layer. Owns the Prisma schema (transactions, payment intents, webhook deliveries) and the repository functions that wrap it.',
      standard: [
        'Subsystem for persistence.',
        '',
        'Files:',
        '- `prisma/schema.prisma` — schema (Transaction, PaymentIntent, WebhookDelivery).',
        '- `src/db/client.ts` — singleton Prisma client.',
        '- `src/db/transactions.repo.ts` — transaction CRUD.',
        '',
        'Not where you add providers — only where you persist their results.',
      ].join('\n'),
      deep: 'Schema + repo reference.',
    },
  ),

  makeCard(
    `${PAYMENTS_APP_REPO_ID}/config`,
    'subsystem',
    {
      index: 'Env-driven configuration: provider keys, currencies, base URLs.',
      summary:
        'Loads and validates environment configuration. Defines which provider ids are *enabled* in a given environment but does not own provider implementations.',
      standard: [
        'Subsystem for environment configuration.',
        '',
        'Files:',
        '- `src/config/env.ts` — `loadEnv()` with Zod validation.',
        '- `src/config/providers.ts` — `ENABLED_PROVIDERS` env-driven list.',
        '',
        'Enabling a new provider in production requires both code (under `payments/providers/`) AND an env var update here.',
      ].join('\n'),
      deep: 'Env reference.',
    },
  ),
];

const PAYMENTS_APP_QUESTIONS: EvalQuestion[] = [
  {
    id: 'payments-app-1-add-provider',
    prompt:
      'Where would I add a new payment provider — say, Braintree — so it can be used for checkouts?',
    mustInclude: [`${PAYMENTS_APP_REPO_ID}/payments`],
    shouldInclude: [`${PAYMENTS_APP_REPO_ID}/config`],
  },
  {
    id: 'payments-app-2-add-route',
    prompt:
      'Where would I add a new HTTP route, e.g. POST /refunds, that takes a transaction id and refunds it?',
    mustInclude: [`${PAYMENTS_APP_REPO_ID}/api`],
  },
  {
    id: 'payments-app-3-add-table',
    prompt:
      'Where would I add a new database table — e.g. `Dispute` — to track chargebacks?',
    mustInclude: [`${PAYMENTS_APP_REPO_ID}/db`],
  },
  {
    id: 'payments-app-4-change-webhook',
    prompt:
      'Where would I change how outbound webhooks are signed before delivery to merchants?',
    mustInclude: [`${PAYMENTS_APP_REPO_ID}/webhooks`],
  },
  {
    id: 'payments-app-5-enable-provider',
    prompt:
      'I have already implemented a new provider. Where do I configure which providers are enabled in production?',
    mustInclude: [`${PAYMENTS_APP_REPO_ID}/config`],
    shouldInclude: [`${PAYMENTS_APP_REPO_ID}/payments`],
  },
];

export const EVAL_FIXTURES: EvalRepoFixture[] = [
  {
    repoId: ENGRAM_CODE_REPO_ID,
    description: 'engram-code itself (self-eval).',
    cards: ENGRAM_CODE_CARDS,
    questions: ENGRAM_CODE_QUESTIONS,
  },
  {
    repoId: PAYMENTS_APP_REPO_ID,
    description: 'payments-app: a small TS checkout service with pluggable payment providers.',
    cards: PAYMENTS_APP_CARDS,
    questions: PAYMENTS_APP_QUESTIONS,
  },
];
