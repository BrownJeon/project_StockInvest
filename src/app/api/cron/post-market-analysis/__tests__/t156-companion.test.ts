jest.mock('next/server',()=>({...jest.requireActual('next/server'),after:jest.fn()}));
jest.mock('@/lib/cron-auth',()=>({checkCronAuth:jest.fn(()=>undefined)}));
jest.mock('@/lib/strategy/post-market-engine',()=>({runPostMarketAnalysis:jest.fn()}));
jest.mock('@/lib/strategy/m40/observer',()=>({observeM40Daily:jest.fn()}));
import { NextRequest,after } from 'next/server';
import { POST } from '../route';
import { runPostMarketAnalysis } from '@/lib/strategy/post-market-engine';
import { observeM40Daily } from '@/lib/strategy/m40/observer';
const baseline={market:'overseas',symbolsEvaluated:125,candidatesFound:3,signalsCreated:0,signalsSkipped:3,errors:[],validFrom:'2026-11-09',ok:true,status:'ok'} as const;
beforeEach(()=>jest.clearAllMocks());
test('companion failure preserves successful legacy result and retry status',async()=>{
 jest.mocked(runPostMarketAnalysis).mockResolvedValue({...baseline});jest.mocked(observeM40Daily).mockRejectedValue(new Error('private-error'));
 const response=await POST(new NextRequest('http://localhost/api/cron/post-market-analysis?market=overseas',{method:'POST'}));
 expect(response.status).toBe(200);const body=await response.json();expect(body.signalsCreated).toBe(0);expect(body.m40.status).toBe('scheduled');
 expect(observeM40Daily).not.toHaveBeenCalled();
 const callback=jest.mocked(after).mock.calls[0][0] as ()=>Promise<void>;
 await expect(callback()).resolves.toBeUndefined();expect(JSON.stringify(body)).not.toContain('private-error');
});
test.each(['overseas_disabled','no_new_session'] as const)('disabled or no-session skip has no companion I/O (%s)',async skipped=>{
 jest.mocked(runPostMarketAnalysis).mockResolvedValue({...baseline,skipped});
 const response=await POST(new NextRequest('http://localhost/api/cron/post-market-analysis?market=overseas',{method:'POST'}));
 expect(response.status).toBe(200);expect(observeM40Daily).not.toHaveBeenCalled();
});
test('domestic and failed overseas analysis do not invoke the companion',async()=>{
 jest.mocked(runPostMarketAnalysis).mockResolvedValue({...baseline,market:'domestic'});
 await POST(new NextRequest('http://localhost/api/cron/post-market-analysis?market=domestic',{method:'POST'}));
 jest.mocked(runPostMarketAnalysis).mockResolvedValue({...baseline,ok:false,status:'data_unknown'});
 const response=await POST(new NextRequest('http://localhost/api/cron/post-market-analysis?market=overseas',{method:'POST'}));
 expect(response.status).toBe(503);expect(observeM40Daily).not.toHaveBeenCalled();
});
