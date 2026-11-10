import { runM40Forecast } from '../forecast-runtime';
import { readM40ForwardStatus } from '../forward-runtime';
import { loadPaperAccount,requirePaperDryRun } from '../forward-store';
jest.mock('@/lib/db',()=>({getPool:jest.fn()}));
jest.mock('../forward-runtime',()=>({readM40ForwardStatus:jest.fn(),loadForwardCalendar:jest.fn()}));
jest.mock('../forward-store',()=>({loadPaperAccount:jest.fn(),requirePaperDryRun:jest.fn()}));
beforeEach(()=>jest.resetAllMocks());
test.each([
 {completed:false,sourceReady:true,beforeNextOpen:true},
 {completed:true,sourceReady:false,beforeNextOpen:true},
 {completed:true,sourceReady:true,beforeNextOpen:false},
])('forecast requires completed forward, qualified source and time before next open: %j',async state=>{
 jest.mocked(readM40ForwardStatus).mockResolvedValue({...state,status:'blocked',session:'2026-11-09',executionScope:'paper_only'});
 const db={query:jest.fn()};expect(await runM40Forecast(db as never)).toEqual({status:'blocked',issueCode:'forecast_forward_not_ready'});
 expect(loadPaperAccount).not.toHaveBeenCalled();expect(db.query).not.toHaveBeenCalled();expect(requirePaperDryRun).toHaveBeenCalledWith(db);
});
