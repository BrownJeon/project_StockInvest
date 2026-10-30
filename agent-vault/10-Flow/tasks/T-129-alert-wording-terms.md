---
task_id: T-129
title: 용어 정정 서버 쪽 마무리(T-108 WP-D) — 텔레그램·경보·리포트·설정 요약 문구의 옛 용어를 승인된 용어로
status: in-progress
priority: medium
project: StockInvest
created: 2026-10-31
updated: 2026-10-31
base_ref: origin/main 9d087a4
risk_level: R2
roles_involved: [leader, judge, developer, reviewer, qa, codex]
related_tasks: [T-108-automation-menu-home-overhaul]
tags:
  - type/task
  - domain/notify
  - domain/ui
aliases:
  - WP-D
  - 알림문구정정
---

# T-129 용어 정정 서버 쪽 마무리 (T-108 WP-D)

## 출처·사용자 지시
- 사용자 지시(원문, 2026-10-30): "변경하는 용어는 모든 화면에서 동일하게 변경해줘 … 카드→시그널 · EOD→쉬운 말 · DRY_RUN→실거래여부 · 킬스위치→모든거래차단 · 하드손절 …", 승인(원문 "T-108 데모 v3 승인…")과 "다음 작업 이어서 진행해줘"(10-31 00:2x).
- T-108 구현에서 **화면(UI 소스)** 은 정정을 마쳤고 **서버가 만드는 사용자 노출 문구**(텔레그램 승인·경보·정기 리포트·설정 응답 요약)는 훅 감시 경로(SAFETY_PATHS)라 별도 커밋·별도 Reviewer 판정으로 미뤘다(가이드 §3.3·L-2). 그 사이 화면은 「모든거래차단」, 텔레그램은 「킬스위치」로 표기가 섞여 있다 — 이 task 가 그것을 닫는다.

## 범위 (문자열만 — 로직·키·로그·DB 저장 텍스트 변경 금지)
정본: [구현 가이드 §3.3](../../../docs/design/2026-10-30-t108-implementation-guide.md) 표.

| 파일 | 바뀜 |
|---|---|
| `src/lib/signals/approval-message.ts` | 「하드 손절」→「손실한도 손절」·「EOD 손절」→「장마감 전 손절」·「킬스위치가 켜져 있음」→「모든거래차단이 켜져 있음」·「(DRY_RUN — 실…)」→「(가상 주문 — 실…)」·「킬스위치가 켜져 있어 승인하지 않았습니다」→「모든거래차단이 켜져 있어 …」 |
| `src/lib/signals/approval-notify.ts` | 「🔴 하드 손절 (자금보호)」→「🔴 손실한도 손절 (자금보호)」·「🔴 EOD 손절」→「🔴 장마감 전 손절」 |
| `src/lib/signals/telegram-approval.ts` | 「⛔ 킬스위치가 켜져 있어 …」→「⛔ 모든거래차단이 켜져 있어 …」 |
| `src/lib/strategy/eval-funnel-labels.ts` | 「청산: 하드손절 비활성」→「청산: 손실한도 손절 꺼짐」 |
| `src/lib/strategy/exit-switch.ts` | `describeExitEngineSwitch` 문구의 옛 용어 → 「손실한도 손절·장마감 전 손절·트레일링·익절」 |
| `src/lib/reports/trade-report.ts` | 「표본부족」→「건수 적음」 |
| `src/lib/safety/kill-switch.ts` | `sendAlert` 제목·본문의 「Kill Switch」·「킬스위치」·「KILL_SWITCH」(사용자에게 보이는 문자열) → 「모든거래차단」 (env 이름·로그·오류 코드는 유지) |
| 기존 시험 | `approval-message.test.ts`·`telegram-approval.test.ts`·`kill-switch*.test.ts` 등의 기대 문자열만 같이 수정 |

