import { Suspense } from 'react';
import { MapView } from '@/components/map-view';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Map — engram-code',
  description: 'Nested view of the repository, level by level.',
};

export default function MapPage() {
  return (
    <main className="mx-auto w-full max-w-[1400px] px-6 py-16 sm:py-24">
      <Suspense fallback={null}>
        <MapView />
      </Suspense>
    </main>
  );
}
