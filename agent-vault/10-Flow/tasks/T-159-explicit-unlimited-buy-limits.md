---
task_id: T-159
title: 매수 주문 한도에서 명시적으로 저장한 0%를 무제한으로 처리
status: done
project: StockInvest
created: 2026-11-07
updated: 2026-11-07
base_ref: f47cf28a015f21e16d017883cfb174113904daae
roles_involved: [leader]
related_tasks: [T-158, T-154, T-156]
tags: [type/task, domain/safety, domain/order]
aliases: [매수 주문 한도 0% 무제한]
execution_context:
  schema_version: 1
  origin_tool: codex
  current_tool: codex
  current_procedure: codex_scoped
  current_scope: "승인 v1 실제 화면 검증, 최종 QA 통과 조건부 운영 배포"
  last_event_id: exec-005
demo_gate:
  required: true
  level: "delta"
  status: "approved"
  version: 1
  repo_path: "mockups/T-159-explicit-unlimited-buy-limits-v1.html"
  artifact_url: ""
  content_sha256: "2f90291aa05234d5f461d0fbd9e97bc52107781d3102fb72556afb469410411f"
  decided_by: "judge"
  rule_id: "DM-kw-delta"
  approved_by: "user"
  approved_at: "2026-11-07T09:06:47+09:00"
  approval_quote: "T-159 v1 승인"
  waived_by: ""
  waived_at: ""
  waiver_quote: ""
  active: false
  approval_source: "codex_contextual"
---

## 목표와 승인 근거

사용자 요청은 “실제 동작도 설명과 같이 0으로 설정하면 '무제한'으로 동작하도록 변경해줘”다. 대상은 설정 → 안전장치 (공통)의 1회·일일 매수 한도다. [[T-158-remove-auto-submit-cap]]에서 제거한 자동 제출 상한과 [[T-154-auto-approval-mode-setting]]의 승인 모드는 별도다. 운영 배포 지시는 이 요청에 포함되지 않았다.

사용자는 1회 한도가 0%일 때 주문 산정 기준으로 “판단에이전트가 판단하여 잔금에 비례하여 종목 후보에 맞춰서 적절한 금액으로 판단하여 계산”을 선택했다. 고정 5% 또는 별도 고정 비율을 자동 주문 금액으로 삼는 안은 채택하지 않았다.

## 실행 도구·절차 이력

| 이벤트 ID | 시각(KST) | 사건 | 이전 → 현재 담당 / 현재 절차 | 범위·남은 일 | 근거 |
|---|---|---|---|---|---|
| exec-001 | 2026-11-07 00:30경 | start | 없음 → codex / codex_scoped | 현행 구현 대조, 설계·재현. 자동 매수 금액 기준 결정 및 실제 Claude 구현·독립 검증 남음 | 본 채팅의 사용자 요청 |
| exec-002 | 2026-11-07 00:35경 | resume | codex → codex / codex_scoped | 시장별 가용 잔금과 후보에 따른 판단 에이전트 배분을 설계에 반영. 실제 Claude 인수·구현·검증 남음 | 본 채팅 질문에 대한 사용자 응답 |
| exec-003 | 2026-11-07 01:04 기록 | resume | codex → codex / codex_scoped | T-159 구현·격리 검증을 직접 맡음. 안전 코드의 독립 커밋 감사와 운영 배포는 별도 | “T-159 작업문서를 읽고 이어받아서 직접 작업해줘 … 구현하고 검증해줘” |
| exec-004 | 2026-11-07 08:45 기록 | resume | codex → codex / codex_scoped | 독립 Reviewer 감사, 지적 수정 및 격리 QA. 두 관문 통과 후 운영 배포 | “T-159 독립 감사 진행해줘. 지적 사항 있으면 수정하고 다시 검증한 뒤, 통과하면 운영에 배포해줘.” |
| exec-005 | 2026-11-07 09:06 | resume | codex → codex / codex_scoped | 승인 v1과 실제 저장 흐름 대조, 지적 수정, 최종 QA 및 조건부 운영 배포 | “T-159 v1 승인. 실제 화면에서 0으로 설정시 무제한으로 설정되는지 검증하고 최종 QA 통과하면 운영에 배포해줘.” |

## 현행 확인

- 직전 운영 읽기 전용 조회에서 두 DB 값은 숫자 `0`이고 헬스체크는 `order_limits_unconfigured`였다. 기존 엔진에서 이 값은 신규 매수 차단이다.
- 설정 화면의 일괄 저장은 변경하지 않은 두 한도 값도 전송한다. 현재의 숫자 `0`만으로는 사용자가 차단 상태에서 무제한을 명시적으로 선택했는지 판별할 수 없다. 현재 코드의 `Number(JSON.parse(...))`도 `null`·`false`·빈 문자열을 0으로 만들 수 있다.
- 장중 전략 엔진과 `/api/analyst/run`은 1회 한도를 시그널 주문 금액 산정에도 사용한다. 기존 양수 경로는 장중 엔진에서 시장별 한도에 비용 여유를 뺀 값이다. 장마감 추천은 이미 자체 카드 금액으로 산정한다. `src/lib/db.ts`의 설치 초기 1회 비율은 5%다.
- [[T-156-us-stock-entry-exit-forecast-design]]은 후보 비교에 쓰는 판단 에이전트를 연구에서 시험했고, 순위 제안과 코드의 자원·주문 검증을 분리했다. 해당 연구 에이전트의 운영 배선은 확인되지 않았다. `records/judgment-*`는 현행 장마감 판단 기록이다. 운영에 있는 LLM 호출 경로와 현금·사이징 함수는 재사용 후보이며, 이번 결정은 연구 전략과 후보 선정 전체를 도입하는 근거로 삼지 않는다.

## 설계 및 인계 범위

