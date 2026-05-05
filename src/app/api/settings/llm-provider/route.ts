import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { getProviderConfig } from '@/lib/llm/provider';
import type { LlmProvider } from '@/lib/llm/types';

export const dynamic = 'force-dynamic';

const VALID_PROVIDERS: LlmProvider[] = ['claude', 'home-m4-api', 'hybrid'];

interface UpsertBody {
  provider?: LlmProvider;
  // home-m4-api (AI_API_KEY는 보안상 .env 전용 — DB/UI 미저장)
  homeM4ApiBase?: string;
  homeM4ApiModel?: string;
  homeM4ApiTemperature?: number;
  // Hybrid Stage 1 + RAG (Phase AB)
  stage1Model?: string;
  stage1TimeoutMs?: number;
  ragEnabled?: boolean;
  ragTopKSignals?: number;
  ragTopKNews?: number;
  ragLookbackDays?: number;
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
  // Phase AB
  const dbStage1Model  = await readSystemConfig('stage1_model');
  const dbStage1Timeout = await readSystemConfig('stage1_timeout_ms');
  const dbRagEnabled   = await readSystemConfig('rag_enabled');
  const dbRagTopkSig   = await readSystemConfig('rag_topk_signals');
  const dbRagTopkNews  = await readSystemConfig('rag_topk_news');
  const dbRagLookback  = await readSystemConfig('rag_lookback_days');

  return NextResponse.json({
    ok: true,
    active: cfg,
    overrides: {
      llm_provider:           dbProvider,
      home_m4_api_base:       dbM4Base,
      home_m4_api_model:      dbM4Model,
      home_m4_api_temperature: dbM4Temp,
      stage1_model:           dbStage1Model,
      stage1_timeout_ms:      dbStage1Timeout,
      rag_enabled:            dbRagEnabled,
      rag_topk_signals:       dbRagTopkSig,
      rag_topk_news:          dbRagTopkNews,
      rag_lookback_days:      dbRagLookback,
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

    // Phase AB — Hybrid Stage 1 + RAG 옵션
    if (body.stage1Model !== undefined) {
      const m = String(body.stage1Model).trim();
      if (m) await upsert('stage1_model', m);
    }
    if (body.stage1TimeoutMs !== undefined) {
      const t = Number(body.stage1TimeoutMs);
      if (!Number.isFinite(t) || t < 5000 || t > 120000) {
        return NextResponse.json({ ok: false, error: 'stage1TimeoutMs must be 5000~120000' }, { status: 400 });
      }
      await upsert('stage1_timeout_ms', t);
    }
    if (body.ragEnabled !== undefined) {
      await upsert('rag_enabled', String(!!body.ragEnabled));
    }
    if (body.ragTopKSignals !== undefined) {
      const n = Number(body.ragTopKSignals);
      if (!Number.isFinite(n) || n < 0 || n > 20) {
        return NextResponse.json({ ok: false, error: 'ragTopKSignals must be 0~20' }, { status: 400 });
      }
      await upsert('rag_topk_signals', n);
    }
    if (body.ragTopKNews !== undefined) {
      const n = Number(body.ragTopKNews);
      if (!Number.isFinite(n) || n < 0 || n > 20) {
        return NextResponse.json({ ok: false, error: 'ragTopKNews must be 0~20' }, { status: 400 });
      }
      await upsert('rag_topk_news', n);
    }
    if (body.ragLookbackDays !== undefined) {
      const n = Number(body.ragLookbackDays);
      if (!Number.isFinite(n) || n < 1 || n > 90) {
        return NextResponse.json({ ok: false, error: 'ragLookbackDays must be 1~90' }, { status: 400 });
      }
      await upsert('rag_lookback_days', n);
    }

    const cfg = await getProviderConfig();
    return NextResponse.json({ ok: true, active: cfg });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[api/settings/llm-provider POST]', error);
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}
