---
task_id: T-101
title: 설정 > 안전장치에 '해외 장마감 후 분석' 스위치(post_market_overseas_enabled) 추가 — 데모 없이 진행(사용자 생략)
status: done
priority: high
project: StockInvest
created: 2026-10-27
updated: 2026-10-28
base_ref: 8f91ecb
risk_level: R2
roles_involved: [leader, judge, developer, reviewer, qa, codex]
related_tasks: [T-062-post-market-overseas-p2, T-072-validation-gate]
tags:
  - type/task
  - domain/settings
  - domain/safety
aliases:
  - 해외분석스위치
waiting: [Developer 구현, Reviewer·Codex·QA, 장외 배포]
demo_gate:
  required: false
  level: "none"
  status: "not_required"
  version: 0
  repo_path: ""
  artifact_url: ""
  content_sha256: ""
  decided_by: "judge"
  rule_id: "DM-kw-waiver"
  approved_by: ""
  approved_at: ""
  approval_quote: ""
  waived_by: ""
  waived_at: ""
  waiver_quote: ""
  active: false
---

# T-101 설정 > 안전장치에 '해외 장마감 후 분석' 스위치 추가

## 사용자 지시 (발화 그대로, 2026-10-27)
"'post_market_overseas_enabled' 설정에 대해서는 설정메뉴의 안전장치항목쪽에 추가해주고 별도 데모없이 바로 작업진행해줘."

## 배경 (실측)
- `system_config.post_market_overseas_enabled` 는 **키 없음 = 꺼짐**, 정확히 JSON `true` 일 때만 켜진다([[T-062-post-market-overseas-p2]]). 지금 키가 없어 해외 장마감 후 분석(매일 08:00 KST, 미국 종목 시나리오)이 꺼져 있다.
- 설정 API(`src/app/api/settings/*`)·설정 화면에 이 스위치를 다루는 항목이 없다. Leader 의 운영 DB 직접 쓰기는 권한 분류기에서 거부됐고(우회하지 않음), 사용자가 메뉴에서 직접 켜기를 원한다.
- 기존 `PATCH /api/settings/safety` 에 필드→키 매핑(예: `analystEnabled` → `strategy_analyst_enabled`)과 boolean 검증 패턴이 이미 있다.

## 요구사항
1. `GET /api/settings/safety` 응답에 `postMarketOverseasEnabled`(boolean)를 추가한다. **값은 엔진이 쓰는 판정식과 같은 것**(키 없음·`true` 외 값·읽기 오류 = `false`)을 재사용해 화면과 엔진이 갈라지지 않게 한다 — 판정식을 복제하지 말고 `post-market-overseas.ts` 의 기존 함수를 export 해 쓴다. 지금 `getOverrides()` 의 LIKE 목록에 `post_market_%` 가 없으니 이 키만 정확히 읽도록 추가한다.
2. `PATCH /api/settings/safety` 에 `postMarketOverseasEnabled` → `post_market_overseas_enabled` 매핑을 추가한다. **boolean 만 허용**(문자열 "true"·숫자 등은 400), 저장 값은 JSON `true`/`false`. 다른 키에는 영향이 없어야 한다.
3. 설정 화면 **안전장치 섹션**에 기존 토글과 같은 컴포넌트·스타일로 한 줄 추가한다. 라벨 예: "해외 장마감 후 분석(미국 시나리오)". 설명 한 줄 예: "켜면 매일 08:00(KST) 미국 종목 시나리오를 만듭니다. 주문은 하지 않으며 승인·킬스위치·검증 관문이 그대로 적용됩니다." 켜기/끄기 확인 대화상자는 기존 안전장치 토글의 패턴을 따른다. 새 화면·새 섹션·구조 변경은 없다(행 하나 추가).
4. 시험: GET 기본값(키 없음=false)·true/false 반영, PATCH 검증(boolean 만·잘못된 타입 400·다른 키 불변), 엔진 판정식과 GET 값 일치, 설정 화면 렌더(토글 존재·상태 표시·저장 호출).
5. 국내 동작·기존 안전장치 항목·엔진(`post-market-overseas.ts` 로직)은 바뀌지 않는다(판정식 export 한 단어 외).

