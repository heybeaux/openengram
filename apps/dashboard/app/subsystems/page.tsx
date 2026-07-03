import Link from 'next/link';
import { listSubsystems } from '@/lib/api';
import { SubsystemGrid } from '@/components/subsystem-grid';

export const dynamic = 'force-dynamic';

export default async function SubsystemsPage() {
  const { subsystems } = await listSubsystems();

  return (
    <main className="mx-auto w-full max-w-[1200px] px-6 py-16 sm:py-24">
      <header className="mb-12 flex flex-col gap-2">
        <Link
          href="/"
          className="font-mono text-xs uppercase tracking-[0.25em] text-stone-400 hover:text-stone-600"
        >
          ← engram-code
        </Link>
        <h1 className="font-serif text-3xl tracking-tight text-stone-900 sm:text-4xl">
          Subsystems
        </h1>
        <p className="text-stone-500">
          Discovered groupings of related modules across the repository.
        </p>
      </header>

      <SubsystemGrid subsystems={subsystems} />
    </main>
  );
}
