---
task_id: T-044
title: 현금 부족 "실행 불가 매수 시그널 요약" 알림 제거 — 실행 가능한 시그널의 승인 요청 알림만 남긴다
status: done
waiting: []
priority: medium
risk_level: R2
roles_involved: [leader, developer, reviewer, qa]
related_tasks: [T-042]
base_ref: c3a14f12f83658020d1a358a5ebc39cd1dad4597
tags:
  - type/task
  - domain/signals
  - domain/notify
aliases:
  - 실행 불가 요약 알림 제거
  - drop unexecutable summary
created: 2026-10-12
updated: 2026-10-26
demo_gate:
  required: true
  level: "delta"
  status: "waived"
  version: 0
  repo_path: ""
  artifact_url: ""
  content_sha256: ""
  decided_by: "judge"
  rule_id: "JV-ui_change"
  approved_by: ""
  approved_at: ""
  approval_quote: ""
  waived_by: "user"
  waived_at: "2026-10-12T11:57:22+09:00"
  waiver_quote: "해석대로 맞고 데모는 생략"
  active: false
---

# T-044 — "📭 실행 불가 매수 시그널 요약" 알림 제거

## 사용자 요구 (2026-10-12 원문)

> 잔고가 부족하여 승인요청을 안보낸것에 대한 알람이라면 해당 알람은 제외해도되며 시그널에 대한 알람만 존재하면 될것으로 보임.
> 다만 잔고가 거래 가능일 경우에는 시그널이 승인으로 처리됨으로 이에 대한 알람은 존재해야 함

**Leader 해석** (사용자 확인 대상): ① 현금 부족 등으로 "실행 불가"로 판정된 매수 시그널은 **텔레그램 알림을 아무것도 보내지 않는다**(요약도 개별도 없음). ② 실행 가능한 시그널의 "📩 승인 요청" 알림은 **지금과 똑같이** 나간다. ③ 시그널 자체는 DB `awaiting_approval` 로 남고 앱 승인 대기 목록에 그대로 보인다.

## 왜 (사실, 10-12 읽기 전용 실측)

- 11:04:51 시그널 #18676(086280 매수 ₩240,572)이 생성됐고, 현금 ₩80,138(스냅샷 10:51:38) < 금액×0.5(₩120,286) 라 `assessExecutability` 가 `cash` 로 판정 → 개별 승인 요청 대신 요약 알림이 나갔다. **주문 시도는 없었다**(오늘 `orders` 0건).
- 알림 경로는 하나뿐이다: `src/lib/signals/service.ts:431` → `notifyApprovalRequest`. 별도의 "시그널 생성" 알림은 없다.
- 현재 `notify_skip_unexecutable` 는 **켜짐(기본) = 요약**, `false` = 실행 불가도 개별 승인 요청을 보냄. "아무것도 안 보냄" 모드는 없다 → 코드 변경이 필요하다.

## 관련 과거 이력 요약

- [[T-042-telegram-approval-buttons]] D2-b 가 요약 알림을 도입했다(알림 홍수 완화 목적: 하루 ~36건·44% 가 00~07시). 이번 요구는 그 요약 자체를 없애는 것이다. D2-b 의 *판정*(`assessExecutability`)은 그대로 쓴다.
- T-042 감사 D-3 의 원칙은 유지한다: **판정 실패·불확실이면 "실행 가능"으로 보고 개별 알림을 보낸다**(알림을 줄이는 쪽이라 의심스러우면 보낸다).
- 사용한 교훈 ID: 없음(`/이슈기록 관련` 미조회 — 소규모 변경).

## 설계 (Leader)

대상: `src/lib/signals/approval-notify.ts`, `src/lib/signals/__tests__/approval-notify.test.ts`, `docs/telegram-approval.md` (§ 스위치 표 24행 부근 + 요약 설명이 있으면 함께).