## 하지 않는 것
- **스위치 값 자체를 바꾸지 않는다**(배포 뒤 사용자가 메뉴에서 켠다). 엔진 로직·cron·주문 경로·킬스위치·D5 관문 변경 금지. 비밀 값 출력 금지. 새 화면·섹션 신설 금지.

## 소유 파일 (예상)
`src/app/api/settings/safety/route.ts`(+`__tests__`, **훅 감시 대상**) · `src/app/settings/SettingsPage.tsx`(+시험) · `src/lib/strategy/post-market-overseas.ts`(판정식 export 만, **훅 감시 대상 여부는 `SAFETY_PATHS` 로 확인**). 훅 감시 파일을 커밋할 때는 이 task 의 `## Reviewer` 마지막 판정 줄이 필요하다(메시지에는 T-101 만 인용).

## 데모 게이트
사용자가 "별도 데모없이 바로 작업진행해줘"라고 했다 → judge 판정과 무관하게 `check.mjs waive` 로 생략을 기록한다.

## 배포
push=배포. 장외 창(15:40~22:00 KST)에만. 지금(10-27 23시대)은 미국 정규장 중이라 **다음 창(10-28 15:40 이후)**. 배포 후 사용자가 메뉴에서 켜면 첫 정기 실행은 그다음 날 08:00 KST.

## 판단 기록 (judge)

- [2026-10-27 23:2x] intake: engine=rules → risk=R1 / developer_model=opus(`MD-judge-failed-opus`) / **demo=none**(`DM-kw-waiver` — 사용자 생략 요청 감지) / next=assign | 입력 `scratchpad/judge-T-101-intake.json`. `check.mjs init` → `DEMO_GATE_INIT`(not_required/none), `waive` 는 "데모가 필요 없는 task 입니다(생략 불필요)"로 거부됨(정상 — 이미 불필요), `check` → `DEMO_GATE_PASSED`.
- **Leader override(위험)**: R1 → **R2**. 변경 대상 `src/app/api/settings/safety/` 가 커밋 훅 `SAFETY_PATHS` 의 안전 경로라 독립 감사(Reviewer 판정 줄)·Codex(`CX-r2-post-review` 예상)·QA 를 모두 거친다.

## 진행 기록
- 2026-10-27 23:2x: Leader 접수. 사용자 지시 원문 기록, 데모 생략 기록 진행.

## Developer

