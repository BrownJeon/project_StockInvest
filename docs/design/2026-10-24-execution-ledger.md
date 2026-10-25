---
project: StockInvest
task: T-079
created: 2026-10-25
updated: 2026-10-25
version: v1
status: active
sources: [integrated-execution-procedure, s00-baseline-report]
tags: [type/ledger, domain/restructure, domain/safety]
---

# StockInvest 단일 실행 원장 (v1)

> **이 문서가 개편 작업의 진행 상태를 기록하는 유일한 원장이다.** 순서·정책·관문의 정본은 [통합 작업절차서](2026-10-24-integrated-execution-procedure.md), 근거는 [S00 기준선 보고서](2026-10-24-s00-baseline-report.md). T-064·T-077 의 옛 Phase/A 표를 별도 일정표로 운영하지 않는다.
> **갱신 규칙:** 단계 상태는 실제 완료 기준을 채웠을 때만 `완료`로 바꾼다. 상태를 바꿀 때 근거 링크(task 기록·커밋·검토 판정)를 같이 적고 §9 변경 이력에 한 줄 남긴다. 과거 Reviewer/QA 판정은 새 안전 코드의 근거로 차용하지 않는다.
> **기준:** 2026-10-25 00:5x KST · HEAD `e0aadad` = `origin/main` · 배포 `20261024-221601-e0aadadf` · 스냅샷 `#5457`. 모든 작업 트리 변경은 미커밋이며 타 세션 변경은 보존한다.
> **상태 표기:** `완료` · `부분`(일부 재사용 가능) · `착수 대기`(선행 충족, 사용자 결정/권한 대기) · `선행 미충족` · `미착수` · `보류`.

## 1. 지금 위치 한 줄

**S00 완료(문서 범위, 2026-10-25 — 독립 검토 2회·QA 반영). 현재 킬스위치 ON 이며 사용자 결정 D-1~D-5 가 다음 단계의 입구다**([보고서 §9](2026-10-24-s00-baseline-report.md)). 다음 한 작업(권고): D-1 결정 후 [T-080](../../agent-vault/10-Flow/tasks/T-080-killswitch-usd-misread.md).

## 2. 단계별 원장 (S00~S09)

열: `실제 task ID / 담당·파일 소유 / 상태 / 근거 링크·버전 / 미해결 / 다음 작업`. 경로 표기 — 공통 / **H**(기존 보유 관리) / **N**(신규 매수 검증).