1. `notifyApprovalRequest` 의 실행 불가 분기(현 156~162행)에서 **요약 집계·발송을 제거**하고 `{ kind: 'suppressed', reasons }` 만 돌려준다. 요약 상태(`summary`, `tallyUnexecutable`, `resetSummaryState`, `SUMMARY_EVERY_MS`, `REASON_KO`, `SAMPLE_MAX`)와 `NotifyDeps.sendSummary` 는 쓰는 곳이 없어지면 삭제한다. `NotifyOutcome.suppressed` 의 `summarySent` 필드도 정리(사용처 확인).
2. **조용히 사라지지 않게 서버 로그 1줄**을 남긴다 — 예: `[approval-notify] 실행 불가 매수 알림 생략: signal <id> <symbol> reasons=cash,…` (알림 채널이 아니라 `console.info`/기존 로거). 비밀·금액 외 민감값 금지. 오늘 "텔레그램이 갔는지 앱 로그로 못 맞춰 본" 문제의 재발 방지.
3. `notify_skip_unexecutable` 의미를 바꾼다: **켜짐(기본) = 실행 불가 매수는 알림 생략**, `false` = 지금처럼 실행 불가여도 개별 승인 요청 발송. 키 이름은 그대로(운영 DB 에 행이 없어 마이그레이션 불필요 — 기본 동작만 바뀐다). 문서 표의 설명 문구를 맞춘다.
4. **절대 바꾸지 않는 것**: 매도는 항상 실행 가능(요약·생략 대상 아님) · 판정 실패/불확실 → 개별 알림 발송 · 실행 가능한 매수의 승인 요청 본문·버튼 경로 · `assessExecutability`(`approval-context.ts`) 판정 로직과 `CASH_SHORTFALL_RATIO` · 주문 경로(`submitOrder`·안전장치) · `service.ts` 호출부.
5. 시그널 DB 상태(`awaiting_approval`)와 앱 승인 대기 목록 동작은 건드리지 않는다.

## 시험 (필수)

- 실행 불가 매수(cash / daily_limit / order_limit 각각): 텔레그램/`sendAlert` 계열 호출 **0회**, outcome `suppressed`, 서버 로그 1줄.
- 실행 불가 매수가 여러 건 연속이어도(1시간 안·밖 모두) 발송 0회 — 요약이 되살아나지 않음(회귀 방지).
- 실행 가능 매수: 기존과 동일하게 개별 승인 요청 발송(간단 형식·버튼 형식 둘 다 기존 테스트 유지).
- 매도: 실행 불가 판정 대상이 아님 → 항상 발송.
- 판정 throw / `null` → 발송(불확실하면 보낸다).
- `notify_skip_unexecutable=false` → 실행 불가여도 개별 발송.
- 제거한 요약 관련 기존 테스트는 삭제/치환하되, 요약이 사라졌다는 사실을 고정하는 테스트로 대체한다.
- `npm run typecheck` · 관련 jest · 전체 jest 회귀 0 · 커밋 훅 테스트(`bash scripts/test-git-hooks.sh`) 해당 시.

## 역할별 지시사항

- **developer**: 위 설계대로 구현. 작업 트리에 다른 세션의 미커밋 변경(.codex/·AGENTS.md·CLAUDE.md·T-042 task 등)이 섞여 있으니 **건드리지 말고**, 변경은 위 3개 파일로 한정한다. 운영 경로(`/home/brownjeon/apps/stockinvest`)·`npm run build`(NFS 트리 `.next`)·DB 쓰기 금지. 검증은 `npm run typecheck` + jest.
- **reviewer**: `src/lib/signals/` 는 훅 SAFETY_PATHS — 독립 감사 후 `## Reviewer` 마지막 줄에 프로젝트 지침의 판정 줄 형식(리터럴 대문자 판정 + scope)을 남긴다. 중점: ① 요약 제거가 "불확실하면 보낸다" 원칙을 깨지 않는가 ② 매도·판정 실패가 침묵으로 새지 않는가 ③ 삭제한 심볼의 잔존 참조(테스트 포함) ④ 로그 줄이 비밀을 싣지 않는가 ⑤ 문서·코드 일치.
- **qa**: 위 시험 목록을 직접 실행. 추가로 "실행 불가/가능 경계"에서 알림 유무를 확인.
- 배포(push=webhook 자동배포)는 **사용자 확인 후** Leader 가 지시한다.

