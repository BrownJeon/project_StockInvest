---
task_id: T-131
title: T-126·T-127·T-128·T-130 후속 후보 모음 — 감사·QA 에서 나온 범위 밖 발견 (착수 전, 우선순위·승인은 사용자)
status: proposed
priority: medium
project: StockInvest
created: 2026-10-31
updated: 2026-10-31
base_ref: ec6723c17e510aeb4baa8cbd3174c1183d1805d6
risk_level: R2
roles_involved: [leader, judge, developer, reviewer, qa]
related_tasks: [T-126-exit-judgment-persistence, T-127-job-run-spool-hardening, T-128-t108-followups, T-130-t108-visual-followups, T-104-cron-jobs-market-grouping]
tags:
  - type/task
  - domain/safety
  - domain/ui
aliases:
  - 후속후보모음
waiting: [사용자 착수 결정 — 항목별 우선순위]
---

# T-131 후속 후보 모음 (착수 전)

10-31 T-126·T-127·T-128·T-130 작업에서 Reviewer·QA 가 낸 **범위 밖 발견**을 한곳에 모았다. 이 파일을 만든 것으로는 코드·DB·스위치를 바꾸지 않는다. 각 항목은 근거 위치(path:line)를 task 이력서 원문에서 가져왔다.

## A. 실거래 직전에 처리를 권하는 것 (안전·자금)
1. (2순위 묶음 — 실거래 단계 진입 전에 착수, 아직 미착수) **안전 스위치 저장 직렬화 + 위험 방향 확인 시트(D9-B)** — `SettingsPage.tsx` `autoSave` 에 진행 중 요청 가드가 없다(연타 시 탭마다 PATCH, 서버가 순서를 뒤바꿔 적용하면 화면과 서버가 어긋나 「모든거래차단이 켜진 줄 알았는데 꺼져 있음」 가능). 실거래여부 ON·모든거래차단 OFF 전환에 확인 단계 없음. UI 파일이지만 저장 의미가 바뀌어 Reviewer·QA, 서버 `api/settings/safety` 를 건드리면 SAFETY_PATHS 판정 필요. 출처: T-130 Reviewer 재감사·WP1 개발자. **실거래여부를 실제로 만지기 전에 처리 권고.**
2. **`toggleHybridMode` 가 저장 실패를 삼킨다** — 승인 후 진입 감시(하이브리드) 스위치 저장이 실패해도 화면은 새 값을 유지. API 가 커밋 훅 감시 목록. 출처: T-130 WP1.
3. ▶ **[T-134 로 처리 — 10-31 19:27 운영 반영 완료]** **`loadPositionState` 에 try/catch 없음** — `engine.ts:888`(T-126 기준 줄). `position_state` 조회 한 번 실패하면 그 시장 틱이 통째로 끝나 남은 종목의 손절·익절 평가가 멈춘다(변경 전 트리에서도 재현, Reviewer 확인). 출처: T-126 Reviewer·Developer. 청산 엔진 수정이라 R2·Reviewer·QA·Codex(가능하면).
4. ▶ **[T-135 로 처리 — 10-31 19:27 운영 반영 완료]** **매달린 INSERT 의 풀 연결 점유 — T-112 `job_run_log`/`judgment_*` 기록기에도 같은 성질** — T-126 은 `getConnection()` + 마감 시 `destroy()` 로 고쳤지만 T-112 기록기(`judgment-recorder.ts`·`job-run-log.ts`)는 그대로. 풀 10개를 주문 경로와 공유. 출처: T-126 Reviewer R1.
5. **entry-watcher 「진입 실행」 알림의 사유 줄에 옛 청산 앞머리 노출 가능** — `POST /api/signals/[id]/approve` 에 `editedScenario` 본문 + 하이브리드 모드일 때만 도달(UI 로는 도달 안 함). `approval-transitions.ts:80`, `entry-watcher/route.ts:531-538`. 이 경로가 열리면 청산 신호가 매도 주문까지 가는지는 미확인. 출처: T-128 QA 8번.

