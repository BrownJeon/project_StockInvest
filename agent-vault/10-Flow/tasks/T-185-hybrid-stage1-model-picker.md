---
task_id: T-185
title: 하이브리드 Stage 1 모델 선택과 LLM 사용처 조사
status: review
roles_involved: [main, designer, judge, reviewer]
base_ref: 53a028d6f01efc01a3b1249782578f732822f6ef
related_tasks: [T-184-chat-grounded-calculation]
tags: [type/task, domain/llm, domain/settings]
aliases: [Stage 1 모델 선택]
created: 2026-11-23
updated: 2026-11-23
execution_context:
  schema_version: 1
  origin_tool: codex
  current_tool: codex
  current_procedure: codex_scoped
  current_scope: 승인 v3의 설정 UI·API 구현 및 격리 검증, Claude 최종 검증 인계 준비
  last_event_id: exec-002
demo_gate:
  required: true
  level: "delta"
  status: "approved"
  version: 3
  repo_path: "mockups/T-185-hybrid-stage1-model-picker-v3.html"
  artifact_url: ""
  content_sha256: "82eaae236af1240a78c7e295511a8962f9847632ecb9c6eca5b6bf6f1a689089"
  decided_by: "judge"
  rule_id: "DM-low-confidence"
  approved_by: "user"
  approved_at: "2026-11-23T19:40:49+09:00"
  approval_quote: "데모화면 승인하니까 구현작업 진행해줘"
  waived_by: ""
  waived_at: ""
  waiver_quote: ""
  active: true
  approval_source: "codex_contextual"
---

# T-185 하이브리드 Stage 1 모델 선택과 LLM 사용처 조사

- 설정 → LLM 제공자 → 하이브리드 Stage 1의 자유 입력을 선택 상자로 바꾼다. 옵션은 Gemma 4 12B, Qwen3 8B, Qwen2.5 14B Instruct이며 신규·미설정 기본값은 Gemma 4 12B다.
- 운영 현재 승인 범위는 구현과 조사다. 저장된 운영 선택을 디폴트와 구분한다. 운영 DB·거래 설정 직접 변경 및 배포는 이 요청에 포함되지 않는다.
- 운영 웹 기준 `53a028d6`과 등록 모델 태그를 직접 대조한다. 관련 작업 [[T-184-chat-grounded-calculation]].
- Impeccable context는 기존 설정 화면의 스타일을 기준으로 삼는 국소 작업으로 확인했다. 프로젝트 UI·컴포넌트 스킬은 네이티브 select와 명확한 레이블에 적용한다.

## 실행 도구·절차 이력

| 이벤트 ID | 시각(KST) | 사건 | 이전 → 현재 담당 / 현재 절차 | 범위·남은 일 | 근거 |
|---|---|---|---|---|---|
| exec-001 | 2026-11-23 19:03 KST | start | 없음 → codex / codex_scoped | Stage 1 선택 입력 및 기본값, 운영 LLM 사용처 조사. UI 데모와 독립 검증 단계 분리. | 사용자 요청 |
| exec-002 | 2026-11-23 19:40 KST | resume | codex → codex / codex_scoped | 승인 v3 구현. 운영 릴리스 기준 분리 사본에서 검증 및 Claude 최종 검증 준비. | 사용자 “데모화면 승인하니까 구현작업 진행해줘” |

## 판단 기록 (judge)
- [2026-11-23 19:04] intake engine=jev → feature/R1/sonnet/demo=delta(designer)/demo_first | overrides=- | fallback=- | tokens=1305

## 운영 조회 및 확인 범위

- 2026-11-23 운영 웹 0.24.0 `53a028d6`의 라우팅과 운영 `system_config`를 읽기 전용으로 대조했다. 하이브리드 활성, Stage 1과 단독 홈 M4 모델 설정은 모두 `qwen2.5:14b-instruct`로 저장돼 있다. M4 Ollama에 `gemma4:12b`, `qwen3:8b`, `qwen2.5:14b-instruct`가 모두 등록돼 있다.
- 하이브리드 Stage 1 사용처는 국내·해외 시그널 후보 배치 1차 선별, 국내·해외 장 마감 분석, 즐겨찾기 AI 차트 분석, 종목 재무 화면의 AI 요약 생성, 수동 시그널 AI 보강, 조건부 매수 금액 배분이다. 기존 차트·재무 캐시와 실측 데이터 경로는 재생성 전 보존된다. 보유 종목·신규 매수 후보·추가 판단 대상은 Claude Sonnet으로 넘어간다. 1차 실패 시 기본 배치도 Sonnet으로 진행한다.
- 비서 챗봇은 전용 `gemma4:12b`로 정제·단순 답변은 사고 OFF, 복합 판단은 ON이다. RAG 활성, StockInvest 설정 기본 임베딩은 `bge-m3`다. 리서치분석의 지금 분석은 시세·패턴 계산으로 실행된다. M40 보조 모델 호출 플래그는 운영 릴리스 `.env`에 없다. 이번 조사는 경로와 설정을 확인한 것이며 각 분기를 새로 실행하지 않았다.

