import { NextRequest,NextResponse } from 'next/server';
import { requireUserId } from '@/lib/auth/current-user';
import { readPaperView,PaperViewError } from '@/lib/strategy/m40/paper-view';
import {parsePaperViewQuery} from '@/lib/strategy/m40/paper-view-query';
import type {PaperViewQuery} from '@/lib/strategy/m40/paper-view-types';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
export async function GET(req:NextRequest){
 const user=await requireUserId(req);
 if(!user.ok){user.res.headers.set('Cache-Control',headers['Cache-Control']);return user.res;}
 let query:PaperViewQuery;try{query=parsePaperViewQuery(req.nextUrl.searchParams);}catch(e){return NextResponse.json({ok:false,error:e instanceof Error?e.message:'paper_query_invalid'},{status:400,headers});}
 try{return NextResponse.json({ok:true,data:await readPaperView(user.userId,query)},{headers});}
 catch(e){return NextResponse.json({ok:false,error:e instanceof PaperViewError?e.message:'paper_view_unavailable'},{status:e instanceof PaperViewError?e.status:503,headers});}
}
