---
task_id: T-081
title: 통합 절차 S01 — 체결 장부·원가·월 지표 기반 (T-071 WP-2/3 잔여 + 기준 정하기 연결)
status: in-progress
priority: high
roles_involved: [leader, developer, reviewer, qa]
related_tasks: [T-079, T-071, T-074, T-069, T-056, T-058, T-067]
base_ref: e0aadadf1604a15b269a6c2a240eefa2b778b400
risk_level: R2
tags:
  - type/task
  - domain/restructure
  - domain/safety
aliases:
  - S01 장부 기반
waiting: [사용자 입력 D-2 (T-074 기준 정하기·달러 질문 — 달러 칸 값은 KIS 조회로 확정, 입력값 제시 예정), T-080 완료(순서 D-5), DDL 승인(WP-2 착수 시)]
created: 2026-10-25
updated: 2026-10-25
---

# T-081 — S01 측정·장부·자원 기반

> **연결:** 통합 절차 S01, 공통(H·N 모두의 입력). 정책: U01·U02·U08 확정, C01·C05 제안 v1. 원장 [execution-ledger §2·§5.1](../../../docs/design/2026-10-24-execution-ledger.md), 근거 [S00 보고서 §2.3·§2.5](../../../docs/design/2026-10-24-s00-baseline-report.md).
> **수익·위험 경로(제1원칙):** 앱에 체결 장부(`executions` 0행)와 입출금 기준(원장 0행)이 없어 실현손익·월 손실·원가를 설명할 수 없다. 그 상태로 만든 월 손실·점수·축소 판단은 가짜 숫자 위에 서 있다. 잘못된 실제 손익으로 새 전략을 학습·합격시키지 않도록 먼저 고친다.

## 재사용 / 새로 만드는 것
- **재사용:** T-071 WP-1·1b(CAS·펜싱·해외 시장가·취소 ok 검사), T-074 원장(`src/lib/ledger/*`, 화면 `/settings/cash-ledger`), T-056 USD 스냅샷 규칙 E, T-069 v0a 보유 리포트, T-058 현금 게이트.
- **새로:** ① 월 수익률 정의(C05, 수정 Dietz 제안)와 외부 입출금 보정 계약 ② T-071 WP-3(일일 한도 경합·결과 불명 합산·KST 자정 리셋 — **시험 먼저**) ③ T-071 WP-2(체결 원장: 통화·가격·수수료 종류·누적 1행 기록, 원가 이월, trade-report 30일 prefetch/원가 미상 폴백 수정) ④ T-074 기준 정하기 실행 연결과 달러 칸 의미 반영 ⑤ #2107 처럼 브로커 번호 없는 `pending` 의 정리 설계(A02) ⑥ **원가·실현손익의 원천을 KIS 체결·기간손익 조회로 전환**(A04 — 05-27 이후 모든 거래가 앱 밖이라 앱 `executions` 는 구조적으로 비어 있음. 2026-10-25 KIS 조회로 국내 2종목 매도 체결·실현손실과 해외 기간손익이 조회 가능함을 확인) ⑥-2 **A06: 앱 국내 체결 조회 TR(`TTTC8001R`) ↔ 현행 TR(`TTTC0081R`) 불일치** — 같은 조건에서 앞은 "조회할 내용이 없습니다", 뒤는 체결 2건 반환. 재현(KIS 읽기) 후 어댑터 보정, 안전 경로 → Reviewer 필수 ⑦ 관측 대기: T-056 후속(R07), 해외 가용액 정의(R08) ⑧ 후순위: T-074 낮은 후속 12건(R10), T-069 v0b 목적 재정의(R11).

## WP 분해와 진행 (Leader, 2026-10-25 — 사용자 "다음 작업 진행", D-5 순서 T-080 → T-081)
D-2(기준 정하기)·DDL 승인과 무관하게 지금 가능한 것부터, 안전 경로 변경은 항목마다 Developer → Reviewer → Judge C2 → QA 순환을 돈다.
| WP | 내용 | 선행/권한 | 상태 |
|---|---|---|---|
| **A ✅ 코드 완료(WP-A)** | **A06: 앱 국내 체결 조회 TR 보정** — `kis-domestic.ts getCompletedOrders` 가 쓰는 레거시 `TTTC8001R` 이 체결이 있어도 rt_cd=0 + "조회할 내용이 없습니다"(빈 목록)를 돌려줘 "체결 0건"으로 읽힌다(침묵 오답). 현행 `TTTC0081R`(+`EXCG_ID_DVSN_CD`)로 교체, 응답 필드(`odno`·`sll_buy_dvsn_cd`·`tot_ccld_qty`·`avg_prvs`·`ord_dt`·`ord_tmd`)는 동일 확인(2026-10-25 라이브 GET) | 없음(읽기 조회로 라이브 재검증은 Leader, KIS 읽기 승인 범위) | **Reviewer 2회 통과·Codex high 1 채택·QA 통과 → 커밋·배포(아래 Leader 기록)** |
| B | F10(WP-3): 일일 한도 경합 — `checkDailyMax` 가 `pending` 제외·KST 자정 리셋. **확증 시험 먼저**, 수정 필요성은 시험 결과로 판단 | 없음(수정 승인은 시험 뒤) | 대기(A 뒤) |
| C | 원가·실현손익 원천을 KIS 체결·기간손익 조회로 — 읽기 전용 리포트부터(DDL 없음) | 어댑터 추가가 `exchanges/`(안전 경로) → A 와 파일 충돌 없게 A 뒤 | 대기 |
| D | WP-2: `executions` 컬럼 확장 DDL·수수료 0 하드코딩 제거·원가 이월 | **DDL 스크립트 제시 후 사용자 승인** | 승인 대기 |
| E | A02: 브로커 번호 없는 `pending` #2107 정리 설계(브로커 미존재 확인됨) | DB 쓰기 승인 | 설계만 |
| F | C05 월 수익률(수정 Dietz) 순수 함수 + 외부 입출금 보정 | D-2 기준 입력 | 대기 |