1. 설정에서 한도를 직접 편집해 0을 저장하면 각 필드의 명시적 무제한 상태를 기록한다. 기존 숫자 `0`, 초기값, 빈 입력, 다른 설정을 저장할 때 따라온 값, 오래된 클라이언트의 일괄 저장은 무제한을 새로 켜지 않게 구분한다. 후보는 기존 JSON 열에 명시적 상태를 저장하는 방식이다. 구버전은 이 상태를 양수로 읽지 않으므로 코드 롤백 시에도 매수 차단 방향으로 동작한다. 기존 양수 설정과 국내·해외 별도 계산은 보존한다.
2. `order-limits.ts`의 설정 판독과 주문 판정을 한 곳에서 구분한다. 양수 비율, 명시적 무제한, 미설정/오류를 분리하며 `Infinity`를 주문 금액이나 무제한 승인 증거로 사용하지 않는다. 무제한인 항목에서 금액 상한 비교만 생략한다. 금액·수량 검증, 다른 한도 항목, 검증 전략·예수금 확인, 킬스위치·DRY_RUN, 유한 일일 한도의 타 주문 예약 합산을 유지한다.
3. 1회 한도가 명시적으로 무제한일 때 장중 `engine.ts`와 `api/analyst/run`은 후보에 맞춰 시장별 가용 잔금을 배분한다. 아래 판단·금액 계약을 적용한다. 양수 1회 한도 경로와 주문 금액이 이미 독립적으로 정해지는 장마감 카드·수동 주문에는 이 배분을 연결하지 않는다. 일일 한도만 무제한인 경우에는 1회 한도 기반 산정 경로가 그대로 성립한다.
4. `/api/health`와 `ops/metrics/live-set.ts`, 승인 문맥에서 상태 표현을 대조한다. 명시적 무제한을 미구성이나 금액 0으로 표시하지 않으며, 조회 장애는 기존 안전 방향으로 처리한다. 화면은 양수/무제한/미구성 구분과 명시적 편집 경로가 필요한 부분만 검토한다.

### 판단·금액 계약

- 기존 규칙과 관문을 거친 매수 후보를 시장별로 함께 비교한다. 판단 입력은 후보 식별자, 통과 근거·위험, 현재 가격, 보유 비중과 주문 단위 등 가용 잔금 대비 상대 지표를 사용한다. 국내 KRW와 해외 USD 가용 현금은 합치지 않는다. 기존 `readAvailableCash`와 검증된 환율·주문 비용 계산을 재사용하고, 정확한 계좌 잔액·계좌 식별자는 모델 입력 대신 로컬에서 사용한다. 신규 제공자나 자격증명 도입은 범위에 포함되지 않는다.
- 에이전트는 각 후보에 이번 시장 가용 잔금의 배정 비율과 근거를 제안하거나 보류할 수 있다. 예를 들어 비율을 정수 bp로 받는다면 개별 값은 0~10,000bp이고, 시장별 합계는 10,000bp 이하만 허용한다. 남겨 둔 비율은 현금으로 유지한다. 중복·미등록 후보, 음수·비수치·합계 초과, 응답 오류·시간 초과는 유효한 주문안으로 채택하지 않는다. 판단 호출은 종목별 무제한 동기 호출로 연결하지 않고 장중 크론·청산 경로에 대한 지연을 격리한다.
- 코드는 확인된 주문 가능 현금에서 미체결·동시 주문과 겹치는 자원을 확인하고, 양수 일일 한도가 있으면 일일 잔여액도 반영한다. 그 범위 안에서 `가용 잔금 × 배정 비율`로 금액을 계산하고 수수료, 환율, 호가 단위, 정수 수량을 적용해 실제 주문 비용을 다시 검증한다. 현금·환율·후보 가격을 확인할 수 없거나 최소 주문 단위에 미달하면 해당 신규 매수를 보류한다. 기존 현금 게이트가 `unknown`을 허용하는 동작은 새 배분 경로의 가용 예산 확인을 대신하지 못한다.
- 발행·송신은 기존 검증 관문, `createSignal`과 `submitOrder` 경로를 사용한다. 최신 잔금·예약과 충돌하는 중복 배분은 재검사하며 기존의 현금 공제와 같은 예약을 중복 차감하지 않는다. 후보·결정 시각·배정 비율·실제 수량 및 채택·보류 사유를 남긴다. 판단 에이전트에는 설정 변경·시그널 발행·주문 실행 권한을 주지 않는다.

## 검증 계획 및 전달 상태

- 작성자 재현에서 실제 `order-limits.ts`에 모의 DB와 평가액을 연결했다. 저장 0, 누락, DB 예외, 깨진 JSON, 불리언, JSON null은 두 검사 모두 거부했고, Infinity도 거부했다. 양수 5%·10%는 평가액 100만 원에서 5만 원·10만 원으로 계산됐다. 기존 Jest 테스트는 로컬 SWC 네이티브 바인딩을 로드하지 못해 0건 실행됐다.
- 대상은 한도 판독·검사, 안전장치 설정의 저장·표시, 전략 주문 금액 산정, 헬스·운용 표시와 관련 시험으로 한정한다. 현재 로컬 HEAD에는 직전 운영 릴리스가 없으므로 실제 구현 전 최신 기준과 동시 작업 변경을 확인한다.
- 격리된 DB/거래소 모의 환경에서 각각 0/양수 조합, 기존 저장 0, 누락·깨진 값·DB 장애, 다른 설정 저장, 무한대·NaN 금액, 유한 일일 한도의 동시 주문, 양 시장, 수동 및 자동 진입, 매도·킬스위치·DRY_RUN과 화면/헬스 일치를 확인한다. 실주문은 검증 수단으로 쓰지 않는다.
- 배분 검증에는 복수 후보 간 서로 다른 비율과 현금 잔류, 배분 합계 초과·미등록 후보·모델 실패, 오래된 잔고·환율, 최소 1주 미달, 장중 가격 변경과 미체결·동시 실행, 양수 일일 잔여액을 포함한다. T-156 연구 성과로 주문 배분 기능의 운영 검증을 대신하지 않는다.
- 위 Claude 인계안은 exec-002 당시의 계획이다. exec-003에서 사용자가 Codex의 직접 구현·검증을 명시했다. 실제 Claude 인수나 외부 검토는 실행되지 않았다.

## Codex 구현

- 설정의 1회·일일 매수 한도에서 직접 편집한 0을 전용 저장 요청으로 보내고 JSON 문자열 상태로 저장한다. 한도만 저장할 때 다른 설정을 전송하지 않는다. 기존 저장 0, 빈 입력, 누락·오류와 다른 사이트의 요청으로 무제한을 활성화할 수 없다. 헬스와 운용 현황은 실제 한도 판독을 따른다.
- 1회가 명시적 무제한인 장중 매수에서 시장별로 후보를 묶어 기존 LLM 제공자에게 배정 비율만 묻는다. 정확한 예수금·계좌 식별자는 로컬 계산에만 사용한다. 장중 매도는 배정 호출 전에 처리한다. 국내와 해외 잔금·미체결 예약을 분리하고, 정수 수량·호가·비용과 유한 일일 한도 잔여액을 반영한다.
- 적응 배정 시그널은 즉시 제출, 승인 후 제출, 진입 감시에서 공통 주문 래퍼로 들어간다. 주문 직전 가용 잔금과 예약을 다시 읽어 검증하고, 해외 어댑터는 검증된 USD 지정가를 사용한다. 잔금 조회 중 체결된 주문은 보수적으로 차감한다. 브로커 반영 시점이 겹치면 사용 가능한 금액을 작게 계산할 수 있다. 외부 계좌 주문 반영 시점과 실제 KIS 환경은 이번 격리 검증의 범위 밖이다.
- 기존 자동 제출 모드·전략 검증·킬스위치·DRY_RUN·매도 면제 분기는 재사용한다. 장마감 카드와 사람이 직접 정한 주문 금액은 에이전트 배정에 넣지 않는다.

