jest.mock('@/lib/credentials',()=>({getCredential:jest.fn(async(k:string)=>k)}));
jest.mock('@/lib/exchanges/kis-auth',()=>({getKisToken:jest.fn(async()=>'token'),kisBaseUrl:jest.fn(()=>'https://openapi.koreainvestment.com:9443')}));
jest.mock('@/lib/exchanges/kis-http',()=>({kisFetch:jest.fn(),kisBodyText:jest.fn(()=>null)}));
import { getKisToken } from '@/lib/exchanges/kis-auth';
import { getCredential } from '@/lib/credentials';
import { kisFetch } from '@/lib/exchanges/kis-http';
import { collectKisForwardIndex } from '../forward-index-kis';
import { indexEvidenceSha, KIS_SP500_SOURCE_URL } from '../forward-index-contract';
import { indexFixture } from './forward-index-fixtures';
const day=(s:string)=>`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
describe('licensed KIS read-only collection',()=>{
  const previous=process.env.KIS_MOCK;
  beforeEach(()=>{process.env.KIS_MOCK='false';jest.clearAllMocks();});
  afterEach(()=>{if(previous===undefined)delete process.env.KIS_MOCK;else process.env.KIS_MOCK=previous;jest.useRealTimers();});
  function setup(){const f=indexFixture();return {...f,collectOptions:{...f.options,fred:f.envelope.fred,now:()=>new Date(f.now),monotonicMs:()=>0}};}
  it('fills actual canonical gaps with short requests and retains all original pages',async()=>{
    const f=setup(),missing=new Set([f.rows[3].session,f.rows[4].session,f.rows[91].session]);
    const fetchPage=jest.fn(async(request:Readonly<Record<string,string>>)=>{
      const start=day(request.FID_INPUT_DATE_1),end=day(request.FID_INPUT_DATE_2);
      const short=Date.parse(end)-Date.parse(start)<7*86400_000;
      return {http:200,rawJson:f.raw(start,end,short?new Set():missing)};
    });
    const result=await collectKisForwardIndex(f.collectOptions,{fetchPage});
    expect(result.rows).toEqual(f.rows);expect(result).toMatchObject({basis:'index',series:'SP500',sourceUse:'evaluation_only',liveEligible:false});
    const envelope=JSON.parse(result.rawJson);expect(envelope.pages.length).toBe(9);expect(fetchPage).toHaveBeenCalledTimes(9);
    expect(result.sha256).toBe(indexEvidenceSha(result.rawJson));expect(result.sourceUrl).toBe(KIS_SP500_SOURCE_URL);
    expect(getKisToken).not.toHaveBeenCalled();expect(kisFetch).not.toHaveBeenCalled();
  });
  it('uses fixed licensed GET, exact params, bulk and zero automatic retries',async()=>{
    const f=setup();jest.mocked(kisFetch).mockImplementation(async(url)=>{
      const parsed=new URL(String(url));return new Response(f.raw(day(parsed.searchParams.get('FID_INPUT_DATE_1')!),day(parsed.searchParams.get('FID_INPUT_DATE_2')!)),{status:200});
    });
    await collectKisForwardIndex(f.collectOptions);
    for(const [url,init,options] of jest.mocked(kisFetch).mock.calls){
      expect(String(url).split('?')[0]).toBe(KIS_SP500_SOURCE_URL);const parsed=new URL(String(url));
      expect([...parsed.searchParams.keys()].sort()).toEqual(['FID_COND_MRKT_DIV_CODE','FID_INPUT_DATE_1','FID_INPUT_DATE_2','FID_INPUT_ISCD','FID_PERIOD_DIV_CODE'].sort());
      expect(parsed.searchParams.get('FID_INPUT_ISCD')).toBe('SPX');expect(parsed.searchParams.get('FID_COND_MRKT_DIV_CODE')).toBe('N');expect(parsed.searchParams.get('FID_PERIOD_DIV_CODE')).toBe('D');
      expect(init).toMatchObject({method:'GET',headers:{tr_id:'FHKST03030100',custtype:'P'}});
      expect(options).toMatchObject({priority:'bulk',timeoutMs:10_000,maxWaitMs:5000,rateLimitRetries:0,transientRetries:0});
    }
    expect(jest.mocked(getCredential).mock.calls.every(([key])=>['KIS_APP_KEY','KIS_APP_SECRET'].includes(key))).toBe(true);
  });
  it.each(['true','unknown',undefined])('rejects mock or unknown environment %s before transport',async(mock)=>{
    if(mock===undefined)delete process.env.KIS_MOCK;else process.env.KIS_MOCK=mock;
    const f=setup(),fetchPage=jest.fn();await expect(collectKisForwardIndex(f.collectOptions,{fetchPage})).rejects.toThrow('mock_ineligible');expect(fetchPage).not.toHaveBeenCalled();
  });
  it('fails on an invalid page before another request',async()=>{
    const f=setup(),fetchPage=jest.fn(async()=>({http:200,rawJson:'{"rt_cd":"0","output1":{"stck_shrn_iscd":"SPY"},"output2":[]}'}));
    await expect(collectKisForwardIndex(f.collectOptions,{fetchPage})).rejects.toThrow();expect(fetchPage).toHaveBeenCalledTimes(1);
  });
  it('fails without progress rather than looping or merging FRED prices',async()=>{
    const f=setup(),missing=new Set([f.rows[3].session]);
    const fetchPage=jest.fn(async(p:Readonly<Record<string,string>>)=>{
      const start=day(p.FID_INPUT_DATE_1),end=day(p.FID_INPUT_DATE_2);
      // Return a valid neighboring row for a gap request by widening would violate its request; empty stays failure.
      return {http:200,rawJson:f.raw(start,end,missing)};
    });
    await expect(collectKisForwardIndex(f.collectOptions,{fetchPage})).rejects.toThrow();expect(fetchPage.mock.calls.length).toBeLessThanOrEqual(8);
  });
  it('enforces the 16 request budget despite many noncontiguous missing sessions',async()=>{
    const f=setup(),missing=new Set(f.rows.filter((_,i)=>i%12===3).map(r=>r.session));
    const fetchPage=jest.fn(async(p:Readonly<Record<string,string>>)=>{
      const start=day(p.FID_INPUT_DATE_1),end=day(p.FID_INPUT_DATE_2),short=Date.parse(end)-Date.parse(start)<7*86400_000;
      return {http:200,rawJson:f.raw(start,end,short?new Set():missing)};
    });
    await expect(collectKisForwardIndex(f.collectOptions,{fetchPage})).rejects.toThrow('request_budget');expect(fetchPage).toHaveBeenCalledTimes(16);
  });
  it('bounds stalled transport to 90 seconds',async()=>{
    jest.useFakeTimers();const f=setup(),fetchPage=jest.fn(()=>new Promise<never>(()=>{}));
    const promise=collectKisForwardIndex(f.collectOptions,{fetchPage});const assertion=expect(promise).rejects.toThrow('deadline');
    await jest.advanceTimersByTimeAsync(90_000);await assertion;expect(fetchPage).toHaveBeenCalledTimes(1);
  });
  it('rejects reversed monotonic clocks without transport',async()=>{
    const f=setup(),clock=jest.fn().mockReturnValueOnce(10).mockReturnValue(9),fetchPage=jest.fn();
    await expect(collectKisForwardIndex({...f.collectOptions,monotonicMs:clock},{fetchPage})).rejects.toThrow('clock_reversed');expect(fetchPage).not.toHaveBeenCalled();
  });
});
