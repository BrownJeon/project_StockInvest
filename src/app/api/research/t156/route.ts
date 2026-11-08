import { NextRequest, NextResponse } from 'next/server';
import { requireUserId } from '@/lib/auth/current-user';
import { listDatasets, listTestArtifacts } from '@/lib/analysis-data/store';
import { paperForwardSummary } from '@/lib/strategy/m40/forward-store';

export const dynamic = 'force-dynamic';

/** Public-source archive inventory only. No account snapshots, judgments or artifact body download. */
export async function GET(req: NextRequest) {
  const user = await requireUserId(req);
  if (!user.ok) return user.res;
  const rawLimit = req.nextUrl.searchParams.get('limit');
  const limit = rawLimit === null ? 50 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return NextResponse.json({ ok: false, error: 'limit_must_be_1_to_100' }, { status: 400 });
  }
  try {
    const [datasets, artifacts,forward] = await Promise.all([listDatasets({ limit }), listTestArtifacts(limit),
      paperForwardSummary().catch(()=>({initialized:false,status:'unavailable'}))]);
    return NextResponse.json({ ok: true,
      forward,
      datasets: datasets.map(dataset => ({ id: dataset.id, kind: dataset.kind, sourceKey: dataset.sourceKey,
        status: dataset.status, liveEligible: dataset.liveEligible, contentSha256: dataset.contentSha256,
        rowCount: dataset.rowCount, createdAt: dataset.createdAt })),
      testArtifacts: artifacts.map(artifact => ({ artifactId: artifact.artifactId, filename: artifact.filename,
        sha256: artifact.sha256, role: artifact.role })),
      note: 'Inventory retains research limitations. Published does not imply live-eligible or strategy validation.',
    });
  } catch {
    return NextResponse.json({ ok: false, error: 't156_archive_unavailable' }, { status: 503 });
  }
}
