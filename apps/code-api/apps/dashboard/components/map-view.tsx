'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { ApiError, EngramCodeApi } from '@/lib/api';
import type { CardResponse, MapNode, MapResponse } from '@/lib/schemas';
import { CardView } from './card-view';

const DEPTHS = [1, 2, 3, 4, 5] as const;
const DEFAULT_DEPTH = 3;

interface MapViewProps {
  client?: Pick<EngramCodeApi, 'getMap' | 'getCard'>;
}

type MapState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; response: MapResponse };

type DetailState =
  | { status: 'idle' }
  | { status: 'loading'; conceptPath: string }
  | { status: 'error'; conceptPath: string; message: string }
  | { status: 'success'; card: CardResponse };

interface FlatNode {
  node: MapNode;
  depth: number;
  hasChildren: boolean;
}

function parseDepth(raw: string | null): number {
  if (raw === null) return DEFAULT_DEPTH;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) return DEFAULT_DEPTH;
  if (n < 1) return 1;
  if (n > 5) return 5;
  return n;
}

function lastSegment(conceptPath: string): string {
  const trimmed = conceptPath.replace(/\/+$/, '');
  if (trimmed === '' || trimmed === '.') return 'repository';
  const idx = trimmed.lastIndexOf('/');
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}

export function flattenVisible(
  nodes: MapNode[],
  expanded: ReadonlySet<string>,
  depth = 0,
): FlatNode[] {
  const out: FlatNode[] = [];
  for (const node of nodes) {
    const hasChildren = node.children.length > 0;
    out.push({ node, depth, hasChildren });
    if (hasChildren && expanded.has(node.conceptPath)) {
      out.push(...flattenVisible(node.children, expanded, depth + 1));
    }
  }
  return out;
}

