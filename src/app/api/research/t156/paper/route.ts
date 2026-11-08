import { NextRequest,NextResponse } from 'next/server';
import { requireUserId } from '@/lib/auth/current-user';
import { readPaperView,paperViewLimits,PaperViewError } from '@/lib/strategy/m40/paper-view';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
export async function GET(req:NextRequest){
 const user=await requireUserId(req);
 if(!user.ok){user.res.headers.set('Cache-Control',headers['Cache-Control']);return user.res;}
 let limit:number;try{limit=paperViewLimits(req.nextUrl.searchParams.get('limit'));}catch{return NextResponse.json({ok:false,error:'signal_limit_must_be_1_to_100'},{status:400,headers});}
 try{return NextResponse.json({ok:true,data:await readPaperView(user.userId,limit)},{headers});}
 catch(e){return NextResponse.json({ok:false,error:e instanceof PaperViewError?e.message:'paper_view_unavailable'},{status:e instanceof PaperViewError?e.status:503,headers});}
}
