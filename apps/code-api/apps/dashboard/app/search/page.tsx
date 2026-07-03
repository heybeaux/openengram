import { Suspense } from 'react';
import { SearchView } from '@/components/search-view';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Search — engram-code',
  description: 'Concept search across the codebase.',
};

export default function SearchPage() {
  return (
    <main className="mx-auto w-full max-w-[820px] px-6 py-16 sm:py-24">
      <Suspense fallback={null}>
        <SearchView />
      </Suspense>
    </main>
  );
}
