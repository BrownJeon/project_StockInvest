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
- `scripts/profit-engine/` 는 커밋 훅 `SAFETY_PATHS` 밖이다(워크스페이스 S00 보고서 §3.3: 금전 영향 경로가 감시 밖). **이 task 는 Reviewer 판정을 스스로 요구한다**(`## Reviewer` 마지막 `최종 판정: PASS (scope: …)` 줄) — 훅이 강제하지 않으므로 Leader 가 확인 뒤 커밋한다. 커밋 훅 경로(`src/lib/signals/` 등)를 만지게 되면 훅이 강제한다.

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
