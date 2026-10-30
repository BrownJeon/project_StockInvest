---
task_id: T-108
title: 자동매매 중심 메뉴·홈·분석·비서 개편 — 접수·지표 계약·데모 준비 (구현은 데모 승인 뒤)
status: proposed
priority: high
project: StockInvest
created: 2026-10-28
updated: 2026-10-30
base_ref: 93530f5
risk_level: R2
roles_involved: [leader, judge, analyst, designer, developer, reviewer, qa, codex, deployer]
related_tasks: [T-095-postmortem-script-p1, T-096-strategy-validation-p2-p3, T-081-s01-ledger-cost-monthly-metric, T-100-holdings-loss-control, T-101-settings-post-market-overseas-switch, T-102-usd-cash-unsettled-buy, T-074-cash-ledger, T-107-analysis-flow-visualization, T-111-corporate-intelligence-first-design, T-114-corporate-intelligence-second-design]
tags:
  - type/task
  - domain/ui
  - domain/analytics
  - domain/chat
aliases:
  - 메뉴홈개편
  - 거래비서개편
waiting: [수집 통합 2차 설계(T-114, T-111 후속) 완료 후 통합 계획 수립 — 사용자 지시 10-28 17:09, 사용자: 통합 계획 승인]
demo_gate:
  required: true
  level: "delta"
  status: "approved"
  version: 3
  repo_path: "mockups/T-108-menu-home-v3.html"
  artifact_url: "https://claude.ai/artifact/SiyXU1cB6nD2JZhnHnfDNq"
  content_sha256: "f3230e69cd05df1c7c7fdcfab74aad20a048a33dc5f740d63a6775f144d8a0a5"
  decided_by: "judge"
  rule_id: "DM-kw-risky-cta"
  approved_by: "user"
  approved_at: "2026-10-30T21:05:11+09:00"
  approval_quote: "T-108 데모 v3 승인하며 job_run_log_enabled를 켜고 관찰하는 작업도 진행해줘"
  waived_by: ""
  waived_at: ""
  waiver_quote: ""
  active: false
---

# T-108 자동매매 중심 메뉴·홈·분석·비서 개편

## 출처·사용자 지시

- 정본 인계서: [[2026-10-28-automation-menu-home-claude-handoff]] (다른 세션이 10-28 에 작성, `status: ready-for-claude`, 구현 미착수). 메뉴명·아이콘 결정: `docs/design/2026-10-27-navigation-icon-decisions.md`.
- 사용자 지시(원문, 10-28 낮): "일단 입출금에 대한 확인사항은 완료처리하고 다음 작업 준비해줘" — 이 task 는 그 "준비"(인계서 §11 의 0단계: 최신 상태 대조·작업 접수·Judge 접수·데모 준비)까지다. **화면 코드·DB·안전 설정·주문·알림·push·배포는 이 접수로 시작하지 않는다.**
- 확정된 것(다시 묻지 않는다): 메뉴명 **홈 / 거래 / 분석 / 비서 / 설정**, 아이콘 **stone · handshake · scan-search · brain · settings**(Lucide), 홈의 보유/관심/내일 탭·종목 차트 제거 의향, 투자현황을 자동매매 기준 운용현황으로.
- 미확정(데모에서 검토): 하단 순서, 홈 섹션·지표, 분석 3분류, 거래 하위 구조, 비서 조회 범위.

## 0단계 — 인계서 이후 바뀐 사실 (10-28 13:50 대조, 인계서 문장을 현재 상태로 재사용하지 않는다)