export function MapView({ client }: MapViewProps) {
  const router = useRouter();
  const params = useSearchParams();

  const apiRef = useRef<Pick<EngramCodeApi, 'getMap' | 'getCard'> | null>(null);
  if (!apiRef.current) {
    apiRef.current = client ?? new EngramCodeApi();
  }

  const rootParam = params.get('root') ?? '';
  const depthParam = parseDepth(params.get('depth'));

  const [root, setRoot] = useState(rootParam);
  const [depth, setDepth] = useState(depthParam);
  const [map, setMap] = useState<MapState>({ status: 'loading' });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailState>({ status: 'idle' });

  useEffect(() => {
    setRoot(params.get('root') ?? '');
    setDepth(parseDepth(params.get('depth')));
  }, [params]);

  useEffect(() => {
    let cancelled = false;
    setMap({ status: 'loading' });
    apiRef.current!
      .getMap(root === '' ? undefined : root, depth)
      .then((response) => {
        if (cancelled) return;
        setMap({ status: 'success', response });
        const firstLevel = new Set<string>();
        for (const n of response.nodes) firstLevel.add(n.conceptPath);
        setExpanded(firstLevel);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setMap({ status: 'error', message });
      });
    return () => {
      cancelled = true;
    };
  }, [root, depth]);

  const flat = useMemo<FlatNode[]>(() => {
    if (map.status !== 'success') return [];
    return flattenVisible(map.response.nodes, expanded);
  }, [map, expanded]);

  const selectedIndex = useMemo(() => {
    if (selected === null) return -1;
    return flat.findIndex((f) => f.node.conceptPath === selected);
  }, [flat, selected]);

  const loadDetail = useCallback(async (conceptPath: string) => {
    setDetail({ status: 'loading', conceptPath });
    try {
      const card = await apiRef.current!.getCard(conceptPath, 'standard');
      setDetail({ status: 'success', card });
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setDetail({
          status: 'error',
          conceptPath,
          message: `No card at ${conceptPath}`,
        });
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      setDetail({ status: 'error', conceptPath, message });
    }
  }, []);

  const select = useCallback(
    (conceptPath: string) => {
      setSelected(conceptPath);
      void loadDetail(conceptPath);
    },
    [loadDetail],
  );

  const toggleExpand = useCallback((conceptPath: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(conceptPath)) next.delete(conceptPath);
      else next.add(conceptPath);
      return next;
    });
  }, []);

  const expand = useCallback((conceptPath: string) => {
    setExpanded((prev) => {
      if (prev.has(conceptPath)) return prev;
      const next = new Set(prev);
      next.add(conceptPath);
      return next;
    });
  }, []);

  const collapse = useCallback((conceptPath: string) => {
    setExpanded((prev) => {
      if (!prev.has(conceptPath)) return prev;
      const next = new Set(prev);
      next.delete(conceptPath);
      return next;
    });
  }, []);

  const updateUrl = useCallback(
    (nextRoot: string, nextDepth: number) => {
      const qs = new URLSearchParams();
      if (nextRoot !== '') qs.set('root', nextRoot);
      if (nextDepth !== DEFAULT_DEPTH) qs.set('depth', String(nextDepth));
      const search = qs.toString();
      router.replace(search === '' ? '/map' : `/map?${search}`);
    },
    [router],
  );

  const onDepthChange = useCallback(
    (next: number) => {
      setDepth(next);
      updateUrl(root, next);
    },
    [root, updateUrl],
  );

  const onTreeKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (flat.length === 0) return;
      const node = selectedIndex >= 0 ? flat[selectedIndex]?.node : undefined;
      if (event.key === 'j' || event.key === 'ArrowDown') {
        event.preventDefault();
        if (selectedIndex < 0) {
          select(flat[0].node.conceptPath);
        } else {
          const next = Math.min(selectedIndex + 1, flat.length - 1);
          select(flat[next].node.conceptPath);
        }
      } else if (event.key === 'k' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (selectedIndex < 0) {
          select(flat[0].node.conceptPath);
        } else {
          const prev = Math.max(selectedIndex - 1, 0);
          select(flat[prev].node.conceptPath);
        }
      } else if (event.key === 'Enter') {
        event.preventDefault();
        if (node && node.children.length > 0) toggleExpand(node.conceptPath);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        if (node && node.children.length > 0) expand(node.conceptPath);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        if (node && node.children.length > 0 && expanded.has(node.conceptPath)) {
          collapse(node.conceptPath);
        }
      }
    },
    [flat, selectedIndex, select, toggleExpand, expand, collapse, expanded],
  );

  return (
    <section
      className="flex flex-col gap-8"
      data-testid="map-view"
    >
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Link
            href="/"
            className="font-mono text-xs uppercase tracking-[0.25em] text-stone-400 hover:text-stone-600"
          >
            ← engram-code
          </Link>
          <h1 className="mt-2 font-serif text-3xl tracking-tight text-stone-900 sm:text-4xl">
            Repository map
          </h1>
          {root !== '' && (
            <p
              className="mt-2 font-mono text-xs text-stone-500"
              data-testid="map-root"
            >
              rooted at <span className="text-stone-700">{root}</span>
            </p>
          )}
        </div>
        <div
          className="flex items-center gap-2"
          role="radiogroup"
          aria-label="Map depth"
          data-testid="depth-selector"
        >
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-stone-400">
            Depth
          </span>
          {DEPTHS.map((d) => {
            const active = depth === d;
            return (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={active}
                data-testid={`depth-${d}`}
                onClick={() => onDepthChange(d)}
                className={`h-8 w-8 rounded-full border text-xs font-medium transition-colors ${
                  active
                    ? 'border-stone-900 bg-stone-900 text-stone-50'
                    : 'border-stone-300 bg-transparent text-stone-500 hover:border-stone-500 hover:text-stone-700'
                }`}
              >
                {d}
              </button>
            );
          })}
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div
          className="overflow-hidden rounded-md border border-stone-200 bg-white"
          data-testid="map-tree-pane"
        >
          {map.status === 'loading' && <TreeSkeleton />}
          {map.status === 'error' && (
            <p
              role="alert"
              data-testid="map-error"
              className="p-6 font-mono text-sm text-red-700"
            >
              Couldn&apos;t load the map: {map.message}
            </p>
          )}
          {map.status === 'success' && map.response.nodes.length === 0 && (
            <p
              data-testid="map-empty"
              className="p-6 font-serif text-stone-500"
            >
              Nothing here yet.
            </p>
          )}
          {map.status === 'success' && map.response.nodes.length > 0 && (
            <div
              role="tree"
              tabIndex={0}
              onKeyDown={onTreeKeyDown}
              data-testid="map-tree"
              className="max-h-[70vh] overflow-y-auto overflow-x-hidden focus:outline-none"
            >
              <ul className="flex flex-col" role="presentation">
                {flat.map((entry) => (
                  <TreeRow
                    key={entry.node.conceptPath}
                    entry={entry}
                    selected={selected === entry.node.conceptPath}
                    expanded={expanded.has(entry.node.conceptPath)}
                    onSelect={select}
                    onToggle={toggleExpand}
                  />
                ))}
              </ul>
            </div>
          )}
        </div>

        <div
          className="min-h-[24rem] overflow-hidden rounded-md border border-stone-200 bg-white p-8"
          data-testid="map-detail-pane"
        >
          {detail.status === 'idle' && (
            <div
              data-testid="map-detail-empty"
              className="flex h-full min-h-[20rem] flex-col items-center justify-center text-center"
            >
              <p className="font-serif text-xl text-stone-700">
                Pick a card to read.
              </p>
              <p className="mt-2 font-mono text-xs text-stone-500">
                Use j / k to move, ← → to fold.
              </p>
            </div>
          )}
          {detail.status === 'loading' && (
            <p
              data-testid="map-detail-loading"
              className="font-mono text-sm text-stone-500"
            >
              Loading {detail.conceptPath}…
            </p>
          )}
          {detail.status === 'error' && (
            <p
              role="alert"
              data-testid="map-detail-error"
              className="font-mono text-sm text-red-700"
            >
              {detail.message}
            </p>
          )}
          {detail.status === 'success' && <CardView card={detail.card} />}
        </div>
      </div>
    </section>
  );
}

