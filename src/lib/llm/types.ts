export type LlmProvider = 'claude' | 'home-m4-api' | 'hybrid';

export type ClaudeModel = 'sonnet' | 'opus' | 'haiku';

/** hybrid 2-stage 도메인 (Stage 1 모델·프롬프트 선택). */
export type HybridDomain = 'domestic' | 'overseas';

export interface LlmCallOptions {
  /** 호출 타임아웃 (ms). 기본 90000, 배치는 180000 권장 */
  timeoutMs?: number;
  /** JSON 응답 강제 (지원하는 provider에서만 효과). 기본 'json' */
  responseFormat?: 'json' | 'text';
  /** Text-only decisions must have no CLI tools or MCP access. */
  toolFree?: boolean;
  /** Claude provider 전용: 모델 동적 선택 (sonnet|opus|haiku). 미지정 시 기본 sonnet. home-m4-api는 무시 */
  model?: ClaudeModel | string;
  /**
   * Hybrid 모드 stage 명시 (1=Ollama 도메인 모델, 2=Claude Sonnet).
   * provider !== 'hybrid' 면 무시. provider==='hybrid' 인데 미지정이면 기본 1.
   */
  stage?: 1 | 2;
  /** Hybrid Stage 1 모델·프롬프트 분기용 도메인. provider !== 'hybrid' 면 무시. */
  domain?: HybridDomain;
  /**
   * T-169 — 별도 system 지시(비서 채팅 전용). **비어 있거나 없으면 요청이 T-169 이전과 바이트 단위로 같다.**
   *  - home-m4-api: `messages` 앞에 `{role:'system'}` 로 보낸다. 첫 메시지가 system 이 아니면 home-m4-api `/v1/chat` 이
   *    「시그널 평가·JSON 단일 객체」 지시를 자동으로 붙이므로(분석가 채팅이 JSON 으로 답하던 원인) 대화형 호출은 이 필드를 쓴다.
   *  - claude: `${system}\n\n${prompt}` 로 합쳐 기존 CLI 인자 형태 그대로 실행한다(채팅 route 가 하던 결합과 같은 결과).
   */
  system?: string;
  /** T-169 — Ollama `num_ctx`(home-m4-api 전용). 없으면 `options` 에 넣지 않는다. claude 는 무시. */
  numCtx?: number;
  /** 선택 모델 검사에서 게이트웨이가 돌려준 모델 태그가 일치해야 한다. */
  requireModelMatch?: boolean;
}

export interface LlmCaller {
  /** prompt 전송 후 응답 텍스트(문자열) 반환. 실패 시 throw. */
  call(prompt: string, opts?: LlmCallOptions): Promise<string>;
}

export interface LlmProviderConfig {
  provider: LlmProvider;
  /** home-m4-api 베이스 URL (예: http://192.168.219.100:8000) */
  homeM4ApiBase?: string;
  /** home-m4-api 모델 (Ollama 모델명, 예: llama3 / llama3.3 / glm-4.7-flash) */
  homeM4ApiModel?: string;
  /** home-m4-api temperature */
  homeM4ApiTemperature?: number;
  /** Hybrid Stage 1 — 국내·해외 통합 모델 */
  stage1Model?: string;
  /** Hybrid Stage 1 timeout (ms). 기본 30000 */
  stage1TimeoutMs?: number;
  /** RAG 활성 여부 (Phase AB) */
  ragEnabled?: boolean;
}
