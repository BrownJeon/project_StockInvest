jest.mock('@/lib/credentials',()=>({getCredential:jest.fn(async()=> 'fixture')}));
jest.mock('@/lib/exchanges/kis-auth',()=>({getKisToken:jest.fn(async()=> 'fixture-token'),kisBaseUrl:()=> 'https://openapi.koreainvestment.com:9443'}));
jest.mock('@/lib/exchanges/kis-throttle',()=>({acquireKisSlot:jest.fn(async()=>{}),currentKisPriority:()=> 'normal',DEFAULT_MAX_QUEUE_WAIT_MS:30000}));
jest.mock('@/lib/api-usage',()=>({logUsage:jest.fn(),opOf:(v:string)=>v,usageClock:()=>0,usageErrKind:()=> 'other'}));
import { kisFetch, kisBodyText, type KisFetchOptions } from '../kis-http';
import { collectKisForwardIndex } from '@/lib/strategy/m40/forward-index-kis';
import { indexFixture } from '@/lib/strategy/m40/__tests__/forward-index-fixtures';
import { acquireKisSlot } from '../kis-throttle';
const url='https://openapi.koreainvestment.com:9443/uapi/overseas-price/v1/quotations/inquire-daily-chartprice?FID_COND_MRKT_DIV_CODE=N&FID_INPUT_ISCD=SPX&FID_INPUT_DATE_1=20250102&FID_INPUT_DATE_2=20250228&FID_PERIOD_DIV_CODE=D';
const originalFetch=global.fetch;
function setup(){const parent=new AbortController(),init:RequestInit={method:'GET',signal:parent.signal,headers:{tr_id:'FHKST03030100',custtype:'P'}};
  const options:KisFetchOptions={priority:'bulk',timeoutMs:10000,maxWaitMs:5000,rateLimitRetries:0,transientRetries:0,maxResponseBytes:32,bodyDeadlineMs:90000};
  return {parent,init,options};}
function bodyStream(){let streamController:ReadableStreamDefaultController<Uint8Array>;
  const cancel=jest.fn();const stream=new ReadableStream<Uint8Array>({start(c){streamController=c;},cancel});
  return {stream,cancel,push:(s:string)=>streamController.enqueue(new TextEncoder().encode(s)),close:()=>streamController.close()};}