## 하지 않는 것
킬스위치 로직(T-080 소유), 신규 매수 경로 개방, 전략 승급, 실주문·취소, 운영 설정·알림, 커밋·push·배포. DDL 은 스크립트와 롤백을 제시하고 별도 승인 후에만.

## 소유 파일 / 훅
- 소유: `src/lib/safety/{order-sync,order-limits}.ts`(훅 대상), `scripts/migrations/`(훅 대상), `src/lib/reports/trade-report.ts`·`src/lib/ledger/`·`src/app/api/cash-ledger/`(**훅 밖** — 그래도 독립 Reviewer 판정을 이 task 가 스스로 요구), `src/lib/db.ts`(훅 대상).
- 비대상: `kill-switch.ts`·`portfolio-total.ts`(T-080), `profit-engine/`(T-082).

## 선행 증거 / 미정 / 사용자 입력
- 선행: S00 대사(완료 대기). **D-2**: T-074 화면에서 기준 정하기 입력(달러 칸은 비워 저장 권고) + 달러 질문 3개 답. **D-3**: KIS 읽기 전용 캡처 1회(잔고·주문가능·증거금·미체결, 앱 밖 주문 확인). **DDL 승인**은 WP-2 착수 시 구체 스크립트로.
- 미정: 월 수익률 방식(C05), 기산·경계, 수수료 추정 요율 표시(D10 0.25% "추정"), 원가 미상 규칙.

## 수용 기준 (절차서 S01 완료 기준)
1. 매도대금 전체 이익화·입금 수익화·통화 혼용 없이 설명 가능하고, 미확정은 가짜 0 이 아니라 상태(`불명`)로 표시된다.
2. 부분체결·재시작·취소 대사에서 장부를 잃지 않는다(격리 DB·모의 KIS 시험, 운영 DB 에 샘플 쓰기 금지).
3. 동시 일일 한도 경합 확증 시험이 통과한다(현재 `pending` 제외 구조 재현 후 수정).
4. 월 수익률이 같은 입력에서 재현되고 USD 행 오염(T-080)과 분리 표시된다.
5. Developer → Reviewer(scope 명시) → Judge C2 → QA 순환. 과거 T-071·T-074 판정을 차용하지 않는다.

## 허용 권한
읽기 전용 DB 조회. 이 외(KIS·DDL·DB 쓰기·배포)는 해당 시점에 구체 범위로 별도 요청.

## 판단 기록 (judge)
- [2026-10-25 00:1x] intake engine=jev → task_type=feature / risk=R2 / developer_model=opus / next=ask_user / demo=none / blocking_gate=requirements | overrides=없음 | fallback=- | tokens=1302. 결과 JSON: `docs/design/judge-result-T-081-intake.json`. complexity 2.95 — 큰 task 이므로 착수 시 WP 로 쪼개 WP 별로 Reviewer 를 돈다.
- `blocking_gate=requirements`: 위 사용자 입력(D-2·D-3)과 착수 승인이 충족되기 전에는 시작하지 않는다.

- [2026-10-25 14:5x] WP-A codex_gate/C1 → codex_required=false (CX-limit-unknown-r2). 결과 `docs/design/judge-result-T-081-C1.json`.
- [2026-10-25 15:0x] WP-A codex_gate/C2 → codex_required=true(`CX-r2-post-review`) / mode=review. 결과 `docs/design/judge-result-T-081-C2.json`. Codex 1회(`--base HEAD`, 33초) → 아래 `## Codex 검토`.

## 관련 과거 이력 요약
[[T-071-ledger-fill-recovery]], [[T-074-cash-flow-ledger]], [[T-069-holdings-baseline-report]], [[T-067-profitability-audit]] (감사 F02·F10), [[T-079-s00-baseline-and-ledger]].

