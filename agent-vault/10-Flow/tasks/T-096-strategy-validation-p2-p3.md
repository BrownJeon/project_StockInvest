---
task_id: T-096
title: 전략 검증 줄기 P2(합격 기준 사전 등록)+P3(일봉 백테스트) — 설계·사전 등록 초안 먼저, 결과 실행은 기준 확정 뒤
status: doing
priority: high
project: StockInvest
created: 2026-10-26
updated: 2026-10-26
base_ref: 53b97d9
risk_level: R1
roles_involved: [leader, judge, analyst, developer, reviewer, qa]
related_tasks: [T-070-daily-bars-phase0, T-064-profit-engine-design, T-072-validation-gate, T-095-postmortem-script-p1]
tags:
  - type/task
  - domain/profit-engine
  - domain/validation
aliases:
  - 전략검증P2P3
  - 사전등록
waiting: [G1 — M1+M2(S1·S7) Reviewer 통과 뒤 --counts-only 로 표본 충족 확인, ETF 2종목 일봉 수집(U9 선행), S1 IS 결과 보고 뒤 S2·S4 구현 여부 사용자 결정]
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

# T-096 전략 검증 줄기 — P2 사전 등록 + P3 일봉 백테스트

## 사용자 결정 (2026-10-26 오후, 발화 그대로)

- "P2: 어떤 사용자 등록이 필요해?" → **질문**이다. Leader 해석: "사전 등록"을 "사용자 등록"으로 읽으신 것 같다. P2 = **합격 기준을 결과를 보기 *전에* 파일로 고정(사전 등록)** 하는 것이지 계정·사용자 등록이 아니다. 사용자가 할 일은 초안의 기준(몇 개의 숫자·규칙)을 읽고 확정하는 것뿐이다 — 채팅 답변과 초안 문서 맨 위 요약에 쉬운 말로 적는다.
- "P3: 승인할테니 백테스트 진행해줘" → **P3 착수 승인.** 단 Leader 판단으로 **순서를 지킨다**: ① 백테스트 **엔진 설계·구현은 지금 시작**한다 ② **결과를 보는 실행(전략 합격/불합격을 가르는 실행)은 P2 합격 기준이 사용자 확정을 받은 뒤**에 한다. 근거: 기준을 결과 본 뒤에 정하면 같은 데이터로 사후 합리화·과적합이 된다 — T-064 §6.5 "사전 등록: 실행 전에 전략별 가설·파라미터 그리드·합격 기준을 파일로 고정"과 T-064 §5.5 "(생존편향 규칙) 반영 전에는 합격 기준(D4)을 확정하지 않는다"가 이미 요구한다. 사용자가 이 순서에 반대하면(예: 기준 확정 전에 탐색 실행) 위험(과적합·확증 편향)을 명시하고 지시대로 한다.

## 범위

- **P2(문서)**: [[T-064-profit-engine-design]] §6.5·§6.6(합격 기준 D4·벤치마크 상대 조건·생존편향 할인)과 [[T-070-daily-bars-phase0]] Analyst 검토(§2 rsi-oversold 평가 규칙·§4 P2)를 합쳐 **합격 기준 사전 등록 문서**를 만든다: 지표·기준선·표본 조건·파라미터 상한·결정일·실패 시 규칙. 비전문가가 읽는 5줄 요약 + 사용자가 확정할 항목 표(권고값 포함)를 맨 위에.
- **P3(구현)**: T-064 Phase 2 — 코드 스크리너 + 3년·93종목 일봉 백테스트(§6.1 백테스트=라이브 동일 코드, §6.2 구성, §6.3 체결 모델, §6.4 비용, §6.5 과적합 통제). 후보 전략 전부(일봉 아날로그 포함), 비용 후·기준선 대비. 소유: `src/lib/profit-engine/`(신규, 기존 `src/lib/research/` 와 분리) 등 — Analyst 설계 뒤 확정.
- 이 task 의 1단계는 **Analyst 설계**(사전 등록 초안 + P3 구현 명세 + 규모·토큰 추정). 구현(Developer)은 그 명세를 사용자가 본 뒤.

## 하지 않는 것