## Codex 검증

- Ubuntu 격리 사본에 T-159 소스·시험 29개를 올리고 로컬과 각 파일의 바이트를 대조했다. 사본은 기록된 기준 HEAD에 T-159 파일만 더한 형태로, 공유 작업 트리의 다른 미커밋 변경을 포함하지 않는다.
- 운영 환경변수 없는 사본에서 타입 검사와 Next.js 빌드 통과. 전체 Jest 결과는 390 스위트 통과, 7 스위트 건너뜀, 11,110 테스트 통과, 267 테스트 건너뜀, 실패 0이다. 판정 모델·KIS 송신은 모의 호출이다. UI 하네스에서 기존 0을 열고 닫아도 저장이 생기지 않고, 직접 입력한 0은 한도만 PATCH 하는 것을 확인했다.
- 네트워크를 끈 MariaDB 10.11.11 일회용 컨테이너에서 실제 예약 SQL을 실행했다. 자기 주문 제외, 다른 계좌·시장 제외, 부분체결 잔량·조회 중 체결 반영, 금액 미확정 검출을 3가지 결과로 확인했다.
- 설치된 Ubuntu Claude CLI의 도구·MCP 비활성화 인자는 도움말 실행으로 확인했다. 실제 모델 응답, 실계좌 잔금과 외부 주문 반영 시점, 운영 UI와 주문은 검증하지 않았다. 독립 Reviewer 판정·커밋·푸시·배포는 별도다.

## Reviewer

