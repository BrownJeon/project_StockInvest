---
task_id: T-095
title: 사후검증 스크립트 보강(P1) — 환율 무관 진입 모델·D+10 구간·같은 날 유니버스 기준선·가격 없음 라벨·가정 명시
status: todo
priority: high
project: StockInvest
created: 2026-10-26
updated: 2026-10-26
base_ref: 53b97d9
risk_level: R1
roles_involved: [leader, judge, developer, reviewer, qa]
related_tasks: [T-070-daily-bars-phase0, T-064-profit-engine-design, T-072-validation-gate]
tags:
  - type/task
  - domain/profit-engine
  - domain/validation
aliases:
  - P1사후검증보강
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

# T-095 사후검증 스크립트 보강 (P1) — 전략 검증 줄기의 첫 단계

## 목표

- **사용자 결정 원문**(2026-10-26 15:30 이전, "다음 작업" 목록의 Q3 에 대한 답): "Q3: 권고대로 진행해줘 … 작업은 지금 바로 진행해줘" → Q3 권고 = **A. 전략 검증을 먼저**(수익 경로 직결). 이 task 는 그 줄기의 **P1**(결정 불필요·LLM 0·DB 쓰기 0·KIS 0).
- **정정(Leader, 2026-10-26)**: 목록에서 "T-070 사후검증 리포트 Analyst 검토"를 다음 작업으로 적었으나 **그 검토는 2026-10-24 에 이미 끝나 있다**([[T-070-daily-bars-phase0]] `## Analyst 검토`). 낡은 세션 메모리를 믿고 쓴 오류다. 따라서 실제 다음 단계는 그 검토가 제안한 P1~P5 이고, 이 task 가 **P1**이다.
- **왜**: 지금 있는 사후검증 리포트의 결론("rsi-oversold 비용 후 D+5 −0.82%" 등)은 ① 미국 수익률이 **환율 역산**(95% 가 같은 날 중앙값)에 1:1 로 걸려 있고 ② D+10 헤드라인에 구간이 없고 ③ 측정 대상이 라이브 전략(TTL 30분)이 아니라 "하루 걸어둔 지정가" 반사실(D+1 프록시)인데 리포트에 그 사실이 없고 ④ 유니버스 무조건 수익 기준선이 없고 ⑤ ai_skipped 70건(가격 없음)이 "단위 불명"으로 잘못 라벨링돼 에피소드 21% 가 탈락한다. **전략이 합격/불합격인지 재는 도구 자체를 먼저 정확하게 만든다** — 그래야 P2(합격 기준 사전 등록)·P3(백테스트)의 숫자를 믿을 수 있다.

## 범위 (Analyst P1 + §5 결함 목록 그대로 — 새 요구를 만들지 않는다)

정본 근거: [[T-070-daily-bars-phase0]] `## Analyst 검토 (2026-10-24)` §1(신뢰도)·§4 P1·§5(결함 의심) 와 리포트 `agent-vault/10-Flow/reports/T-070-signal-postmortem-20261024.md`.

1. **환율 무관 진입 모델** `--entry-model=d1open|d0close` (USD 일봉 `daily_bars` 자체로 진입·청산). 수익률·MAE·H-D·rsi 판정은 환율에서 완전히 벗어난다. would_fill·D+1 갭·H-C·H-E 만 환율 의존으로 남기고 `[추측]` 표기 유지. 기본값은 기존 동작(`legacy`)을 유지해 **v1 리포트 숫자가 그대로 재현**되어야 한다.
2. **D+10 에 신뢰구간**(`STAT_HEAD` 가 D+5 만 가짐) — 헤드라인에 불확실성 없이 D+10 수치를 인용하지 않는다. 주 군집(유효 N) 기준 구간 계산 방식은 기존 D+5 와 같게.
3. **같은 날(D0) 유니버스 무조건 수익 기준선** — 시그널 수익에서 같은 D0 날짜의 유니버스 평균을 뺀 **초과수익**(날짜 일치). 같은 93종목·같은 날 기준.
4. **ai_skipped 70건 포함**: 가격 NULL 에피소드를 D0 종가 진입으로 평가 가능하게(`d0close` 모델). `unit_unknown` 라벨을 정정해 **"가격 없음(price_missing)"** 과 진짜 단위 불명을 분리.
5. **리포트 문구 정정(가정 명시)**: "당일 만료 = D+1 프록시(하루 지정가 반사실)" 사실, h=1 라벨 정의("D+1 = 체결 당일"), 다중비교(분할 14회) 경고, H-D US 차 1.00%p 가 임계와 동일한 경계라는 경고(H-G 에 이미 있는 것과 같은 형식), H-B 의 [확실] 은 건수에만이라는 단서, H-A 커버 183건의 시장·기간 분해 표(가능하면).
6. 출력: **새 리포트 파일**(예: `T-095-signal-postmortem-v2-<KST 날짜>.md` — v1 파일은 덮어쓰지 않는다)과 선택적 `--json`. 읽기 전용 세션(`SET SESSION TRANSACTION READ ONLY`) 유지.

