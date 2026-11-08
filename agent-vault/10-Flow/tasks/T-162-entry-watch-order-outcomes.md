---
task_id: T-162
title: 진입 감시 주문 결과 반영 및 완료 주문 목록 제외
status: done
waiting: []
created: 2026-11-08
updated: 2026-11-08
base_ref: ebbcdca714499243ccd3411f9df55d66e1297b58
roles_involved: [leader, judge, developer, reviewer, qa, deployer]
related_tasks: [T-043, T-049, T-108]
tags: [type/task, domain/ui, domain/trading]
aliases: [주문 선점 과거 주문 정리]
execution_context:
  schema_version: 1
  origin_tool: codex
  current_tool: codex
  current_procedure: codex_scoped
  current_scope: "사용자가 추가 승인한 T-162 기록 커밋 f01e5b8만 원격 main push 및 자동 배포 결과 확인. 코드·운영 DB 변경 없음"
  last_event_id: exec-009
demo_gate:
  required: true
  level: "full"
  status: "approved"
  version: 1
  repo_path: "mockups/T-162-entry-watch-order-outcomes-v1.html"
  artifact_url: "http://127.0.0.1:8762/T-162-entry-watch-order-outcomes-v1.html"
  content_sha256: "80c9ca2aa8add80b03a49091ed97740de915b345a2cc5affb4a280eb4e420c84"
  decided_by: "judge"
  rule_id: "DM-kw-full"
  approved_by: "user"
  approved_at: "2026-11-08T15:37:44+09:00"
  approval_quote: "이 시안으로 승인해"
  waived_by: ""
  waived_at: ""
  waiver_quote: ""
  active: false
  approval_source: "codex_contextual"
---

# T-162 — 진입 감시 주문 결과 반영

## 목표

사용자 요청: “체결·취소된 3건은 이력은 보존하면서 진입 감시 목록에서 빠지도록 정리하고, 앞으로도 주문 결과가 화면에 제대로 반영되게 수정해줘.”

- 과거 시그널과 orders/executions/trade_logs는 삭제·수정하지 않는다. executing 잠금을 풀지 않는다.
- 연결 주문이 filled/cancelled인 행은 현재 진입 감시 목록과 홈/거래 건수에서 제외한다. 원 시그널/주문 조회 이력은 그대로 보존한다.
- 진행 중 주문은 접수·부분체결·테스트·결과 확인 필요 등을 실제 주문 상태에 맞게 구분한다. 번호 없는 선점·판정 불명은 숨기지 않는다.
- 실제 주문/취소, 안전 설정 변경, 운영 DB 쓰기는 범위 밖. 웹 표시 수정의 검증·배포를 준비한다.

## 관련 과거 이력 요약

- [[T-043-entry-watcher-preorder-claim]]: 주문 전 executing 선점으로 중복 제출 방지. 성공/불명은 잠금 유지. 표시 정리를 이유로 잠금 해제 금지.
- [[T-049-dashboard-executing-label]]: 주문 번호만으로 접수 확정 불가. withOrder 응답 및 decision-outcome의 기존 분류가 있어 재사용 검토. 이미 5월 executing 3건의 filled/filled/cancelled 기록을 관측한 이력.
- [[T-108-automation-menu-home-overhaul]]: 현 거래 화면은 executing을 일괄 선점 중으로 표시하며 홈/거래 count는 주문 결과를 보지 않는다.

## 확인한 현황

2026-11-08 14:42 KST 운영 DB 읽기 전용 조회: executing 3건, approved_pending_entry 0건. 시그널 5326→주문3137 cancelled, 5330→3138 filled, 5327→3139 filled. executions 상세 0행으로 증권사 실제 체결량/가격 대조는 미확인. 운영 릴리스 당시 20261108-140336-cb969ee2. 로컬 공유 checkout은 낡음·타 세션 변경이 있어 보존 필요.

## 설계 초안

원본 상태는 보존하고 read model에서 연결 orders를 조회해 종료 여부와 상태를 판정한다. 동일 판정을 count/list에 적용해 서로 어긋나지 않게 한다. 종료 제외 조건은 명시적 filled/cancelled만이며 NULL/모르는 값은 확인 필요로 남긴다. 기존 표시 분류/토큰을 재사용하고 임의 레이아웃·CTA 변경은 하지 않는다. 새 문구/흐름이 필요하면 demo gate 결과를 따른다.

## 역할별 지시사항

- Judge: intake 및 demo 수준을 정식 도구로 판정. 기능 요약만 전송.
- Developer: 승인된 표시 수정과 의미 있는 회귀 테스트만, 타인의 변경 보존. 소스 변경 전 게이트 확인. 운영 DB 쓰기·주문·배포 금지.
- Reviewer: 독립 감사. 종료 주문 제외, 불명 보존, count/list 일치, 이력 보존 및 주문 잠금 불변을 검토.
- QA: 지정 테스트·격리 DB/합성 렌더 검증, 운영 읽기 전용 확인. 주문/cron 실행 금지.
- Deployer: QA 이후 승인 범위와 절차 확인, 웹 배포 및 운영 결과 조회. DB 이관 없음.

## 실행 도구·절차 이력

| 이벤트 ID | 시각(KST) | 사건 | 이전 → 현재 / 절차 | 범위·남은 일 | 근거 |
|---|---|---|---|---|---|
| exec-001 | 2026-11-08 | start | 없음 → codex / codex_scoped | 지정 표시 수정 접수. 게이트·구현·독립검토·최종검증·배포 남음 | 현재 사용자 요청 |
| exec-002 | 2026-11-08 15:38 | resume | codex → codex / codex_scoped | 승인 v1 지정 화면 구현 및 독립 검증. 배포 미포함 | 사용자 “이 시안으로 승인해. 화면 구현과 독립 검증까지 진행해줘.” |
| exec-003 | 2026-11-08 15:53 | scope_completed | codex → codex / codex_scoped | 승인 v1 지정 구현·독립 Reviewer/QA 검증 완료. 미커밋·미배포. 운영 반영은 별도 범위 | 사용자 요청 범위와 실제 검증 결과 |
| exec-004 | 2026-11-08 15:55 | resume | codex → codex / codex_scoped | T-162만 커밋·배포 및 운영 목록/이력 검증. 새로운 승인 범위로 재개 | 사용자 “T-162 변경분만 커밋하고 운영에 배포해줘. 배포 후 3건이 진입 감시 목록에서 빠지고 이력은 남아 있는지도 확인해줘.” |
| exec-005 | 2026-11-08 16:04 | scope_completed | codex → codex / codex_scoped | T-162 전용 커밋·운영 배포 및 배포 전후 이력 해시/목록 제외 검증 완료 | RELEASE_RESULT ok·후속 health200·독립 QA 운영 READ ONLY 검증 |
| exec-006 | 2026-11-08 17:25 | scope_completed | codex → codex / codex_scoped | 사용자 앱에서 기존3건 미노출 확인을 기록하고 최종 종결. 코드·운영 변경 없음 | 사용자 “앱에서 기존 3건이 진입 감시에서 사라진 것 확인했어. T-162 작업 마무리해줘.” |
| exec-007 | 2026-11-08 17:33 | resume | codex → codex / codex_scoped | T-162 작업문서·보드·현재 현황·일일 로그의 T-162 기록만 분리 커밋. 기능 done/대기없음 유지 | 사용자 “T-162 배포 결과와 앱 확인 완료 기록도 다른 작업 변경은 제외하고 커밋해줘.” |
| exec-008 | 2026-11-08 17:37 | resume | codex → codex / codex_scoped | 기존 완료 상태 유지, 기록 커밋 f01e5b8의 main push·자동 배포 확인 수행 | 사용자 “기록 커밋 f01e5b8도 다른 작업은 제외하고 원격 main에 push해줘. 자동 배포 결과도 확인해줘.” |
| exec-009 | 2026-11-08 17:41 | scope_completed | codex → codex / codex_scoped | 기록 커밋 f01e5b8만 원격 main push 및 자동 배포 후검증 완료 | 원격 SHA 일치·RELEASE_RESULT ok·health200·문서4파일 배포 해시 일치 |