기준 확정 전 합격/불합격을 가르는 백테스트 실행, 전략 활성/비활성·승급(`validation_status` 변경) 결정, DB 쓰기·DDL·KIS 호출·앱 API 호출·주문·알림·스위치 변경, push·배포. 읽기 전용 DB 조회(SELECT)만.

## 허용 권한

읽기 전용 DB 조회와 로컬 작업 트리 문서 편집. Analyst 는 `docs/design/` 아래 새 문서만 쓴다.

## 판단 기록 (judge)

## 관련 과거 이력 요약

- [[T-070-daily-bars-phase0]]: `daily_bars` 70,965행·93종목, 사후검증 v1, Analyst 검토(10-24) P1~P5.
- [[T-072-validation-gate]]: 전략 16개 전부 `unvalidated` → 신규 매수 차단. 승급 조건이 P2 와 같은 자리.
- [[T-095-postmortem-script-p1]]: P1(사후검증 도구 보강) 진행 중 — 지표 정의(환율 무관 진입·같은 날 유니버스 초과수익)를 P2 가 같게 쓴다.
- 사용한 교훈 ID: 없음.

## 진행 기록

- 2026-10-26 15:53: Leader 착수. Analyst 설계 투입(사전 등록 초안 + P3 구현 명세).

## Analyst

- [15:55] 착수(Fable, 읽기 전용). 읽은 것: `analyst.md` 역할 · 이 task · [[T-064-profit-engine-design]] 전체(§5.5·§6.1~6.7·§7·§14 D4·D19) · [[T-070-daily-bars-phase0]] `## Analyst 검토(10-24)` 전체 + Developer/Reviewer 기록 · [[T-072-validation-gate]] 상단~설계 확정·후속 승급 선행 조건·`validation_status` 관련 줄 · [[T-095-postmortem-script-p1]] 전체 · `docs/trading-strategy.md` · 통합 절차서 §7~§9(C09) · `src/lib/strategy/backtest.ts` 구조·`rules/` 7개 조건·`indicators/` export·`style.ts` 기본값 · `isolation.test.ts` 허용목록·needle · 커밋 훅 `SAFETY_PATHS` · `docs/db-schema.md` `paper_fills` 표. 실행: 읽기 전용 DB 조회 **6건**(strategies 16행·daily_bars 시장별/종목별 커버리지·paper_fills 건수·안전 스위치 4키·`style_default_*` 9키 — SELECT 만, 비밀 키 제외). **후보 전략의 수익률·초과수익을 계산하는 질의는 실행하지 않았다**(사전 등록 무결성). DB 쓰기·KIS·앱 API·LLM 호출·커밋 0. T-095 worktree 는 건드리지 않음.
- [16:08] 산출물: `docs/design/2026-10-26-strategy-validation-preregistration.md`(초안 v0.1) — §A 5줄 요약 + **사용자 확정 항목 U1~U14** + Analyst 기본값 표 / §B 사전 등록 본문(데이터 실측·후보 10개 Tier A 3(S1 rsi-oversold 일봉판·S2 추세 눌림목·S4 횡단면 모멘텀)+대조군+Tier B 6·총 시행 N US 78(국내 포함 156)·IS 2024-02~2025-09/OOS 2025-10-01~2026-10-23 잠금·체결 d1open 판정+§6.3 지정가 민감도·비용 US 0.65/0.75·KR 0.33/0.43+슬리피지 ×1.5 조건·같은 날 유니버스 기준선+지수 ETF δ 할인·합격 조건 1차(거래)·2차(포트폴리오) 수치표·고원 선택·실패 규칙·결정일 2026-12-07·T-072 승급 연결·rsi-oversold-v1 평가 규칙·버전 동결 선언) / §C P3 구현 명세(모듈·시그니처·백테스트=라이브 동일 코드·흐름·시험 계획·안전 경로·M1~M4 수용 기준) / §D 규모(코드+시험 약 4.5k~6.8k 줄, 토큰 300~670만 `[추측]`, 실행 비용 LLM 0·DB 읽기 1회, go/no-go G0~G3) / §E 위험(약한 가정 3개 먼저·"엣지 없음" 확률 55~75% `[추측]`·그때 선택지 4개·확인 못 한 것).
- [16:08] 이전 Analyst 검토(10-24)와 달라진 점·정정: ① 라이브 `rsi-oversold-v1` 임계값은 코드 기본 35 가 아니라 DB `style_default_rsiBuyThreshold`=**38**(T-072 기록과 일치) — 일봉판 격자에 38 포함 ② T-064 "연도별 4개 중 3개 흑자"는 3년 데이터라 불가 → "IS 내부 3폴드 중 2개 양(+)"로 대체 ③ T-064 표본 ≥200/≥100·기여 ≥30종목은 ≥150종목 유니버스 전제라 93종목에 비례 축소(≥150/≥80·≥15/≥10) ④ 통합 절차서 C09 제안("가설 1~2개+대조군")과 T-070 P3("후보 전부")를 2층(Tier A 판정·Tier B 보고)으로 절충 ⑤ 다중비교 t 임계를 N≤100 이면 2.5 로(T-064 는 N≥100 에서 3.0 만 정의) — 격자 폭을 24 로 줄인 대가.
- [16:08] Leader 가 정할 것(사용자 결정 아님): (a) `isolation.test.ts` needle `'@/lib/strategy'` 를 `strategy/indicators/*` 5개 모듈 허용목록으로 좁히는 변경 승인 여부(아니면 지표 복제+패리티) (b) ETF 2종목(`SPY`·`069500`) 일봉 수집 실행(오프아워, T-070 라우트, KIS 약 16호출) — U9 선행 조건 (c) 20-Log 한 줄 기록은 Leader 지시(쓰는 파일 2개 제한)에 따라 남기지 않았다 (d) 통합 절차서 C09 상태 갱신. **확인 못 한 것**: KIS ETF 수집 가능 여부·거래소 코드, 국내 현행 거래세 구성, rsi-oversold 라이브 봉 간격(30m/1h), 각 전략의 실제 발화 빈도(의도적으로 미계산 — G1 `counts` 모드로 확인).

