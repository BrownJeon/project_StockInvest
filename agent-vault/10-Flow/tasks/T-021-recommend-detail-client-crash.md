---
id: T-021
title: 추천 시그널 상세 클릭 시 "Application error" 클라이언트 크래시
status: review
created: 2026-08-11
updated: 2026-08-11
owner: leader
tags:
  - type/task
  - domain/ui
  - domain/signals
aliases:
  - 추천 상세 크래시
  - Application error 클라이언트 예외
related_tasks:
  - "[[T-016-recommend-build-page-invalid-id]]"
---

# T-021 — 추천 시그널 상세 클릭 시 "Application error: a client-side exception has occurred"

## 1. 사용자 신고

추천(recommend) 목록에서 생성된 시그널을 **클릭하면** 상세 화면 대신
`Application error: a client-side exception has occurred` 가 뜬다.
사용자 요청: **"테스터가 에러를 재현하고, 실패내역을 수정해달라"**

## 2. Leader 사전 진단 (QA는 이걸 *검증·정밀화* 하는 데서 시작 — 처음부터 다시 찾지 말 것)

### 2.1 재현 대상

- 경로: `/recommend/17211`
- signal id `17211` / symbol `012330` / side `buy` / status `pending`
- 생성 2026-08-11 16:00:50 KST · `scenario_source='post-market'`
- 오늘 살아있는 pending 시그널이라 **추천 목록에 노출되고 지금 클릭 가능하다.**

### 2.2 크래시 지점 (가설)

`src/components/ScenarioDetail.tsx:418`

```tsx
{sc && sc.risk_factors.length > 0 && (
```

`sc`(= `signal.indicators?.ai?.scenario`)가 truthy 인데 `sc.risk_factors` 가 `undefined` 면
`.length` 접근에서 `TypeError: Cannot read properties of undefined (reading 'length')` 가 던져지고,
**React 렌더 중 예외 → 라우트 전체가 Next.js 기본 "Application error" 화면으로 대체**된다.

### 2.3 실측 데이터 (DB 직접 조회, 읽기 전용)

signal 17211 의 `indicators.ai.scenario` 실제 값:

```json
{"grade":"B","entry":{"trigger":"price_zone","price_zone":"494000~497000"},
 "exit":{"target_pct":3.5,"stop_pct":1.8,"holding_days":"2일","holding_deadline":"2026-08-14"}}
```

→ `risk_factors` · `why_now` · `context` · `ev` · `exit.trailing_activate_pct` 가 **전부 없다.**

### 2.4 타입과 실데이터의 괴리 (구조적 원인)

시나리오 타입이 **두 벌** 존재하고 서로 다르다.

| 위치 | 성격 | 문제 |
|---|---|---|
| `src/lib/signals/scenario-builder.ts` `ScenarioCard` | **생산자** 타입. `buildScenarioFromAiResult()` 가 전 필드를 항상 채우므로 required 가 맞다 | — |
| `src/components/ScenarioCard.tsx` `SignalWithScenario.indicators.ai.scenario` | **소비자(=DB JSON 읽기)** 타입인데 `risk_factors: string[]`·`why_now: string`·`context: string`·`ev: number`·`exit.target_pct: number` 를 **required 로 선언** | DB JSON 은 그 계약을 지킬 의무가 없다. **타입이 거짓말을 하고 있어서 컴파일러가 이 크래시를 잡지 못했다** |

### 2.5 생성 위치 — 왜 필드가 비는가

`src/lib/strategy/post-market-engine.ts:251-272` 이 만드는 `indicators.ai.scenario` 객체가
애초에 `grade`/`entry`/`exit` 만 채우고 나머지 5개 필드를 넣지 않는다. 그대로 INSERT 된다.
반면 `scenario-builder.ts` 경로(장중 AI / 사용자 "내 시나리오")는 전 필드를 채운다 → **"정상" 케이스만 눈에 보였다.**

### 2.6 만성 문제임을 확인함

`signals` 에서 `ai.scenario` 는 있는데 `risk_factors` 가 없는 신호의 날짜별 집계(읽기 전용):
**2026-06-09 ~ 08-11 거의 매일 발생**(06-25 하루만 예외).
즉 **post-market 엔진이 만든 매수 시그널을 클릭하면 거의 항상 이 에러가 났다.**
과거 것들은 대부분 `expired` 라 지금은 클릭되지 않을 뿐이다.

### 2.7 인접 위험 (같은 클래스, 이번엔 발화 안 함)

- `ScenarioDetail.tsx:390` — `(sc.ev * 100).toFixed(0)` : `ev` 없으면 크래시는 아니지만 **화면에 `NaN%` 가 EV 로 표시된다** (거짓 수치 노출)
- `ScenarioDetail.tsx:393·399` — `sc.exit.target_pct` : `sc &&` 로만 가드, `sc.exit` **자체는 무가드**
- `ScenarioDetail.tsx:448` — `sc?.entry.price_zone` : `sc?.` 는 sc 만 가드, `entry` **무가드**
- `ScenarioCard.tsx:72-77` — `scenario?.exit.target_pct` 등 : 같은 패턴. **목록 화면도 `exit` 없는 데이터엔 크래시**
- 이번 케이스는 `entry`·`exit` 가 존재해서 살았을 뿐이다.

### 2.8 방어 경계 부재

`src/app/` 전체에 `error.tsx` / `global-error.tsx` 가 **하나도 없다.**
그래서 렌더 예외가 앱 경계까지 그대로 올라가 Next.js 기본 "Application error" 화면이 뜬다
(사용자가 본 그 화면). **현재 이 앱은 어떤 화면이 깨져도 사용자에게 아무 정보도 주지 못한다.**

## 3. Leader 범위 판단 (Developer 는 이 결정을 그대로 따른다)

### ✅ (a) 방어적 렌더링 — **필수, 이번 범위**

`ScenarioDetail.tsx` + `ScenarioCard.tsx` 가 **DB JSON 을 신뢰하지 않도록** 고친다.

- 소비자 쪽 시나리오 타입을 **실데이터를 반영해 옵셔널로 정정**한다.
  `entry?` · `exit?` · `risk_factors?` · `why_now?` · `context?` · `ev?` · `holding_days?` · `holding_deadline?`
  → 타입을 정직하게 만들면 **컴파일러가 나머지 무가드 지점을 자동으로 찾아준다.** 이것이 이번 수정의 핵심 레버다.
- 없는 필드의 섹션·배지는 **그냥 렌더하지 않는다**(빈 값·`—`·`NaN` 대신 부재).
  - `risk_factors` 없음 → 리스크 요인 섹션 미표시
  - `ev` 없음/비유한 → **EV 박스 미표시** (지금의 `NaN%` 제거)
  - `exit`/`entry` 없음 → 해당 항목만 미표시, 나머지 화면은 정상 동작
- **AI 평가 섹션 전체가 빌 수 있다** — 그때 빈 껍데기 섹션이 남지 않게 할 것.
- `handleApprove()` 의 `scenario: sc ?? {...}` 폴백(282행)도 함께 점검 — 부분 결측 `sc` 를 그대로 POST 하면
  서버가 required 를 가정할 수 있다. **`/api/signals/custom/confirm` 이 무엇을 요구하는지 확인 후 대응**할 것.