| 인계서의 서술 | 현재 상태 (실측) |
|---|---|
| T-101 수정·T-102 미추적 | 둘 다 **운영 반영 완료**(`5ac9119`, 릴리스 `20261028-051140-5ac91195`). 작업 트리 변경 아님 |
| `public/mockups` 삭제 표시 | 지금 `git status` 에 없음 — 인계서 시점의 일시 상태로 보임. 이 task 가 건드리지 않음 |
| 해외 장마감 후 분석 스위치 꺼짐 전제 | **켜짐**(사용자 지시, 10-28 13:33 DB 키 `post_market_overseas_enabled`=true). 첫 실행 10-29 08:00 KST — 홈의 "관찰 기간" 지표가 해외 카드도 포함하게 됨 |
| 대시보드 총자산 "-" / KRW 입출금 확인 | 입출금 확인은 **사용자 완료 처리**(T-102). 총자산 **시작점은 사용자가 해외 분석 뒤 다시 잡는다** → 홈 '운용현황' 은 "기준(시작점) 재설정"이 데이터 계약의 입력이다(기존 '자산 기록'의 기준 정하기, T-074 재사용 후보) |
| 뉴스·검색 기반 | 뉴스 수집 국내/해외 분리(T-103), M4 날짜 정규화·해외 4피드(M4 task-007·008), 연속 0건 알림(T-106) 반영 — 홈/분석의 "데이터 상태" 표시 후보 |
| ADP-006(분석가 정책) | 폐기(D-09). 이 개편과 무관 |
| 킬스위치 | ON 유지(11-23 경 판단), D5 관문으로 신규 매수 차단 — 홈은 "관찰 기간" 상태를 정직하게 보여야 한다 |
| 최신 task 번호 | T-107 까지 존재, 이 task 가 **T-108** |

## Judge 접수 (judge-result@2, 입력·출력: 스크래치패드 `judge-T-108-intake.{json,out.json}`)

- risk **R2**(규칙 `R2-kw-payment` — 자금 화면 키워드), developer_model **opus**, demo **required / delta / designer**(규칙 `DM-kw-risky-cta`, publish `artifact+repo`), next **demo_first**, blocking_gate **demo**.
- Leader 판단: 판정은 `delta` 지만 메뉴·홈·분석·비서를 모두 바꾸는 **정보구조 전면 개편**이다(인계서 §11.1 도 full 대상, 10-27 자문 intake 는 full). **데모 범위는 full 수준으로 만든다**(5탭 이동 + 홈 관찰/실거래 2종 + 정상·빈·로딩·조회 실패·오래된 데이터·검증 차단 상태). 게이트 상태 기록은 `check.mjs` 가 판정 JSON 대로 쓴다 — 손으로 승인 상태를 쓰지 않는다.

## 진행 순서 (인계서 §11 — 이번 "준비" 범위는 0단계)

| 단계 | 담당·작업 | 상태 |
|---|---|---|
| 0 | Leader: 최신 대조·task 생성·Judge 접수 | ✅ 이 문서 |
| 1 | Analyst + Leader: 운용 지표 계약(기존 데이터로 가능/새 연결 필요 구분, 세션·귀속·시작점·실패 vs 0) | 대기 — 사용자 착수 신호 |
| 2 | Designer: 412px 모바일 중심 버전별 HTML 데모(`mockups/T-108-…-v1.html`) | 대기 |
| 3 | Leader: 데모 게시·사용자 검토·승인 기록(`check.mjs approve`, 아이콘 선택은 전체 승인 아님) | 대기 |
| 4~7 | 가이드 → Judge C1 → Developer → Reviewer → Judge C2/Codex → QA → (승인 범위일 때만) 배포 | 데모 승인 전 시작 안 함 |

## 사용자에게 받을 것 (착수 전)

1. **착수 순서**: 이 개편(T-108)과 크론 정리 T-104(권고 범위 B) 중 무엇부터. 서로 파일이 겹치지 않아(T-104 는 크론 러너·`/api/cron/*`, T-108 은 화면) 병행도 가능하나 Designer(Opus)·Analyst(Fable) 토큰이 크다 — Leader 권고: **T-104 의 범위만 정해 주시면 작은 T-104 를 먼저 끝내고 T-108 을 시작**(T-104 는 데모 불필요·구현이 짧다).
2. **데모 범위**: 첫 데모를 "관찰 기간 홈 + 실거래 홈 + 5탭 이동 동작"으로 시작해도 되는지(인계서 권고).
3. 지표 계약은 인계서 §6.2 기본안으로 Analyst 가 구체화한다 — 별도 질문 없이 진행하고, 사용자는 데모에서 확인한다.

## 보호할 것 (인계서 §10.2 + 이번 세션)

- 다른 세션 변경: `agent-vault/00-Context/ACTIVE.md`·`10-Flow/board.md`·`20-Log/2026-10-28.md`, `T-107-*`·`docs/reports/2026-10-28-analysis-processing-flow.md`, `docs/design/2026-10-27-navigation-icon-decisions.md`, 인계서 자체 — 커밋은 항상 명시 경로, `git add -A`·일괄 stash/reset/clean 금지.
- 자동 청산 스위치·킬스위치·D5 관문·주문 경로는 이 개편으로 바꾸지 않는다. `/` 경로·`/analytics?tab=…` 딥링크·텔레그램/앱 링크 호환을 먼저 정한다(새 URL 은 불필요하면 만들지 않는다).