### 사용자 확정·동결 (18:43 기록)

- 사용자 발화 그대로: "2. P3 직압 진행해줘"(같은 메시지: "위에 작업 후에 다음작업도 진행해줘"). Leader 해석: 직전 보고가 요청한 네 가지(U1~U14 확정·1단계 먼저·지표 재사용 허용 목록·ETF 일봉 수집)를 **전부 권고대로** 승인("직압"=즉시로 해석). 근거와 한계는 동결 문서의 "확정 기록" 절. **이 해석은 되돌리기 쉬운 쪽(결과 실행 전이면 새 메이저 버전으로 정정 가능)으로 진행한 것이며, 사용자가 바꾸려는 항목이 있으면 결과 실행 전에 말해 달라고 보고했다.**
- **v1.0 동결**: `docs/design/2026-10-26-strategy-validation-preregistration-v1.0.md`, §B sha256 `956811640d61ad959119c0b7be82b3a69d97634ec2a97aeaebaecc55a5252386`(머리 `sha256_section_B`). v0.1 초안은 이력으로 남김. 러너는 이 해시와 다르면 IS·OOS 실행 거부.
- **1단계 범위(확정)**: M1 엔진 + S1(rsi-oversold 일봉판)·S7 대조군 + 등록/해시 잠금 + `--counts-only` 러너(+ 수익 계산 phase 코드는 만들되 G1 통과 전 실행 금지) + `isolation.test.ts` 허용 목록 완화. S2·S4 는 S1 IS 결과 뒤 사용자에게 다시 묻는다.

### Leader 기록(Analyst 1단계 완료 후)