### ❌ (b) post-market-engine 필드 보강 — **이번 범위에서 제외 (Leader 결정)**

`src/lib/strategy/post-market-engine.ts` 는 **건드리지 않는다.** 필드별 근거:

| 필드 | 판단 | 근거 |
|---|---|---|
| `why_now` | **채우지 않음** | 유일한 후보인 `d.reasoning` 은 **이미 `reasoning` 본문(274-278행)에 들어가 상세 화면 "분석 사유" 로 표시된다.** `why_now` 에 넣으면 같은 문장이 한 화면에 두 번 뜬다 — 정보 증가 0, 잡음만 증가 |
| `risk_factors` | **채우지 않음** | post-market 프롬프트에 리스크 요인 산출이 없다. 만들려면 프롬프트·AI 출력 스키마 변경 = analyst 개입 + 별도 범위. `[]` 로 채우는 것은 (a) 방어적 렌더링과 결과가 동일하므로 무의미 |
| `context` | **채우지 않음** | 출처 없음 |
| `ev` | **채우지 않음 — 명시적 거부** | `confidence` 로 EV 를 유도할 수 있지만, LLM 자기신고 confidence 는 **보정된 승률이 아니다.** 그걸 승률로 써서 EV 를 만들면 *측정값처럼 보이는 지어낸 숫자* 가 화면에 뜬다. 이 프로젝트가 T-007·T-012·T-014·T-018 내내 없애온 **"거짓 데이터"의 재발**이다 |
| `exit.trailing_activate_pct` | **채우지 않음 — 단, 조사 필요** | 이건 표시 문제가 아니라 **매매 로직 문제일 수 있다.** 값이 없어 트레일링 스탑이 조용히 비활성이면 실자금 영향이다. **Developer 는 값을 넣지 말고, exit 로직이 이 필드 부재를 어떻게 처리하는지 읽어서 사실만 보고**할 것 → 실제 공백이면 Leader 가 백로그로 분리한다 |

> `post-market-engine.ts` 는 `signals` INSERT 경로다. UI 크래시를 고치자고 실거래 시그널 생성 경로를
> 같은 사이클에 건드리지 않는다. **UI 는 어차피 결측을 견뎌야 한다 — 과거 데이터는 소급 수정되지 않으므로.**

### ✅ (c) `src/app/error.tsx` 추가 — **이번 범위에 포함 (Leader 결정)**

근거: 실계좌 실거래 중인 앱에 **렌더 예외 경계가 단 하나도 없다.** 오늘 이 크래시가 그 사실을 드러냈고,
(a) 로 이 케이스를 막아도 **다음 결측 필드에서 똑같이 백지 화면이 된다.**

범위는 최소로:
- `src/app/error.tsx` **하나만** 추가 (App Router 에서 하위 라우트 전체를 덮는다). `global-error.tsx` 는 만들지 않는다 — 루트 레이아웃 오류라는 별개·희소 케이스이고 이번 근거와 무관하다.
- 내용: "이 화면에 문제가 발생했습니다" + **다시 시도** + **뒤로가기**. `error.digest` 표시(문의 시 식별자).
- `useEffect` 로 `console.error` 로깅. **외부 전송·알림 배선 금지**(이번 범위 아님).
- `'use client'` 필수. 스타일은 기존 `var(--bg)`/`var(--text)`/`var(--muted)`/`var(--danger)` 토큰 사용, 모바일 412px 기준.

## 4. 역할별 지시사항

### 4.1 QA (1차 — 재현 검증) ⏱ 짧게

**이미 답을 아는 상태의 확인 작업이다. T-018~T-020 때보다 짧아야 한다.**

1. signal 17211 의 **현재 상태 재조회**(status 가 아직 `pending` 인지, scenario JSON 이 §2.3 과 같은지). 읽기 전용 SELECT 만.
2. 코드를 읽어 **크래시 경로를 독립적으로 재추적** — 418행이 정말 첫 발화 지점인가? 그 앞(390행 `sc.ev`)에서 먼저 죽지는 않는가?
3. **코드 레벨 재현**: 실제 JSON 을 입력으로 렌더 경로가 던지는지 확인. 브라우저 클릭은 로그인 세션이 없어 불가할 수 있음(T-016 제약) — 그러면 **그 사실을 명시하고** 코드 레벨 재현으로 대체.
4. 결측 사례 2~3건 추가 확인(다른 날짜/다른 심볼) — 만성 문제 주장(§2.6)의 뒷받침.
5. 결과를 아래 QA 섹션에 기록.

### 4.2 Developer

§3 의 (a) + (c) 를 구현한다. (b) 는 **조사만**.
`npm run typecheck` + `npm test` 로 self-check. **`npm run build`·`npm install`·dev 서버 기동 금지.**
회귀 방지 테스트를 추가할 것 — 특히 "필드가 결측된 시나리오"를 입력으로 하는 케이스.

### 4.3 Reviewer

- (a) 가 **의도를 충족하는가**: 결측 필드에서 크래시 없이 우아하게 렌더되는가, 기존 정상 데이터(전 필드 존재)에 **회귀가 없는가**.
- 타입 옵셔널화로 **다른 호출처가 깨지지 않는지** 전수 확인(같은 타입을 쓰는 파일 전체).
- (c) `error.tsx` 가 **에러 내부 정보를 과다 노출하지 않는지**(스택·env·API 키 흔적).
- `post-market-engine.ts` 가 **실제로 무변경인지** 확인 — 변경됐다면 signals INSERT 경로이므로 안전장치 우회·정상 케이스 회귀를 반드시 감사.
- 이번 변경은 순수 UI 렌더링이라 주문·자금 경로와는 무관하다. 그 전제가 맞는지도 확인.

### 4.4 QA (2차 — 최종 검증)

- signal 17211(또는 재현 시점에 여전히 pending 인 유사 시그널)의 실제 JSON 으로 수정된 렌더 경로가 크래시 없이 통과하는지.
- 전 필드 존재하는 "정상" 시나리오도 **표시가 그대로인지**(회귀).
- `npm run typecheck` · `npm test` 실행 결과 기록.
- 브라우저 실클릭이 불가하면 **그 제약을 명시**하고 코드 레벨 검증으로 대체(조용히 건너뛰지 말 것).

## 5. 제약 (이전 작업과 동일 — 위반 금지)

- 검증은 **`npm run typecheck` / `npm test` 만**. `npm run build`·`npm install`·dev 서버 기동 **금지**(이 NFS 경로가 곧 운영 배포 경로).
- **새 의존성 금지.**
- **git commit / push / stash 절대 금지.** pm2 재시작·재배포 금지.
- **DB 쓰기 금지 — SELECT 만.** 특히 **과거 결측 시그널을 백필하거나 정리하지 말 것**(이번 범위 아님).
- 안전 설정(`system_config.safety_*`) 변경 금지.
- 작업물은 **미커밋 상태로 남겨** 사용자 승인을 기다린다.
- 스킵·미판정은 조용히 넘기지 말고 **흔적을 남긴다.**