- [2026-10-27 23:5x] **Developer(Opus, worktree `t101`, 미커밋)** — 변경 4파일: `src/app/api/settings/safety/route.ts`(+22/−1: GET 이 엔진 판독기 `readPostMarketOverseasSwitch()` 를 직접 호출해 `postMarketOverseasEnabled` 응답 · PATCH 매핑 `postMarketOverseasEnabled → POST_MARKET_OVERSEAS_SWITCH_KEY`(엔진과 같은 상수) · `PATCH_STRICT_BOOLEANS` 에 추가(boolean 만, 아니면 400·무쓰기) · 변경 시 `console.warn` 한 줄), 신규 시험 `src/app/api/settings/safety/__tests__/post-market-overseas-switch.test.ts`(57), `src/app/settings/SettingsPage.tsx`(+41/−1: '안전장치 (공통)' 카드의 '자동 청산 엔진' 뒤·'1회 주문 최대' 앞에 `PostMarketOverseasRow` — 기존 `Toggle`·ON/OFF 표시, 즉시 `autoSave`(실패 시 서버 값으로 되돌림)), 신규 시험 `src/app/settings/__tests__/settings-post-market-overseas.test.ts`(13). 엔진 파일 변경 0.
- **요구와 다른 점 2(Leader 검토 — 타당)**: ① `getOverrides()` LIKE 목록에 키를 추가하지 않고 엔진 판독기를 직접 호출 — `getOverrides()` 가 한 번 `JSON.parse` 한 값을 다시 판정하면 문자열 `"true"` 가 켜짐으로 읽혀 엔진(꺼짐)과 갈라지고, 행 하나가 파싱에 실패하면 결과 전체가 `{}` 가 되기 때문 → "화면과 엔진이 갈라지지 않게"라는 요구 목적에 더 정확. ② 저장 바 일괄 저장(`handleSave`)에서 이 키만 제외 — 다른 필드(주문 한도 등)를 저장할 때 화면에 남은 오래된 값으로 이 스위치를 덮어쓰지 않게(키가 없던 상태가 false 행으로 바뀌는 것도 방지). 확인 대화상자는 넣지 않음 — 같은 카드의 기존 토글(실거래·KILL_SWITCH·자동 청산)에 confirm 이 없고 같은 방식(즉시 저장)을 따랐다고 보고(Reviewer 검증 대상).
- 검증: 새 시험 70개 통과(GET 12종 이상 입력·엔진 판정식 일치 19종+키 없음+읽기 오류·PATCH 타입 9종 400·원자성·다른 키 불변·왕복·화면 렌더/저장/되돌림/일괄 저장 본문), 변이 6종 모두 새 시험이 실패(PATCH 검증 제거 10·GET 느슨한 판정 24·매핑 키 오타 6·다른 키도 저장 4·일괄 저장 제외 제거 1·autoSave 미호출 4; 원본 sha256 복원 확인), tsc 0, 영역 jest 42묶음 957 통과, 전체 jest 294묶음 통과·7,874 통과·실패 0(건너뜀 149 = 기존 DB 의존). 못 한 것: 모바일 실렌더·`next build`·실DB GET/PATCH 스모크·라우트 인증 검토. 보고서: scratchpad `t101/dev-report.md`.
- [00:0x] **Developer 2·3차(같은 worktree, 미커밋)** — Reviewer 1차 채택분 반영: **F-3** `PostMarketOverseasRow` 문구를 상태별로 정정(OFF "OFF — 켜면 미국 정규장이 열린 날의 다음 날 아침 08:00(KST)에 미국 종목 시나리오 카드를 만듭니다(미국 휴장일 다음날은 건너뜀). 주문은 하지 않으며 승인·킬스위치·검증 관문이 그대로 적용됩니다." / ON "ON — 미국 정규장이 열린 날의 다음 날 아침 08:00(KST)에 …(같은 문장)"). **F-2** `route.ts` 의 `post-market-overseas` 정적 import 제거 → GET 에서만 지연 `import()`+실패 시 false(꺼짐)+`=== true`, PATCH 는 export 하지 않은 리터럴 키 `'post_market_overseas_enabled'`(엔진 상수와의 일치는 "PATCH 가 실제로 쓴 키 == 엔진 상수" 시험으로 고정), 신규 `post-market-overseas-isolation.test.ts`(엔진 모듈 로드가 throw 해도 PATCH·GET 나머지 필드 정상, PATCH 는 엔진 미로드). **Reviewer 델타 재검토 후 F-7**(코드 주석 1·서버 로그 ON 문구의 옛 "매일 08:00" → 정확한 표현, 로그 문구 ON/OFF 시험 고정)·**F-8**(라우트 export 가 `GET`·`PATCH`·`dynamic` 뿐인지 시험 1개) 반영. 검증: 최종 tsc 0, 영역 jest 969 통과, **전체 jest 7,886 통과·149 건너뜀·실패 0**, 변이(로그 문구 되돌림·상수 export 추가·지연 import 정적화·catch true 등)가 모두 시험에 걸림. 변경 5파일: `route.ts`(+39/−1)·`SettingsPage.tsx`(+44/−1)·신규 시험 3(switch 243줄·isolation 155줄·화면 306줄). 보고서: scratchpad `t101/dev-report-2.md`.

## Reviewer

