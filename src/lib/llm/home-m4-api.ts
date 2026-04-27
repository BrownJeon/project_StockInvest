import type { LlmCallOptions, LlmCaller } from './types';

/**
 * home-m4-api 호출자 — Mac M4 FastAPI 허브.
 *
 * 엔드포인트: POST {base}/v1/chat
 * 인증: X-API-Key 헤더 (AI_API_KEY 환경변수)
 * 응답: { message: { content: string } }
 *
 * 분석가가 단일 프롬프트(JSON 응답 강제)를 보내는 패턴이라
 * messages는 [{role:'user', content: prompt}] 한 개만 보낸다.
 *
 * 로깅: HOME_M4_API_DEBUG=1 환경변수로 요청·응답 본문 일부를 stdout에 출력.
 */
const DEBUG = process.env.HOME_M4_API_DEBUG === '1';

/** 프롬프트에서 종목 수 어림짐 — 배치 프롬프트의 "### [N] SYMBOL" 헤더 카운트 */
function countSymbolsInPrompt(prompt: string): number {
  const matches = prompt.match(/^###\s*\[\d+\]/gm);
  return matches ? matches.length : 1;
}

export class HomeM4ApiCaller implements LlmCaller {
  constructor(
    private readonly base: string,
    private readonly apiKey: string,
    private readonly model: string,
    private readonly temperature: number,
  ) {}

  async call(prompt: string, opts?: LlmCallOptions): Promise<string> {
    if (!this.apiKey) {
      throw new Error('AI_API_KEY not configured for home-m4-api provider');
    }
    const timeoutMs = opts?.timeoutMs ?? 90_000;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const startedAt = Date.now();
    const symbolCount = countSymbolsInPrompt(prompt);

    if (DEBUG) {
      console.log(
        `[home-m4-api req] base=${this.base} model=${this.model} chars=${prompt.length} symbols=${symbolCount} temp=${this.temperature}`,
      );
    } else {
      // 운영용 짧은 로그 (항상 출력 — 분석·이상 탐지)
      console.log(`[home-m4-api req] chars=${prompt.length} symbols=${symbolCount}`);
    }

    try {
      const res = await fetch(`${this.base}/v1/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.apiKey,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: 'user', content: prompt }],
          options: { temperature: this.temperature },
        }),
        signal: ctrl.signal,
        cache: 'no-store',
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        const elapsedMs = Date.now() - startedAt;
        console.error(`[home-m4-api err] HTTP ${res.status} elapsedMs=${elapsedMs} body=${body.slice(0, 200)}`);
        throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
      }

      const data = (await res.json()) as { message?: { content?: string } };
      const content = data?.message?.content ?? '';
      const elapsedMs = Date.now() - startedAt;

      if (!content) {
        console.error(`[home-m4-api err] empty content elapsedMs=${elapsedMs}`);
        throw new Error('empty content from home-m4-api');
      }

      if (DEBUG) {
        console.log(
          `[home-m4-api resp] elapsedMs=${elapsedMs} chars=${content.length} sample=${content.slice(0, 200).replace(/\n/g, ' ')}`,
        );
      } else {
        console.log(`[home-m4-api resp] elapsedMs=${elapsedMs} chars=${content.length}`);
      }
      return content;
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        console.error(`[home-m4-api err] timeout after ${timeoutMs}ms`);
        throw new Error(`home-m4-api timeout after ${timeoutMs}ms`);
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
}