---

## QA 기록 (1차 — 재현 검증)

### [17:24] signal 17211 현재 상태 재조회 완료

DB 직접 조회 결과 (SELECT 읽기 전용):

```
id: 17211
symbol: 012330
side: buy
status: pending (현재 클릭 가능)
scenario_source: post-market
created_at: 2026-08-11 16:00:50
scenario_json: {"grade": "B", "entry": {"trigger": "price_zone", "price_zone": "494000~497000"}, "exit": {"target_pct": 3.5, "stop_pct": 1.8, "holding_days": "2일", "holding_deadline": "2026-08-14"}}
```

**진단 일치**: 실제 JSON이 task §2.3과 정확히 일치.
- `risk_factors` = undefined (결측)
- `why_now` = undefined (결측)
- `context` = undefined (결측)
- `ev` = undefined (결측)
- `entry`, `exit` = 존재 ✓

### [17:25] ScenarioDetail.tsx 크래시 경로 추적

코드 읽기 결과 (422행):

```tsx
322:  const sc = signal.indicators?.ai?.scenario;
...
379:  {sc && (
  ...
390:      {(sc.ev * 100).toFixed(0)}%   ← undefined * 100 = NaN, NaN.toFixed(0) = "NaN" (예외 없음)
...
393:      {sc.exit.target_pct != null && (       ← sc.exit 존재, target_pct=3.5 (조건 통과)
...
399:      {sc.exit.stop_pct != null && (         ← sc.exit 존재, stop_pct=1.8 (조건 통과)
...
418:  {sc && sc.risk_factors.length > 0 && (   ← ⚠️ sc는 truthy인데 sc.risk_factors = undefined
                                                  → TypeError 발생!
```

**결론**: 418행이 정말 첫 크래시 지점. 390행은 NaN 표시일 뿐 예외 아님.

#### 인접 위험 확인

- 390행(`sc.ev * 100`): undefined → NaN → "NaN%" 표시 (화면에 거짓 수치 노출, 예외 없음) ✓ (§2.7 지적 일치)
- 393행(`sc.exit.target_pct`): 실제 exit 객체가 존재하고 필드도 있음 → 조건 통과 ✓
- 399행(`sc.exit.stop_pct`): 같음 ✓
- 448행(`sc?.entry.price_zone`): entry 객체 존재, price_zone 존재 → 통과 ✓

왜 이 JSON에선 393, 399, 448행은 안 죽는가: **exit, entry가 객체로 존재하기 때문**. 이번엔 risk_factors 필드만 빠졌을 뿐.

### [17:26] 코드 레벨 재현 (node -e)

실제 signal 17211 JSON을 입력으로 렌더 경로 시뮬레이션:

```javascript
const sc = {
  "grade": "B",
  "entry": {"trigger": "price_zone", "price_zone": "494000~497000"},
  "exit": {"target_pct": 3.5, "stop_pct": 1.8, "holding_days": "2일", "holding_deadline": "2026-08-14"}
};
```

실행 결과:

```
[Step 1] sc 객체 존재: true
[Step 2] sc.ev 값: undefined → sc.ev * 100 = NaN → .toFixed(0) = "NaN"  (예외 없음)
[Step 3] sc.exit 존재: true
[Step 4] sc.exit.target_pct: 3.5
[Step 5] sc.exit.stop_pct: 1.8
[Step 6] sc.risk_factors 값: undefined
[Step 7] sc.risk_factors.length 접근 시도...
  → [ERROR] TypeError: Cannot read properties of undefined (reading 'length')
```

**실증 완료**: 418행에서 정확히 이 예외가 발생.

브라우저 실클릭 불가 이유: 로그인 세션 부재 (T-016 제약과 동일) → 코드 레벨 재현으로 대체함.

### [17:27] 결측 사례 추가 조회 (만성 문제 검증)

#### (1) 날짜별 결측 발생 추이

```
2026-08-11: 1건 (012330=17211)
2026-07-19: 1건 (005380)
2026-07-18: 1건 (005380)
2026-07-17: 1건 (005380)
2026-07-16: 1건 (005380)
2026-07-15: 2건 (005380, 096770)
2026-07-13: 1건 (247540)
...
2026-06-16: 2건 (011200, 041510)
```

**§2.6 검증**: 과거 2개월간(06-16~08-11) 거의 매일 risk_factors 결측이 발생함. task 진단 정확.

#### (2) 현재 클릭 가능한(pending) 결측 시그널 조회

```
id: 17211 (유일함)
symbol: 012330
side: buy
status: pending
scenario_source: post-market
```

**결론**: 사용자가 지금 클릭할 수 있는 크래시 경로는 17211 **1건**. 과거 발생했던 것들은 expired 상태라 현재 노출 안 됨. 하지만 post-market 엔진이 계속 같은 구조로 시그널을 생성 중이므로, 내일·내일모레도 같은 문제가 반복될 위험.

#### (3) 과거 만료 시그널 샘플 (같은 구조)

```
id 12364 (2026-07-19): 005380, post-market, {"grade":"B","entry":{...},"exit":{...}}
id 12363 (2026-07-18): 005380, post-market, {"grade":"B","entry":{...},"exit":{...}}
id 12342 (2026-07-17): 005380, post-market, {"grade":"B","entry":{...},"exit":{...}}
```

이 3건 모두 **risk_factors, why_now, context, ev가 없고 entry, exit만 있는 구조**. post-market-engine.ts의 systematic 결함 확인.

### [17:28] QA 검증 완료

- ✅ signal 17211의 현재 상태 및 시나리오 JSON이 leader 진단과 **정확히 일치**
- ✅ 418행이 **첫 크래시 지점** (390행 `sc.ev`는 NaN만 나올 뿐 예외 아님)
- ✅ 코드 레벨 재현으로 **실제 예외 메시지** 캡처: `TypeError: Cannot read properties of undefined (reading 'length')`
- ✅ 결측 사례 여러 건 확인 → **만성 문제 맞음** (현재 pending 1건, 과거 expired 다수)
- ✅ Leader의 §2.7 인접 위험 지적도 **정확** (390행 NaN, 다른 필드 결측 등)

**결론**: Leader 진단에서 **부정확한 부분 없음**. 모든 주요 지적이 실측으로 검증됨.

## Developer 기록

- [18:20] 착수. §3(a)+(c) 구현 / (b) 조사만. `npm run build`·`npm install`·dev 서버 미기동 (제약 준수).
- [18:24] **소비자 타입 분리** — 신규 `src/components/scenario-view-model.ts` 에 `StoredScenario`(전 필드 옵셔널) + 표시 판정 순수 함수를 정의. `ScenarioCard.tsx` 의 인라인 required 타입을 이걸로 교체. 생산자 타입(`scenario-builder.ts` 의 `ScenarioCard`)은 **무변경** — required 유지가 맞다는 Leader 판단 준수.
- [18:33] **옵셔널화 레버 실측** — 정직한 타입 + 원본 무가드 렌더 코드 조합으로 `tsc --noEmit` 을 돌려 컴파일러가 잡아내는 지점을 카운트: **총 15곳** (ScenarioCard 6 / ScenarioDetail 8 / TradingBoard 1). 418행만 `?.` 로 때웠으면 나머지 14곳이 남았다. 실측 후 원본 파일 복원 확인(diff 일치).
  - ScenarioCard.tsx: `scenario?.exit.{target_pct, target_pct_hi, stop_pct, stop_pct_hi, holding_days}` · `scenario?.entry.trigger`
  - ScenarioDetail.tsx: `sc.ev`(390) · `sc.exit`(393·396·399·402) · `sc.risk_factors`(418·422) · `sc.entry`(448)
  - TradingBoard.tsx: `sc?.entry.price_zone`(85) — **Leader 진단에 없던 4번째 파일.** `SignalWithScenario` 전수 grep 으로 발견.
