import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { ClaudeCliCaller } from './claude-cli';
import { HomeM4ApiCaller } from './home-m4-api';
import type { LlmCaller, LlmProvider, LlmProviderConfig } from './types';

const VALID_PROVIDERS: LlmProvider[] = ['claude', 'home-m4-api', 'hybrid'];

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

/** 공용 게이트웨이 주소 해석. 챗봇 모델 선택과 공용 모델 설정은 독립적이다. */
export async function getHomeM4ApiBase(): Promise<string> {
  return (await readSystemConfig('home_m4_api_base')) ?? process.env.AI_API_BASE ?? 'http://192.168.219.100:8000';
}

/** 현재 provider 설정 전체 조회 (UI 표시용 + caller 빌드용). */
export async function getProviderConfig(): Promise<LlmProviderConfig> {
  const provider = await getActiveProvider();

  // home-m4-api 설정
  const homeM4ApiBase = await getHomeM4ApiBase();
  const homeM4ApiModel =
    (await readSystemConfig('home_m4_api_model')) ??
    process.env.AI_API_MODEL ??
    'qwen2.5:14b-instruct';
  const m4TempRaw =
    (await readSystemConfig('home_m4_api_temperature')) ??
    process.env.AI_API_TEMPERATURE ??
    '0.3';
  const homeM4ApiTemperature = Number.isFinite(Number(m4TempRaw)) ? Number(m4TempRaw) : 0.3;

  // Hybrid Stage 1 — 통합 모델 (도메인 분리 제거, Phase AB)
  // 옛 키(stage1_model_domestic/overseas) fallback 으로 호환 유지
  const stage1Model =
    (await readSystemConfig('stage1_model')) ??
    (await readSystemConfig('stage1_model_domestic')) ??
    process.env.STAGE1_MODEL ??
    'qwen2.5:14b-instruct';
  const stage1TimeoutRaw =
    (await readSystemConfig('stage1_timeout_ms')) ??
    process.env.STAGE1_TIMEOUT_MS ??
    '30000';
  const stage1TimeoutMs = Number.isFinite(Number(stage1TimeoutRaw)) ? Number(stage1TimeoutRaw) : 30_000;

  // RAG 설정 (Phase AB)
  const ragEnabledRaw =
    (await readSystemConfig('rag_enabled')) ??
    process.env.RAG_ENABLED ??
    'true';
  const ragEnabled = String(ragEnabledRaw).toLowerCase() === 'true';
  const ragTopKSignals = Number((await readSystemConfig('rag_topk_signals')) ?? process.env.RAG_TOPK_SIGNALS ?? 5) || 5;
  const ragTopKNews    = Number((await readSystemConfig('rag_topk_news'))    ?? process.env.RAG_TOPK_NEWS    ?? 3) || 3;
  const ragLookbackDays = Number((await readSystemConfig('rag_lookback_days')) ?? process.env.RAG_LOOKBACK_DAYS ?? 7) || 7;

  return {
    provider,
    homeM4ApiBase, homeM4ApiModel, homeM4ApiTemperature,
    stage1Model, stage1TimeoutMs,
    ragEnabled, ragTopKSignals, ragTopKNews, ragLookbackDays,
  };
}

async function buildCaller(opts?: { stage?: 1 | 2; domain?: 'domestic' | 'overseas' }): Promise<{ provider: LlmProvider; caller: LlmCaller }> {
  const cfg = await getProviderConfig();

  // Hybrid: stage 따라 caller 분기 (도메인 분리 제거 — Phase AB)
  if (cfg.provider === 'hybrid') {
    const stage = opts?.stage ?? 1;
    if (stage === 1) {
      return {
        provider: 'hybrid',
        caller: new HomeM4ApiCaller(
          cfg.homeM4ApiBase ?? 'http://192.168.219.100:8000',
          process.env.AI_API_KEY ?? '',
          cfg.stage1Model ?? 'qwen2.5:14b-instruct',
          cfg.homeM4ApiTemperature ?? 0.3,
        ),
      };
    }
    // Stage 2: Claude Sonnet
    return { provider: 'hybrid', caller: new ClaudeCliCaller() };
  }

  if (cfg.provider === 'home-m4-api') {
    return {
      provider: 'home-m4-api',
      caller: new HomeM4ApiCaller(
        cfg.homeM4ApiBase ?? 'http://192.168.219.100:8000',
        process.env.AI_API_KEY ?? '',
        cfg.homeM4ApiModel ?? 'qwen2.5:14b-instruct',
        cfg.homeM4ApiTemperature ?? 0.3,
      ),
    };
  }
  return { provider: 'claude', caller: new ClaudeCliCaller() };
}