- [08:38] 독립 감사 1차 (실행 도구 Codex, gpt-6.1-terra). 현재 공유 작업 트리에서 배정된 T-159 코드와 관련 시험 일부를 정적으로 대조했다. 실계좌·운영 환경·기능 테스트는 실행하지 않았고, 다른 작업 변경은 판정하지 않았다. 작업 트리의 변경 가능성이 있어 이 판정은 수정 전 후보에 한정한다.
- [08:38] **R1 — CRITICAL, 응답 불명 주문의 현금 예약 누락.** `src/lib/signals/adaptive-buy-cash.ts:45-48`은 pending·accepted·partially_filled와 최근 filled만 예약에 합산한다. 반면 `src/lib/safety/dry-run.ts:314-330`은 송신 중 네트워크 오류·5xx 또는 송신 후 예외의 주문을 rejected/failed로 기록하면서 접수 여부 불명으로 처리한다. 브로커가 주문을 접수했으나 응답이 유실되고 잔금에 아직 반영되지 않은 경우, 다음 적응 매수가 같은 현금을 다시 배분할 수 있다. 실제 접수·잔액 반영 여부를 확인하기 전까지 불명 주문의 자원을 보수적으로 유지하는 방안과 재현 시험이 필요하다. 위 경로는 정적 분석이며 실제 브로커 반영 시간은 미검증이다.
- [08:38] **R2 — HIGH, 무제한 설정이 분석가 매도 신호를 건너뜀.** `src/app/api/analyst/run/route.ts:30-32,85-88`에서 1회 무제한이면 룰에 금액 0을 전달하고 반환된 sell을 `sell_amount_unavailable`로 생략한다. 이전 경로는 해당 신호를 `createSignal`로 전달했다. 사용자 계약의 매도 경로 유지와 불일치한다. 매도 금액의 기준을 보존하고 양수·무제한 양 경우 매도 처리 회귀를 확인해야 한다.
- [08:38] **R3 — HIGH, 구버전 저장으로 무제한 상태 소실.** `src/app/api/settings/safety/route.ts:62-68,303-306,335-340`은 저장된 unlimited를 GET에서 숫자 0으로 표시하지만 구버전의 일괄 PATCH가 이 값을 숫자 0으로 저장한다. 다른 설정을 저장하는 동작만으로 한도가 미구성 상태로 바뀌어 신규 매수가 차단될 수 있다. 구버전의 다른 설정 저장이 명시적 무제한을 보존하는지 확인해야 한다.
- [08:38] 확인 범위에서는 적응 매수의 전략 검증, 지정가·정수 수량·가용 현금 재검사, 기존 킬스위치·DRY_RUN 경유, 시장·계좌별 예약 필터, 모델 응답의 후보 ID·비율 검증 코드를 대조했다. 이는 해당 경로의 완전성이나 운영 안전성 통과를 뜻하지 않는다. 현금·환율 및 브로커 반영 지연, 실제 모델 호출, 동시 실행, 구버전 클라이언트와 매도 동작은 별도 실행 검증이 필요하다. R1은 자금 안전에 직결되므로 수정·재감사 전 QA 및 배포 진행을 중단하도록 Leader에 전달했다.
- [08:38] **최종 판정: FAIL (scope: src/lib/safety/buy-limit-config.ts, src/lib/safety/order-limits.ts, src/lib/safety/dry-run.ts, src/lib/signals/adaptive-buy-cash.ts, src/lib/signals/entry-cash-precheck.ts, src/lib/signals/service.ts, src/lib/signals/approval-context.ts, src/lib/strategy/adaptive-buy-sizing.ts, src/lib/strategy/engine.ts, src/lib/strategy/eval-funnel-labels.ts, src/lib/exchanges/types.ts, src/lib/exchanges/kis-overseas.ts, src/lib/llm/types.ts, src/lib/llm/provider.ts, src/lib/llm/claude-cli.ts, src/lib/ops/metrics/live-set.ts, src/app/api/settings/safety/route.ts, src/app/api/health/route.ts, src/app/api/analyst/run/route.ts, src/app/api/cron/entry-watcher/route.ts, src/app/settings/SettingsPage.tsx)**
- [08:46] 독립 재감사 2차 (Codex, gpt-6.1-terra). Ubuntu 격리 후보 `/home/brownjeon/.node-local/stockinvest-t159-release.FJcWn1ys`, 기준 `2ce01869cd95992a49b35ec198cbed1a72193037`을 대상으로 31개 지정 파일의 SHA-256을 `/tmp/t159-final-source.sha256`과 대조해 모두 일치했다. `git ls-files --others --exclude-standard`로 신규 파일을 확인했다. 1차 감사와 이번 변경분에 대한 정적 대조이며, SQL·기능 시험·실계좌·운영 접근은 실행하지 않았다.
- [08:46] **R1 미해결 — CRITICAL, 기존 송신 결과 불명 failed 행 누락.** 새 송신 예외는 `src/lib/safety/dry-run.ts:317-340`에서 마커를 저장하고 `src/lib/signals/adaptive-buy-cash.ts:47-50`, `src/lib/safety/order-limits.ts:261-265`가 기존 네트워크·5xx와 새 마커를 합산한다. 그러나 기준 HEAD의 `dry-run.ts:306-311`은 송신 후 예외를 `status='failed'`만 기록하고 접수 불명으로 반환했다. 기존 `failed` 행의 `blocked_by`가 NULL인 경우 새 `src/lib/safety/submission-outcome.ts:9-10` 조건에 포함되지 않아 해당 주문이 실제 접수됐고 현금에 미반영된 상태라면 후속 배분이 이 자원을 빠뜨린다. 이런 운영 행의 실제 존재 여부는 미확인이다. 이전 행을 보존하면서 접수 불명을 식별하거나 확인 전 보수적으로 다루는 방안과 격리 재현이 필요하다. 자금 안전에 직결되므로 수정 및 재감사 전 QA·배포 중단을 Leader에 요청했다.
- [08:46] **R2 수정 확인, 실행 검증 대기.** 이전 양수 비율이 존재하는 전환은 설정 upsert가 이전 값을 보존하고 `getLegacyAnalystSellAmount`가 매도 금액을 산정해 analyst 경로가 sell을 전달한다. 이전 양수 비율이 없으면 매도 금액을 산정하지 못해 건너뛰며, 실제 SQL·매도 실행은 검증하지 않았다.
- [08:46] **R3 수정 확인, 실행 검증 대기.** 기존 무제한을 조건부 upsert로 보호하여 오래된 일괄 저장의 0·양수 값에 덮어쓰이지 않도록 했고, 전용 편집은 양수로 바꿀 수 있다. MariaDB SQL 실행과 동시성 검증은 별도 QA 범위다.
- [08:46] **최종 판정: FAIL (scope: src/lib/safety/buy-limit-config.ts, src/lib/safety/order-limits.ts, src/lib/safety/dry-run.ts, src/lib/safety/submission-outcome.ts, src/lib/signals/adaptive-buy-cash.ts, src/lib/signals/entry-cash-precheck.ts, src/lib/signals/service.ts, src/lib/signals/approval-context.ts, src/lib/strategy/adaptive-buy-sizing.ts, src/lib/strategy/engine.ts, src/lib/strategy/eval-funnel-labels.ts, src/lib/exchanges/types.ts, src/lib/exchanges/kis-overseas.ts, src/lib/llm/types.ts, src/lib/llm/provider.ts, src/lib/llm/claude-cli.ts, src/lib/ops/metrics/live-set.ts, src/app/api/settings/safety/route.ts, src/app/api/health/route.ts, src/app/api/analyst/run/route.ts, src/app/api/cron/entry-watcher/route.ts, src/app/settings/SettingsPage.tsx, src/lib/strategy/__tests__/adaptive-buy-sizing.test.ts, src/lib/strategy/__tests__/engine-collect-fanout-t148.test.ts, src/lib/safety/__tests__/submit-order.test.ts, src/lib/safety/__tests__/order-limits-failsafe.test.ts, src/lib/signals/__tests__/signal-cash-gate-order-parity.test.ts, src/app/api/settings/safety/__tests__/explicit-buy-limits.test.ts, src/app/settings/__tests__/settings-touch-keyboard-t130.test.ts, src/app/settings/__tests__/settings-post-market-overseas.test.ts, src/app/api/analyst/run/__tests__/route.test.ts)**
- [08:49] 독립 재감사 3차 (Codex, gpt-6.1-terra). Ubuntu 격리 후보 `/home/brownjeon/.node-local/stockinvest-t159-release.FJcWn1ys`, 기준 `2ce01869cd95992a49b35ec198cbed1a72193037`. 지정 32개 파일의 SHA-256을 `/tmp/t159-final-source.sha256`과 대조해 모두 일치했고 신규 파일 목록도 확인했다. 1·2차 감사 및 3차 수정분의 정적 검토 결과다.
- [08:49] **R1 수정 확인.** 기존 `failed`·`blocked_by NULL` 행은 `trade_logs`의 해당 주문에 명확한 `error`/`safety_check` 기록이 있을 때만 예약에서 제외하고, 기록 부재·phase 부재·`post_send`는 현금 예약과 일일 합계에 포함한다. 신규 송신 전 실패에는 `submit_not_sent`, 송신 후 결과 불명에는 `submit_outcome_unknown`을 저장한다. 금액을 확인할 수 없는 예약 행은 적응 예산 산정을 보류한다. 관련 구현은 `src/lib/safety/submission-outcome.ts`, `src/lib/safety/dry-run.ts`, `src/lib/signals/adaptive-buy-cash.ts`, `src/lib/safety/order-limits.ts`다.
- [08:49] **R2·R3 수정 유지.** 기존 양수 한도에서 무제한으로 전환할 때 이전 비율을 보존해 analyst sell에 사용하고, 구버전 일괄 저장에서 무제한을 덮어쓰지 않도록 한 조건을 재확인했다. 이전 양수 비율이 없는 경우 analyst sell 금액은 산정하지 못한다.
- [08:49] 범위 내 추가 차단 결함은 정적 검토에서 발견하지 못했다. 이 판정은 수정된 격리 후보의 감사 범위에 한정한다. MariaDB SQL·동시성·전체 QA·실계좌·운영 모델과 브로커 반영 시간은 본 감사에서 실행하거나 확인하지 않았다. SQL 실행 및 QA 결과는 별도로 필요하다. 결과를 Leader에게 전달했다.
- [08:49] **최종 판정: PASS (scope: src/lib/safety/buy-limit-config.ts, src/lib/safety/order-limits.ts, src/lib/safety/dry-run.ts, src/lib/safety/submission-outcome.ts, src/lib/signals/adaptive-buy-cash.ts, src/lib/signals/entry-cash-precheck.ts, src/lib/signals/service.ts, src/lib/signals/approval-context.ts, src/lib/strategy/adaptive-buy-sizing.ts, src/lib/strategy/engine.ts, src/lib/strategy/eval-funnel-labels.ts, src/lib/exchanges/types.ts, src/lib/exchanges/kis-overseas.ts, src/lib/llm/types.ts, src/lib/llm/provider.ts, src/lib/llm/claude-cli.ts, src/lib/ops/metrics/live-set.ts, src/app/api/settings/safety/route.ts, src/app/api/health/route.ts, src/app/api/analyst/run/route.ts, src/app/api/cron/entry-watcher/route.ts, src/app/settings/SettingsPage.tsx, src/lib/strategy/__tests__/adaptive-buy-sizing.test.ts, src/lib/strategy/__tests__/engine-collect-fanout-t148.test.ts, src/lib/safety/__tests__/submit-order.test.ts, src/lib/safety/__tests__/order-limits-failsafe.test.ts, src/lib/safety/__tests__/t081b-daily-limit-race-disposable-mariadb.test.ts, src/lib/signals/__tests__/signal-cash-gate-order-parity.test.ts, src/app/api/settings/safety/__tests__/explicit-buy-limits.test.ts, src/app/settings/__tests__/settings-touch-keyboard-t130.test.ts, src/app/settings/__tests__/settings-post-market-overseas.test.ts, src/app/api/analyst/run/__tests__/route.test.ts)**