## Leader

- [15:59] 사용자 추가 승인에 따라 T-162 전용 커밋 `57600fff104d3a6fa53af1d104038c5d14cfc9b5`를 서버 ext4 별도 checkout(codex/t162-release)에서 생성. parent는 현 운영/원격 main `c61545746cb7a8f740aec448c13d71a7f5f589f2`. 검증10파일+승인데모+T162task 총12파일만 포함, 기존모드보존. shared main은 reset/checkout하지 않았고 unrelated dirty/untracked는 보존했다. clone hook설치·전체시험 통과. 외부 Claude의 이전 미실행 한계는 유지하며 현재 사용자 배포 지시를 수행한다.

- [15:49] 실제 구현 CUA 시각 확인(Codex IAB): 최종 실 TradeNowPanel + decisionOutcome + global/ops CSS를 합성 SSR로 생성한 fixture 8상태(closed/active/unknown/boundary/countsError/error/unauthorized/loading) 확인. CSS 뷰포트 360×800·412×915·1280×900에서 document.scrollWidth=innerWidth, DPR1. 승인 v1 헤더·접수/부분체결/테스트·10분 경계·불명/집계실패·로그인 필요·정상0 구분 관측. 412 active/closed PNG는 채팅 전용 visualization 디렉터리에 저장하고 Designer가 직접 대조 PASS. HTMLlang ko, Date.now KST 고정, 웹폰트 다운로드 없음, 애니메이션 비활성화 별도 조작 없음. IAB 버전·OS locale/timezone 조회는 도구에서 노출되지 않아 미확인. 실제 useEffect/poll/fetch/API/로그인/실기기·상단안전띠/하단내비 셸은 이 SSR 검증 범위 밖. 브라우저 viewport override는 원복.

- [15:43] C1 Claude 정식 runner 판정: claude-result@1 skipped/checkpoint_not_selected. design_uncertain=false로 호출했고 실제 provider 검토·소스 전송 없음. C2는 Reviewer PASS 이후 별도 정식 경로로 확인. 이번 사용자 승인 범위는 지정 화면 구현과 독립 검증까지이며 commit/push/배포 미포함.

- [15:20] 데모 v1 review_requested 등록: sha256 80c9ca2aa8add80b03a49091ed97740de915b345a2cc5affb4a280eb4e420c84, localhost 프리뷰를 사용자 브라우저 패널에 표시. CUA 실제 미리보기 폭 360(client358/scroll358), 412(client410/scroll410), 1280(client1278/scroll1278) 수평 초과 없음. 기본 종료3건→0건, 접수/부분체결/테스트 및 집계 실패 문구를 실제 조작 확인. OS 브라우저 확대율 때문에 viewport override와 CSS 폭은 달랐으며 위 수치는 데모 컨테이너 실제 폭 기준이다. 합성 시안의 렌더 확인이며 실제 앱 UI·실기기 QA는 아님. 화면 소스는 승인 전 미수정. backend 독립 준비만 진행.

- [15:15] 운영 DB 읽기 전용 사전 검증: 제안 LEFT JOIN 조건으로 현재 목록 0행(1ms), 기존 원본 3행의 executing/연결 주문 filled·filled·cancelled는 그대로 조회됨. EXPLAIN은 signals idx_signals_status(ref, 추정3행)와 orders PRIMARY(eq_ref,1행) 사용. 실제 수정 SQL의 최종 검증은 구현 후 별도. UI 승인 대기 전에 가능한 데이터 보존·쿼리 준비 수행.

- [15:13] 지정 3건을 삭제/상태복구하지 않고 read model에서 완료 주문만 제외하기로 설계. 실제 원본 이력·중복주문 방지 잠금 유지. 기존 decisionOutcome 재사용 조사 완료. 사전 독립 Reviewer의 NULL/unknown 유지·LIMIT 전 제외·집계 실패 가시성·부분체결 취소 주의 반영 지시. UI는 demo 승인 전 미구현, backend 독립 준비만 배정. 판정 규칙 DM-kw-full 때문에 full 데모가 필요하며 사용자 범위를 화면 전면개편으로 확대하지 않음.

## 판단 기록 (judge)

- [2026-11-08 14:50] intake engine=jev → local_fix / R2 / developer_model=opus / next=demo_first; demo=full/designer(DM-kw-full), actions=prepare_demo,request_demo_approval,assign_developer | overrides=R2-kw-payment,DM-kw-full | fallback=- | tokens=1373

## Developer

- [15:17] backend 담당 Codex: `trade.ts`·`signal-counts.ts`·`types.ts` 및 metrics 시험 2개만 수정. signals.executing/consumed_order_id 원본·주문 잠금은 변경하지 않고, orders PK LEFT JOIN에서 명시적 filled/cancelled만 목록·홈/거래 count에서 제외. NULL/missing/unknown/번호없음 보존, 공통 `ACTIVE_EXECUTING_ORDER_SQL` 재사용, WHERE 제외 후 LIMIT 20. DTO optional nullable consumedOrderId/orderStatus/orderBlockedBy 제공(기존 since 유지), 기존 decisionOutcome 재사용 가능. 조회 실패는 기존 section error 유지.
- [15:17] backend 검증: 우분투 `/tmp/stockinvest-t162.84a9`에 운영 기준 cb969ee2 archive + 소유 5파일만 복사, .env 미복사, Linux current/node_modules 링크. `node node_modules/jest/bin/jest.js --runInBand --runTestsByPath src/lib/ops/metrics/__tests__/entry-watch-outcomes.test.ts src/lib/ops/metrics/__tests__/signal-counts.test.ts src/lib/ops/metrics/__tests__/ops-read-only-fence.test.ts` → 3 suites/78 tests PASS. `node node_modules/typescript/bin/tsc --noEmit --incremental false` → exit 0. 새 시험은 Python3 SQLite :memory:에서 실제 SELECT를 실행: newer 종료25건을 LIMIT 전 제외, open/null/unknown/missing/no-ID 11건 보존, count/list 11=11. DTO 매핑·orders 조회 실패 전달·SELECT-only 울타리 포함. git diff --check 통과. Mac 표준 Jest는 SWC native binding 누락, lint는 설정 파일 부재, Mac tsc는 기존 dependency/type 오류로 실패(최종 타입 근거는 위 Linux PASS). 임시 TS transformer 재시도는 중단했고 최종 근거로 사용하지 않음.
- [15:17] 안전 self-check: 주문 송신/DRY_RUN/Kill Switch/한도/심볼/감사로그 쓰기 경로 수정·실행 없음, 읽기 전용 울타리 PASS. 실주문 5항목 실행 검증은 이 backend 범위에 해당 없음. UI 데모 미승인으로 TSX 편집·서버 기동·curl·운영 DB 접근·commit/push/배포 없음. QA 잔여: MariaDB 실제 쿼리 실행/EXPLAIN과 동시 주문 상태 변경 시 병렬 count/list의 순간 차이, 승인 UI 연결. Reviewer 재검증 뒤 QA 순환 필요.