- [23:34] **1차 Reviewer(Sonnet, 독립 감사)** — 치명 0·높음 0·낮음 5(+기존 문제 1). 직접 실행: jest 영역 42묶음 957·safety+settings 8묶음 171(새 시험 70) 통과, tsc 0, middleware-public-paths 130 통과(`/api/settings/safety` 무세션 401 단언 포함), demo gate PASSED. 항목별 `[확실]`: ① GET 은 엔진과 같은 `readPostMarketOverseasSwitch()`(판정 `gateSwitchValueEnabled`, 캐시 없음) — 입력별(키 없음·true·false·`"true"`·`1`·`null`·파싱 불가·읽기 오류) 화면과 엔진이 갈라지지 않음 ② PATCH 는 `PATCH_STRICT_BOOLEANS` 로 boolean 만, 검증이 모든 쓰기보다 먼저(400 이면 무쓰기), 저장은 `JSON.stringify`·`?` 바인딩, 쓰기 대상은 서버 상수 `ALLOWED_PATCH_KEYS` 순회라 요청 본문 키로 다른 키를 쓸 수 없고 프로토타입 오염 경로 없음 ③ 인증: middleware 공개 목록에 없고 유효 세션 없으면 401·세션 비밀 없으면 503, KILL_SWITCH·DRY_RUN 과 같은 보호 수준(주문이 나가지 않는 쪽이라 더 약한 권한) ④ Developer 의 이탈 2건(`getOverrides` 미경유·일괄 저장에서 키 제외) 둘 다 타당 ⑤ 확인 대화상자 없음 — 같은 카드의 기존 토글(실거래·KILL_SWITCH·자동 청산)에 confirm 0건, 즉시 `autoSave` 방식과 동일 ⑥ 문구: "주문은 하지 않으며"·"승인·킬스위치·검증 관문이 그대로 적용" 사실(post-market 엔진에 `submitOrder`/`createOrder` 호출 0, `entry-watcher` 는 `approved_pending_entry` 만, G5 검증 관문·`submitOrder` 킬스위치) / "매일"은 과장 ⑧ 변이 24종 전부 시험이 잡음(원본 sha256 복원).
- [23:34] findings: F-1 낮음(GET 이 `source` 를 버려 읽기 오류 시 화면이 조용히 꺼짐으로 보임 — 같은 카드 자동 청산 행은 경고를 띄움; 화면 변경이라 designer 필요 → 보류) · **F-2 낮음(Leader 채택)**: 설정 라우트의 정적 import 폐쇄가 52→91 모듈로 늘고 `child_process` 가 들어옴 — KILL_SWITCH 를 호스팅하는 긴급 제어 라우트가 llm·rag·텔레그램 모듈 트리 로드에 결합 → GET 에서만 지연 import + PATCH 는 키 리터럴로 분리 · **F-3 낮음(Leader 채택)**: "매일 08:00" 과장 — 실제는 미국 정규장이 열린 날의 다음 날 아침(KST 화~토), 휴장일 다음날은 건너뜀 → 문구 정정 · F-4 낮음(엔진에는 `KIS_OVERSEAS_ENABLED` env 라는 두 번째 끔 스위치가 있음 — 현재 .env 둘 다 true, 조치 불필요) · F-5 기존 문제(범위 밖: 세션이 있으면 누구나 전역 안전장치 PATCH 가능, 일괄 저장이 오래된 탭의 dryRun·killSwitch·exitEngine 을 되돌려 쓸 수 있음, 본문 null 이면 500, `getOverrides` 가 오류를 삼킴 — 별도 task 후보) · F-6 낮음(worktree 의 `node_modules` 심볼릭 링크가 untracked — 커밋은 명시 경로, 메시지에는 T-101 만).
- [23:34] **최종 판정: PASS (scope: src/app/api/settings/safety/route.ts, src/app/api/settings/safety/__tests__/post-market-overseas-switch.test.ts, src/app/settings/SettingsPage.tsx, src/app/settings/__tests__/settings-post-market-overseas.test.ts)**
- [00:02] **2차 Reviewer 델타 재검토(Sonnet)** — 치명 0·높음 0·중간 0·낮음 2. 직접 실행: 영역 jest 43묶음 966·전체 jest 295묶음 7,883 통과·실패 0, isolation 시험 `--runInBand` 3회·병렬 3회 흔들림 없음(이웃 포함), tsc 0, demo gate PASSED. 델타 확인 `[확실]`: ① 지연 import 블록은 import 실패·판독 reject·boolean 아닌 값(`'true'`)·함수 아님에서 모두 꺼짐으로 수렴하고 오류 로그는 `e.message` 한 줄(응답 비노출, 계좌·키 정보 경로 없음) ② 리터럴 키 오타(10개)·PATCH 다른 키(9개) 변이를 시험이 잡음 ③ route 의 export 는 `dynamic`·`GET`·`PATCH` 뿐 ④ isolation 시험의 전제(jest-runtime 29.7 `requireMock` — factory 가 throw 하면 캐시하지 않음)는 반복 실행에서 안정, 단 선언 순서(load-fail → ok)에 의존해 `--randomize` 에서는 깨질 수 있음(낮음·참고) ⑤ PATCH 는 엔진 모듈을 전혀 로드하지 않음(변이 M7 이 걸림) ⑥ GET 의 다른 필드·응답 모양 불변, route 의 정적 import 폐쇄 30파일(base 와 같음, `child_process` 없음) ⑦ 문구는 엔진·크론과 일치(`cron-runner.sh` 08시 하루 1회·`lastCompletedSessionEt` 가 ET 거래일 16:00 이후만 → KST 화~토 아침, 일·월·휴장 다음날은 `no_new_session`). 변이 M1~M17 중 M10·M17 외 전부 시험이 잡음(M10=route 에 export 추가, M17=서버 로그 문구 — 둘 다 아래 F-7·F-8 로 후속 반영).
- [00:02] findings: **F-7 낮음(채택·반영)**: `route.ts` 의 옛 "매일 08:00" 표현(코드 주석·서버 로그 ON 문구)이 남음 → 정확한 표현으로 교체, 로그 문구 시험 추가 / **F-8 낮음(채택·반영)**: route 파일 export 추가를 못 잡음 → export 키 시험 추가 / 범위 밖(별도 task 후보): `src/components/scenario-card-display.ts:296` 카드 각주 "미국 카드는 매일 08:00 분석" 과장(기존 시험 3곳이 이 문자열을 고정) / 참고: 엔진 두 번째 끔 스위치 `KIS_OVERSEAS_ENABLED`·`next build` 미확인.
- [00:3x] Leader 확인: F-7·F-8 반영분을 diff 로 직접 확인(문자열 2곳 교체·시험 3개 추가, `route.ts` 줄 수 불변, 옛 문구 0건, export 3개) — 문자열·시험만 바뀌어 재감사 없이 통과 판정을 유지한다(Reviewer 의 권고: Leader diff 확인·task 기록으로 충분).
- [00:02] **최종 판정: PASS (scope: src/app/api/settings/safety/route.ts, src/app/api/settings/safety/__tests__/post-market-overseas-switch.test.ts, src/app/api/settings/safety/__tests__/post-market-overseas-isolation.test.ts, src/app/settings/SettingsPage.tsx, src/app/settings/__tests__/settings-post-market-overseas.test.ts)**