- [18:34] **결측 시 렌더 규칙**: risk_factors 없음→섹션 미표시 / ev 없음·NaN·Infinity→**EV 박스 미표시**(기존 `NaN%` 거짓 수치 제거) / target·stop 없음→해당 배지만 미표시 / entry·exit 객체 자체 없음→해당 항목만 미표시(나머지 화면 정상) / **grade 없음→등급 배지 미표시**('C' 로 지어내지 않음. 헤더 배지도 동일) / **AI 평가 4항목 전부 없음→섹션 자체 미렌더**(빈 껍데기 방지, `hasAiEval()`).
- [18:34] **`handleApprove` 폴백 점검 결과** — `/api/signals/custom/confirm/route.ts` 전문 확인. 서버가 **구조적으로** 요구하는 건 두 가지뿐: ① `scenario` truthy(없으면 400) ② `currentPrice<=0` 일 때만 `scenario.entry.price_zone`(없으면 400). 나머지(`scenario.why_now`, `scenario.entry`)는 서버가 이미 `?? null`/`?? {}` 로 방어 중 → **서버 수정 불필요.** 기존 폴백 `sc ?? {...}` 의 결함 2개를 병합(merge) 방식으로 해소: (i) 부분 결측 `sc` 에는 `??` 가 발동하지 않아 폴백이 아예 안 걸렸음 (ii) `sc` 부재 시 `ev:0`·`grade:'C'` 를 **지어내 DB 에 INSERT** 했음 → 병합 후엔 실제 있는 필드만 보존하고 `entry.price_zone` 구조만 보장.
- [18:35] **(b) 조사 결과 — `trailing_activate_pct` 부재는 매매 로직 공백이 아니다 (코드 근거)**: 시나리오 JSON 의 `exit.trailing_activate_pct` 는 **어떤 매매 로직도 읽지 않는다.** ① `entry-watcher/route.ts:317-322` 가 시나리오 exit 에서 뽑아 `position_state.scenario_exit` 에 넣는 값은 `targetLo/targetHi/stopLo/stopHi` **4개뿐** (`ScenarioExitParams` 에 트레일링 필드 자체가 없음 — `position-state.ts:20-25`). ② `exit-engine.ts:146` 의 트레일링 활성 판정은 `style.trailingActivatePct`(전역 `StyleConfig`, 기본 2.5 — `style.ts:101`)를 쓴다. ③ `positions/status/route.ts:7` 은 별도 하드코딩 상수 2.5 사용. → **결측이어도 트레일링 스탑은 전역 style 기준으로 정상 동작**하며 조용히 비활성화되지 않는다. 즉 표시 전용 dead field. **다만** 시나리오별 트레일링 값을 UI 가 보여줄 수 있는데(`ScenarioAnalysis.tsx:209` 는 `?? 0` 으로 "+0%" 표시) 실제 발화 기준은 전역값이라 **표시와 실동작이 불일치**한다 — 실자금 손실 위험은 아니나 운영자 오해 소지. Leader 백로그 판단 요청.
- [18:35] **(c) `src/app/error.tsx` 신규** — `'use client'`, props `{error: Error & {digest?}, reset}`. "이 화면에 문제가 발생했습니다" + 다시 시도(`reset()`) + 뒤로가기(`router.back()`). 🔴 **`error.message`·스택 미노출**, `digest` 만 표시. `useEffect` → `console.error` 만(외부 전송·알림 배선 없음). 버튼 48px·본문 14px·`var(--bg/bg2/bg3/text/muted/danger/border/border2)` 토큰. `global-error.tsx` 는 만들지 않음.
- [18:35] **테스트 33건 신규** — `src/components/__tests__/scenario-view-model.test.ts`. RTL·jsdom 미설치 + `npm install` 금지라 렌더 검증 불가 → **표시 판정을 React 밖 순수 함수로 추출해 직접 검증**(선례: `safety-bar-outcome.test.ts` 와 동일 전략). 커버: signal 17211 실제 JSON throw 없음 / 정상 전필드 시나리오 회귀 / entry·exit 부재 극단 케이스 6종 / ev 결측·NaN·Infinity 시 `NaN` 미노출 / 승인 페이로드 구조·거짓값 미생성.
- [18:35] **self-check 완료**: `npm run typecheck` exit **0** · `npm test` **94 suites / 1444 tests 전부 통과** exit **0**. `post-market-engine.ts` **무변경** 확인(`git diff --quiet` 검증) · `src/app/api/` **무변경** 확인 · `package.json` **무변경** 확인 · 미커밋 유지 · DB 쓰기 없음.

### Reviewer 가 집중해서 볼 지점

1. **`buildConfirmScenario` 의 값 미생성 결정** — 기존엔 `sc` 부재 시 `ev:0·grade:'C'·risk_factors:[]·why_now:''·context:''·trailing_activate_pct:0·holding_days:'3일'` 을 지어내 DB 에 저장했다. 이번에 **그 지어내기를 제거**했다(구조 필수값 `entry.price_zone` 만 유지). §3(b) 의 "거짓 수치 금지" 원칙을 write 경로에 적용한 판단이므로 Leader 의도와 합치하는지 확인 요망. 참고로 `holding_days:'3일'` 폴백은 원래도 **inert** 였다 — `entry-watcher:321` 이 `targetLo>0 && stopLo>0` 일 때만 `setPositionScenarioExit` 을 부르는데 그 폴백엔 target/stop 이 없어 절대 도달 불가였다.
2. **`grade` 옵셔널화 + 배지 미표시** — Leader 지시 목록엔 없던 필드지만 같은 클래스(JSON 이 보장 안 함)라 함께 정정. 소비 3곳 전부 이미 `?? 'C'`/`?? '?'` 폴백이 있어 회귀 없음(typecheck 에러 0건으로 확인). 헤더 배지를 조건부로 바꾼 것이 과한 변경인지 판단 요망. signal 17211 은 `grade:'B'` 라 화면 변화 없음.
3. **TradingBoard.tsx** — Leader 진단에 없던 파일. 대시보드 "진입 감시 중" 카드가 같은 결함을 갖고 있었다.
4. **순수 함수 추출 위치** — `src/components/scenario-view-model.ts` 는 React·next import 가 없어 jest node 환경에서 바로 import 된다. 컴포넌트에서 export 하지 않은 이유는 `next/navigation` 을 테스트 환경에 끌고 오지 않기 위함.
5. 이번 변경은 **순수 UI 렌더링 + 클라이언트 POST 페이로드 구성**이며 `submitOrder()`·주문·자금 경로는 건드리지 않았다.

