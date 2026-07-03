'use client';

import { useEffect, useRef, useState, type ComponentPropsWithoutRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { CardResponse, LodLevel } from '@/lib/schemas';
import { LodSwitcher } from './lod-switcher';

interface CardViewProps {
  card: CardResponse;
  lod?: LodLevel;
  onLodChange?: (next: LodLevel) => void;
}

function formatMetadataValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(formatMetadataValue).join(', ');
  return JSON.stringify(value);
}

const markdownComponents: ComponentPropsWithoutRef<typeof ReactMarkdown>['components'] = {
  code({ children, ...rest }) {
    return (
      <code {...rest} className="font-mono text-[0.92em]">
        {children}
      </code>
    );
  },
};

export function CardView({ card, lod, onLodChange }: CardViewProps) {
  const metadataEntries = Object.entries(card.metadata).filter(
    ([, value]) => value !== null && value !== undefined && value !== '',
  );

  const activeLod = lod ?? card.lod;
  const showSwitcher = typeof onLodChange === 'function';
  const isIndex = activeLod === 'index';

  const [bodyVisible, setBodyVisible] = useState(true);
  const lastContentRef = useRef(card.content);
  useEffect(() => {
    if (lastContentRef.current === card.content) return;
    lastContentRef.current = card.content;
    setBodyVisible(false);
    const raf = requestAnimationFrame(() => setBodyVisible(true));
    return () => cancelAnimationFrame(raf);
  }, [card.content]);

  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  }, []);

  const copyMarkdown = async () => {
    try {
      const nav = typeof navigator !== 'undefined' ? navigator : null;
      if (nav?.clipboard?.writeText) {
        await nav.clipboard.writeText(card.content);
      } else {
        throw new Error('Clipboard unavailable');
      }
      setToast('Copied');
    } catch {
      setToast('Copy failed');
    }
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 1800);
  };

  return (
    <article className="card-view relative" data-testid="card-view" data-lod={activeLod}>
      <div className="absolute right-0 top-0 flex items-center gap-3">
        {toast && (
          <span
            data-testid="card-toast"
            role="status"
            className="rounded-full border border-stone-300 bg-stone-50 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.15em] text-stone-600"
          >
            {toast}
          </span>
        )}
        <button
          type="button"
          onClick={copyMarkdown}
          data-testid="card-copy"
          aria-label="Copy as markdown"
          className="rounded-full border border-stone-300 bg-transparent px-3 py-1 text-[10px] font-medium uppercase tracking-[0.15em] text-stone-500 transition-colors hover:border-stone-500 hover:text-stone-800"
        >
          Copy markdown
        </button>
      </div>

      {showSwitcher && (
        <div className="mb-8 mr-32">
          <LodSwitcher value={activeLod} onChange={onLodChange!} />
        </div>
      )}

      {metadataEntries.length > 0 && (
        <dl
          className={`${isIndex ? 'mb-0' : 'mb-12'} grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm text-stone-500`}
          data-testid="card-metadata"
        >
          {metadataEntries.map(([key, value]) => (
            <div key={key} className="contents">
              <dt className="font-medium uppercase tracking-wide text-stone-400">
                {key.replace(/_/g, ' ')}
              </dt>
              <dd className="text-stone-600">{formatMetadataValue(value)}</dd>
            </div>
          ))}
        </dl>
      )}

      {!isIndex && (
        <div
          className={`prose prose-stone max-w-none transition-opacity duration-75 ease-out prose-headings:font-serif prose-headings:tracking-tight prose-h1:text-5xl prose-h1:leading-tight prose-h1:mb-8 prose-h2:text-3xl prose-h2:mt-12 prose-h3:text-xl prose-p:text-stone-700 prose-p:leading-relaxed prose-a:text-stone-900 prose-a:underline prose-a:underline-offset-4 prose-code:text-stone-800 prose-code:font-mono prose-code:before:content-none prose-code:after:content-none prose-code:bg-stone-100 prose-code:px-1 prose-code:py-0.5 prose-code:rounded ${
            bodyVisible ? 'opacity-100' : 'opacity-0'
          }`}
          data-testid="card-body"
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
            {card.content}
          </ReactMarkdown>
        </div>
      )}
    </article>
  );
}