- 2026-10-26 16:15: Analyst 1단계 완료 — 초안 `docs/design/2026-10-26-strategy-validation-preregistration.md` v0.1(435줄). 사용자 확정 항목 U1~U14(권고대로 한 마디로 확정 가능), P3 규모 코드 2,100~3,150줄+시험 2,400~3,600줄·토큰 합계 약 300~670만(Developer 160~360만 포함, **[추측]**, 참고점 ADP-006 C01 실측 224만의 1.3~3배), 영업일 6~9일, go/no-go G0~G3. Analyst 추정 **"판정 대상 3개가 모두 불합격일 확률 55~75%"([추측], S1 단독 70~85%)**. 사전 등록 무결성: 후보 전략 수익률 계산 질의 0건(Analyst 보고, DB 질의 6건 SELECT·메타데이터).
- Leader 대조 확인: `isolation.test.ts:101` 의 금지 needle 목록에 `'@/lib/strategy'` 가 있어 지표 재사용(`strategy/indicators/*`)을 막는다는 Analyst 주장 [확실]. 처리 선택지: 5개 모듈 정규식 허용목록 + 순수성 단언으로 좁히기(Reviewer 필요) vs 지표 복제 + 패리티 시험.
- **Leader 권고(사용자에게 제시)**: ① U1~U14 권고대로 확정 ② **단계 go** — M1 엔진 + S1(rsi 일봉판)·대조군 S7 먼저 → G1(`--counts-only`) → S1 IS 결과 보고 뒤 S2·S4 구현 여부를 다시 결정(Tier A 3개의 사전 등록 N=56 은 그대로 유지해 다중비교 기준을 낮추지 않음, 절감폭은 [추측]) ③ ETF 2종목(SPY·069500) 일봉 수집은 U9 선행이라 KIS 읽기 승인이 필요(약 16호출, 오프아워).

### U9 선행 — ETF 2종목 일봉 수집 완료 (18:45 기록)

- 사용자 확정("2. P3 직압 진행해줘", 동결 문서 확정 기록 4항)에 따라 T-070 라우트 `POST /api/cron/daily-bars`(`{"symbols":["AMS:SPY","069500"],"years":3,"maxCalls":40}`, 오프아워, 크론 비밀은 헤더 파일로만)로 수집 — **KIS 읽기 16호출(8+8), HTTP 200**. `AMS:SPY`(미국, USD) **800행**(8호출×100행), `069500`(국내, KRW) **728행**. 품질 지표 전부 0(기업행위 의심·0 거래량·중복·충돌·순서 위반·드롭·결측 모두 0). 추가 전용(`daily_bars` 행 추가, 되돌리기 = 해당 두 종목 행 삭제). **ETF 가 KIS 일봉으로 수집 가능하고 `AMS` 거래소 코드가 맞다는 것이 확인됐다**(Analyst 의 미확인 항목 해소). 주문·시그널 생성 없음. 읽기 전용 확인 질의로 행 수·기간만 확인(수익 계산 0).

### Analyst — v1.1 해석 확정 패치 (19:37 기록)