interface TreeRowProps {
  entry: FlatNode;
  selected: boolean;
  expanded: boolean;
  onSelect: (conceptPath: string) => void;
  onToggle: (conceptPath: string) => void;
}

function TreeRow({ entry, selected, expanded, onSelect, onToggle }: TreeRowProps) {
  const { node, depth, hasChildren } = entry;
  return (
    <li role="treeitem" aria-expanded={hasChildren ? expanded : undefined}>
      <div
        className={`flex items-start gap-1 border-l-2 px-3 py-2 transition-colors ${
          selected
            ? 'border-stone-900 bg-stone-50'
            : 'border-transparent hover:bg-stone-50'
        }`}
        style={{ paddingLeft: `${0.75 + depth * 1.25}rem` }}
        data-testid="map-row"
        data-depth={depth}
        data-selected={selected ? 'true' : 'false'}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggle(node.conceptPath);
            }}
            aria-label={expanded ? 'Collapse' : 'Expand'}
            data-testid="map-row-toggle"
            data-expanded={expanded ? 'true' : 'false'}
            className="mt-1 inline-flex h-4 w-4 shrink-0 items-center justify-center text-stone-400 hover:text-stone-700"
          >
            <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
          </button>
        ) : (
          <span aria-hidden="true" className="mt-1 inline-block h-4 w-4 shrink-0" />
        )}
        <button
          type="button"
          onClick={() => onSelect(node.conceptPath)}
          data-testid="map-row-select"
          className="flex min-w-0 flex-1 flex-col text-left"
        >
          <span className="flex items-baseline gap-2">
            <span
              className={`truncate font-serif text-base ${
                selected ? 'text-stone-900' : 'text-stone-800'
              }`}
              data-testid="map-row-label"
            >
              {lastSegment(node.conceptPath)}
            </span>
            <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-stone-400">
              {node.level}
            </span>
          </span>
          <span
            className="line-clamp-1 text-sm text-stone-500"
            data-testid="map-row-summary"
          >
            {node.summary || '—'}
          </span>
        </button>
      </div>
    </li>
  );
}

function TreeSkeleton() {
  return (
    <div data-testid="map-skeleton" className="animate-pulse space-y-3 p-6">
      <div className="h-5 w-3/4 rounded bg-stone-200" />
      <div className="h-5 w-2/3 rounded bg-stone-200" />
      <div className="h-5 w-1/2 rounded bg-stone-200" />
      <div className="h-5 w-3/5 rounded bg-stone-200" />
    </div>
  );
}
