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
- [20:01] **r2 — Reviewer H-1 반영**(Leader 지시 4건, 성과 계산·DB 조회 0). v1.1-DRAFT 에 추가: §D **10** §A-2 기본값 → 신설 §B-12 표(값 v1.0 그대로·변경 0, 항목 16개: 에피소드 창 5·d1open·손절 규칙/0.25%·갭 2/3%·경계 1e-12·ADTV20×0.1%·품질 플래그·봉 간격 9일·기준선 최소 종목 10·MA100·부트스트랩 2,000/20261026·자본 $15,000/2,000만·슬롯 10/10%·벤치마크 비용 규칙·252·지정가 0.005/틱·USD·민감도 1.5/2.0·리포트 경로 — 각각 "지금 어디 있나(코드·registry)"와 "registry 키") · §D **11** registry 지문 마커 `registry-numeric-sha256: <hex>` 를 §B-11 첫 불릿 위 단독 줄로, H_r 정의(docHash 제외 정규화 JSON)·순환 해소 순서·러너 이중 검사(§B 해시+H_r, 불일치 → 종료 2) · §D **12** 실행 규율 단락(`--as-of` = registry `asOf` 2026-10-23 강제, IS 실행 원장 추가 전용 + 지문 4종(registry H_r·엔진·데이터·유니버스), OOS 지문 대조 불일치 거부, 결정일 보고에 원장 첨부) · §E 절차를 7단계로 재작성(Developer 가 registry 최종화 → Leader 복제·§D 반영 → H_r → 마커 → §B 해시 → registry/머리 갱신 → 러너 건식 확인 "is 거부 사유가 G1 미기록 하나뿐" → Reviewer 값 대조 → counts → G1 → is) · §F 솔직한 한계(g1-record·원장은 코드가 진위 검증 불가 → 정직성+git 이력+지문에 의존, "속이면 들킨다"까지만 보장) · §B-0 **V4(선택, 사전 등록 밖)** 커밋 훅 `SAFETY_PATHS` 에 `registry/`·`backtest/`·러너 편입 권고(사용자 결정, 동결과 무관) · §C-1 행 6·7(기본값 이동·H_r/원장/지문 — Leader 가 Developer 에 이미 지시). 사용자 확정 V1~V3 는 그대로, 추가 질문은 V4 하나이며 지금 답하지 않아도 됨.

## Developer