## QA

- [00:4x] **QA(Sonnet, 직접 실행, 깨끗한 사본 HEAD `6052525` + 5파일)** — **QA 결과: PASS (결함 0)**. tsc 0(시험 3파일은 임시 tsconfig 로도 0) · 신규 시험 3파일 82 통과 · 영역 43묶음 969 통과 · isolation 시험 `--runInBand --no-cache` 3회·이웃 포함 병렬 3회·`--randomize` 2회 모두 통과(흔들림 없음) · **전체 jest 295묶음 통과(4 건너뜀)·7,886 통과·149 건너뜀·실패 0** · **`next build` 성공**(23초, `/api/settings/safety` 동적 빌드, 타입·route export 규칙 오류 없음, 번들 분석상 엔진 청크가 GET 안에서만 지연 로드되고 `node:child_process` 는 지연 청크 1개에만 있음) · 라우트 시뮬레이션 27건(진짜 GET/PATCH 핸들러 + 가짜 `system_config`): PATCH `true` → 200·저장 값 정확히 JSON `true`·다른 키 불변·쓰기 정확히 1건, `false` 동일, `"true"`·`1`·`null`·`0`·`"false"`·`[]`·`{}`·`""` → 400·무쓰기(다른 필드와 함께 보내도 무쓰기), 본문의 다른 키·`__proto__` 는 무시, GET: 키 없음·`false`·`"true"`·`1`·`null`·garbage → false, 엔진 판독기 throw/reject/garbage·이 키 조회 DB 오류 → 200 + 해당 필드만 false·나머지 필드 정상·응답에 오류 문구 비노출, 변이 3종(boolean 검증 제거·판독 실패 시 true 수렴·저장 값 문자열화) 시험이 잡음 · 화면: `renderToStaticMarkup` 로 OFF/ON 문구·`aria-checked`·ON/OFF 색 확인, 옛 "매일" 부재, 앱 실제 `globals.css` 로 **Chromium 실렌더 412px·360px(ON/OFF)**: 가로 스크롤 없음·카드 안·설명과 스위치 겹침 없음·위치는 '자동 청산 엔진' 뒤·'1회 주문 최대' 앞. SQL 은 `?` 바인딩, 응답에 늘어난 값은 boolean 하나, middleware-public-paths 130 통과(`/api/settings/safety` 무세션 401 포함).
- [00:4x] 관찰(T-101 이 만든 결함 아님, 후속 후보): 스위치 높이 24px 로 터치 대상 44px 기준에 못 미치고 `div role="switch"` 라 `tabIndex` 가 없다 — 같은 카드의 KILL_SWITCH 등 기존 `Toggle` 컴포넌트 공통(designer 별도 task). 못 한 것: 로그인한 실제 앱·WebView·실기기(갤럭시 S25+)·실DB GET/PATCH 스모크·키보드/스크린리더 실측.