- [09:10] 데모 게이트 보완 독립 감사 (Codex, gpt-6.1-terra). 증거 `../.claude/state/demo-gate/evidence.jsonl`의 T-159 승인 행에서 작업·v1·사용자 발화 지문·세션·해시를 확인하고, 연결된 실제 사용자 발화가 v1 승인과 실제 화면 검증·QA 통과 후 배포 요청임을 대조했다. 데모 파일 SHA-256은 승인 값 `2f90291aa05234d5f461d0fbd9e97bc52107781d3102fb72556afb469410411f`와 일치했고 격리 후보 32개 파일도 기존 매니페스트와 일치했다. 한도 입력, 미구성/무제한/양수 표시, 0의 명시적 저장과 한도 편집 별도 요청은 코드상 v1과 대조했다. 실제 브라우저·API·DB 동작은 본 감사에서 실행하지 않았다.
- [09:10] **D1 — material, 혼합 편집 시 저장 실패의 결과 차이.** 승인된 v1은 한도와 경고 등 여러 항목을 편집한 상태에서 저장 실패를 주입하면 저장된 값 전체가 보존된다고 보여 준다. 반면 `src/app/settings/SettingsPage.tsx:503-529`는 한도와 다른 설정을 별도의 PATCH로 동시에 전송한다. 한쪽이 성공하고 다른 쪽이 실패하면 성공한 항목은 저장되며 화면은 저장 실패를 표시한다. 이 부분 성공 시나리오가 데모의 저장 결과와 다르므로 Leader에게 전달했다. 구현을 승인 데모와 맞추거나 변경 내용을 사용자에게 제시해 판단받은 뒤 재감사해야 한다.
- [09:10] 승인 증거 위치를 확인하는 과정에서 요청한 파일 범위를 넘어 `../.claude/tools/demo-gate/gate.mjs`와 `codex-evidence.mjs`의 evidence 경로 관련 검색 결과 일부를 읽었다. 외부 전송은 없었다. 기존 3차 코드 정적 감사 PASS와 별개로 화면 게이트 판정은 아래와 같다.
- [09:10] **최종 판정: FAIL (scope: src/lib/safety/buy-limit-config.ts, src/lib/safety/order-limits.ts, src/lib/safety/dry-run.ts, src/lib/safety/submission-outcome.ts, src/lib/signals/adaptive-buy-cash.ts, src/lib/signals/entry-cash-precheck.ts, src/lib/signals/service.ts, src/lib/signals/approval-context.ts, src/lib/strategy/adaptive-buy-sizing.ts, src/lib/strategy/engine.ts, src/lib/strategy/eval-funnel-labels.ts, src/lib/exchanges/types.ts, src/lib/exchanges/kis-overseas.ts, src/lib/llm/types.ts, src/lib/llm/provider.ts, src/lib/llm/claude-cli.ts, src/lib/ops/metrics/live-set.ts, src/app/api/settings/safety/route.ts, src/app/api/health/route.ts, src/app/api/analyst/run/route.ts, src/app/api/cron/entry-watcher/route.ts, src/app/settings/SettingsPage.tsx, src/lib/strategy/__tests__/adaptive-buy-sizing.test.ts, src/lib/strategy/__tests__/engine-collect-fanout-t148.test.ts, src/lib/safety/__tests__/submit-order.test.ts, src/lib/safety/__tests__/order-limits-failsafe.test.ts, src/lib/safety/__tests__/t081b-daily-limit-race-disposable-mariadb.test.ts, src/lib/signals/__tests__/signal-cash-gate-order-parity.test.ts, src/app/api/settings/safety/__tests__/explicit-buy-limits.test.ts, src/app/settings/__tests__/settings-touch-keyboard-t130.test.ts, src/app/settings/__tests__/settings-post-market-overseas.test.ts, src/app/api/analyst/run/__tests__/route.test.ts)**


