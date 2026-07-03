import Link from 'next/link';
import type { Subsystem } from '@/lib/schemas';

interface SubsystemGridProps {
  subsystems: ReadonlyArray<Subsystem>;
}

export function SubsystemGrid({ subsystems }: SubsystemGridProps) {
  if (subsystems.length === 0) {
    return (
      <div
        data-testid="subsystems-empty"
        className="rounded-md border border-dashed border-stone-300 bg-stone-50/50 p-12 text-center"
      >
        <p className="font-serif text-2xl text-stone-700">
          No subsystems synthesized yet
        </p>
        <p className="mt-4 text-stone-500">
          Run{' '}
          <code className="rounded bg-stone-100 px-2 py-1 font-mono text-sm text-stone-700">
            engram-code synth subsystems
          </code>{' '}
          to discover them.
        </p>
      </div>
    );
  }

  return (
    <ul
      data-testid="subsystem-grid"
      className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-3"
    >
      {subsystems.map((sub) => (
        <li key={sub.slug}>
          <Link
            href={`/subsystems/${encodeURIComponent(sub.slug)}`}
            data-testid={`subsystem-card-${sub.slug}`}
            className="group flex h-full flex-col gap-4 rounded-md border border-stone-200 bg-white p-6 transition-colors hover:border-stone-400"
          >
            <div className="flex items-start justify-between gap-4">
              <h2 className="font-serif text-2xl tracking-tight text-stone-900 group-hover:text-stone-700">
                {sub.name}
              </h2>
              <span
                data-testid={`subsystem-count-${sub.slug}`}
                className="shrink-0 rounded-full border border-stone-300 px-3 py-1 font-mono text-xs uppercase tracking-[0.15em] text-stone-500"
              >
                {sub.memberCount} {sub.memberCount === 1 ? 'file' : 'files'}
              </span>
            </div>
            {sub.description && (
              <p className="line-clamp-2 text-sm text-stone-600">
                {sub.description}
              </p>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}