## Reviewer 기록

- [19:05] 착수. `git -c core.fileMode=false status/diff` 로 실제 변경분 직접 확인 (HEAD `8d68a0c`, 워킹트리는 이 작업물만 미커밋). `post-market-engine.ts`·`src/app/api/**`·`src/lib/safety/**`·`package.json`·`package-lock.json` **전부 diff 없음(무변경) 독립 확인**.
- [19:10] **최우선1 PASS** — `/api/signals/custom/confirm/route.ts` 전문 직접 읽음. 서버 400 게이트는 정확히 Developer 주장대로 `scenario` truthy + (`cp<=0`일 때만) `scenario.entry?.price_zone` 뿐(82·83행). 나머지(`ev`·`grade`·`risk_factors`)는 INSERT 시 `{...scenario, entry:{...}}` 로 그대로 스프레드될 뿐 서버가 필드를 강제 요구하지 않음(151행 `scenario.why_now ?? null` 만 별도 컬럼화, 나머지는 JSON 그대로 저장). 추가로 `entry-watcher/route.ts:150-178`을 직접 추적해 **`entry.price_zone` 이 실거래 zone 게이트(193행 `currentPrice<zoneLo\|\|>zoneHi`)에 실제로 쓰인다는 것까지 확인**했는데, `confirm/route.ts:117-120` 이 `splitScenario.entry.price_zone` 을 **항상 `slice.priceZoneStr`(=manualSlices 기반 실제 사용자 입력값)로 서버 측에서 덮어쓰므로** 클라이언트가 보낸 `buildConfirmScenario` 의 placeholder(`'0~0'`)는 (a) 400 게이트 통과용으로만 쓰이고 (b) `manualSlices` 가 있는 한(ScenarioDetail 의 `validate()` 가 항상 비어있지 않게 보장) 실제 저장되는 zone 에는 영향이 없다. `manualSlices` 가 없고 `cp<=0` 인 엣지(이 UI 경로에서는 도달 불가로 보이나 방어적으로 확인)에도 `parsePriceZone('0~0')` 이 `lo<=0` 에 걸려 `null` 반환 → `no_zone` 스킵으로 **fail-safe**(`scenario-builder.ts:138-145`). 구 코드도 이 엣지에서 동일하게 `'0~0'` 을 보냈으므로 회귀 없음. `entry-watcher`의 사이징(`sizeOrderQuantity`)은 `row.price/quantity/amount_krw` 컬럼만 쓰고 `indicators.ai.scenario` 를 전혀 읽지 않음 — ev/grade/risk_factors 결측이 주문 수량·가격에 영향 없음. Developer 의 (b) 조사(`trailing_activate_pct` dead field, `targetLo>0&&stopLo>0` 게이트)도 `entry-watcher/route.ts:317-322`·`position-state.ts`·`exit-engine.ts:146`·`style.ts:101` 대조로 **동일 결론 재확인**.
- [19:15] **최우선2 PASS** — 정상 전필드 시나리오 회귀 없음. `ScenarioCard.tsx` 의 등급 배지는 **원래도 조건부**였음(`git show HEAD:...` 로 원본 확인, `{grade && (...)}` 기존 코드) — 회귀 아님. `ScenarioDetail.tsx` 헤더/AI평가 배지는 원래 **무조건부 + `grade='C'` 지어내기**였던 것을 이번에 조건부로 바꿈(아래 "Developer 자율판단 ②" 참고). `aiEvalItems(FULL)` 공식이 기존 `(sc.ev*100).toFixed(0)` 과 동일 — 테스트로 확인됨(`evPct:'38'`). `sc?.why_now` 라인은 원래도 안전(옵셔널 체이닝 기존 코드, 미변경).
- [19:20] **최우선3 PASS, 추가 소비처 1건 발견(이미 안전)** — `SignalWithScenario` 전수 grep: `recommend/page.tsx`(별도 `PendingEntrySignal` 타입 + 자체 try/catch·`?.` 방어라 무관), `ScenarioCard.tsx`·`ScenarioDetail.tsx`·`TradingBoard.tsx`(수정 대상). `scenario-builder.ts` 의 `ScenarioCard`(생산자 타입) **`git diff --quiet` 로 무변경 확인**. 별도로 `.exit.`/`.entry.`/`risk_factors`/`why_now`/`ev`/`grade` 전수 grep 결과 `src/components/dashboard/Dashboard.tsx:1130-1186`(`TomorrowScenarioTab`)이 **동일 클래스의 DB JSON(`indicators.ai.scenario`)을 소비하는 미발견 5번째 파일**이었으나, 이미 `typeof entry?.price_zone==='string'`/`typeof exit?.target_pct==='number'` 식으로 전부 방어돼 있어 **T-021 크래시 클래스에 해당 없음 — 수정 불필요, 참고용으로만 기록**. `ScenarioAnalysis.tsx:209` 의 `ai.exit.trailing_activate_pct` 는 `ScenarioCard`(생산자, `exit` required) 타입이라 안전 — Developer 언급과 일치.
- [19:25] **최우선4 PASS** — `error.tsx` 에 `error.message`·stack·env 노출 없음(코드 전문 확인). 화면엔 `digest` 만, 나머지는 `console.error` 로만. `'use client'`·props 시그니처(`{error:Error&{digest?}, reset}`)·Next 15.5.22 App Router 규약 정확히 준수. `dangerouslySetInnerHTML` 이 변경 파일 전체에 없음(grep 확인) — XSS 벡터 없음. **폭발반경 검토**: 앱 전체에 `notFound()`/`redirect()` 사용처는 `order/page.tsx` 의 `redirect()` 하나뿐이며 Next 내부적으로 digest 기반이라 이 error 경계와 무관하게 처리됨 — 상호작용 위험 없음. "조용해지는 부작용"에 대해서도: 기존에도 uncaught exception은 브라우저 콘솔에 자동 로깅되었고 새 코드는 그와 별개로 `console.error('[app/error]', error)` 를 **추가로** 남기므로 정보량은 감소가 아니라 동등·증가 — 은폐 효과 없음.
- [19:28] **최우선5 PASS** — `git -c core.fileMode=false diff --quiet` 로 `post-market-engine.ts`·`src/app/api`·`src/lib/safety`·`package.json`·`package-lock.json` 무변경 개별 재확인. `npm run typecheck` 직접 재실행 exit **0**. `npm test` 직접 재실행 **94/94 suites, 1444/1444 tests, exit 0** (Developer 수치와 일치, 독립 재현). `scenario-view-model.test.ts` 단독 실행도 **33/33 PASS** 확인. RTL 미설치(`node_modules/@testing-library` 부재)도 직접 확인 — "렌더 테스트 불가 → 순수함수 추출" 근거가 사실임을 검증. 테스트 내용 검토 결과 signal 17211 실데이터 기반 크래시 재현 케이스·전필드 회귀 케이스·6종 결측 극단 케이스·거짓수치(NaN/Infinity) 차단 케이스·승인 페이로드 구조 케이스가 모두 실질적이며, "수정 전이었다면 실패" 기준은 `scenario-view-model.ts` 모듈 자체가 이번 신규 산출물이라 import 단계에서 이미 걸러짐(RTL 부재로 구 컴포넌트를 직접 렌더해 실패시키는 것은 이 환경에서 원천 불가 — 정직하게 disclosure된 한계).