## 판단 기록 (judge)

- [10-12] 접수(`judge-result@2`, engine jev, 규칙 dev-rules@0.5.0): task_type `local_fix` · complexity 0.92 · risk **R2**(규칙 `R2-kw-payment`) · developer=**opus**(`MD-r2-opus`) · `demo=delta/designer`(`JV-ui_change`, behavior_change 0.74) · `next=demo_first` · `blocking_gate=demo`. 데모 게이트 `init` → `drafting`. Leader 관찰: 이 변경은 텔레그램 메시지 하나가 **사라지는** 것이고 새 모양이 없다(승인 요청 본문·버튼은 불변) — 데모로 보여 줄 화면이 없어 사용자 생략(`waive`) 여부를 묻는다. 대리 생략·승인 금지. 결과 원본은 세션 스크래치패드(`judge-T-044-result.json`).
- [10-12] 사용자 "해석대로 맞고 데모는 생략" → `check.mjs waive`·`activate` 기록(status waived, `DEMO_GATE_PASSED`). 해석 확정: 실행 불가 매수 알림 완전 생략, 실행 가능 시그널의 승인 요청은 불변.
- [10-12] `codex_gate` C2 (`judge-result@2`, engine jev): `codex_required: true` · mode `adversarial-review` · focus `design_assumption` · 규칙 `CX-limit-unknown-r2`(남은 한도 미상 → R2 만 개입) · 호출 0/4 · 스위치 on. 따름(override 없음). Codex 실행 done(72초, 호출 1/4) — 지적 2건은 `## Codex 검토` 절. Leader 코드 확인: medium 건(service.ts:370-385 중복 방지 때문에 생략된 시그널이 TTL 안에 실행 가능해져도 재알림 없음)은 **사실**이다. 이전에도 같은 구조였으나(옛 요약 문구 "현금을 채우면 다시 개별 요청이 옵니다"는 TTL 안에서는 부정확했다) 요약이 사라지며 눈에 띄게 됐다. 사용자 결정 사항으로 올림 — 수용/수정 선택에 따라 Reviewer 채택·기각 판정과 이후 단계가 갈린다.

## Developer