| 단계 | 실제 task ID | 담당·파일 소유 | 상태 | 근거 링크·버전 | 미해결 | 다음 작업 |
|---|---|---|---|---|---|---|
| **S00** 현황·정책 기준 고정 (공통) | [T-079](../../agent-vault/10-Flow/tasks/T-079-s00-baseline-and-ledger.md), [T-083](../../agent-vault/10-Flow/tasks/T-083-s00-follow-up-hygiene.md) | Leader(메인 세션) · Reviewer/QA(읽기 전용). 소유: `docs/design/2026-10-24-{s00-baseline-report,execution-ledger}.md`, T-079~T-083 task 문서, `.gitignore` 1줄, 로컬 보고서(git 제외) | **완료(문서 범위)** | [보고서](2026-10-24-s00-baseline-report.md) · 원장 v1 · Judge `judge-result-T-079-intake.json` | 미확정 10건(보고서 §6), 사용자 결정 D-1~D-5, 문서 불일치 정정(M-01~M-12) | T-083(상태 동기화·위생)은 D-4 결정 후 |
| **S01** 측정·장부·자원 기반 (공통) | [T-081](../../agent-vault/10-Flow/tasks/T-081-s01-ledger-cost-monthly-metric.md) (재사용: [T-056](../../agent-vault/10-Flow/tasks/T-056-usd-cash-snapshot.md)·[T-069](../../agent-vault/10-Flow/tasks/T-069-holdings-baseline-report.md) v0a·[T-071](../../agent-vault/10-Flow/tasks/T-071-ledger-fill-recovery.md) WP-1/1b·[T-074](../../agent-vault/10-Flow/tasks/T-074-cash-flow-ledger.md)) | Developer(Opus)·Reviewer·QA. 소유: `src/lib/safety/{order-sync,order-limits}.ts`(훅 대상), `src/lib/reports/trade-report.ts`·`src/lib/ledger/`(**훅 밖**), `scripts/migrations/`(훅 대상) | 부분 재사용 / **WP-A 코드 완료·배포 대기→확인 후 갱신** | T-071 WP-1 `54eb5a3`·`a3aa6d1`, T-074 `330314e`, T-056 `05a82a8`(기록 기준, 운영 재실측 아님) | 체결 장부 0행(앱 밖 거래가 구조적 — 원천은 KIS 체결·기간손익)·수수료 0 하드코딩·원가 미상=전액 이익(F02), 국내 체결 조회 TR 불일치(A06), 일일 한도 경합(F10), 월 지표 정의(C05), 기준 정하기 미실행, USD 행 정의 | D-2 사용자 입력(달러 칸 값은 D-3 조회로 확정됨 — 입력값을 정리해 제시) → T-081 착수 승인 |
| **S02** 일봉·사건·후보군 (공통/N) | [T-082](../../agent-vault/10-Flow/tasks/T-082-s02-daily-bars-universe-remaining.md) (재사용: [T-070](../../agent-vault/10-Flow/tasks/T-070-daily-bars-phase0.md) Phase 0·[T-059](../../agent-vault/10-Flow/tasks/T-059-us-data-collector-p1.md)) | Developer·Analyst(Fable, 후보군 원천 판단)·Reviewer. 소유: `src/lib/profit-engine/`·`scripts/profit-engine/`(**훅 밖**), `src/app/api/cron/daily-bars/route.ts`(훅 대상) | 부분 | T-070 `34608e5`·DDL 10-24 05:15·`daily_bars` 70,965행, T-059 `a1e5c36`+`7cd47e7` | 증분 확인(10-27 화 05:35 이후), 이월 3건, 정기 cron 미등록, 지수 구성 원천·효력일 이력 0, PIT | 10-27 이후 증분 확인(KIS 읽기 권한) · C02 원천 확인(공식 원천 먼저) |
| **S03** 순수 결정 함수·실험 계약 (N·H 일부) | — | Analyst(가설·점수 계약)·Developer. 소유 예정: 순수 함수 위치 미정(`strategy/` 이면 훅 대상) | 미착수 / 선행 미충족 | 설계 문서만([T-064](../../agent-vault/10-Flow/tasks/T-064-profit-engine-design.md)) | 선행: S01 비용 필드·S02 자료 계약, **C03·C04·C06·C09 사용자 검토**. 전략 코드 0줄 | C03/C06 정책안 검토 → H 보유 정책 함수를 먼저(N 합격과 분리) |
| **S04** 후향·표본 외 판정 (N) | — | Analyst·Developer·Reviewer | 미착수 / 선행 미충족 | — | 선행: S02·S03. 기존 `backtest.ts` 는 F04 결함, 사전 등록·OOS 코드 0 | S02 품질 보고 후 최소 가설 등록(C09) |
| **S05** 공동 자원·주문 경계 (공통/H/N) | [T-080](../../agent-vault/10-Flow/tasks/T-080-killswitch-usd-misread.md) (재사용: [T-058](../../agent-vault/10-Flow/tasks/T-058-signal-cash-gate.md)·[T-068](../../agent-vault/10-Flow/tasks/T-068-risk-policy-followups.md)·[T-071](../../agent-vault/10-Flow/tasks/T-071-ledger-fill-recovery.md) WP-1b·[T-072](../../agent-vault/10-Flow/tasks/T-072-validation-gate.md)·[T-076](../../agent-vault/10-Flow/tasks/T-076-emergency-cancel-partial-fills.md) 설계) | Developer(Opus)·Reviewer(필수, 훅 대상)·QA. 소유: `src/lib/safety/`·`src/lib/signals/`·`src/lib/strategy/`·`src/app/api/{orders,safety,signals}/`(전부 훅 대상) | 부분 | T-072 `fa0669c`(매수 관문), T-058 `8894416`(건별 현금 게이트), T-068 `b3572ed`·`add32cf`, **T-080 Phase 1 `294f7e0` 배포 완료**(릴리스 `20261025-140926-30ae50bd` ok; Reviewer 3회·Codex·QA 통과) | **공동 예산·슬롯·매도 수량 예약 0(N01·N02)**, 누적 분할 게이트(D17), C6 캡처·카나리, T-076 해석 확인, 전략 ID 불일치, F03/F05/F12 | **T-080 은 선행 없음 → 먼저 가능.** 예약 설계(N01/N02)는 S01·S03 계약 후 |
| **S06** 보유·월 손실·기간·승인 (H) | — (재사용: [T-055](../../agent-vault/10-Flow/tasks/T-055-sell-proposal-mode.md) 1단계·[T-066](../../agent-vault/10-Flow/tasks/T-066-risk-policy-settings.md)·T-068) | Analyst·Developer·Reviewer·QA. 소유 예정: 월 손실·축소 로직은 **훅 밖 `src/lib/risk/` 에 두지 말 것**(R40 결정 선행) | 미착수 / 선행 미충족 | T-055 `24a5440`(읽기 전용 시뮬레이션), T-065 문서 없음 | 재평가 사건·점수 축소·3개월 기산·연장 승인·재알림 전부 0(N03~N06). H 에 켤 코드 없음 | S01·S03·S05 후. R40(훅 범위) 결정이 로직 위치보다 먼저 |
| **S07** 최소 화면·리포트 (공통) | — ([T-073](../../agent-vault/10-Flow/tasks/T-073-dashboard-direction.md) 보류) | Designer(데모→사용자 승인)·Developer. 소유: `src/components/dashboard/*` | 보류 | board.md: 사용자 "추후 지시" | 데모 `drafting`, "월간/연간 손실 한도" 등 문구 정정(M-14 성격) | S03 표시 계약 후, 데모 승인 전 화면 코드 금지 |
| **S08** 전진 모의·결합 검증 (N/H) | — | Analyst·QA | 부분(관측만) | `paper_fills` 55건(`rsi-oversold-v1` 한 전략, 10-23 이후) | 합격 기준·종료일 사전 등록 0, 표본 서로 다른 주 20 도달 2027-03 초 추정 | 사전 등록(C09) 후. 기간 경과만으로 승급 금지 |
| **S09** 단계적 운영·승급/중단·롤백 | — | 사용자 권한(C10)·Deployer(승인 후)·Reviewer→Judge C2→QA | 선행 미충족 | 현재 권한 상태: DRY_RUN=false·**킬스위치 ON**·autopilot=assist·exit OFF | G-H/G-N 증거 전부 미충족(§3) | D-1 이후 H 먼저 단계별 권한 요청 |