## 데모 및 설정 검증 준비

- Designer delta v1 데모를 로컬 HTML로 검토 요청했다. 버전 해시와 형식은 demo_gate에 기록했다. Designer Chrome 360·412·1280px 검증과 Impeccable 검사 통과. 이 세션에 Claude Artifact 게시 도구가 없어 저장소 HTML을 제공했다.
- 운영 커밋의 세 파일 범위만 복사한 격리 초안 `/tmp/stock-t185-stage1.6407gK/prep`에서 공용 모델 목록, 기본값, 저장 API 모델 허용 목록을 준비했다. 실 DB 없이 provider/GET/POST 함수를 실행해 기본값, 기존 값 및 환경 설정 우선순위, 세 모델 저장/조회/호출 전달, 잘못된 값의 선제 거부, 생략 시 설정 보존을 확인했다. 운영 소스나 설정에 반영하지 않았다.

## v2 수정 범위와 검증

- 사용자 요청: 모델 선택 옆 체크 버튼에 실제 M4 응답 점검과 성공 ○·실패 × 표시, RAG의 하위 숫자 입력 및 Stage 1 → Stage 2 임계값 안내 제거, 제공자 이름 `Hybrid(로컬LLM + Claude)`.
- Designer v2 데모를 검토 요청했다. Chrome 360·412·1280px에서 결과별 상태, 재검사, 키보드 조작, 모델 변경으로 무효화된 요청의 결과 무시를 검증했다. 승인 상태와 데모 파일 SHA-256은 frontmatter 참조.
- 격리 서버 초안에서는 기존 연결 테스트 API의 Hybrid 분기가 허용 모델만 받는다. 저장된 M4 게이트웨이 설정으로 합성 JSON 예시를 생성하고 필수 필드와 값이 일치하는지 확인하며 모델 선택을 저장하지 않는다. 일반 Stage 1 호출과 같은 30초 한도를 사용한다.
- 운영 RAG 세부 설정은 검색 기본값(과거 시그널 최대 5건, 뉴스 최대 3건, 뉴스·매크로 7일)과 일치한다. 기존 벡터 검색이 관련도·유효성·최신성으로 결과를 자동 선택한다. v2 격리 초안은 이 검색 설정을 서버에서 관리하고 설정 UI·API에는 활성 여부만 남긴다. DB에 있는 세부 옵션 행은 수정하지 않는다.
- 추가 조사: M4 게이트웨이 `a707243`의 `/v1/market-context`는 캐시가 없을 때 게이트웨이 기본 챗 모델로 시장 컨텍스트를 생성한다. 해당 릴리스의 설정은 `llama3.1:8b`이며 Ollama 등록을 읽기 전용으로 확인했다. 이 모델 선택은 StockInvest Stage 1과 별도다.
- 게이트웨이 기본 시스템 프롬프트가 점검 계약에 끼어드는 것을 막기 위해 점검 호출에 전용 시스템 메시지를 보냈다. 운영 M4에 세 모델을 순차적으로 1회씩 요청한 결과 Qwen3 8B는 8,419ms에 예시 JSON 통과, Gemma 4 12B와 Qwen2.5 14B Instruct는 30초 한도 초과였다. 이는 합성 응답 점검이며 종목 분석 완주/품질은 별도로 확인해야 한다.
- Ubuntu 격리 사본의 Stage 1·RAG retrieval·M4 caller Jest 27건 통과. Stage 1 기존 시험은 RAG 결합 분기를 모킹해 별도 실자료 RAG 결합 호출은 확인 범위에 포함되지 않는다. 새 체크 API 함수의 허용 목록, 서버 설정 주소 사용, JSON 및 타임아웃 실패 처리도 격리 호출로 확인했다.

## v3 수정 범위

- 검사 실패 시 체크 버튼 아래 한 줄 상태 영역에 실제 실패 이유를 표시한다. 20자 이하면 그대로 표시하고, 초과하면 앞 17자와 `...`를 표시한다. 성공·새 검사·모델 변경 시 이전 실패 이유를 지운다. 사용자가 v3을 승인했고 게이트가 승인 버전과 해시를 대조했다.

## 승인 v3 구현 및 검증