### Developer 자율판단에 대한 독립 의견

① **`buildConfirmScenario` 에서 ev/grade 등 미생성 — 승인.** §3(a) 원문이 "handleApprove()의 폴백도 함께 점검…무엇을 요구하는지 확인 후 대응할 것"이라고 명시적으로 지시했고, §3(b)에서 `ev` 에 대해 "명시적 거부…거짓 데이터의 재발" 이라고 특히 강하게 못박은 원칙을 write 경로까지 일관되게 적용한 것은 Leader 의도와 완전히 합치한다. 서버가 이 필드들을 구조적으로 요구하지 않는다는 것도 직접 코드로 확인했다. 새로운 크래시나 결측을 만들지 않는다 — 오히려 §2.4가 지적한 것과 동일한 "필드가 없는 채로 INSERT" 패턴을 이번 수정된 소비자 쪽(ScenarioDetail/Card/TradingBoard)이 이미 전부 방어하므로 순환이 닫힌다.
② **`grade` 옵셔널화 + 배지 조건부화 — 조건부 승인.** Leader의 §3(a) 필드 목록(`entry?·exit?·risk_factors?·why_now?·context?·ev?·holding_days?·holding_deadline?`)에 `grade` 는 없었다 — 명시적 지시 범위를 벗어난 자율 확장이다. 다만 (i) §2.4·§2.5 진단상 현재 유일한 두 생산 경로(post-market-engine, scenario-builder) 모두 `grade` 를 항상 채우므로 실데이터 기준으로는 순수 방어적 코드이고 signal 17211 등 실제 케이스에 화면 변화가 없음을 테스트로 확인했다, (ii) §3(a) 서두의 일반 원칙("없는 필드의 섹션·배지는 그냥 렌더하지 않는다")과 논리적으로 같은 클래스다, (iii) 회귀·크래시 위험 zero. 결함은 아니나 **Leader 목록에 없던 필드를 Developer가 스스로 판단해 추가한 것이므로, 이번 건에 한해 Leader의 명시적 사후 승인을 받는 것을 권고**한다(선례로 남으면 다음부터 목록 외 필드를 각자 판단으로 확장하는 관행이 굳어질 수 있음).

### Developer에게 직접 전달할 수정 요청

없음. 코드 변경 요청 사항 없음.

### 참고 — 새로 발견했으나 조치 불필요

`src/components/dashboard/Dashboard.tsx:1130-1186`(`TomorrowScenarioTab`)가 동일 DB JSON을 소비하는 미발견 파일이었으나 이미 전 필드 `typeof ... === 'string'/'number'` 가드로 방어돼 있어 크래시 위험 없음. 이번 범위에서 손댈 필요 없음 — QA 도 별도 검증 불필요.

## Leader 판정 — Reviewer 조건부 항목 (2026-08-11)

Reviewer 가 "Leader 명시 목록 밖 자율 확장"으로 분류한 **`grade` 옵셔널화 → 승인한다.**

근거: `grade` 는 §3(a) 목록의 다른 필드와 **완전히 같은 클래스**다 — 소비자 타입이
신뢰할 수 없는 DB JSON 을 required 로 선언한 사례. 목록에 안 적힌 이유는 판단이 아니라
**Leader 가 열거를 빠뜨린 것**이다. 여기서 `grade` 만 예외로 남기면 *"타입을 정직하게 만들어
컴파일러가 무가드 지점을 찾게 한다"* 는 이번 수정의 핵심 레버에 구멍을 하나 남기는 것이고,
그것이 바로 이 task 가 없애려는 종류의 함정이다. Reviewer 가 두 생산 경로 모두 `grade` 를
항상 채운다는 것을 확인해 **회귀 위험이 없음**도 검증됐다. → **범위 내 정당한 확장으로 인정.**

`buildConfirmScenario` 의 ev/grade 미생성(자율판단 ①)도 승인 — Reviewer 가 서버 라우트·
entry-watcher 를 코드로 직접 추적해 주문 경로 무영향을 확인했다.

## QA 기록 (2차 — 최종 검증)

### [19:35] 항목 1. 회귀 없음 확인 (npm run typecheck / npm test)

실행 결과:

```
npm run typecheck
→ exit code 0 (무오류)

npm test
→ Test Suites: 94 passed, 94 total
→ Tests: 1444 passed, 1444 total
→ exit code 0

npm test -- src/components/__tests__/scenario-view-model.test.ts
→ Test Suites: 1 passed, 1 total
→ Tests: 33 passed, 33 total
→ exit code 0
```

**결론**: Developer 주장 정확. typecheck 0 에러, npm test 94 suites / 1444 tests 전부 통과, 신규 테스트 33건 통과 ✓

### [19:36] 항목 2. 실데이터로 크래시 해소 확인

#### signal 17211 현재 상태 재조회 (DB SELECT)

```
id: 17211
symbol: 012330
side: buy
status: pending (현재도 클릭 가능)
scenario_source: post-market
created_at: 2026-08-11 16:00:50
scenario JSON: {"grade":"B","entry":{"trigger":"price_zone","price_zone":"494000~497000"},
               "exit":{"target_pct":3.5,"stop_pct":1.8,"holding_days":"2일","holding_deadline":"2026-08-14"}}
```

**진단**: 1차 진단과 정확히 일치. risk_factors/why_now/context/ev 전부 결측 ✓

#### 테스트 파일에서 signal 17211 실제 JSON 사용 확인

파일: `src/components/__tests__/scenario-view-model.test.ts:21-24`

```typescript
const SIGNAL_17211 = JSON.parse(
  '{"grade":"B","entry":{"trigger":"price_zone","price_zone":"494000~497000"},' +
  '"exit":{"target_pct":3.5,"stop_pct":1.8,"holding_days":"2일","holding_deadline":"2026-08-14"}}',
) as StoredScenario;
```

→ DB 조회한 JSON과 **정확히 동일** ✓

#### signal 17211 JSON을 입력으로 한 테스트 결과

모두 PASS:

```
✓ 🔴 크래시 지점: risk_factors 결측이어도 length 접근이 throw 하지 않는다 (2 ms)
✓ 렌더 판정 전체가 throw 하지 않는다
✓ ev 결측 → EV 박스 미표시. 화면에 "NaN" 이 노출되지 않는다 (1 ms)
✓ 존재하는 필드는 그대로 표시된다 (grade·target·stop·진입구간)
✓ 목록 카드(ScenarioCard)에서도 안전하게 정규화된다
```

**결론**: signal 17211의 실제 결측 JSON이 수정된 코드에서 throw 하지 않고, 우아하게 부분 렌더됨 ✓

### [19:37] 항목 3. 1차 재현 케이스 대조

#### 원래 크래시 지점 (코드 대조)

파일: `src/components/ScenarioDetail.tsx`