## 3. 관문 상태 (G-H / G-N)

H 는 N 합격을 기다리지 않는다. 그러나 H 에 켤 코드가 아직 없다는 사실(보고서 §0-4)을 감추지 않는다.

| 관문 | 필수 증거 | 현재 | 근거 |
|---|---|---|---|
| **G-H** 승인된 보유 정책 | 종목/업종 상한·축소 속도·기산·연장·재알림 | ❌ 제안만(C03·C06·C07) | 보고서 §7 |
| G-H 최신 수량/원가·분석 | 수량·원가·분석 최신 | △ 수량 ✅(스냅샷) · 원가는 KIS 평균매입가 의존, 앱 체결 장부 0행 | 보고서 §2.3·§2.5 |
| G-H 점수/축소량 검증 | 재생 가능한 점수·축소량 시험 | ❌ 점수식 없음(U07 충돌) | 보고서 §3 |
| G-H 공통 매도 선점·취소/대사 | 매도 수량 선점, 취소·대사 | ❌ N02 없음, T-076 설계만, C6 미실행, #2107 은 브로커에 없는 앱 DB stale 행(정리 경로 없음) | 보고서 §2.2·§3.1 |
| G-H 재생/섀도우 | 같은 정책 버전 재생 | ❌ | S08 |
| G-H Reviewer/QA·운영 승인 | 독립 검토 + 사용자 운영 승인 | ❌ (킬스위치 ON 이 별도 장벽) | §1 |
| **G-N** 고정된 전체 정책 버전 | 후보군·신호·점수·배분·비용 해시 | ❌ | S03 미착수 |
| G-N S04 합격 근거 | 사전 등록→OOS 합격 | ❌ 코드 0 | S04 |
| G-N S08 전진/체결·비용 정합 | 전진 표본 | △ 관측 55건(한 전략, 평가 규칙 미등록) | 보고서 §2.2 |
| G-N T-072 귀속/검증 상태 | `paper_validated` 등 승급 | ❌ 16/16 `unvalidated`, 전략 ID 불일치 | 보고서 §3.2 |
| G-N 자금/슬롯 계약 | 공동 예약 | ❌ N01 없음 | 보고서 §3.1 |

## 4. 기존 task 재사용·잔여 대조 (25개)

"배포됨" 은 task 문서의 push·`RELEASE_RESULT` 기록과 `origin/main` 일치로 확인한 것이며 운영 재실측이 아니다.