## Leader 기록
- 2026-10-25 (WP-A, 사용자 "다음 작업 진행"): Developer 구현 → **Leader 라이브 읽기 전용 재검증**(현행 TR: 005930 매도 9주·000660 매도 1주·035720 [] — KIS 가 돌려준 체결과 일치) → Reviewer 1차 통과 → Judge C2 → Codex review(high 1: `tr_cont` M/F 무시) → Developer 2차(M/F → throw, fail-closed) → Leader 라이브 재검증(실제 응답은 `tr_cont` E/D 라 예외 없이 동일 결과) → Reviewer 2차 통과(Codex 채택, 실제 order-sync 와 이어 재현: 경고만이면 체결 주문이 cancelled 로 기록됨 / throw 면 `completed_query_failed` 보류, 같은 회차 다른 종목은 정상 정산) → QA 통과(독립 하니스 34건·HEAD 비교·order-sync 연계·훅 시뮬레이션).
- **후속(이번 범위 밖, 낮음~중간):** ① L-5 한 종목이 매 회차 M/F 면 그 종목 주문이 계속 보류(안전, 30분 알림) — 근본 해결은 연속조회 병합(`getActiveOrders`·해외 체결 조회 패턴) ② **같은 어댑터의 다른 국내 TR 이 구형일 가능성**(Reviewer 가 KIS 공식 예시로 확인): 미체결 `TTTC8036R`→`TTTC0084R`(1순위 — 침묵 오답 가능, 열린 주문이 있을 때 비교해야 함), 주문 `TTTC0801U/0802U`→`TTTC0011U/0012U`+`EXCG_ID_DVSN_CD`, 취소 `TTTC0803U`→`TTTC0013U`+`EXCG_ID_DVSN_CD` — 라이브 근거가 없어 **주문 캐너리(T-071 C6)** 때 함께 검증(주문 권한 필요) ③ 취소 판정을 부재 추론 대신 양성 증거로 바꾸기(Reviewer M-2) ④ 3개월 초과 미결 주문은 `CTSC9215R` 필요(기존 제약).

## Developer 기록
- [2026-10-25] **WP-A (A06) 구현 — 국내 체결 조회 TR 보정.** 변경 파일 2개(커밋 전, Reviewer 감사 대기):
  - `src/lib/exchanges/kis-domestic.ts` `getCompletedOrders` 한 함수만: `trId` 실전 `TTTC0081R`/모의 `VTTC0081R`, 쿼리에 `EXCG_ID_DVSN_CD`(실전 `ALL`, 모의 `KRX`) 추가. 나머지 파라미터·응답 매핑·토큰 만료 1회 재시도·에러 처리·`kisFetch` 라벨 `'domestic getCompletedOrders'`·반환 형식 `{orderId, side, price, qty, ts}` 불변. JSDoc 에 "구 `TTTC8001R` 은 체결이 있어도 빈 목록 — 2026-10-25 라이브 비교" 명시.
  - 관측 1줄 추가: 응답 헤더 `tr_cont` 가 `M`/`F` 이면 `console.warn`(종목·조회 기간). 연속조회는 하지 않으며 판정은 바뀌지 않는다.
  - 새 시험 `src/lib/exchanges/__tests__/kis-domestic-completed-orders.test.ts` 10건: 실전/모의 요청 형태(경로·tr_id·EXCG_ID_DVSN_CD·PDNO·CCLD_DVSN·KST 날짜 경계 — UTC 10-18 15:30 → `20261019`·라벨), 응답 매핑(매도·미체결 제외·매수 ord_unpr 폴백·odno 빈 행 제외), rt_cd≠0·HTTP 500 throw, 토큰 만료 1회 재시도(재시도도 현행 TR)·2회째 throw, rt_cd=0 빈 목록 → [], tr_cont=M 관측, 레거시 TR 정적 봉인(주석 제외 실행 코드에 `[TV]TTC8001R` 없음 + 현행 TR 존재).
  - 변이 점검(각각 적용 → 시험 → 원복, 원복 후 sha256 일치 확인): TR ID 를 레거시로 되돌림 → 4건 실패 / `EXCG_ID_DVSN_CD` 제거 → 2건 실패 / 모의 분기 제거 → 2건 실패.
  - `tsc --noEmit` 0 오류. 전체 jest 241 스위트 통과·2 skip, 6004 통과·41 skip·실패 0 (첫 실행에서 `kis-usage-isolation` 1건이 부하 시간 초과로 한 번 실패 — 단독 4.6s 로 통과, 이후 전체 2회 연속 실패 0. 이 시험은 `getCompletedOrders` 를 부르지 않는다).
  - 하지 않은 것: KIS·텔레그램 실호출, DB 쓰기, 킬스위치·주문, `order-sync.ts`·해외 어댑터 변경, git 조작. 라이브 재검증은 Leader 몫.
