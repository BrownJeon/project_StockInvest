import { NextRequest,NextResponse,after } from 'next/server';
import { checkCronAuth } from '@/lib/cron-auth';
import { initializeApprovedForwardPilot,runM40ForwardCycle } from '@/lib/strategy/m40/forward-runtime';
import { requirePaperDryRun,loadPaperAccount } from '@/lib/strategy/m40/forward-store';

export const dynamic='force-dynamic';
/** Explicit initialization plus independent daily paper evaluation. No active order or signal adapter. */
export async function POST(req:NextRequest) {
 const auth=checkCronAuth(req);if(auth)return auth;
 try {
  await requirePaperDryRun();
  if(req.nextUrl.searchParams.get('initialize')==='1')await initializeApprovedForwardPilot();
  const account=await loadPaperAccount();
  if(!account)return NextResponse.json({ok:false,error:'paper_account_not_initialized',executionScope:'paper_only'},{status:503});
  if(account.status==='paused')return NextResponse.json({ok:false,error:'paper_account_paused',executionScope:'paper_only'},{status:409});
  after(async()=>{
   try {console.log('[m40-forward]',JSON.stringify(await runM40ForwardCycle()));}
   catch(error){const text=error instanceof Error?error.message:'';
    console.error('[m40-forward] failed',/^(paper|m40_forward|forward)_[a-z_]+$/.test(text)?text:'forward_cycle_failed');}
  });
  return NextResponse.json({ok:true,scheduled:true,completed:false,executionScope:'paper_only'},{status:202});
 }catch(error){const code=error instanceof Error&&error.message==='m40_forward_requires_dry_run'?'m40_forward_requires_dry_run':'paper_initialization_unavailable';
  return NextResponse.json({ok:false,error:code,executionScope:'paper_only'},{status:503});}
}