## 소유 파일 / 제약

- 소유: `scripts/profit-engine/postmortem-core.js`(계산, 시험 대상)·`scripts/profit-engine/signal-postmortem.mjs`(연결·파일 쓰기)·`src/lib/profit-engine/__tests__/signal-postmortem-core.test.ts`(시험 확장).
- **격리 시험이 import 목록을 고정한다**: `src/lib/profit-engine/__tests__/isolation.test.ts:191-206` — `signal-postmortem.mjs` 의 import 는 정확히 `['./postmortem-core.js','mysql2/promise','node:fs','node:path','node:url']`. **새 import 를 만들지 않는다**(만들어야 하면 Leader 에게 먼저 묻는다 — 격리 시험은 의도된 방어선이다).
- `src/lib/signals/paper-fill.ts` 는 주석에서만 `postmortem-core` 를 언급한다(import 없음, 2026-10-26 grep). 그래도 **`postmortem-core` 의 기존 export 시그니처·기본 동작은 바꾸지 않는다**(추가만). Reviewer 가 `paper-fill` 쪽 영향 0 을 확인한다.
- `scripts/profit-engine/` 는 커밋 훅 `SAFETY_PATHS` 밖이다(워크스페이스 S00 보고서 §3.3: 금전 영향 경로가 감시 밖). **이 task 는 Reviewer 판정을 스스로 요구한다**(`## Reviewer` 마지막 판정 줄 — 형식은 프로젝트 CLAUDE.md 「Reviewer 기록 작성 규칙」) — 훅이 강제하지 않으므로 Leader 가 확인 뒤 커밋한다. 커밋 훅 경로(`src/lib/signals/` 등)를 만지게 되면 훅이 강제한다.

## 하지 않는 것

DB 쓰기·DDL·`system_config` 변경·KIS 호출·앱 API 호출·LLM 호출·주문·알림·스위치 변경, 전략 활성/비활성 결정(P2 이후), push·배포(스크립트 전용 변경은 다음 push 에 동승 — 문서·스크립트만을 위한 배포는 하지 않는다). 새 요구를 임의로 넓히지 않는다(P3 백테스트·P4 자본 정합은 별도 결정).

## 수용 기준

1. `legacy` 모델로 같은 `--days 90` 을 돌리면 v1 리포트의 핵심 수치(에피소드 336·일봉 있는 258·D+5 −0.82% 구간 등)가 **그대로 재현**된다(읽기 전용, 같은 DB 기준 — 새 봉이 생기기 전 시점이라는 단서를 리포트에 기록).
2. `d1open` 에서 미국 수익률 계산 경로에 환율(`fx`)이 **들어가지 않는다**(단위 시험으로 증명: 환율 값을 바꿔도 결과 불변).
3. D+10 에도 D+5 와 같은 방식의 구간이 있고, 헤드라인은 구간과 함께 쓴다. 표본 부족(n<30)·경계값(임계와 동일) 경고가 자동으로 붙는다.
4. 같은 날 유니버스 초과수익이 리포트에 나온다. 계산 정의(어느 종목·어느 가격)가 문서 맨 위에 적혀 있다.
5. ai_skipped(가격 없음) 에피소드가 `d0close` 에서 평가되고 `price_missing` 라벨로 분리된다. `unit_unknown` 은 진짜 단위 불명에만 쓴다.
6. 리포트에 D+1 프록시 반사실 문구·다중비교 경고·H-D 경계 경고가 들어간다.
7. 격리 시험(`isolation.test.ts`)·기존 `signal-postmortem-core.test.ts`·전체 jest·tsc 가 통과한다. 쓰기 SQL 이 한 문장도 없다(`assertReadOnlySql` 통과 + 시험).
8. Reviewer 판정(`PASS`/`CONDITIONAL_PASS`, scope 에 위 소유 파일 포함) → Judge C2 → QA(격리 사본) 순환.

## 허용 권한

읽기 전용 DB 조회(`signal-postmortem.mjs` 의 읽기 전용 세션)와 로컬 작업 트리 편집. 커밋은 Leader 가 명시 경로로. 그 밖(쓰기·KIS·push 등)은 별도 요청.

## 역할 배정

- **judge**: 접수·developer 모델·C2(Codex) 판정.
- **developer**: 격리 worktree 에서 구현(`git worktree add ~/.node-local/stockinvest-postmortem-t095 -b postmortem-p1-t095 main`), 시험 확장. `node_modules` 는 worktree 에 설치(NFS noexec).
- **reviewer(Sonnet)**: 독립 감사 — 수치 재현(수용 1)·환율 무관 증명(수용 2)·구간 계산 수식 대조·`paper-fill`/격리 시험 영향·쓰기 SQL 0·리포트 문구의 사실성.
- **qa**: 격리 사본에서 `legacy` 재현·`d1open`/`d0close` 실행·경계 입력(빈 표본·가격 NULL·휴장일·종목 상장 전).

## 판단 기록 (judge)