describe('opt-in SPX GET bounds without changing legacy behavior',()=>{
  beforeEach(()=>{jest.clearAllMocks();global.fetch=jest.fn();});
  afterEach(()=>{global.fetch=originalFetch;jest.useRealTimers();});
  it('preserves a complete bounded raw body for replay and metadata',async()=>{
    const f=setup();jest.mocked(fetch).mockResolvedValue(new Response('{"rt_cd":"0"}',{status:200}));
    const response=await kisFetch(url,f.init,f.options);expect(kisBodyText(response)).toBe('{"rt_cd":"0"}');expect(await response.text()).toBe('{"rt_cd":"0"}');
    expect(jest.mocked(fetch).mock.calls[0][1]).toMatchObject({redirect:'error',method:'GET'});expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('aborts the socket and cancels the reader on streaming overflow, before EOF',async()=>{
    const f=setup(),s=bodyStream();let socket:AbortSignal|undefined;
    jest.mocked(fetch).mockImplementation(async(_,init)=>{socket=init?.signal as AbortSignal;return new Response(s.stream);});
    const p=kisFetch(url,f.init,f.options),assertion=expect(p).rejects.toThrow('response_budget');
    await Promise.resolve();await Promise.resolve();s.push('x'.repeat(33));await assertion;
    expect(s.cancel).toHaveBeenCalledTimes(1);expect(socket!.aborted).toBe(true);expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('rejects an oversized declared body without collecting it',async()=>{
    const f=setup(),s=bodyStream();jest.mocked(fetch).mockResolvedValue(new Response(s.stream,{headers:{'Content-Length':'33'}}));
    await expect(kisFetch(url,f.init,f.options)).rejects.toThrow('response_budget');expect(s.cancel).toHaveBeenCalledTimes(1);
  });
  it('cancels a body that stalls after headers when deadline expires',async()=>{
    jest.useFakeTimers();const f=setup(),s=bodyStream();let socket:AbortSignal|undefined;
    jest.mocked(fetch).mockImplementation(async(_,init)=>{socket=init?.signal as AbortSignal;return new Response(s.stream);});
    const p=kisFetch(url,f.init,{...f.options,bodyDeadlineMs:50}),assertion=expect(p).rejects.toThrow('deadline');
    await jest.advanceTimersByTimeAsync(50);await assertion;
    expect(s.cancel).toHaveBeenCalledTimes(1);expect(socket!.aborted).toBe(true);expect(jest.getTimerCount()).toBe(0);
  });
  it('honors parent abort during body read and clears timers/listener',async()=>{
    jest.useFakeTimers();const f=setup(),s=bodyStream(),remove=jest.spyOn(f.parent.signal,'removeEventListener');
    jest.mocked(fetch).mockResolvedValue(new Response(s.stream));const p=kisFetch(url,f.init,f.options),assertion=expect(p).rejects.toThrow('aborted');
    await jest.advanceTimersByTimeAsync(0);f.parent.abort();await assertion;
    expect(s.cancel).toHaveBeenCalledTimes(1);expect(remove).toHaveBeenCalled();expect(jest.getTimerCount()).toBe(0);
  });
  it('does not send when parent aborts before or during queue wait',async()=>{
    const f=setup();f.parent.abort();await expect(kisFetch(url,f.init,f.options)).rejects.toThrow('aborted');expect(fetch).not.toHaveBeenCalled();
    const g=setup();jest.mocked(acquireKisSlot).mockImplementationOnce(async()=>{g.parent.abort();});
    await expect(kisFetch(url,g.init,g.options)).rejects.toThrow('aborted');expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    {maxResponseBytes:undefined},{bodyDeadlineMs:undefined},{maxResponseBytes:0},{maxResponseBytes:524289},
    {bodyDeadlineMs:90001},{bodyDeadlineMs:NaN},{timeoutMs:0},{timeoutMs:10001},{maxWaitMs:5001},
    {rateLimitRetries:1},{transientRetries:1},{priority:'normal'},
  ])('rejects invalid opt-in before queue or HTTP %j',async(override)=>{
    const f=setup();await expect(kisFetch(url,f.init,{...f.options,...override} as KisFetchOptions)).rejects.toThrow('invalid bounded');
    expect(fetch).not.toHaveBeenCalled();expect(acquireKisSlot).not.toHaveBeenCalled();
  });
  it.each([
    (u:string)=>u.replace('SPX','SPY'),(u:string)=>u.replace('SPX','.SPX'),(u:string)=>u.replace(':9443',':29443'),
    (u:string)=>u.replace('inquire-daily-chartprice','order'),(u:string)=>u+'&extra=x',
    (u:string)=>u.replace('20250102','20250230'),
  ])('rejects wrong identity/path/query/date before HTTP %#',async(edit)=>{
    const f=setup();await expect(kisFetch(edit(url),f.init,f.options)).rejects.toThrow('invalid bounded');expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects POST, missing signal and nonallowlisted headers before transmission',async()=>{
    const f=setup();for(const override of [{method:'POST'},{signal:undefined},{headers:{tr_id:'wrong',custtype:'P'}},{body:'x'},{headers:{tr_id:'FHKST03030100',custtype:'P',hashkey:'x'}}]){
      await expect(kisFetch(url,{...f.init,...override},f.options)).rejects.toThrow('invalid bounded');
    }expect(fetch).not.toHaveBeenCalled();
  });
  it('connects the real adapter and real bounded transport with fractional monotonic time',async()=>{
    const previous=process.env.KIS_MOCK;process.env.KIS_MOCK='false';
    try{
      const f=indexFixture();let ticks=0;
      jest.mocked(fetch).mockImplementation(async(input)=>{
        const requested=new URL(String(input)),day=(s:string)=>`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
        return new Response(f.raw(day(requested.searchParams.get('FID_INPUT_DATE_1')!),day(requested.searchParams.get('FID_INPUT_DATE_2')!)),{status:200});
      });
      const result=await collectKisForwardIndex({...f.options,fred:f.envelope.fred,now:()=>new Date(f.now),monotonicMs:()=>0.125+(ticks++)*0.25});
      expect(result.rows).toEqual(f.rows);expect(fetch).toHaveBeenCalledTimes(7);
    }finally{if(previous===undefined)delete process.env.KIS_MOCK;else process.env.KIS_MOCK=previous;}
  });
  it('leaves a legacy POST replay and parent signal behavior unchanged',async()=>{
    const parent=new AbortController();jest.mocked(fetch).mockResolvedValue(new Response('legacy'));
    const response=await kisFetch('https://kis.example/order',{method:'POST',signal:parent.signal},{rateLimitRetries:0});
    expect(await response.text()).toBe('legacy');expect(jest.mocked(fetch).mock.calls[0][1]?.signal).toBe(parent.signal);
  });
});