## 하지 않는 것
- `console.log/warn/error` 로그 문구 전부(pm2 로그 grep·운영 점검 문구가 기대함).
- `exit-engine.ts` 의 `reasonHead: '[EOD 손절]'`·`'[하드 손절]'`(DB `signals.reason` 에 저장되는 텍스트 — 신호 생성 경로).
- 오류 코드·필드(`KILL_SWITCH_ACTIVE`·`blockedBy:'kill_switch'`·`dry_run`)·env 이름(`DRY_RUN`·`KILL_SWITCH`)·`dry-run.ts` 경고 로그.
- `post-market-*.ts`·`judgment-recorder.ts`·`volatility-guard.ts`·`portfolio-snapshot/route.ts` 의 내부 경보 설명(v1 제외, 후속).
- 주문·승인·안전 판단 로직 변경, 스위치·DB·DDL.

## 위험·검증 계획
- 문구만이지만 **훅 감시 경로**(`^src/lib/signals/`·`^src/lib/strategy/`·`^src/lib/safety/`·`^src/lib/reports/`)라 Reviewer `최종 판정` 줄(scope = 실제 읽은 경로)이 있어야 커밋된다.
- 확인: 바뀐 줄 diff 가 문자열 리터럴뿐인지(로직·조건·키 변경 0), 기존 시험 기대값 변경이 용어 정정에 한정되는지, 로그·DB 저장 텍스트가 안 바뀌었는지, 텔레그램 메시지가 길이 제한·마크다운 이스케이프를 깨지 않는지(`telegram-approval` 의 파서·`callback_data` 가 문구에 의존하지 않는지).
- 배포: 웹 배포(push=blue/green), DB·네이티브 변경 없음.

## 판단 기록 (judge)
- [2026-10-31 01:02] codex_gate/C2 engine=jev → codex_required=true · mode=adversarial-review · focus=data_integrity · budget_rule=CX-limit-unknown-r2 | overrides=- | fallback=- | tokens=918

## 진행 기록
- [2026-10-31 00:50] 착수(Leader). 사용자 "다음 작업 이어서 진행해줘" 의 다음 작업으로 선택 — T-108 의 용어 정정 요청을 서버 문구까지 닫는 일이고 파일 7개·약 80줄. 서버 worktree `~/.node-local/stockinvest-t129`(기준 `de351bc`). T-108 배포(05:17 예약)에는 이 task 가 Reviewer 판정까지 끝났을 때만 함께 올리고, 아니면 T-108 커밋까지만 push 한다.
- [01:15] **Leader 결정**: ① Reviewer PASS(Critical 0·Major 0·Minor 4) — 경미 1 은 울타리 시험 보강으로 반영, 2·3·4 와 별칭 맵 필요성은 후속([[T-128-t108-followups]]) ② 텔레그램 청산 승인 메시지에 새 제목 「손실한도 손절」과 DB 저장 사유 앞머리 `[하드 손절]` 이 같이 보이는 혼재는 이번에 수용(표시 시점 별칭은 코드 변경이라 「문자열만」 보증을 깸) — 사용자에게 알린다 ③ 경보 6건(`volatility-guard.ts` L630·658·672, `portfolio-snapshot/route.ts` L27·50·218)에 「킬스위치」 잔존 — 이 task 의 선언된 제외 범위, 후속 ④ 훅 감시 경로 정정: 이 task 문서의 `^src/lib/reports/` 는 실제 SAFETY_PATHS 에 없다(감시 대상은 signals·strategy·safety 12개 파일).