- [2026-10-26 15:3x] intake engine=rules → risk=R1 / developer_model=opus / next=assign / demo=none(level none) / blocking_gate=null. 입력 요약은 기능 수준(코드·비밀 없음). 결과 JSON: 세션 임시 `judge-T-095-intake.out.json`(저장소 밖). C2(Codex) 는 Reviewer 통과 뒤 judge 가 판정.

## 관련 과거 이력 요약

- [[T-070-daily-bars-phase0]]: `daily_bars` 70,965행·93종목(KR 43·US 50)·사후검증 리포트 v1(4,079 시그널 → 336 에피소드). Reviewer 조건부×4 → Analyst 검토(10-24) 에서 위 결함·P1~P5 제안.
- [[T-072-validation-gate]]: 전략 16개 모두 `unvalidated` → 신규 매수 차단(G1~G6). 승급 조건이 P2 와 같은 자리.
- 사용한 교훈 ID: 없음(`/이슈기록 관련` 승인 교훈 0건 — 확인 필요 시 접수 때 재조회).

## 진행 기록

- 2026-10-26 15:3x: Leader 착수. 번호 T-095(T-094 는 앱 후속 절차 task 로 예약).
- 2026-10-26 16:10: Developer 구현 완료 → Reviewer 독립 감사 **CONDITIONAL_PASS**(조건 C1: 가격 없음 제외 행·최대 군집 비중 경고·H-D 판정 보류 라벨 / C2: v1 대비 같은 에피소드 비교 문장) → Leader 결정 **충족 방법 A(코드 반영)** → Developer 에게 조건 반영 지시, 반영 뒤 Reviewer 재감사(Reviewer 부터 재순환). Developer 가 보고한 "rsi D+5 −0.82%→−0.17%, H-D 지지→반대"는 **표본 구성 효과**였음이 감사에서 드러났다(같은 121건에서 d1open 은 −1.12% 로 오히려 나쁨) — 이 수치를 전략 결론·사용자 보고의 근거로 쓰지 않는다.

## Developer

- [15:53] 격리 worktree `~/.node-local/stockinvest-postmortem-t095`(브랜치 `postmortem-p1-t095`, base `53b97d9`)에서 구현 완료. 커밋 안 함. 바꾼 파일은 소유 파일 3개뿐: `scripts/profit-engine/postmortem-core.js`, `scripts/profit-engine/signal-postmortem.mjs`, `src/lib/profit-engine/__tests__/signal-postmortem-core.test.ts`. 새로 만든 파일: worktree 의 `agent-vault/10-Flow/reports/T-095-signal-postmortem-v2-{d1open,d0close}-20261026.md`. v1 리포트는 손대지 않았다.
- [15:53] 바뀐 점: ① `--entry-model legacy|d1open|d0close`(기본 legacy). d1open 은 D+1 시가 진입, d0close 는 D0 종가 진입이고 둘 다 `daily_bars` 원값만 쓴다(환율 없음). ② 가격 NULL 은 `price_missing` 으로 라벨링한다(legacy 는 라벨만 바뀌고 계속 제외, 일봉 모델은 평가). ③ 같은 날 유니버스 초과수익: `universeBaselines`·`attachBaselines` 가 시장 전 종목을 같은 진입 모델로 계산해 D0 봉 날짜 기준으로 붙인다. ④ D+10 구간과 자동 경고(n<30·주<8·경계 ±0.1%p). ⑤ v2 리포트(`renderReportV2`)는 정의를 맨 위에 둔다. ⑥ `--as-of`(시그널·주문 창 고정), `--bars-until`(새 봉 분리), `--no-compare`. 새 질의는 `signalsAsOf`·`ordersAsOf`·`barsAll`·`ordersSpan(AsOf)` 로 전부 SELECT 다. legacy 이고 as-of 가 없으면 v1 과 같은 질의 5개·같은 인자만 보낸다.
- [15:53] 그대로 둔 것: `signal-postmortem.mjs` 의 import 5개, `postmortem-core.js` 기존 export 의 시그니처와 기본(legacy) 계산 경로(export 는 추가만 함). 의도적으로 바꾼 동작은 하나다. 가격 NULL 의 `state` 값이 `'unit_unknown'` → `'price_missing'` 로 바뀐다(수치 영향 0, 수용 5 와 Analyst §5 첫 줄). `paper-fill.ts` 는 주석에서만 언급하므로 영향이 없다.
- [15:53] 수용 1 재현: `node scripts/profit-engine/signal-postmortem.mjs --env <메인 .env> --days 90 --as-of '2026-10-24 05:50:00' --out <scratch>` 를 돌리고 v1 파일과 `diff` 했다. 다른 줄은 4줄뿐이다(생성 날짜 2·생성 시각 1·표본 줄의 라벨 정정 1: "단위 불명 70" → "가격 없음 70 · 단위 불명 0"). 나머지 수치는 바이트 단위로 같다(에피소드 336·일봉 있는 258·rsi D+5 −0.82% [−1.71~0.06] 등). [확실] DB 확인 결과 일봉 최신 날짜는 KR·US 모두 10-23 이고 10-24 05:50 뒤 새 봉이 없다. `fetched_at` 이 05:50:14 까지 있는 행 3,200개는 v1 실행과 겹친 재수집 갱신으로 보이는데 결과가 같으니 값은 바뀌지 않았다 [가능성 높음]. as-of 없이 `--days 90` 을 돌리면 창이 이틀 밀려 시그널 3,766·에피소드 354 가 된다. 새 봉 때문이 아니라 창 이동 때문이며, 10-26 장중 신규 매수 시그널 93건 유입과 07-26~28 분 탈락이 원인이다. 그래서 `--as-of` 가 필요하다.
- [15:53] 수용 2: 단위 시험 2개가 증명한다. ① `evaluateSignal` 에 환율 1300·1400·1550·없음과 다른 원화 가격을 넣어도 d1open·d0close 의 ret·mae10·entryPrice·추세·returnStats 가 같다. ② `runPostmortem` 을 스냅샷 환율 1300 과 1500 으로 끝까지 돌려도 `rsi.byH`·`byMarket.US.byH`·`trend` 가 같다. 대조로 legacy 진입가는 달라진다. D+1 갭은 환율 의존이 남는다는 것도 시험이 명시한다.
- [15:53] 수용 3~6: 시험(`(T-095)` describe 4개, 16개 시험)과 v2 리포트 본문으로 확인했다. 같은 날 기준선은 독립 대조도 했다. 스크래치 SQL 의 `LEAD()` 창 함수로 계산한 값과 `universeBaselines` 가 6개 지점(KR·US × 08-20·09-15·10-01, d0close D+5·d1open D+5·D+10)에서 소수 6자리까지 일치한다(스크래치 `basecheck.mjs`, 저장소 밖).
- [15:53] 수용 7: `npx jest src/lib/profit-engine/__tests__/signal-postmortem-core.test.ts src/lib/profit-engine/__tests__/isolation.test.ts` 110/110 통과, 전체 jest 280 스위트 7,291 통과(skipped 149, 실패 0), `npx tsc --noEmit -p tsconfig.json` 0 오류. 로그는 `~/.node-local/t095-jest-3.log`·`t095-jest-full.log`·`t095-tsc.log`. 쓰기 SQL 0 이다(새 SQL 키도 기존 시험 "본체가 보내는 SQL 은 전부 가드를 통과·SELECT 로 시작"에 자동 포함). lint 는 못 돌렸다. worktree 에 ESLint 설정 파일이 없어 `next lint` 가 설정 생성 대화로 빠진다.
- [15:53] Analyst §5 지적 대응표:

| Analyst §5 지적 | 대응 위치(코드 / v2 리포트) |
|---|---|
| `:284-291` 가격 NULL → `unit_unknown`, 21% 탈락 | core `evaluateSignal` `priceStatus='price_missing'` 분기 / 리포트 "결론 먼저" 표본 줄 "가격 없음(price_missing) 에피소드 70건 — 평가 포함 70건", 상태별 표 `KR|ai_skipped`·`US|ai_skipped` 행. legacy 리포트 표본 줄도 "가격 없음 70 · 단위 불명 0" |
| `:643` STAT_HEAD·헤드라인 D+10 구간 없음 | `STAT_HEAD_V2` 의 "순 D+10 95% 구간" 열과 "자동 경고" 열 / 결론 rsi 문장의 "D+10 …(95% 구간 …, 주 군집 …)", 모델 비교 표의 legacy D+10 구간(v1 에 없던 값) |
| `:347-348`·`:354` 당일 만료 = D+1 프록시(하루 지정가 반사실)인데 리포트에 없음 | 정의 4번째 줄 "측정 대상은 라이브 전략이 아니다 … D+1 프록시 = 하루 걸어둔 지정가 반사실", 표 열 이름 "D+1 체결(지정가 프록시)", H-E 절 "당일 만료(… → D+1 프록시)" |
| H-B "[확실]" 은 건수에만 | `judge` v2 H-B 태그 `[확실](건수만)` + 근거 "주문 시각 first ~ last(서로 다른 날 N일) · [확실]은 건수에만" / 경고 목록 4번째 줄 |
| H-D US 차 = 임계(경계), 분할 14회, MA60 위 n=24 | `hdDiffs` 자동 경고(±0.1%p 경계·n<30) / H-D 판정 근거 "⚠ 다중비교: 이 분할은 14개 중 하나", 모델 비교 아래 "H-D 차 — 모델별 경계·표본 경고" 표(legacy US 차 1.01%p 에 경계·n=24 경고가 자동으로 붙음) |
| H-A 커버 183건 시장·기간 분해 없음 | `summarizeV2.haBreak` / "H-A 커버 분해(시장 × D0 월)" 표, H-A 근거에 표 안내 |
| `:376` h=1 라벨 정의(체결 당일) | 정의 2번째 줄 "D+h = D0 봉 다음 h번째 봉 종가 — d1open 의 D+1 은 진입 당일 … (v1 legacy 의 D+1 은 체결 봉 = 체결 당일 종가)" |
| 유니버스 무조건 수익 기준선 없음 | `universeBaselines`·`attachBaselines`·`returnStats.byH[h].excess` / 정의 3번째 줄(종목·가격·제외·최소 종목 수·날짜 일치·비용 처리), 표의 "초과 D+5/D+10(비용 전)"과 구간 열 |
| `:33` 다중비교(14 분할) 경고 없음 | 경고 목록 3번째 줄 "다중비교", "전략별 — ⚠ 다중비교" 절 제목, "H-D 추세 조건 분할 — ⚠ 다중비교(분할 14개)" |
| §1 환율 역산 1:1 의존 | d1open·d0close 진입(정의 1·5번째 줄 "환율 의존이 남는 것"), v2 rsi·H-D 태그에서 `capForFx` 하향을 빼고 H-C·H-E 는 환율 메모 유지 |

