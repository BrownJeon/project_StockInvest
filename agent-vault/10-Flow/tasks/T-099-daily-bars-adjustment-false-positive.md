---
task_id: T-099
title: 일봉 증분 수집의 조정 기준 변경 오탐 — 원인 확인 후 비교 규칙 수정
status: done
priority: medium
project: StockInvest
created: 2026-10-27
updated: 2026-10-27
base_ref: f6f3b70
risk_level: R1
roles_involved: [leader, judge, developer, reviewer, qa]
related_tasks: [T-082-s02-daily-bars-universe-remaining, T-070-daily-bars-collector, T-096-strategy-validation-p2-p3]
tags:
  - type/task
  - domain/profit-engine
  - domain/data-quality
aliases:
  - 조정오탐
waiting: []
demo_gate:
  required: false
  level: "none"
  status: "not_required"
  version: 0
  repo_path: ""
  artifact_url: ""
  content_sha256: ""
  decided_by: "judge"
  rule_id: ""
  approved_by: ""
  approved_at: ""
  approval_quote: ""
  waived_by: ""
  waived_at: ""
  waiver_quote: ""
  active: false
---

# T-099 일봉 증분 수집의 조정 기준 변경 오탐 — 원인 확인 후 비교 규칙 수정

## 사용자 결정 (10-27 발화, 그대로)

"T-082에 대하여 지금 상태로 유지하되 원인 확인 및 수정 task를 먼저 생성해서 진행해줘" — [[T-082-s02-daily-bars-universe-remaining]] 의 나머지 수집은 이 task 가 끝나기 전까지 하지 않는다(지금 상태 유지).

## 현상 (T-082 실행 10-27 05:41:55~05:43:33 KST, HTTP 200)

- 증분 수집이 처리한 **17종목 전부**(미국 4·국내 13)에서 겹친 구간의 확정 봉 9개 중 **정확히 1개**가 불일치(`adjChange {compared:9, mismatches:1}`)로 잡혀 "조정 기준이 바뀌었다"로 판정, 종목 전체를 다시 받았다(종목당 9호출, 731~899행 재작성). 호출 상한 150건을 17종목에서 다 써서 93종목 중 76종목은 손대지 못했다.
- 정기 증분이 이 상태로 돌면 종목당 1호출이 아니라 9호출, 93종목이면 회당 약 850호출이다 — 증분 설계가 무력화된다.

## 읽기 전용으로 확인한 것 (10-27, KIS 호출 0건)

1. **판정 코드** ([daily-bars-quality.ts:195](../../../src/lib/profit-engine/daily-bars-quality.ts) `detectAdjustmentChange`): 저장분 중 `is_final=1` 이고 `adj_stale`·`adj_orphan` 이 아닌 봉만, 같은 날짜의 새로 받은 종가와 **절대 오차 0.0001** 로 비교. 하나라도 넘으면 `changed`. 허용 오차는 상대값이 아니고, 최신 봉이라는 구분도 없다.
2. **확정 시각** ([daily-bars-time.ts:15](../../../src/lib/profit-engine/daily-bars-time.ts) `FINAL_AFTER_MIN`): 국내 15:40, 미국 16:30(현지). 10-24 첫 수집은 05:40~05:50 KST = 미국 16:40~16:50 ET, 마감(05:00 KST)에서 40~50분, 확정 문턱(05:30 KST)에서 10~20분 뒤에 저장됐다.
3. **미국 최신 봉 모양**: 10-24 에 받은 뒤 아직 손대지 않은 미국 46종목에서 4자리 소수 종가(= 2자리가 아닌 값) 개수가 날짜별로 이렇다 — 10-05 8 · 10-06 5 · 10-07 5 · 10-08 4 · 10-09~13 3 · 10-14 2 · 10-15 1 · 10-16 2 · 10-19 1 · 10-20 2 · 10-21~22 1 · **10-23 12**. 오래된 날일수록 많은 것은 배당 조정이 누적되기 때문(수정주가)이라 설명되지만, **가장 최근 하루만 튀는 것**(12/46)은 설명되지 않는다. 방금 다시 받은 종목도 같다: NAS:MU 10-19~10-23 은 2자리(`904.9000`·`896.0700`·`913.6700`·`856.4900`·`877.5500`), **10-26 만 `904.8849`**. → 마감 직후 받은 최신 봉은 잠정값이고, 며칠 뒤 확정값으로 바뀐다고 보는 것이 가장 단순하다 **[가능성 높음 — 미국]**.
4. **국내는 이 설명으로 안 된다**: 국내 종가는 정수라 모양으로 구별할 수 없고, 10-24(토) 05:4x 에 받은 10-23(금) 봉은 마감(15:30)에서 14시간 뒤라 잠정값일 이유가 약하다. 그런데 국내 13종목도 똑같이 1건씩 불일치했다. **원인 미확인 [추측]** — 가설: ① 새로 받은 쪽 페이지 경계(겹침 시작일) 봉의 값이 다름 ② 토요일 새벽 응답과 화요일 새벽 응답의 최신 봉 산출 차이 ③ 다른 원인.
5. **옛 값은 없다**: 17종목의 옛 저장값은 덮어써져 어느 날짜가 얼마나 달랐는지 DB 에서 알 수 없다. 찾아본 범위(운영 DB 백업 스크립트 흔적·홈 백업 폴더)에 DB 덤프는 없었다.
6. 단순 배당·액면 조정 가설은 기각: 조정 사건이 있으면 그 날 **이전의 모든 봉**이 같이 달라져 비교 구간에서 여러 건이 걸려야 한다. 17종목 전부 정확히 1건인 것과 맞지 않는다(사건이 하필 비교 구간의 둘째로 새로운 날이 아닌 한).
7. **거래량 비교 (10-27 추가, 읽기 전용)**: 10-24 에 받은 최신 봉(10-23)의 거래량 ÷ 앞선 9일(10-13~10-22) 평균 — **미국 46종목 전부 0.25~0.80(평균 0.50)**, 종가 2자리 34종목 평균 0.50·4자리 12종목 평균 0.48. **국내 30종목은 평균 0.97(0.35~3.17)로 정상.** → 미국 최신 봉은 종가 모양과 무관하게 거래량이 평소의 절반 수준으로 일관되게 낮다 = 마감 40~50분 뒤 저장한 잠정 봉 **[가능성 높음]**. 국내는 정상이라 국내 불일치는 같은 원인이 아니다 **[가능성 높음]**(국내 원인은 계속 미확인). 수집기의 비교는 종가만 보므로 **거래량 잠정값은 감지되지 않고**, 다음 증분의 겹침 재작성이 덮어쓸 때만 고쳐진다. 영향 후보: P3 OOS 의 마지막 날(as-of 2026-10-23)이 바로 이 잠정 봉이다 — S7(거래량 수축)과 유동성 필터는 거래량을 쓰므로 OOS 실행 전에 확정값으로 갱신해야 하는지 확인 필요 **[추측: OOS 에서의 사용 방식은 이번에 코드로 확인하지 않음]**.