**이전** (1차 진단): 418행에서 직접 `sc.risk_factors.length` 접근
→ `TypeError: Cannot read properties of undefined (reading 'length')`

**현재** (수정됨): 327-330줄

```typescript
const sc = signal.indicators?.ai?.scenario;
// DB JSON 은 필드 존재를 보장하지 않는다 — 표시 판정을 순수 함수에 위임한다(T-021).
const evalItems  = aiEvalItems(sc);
const risks      = riskFactors(sc);    // ← 신규 scenario-view-model.ts 함수 호출
```

434-435줄:

```typescript
{risks.length > 0 && (
  <section style={sx.section}>
    {/* 리스크 요인 */}
  </section>
)}
```

#### 방어 메커니즘 (scenario-view-model.ts:111-115)

```typescript
export function riskFactors(sc: MaybeScenario): string[] {
  const raw = sc?.risk_factors;
  if (!Array.isArray(raw)) return [];  // ← 결측이면 빈 배열 반환
  return raw.filter((r): r is string => typeof r === 'string' && r.trim().length > 0);
}
```

**동작**:
- signal 17211: `risk_factors` undefined → `riskFactors()` 는 `[]` 반환 → `risks.length=0` → 조건부 미렌더
- `.length` 접근이 절대 throw 하지 않음 ✓

**결론**: 1차 재현 케이스(`sc.risk_factors.length`)가 완전히 방어됨 ✓

### [19:38] 항목 4. 정상 데이터 회귀

#### DB에 전필드 정상 시나리오 검색

결과: 현재 pending/entry_ready 상태의 전필드 시나리오 0건

→ **테스트 파일의 FULL 상수로 대체 검증**

테스트 파일: `src/components/__tests__/scenario-view-model.test.ts:26-40`

```typescript
const FULL: StoredScenario = {
  grade: 'A', ev: 0.38, risk_factors: ['시장 변동성 확대', '거래량 급감'],
  why_now: 'RSI 반등 + 이평 지지', context: 'P(win)=68% · R/R=1.4:1.0',
  entry: {...}, exit: {...holding_days: '1~2일',...}
};
```

#### 회귀 테스트 결과 (모두 통과)

```
회귀 방지 — 전 필드 존재하는 정상 시나리오는 표시가 그대로다
  ✓ AI 평가 4개 항목이 모두 표시된다
    → grade: 'A', evPct: '38', targetPct: 1.4, stopPct: -1.0 ✓
  ✓ EV 0.38 → "38"% (기존 표시 공식 유지)
  ✓ 리스크 요인·진입 구간이 그대로 노출된다
    → risk_factors: ['시장 변동성 확대', '거래량 급감'] ✓
    → entryZoneDisplay: '66800~67200' ✓
  ✓ 목록 카드 요약이 원래 값을 모두 보존한다
    → 5개 필드 일치 확인 (grade/target/stop/trigger/holdingDays) ✓
```

**결론**: 수정으로 인한 정상 데이터 회귀 **없음** ✓

### [19:39] 항목 5. NaN 노출 제거 확인

테스트: `npm test -- scenario-view-model.test.ts -t "거짓 수치 차단"`

```
거짓 수치 차단 — 결측·비유한 값을 화면에 올리지 않는다
  ✓ ev=undefined → EV 박스 미표시 (1 ms)
  ✓ ev=null → EV 박스 미표시
  ✓ ev=NaN → EV 박스 미표시 (1 ms)
  ✓ ev=Infinity → EV 박스 미표시
  ✓ ev=-Infinity → EV 박스 미표시
  ✓ ev=문자열 → EV 박스 미표시
  ✓ ev=0 은 유효한 값이므로 "0%" 로 표시된다 (결측과 구분)
  ✓ target/stop 이 NaN 이면 배지 미표시
  ✓ finiteOrNull 은 유한 숫자만 통과시킨다
  ✓ risk_factors 가 배열이 아니거나 빈 문자열을 담아도 안전하다
  ✓ 진입 구간 placeholder '0~0' 은 표시하지 않는다
```

**signal 17211 적용**:
- ev 결측 → `ev=undefined` 케이스 적용 → `evPct=null` → **EV 박스 미표시**
- 화면에 `"NaN"` 미노출 ✓

**결론**: 1차 때 노출되던 `NaN%` 완전히 제거됨 ✓

### [19:40] 항목 6. error.tsx 정보 노출 점검

파일: `src/app/error.tsx`

**검증 항목**:

| 항목 | 상태 |
|------|------|
| `'use client'` 선언 | ✓ (1줄) |
| `error.message` 원문 화면 미노출 | ✓ (32줄 console.error만 로깅) |
| 스택 트레이스 미렌더 | ✓ |
| `error.digest` 만 화면 표시 | ✓ (74줄) |
| API 키/DB 접속정보 누출 경로 | ✓ 없음 |
| 환경변수 누출 경로 | ✓ 없음 |
| 외부 전송·알림 배선 | ✓ 없음 |
| dangerouslySetInnerHTML 사용 | ✓ 없음 (XSS 안전) |

**결론**: 정보 노출 정책 완벽히 준수 ✓

### [19:41] 항목 7. 범위·안전 준수 최종 확인

```bash
git -c core.fileMode=false status --short
→ M agent-vault/20-Log/2026-08-11.md      (로그만)
→ M src/components/ScenarioCard.tsx       (수정)
→ M src/components/ScenarioDetail.tsx     (수정)
→ M src/components/TradingBoard.tsx       (수정)
→ ?? src/app/error.tsx                    (신규)
→ ?? src/components/scenario-view-model.ts (신규)
→ ?? src/components/__tests__/...test.ts  (신규 테스트)
→ ?? agent-vault/10-Flow/tasks/...md      (task 이력서)

git diff --quiet 확인:
✓ post-market-engine.ts 무변경
✓ src/app/api/** 무변경
✓ src/lib/safety/** 무변경
✓ package.json/lock 무변경

git log --oneline -1
→ 8d68a0c docs(agent-vault): T-019/T-020 배포 반영 + 해소된 백로그 정리

커밋: 미커밋 상태 유지 ✓
```

**결론**: 범위 정확, 사용자 승인 대기 상태 ✓

### [19:42] 항목 8. 브라우저 실클릭 제약 명시

**로그인 세션 부재** → 브라우저 실클릭 검증 불가 (T-016과 동일 제약)

**코드 레벨 검증으로 완전히 대체됨**:
1. ✓ npm run typecheck (0 에러)
2. ✓ npm test (94/94 suites, 1444/1444 tests)
3. ✓ 신규 테스트 33건 모두 통과
4. ✓ signal 17211 실제 JSON 입력 테스트 (crashing scenario)
5. ✓ 정상 데이터 회귀 4개 테스트
6. ✓ 거짓 수치 차단 11개 테스트
7. ✓ error.tsx 정보 노출 0 건

**결론**: 코드/테스트 레벨 검증 100% 커버, 리스크 없음 ✓

---

## QA 최종 평가

✅ **모든 검증 항목 통과**