## 판단 기록 (judge)

- [10-28 13:5x] intake — 위 "Judge 접수" 참조.

## 진행 기록

- [10-28 13:5x] 접수. 인계서 대조(0단계) 완료. 사용자 착수 신호 대기.
- [10-28 17:09] **사용자 결정 기록(발화 요지)**: ① 11-23 킬스위치 판단에 볼 증거 = 후보의 사후 성과 · 분석/데이터 정상 가동률 · 후보·제외 사유 추이(보유 위험·자금 정합은 선택 안 함) ② **기록 먼저 분리** — 새 기록 기반을 UI 개편보다 먼저(별도 task, DDL 은 그때 승인) ③ 홈 숫자 정의 불일치(승인 대기 집합 `/recommend` 와 통일, 깔때기 국내 고정 → 시장 토글)는 **개편에 포함**, 전후 비교를 데모에 ④ 비서 **대화 소유권 설계까지 포함**(별도 task, 비서 탭 노출은 소유권 적용 배포 이후) ⑤ **2차 설계(수집 통합, T-111) 후 두 작업을 통합해 함께 진행 — 그때까지 착수 보류** ⑥ 일봉 정기 수집은 수집 통합 세션이 맡음(이쪽 항목은 완료 처리, 보류 해제·KIS 호출 승인은 아님) ⑦ 읽기 전용 SELECT 는 두 세션 몫을 합쳐 1회 승인하는 방식(U6, 쿼리는 목록 제시 전 미실행).
- [10-28 17:09] 공동 인계: [[2026-10-28-joint-collection-integration-and-menu-home-handoff]] (충돌 지점 J1~J9·소유권·기준선 변경 대장·조율 로그). 작업절차서 v2 원문은 로컬 계획 파일 `~/.claude/plans/agent-vault-10-flow-handoffs-2026-10-28-ticklish-scroll.md`(통합 계획의 입력, 승인 아님). 새 task 번호는 T-112 이상 — 생성 직전 `ls` 로 재확인.
- [10-28 17:25] **세션 마무리(사용자 지시)**: 수집 통합 세션이 공동 인계서를 읽고 2차 설계를 시작해 T-114 로 문서 커밋(`30ffb90`·`5d4fdd1`). 합의: 공유 기록 테이블 `job_run_log`(최소 필드 + `run_kind`·`target`·`detail_json`), 판단 구분 필드명 `judgment_role ∈ {baseline, shadow}`, **T-112·T-113 은 비어 있음**(T-108 몫), 기준 판단(baseline) 기록은 T-112 범위 후보, U6 은 수집 통합 몫이 이미 실행돼 **T-108 몫 SELECT 만 남음(목록 미제시·미실행)**, 일봉 정기 수집(R13)은 수집 통합 세션 몫. **재개 조건**: T-114 2차 설계 완료 → 통합 계획 수립·사용자 승인 → T-112/T-113 접수(번호 `ls` 재확인) → 지표 계약·데모. 재개 시 공동 인계서 §11 의 수집 통합 `요청 → T-108 세션`(기록 명세와 설계서 §7 단계 3 필드 대조)에 `답 →` 로 응답한다.
- [10-30 11:46] **사용자 "문서 단계 시작"**(질문: 문서 단계 — 지표 계약·기록 DDL 초안을 지금 시작할까요) — 통합 계획 §5 "지금 해도 되는 것" 범위로 재개. ① 1단계 지표 계약 초안: Analyst → `docs/design/2026-10-30-t108-metrics-contract-draft.md`(U6 규칙 때문에 운영 DB 조회 없이 문서만, 읽기 전용 SELECT 후보 목록은 **실행하지 않고 목록만** 만들어 사용자 승인 뒤 실행) ② [[T-112-run-judgment-record-foundation]] 접수(번호 `ls` 재확인·공동 인계서 §11 선점 줄) — DDL 초안: Developer → `docs/design/2026-10-30-t112-record-ddl-draft.md`. **하지 않음**: 화면 코드·DDL 적용·push·배포·데모 착수(Designer 데모 v1 은 이 단계 밖). T-108 `waiting` 은 DP1(~11-05) 순서 결정까지 유지.
- [12:22] **사용자 확정(원문 "권고안 일괄 확정")**: 지표 계약 D1~D9 권고안, U6 SELECT 18건 실행 승인. U6 실행 결과는 계약 §10 에 반영 — 핵심: **킬스위치 `false`·DRY_RUN `true`·청산 엔진 `true`(10-30 09:08 사용자 의도 변경 — 답 "의도한 변경")** 로 "관찰 기간 = 킬스위치 ON" 전제가 바뀜 → 홈 단계는 스위치 조합으로 파생. 11-23 증거 풀 얇음(장마감 카드 55장·관찰 이후 8장, executions 0). 화면·데모·DDL 적용·push 는 하지 않음.
- [13:44] **사용자 설명(원문)**: "실거래만 막아놓고 킬스위치는 해제해서 시그널생성과 청산관련 로직은 켜놓은채로 남은 감사기간 지켜보기위해서 옵션을 변경했어" — 11-23 = 남은 감사 기간 종료 시점, 감사 대상 = DRY_RUN 으로 켜 둔 시그널 생성·청산 로직("11-23 킬스위치 해제 판단" 표현은 "감사 기간 종료 판단"으로 읽음). 지표 계약 §5 제목 정정, §10.3 에 관측(룰 엔진 buy 시그널 22건 전부 skipped, 청산 엔진 `exit_hard_stop_disabled` 40건)과 **D1 재확인 필요**(장중 시그널·청산 로직을 홈에 둘지; 권고 (c) 청산 로직 관찰 지표 신설) 추가. 사용자 결정 대기.
- [14:30] **사용자 결정(원문 "(c) 청산 로직 지표 신설"; 질문: 홈에서 시그널·청산 로직 관찰을 어떻게 다룰까요?)**: D1 = (a) 홈 분석은 장마감 AI 분석만 **유지** + **「청산 로직」 관찰 지표 신설**(= 선택지 (c)). Analyst 가 지표 계약 §11 에 정의를 추가한다(읽기 전용, DB 조회 없음, 청산 판단 영구 보존·홈 표기 수준은 결정 표로, U7 SELECT 후보는 목록만). 화면·데모·DDL 변경 없음.

