import { ScenarioDetail } from '@/components/ScenarioDetail';

interface Props {
  params: { id: string };
}

export const dynamic = 'force-dynamic';

export default function RecommendDetailPage({ params }: Props) {
  const id = Number(params.id);
  return <ScenarioDetail signalId={id} />;
}