- [15:43] UI 담당 Codex: 사용자 승인 v1 + Designer 구현 가이드 수신 뒤 gate check 실행: `DEMO_GATE_PASSED` / `task: T-162` (approved_version v1, hash verified). `TradeNowPanel.tsx`만 앱 UI 수정. 기존 decisionOutcome/HINT_TEXT 재사용으로 접수/부분체결/테스트/번호 유무/정확히10분/10분초과/미래5분초과 판정과 title/sub/glyph를 승인대로 반영. 진입구간 도달 일괄단정 제거. count error/missing은 숫자 —·집계 확인 실패, stale/error 응답은 확인된0 금지·기존 행 갱신실패 안내. fetch/poll·취소 CTA·기존 layout·잠금 불변. 기존 취소 시험의 옛 고정문구 기대값만 새 판정으로 갱신.
- [15:43] UI 최종 검증: `/tmp/stockinvest-t162.84a9` Linux 표준 Jest 7 suites/142 tests PASS(신규 t162-entry-watch-render + 기존 trade-render/watch-cancel-sheet/trade-cancel-refresh + backend3), tsc --noEmit --incremental false exit0, diff --check PASS. 첫 실행 신규 시험의 버튼 기대값을 기존 RetryButton 실제 문구 '다시 시도'로 수정, tsc 중복 상태 비교1건 제거 후 재검증 PASS. SSR transition은 props/DTO별 재렌더이며 React useEffect/poll 실행 검증이 아님. backend fixture 종료25건 제외 시험과 UI 상태별 렌더를 함께 확인했지만 실제 API→브라우저 통합·로그인·실기기 검증은 미실행.
- [15:43] 브라우저 독립검증 환경: `T162_FIXTURE_OUTPUT=/tmp/stockinvest-t162-fixtures`를 신규 렌더 시험 실행에 지정하면 실 TradeNowPanel·decisionOutcome·globals.css·ops.module.css의 합성 SSR HTML 생성. useEffect/fetch 미실행·운영 API 없음. 서버와 Mac `/tmp/stockinvest-t162-fixtures`에 index/closed/active/unknown/boundary/countsError/error/unauthorized/loading.html 준비. Mac `python3 -m http.server 8763 --bind 127.0.0.1 --directory /tmp/stockinvest-t162-fixtures` 후 `http://127.0.0.1:8763/active.html` 등으로 Reviewer/QA 검토 가능(버튼 실제동작은 SSR에서 미실행). 신규 화면 테스트의 fixture 목록 링크는 테스트 페이지 전용.
- [15:43] 격리 build 실행: `.env` 없이 DB_HOST=127.0.0.1 DB_PORT=9 DRY_RUN=true KILL_SWITCH=true SIGNAL_STATUS_ENUM_AUTO_ALTER=false로 운영접근 차단. `next build`는 공유 auth-oauth 패키지 core/exchange.js·providers/github.js·google.js 등 누락으로 webpack 실패(`/tmp/T-162-linux-build.log`), 앱 변경의 build 통과는 주장하지 않음. 운영 DB·주문·cron·commit/push·배포 미수행. Reviewer 잔여: nonempty count/list 별도 SELECT 순간 불일치, QA MariaDB SQL/EXPLAIN·360/412/1280 브라우저 확인. docs/screens.md는 담당 밖으로 Leader에 전달.

- [15:44] Reviewer 문서 누락 지적 및 Leader 추가 배정으로 `docs/screens.md` §3 운용 현황 1문장만 실제 주문 결과 표시·filled/cancelled 목록/건수 제외·원본 이력/잠금 보존으로 갱신, diff-check PASS. 앱 소스 동결 유지. 요약 문구 데모/가이드 차이는 Leader/Designer 판정 대기, 임의 변경하지 않음.

- [15:47] Reviewer/Leader 채택 수정: 승인 v1 요약을 정확히 '감시 중 N · 주문 선점 N · 다음 세션 N'으로 반영(count 실패/누락은 각 —). 기존 t108-trade-render 기대값1건 수정·신규 t162 시험에 다음세션4 및 실패— 검증 추가. manifest 총10파일(task 이력 별도), 앱 소스 재동결. Linux 표준 Jest 최종 7 suites/143 tests PASS, tsc --noEmit --incremental false PASS. SSR fixture도 최신 재생성해 Mac `/tmp/stockinvest-t162-fixtures`로 복사 완료. Reviewer와 QA에 명령·manifest·동결해시 전달, QA는 Reviewer 최종판정 대기.
- [15:47] build 판정 정정: 첫 실패를 공용 원본 파일 누락으로 설명했으나 실제 원본은 NAS shared에 존재했음. 정식 배포는 releases/shared→NAS shared 링크 구조이며 외부 node_modules 전체를 task 사본에 링크한 격리 준비가 상대 공용 모듈 경로를 잘못 만들었음. task 사본 node_modules만 개별 기존 의존성 링크로 준비하고 @workspace/auth-oauth·api-usage를 NAS에서 복사(.env 파일 없음 확인), 공용 원본/운영 설정/새 의존성 설치는 변경하지 않음. 첫 재빌드는 이전 .next 캐시의 낡은 경로로 실패했으므로 사본 `.next`를 `/tmp/stockinvest-t162-next-cache-first-attempt`로 분리하고 재빌드 → **BUILD_EXIT=0**(`/tmp/T-162-linux-build-clean.log`). DB_HOST=127.0.0.1:9·DRY_RUN=true·KILL_SWITCH=true·.env 없음 유지. 최초실패 `/tmp/T-162-linux-build.log`, 환경보완후캐시실패 `/tmp/T-162-linux-build-prepared.log`, 최종성공을 구분함. 이는 운영 검증/배포가 아님.

## Reviewer

- [15:12] 사전 설계 검토(Codex, 구현 전·최종 판정 아님): 허용 범위 기존 코드에서 executing 전체 집계·20건 목록, 별도 SELECT와 UI의 count null 폴백을 확인했다. 주문 연결 NULL/미존재·알 수 없는 상태는 SQL NULL 3값 논리로 누락되지 않게 보존하고 종료 상태 제외는 LIMIT 이전에 적용할 것. count/list 동일 기준을 쓰되 병렬 조회 중 상태 전환·개별 실패를 고려하고 count 실패를 0으로 오인하지 않도록 검증할 것. executing은 다른 승인 경로도 포함되므로 진입 구간 도달 단정 금지. 기존 decisionOutcome의 번호 없음 시간 경계 및 결과 불명 분류 재사용 검토. filled/cancelled는 DB 기록이며 부분체결 후 취소·과거 원장 부재를 구분. 2.5초 판독 기한 내 MariaDB 조인 성능·컬럼 한정 및 격리 시나리오 확인 필요. 원본 잠금·이력 수정 금지. 구현·데모·독립 최종 감사·QA는 미수행.


