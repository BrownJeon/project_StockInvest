import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { ClaudeCliCaller } from './claude-cli';
import { HomeM4ApiCaller } from './home-m4-api';
import type { LlmCaller, LlmProvider, LlmProviderConfig } from './types';

const VALID_PROVIDERS: LlmProvider[] = ['claude', 'home-m4-api'];

// claude CLI 전용 직렬화 큐 (subprocess 세션 충돌 방지)
let cliQueue: Promise<unknown> = Promise.resolve();

/** system_config DB의 단일 키 조회 (없으면 null). */
async function readSystemConfig(key: string): Promise<string | null> {
  try {
    const pool = getPool();
    const [rows] = await pool.query<(RowDataPacket & { value: string })[]>(
      'SELECT value FROM system_config WHERE `key` = ? LIMIT 1',
      [key],
    );
    if (rows.length === 0) return null;
    const raw = rows[0].value;
    // JSON-encoded 문자열 우선 처리, 일반 문자열도 허용
    try {
      const parsed = JSON.parse(raw);
      return typeof parsed === 'string' ? parsed : String(parsed);
    } catch {
      return raw;
    }
  } catch {
    return null;
  }
}

/** 활성 LLM provider 결정 — DB system_config > env > 기본 'claude'. */
export async function getActiveProvider(): Promise<LlmProvider> {
  const fromDb = await readSystemConfig('llm_provider');
  if (fromDb && (VALID_PROVIDERS as string[]).includes(fromDb)) return fromDb as LlmProvider;
  const fromEnv = (process.env.LLM_PROVIDER ?? '').toLowerCase();
  if ((VALID_PROVIDERS as string[]).includes(fromEnv)) return fromEnv as LlmProvider;
  return 'claude';
}

/** 현재 provider 설정 전체 조회 (UI 표시용 + caller 빌드용). */
export async function getProviderConfig(): Promise<LlmProviderConfig> {
  const provider = await getActiveProvider();

  // home-m4-api 설정
  const homeM4ApiBase =
    (await readSystemConfig('home_m4_api_base')) ??
    process.env.AI_API_BASE ??
    'http://192.168.219.163:8000';
  const homeM4ApiModel =
    (await readSystemConfig('home_m4_api_model')) ??
    process.env.AI_API_MODEL ??
    'llama3';
  const m4TempRaw =
    (await readSystemConfig('home_m4_api_temperature')) ??
    process.env.AI_API_TEMPERATURE ??
    '0.3';
  const homeM4ApiTemperature = Number.isFinite(Number(m4TempRaw)) ? Number(m4TempRaw) : 0.3;

  return {
    provider,
    homeM4ApiBase, homeM4ApiModel, homeM4ApiTemperature,
  };
}

async function buildCaller(): Promise<{ provider: LlmProvider; caller: LlmCaller }> {
  const cfg = await getProviderConfig();
  if (cfg.provider === 'home-m4-api') {
    return {
      provider: 'home-m4-api',
      caller: new HomeM4ApiCaller(
        cfg.homeM4ApiBase ?? 'http://192.168.219.163:8000',
        process.env.AI_API_KEY ?? '',
        cfg.homeM4ApiModel ?? 'llama3',
        cfg.homeM4ApiTemperature ?? 0.3,
      ),
    };
  }
  return { provider: 'claude', caller: new ClaudeCliCaller() };
}

export interface RunLlmOptions {
  timeoutMs?: number;
  responseFormat?: 'json' | 'text';
  /** Claude provider 전용: 모델 동적 선택 (sonnet|opus|haiku). home-m4-api는 무시. */
  model?: string;
}

/** 1회 호출 (재시도 없음, 큐 없음). */
export async function runLlmOnce(prompt: string, opts: RunLlmOptions | number = {}): Promise<string> {
  const o = typeof opts === 'number' ? { timeoutMs: opts } : opts;
  const { caller } = await buildCaller();
  return caller.call(prompt, {
    timeoutMs: o.timeoutMs ?? 90000,
    responseFormat: o.responseFormat ?? 'json',
    model: o.model,
  });
}

/**
 * 안정 호출 — provider별 재시도 정책 + claude일 때 큐 직렬화.
 * - claude: "Execution error" 발생 시 3회 재시도 + cliQueue 직렬화 (subprocess 충돌 방지)
 * - home-m4-api: HTTP 5xx / abort / 네트워크 에러 시 3회 재시도, 동시성 풀림
 *
 * 두 번째 인자: 숫자(legacy timeoutMs) 또는 RunLlmOptions 객체.
 */
export async function runLlm(prompt: string, opts: RunLlmOptions | number = {}): Promise<string> {
  const o = typeof opts === 'number' ? { timeoutMs: opts } : opts;
  const timeoutMs = o.timeoutMs ?? 90000;
  const responseFormat = o.responseFormat ?? 'json';
  const model = o.model;
  const { provider, caller } = await buildCaller();

  const attempt = async (): Promise<string> => {
    let lastErr: unknown;
    for (let tries = 0; tries < 3; tries++) {
      try {
        return await caller.call(prompt, { timeoutMs, responseFormat, model });
      } catch (e) {
        lastErr = e;
        const msg = e instanceof Error ? e.message : String(e);
        const retriable =
          provider === 'claude'
            ? msg.includes('Execution error')
            : /HTTP 5\d\d|HTTP 429|timeout|aborted|ECONNREFUSED|ECONNRESET|ETIMEDOUT|fetch failed/i.test(msg);
        if (tries < 2 && retriable) {
          await new Promise(r => setTimeout(r, 300 + tries * 500));
          continue;
        }
        throw e;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('unreachable');
  };

  if (provider === 'claude') {
    // 큐 직렬화 (subprocess 동시 실행 시 100% Execution error 발생 방지)
    const prev = cliQueue;
    const next = prev.then(() => attempt(), () => attempt());
    cliQueue = next.catch(() => {});
    return next;
  }
  // home-m4-api는 HTTP — 동시성 허용
  return attempt();
}