- [09:13] 승인 데모 차이 수정 후보 독립 재감사 (Codex, gpt-6.1-terra). Ubuntu 격리 후보 `/home/brownjeon/.node-local/stockinvest-t159-release.FJcWn1ys`의 32개 파일은 최신 `/tmp/t159-final-source.sha256`과 모두 일치했고 v1 데모 해시도 승인 기록과 일치했다. 이전 감사 후 변경된 설정 API·화면 및 해당 시험을 정적으로 대조했다. 실제 브라우저·MariaDB 실패 주입·전체 QA·운영은 본 감사에서 실행하지 않았다.
- [09:13] **D1 수정 확인.** 한도와 경고 등 안전 설정을 하나의 PATCH와 단일 다중 행 upsert로 보내고, 전송 전 검증 오류 및 명시된 즉시 안전 스위치 혼합은 거부한다. 안전 설정 요청 실패 시 전략 요청은 실행하지 않고 편집 상태를 남긴다. 전략 요청은 안전 설정 성공 후 별도 실행하며 실패 시 전략 실패로 표시한다. 이전 R1~R3 판정에 해당하는 나머지 후보는 동일 해시다. 동시성·SQL 원자성·실제 실패 주입은 별도 QA에서 검증해야 한다.
- [09:13] 처음 제기한 후속 `syncEngineSwitchesFromLegacy()` 예외의 API 실패 전파 가설은 철회한다. Leader가 추가 확인을 허용한 `src/lib/signals/router.ts:189-227`을 직접 읽어 이 함수의 DB 예외가 내부 catch에서 null로 반환됨을 확인했다. 네트워크 응답 유실 때의 반영 여부는 실제 실행으로 확인하지 않았다.
- [09:13] **최종 판정: PASS (scope: src/lib/safety/buy-limit-config.ts, src/lib/safety/order-limits.ts, src/lib/safety/dry-run.ts, src/lib/safety/submission-outcome.ts, src/lib/signals/adaptive-buy-cash.ts, src/lib/signals/entry-cash-precheck.ts, src/lib/signals/service.ts, src/lib/signals/approval-context.ts, src/lib/strategy/adaptive-buy-sizing.ts, src/lib/strategy/engine.ts, src/lib/strategy/eval-funnel-labels.ts, src/lib/exchanges/types.ts, src/lib/exchanges/kis-overseas.ts, src/lib/llm/types.ts, src/lib/llm/provider.ts, src/lib/llm/claude-cli.ts, src/lib/ops/metrics/live-set.ts, src/app/api/settings/safety/route.ts, src/app/api/health/route.ts, src/app/api/analyst/run/route.ts, src/app/api/cron/entry-watcher/route.ts, src/app/settings/SettingsPage.tsx, src/lib/strategy/__tests__/adaptive-buy-sizing.test.ts, src/lib/strategy/__tests__/engine-collect-fanout-t148.test.ts, src/lib/safety/__tests__/submit-order.test.ts, src/lib/safety/__tests__/order-limits-failsafe.test.ts, src/lib/safety/__tests__/t081b-daily-limit-race-disposable-mariadb.test.ts, src/lib/signals/__tests__/signal-cash-gate-order-parity.test.ts, src/app/api/settings/safety/__tests__/explicit-buy-limits.test.ts, src/app/settings/__tests__/settings-touch-keyboard-t130.test.ts, src/app/settings/__tests__/settings-post-market-overseas.test.ts, src/app/api/analyst/run/__tests__/route.test.ts)**

## 데모 검토 (demo gate)

> 실행 판정 정본은 frontmatter `demo_gate` 이다. 이 표는 check.mjs 가 함께 기록하는 사람용 이력이다(docs/demo-review-gate.md).

| 버전 | 상태 | 저장소 파일 | Artifact | 사용자 결정 | 일시 |
|---|---|---|---|---|---|
| - | 작성중 | - | - | judge: delta (DM-kw-delta) | 11-07 08:51 |
| v1 | 검토요청 | mockups/T-159-explicit-unlimited-buy-limits-v1.html | - | 사용자 검토 요청 | 11-07 08:54 |
| v1 | 승인 | mockups/T-159-explicit-unlimited-buy-limits-v1.html | - | "T-159 v1 승인" | 11-07 09:06 |

## 감사 수정 및 배포 준비 — Codex

- 1·2차 감사 지적을 반영했다. 접수 불명 송신은 신규 마커로 기록하고 현금 예약과 당일 한도 집계에 포함한다. 구버전 `failed/NULL`도 포함하며, 송신 전 실패라는 기존 `safety_check` 감사 로그가 있는 행만 제외한다. 확정 거부와 신규 `submit_not_sent`는 예약하지 않는다.
- 무제한으로 전환하기 직전 양수 비율을 설정 쓰기에서 원자적으로 보존한다. 이 비율은 기존 수동 분석 RSI 매도 금액에만 사용한다. 이력이 없으면 RSI 매도 금액은 산정 불가로 보고한다. 구버전 일괄 저장의 0·양수는 명시적 무제한을 보존하고, 전용 편집은 의도한 유한 한도로 바꿀 수 있다.
- 배포 후보는 Ubuntu 독립 clone의 `origin/main=2ce01869cd95992a49b35ec198cbed1a72193037` 위에 코드·시험 32개만 덧씌웠다. Mac과 서버 SHA-256 전부 일치, 기준 차이에서 대상 경로 겹침 없음. 격리 MariaDB 10.11.11 일일 한도 경합 시험과 대상 회귀 5 스위트 77건 통과. 별도 네트워크 없는 컨테이너에서 예약·한도·설정 실제 SQL 11개 결과 행 일치.
- Reviewer 3차 정적 판정 PASS는 코드 후보에 한정한다. QA가 설정 입력·저장 흐름의 데모 승인 기록 부재를 확인했다. 로컬 규칙 Judge의 첫 요청 요약은 입력 흐름과 오류 상태를 빠뜨려 none이었고, 실제 변경 범위를 반영한 재판정에서 delta / `DM-kw-delta`가 나왔다. 게이트 도구로 drafting을 기록했다. 사용자 화면 검토와 QA 최종 판정 후 운영 배포한다. 현재 후보는 미커밋·미푸시 상태다.

## Designer 기록

- [08:54] 설정 → 안전장치 (공통) 매수 한도 delta 데모 v1을 작성했다. `mockups/T-159-explicit-unlimited-buy-limits-v1.html` · SHA-256 `2f90291aa05234d5f461d0fbd9e97bc52107781d3102fb72556afb469410411f` · 공식 `DEMO_LINT_PASSED`. 기존 T-130 값 행과 SettingsPage 표시·입력·저장 흐름을 대조했다. 현재와 제안은 동일 합성값으로 비교하며, 실패 재현·초기화·저장된 값 표시는 데모 전용이다.
- [08:54] 디자인 스킬: project-ui-system(부분)·ui-component-builder·ui-design-reviewer·ui-accessibility-reviewer / 자체 점검 P0 0·P1 0·P2 0, a11y Critical 0·Major 0·Minor 0(데모 범위). 격리 Chromium 360·412·1280px에서 수평 넘침 0, 56px 행·44px 입력, Enter·blur 확정 및 Escape 취소·포커스 복귀, 무입력·음수 거부, 0 저장 실패·재시도, 무제한↔양수 및 다른 설정 저장의 한도 보존을 확인했다. 412px 캡처를 육안 점검했다. 운영 화면·API·실거래 실행과 스크린리더 실기기 검증은 이 증거에 포함되지 않는다. 사용자 검토 및 승인 버전 인계 대기.

## QA