- [19:25] 착수(Fable, 읽기 전용). 읽은 것: v1.0 전문(§A~§E·확정 기록) · 이 task(Developer 절 포함) · [[T-064-profit-engine-design]] §6.1~6.7 · [[T-070-daily-bars-phase0]] Analyst 검토(10-24) 전체 · [[T-095-postmortem-script-p1]] 지표 정의(수용 기준 3·4, Reviewer 기준선 대조·자기 포함 편향) · worktree `~/.node-local/stockinvest-p3s1` 의 `backtest/{fill,episodes,metrics,pipeline,baseline,signals/rsi-oversold-daily,signals/control-spike-contraction}.ts`·`registry/{evaluate-pass,registry}.ts`·`preregistration.json`·러너 코어 관문·counts·runIs 부분·`portfolio.ts` 머리·counts 리포트. **DB 조회 0건(읽기 전용 포함), 수익 계산 0건, 코드·worktree·설정 편집 0, 커밋 0.** 참고 실측은 Developer counts(건수)만.
- [19:37] 산출물: `docs/design/2026-10-26-strategy-validation-preregistration-v1.1-DRAFT.md` — v1.0 복제 아님, "해석 확정 패치". §A 5줄 요약 / §B 사용자 확정 3개(V1 단일 종목 비중 분모 = 전체 순수익 합 · V2 고원 구성원은 표본 충족 필수·이웃 증거는 1-3~1-7 만 · V3 G1 = 필터 후 counts 에서 U5 충족 조합 ≥ 1 + counts 확장) / §C 12개 확정표 — **추인 8**(①갭 경계 ②S7 정의 동결 ③초과수익 ⑤폴드 ⑥IS 끝 미청산 ⑧에피소드 시간 기준 ⑩시드 20261026 (a)가장자리 이웃) · **변경 4**(④분모 보수화 ⑦중앙값 비구성원→L1 최근접 구성원·regime 동률 off 추인 ⑧포트폴리오 시뮬에도 같은 재진입 금지 창 ⑨구성원 = P_perf ∩ U5 충족) + (b) counts 확장 / §D §B 패치 문구 9건(Leader 가 v1.1 전문에 반영) / §E 동결 절차 / §F 위험·정정.
- [19:37] 핵심 판단: 변경 4건은 전부 보수 방향(④·⑨) 또는 성과를 보지 않는 절차 규칙(⑦·⑧) — 어느 것도 합격을 쉽게 만들지 않음. 2차 관문 벤치마크가 동일가중(`ew`)·δ 가 ETF 로 배선된 것 §B-6 과 일치 확인 `[확실]`. **발견(⑧ 하위)**: `portfolio.ts:108` 은 보유·주문 중 종목만 제외해 손절 다음 날 재진입 가능 → 에피소드 규칙(시간 기준 차단)과 불일치 → 같은 규칙 적용 지시(방향 불명, 일관성 목적 — 미루려면 반대로 명시). **th=38 쏠림 평가**: th=30 전부 미달(데이터)+38 이 격자 가장자리(이웃 35 하나) → 38 이 가장 쉬운 후보이지만 35 의 성과 조건 통과 없이는 고원 불가; `edge` 표시 의무화. **G1 의견**: 상한 기준 S1 7/12·S7 2/2 → 통과 예정이나 th=35·hold5·레짐on 188건 등은 갭 필터 뒤 150 선에 걸칠 수 있어 필터 후 재집계(진입 뒤 봉 미접근, 무결성 영향 0) 뒤 G1 기록 권고.
- [19:37] 확인 못 한 것: `runOos` 프레임 절단·OOS 미청산 처리 코드 줄(Reviewer 가 ⑥ 대칭 확인), 갭 필터로 줄어드는 건수 크기(V3 재집계 전 불명), KR 유동성 필터 영향(판정 시장 아님). 20-Log 는 Leader 지시(편집 범위 2개 파일)에 따라 쓰지 않음.

## Developer