## 배포 기록

- **2026-10-28 05:11 KST push `61b80c9..5ac9119`(7커밋, T-101 `2d4079a`·T-102 `227c5bf`와 문서 5개 동승) → 웹훅 blue/green → `RELEASE_RESULT ok`, 릴리스 `20261028-051140-5ac91195`, `migrated=false`(DB 변경 없음), 05:13 완료.**
- 배포 창 근거: docs/deploy-order.md 허용 창 05:10~08:30(미국 정규장 05:00 마감 후·국내장 09:00 전). 사전 점검(05:10): 킬스위치 ON·`safety_dry_run=false`·최근 3시간 주문 0건·`orders` 최대 id 3229·`system_config` 87키·health 200(포트 3003)·pm2 두 프로세스 online 재시작 0. 사전 `git fetch` 로 다른 세션 커밋이 섞이지 않았음(7커밋 모두 이 세션 것)을 확인했고 다른 세션의 미추적 파일 2개는 올리지 않았다.
- 배포 후 검증(05:13): pm2 `stockinvest`·`stockinvest-cron` 새 릴리스 경로 online·재시작 0 · health 200 · 킬스위치 ON·주문 최대 id 3229·최근 3시간 주문 0건·키 87개 그대로(`post_market_overseas_enabled` 키는 **여전히 없음 = 꺼짐**, Leader 가 쓰지 않음) · 새 번들 `.next/server/app/api/settings/safety/route.js`·`settings/page.js` 에 `postMarketOverseasEnabled` 포함.
- 롤백: 코드 `git revert 2d4079a` 후 push(스위치 행만 사라지고 키는 그대로 꺼짐 유지). 스위치를 켠 뒤라면 DB 키를 지우거나 `false` 로 저장하면 같은 효과.

## Codex 검토

### [2026-10-28 00:1x] C2 review focus=none — done (지적 1건, 중간)
- judge 판정: `codex_required: true`(`CX-r2-post-review`, 스위치 on) / 이 task 호출 1회 — 입력 `scratchpad/judge-T-101-c2.json`.
- 대상: repo=`/home/brownjeon/.node-local/stockinvest-t101`(미커밋 사본, `node_modules` 링크 제거 후) base=8f91ecb snapshot=3a7102c, 실행 70초.
- 지적 1건: **[medium] `route.ts:290` 복수 필드 PATCH 의 쓰기 루프가 트랜잭션 없이 필드마다 개별 `INSERT` — 뒤쪽 쿼리가 실패하면 앞선 키(예: `post_market_overseas_enabled`)는 이미 커밋되고 응답은 500, 감사 로그는 루프 뒤라 부분 변경이 남지 않는다.** 권고: 트랜잭션으로 묶거나, 이 스위치는 단일 필드 요청만 허용(다른 필드와 함께면 400).
- Leader 판정: **사실이나 이번 변경이 만든 문제가 아니다 — 기존 구조의 공통 특성으로 분류, 이번에는 고치지 않는다.** 근거(코드 확인): 이 루프(`ALLOWED_PATCH_KEYS` 순회 개별 `INSERT`)는 base 에 이미 있고 모든 안전장치 필드(KILL_SWITCH·DRY_RUN·한도 등)가 같은 방식이다. 이번에 추가한 키는 매핑 한 줄뿐이다. 화면 경로상 이 스위치는 **자기 토글(autoSave)로 단일 필드 PATCH 로만** 저장되고 일괄 저장 본문에서 제외돼(Reviewer 변이 M13 이 고정) 이 키가 복수 필드 요청의 부분 반영에 휘말릴 UI 경로가 없다. 트랜잭션 도입은 KILL_SWITCH 저장 경로를 바꾸는 별도 안전 변경이라 이 task 에 끼우지 않고 **후속 task 후보**(PATCH 쓰기 원자성·감사 로그 커밋 후 기록 — Reviewer 1차 F-5 와 묶음)로 둔다.
- 이 지적 외 Codex 가 확인한 것: GET 은 엔진 판독기를 지연 import 로 쓰고 실패·비불리언을 false 로 수렴 → 엔진 판정과 일치, 새 필드는 순수 boolean 만 허용·일괄 저장에서 제외되어 기존 안전장치 필드 저장 구성 유지.
- 검토하지 못한 범위(Codex 보고): `next build`, 실제 MariaDB GET/PATCH 스모크, 모바일 실기기 렌더링, DB·KIS·외부 네트워크 연동 — QA 가 `next build`·핸들러 시뮬레이션을 별도로 실행한다.
- 원본: `.claude/state/codex-review/runs/20261027T150910Z-T-101-C2/raw.txt`

