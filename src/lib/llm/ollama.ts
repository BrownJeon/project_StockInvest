import type { LlmCallOptions, LlmCaller } from './types';

/**
 * Ollama HTTP API (`/api/chat`) 어댑터.
 * - 다른 서버에 호스팅된 Ollama와 통신 (OPENAI 호환 모드 X — 기본 형식 사용)
 * - format='json' 옵션으로 JSON 응답 강제
 */
export class OllamaCaller implements LlmCaller {
  constructor(
    private baseUrl: string,
    private model: string,
    private temperature = 0.3,
  ) {}

  async call(prompt: string, opts: LlmCallOptions = {}): Promise<string> {
    const timeoutMs = opts.timeoutMs ?? 90000;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const url = `${this.baseUrl.replace(/\/$/, '')}/api/chat`;

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: 'user', content: prompt }],
          stream: false,
          format: opts.responseFormat === 'json' ? 'json' : undefined,
          options: {
            temperature: this.temperature,
            num_predict: 2048,
          },
        }),
        signal: ctrl.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Ollama HTTP ${res.status}: ${body.slice(0, 200)}`);
      }

      const json = (await res.json()) as { message?: { content?: string } };
      const content = json?.message?.content;
      if (typeof content !== 'string' || !content.trim()) {
        throw new Error('Ollama unexpected response shape (missing message.content)');
      }
      return content.trim();
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        throw new Error(`Ollama timeout after ${timeoutMs}ms`);
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
}