| task | 실제 상태 | 재사용하는 것 | 남은 것 (ID) | 단계·경로 |
|---|---|---|---|---|
| [T-040](../../agent-vault/10-Flow/tasks/T-040-api-usage-log.md) | 구현만·미커밋 28파일, 기준 커밋 낡음 | `api-usage` 래퍼·시험 | 커밋/폐기 결정, HEAD 기준 재검증(R03) | S00 공통 |
| [T-055](../../agent-vault/10-Flow/tasks/T-055-sell-proposal-mode.md) | 부분 — 1단계 배포(`24a5440`), 2·3단계 코드 0 | `evaluateSellProposal`·정책·요약 | 사용자 확인(R32), 2·3단계를 U07/U12/U13 로 재정의(R33·R34) | S06 H |
| [T-056](../../agent-vault/10-Flow/tasks/T-056-usd-cash-snapshot.md) | 완료·배포(`05a82a8`), 실측 일부 미관측 | USD 예수금 스냅샷·규칙 E | 후속 묶음(R07) | S01 |
| [T-057](../../agent-vault/10-Flow/tasks/T-057-us-stock-analysis-data-collection.md) | 부분 — P1=T-059, P2=T-062, P0 폐기, P3 미착수 | — | P3(R24, ADP-006 hold) | S02·S03 N |
| [T-058](../../agent-vault/10-Flow/tasks/T-058-signal-cash-gate.md) | 완료·배포(`8894416`), 최종 요약 공란 | `evaluateSignalCashGate` | 후속(R31), 해외 가용액 정의(R08) | S05 |
| [T-059](../../agent-vault/10-Flow/tasks/T-059-us-data-collector-p1.md) | 완료·배포(`a1e5c36`+`7cd47e7`) | EDGAR·KIS 스냅샷 수집기 | 후속 묶음·정적 유니버스 코드 정정(R17) | S02 |
| [T-060](../../agent-vault/10-Flow/tasks/T-060-sell-proposal-delivery-observability.md) | 완료·배포(`fae6baf`), 도착 확인 대기 | 요약 전달 관측 | 후속(R30) | S06 H |
| [T-061](../../agent-vault/10-Flow/tasks/T-061-adp006-c01-analyst-policy-trial.md) | 폐기(ADP-006 hold) | — | — | — |
| [T-062](../../agent-vault/10-Flow/tasks/T-062-post-market-overseas-p2.md) | 부분 — 서버·화면 배포, **운영 활성화 안 됨** | `post-market-overseas.ts`·WP-U 화면 | 스위치 전 3조건+선결(R28) | S09 N |
| [T-063](../../agent-vault/10-Flow/tasks/T-063-card-amount-format.md) | T-062 WP-U 에 합침 | — | — | — |
| [T-064](../../agent-vault/10-Flow/tasks/T-064-profit-engine-design.md) | 설계만(구현은 하위 task) | 연구 계약(통합 절차서 §7) | Phase 1~4 (R14·R18·R38), D4·D6·D7·D19②·D20(R41) | S02~S09 N |
| T-065 | **문서 없음**(번호만 예약) | 요구는 T-064 §8·T-077 §8.2 | 보유 관리 루프(R35) | S06 H |
| [T-066](../../agent-vault/10-Flow/tasks/T-066-risk-policy-settings.md) | 완료·배포(`6c7e751`) — 표시·계산 전용 | `risk/{compute,defaults,policy-store}` | Low 후속(R36) | S06·S07 H |
| [T-067](../../agent-vault/10-Flow/tasks/T-067-profitability-audit.md) | 보고서 완료(미추적), 코드 변경 없음 | F01~F13 | F02·F03·F04·F05·F10·F12·F13 미수정 | — |
| [T-068](../../agent-vault/10-Flow/tasks/T-068-risk-policy-followups.md) | 완료·배포(`b3572ed`·`add32cf`) — 누적 분할 미포함 | 손절 알림·분할 4·현금 정보 | 누적 분할 게이트(R25), Low 후속(R36) | S05·S06 H |
| [T-069](../../agent-vault/10-Flow/tasks/T-069-holdings-baseline-report.md) | 부분 — v0a 완료(`4c2b0e6`) | 읽기 전용 보유 리포트 | v0b 목적 재정의(R11), `waiting` 낡음 | S01 H |
| [T-070](../../agent-vault/10-Flow/tasks/T-070-daily-bars-phase0.md) | 부분 — Phase 0 완료·운영 적용(`34608e5`) | `daily_bars`·품질·사후검증 | 증분 확인·이월 3건·cron(R12·R13), 도구 보강(R16) | S02 |
| [T-071](../../agent-vault/10-Flow/tasks/T-071-ledger-fill-recovery.md) | 부분 — WP-1·1b 배포, 운영 미발화(C6 미실행) | CAS·펜싱·해외 시장가·취소 ok 검사 | WP-2(R05)·WP-3(R06)·D17(R25)·C6(R26) | S01·S05 |
| [T-072](../../agent-vault/10-Flow/tasks/T-072-validation-gate.md) | 완료·배포(`fa0669c`) — 승급 전 선결 남음 | `evaluateValidationGate`·`paper_fills` | 전략 ID(R20)·신뢰 경계(R21)·고아 재조정(R22)·정보성(R23) | S05·S09 N |
| [T-073](../../agent-vault/10-Flow/tasks/T-073-dashboard-direction.md) | 미착수·보류 | 요구·제약 문서 | 대시보드(R37) | S07 |
| [T-074](../../agent-vault/10-Flow/tasks/T-074-cash-flow-ledger.md) | 완료·배포(`330314e`) — **기준 정하기 미실행**, 배포 기록 미커밋 | `src/lib/ledger/*`·화면 | 기준 정하기·달러 의미(R09), 낮은 후속 12건(R10) | S01 |
| [T-075](../../agent-vault/10-Flow/tasks/T-075-safety-paths-extension.md) | 완료·배포(`4557278`; 배포는 T-074 문서의 롤백 대상 릴리스 `20261024-051605-45572784` 와 git 으로 확인, T-075 문서 자체엔 배포 기록 없음) — 보드는 "구현 중"으로 낡음 | SAFETY_PATHS 38개 | 훅 밖 금전 경로(R40) | S09 안전 |
| [T-076](../../agent-vault/10-Flow/tasks/T-076-emergency-cancel-partial-fills.md) | 설계만(Stage 0), 구현 0 | `cancel-all` WP-1b | 해석 확인·Q1~Q8(R29) | S05 H |
| [T-077](../../agent-vault/10-Flow/tasks/T-077-portfolio-restructure-handoff.md) · [T-078](../../agent-vault/10-Flow/tasks/T-078-integrated-execution-procedure.md) | 문서 완료(미추적) | 통합 절차서 | — | — |

