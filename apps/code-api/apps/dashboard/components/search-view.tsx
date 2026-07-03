'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { EngramCodeApi } from '@/lib/api';
import { cardKindSchema, type CardKind, type SearchConceptHit } from '@/lib/schemas';
import { EXAMPLE_QUERIES } from '@/lib/examples';
import { CardView } from './card-view';

const LEVELS: ReadonlyArray<CardKind> = [
  'repository',
  'subsystem',
  'module',
  'capability',
];

const LEVEL_LABELS: Record<CardKind, string> = {
  repository: 'REPOSITORY',
  subsystem: 'SUBSYSTEM',
  module: 'MODULE',
  capability: 'FILE',
};

interface SearchViewProps {
  client?: Pick<EngramCodeApi, 'searchConcept' | 'getCard'>;
}

type ResultsState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; hits: SearchConceptHit[]; totalFound: number; searchTimeMs: number };

type DetailState =
  | { status: 'closed' }
  | { status: 'loading'; conceptPath: string }
  | { status: 'error'; conceptPath: string; message: string }
  | { status: 'success'; card: import('@/lib/schemas').CardResponse };

function parseLevel(raw: string | null): CardKind | null {
  if (raw === null) return null;
  const parsed = cardKindSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function SearchView({ client }: SearchViewProps) {
  const router = useRouter();
  const params = useSearchParams();
  const apiRef = useRef<Pick<EngramCodeApi, 'searchConcept' | 'getCard'> | null>(null);
  if (!apiRef.current) {
    apiRef.current = client ?? new EngramCodeApi();
  }

  const initialQuery = params.get('q') ?? '';
  const initialLevel = parseLevel(params.get('level'));

  const [draft, setDraft] = useState(initialQuery);
  const [query, setQuery] = useState(initialQuery);
  const [level, setLevel] = useState<CardKind | null>(initialLevel);
  const [results, setResults] = useState<ResultsState>({ status: 'idle' });
  const [activeIndex, setActiveIndex] = useState(0);
  const [detail, setDetail] = useState<DetailState>({ status: 'closed' });

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key !== '/') return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const runSearch = useCallback(
    async (nextQuery: string, nextLevel: CardKind | null) => {
      const trimmed = nextQuery.trim();
      if (trimmed === '') {
        setResults({ status: 'idle' });
        return;
      }
      setResults({ status: 'loading' });
      setActiveIndex(0);
      try {
        const res = await apiRef.current!.searchConcept(trimmed, {
          lod: 'standard',
          ...(nextLevel !== null ? { level: nextLevel } : {}),
        });
        setResults({
          status: 'success',
          hits: res.results,
          totalFound: res.totalFound,
          searchTimeMs: res.searchTimeMs,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setResults({ status: 'error', message });
      }
    },
    [],
  );

  useEffect(() => {
    if (query.trim() === '') return;
    void runSearch(query, level);
  }, [query, level, runSearch]);

  const updateUrl = useCallback(
    (nextQuery: string, nextLevel: CardKind | null) => {
      const qs = new URLSearchParams();
      if (nextQuery.trim() !== '') qs.set('q', nextQuery.trim());
      if (nextLevel !== null) qs.set('level', nextLevel);
      const search = qs.toString();
      router.replace(search === '' ? '/search' : `/search?${search}`);
    },
    [router],
  );

  const onSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const trimmed = draft.trim();
      setQuery(trimmed);
      updateUrl(trimmed, level);
    },
    [draft, level, updateUrl],
  );

  const toggleLevel = useCallback(
    (next: CardKind) => {
      const newLevel = level === next ? null : next;
      setLevel(newLevel);
      updateUrl(query, newLevel);
    },
    [level, query, updateUrl],
  );

  const openDetail = useCallback(async (hit: SearchConceptHit) => {
    setDetail({ status: 'loading', conceptPath: hit.conceptPath });
    try {
      const card = await apiRef.current!.getCard(hit.conceptPath, 'standard');
      setDetail({ status: 'success', card });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setDetail({ status: 'error', conceptPath: hit.conceptPath, message });
    }
  }, []);

  const hits = results.status === 'success' ? results.hits : [];

  const onResultsKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (hits.length === 0) return;
      if (event.key === 'j' || event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, hits.length - 1));
      } else if (event.key === 'k' || event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const hit = hits[activeIndex];
        if (hit) void openDetail(hit);
      }
    },
    [hits, activeIndex, openDetail],
  );

  const queryTerms = useMemo(() => extractTerms(query), [query]);

  return (
    <section className="flex flex-col gap-10" data-testid="search-view">
      <header>
        <p className="font-mono text-xs uppercase tracking-[0.25em] text-stone-400">
          engram-code
        </p>
        <h1 className="mt-2 font-serif text-3xl tracking-tight text-stone-900 sm:text-4xl">
          Concept search
        </h1>
      </header>

      <form onSubmit={onSubmit} role="search" data-testid="search-form">
        <label htmlFor="concept-search" className="sr-only">
          Search concepts
        </label>
        <input
          id="concept-search"
          ref={inputRef}
          data-testid="search-input"
          type="search"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ask a question about this codebase…"
          autoComplete="off"
          aria-keyshortcuts="/"
          className="w-full rounded-xl border border-stone-300 bg-white px-6 py-6 font-serif text-2xl text-stone-900 placeholder:text-stone-400 focus:border-stone-900 focus:outline-none focus:ring-1 focus:ring-stone-900 sm:text-3xl"
        />
        <p className="mt-2 text-right font-mono text-[10px] uppercase tracking-[0.2em] text-stone-400">
          Press / to focus
        </p>
      </form>

      <div
        role="radiogroup"
        aria-label="Filter by level"
        className="flex flex-wrap gap-2"
        data-testid="filter-chips"
      >
        {LEVELS.map((lvl) => {
          const active = level === lvl;
          return (
            <button
              key={lvl}
              type="button"
              role="radio"
              aria-checked={active}
              data-testid={`filter-${lvl}`}
              onClick={() => toggleLevel(lvl)}
              className={`rounded-full border px-4 py-1.5 text-xs font-medium uppercase tracking-[0.15em] transition-colors ${
                active
                  ? 'border-stone-900 bg-stone-900 text-stone-50'
                  : 'border-stone-300 bg-transparent text-stone-500 hover:border-stone-500 hover:text-stone-700'
              }`}
            >
              {LEVEL_LABELS[lvl]}
            </button>
          );
        })}
      </div>

      <div
        className="min-h-[12rem]"
        data-testid="search-results"
        tabIndex={hits.length > 0 ? 0 : -1}
        onKeyDown={onResultsKeyDown}
        role="region"
        aria-label="Search results"
      >
        {results.status === 'idle' && <EmptyExamples onPick={(q) => {
          setDraft(q);
          setQuery(q);
          updateUrl(q, level);
        }} />}
        {results.status === 'loading' && <SearchSkeleton />}
        {results.status === 'error' && (
          <p role="alert" className="font-mono text-sm text-red-700" data-testid="search-error">
            Search failed: {results.message}
          </p>
        )}
        {results.status === 'success' && (
          <ResultsList
            hits={results.hits}
            totalFound={results.totalFound}
            searchTimeMs={results.searchTimeMs}
            activeIndex={activeIndex}
            terms={queryTerms}
            onSelect={(idx, hit) => {
              setActiveIndex(idx);
              void openDetail(hit);
            }}
          />
        )}
      </div>

      {detail.status !== 'closed' && (
        <DetailPanel
          detail={detail}
          onClose={() => setDetail({ status: 'closed' })}
        />
      )}
    </section>
  );
}

