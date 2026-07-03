/**
 * Shared types for the EC-39 GitHub ingest flow.
 *
 * The ingest pipeline is a small state machine: queued → cloning → synth-*
 * → ready, with `failed` as the terminal error state. Stages mirror the
 * existing CLI synth pipeline (EC-38) so progress reads naturally to the
 * dashboard user.
 */

export type IngestStage =
  | 'queued'
  | 'cloning'
  | 'structure'
  | 'contracts'
  | 'gotchas'
  | 'subsystem'
  | 'repository'
  | 'done';

export type IngestStatus = 'queued' | 'running' | 'ready' | 'failed';

/** Discriminator for the failure modes called out in the EC-39 spec. */
export type IngestFailureKind =
  | 'not-found'
  | 'private'
  | 'too-large'
  | 'network'
  | 'rate-limit'
  | 'invalid-url'
  | 'storage'
  | 'unknown';

export interface IngestJob {
  /** Stable id used in URLs (`GET /v1/ingest/:id`). */
  id: string;
  /** Slug derived from the URL (`owner__repo`). Used for artifacts path. */
  repoId: string;
  /** Original GitHub URL as submitted by the caller. */
  url: string;
  /** Optional branch/tag; defaults to the repo's default branch. */
  ref?: string;
  status: IngestStatus;
  stage: IngestStage;
  /** Coarse 0-100 progress hint. Stage transitions advance this. */
  progress: number;
  /** Human-readable error message when status === 'failed'. */
  error?: string;
  errorKind?: IngestFailureKind;
  startedAt: string;
  finishedAt?: string;
  /** Optional totals once synth completes. */
  totalTokens?: number;
  /**
   * EC-49: trigger attribution (cron / webhook / hook / manual). Carried
   * through to every `pass_runs.metadata.trigger` row this job emits.
   */
  trigger?: {
    source: 'manual' | 'cron' | 'webhook' | 'hook';
    sha?: string;
    detail?: Record<string, unknown>;
  };
}

/** Public-facing shape returned by the ingest controller. */
export type IngestJobDto = IngestJob;

/** Map stage → percentage hint. Used for the UI progress bar. */
export const STAGE_PROGRESS: Record<IngestStage, number> = {
  queued: 0,
  cloning: 10,
  structure: 25,
  contracts: 45,
  gotchas: 60,
  subsystem: 75,
  repository: 90,
  done: 100,
};
