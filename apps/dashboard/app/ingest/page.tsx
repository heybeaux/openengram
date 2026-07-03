import { IngestPanel } from '@/components/ingest-panel';

export const dynamic = 'force-dynamic';

export default function IngestPage() {
  return (
    <main className="mx-auto w-full max-w-[720px] px-6 py-16 sm:py-24">
      <IngestPanel />
    </main>
  );
}
