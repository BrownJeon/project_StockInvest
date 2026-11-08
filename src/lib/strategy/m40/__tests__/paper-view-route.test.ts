import { NextRequest,NextResponse } from 'next/server';
import { GET } from '@/app/api/research/t156/paper/route';
import { requireUserId } from '@/lib/auth/current-user';
import { readPaperView,PaperViewError } from '../paper-view';
jest.mock('@/lib/auth/current-user',()=>({requireUserId:jest.fn()}));
jest.mock('../paper-view',()=>({...jest.requireActual('../paper-view'),readPaperView:jest.fn()}));
describe('private paper route',()=>{
 beforeEach(()=>jest.clearAllMocks());
 test('authentication occurs before parameters or paper reads; failure never caches',async()=>{
 jest.mocked(requireUserId).mockResolvedValue({ok:false,res:NextResponse.json({ok:false},{status:401})});
 const response=await GET(new NextRequest('http://localhost/api/research/t156/paper?limit=bad'));
 expect(response.status).toBe(401);expect(readPaperView).not.toHaveBeenCalled();expect(response.headers.get('Cache-Control')).toBe('private, no-store');
 });
 test('boundaries reject then preserve forbidden response without exposing details',async()=>{
 jest.mocked(requireUserId).mockResolvedValue({ok:true,userId:42});
 const invalid=await GET(new NextRequest('http://localhost/api/research/t156/paper?limit=101'));expect(invalid.status).toBe(400);expect(readPaperView).not.toHaveBeenCalled();
 jest.mocked(readPaperView).mockRejectedValue(new PaperViewError(403,'paper_viewer_forbidden'));
 const forbidden=await GET(new NextRequest('http://localhost/api/research/t156/paper'));expect(forbidden.status).toBe(403);expect(await forbidden.json()).toEqual({ok:false,error:'paper_viewer_forbidden'});expect(forbidden.headers.get('Cache-Control')).toBe('private, no-store');
 });
 test('v6 period parsing and snapshot conflict return no-store without stale data',async()=>{
 jest.mocked(requireUserId).mockResolvedValue({ok:true,userId:42});
 jest.mocked(readPaperView).mockRejectedValue(new PaperViewError(409,'paper_snapshot_changed_restart_page_1'));
 const response=await GET(new NextRequest('http://localhost/api/research/t156/paper?period=week&anchorSession=2026-11-02&signalPage=2&snapshot=old'));
 expect(response.status).toBe(409);expect(response.headers.get('Cache-Control')).toBe('private, no-store');
 expect(await response.json()).toEqual({ok:false,error:'paper_snapshot_changed_restart_page_1'});
 expect(readPaperView).toHaveBeenCalledWith(42,expect.objectContaining({period:'week',anchorSession:'2026-11-02',signalPage:2,snapshot:'old'}));
 });
});
