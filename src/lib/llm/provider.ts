import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { ClaudeCliCaller } from './claude-cli';
import { OllamaCaller } from './ollama';
import type { LlmCaller, LlmProvider, LlmProviderConfig } from './types';

const VALID_PROVIDERS: LlmProvider[] = ['claude', 'ollama'];

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
  const ollamaBaseUrl =
    (await readSystemConfig('ollama_base_url')) ??
    process.env.OLLAMA_BASE_URL ??
    'http://localhost:11434';
  const ollamaModel =
    (await readSystemConfig('ollama_model')) ??
    process.env.OLLAMA_MODEL ??
    'llama3.1:8b';
  const tempRaw =
    (await readSystemConfig('ollama_temperature')) ??
    process.env.OLLAMA_TEMPERATURE ??
    '0.3';
  const ollamaTemperature = Number.isFinite(Number(tempRaw)) ? Number(tempRaw) : 0.3;
  return { provider, ollamaBaseUrl, ollamaModel, ollamaTemperature };
}

async function buildCaller(): Promise<{ provider: LlmProvider; caller: LlmCaller }> {
  const cfg = await getProviderConfig();
  if (cfg.provider === 'ollama') {
    return {
      provider: 'ollama',
      caller: new OllamaCaller(
        cfg.ollamaBaseUrl ?? 'http://localhost:11434',
        cfg.ollamaModel ?? 'llama3.1:8b',
        cfg.ollamaTemperature ?? 0.3,
      ),
    };
  }
  return { provider: 'claude', caller: new ClaudeCliCaller() };
}

/** 1회 호출 (재시도 없음, 큐 없음). */
export async function runLlmOnce(prompt: string, timeoutMs = 90000): Promise<string> {
  const { caller } = await buildCaller();
  return caller.call(prompt, { timeoutMs, responseFormat: 'json' });
}

/**
 * 안정 호출 — provider별 재시도 정책 + claude일 때 큐 직렬화.
 * - claude: "Execution error" 발생 시 3회 재시도 + cliQueue 직렬화 (subprocess 충돌 방지)
 * - ollama: HTTP 5xx / abort / 네트워크 에러 시 3회 재시도, 동시성 풀림
 */
export async function runLlm(prompt: string, timeoutMs = 90000): Promise<string> {
  const { provider, caller } = await buildCaller();

  const attempt = async (): Promise<string> => {
    let lastErr: unknown;
    for (let tries = 0; tries < 3; tries++) {
      try {
        return await caller.call(prompt, { timeoutMs, responseFormat: 'json' });
      } catch (e) {
        lastErr = e;
        const msg = e instanceof Error ? e.message : String(e);
        const retriable =
          provider === 'claude'
            ? msg.includes('Execution error')
            : /HTTP 5\d\d|timeout|aborted|ECONNREFUSED|ECONNRESET|ETIMEDOUT|fetch failed/i.test(msg);
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
  // ollama는 HTTP — 동시성 허용
  return attempt();
}