- [2026-10-25] **WP-A 2차 보강 — Codex high(Reviewer M-1) 반영: `tr_cont` M/F 는 fail-closed.** 1차의 "경고만 남김"을 대체한다.
  - `kis-domestic.ts getCompletedOrders`: 응답 헤더 `tr_cont` 가 `M`/`F` 이면 `KIS getCompletedOrders <종목>: 연속조회 신호(tr_cont=<값>) — 첫 페이지만으로는 체결 부재를 판정할 수 없다 (기간 <시작>~<종료>)` 로 throw. 위치는 rt_cd 검사 뒤·`rows == null` 조기 반환과 행 매핑 앞. `D`/`E`/헤더 없음은 통과. 헤더 접근은 `res.headers?.get?.` 유지. 연속조회는 구현하지 않음. 토큰 재시도·rt_cd 처리·라벨·반환 형식 불변.
  - 효과: order-sync 는 이 예외를 `completed_query_failed` 보류로 처리한다(`order-sync.ts` 의 `!completedOk` 분기 — 부재 연속을 인정하지 않고 cancelled 추론을 하지 않음). 대신 그 회차엔 같은 종목의 체결 확정도 보류된다(보수적 방향).
  - 주석 순화: JSDoc·시험 머리말의 "구 TR 은 체결이 있어도 빈 목록"을 "같은 조건에서 구 TR 호출은 빈 목록, 현행 TR + `EXCG_ID_DVSN_CD=ALL` 호출은 체결 2건 — TR ID 와 파라미터가 함께 달라 원인 분리 못 함"으로 고침. M/F 에서 던지는 이유(부재 추론은 완전한 목록 전제, T-018) 2줄 추가.
  - 시험 교체·추가(10 → 17건): `M`·`F` → throw(메시지에 종목·`tr_cont`·기간, `kisFetch` 1회), `D`·`E`·헤더 없음 → 정상 반환, rt_cd≠0 + `M` → rt_cd 오류가 먼저(순서 고정), `M` + 빈 목록 → throw, `M` + output1 누락 → throw(조기 반환보다 앞 고정).
  - 변이 점검(적용 → 시험 → 원복, sha256 일치 확인): 경고로 복원 → 4건 실패 / `M` 만 검사 → 1건 실패(F) / rt_cd 검사 앞으로 이동 → 1건 실패(순서) / `rows == null` 조기 반환 뒤로 이동 → 1건 실패(output1 누락) / 행 매핑 뒤로 이동(도달 불가 = 제거와 같음) → 4건 실패.
  - `tsc --noEmit` 0 오류. 전체 jest 241 스위트 통과·2 skip, 6011 통과·41 skip·실패 0. 이 변경으로 Reviewer 재감사 필요.