- [15:47] 최종 독립 코드감사(Codex Reviewer, 2차): 1차에서 승인 v1의 요약 문구 `주문 선점` 및 `다음 세션` 누락을 defect로 통지했고 Designer 정정·Developer 수정 후 재감사했다. 헤더·상태별 문구·오류 시 0건 위장 방지·기존 CTA 유지가 승인 v1/정정 가이드와 일치한다. DEMO_GATE_PASSED, 사용자 원문 해시와 T-162 v1 승인증거·데모 해시·세션을 대조했다. 실제 브라우저·접근성·운영 UI 검증은 본 감사 범위 밖.
- [15:47] 데이터/안전 검토: 동일 SQL 조건으로 `filled`/`cancelled`만 제외하며 LEFT JOIN의 NULL·미연결·알 수 없는 결과는 보존, 목록은 LIMIT 이전 제외한다. 주문 상태·시그널·이력·executing 잠금에 대한 변경은 검토 대상 diff에 없으며 조회 실패는 섹션 오류로 전파된다. 이 판정은 변경 10파일에 국한되고 기존 주문 송신·KIS·전략 전체의 안전성을 보증하지 않는다. 6개 검토 영역 중 변경된 SQL·표시·호환·성능/보안 경계를 확인했고 전송/DB쓰기/거래소 경로는 변경 없음으로 해당 범위에 한정했다.
- [15:47] 잔여 LOW: `buildTrade`에서 목록과 집계는 별도 병렬 SELECT라 조회 사이 주문 상태가 바뀌면 일시적으로 건수와 목록이 다를 수 있다. 특히 건수 0/목록 1의 경우 기존 UI는 행을 표시하지만 불일치 경고는 내지 않는다. 다음 poll에서 회복될 수 있으나 즉시 일치가 보장되지는 않으며 DB 스냅샷 단위 원자성은 이번 범위에서 검증하지 않았다. 기존 20건 목록 상한도 유지한다. QA에는 양방향 경합·목록 제한·읽기 전용 MariaDB·실제 응답 실패·상태별 SSR 검증을 인계한다.
- [15:47] 대상 파일 해시 SHA-256 앞12자리: trade.ts `1bd23e3e25b5`; signal-counts.ts `544082d7dff9`; types.ts `5af42e7902e4`; signal-counts.test.ts `dc8b491b0c43`; entry-watch-outcomes.test.ts `c9832842ac9b`; TradeNowPanel.tsx `d23b8a9363d4`; t162-entry-watch-render.test.ts `f87a0c182c64`; t108-watch-cancel-sheet.test.ts `f633159cd255`; t108-trade-render.test.ts `cb145f017492`; docs/screens.md `2354bab43a54`. 기존 checkout 기준 ebbcdca와 운영 기준 cb969ee2 사이 기존 대상 8파일의 내용 차이 0. 새 시험 2개는 별도 읽었다. 최종 변경파일 외·실제 브로커·실기기는 미검토.
- [15:47] **최종 판정: PASS (scope: src/lib/ops/metrics/trade.ts, src/lib/ops/metrics/signal-counts.ts, src/lib/ops/metrics/types.ts, src/lib/ops/metrics/__tests__/signal-counts.test.ts, src/lib/ops/metrics/__tests__/entry-watch-outcomes.test.ts, src/app/recommend/TradeNowPanel.tsx, src/__tests__/t162-entry-watch-render.test.ts, src/__tests__/t108-watch-cancel-sheet.test.ts, src/__tests__/t108-trade-render.test.ts, docs/screens.md)**

## QA

- [16:03] 배포 후 독립 QA(Codex): Deployer의 `RELEASE_RESULT ok`·릴리스 `20261108-160042-57600fff`·exit 0 통지 뒤 16:02:35 KST 새 REPEATABLE-READ / READ ONLY 트랜잭션에서 기준선(15:58:24 KST, 릴리스 `20261108-154918-c6154574`)과 4개 전체 행셋을 대조했다. signals 3행 SHA `ac10a25bc6e2…`, orders 3행 `39f9b795ffde…`, executions 0행 `4f53cda18c2b…`, 관련 trade_logs 6행 `10cf948456de…` 모두 기준선의 건수·전체 행셋 SHA-256 일치. 서로 다른 시점의 별도 트랜잭션이며 원문·계좌·자격정보는 파일이나 로그에 쓰지 않았다. 로그 범위는 주문 id와 payload signalId/signal_id의 대상만 포함한다.
- [16:03] 실운영 current 릴리스의 `EXECUTING_SQL`·`WATCH_COUNT_SQL`·공통 predicate를 소스에서 직접 추출해 읽기 전용으로 실행: 목록 0행, 시장별 집계 0행(앱 카운터 기본값 국내·해외 각0). 목표 시그널 3건에 대한 별도 조건 판정도 LIMIT 없이 0행이어서 목록 상한으로 가려졌을 가능성을 배제했다. 조회 전후 current 릴리스 동일. SQL 소스 SHA-256: trade.ts `1bd23e3e25b5…`, signal-counts.ts `544082d7dff9…`; Reviewer 승인 대상과 일치한다. 운영 DB 쓰기·DDL·주문·cron 호출 없음.
- [16:03] 운영 SQL/원장 보존 검증 PASS. 로그인 인증된 HTTP 응답·실제 앱 화면·실기기 및 증권사 원장 직접 대조는 확인하지 못했다. 현재 앱에서 3건이 실제로 사라진 모습은 SQL과 배포 소스만으로 간접 확인한 것이므로 사용자 화면 확인과 구분한다.

- [15:58] 운영 반영 전 QA 기준선(Codex): 사용자 T-162 커밋·배포·후검증 명시 승인(exec-004)에 따라 운영 DB REPEATABLE READ / READ ONLY로 신호 3행·연결 주문 3행·체결 0행·관련 로그 6행의 전체 행셋 해시·건수·id/상태만 서버 `/tmp/t162-qa-baseline-1254439.json`(0600)에 보관했다. 로그는 해당 주문 id와 payload의 signalId/signal_id 대상도 포함. 원문·계좌정보·자격은 저장하지 않았다. 기준 릴리스 `20261108-154918-c6154574`, 기준 시각 2026-11-08 15:58:24 KST. 배포 완료 통지 후 별도 트랜잭션에서 전후 대조 예정.


- [15:51] 독립 QA(Codex): Reviewer 최종 PASS 후 승인 데모 v1 게이트 PASS·해시 verified. Reviewer 범위 10파일의 공유본·우분투 격리본 SHA-256 일치. 앱·테스트 9파일은 시험 전후 일치했고, 시험 중 격리본 docs/screens.md 1개만 공유본으로 동기화해 이후 전수 일치 확인; 공유 원본 무변경. `/tmp/stockinvest-t162.84a9`에는 .env 없고 운영 API·cron·주문 호출 없음.
- [15:51] 지정 명령 독립 재실행: `node node_modules/jest/bin/jest.js --runInBand --runTestsByPath` 대상으로 `t162-entry-watch-render`, `t108-trade-render`, `t108-watch-cancel-sheet`, `t108-trade-cancel-refresh`, `entry-watch-outcomes`, `signal-counts`, `ops-read-only-fence` 시험 → **7 suites/143 tests PASS**. `node node_modules/typescript/bin/tsc --noEmit --incremental false` → exit 0. SQLite :memory:가 실제 SQL을 실행해 완료25건 선제외·진행/미상 11건 보존·집계 일치 확인. 오류전파 경고는 실패 주입 시험에서 발생. 격리 build PASS는 Developer 결과이며 QA가 build를 반복한 것은 아님.
- [15:51] 최종 소스 2파일에서 SELECT 추출·SHA 대조 후 운영 MariaDB `START TRANSACTION READ ONLY`: 2026-11-08 15:49 KST 목록 0행·집계 0행(시장이 모두 0이면 집계 함수가 0 반환), 대상3건 제외. 원본 3행의 시그널 id/status/consumed_order_id와 연결 주문 status는 동일 읽기 전용 스냅샷 내 전후 SHA-256 `5881cfea2fd4…` 동일. 열거한 필드 확인이며 전체 원장·동시 외부 변경 검증은 아님. EXPLAIN: signals idx_signals_status, orders PRIMARY eq_ref. 목록/집계 각 1ms(해당 표본 한정). 운영 쓰기·DDL 없음.
- [15:51] 독립 XSS 합성 SSR: 격리 시험 사본에서 `img`/`onerror` 문자열은 HTML 이스케이프되고 태그 원문이 없음(추가 1건 PASS). 임시 테스트 사본 제거. 브라우저 DOM 주입은 미검증. 주문·킬스위치·DRY_RUN·한도·심볼·감사로그 변경 및 회로 실동작 시험 없음; 읽기 전용 fence 시험 PASS. 키 노출/SQL 인젝션 전체 보안 감사는 미수행(변경 SQL은 SELECT와 바인딩).
- [15:51] **판정: 범위 한정 PASS** — 지정 회귀·타입·실제 MariaDB 읽기 전용 SQL 확인 통과, 치명 결함 발견 없음. Reviewer LOW: 별도 병렬 SELECT 중 상태변화 시 집계/목록의 순간 불일치 가능, 특히 count0/list1은 경고 없음. 기존 LIMIT20 유지. 실API→실제 화면·React effect/poll/fetch·실기기·증권사 원장 검증 NOT_VERIFIED. 테스트는 운영 반영이나 실주문 안전장치 회로 통과가 아님.