- [08:54] 격리 후보 직접 실행 (Codex, gpt-6.1-terra). Ubuntu 로컬 /home/brownjeon/.node-local/stockinvest-t159-release.FJcWn1ys, 기준 2ce01869cd95992a49b35ec198cbed1a72193037. 지정 32개 파일 SHA-256 대조 일치, .env 부재 확인. 운영 변수 없이 env -i 및 flock·nice 실행. TypeScript --noEmit PASS, Next.js build PASS, Jest 전체 393 suites PASS·7 skipped, 11,145 tests PASS·268 skipped, 실패 0. KIS·모델·DB를 모의한 시험이며 운영 계좌·실모델·실주문 검증은 아니다.
- [08:54] Jest 실행 범위에 submit-order.test.ts(DRY_RUN 송신 0·상태/감사 로그, 킬스위치, 블랙리스트, 1회·일일 제한, 거부·예외 기록 및 결과 불명), 송신 직전 킬스위치, order-limits 회귀(기존 0·명시 무제한·미구성), adaptive-buy-sizing(국내·해외 후보·현금, 일일 한도, 잘못된 배분·판단 시간 초과), explicit-buy-limits(전용 저장·구버전 및 invalid body), analyst/run route(매도 금액과 적응 매수), kis-throttle, settings-touch-keyboard가 포함된다. 실효 심볼 정책은 시장별 블랙리스트다.
- [08:54] 멱등성은 네트워크 없는 일회용 MariaDB 10.11.11에서 운영 DDL과 같은 client_order_id UNIQUE KEY를 둔 최소 테이블에 동일 ID 두 번 INSERT하여 두 번째 ERROR 1062, 행 수 1을 직접 확인했다. 전체 주문 엔드포인트의 중복 HTTP 응답은 미검증이다. 관련 변경 SQL의 사용자 값은 바인딩을 사용한다. 변경 diff에서 일반적인 키 문자열 패턴 검색은 일치 0이며 전수 보안 감사는 아니다.
- [08:54] 별도 Lead 실행 보고. loopback 일회용 MariaDB에서 일일 한도·경합 및 관련 5 suites 77/77 PASS, 네트워크 없는 별도 MariaDB에서 예약·일일·설정 SQL 결과 11행 기대와 일치. 이는 QA 본인의 실행 결과가 아니다.
- [08:54] 데모 게이트 BLOCKED. check.mjs check --task T-159 실행 결과 DEMO_GATE_BLOCKED, 사유 task frontmatter 에 demo_gate 가 없습니다. SettingsPage.tsx에서 한도 입력 동작·표시와 저장 바가 변경되므로 적용 대상과 사용자 승인/면제를 Leader가 확인해야 한다.
- [08:54] 화면 NOT_VERIFIED. CUA getState로 Chrome 브라우저 도구 존재를 실제 확인했다. 승인된 데모와 격리 후보 fixture 화면이 아직 준비되지 않아 실제 브라우저의 모바일·데스크톱, light·dark, 가로 넘침, 터치 크기와 승인본 대비 검증은 진행하지 않았다. CUA 인벤토리 조회 외 스크린샷 산출물 0개. 승인·기준 확인 후 실제 후보 화면을 확인해야 한다.
- [08:54] 종합 판정 HOLD. 실행한 자동 검증은 통과했으나 데모 관문과 브라우저 시각 검증이 미완료다. 운영 배포에 대한 QA PASS를 발급하지 않았다.

- [09:12] 재개 시 demo-gate check PASS, 승인 v1 해시 확인 및 후보 32개 SHA-256 재대조 일치. Chrome에서 승인본을 실제 열고 412×915 화면에서 1회 미구성→0 입력/Enter→무제한 표시·저장바→저장 후 무제한을 확인했다. 데모 본문 폭 412px로 가로 넘침 0, 한도 행 68~69px이었다. 이는 데모 확인이며 실제 후보의 0% 저장 검증은 아니다.
- [09:12] 격리 후보는 SSH loopback 터널에서 /settings가 실제 로그인 화면으로 연결되는 것까지 확인했다. 테스트 인증정보 직접 입력·토큰 주입을 하지 않아 실후보 로그인 뒤 화면·저장은 QA가 직접 검증하지 않았다. CUA viewport를 원복하고 해당 QA 탭을 닫았다.
- [09:12] Reviewer 승인본 대조 감사는 혼합 편집 후 일부 요청 실패 시 승인본의 저장 실패 의미와 다른 동작을 지적하여 FAIL. 따라서 종합 판정은 HOLD를 유지한다. 후보 수정 시 기존 32개 해시와 그 해시에 대한 자동검증은 새 후보의 검증을 대신하지 않는다.

- [09:19] 수정 후보 재검증. 데모 check approved v1 PASS, 지정 32파일 SHA-256 재대조 일치 및 .env 부재 확인. 타입 검사 PASS. 격리 DB 합성 로그인 후 QA가 직접 실제 safety GET/PATCH를 호출해 MariaDB 트리거 실패 시 한도와 경고가 모두 유지됨을 확인했고, 트리거 해제 후 재시도, 구버전 일괄 저장에서 무제한 보존, 다른 사이트 403, 양수/무제한 전환과 GET, DRY_RUN·킬스위치 true 유지가 통과했다. 운영 접속은 하지 않았다.
- [09:19] Lead의 격리 실제 Chromium/Next/일회용 MariaDB 하네스와 JSON 결과를 QA가 읽고 검토했다. 서버 발급 정상 인증, 초기 미구성, 빈 입력·ESC 취소, 혼합 저장 실패·재시도, 1회·일일 0 저장과 새로고침, 다른 설정 저장 보존, 양수 복귀를 Lead가 실행해 PASS를 기록했다. QA는 Lead가 저장한 후보 360·412·1280px 캡처를 직접 열어 승인본의 문구·상태와 배치를 육안 대조했다. 360px에서 설명이 줄바꿈되며 값과 겹치지 않았고 1280px에서도 두 행을 확인했다. Lead 측정 가로 넘침 0, 높이 81·65·65px로 44px 이상이었다. 412×915·DPR1, Chrome, timezone Asia/Seoul 기준. 테마 시스템 설정 light/dark의 실제 후보 캡처를 직접 확인했고, Lead가 계산한 배경 rgb(15,17,21)·글자 rgb(230,232,238)는 동일했다. 별도 라이트 테마가 없는 현행 화면이다. 확인 후 임시 스크린샷 5개를 삭제했다.
- [09:19] 첫 전체 Jest 시도에서 Mac tar가 격리 사본에 생성한 AppleDouble 테스트 2개가 구문 오류로 FAIL하여 실행을 중단했다. Lead의 확인 후 격리 사본의 4개 sidecar만 제거하고 앱 32파일 해시를 재대조한 뒤 전체 Jest를 재실행 중이다. 첫 시도는 불완전하며 새 결과와 구분한다.