## Reviewer
- [14:46] **WP-A (A06) 독립 감사 — 국내 `getCompletedOrders` TR 보정.** 검토 범위: `src/lib/exchanges/kis-domestic.ts`(diff 4개 hunk 전부 이 함수 안), `src/lib/exchanges/__tests__/kis-domestic-completed-orders.test.ts`. 호출처 `src/lib/safety/order-sync.ts`(체결 판정 `completedOrderIds.has(eid)`·`fills` 최대 수량·`settleDecision`·취소 추론)는 읽기만 했고 수정 없음.
- [14:46] 사실 확인: 변경은 TR ID(`TTTC0081R`/`VTTC0081R`)·`EXCG_ID_DVSN_CD`(실전 ALL/모의 KRX)·JSDoc·`tr_cont` 관측 경고뿐이고 반환 형식·재시도·에러·라벨은 불변이다. KIS 공식 저장소(`koreainvestment/open-trading-api` main, raw 원문을 직접 내려받아 확인)의 `inquire_daily_ccld.py` 가 같은 TR ID 와 같은 14개 파라미터 + `EXCG_ID_DVSN_CD`(KRX/NXT/SOR/ALL, 기본 KRX)를 쓴다. 내 쪽 직접 실행: `tsc --noEmit -p tsconfig.json` 0 오류, 전체 jest 241 스위트 통과·2 skip, 6004 통과·41 skip·실패 0. T-040 라벨 가드(`kis-http-usage.test.ts`)와 충돌 없음(라벨을 바꾸면 그 시험이 깨지는 것도 변이로 확인).
- [14:46] order-sync 영향 추적: 매칭은 `odno` 문자열 일치 + 수량은 주문별 최대값(합산 아님)이라 같은 주문의 복수 행(분할·누적 표현)은 과대 집계되지 않는다. `side`·`price`(avg_prvs 우선)·`ts`(주문 일시) 매핑은 이전과 동일하고, 빈 목록 = 체결 0건 의미도 불변이다. 앱 주문은 `EXCG_ID_DVSN_CD` 없이 나가므로 거래소 KRX 기본이고, ALL 은 그 상위집합이라 놓침(침묵 오답) 쪽 위험을 줄이는 방향이다. 새로 열리는 오판 경로는 찾지 못했다.
- [14:46] 변이 21개 재현(scratch 복사본, 원복 후 sha256 일치): TR 둘 다 레거시 원복·실전만 원복·모의만 원복·`EXCG_ID_DVSN_CD` 제거·ALL/KRX 뒤바꿈·모의 분기 제거·PDNO 제거·CCLD_DVSN 변경·INQR_DVSN 변경·UTC 날짜·체결수량 필터 제거·side 반전·price 폴백 변경·ts 오프셋 제거·odno 빈 행 필터 제거·rt_cd 검사 제거·토큰 재시도 제거·tr_cont 경고 제거·경고를 throw 로 바꾸기·라벨 변경은 전부 시험이 잡았다. 생존 1건: `output1` 부재(`rows == null`)를 throw 로 바꿔도 통과 — 이 분기는 이번 시험이 안 건드린다(기존 동작, 낮음).
- [14:46] 지적(차단 아님): M-1 `tr_cont=M/F` 는 경고만 남기고 "목록에 없음"을 계속 부재 증거로 쓴다 — `getActiveOrders`(T-023)·해외 `getCompletedOrders` 는 불완전하면 던지는데 국내 체결 조회만 다르다. 종목 지정·짧은 기간이라 발생 확률은 매우 낮지만 일어나면 체결 주문이 취소 추론 대상이 되는 같은 유형이라, 후속에서 던지거나 연속조회를 붙일 것. M-2 침묵 오답의 구조적 위험(TR 이 또 낡으면 빈 목록)은 남는다 — 빈 목록 때 `msg1` 로깅은 저비용이지만 A06 때 `msg1` 이 "조회할 내용이 없습니다"였고 진짜 0건도 같은 문구일 수 있어 판별력이 약하다[추측]; 실효 있는 완화는 취소를 부재가 아니라 양성 증거(`CCLD_DVSN=00` 의 해당 행 취소 표시)로 판정하거나 알려진 체결을 되묻는 정기 점검이며 별도 task 로 다룰 것. L-1 JSDoc·시험 머리말이 "구 TR 은 체결이 있어도 빈 목록"을 사실처럼 쓰는데 기준선 보고서는 TR ID 와 파라미터가 동시에 달라 원인을 분리 못 했다고 적었다 — "현행 TR+거래소 구분 조합만 체결 반환(원인 분리 안 됨)"으로 순화 권장. L-2 정적 봉인 시험은 동작 시험(tr_id 단언)과 중복이고 따옴표 형태에 의존해 약간 취약하다 — 유지해도 해는 없다. L-3 `TTTC0081R` 은 3개월 이내 조회 TR 이라 가장 오래된 미결 주문이 3개월을 넘으면 `CTSC9215R` 이 필요하다(공식 예시) — 기존 제약, 국내 주문이 다시 쌓일 때 확인. L-4 `KIS_DOMESTIC_DEBUG` 원문 로그에 `msg_cd`/`msg1` 이 없다(추가해도 동작 무영향).
- [14:46] 후속 항목 후보(이번 diff 밖, 공식 저장소 main 대비): 국내 미체결 `getActiveOrders` 는 앱 `TTTC8036R`/`VTTC8036R` 인데 공식 예시는 `TTTC0084R`(모의 TR 예시 없음) — 이 repo 에 `TTTC8036R` 의 라이브 정상 응답 기록이 없고 A06 과 같은 부류라 후속 1순위로 제안한다(미체결이 0건이면 낡은 TR 인지 구분이 안 되므로 열린 주문이 있을 때 비교해야 함). 국내 주문·취소 `TTTC0802U`/`TTTC0801U`/`TTTC0803U` 는 공식 예시가 `TTTC0012U`/`TTTC0011U`/`TTTC0013U`+`EXCG_ID_DVSN_CD`(필수)로 바뀌어 있다 — 앱 마지막 주문이 05-27 이라 이후 라이브 근거가 없고, 실패하면 `rt_cd≠0` 로 소리 나는 쪽이다. 일치 확인: 국내 잔고 `TTTC8434R`, 해외 체결 `TTTS3035R`, 해외 미체결 `TTTS3018R`(모의 TR 은 공식 예시에 없음), 해외 주문 `TTTT1002U`/`TTTT1006U`, 해외 취소 `TTTT1004U`, 해외 잔고 `TTTS3012R`/`CTRP6504R`. 공식 저장소는 예시 코드이지 KIS 명세 원본이 아니며, 레거시 TR 이 지금도 서비스되는지는 KIS 호출 없이는 확인할 수 없다.
- [14:46] 확인하지 못한 것: Leader 의 라이브 재검증(005930 매도 9주·000660 매도 1주·035720 빈 목록)은 재현하지 않았다(KIS 호출 금지). 새 TR 로 앱이 낸 주문의 `odno` 가 주문 응답 `ODNO` 와 같은 형식(0 채움)인지는 앱 주문이 다시 나올 때까지 실증 불가. ALL 에서 KRX/NXT 가 같은 `odno` 를 쓰는 충돌 가능성은 확인하지 못했다(앱 주문이 KRX 전용이라 영향은 매우 낮음). DB·운영 앱은 열지 않았다. 이 감사는 위 두 파일에만 적용되며 후속 항목이나 다른 변경의 승인으로 쓰지 않는다.
- [14:46] **최종 판정: PASS (scope: src/lib/exchanges/kis-domestic.ts, src/lib/exchanges/__tests__/kis-domestic-completed-orders.test.ts)**
- [15:00] **재순환 감사 — Judge C2/Codex 지적(`tr_cont` M/F 를 경고만 하고 첫 페이지를 전체처럼 반환) 반영분.** 위 14:46 판정의 M-1(경고만 남기고 부재 증거로 씀)은 이번 변경으로 해소됐다. 검토 범위는 같은 두 파일(`kis-domestic.ts` 4fcbfede…, 시험 파일 892b7bf4…)이고 읽기만 했다(저장소 수정 없음).
- [15:00] Codex 지적 채택: 직접 재현했다. scratch 에서 실제 `getCompletedOrders` + 실제 order-sync 를 잇고(HTTP·DB·알림만 모킹) 005930 의 1페이지(`tr_cont=M`)에 해당 주문이 없고 2페이지에 있다고 가정하니, M/F 가 경고뿐일 때는 그 주문이 `cancelled` 로 쓰이고 `complete=true`·보류 0건·알림 없음으로 끝났다(침묵 오답). 현재 코드(throw)에서는 cancelled 0건이다. 심각도는 결과(체결 주문의 cancelled 오기록)로는 높음이 맞고, 발생 확률은 종목 지정·짧은 기간이라 매우 낮다고 본다 — 채택 여부와 무관하게 수정은 옳다.
- [15:00] 반영 정확성: 검사 위치는 `res.ok`·`rt_cd` 검사 뒤, `rows == null` 조기 반환·행 매핑 앞이다. 값 집합 M/F 는 공식 예시 `inquire_daily_ccld.py`(`tr_cont in ["M","F"]` = 다음 페이지 존재)와 일치하고 D/E/헤더 없음은 통과한다. 토큰 만료(HTTP 500, `continue`)는 검사 이전 분기라 상호작용이 없고 재시도 응답도 같은 검사를 받는다. 반환 형식·라벨·재시도·에러 의미 불변(diff 가 이 함수 안으로 한정). 메시지에 종목·기간이 들어간다.
- [15:00] order-sync 경로 추적(코드 + scratch 종단 시험): throw → 종목별 try/catch 가 `completedOk=false`·`errors[]` 기록 → 그 종목 주문은 체결 양성 분기를 건너뛰고 `!completedOk` 분기에서 `completed_query_failed`(미체결 조회도 실패면 `both_queries_failed`)로 `track()` 보류 후 continue — cancelled·filled 어느 쪽도 쓰지 않는다. (a) 체결 주문을 cancelled 로 잘못 쓰는 경로는 없다. (b) 범위는 그 종목·그 회차뿐이다: 같은 회차에 000660 은 정상으로 filled 정산됐고(`synced=1`), 보류된 종목의 다른 주문도 같은 이유로 함께 보류되며(양성 체결 판정도 지연) 다음 회차(5분)에 재시도한다. 호출부 `strategy-eval` 은 결과를 로그로만 쓴다(거래 게이트 아님). 영구 보류 관측: 매 회차 `ORDER_SYNC_UNRECONCILED` 경고에 detail(`tr_cont=M`…)이 남고, 30분(STALE_MS) 지속 시 critical 알림(scratch 에서 31분 경과로 `order-sync:stale` critical 발송 확인), 2시간 뒤 구조적 승격이 이어진다.
- [15:00] 변이(scratch 복사본, 원복 후 sha256 일치, 시험 17건 + T-040 가드 + 종단 시험으로 판정): M/F 검사를 경고로 복원 → 6건 실패(종단 시험의 cancelled 0건 단언 포함) / `F` 누락 → 1건 실패 / `M` 누락 → 5건 실패 / 검사를 rt_cd 앞으로 이동 → 1건 실패 / `rows == null` 반환 뒤로 이동 → 1건 실패 / 빈 output1 이면 검사 생략 → 3건 실패 / 헤더 이름 오타 → 6건 실패 / D·E 도 throw(과잉) → 3건 실패 / 메시지에서 종목·기간 제거 → 각 2건 실패. 1차의 TR·`EXCG_ID_DVSN_CD`·모의 분기·매핑·재시도·라벨 변이 20개도 새 시험 세트에서 계속 잡혔다. 생존은 1차와 같은 1건뿐(`output1` 부재를 throw 로 바꿔도 통과 — 기존 동작, 낮음). 직접 실행: `tsc --noEmit -p tsconfig.json` 0 오류, 전체 jest 241 스위트 통과·2 skip, 6011 통과·41 skip·실패 0.
- [15:00] 새 지적(차단 아님): L-5 throw 로 바꾼 만큼, 한 종목이 매 회차 M/F 이면 그 종목 주문은 계속 보류(안전한 쪽)된다. 조회 창이 가장 오래된 미결 주문 시각에서 시작해 보류가 길수록 창이 넓어지고, `EXCG_ID_DVSN_CD=ALL` 이라 앱 밖(수동) 체결 행도 섞여 행 수가 늘기 쉽다. 가시성(30분 알림)은 있으므로 막지는 않지만, 근본 해결은 연속조회 병합(`getActiveOrders`·해외 체결 조회가 쓰는 패턴, `tr_cont:'N'` + 이전 `ctx_area_*`)이다 — 별도 후속 task 로 권한다. 공식 예시상 모의 계좌는 1회 15건(실전 100건)이라 `KIS_MOCK=true` 에서는 M/F 가 훨씬 흔하다. L-1 은 JSDoc·시험 머리말이 "원인 분리 안 됨"을 명시하게 되어 해소됐다. 나머지 14:46 지적(M-2 구조적 침묵 위험·L-2~L-4)과 후속 후보(`TTTC8036R` 미체결 조회 1순위, 주문 `TTTC0801U`/`TTTC0802U`·취소 `TTTC0803U` 구형 가능성)는 그대로 유지하며 새로 알게 된 항목은 없다.
- [15:00] 확인하지 못한 것(추가): Leader 의 현재 코드 라이브 재검증(실제 응답 `tr_cont` 가 E/D)은 재현하지 않았다(KIS 호출 금지). 1페이지 `tr_cont=M` 이 실제 KIS 에서 어떤 조건에 오는지는 라이브로 보지 못했다. 이 감사는 위 두 파일에만 적용되며 후속 항목이나 다른 변경의 승인으로 쓰지 않는다.
- [15:00] **최종 판정: PASS (scope: src/lib/exchanges/kis-domestic.ts, src/lib/exchanges/__tests__/kis-domestic-completed-orders.test.ts)**