### QA 시각 검증

- [15:51] 승인 데모 v1·Designer v1 가이드 및 Reviewer 확인본과 같은 후보. 도구 Codex IAB(세부 버전 API 미노출). Leader가 실 `TradeNowPanel`·`decisionOutcome` 및 global/ops CSS를 합성 SSR fixture로 렌더하고 CSS viewport 360/412/1280에서 각각 document.scrollWidth=innerWidth를 측정한 결과 인계(DPR1). QA는 제공받은 412px 진행 주문·완료 제외 스크린샷 2개를 열어 접수/부분체결/테스트 문구 및 완료0의 확인된0을 관찰했다. 360/1280과 기타 상태는 Leader 관찰이며 QA가 직접 재실행하지 않음.
- [15:51] 조건: HTML lang=ko, 시간 fixture 2026-11-08 15:00 KST 고정; OS locale/timezone 직접 확인 불가. 웹폰트 별도 다운로드 없음(global 기본 폰트), 글꼴 로딩 별도 측정 안 함. 애니메이션 비활성 별도 조작 안 함(검증 행 정적). 합성 SSR 정적 네트워크 fixture, 운영 API 미접속; 상단 안전띠·하단 앱 셸 미포함. 변경 상태 캡처이며 실제 앱 전체가 아님. 승인본 문구·상태·행 구성을 비교했고 합성 fixture 껍데기 차이는 환경 차이.
- [15:51] 기존 UI의 44px 터치 대상 실측·키보드 포커스·실브라우저 XSS DOM·버전·인증 후 화면·실기기·실시간 poll은 NOT_VERIFIED. 새 CTA/포커스/입력은 없는 작업이다. QA 생성 스크린샷 0개(Leader 제공 사용자 검토용 이미지 열람만); `/tmp/qa-artifacts` 생성·삭제 0개.

## 배포 기록

| 시각 | 릴리스 | 커밋 | 포함 작업 | 결과 | 비고 |
|------|--------|------|-----------|------|------|
| 2026-11-08 16:01 KST | 20261108-160042-57600fff | 57600fff | T-162 진입 감시 주문 결과 반영 | ✅ ok | `RELEASE_RESULT status=ok`, `migrated=false`; 정식 `--status` 재확인: health 200, `stockinvest`·`stockinvest-cron` 각 1개 online. 초기 status health 실패는 기동 직후 지연이었고 후속 확인에서 정상. 3건 목록 제외·이력 보존은 QA 운영 기능 검증 대기. |
| 2026-11-08 17:39 KST | 20261108-173820-f01e5b8e | f01e5b8 | T-162 기록 커밋 배포 | ✅ ok | 기록 전용 4파일 커밋, 코드 변경 없음. `RELEASE_RESULT status=ok`, `migrated=false`; 정식 `--status` health 200, web·cron 각 1개 online. 후속 운영 확인: DB 연결 정상·safety green·DRY_RUN=true·KILL_SWITCH=false·재시작 0. |

## 데모 검토 (demo gate)

> 실행 판정 정본은 frontmatter `demo_gate` 이다. 이 표는 check.mjs 가 함께 기록하는 사람용 이력이다(docs/demo-review-gate.md).

| 버전 | 상태 | 저장소 파일 | Artifact | 사용자 결정 | 일시 |
|---|---|---|---|---|---|
| - | 작성중 | - | - | judge: full (DM-kw-full) | 11-08 15:10 |
| v1 | 검토요청 | mockups/T-162-entry-watch-order-outcomes-v1.html | http://127.0.0.1:8762/T-162-entry-watch-order-outcomes-v1.html | 사용자 검토 요청 | 11-08 15:16 |
| v1 | 승인 | mockups/T-162-entry-watch-order-outcomes-v1.html | http://127.0.0.1:8762/T-162-entry-watch-order-outcomes-v1.html | "이 시안으로 승인해" | 11-08 15:37 |

## Designer 기록

- [15:13] 실행 도구 Codex. mockups/T-162-entry-watch-order-outcomes-v1.html 작성. 기존 TradeNowPanel·decision-outcome·ops 스타일/문구·globals 토큰·screens 관련 절을 기준으로 구조/CTA 변경 없이 현재/제안 비교, 종료 3건 제외 기본 빈상태, 접수·부분체결·테스트·번호 있는 pending/불명·번호 없는 9분/10분/11분/시각 불명/5분 초과 미래, 로딩·조회/집계 실패·로그인 필요를 전환하는 합성 데모. 명시적 filled/cancelled만 제외, 원 이력/잠금 보존. 제안에서 진입 구간 도달을 일괄 단정하지 않음.
- [15:13] 디자인 스킬: page-layout-designer, ui-component-builder, project-ui-system(원칙 부분 적용), ui-design-reviewer, ui-accessibility-reviewer / 소스 자체 점검 P0 0·P1 0·P2 0, a11y Critical 0·Major 0·Minor 0. 텍스트 상태/포커스/44px 컨트롤/aria-live/합성 데이터 확인. 실제 브라우저 렌더·360/412/1280 overflow 측정은 아직 미확인으로 Leader에게 요청. 데모 내부 폭 전환은 제공함.
- [15:13] 정식 lint DEMO_LINT_PASSED. v1 검토 게시 준비 완료. 아직 사용자 승인 전이며 구현 가이드/앱 소스 작성 없음. 검토 요청 뒤 v1 불변.

- [15:39] 사용자 승인 v1 확인(실행 도구 Codex). 아래 구현 가이드를 Leader/Developer에 인계. 승인 범위는 화면 구현·독립 검증이며 배포는 포함하지 않음.

### 진입 감시 구현 가이드
승인 데모: mockups/T-162-entry-watch-order-outcomes-v1.html (v1) · 적용 토큰: --bg, --bg2, --bg3, --bg4, --border, --border2, --text, --muted, --accent, --warn, --nav-h. 기존 .num 유지.

#### 레이아웃 설계
목표: 현재 처리해야 할 진입 감시와 실제 주문 기록 상태를 혼동 없이 확인. 기존 안전 상태 띠 → 운용 현황 세그먼트 → 승인 대기/관측 기록/진입 감시/전략 상태 위계를 유지. 기존 Section·Rows·CheckRow·StatusChip·EmptyNote·RetryButton 재사용. 데모 #entry-watch의 요약/목록만 변경하며 #mode/#state/[data-width]/#fixtures/비교 근거/설명용 이력 표는 앱에 구현하지 않음. 360~412px 단열·900px 이상 기존 데스크톱 복원 유지. 승인·감시취소·시나리오 생성 CTA 위치/동작은 현행 그대로.

