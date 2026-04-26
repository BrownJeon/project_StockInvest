import { NextRequest, NextResponse } from 'next/server';
import { getCredentialState, setCredential, deleteCredentialOverride } from '@/lib/credentials';

export const dynamic = 'force-dynamic';

/** 노출·관리 가능한 키 목록 (StockInvest 전용) */
const KEYS = [
  // 거래소 계정 (KIS)
  'KIS_APP_KEY',
  'KIS_APP_SECRET',
  'KIS_ACCOUNT_NO',
  'KIS_ACCOUNT_PRODUCT',
  // 알람
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_CHAT_ID',
  'SLACK_WEBHOOK_URL',
] as const;

type CredKey = typeof KEYS[number];

const SENTINEL_RESET = '__reset__';

export async function GET() {
  const result: Record<string, unknown> = {};
  for (const k of KEYS) {
    result[k] = await getCredentialState(k);
  }
  return NextResponse.json({ ok: true, credentials: result });
}

interface PostBody {
  values?: Partial<Record<CredKey, string>>;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as PostBody;
    const updates = body.values ?? {};
    const errors: string[] = [];
    const updated: string[] = [];

    for (const k of KEYS) {
      const v = updates[k];
      if (v === undefined) continue;
      if (v === '') continue;
      if (v === SENTINEL_RESET) {
        await deleteCredentialOverride(k);
        updated.push(`${k} (reset to env)`);
        continue;
      }
      if (k === 'SLACK_WEBHOOK_URL' && !/^https?:\/\//.test(v)) {
        errors.push(`${k}: must start with http(s)://`);
        continue;
      }
      await setCredential(k, v);
      updated.push(k);
    }

    if (errors.length > 0) {
      return NextResponse.json({ ok: false, errors, updated }, { status: 400 });
    }
    return NextResponse.json({ ok: true, updated });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[api/settings/credentials POST]', error);
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}
