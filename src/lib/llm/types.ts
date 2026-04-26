export type LlmProvider = 'claude' | 'home-m4-api';

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
  /** home-m4-api 베이스 URL (예: http://192.168.219.163:8000) */
  homeM4ApiBase?: string;
  /** home-m4-api 모델 (Ollama 모델명, 예: llama3 / llama3.3 / glm-4.7-flash) */
  homeM4ApiModel?: string;
  /** home-m4-api temperature */
  homeM4ApiTemperature?: number;
}
