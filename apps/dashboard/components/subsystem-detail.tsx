'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, EngramCodeApi } from '@/lib/api';
import type { CardResponse, LodLevel } from '@/lib/schemas';
import { useLodPersistence } from '@/lib/use-lod-persistence';
import { CardView } from './card-view';

interface SubsystemDetailProps {
  slug: string;
  initialLod?: LodLevel;
  client?: Pick<EngramCodeApi, 'getCard'>;
}

type CardState =
  | { status: 'loading' }
  | { status: 'not_found' }
  | { status: 'error'; message: string }
  | { status: 'success'; card: CardResponse };

export function SubsystemDetail({
  slug,
  initialLod = 'standard',
  client,
}: SubsystemDetailProps) {
  const [lod, setLod] = useLodPersistence(initialLod);
  const [state, setState] = useState<CardState>({ status: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);

  const conceptPath = `subsystems/${slug}`;
  const mapHref = `/map?root=${encodeURIComponent(conceptPath)}`;

  useEffect(() => {
    const api = client ?? new EngramCodeApi();
    let cancelled = false;
    setState({ status: 'loading' });
    api
      .getCard(conceptPath, lod)
      .then((card) => {
        if (cancelled) return;
        setState({ status: 'success', card });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          setState({ status: 'not_found' });
          return;
        }
        const message = err instanceof Error ? err.message : String(err);
        setState({ status: 'error', message });
      });
    return () => {
      cancelled = true;
    };
  }, [conceptPath, lod, client, reloadKey]);

  const retry = useCallback(() => setReloadKey((n) => n + 1), []);

  return (
    <section className="flex flex-col gap-12">
      <header className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Link
            href="/subsystems"
            className="font-mono text-xs uppercase tracking-[0.25em] text-stone-400 hover:text-stone-600"
          >
            ← subsystems
          </Link>
          <h1 className="mt-2 font-serif text-3xl tracking-tight text-stone-900 sm:text-4xl">
            {slug}
          </h1>
        </div>
        <Link
          href={mapHref}
          data-testid="open-in-repo-map"
          className="self-end rounded-full border border-stone-300 px-4 py-1.5 text-xs font-medium uppercase tracking-[0.15em] text-stone-600 transition-colors hover:border-stone-500 hover:text-stone-900"
        >
          Open in repo map →
        </Link>
      </header>

      <div className="min-h-[24rem]">
        {state.status === 'loading' && <LoadingSkeleton />}
        {state.status === 'not_found' && <NotFoundState slug={slug} />}
        {state.status === 'error' && (
          <ErrorState message={state.message} onRetry={retry} />
        )}
        {state.status === 'success' && (
          <CardView card={state.card} lod={lod} onLodChange={setLod} />
        )}
      </div>
    </section>
  );
}

function LoadingSkeleton() {
  return (
    <div data-testid="subsystem-skeleton" className="animate-pulse space-y-6">
      <div className="h-3 w-32 rounded bg-stone-200" />
      <div className="h-10 w-3/4 rounded bg-stone-200" />
      <div className="space-y-3">
        <div className="h-4 w-full rounded bg-stone-200" />
        <div className="h-4 w-11/12 rounded bg-stone-200" />
        <div className="h-4 w-10/12 rounded bg-stone-200" />
      </div>
    </div>
  );
}

function NotFoundState({ slug }: { slug: string }) {
  return (
    <div
      data-testid="subsystem-not-found"
      role="alert"
      className="rounded-md border border-dashed border-stone-300 bg-stone-50/50 p-12 text-center"
    >
      <p className="font-serif text-2xl text-stone-700">Subsystem not found</p>
      <p className="mt-4 font-mono text-sm text-stone-500">
        No card exists at <code className="text-stone-700">subsystems/{slug}</code>.
      </p>
      <Link
        href="/subsystems"
        className="mt-6 inline-block font-mono text-xs uppercase tracking-[0.15em] text-stone-600 underline underline-offset-4 hover:text-stone-900"
      >
        Back to subsystems
      </Link>
    </div>
  );
}

function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div
      data-testid="subsystem-error"
      role="alert"
      className="rounded-md border border-red-200 bg-red-50/60 p-8"
    >
      <p className="font-serif text-xl text-red-900">Couldn&apos;t load the card</p>
      <p className="mt-2 break-words font-mono text-sm text-red-700">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        data-testid="subsystem-retry"
        className="mt-6 rounded-full border border-red-300 px-4 py-1.5 text-xs font-medium uppercase tracking-[0.15em] text-red-700 transition-colors hover:bg-red-100"
      >
        Retry
      </button>
    </div>
  );
}