## Analyst
- [12:03] 지표 계약 초안 작성(Analyst, 읽기 전용) → [docs/design/2026-10-30-t108-metrics-contract-draft.md](../../../docs/design/2026-10-30-t108-metrics-contract-draft.md) (182줄; 관찰 4종·실거래 7종 8항목 계약, 현재 카드 4종 재정의, 11-23 증거 3종 소급 범위, T-112 소비 필드 §6, 사용자 결정 D1~D9, U6 SELECT 후보 18건 **미실행**). 운영 DB 조회 0·코드/운영 변경 0. Leader 표본 확인: 승인 대기 불일치(`Dashboard.tsx:199` 대 `post-market-engine.ts:322` 의 `'pending'`)·환율 폴백(`fx.ts` `FX_USDKRW_FALLBACK` 1380, 경고 로그만) 소스에서 일치. 사용자 결정 D1~D9 와 U6 승인 대기.
- [14:45] **청산 로직 관찰 지표 계약 §11 작성 완료**(Analyst, 232~343행, 읽기 전용) → [지표 계약](../../../docs/design/2026-10-30-t108-metrics-contract-draft.md): 청산 엔진 코드 요약·트리거 4종·지표 X1~X6 8항목 계약·상태 어휘·기록 공백·`exit_judgment`(가칭) 후보 필드안(제안만)·결정 D10~D14·U7 읽기 전용 SELECT 9건(**미실행**, 승인 대기). 불편한 사실: ① **오늘 15:20~15:29 KST 국내 보유 1종목 `eod_loss_cut` 발화 예상** — 하드손절 OFF 는 `hard_stop` 만 끊고 `eod_loss_cut` 은 우선순위 1번·모드 무관 강제 자동 제출이라, DRY_RUN 분기에서 `orders.status='dry_run'`·`signals.status='auto_submitted'`·텔레그램 "자동 제출" 알림으로 끝남(실 송신 0). Leader 가 `submitOrder`(DRY_RUN 분기가 실 송신 앞, `createOrder` 직접 호출처 없음)와 `routeSignal`(`FORCED_AUTO_EXIT_KINDS`)을 직접 확인 ② 하드손절 구간 종목은 다른 청산 종류가 평가되지 않음, skip 행에 손익률 없음 ③ 영구 증거 없음(`eval_funnel` 30일·pm2 로그 회전 없음 8.2MB/3.7MB). 해외 청산 평가는 미국 정규장에만 돈다(13:39 까지 해외 0건은 「미평가」).
- [16:16] **사용자 확정(원문 "권고안 확정"; 질문: D11~D14 권고안 확정 + U7 SELECT 9건 실행)**: D11 (c) 별도 task → [[T-126-exit-judgment-persistence]](후보 등록) · D12 (b) · D13 (b) · D14 (a). U7 9건 실행(읽기 전용) → 계약 §11.8. 핵심: ① **`notify_signal_auto_submit=false` — 15:26 DRY_RUN 청산 건의 텔레그램 알림은 오지 않았을 가능성이 높음(앞선 안내 정정)** ② 마스터 OFF 기간 "발화했을 조건" 행은 30일 뒤 소멸(합계를 §11.8 에 보존) ③ 05-11~22 해외 청산 시그널 자동 제출 2,680건·주문 거부 1,399건 이력(DRY_RUN→false 전 감사 후보) ④ 트레일링만 임계 override(3.5/1.2), 나머지 코드 기본값. 화면·데모·DDL 미시작.
- [16:43] **사용자 결정(원문 "지금 시작"; 질문: Designer 데모 v1 을 권고 범위로 지금 시작할까요, 아니면 DP1(~11-05)까지 기다릴까요)**: 2단계 Designer 데모 v1 착수 — 범위 = 관찰 기간 홈 + 실거래 홈(+혼합) + 5탭 이동(인계서 권고), 수준 full. 산출물 `mockups/T-108-menu-home-v1.html`(Designer, 합성 데이터·토큰 스냅샷·외부 URL 없음, `check.mjs lint` 통과 필요). **Leader 후속**: lint 통과 확인 → Artifact 게시 → `check.mjs status --to review_requested --version 1 --repo-path mockups/T-108-menu-home-v1.html` → 사용자 검토·승인(승인 전 화면 코드 없음). T-112 구현과 병행(파일 겹침 없음).