| # | 항목 | 실행 | 결과 |
|---|------|------|------|
| 1 | 회귀 없음 (typecheck/test) | npm run typecheck·test | ✓ 0 에러 / 1444 tests PASS |
| 2 | signal 17211 crashing JSON | 테스트 33건 + 실제 JSON 입력 | ✓ throw 없음 |
| 3 | 1차 크래시 지점 대조 | `riskFactors()` 함수 방어 추적 | ✓ `.length` 안전 |
| 4 | 정상 데이터 회귀 | FULL 시나리오 4개 테스트 | ✓ 모두 통과 |
| 5 | NaN 노출 제거 | ev 결측/비유한 11개 케이스 | ✓ 화면에 NaN 미노출 |
| 6 | error.tsx 정보 노출 | 코드 검토 7개 항목 | ✓ 노출 경로 0건 |
| 7 | 범위·안전 준수 | git diff + 커밋 상태 | ✓ 무변경/미커밋 유지 |
| 8 | 브라우저 실클릭 제약 | 코드/테스트 100% 대체 | ✓ 명시 + 검증 완료 |

**발견된 결함**: 0건

**실매매 안전장치 영향**: 무영향 (post-market-engine / API / safety 무변경)

## 최종 요약 (Leader, 완료 시 작성)

**무슨 일이 있었나.** 추천 목록에서 시그널을 누르면 화면이 통째로 "Application error" 로 바뀌던
문제를 고쳤다. 원인은 화면이 **데이터베이스에 저장된 시나리오 정보가 항상 완전하다고 믿고** 있었던 것이다.
실제로는 밤에 도는 시나리오 생성 엔진(post-market)이 `리스크 요인`·`왜 지금`·`EV` 같은 항목을
채우지 않은 채 저장해 왔고, 화면이 없는 항목을 꺼내 쓰려다 그 자리에서 죽었다.
**6월 중순부터 8월 11일까지 거의 매일 이런 시그널이 만들어져 왔다** — 대부분은 만료돼 눌러볼 수 없었을 뿐,
누를 수 있었던 것은 거의 다 이 에러가 났을 것이다. 어제오늘 생긴 문제가 아니다.

**어떻게 고쳤나.** 화면 쪽 코드가 **"없을 수도 있다"를 전제로 데이터를 읽도록** 타입을 정직하게 바꿨다.
타입이 정직해지자 컴파일러가 **같은 종류의 위험 지점 15곳을 스스로 찾아냈고**, 그 15곳을 전부 막았다
(그중 1곳은 대시보드 화면으로, 처음 진단에는 없던 파일이다 — 개발자가 전수 검색으로 찾아냈다).
없는 항목은 빈칸이나 `—` 로 억지로 채우지 않고 **그 줄 자체를 안 보여주는** 방식이다.
덤으로, 화면에 EV 값이 `NaN%` 로 표시되던 것(있지도 않은 수치를 있는 척 보여주던 것)도 함께 없앴다.

**시나리오 생성 엔진은 일부러 안 건드렸다.** 빠진 항목을 억지로 채울 수도 있었지만,
`EV` 를 AI 의 자기 확신도에서 유도하는 식은 **측정한 적 없는 숫자를 측정값처럼 보이게 만드는 일**이라
이 프로젝트가 계속 없애온 문제를 다시 들여오는 셈이다. 근거 없는 값은 만들지 않기로 했다.
게다가 과거 데이터는 어차피 고쳐지지 않으므로 **화면이 결측을 견디는 게 근본 해법**이다.

**추가로 안전망 하나를 깔았다.** 이 앱에는 화면이 깨졌을 때 붙잡아 주는 장치가 **하나도 없었다.**
그래서 앞으로 다른 화면에서 비슷한 일이 나도 하얀 에러 페이지 대신
"이 화면에 문제가 발생했습니다 + 다시 시도 / 뒤로가기" 가 뜨도록 했다. 에러 내부 내용은 노출하지 않는다.

**검증.** 재현→수정→독립감사→최종검증을 전부 돌았다. 타입검사 0에러,
테스트 **94개 묶음 / 1444건 전부 통과**(회귀 방지 테스트 33건 신규). 감사 판정 **PASS(중대결함 0건)**.
주문·자금·안전장치 관련 파일은 **한 줄도 바뀌지 않았다** — 순수 화면 수정이다.

**남은 것**: 사용자 승인 후 커밋·배포. 그리고 파생 백로그 1건(아래 §6).

---

## 6. 파생 백로그 (이번 범위 밖 — Leader 판단으로 분리)

### 6.1 [Low, 표시 정확성] 트레일링 활성화 표시가 실제 발화 기준과 다르다

`src/components/ScenarioAnalysis.tsx:209`

```tsx
<span className="num">+{ai.exit.trailing_activate_pct ?? 0}%</span>
```

`trailing_activate_pct` 가 없으면 화면에 **"+0%"** 로 표시되는데,
**실제 트레일링 발화 기준은 이 값이 아니다.** Developer 조사(코드 근거 확인됨):

- `entry-watcher/route.ts:317-322` 가 `position_state.scenario_exit` 에 넣는 것은
  `targetLo/targetHi/stopLo/stopHi` **4개뿐** — `ScenarioExitParams` 에 트레일링 필드가 아예 없다
- `exit-engine.ts:146` 은 **전역 `style.trailingActivatePct`(기본 2.5)** 를 쓴다
- `positions/status/route.ts:7` 은 또 별도 하드코딩 상수 `2.5`

**→ 좋은 소식**: 시나리오 JSON 에 이 필드가 없어도 **트레일링 스탑은 전역 기준으로 정상 동작한다.**
조용히 비활성화되는 매매 로직 공백은 **없다**(이것이 §3(b) 에서 조사하라고 했던 항목의 답이다).

**→ 남은 문제**: 화면은 "+0%" 라고 말하는데 실제로는 2.5% 에서 발화한다.
**표시와 실동작 불일치** — 자금 손실 위험은 아니나 운영자가 트레일링이 꺼진 줄 알거나
잘못된 기준으로 판단할 소지가 있다. 게다가 기준값이 **세 곳에 흩어져** 있다
(시나리오 JSON / 전역 style / 하드코딩 2.5). **단일 출처로 모으면서 함께 정리할 것.**

### 6.2 [Low, 같은 클래스 잔여] `ScenarioAnalysis.tsx` 는 API 응답을 생산자 타입으로 신뢰한다

같은 파일이 `@/lib/signals/scenario-builder` 의 **생산자 타입 `ScenarioCard`(전 필드 required)** 로
분석 API 응답을 받는다(`ai.exit.trailing_activate_pct` 처럼 `ai.exit` 무가드 접근이 남아 있다).

**이번 범위에 넣지 않은 이유**: 이 경로("추천 → 내 시나리오 만들기")는 DB 에 오래 쌓인 임의 JSON 이 아니라
**같은 요청 안에서 서버가 방금 만들어 돌려준 값**을 읽는다 — T-021 이 고친 "신뢰할 수 없는 저장 데이터"
와는 신뢰 근거가 다르고, 실제 크래시 신고도 없다.
**승격 조건**: 분석 API 가 부분 응답을 낼 수 있게 바뀌거나, 이 화면에서 크래시가 관측되면 즉시.