## 진단 계획 (Step B — 사용자 승인 필요)

읽기 전용, DB 쓰기 0. 아직 손대지 않은 종목 중 국내 1·미국 1(미국은 최신 봉이 4자리 소수인 종목)을 골라 수집기와 같은 요청(겹침 시작일~오늘, 1페이지)을 **각 1~2회**만 보내 새 응답을 저장된 값과 날짜별로 비교해 표로 남긴다. **KIS 읽기 최대 4건.** 기대 결과:
- 가설 ①(잠정 최신 봉)이 맞으면: 불일치가 **저장된 가장 최신 봉(10-23) 하나**에만 있고, 미국은 저장값이 4자리·새 값이 2자리.
- 국내에서 같은 위치(최신 봉)에 불일치가 나오면 원인은 시장 공통(응답이 며칠 사이 바뀜). 다른 위치(겹침 시작 경계)에 나오면 경계 효과.
- 어느 쪽이든 불일치 크기와 날짜가 수정 규칙(Step C)의 입력이 된다.
승인 없이는 호출하지 않는다.

## 진단 결과 (10-27 17:11 KST, 사용자 승인 후 KIS 읽기 GET 4건)

사용자 승인(발화 그대로): "진단 KIS 읽기 4건에 대해 승인히며 is 실행도 승인하니까 작업 진행해줘". 수집기의 증분 첫 호출과 같은 요청(겹침 시작 2026-10-13~오늘, 수정주가)을 종목당 1번, 아직 손대지 않은 4종목에 보내 새 응답을 저장값과 날짜별로 비교했다. DB 쓰기 0·토큰 재발급 0·호출 정확히 4건. 원 결과 JSON 은 세션 임시 폴더(`diag/diag-result-20261027-171104.json`)에 있다.

| 종목 | 비교한 봉 | 일치 | 불일치 | 저장 → 새 종가 | 저장 → 새 거래량 |
|---|---|---|---|---|---|
| NAS:MSFT | 9 | 8 | **10-23 하나** | 524.9988 → 524.51 (−0.093%) | 10,298,605 → 13,681,067 (+33%) |
| NAS:AAPL | 9 | 8 | **10-23 하나** | 347.37 → 347.725 (+0.102%) | 26,174,997 → 39,539,690 (+51%) |
| 005930 | 9 | 8 | **10-23 하나** | 213,500 → 215,500 (+0.94%) | 16,145,972 → 16,145,972 (동일) |
| 000660 | 9 | 8 | **10-23 하나** | 1,263,000 → 1,277,000 (+1.11%) | 3,941,446 → 3,941,446 (동일) |

읽은 결과 **[확실 — 4/4 직접 관측]**
1. 불일치는 네 종목 모두 **저장된 가장 최신 봉(10-23) 하나뿐**이고, 그보다 오래된 8개 봉은 종가·거래량이 소수점 끝까지 일치한다. 배당·액면 조정 사건이라면 최신이 아닌 봉들이 어긋나야 한다 → 조정 오탐이 맞다.
2. **미국**: 최신 봉의 종가와 거래량이 모두 나중 값과 다르다(거래량은 +33~51%). 앞서 "4자리 소수 종가 = 잠정 봉 표지" 라고 한 것은 **불충분**했다 — AAPL 은 저장 종가가 2자리(`347.37`)인데도 나중에 `347.725` 로 바뀌었다. 종가 모양이 아니라 "마감 직후 저장한 최신 봉" 자체가 잠정이라고 보아야 한다(전수 거래량이 평소의 0.25~0.80배인 것과 일치).
3. **국내**: 거래량은 같고 종가만 +0.9~1.1% 달라졌다. 국내도 최신 봉이 잠정이었다는 점은 미국과 같지만 **원인 기전은 미확인**(거래량이 같아 장중 합산 문제는 아니다. 확인되지 않은 후보: 시간외·대체거래소 거래의 종가 반영 시점 차이. 이 task 의 수정에는 기전이 필요하지 않다).
4. **크기**: 차이는 미국 약 0.1%, 국내 약 1%. 처음 가정한 "상대 오차 1e-4 로 흡수" 는 **성립하지 않는다**(MU 의 5.6e-6 은 4자리 소수 반올림 차이였을 뿐). 허용 오차로는 막을 수 없고 **"어느 봉에서 불일치했는가(위치)"로 판정해야 한다.**
5. 미국 10-27 봉(`close 529.0012 vol 14,160`)은 아직 시작 전 새벽의 부분 봉이다 — 저장 시 `is_final=0` 이므로 비교 대상이 아니다(지금 구조 그대로 안전).

## 확정된 수정 설계 (진단 결과 반영)

**규칙 C-2 "정착 중인 최신 봉"**: `detectAdjustmentChange` 에서 비교한 확정 봉을 날짜 오름차순으로 놓고, 불일치 집합 M 이 비어 있지 않을 때
- M 의 모든 날짜가 **가장 최근 K=2 개 비교 봉 안**에 있고, 그보다 오래된 비교 봉이 **최소 3개** 있으며 전부 일치하면 → `changed=false`, `settling` 으로 센다. 호출자는 stale 표시·전체 재수집을 하지 않고 평소처럼 받은 페이지를 쓰기만 한다(겹침 구간 재기록이 최신 봉을 확정값으로 덮는다).
- 그렇지 않으면(오래된 봉에도 불일치가 있거나, 오래된 일치 봉이 3개 미만이라 구분할 근거가 없으면) 지금과 같이 `changed=true` — **구분이 안 될 때는 보수적으로 재수집**.
- 근거: 진짜 조정은 기준일 **이전의 모든 봉**을 바꾸므로 최신 봉만 달라질 수 없다.
- 그대로 두는 것: 절대 오차 `ADJ_CLOSE_TOLERANCE`, 단위 혼입 검사(`UNIT_MISMATCH_RATIO`, 위치와 무관하게 모든 불일치에 적용 — 정착 중이라도 비율이 20배 넘으면 거부), `isFinalBar`·`FINAL_AFTER_MIN`(소비처의 `is_final` 의미 유지, C-3 은 하지 않는다).
- 보고: 수집 응답에 `adjChange.settling`(정착 중으로 처리한 건수)을 더한다.
- 한계(정직하게 남긴다): 저장된 가장 최신 봉이 잠정인 채로 다음 증분 전까지 남는 문제는 이 수정으로 해결되지 않는다 — 다음 날 증분(겹침 재기록)이 고친다. 마지막 봉의 거래량을 쓰는 소비처(P3 OOS 마지막 날 등)는 증분을 한 번 돌린 뒤에 써야 한다.