## Developer
- [01:00] **구현 완료(t129-dev)**: 소스 7개 파일 문자열 리터럴 23개 치환(`approval-message.ts` 42·45·220·236·258, `approval-notify.ts` 142·145, `telegram-approval.ts` 223, `eval-funnel-labels.ts` 318, `exit-switch.ts` 142·145, `trade-report.ts` 613, `kill-switch.ts` 경보 제목·본문 8곳), 기존 시험 7개 파일 기대 문자열 13줄, 새 회귀 시험 `src/__tests__/t129-alert-terms-fence.test.ts`(AST·한글 리터럴 포함·console/env/주석 예외 명시). 소스 7개를 HEAD 와 AST 비교해 비문자열 코드 토큰·console 리터럴 동일. 조사(가/이·를/을) 정정. 바꾸지 않은 후보: `kill-switch.ts` 공유 `msg`(→ Codex 지적 뒤 분리 반영), `'환경변수 KILL_SWITCH'`(env 이름 출처 표기), `approval-message.ts:11` 주석.
- [01:10] **Codex 지적 반영**: `kill-switch.ts:118-123` `reportUnparsableKillSwitch` 공유 `msg` 분리(console 문장은 호출 안에 직접 써 바이트 동일, 경보 본문만 「모든거래차단 활성으로 처리합니다」), 울타리의 두 번째 ALLOWED 예외 제거(남은 예외: 「환경변수 KILL_SWITCH」 출처 표기 1건). 로직·throttle·판정·반환값 불변.
- [01:14] **Reviewer 경미 지적 반영**: 울타리에 `exit-switch.ts` 한정 `/트레일링 ?스탑|목표 ?익절/` 검사 추가(변이 M7 잡힘).

## Reviewer