function EmptyExamples({ onPick }: { onPick: (q: string) => void }) {
  return (
    <div data-testid="search-examples" className="rounded-md border border-dashed border-stone-300 bg-stone-50/50 p-8">
      <p className="font-serif text-xl text-stone-700">Try an example</p>
      <ul className="mt-4 flex flex-col gap-3">
        {EXAMPLE_QUERIES.map((ex) => (
          <li key={ex.query}>
            <button
              type="button"
              data-testid="example-query"
              onClick={() => onPick(ex.query)}
              className="w-full rounded-md border border-stone-200 bg-white px-4 py-3 text-left transition-colors hover:border-stone-400"
            >
              <p className="font-serif text-base text-stone-900">{ex.query}</p>
              <p className="mt-1 text-xs text-stone-500">{ex.hint}</p>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SearchSkeleton() {
  return (
    <div data-testid="search-skeleton" className="animate-pulse space-y-4">
      <div className="h-24 rounded-md bg-stone-200" />
      <div className="h-24 rounded-md bg-stone-200" />
      <div className="h-24 rounded-md bg-stone-200" />
    </div>
  );
}

interface ResultsListProps {
  hits: SearchConceptHit[];
  totalFound: number;
  searchTimeMs: number;
  activeIndex: number;
  terms: string[];
  onSelect: (index: number, hit: SearchConceptHit) => void;
}

function ResultsList({ hits, totalFound, searchTimeMs, activeIndex, terms, onSelect }: ResultsListProps) {
  if (hits.length === 0) {
    return (
      <p data-testid="search-empty-results" className="font-serif text-lg text-stone-500">
        No results.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <p
        data-testid="search-meta"
        className="font-mono text-[10px] uppercase tracking-[0.2em] text-stone-400"
      >
        {totalFound} {totalFound === 1 ? 'result' : 'results'} · {searchTimeMs}ms
      </p>
      <ul className="flex flex-col gap-3">
        {hits.map((hit, idx) => {
          const active = idx === activeIndex;
          return (
            <li key={`${hit.conceptPath}-${idx}`}>
              <button
                type="button"
                data-testid="search-result"
                data-active={active ? 'true' : 'false'}
                onClick={() => onSelect(idx, hit)}
                className={`w-full rounded-md border bg-white p-6 text-left transition-colors ${
                  active ? 'border-stone-900' : 'border-stone-200 hover:border-stone-400'
                }`}
              >
                <div className="flex items-baseline justify-between gap-4">
                  <p className="font-serif text-xl text-stone-900">{hit.conceptPath}</p>
                  <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-stone-400">
                    {hit.level}
                  </span>
                </div>
                <p
                  className="mt-3 text-stone-600"
                  data-testid="search-snippet"
                  dangerouslySetInnerHTML={{ __html: highlightSnippet(hit.snippet, terms) }}
                />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

interface DetailPanelProps {
  detail: Extract<DetailState, { status: 'loading' | 'error' | 'success' }>;
  onClose: () => void;
}

function DetailPanel({ detail, onClose }: DetailPanelProps) {
  return (
    <div
      data-testid="search-detail"
      className="rounded-md border border-stone-300 bg-white p-8"
    >
      <div className="mb-6 flex items-center justify-between">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-stone-400">
          {detail.status === 'success' ? detail.card.conceptPath : detail.conceptPath}
        </p>
        <button
          type="button"
          onClick={onClose}
          data-testid="search-detail-close"
          className="rounded-full border border-stone-300 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.15em] text-stone-500 hover:border-stone-500 hover:text-stone-700"
        >
          Close
        </button>
      </div>
      {detail.status === 'loading' && (
        <p className="font-mono text-sm text-stone-500">Loading…</p>
      )}
      {detail.status === 'error' && (
        <p role="alert" className="font-mono text-sm text-red-700">
          {detail.message}
        </p>
      )}
      {detail.status === 'success' && <CardView card={detail.card} />}
    </div>
  );
}

function extractTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z0-9_-]/gi, ''))
    .filter((t) => t.length >= 2);
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function highlightSnippet(snippet: string, terms: string[]): string {
  const escaped = escapeHtml(snippet);
  if (terms.length === 0) return escaped;
  const pattern = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'gi');
  return escaped.replace(pattern, '<mark>$1</mark>');
}