## B. 표시·문구 정리 (화면 — 데모 게이트 대상)
6. **「검증 관문 차단」 집계가 gate 없는 skipped 를 포함 (T-130 QA N1, Medium)** — `analysis-runs.ts` `RUN_SIGNALS_SQL`(46행)·`readRunSignals`(125~134행)가 `skipped` 전체를 blocked 로 세서 홈 칩 「시그널 2건 모두 검증 관문 차단」과 후보 줄 「건너뜀 · 사유 기록 없음」이 어긋남. 관찰 단계(검증 통과 전략 0/16)에서는 gate 없는 skipped 가 드물 것으로 추정(운영 데이터 미확인). 집계를 gate 조건으로 좁히는 SQL 변경 — 숫자 의미가 바뀌므로 Designer 확인.
7. 설정 화면의 남은 44px 미만 컨트롤: 정기 거래 리포트 **고정 발송 시각 입력칸 160×30**, 검색 드롭다운 항목 292×37, 별도 컴포넌트 5개(AI 제공자 [저장] 31px·거래소 [등록] 31px·프로젝트 태그 입력 29px/[저장] 28px·알림 채널 [등록] 31px). 출처: T-130 QA.
8. 영문 코드/옛 용어가 남은 곳: `src/lib/strategy/exit-switch.ts`(「트레일링·익절」, 감시 경로), `ScenarioAnalysis.tsx:208`, `OrderHistoryTab.tsx:319`(`blocked_by` 영문 그대로), 거래 리포트의 「손절」·「마감손절」, 정적 문구의 `paper_fills`·`eval_funnel`(홈 운용현황 하단·거래 › 운영 기록 하단·분석 › 검증·성과 청산 로직 foot — T-130 QA 는 예외로 둠), 청산 이름 `EXIT_KIND_LABEL[x] ?? x`.
9. 주문 사유 사전이 화면에 한 벌 더 있다(`TradeLogPanel.BLOCKED_BY_TEXT`·`ORDER_REASON_KO` — 값 일치만 시험으로 고정, 한 출처화 안 함). `blocked_by` 없는 차단 주문은 운영 기록 목록에 「차단」만 보임. `run_failed`·`order_max_unset` 한국어 문구 없음. 출처: T-130 WP2.
10. 값 행에서 Enter 를 길게 누르면 편집 칸이 열고 닫히며 깜박일 수 있음(Reviewer 추정, 미재현) — 입력칸 Enter 처리기를 `if (!e.repeat) close(...)` 로. 값 행 스크린리더가 둘째 줄(「0 = 무제한」)을 읽지 못함(Designer 판단). `.st` 줄바꿈 CSS 를 고정하는 시험 없음(F3).
11. 잡 이름 4개 [추측](`holdings-premarket`·`holding-checker` 등) — Designer 가 다듬을지 판단. T-104 WP5 가 새 스위치에 `label` prop 을 넘겨야 tsc 가 통과함.

## C. 읽기 계층·시험 (낮음)
12. T-128 Reviewer Low: 키 일치 시험의 `KNOWN_UNMAPPED` 설명 정정(`rag_fail`·`no_symbols` 는 화면에 보일 수 있음), `createSafetyReader` 가 상수 밖 SQL 을 거부하는 단언 1줄(변이 M09 생존), `approval-notify.ts:165` `[AI ` 줄 변환 시험 없음(M22 생존).
13. 일봉(`daily_bars`) 표 없음(1146)을 브로커 원장과 같은 규칙(`prep`)으로 — 홈 「데이터 이상」 건수 의미가 바뀌므로 `sourcesChecked` 의미와 함께 한 번에 정할 것(출처: T-128 Reviewer Low-4).
14. T-126 `exit_judgment` "영향 0" 배선 시험은 변경 후 엔진끼리 비교한다(Reviewer 의 변경 전 트리 대조 329건으로 보강) — 이후 `engine.ts` 편집에 대한 자동 보증은 아님. 시세·평단이 둘 다 1 이면 `currency='KRW'` 만 틀리게 남는 알려진 한계.