- [15:53] 확인 못 한 것·위험: ① v2 수치는 v1 결론과 방향이 꽤 다르다. 예: rsi 전체 비용 후 D+5 는 legacy −0.82% 에서 d1open −0.17%, 초과 D+5 는 +0.37%(구간이 0 포함)다. H-D 판정도 d1open 에서 "반대"로 뒤집힌다(KR 차 −5.94%p). 원인이 지정가→시장가 진입 정의 차이인지 환율 역산 편향인지 이 리포트로는 가를 수 없다 [추측]. ② KR `ai_skipped`(대부분 `price-breakout-v1` 37건)가 서로 다른 주 1개에 몰려 있어 KR D+10 평균을 끌어올린다(시장 KR d1open D+10 +3.19%, 구간 −4.86~11.25). 자동 경고가 그 행에는 붙지만 시장 합계 행에는 주 13개라 안 붙는다. ③ d0close 의 장 마감 뒤 시그널 5건은 낙관 근사다. ④ 기준선은 시그널 종목을 포함한 등가중 평균이다. ⑤ 전략 활성·비활성 결론은 내지 않는다(P2).
- [15:53] Reviewer 에게: 재현 명령은 위 수용 1 줄, v2 는 `--entry-model=d1open|d0close --as-of '2026-10-24 05:50:00'` 로 돌린다. 리뷰 대상 파일 scope 는 소유 3개다. 커밋 훅 `SAFETY_PATHS` 밖이라 훅은 강제하지 않는다.

## Reviewer

