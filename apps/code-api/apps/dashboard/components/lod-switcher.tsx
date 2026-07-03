'use client';

import { useEffect } from 'react';
import type { LodLevel } from '@/lib/schemas';

const LEVELS: ReadonlyArray<LodLevel> = ['index', 'summary', 'standard', 'deep'];

interface LodSwitcherProps {
  value: LodLevel;
  onChange: (next: LodLevel) => void;
}

export function LodSwitcher({ value, onChange }: LodSwitcherProps) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        return;
      }
      const index = Number.parseInt(event.key, 10) - 1;
      if (Number.isInteger(index) && index >= 0 && index < LEVELS.length) {
        onChange(LEVELS[index]!);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onChange]);

  return (
    <div
      role="radiogroup"
      aria-label="Level of detail"
      className="flex flex-wrap gap-2"
      data-testid="lod-switcher"
    >
      {LEVELS.map((level, idx) => {
        const active = value === level;
        return (
          <button
            key={level}
            type="button"
            role="radio"
            aria-checked={active}
            aria-keyshortcuts={String(idx + 1)}
            data-testid={`lod-${level}`}
            onClick={() => onChange(level)}
            className={`rounded-full border px-4 py-1.5 text-xs font-medium uppercase tracking-[0.15em] transition-colors ${
              active
                ? 'border-stone-900 bg-stone-900 text-stone-50'
                : 'border-stone-300 bg-transparent text-stone-500 hover:border-stone-500 hover:text-stone-700'
            }`}
          >
            <span className="mr-2 font-mono text-[10px] opacity-60">{idx + 1}</span>
            {level}
          </button>
        );
      })}
    </div>
  );
}