## D. 러너·운영
15. ▶ **[T-135 로 처리 — 10-31 19:27 운영 반영 완료]** **`call()` 의 `/tmp/cron-runner-$$.out`(644)에 마스킹 전 원문이 호출 동안 남음** + 응답이 200 이 아니면 러너 로그에 본문 앞 200자 — T-127 Reviewer L-1. `mktemp` + 호출 안 `umask 077` + 로그 `body=` 마스킹. `call()` 은 모든 잡의 경로라 러너 시험 7종(약 40분) 재실행 필요. 출처: T-127.
16. (T-135 에서 **제외**, 이유: 현재 금액을 싣는 라우트가 그 두 개뿐이라 발생 조건이 없고 라벨 정책을 바꾸면 비금액 라벨 진단 본문이 사라질 수 있다 — T-135 Reviewer R-2 도 같은 맥락) 마스킹 라벨이 두 개로 고정 — 금액을 싣는 새 `call` 라벨이 생기면 자동 마스킹 안 됨(I-3). 숫자 문자열(`"KRW":"123"`)·키/값 줄바꿈 미마스킹(L-2, 현재 라우트는 발생 조건 없음).
17. 롤업 `runs` 중복 가산(재전송 중복 억제 설계) — 스풀 줄 멱등 키 등. 스풀 줄 형식·서버 롤업 가산 규칙 변경이 필요해 별도 설계(T-127 에서 제외). 관찰 22:13 의 71 대 68(+3).
18. ✅ **[처리 — 2026-10-31 21:4x 사용자 「권고대로(주 1회+20MB)」: 시스템 logrotate, StockInvest 4개 파일, 주 1회 + 20MB 상한, 8개 보관, 압축, copytruncate, 사용자 crontab 매일 04:15. 첫 회전 11-01(일) 04:15 — 운영 방식·한계·되돌리기: [[stockinvest-log-rotation]]]** (아래는 결정 전 조사 기록) **pm2 로그 회전 없음** (2026-10-31 조사). 서버 pm2 한 개가 17개 앱(여러 프로젝트)을 돌리고 회전 도구가 없다(`pm2-logrotate` 미설치, `/etc/logrotate.d` 에 pm2 항목 없음; pm2 6.0.14). StockInvest 로그(`shared/logs/`): `cron-out.log` 9.4MB(6주, 하루 약 3,300줄×60B ≈ 0.2MB)·`pm2-out.log` 8.3MB(평일 약 3,000줄×89B ≈ 0.27MB/일, 주말 약 350줄)·`pm2-err.log` 3.8MB(평일 400~600줄×246B ≈ 0.1MB/일)·`cron-err.log` 0.2MB — 합쳐 약 0.6MB/일(월 약 18MB), 디스크는 488GB 여유(44% 사용) → **급하지 않은 위생 작업**. 같은 폴더의 `api-usage-YYYY-MM-DD.jsonl` 은 앱이 날짜별로 이미 나누지만 **하루 약 4MB·월 약 120MB 가 보관 정책 없이 쌓인다**(별개 항목). pm2 전체에서 가장 큰 것은 `~/.pm2/logs/bjj-out.log` 50MB(BJJ, 활성)·`tradinginvest-out-15.log` 84MB(삭제된 앱의 정지 파일)·`theroute-out.log` 35MB(05-05 이후 정지). 도구 선택지 — A) 시스템 `logrotate`(이미 설치, 제3자 코드 없음): `daily|weekly|monthly` 와 `maxsize` 를 **함께** 쓸 수 있다(시간 경계 또는 크기 초과 중 먼저 오는 쪽), pm2 가 파일을 계속 열고 있어 `copytruncate` 필요(복사~비움 사이 몇 줄 유실 가능), root 없이 쓰려면 사용자 crontab 한 줄(영구 설정 변경). B) `pm2-logrotate` 모듈(`pm2 install`, npm 외부 코드를 pm2 데몬 안에서 실행): `max_size`(크기)와 `rotateInterval`(cron 시각)을 **둘 다** 설정, `retain`·`compress` 지원, **17개 앱 전부에 적용**(다른 프로젝트 로그까지). 기본값은 기억 기준이라 설치 후 `pm2 conf` 로 확인해야 한다. 회전 후에는 「최근 N시간 로그를 한 파일에서 grep」하는 점검 스크립트가 경계에서 직전 회전 파일도 읽어야 한다. 사용자 결정 필요: 기준(시간/크기/둘 다)·값·보관 개수·범위(StockInvest 4개 vs 전체)·도구. 16:00 국내 분석 소요 시간 이상(3분 36초)은 기존 후보 그대로.
19. ✅ **[해결 — 2026-10-31 22:1x 사용자 「CLI 갱신(권고)」]** nvm v25.6.1 의 전역 `@openai/codex` **0.156.1 → 0.166.0**(`PATH="$HOME/.nvm/versions/node/v25.6.1/bin:$PATH" npm i -g @openai/codex@latest`, 29초; 실제 바이너리는 플랫폼 패키지 `darwin-arm64`, 압축 해제 약 363MB). 검증: ① 실험 a 재실행(PATH 기본 `codex` + 설정 모델 `gpt-6.1-sol`, 이전엔 400) → **OK** ② 래퍼 끝까지(임시 저장소·가짜 한 줄 변경) → `status: done`·`parsed: true`·`files_modified_in_snapshot: []`·검토 1건·33초, `model_not_found` 0건. 첫 시험의 `incomplete / snapshot_modified` 는 CLI 때문이 아니라 **임시 저장소의 `core.fileMode=true`**(SMB 위 worktree 의 모든 파일이 권한 변경으로 보임) 때문이었다 — `core.fileMode=false` 로 같은 시험을 하자 사라졌고 프로젝트 저장소는 이미 false 다. ⚠ **설치본이 셋이다**: ① nvm 25.6.1(이것 — PATH 에서 `codex` 가 가리키는 것) ② Homebrew `/opt/homebrew`(0.116.0, **설치가 깨져 있다** `spawn … ENOENT`, PATH 뒤쪽이라 안 쓰임, 건드리지 않음) ③ ChatGPT 앱 번들(0.166.0-alpha.5.1, 앱 소유). 이 셸은 `node@22`(Homebrew)가 PATH 앞이라 **그냥 `npm i -g` 는 Homebrew 쪽에 설치된다** — 갱신은 nvm 의 npm 으로 해야 한다. nvm 전역은 node 버전별이라 다른 node 로 바꾸면 그쪽엔 codex 가 없다. 되돌리기: `PATH="$HOME/.nvm/versions/node/v25.6.1/bin:$PATH" npm i -g @openai/codex@0.156.1`(그러면 `gpt-6.1-sol` 은 다시 400). 래퍼 한계: 임의 저장소를 `core.fileMode=true` 로 검토시키면 SMB 위 worktree 가 전부 「M」으로 보여 `snapshot_modified`(incomplete)가 난다. **소급 Codex 검토 5건(T-126·T-127·T-128·T-134·T-135)은 사용자 승인(10-31 22:3x)** — 22:30 첫 시도(T-126)가 **계정 사용 한도 초과**(「try again at Nov 1st, 2026 2:15 AM」)로 5초 만에 실패, 11-01 02:25 재시도 예약(세션 한정; 입력·수동 실행법은 [[retro-codex]]). 지적 0건이 아니라 「검토 안 됨」이다. (아래는 해결 전 원인 정정 기록) **Codex 연계 — 원인 정정(10-31 21:2x)**: 처음 적은 「`~/.codex/config.toml` 의 `model = "gpt-6.1-sol"` 이 계정에서 미지원」은 **틀린 진단**이었다. 계정은 이 모델을 쓸 수 있고(모델 목록 캐시에 `gpt-6.1-sol` `visibility=list`), 같은 프롬프트로 CLI 만 바꿔 대조하니 CLI 0.156.1(PATH 의 npm 전역)+`gpt-6.1-sol` → 400 `model_not_found` / 같은 CLI+`gpt-5.6-sol` → OK / ChatGPT 앱 번들 CLI 0.166.0-alpha.5.1+`gpt-6.1-sol` → OK. **낡은 CLI(0.156.1, npm 최신 0.166.0)가 새 모델을 모르는 것이 원인**이다. 해결 후보(사용자 결정): ① `npm i -g @openai/codex@latest`(PATH 의 CLI 자체를 갱신, 사용자 전역 환경 변경) ② 래퍼 설정 `.claude/tools/codex-review/config.env` 의 `CODEX_BIN` 을 앱 번들 CLI 경로로 지정(워크스페이스 안 한 줄, 번들은 alpha 빌드 `0.166.0-alpha.5.1` 이고 앱 업데이트 때 경로·버전이 바뀐다) ③ 임시로 `model` 을 `gpt-5.6-sol` 로(사용자 전역 파일). 고치면 T-126·T-127·T-128 의 Codex 검토를 소급 실행할 수 있다. 남은 확인: 래퍼 경유(스냅샷 worktree 포함) 전체 호출은 이번에 돌려 보지 않았다 — 사소한 프롬프트로만 검증.

