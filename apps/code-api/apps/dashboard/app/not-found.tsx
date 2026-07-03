import Link from 'next/link';

export const metadata = {
  title: 'Not found — engram-code',
};

export default function NotFound() {
  return (
    <main className="mx-auto w-full max-w-[640px] px-6 py-24 sm:py-32">
      <section
        data-testid="not-found"
        className="flex flex-col gap-8 rounded-md border border-dashed border-stone-300 bg-stone-50/50 p-12 text-center"
      >
        <p className="font-mono text-xs uppercase tracking-[0.25em] text-stone-400">
          404
        </p>
        <h1 className="font-serif text-3xl tracking-tight text-stone-900 sm:text-4xl">
          That page doesn&apos;t live here. Maybe it never did.
        </h1>
        <p className="text-stone-500">
          The link you followed may be old, or the concept may have been renamed.
        </p>
        <div className="flex flex-col items-center gap-3 pt-4 sm:flex-row sm:justify-center sm:gap-6">
          <Link
            href="/"
            className="font-mono text-xs uppercase tracking-[0.15em] text-stone-700 underline underline-offset-4 hover:text-stone-900"
          >
            Back to the repo card
          </Link>
          <Link
            href="/subsystems"
            className="font-mono text-xs uppercase tracking-[0.15em] text-stone-700 underline underline-offset-4 hover:text-stone-900"
          >
            Browse subsystems
          </Link>
          <Link
            href="/search"
            className="font-mono text-xs uppercase tracking-[0.15em] text-stone-700 underline underline-offset-4 hover:text-stone-900"
          >
            Search concepts
          </Link>
        </div>
      </section>
    </main>
  );
}