## 5. 남은 작업 — 배정과 대기 사유

R01~R41(task 기원) + N01~N08(절차서 기원) + A01~A11(S00 실측 신규). 안전 경로 = 커밋 훅 `SAFETY_PATHS` 대상(대입 판정). 권한 약어: DDL · 운영설정 · 주문 · 알림 · 유료 · 배포(push) · KIS(읽기).

### 5.1 후속 task 로 배정한 것 (선행 충족)

| ID | 내용 | 단계·경로 | 안전 경로 | 필요 권한 | 배정 |
|---|---|---|---|---|---|
| A01 | 킬스위치 24h 손실 판정이 USD 행 양쪽 0 을 환전 손실로 오집계 | S05 공통 | YES(`safety/kill-switch.ts`) | 없음(해제는 사용자 전용) | **T-080** |
| R05 | T-071 WP-2: 체결 장부 컬럼·수수료·원가 이월·trade-report 보정 | S01 공통 | 부분 YES | DDL | T-081 |
| R06 | T-071 WP-3: 일일 한도 경합·결과 불명 합산·KST 자정 리셋 | S01→S05 | YES | 수정 승인 | T-081 |
| R07 | T-056 후속 묶음(장중 USD>0 응답·체결기준·Q7/Q8/Q10) | S01 | YES | KIS(주말 응답)·첫 해외 매도 관측 | T-081 (관측 대기) |
| R08 | 해외 가용액 정의(예수금 ≠ 구매력). T-058 생성 시점 게이트가 해외도 USD 예수금으로 비교하므로, USD 행이 야간에 0 으로 읽히는 영향도 함께 확인 | S01 | YES | KIS | T-081 (D-3 선행) |
| R09 | T-074 기준 정하기 + 달러 의미 | S01 | n/a | **사용자 입력** | T-081 (D-2) |
| R10 | T-074 낮은 후속 12건 + 설계 전제 L3·L6·L7 | S01 | NO | 없음 | T-081 후순위 |
| R11 | T-069 v0b — D3→U12 대체로 목적 재정의 | S01 H | NO | 정책 응답 | T-081 (재정의) |
| N03 | 월 수익률 정의(C05) — 재평가 *사건* 구현은 S06 | S01 | NO | 방식 검토 | T-081 (정의만) |
| A02 | #2107 브로커 번호 없는 `pending` — 어느 경로도 정리 못 함 | S01·S05 | YES | DB 쓰기(정리는 별도 승인) | T-081 (설계) |
| A03 | USD 행 시간대 의존의 원인 | S01 | — | KIS + 사용자 답 | T-081 (D-2·D-3) |
| A04 | 앱 밖 거래(05-27 이후 전부) → 원가·실현손익을 **KIS 체결·기간손익 조회**에서 가져오는 원천 설계. 국내 2종목 매도는 KIS 로 확인됨(10-25) | S01 | NO | KIS(읽기, 승인됨) | T-081 |
| A09 | **좀비 `pending` 주문**(INSERT 뒤 UPDATE 전에 프로세스가 죽으면 오늘자 pending 이 KST 자정까지 시장 예산 점유; 자동 정리 경로 없음). 시간 컷오프로 합산에서 빼는 것은 금지(송신 중 상한 없음) → 차단 상세에 pending 합계 표시/오래된 오늘자 pending 경고 | S05 | YES(`safety/order-limits.ts`·`order-sync.ts`) | 없음(설계 후 Reviewer) | T-081 후속 |
| A10 | `approval-context.ts` 표시값 `dailyUsedKRW` 가 `pending` 을 계속 제외 → 승인 알림 "오늘 한도 잔여" 과대 표시(판정은 이미 pending 포함) | S05 | YES(`signals/`) | 없음 | T-081 후속 |
| A11 | `checkDailyMax` 의 `selfOrderId` 에 다른 pending 의 유효 id 가 전달되는 호출부 회귀 방어·시험(현재 호출은 INSERT id 직접 전달) | S05 | YES | 없음 | T-081 후속 |
| A08 | 같은 어댑터의 **다른 국내 TR 이 구형일 가능성**(T-081 WP-A Reviewer 가 KIS 공식 예시로 확인): 미체결 `TTTC8036R`→`TTTC0084R`(1순위 — 침묵 오답 가능), 주문 `TTTC0801U/0802U`→`TTTC0011U/0012U`+`EXCG_ID_DVSN_CD`, 취소 `TTTC0803U`→`TTTC0013U`+`EXCG_ID_DVSN_CD`. 열린 주문이 있을 때만 비교 가능 | S05 H | YES(`exchanges/kis-domestic.ts`) | **주문 권한**(T-071 C6 캐너리와 함께) | 대기(R26) |
| A07 | 킬스위치 **반대 방향 편향**(T-080 독립 감사 M-3, 이번 diff 밖의 기존 결함): 기준선 가려짐·현재 보임이면 원시 손실률이 USD 비중(약 11%p)만큼 부풀어 진짜 −10% 도 +수% 로 읽혀 **침묵**한다. 실데이터에서 주말(토 10:01 이후~일) 9틱 연속 +12~+15%. 미국 폐장 시간대라 영향은 작지만 월요일 이른 시간 등에서 재발 가능 | S05 공통 | YES(`safety/kill-switch.ts`) | 없음(Phase 2 = 평일 저녁 KIS 조회 뒤 모든 틱 대칭 보정 또는 USD 근본 수정) | T-080 Phase 2 |
| A06 | 앱 국내 체결 조회(레거시 TR `TTTC8001R`)가 현행 TR(`TTTC0081R`)이 반환하는 체결을 못 가져옴 [가능성 높음] — `order-sync` 완료/취소 판정 영향 | S01·S05 | YES(`exchanges/kis-domestic.ts`) | KIS(읽기, 재현용) | T-081 |
| R12 | T-070 증분 확인(10-27 05:35 이후) | S02 | n/a | KIS(수동 호출) | T-082 |
| R13 | T-070 Phase 1 이월 3건 + 정기 증분 cron 등록 | S02 | 부분 YES | 운영설정(cron)·배포 | T-082 |
| R14 | 유니버스 ≥150·PIT 스냅샷·지수 원천 | S02 N | 부분 YES | DDL·C02 | T-082 (C02 후) |
| R15 | D19① Yahoo 일봉 읽기 전용 교차검증 | S02 | NO | 없음(승인됨) | T-082 |
| R16 | 사후검증 도구 보강 | S02·S04 N | NO | 없음 | T-082 후순위 |
| R17 | T-059 후속 묶음(정적 코드 정정·IR 일정·휴장일) | S02 N | 부분 YES | 운영 DB 쓰기·KIS | T-082 |
| N08 | 후보군 원천(Nasdaq100·코스닥100)·정적 목록 대체 | S02 N | 부분 | C02 | T-082 |
| R01 | task 상태표·보드·RESUME 동기화(M-01) | S00 | NO | 없음 | T-083 |
| R02 | 미추적 산출물 보존·커밋 시점 | S00 | NO | **배포(push) — 사용자 결정 D-4** | T-083 |
| R03 | T-040 커밋 vs 폐기 | S00 | YES | 커밋/폐기 결정 | T-083 → 사용자 |
| R04 | 저장소 위생(루트 `NUL`·`@eaDir` ref 오류·낡은 stash) | S00 | NO | 삭제는 확인 | T-083 |