## 수정 후보 (Step C — 진단 결과로 확정, 지금은 구현하지 않음)

- **C-1 상대 오차 + 최근 봉 제외**: 비교에서 저장된 **가장 최근 K개 확정 봉**(K=2~3 거래일)을 뺀다(잠정값 정착 대기). 가장 단순하고 오탐 요인을 직접 겨냥.
- **C-2 사건 위치 판정**: 진짜 조정 사건은 날짜 **이전 전체**를 바꾸므로, 불일치가 **가장 최근 비교 봉에만** 있고 그보다 오래된 비교 봉이 모두 일치하면 "정착 중인 최신 봉"으로 보고 조정 변경으로 치지 않는다(덮어쓰기는 `write` 가 이미 한다). 정확하지만 비교 구간이 짧을수록 약해진다.
- **C-3 확정 시각 지연**: `FINAL_AFTER_MIN` 을 늘리거나 최신 봉을 N시간 뒤에야 `is_final=1` 로 쓴다. 소비처(백테스트·사후검증)의 `is_final` 의미를 바꾸므로 가장 침습적 — 마지막 수단.
- 권고(진단 전 가설): **C-2 + 상대 오차 1e-4**. 배당 조정은 보통 3e-3 이상이라 잠정값 차이(MU: 절대 0.005, 상대 5.6e-6)와 구분된다. 최종은 진단 표를 보고 정한다.

## 하지 않는 것

KIS 호출(승인 전), 나머지 76종목 수집, 운영 DB 쓰기, 주문·안전장치·화면 변경, 정기 증분 크론 등록(수정 후 별도 결정). 운영 반영(push)은 이 task 의 수정 구현이 Reviewer·QA 를 통과한 뒤 사용자 확인.

## 수용 기준 (수정 단계)

1. 진단 표가 task 에 남아 있고, 선택한 규칙이 그 표의 불일치 위치·크기를 정확히 설명한다.
2. 시험: 잠정 최신 봉 1건만 다른 경우 → `changed=false`(재수집 없음) · 조정 사건(최신이 아닌 여러 봉이 같은 비율로 다름) → `changed=true` · 단위 혼입 판정(`UNIT_MISMATCH_RATIO`)은 그대로.
3. 증분 1호출로 끝나는 정상 경로와 기존 재수집 경로의 호출 수가 시험으로 고정된다.
4. 기존 일봉 수집 시험·전체 jest·tsc 통과. 훅 감시 경로(SAFETY_PATHS) 밖이므로 Reviewer 판정은 절차상 필요하나 훅은 요구하지 않음.

## 역할 배정

Developer(Opus, 격리 worktree) → Reviewer(Sonnet) → QA(Haiku). 진단 스크립트는 Developer 가 읽기 전용으로 작성(DB `SELECT`만, KIS GET 만, `daily_bars` 쓰기 경로 import 금지). 비밀 값은 출력하지 않는다.

## 판단 기록 (judge)

- intake(rules 엔진, 10-27 16:09~16:13 사이): **R1 · developer opus · demo none · next assign**. 첫 요약에 "주문·안전장치·화면은 바뀌지 않는다"라는 부정문을 넣었더니 키워드 규칙(`R2-kw-payment`·`DM-kw-risky-cta`)이 오탐해 R2·데모 delta 로 나왔고, 해당 단어를 뺀 요약으로 다시 판정한 결과가 위 값이다(판정 도구의 키워드 오탐 — 후속 후보). 입력·출력은 세션 임시 폴더에만 있다.
- C2(rules 엔진, 10-27 Reviewer 재확인 PASS 뒤): **codex_required=false**(`CX-limit-ok`, Codex 연계 스위치 on, 개입 불필요). 입력·출력은 세션 임시 폴더에만 있다.

## 관련 과거 이력 요약

[[T-082-s02-daily-bars-universe-remaining]]: 이 오탐이 나온 실행의 상세·부작용. [[T-070-daily-bars-collector]] 계열: 증분 설계(10일 겹침 → 조정 감지 → 종목 전체 재수집). [[T-096-strategy-validation-p2-p3]]: 일봉 데이터 지문이 G1 결속에 들어가므로, 같은 미국 종목을 다시 수집하면 지문이 바뀌어 counts 재실행·G1 재기록이 필요하다. 사용한 교훈 ID: 없음.

## 진행 기록

- 2026-10-27 16:13 KST: 사용자 지시("원인 확인 및 수정 task를 먼저 생성해서 진행") → Leader 가 task 작성. 읽기 전용 증거 6항 정리(위). KIS 호출 0건. 다음: 진단 호출 승인 요청(최대 4건) → 승인되면 Developer 가 진단 스크립트 작성·실행.
- 2026-10-27 16:27: 읽기 전용 진단 스크립트 준비(세션 임시 폴더 `diag/t099-diag.py`, 저장소에 넣지 않음) — 건식으로 저장 행만 출력해 확인했고 KIS 호출은 `--call` 이 있을 때만(종목 4개·호출 4건 상한, 캐시 토큰만 사용·재발급 금지, DB 쓰기 0). 대상 4종목: NAS:MSFT(최신 봉 종가 4자리 소수 `524.9988`, 거래량 10.3M — 앞선 날 14~24M 에 비해 낮음 = 잠정 봉 의심)·NAS:AAPL(종가 2자리 `347.37`, 거래량 26.2M — 대조군)·005930·000660(국내 원인 확인). **KIS 호출 최대 4건 사용자 승인 대기.** 추가 관찰: 미국 최신 봉은 종가 모양뿐 아니라 거래량도 낮은 종목이 있어 잠정 봉 가설을 거래량 쪽에서도 확인한다.
- 2026-10-27 17:11: 진단 KIS 읽기 4건 실행(사용자 승인) → 4/4 최신 저장 봉 하나만 불일치. 설계 C-2 확정(b38e401).
- 2026-10-27 17:57: Developer 구현(Opus, 격리 worktree) → Reviewer 감사 PASS(17:37, F1 시험 공백 MEDIUM·F2~F7 LOW/INFO) → Developer 시험 2건 보완(변이 2개 사망) → Reviewer 재확인 PASS(17:49) → judge C2 Codex 불필요 → QA PASS(17:55, 결함 0) → Leader 가 4파일을 메인 트리로 옮겨 커밋(미push).