- [18:50] 1단계 착수(Opus, worktree `~/.node-local/stockinvest-p3s1` 브랜치 `p3s1` base `e2a7206`). 정본 v1.0 전문·이 task·`isolation.test.ts`·`strategy/indicators/*`·`postmortem-core.js`(P1 `universeBaselines`·`assertReadOnlySql`·`COSTS`) 읽음. 계획 — 모듈: `backtest/{types,frames,fill,episodes,baseline,metrics,regime,portfolio}.ts`(M1) · `backtest/signals/{rsi-oversold-daily,control-spike-contraction,index}.ts`(S1·S7만) · `backtest/registry/{preregistration.json,oos-ledger.json,hash,criteria,oos-ledger,evaluate-pass}.ts`(Tier A N=56·US 78 전부 등록) · 러너 `scripts/profit-engine/backtest-runner.mjs`(연결) + `backtest-runner-core.js`(시험 대상, phase 관문·counts) + TS 엔진을 `typescript.transpileModule` 로 scratch 캐시에 옮겨 싣는 로더(허용 경로만). 시험: 엔진 단위·변이(룩어헤드·경계·0분모·결측·휴장)·P1 기준선 6지점 패리티·판정 진리표·러너 관문(해시 불일치·G1 미기록·원장 존재·IS 리포트 없음 → 거부)·격리 허용목록+지표 순수성. 실제 데이터는 `counts` 1회만(수익 계산 경로 미호출을 시험으로 고정).
- [18:50] 발견: 10-26 ETF 수집으로 `daily_bars` 에 `AMS:SPY`·`069500` 이 들어와 있다 → 유니버스(US 50·KR 43)에서 벤치마크 종목을 registry 로 명시 제외해야 한다(안 하면 기준선·레짐 지수·counts 가 ETF 를 종목으로 섞는다).
- [19:22] 1단계 구현 완료(미커밋, worktree `p3s1`). 신규: 엔진 `src/lib/profit-engine/backtest/`(types·frames·costs·fill·episodes·baseline·metrics·regime·portfolio·pipeline·index + signals/{rsi-oversold-daily,control-spike-contraction,index}) · `src/lib/profit-engine/registry/`(preregistration.json — Tier A 56·대조군 2·Tier B 20 = US 78 전수 등록, oos-ledger.json 빈 원장, hash·registry·oos-ledger·evaluate-pass) · 러너 `scripts/profit-engine/backtest-runner.mjs`(연결) + `backtest-runner-core.js`(관문·counts·is·oos·TS 엔진 로더) · 시험 7개 파일 + `isolation.test.ts` 확장. 코드 약 2,265줄·시험 약 1,470줄, 새 시험 201건.
- [19:22] 검증: 전체 `npx jest` 289 스위트·7,550 통과(실패 0) · `npx tsc --noEmit` 0 · 변이 33종 전부 잡힘(갭·손절·비용·진입가·유동성·ADTV 미래봉·에피소드 창·기준선·부트스트랩 iid·MDD·순위·평가손·정수주·S1 룩어헤드·MA 배수·th 경계·t 임계·원장 1회·해시 규칙·레짐 경계·G1/해시 관문·IS 가 OOS 봉 사용·원장 선기록·격리 3종·counts 의 체결 호출). §B 해시는 코드가 문서에서 재계산해 registry·문서 머리와 일치 확인.
- [19:22] **counts 실제 실행 1회**(19:20, US, 읽기 전용 세션, 질의 1건 SELECT, 수익 계산 0 — 시험이 counts 경로의 체결·기준선·지표·포트폴리오 미호출을 고정). IS(2024-02-01~2025-09-30, isTo 뒤 봉 미사용) closable 에피소드: S1 12조합 중 U5 상한 충족 7(th=30 은 4조합 모두 미달 62~126, th=35·hold10·레짐on 144 미달) · S7 2/2 충족(157·183). 건수는 갭·유동성 필터 전 상한. 리포트 `agent-vault/10-Flow/reports/T-096-backtest-counts-US-20261026.{md,json}`(worktree). `is`·`oos` 는 실제 데이터로 실행하지 않음(G1 기록 `registry/g1-record.json` 없으면 러너가 DB 접속 전 코드 2 로 거부).
- [19:22] Leader 결정 필요(§B 모호·해석 — 코드에 박지 않고 해석으로 표시): ① 갭 경계(§A-2 `>`/`<` vs §C-4 "경계=미진입") — §C-4 따름 ② S7 정의 창·ATR 기간·수축 비교 대상 미정 — 해석 구현 ③ 초과수익을 거래 순수익(손절 포함) − (유니버스 평균 − 왕복)으로 정의 ④ 단일 종목 손익 비중 = 양(+) 기여 종목 중 최대 몫 ⑤ 폴드 "양(+)" = 검증 창 평균 초과수익 > 0, 이익 비중 = 폴드 순수익 합 기준 ⑥ IS 실행은 isTo 뒤 봉을 안 씀(IS 끝 무렵 에피소드 미청산) ⑦ 고원 중앙값이 고원 밖이면 chosen=null, regime 중앙값은 false 쪽 ⑧ 에피소드 보유 기간은 시간 기준(손절 조기 청산 무관) ⑨ 1-1 표본은 고원 집합 P 조건이 아니고 선택 조합에만 적용 ⑩ 부트스트랩 시드 20261026(§B 미지정). Reviewer 판정 필요(scope: `src/lib/profit-engine/backtest/`, `src/lib/profit-engine/registry/`, `src/lib/profit-engine/__tests__/isolation.test.ts`, `scripts/profit-engine/backtest-runner.mjs`, `scripts/profit-engine/backtest-runner-core.js`). 20-Log 는 지시(Developer 절만)에 따라 쓰지 않음.

## Reviewer