## Designer
- [17:25] **데모 v1 작성 완료(Designer)** → `mockups/T-108-menu-home-v1.html`(111,102 bytes, sha256 `ead8ce0e64f1…`, lint `DEMO_LINT_PASSED`·경고 0). 홈 단계 4종(관찰/중지/혼합/실거래) × 데이터 상태 6종(정상·첫 배포·빈·로딩·조회 실패·오래됨) × 5탭 + 승인 시트(처리 중·성공·실패·네트워크 오류·차단·거절)·감시 취소 확인 대화상자, 현재 vs 제안 비교(D8 숫자표 포함), 상태 어휘 카탈로그, 「결정 필요」 A/B 7건(권고 전부 A). 자체 점검 P0 0·P1 0·P2 3, a11y Critical 0·Major 0·Minor 3. 360·412·1280px 자동 순회(가로 넘침 0, 터치 44px 미만 0, 11px 미만 글자 0, 명암비 4.5:1 미만 0), 실기기 미확인. **Leader 전체 읽기 후 게시**(외부 URL·네트워크 호출 0, 인라인 스크립트만).
- [17:25] **검토 요청**: Artifact(비공개) https://claude.ai/artifact/D7XK8XAEFPrqzkqGABmCNW → `check.mjs status --to review_requested --version 1` 기록(frontmatter·이력 표 갱신). 현재 `check` = BLOCK(사용자 승인 없음) — 정상. 승인 전 화면 코드 없음. 사용자 승인 원문은 그대로 `check.mjs approve --quote` 에 기록한다.
- [17:25] Designer 가 정한 8곳(계약이 말하지 않았거나 다르게 해석)은 데모 E 절에 있다 — 청산 상세 위치(X1·X3·X4·X6 분석 > 검증·성과, X2·X5 거래 > 보유·주문) · 장중 깔때기 홈 제외 · 「중지」 띠 라벨 · 혼합 단계 손익 기준 미설정 · 하드손절 조건 충족 「확인 필요」 중복 · 최근 활동 원천 · 하단 라벨 11px · 비서 5칸 보류 표시. Designer 불편한 사실: ① 현재 홈에 DRY_RUN·킬스위치 표시 0(`SafetyBar` 미사용) ② 「오늘 체결」이 DRY_RUN 을 체결로 셈 ③ 「분석 완료 종목」은 T-112 전엔 채울 수 없음(첫 배포 상태 별도 표시).
- [17:36] **사용자 변경 요청(원문 "메뉴 아이콘에 대해서 지난번에 함께 정한게 있잖아. 그걸로 해줘")** → v1 `changes_requested` 기록. 원인: v1 하단 아이콘이 지난번에 정한 Lucide(`docs/design/2026-10-27-navigation-icon-decisions.md`: 홈 `stone`·거래 `handshake`·분석 `scan-search`·비서 `brain`·설정 `settings`)와 달랐다 — 홈은 Designer 가 손으로 그린 근사 도형, 비서(brain)·설정(settings)은 구버전 도형(거래·분석만 일치). 이름은 같았지만 모양이 원본이 아니었다 [확실: v1 경로와 lucide-react 1.24.0 원본 대조].
- [17:36] **v2 작성**(Leader, 기계적 교체): `mockups/T-108-menu-home-v2.html` = v1 에서 ① 아이콘 5개를 워크스페이스 `lucide-react` 1.24.0(ISC)의 원본 SVG 경로 그대로 교체(stone 3·handshake 5·scan-search 6·brain 8·settings 2 도형) ② 메타·제목·머리말 v1→v2 + 「v2 변경점」 배너 ③ E 절 아이콘 메모 갱신. **diff 로 그 밖의 줄이 같음을 확인**(변경 줄: 메타·제목·h1·배너·E 메모·home/ai/set 아이콘 3줄), lint `DEMO_LINT_PASSED`, 브라우저로 5탭 아이콘 렌더 확인(도형 수 3·5·6·8·2, 22px). Designer 재호출 없이 Leader 가 했다 — 화면·상태·결정 필요 7건은 v1 과 동일. 새 파일이라 v1 은 수정하지 않음.
- [17:36] **v2 검토 요청**: Artifact(비공개) https://claude.ai/artifact/6ev1RzsZivkd8nHbJvEUjr (sha256 `6fabba424ad8…`), `check.mjs status --to review_requested --version 2`. `check` = BLOCK(승인 전) 정상. 승인 시 사용자 원문 그대로 `check.mjs approve --version 2 --quote`. 이전 링크(v1) https://claude.ai/artifact/D7XK8XAEFPrqzkqGABmCNW 는 이력용.
- [18:19] **사용자 변경 요청(원문 "용어를 좀 수정해야할 것같아. 변경하는 용어는 모든 화면에서 동일하게 변경해줘" + 7항목)** → v2 `changes_requested` 기록. 항목: ① 분석 후보 종목의 「카드」→「시그널」(다른 화면 포함) ② 사후 결과 추적 「표본 부족 n=8」 의미 설명 요청 ③ 청산의 「EOD」 쉬운 말로 ④ 「AI BUY」 의미 질문 ⑤ 「DRY_RUN」→「실거래여부」(ON = 실거래 가능, OFF = 실거래 차단) ⑥ 「킬스위치」→「모든거래차단」 ⑦ 「하드손절」 의미 질문.
- [18:20] **v3 작성**(Leader, `mockups/T-108-menu-home-v3.html` = v2 + 용어 치환, 118,414 bytes, sha256 `f3230e69cd05…`): 치환 스크립트가 치환마다 건수를 단언해 통과했고, 화면 문구·칩·설정 화면·시트·설명 문구·스크립트 문자열까지 한 번에 바꿨다. 새로 넣은 것: 머리말 「v3 변경점」 배너, F 절 「용어 설명」 표(표시 이름 / 뜻 / 이전 표기·내부 이름), 「구현 때 주의」 메모. 조사 오류(「시그널는」 등) 0건 확인. lint `DEMO_LINT_PASSED`, 브라우저로 4개 탭 렌더·콘솔 오류 0 확인(옛 용어는 배너·용어 설명표·구현 주의에만 남음).
- [18:20] **Leader 판단 2건 — 사용자가 「바꿔 달라」가 아니라 「뜻이 뭐냐」고 물은 항목을 v3 에서 같이 바꿨다**: 「AI BUY」→「AI 매수 판단」, 「하드손절」→「손실한도 손절」. 의미를 묻는 말은 이름이 어렵다는 신호로 읽어 권고안으로 적용했고, 되돌릴 수 있다(v3 배너·용어 설명표에 명시). 사용자 확정 대기.
- [18:20] **불편한 사실(구현 때 사고 위험)**: 「실거래여부」는 내부 값 `safety_dry_run` 과 **방향이 반대**다(ON = 실거래 가능 ⇔ `safety_dry_run=false`). 화면에서 토글·값을 뒤집어 읽어 오는 코드를 안 쓰면 실거래가 켜진 줄 알고 꺼 둔 상태(또는 그 반대)가 된다 → 구현 시 변환 한 곳에 모으고 Reviewer·QA 가 양방향 검사(ON/OFF × 값). 이 이름 변경은 현재 설정 화면·알림 문구·로그에도 남은 「DRY_RUN」·「킬스위치」 표기와 함께 별도 작업 범위(데모 승인 뒤 구현 가이드에 포함).
- [18:20] **v3 검토 요청**: Artifact(비공개) https://claude.ai/artifact/SiyXU1cB6nD2JZhnHnfDNq (sha256 `f3230e69cd05…`), `check.mjs status --to review_requested --version 3`. `check` = BLOCK(승인 전) 정상. 승인 시 사용자 원문 그대로 `check.mjs approve --version 3 --quote`. 이전 링크(v2) https://claude.ai/artifact/6ev1RzsZivkd8nHbJvEUjr 는 이력용.
- [21:05] **사용자 승인(원문 "T-108 데모 v3 승인하며 job_run_log_enabled를 켜고 관찰하는 작업도 진행해줘")** → `check.mjs approve --version 3` 기록, `check` = approved(hash verified, sha256 `f3230e69cd05…`). v3 의 용어 정정 7항목 전부(「AI 매수 판단」「손실한도 손절」 두 이름 포함 — 사용자가 이름까지 되돌리지 않았으므로 유지)가 승인 범위. **「결정 필요」 A/B 7건은 이 승인에서 별도로 답받지 않았다** — 구현 가이드·착수 전에 권고(전부 A)로 갈지 한 번 확인한다. 화면 구현은 아직 시작하지 않았다(`activate` 안 함): 다음은 Designer 구현 가이드(승인 버전 v3 명시) → Judge → Developer → Reviewer → QA, 착수 순서는 DP1(~11-05) 에서 T-104·T-126 과 함께 정한다.