## Developer

- [10-27] 설계 C-2 그대로 구현. 작업 위치: 격리 worktree `/home/brownjeon/.node-local/stockinvest-t099`(브랜치 `fix-t099`, base `b38e401`), **미커밋**. KIS 호출·DB 쓰기·운영 접근 0. `registry/`·`backtest/`·러너 2파일·`isolation.test.ts` 는 건드리지 않았고 새 import 도 없다(훅 감시 경로 밖 — 변경 4파일 모두 `daily-bars-*`).
- 변경 파일
  - `src/lib/profit-engine/daily-bars-quality.ts` — `ADJ_SETTLING_BARS = 2`·`ADJ_SETTLING_MIN_OLDER = 3` export(근거 주석), `AdjustmentCheck.settling: number` 추가(정착 중으로 뺀 불일치 수, `changed=true` 이면 0). `detectAdjustmentChange` 는 비교 대상(확정·비 stale·비 orphan·새 응답에 같은 날짜 있음 — 기존 규칙 그대로)을 날짜 오름차순으로 정렬한 뒤, 가장 오래된 불일치 위치가 마지막 K 개 안이고 그보다 오래된 비교 봉이 3개 이상이면 `changed=false`·`settling=불일치 수`, 아니면 `changed=true`. `unitMismatch` 는 위치와 무관하게 모든 불일치에 적용(정착 중이라도 20배 넘으면 거부). `ADJ_CLOSE_TOLERANCE`·`UNIT_MISMATCH_RATIO`·`isFinalBar`·`FINAL_AFTER_MIN` 불변. 머리 주석 5번·함수 주석에 새 규칙과 한계 한 줄.
  - `src/lib/profit-engine/daily-bars-collector.ts` — `SymbolReport.adjChange` 에 `settling`(증분 칸 누적) 추가, `mismatches` 는 불일치 총수 의미 유지. `changed=false` 경로는 원래대로 `write` 만(stale 표시·재수집 없음 — 기존 upsert 는 확정 위 확정 덮어쓰기를 허용하므로 잠정 최신 봉이 새 값으로 바뀐다). 머리 주석에 규칙·한계. 라우트(`app/api/cron/daily-bars/route.ts`)는 결과를 그대로 JSON 으로 돌려주므로 타입 변경 불필요 — 손대지 않음.
  - 시험 `__tests__/daily-bars-quality.test.ts`(+13건, 17→30: 진단 재현 미국형 524.9988→524.51·국내형 213500→215500, 정렬 무관, 최신 2개(K 경계)·둘째 봉만 → false, 최신 3개·셋째 봉만·오래된 봉·최신+오래된 봉·전 봉 ×0.95 → true, 비교 봉 1~4개 → true / 5개 → false(경계), 불일치 0 → settling 0, 단위 혼입 유지, 비확정·stale·orphan 제외). 기존 2건은 반환 모양에 `settling: 0` 만 추가(필드 추가에 따른 정당한 갱신, 판정 기대값은 그대로).
  - 시험 `__tests__/daily-bars-collector.test.ts`(+3건: 미국형 저장 최신 봉만 잠정 → `calls 1`·`adjChange {compared 8, mismatches 1, settling 1}`·flags 전부 null·최신 봉이 확정값으로 덮임·겹침 밖 과거 행 불변 / 국내형 같은 흐름 / 최신 3개 1% 차이 → `['incremental','refetch']`·`calls 4`(증분 1+재수집 3) 고정·stale 해제). 기존 수집기 시험 45건은 수정 없이 통과(기존 조정 시험은 10-21 이전 전체를 바꾸므로 새 규칙에서도 재수집).
- 시험 결과: `tsc --noEmit` 0 · `jest src/lib/profit-engine` 14 suites / **542 통과** · 전체 `jest --silent` 292 suites 통과(4 skipped) / **7790 통과**·149 skipped·실패 0.
- 변이 점검(두 시험 파일 78건 기준, 매번 원본 복구·cmp 확인): K=3 → 5건 실패 · K=1 → 4 · 최소 오래된 봉 2 → 2 · 4 → 2 · 위치 판정 제거 → 8 · 위치를 가장 최신 불일치로 잘못 잡기 → 8 · 정착 중도 changed=true(옛 동작) → 9 · 날짜 정렬 제거 → 1 · 수집기가 settling 에도 재수집 → 2 · settling 누적 누락 → 2. 살아남은 변이 없음.
- 한계(설계대로 남김): 저장된 가장 최신 봉(종가·거래량)이 다음 증분 전까지 잠정인 문제는 해결하지 않는다 — 다음 날 증분의 겹침 재기록이 고친다. 마지막 봉의 거래량을 쓰는 소비처(P3 OOS 마지막 날 등)는 증분을 한 번 돌린 뒤 써야 한다. 비교 봉이 4개 이하(상장 직후·짧은 겹침)면 보수적으로 재수집한다(기존 동작).
- 설계와 다르게 한 점: 없음. (`settling` 은 지시의 "건수 또는 목록" 중 **건수**로 했다 — 날짜는 기존 `mismatches` 목록에 이미 있다.)
- [10-27] Reviewer F1·F5 보완(**시험만 추가, 코드 2파일 무변경**).
  - F1: `daily-bars-collector.test.ts` 의 `(R-1)` 묶음에 2건 추가(`(T-1) 한 실행 안에서 여러 칸` 시험 기반, 14개월 빈틈 4칸). ① 첫 칸 겹침의 최신 저장 봉(2025-08-20)만 잠정값 → `modes ['incremental']`·`calls 4`·요청 endDate 4칸 고정·`adjChange {compared 34, mismatches 1, settling 1}`·flags 전부 null·08-20 이 확정값으로 덮임·저장 MAX 2026-10-21 도달·빈틈 0. ② 첫 칸(08-20 저장 잠정) + 둘째 칸(첫 칸 응답의 최신 봉 2025-12-18 만 잠정으로 줌 → 둘째 칸이 확정값으로 다시 받음) → `adjChange {compared 34, mismatches 2, settling 2}`·재수집 없음·12-18 확정값·MAX 도달.
  - F1 변이 점검(두 파일 80건 기준, 매번 원본 복구·cmp 확인): "정착 중이면 칸 루프 중단"(`if (end === null || adj.settling > 0) break;`) → **2건 실패**(새 시험 ①②) · "settling 칸마다 덮어쓰기"(`settling = adj.settling`) → **2건 실패**(새 시험 ①② — ①은 마지막 칸 0 으로 덮여 1≠0). 두 변이 모두 죽는다.
  - F5 정정: 앞 기록의 "quality +14건"은 틀렸다 — 실제 +13(17→30). 최종 수치: quality 30건(+13) · collector 50건(45→50, +5 = 처음 3 + F1 2) · 두 파일 합 80건(62→80, +18).
  - 검증(보완 후): `tsc --noEmit` 0 · `jest src/lib/profit-engine` 14 suites / **544 통과**(542 + 2). 전체 jest 재실행은 생략(지시대로).