export interface RunLlmOptions {
  timeoutMs?: number;
  responseFormat?: 'json' | 'text';
  toolFree?: boolean;
  /** Claude provider 전용: 모델 동적 선택 (sonnet|opus|haiku). home-m4-api는 무시. */
  model?: string;
  /** Hybrid 모드 stage. provider==='hybrid' 일 때 1=Ollama 도메인, 2=Claude. */
  stage?: 1 | 2;
  /** Hybrid Stage 1 도메인 모델 선택 — 'domestic' | 'overseas'. */
  domain?: 'domestic' | 'overseas';
  /** T-169 — 별도 system 지시(비서 채팅 전용). 없으면 caller 에 넘기는 옵션·요청이 T-169 이전과 같다. */
  system?: string;
  /** T-169 — Ollama num_ctx(home-m4-api 전용). 없으면 넘기지 않는다. */
  numCtx?: number;
}

/**
 * T-169 — system·numCtx 는 **값이 있을 때만** caller 옵션에 키를 만든다. 다른 호출부(필드를 안 넘김)는 caller 가 받는
 * 옵션 객체가 T-169 이전과 같다(`home-m4-api-system-t169.test.ts`).
 */
function chatOnlyOptions(o: RunLlmOptions): { system?: string; numCtx?: number } {
  return {
    ...(typeof o.system === 'string' && o.system.length > 0 ? { system: o.system } : {}),
    ...(typeof o.numCtx === 'number' ? { numCtx: o.numCtx } : {}),
  };
}

/** 1회 호출 (재시도 없음, 큐 없음). */
export async function runLlmOnce(prompt: string, opts: RunLlmOptions | number = {}): Promise<string> {
  const o = typeof opts === 'number' ? { timeoutMs: opts } : opts;
  const { caller } = await buildCaller({ stage: o.stage, domain: o.domain });
  return caller.call(prompt, {
    timeoutMs: o.timeoutMs ?? 90000,
    responseFormat: o.responseFormat ?? 'json',
    ...(o.toolFree ? { toolFree: true } : {}),
    model: o.model,
    ...chatOnlyOptions(o),
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
  const chatOnly = chatOnlyOptions(o);
  const { provider, caller } = await buildCaller({ stage: o.stage, domain: o.domain });

  // hybrid stage 결정 — caller 종류로 직렬화 여부 판단
  const isClaudeBackend =
    provider === 'claude' || (provider === 'hybrid' && (o.stage ?? 1) === 2);

  const attempt = async (): Promise<string> => {
    let lastErr: unknown;
    for (let tries = 0; tries < 3; tries++) {
      try {
        return await caller.call(prompt, { timeoutMs, responseFormat, model, ...(o.toolFree ? { toolFree: true } : {}), ...chatOnly });
      } catch (e) {
        lastErr = e;
        const msg = e instanceof Error ? e.message : String(e);
        const retriable =
          isClaudeBackend
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

  if (isClaudeBackend) {
    // 큐 직렬화 (subprocess 동시 실행 시 100% Execution error 발생 방지)
    const prev = cliQueue;
    const next = prev.then(() => attempt(), () => attempt());
    cliQueue = next.catch(() => {});
    return next;
  }
  // home-m4-api / hybrid stage 1은 HTTP — 동시성 허용
  return attempt();
}
