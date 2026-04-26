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
 */
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
        throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
      }

      const data = (await res.json()) as { message?: { content?: string } };
      const content = data?.message?.content ?? '';
      if (!content) throw new Error('empty content from home-m4-api');
      return content;
    } finally {
      clearTimeout(timer);
    }
  }
}