## Reviewer

### Reviewer 감사 (10-27)

- [17:37] 1. 의도 충족: 구현이 설계 C-2 와 일치한다. K=2·최소 오래된 봉 3(`olderCount = compared − K`, `olderCount >= 3 && oldestMismatchIdx >= olderCount` → 비교 봉 5개부터 정착 판정, 최신 K 개 안이면 경계 포함)이고, 비교 봉은 날짜 오름차순으로 정렬해 판정하며, `settling` 은 `changed=true` 이면 0, `mismatches` 는 불일치 총수이고, 단위 혼입은 모든 불일치에 위치와 무관하게 적용된다. 반례 탐색은 코드 추론과 탐침 테스트(변이용 worktree 의 임시 파일, 이미 제거)로 했다. 진짜 조정은 기준일 이전 모든 봉을 바꾸므로 보이는 조정이면 가장 오래된 비교 봉(idx 0)이 어긋나 `changed=true` 가 된다. 확인한 입력: ex-date 가 최신 봉·둘째·셋째 최신·중간·앞쪽·둘째 오래된 봉·미저장 새 봉인 경우와 0.01% 소폭 조정이 전부 `changed=true`, 비교 봉 1~4개는 보수적 `changed=true`, 비교 봉 2개(최신 2개만 겹침)도 `changed=true`. 현실 입력에서 진짜 조정이 정착 중으로 오분류되는 경우는 찾지 못했다. 예외는 이론적인 정수 반올림 한 가지다(발견 F3).
- [17:37] 2. 수집기 통합: `changed=false` 이면 stale 표시·재수집 없이 `write(r, false)` 만 한다(`daily-bars-collector.ts:358-365`). `DAILY_BARS_UPSERT_SQL` 은 `IF(is_final = 1 AND VALUES(is_final) = 0, c, VALUES(c))` 라 확정 위 확정은 덮어쓰고, `is_final = GREATEST(...)` 는 맨 끝에 있다. 탐침 실측으로 잠정 최신 봉이 새 종가·거래량·`flags=null`·`is_final=1`·새 `fetched_at` 으로 덮이고 같은 날 재실행은 호출 0 임을 확인했다. 칸별 판정은 칸마다 `detectAdjustmentChange` 를 부르는 단위이고 `compared`·`mismatches`·`settling` 은 칸 누적이다. 14개월 빈틈 + 첫 칸 겹침의 최신 저장 봉만 잠정인 탐침은 `modes ['incremental']`·`calls 4`·`adjChange {compared 34, mismatches 1, settling 1}` 이었다. 단위 혼입 검사는 `changed` 판정보다 앞이라 정착 중이어도 거부된다(탐침 통과). `detectAdjustmentChange`·`adjChange` 의 사용처는 `daily-bars-collector.ts` 와 시험뿐이고, 라우트는 결과를 그대로 JSON 으로 돌려준다(`src/app/api/cron/daily-bars/route.ts:48-51`). `scripts/`·`src/app/` 에 다른 호출처는 없다(grep 전수). 라우트 시험 24건 통과.
- [17:37] 3. 시험 품질: 직접 변이 24개를 변이용 worktree 복사본에서 돌렸다. 두 시험 파일 78건 기준이고 매번 원본 복구 후 `cmp` 로 확인했다. 22개는 죽었다: K=3·K=1·최소 오래된 봉 2·4·위치 판정 제거·경계 off-by-one ±1·`>` 경계·`settling` 미집계·정렬 제거·가장 최근 불일치 위치 사용·stale/orphan/비확정 필터 제거·단위 혼입 무시·정착 중도 `changed=true`·`compared` 계산 변경·수집기 `settling` 에도 재수집·수집기 `settling` 누적 누락(최종 보고 쪽)·`mismatches` 변형·정착 중 `write` 생략·단위 혼입 검사 순서 변경. 2개는 살았다(발견 F1). 가짜 DB 는 코드의 실제 upsert SQL 을 `UpsertSim` 으로 해석하므로 SQL 경로를 가린 곳은 없다. 다만 SQL 자체는 실제 MariaDB 가 아니라 시뮬레이터가 해석한다. 이 점은 코드 읽기로 보완했다.
- [17:37] 4. 기존 동작 보존: 정상 증분(불일치 0)·진짜 조정(전 봉 변경)·단위 혼입·비확정/stale/orphan 제외는 그대로다. 기존 수집기 시험 45건은 수정 없이 통과했고 기존 품질 시험 2건은 `settling: 0` 필드 추가만 바뀌었다. 금지 경로(`registry/`·`backtest/`·`scripts/profit-engine/`·`isolation.test.ts`) diff 는 0줄이고 `isolation.test.ts` 는 통과한다. 소스 두 파일에 새 import 는 없다(diff 에 import 줄 변경 없음). 변경은 4파일이다.
- [17:37] 5. 검증 재실행: `tsc --noEmit` 은 증분·비증분(`--incremental false`) 모두 에러 0이다. `jest src/lib/profit-engine` 은 14 suites / 542 통과(Developer 보고와 일치), `jest src/app/api/cron/daily-bars` 는 2 suites / 24 통과다. 전체 jest 7790 은 재실행하지 않았다(변경 4파일이 `src/lib/profit-engine/daily-bars-*` 에 한정되고 외부 호출처가 없음을 grep 으로 확인).
- [17:37] 6. 서술·정직성: 머리 주석·함수 주석·`SymbolReport` 주석은 코드와 맞고 한계(다음 증분 전까지 잠정 지속, 마지막 봉 거래량 소비처는 증분 1회 뒤 사용)를 정직하게 적었다. 비밀 값은 없다. 낡거나 과장된 서술은 작은 건 하나뿐이다(발견 F5). 짧은 겹침 한계는 적혀 있으나 긴 연휴 사례는 빠져 있다(발견 F2).
- [17:37] 발견 사항: 차단 사항(Critical·High) 없음. F1 (MEDIUM, 시험 공백, 비차단): 다중 칸 루프 + 정착 중 경로가 시험으로 고정돼 있지 않다. 변이 `settling 이면 칸 루프 중단` 과 `settling 을 칸마다 덮어쓰기(누적 아님)` 가 78건을 전부 통과했다. 코드는 올바르다(위 2번의 탐침). 권고: 14개월 빈틈 시험(`(T-1) 한 실행 안에서 여러 칸`)에 첫 칸 겹침의 최신 저장 봉만 잠정으로 바꾼 변형을 더해 `modes ['incremental']`·`calls 4`·`adjChange.settling 1`·stale 없음을 고정할 것. 루프 중단 회귀는 `status 'done'` 인 채 최신 구간이 덜 모이고 다음 실행이 이어 받아 자가 복구되므로 위험은 낮다. F2 (LOW, 효과 한계): 비교 봉이 5개 미만이면 보수적으로 재수집한다. 겹침 창(10 달력일)은 평소 7~9 봉이지만 국내 설·추석 같은 긴 연휴 직후 며칠은 3~4 봉으로 줄어 오탐 비용(종목당 9호출)이 되돌아올 수 있다. 안전한 방향이고 비용만 든다. 정기 증분을 켤 때 그 주를 감안할 것. F3 (LOW, 이론적, 조치 불필요): 국내 정수 종가에서 0.005% 안팎의 극소 조정은 가격이 높은 최신 봉만 1원 어긋나 정착 중으로 분류될 수 있다(탐침: 9,000~10,000원대·계수 1−0.5/9,900 → settling 2). 앞선 봉이 반올림으로 같아지는 크기라 안 고쳐진 과거 봉의 오차는 0.5원 미만(약 0.005%)이다. F4 (LOW, 관찰성): 정착 중으로 덮은 차이는 건수만 보고되고 크기·날짜는 남지 않는다. 20배 미만의 큰 차이도 위치만 맞으면 조용히 덮인다. 진단 근거는 약 0.1%·약 1% 였다. 선택 권고: 보고나 로그에 정착 중 최대 상대 차이 한 값을 더할 것. F5 (LOW, 문서): Developer 기록의 "quality 시험 +14건" 은 실제 +13건이다(17→30, 두 파일 합 62→78 = +16 = 13+3). F6 (INFO): ex-date 가 겹침 창의 첫 봉 이하이면 불일치가 0 이라 조정을 못 보는 사각지대는 이번 변경 이전부터 있었고 넓어지지 않았다. F7 (INFO, Leader 판단): 이 수정 배포 뒤 첫 증분이 10-23 봉(P3 OOS 마지막 날, as-of 2026-10-23)을 확정값으로 덮으므로, 증분을 돌리는 시점이 T-096 일봉 데이터 지문·OOS 입력과 어긋나지 않게 맞춰야 한다.
- [17:37] **최종 판정: PASS (scope: src/lib/profit-engine/daily-bars-quality.ts, src/lib/profit-engine/daily-bars-collector.ts, src/lib/profit-engine/__tests__/daily-bars-quality.test.ts, src/lib/profit-engine/__tests__/daily-bars-collector.test.ts)**
- [17:49] 재확인(F1·F5 보완): ① 소스 두 파일 무변경 확인 — git blob 해시가 첫 감사 때 diff 의 `index` 줄과 같다(`daily-bars-quality.ts` 18ba361, `daily-bars-collector.ts` f1a3446, diff 줄 수도 11·53 동일). 수정 시각은 collector 가 17:40 으로 첫 감사 뒤이나 내용은 같다. ② 변이용 worktree 를 다시 만들어 변이 10개를 돌렸다(80건 기준, 매번 복구 후 `cmp`). 첫 감사에서 살아남은 두 변이 "정착 중이면 칸 루프 중단"·"settling 을 칸마다 덮어쓰기"가 새 시험 2건에 각각 2건 실패로 죽는다. 추가 변이도 모두 죽었다: 보고값만 현재 칸 값·`mismatches` 비누적·`compared` 비누적·정착 중 stale 표시·칸 전진 제거·정착 중 `write` 생략·K=3·위치 판정 제거. ③ 새 시험 값은 시나리오에서 독립적으로 유도된다. 요청 endDate 4칸은 기존 `(T-1)` 시험과 같고 `compared 34` 는 칸별 겹침 8+9+9+8 로 계산이 맞다. 시험 ②는 첫 칸 응답 최신 봉(2025-12-18)만 잠정으로 주고 둘째 칸의 재수신 불일치를 `settling 2` 로 세므로 구현을 되풀이하는 동어반복이 아니다. 단언 대상도 `modes`·`calls`·`adjChange`·stale 없음·덮인 종가·MAX 2026-10-21 도달·빈틈 0 이다. ④ `tsc --noEmit` 은 증분·비증분 모두 0 이고 `jest src/lib/profit-engine` 은 14 suites / 544 통과다. ⑤ F5 정정 수치는 실제와 같다: quality 17→30(+13), collector 45→50(+5), 두 파일 합 62→80. 새 발견 사항은 없다. 변이용 worktree 와 임시 스크립트는 제거했고 원본 worktree 는 변경하지 않았다.
- [17:49] **최종 판정: PASS (scope: src/lib/profit-engine/daily-bars-quality.ts, src/lib/profit-engine/daily-bars-collector.ts, src/lib/profit-engine/__tests__/daily-bars-quality.test.ts, src/lib/profit-engine/__tests__/daily-bars-collector.test.ts)**