## E. T-134·T-135 에서 나온 이월 (2026-10-31, 모두 착수 전)
20. **`runMarket` 이 청산 엔진 뒤에 부르는 `strategies` 조회(`engine.ts:1347-1351`)와 `refreshUniverse`(1353)에 호출부 try 가 없다** — 던지면 그 틱의 `eval_funnel` 행이 사라지고 라우트가 500. 시그널·판단 기록은 이미 써진 뒤라 보호가 아니라 관찰 손실. 코드 읽기 결과, 재현 안 함. 출처: T-134 Developer 범위 밖 발견.
21. T-134 Reviewer F-1(Low): 던진 값이 null 프로토타입 객체이면 catch 안 `String(e)` 가 TypeError 를 내 루프 밖으로 샌다(변경 전에도 동일, 이웃 catch 도 같은 모양, mysql2 는 Error 객체만 던져 현실성 낮음). F-2(Low): 지표 계약 `docs/design/2026-10-30-t108-metrics-contract-draft.md:263` 청산 게이트 나열에 `exit_state_load_failed` 한 줄 누락(동작은 §11.3 와일드카드로 맞음).
22. T-134 F-3(Info): 이 실패는 이전엔 크론 500 → `job_run_log` failed 로 보였지만 이제 HTTP 200 으로 끝난다 — 반복 실패 전용 경보 필요 여부는 실패 빈도를 본 뒤 결정(운영에서 이 조회가 얼마나 실패하는지 미측정).
23. T-135 이월: ① 카드 조회 SELECT(`lookupCardIds`)와 스위치 읽기(`record-switch.ts`)는 여전히 일반 풀 — 그 표에 DDL 잠금이 걸리면 연결이 묶일 수 있다 ② 배포 순간 옛 러너가 `/tmp` 에 644 파일을 하나 남길 수 있다(새 러너 정리는 자기 디렉터리만 본다, 일회성) ③ `cron-runner.sh` ~606행 주석의 「`$$` 임시 파일명 충돌」 이유가 낡음(Reviewer R-1) ④ 비-200 로그에서 모든 라벨의 `"detail":"…"` 가 지워진다 — 사양대로이며 16번 점검 항목에 한 줄 추가(R-2) ⑤ 시작 정리의 생존 판정은 같은 PID 네임스페이스 가정(R-3, 현재 pm2 호스트 직접 실행이라 해당 없음) ⑥ mktemp 까지 실패하는 폴백 경로 이름이 예측 가능(R-4, 변경 전과 같음) ⑦ 재전송 중복으로 인한 롤업 `runs` 과대 집계는 줄었지만 없어지지 않음(17번과 같은 뿌리) ⑧ `exit-judgment.ts` 를 새 헬퍼 `bounded-conn.ts` 로 합치는 정리(T-126 이 방금 배포돼 스위치가 켜져 있어 미룬 것).
24. **배포 후 권고(T-135) — 19:32 평시 PROCESSLIST 는 비어 있음(폐기 경로가 실제로 돈 증거는 아직 없음; 상한 타임아웃이 난 시점에 다시 본다)**: 운영 MariaDB 에서 destroy 한 연결의 서버 쪽 대기 문장이 거둬지는지는 일회용 10.11 에서만 확인했다 — 배포 뒤 `SHOW PROCESSLIST` 를 읽기로 한 번 본다(서버가 안 거두면 풀 슬롯 대신 서버 스레드가 틱당 하나씩 남을 수 있다, T-126 과 같은 가정).