- [01:04] 감사 방법(독립, 읽기·시험 실행만): 서버 worktree `~/.node-local/stockinvest-t129`(기준 `de351bc`, 미커밋 15파일)의 `git diff` 를 줄 단위로 읽고, 소스 7개를 HEAD 와 TypeScript AST 로 직접 비교했다(문자열·템플릿 조각 내용만 가린 비리터럴 토큰 골격). **[확실]** 7개 파일 모두 골격 동일(토큰 수 동일)·리터럴 개수 동일, 바뀐 리터럴은 23개(kill-switch 9 · approval-message 5 · approval-notify 2 · telegram-approval 1 · eval-funnel-labels 1 · exit-switch 3 · trade-report 2)로 Developer 보고와 일치. 로직·조건·키·정규식·상수·호출·주석 변경 0.
- [01:04] 바뀐 리터럴의 쓰임(AST 조상 확인) **[확실]**: kill-switch.ts 9개는 전부 `sendAlert`/`sendAlertThrottled` 인자(제목 6·본문 3)이고 console.* 안의 리터럴 변경은 0, env 이름·오류 코드·정규식 `/kill_switch|KILL_SWITCH/i` 변경 0. 스로틀 키(`kill-switch:*`)는 제목과 별개 인자이고 `notify/index.ts`·`throttle.ts`·`flags.ts` 에서 제목은 로그 출력·서식 외에 키·분기에 쓰이지 않는다(`shouldReportUnparsable` 키는 source=raw). 텔레그램 승인 흐름: `callback_data` 는 (동작·signalId·금액) HMAC 이라 문구와 무관, 오류 분기는 `errorCode`/`startsWith('order_…')` 라 바뀐 리터럴과 무관, 새 문구에 `& < >` 없음·HTML 태그 균형 유지·토스트 약 45자(200자 한도 안).
- [01:04] 의존처·시험 기대값 **[확실]**: 바뀐 문구를 includes/===/정규식으로 비교하는 코드는 src·scripts·docs·.claude 에 없다. 기존 시험 수정은 13줄이고 전부 용어 정정에 한정(trade-report 1 · kill-switch 2 · approval-message 3 · approval-notify 1 · telegram-approval 2 · exit-switch 4), 시험 논리·구조 변경 없음. `eval-funnel-labels` 라벨은 `eval-funnel-query.ts` 가 표시용 `label` 로만 쓰고 키는 원 코드(`r.reason`)다.
- [01:04] 실행 검증 **[확실]**: 관련 시험 18 스위트·667 시험 통과(t129 울타리·t108 울타리·exit-switch·engine-exit-disabled·approval-message/notify/telegram-approval·kill-switch*·trade-report*). 샌드박스 사본(원본 worktree 불변 — `git status` 15줄 그대로, 사본은 삭제함)에서 옛 문구 복귀 변이 21개(치환 정확히 1회 단언)를 돌려 20개 탐지·1개(M7) 미탐지. 처음 돌린 변이 하네스는 인코딩 불일치로 치환이 0회였고 그 결과는 폐기했다. 전체 jest·tsc 는 Leader 담당이라 재실행하지 않았다 — Developer 의 3711 통과·tsc 0 은 내가 확인하지 않았다. 실제 텔레그램 발송·pm2·DB·`.env` 접근 없음. 데모 게이트: 화면 소스 파일 변경 0 이라 check.mjs 는 돌리지 않았다(해당 없음). 화면에 나가는 라벨(`GATE_LABEL_KO`·`exitSwitchSummary`)은 가이드 §3.3 표와 일치.
- [01:04] 용어 정확성 **[확실]**: §12 표·가이드 §3.3 대조 — 「손실한도 손절」(hard_stop)·「장마감 전 손절」(eod_loss_cut)·「모든거래차단」·「가상 주문」(dryRun 분기)·「건수 적음」(화면 `ResearchTab` 의 「판단 보류(건수 적음)」과 같은 용법) 모두 표·문맥과 일치하고 조사(차단이/차단을, 익절이)가 맞다. exit-switch 의 「트레일링」「익절」은 §12 에는 없으나 가이드 §3.3 표에 명시돼 있고 화면 `check-copy.ts` 의 EXIT_KIND_LABEL·`SettingsPage.tsx:614` 와 같은 표기라 수용.
- [01:04] [minor-1] 시험 보호력 약화(Developer 공개와 일치 — 실제 약화 맞음) **[확실]**: `exit-switch.test.ts:125-128` 이 `하드손절·EOD손절·트레일링스탑·목표익절` 4단언에서 `손실한도 손절·장마감 전 손절·트레일링·익절` 로 바뀌며 뒤 둘은 옛 표기의 부분 문자열이라 복귀를 못 잡는다. 변이 M7(ON 문구 `·장마감 전 손절·트레일링·익절 동작 중` 을 `트레일링스탑·목표익절` 로 복귀)은 울타리·기존 시험 어디서도 잡히지 않았다(OFF 문구 복귀 M8 은 울타리가 잡음). 울타리 OLD_TERMS 에 `트레일링스탑|목표익절`(붙여 쓴 형태)이 없다. 권고(비차단, 시험만): `exit-switch.test.ts` 를 `'장마감 전 손절·트레일링·익절'` 단일 단언으로 조이거나, 울타리에 exit-switch.ts 한정 `/트레일링스탑|목표익절/` 추가(approval-message 의 `트레일링 스탑`·`목표 익절` 은 띄어 써서 걸리지 않음).
- [01:04] [minor-2] 공유 함수 경유 로그 문구 변경 **[확실]**: `describeExitEngineSwitch` 반환값은 설정 응답 `exitSwitchSummary` 외에 `db.ts:765-774` 부팅 배너(console.warn/log)·`engine.ts:792` 틱마다 console.warn·`engine.ts:990` 경보 본문에도 들어간다. 그래서 「console 로그 문구 무변경」은 리터럴 수준에서만 참이고 출력 수준에서는 이 로그 3곳의 용어가 바뀐다(Developer 의 AST 비교는 console 호출 안 리터럴만 봐서 이 경로를 못 본다). 저장소(src·scripts·docs·.claude·ecosystem.config.js)에 옛 단어(`하드손절` 등)로 그 로그를 grep 하는 곳은 없고 `engine-exit-disabled.test.ts` 는 `자동 청산 엔진 OFF` 만 단언한다(통과). 수용하되 최종 요약에 명시 권고 — pm2 로그를 옛 단어로 찾던 사람이 놀라지 않게.
- [01:04] [minor-3] 화면 표기 혼재(T-129 이전부터) **[확실]**: 「트레일링」「익절」(`check-copy.ts`·`SettingsPage.tsx:614`·exit-switch)과 「트레일링 스탑」「목표 익절」(`SettingsPage.tsx:493·505·643`·`AnalystStatusBanner.tsx:134`·텔레그램 EXIT_LABELS·approval-notify)이 공존한다. §12 표에 없는 말이라 이번 결함은 아님 — 후속에서 §12 에 한 줄로 정하길 권고.
- [01:04] [판단 요청 4(a) 답] 텔레그램 청산 승인 메시지에 새 제목 「손실한도 손절」과 DB 저장 앞머리 `[하드 손절]` 이 같이 보이는 것 → **이번 task 에는 두지 않는 쪽을 권고(수용)** **[가능성 높음]**. 근거: ① 가이드 §3.3 이 DB 저장 텍스트를 제외로 승인했고 화면도 같은 허용 경로다. ② 앞머리 문자열을 읽는 코드는 없다(grep: `[하드`·`[EOD` 는 exit-engine.ts 생성부와 시험뿐) — 표시 시점 별칭이 안전하게 가능하다. ③ 그러나 별칭은 문자열이 아니라 코드 변경이라 이번 diff 의 「문자열만」 보증을 깨고, 텔레그램 2곳(approval-message reasonLine·approval-notify 사유)과 화면의 사유 표시를 함께 정해야 한다. 후속 task 분리 권고: 표시 전용 함수로 `^\[(하드 손절|EOD 손절)\]` → 새 용어(과거 저장 행도 같이 바뀜), exit-engine.ts·DB 불변. 그때까지 사용자 보고에 「청산 승인 메시지에 새 이름과 옛 앞머리가 같이 보인다」를 알려야 한다. `approval-notify.test.ts:125-126` 이 이 혼재를 그대로 단언해 의도된 상태로 기록돼 있다.
- [01:04] [판단 요청 4(b) 답] `kill-switch.ts:119` 공유 `msg` 의 「KILL_SWITCH 활성으로 처리합니다」가 경보 본문에 남는 것 → **이번엔 수용** **[확실: 구조 / 가능성 높음: 영향 크기]**. 근거: ① 같은 `msg` 를 console.error 도 쓰므로 바꾸면 로그가 바뀐다. ② 분리는 새 변수를 만드는 코드 변경이라 안전 경로의 별도 감사 대상이다. ③ 같은 본문의 `환경변수 KILL_SWITCH`·`system_config.safety_kill_switch` 는 사용자가 고쳐야 할 실제 키 이름이라 유지가 맞다. ④ 제목은 「모든거래차단 값 해석 불가 — 활성 처리」로 새 용어이고, 이 경보는 값이 해석 불가일 때 프로세스당 (키·값) 조합마다 1회만 나간다(`shouldReportUnparsable`). 울타리 ALLOWED 에 사유와 함께 정확 일치로 등록돼 새 누출은 막힌다. 선택 후속: `alertMsg` 분리.
- [01:04] [정보] 이번 범위 밖에 옛 용어가 남은 사용자 노출 경보(AST 전수 조사): `src/lib/safety/volatility-guard.ts` L630·658·672(sendAlert/Throttled, 킬스위치) · `src/app/api/cron/portfolio-snapshot/route.ts` L27·50·218(킬스위치·Kill Switch). task 가 선언한 v1 제외·후속 대상이라 결함이 아니다. 다만 같은 사건(스냅샷 낡음)에서 kill-switch.ts 경보는 「모든거래차단」, 이 둘은 「킬스위치」로 오므로 사용자 보고의 남은 일로 올리고 후속 task 로 묶기를 권고한다. `exit-engine.ts` reasonHead 2개는 제외 대상 그대로.
- [01:04] 종합: critical 0 · major 0 · minor 3. 안전장치 우회 경로·로직 변경·로그 리터럴·오류 코드·env 이름 변경 없음. 확인하지 못한 것: 실제 텔레그램 렌더링, 전체 jest·tsc, 커밋 훅 동작, Codex 검토(미수행). 시험 파일 7개는 diff 수준으로 읽었고 전체 정독은 아니다.
- [01:07] 먼저 쓴 판정 줄을 철회한다: 그 줄은 Codex C2 지적 ①(경보 본문 분리) 반영 수정 전의 `kill-switch.ts`·울타리 시험 기준이라, 그대로 두면 수정본이 재확인 없이 커밋 훅을 통과한다(Leader 지시: 임시 판정 줄 금지). 1차 감사 결과 자체(critical 0 · major 0 · minor 3)는 위 항목 그대로이고, 판정 줄은 수정 재확인 뒤 다시 기록한다.
- [01:07] [Codex C2 지적 ① 판정: 채택] `kill-switch.ts:119` 공유 `msg` → 경보 본문에 「KILL_SWITCH 활성」이 남고 울타리 ALLOWED 가 이를 고정한다는 사실은 맞다(내가 위 4(b) 에서 이미 같은 사실을 확인). 다만 내 4(b) 판단은 「수용」이었고 Codex 는 medium — 차이는 심각도뿐이다. 사용자 지시 「모든 화면에서 동일하게」에 비추면 Leader 의 반영 결정이 맞고, 내가 수용 근거로 든 「분리는 별도 감사 대상 코드 변경」은 이제 그 감사를 이 라운드에서 하면 해소된다. 재확인 조건: ⓐ console.error 로 나가는 `msg` 원문은 그대로 ⓑ 분리가 `shouldReportUnparsable`·반환 흐름·호출 순서에 닿지 않을 것 ⓒ 경보 본문의 출처 표기(`환경변수 KILL_SWITCH`·`system_config.safety_kill_switch`)는 사용자가 고칠 실제 키라 유지 — 따라서 ALLOWED 의 첫 예외(`환경변수 KILL_SWITCH`)는 남고 두 번째만 제거되는 것이 정상 ⓓ 새 문구의 조사.
- [01:07] [Codex C2 지적 ② 판정: 사실 채택·조치 불요(수용)] `describeExitEngineSwitch` 반환값이 `db.ts:765-774`·`engine.ts:792` console 에 나가 로그 문구가 바뀐다는 사실은 맞고 내가 위 minor-2 에서 독립적으로 같은 결론에 이르렀다(오탐 아님). 포맷터를 둘로 나누자는 권고는 채택하지 않는다 — 저장소에 그 로그를 옛 단어로 찾는 곳이 없고(src·scripts·docs·.claude·ecosystem 전수 grep), 저장·판정 영향이 없으며, 같은 문장을 두 벌 유지하면 다음 용어 정정 때 한쪽만 고쳐질 위험이 더 크다. 대신 task 최종 요약에 「부팅 배너·엔진 틱 경고 로그의 청산 용어도 새 용어로 바뀜」을 한 줄 명시한다. Codex 요약의 나머지(표시 라벨은 저장·집계 키 아님, 콜백 서명·callback_data·스로틀 키·system_config 키 불변)는 내 AST·호출 조상 확인과 일치한다.

