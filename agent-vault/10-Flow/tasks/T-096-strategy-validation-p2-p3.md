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
waiting: [사용자: 사전 등록 U1~U14 확정 + P3 구현 단계 go(예상 300~670만 토큰 [추측]), T-095 P1 재감사 통과, Leader: isolation 시험 완화 승인·ETF 2종목 일봉 수집(KIS 읽기) 승인]
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

### Leader 기록(Analyst 1단계 완료 후)

- 2026-10-26 16:15: Analyst 1단계 완료 — 초안 `docs/design/2026-10-26-strategy-validation-preregistration.md` v0.1(435줄). 사용자 확정 항목 U1~U14(권고대로 한 마디로 확정 가능), P3 규모 코드 2,100~3,150줄+시험 2,400~3,600줄·토큰 합계 약 300~670만(Developer 160~360만 포함, **[추측]**, 참고점 ADP-006 C01 실측 224만의 1.3~3배), 영업일 6~9일, go/no-go G0~G3. Analyst 추정 **"판정 대상 3개가 모두 불합격일 확률 55~75%"([추측], S1 단독 70~85%)**. 사전 등록 무결성: 후보 전략 수익률 계산 질의 0건(Analyst 보고, DB 질의 6건 SELECT·메타데이터).
- Leader 대조 확인: `isolation.test.ts:101` 의 금지 needle 목록에 `'@/lib/strategy'` 가 있어 지표 재사용(`strategy/indicators/*`)을 막는다는 Analyst 주장 [확실]. 처리 선택지: 5개 모듈 정규식 허용목록 + 순수성 단언으로 좁히기(Reviewer 필요) vs 지표 복제 + 패리티 시험.
- **Leader 권고(사용자에게 제시)**: ① U1~U14 권고대로 확정 ② **단계 go** — M1 엔진 + S1(rsi 일봉판)·대조군 S7 먼저 → G1(`--counts-only`) → S1 IS 결과 보고 뒤 S2·S4 구현 여부를 다시 결정(Tier A 3개의 사전 등록 N=56 은 그대로 유지해 다중비교 기준을 낮추지 않음, 절감폭은 [추측]) ③ ETF 2종목(SPY·069500) 일봉 수집은 U9 선행이라 KIS 읽기 승인이 필요(약 16호출, 오프아워).

## Developer

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
