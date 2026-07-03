import { SubsystemDetail } from '@/components/subsystem-detail';

export const dynamic = 'force-dynamic';

interface SubsystemDetailPageProps {
  params: Promise<{ name: string }>;
}

export default async function SubsystemDetailPage({
  params,
}: SubsystemDetailPageProps) {
  const { name } = await params;
  const slug = decodeURIComponent(name);

  return (
    <main className="mx-auto w-full max-w-[960px] px-6 py-16 sm:py-24">
      <SubsystemDetail slug={slug} />
    </main>
  );
}
