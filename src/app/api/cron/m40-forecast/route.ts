import { NextRequest,NextResponse } from 'next/server';
import { checkCronAuth } from '@/lib/cron-auth';
import { runM40Forecast, evaluateM40Forecasts } from '@/lib/strategy/m40/forecast-runtime';
export const dynamic='force-dynamic';
export const maxDuration=150;
/** Await completion so the cron caller records the actual outcome, never a queued success. */
export async function POST(req:NextRequest){
 const denied=checkCronAuth(req);if(denied)return denied;
 try{await evaluateM40Forecasts();const result=await runM40Forecast();return NextResponse.json({ok:result.status==='completed'||result.status==='already_running_or_published',...result},{status:result.status==='failed'||result.status==='blocked'?503:200,headers:{'Cache-Control':'private, no-store'}});}
 catch{return NextResponse.json({ok:false,status:'failed',issueCode:'forecast_run_failed'},{status:503,headers:{'Cache-Control':'private, no-store'}});}
}