## QA

- [17:55] QA 실행 검증(Haiku 역할, 전부 직접 실행) — 대상: worktree `/home/brownjeon/.node-local/stockinvest-t099`(브랜치 `fix-t099`, base `b38e401`, 미커밋 4파일). KIS 호출 0·DB 쓰기 0·운영 접근 0·코드 수정 0(임시 시험 파일만 만들고 삭제). NFS noexec 이라 node 는 로컬 디스크 worktree 에서 실행.
- [17:55] 항목1 전체 회귀: `tsc --noEmit` 오류 0(증분·`--incremental false` 둘 다 exit 0). `jest --silent` 전체 **292 스위트 통과(4 skipped) / 7,792 통과 / 149 skipped / 실패 0**, 169.6초, exit 0. 수치 설명: push 직전 기준 7,600 통과·287 스위트 + 이번 T-099 시험 +18(품질 +13·수집기 +5) + T-097 계열 시험 ≈174 = 7,792 이고(7,600+18 = 7,618, 7,792−7,618 = 174), 스위트도 287+5 = 292 로 맞는다. Developer 보고의 7,790 에 F1 보완 +2 가 더해진 값과도 같다. 이상한 수치 없음.
- [17:55] 항목2 변경 범위: `git status --short` = 수정 4파일(`src/lib/profit-engine/daily-bars-quality.ts`·`daily-bars-collector.ts`·`__tests__/daily-bars-quality.test.ts`·`__tests__/daily-bars-collector.test.ts`) + 기존 `node_modules` 심볼릭 링크(비추적, 변경 아님)뿐. `git diff --stat` 4 files, 266 insertions(+), 17 deletions(-). 금지 경로(`registry/`·`backtest/`·`scripts/profit-engine`·`isolation.test.ts`) diff 0줄. `git diff` 의 `^[+-]import|from|require` 줄 0건 — 새 import 없음.
- [17:55] 항목3 진단 재현(독립 작성 `zz-qa-t099.test.ts`, 13건 전부 통과, 실행 후 삭제). 입력은 진단 수치(비교 봉 10-13~10-23 9개 + 새 쪽 미저장 10-26 봉):

  | 시나리오 | 입력 | 실제 결과 | 기대 |
  |---|---|---|---|
  | (가) 미국형 | 최신 10-23 만 524.9988→524.51, 나머지 8개 동일 | changed=false · settling=1 · compared=9 · mismatches 1건 | 일치 |
  | (나) 국내형 | 최신 10-23 만 213500→215500 | changed=false · settling=1 · compared=9 · mismatches 1건 | 일치 |
  | (다) 최신 3개 다름 | 10-21·22·23 | changed=true · settling=0 · mismatches 3 | 일치 |
  | (라) 둘째(오래된) 봉만 다름 | 10-14 | changed=true · settling=0 | 일치 |
  | (마) 전 봉 ×0.95 | 9개 전부 | changed=true · mismatches 9 · unitMismatch=false | 일치 |
  | (바) 비교 봉 4개 + 최신 1개만 다름 | compared=4 | changed=true · settling=0 | 일치(보수적) |
  | (사) 최신 봉 ×25(및 ÷25) | 정착 위치지만 20배 초과 | unitMismatch=true(양방향) | 일치 |
  | (아) 불일치 0 | 전부 동일 | `{compared 9, mismatches [], changed false, settling 0, unitMismatch false}` | 일치 |
  | 추가 | 비교 봉 5개: 최신 1개·최신 2개 → changed=false(settling 1·2), 최신 3개 → true / 최신+가장 오래된 봉 → true / 둘째 최신(10-22)만 → false / 셋째 최신(10-21)만 → true / 입력 순서 뒤섞임 → 날짜순 판정 / 최신 봉이 미확정·adj_stale·adj_orphan 이면 비교 8·changed=false | 전부 기대대로 | 일치 |

