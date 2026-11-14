import type { LlmCallOptions, LlmCaller } from './types';
import { trackCall } from '@/lib/api-usage';

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
 * T-169: `opts.system` 이 있으면(비서 채팅) `[{role:'system'},{role:'user'}]` 두 개를 보낸다 — home-m4-api 는 첫 메시지가
 * system 이 아닐 때만 「시그널 평가·JSON 단일 객체」 지시를 앞에 붙이므로, 대화형 답이 필요한 호출은 system 을 직접 준다.
 * `opts.numCtx` 가 있으면 `options.num_ctx` 로 보낸다. **둘 다 없으면 요청 본문은 T-169 이전과 바이트 단위로 같다**
 * (`home-m4-api-system-t169.test.ts` 가 고정).
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
    // T-169 — 빈 문자열·비정상 값은 "없음"과 같다(요청 본문을 바꾸지 않는다).
    const system = typeof opts?.system === 'string' && opts.system.length > 0 ? opts.system : null;
    const numCtx = typeof opts?.numCtx === 'number' && Number.isInteger(opts.numCtx) && opts.numCtx > 0 ? opts.numCtx : null;
    const extraLog = `${system ? ` sys=${system.length}` : ''}${numCtx ? ` num_ctx=${numCtx}` : ''}`;

    if (DEBUG) {
      console.log(
        `[home-m4-api req] base=${this.base} model=${this.model} chars=${prompt.length} symbols=${symbolCount} temp=${this.temperature}${extraLog}`,
      );
    } else {
      // 운영용 짧은 로그 (항상 출력 — 분석·이상 탐지)
      console.log(`[home-m4-api req] chars=${prompt.length} symbols=${symbolCount}${extraLog}`);
    }

    try {
      // T-040 호출 기록 — 프롬프트·응답은 남기지 않는다. 자체 타이머 abort 는 timeout.
      const res = await trackCall('m4', 'chat', () => fetch(`${this.base}/v1/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.apiKey,
        },
        body: JSON.stringify({
          model: this.model,
          messages: system
            ? [{ role: 'system', content: system }, { role: 'user', content: prompt }]
            : [{ role: 'user', content: prompt }],
          options: numCtx
            ? { temperature: this.temperature, num_ctx: numCtx }
            : { temperature: this.temperature },
        }),
        signal: ctrl.signal,
        cache: 'no-store',
      }), { err: () => (ctrl.signal.aborted ? 'timeout' : undefined) });

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