25. **(T-135 QA 관찰) 비정상 응답 로그 `body=` 마스킹의 남은 틈** — 마스킹 키 목록(`totalKRW`·`KRW`·`USD`·`headerPnlKRW`·`detail`) 밖의 금액성 키(`usdValueKRW`·`baselineKRW`·`usdCashRequired`·`cash` 등 라우트 코드에 있는 이름)와 줄바꿈이 들어간 JSON 은 로그에 원문으로 남을 수 있다. 퇴보는 아니다(옛 러너는 전부 원문) — 16번의 구체적 근거. 실제 비-200 본문에 금액이 실리는지는 미확인. 가장 단순한 처방은 마스킹을 늘리는 것이 아니라 **비정상 응답 로그에서 본문을 아예 찍지 않고 분류어·길이만 남기는 것**(T-127 의 `reason=` 방식).
26. **(10-31 조사 중 발견, 미검증 [추측]) `news-health` 기록기도 DB 대기 상한만 있고 연결은 놓지 않을 수 있다** — 10-29 08:00:42 로그에 `[news-health] retrieval overseas 기록이 4000ms 안에 끝나지 않아 건너뜀(DB 대기 상한)` 과 같은 줄의 `retrieval_error` 가 남았다. 4초 상한이 「기다림만」 끊는 방식이면 T-135 가 고친 기록기들과 같은 계열(타임아웃 뒤에도 풀 연결 점유)일 수 있다. 코드는 아직 읽지 않았다 — 확인부터 필요.

## 하지 않는 것
이 파일 작성으로는 코드·DB·스위치를 바꾸지 않는다. 착수는 사용자 결정(항목 번호로 지시).

## 진행 기록
- [2026-10-31 19:32] 3번 → T-134, 4·15번 → T-135 운영 반영 완료(릴리스 `20261031-192807-8ed1ba7b`). 남은 착수 대상: 1·2번(2순위 묶음 — 실거래 단계 진입 전), 5~14번, 16~25번.
- [2026-10-31 17:55] 사용자 「권고대로 착수」 — 1순위 ①(`getTicker` HTTP200)은 다른 세션의 [[T-133-ticker-business-failure-retry]] 가 진행 중이라 제외하고, 3번 → [[T-134-exit-engine-state-load-isolation]], 4·15번 → [[T-135-recorder-pool-hold-and-runner-tmp]] 로 착수(16번은 제외). 코드는 서버 worktree 별도 브랜치에 커밋(`bf9980a`·`0957125`), `main`·운영에는 아직 없다. E 절 추가.
- [2026-10-31 11:00] 등록(Leader). T-126·T-127·T-128·T-130 의 Reviewer·QA·Developer 범위 밖 발견을 모음.

## 최종 요약
(미작성)