- [01:12] 재확인(Codex ① 반영 수정) — 범위·방법 **[확실]**: 수정본을 다시 읽고 (1) 나머지 소스 6개를 HEAD 와 AST 로 재비교(골격·리터럴 개수 동일, 그사이 변경 없음), (2) `kill-switch.ts` 는 `reportUnparsableKillSwitch` 를 뺀 나머지가 HEAD 와 골격 동일·리터럴 개수 동일에 바뀐 리터럴 8개(경보 제목·본문 전부 `sendAlertThrottled`/`sendAlert` 인자)임을 확인, (3) 시험 파일 7개는 diffstat 이 1차 때와 줄 수까지 동일(내용 해시 비교는 아님), (4) 샌드박스에서 HEAD 의 `kill-switch.ts` 와 수정본을 같은 목(mock)으로 실행해 비교.
- [01:12] 수정 ① 평가 = 4(b) 의 최종 판단: **적절하다(채택 확정)** **[확실]**. 실행 비교 결과 — env 경로(`환경변수 KILL_SWITCH`)·DB 경로(`system_config.safety_kill_switch`) 두 경우 모두 ⓐ `console.error` 출력이 HEAD 와 바이트 동일 ⓑ `isKillSwitchActive()` 반환값 true 동일 ⓒ 같은 값 두 번째 호출은 로그·경보 모두 억제(`shouldReportUnparsable` 불변) ⓓ 경보는 `critical` 레벨 1회, 제목 「모든거래차단 값 해석 불가 — 활성 처리」, 본문은 HEAD 본문에서 「KILL_SWITCH 활성으로 처리합니다」→「모든거래차단 활성으로 처리합니다」 한 군데만 다름. 코드상 `head` 변수는 console 과 경보가 공유하는 앞문장(출처·원값·`안전을 위해`)뿐이라 판정·throttle·반환 흐름에 닿지 않았다. 조사: 「모든거래차단 활성으로」는 어색하지 않고 제목과 같은 말. 경보 본문에 남는 `환경변수 KILL_SWITCH`·`system_config.safety_kill_switch` 는 사용자가 고칠 실제 키 이름이라 유지가 맞다.
- [01:12] 울타리 시험 재확인 **[확실]**: ALLOWED 예외가 2건에서 1건(`환경변수 KILL_SWITCH` — 출처 표기, 사유 명시)으로 줄었고, 제거된 예외의 문장은 이제 console 호출 안(제외)과 `head`(옛 용어 없음)로 갈라져 있다. 수정 후 변이: 경보 본문을 옛 용어로 되돌리면(A) 울타리가, 경보 제목을 되돌리면(B) 울타리가, 중복 억제 가드를 지우면(D) 기존 `kill-switch.test.ts` 가 잡는다. 관련 묶음(울타리 2·exit-switch·engine-exit-disabled·approval 3·kill-switch*·flags·trade-report*) 19 스위트·681 시험 통과. 전체 jest·tsc 는 Leader 가 돌리는 중이라 재실행하지 않았다.
- [01:12] [minor-4, 비차단] console 문구 불변이 시험으로 고정돼 있지 않다 **[확실]**: 변이 C(`console.error` 문구를 「모든거래차단 활성으로…」로 바꿔 로그를 바꿈)는 울타리·기존 시험 어디서도 잡히지 않았다(울타리는 console 안 리터럴을 일부러 제외하고, `kill-switch.test.ts` 는 경보 제목의 `해석 불가` 만 단언). 이번 수정이 로그를 안 바꿨다는 근거는 위 실행 비교와 Developer 의 임시 시험(커밋 안 됨)뿐이다. 선택 권고: `kill-switch.test.ts` 의 해석 불가 시험에 `console.error` 호출 문자열 단언 1줄을 더해 영구 고정.
- [01:12] 종합: critical 0 · major 0 · minor 4(minor-1 시험 보호력 · minor-2 로그 3곳 용어 변경 수용 · minor-3 화면 표기 혼재 후속 · minor-4 console 불변 미고정 — 전부 비차단). Codex 2건: ① 채택(반영 완료, 확인 완료) ② 사실 채택·조치 불요(수용). 4(a)=이번 task 에 두지 않고 후속 task 분리 + 사용자 보고에 「청산 승인 메시지에 새 이름과 옛 앞머리 `[하드 손절]`/`[EOD 손절]` 병존」 명시, 4(b)=반영 결정이 적절. 후속 권고: 표시용 사유 앞머리 별칭 · `volatility-guard.ts`·`portfolio-snapshot/route.ts` 경보 6건 용어 정정 · §12 에 「트레일링」「익절」 표기 확정. 확인하지 못한 것: 실제 텔레그램 렌더링, 전체 jest·tsc(Leader 실행 중), 커밋 훅 동작, Codex 가 읽지 않은 운영 DB·알림 이력.
- [01:12] **최종 판정: PASS (scope: src/lib/safety/kill-switch.ts, src/lib/safety/__tests__/kill-switch-hidden-usd.test.ts, src/lib/safety/__tests__/kill-switch-transition-note.test.ts, src/lib/signals/approval-message.ts, src/lib/signals/approval-notify.ts, src/lib/signals/telegram-approval.ts, src/lib/signals/__tests__/approval-message.test.ts, src/lib/signals/__tests__/approval-notify.test.ts, src/lib/signals/__tests__/telegram-approval.test.ts, src/lib/strategy/eval-funnel-labels.ts, src/lib/strategy/exit-switch.ts, src/lib/strategy/__tests__/exit-switch.test.ts, src/lib/reports/trade-report.ts, src/lib/reports/__tests__/trade-report.test.ts, src/__tests__/t129-alert-terms-fence.test.ts)**

