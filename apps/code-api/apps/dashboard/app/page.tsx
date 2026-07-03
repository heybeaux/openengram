import { HomeCard } from '@/components/home-card';

export const dynamic = 'force-dynamic';

interface HomeProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function Home({ searchParams }: HomeProps) {
  const params = (await searchParams) ?? {};
  const raw = params.repo;
  const repoId = typeof raw === 'string' && raw !== '' ? raw : undefined;
  return (
    <main className="mx-auto w-full max-w-[720px] px-6 py-16 sm:py-24">
      <HomeCard repoId={repoId} />
    </main>
  );
}