- [18:50] 1단계 착수(Opus, worktree `~/.node-local/stockinvest-p3s1` 브랜치 `p3s1` base `e2a7206`). 정본 v1.0 전문·이 task·`isolation.test.ts`·`strategy/indicators/*`·`postmortem-core.js`(P1 `universeBaselines`·`assertReadOnlySql`·`COSTS`) 읽음. 계획 — 모듈: `backtest/{types,frames,fill,episodes,baseline,metrics,regime,portfolio}.ts`(M1) · `backtest/signals/{rsi-oversold-daily,control-spike-contraction,index}.ts`(S1·S7만) · `backtest/registry/{preregistration.json,oos-ledger.json,hash,criteria,oos-ledger,evaluate-pass}.ts`(Tier A N=56·US 78 전부 등록) · 러너 `scripts/profit-engine/backtest-runner.mjs`(연결) + `backtest-runner-core.js`(시험 대상, phase 관문·counts) + TS 엔진을 `typescript.transpileModule` 로 scratch 캐시에 옮겨 싣는 로더(허용 경로만). 시험: 엔진 단위·변이(룩어헤드·경계·0분모·결측·휴장)·P1 기준선 6지점 패리티·판정 진리표·러너 관문(해시 불일치·G1 미기록·원장 존재·IS 리포트 없음 → 거부)·격리 허용목록+지표 순수성. 실제 데이터는 `counts` 1회만(수익 계산 경로 미호출을 시험으로 고정).
- [18:50] 발견: 10-26 ETF 수집으로 `daily_bars` 에 `AMS:SPY`·`069500` 이 들어와 있다 → 유니버스(US 50·KR 43)에서 벤치마크 종목을 registry 로 명시 제외해야 한다(안 하면 기준선·레짐 지수·counts 가 ETF 를 종목으로 섞는다).
- [19:22] 1단계 구현 완료(미커밋, worktree `p3s1`). 신규: 엔진 `src/lib/profit-engine/backtest/`(types·frames·costs·fill·episodes·baseline·metrics·regime·portfolio·pipeline·index + signals/{rsi-oversold-daily,control-spike-contraction,index}) · `src/lib/profit-engine/registry/`(preregistration.json — Tier A 56·대조군 2·Tier B 20 = US 78 전수 등록, oos-ledger.json 빈 원장, hash·registry·oos-ledger·evaluate-pass) · 러너 `scripts/profit-engine/backtest-runner.mjs`(연결) + `backtest-runner-core.js`(관문·counts·is·oos·TS 엔진 로더) · 시험 7개 파일 + `isolation.test.ts` 확장. 코드 약 2,265줄·시험 약 1,470줄, 새 시험 201건.
- [19:22] 검증: 전체 `npx jest` 289 스위트·7,550 통과(실패 0) · `npx tsc --noEmit` 0 · 변이 33종 전부 잡힘(갭·손절·비용·진입가·유동성·ADTV 미래봉·에피소드 창·기준선·부트스트랩 iid·MDD·순위·평가손·정수주·S1 룩어헤드·MA 배수·th 경계·t 임계·원장 1회·해시 규칙·레짐 경계·G1/해시 관문·IS 가 OOS 봉 사용·원장 선기록·격리 3종·counts 의 체결 호출). §B 해시는 코드가 문서에서 재계산해 registry·문서 머리와 일치 확인.
- [19:22] **counts 실제 실행 1회**(19:20, US, 읽기 전용 세션, 질의 1건 SELECT, 수익 계산 0 — 시험이 counts 경로의 체결·기준선·지표·포트폴리오 미호출을 고정). IS(2024-02-01~2025-09-30, isTo 뒤 봉 미사용) closable 에피소드: S1 12조합 중 U5 상한 충족 7(th=30 은 4조합 모두 미달 62~126, th=35·hold10·레짐on 144 미달) · S7 2/2 충족(157·183). 건수는 갭·유동성 필터 전 상한. 리포트 `agent-vault/10-Flow/reports/T-096-backtest-counts-US-20261026.{md,json}`(worktree). `is`·`oos` 는 실제 데이터로 실행하지 않음(G1 기록 `registry/g1-record.json` 없으면 러너가 DB 접속 전 코드 2 로 거부).
- [19:22] Leader 결정 필요(§B 모호·해석 — 코드에 박지 않고 해석으로 표시): ① 갭 경계(§A-2 `>`/`<` vs §C-4 "경계=미진입") — §C-4 따름 ② S7 정의 창·ATR 기간·수축 비교 대상 미정 — 해석 구현 ③ 초과수익을 거래 순수익(손절 포함) − (유니버스 평균 − 왕복)으로 정의 ④ 단일 종목 손익 비중 = 양(+) 기여 종목 중 최대 몫 ⑤ 폴드 "양(+)" = 검증 창 평균 초과수익 > 0, 이익 비중 = 폴드 순수익 합 기준 ⑥ IS 실행은 isTo 뒤 봉을 안 씀(IS 끝 무렵 에피소드 미청산) ⑦ 고원 중앙값이 고원 밖이면 chosen=null, regime 중앙값은 false 쪽 ⑧ 에피소드 보유 기간은 시간 기준(손절 조기 청산 무관) ⑨ 1-1 표본은 고원 집합 P 조건이 아니고 선택 조합에만 적용 ⑩ 부트스트랩 시드 20261026(§B 미지정). Reviewer 판정 필요(scope: `src/lib/profit-engine/backtest/`, `src/lib/profit-engine/registry/`, `src/lib/profit-engine/__tests__/isolation.test.ts`, `scripts/profit-engine/backtest-runner.mjs`, `scripts/profit-engine/backtest-runner-core.js`). 20-Log 는 지시(Developer 절만)에 따라 쓰지 않음.

## Reviewer

## QA

## 배포 기록

## Codex 검토

## 최종 요약

(완료 시 Leader 가 작성)

## 데모 검토 (demo gate)

| 버전 | 상태 | 저장소 파일 | Artifact | 사용자 결정 | 일시 |
|---|---|---|---|---|---|
| - | 해당없음 | - | - | judge: none | - |