- [11:59] 구현 완료(설계 1~5 그대로). 변경 파일 3개만: `src/lib/signals/approval-notify.ts`, `src/lib/signals/__tests__/approval-notify.test.ts`, `docs/telegram-approval.md` (+86/−118). 커밋·push 안 함.
- [11:59] `approval-notify.ts`: 실행 불가 분기에서 요약 집계·발송 제거 → `console.info("[approval-notify] 실행 불가 매수 알림 생략: signal <id> <symbol> reasons=<a,b>")` 1줄 후 `{ kind: 'suppressed', reasons }` 반환. 로그에는 금액·잔고·라벨 없음(원본 심볼·id·사유 코드만). 삭제 심볼: `summary`(상태)·`SummaryState`·`tallyUnexecutable`·`resetSummaryState`·`SUMMARY_EVERY_MS`·`REASON_KO`·`SAMPLE_MAX`·`NotifyDeps.sendSummary`·`defaultDeps().sendSummary`·`NotifyOutcome.suppressed.summarySent`, 쓰지 않게 된 `won` import. 매도 무판정·판정 throw/null → 발송·`skipUnexecutable` 조회 실패 → 발송·`notify_skip_unexecutable` 키/기본값(켜짐) 은 코드 그대로(의미만 "요약"→"생략"). 파일 머리 주석 2번 항목 갱신.
- [11:59] 잔존 참조 grep(`src docs scripts`): 삭제 심볼은 테스트의 "없어졌음을 고정하는" 단언 4줄에만 남음. `notifyApprovalRequest` 호출부는 `service.ts:431` 하나이고 반환값을 쓰지 않음 → 호출부 수정 불필요. ⚠ `service.ts:428` 주석에 "실행 불가 매수는 요약으로" 문구가 남았다 — 변경 금지 파일이라 손대지 않음(동작 영향 없음, Leader 판단).
- [11:59] 테스트 §4 치환: cash/daily_limit/order_limit 각각 발송 0회·suppressed·로그 1줄(문자열 정확 일치) / 진짜 `defaultDeps` 발송 함수(sendAlert·dispatchAlertWithTelegram·sendTelegramMessage·sendTelegramAlert) 0회 / 다중 사유 로그에 금액·잔고 수치 없음 / 1시간 안·밖(0~24h) 7건 연속 발송 0회·`summarySent` 없음 / 요약 export·`sendSummary` 부재 / 버튼 켜짐에서도 생략 / 매도 항상 발송·판정 안 함 / `notify_skip_unexecutable=false` 개별 발송 / 판정 throw·null → 발송 / 스위치 조회 throw → 발송 / 실행 가능 매수 개별 발송·로그 없음. `console.info` 는 `jest.spyOn(...).mockImplementation` 으로 소음 차단+검사. §1~3·sendRich 기존 테스트 유지.
- [11:59] 검증: `npm run typecheck` exit 0(출력 없음) · `npx jest src/lib/signals/__tests__/approval-notify.test.ts` 34/34 pass · `npx jest src/lib/signals` 14 suites 602/602 pass · `npx jest`(전체) 141 suites 2878/2878 pass. `scripts/test-git-hooks.sh` 는 훅 미변경이라 미실행. 화면 파일 미수정(데모 게이트 waived). `npm run build`·운영 경로·DB·pm2 접근 없음.
- [11:59] reviewer 중점 제안: ① 로그 줄의 `a.symbol` 은 시그널 입력 원본(내부 생성값) — 비밀 아님 ② `strategyTitle` import 는 이번 변경 전부터 미사용(범위 밖이라 그대로 둠) ③ 운영 영향: 배포 즉시 기본 동작이 "시간당 요약 1건" → "알림 0건"으로 바뀐다. 이제 판정 오판정은 요약이라는 안전망 없이 바로 침묵이 되므로 `assessExecutability` 정확도가 더 중요해진다 — T-042 감사 D-3(한도 0 = 모름)은 `approval-context.ts:125` 에 이미 반영돼 있음을 확인(읽기만, 미변경). 생략 건은 서버 로그로만 추적 가능.
- [12:01] Leader 추가 지시 반영: `src/lib/signals/service.ts:428` 주석만 수정("실행 불가 매수는 요약으로" → "실행 불가 매수는 알림 생략 + 서버 로그 1줄(T-044)"). `git diff --numstat` 1/1 — 주석 1줄 외 변경 없음. `npm run typecheck` exit 0. 이에 따라 Reviewer scope 에 `src/lib/signals/service.ts` 도 포함돼야 커밋 훅을 통과한다.

## Reviewer