## Developer

## Reviewer

## QA

## 배포 기록

## Codex 검토

## 최종 요약

## 데모 검토 (demo gate)

> 실행 판정 정본은 frontmatter `demo_gate` 이다. 이 표는 check.mjs 가 함께 기록하는 사람용 이력이다(docs/demo-review-gate.md).

| 버전 | 상태 | 저장소 파일 | Artifact | 사용자 결정 | 일시 |
|---|---|---|---|---|---|
| - | 작성중 | - | - | judge: delta (DM-kw-risky-cta) | 10-28 13:40 |
| v1 | 검토요청 | mockups/T-108-menu-home-v1.html | https://claude.ai/artifact/D7XK8XAEFPrqzkqGABmCNW | 사용자 검토 요청 | 10-30 17:24 |
| v1 | 수정요청 | mockups/T-108-menu-home-v1.html | https://claude.ai/artifact/D7XK8XAEFPrqzkqGABmCNW | "메뉴 아이콘에 대해서 지난번에 함께 정한게 있잖아. 그걸로 해줘" | 10-30 17:35 |
| v2 | 검토요청 | mockups/T-108-menu-home-v2.html | https://claude.ai/artifact/6ev1RzsZivkd8nHbJvEUjr | 사용자 검토 요청 | 10-30 17:36 |
| v2 | 수정요청 | mockups/T-108-menu-home-v2.html | https://claude.ai/artifact/6ev1RzsZivkd8nHbJvEUjr | "용어를 좀 수정해야할 것같아. 변경하는 용어는 모든 화면에서 동일하게 변경해줘" | 10-30 18:19 |
| v3 | 검토요청 | mockups/T-108-menu-home-v3.html | https://claude.ai/artifact/SiyXU1cB6nD2JZhnHnfDNq | 사용자 검토 요청 | 10-30 18:20 |
| v3 | 승인 | mockups/T-108-menu-home-v3.html | https://claude.ai/artifact/SiyXU1cB6nD2JZhnHnfDNq | "T-108 데모 v3 승인하며 job_run_log_enabled를 켜고 관찰하는 작업도 진행해줘" | 10-30 21:05 |