## QA
- [15:10] **WP-A (A06) QA — 국내 체결 조회 TR 보정, 직접 실행 검증.** 대상: `kis-domestic.ts`(sha256 `4fcbfede…`)·신규 시험(`892b7bf4…`) — Reviewer 15:00 재감사가 본 해시와 같다. 저장소 파일은 이 `## QA` 절 외에 수정하지 않았고(git status·md5 전후 동일), KIS·DB·텔레그램·`.env`·`test-git-hooks.sh` 는 건드리지 않았다.
- [15:10] 정적·단위: `tsc --noEmit -p tsconfig.json` 오류 0(증분 캐시 영향을 배제하려고 `--incremental false` 로도 0). tsconfig 가 시험 파일을 제외하고 jest 는 swc 라 타입 검사를 안 하므로 임시 tsconfig 로 신규 시험 파일을 따로 검사해도 0. 신규 시험 단독 17건 통과, `src/lib/exchanges` 17 스위트 401건 통과, `src/lib/safety` 36 스위트 1029건 통과(order-sync 시험 5개 포함).
- [15:10] 전체 jest: 순차 2회 + 동시 3회(부하) 모두 241 스위트 통과·2 skip(DB 가 필요한 `t072`·`t074` disposable-mariadb 시험, 이번 변경과 무관), 6011 통과·41 skip·실패 0. `kis-usage-isolation` 은 전체 실행 한 판을 동시에 돌리는 부하에서 단독으로 5회 더 돌려도 17건 모두 통과했고(그 5판의 전체 실행도 모두 통과), 불안정 재현은 되지 않았다(Developer 가 본 1회 시간 초과는 재현 못 함). 시험은 `TZ=UTC` 에서도 통과.
- [15:10] 변경 범위: `git diff HEAD --stat` 은 `kis-domestic.ts` +20/−2 와 이 문서(이 절 추가 전 기준 +43) 뿐이고, 소스 hunk 5개가 전부 `getCompletedOrders` JSDoc·본문 안이다. 반환 형식·토큰 만료 재시도·`kisFetch` 라벨 `domestic getCompletedOrders` 는 텍스트 diff 상 불변. `git status --porcelain` 은 수정 2(소스·T-081 문서)·신규 3(시험, 판정 JSON 2) 외에 없다(`NUL` 없음). 레거시 TR 문자열은 주석 한 곳에만 남아 있다.
- [15:10] 독립 시나리오 하니스(내가 새로 작성, `git archive HEAD` 사본 + 변경 파일 덮어쓰기, `global.fetch` 모킹으로 실제 `kisFetch` 통과, 인증·자격증명만 모킹) 34건: 변경 사본 34/34 통과, HEAD 사본은 효과 시험 8건 + order-sync 연계 5건 실패. 확인한 것: (a) 실전 `TTTC0081R`·경로 `inquire-daily-ccld`·`EXCG_ID_DVSN_CD=ALL`·`PDNO`·`CCLD_DVSN=01`·KST 날짜(자정 경계 23:59:59→당일, 00:00:00→익일)·쿼리 키 15개 전체. (b) 모의 `VTTC0081R`+`KRX`(`KIS_MOCK` 미설정 기본값도 모의). (c) 매도 체결 매핑·체결수량 0 행 제외·`odno` 빈 행 제외·`avg_prvs` 부재 시 `ord_unpr`·`ts` +09:00 — 응답 매핑 결과는 HEAD 와 JSON 이 일치(반환 형식 불변). (d) `tr_cont` M·F → 예외(메시지에 종목·`tr_cont`·기간 20261020~20261023, 추가 요청 없음), D·E·빈 값·헤더 없음 → 정상, `rt_cd`≠0 이면 `rt_cd` 오류가 우선, 토큰 재시도 응답에도 같은 검사. (e) 빈 목록·`output1` 부재·null → `[]`, 배열 아님 → 예외. (f) `rt_cd`≠0·HTTP 500·404·비 JSON·fetch 예외 → 예외, 레이트리밋 `EGW00201` 은 3회 시도 후 예외(재시도 구조 불변). (g) `EGW00123` 1회 재발급 후 같은 TR·새 토큰으로 재시도, 두 번째 만료는 예외. HEAD 에서 실패한 것은 (a) 요청 형태·(b) 모의 3건·(d) M/F 2건·(g) TR/`tr_cont` 2건으로, 변경이 실제 효과를 낸다. HEAD 의 `tr_cont=M` 은 예외 없이 첫 페이지를 그대로 반환했다. 시간대는 `TZ=UTC`·`America/New_York`·`Asia/Seoul` 모두 통과.
- [15:10] order-sync 연계(실제 `getCompletedOrders` + 실제 `syncPendingOrders`, HTTP·DB·알림·미체결 조회만 모킹): 체결 응답(`tr_cont=D`) → `filled` 정산(변경 전후 동일). 1페이지 `tr_cont=M` 이고 해당 주문이 없으면 **변경 사본은 쓰기 0·`completed_query_failed` 보류·`complete=false`·errors 에 `tr_cont=M`**, **HEAD 는 그 주문을 `cancelled` 로 기록**했다(침묵 오답 재현). `F` 도 동일. `M` 이고 주문이 1페이지에 있어도 보수적으로 보류. `E`+빈 목록은 보류 없이 정상 경로(국내 지정가 `cancelled` 추론)로 간다. 종목 두 개 중 한 종목만 `M` 이면 그 종목만 보류되고 다른 종목은 `filled` 정산(`synced=1`). order-sync 경유 요청도 `TTTC0081R`+`ALL`(HEAD 는 `TTTC8001R`+파라미터 없음). 기존 order-sync 시험은 `@/lib/exchanges/kis` 파사드를 모킹하므로 어댑터 변경과 무관하게 통과한다 — 어댑터와 order-sync 의 접점은 위 하니스로 확인했고, 기존 커버리지 매핑은 `order-sync-fail-closed.test.ts`(체결 조회 실패 → `completed_query_failed`).
- [15:10] 커밋 훅(임시 저장소에 실제 `scripts/git-hooks/commit-msg`·현재 T-081 문서·변경 파일을 복사해 stage 하고 로직만 호출, 프로젝트 저장소 미접촉): 안전 파일 2개(`^src/lib/exchanges/` 에 걸리는 소스·시험)를 `T-081` 메시지로 stage → 통과(exit 0). 차단 확인(모두 exit 1): task ID 없는 메시지, 없는 task ID, scope 밖 안전 파일(`order-sync.ts`) 추가, 마지막 `최종 판정` 을 실패로 바꾼 복사본, scope 에서 시험 파일을 뺀 복사본, `최종 판정` 줄이 없는 복사본, 소문자로 바꾼 복사본. 원본 문서로 되돌리면 다시 통과. (이 절을 추가한 뒤의 문서로도 같은 시뮬레이션을 다시 돌려 통과를 확인했다.)
- [15:10] 문서 위생: 이 문서에서 대문자 판정 단어는 `## Reviewer` 절 안의 `최종 판정` 줄 2개(14:46·15:00, 같은 판정·같은 scope — 마지막 줄이 유효, 판정이 뒤집히지 않았으므로 정리 불필요)에만 있고 설명 문장·`## Developer 기록`·다른 절에는 없다. `## Reviewer` 안에 소제목이 없고, 제목에 reviewer 가 든 헤딩은 `## Reviewer` 하나뿐이다.
- [15:10] 결함: 심각도 높음·중간 없음. 낮음 3건 — ① 시험 파일이 tsconfig 에서 제외되고 jest 가 타입 검사를 안 하므로 시험 타입 오류는 지금처럼 따로 돌려야 잡힌다(이번 검사는 0). ② `--forceExit` 로 도는 jest 가 `/tmp/stockinvest-jest-api-usage-*` 빈 디렉터리를 남긴다(이번 세션 약 23개, 이번 변경 무관·기존 현상). ③ Reviewer 의 L-5(한 종목이 매 회차 `M`/`F` 면 그 종목 주문이 계속 보류, 특히 `KIS_MOCK=true` 는 1회 15건이라 잦다)는 안전한 방향이며 하니스에서 보류 동작을 확인했다 — 연속조회 병합은 후속 task 대상.
- [15:10] 확인하지 못한 것: KIS 라이브(Leader 가 이미 한 005930·000660·035720 확인은 재현하지 않음 — 금지), 실제 KIS 에서 첫 페이지가 `tr_cont=M` 으로 오는 조건, 모의 계좌의 `VTTC0081R` 수락 여부, 새 TR 로 앱이 낸 주문의 `odno` 형식 일치(앱 주문이 다시 나올 때까지 실증 불가), 3개월 초과 미결 주문(`CTSC9215R` 필요, 기존 제약), `ALL` 에서 KRX·NXT 가 같은 `odno` 를 쓰는 충돌. 실제 `git commit` 훅 경로(`core.hooksPath` shim 포함)는 실행하지 않았다 — 훅 로직만 임시 저장소에서 호출했다.
- [15:10] **QA 종합 판정: 통과** — 국내 체결 조회 TR 보정과 `tr_cont` M/F 차단(fail-closed)은 직접 실행한 결과 의도대로 동작하고, 변경 범위는 `getCompletedOrders` 안에 한정되며, order-sync 가 불완전한 첫 페이지로 체결 주문을 취소로 오기록하던 경로가 닫혔다. 커밋 훅 준비도 통과했다. Leader 의 라이브 재검증과 합쳐 배포 전 남은 위험은 위 "확인하지 못한 것"뿐이다.

## Codex 검토

### [2026-10-25 15:0x] C2 review focus=none — done (WP-A)
- judge 판정: `## 판단 기록 (judge)` 의 `codex_gate/C2` 줄 / 호출 차수 T-081 1/4. 대상: repo=StockInvest base=HEAD(`2c9970e`) — WP-A 미커밋분만 전송.
- 지적 1건: [high] `kis-domestic.ts` `tr_cont` M/F 를 경고만 남기고 첫 페이지를 전체처럼 반환 → order-sync 의 부재 추론과 결합해 체결 주문이 cancelled 로 오기록될 수 있음. 권고: 병합 또는 최소 throw.
- 채택·기각(Reviewer 2차): **채택**(결과는 높음, 발생 확률은 종목 지정·짧은 기간이라 낮음). 반영: M/F → Error(fail-closed), 시험 17건. 검토하지 못한 범위(Codex): 라이브 응답·KRX/NXT 주문번호 충돌·시험 실행.
- 원본: `/home/brownjeon/NFS/homes/brownjeon/project/.claude/state/codex-review/runs/20261025T054804Z-T-081-C2/`.

