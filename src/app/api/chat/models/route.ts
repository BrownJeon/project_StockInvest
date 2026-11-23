import { NextRequest, NextResponse } from 'next/server';
import { requireChatUser } from '@/lib/chat/ownership';
import { STOCK_CHAT_MODEL, STOCK_CHAT_PROVIDER } from '@/lib/chat/model';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await requireChatUser(req);
  if (!auth.ok) return auth.res;
  return NextResponse.json({
    ok: true,
    provider: STOCK_CHAT_PROVIDER,
    models: [{ id: STOCK_CHAT_MODEL, label: 'Gemma 4 12B' }],
    fixed: true,
    default: STOCK_CHAT_MODEL,
  });
}