- [19:55] 독립 감사 1라운드(Sonnet, 읽기 전용 — worktree·메인 트리 소스 편집 0, 변이·재현은 스크래치 복사본 `…/scratchpad/p3rev/`). 읽은 것: 동결 문서 v1.0 전문 · 이 task · 엔진 `backtest/` 14파일 · `registry/` 5파일+json 2개 · 러너 2개 · 시험 8개 · `isolation.test.ts` diff · P1 `postmortem-core.js`(assertReadOnlySql·universeBaselines·COSTS). 실행: 전체 `npx jest` = 289 스위트 통과·4 스킵·7,550 통과(Developer 주장과 일치) · `npx tsc --noEmit --incremental false` exit 0(비시험 코드). 시험 파일은 tsconfig 제외라 별도 tsconfig 로 검사하니 새 시험에 타입 오류 3건(`backtest-registry.test.ts:239-241`, `{ ...A, tier: 'B' }` 리터럴 좁힘) — swc 는 타입을 안 보므로 실행엔 무해, 기존 P1 시험의 3건(`signal-postmortem-core.test.ts:591-593`)은 이번 범위 밖. DB 는 읽기 전용 SELECT 만(독립 건수 1건·벤치/ETF 제외 종목 수 확인·무조건 갭 비율 분포(전 종목, 전략 무관)·러너 counts 재실행 1건). 후보 전략의 수익·승률·초과수익을 실제 데이터로 계산하지 않았고 `--phase is|oos` 는 실제 데이터로 실행하지 않았다(합성 데이터·임시 메모리 파일시스템에서만).
- [19:55] 사전 등록 무결성 1-a(counts) 확인: 경로를 코드로 추적 — `runPhase(counts)` → `runCounts` → `buildFrames`·`universeIndex`·`signalModule`·`countCombo`(scanSignals·applyRegime·toEpisodes·weekKey) 뿐, `d1openFill`·`limitFill`·`universeBaseline*`·`expectancy`·`clusterBootstrapCI`·`simulate`·`judge`·`plateau` 는 어떤 경로로도 안 불린다(내 변이 M34 — countCombo 에 체결 호출 삽입 — 시험이 잡음). 리포트 2개(.md·.json)의 키 전수 대조: 후보 신호·에피소드·closable·주·종목·U5 충족 여부·미달 사유뿐, 성과 지표 0. 러너 counts 를 스크래치 복사본에서 다시 실행하니 결과가 Developer 리포트와 완전히 같다(`result` 동일). 독립 재구현(지표 RSI·SMA·ATR 직접 구현, 수익 계산 없음)으로 S1 12조합·S7 2조합 **14개 전부** 신호·에피소드·closable·주·종목이 일치.
- [19:55] 해시 잠금 2: 문서 §B 해시를 별도 스크립트(python, 코드 미참조)로 계산 = `956811…2386` — 문서 머리·registry·원장 머리·동결 커밋 `e2a7206` 의 파일과 모두 일치(메인 트리 파일과 sha 동일). 변이 민감도: §B 안 한 글자(Tier A→Tier a, 비용 0.65→0.66, PF 1.4→1.3, 공백 추가) 모두 불일치, CRLF·NFD·§B 제목 중복·§C 제목 중복·§C 제목 소실 모두 거부(fail-closed), 끝의 공백·`---` 추가는 규칙대로 해시 불변. 그러나 **§A-1·§A-2·§C 는 해시 밖** — 에피소드 창 5일·갭 필터·ADTV 0.1%·부트스트랩 2,000회·자본 $15,000·슬롯 10·레짐 MA100 등 코드가 쓰는 기본값 상당수가 §A-2 에만 있고(§B-6 이 "§A-2 시뮬 설정"을 인용) 문서를 바꿔도 해시가 안 변한다(재현 확인).
- [19:55] 높음(H-1) registry 수치가 런타임에 §B 해시와 연결돼 있지 않다 — `runPhase` 는 문서 §B 해시가 **registry 안에 적힌 해시**와 같은지만 보고, `validateRegistry` 는 형식·시행 수만 본다. 합성 DB 로 `criteria.is.minPf=1.0`·`minNetAfterDelta=-1`·`tThresholds.nLe100=0.1`·`episodes.windowDays=1`·`execution.gapUp=0.5` 로 바꾼 registry(해시 필드는 그대로)로 `--phase is` 를 돌리니 관문을 통과해 IS 가 실행됐다(재현 5). 문서 §B+registry 해시+g1+원장을 일관되게 같이 바꿔도 통과(재현 4). 막는 것은 jest 의 원문 대조 시험뿐인데 그 파일과 `registry/` 는 커밋 훅 `SAFETY_PATHS` 밖이라 시험을 같이 고치면 아무도 못 막는다. `registry/preregistration.json` 의 `gapBoundary`·`fixed.maMult`·`fixed.spike`·`integerShares`·`judgeModel`·`sensitivityModel`·`pit`·`decisionDate` 는 코드가 읽지 않는 죽은 값이라(grep 확인) 바꿔도 효과가 없는데 설정처럼 보인다(낮음).
- [19:55] 높음(H-2) `--as-of` 로 잠긴 OOS 창을 자를 수 있다 — `asOf > registry.asOf` 만 거부하고 그 이하는 전부 허용한다. `--phase oos --as-of 2026-01-15` 가 코드 0 으로 실행되고 결과 `window.to` 는 등록 창(2026-10-23)으로 표기돼 실제 데이터 끝과 어긋난다(재현 15). U8 이 "OOS 종료일을 지금 고정해 언제 돌리느냐로 창을 고르는 것을 막는다"고 한 취지를 CLI 플래그 하나로 우회한다(IS 도 같은 구멍). 데이터가 `oosTo`/`isTo` 까지 실제로 있는지 검사도 없다.
- [19:55] 높음(H-3) 관문의 증빙이 전부 에이전트가 쓸 수 있는 파일·공개 값이다(우회 시도표). 막힘: 해시 불일치(재현 3)·G1 파일 없음(재현 1, **DB 접속 전** 종료 코드 2 확인)·G1 시장/승인 문구 누락(6·7)·`--unlock-oos` 오값(9a)·여러 전략 동시(14)·IS 리포트 없음(8)·원장 존재 시 재실행(11)·원장 파일 삭제(13). 안 막힘: ① `registry/g1-record.json` 을 에이전트가 직접 쓰기(재현 2 — 승인 필드를 검증하는 것은 `approved_by==='user'`·문구 비어있지 않음뿐, 작성자·승인 증거 검증 없음) ② IS 리포트 JSON 의 `plateau.chosen` 을 손으로 바꿔 OOS 실행(재현 10 — OOS 는 `chosen` 을 그대로 믿고 격자에서 재계산하지 않음, 잠금 줄에는 바꾼 값이 기록됨) ③ `oos-ledger.json` 을 빈 원장으로 되돌린 뒤 같은 전략 OOS 재실행(재현 12 — "추가 전용"은 메모리 안 검사일 뿐 디스크·git 대조 없음) ④ `--unlock-oos` 값은 §B 해시 자체라 공개 값이라 확인 문구 역할뿐 ⑤ IS 는 횟수 제한이 없고 IS 리포트·잠금 줄에 엔진 코드 지문(로더가 이미 `engine-<digest16>` 를 계산함)·registry 지문·데이터 지문·IS 리포트 해시가 안 남아 IS 를 보고 코드·설정을 고쳐 다시 도는 분기 경로를 사후에 못 찾는다.
- [19:55] 중간(M-1) 동시 OOS 2회 가능(TOCTOU) — 같은 디스크 상태에서 `runPhase(oos)` 두 개를 동시에 시작하면 둘 다 원장 비어있음을 읽고 둘 다 코드 0 으로 OOS 를 계산한다(재현 16, 리포트 파일은 같은 이름이라 덮어써져 1건만 남음). 잠금 파일 배타 생성(`wx`) 또는 쓰기 직전 재읽기가 필요하다. 또 `runOos` 의 IS 행 조회·`chosen` 검증이 잠금 줄 기록 **뒤**에 있어 검증 실패 시 OOS 기회만 소진된다(순서 변경 권고).
- [19:55] 중간(M-2) 변이 시험: 내 변이 90종(체결·비용·에피소드·신호·기준선·파이프라인·통계·포트폴리오·레짐·판정·관문·원장·해시·registry 수치) 중 76 사망·14 생존. 동치 변이 4(M23 S7 slice 확장·M47 슬롯 상한 `>=`→`>` 는 pending 합산 때문에 도달 불가·M83 CR 검사 제거는 CRLF 가 어차피 해시 불일치·M85 §C 제목 중복 허용은 첫 제목을 쓰므로 무해) 제외한 시험 공백 10건: M60 고원 이웃 `every`→`some`(핵심 §B-7 규칙인데 시험이 이웃 2개인 축을 안 다룸) · M40 부트스트랩 하한 2.5%→5% · M33 `runCombo` 에피소드가 `exec.hold` 를 안 쓰게 해도 통과 · M53 포트폴리오 진입 당일 손절 제외 · M31 counts closable `<`→`<=`(G1 off-by-one) · M76 counts 가 isTo 뒤 봉을 받아도 통과(실제 코드는 `until: isTo` 로 올바름 — 내 독립 건수가 일치) · M36 군집 SE `G/(G-1)` 제거 · M30 δ_trade 252→365 · M09 ADTV 창에서 D0 제외 · M43 폴드 `>`→`>=`. 격리 시험(item 6)은 변이 24종 전부 사망(허용 지표 5개 중 하나에 fs·process.env·Date.now·상대 import·@/lib/db·macd 이웃 import 삽입, 허용 정규식의 끝 고정 제거·macd 추가, 엔진의 index·macd·safety·exchanges·fs·os·mysql2·동적 import·require·fetch·상대경로 우회).
- [19:55] 격리 시험 변경(`isolation.test.ts` +129/-5) 확인: 금지 바늘 배열은 diff 상 **한 줄도 안 줄었다**(`'@/lib/safety'`…`'VTTT'` 그대로, 바뀐 것은 허용 지표 import 문자열만 지우고 검사하도록 `hits` 한 줄). 허용 정규식은 정확히 5개(`rsi|sma|ema|bollinger|atr`) 끝 고정이고 시험이 `index`·`macd`·`rsi.ts`·`rsix`·`../..` 우회를 거부함을 단언. 허용 지표 5개의 순수성 단언(import 는 서로 간 상대뿐, fs·process.env·Date.now·fetch·console·`@/lib/` 0)이 실제로 I/O 삽입을 잡음(변이 I01~I06). 러너 로더 허용 목록(`ENGINE_ALLOWED` 4개 정규식)은 격리 시험 목록과 같다(시험이 샘플로 대조). 로더: `typescript.transpileModule` 로 `--cache`(저장소 안이면 거부, 기본은 OS 임시 디렉터리 고정 경로 `t096-backtest-cache` — 공유 /tmp 라 예측 가능, 낮음)에 CJS 로 쓰고 `require`; import 해석 결과가 허용 목록 밖이면 거부, `fs`·`child_process` 등 내장은 `crypto` 외 전부 거부. 앱 런타임·`src/` 안 다른 곳에서 backtest/registry 를 참조하는 파일 0(grep). `git status` 상 기존 추적 파일 수정은 `isolation.test.ts` 하나뿐 — 앱 코드·DB 스키마·`system_config`·package.json 변경 없음.
- [19:55] 핵심 수식 독립 재구현 대조(내 입력, Developer 시험 미복사): ① `d1openFill` — 무작위 4,000건(갭·손절·시간·비용)을 §B-4·§A-2 문구에서 직접 짠 기준 구현과 대조해 **불일치 0**, 경계 시험: 갭 102/100·97/100 경계는 미진입, 101.99·97.01 은 진입, 부동소수 경계(`c×1.02`·`c×0.97`) 미진입, 손절 `low==stop` 손절·`97.0001` 시간 청산, 갭하락 `open<stop` 은 시가 청산(순수익 −5.75% = 시가 −5% −손절 비용 0.75%), 진입 당일 손절, 청산일 저가가 손절선 이하면 손절 우선, 비용 방향·값(+2% → +1.35%), 보유 창이 데이터 끝을 넘으면 null, 진입봉 zero_volume 은 건너뜀, 청산일 zero_volume 은 다음 거래 가능 봉 종가로 미룸, `limitFill` 체결·미체결 경계. ② 에피소드: 5일 창·6일째 새 에피소드·보유 10일은 10일 차단·종목 독립 일치. ③ 기준선: 내 합성 유니버스 25종목(기업행위 의심·15거래일 결측·adj_stale·zero_volume 포함)을 P1 `universeBaselines` 와 직접 대조해 평균·표본 수 510점 **불일치 0**. ④ 레짐: 내 구현과 지수 최대 오차 0·`regimeOk` 260점 불일치 0·앞 99점 false·지수 뒤쪽을 덮어도 과거 날짜 결과 불변. ⑤ 통계: 군집 SE·t 가 내 계산과 소수 6자리 일치, 부트스트랩 구간은 내 2만 회 재표집과 몬테카를로 오차 내 일치, 시드 재현·군집 1개 null·샤프·MDD(100→10→110 = 90%)·연환산·PF·손익비 일치. ⑥ 포트폴리오: 손계산(수량 floor(1,000/100.325)=9·최종 자산 10,083.8575·손절 netRet −3.75%·평가손 MDD)과 일치, 1주>슬롯 계수·슬롯 10 상한·동률 순위(종목코드)·현금 비음수 확인. ⑦ S1 신호: 독립 구현과 4만 8천 점 불일치 0, 룩어헤드 — 미래 봉을 난수로 덮은 320건(S1·S7) 결과 불변, 스캔 단위 절단 불변 확인, IS 실행은 isTo 뒤 봉 값이 달라도 결과가 완전히 같다(재현 17).
- [19:55] §B/§C 모호 10건(+내가 본 3건) 평가(판정 확정은 Analyst·Leader 몫). 1 갭 경계: 모호함(§A-2 `>`/`<` 대 §C-4 경계=미진입, §B-4 는 경계 언급 없음), 구현의 §C-4 선택은 안전한 쪽, 영향 낮음 — 무조건(전 종목·IS 기간) 26,168개 갭 쌍 중 정확히 경계값 0건(±1e-4 안 22건). 2 S7: 진짜 미정(창·ATR 기간·수축 기준·순위), Developer 해석은 자연스러운 쪽이나 대조군(탐색 전용)이라 판정 영향 낮음 — 단 결과를 본 뒤 정의를 고칠 자유도라 IS 전에 동결. 3 초과수익: 모호함(§B-5-1 "전략 거래의 ret_h" 대 §C-1 `excess` 가 `horizonRets`(손절 없는 지평 수익)에서 계산), 구현은 손절 포함 거래 순수익−(기준선−왕복)이라 §C-1 시그니처의 의도(손절 없는 `ret_h`)와 다르게 읽을 여지, 영향 **높음**(1-3 의 t·구간 하한이 핵심 관문). 4 단일 종목 비중: 모호(분모 미정), 구현 분모(양(+) 종목 합)는 "손익 비중"의 자연스러운 뜻(총 손익 중 몫)보다 항상 크거나 같아 낙관 쪽(내 5건 예: 44% 대 총 순수익 기준 80%), 영향 중간. 5 폴드: 모호, "양(+)"=평균 초과수익>0 은 문구에 가깝고 이익 비중은 음 폴드를 합쳐 분모가 작아져 일부 경우 더 엄격(+8,+6,−2 이면 구현 67% 실패 대 양 폴드만 57% 통과), 영향 낮음~중간(보조 조건). 6 IS 끝 미청산: 모호하나 OOS 가격을 IS 에 섞지 않으려는 구현이 §B-3 취지에 가깝고, `runOos` 도 `until: oosTo` 로 대칭(OOS 끝 미청산 동일 처리), 영향 낮음(끝 5~10거래일). 7 고원 중앙값: 모호, 중앙값 조합이 고원 밖이면 `chosen=null` 은 §B-7 에 없는 추가 요건이지만 §B-6(중앙값 조합이 IS 전 조건 통과)과 대체로 같은 결과, 이때 전략 판정값이 정의돼 있지 않음(러너는 코드 2 로 멈춤), 영향 낮음~중간. 8 보유 기간: 모호, 에피소드는 시간 기준(경로 비의존, 표본 수가 수익에 안 흔들림)이라 합리적이나 포트폴리오 시뮬은 "보유·주문 중 종목만 제외"라 손절 다음 날 재진입이 가능 — 1차·2차 관문의 표본 정의가 다름(추가 발견), 영향 낮음~중간. 9 1-1 적용 대상: 문구 그대로(§B-7 의 P 는 1-3~1-7)라 구현이 문구에 더 가깝지만 결과가 S1 에 비직관적 — th=30 네 조합은 closable 62~126 으로 표본 미달인데 P·고원 이웃·중앙값 후보가 될 수 있어(th=35 가 고원이려면 th=30 이 성과 조건을 통과해야 함, 중앙값이 th=30 쪽으로 가면 INSUFFICIENT), 영향 중간~높음. 10 부트스트랩 시드: §B·§A 모두 값 없음(`20261026` 은 registry 만, 해시 밖) — 시드 쇼핑 여지, 2,000회 표본 오차로 하한이 0 근처인 경계 사례는 뒤집힐 수 있어 영향 낮음~중간, 고정 값·회수·PRNG 를 해시 범위 안으로. 추가: A) δ 를 단계 창(IS 창·OOS 창)마다 따로 계산 — "같은 창" 의 뜻 모호(OOS 에서 δ 가 0 이면 1-4 가 쉬워짐) B) 슬리피지 ×1.5 조건에서 손절 슬리피지도 ×1.5 이고 δ 는 안 뺌 C) 에피소드 수(1-1)는 갭·유동성 후 청산 건수인데 G1 은 필터 전 상한 — G1 통과가 IS 충족을 보증하지 않음. §B 수치를 코드가 registry 에서 읽는지: 합격·격자·분할·비용·시드·창·갭·ADTV 는 registry 에서 읽음(하드코딩 아님), 코드 안 상수는 S1 `MA_MULT`·S7 `SPIKE`(registry `fixed` 는 읽지 않는 복사본)·`UNIVERSE_MIN_N`(P1 과 같은 10)·`BAR_GAP_DAYS` 9·252 정도. Analyst 의 v1.1-DRAFT(19:37)는 ③·④·⑦·⑧·⑨·⑩·G1 을 이미 다루는 것으로 보이나(대조만, 평가는 독립) H-1~H-3(런타임 registry 결합·as-of 고정·관문 증빙)은 다루지 않는다.
- [19:55] 러너 안전(7): SQL 은 `SET SESSION TRANSACTION READ ONLY` 와 SELECT 2종(`barsCounts` 에 turnover 없음·`barsFull`)뿐이고 `?` 바인딩, `assertReadOnlySql` 이중 방어(질의 함수와 실행기 양쪽), `multipleStatements:false`, 관문은 DB 접속 전에 판정, KIS·LLM·fetch·앱 모듈 0, `.env` 는 `--env` 로 읽되 값은 출력 안 함(에러 문구는 변수 이름만), 종료 코드 0 완료·2 거부·1 실패(인자 오류·캐시 위치 오류 확인), `--cache` 가 저장소 안이면 거부. 한계(낮음~중간): `--out`/`--json` 이 임의 경로(절대경로 포함)로 쓰여 registry·원장을 덮어쓸 수 있음(재현 21 — counts 마크다운이 registry 경로에 쓰임), `--cache` 는 §C-1 의 "일봉 JSON 캐시" 가 아니라 컴파일 캐시로 의미가 바뀜(문서와 불일치, 낮음), 유니버스를 종목 수(50)로만 고정해 종목 교체는 통과, 유니버스 행에서 벤치 ETF 제외(`AMS:SPY`·`069500`)는 올바름(DB 51·44종목 → 50·43, SMH ETF 는 §B-0 대로 유니버스에 남음).
- [19:55] §C-1 시그니처 대조(10): 함수·파일 이름은 대체로 일치하고 차이는 전부 인자·반환 확장 — `judge(…, opts)`→`{verdict, shape, isPassed, promotionBlocked, reasons}`·`plateau(…, grid)`·`toEpisodes(…, holdBars)`·`d1openFill(…, opts)` null 반환(보유 창이 끝을 넘으면)·`ExitKind` 'unfilled'·`StrategySpec.rank` 미구현(Signal.score 로 대체) — 주석에 "보고 대상"으로 적혀 있고 실제와 일치(주석 사실성 확인: fill.ts·episodes.ts·control-spike 주석의 정의가 코드와 맞음). `report.ts`(M4)는 1단계 범위 밖. 패리티 시험은 §C-4 의 "고정 CSV" 가 아니라 결정적 합성 일봉으로 P1 함수와 대조(같은 목적, 낮음).
- [19:55] 이슈 요약 — critical 0 · high 3(H-1 registry 런타임 결합 없음·§A-2 해시 밖, H-2 `--as-of` 로 OOS 창 절단, H-3 관문 증빙 자기 증명·코드/설정/데이터 지문 미결합) · medium 8(M-1 동시 OOS·잠금 순서, M-2 시험 공백 10건, 해석 ③④⑨ 영향 높음~중간 미결, 포트폴리오↔에피소드 재진입 불일치, 유니버스 구성 미고정, `--out` 임의 경로, 시험 타입 오류 3건, IS 반복 횟수·분기 경로 미기록) · low 7(죽은 registry 값, `--cache` 의미, S1 NaN 이력, 기본 캐시 /tmp 고정 경로, δ 창, ADTV D0 포함 미고정, 데이터 스냅샷 지문). 조건 — 이 변경은 앱 런타임·DB·스위치에 닿지 않고 결과가 아직 한 번도 안 나왔으므로 현 상태 커밋은 허용하되(`g1-record.json` 이 없어 `is`·`oos` 는 코드 2 로 막힘), **다음 전부가 닫히기 전에는 G1 기록 작성과 `--phase is` 실행을 하지 않는다**: C-1 `is`·`oos` 에서 `--as-of` 는 등록 as-of 와 같아야 하고 데이터 최대 날짜가 `isTo`/`oosTo` 이상임을 검사하며 결과 `window` 에 실제 데이터 범위를 적는다. C-2 registry 정본 지문(sha256)·엔진 지문(`engine-<digest>`)·데이터 지문(행 수+정렬 행 해시)·유니버스 종목 목록 해시를 IS 리포트 머리와 OOS 잠금 줄에 기록하고 OOS 가 불일치 시 거부하며 `plateau.chosen` 은 IS 리포트 격자에서 재계산해 대조하고 IS 실행 횟수를 추가 전용으로 남긴다(결과 후 수정 불가 기준을 코드가 아니라 기록으로 고정) — 아울러 **사용자 결정**: `registry/`·`backtest/`·러너를 커밋 훅 `SAFETY_PATHS` 에 넣을지(들어가면 이후 변경도 범위 있는 Reviewer 판정 필요). C-3 OOS 잠금을 배타 생성 + 쓰기 직전 재읽기로 바꾸고 IS 행·`chosen` 검증을 잠금 앞으로 옮기며 `--out`/`--json` 은 리포트 디렉터리 안으로 제한. C-4 시험 공백 변이(M60·M40·M33·M53·M31·M76·M36·M30·M09)를 잡는 시험을 추가하고 시험 타입 오류 3건을 고친 뒤 변이를 다시 돌려 사망 확인. C-5 Leader·Analyst 가 해석 ③·④·⑨(+⑦·⑧ 포트폴리오·⑩ 시드)를 **결과를 보기 전에** 새 패치 버전으로 확정하고 §A-2 기본값을 해시 범위 안으로 옮기며(새 버전 필요) Developer 변경분은 Reviewer 가 재검증한다.
- [19:55] **최종 판정: CONDITIONAL_PASS (scope: src/lib/profit-engine/backtest/, src/lib/profit-engine/registry/, src/lib/profit-engine/__tests__/isolation.test.ts, scripts/profit-engine/backtest-runner.mjs, scripts/profit-engine/backtest-runner-core.js, src/lib/profit-engine/__tests__/backtest-*.test.ts)**

## QA

## 배포 기록

## Codex 검토

## 최종 요약

(완료 시 Leader 가 작성)

## 데모 검토 (demo gate)

| 버전 | 상태 | 저장소 파일 | Artifact | 사용자 결정 | 일시 |
|---|---|---|---|---|---|
| - | 해당없음 | - | - | judge: none | - |