- [12:05] 감사 범위: `git diff`(base `c3a14f1` = 현재 HEAD) 의 4개 파일을 직접 읽음 — approval-notify.ts(+9/−48) · approval-notify.test.ts(+75/−68) · service.ts(+1/−1) · docs/telegram-approval.md(+2/−2). `src docs scripts` 의 수정 파일은 이 4개뿐(다른 세션 변경은 범위 밖). `approval-context.ts` 는 `git diff` 비어 있음 = 미변경 확인.
- [12:05] 의도 대조(사용자 요구): 실행 불가 매수 → 알림 0건(요약 포함), 실행 가능 매수 → 기존과 동일 개별 승인 요청, 시그널 DB 상태 불변. 코드 `approval-notify.ts:118-125` 가 이를 충족한다 — 생략 분기는 `console.info` 1줄 + `{kind:'suppressed', reasons}` 만 돌려주고 어떤 발송 함수도 부르지 않는다. 실행 가능 경로(127행 이후)는 diff 에서 한 줄도 바뀌지 않았다. 호출부 `service.ts:431` 은 반환값을 쓰지 않으며 주석 1줄 외 변경 없음(`git diff --numstat` 1/1, 변경 줄이 주석임을 직접 확인).
- [12:05] 중점 ① "불확실하면 보낸다": 판정 throw/null → `.catch(() => null)` + `assessment &&` 가드로 발송, 스위치 조회 throw → `.catch(() => false)` 로 판정 자체를 건너뛰어 발송, 한도 0(모름) → 변경 없는 `approval-context.ts:125-134` 의 `orderMaxKnown/dailyMaxKnown` 가드로 사유에 안 들어가 발송, 조회 실패성 `ok:false`(`<금액> > <한도>` 형태 아님) → `exceedsLimit` 으로 사유 제외. 침묵으로 새는 경로를 발견하지 못했다.
- [12:05] 중점 ② 매도: `a.side === 'buy' &&` 조건(118행)으로 판정 대상이 아니고 `assessExecutability` 도 매도는 즉시 executable(`approval-context.ts:117`). 매도 이중 방어 확인. `side` 타입은 `'buy'|'sell'` 뿐(`service.ts:84`)이라 이상값이 생략 쪽으로 샐 길도 없다(buy 가 아니면 발송 쪽).
- [12:05] 중점 ③ `notify_skip_unexecutable`: `defaultDeps` 의 `(await readConfig(...)) !== false` — 키 없음/true/그 외 값 = 켜짐(생략), 정확히 `false` 일 때만 개별 발송. 테스트 `notify_skip_unexecutable=false …` 가 title(`📩 승인 요청: 라벨(NAS:BKNG)`)·판정 미호출·로그 없음까지 고정.
- [12:05] 중점 ④ 잔존 참조: `summarySent|sendSummary|tallyUnexecutable|resetSummaryState|SUMMARY_EVERY_MS|REASON_KO|SAMPLE_MAX|SummaryState|📭 실행 불가 매수 시그널 요약` 을 `src scripts docs` 에서 grep → 테스트의 "없어졌음을 고정하는" 단언 4줄(253·258·259·260행)에만 남음. `approval-notify|notifyApprovalRequest|NotifyDeps|defaultDeps|NotifyOutcome` 의 사용처는 service.ts·approval-notify.test.ts·docs 뿐이라 자가 점검 라우트·폴러·다른 테스트는 영향 없음. typecheck 가 이를 뒷받침한다.
- [12:05] 중점 ⑤ 로그: `[approval-notify] 실행 불가 매수 알림 생략: signal <id> <symbol> reasons=<코드,…>` — 시그널 번호·원본 심볼·사유 코드만 싣고 금액·잔고·라벨·키는 없다. `src` 전체에서 `console.*` 재정의·로그 포워더를 찾지 못했고(`instrumentation.ts` 는 cron 워치독만), pm2 는 `pm2-out.log` 파일로만 받는다 → 알림 채널(텔레그램/슬랙)로 가지 않는다. 테스트가 sendAlert·dispatchAlertWithTelegram·sendTelegramMessage·sendTelegramAlert 0회를 진짜 `defaultDeps` 발송 함수로 확인한다.
- [12:05] 중점 ⑦ 테스트 diff 전수: 원본 36개 `describe/test` 중 삭제 6건은 전부 요약 전용(첫 건 요약 1건 발송·1시간 누적 요약·예시 종목 최대 3개·요약 종목명 이스케이프·요약 라벨 조회 실패 이스케이프·사유 한국어 묶음). §1~3·sendRich 케이스와 이름·본문은 diff 상 한 줄도 바뀌지 않았다(헤더 import, `Sent` 형태와 §1 의 `toEqual` 에서 summary 키 제거, `beforeEach` 교체만). 라벨 조회 실패 시 원본 심볼 이스케이프는 §2 의 별도 테스트(116행 부근)가 여전히 고정하므로 요약 삭제로 빠진 보호 공백 없음. 매도·throw·스위치 조회 throw·`false` 케이스는 유지 또는 강화(null 판정·버튼 켜짐·1시간 안팎 연속 7건·export 부재 추가).
- [12:05] 중점 ⑥ 변이 시험 — 원본 미수정, `~/` 가 아닌 세션 스크래치패드의 `src` 복사본(node_modules 심볼릭 링크)에서만 수행하고 원본은 읽기 전용으로 썼다. 기준선 34/34 통과 후 17개 변이를 하나씩 적용: M1 생략 분기에 sendPlain 추가(7건 실패)·M2 sendRich 추가(7)·M3 매도에도 판정 적용(1: 매도 항상 발송)·M4 판정 null 이면 생략(3)·M5 판정 throw 이면 생략(2)·M6 스위치 throw 시 생략(1)·M7 스위치 false 무시(2)·M8 로그에 금액·잔고 포함(4)·M9 로그 제거(5)·M10 로그를 sendAlert 로 전송(1: 진짜 기본 배선 0회)·M11 `summarySent` 필드 부활(5)·M12 `tallyUnexecutable` export 부활(1)·M13 `defaultDeps.sendSummary` 부활(1)·M14 cash 만 생략(2)·M15 order_limit 은 발송(2)·M16 버튼 켜짐이면 발송(1)·M17 1시간 경과 시 요약처럼 sendPlain(7). 17개 전부 적어도 1개 테스트가 빨개졌고 살아남은 변이는 없다. 시험 후 복사본을 원본으로 되돌려 동일함을 확인했고, 원본 4개 파일의 `git diff --numstat` 는 감사 전과 같다(9/48 · 75/68 · 1/1 · 2/2).
- [12:05] 독립 재실행(내가 직접 실행): `npm run typecheck` exit 0 · `tsc --noEmit --incremental false` exit 0(출력 없음) · `npx jest src/lib/signals/__tests__/approval-notify.test.ts` 34/34 통과 · `npx jest src/lib/signals` 14 suites 602/602 통과 · `npx jest`(전체) 141 suites 2878/2878 통과 exit 0 — developer 보고와 일치. `next lint` 는 ESLint 미구성이라 대화형 설정 프롬프트에서 멈춰 실행 불가였다(저장소에 파일은 생기지 않음을 확인) — 린트 증빙은 없다.
- [12:05] 중점 ⑧ 문서: `docs/telegram-approval.md` 24행(스위치 표)·32행(배포 직후 적용 항목)이 코드와 일치한다 — 켜짐=생략·서버 로그 문구가 코드 문자열과 같고, false=개별 발송, 매도·판정 실패는 항상 발송, 기본값 켜짐. 문서에 "요약" 이 남은 곳은 의도된 표현(제거 안내)과 무관한 §4 제목뿐이다.
- [12:05] 발견 사항 (Critical 0 · High 0 · Medium 0 · Low 3, 차단 없음):
- [12:05] Low-1 `src/lib/signals/approval-context.ts:7`(머리 주석 "개별 알림 대신 요약 1건으로 묶는다")·`:98`("개별 알림이 요약으로 사라진다")·`:127`("이 알림이 요약으로만 가")이 이제 사실이 아니다. 오판정의 결과가 "요약으로만 감"에서 "아무 알림도 없음"으로 더 나빠졌는데 주석은 완화된 결과를 가정한다. 이 파일은 `src/lib/signals/` 안이라 SAFETY 경로이므로 이번 task 범위(미변경 약속) 밖이다 — 후속 task 에서 주석만 고치되 Reviewer 기록이 필요하다. 동작 영향 없음.
- [12:05] Low-2 `docs/telegram-approval.md` 가 생략 로그를 "서버 로그" 로만 적고 어디서 찾는지 쓰지 않았다. 오늘 문제(텔레그램이 갔는지 앱 로그로 못 맞춰 봄)의 재발 방지가 목적이라면 `pm2 logs stockinvest | grep "실행 불가 매수 알림 생략"`(로그 파일 `pm2-out.log`) 한 줄을 §2 근처에 두면 운영 확인이 쉽다. 코드 결함 아님.
- [12:05] Low-3 `approval-notify.ts:25` 의 `strategyTitle` import 는 미사용이다 — base 에도 있던 기존 상태(base 24행에서 확인)라 이번 변경이 만든 문제가 아니며 typecheck 는 통과한다(권고: 다음에 이 파일을 만질 때 정리).
- [12:05] 참고(권고) 판정 오류 시 안전망 소멸: 이전에는 현금 판정이 틀려도(스냅샷 최대 3시간 경과 허용 `approval-context.ts:38` × 현금 < 금액×0.5 `:36,145` — 입금·매도 정산 직후 스냅샷이 낡으면 현금 부족으로 오판) 시간당 요약 1건이 사용자에게 신호를 줬다. 이제는 같은 오판이 서버 로그 1줄 외에 어떤 흔적도 없는 침묵이다. 코드 쪽 방어는 충분하다(조회 실패·한도 0·집계 실패는 모두 "실행 가능" 쪽) — 남는 것은 "스냅샷은 신선하나 값이 틀린" 경우와 "신선도 3시간 이내이나 입금 반영 전" 경우뿐이고, 둘 다 코드로는 구분할 수 없다. 위험이 드러난 정도: 코드 주석(approval-notify.ts:115-116)은 "판정 불확실이면 보낸다"를 적었지만 "오판정 시 침묵" 결과는 적지 않았고 approval-context.ts 주석은 오히려 낡았다(Low-1), 문서는 `false` 로 되돌리는 탈출구를 표에 적었다. 테스트는 판정 *결과* 별 동작은 고정하나 판정의 정확도는 이 suite 의 대상이 아니다(approval-context 테스트 몫). 의견: 사용자 결정이므로 차단하지 않는다. 운영 단계에서는 (a) 켠 직후 며칠은 `pm2-out.log` 의 생략 줄 수와 실제 승인 대기 목록을 한 번 대조하고 (b) 필요하면 `notify_skip_unexecutable=false` 로 즉시 되돌릴 수 있음을 task 최종 요약에 한 줄 남기길 권한다.
- [12:05] 결론: 사용자 확정 의도 충족, 안전장치 우회·주문 경로 변경 없음(`submitOrder`·`order-limits` 미접촉), 침묵 경로 없음, 회귀 테스트가 변이 17/17 을 잡음. QA 에는 "실행 가능/불가 경계"(현금 = 금액×0.5 전후, 한도 0, 스냅샷 3시간 경계)와 `notify_skip_unexecutable=false` 전환을 집중 검증하도록 전달한다.
- [12:05] **최종 판정: PASS (scope: src/lib/signals/approval-notify.ts, src/lib/signals/__tests__/approval-notify.test.ts, src/lib/signals/service.ts, docs/telegram-approval.md)**

