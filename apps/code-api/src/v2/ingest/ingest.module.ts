/**
 * NestJS module wiring for the EC-39 ingest flow.
 *
 * EC-47 adds the pass-run recorder so every synthesis pass driven by
 * `IngestService` writes a row to `pass_runs`. The recorder factory is
 * registered as a provider keyed on {@link INGEST_PASS_RUN_RECORDER} so
 * tests can override it by binding their own value to the same token.
 *
 * EC-50 layers an Engram observation emitter on top: when
 * `observations.enabled` is true in the loaded config (or an
 * `ENGRAM_API_KEY` env var is present), the recorder also fires a
 * fire-and-forget observation per pass. Both gates must pass — a missing
 * key with `enabled: true` silently degrades to "ledger only" rather than
 * crashing the module.
 */

import { Module } from '@nestjs/common';

import { loadConfig, type ResolvedEngramConfig } from '../config';
import { EngramEmitter } from '../observations/engram-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { IngestController } from './ingest.controller';
import {
  INGEST_BUDGET_PRISMA,
  INGEST_ENGRAM_EMITTER,
  INGEST_INCREMENTAL_PRISMA,
  INGEST_PASS_RUN_RECORDER,
  IngestService,
  makePrismaPassRunRecorder,
  type PassRunRecorder,
} from './ingest.service';

/**
 * Resolve emitter wiring from the bundled config + process env. We
 * deliberately don't read the per-repo `.engram/config.yaml` here — that
 * file lives inside the cloned repo and isn't available at app boot. The
 * current deployment model is "one indexer per environment", so a
 * process-level key (env or static config) is sufficient.
 */
async function buildEngramEmitter(): Promise<EngramEmitter | null> {
  let config: ResolvedEngramConfig | null = null;
  try {
    ({ config } = await loadConfig());
  } catch {
    // If we can't load a config (e.g. CI without a repo root), fall back
    // to env-only wiring with built-in defaults.
    config = null;
  }
  const envApiKey = process.env.ENGRAM_API_KEY?.trim();
  const apiKey = (config?.observations.apiKey || envApiKey || '').trim();
  const enabled = (config?.observations.enabled ?? false) || Boolean(envApiKey);
  if (!enabled || !apiKey) return null;
  return new EngramEmitter({
    endpoint: config?.observations.endpoint ?? 'https://api.openengram.ai',
    apiKey,
    batchSize: config?.observations.batchSize,
    batchIntervalMs: config?.observations.batchIntervalMs,
    logger: {
      log: (m) => console.log(`[engram-emitter] ${m}`),
      warn: (m) => console.warn(`[engram-emitter] ${m}`),
      error: (m) => console.error(`[engram-emitter] ${m}`),
    },
  });
}

@Module({
  controllers: [IngestController],
  providers: [
    IngestService,
    {
      provide: INGEST_ENGRAM_EMITTER,
      useFactory: () => buildEngramEmitter(),
    },
    {
      provide: INGEST_PASS_RUN_RECORDER,
      useFactory: (
        prisma: PrismaService,
        emitter: EngramEmitter | null,
      ): PassRunRecorder =>
        makePrismaPassRunRecorder(
          prisma,
          { error: (msg) => console.error(`[ingest pass-run] ${msg}`) },
          emitter,
        ),
      inject: [PrismaService, INGEST_ENGRAM_EMITTER],
    },
    {
      provide: INGEST_BUDGET_PRISMA,
      useFactory: (prisma: PrismaService) => prisma,
      inject: [PrismaService],
    },
    {
      // EC-46: incremental rescans need the same Prisma client; bind it
      // under its own token so a deployer could swap in a read-replica.
      provide: INGEST_INCREMENTAL_PRISMA,
      useFactory: (prisma: PrismaService) => prisma,
      inject: [PrismaService],
    },
  ],
  exports: [IngestService],
})
export class V2IngestModule {}