- [17:55] 항목4 수집기 end-to-end(독립 작성 `zz-qa-t099-e2e.test.ts`, 가짜 DB `fake-bars-db.ts`, 4건 전부 통과, 실행 후 삭제). ① 미국(NAS:MSFT 1년 백필 후 저장 최신 봉 10-21 의 종가 +0.49·거래량 ×0.6 을 잠정값으로 심고 10-23 까지 증분): `modes ['incremental']` · `calls 1`(요청 1건) · `status done` · `adjChange {compared 8, mismatches 1, settling 1}` · `flags` 있는 행 0(adj_stale 없음) · 10-21 봉의 종가·거래량 둘 다 확정값으로 덮임·`is_final=1` · 마지막 행 10-23. ② 진짜 조정(10-21 이하 전 봉 ×0.9): `modes ['incremental','refetch']` · settling 0 · mismatches ≥3 · calls >1 · done · stale 표시 0 · 최근 구간 저장 종가가 새(조정) 데이터와 전부 일치. ③ 정착 위치여도 최신 저장 봉 ×30: `status failed`, 오류 `unit_mismatch`, 저장 행(날짜·종가·flags) 불변. ④ 국내(000660): 저장 최신 봉(10-22) 종가 −14,000 → `['incremental']` · calls 1 · `{mismatches 1, settling 1}` · 표시 없음 · 확정값으로 덮임.
- [17:55] 항목5 G1 무효화 없음: `backtest-runner.mjs --phase counts --market US --strategy all --as-of 2026-10-23`(읽기 전용 SELECT) exit 0, 생성 json 의 `head.fingerprints` — `engine` = `engine-78a3ef6b29365b1d26d821169ac7109e7be5da05816f2ce26b1a2e7fcac59592`(G1 기록과 일치) · `data` = `{until 2025-09-30, rows 27141, sha256 9e4c2460cdf5667ba3f9bbec5635cc1e9e621b4c9ddbf6e3605929f9fff6f245}`(G1 근거와 일치) · `universe` = `{n 50, sha256 c796de8cf06ea454d854ea89a19bdce4408c5b8805b5e24c4929bddda97ab854}`(일치) · `registryFull`·`registryNumeric` 일치 · `hashOk`·`numericOk` true · `result` 전체가 G1 근거 리포트 `T-096-backtest-counts-US-20261027-r2.json` 과 바이트 수준 구조 동일. 생성한 `-qa099` 파일 2개는 삭제(재확인 0개). 엔진 지문 대상에 `daily-bars-*` 가 없어 이 변경은 엔진 지문에 닿지 않는다는 점도 결과로 확인.
- [17:55] 항목6 새 시험 점검: jest 로 센 두 파일 합 80건(품질 30·수집기 50, Developer 보고와 같음). 정규식 스캔: 품질 30선언, 수집기 45선언(일반 43 + `test.each` 2선언이 5+2 = 7건으로 확장 → 43+7 = 50)을 전부 훑어 `expect` 없는 시험은 0개. 단언은 정확 값(`toEqual`/`toMatchObject`)이며 구현 식을 되풀이하지 않고 진단 수치·시나리오에서 독립 도출한다(예: `compared 34 = 8+9+9+8`, 요청 endDate 4칸 고정). 가짜 DB 가 실제 upsert SQL 을 `UpsertSim` 으로 해석한다. 관찰(낮음, 비차단): ⓐ `상수: K=2, 오래된 일치 봉 최소 3` 시험은 상수 값만 고정하는 시험이라 동작 검증은 아니지만 값 변경을 의도적 변경으로 강제하는 용도로 타당하다. ⓑ 가짜 DB 는 실제 MariaDB 가 아니라 시뮬레이터라 SQL 의 `GREATEST/IF` 가 실DB 에서 같이 동작하는지는 코드 읽기(Reviewer)에만 의존한다.
- [17:55] 항목7 비밀 값 grep: 변경 4파일의 diff 추가 줄 + 임시 시험 2개에서 `api_key|secret|token|password|appkey|bearer|authorization|40자 이상 영숫자|mysql://|BEGIN` 검색 — 비밀 값 0건(임시 e2e 의 한국어 mock 오류 문구 "토큰 조회 금지" 1건만 단어 일치, 비밀 아님).
- [17:55] 정리: 임시 시험 2개(`zz-qa-t099.test.ts`·`zz-qa-t099-e2e.test.ts`)를 worktree 와 scratchpad 양쪽에서 삭제했고 `git status --short` 가 다시 4파일 + `node_modules` 뿐임을 확인. 안전장치(DRY_RUN·Kill Switch·주문 한도·주문 경로)는 이 변경 4파일이 닿지 않는 영역이라 해당 체크리스트는 대상 아님(`submitOrder`·`safety/`·`exchanges/` diff 0).
- [17:55] QA 가 확인하지 못한 것: 실제 MariaDB 에서의 upsert 동작(가짜 DB 시뮬레이터), 실제 KIS 응답에서 정착 중 불일치가 언제까지 이어지는지(진단 4종목·1시점만 관측 — 설계 문서가 한계로 적음), 배포 후 첫 정기 증분의 실제 호출 수. 한계(설계대로): 저장된 가장 최신 봉이 다음 증분 전까지 잠정인 채로 남는다 — 마지막 봉의 거래량을 쓰는 소비처는 증분 1회 뒤에 쓸 것(Reviewer F7: 이 수정 배포 뒤 첫 증분이 10-23 봉을 덮으므로 T-096 일봉 지문·OOS 입력과 시점을 맞춰야 한다).
- [17:55] **QA 판정: PASS**