- [09:20] 최종 수정 후보의 격리 전체 Jest 재실행 완료. 393 suites PASS·7 skipped, 11,147 tests PASS·268 skipped, 실패 0, 163.246초. 실행 후 32파일 해시 재확인 일치, .env 및 src AppleDouble 부재. TypeScript --noEmit은 QA 직접 PASS, Next 빌드는 Lead가 같은 최종 해시에서 PASS를 보고했으며 QA가 이 해시의 빌드를 별도 재실행하지 않았다.
- [09:20] 검증 통과. 판정 범위는 위 명시한 승인 v1과 최종 후보의 격리 회귀·실제 격리 DB API·Lead 실행 실제 브라우저 증거 및 QA의 360/412/1280px 캡처 육안 대조다. 주문 API의 동일 clientOrderId 중복 HTTP 응답, 실제 모델·KIS·운영 데이터와 운영 주문 실행은 NOT_VERIFIED다. 로컬 MariaDB UNIQUE 제약은 별도 확인했다. 전략 설정은 안전 설정 성공 후 별도 요청이며 실패 시 전략 오류로 표시된다는 Reviewer의 범위 구분을 유지한다. 발견된 미해결 Critical·High·기능 결함 0건.
- [09:20] QA 최종 판정: PASS. 배포 후 확인 요청은 정확한 릴리스 SHA·RELEASE_RESULT, 웹 및 cron 각 1개, health·DB·안전 상태, 기존 한도와 DRY_RUN/킬스위치의 유지 확인이다. 실제 거래나 운영 설정 변경으로 확인하지 않는다.

## 배포 보류 — 화면 승인 대기

- 운영 사전 조회 `20261107-002331-2ce01869`, `/api/health` 정상(DB 정상·안전 green), `dryRun=true`·`killSwitch=false`·`limitsConfigured=true`. 운영 변경과 푸시 없이 기존 릴리스 유지.
- 데모 v1을 공식 도구로 `review_requested` 등록하고 현재 Codex root 세션의 요청 영수증과 파일 해시가 일치함을 확인했다. `check`는 사용자 승인 대기로 BLOCKED다. 배포 의사는 이전 사용자 지시로 확인했으며, 남은 것은 이 데모 버전 승인과 해당 버전 대비 실제 후보 화면 검증·QA 최종 판정이다.



## v1 승인 후 실제 화면 검증 — Codex

- 사용자 승인 원문을 같은 Codex root 세션의 정식 증거로 대조해 `DEMO_GATE_APPROVED` 및 `DEMO_GATE_PASSED`를 확인했다. v1 SHA-256 `2f90291aa05234d5f461d0fbd9e97bc52107781d3102fb72556afb469410411f`.
- 승인본과 실제 후보의 혼합 저장 차이를 수정했다. 명시 한도와 다른 안전 설정은 단일 PATCH·단일 MariaDB 문장으로 저장한다. 안전 저장 실패 시 전략 요청도 시작하지 않는다. 즉시 안전 스위치와 구형 한도 필드는 명시 한도 요청에 혼합할 수 없다. 수정 대상 4개 파일 포함 최종 후보 32개가 Mac/Ubuntu SHA-256 일치했다. 관련 회귀 3 스위트 84건, 타입 검사와 Next.js 빌드를 확인했다.
- 실제 후보 Next.js와 일회용 MariaDB 10.11.11, Chromium 격리 프로필 및 테스트 로그인으로 검증했다. legacy 0 미구성, 빈 입력·Escape의 설정 보존, 1회·일일 각각 0 저장 후 재조회 무제한, 다른 설정 저장 후 보존, 4%·8% 복귀를 확인했다. 실제 MariaDB 트리거 오류로 혼합 저장 PATCH가 한 번 실패한 뒤 두 DB 값이 그대로였고, 재시도는 200으로 두 값이 함께 변경됐다.
- 360·412·1280px에서 화면의 가로 넘침은 0이고 한도 행은 각각 81·65·65px였다. 합성 계정으로 서버 정상 로그인 API가 세션을 발급했다. 운영 계정·증권사·실주문 테스트는 수행하지 않았다.

## 배포 기록

| 시각 (KST) | 릴리스 | 커밋 | 포함 작업 | 결과 | 비고 |
|---|---|---|---|---|---|
| 2026-11-07 09:22 | 20261107-092140-fb3b9bbb | fb3b9bbb | T-159 명시적 무제한 매수 한도·판단 에이전트 잔금 기반 주문 금액 | ✅ ok | 사용자 승인 v1, QA 최종 PASS 후 Leader push가 시작한 webhook 배포. exact SHA `fb3b9bbb2a95f2c4aaa101c51d818343193aae7f`, RELEASE_RESULT status=ok, webhook END exit=0. DB 마이그레이션·APK 없음. |

- [09:23] 배포 후 독립 확인: `scripts/deploy.sh StockInvest --status`에서 current 릴리스가 위 SHA와 일치, 웹·cron 각 1개 online이며 두 앱의 cwd가 새 릴리스, 로컬 헬스 200. 공개 `/api/health` HTTP 200, `ok=true`, DB 정상, safety green, DRY_RUN=true·KILL_SWITCH=false·limitsConfigured=true·국내/해외 한도 해석 완료. 읽기 전용 Chrome에서 운영 홈이 렌더링되고 “실거래여부 OFF · 실거래 차단”으로 표시됨을 확인했다.
- cron 로그는 컷오버 직후 일부 내부 요청 HTTP=000/503 timeout을 기록했으나 다음 틱에서 portfolio-snapshot·trade-report 및 job-run-log 전송이 회복됐고, 이후 cron 잡은 정상으로 기록됐다. KIS OpenAPI 상태 및 PM2 재시작 횟수는 독립 확인하지 않았다. 운용 한도·DB·거래 상태는 변경하지 않았다.

## 완료 — Codex

- 최종 Reviewer와 QA 통과 이후 Ubuntu safety commit-msg 훅을 통과했다. 코드·시험 32개, 승인 데모와 작업문서만 포함한 `fb3b9bbb2a95f2c4aaa101c51d818343193aae7f`를 main에 fast-forward 푸시했다. 공유 체크아웃의 별도 변경은 릴리스 후보에 포함하지 않았다.
- 2026-11-07 09:22:59 KST, 웹훅의 exact SHA `RELEASE_RESULT` status ok 및 END exit=0. current `20261107-092140-fb3b9bbb`이며 웹·cron 각 1개가 새 cwd에서 online, 각각 재시작 0. 초기 헬스 요청은 시간 초과됐고 최종 확인은 HTTP 200, DB true, safety green, DRY_RUN true, 킬스위치 false, 한도 구성 및 국내·해외 실효 한도 확인 true. 로그인 진입 HTTP 200.
- 마이그레이션은 없었다. 운영 한도 저장·실주문은 실행하지 않았다. 0% 저장 검증은 운영과 같은 후보 코드의 격리 화면·API·일회용 DB에서 수행했다.
