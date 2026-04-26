export type LlmProvider = 'claude' | 'ollama';

export interface LlmCallOptions {
  /** 호출 타임아웃 (ms). 기본 90000, 배치는 180000 권장 */
  timeoutMs?: number;
  /** JSON 응답 강제 (지원하는 provider에서만 효과). 기본 'json' */
  responseFormat?: 'json' | 'text';
}

export interface LlmCaller {
  /** prompt 전송 후 응답 텍스트(문자열) 반환. 실패 시 throw. */
  call(prompt: string, opts?: LlmCallOptions): Promise<string>;
}

export interface LlmProviderConfig {
  provider: LlmProvider;
  ollamaBaseUrl?: string;
  ollamaModel?: string;
  ollamaTemperature?: number;
}