## QA

## Codex 검토

### [2026-10-12 12:08] C2 adversarial-review focus=design_assumption — done
- judge 판정: `judge-result@2` codex_gate C2 (`codex_required: true`, `budget_rule: CX-limit-unknown-r2`) / 호출 차수: 1/4
- 대상: repo=StockInvest base=c3a14f1(task_file) snapshot=6311613
- 지적 2건:
  - [medium] `src/lib/signals/service.ts:370` — 최초 알림 생략 뒤 시그널 유효시간 안에 현금이 보충되어 매수가 실행 가능해질 때 → 기존 `awaiting_approval` 시그널은 중복 검사(370-384)에 걸려 재평가·재알림 경로가 없어 텔레그램에서 영구 침묵, 앱 승인 목록을 직접 열지 않으면 기회를 놓침 (권고: suppressed 매수를 잔고 갱신 시 재평가해 false→true 전환 때 1회 알림하도록 영속 상태 기록, 또는 중복 경로에서 실행 가능성 전환 재알림)
  - [low] `src/lib/signals/approval-notify.ts:174` — `notify_skip_unexecutable` 를 `!== false` 로 해석해 문자열 "false"·0·null 등 비정상 값이 생략을 켬 → "불확실하면 보낸다" 원칙과 불일치, 테스트는 주입된 리터럴 false만 검사 (권고: 명시적 true일 때만 생략, 실 defaultDeps 로 false/"false"/0/null/파싱 실패 검증 테스트 추가)