## 배포 기록

- **배포됨(사용자 지시 "T-099과 T-096에 대한 커밋 및 푸시 진행해주고…").** 2026-10-27 18:51 push `cae9f80..c9ab4ca`(9커밋) → 릴리스 `20261027-185125-c9ab4ca4` `RELEASE_RESULT ok`, migrated=false. 배포 후: pm2 stockinvest·stockinvest-cron 각 1(cron 1행)·재시작 0, `/api/health` 200, 앱·cron 로그 예외 없음, 킬스위치 ON, 주문 id 3229 불변, system_config 87키 불변. push 직전 최종 HEAD(`c9ab4ca`) tsc 0·전체 jest 292 스위트 7,792 통과·실패 0. 수집 라우트가 다음에 실행될 때부터 새 판정이 적용된다(정기 증분 크론은 등록돼 있지 않다). `adjChange` 응답에 `settling` 필드가 추가된다(앱 화면·주문·안전장치와 무관).

## 최종 요약

### [T-099] 일봉 증분 수집의 조정 오탐 — 원인 확인 후 수정 (사용자용)

- **상태**: ✅ 완료·배포(릴리스 `20261027-185125-c9ab4ca4`)
- **무엇이 바뀌었나**: 증분 수집이 "조정 기준이 바뀌었다"고 잘못 판정해 종목 전체를 다시 받던 오탐을 고쳤다. 이제 겹친 구간에서 불일치가 가장 최근 봉 2개 안에만 있고 그보다 오래된 비교 봉 3개 이상이 전부 일치하면 잠정 최신 봉으로 보고 재수집하지 않는다. 그 밖은 지금처럼 재수집하고, 단위 혼입(20배 초과)은 위치와 무관하게 거부한다. 수집 응답에 `settling` 건수가 추가된다.
- **원인(확인됨)**: 마감 직후 저장한 최신 봉이 잠정값이었다. KIS 실응답 진단(4종목 4/4)에서 불일치는 저장된 가장 최신 봉(10-23) 하나뿐이고 더 오래된 8개 봉은 소수점 끝까지 일치했다. 미국은 종가 약 0.1%·거래량 +33~51% 가, 국내는 종가 약 1%(거래량 동일)가 나중에 바뀌었다. 허용 오차로는 막을 수 없는 크기라 위치로 판정한다. 국내 쪽 기전(왜 종가만 바뀌는지)은 미확인이지만 수정에는 필요하지 않다.
- **AI 가 검증한 것**: Reviewer 독립 감사 2회 PASS(변이 점검 24개 중 22개 사망 + 보완 후 남은 2개도 사망, 진짜 조정을 정착 중으로 오분류하는 입력은 찾지 못함), judge C2 Codex 불필요, QA 직접 실행 PASS(전체 jest 292 스위트 7,792 통과·실패 0, 진단 수치 재현 13건, 수집기 end-to-end 4건, G1 엔진·데이터 지문 불변 확인).
- **AI 가 못 한 것**: 실제 MariaDB 에서의 upsert(가짜 DB 시뮬레이터만), 배포 뒤 첫 정기 증분의 실제 호출 수, KIS 에서 잠정 상태가 언제까지 이어지는지(진단은 4종목·1시점).
- **👉 사용자가 결정할 것**: ① (해소: 10-27 18:51 push·배포 완료) ② 나머지 76종목(+055550) 수집 재개 시점·KIS 호출 승인(약 80~90호출 예상 [추측]: 증분 1호출/종목 + 055550 마무리 재수집 몇 호출 — 오탐이 없다면. 이전 계획의 약 700호출이 아님). 권고: P3 OOS 를 하기 전에 수집을 한 번 돌려 10-23 최신 봉(잠정)을 확정값으로 덮는다.
- **남은 일**: 정기 증분 크론 등록 여부 결정, 비교 봉 5개 미만(긴 연휴 직후)에서는 보수적으로 재수집하는 비용 한계(F2), 정착 중으로 덮은 차이의 크기 보고(F4, 선택).
- **이슈·위험**: 가장 최신 저장 봉은 다음 증분 전까지 잠정인 채 남는다(수정이 못 고치는 부분). 같은 미국 종목을 다시 수집해 2025-09-30 이하 봉이 바뀌면 T-096 IS 가 거부되고 G1 재기록이 필요하다 — 이 수정은 그런 재수집을 줄일 뿐 없애지는 않는다.

