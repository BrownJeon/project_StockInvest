export type LlmProvider = 'claude' | 'home-m4-api' | 'hybrid';

export type ClaudeModel = 'sonnet' | 'opus' | 'haiku';

/** hybrid 2-stage 도메인 (Stage 1 모델·프롬프트 선택). */
export type HybridDomain = 'domestic' | 'overseas';

export interface LlmCallOptions {
  /** 호출 타임아웃 (ms). 기본 90000, 배치는 180000 권장 */
  timeoutMs?: number;
  /** JSON 응답 강제 (지원하는 provider에서만 효과). 기본 'json' */
  responseFormat?: 'json' | 'text';
  /** Claude provider 전용: 모델 동적 선택 (sonnet|opus|haiku). 미지정 시 기본 sonnet. home-m4-api는 무시 */
  model?: ClaudeModel | string;
  /**
   * Hybrid 모드 stage 명시 (1=Ollama 도메인 모델, 2=Claude Sonnet).
   * provider !== 'hybrid' 면 무시. provider==='hybrid' 인데 미지정이면 기본 1.
   */
  stage?: 1 | 2;
  /** Hybrid Stage 1 모델·프롬프트 분기용 도메인. provider !== 'hybrid' 면 무시. */
  domain?: HybridDomain;
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
  /** Hybrid Stage 1 — 통합 모델 (default glm-4.7-flash, 도메인 분리 없음) */
  stage1Model?: string;
  /** Hybrid Stage 1 timeout (ms). 기본 30000 */
  stage1TimeoutMs?: number;
  /** RAG 활성 여부 (Phase AB) */
  ragEnabled?: boolean;
  /** RAG top_k — past signals */
  ragTopKSignals?: number;
  /** RAG top_k — recent news */
  ragTopKNews?: number;
  /** RAG lookback days for news/macro */
  ragLookbackDays?: number;
}