### 5.2 선행 미충족·사용자 대기 (task 미생성 — 번호 예약 안 함)

| ID | 내용 | 단계·경로 | 안전 경로 | 막는 것 |
|---|---|---|---|---|
| N01 | 공동 예산·슬롯·intent 영속 예약(모든 INSERT 경로) | S05 공통 | YES(+DDL) | S01 자금 필드·S03 자원 계약 |
| N02 | 공통 매도 수량 선점 | S05 H | YES | N01 설계, T-076 |
| N04 | 승인 대기·재알림 영속화(holding-checker 단발 종료 대체) | S06 H | YES | C06·C07, N02 |
| N05 | 3개월 기산·연장 승인 유형(주문 승인과 별도 CAS) | S06 H | YES | C06 |
| N06 | 집중도 점수 기반 점진 축소 | S06 H | YES | C03·C04, N02 |
| N07 | 분석 기록/점수 계약 + LLM 사실 해석 분리 | S03 | YES | C04 |
| R18 | Phase 2 스크리너·백테스터(F04 결함 포함) | S03·S04 N | 부분 | C09, R15·R16, **착수 승인(토큰 큼)** |
| R19 | rsi-oversold 평가 규칙 사전 등록·가상 체결 유지 | S03 N | NO | C09 사용자 결정 |
| R20 | 전략 ID 불일치(`oversold-bounce-v1` ≠ `-daily-v1`) | S05 N | YES | 전략 승급 계획이 생길 때(지금 불필요) |
| R21 | `POST /api/signals` `body.strategyId` 신뢰 경계 | S05 N | YES | 위와 동일(설계 결정 필요) |
| R22 | `paper_fills` 고아 재조정·소비 규칙 | S05·S08 N | YES | R23 일부 |
| R23 | T-072 정보성 5건 + 첫 장중 관측 | S05 N | 부분 | 평일 관측 |
| R24 | T-057 P3: 런타임 프롬프트에 수집값 연결 | S03 N | YES | ADP-006 hold 해제·사용량 동의 |
| R25 | D17 누적 분할 게이트(미국 자동 매수 종목당 한도 없음) | S05 공통 | YES | C03·C08 사용자 결정 |
| R26 | T-071 C6 읽기 전용 캡처 + 카나리(실주문 1주) | S05 공통(G-H 전) | n/a | **KIS + 주문 권한**, 미국 정규장 |
| R27 | F03/F05/F12 카드·매수 선결 시험 | S05 N | YES | N 활성화 전. F12 는 정수 달러 유지(기존 결정) |
| R28 | T-062 스위치 켜기 전 3조건 + S09 선결 | S09 N | n/a | R27·R20·R17, 운영설정 권한 |
| R29 | T-076 해석 확인(Q1~Q8)·구현 | S05 H | YES | **사용자 해석 답 + KIS + 주문(체결 불가 지정가→취소)** |
| R30 | T-060 후속(notify 타임아웃·도착 확인) | S05 공통 | 부분 | 알림 도착 사용자 확인 |
| R31 | T-058 후속(시험 공백·TTL 자기참조·최종 요약) | S05 N | YES | 없음(소) |
| R32 | T-055 1단계 3거래일 리포트 확인 | S06 H | n/a | **사용자 확인** |
| R33 | T-055 2단계 재정의(U07/U12/U13) | S06 H | YES | R32·R29·N02, 데모 |
| R34 | T-055 3단계(텔레그램 승인 버튼·부분 매도) | S06 H | YES | R33, T-042 스위치 |
| R35 | 보유 관리 루프(T-065, 문서 없음) | S06 H | YES | S01·S03·S05, C03·C05~C08 |
| R36 | T-066/T-068 후속 Low | S06 H | NO | 사용자 확인(소) |
| R37 | T-073 대시보드 | S07 | NO | 사용자 "추후 지시", 데모 승인 |
| R38 | Phase 3 섀도우·주간 리포트 | S08 N | 부분 | C09 |
| R39 | H/N 운영 권한·승급 절차(C10) | S09 | n/a | **사용자 권한 전부** |
| R40 | SAFETY_PATHS 후속 — 훅 밖 금전 경로(`risk/`·`ledger/`·`reports/`·`profit-engine/`·`grant-*.sql`) | S09 안전 | YES(훅 자체) | **사용자 결정(훅 변경)** — S06 로직 위치보다 먼저 |
| R41 | D4·D6·D7·D19②·D20 미결 묶음 | S03 N | n/a | C09 사용자 결정 |

