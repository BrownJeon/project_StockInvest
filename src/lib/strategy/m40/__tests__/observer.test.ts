jest.mock('@/lib/db',()=>({getPool:()=>({query:jest.fn(async()=>[[{session:'2026-11-06'}],[]])})}));
jest.mock('@/lib/analysis-data/store',()=>({saveAnalysisRun:jest.fn(async()=>'saved'),jsonSha256:()=> 'a'.repeat(64),putJudgment:jest.fn(),findJudgment:jest.fn(),putSignalDraft:jest.fn()}));
jest.mock('../load-input',()=>({loadM40Input:jest.fn(async()=>{throw new Error('m40_policy_not_configured');})}));
jest.mock('../runner',()=>({runM40Analysis:jest.fn(),askConfiguredM40Agent:jest.fn()}));
jest.mock('../load-evidence',()=>({loadM40Evidence:jest.fn(async()=>({evidence:[],issues:[]}))}));
jest.mock('@/lib/analysis-data/capture-operating-data',()=>({captureOperatingData:jest.fn(async()=>({status:'partial'}))}));
import { observeM40Daily } from '../observer';
import { saveAnalysisRun } from '@/lib/analysis-data/store';
import { runM40Analysis } from '../runner';
import { loadM40Evidence } from '../load-evidence';
import { loadM40Input } from '../load-input';
import { captureOperatingData } from '@/lib/analysis-data/capture-operating-data';
test('missing policy persists an honest blocked audit without a synthetic account or model call',async()=>{
 const result=await observeM40Daily();expect(result.status).toBe('blocked');
 expect(saveAnalysisRun).toHaveBeenCalledWith(expect.objectContaining({sessionDate:'2026-11-06',status:'blocked',plan:{status:'blocked',reason:'m40_policy_not_configured',executionMode:'shadow'}}));
 expect(JSON.stringify(jest.mocked(saveAnalysisRun).mock.calls)).not.toContain('equityUsd');
 expect(runM40Analysis).not.toHaveBeenCalled();
});
test('archive failure stays in the companion without throwing into legacy execution',async()=>{
 jest.mocked(captureOperatingData).mockRejectedValueOnce(new Error('secret-provider-error'));
 await expect(observeM40Daily()).resolves.toEqual({status:'archive_unavailable',reason:'m40_archive_unavailable'});
});

test('optional evidence failure keeps the base path and uses the frozen input cutoff',async()=>{
 jest.mocked(loadM40Input).mockResolvedValueOnce({decisionTime:'2026-11-06T21:30:00Z'} as Awaited<ReturnType<typeof loadM40Input>>);
 jest.mocked(loadM40Evidence).mockResolvedValueOnce({evidence:[],issues:['operating_evidence_unavailable']});
 jest.mocked(runM40Analysis).mockResolvedValueOnce({runId:'run',draftCount:1,plan:{status:'ready'}} as Awaited<ReturnType<typeof runM40Analysis>>);
 await expect(observeM40Daily()).resolves.toMatchObject({status:'ready',runId:'run'});
 expect(loadM40Evidence).toHaveBeenLastCalledWith('2026-11-06T21:30:00Z');
 expect(runM40Analysis).toHaveBeenLastCalledWith(expect.objectContaining({optionalDataIssues:['operating_evidence_unavailable'],triggers:['optional_data_gap']}),expect.anything());
});
