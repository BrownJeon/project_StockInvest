import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { getProviderConfig } from '@/lib/llm/provider';
import type { LlmProvider } from '@/lib/llm/types';

export const dynamic = 'force-dynamic';

const VALID_PROVIDERS: LlmProvider[] = ['claude', 'ollama'];

interface UpsertBody {
  provider?: LlmProvider;
  ollamaBaseUrl?: string;
  ollamaModel?: string;
  ollamaTemperature?: number;
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
  const dbOllamaUrl    = await readSystemConfig('ollama_base_url');
  const dbOllamaModel  = await readSystemConfig('ollama_model');
  const dbOllamaTemp   = await readSystemConfig('ollama_temperature');

  return NextResponse.json({
    ok: true,
    active: cfg,
    overrides: {
      llm_provider:       dbProvider,
      ollama_base_url:    dbOllamaUrl,
      ollama_model:       dbOllamaModel,
      ollama_temperature: dbOllamaTemp,
    },
    env: {
      LLM_PROVIDER:       process.env.LLM_PROVIDER ?? null,
      OLLAMA_BASE_URL:    process.env.OLLAMA_BASE_URL ?? null,
      OLLAMA_MODEL:       process.env.OLLAMA_MODEL ?? null,
      OLLAMA_TEMPERATURE: process.env.OLLAMA_TEMPERATURE ?? null,
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
    if (body.ollamaBaseUrl !== undefined) {
      const url = String(body.ollamaBaseUrl).trim();
      if (url && !/^https?:\/\//.test(url)) {
        return NextResponse.json({ ok: false, error: 'ollamaBaseUrl must start with http:// or https://' }, { status: 400 });
      }
      await upsert('ollama_base_url', url);
    }
    if (body.ollamaModel !== undefined) {
      await upsert('ollama_model', String(body.ollamaModel).trim());
    }
    if (body.ollamaTemperature !== undefined) {
      const t = Number(body.ollamaTemperature);
      if (!Number.isFinite(t) || t < 0 || t > 2) {
        return NextResponse.json({ ok: false, error: 'ollamaTemperature must be 0~2' }, { status: 400 });
      }
      await upsert('ollama_temperature', t);
    }

    const cfg = await getProviderConfig();
    return NextResponse.json({ ok: true, active: cfg });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[api/settings/llm-provider POST]', error);
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}