A05(킬스위치 발동 알림이 사용자에게 도착했는지)는 task 가 아니라 **사용자 확인** 항목이다(S05, 텔레그램 실패 로그는 그 시각에 없음).

배정 집계: task 기원 41건 중 **17건 후속 task 배정**(T-081 7 · T-082 6 · T-083 4), **24건 선행 미충족/사용자 대기**. 절차서 기원 8건 중 N03(정의)·N08 배정, 6건 대기. 실측 신규 A01~A11 중 A01~A04·A06·A07 배정(A06 완료), A05 사용자 확인, A08 주문 캐너리 권한 대기, A09~A11 은 T-081 WP-B 후속(낮음~중간, 비차단).

## 6. 파일 소유·충돌 방지·작업 순서

| 후속 task | 소유 파일 | 비대상(건드리지 않음) | 훅 |
|---|---|---|---|
| T-080 | `src/lib/safety/kill-switch.ts`·`portfolio-total.ts` + 시험 | 주문 송신·킬스위치 DB 값(해제는 사용자) | 대상 → Reviewer 판정 필수 |
| T-081 | `order-sync.ts`·`order-limits.ts`·`trade-report.ts`·`ledger/`·`scripts/migrations/` | `kill-switch.ts`(T-080 소유) | 일부 대상(`reports/`·`ledger/` 는 훅 밖이나 Reviewer 요구) |
| T-082 | `profit-engine/`·`scripts/profit-engine/`·`api/cron/daily-bars/route.ts` | 주문 경로 | 부분 대상 |
| T-083 | `agent-vault/` 상태 문서·`docs/design/` 원장 | 소스·설정 | 비대상 |

