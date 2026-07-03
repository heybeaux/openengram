'use client';

/**
 * EC-39c — ingest panel.
 *
 * One-screen flow: paste a GitHub URL, submit, watch the worker
 * advance through queued → cloning → structure → … → done, then jump
 * to that repo's card via `?repo=<repoId>`. A "Recent ingests" list
 * underneath lets you reopen prior runs.
 *
 * Polling is intentionally simple: every 1.5s while the active job is
 * running, and stops on `ready`/`failed`. The dashboard is a personal
 * tool so polling beats a websocket here.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, EngramCodeApi } from '@/lib/api';
import type { IngestJob, IngestStage, RepoSummary } from '@/lib/schemas';

const STAGES: IngestStage[] = [
  'queued',
  'cloning',
  'structure',
  'contracts',
  'gotchas',
  'subsystem',
  'repository',
  'done',
];

const STAGE_LABEL: Record<IngestStage, string> = {
  queued: 'Queued',
  cloning: 'Cloning',
  structure: 'Structure',
  contracts: 'Contracts',
  gotchas: 'Gotchas',
  subsystem: 'Subsystem',
  repository: 'Repository',
  done: 'Done',
};

interface IngestPanelProps {
  client?: Pick<
    EngramCodeApi,
    'submitIngest' | 'getIngest' | 'listIngests' | 'listRepos'
  >;
}

type ActiveState =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'tracking'; job: IngestJob }
  | { kind: 'error'; message: string };

export function IngestPanel({ client }: IngestPanelProps) {
  const api = useMemo(() => client ?? new EngramCodeApi(), [client]);
  const [url, setUrl] = useState('');
  const [active, setActive] = useState<ActiveState>({ kind: 'idle' });
  const [recents, setRecents] = useState<IngestJob[]>([]);
  const [repos, setRepos] = useState<RepoSummary[]>([]);

  const refresh = useCallback(async () => {
    try {
      const [list, repoList] = await Promise.all([
        api.listIngests(20),
        api.listRepos(),
      ]);
      setRecents(list.jobs);
      setRepos(repoList.repos);
    } catch {
      // Refresh failures are non-fatal; user can retry.
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Poll the active job while it's queued/running.
  useEffect(() => {
    if (active.kind !== 'tracking') return;
    if (active.job.status === 'ready' || active.job.status === 'failed') {
      void refresh();
      return;
    }
    const id = active.job.id;
    const timer = setInterval(() => {
      api
        .getIngest(id)
        .then((next) => {
          setActive({ kind: 'tracking', job: next });
        })
        .catch((err: unknown) => {
          if (err instanceof ApiError && err.status === 404) {
            setActive({
              kind: 'error',
              message: `Job ${id} disappeared from the server.`,
            });
            return;
          }
          // Transient errors are swallowed; the next tick retries.
        });
    }, 1500);
    return () => clearInterval(timer);
  }, [active, api, refresh]);

  const onSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const trimmed = url.trim();
      if (trimmed === '') return;
      setActive({ kind: 'submitting' });
      try {
        const result = await api.submitIngest(trimmed);
        setActive({ kind: 'tracking', job: result.job });
        setUrl('');
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        setActive({ kind: 'error', message });
      }
    },
    [api, url],
  );

  return (
    <section className="flex flex-col gap-12">
      <header>
        <p className="font-mono text-xs uppercase tracking-[0.25em] text-stone-400">
          engram-code · ingest
        </p>
        <h1 className="mt-2 font-serif text-3xl tracking-tight text-stone-900 sm:text-4xl">
          Ingest a GitHub repo
        </h1>
        <p className="mt-4 text-stone-600">
          Paste a public GitHub URL. The worker clones it, runs the synth
          pipeline, and writes cards you can browse afterwards.
        </p>
      </header>

      <form
        onSubmit={onSubmit}
        className="flex flex-col gap-3 sm:flex-row sm:items-center"
      >
        <input
          type="url"
          required
          placeholder="https://github.com/owner/repo"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="flex-1 rounded-md border border-stone-300 bg-white px-4 py-2 font-mono text-sm shadow-sm focus:border-stone-500 focus:outline-none focus:ring-1 focus:ring-stone-500"
          data-testid="ingest-url"
          disabled={active.kind === 'submitting'}
        />
        <button
          type="submit"
          disabled={active.kind === 'submitting' || url.trim() === ''}
          data-testid="ingest-submit"
          className="rounded-full bg-stone-900 px-5 py-2 text-xs font-medium uppercase tracking-[0.15em] text-stone-50 transition-colors hover:bg-stone-700 disabled:bg-stone-400"
        >
          {active.kind === 'submitting' ? 'Submitting…' : 'Ingest'}
        </button>
      </form>

      {active.kind === 'tracking' && <JobProgress job={active.job} />}
      {active.kind === 'error' && (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50/60 p-4 font-mono text-sm text-red-700"
        >
          {active.message}
        </p>
      )}

      <RepoList repos={repos} />
      <RecentList recents={recents} />
    </section>
  );
}

function JobProgress({ job }: { job: IngestJob }) {
  const idx = STAGES.indexOf(job.stage);
  return (
    <div
      data-testid="ingest-progress"
      className="rounded-md border border-stone-200 bg-stone-50/50 p-5"
    >
      <div className="flex items-baseline justify-between gap-4">
        <p className="font-mono text-xs uppercase tracking-[0.15em] text-stone-500">
          {job.repoId}
        </p>
        <p className="font-mono text-xs text-stone-500">
          {job.status} · {job.progress}%
        </p>
      </div>
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-stone-200">
        <div
          className="h-2 bg-stone-700 transition-all"
          style={{ width: `${job.progress}%` }}
        />
      </div>
      <ol className="mt-4 flex flex-wrap gap-x-3 gap-y-1 font-mono text-xs text-stone-500">
        {STAGES.map((stage, i) => (
          <li
            key={stage}
            className={
              i < idx
                ? 'text-stone-400 line-through'
                : i === idx
                  ? 'font-semibold text-stone-900'
                  : 'text-stone-400'
            }
          >
            {STAGE_LABEL[stage]}
          </li>
        ))}
      </ol>
      {job.status === 'ready' && (
        <p className="mt-4 text-sm">
          <a
            className="underline underline-offset-4 hover:text-stone-700"
            href={`/?repo=${encodeURIComponent(job.repoId)}`}
          >
            Open repository card →
          </a>
        </p>
      )}
      {job.status === 'failed' && (
        <p className="mt-4 font-mono text-sm text-red-700">
          {job.errorKind ? `[${job.errorKind}] ` : ''}
          {job.error ?? 'Unknown failure'}
        </p>
      )}
    </div>
  );
}

function RepoList({ repos }: { repos: RepoSummary[] }) {
  if (repos.length === 0) return null;
  return (
    <div>
      <h2 className="font-serif text-xl text-stone-900">Ingested repos</h2>
      <ul className="mt-4 divide-y divide-stone-200">
        {repos.map((r) => (
          <li
            key={r.repoId}
            className="flex items-baseline justify-between py-2"
          >
            <a
              href={`/?repo=${encodeURIComponent(r.repoId)}`}
              className="font-mono text-sm text-stone-800 hover:underline"
            >
              {r.repoId}
            </a>
            <span className="font-mono text-xs text-stone-500">
              {r.cardCount} card{r.cardCount === 1 ? '' : 's'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RecentList({ recents }: { recents: IngestJob[] }) {
  if (recents.length === 0) return null;
  return (
    <div>
      <h2 className="font-serif text-xl text-stone-900">Recent ingests</h2>
      <ul className="mt-4 divide-y divide-stone-200" data-testid="ingest-recents">
        {recents.map((job) => (
          <li key={job.id} className="flex items-baseline justify-between py-2">
            <div className="flex flex-col">
              <span className="font-mono text-sm text-stone-800">
                {job.repoId}
              </span>
              <span className="font-mono text-xs text-stone-500">
                {new Date(job.startedAt).toLocaleString()}
              </span>
            </div>
            <div className="text-right">
              <span
                className={`font-mono text-xs uppercase tracking-[0.15em] ${
                  job.status === 'ready'
                    ? 'text-emerald-700'
                    : job.status === 'failed'
                      ? 'text-red-700'
                      : 'text-stone-500'
                }`}
              >
                {job.status}
              </span>
              {job.status === 'ready' && (
                <a
                  className="ml-3 underline underline-offset-4 text-xs hover:text-stone-700"
                  href={`/?repo=${encodeURIComponent(job.repoId)}`}
                >
                  open
                </a>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
