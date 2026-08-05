import { ScenarioDetail } from '@/components/ScenarioDetail';

interface Props {
  params: Promise<{ id: string }>;
}

export const dynamic = 'force-dynamic';

export default async function RecommendDetailPage({ params }: Props) {
  const id = Number((await params).id);
  return <ScenarioDetail signalId={id} />;
}