## 최종 요약

**[T-101] 설정 > 안전장치에 '해외 장마감 후 분석' 스위치 추가**

- 상태: 완료·운영 반영(2026-10-28 05:13, 릴리스 `20261028-051140-5ac91195`).
- 무엇이 바뀌었나: 설정 화면 '안전장치 (공통)' 카드의 '자동 청산 엔진' 아래·'1회 주문 최대' 위에 **해외 장마감 후 분석 ON/OFF 스위치**가 생겼다. 누르면 즉시 저장되고(실패하면 원래대로 되돌림) '변경 저장' 일괄 저장과는 별개다. 서버(`/api/settings/safety`)는 이 키를 참/거짓 값 하나로만 받고 그 외 값은 400 으로 거절한다.
- 배포: 05:11 push·05:13 `ok`, DB 마이그레이션 없음. T-102 와 같은 배포에 실렸다.
- AI 가 검증한 것: 타입 검사·전체 jest(296묶음 통과·실패 0)·`next build`·진짜 GET/PATCH 핸들러 시뮬레이션 27건·Chromium 360/412px 실렌더(가로 스크롤 없음)·Reviewer 독립 감사 PASS·Codex C2·QA PASS. 배포 후 번들에 새 코드 포함 확인.
- AI 가 못 한 것: 로그인한 실제 앱·WebView·실기기, 실DB 에서 GET/PATCH 한 번 돌려 보기, 키보드·스크린리더 실측. **스위치는 사용자가 켜기 전까지 꺼져 있다 — AI 는 운영 DB 에 쓰지 않았다.**
- 👉 사용자가 확인할 것: **설정 > 안전장치(공통)** 에 '해외 장마감 후 분석' 행이 보이는지(지금 OFF 여야 정상). 켜기로 결정하면 직접 켠다 — 켜면 **다음 영업일 08:00 KST**(미국 정규장이 열린 날의 다음 날 아침)부터 미국 종목 시나리오 카드가 만들어지고, 주문은 하지 않으며 승인·킬스위치·검증 관문이 그대로 적용된다. 켜기 전 필수 조건 3개(카드 금액 10만원에서 실효 종목 수 인지·보유/관심 종목 IR 확정일 입력·08:00 에 KIS 일봉 반영 확인)는 T-062 기록 참조.
- 남은 일(후속 후보): PATCH 쓰기 루프 트랜잭션·감사 로그 커밋 후 기록(기존 구조, Codex 중간 지적) · 스위치 터치 영역 24px·`tabIndex`(designer) · `scenario-card-display.ts:296` 카드 안내 문구의 "매일 08:00" 과장 표현 · 판독 실패(read_error) 화면 경고.
- 이슈·위험: 위 후속 후보 외 없음.

## 데모 검토 (demo gate)

| 버전 | 상태 | 저장소 파일 | Artifact | 사용자 결정 | 일시 |
|---|---|---|---|---|---|
| - | 해당없음 | - | - | judge: none | - |
| - | 해당없음 | - | - | judge: none (DM-kw-waiver) · 생략 요청 감지(확정 전) | 10-27 23:11 |