## QA
- [01:14] **QA 생략(Leader 판단)**: 문자열 리터럴 한정 변경이라 별도 QA 에이전트(일회용 환경·브라우저)는 두지 않고 Reviewer(AST 비교·console 바이트 동일·변이 21개 중 20개 검출)·Codex(데이터 무결성)와 자동 시험으로 대체. 서버 `flock` 직렬 실행(Leader): 전체 tsc 0(`TSC_EXIT=0`) · 전체 jest 340 스위트 9,567 통과·실패 0(`JEST_EXIT=0`, 건너뜀 6 스위트 184건 = 일회용 DB 시험) — T-108 구현(커밋 52442c5)이 이미 포함된 기준. 마지막으로 추가된 울타리 시험 1건은 Developer 가 해당 파일만 실행(4건 통과·변이 on/off 잡힘). **실제 텔레그램 발송·화면 렌더는 미확인**(배포 후 다음 알림에서 확인).

## 배포 기록

## Codex 검토

### [2026-10-31 01:04] C2 adversarial-review focus=data_integrity — done
- judge 판정: 2026-10-31 01:02 줄(codex_required=true · budget_rule=CX-limit-unknown-r2) / 호출 차수: 1/4
- 대상: repo=/home/brownjeon/.node-local/stockinvest-t129 base=de351bc(arg) snapshot=f6a41c7, 43초
- 지적 2건:
  - [medium] src/lib/safety/kill-switch.ts:119 — 값 해석 불가 때 경보 본문에 KILL_SWITCH 가 남고 새 울타리의 ALLOWED 예외가 이를 영구 고정 → 사용자 노출 용어 정정 기준 미충족 (권고: console 용 원문과 alert 본문 분리) — **Leader 반영 결정, 완료**
  - [low] src/lib/strategy/exit-switch.ts:142 — `describeExitEngineSwitch` 결과가 `db.ts:766·774`·`engine.ts:792` console 로그에도 적용돼 「로그 문구 불변」 기준과 어긋남 (저장·판정 영향 없음) — **Leader 수용 결정**(로그 grep 하는 docs·scripts·runbook 없음, 포맷터 분리는 한쪽만 고쳐질 위험이 더 큼; Reviewer 도 같은 판단)
- Codex 요약: 표시 라벨은 저장·집계 키 아님, 콜백 서명 입력·callback_data·알림 스로틀 키·system_config 키 불변 → 데이터 분할·기존 행 불일치 없음
- 검토하지 못한 범위: 실제 MariaDB 저장 데이터·운영 알림 이력 / Telegram 실전송·운영 로그 수집기 / 전체 Jest·tsc
- 원본: /home/brownjeon/NFS/homes/brownjeon/project/.claude/state/codex-review/runs/20261030T160447Z-T-129-C2/raw.txt

## 최종 요약
(미작성)