- 검토하지 못한 범위: 커밋 범위 내 .codex 에이전트·훅 설정, AGENTS.md/CLAUDE.md, T-040·roadmap 변경(T-044와 무관); 운영 DB 현재 값·실제 잔고 시나리오(읽기 전용·DB 접근 금지); 테스트 재실행 없음(정적 경로 분석)
- 원본: /home/brownjeon/NFS/homes/brownjeon/project/.claude/state/codex-review/runs/20261012T030737Z-T-044-C2/raw.txt

## 최종 요약

> 2026-10-26 16:29 상태 정리(T-083 R01 후속) — 사용자 발화 그대로: "2. T-042·T-044 상태는 권고대로 진행해줘 / 3. T-038, T-039도 권고대로 진행해줘"(10-26 16:29 이전, T-083 `## Leader 기록` 4개 task 대조표의 권고에 대한 답).

### [T-044] 현금 부족으로 실행 못 하는 매수는 승인 요청 알림을 보내지 않는다 (T-058 에 흡수·배포됨)

- **상태**: ✅ 완료(운영 반영)
- **무엇이 바뀌었나**: 지금 실행할 수 없는 매수(현금 부족·한도 소진·1회 한도)는 텔레그램 승인 요청도 시간당 요약도 보내지 않는다(서버 로그에 한 줄만). 실행 가능한 시그널의 승인 요청은 그대로. 매도·판정 실패는 항상 보낸다. 동작은 T-058 에 흡수됐다.
- **배포**: ✅ 커밋 `8894416` · 2026-10-21 14:38 KST · push(webhook) · 결과 ok(릴리스 `20261021-143838-88944165`). 같은 배포: T-058·T-060·T-056 문서
- **AI 가 검증한 것**: 코드(`approval-notify.ts` — `tallyUnexecutable`·`sendSummary` 없음, 생략 로그 L123, `notify_skip_unexecutable` 은 키 없음 또는 JSON `true` 일 때만 생략)와 `docs/telegram-approval.md` L24·L28~31 의 서술이 일치(T-083 대조표). 사용자 결정(10-12 11:57 "해석대로 맞고 데모는 생략")은 이미 해소.
- **👉 사용자가 확인할 것**: 없음
- **👉 사용자가 결정할 것**: 없음
- **남은 일**: **한도 사유(일 한도·1회 한도)로 알림이 생략된 시그널은 유효시간 30분 안에 한도가 풀려도 다시 알리지 않는다**(알려진 한계, T-058 최종 요약 이슈 ③) — 필요해지면 별도 task
- **이슈·위험**: 없음 (되돌리기: `notify_skip_unexecutable` 키에 JSON `false`)

(완료 시 Leader 작성)

## 데모 검토 (demo gate)

> 실행 판정 정본은 frontmatter `demo_gate` 이다. 이 표는 check.mjs 가 함께 기록하는 사람용 이력이다(docs/demo-review-gate.md).

| 버전 | 상태 | 저장소 파일 | Artifact | 사용자 결정 | 일시 |
|---|---|---|---|---|---|
| - | 작성중 | - | - | judge: delta (JV-ui_change) | 10-12 11:50 |
| - | 생략 | - | - | "해석대로 맞고 데모는 생략" | 10-12 11:57 |