#### 1. 화면 개요
진입 /recommend?tab=now. orders.status가 명시적 filled/cancelled인 executing은 목록·홈/거래 count에서 제외. 이력·원 시그널 상태·consumed_order_id·executing 잠금 보존. 부분체결 후 취소일 수 있으므로 취소를 전량 미체결로 표현하지 않음. 안전장치 상태는 부모의 기존 띠 그대로 유지.

#### 2. UI 구조 및 행 판정
의사코드: Section(#entry-watch) → 기존 건수 요약 → pendingEntry 기존 영역 → Rows(executing.map(기존 decisionOutcome 어댑터)) → 기존 오류/빈상태 분기.
DTO의 consumedOrderId/orderStatus/since를 기존 decisionOutcome({ status:'executing', consumed_order_id, order_status, updated_at:since }, nowMs)에 대응. 누락 값은 null로 전달하고 새 상태 추론 규칙을 만들지 않음. 번호 있음만으로 접수 확정 금지. 10분 **이하**는 처리 중, 10분 초과/갱신시각 불명/5분 초과 미래는 확인 필요라는 기존 STUCK_MS/FUTURE_SKEW_MS 판정 그대로.

| kind | title의 상태 문구 | sub | severity / glyph |
|---|---|---|---|
| accepted | decisionOutcome.text: 주문 접수됨 #번호 | 주문 처리 중 (취소 불가) | w / … |
| partial | decisionOutcome.text: 부분체결 #번호 | 주문 처리 중 (취소 불가) | w / … |
| test | decisionOutcome.text: 테스트 #번호 · 실주문 아님 | 실주문 아님 | w / … |
| pending(번호 없음) | decisionOutcome.text: 주문 처리 중… | 주문 처리 중 (취소 불가) | w / … |
| check | decisionOutcome.text: 주문 여부 확인 필요 + 함수가 정한 번호/경과 | 기존 HINT_TEXT 그대로 | w / ! |
| filled / cancelled | 현재 목록 제외 | 행 없음 | 해당 없음 |

title = 기존 displaySymbol(x.symbol) + ' ' + marketText(x.market) + ' · ' + 위 상태 문구. CheckRow의 기존 title/sub 색·타이포 유지. 승인 데모는 상태별 텍스트와 glyph를 구분하고 아이콘은 공통 accent이므로 decisionOutcome.color를 새 행 전체 색으로 적용하지 않음. 확인 필요 glyph는 장식으로 aria-hidden 유지, 핵심 의미는 title/sub 텍스트에 포함. '진입 구간 도달' 일괄 안내 금지. 신규 주문/취소 CTA 없음.

#### 3. API 호출 계획
| 엔드포인트 | 메서드 | 파라미터 | 사용 필드 | 에러 처리 |
|---|---|---|---|---|
| /api/ops/trade | GET | 기존 부모 poll 그대로 | counts, executing.data의 symbol/market/consumedOrderId/orderStatus/since 및 state/error | 목록/집계 error를 각각 유지, 재조회 연결 |
| /api/ops/home | GET | 현행 유지 | 진입 감시 집계 | 같은 종료 제외 기준; 실패를 0으로 치환 금지 |
| /api/signals | GET | 기존 approved_pending_entry 목록 그대로 | 기존 pendingEntry | 기존 오류/재조회 유지 |
새 API·DB 쓰기·주문 호출 없음. backend의 공통 종료 제외 기준을 재사용. 주문 조회 실패는 정상 빈 배열로 바꾸지 않음.

#### 4. 상태 관리
기존 부모 poll 및 로컬 목록 상태 유지. pending 목록과 executing 목록 모두 조회 성공, counts.state='ok', 관련 count 모두 0, 실제 목록 모두 빈 경우에만 '진입 감시 없음 · ✓ 확인된 0'. counts 실패/누락이면 숫자는 '—', 집계 확인 실패(기존 StatusChip/RetryButton), 정상 0 문구 금지. 목록/집계 불일치도 기존 경고/재조회 유지. 로딩은 '확인 중…'. unauthorized는 기존 오류 사전의 로그인 필요 표현 유지. 실패 중 남아 있는 기존 행은 숨기지 말고 오류/갱신 실패 표시를 동반; 오류에 빈상태 덮어쓰기 금지.

#### 5. 최소 생성/수정 파일
앱 UI: src/app/recommend/TradeNowPanel.tsx. backend: 배정된 src/lib/ops/metrics/trade.ts·signal-counts.ts·types.ts(읽기 모델). 기존 src/components/dashboard/decision-outcome.ts와 HINT_TEXT는 import 재사용, 의미 수정 없음. 기존 TradeNowPanel 관련 시험 또는 작은 전용 렌더 시험에 상태 회귀 추가. docs/screens.md §3 거래 운용 현황의 '주문 선점 중' 설명을 실제 주문 결과 표시·종료 제외로만 갱신(네비/화면목록 변경 없음). 공용 컴포넌트/CSS 신규 생성 불필요.

#### 6. 구현 순서·검증
게이트 check PASS → backend DTO/종료 제외 기준 확인 → decisionOutcome 어댑터 → 행 text/sub/glyph → counts 오류/빈상태 분기 → 상태별 렌더 회귀 → 독립 Reviewer/QA → 승인 v1 대비 점검. 의미 있는 회귀: filled/cancelled 제외와 count 일치, accepted/partially_filled/dry_run, 번호 있는 pending/null/unknown 및 rejected/failed/blocked는 확인 필요, 번호 없음 9분/정확히10분/10분초과/시각불명/미래5분초과, counts만 실패·executing만 실패·두 목록 빈 성공, API실패 재조회. CTA/안전 띠 유지와 360/412/1280 실제 overflow·잘림 확인.

#### 7. 주의사항
안전장치·주문 동작·원 이력·잠금을 변경하지 않음. 데모 문서 제어판과 합성 이력 표를 앱 기능으로 확대하지 않음. 승인 v1 파일은 불변. 데이터 길이/브라우저 차이는 구현상 차이로 기록 가능하나 상태 의미·새 CTA·새 흐름 변경은 Leader 중재와 데모 절차 필요. 실제 브라우저/접근성 검증을 수행하지 않았다면 수행한 것으로 보고하지 않음.

- [15:45] **가이드 정정(승인본 우선)**: 위 가이드의 '기존 건수 요약/기존 요약 유지'는 원래 헤더 문구 유지가 아니라 승인 v1 #count의 정확한 형식으로 구현하는 뜻으로 정정. 진입 감시 요약은 `감시 중 ${watchingN ?? '—'} · 주문 선점 ${executingN ?? '—'} · 다음 세션 ${counts?.nextSession ?? '—'}`. counts 성공 때만 실제 숫자 사용, 실패/미수집은 세 값 모두 —. 예시 `감시 중 0 · 주문 선점 3 · 다음 세션 0`, 종료 3건 제외 뒤 `감시 중 0 · 주문 선점 0 · 다음 세션 0`. '선점' 축약과 '다음 세션' 누락은 승인본 요구 누락(defect)이며 새 설계가 아님. 기존 불일치 경고 본문의 단축 표현은 이번 승인 헤더와 별개인 현행 오류 안내지만 정상 요약과 혼동되면 같은 용어로 맞출 수 있음.
- [15:45] 구현 대조(Codex, 소스 기준): src/app/recommend/TradeNowPanel.tsx와 승인 v1, docs/screens.md 거래 절 대조. 기존 decisionOutcome/HINT_TEXT 재사용·정상 …/check !·severity w·일반/test/check sub·종료 제외 read model 연결·집계 실패의 —/오류/정상0 금지·기존 CTA 유지·제안에서 진입구간 일괄 단정 제거가 가이드와 맞음. docs/screens.md도 실제 결과 표시/완료 제외/이력·잠금 보존 범위로 갱신됨. 현재 헤더 '감시 중 N · 선점 N'의 승인본 누락 1건은 root가 수정 배정 중. 그 외 소스에서 추가 material 불일치 발견 없음. 오류 시 조회 성공한 감시 목록 0건과 실패한 주문 선점 여부를 구분하는 기존 상세 안내, 기존 상태 칩 색/레이아웃·재조회 버튼은 implementation 차이로 유지 가능(실패 전체를 정상0으로 표현하지 않음). 소스 점검상 추가 P0/P1·a11y Critical/Major 없음. 실제 렌더·폭별 잘림·스크린리더 검증은 아직 수행하지 않았으며 root의 실제 컴포넌트 fixture 증거 확인 대기. 앱 코드/승인 데모 수정 없음.

- [15:48] **최종 구현 디자인 대조 — PASS (범위 제한)**. 실행 도구 Codex. 승인 v1 및 최종 TradeNowPanel 소스와 root 제공 `t162-implemented-active-412.png`·`t162-implemented-closed-412.png`를 view_image로 직접 확인. active는 `감시 중 0 · 주문 선점 3 · 다음 세션 0`, 주문 접수됨/부분체결/테스트·실주문 아님, 정상 … 아이콘과 승인된 sub가 표시됨. closed는 `감시 중 0 · 주문 선점 0 · 다음 세션 0`와 `진입 감시 없음 · ✓ 확인된 0`, 종료 3행 미노출을 확인. 기존 관측/전략/시나리오 CTA 문맥 유지. 헤더 누락 defect 해소. 승인본의 독립 데모 외곽·샘플 주변 섹션 배열과 실컴포넌트의 기존 레이아웃 차이는 이번 작업에서 유지하기로 한 기존 구조/공용 CSS 차이이며 추가 material 변경 아님. 확인 범위에서 material 불일치 0건, 디자인 P0 0·P1 0·P2 0.
- [15:48] **접근성 대조 — Critical 0·Major 0·Minor 0 (신규 결과 표시 범위)**. 두 이미지에서 상태가 색 외 명시적 텍스트로 구별되고 긴 합성 상태가 잘리지 않는 것을 확인. 최종 소스에서 기존 CheckRow 기반 title/sub에 상태 의미가 있고 정상 …/확인 ! 장식 구분 및 HINT_TEXT 재사용 확인. glyph aria-hidden은 root의 실제 fixture/기존 컴포넌트 검증 근거로 전달받음(이 단계에서 CheckRow 소스 추가 열람은 하지 않음). 스크린리더 낭독·키보드 포커스 이동·전체 화면 명암 계측/전체 앱 접근성 감사는 미수행이며 포괄적인 a11y 인증을 뜻하지 않음.
- [15:48] 검증 출처/한계: root 보고 CSS 360/412/1280 모두 document.scrollWidth=innerWidth, DPR1, Codex IAB(브라우저 버전 API 미노출), 합성 실제 컴포넌트 SSR+실 globals/ops CSS. root가 active/closed/unknown/boundary/countsError/error/unauthorized/loading 8상태와 텍스트 판정 확인. Designer가 직접 시각 확인한 것은 위 412px 2장 및 최종 지정 소스이며 나머지 6상태/360·1280 측정은 root 증거를 인용한 것. useEffect/fetch/운영 API·실기기 미검증. SSRfixture에 페이지 상단 안전 띠/하단 메뉴가 포함되지 않아 해당 주변 셸의 최종 렌더는 이 이미지로 검증하지 않았음. 앱/데모 수정 없음; 배포 범위 없음.

## Claude 검토

### [2026-11-08 15:50 KST] C2 — incomplete
- 실행 도구: Codex의 Claude 외부검토 창구. 호출 근거는 현재 사용자의 승인 v1 구현·독립 검증 범위 및 실제 독립 Reviewer PASS 이후 정식 C2 경계 점검(risk R2, reviewer_passed=true, user_requested=false). 내부 Reviewer를 Claude 결과로 대체하지 않았다.
- 대상: StockInvest / base_ref 및 검사 시점 HEAD `ebbcdca714499243ccd3411f9df55d66e1297b58` / 선택 3파일 `src/lib/ops/metrics/trade.ts`, `src/lib/ops/metrics/signal-counts.ts`, `src/app/recommend/TradeNowPanel.tsx`. 실제 본문·diff 접근은 이 3파일 및 실행지침/배정 task에 한정했고 계좌·자격·운영자료를 선택 코드에서 발견하지 못했다. 범위 밖 source 본문 읽기·해시 계산·모델 입력·외부 전송 없음.
- 실행: `node ../.claude/tools/claude-review/runner.mjs /tmp/T-162-claude-C2-request.json` 1회. 정식 결과 `claude-result@1`, `status=incomplete`, `reason=selected_file_uncommitted`, `attempt=null`. 선택 작업 트리가 대상 커밋과 달라 경계에서 중단됐으며 provider 검토/소스 전송은 0건이다. Claude 실행 모델·run ID·response.json·비용은 생성/확인되지 않았다.
- 소스 식별 SHA-256 앞12: trade.ts `1bd23e3e25b5`, signal-counts.ts `544082d7dff9`, TradeNowPanel.tsx `d23b8a9363d4`. 이는 로컬 선택 파일 식별이며 Claude 검토 완료 근거가 아니다.
- 지적 수: 산정 불가(별도 Claude가 선택 소스를 검토하지 못함). 미검토 범위는 위 3파일의 현재 미커밋 변경 전체다. 검토를 위한 임의 commit·직접 Claude CLI 호출·스위치 변경·재시도는 하지 않았다.
- 후속: 실패 비차단 정책에 따라 Leader에 미실행 사유와 미검토 범위를 보고. 재시도/커밋/배포를 이번 실행이 승인하지 않으며, 내부 Reviewer·QA 결과는 별도 유지한다.

## 최종 요약

**[T-162] 진입 감시의 완료 주문 제외와 실제 주문 결과 표시**

- **상태**: 승인 v1의 지정 화면 구현·독립 검증 완료. 운영 반영 완료를 뜻하지 않는다.
- **무엇이 바뀌었나**: 연결 주문이 filled/cancelled인 과거 3건과 앞으로의 종료 주문을 진입 감시 목록 및 홈/거래 건수에서 제외한다. 접수·부분체결·테스트·확인 필요를 주문 기록에 맞게 표시하고, 조회 실패를 확인된 0으로 표시하지 않는다. 원본 시그널·주문·잠금은 보존한다.
- **배포**: 미배포·미커밋. 이번 사용자 승인 범위는 화면 구현과 독립 검증까지다. 함께 배포된 작업 없음. 운영 앱은 아직 변경 전이다.
- **AI가 검증한 것**: 독립 Reviewer PASS(Critical/High/Medium 0), 독립 QA 범위 한정 PASS. 격리 Linux 지정 7묶음 143 tests 및 타입 검사 통과. Developer의 정식 build PASS. 실제 최종 SELECT를 운영 MariaDB READ ONLY 트랜잭션에서 실행해 현재 목록/집계 0건 및 기존 3행의 확인 대상 필드 보존 확인, 각 1ms·인덱스 사용. 360/412/1280 CSS 폭의 합성 실제 컴포넌트 SSR 확인 및 Designer의 412px 이미지 대조 PASS.
  - **검증 못 한 것**: 운영 인증 화면·실기기·실제 effect/poll/fetch·증권사 원장 대조·실주문 안전회로 실동작. 외부 Claude C2는 미커밋 선택 파일 제한(selected_file_uncommitted)으로 미실행이며 실제 provider 실행·소스 전송 0건. 내부 감사/QA와 구분한다.
- **사용자가 확인할 것**: 이번 범위에서 없음. 운영 앱 확인은 추후 배포 이후 가능하다.
- **사용자가 결정할 것**: 이번 범위에서 없음.
- **남은 일**: 운영 반영은 별도 요청 범위. 배포 절차에서 필요하면 Claude 최종 인계·커밋된 선택 파일의 외부검토를 별도로 수행한다.
- **이슈·위험**: 기존 LOW 1건 — 목록과 집계가 별도 SELECT여서 주문 상태 전이 순간 숫자와 행이 잠시 다를 수 있다. 이번 범위에서 원본 잠금을 풀거나 기존 구조를 확대하지 않았다. 초기 격리 build 실패는 공용 모듈 연결/캐시 환경을 보완해 최종 성공했다.

## 운영 배포 추가 완료 요약

**[T-162] 진입 감시 주문 결과 표시 — 운영 반영 및 원본 보존 확인**

- **상태**: 사용자 추가 요청(커밋·운영 배포·3건 제외/이력 보존 확인) 완료.
- **무엇이 바뀌었나**: 완료 주문 3건은 운영 진입 감시 조회에서 제외되고 원본 시그널·주문·체결·관련 거래 로그는 보존된다. 앞으로도 동일한 주문 결과 판정으로 현재 목록/집계를 만든다.
- **배포**: 커밋 `57600fff104d3a6fa53af1d104038c5d14cfc9b5` · 릴리스 `20261108-160042-57600fff` · 2026-11-08 16:01:55 KST · push→정식 release.sh blue/green · RELEASE_RESULT ok / END exit0 / migrated:false. parent는 직전 운영 c615457. 추가된 커밋은 T-162 하나이고 대상 12파일(검증된10+승인데모+T162task)만 포함, 다른 작업 동승 없음.
- **AI가 검증한 것**: 최종 배포 12파일 전체 SHA가 허용 manifest와 일치하고 운영 recommend page 빌드 청크에 변경 문구 존재. 후속 health200·DB정상·safetyStatus green·DRY_RUN=true/killSwitch=false(배포 전과 같음), 웹·cron 각1 online·재시작0. 독립 QA는 15:58:24 배포 전과 16:02:35 배포 후의 별도 READ ONLY 트랜잭션에서 signals3/orders3/executions0/관련 trade_logs6 전체 행셋 SHA/건수 일치를 확인. 새 current 소스 SQL의 목록·집계 0행, 목표3건만 LIMIT 없이 재판정해도0행. 운영 DB 쓰기·주문·cron 수동 실행 없음.
  - **검증 못 한 것**: 인증된 운영 HTTP 응답·실제 Android/웹 화면·증권사 원장은 직접 대조하지 않았다. 목록에서 사라지는 동작은 운영 소스/빌드/실제 SQL 결과에 의한 간접 확인이다. 기존 외부 Claude 미커밋 경계 미실행 한계는 이전 기록 그대로 유지한다.
- **사용자가 확인할 것**: 선택적으로 앱을 다시 열거나 새로고침 후 거래 → 운용 현황 → 진입 감시에서 기존3건이 없는지 확인할 수 있다. 웹 변경이라 APK 재설치 불필요. 이것을 추가 완료 조건으로 올리지 않는다.
- **사용자가 결정할 것**: 없음.
- **남은 일**: 이번 요청 범위에서 없음. 실제 기기 화면 직접 확인은 미실행 사실로 남긴다.
- **이슈·위험**: 기동 직후 status/curl의 일시 응답 지연은 정식 120초 헬스 창 안에 회복됐고 최종 health_failed/롤백은 없었다. 기존 LOW(병렬 집계/목록 조회 순간 차이) 유지. 공유 NFS checkout은 타 세션 변경 보존을 위해 reset/checkout하지 않았으며 커밋은 서버 별도 checkout에서 수행했다. 배포 후 추가된 감사 기록은 공유 Vault에 보존한다.

## 사용자 앱 확인 및 최종 종결 — 2026-11-08 17:25 KST

- **상태**: T-162 최종 종료. `status: done`, `waiting: []`.
- **사용자 확인**: “앱에서 기존 3건이 진입 감시에서 사라진 것 확인했어. T-162 작업 마무리해줘.” 사용자가 실제 앱의 기존3건 미노출을 직접 확인했다. 앞선 운영 소스·SQL 간접 확인에 사용자 앱 확인 증거가 추가됐다.
- **배포**: 기존 커밋 `57600fff104d3a6fa53af1d104038c5d14cfc9b5` · 릴리스 `20261108-160042-57600fff` · 2026-11-08 16:01:55 KST · RELEASE_RESULT ok. 이번 마무리는 기록만 갱신하며 추가 코드 변경·배포 없음. 함께 배포된 다른 작업 없음.
- **검증**: 기존 독립 Reviewer/QA, 143 tests·타입·build 및 운영 READ ONLY 검증 기록 유지. 배포 전후 시그널3/주문3/체결0/관련로그6 전체 행셋 해시·건수 보존 확인에 이번 사용자 앱 확인을 합쳐 요청 목표를 충족했다.
- **확인 범위**: 사용자 확인은 기존3건의 진입 감시 미노출에 한정한다. 새 주문의 모든 결과 상태·실시간 갱신·증권사 원장·안전회로의 실동작까지 확인된 것으로 확대하지 않는다. 이전 시점의 미관측 기록은 당시 이력으로 보존한다.
- **사용자 확인·결정 대기 / 남은 일**: 없음.
- **잔여 이슈·위험**: 기존 LOW(상태 전환 순간 별도 목록·집계 조회의 차이) 및 외부 Claude 미실행 기록은 보존하며 새로운 필수 작업으로 올리지 않는다.

## 기록 커밋 원격 반영·자동 배포 완료 — 2026-11-08 17:41 KST

- **상태**: 기록 커밋 `f01e5b8e94cdcda6efbdc33f291f982fd9b1a723`만 원격 main에 push 완료. T-162 기능 최종 종료/대기없음 유지.
- **범위**: 직전 원격·운영 `e9dccee51e1ee302a0ccf37a40897aa7c7fccebd`의 직계후속 1커밋이며 T-162 기록4파일(작업문서·보드·현재 현황·11-08 로그)만 포함. 다른 작업의 추가 변경·제품 코드 변경 없음. 공유 작업 트리의 다른 변경은 보존했다.
- **배포**: 자동 webhook→정식 release.sh, 릴리스 `20261108-173820-f01e5b8e`, 완료 2026-11-08 17:39:40 KST. RELEASE_RESULT ok / END exit0 / migrated:false. 같은 배포에 추가된 다른 작업 없음. 수동 중복 배포 없음.
- **확인**: 배포된 기록4파일 전체 SHA가 f01e5b8 Git blob과 모두 일치. 후속 health200·DB정상·safetyStatus green, DRY_RUN=true·killSwitch=false(배포 전과 같음), 웹·cron 각1 online·restart0. 문서 전용이므로 제품 테스트·주문·운영 DB 쓰기·앱 재설치는 수행/요구하지 않았다. 기존 사용자 앱 확인 및 원본 이력 보존 검증 기록 유지.
- **사용자 확인·결정 / 남은 일**: 이번 요청 범위에서 없음.
