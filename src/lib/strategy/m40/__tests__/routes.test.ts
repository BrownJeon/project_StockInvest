import { NextRequest, NextResponse } from 'next/server';
import { POST } from '@/app/api/cron/m40-analysis/route';
import { GET } from '@/app/api/research/t156/route';
import { checkCronAuth } from '@/lib/cron-auth';
import { requireUserId } from '@/lib/auth/current-user';
import { loadM40Input } from '../load-input';
import { runM40Analysis } from '../runner';
import { listDatasets, listTestArtifacts } from '@/lib/analysis-data/store';

jest.mock('../load-evidence',()=>({loadM40Evidence:jest.fn(async()=>({evidence:[],issues:[]}))}));
jest.mock('@/lib/cron-auth', () => ({ checkCronAuth: jest.fn() }));
jest.mock('@/lib/auth/current-user', () => ({ requireUserId: jest.fn() }));
jest.mock('../load-input', () => ({ loadM40Input: jest.fn() }));
jest.mock('../runner', () => ({ runM40Analysis: jest.fn(), askConfiguredM40Agent: jest.fn() }));
jest.mock('@/lib/analysis-data/store', () => ({ saveAnalysisRun: jest.fn(), putJudgment: jest.fn(),
  findJudgment: jest.fn(), putSignalDraft: jest.fn(), listDatasets: jest.fn(), listTestArtifacts: jest.fn() }));

describe('T-156 authenticated archive and cron entry points', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('checks the cron secret before loading inputs or writing analysis', async () => {
    jest.mocked(checkCronAuth).mockReturnValue(NextResponse.json({ ok: false }, { status: 401 }));
    const response = await POST(new NextRequest('http://localhost/api/cron/m40-analysis', { method: 'POST' }));
    expect(response.status).toBe(401);
    expect(loadM40Input).not.toHaveBeenCalled();
    expect(runM40Analysis).not.toHaveBeenCalled();
  });

  it('keeps unavailable core inputs fail closed and reports only known safe error codes', async () => {
    jest.mocked(checkCronAuth).mockReturnValue(undefined);
    jest.mocked(loadM40Input).mockRejectedValueOnce(new Error('m40_input_not_published'));
    let response = await POST(new NextRequest('http://localhost/api/cron/m40-analysis', { method: 'POST' }));
    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe('m40_input_not_published');
    jest.mocked(loadM40Input).mockRejectedValueOnce(new Error('password=private-exception'));
    response = await POST(new NextRequest('http://localhost/api/cron/m40-analysis', { method: 'POST' }));
    expect(JSON.stringify(await response.json())).not.toContain('private-exception');
    expect(runM40Analysis).not.toHaveBeenCalled();
  });

  it('rejects future decisions before consulting the data source', async () => {
    jest.mocked(checkCronAuth).mockReturnValue(undefined);
    const response = await POST(new NextRequest('http://localhost/api/cron/m40-analysis?decision_at=2099-01-01T00:00:00Z', { method: 'POST' }));
    expect(response.status).toBe(400);
    expect(loadM40Input).not.toHaveBeenCalled();
  });

  it('requires a signed user session before showing source metadata', async () => {
    jest.mocked(requireUserId).mockResolvedValue({ ok: false, res: NextResponse.json({ ok: false }, { status: 401 }) });
    const response = await GET(new NextRequest('http://localhost/api/research/t156'));
    expect(response.status).toBe(401);
    expect(listDatasets).not.toHaveBeenCalled();
    expect(listTestArtifacts).not.toHaveBeenCalled();
  });

  it('exposes a limited inventory without snapshot, account or artifact metadata payloads', async () => {
    jest.mocked(requireUserId).mockResolvedValue({ ok: true, userId: 7 });
    jest.mocked(listDatasets).mockResolvedValue([{ id: 'public', kind: 'source', sourceKey: 'public-source', status: 'published',
      liveEligible: false, contentSha256: null, rowCount: 2, metadata: { account: 'private-account-field' }, createdAt: '2026-11-08T00:00:00Z' }]);
    jest.mocked(listTestArtifacts).mockResolvedValue([{ artifactId: 'test', filename: 'test.json', sha256: 'abc', role: 'result',
      metadata: { account: 'private-artifact-field' } }]);
    const response = await GET(new NextRequest('http://localhost/api/research/t156?limit=10'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.datasets[0].liveEligible).toBe(false);
    expect(JSON.stringify(body)).not.toContain('private-');
    expect(body.datasets[0].metadata).toBeUndefined();
    expect(body.testArtifacts[0].metadata).toBeUndefined();
  });
});
