import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { getProviderConfig } from '@/lib/llm/provider';
import type { LlmProvider } from '@/lib/llm/types';

export const dynamic = 'force-dynamic';

const VALID_PROVIDERS: LlmProvider[] = ['claude', 'home-m4-api'];

interface UpsertBody {
  provider?: LlmProvider;
  // home-m4-api (AI_API_KEY는 보안상 .env 전용 — DB/UI 미저장)
  homeM4ApiBase?: string;
  homeM4ApiModel?: string;
  homeM4ApiTemperature?: number;
}

async function upsert(key: string, value: unknown): Promise<void> {
  const pool = getPool();
  await pool.query(
    'INSERT INTO system_config (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
    [key, JSON.stringify(value)],
  );
}

async function readSystemConfig(key: string): Promise<unknown | null> {
  try {
    const pool = getPool();
    const [rows] = await pool.query<(RowDataPacket & { value: string })[]>(
      'SELECT value FROM system_config WHERE `key` = ? LIMIT 1',
      [key],
    );
    if (rows.length === 0) return null;
    try { return JSON.parse(rows[0].value); } catch { return rows[0].value; }
  } catch {
    return null;
  }
}

export async function GET() {
  const cfg = await getProviderConfig();
  const dbProvider     = await readSystemConfig('llm_provider');
  const dbM4Base       = await readSystemConfig('home_m4_api_base');
  const dbM4Model      = await readSystemConfig('home_m4_api_model');
  const dbM4Temp       = await readSystemConfig('home_m4_api_temperature');

  return NextResponse.json({
    ok: true,
    active: cfg,
    overrides: {
      llm_provider:           dbProvider,
      home_m4_api_base:       dbM4Base,
      home_m4_api_model:      dbM4Model,
      home_m4_api_temperature: dbM4Temp,
    },
    env: {
      LLM_PROVIDER:        process.env.LLM_PROVIDER ?? null,
      AI_API_BASE:         process.env.AI_API_BASE ?? null,
      AI_API_MODEL:        process.env.AI_API_MODEL ?? null,
      AI_API_TEMPERATURE:  process.env.AI_API_TEMPERATURE ?? null,
      // AI_API_KEY는 보안상 응답에서 제외 (UI에 키 노출 방지)
      AI_API_KEY_set:      process.env.AI_API_KEY ? 'yes' : 'no',
    },
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as UpsertBody;
    if (body.provider !== undefined) {
      if (!(VALID_PROVIDERS as string[]).includes(body.provider)) {
        return NextResponse.json({ ok: false, error: `invalid provider (must be one of ${VALID_PROVIDERS.join('|')})` }, { status: 400 });
      }
      await upsert('llm_provider', body.provider);
    }

    // home-m4-api 필드
    if (body.homeM4ApiBase !== undefined) {
      const url = String(body.homeM4ApiBase).trim();
      if (url && !/^https?:\/\//.test(url)) {
        return NextResponse.json({ ok: false, error: 'homeM4ApiBase must start with http:// or https://' }, { status: 400 });
      }
      await upsert('home_m4_api_base', url);
    }
    if (body.homeM4ApiModel !== undefined) {
      await upsert('home_m4_api_model', String(body.homeM4ApiModel).trim());
    }
    if (body.homeM4ApiTemperature !== undefined) {
      const t = Number(body.homeM4ApiTemperature);
      if (!Number.isFinite(t) || t < 0 || t > 2) {
        return NextResponse.json({ ok: false, error: 'homeM4ApiTemperature must be 0~2' }, { status: 400 });
      }
      await upsert('home_m4_api_temperature', t);
    }

    const cfg = await getProviderConfig();
    return NextResponse.json({ ok: true, active: cfg });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[api/settings/llm-provider POST]', error);
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}