- [16:10] 감사 방법: Developer 보고를 믿지 않고 worktree(`~/.node-local/stockinvest-postmortem-t095`, 미커밋 3파일+새 리포트 2개)를 직접 읽고 실행했다. worktree·메인 트리 소스는 편집하지 않았다(변이·재현은 스크래치패드 복사본, DB 는 읽기 전용 세션·가드 래퍼 `q`). 작업 후 `git status` 가 시작 때와 같음을 확인했다.
- [16:10] 수용 1 재현 [확실]: `legacy --days 90 --as-of '2026-10-24 05:50:00'` 결과를 v1 리포트와 `diff` 하니 4줄만 다르다(생성 날짜 2·생성 시각 1·표본 줄 라벨 1). 더 강하게, base(`53b97d9`) 코어를 같은 질의로 돌려 비교했다: 시그널 4,079건 평가 객체 중 2,401건이 다르고 그 2,401건은 전부 `state: unit_unknown → price_missing` 라벨 하나뿐이며 그 밖 필드 차이 0건. 요약 객체는 추가 키(`excess`·`baseMean`·`priceMissing` 등)를 빼고 `price_missing` 을 `unit_unknown` 으로 되접으면 키 정렬 후 완전 일치, 판정 행·rsi 권고도 완전 일치. Developer 의 "라벨만 바뀐다" 주장이 맞다(수용 4의 legacy 부분 포함).
- [16:10] 수용 2 환율 무관 [확실]: 코드 추적 — 일봉 모델의 수익·MAE·추세는 `entryFromBars(bars,i0,model,d0)`(core :420-428)와 `bars` 만 쓰고, 기준선 `universeBaselines` 도 `bars` 만 쓴다. `fx`·`ctx.fxForSignal` 은 `p`·`gapD1`·`fillD1`·`wouldFill`·H-C·H-E 에만 들어간다. 실데이터 시험: 스냅샷 USD 행 환율을 ×1·×1.25·×0.8 로 바꿔 `runPostmortem` 을 끝까지 3번 돌리니 d1open·d0close 의 수익·MAE·추세·5분위·전략별·상태별·기업행위·초과수익 통계가 전부 바이트 단위로 같고, legacy 는 같지 않다. D+1 갭·체결률·H-C·H-E 는 리포트가 말한 대로 환율에 따라 달라진다. 환율 누수 변이(M26)는 시험 2개가 죽인다.
- [16:10] 수용 3 통계·기준선 [확실]: D+5·D+10 구간은 같은 `clusterCi95`(D0 주 군집, 자유도 G−1)이고 D+10 순수익 구간은 base 에도 `byH[10].net` 으로 이미 계산되던 값이라 방식이 같다. 초과수익은 같은 함수에 주 키를 그대로 쓴다. t 임계 표 df 1~30 은 전부 맞다. 독립 SQL(창 함수 `LEAD`/`ROW_NUMBER`, 읽기 전용)로 KR·US × 날짜 5개(08-20·09-02·09-15·10-01·10-08) × h=5·10 × d0close·d1open = 40개 지점을 재계산했고 n 과 평균이 `universeBaselines` 와 1e-9 이내로 40/40 일치한다. 한계: 이 데이터에는 기업행위 의심 창·9일 초과 결측 창이 0건이라 실데이터로는 제외 경로를 실행하지 못했다(제외 건수 0/0).
- [16:10] 시그널 종목이 기준선에 포함되는 편향 평가 [확실, 산술]: 유니버스 93종목 중 시그널 종목이 KR 43/43·US 47/50 이라 "시그널 종목 제외 기준선"은 만들 수 없다(KR 0종목). 자기 종목 포함 효과는 정확히 `excess_LOO = excess × n/(n−1)`(n=43~50)이라 초과수익이 약 2.0~2.3% 상대 크기만큼 작게 나올 뿐 부호·구간 판단에는 영향이 없다. 더 큰 문제는 기준선이 "시장"이 아니라 이 93종목 등가중 관심목록 평균이라는 점이다. 리포트 정의는 "그 시장 전 종목"이라 적어 오해를 부른다(발견 M-1).
- [16:10] 수용 4·5: `evaluateSignal` 의 `priceOk` 분기(core :301-320)로 가격 NULL 은 `price_missing`, 가격은 있는데 비율이 어느 범위에도 안 맞는 경우만 `unit_unknown` 이다. d1open·d0close 는 가격 없음을 평가(70건 전부 평가에 들어감), 실데이터 `unit_unknown` 은 0건. 가격 NULL 시그널 원시 2,401건이 전부 `ai_skipped` 임을 SQL 로 확인했다.
- [16:10] 수용 7 격리·안전 [확실]: `signal-postmortem.mjs` import 는 정확히 `node:fs`·`node:path`·`node:url`·`mysql2/promise`·`./postmortem-core.js` 5개(격리 시험 통과). `postmortem-core.js` export 는 base 목록 전부 유지+추가만(ENTRY_MODELS·UNIVERSE_MIN_N·MIN_N_WARN·HD_THRESHOLD·BOUNDARY_BAND·entryFromBars·universeBaselines·attachBaselines·renderReportV2·ciWarn·isBoundary·hdDiffs). 새 SQL 5개(`signalsAsOf`·`ordersAsOf`·`barsAll`·`ordersSpan`·`ordersSpanAsOf`)는 전부 `SELECT`, 내 실행에서 모두 `assertReadOnlySql` 래퍼를 통과해 나갔고 시험 "본체가 보내는 SQL 은 전부 가드"가 `Object.values(SQL)` 로 자동 포함한다. `SET SESSION TRANSACTION READ ONLY` 유지, 가드는 `WITH` 도 거부하는 보수적 허용 목록이라 내 시험 SQL 은 파생 테이블로 감싸야 했다. `src/lib/signals/paper-fill.ts` 는 주석 한 줄(:8)에서만 `postmortem-core` 를 언급하고 import 0·worktree 미변경이라 영향 0. 코어를 쓰는 다른 소비자는 시험·mjs 뿐이다(저장소 grep).
- [16:10] 수용 8 시험 [확실]: `npx jest src/lib/profit-engine` 7 스위트 217/217 통과(격리 시험 포함). 전체 jest 280 스위트 통과·4 스킵·테스트 7,291 통과(Developer 주장과 일치), `tsc --noEmit` 종료코드 0·출력 없음. ESLint 설정 파일이 메인 트리에도 저장소에도 없어 lint 는 이 프로젝트의 관문이 아니다(Developer 의 "못 돌렸다"는 사실이나 결함 아님).
- [16:10] 변이 시험 [확실]: 코어 복사본에 변이 35종(진입가 선택 3·초과수익 빼기 3·기준선 정의 4·구간 df·군집키 2·경계·경고 임계 5·price_missing 분기 3·환율 누수 1·질의 인자·SELECT 가드 2·리포트 열 3·기타 9)을 하나씩 적용해 기존 64개(새 16개 포함) 시험을 돌렸다. 25종은 죽고 10종이 살아남았다. 생존: M04 초과수익이 기준선의 다른 h(`e.base[1]`)를 써도 통과(시험 픽스처가 h 마다 같은 기준선을 씀) · M10 경계 `<=`→`<`(정확히 ±0.1%p 가장자리 미시험) · M19 `--bars-until` 경계 `>`→`>=` · M20 `runPostmortem` 이 기준선 모델을 항상 d0close 로 고정해도 통과(통합 시험이 d1open 과 d0close 기준선을 구분 안 함 — 출력은 실제로 두 모델 값이 다르므로 현재 동작은 맞음) · M21 기준선 9일 결측 창 제외 무력화(시험이 기업행위 창만 검증) · M25 MAE 창 시작 `i0+1`→`i0`(픽스처에서 D0 봉 저가가 D+1 보다 높아 구분 못 함) · M27 리포트 D+10 구간 열에 D+5 구간 출력 · M28 비교표 초과 D+10 열에 D+5 출력 · M29 H-A 분해 `<`→`<=` · M34 d1open 시가 0 가드 제거. 보강 권고: h 마다 다른 기준선 값으로 `attachBaselines` 시험, `runPostmortem` d1open 의 `base[5]` 가 `universeBaselines(...,'d1open')` 값과 같고 d0close 값과 다름을 단언, 9일 결측 창 제외 시험, D0 봉 저가가 최저인 MAE 시험, 리포트 D+10 구간·초과 열의 실제 값 단언.
- [16:10] 리포트 사실성 — 맞는 것 [확실]: H-B "매수 주문 12건 전부 거부, 2026-08-12 15:13~15:29, 서로 다른 날 1일"과 유니버스 KR 43·US 50, 환율 역산 2·3차 135/142(95.1%), "라이브 매수 시그널은 승인 TTL 30분 지정가"(`router.ts` 기본 TTL 30, 승인 메시지 "지정가 주문")를 SQL·코드로 확인했다. 정의 절의 D+1 프록시·h=1 라벨(d1open 의 D+1=진입 당일, legacy 의 D+1=체결 당일)·다중비교 14개·H-D 경계 경고(legacy US 1.01%p 가 경계·n=24 로 자동 표시)·H-B [확실](건수만)·H-A 커버 분해 표는 코드와 일치한다. 비밀·계좌·토큰·금액 절대값은 두 리포트 모두 없다(패턴 검색, 건수·비율만).
- [16:10] **발견 H-1 (HIGH, 리포트 정확성)**: rsi 헤드라인과 H-D "반대" 판정이 가격 없음(`ai_skipped`) 에피소드 소수와 한 주 집중에 좌우되는데 리포트가 이를 보여 주지 않는다. [확실, 내 계산] ① rsi 전체 d1open 비용 후 D+5 는 포함 시 −0.17%(구간 −1.48~1.14, n=164)지만 가격 없음 14건을 빼면 −0.86%(−1.60~−0.11, n=150)로 구간이 0 을 제외하고, D+10 은 −0.39%(−3.24~2.47)에서 −2.02%(−3.76~−0.28)로 바뀐다. 초과수익도 +0.37%/+0.43% 에서 −0.07%/−0.52% 로 부호가 바뀐다(d0close 도 같은 경향). 그 14건의 D+5 평균은 +7.20%(D+10 11건 +16.99%)이고 상위 에피소드에 한화(000880, D0 봉이 `zero_volume` 이월 가격) +34.7% 등이 있다. ② H-D KR: 07-27 주 하나에 KR 에피소드 42건(전부 가격 없음 `ai_skipped`, `price-breakout-v1` 37)이 몰려 KR D+10 표본 121건의 35% 이고, 이 주를 빼면 KR 시장 D+10 이 +3.19%→−1.56%, MA60 아래 +4.91%→−1.69%, H-D KR 차가 −5.94%p→+0.38%p 가 된다. 즉 "반대(하락 추세 매수가 더 나음)" 라벨은 그 한 주의 산물이다. 자동 경고는 n<30·주<8 만 보고 집중도를 보지 않아 이 행들에는 경고가 안 붙는다(`ciWarn` core :690-697, H-D 판정 :784-803, 구간 계산은 정상이지만 H-D 규칙은 구간을 쓰지 않음). 수용 기준 4 가 가격 없음 포함을 요구했으므로 계산은 명세대로이나 헤드라인이 이 민감도를 숨긴다.
- [16:10] **발견 H-2 (HIGH, 리포트 정확성)**: v1→v2 방향 변화(rsi D+5 −0.82%→−0.17%, H-D "지지"→"반대")의 원인이 구분 불가([추측])라는 Developer 의 주장은 두 리포트에 아예 적혀 있지 않다(리포트에서 "v1 대비"·"방향"·"원인" 문장 0건). 게다가 대부분은 구분 가능하다 [확실, 내 계산]: legacy 가 D+5 로 평가한 같은 rsi 121건에서 d1open 은 −1.12%(legacy −0.82%)로 오히려 더 나쁘고(US 76건 −0.85% vs −1.21%, KR 45건 −0.78% vs −0.95%), D+10 도 같은 95건에서 −2.44% vs −2.17% 다. "개선"의 전부는 표본 구성이다 — d1open 에만 들어온 43건 = 가격 없음 14건(+7.20%)+지정가 미체결 29건(+0.23%). legacy 의 체결 선택(가격이 내려와야 체결) 효과와 가격 없음 포함 효과를 환율 역산 편향과 분리하지는 못하지만(US 같은 표본 차 0.36%p 는 환율 오차와 "지정가가 시가보다 싸다"는 구조 효과의 합), 방향 반전을 환율 때문이라 읽게 둘 수는 없다.
- [16:10] **발견 H-2 에 대한 (a)·(b) 판정**: (a) 리포트는 정직하게 쓰지 않았다 — 비교 표만 있고 설명이 없어 독자가 H-D 반전을 오독할 수 있다. 위 분해를 리포트에 넣어야 한다. (b) KR `ai_skipped` 쏠림은 계산 결함이 아니라 **자동 경고 설계의 누락(집중도 검사 없음)이고, 결과가 시장 합계 행에 그치지 않고 rsi 헤드라인과 H-D 판정까지 번진다** — 결함으로 판정한다(Developer 보고의 "시장 합계 행에 경고가 안 붙는다"는 영향 범위를 과소 서술).
- [16:10] 발견 M-1 (MEDIUM): 리포트 정의 절(`renderReportV2` core :1018)의 "그 시장 전 종목"은 93종목 관심목록(시그널 종목이 97%)이라 "시장" 기준선으로 읽히면 안 된다. "수집 유니버스 93종목 등가중 평균, 시그널 종목 약 97% 포함(제외 기준선 불가), 자기 포함 효과 약 2%"로 고칠 것.
- [16:10] 발견 M-2 (MEDIUM): 시험 공백 — 위 생존 변이 10종 중 M04·M20·M21·M25 가 실질 공백(기준선의 h·모델 대응, 결측 창 제외, MAE 창). 표본 열 값 단언도 없다.
- [16:10] 발견 M-3 (MEDIUM): H-A "지배적 후보 [가능성 높음] 182/183(99.5%)" 행에 Analyst(10-24 §1)가 적은 "현금이 카드·슬롯 금액보다 작으면 항등식" 단서가 없다. 수용 기준 5 범위 밖이라 필수는 아니다.
- [16:10] 발견 L-1 (LOW, 잠복): 시그널 수익 통계는 기업행위 의심 봉이 걸린 창을 포함(`returnStats` 주석 :509)하는데 기준선은 그런 창을 제외(core :463-472)한다. 현재 두 쪽 모두 0건이라 영향 없으나 0 이 아니게 되면 초과수익에 비대칭이 생긴다. L-2: `zero_volume` 플래그 봉은 걸러지지 않아(`adj_stale`·`adj_orphan` 만 제외) d0close 진입가가 이월 가격일 수 있다(한화 사례, [추측] 영향 크기 미측정) — 중앙값 열 또는 극단값 점검 권고. L-3: t 임계는 df 31~60 에서 2.0(실제 2.04~2.00), df 61~120 에서 1.98(실제 2.00~1.98)로 약간 좁다(기존 코드, 현 표본 G≤13 이라 영향 없음). L-4: `baseMean` 은 계산만 되고 리포트에 안 쓰이며 `--json` 에 추가 키가 생긴다(소비자 없음).
- [16:10] QA 가 집중할 곳(high_risk_areas): core :301-320(가격 없음 분기)·:419-429(일봉 진입)·:456-500(기준선)·:690-697(경고)·:784-803(H-D); 빈 표본·가격 NULL·휴장일(d0 비거래일)·상장 전 종목·`--as-of` 경계(시그널 창 끝 포함 `<=`)·`--bars-until` 경계. 크기·정의 경계에서 legacy 재현(diff 4줄)이 깨지지 않는지.
- [16:10] 조건(조건부 통과의 충족 요건): C1(필수) 리포트 두 개가 위 발견 H-1 을 드러내야 한다 — (i) rsi 전체 D+5·D+10 을 "가격 없음 제외" 행과 나란히 표시하고 (ii) KR 집중(07-27 주 42건=KR D+10 표본 35%)을 H-D·KR 행에 명시하고 H-D 판정은 "표본 집중 — 판정 보류" 수준으로 낮춘다. 코드로 구현하면(자동 경고에 최대 군집 비중 기준 추가·가격 없음 제외 병기·시험 추가·리포트 재생성) Reviewer 부터 재순환이고, 코드 불변이면 Leader 가 두 리포트에 "검토 주석" 절을 붙이는 것으로 충족하되 수치는 이 기록의 값을 쓴다. C2(필수) 발견 H-2 의 같은 에피소드 비교 문장(121건 −0.82% vs −1.12%, d1open 전용 43건 구성)을 리포트에 넣는다. M-1 문구 정정과 M-2 시험 보강은 같은 수정 때 권고(필수 아님).
- [16:10] **최종 판정: CONDITIONAL_PASS (scope: scripts/profit-engine/postmortem-core.js, scripts/profit-engine/signal-postmortem.mjs, src/lib/profit-engine/__tests__/signal-postmortem-core.test.ts)**

## QA

## 배포 기록

(스크립트·시험만 바뀐다 — 배포 대상 아님. 커밋 후 push 는 다음 배포에 동승.)

## Codex 검토

## 최종 요약

(완료 시 Leader 가 작성)

## 데모 검토 (demo gate)

> 실행 판정 정본은 frontmatter `demo_gate` 이다. 이 표는 check.mjs 가 함께 기록하는 사람용 이력이다(docs/demo-review-gate.md).

| 버전 | 상태 | 저장소 파일 | Artifact | 사용자 결정 | 일시 |
|---|---|---|---|---|---|
| - | 해당없음 | - | - | judge: none | 10-26 15:3x |