- 운영 커밋 기반 분리 checkout `/tmp/stock-t184-web-release.l20PNY/candidate`, 브랜치 `codex/t185-stage1-model-picker`에 구현 파일 9개를 적용했다. 공유 checkout에는 기존 작업과 충돌할 소스 변경을 적용하지 않았다. 커밋·푸시·배포 및 운영 설정 변경은 하지 않았다.
- 선택된 허용 모델의 연결·예시 JSON만 점검한다. 모델 태그까지 검증하고, 타임아웃·모델 불일치·응답 형식 오류를 구분한다. 설정은 모든 요청 값 검증 후 단일 다중 행 upsert로 반영한다. 이전 UI의 RAG 세부 숫자 필드는 무시하고 지원되는 필드는 기존대로 저장한다. 기존 RAG 상한은 동일하며 관련도와 최신성에 따라 검색한다.
- 실 앱 컴포넌트를 Chrome 412px 격리 렌더링해 API 응답을 모의했다. 기존 선택·Gemma 기본값·3개 옵션, 실패 길이와 접근성, 성공·실패·늦은 응답 무시, 모델 변경 저장 및 레거시 모델을 보존한 RAG 단독 저장을 확인했다.
- Ubuntu 격리 환경 TypeScript 검사 성공, 관련 Jest 11개 스위트 223건 통과(Jest 종료 지연 경고 있음). DB와 M4를 대역으로 실제 API/caller 함수의 검증 선행, 일괄 SQL, 세 허용 모델, 다른 응답 모델 거부를 확인했다.
- 인계 대상은 위 분리 checkout의 범위가 한정된 소스와 테스트 결과다. 동일한 변경을 보존한 로컬 패치는 `/Users/brownjeon/.codex/visualizations/2026/11/23/01a205cd-f721-7313-bd4e-8140fcac340e/T-185-implementation.patch`에 있다. Claude 최종 인수나 실제 운영 웹 통합·배포는 확인하지 않았다.

## Reviewer

- 초기 독립 리뷰에서 부분 저장, 검사 범위 표시, 응답 모델 태그 누락과 기존 RAG 필드 호환을 지적했다. 쓰기 전 전체 검증, 단일 SQL, 연결·예시 응답 표기, 태그 일치 검증을 반영했다. 이전 RAG 입력 호환 동작은 위에 명시했다.
- 최종 판정: PASS (scope: src/app/settings/LlmProviderSection.tsx, src/app/api/settings/llm-provider/route.ts, src/app/api/settings/llm-provider/test/route.ts, src/lib/llm/provider.ts, src/lib/llm/types.ts, src/lib/llm/stage1-models.ts, src/lib/llm/home-m4-api.ts, src/lib/rag/retrieval.ts, src/lib/strategy/ai-filter-stage1.ts). 승인 v3 및 코드 검토 범위 한정. 운영 DB 쓰기·동시성 실행·주문 경로 실동작은 범위 밖.
- [20:06][Reviewer] 독립 재검토 본인 기록. 최초 지적한 부분 저장은 전체 검증 후 단일 다중 행 upsert로, 응답 모델 검증 누락은 게이트웨이 반환 태그 일치 확인으로 수정됐다. 검사는 연결·예시 응답 확인임을 화면에 표시한다. RAG 고정 상한과 구버전 숫자 필드 무시의 의미를 보고했으며, 구버전 UI에서 값이 반영됐다고 오해할 가능성이 남는다. 검토한 격리 구현과 게시 checkout의 아래 9개 파일은 각각 SHA-256 일치했다. 데모 게이트 v3 승인·해시 검사 PASS. 운영 DB 쓰기·DB 동시성 실행·주문 경로 실동작은 평가하지 않았다.
- 최종 판정: PASS (scope: src/app/settings/LlmProviderSection.tsx, src/app/api/settings/llm-provider/route.ts, src/app/api/settings/llm-provider/test/route.ts, src/lib/llm/provider.ts, src/lib/llm/types.ts, src/lib/llm/stage1-models.ts, src/lib/llm/home-m4-api.ts, src/lib/rag/retrieval.ts, src/lib/strategy/ai-filter-stage1.ts)

## 데모 검토 (demo gate)

> 실행 판정 정본은 frontmatter `demo_gate` 이다. 이 표는 check.mjs 가 함께 기록하는 사람용 이력이다(docs/demo-review-gate.md).

| 버전 | 상태 | 저장소 파일 | Artifact | 사용자 결정 | 일시 |
|---|---|---|---|---|---|
| - | 작성중 | - | - | judge: delta (DM-low-confidence) | 11-23 19:05 |
| v1 | 검토요청 | mockups/T-185-hybrid-stage1-model-picker-v1.html | - | 사용자 검토 요청 | 11-23 19:07 |
| v1 | 수정요청 | mockups/T-185-hybrid-stage1-model-picker-v1.html | - | "선택박스 옆에 '체크'아이콘도 추가해서 클릭시 선택한 모델이 정상적으로 처리되는지에 대한 확인도 할 수 있도록 해줘." | 11-23 19:15 |
| v2 | 검토요청 | mockups/T-185-hybrid-stage1-model-picker-v2.html | - | 사용자 검토 요청 | 11-23 19:18 |
| v2 | 수정요청 | mockups/T-185-hybrid-stage1-model-picker-v2.html | - | "모델에 대한 모의 검사가 실패하면 아래 문구로 실패사유를 20글자내외로 표시해주고 20글자가 초과하면 '...'으로 처리해줘" | 11-23 19:35 |
| v3 | 검토요청 | mockups/T-185-hybrid-stage1-model-picker-v3.html | - | 사용자 검토 요청 | 11-23 19:37 |
| v3 | 승인 | mockups/T-185-hybrid-stage1-model-picker-v3.html | - | "데모화면 승인하니까 구현작업 진행해줘" | 11-23 19:40 |