- **순서(권고):** D-1 → T-080 → D-2/D-3 → T-081(H 우선 최소 범위) → T-082(병행 가능, 파일 비중복) → 이후 S03(H 보유 정책 함수 먼저).
- **충돌 방지:** T-080 과 T-081 은 `kill-switch.ts`/`order-sync.ts` 를 나눠 갖는다. 같은 파일을 동시에 고치지 않는다. 안전 코드 커밋 전에 `## Reviewer` 에 `최종 판정` 줄(scope 포함)이 있어야 한다.
- **보존 대상(타 세션 미커밋):** T-040 계열 `src/` 24파일·설정 4개, `.codex/`·`AGENTS.md`·`CLAUDE.md`, T-042·T-046·T-049·T-064·T-067·T-074·T-077·T-078 문서, 로그·인벤토리·roadmap·감사 보고서·인터뷰·핸드오프, 루트 `NUL`. **`git add -A`·stash·reset·clean 금지.** 작업 트리 tsc/jest 는 깨져 있으므로 시험은 `git archive HEAD` 격리 사본에서 한다.

## 7. 권한 레지스터 (유효한 기존 권한)

보고서 [§8](2026-10-24-s00-baseline-report.md) 과 같다. 요약: **읽기 전용 DB 조회만 유효.** KIS 호출·운영 DB 쓰기·DDL·주문/취소·알림·유료 가입·킬스위치 변경·커밋/push/배포는 모두 없음(과거 건별 승인은 소진). 각 후속 task 는 착수 시점에 구체 범위(스크립트·대상·롤백)를 제시하고 별도로 받는다.

## 8. 결정 목록 버전

| 구분 | 상태 | 위치 |
|---|---|---|
| U01~U16 | **확정**(2026-10-23 인터뷰) — 재질문·역행 금지 | 절차서 §2 |
| C01~C10 | **제안 v1**(2026-10-25) — 사용자 검토 대기, 정책안 본문 | [보고서 §7](2026-10-24-s00-baseline-report.md) · 절차서 §9 상태표 |
| D1~D20 | 이관 상태 유지(D3 은 U03/U12 로 대체, D20 은 "기존 결정 유지 + 체결 모델 반영"으로 문구 축소 제안) | 절차서 §9 |
| 사용자 결정 D-1~D-5 | 대기 | [보고서 §9](2026-10-24-s00-baseline-report.md) |

## 9. 변경 이력

| 시각(KST) | 변경 | 근거 |
|---|---|---|
| 2026-10-25 00:xx | v1 작성 — S00 상태 대조·task 25개 대조·잔여 작업 분리·T-080~T-083 접수(Judge) | [T-079](../../agent-vault/10-Flow/tasks/T-079-s00-baseline-and-ledger.md) |
| 2026-10-25 00:5x | S00 `완료(문서 범위)` 표기 — 독립 Reviewer 2회 지적(M 4·L 12·R 5) 반영, 문서 QA(링크·ID·건수·민감정보) 통과. 킬스위치 −0.7% 오류를 −2.8% 로 정정 | T-079 `## Reviewer`·`## QA` |
| 2026-10-25 10:5x | 사용자 답변 반영: D-1·D-5 권고대로, D-3 KIS 읽기 전용 조회 실행(§2.8 요약 · A06 신규 · #2107 은 브로커 미존재 · USD 행 일치), D-4 모두 커밋·push 진행 | T-079 |
| 2026-10-25 11:0x | D-4 실행: 커밋 3개 push·배포 ok(릴리스 `20261025-105456-34ab66dd`). T-040 운영 반영(현 HEAD 기준 Reviewer 재감사 PASS) — S09 안전·R03 처리. 작업 트리 `@workspace/api-usage` 링크 복구. T-080 Developer 착수(설계 v1, Judge C1 Codex 불요) | T-079·T-040 |
| 2026-10-25 12:0x | T-080 Phase 1 코드 커밋 `294f7e0`(독립 Reviewer 3회: 조건부→통과→통과, Codex high 1 채택·반영, QA 통과(주의 있음)). 남은 한계 R-1·반대 방향 편향 A07 명시. 킬스위치는 ON 유지 | T-080 |
| 2026-10-25 14:1x | T-080 Phase 1 push·배포 ok(사용자 "권고사항대로"). 킬스위치 ON 유지. "$118.60" 항목 종결(사용자 기억 없음 — API 값으로 대체). 평일 저녁 KIS 조회 10-26 17:10 예약 | T-080 |
| 2026-10-25 15:1x | T-081 WP-A(A06) 완료: 국내 체결 조회 TR 현행화+`tr_cont` M/F fail-closed. Leader 라이브 읽기 재검증·Reviewer 2회·Codex high 1 채택·QA 통과. 후속 A08(다른 국내 TR 구형 가능성)·연속조회 병합 기록 | T-081 |
| 2026-10-25 15:5x | T-081 WP-B(F10) 완료: 일일 한도 경합을 일회용 MariaDB 로 재현 확증 후 자기 pending 행만 제외로 수정. Reviewer 통과·Codex(중간1·낮음1 비차단)·QA 통과. 후속 A09~A11 기록, 동시 두 건 상호 거부(과차단) 수용 | T-081 |
