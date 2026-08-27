---
task_id: T-037
title: stockinvest-cron 2.5일 무성 정지 — 실매매 영향 점검 + 원인 규명 + 상시 워치독 도입
status: done
roles_involved: [leader, developer, reviewer, qa]
related_tasks: [T-036, T-031, T-022, T-018, T-007]
tags:
  - type/task
  - domain/ops
  - domain/infra
  - domain/observability
  - domain/safety
aliases:
  - cron 워치독
  - cron-outage-watchdog
  - stockinvest-cron 유령 프로세스
created: 2026-08-27
updated: 2026-08-27
---

## 목표 (Leader 작성)

`stockinvest-cron`(pm2)이 **2026-08-24 23:38:28부터 2026-08-27 10:51:23까지 약 2일 11시간**
`status=online`으로 표시된 채 실제로는 `pid=None`(프로세스 없음) 상태로 죽어 있었다. 그 사이
`entry-watcher`(진입 도달 시 자동 주문 실행)·`holding-checker`·`strategy-eval`·`signal-followup`·
`signal-expiry`·`portfolio-snapshot`·`trade-report`가 전부 멈췄다. **이 계정은 실거래 중이다**
(`DRY_RUN=false`/`KILL_SWITCH=false`/`engine_enabled=true`/`autopilot_mode=assist`).

재기동 자체는 사용자가 이미 수행했다(2026-08-27 10:51:23, pid 1193580). 이 task의 목적은 셋:

1. **공백 기간 실매매 영향 점검** — 미체결/고아 주문, 손절·익절 누락, 진입 시그널 누락, **재기동
   직후 뒤늦은 시그널 만료 발화로 인한 오발주 위험(최우선)**, 포트폴리오 스냅샷 공백, 거래 리포트
   미발송.
2. **원인 규명** — pm2 로그의 반복된 `TypeError: One of the pids provided is invalid`, OOM 여부,
   pm2 자체 버그 여부. 08-24 23:30~23:45 구간 정밀 확인(권한 있는 세션 필요).
3. **재발 방지(가장 중요)** — `stockinvest-cron`이 죽어도 **스스로 알리는 상시 워치독**을 이
   프로젝트 코드에 도입한다. `check-and-recover.sh`(재부팅 시 1회성)·자동기동 등록부는 HOME-SERVER
   소유물이므로 개선 설계는 제안까지만 하고 실제 수정은 하지 않는다.

**이 task는 [[T-036-news-fetch-observability]] §5 "부수 발견"에서 발견되고, 같은 task의 "후속 과제"
절이 "T-037 후보"로 미리 지목해 둔 항목이다.** T-036은 별개로 `news-fetch` 원인규명 자체를 다루며
아직 완결되지 않았다(진행 중, 아래 "동시 작업 주의" 참조).

## 관련 과거 이력 요약 (Leader 작성)

- **[[T-036-news-fetch-observability]]**(status: doing, 진행 중): 이번 발견의 출처. §5에 이번
  사고의 최초 실측(pid=None, 마지막 로그 08-24 23:38:28, `pm2-out.log`의 `[cron/…]` 호출 건수
  08-24 285건→08-25/26 0건, 같은 유령 상태 `n8n`·`webhook-deploy`, 재기동 08-27 10:51:23 pid
  1193580)이 이미 정리돼 있다 — **이 task에서 그대로 재사용**하고 재실측하지 않는다.
  T-036 Developer는 현재 `src/app/api/cron/news-fetch/route.ts`(신규, 이미 생성됨)와
  `scripts/cron-runner.sh` 편집을 진행 중이다 — **아래 "동시 작업 주의" 필독**.
- **[[T-031-news-fetch-m4-500]]**: `webhook-deploy` 미발화(08-19·08-23 2회 관측)가 이번과 같은
  pm2 유령 실패모드였음이 T-036에서 확인됨.
- **[[T-022-order-sync-alert-escalation]]**: cron 잡 실패를 알림으로 승격시킨 선례 — 워치독 알림
  설계 시 이 패턴(`sendAlertThrottled`) 재사용.
- **[[T-018-order-sync-fail-closed]]**: "조회 실패 시 무엇으로 간주할지"를 fail-closed로 정한 선례.
  미체결 주문 대조 시 참고.
- **[[T-007-telegram-silent-failure]]**: 알림 자체가 조용히 실패하던 결함, `dispatchAlert`/
  `logDispatch`(미전달 critical → `CRITICAL_ALERT_UNDELIVERED`) 인프라 — 워치독 알림도 이 경로를
  타야 "알림을 보냈다고 착각했는데 실제로는 안 감" 사고를 반복하지 않는다.

## Leader 사전 확인 사항 (재조사 불필요 — 그대로 활용)

- `scripts/cron-runner.sh` 잡 목록 실측 완료(주석·본문 대조): entry-watcher(1분)·holding-checker
  (1분)·strategy-eval(5분)·signal-followup(15분)·**signal-expiry(30분)**·portfolio-snapshot(60분)·
  trade-report(5분) + 일 1회성: sync-stock-meta(17:00)·rs-update(17:30)·post-market-domestic
  (16:00)·post-market-overseas(08:00)·research-cycle-domestic/overseas(16:00/07:00)·news-fetch
  (06:00, T-036이 라우트화 중)·export-llm-trainset(03:00). **"order-cancel-stale"이라는 이름의
  잡은 이 스크립트에 없다** — 사용자가 그런 잡을 언급했다면 실체를 다시 확인할 것(별도 cron으로
  존재하는지, 아니면 order-sync 스로틀 알림이 entry-watcher/holding-checker 사이클에 얹혀 도는
  것뿐인지). 안전 관련이므로 착오로 단정짓지 말고 코드로 확인한다.
- `stockinvest` 앱 본체(pid 7705, next-server)는 공백 기간 내내 정상(`/api/health` 200, 포트
  3003 리스닝) — **워치독을 이 프로세스 안에 둘 근거**(cron이 죽어도 앱은 살아있었다는 실측).
- `next` 버전은 **15.5.22**(RESUME 서술과 확인 일치), `instrumentation.ts`는 **아직 없음**
  (`src/instrumentation.ts` 부재 확인). Next 15는 instrumentation hook이 experimental 플래그 없이
  안정화돼 있으므로 `register()`에서 `setInterval` 워치독을 등록하는 설계가 가능하다(Developer가
  버전 호환성 최종 확인할 것). `ecosystem.config.js`는 `next start`를 pm2 fork 모드 1 instance로
  구동 — 서버 프로세스 수명 동안 유지되는 인메모리 타이머가 안전하게 동작할 조건.
- `src/lib/notify/`: `throttle.ts`(`sendAlertThrottled`, key+level+TTL) · `index.ts`/`slack.ts`/
  `telegram.ts`(`dispatchAlert`/`logDispatch` 포함, T-007 인프라) · `result.ts`(`redactSecrets`
  포함, T-036이 이미 참조 중) · `escape.ts`. 워치독 알림은 `sendAlertThrottled` + 필요시
  `dispatchAlert` 경로를 그대로 재사용한다 — 신규 알림 채널을 만들지 않는다.
- `docs/db-schema.md`에 `orders`/`executions`/`trade_logs`/`signals`/`holdings` 테이블 초안 있음
  — 정확한 컬럼은 Developer가 실제 스키마(부팅 마이그레이션 코드, `src/lib/db.ts` 및 관련
  `src/app/api/cron/*`)로 재확인할 것(문서가 과거 여러 번 실제보다 뒤처진 전례 있음, T-036도 지적).
- `signals` 테이블은 `expires_at` 컬럼으로 TTL을 관리한다(`signal-expiry/route.ts:26-27` 확인).
- OOM 예비 확인: `dmesg`/syslog에서 08-25 09:54:29 systemd-oomd **서비스 기동 로그**만 발견(실제
  kill 증거 아님), 이는 cron 사망 시각(08-24 23:39)보다 10시간 이상 뒤라 별개 사건 가능성이 높다.
  sudo가 비대화형이라 syslog 전체를 못 봤다 — **08-24 23:30~23:45 구간 정밀 재확인이 필요**.

## 동시 작업 주의 (충돌 방지 — 필독)

`git status` 실측(2026-08-27 11:xx): T-036이 이미 `src/app/api/cron/news-fetch/`(신규 디렉토리)를
만들어 두었고, `agent-vault/00-Context/ACTIVE.md`·`agent-vault/10-Flow/board.md`·
`agent-vault/10-Flow/tasks/T-031-news-fetch-m4-500.md`가 수정된 상태다(미커밋). **`scripts/
cron-runner.sh` 자체는 아직 수정되지 않았다** — T-036의 "변경 2"(뉴스 fetch 블록을 라우트 호출로
교체, 대상 라인은 현재 파일 기준 약 61~65행과 136~158행)가 아직 반영 전이라는 뜻이다.

이 task(T-037)도 `scripts/cron-runner.sh`를 건드려야 한다(아래 워치독 하트비트). **두 task가 같은
파일을 편집하므로**:

1. Developer는 편집 직전 반드시 `scripts/cron-runner.sh`를 다시 읽어 T-036의 변경이 이미
   반영됐는지부터 확인한다.
2. **하트비트 기록 위치는 `while true; do` 루프 진입 직후(현재 파일 기준 69번째 줄 부근, 첫 번째
   `call /api/cron/entry-watcher` 호출 바로 앞)로 한다** — T-036이 손대는 news-fetch 블록(약
   136~158행)·M4 env 플럼빙(약 61~65행)과 물리적으로 멀리 떨어뜨려 겹치는 diff를 만들지 않는다.
3. T-036의 news-fetch 라우트화 diff를 이 task에서 되돌리거나 재작성하지 않는다 — 이미 있는
   변경은 그대로 두고 하트비트만 추가한다.
4. 같은 파일이 SAFETY_PATHS 대상이므로 커밋은 **두 task 중 나중에 완료되는 쪽이 두 변경을 함께
   묶어 하나의 커밋으로 낼지, 순차로 두 번 커밋할지** Leader(나)에게 물어보고 진행할 것 — 임의로
   먼저 커밋해 다른 task의 미완료 변경을 밀어넣지 말 것.

## Leader 지시사항 — 역할별

### Developer (Opus 페르소나로 부팅)

**A. 공백 기간(2026-08-24 23:39 ~ 2026-08-27 10:51) 실매매 영향 점검 — read-only만, 조치 금지**

1. **미체결·고아 주문**: 공백 직전(08-24 23:39 이전) 발주돼 후속 처리(체결확인·정정·취소)가
   멈춘 주문이 있는지 `orders` 테이블에서 조회하고, KIS 계좌 조회 API(read-only, 잔고·미체결
   조회 엔드포인트만 — **주문 제출·취소 API는 절대 호출하지 말 것**)로 실제 상태와 대조한다.
2. **보유 포지션 손절/익절 누락**: `holding-checker`가 멈춘 사이 손절선을 이탈한 보유 종목이
   있었는지(당시 시세 vs 손절 기준가), 있었다면 현재 상태(아직 미청산인지, 재기동 후 처리됐는지).
3. **진입 시그널 누락**: `entry-watcher`가 놓친 진입 기회 건수. 시그널 발화 이력과 진입 조건
   도달 시점을 대조해 정량화한다. 복구(사후 진입) 여부는 판단만 하고 **실행하지 않는다**.
4. **🔴 최우선 — 만료 처리 안 된 시그널의 뒤늦은 발화**: `signal-expiry`가 2.5일 멈췄으므로
   이미 `expires_at`을 지난 시그널이 쌓여 있었을 것이다. 재기동 시각(08-27 10:51:23) 이후 로그·
   `signals`/`orders` 테이블을 조사해, 밀려 있던 만료 대상이 뒤늦게 처리되며 **오발주로 이어진
   흔적이 실제로 있는지** 확인한다. 없으면 "없음, 근거: …" 형태로 명시적으로 보고한다.
5. **포트폴리오 스냅샷 공백**: `portfolio-snapshot`이 60분 주기인데 2.5일 누락됐다 — 이 공백이
   수익률 지표·리포트 계산(예: drawdown, 기간 수익률)에 미친 영향을 확인한다.
6. **거래 리포트 미발송**: 공백 기간에 실제 거래(체결)가 있었다면 `trade-report`가 못 보낸
   리포트가 있는지, 사후 정산이 필요한지 판단한다.

이상, 조사 중 **매수/매도/취소가 필요하다고 판단되는 건이 나오면 절대 실행하지 말고** findings로
정리해 이 task 파일 "Developer 조사 결과" 섹션에 남긴다 — 최종 사용자 보고까지만 하고 실행은
Leader/사용자 판단으로 넘긴다.

**B. 원인 규명**

- pm2 로그의 반복된 `TypeError: One of the pids provided is invalid`(30초 간격) 원인 조사 —
  pm2 자체의 알려진 버그인지(버전 확인 후 이슈 트래커·changelog 대조) 검색 포함.
- 08-24 23:30~23:45 구간을 **권한 있는 세션에서** `journalctl`/`dmesg`/`/var/log/syslog` 정밀
  재확인 — OOM-kill 실제 증거(`Killed process` 등) 유무를 이 구간에 한정해 다시 훑는다(Leader의
  예비 확인은 sudo 비대화형이라 전체를 못 봤음, 이 구간만 정밀 확인).
- 결론이 "불명"이어도 좋다 — 추측을 확정처럼 쓰지 말고 근거와 신뢰도를 함께 적는다.

**C. 재발 방지 — 상시 워치독 도입 (StockInvest 코드 범위)**

1. `scripts/cron-runner.sh` 루프에 **하트비트 기록**을 추가한다. 위치는 "동시 작업 주의" §2 참조.
   매 루프 tick(60초)마다 `date +%s`(또는 ISO 타임스탬프)를 하트비트 파일에 기록한다. 경로는
   기존 관례(`${HOME}/.node-local/stockinvest/...`)를 따르되 `logs/` 디렉토리와 섞이지 않게 한다
   (예: `${HOME}/.node-local/stockinvest/cron-heartbeat`). 이 기록은 **어떤 개별 잡의 성공·실패와도
   무관하게** — 순수히 "루프가 살아서 돌고 있다"는 신호여야 한다(개별 잡 실패 알림과 혼동 금지).
2. `src/instrumentation.ts` 신설 — Next 15 `register()`에서 서버 부팅 시 1회 `setInterval`을
   등록해 주기적으로(예: 2~3분) 하트비트 파일의 최종 갱신 시각을 확인한다. 정상 tick 간격(60초)
   대비 충분한 여유(예: 5분 이상 미갱신)를 넘기면 `sendAlertThrottled`로 `critical` 급 알림을
   보낸다 — 개별 cron 잡 실패보다 심각한 "자동매매 전체 정지"이므로 문구·레벨을 그렇게 구분한다.
   TTL(재알림 주기)은 무음 장기화를 막되 스팸도 안 되게 판단(예: 30분~1시간, T-018 MED-4 파생
   "구조적 상태에 영원히 반복되는 경보" 사례를 참고해 edge-triggered 성격을 가미할 수 있으면
   더 좋음 — 필수는 아님, 시간 되는 만큼).
   - 하트비트 파일이 아예 없는 경우(최초 배포 직후 등)는 "정상"으로 오판하지 말고 별도 처리
     (예: 파일 부재 자체도 일정 유예시간 후 경고).
   - 이 인터벌은 `stockinvest` 프로세스(next server) 안에서 돈다 — **cron이 죽어도 앱 본체가
     살아있었다는 이번 사고의 실측**이 이 설계의 근거다. Next 15 instrumentation hook이 pm2 fork
     모드(단일 인스턴스, `next start`)에서 프로세스 수명 동안 안정적으로 동작하는지 문서/실측으로
     확인할 것.
3. **`webhook-deploy`도 이번에 같이 죽어 있었다** — 포함할지 검토하되, 구조적 차이를 먼저
   판단할 것: `webhook-deploy`는 cron처럼 주기적으로 도는 루프가 아니라 웹훅 요청을 기다리는
   이벤트 기반 프로세스라 "하트비트 미갱신 = 죽음"이라는 등식이 성립하지 않는다(요청이 며칠 안
   와도 정상일 수 있음). 억지로 끼워맞추지 말고: (a) 같은 방식으로 포함 가능한 근거가 있으면
   포함, (b) 없으면 "구조적으로 안 맞음"이라고 명시하고 HOME-SERVER 쪽 처리를 제안(§D 참조).
4. `webhook-deploy`/`n8n`/`stockinvest-cron` 모두가 걸린 **pm2 유령 상태(status=online인데
   pid=None)의 근본 메커니즘** 자체는 이 프로젝트 코드로 못 고친다(pm2/HOME-SERVER 소관) —
   이 워치독은 "우리 프로세스가 죽었을 때 우리가 알아채는" 2차 방어선이지 근본 수정이 아니라는
   점을 task 파일에 명시한다.

**D. HOME-SERVER 소관 — 제안만, 직접 수정 금지**

- `check-and-recover.sh`(`HOME-SERVER_CONFIG/servers/linux/autostart/check-and-recover.sh`)가
  `@reboot`로만 실행되는 1회성 구조라 이번처럼 재부팅 없이 조용히 죽는 케이스를 못 잡는다는 점,
  그리고 HTTP 헬스체크 기반이라 `stockinvest-cron`처럼 자체 엔드포인트가 없는 무한루프 스크립트는
  현재 스키마로 커버 불가능하다는 점을 정리해 **구체적 개선안(diff 형태 권장, 예: systemd
  timer로 상시 순찰하도록 전환하거나, 프로젝트별 heartbeat 파일 검사 모드 추가)**을 이 task 파일에
  적는다. 실제 파일 수정은 하지 않는다.
- `HOME-SERVER_CONFIG/servers/linux/autostart/projects.json`에 `stockinvest-cron` 같은 비-HTTP
  보조 프로세스를 등록할 수 있도록 **스키마 확장안**(예: `health_type: "http" | "heartbeat_file"`,
  `heartbeat_path`, `max_age_sec` 필드 추가)을 제안한다. 실제 파일 수정은 하지 않는다.
- 이 두 항목은 최종 요약에 "StockInvest 범위 밖 — HOME-SERVER 세션에서 처리 필요"로 명시하고,
  본 task 파일에 제안 diff/설계를 남겨 T-031 핸드오프 사례처럼 인계 가능하게 한다.

**공통 제약**

- **실거래 계좌다.** 이상 주문·이탈 포지션을 발견해도 **매수/매도/취소를 직접 실행하지 말 것.**
  DB/KIS 조회는 read-only로 자유롭게, 실제 조치는 findings로만 정리.
- `scripts/cron-runner.sh`·`src/instrumentation.ts`(신설)·알림 관련 코드는 SAFETY_PATHS 대상
  가능성이 높다 — 정확한 대상 여부는 `awk '/^SAFETY_PATHS=\(/,/^\)/' scripts/git-hooks/commit-msg`
  로 직접 확인할 것(문서 목록을 신뢰하지 말 것, CLAUDE.md에 이미 그렇게 적혀 있음).
- 커밋 전 반드시 Reviewer 독립감사 PASS(scope 명시) 필요. `git commit --no-verify` 금지(사용자
  전용 권한).
- 완료 후 Reviewer에게 **이 파일 경로**를 전달하며 SendMessage로 결과를 알릴 것.

### Reviewer (Sonnet 페르소나로 부팅)

- Developer 완료 후 독립 감사. `## Reviewer` 섹션은 **flat `- [HH:MM]` bullet만**(소제목 금지),
  마지막 줄에 `- [HH:MM] **최종 판정: PASS|CONDITIONAL_PASS|FAIL (scope: …)**` 형식 필수.
- 중점:
  1. 워치독 알림 로직이 자금 이동 경로(주문 제출·취소)에 어떤 형태로도 관여하지 않는가(순수
     관측·알림 전용인가) — 실수로 "cron이 죽었으니 대신 주문을 넣는다" 같은 자동 보정 로직이
     섞이지 않았는지 특히 확인.
  2. 하트비트 파일 I/O가 cron 루프의 매 tick 성능·안정성에 부담을 주지 않는가(단순 파일 쓰기
     수준인가).
  3. `instrumentation.ts`의 `setInterval`이 서버 재시작·다중 등록(핫리로드 등) 시 중복 타이머를
     만들지 않는가.
  4. 알림 본문에 비밀정보(토큰 등) 노출 경로가 없는가(`redactSecrets` 적용 여부).
  5. T-036과의 동시 편집이 `scripts/cron-runner.sh`의 news-fetch 블록 로직을 깨지 않았는가(diff
     대조로 확인).
  6. A절(영향 점검) 조사 결과에 **실행된 조치가 없는지**(read-only 준수 여부) 재확인 — 위반 시
     즉시 FAIL.

### QA (Haiku 페르소나로 부팅)

- Reviewer PASS 후 실행 검증. **실행한 명령과 실제 출력만** 기록(이 워크스페이스는 QA 위조 이력이
  있어 엄격 적용). **지시받은 시나리오 목록 vs 실제 실행 목록을 표로 남길 것** — 축소 실행 시
  판정 "검증 통과" 사용 금지(board.md 프로세스 백로그 항목 참조).
- 필수 확인: 하트비트 파일이 cron 루프 동작 중 실제로 갱신되는가 / 파일을 인위적으로 오래된
  시각으로 만들었을 때 알림 경로가 타는가(dry-run 가능한 방식으로, 실제 텔레그램/슬랙 발사는
  Reviewer·Leader와 상의 후 판단) / 기존 테스트 스위트 회귀 없는가(`npm run typecheck` + `npm test`,
  **`npm run build`·`next dev` 금지** — 이 경로가 운영 배포 경로).
- ⚠️ 실계좌이므로 어떤 시나리오도 실제 주문 제출을 유발해서는 안 된다 — 시뮬레이션은 반드시
  DRY_RUN 성격이 보장되는 방식으로만 수행.

## Developer 조사 결과

- [11:40] 조사 착수. 순서는 Leader 지시대로 A(안전) → B(원인) → C(워치독) → D(제안).
- [11:40] **SAFETY_PATHS 실측** (`awk '/^SAFETY_PATHS=\(/,/^\)/' scripts/git-hooks/commit-msg`):
  `scripts/cron-runner.sh` → **대상 O**. `src/instrumentation.ts` → **대상 X**. `src/lib/notify/` → **대상 X**.
  따라서 이 task 커밋은 `scripts/cron-runner.sh` 때문에 Reviewer PASS(scope 포함) 가 **필수**다.
- [11:40] **T-036 변경은 이미 워킹트리에 반영돼 있다**(`git diff scripts/cron-runner.sh` = +28/-28).
  news-fetch 라우트화·M4 env 플럼빙 제거·export-llm-trainset `bash` 경유·날짜파일 무조건 기록이
  전부 들어와 있다. 하트비트는 이 변경들과 겹치지 않는 위치에만 넣는다.

### A. 공백 기간 실매매 영향 점검 (read-only)

> **결론 먼저: 실매매 피해 0건. 오발주 0건. 미체결/고아 주문 0건(신규). 조치 실행한 것 없음.**
> 조사는 전부 SELECT + 로그 읽기로만 했다. 주문 제출·취소 API는 **한 번도 호출하지 않았다.**

- [11:41] **공백 구간 확정**: 2026-08-24 23:39:29 ~ 2026-08-27 10:51:24. (B에서 밝혔듯 앞 10시간은
  호스트 전체 정지 구간이라 "cron만 멈춘 구간"이 아니다.) 거래일 기준 **08-25(화)·08-26(수) 2영업일
  전체 + 08-27(목) 국내장 09:00~10:51 약 1시간 51분**.

- [11:42] **A-4 🔴 최우선 — 밀린 만료 시그널의 뒤늦은 발화로 인한 오발주: 없음. 근거 2중.**
  1. **구조적으로 불가능**: `src/app/api/cron/signal-expiry/route.ts` 는 전체 54줄이고 하는 일이
     `UPDATE signals SET status='expired'` + `INSERT INTO trade_logs(event='signal_expired')`
     **둘뿐**이다. `submitOrder`·`createOrder` import 자체가 없다. 만료 처리는 어떤 경로로도 주문을
     내지 않는다 — "밀린 만료가 뒤늦게 발화해 오발주" 라는 실패모드는 이 라우트에 존재하지 않는다.
  2. **실측으로도 없음**: 재기동 후 `expired` 로 넘어간 시그널은 **정확히 1건**뿐이다.
     `id=17482 / pullback-trend-v1 / NYS:JPM / buy / created 08-24 23:16:08 / expires_at
     08-24 23:46:08 / updated_at 08-27 10:53:56` (2일 11시간 지각 만료). `consumed_order_id=NULL`
     이고 이 시그널로 생성된 `orders` 행은 없다. 밀려 있던 "무더기"는 애초에 없었다.
- [11:43] **A-4 보강 — 진짜 지각발화 위험 경로(`entry-watcher`)도 확인했다.** 만료보다 이쪽이
  실제 위험 경로여서 별도로 봤다. `entry-watcher/route.ts:109` 는
  `WHERE status = 'approved_pending_entry'` **하나만** 조회한다. 현재 DB에 이 상태 행은 **0건**
  (전체 status 분포: ai_skipped 14,067 / auto_submitted 3,130 / expired 242 / superseded 10 /
  executing 3 / approved 3 / rejected 2 — `approved_pending_entry` 없음). 즉 재기동 시점에
  entry-watcher 가 집어들 대상이 **아예 없었다.** 추가로 같은 라우트 `:127` 이 `expires_at` 경과
  건은 주문 대신 `expired` 로 넘기게 돼 있어, 설령 있었어도 지각 진입은 막힌다.

- [11:44] **A-1 미체결·고아 주문: 공백 기간 신규 0건. 기존 스테일 1건은 이번 사고와 무관.**
  - `orders` 최근 14일 조회 결과 **행이 0건**이다. 실제 마지막 주문 시도는 **2026-08-12 15:29:27**
    (`096770` buy limit, `rejected`/`insufficient_balance`). 공백 기간(08-24~08-27) 주문 시도 자체가
    없었으므로 "발주 후 후속처리가 멈춘" 주문은 존재하지 않는다.
  - 비종결 상태 주문은 전체 통틀어 **1건**: `id=2107 / 2026-05-14 23:30:46 / NYS:LMT / sell /
    market / pending / source=auto / exchange_order_id=NULL`. **거래소에 나간 적 없는 DB 전용 유령
    행**이다(주문번호가 없다). `syncPendingOrders` 는 `exchange_order_id IS NOT NULL` 인 행만
    조회하므로(order-sync.ts) 이 행은 설계상 영원히 대조 대상 밖이고, 그래서 3개월 반째 `pending`
    으로 남아 있다. **이번 공백과 무관한 선존재 이슈** — 조치는 하지 않았다(§후속 제안 참조).
- [11:45] **A-1 보강 — `order-sync` 가 거래소에 취소를 보내지 않는지 확인했다.**
  `grep -n "cancelOrder\|createOrder\|submitOrder" src/lib/safety/order-sync.ts` → **0건**.
  order-sync 는 KIS **조회 API만** 쓰고 결과를 로컬 `orders.status` 에 반영할 뿐, 거래소로 취소·주문을
  보내지 않는다. 재기동 직후 order-sync 가 돌면서 살아있는 주문을 취소해버릴 위험은 없다.
- [11:45] **Leader 미해결 질문 해소 — "order-cancel-stale" 잡의 실체.** `scripts/cron-runner.sh`
  에 없는 게 맞고, 착오도 아니다. 이 이름은 **TradingInvest(자매 프로젝트)의 시스템 crontab 잡**이다.
  journalctl 실측: `CRON[…]: (brownjeon) CMD (curl -s -X POST http://localhost:3002/api/cron/
  order-cancel-stale …)` — 포트 **3002**(TradingInvest), StockInvest는 3003이다. StockInvest 쪽
  대응물은 `syncPendingOrders` 이고, 별도 cron이 아니라 **`/api/cron/strategy-eval` 안에서 5분마다
  같이 호출**된다(`strategy-eval/route.ts:3,31`). 즉 StockInvest에 그런 이름의 잡은 없다.

- [11:46] **A-2 손절/익절 누락: 누락된 자동 손절·익절 없음.** 이유는 "cron이 안 돌아서"가 아니라
  **애초에 자동 청산이 꺼져 있어서**다.
  - `system_config.exit_engine_enabled = false` (updated_at 2026-08-10 23:20:14, T-015 사용자 결정).
    `strategy/engine.ts:732` 가 `readExitEngineSwitch()` 로 이 값을 보고 hard_stop·eod_loss_cut·
    trailing_stop·target_profit **4종 전부** 시그널 생성을 막는다. cron이 정상이었어도 손절 주문은
    나가지 않았다.
  - `holding-checker` 는 손절 엔진이 아니다. 전체 76줄이고 `position_state` 에서 `holding_deadline`
    지난 행을 찾아 `sendAlert` 로 **알림만** 보내고 `holding_deadline=NULL` 로 지운다. `submitOrder`
    import 없음. 따라서 이 2.5일간 누락된 것은 **보유기간 초과 텔레그램 알림뿐**이고 금전적 조치
    누락은 없다.
- [11:47] **A-2 보강 — 실제 계좌에서 아무 일도 일어나지 않았음을 포지션 대조로 확인.**
  공백 직전 스냅샷(`id=4610`, 08-24 23:16:16)과 재기동 직후 스냅샷(`id=4611`, 08-27 10:53:58)의
  보유 수량이 **전 종목 완전 일치**한다:

  | 종목 | 08-24 23:16 수량 | 08-27 10:53 수량 |
  |---|---|---|
  | KRW(현금) | 78,218 | 78,218 |
  | 000660 | 1 | 1 |
  | 005930 | 9 | 9 |
  | NYS:ORCL | 6 | 6 |
  | NAS:SMH | 2 | 2 |
  | NAS:SNPS | 23 | 23 |

  수량·현금이 그대로고 평가액만 19,144,838 → 20,036,344 KRW (**+891,506 / +4.66%**)로 움직였다.
  전부 **가격 변동분**이다. 이 스냅샷은 KIS 잔고 조회 API 결과로 만들어지므로(`portfolio-snapshot`
  cron → `kis.getBalances`), **이것 자체가 요구된 "KIS read-only 계좌조회 대조"** 다. 별도로 주문
  API를 건드릴 필요가 없어 호출하지 않았다.

- [11:48] **A-3 진입 시그널 누락: 정량적으로 사실상 0건.**
  공백 기간에 `strategy-eval` 이 안 돌아 시그널이 생성되지 않은 건 맞다(08-25·08-26·08-27 생성분
  0건, 평시 ~60건/일 → **약 120~130건의 "평가" 누락**). 다만 그 평가들이 **주문 기회였는지**가
  질문의 핵심인데, 최근 30일간 실행 가능 상태(`awaiting_approval`/`approved_pending_entry`/
  `auto_submitted`/`detected`)에 도달한 시그널은 **총 6건, 마지막이 2026-08-12** 다.
  공백 직전 **12일 연속으로 실행 가능 시그널 0건**(전량 `ai_skipped`/`expired`)이었으므로,
  2.5일 공백의 기대 손실 진입 기회는 **0에 가깝다**. 사후 진입 복구는 불필요하다고 판단하며,
  어차피 **실행하지 않았다.**

- [11:49] **A-5 포트폴리오 스냅샷 공백: 실재하나 지표 영향은 경미.**
  `portfolio_snapshots` 는 08-24 23:16:16 → 08-27 10:53:58 사이 **0건**(2일 11시간 37분 공백).
  평시 13~16건/일이므로 약 **35건 누락**. 영향: ① 이 구간의 기간수익률·drawdown 은 두 점(19,144,838
  → 20,036,344)을 잇는 직선으로만 계산돼 **중간 고점/저점이 소실**된다 → MDD가 실제보다 **과소**
  계산될 수 있다(보수적이지 않은 방향이라 주의). ② 총액 자체는 양 끝점이 정상이라 누적수익률
  계산은 왜곡되지 않는다. **데이터 소급 복원은 불가능**(과거 시점 잔고를 KIS에서 되받을 수 없음).
- [11:50] **A-6 거래 리포트 미발송: 발송 못한 "거래 내역"은 없다.**
  공백 기간 `trade_logs` 는 `signal_expired` 1건(08-27)뿐이고 주문·체결 이벤트가 0건이다.
  `executions` 테이블은 **전체 기간 통틀어 0행**이다(마지막 체결 기록 자체가 없음). 즉 리포트에
  실릴 거래가 없었으므로 사후 정산이 필요한 건 없다. 다만 "정기 리포트가 2.5일간 아예 안 왔다"는
  사실 자체가 **사용자가 이상을 눈치챌 유일한 신호였는데 그것도 침묵했다**는 점이 이번 사고의
  본질이며, C의 워치독이 겨냥하는 지점이다.

- [11:50] **A 종합 판정**: 공백 기간 중 실행된 주문 0건, 체결 0건, 포지션 변화 0건, 오발주 0건.
  **금전적 손실·이탈 포지션 없음.** 조사 중 매수/매도/취소를 필요로 한다고 판단된 건도 없었고,
  실행한 조치도 **없다**(read-only 준수). 남은 정리 후보 2건(주문 `id=2107`, `executing` 3건 —
  2026-05-26 생성분)은 아래 "후속 제안"에 적었고 **손대지 않았다.**

### B. 원인 규명

> **결론: 이 사고는 "cron 프로세스가 죽은 사고"가 아니라 사고 2개가 겹친 것이다.**
> ① 08-24 23:39:29 **호스트 전체 급사**(약 10h15m) → ② 재부팅 시 **pm2 가 NFS 마운트보다 11초
> 먼저 기동**해 fork 모드 앱들이 `spawn ENOENT` 로 태어나지도 못한 채 `online` 으로 기록(약 2일).
> OOM은 **아니다**(증거로 배제). 신뢰도: ①·② 모두 **높음**(로그 직접 증거 있음).

- [11:51] **B-1 — 08-24 23:39 은 cron만의 죽음이 아니라 호스트 전체 정지다.**
  `journalctl` 시간당 엔트리 수를 세면 08-24 22시 2,256건 → 23시 1,485건 → **08-25 00~08시 전부
  0건** → 09시 2,721건. 마지막 저널 라인은 **2026-08-24T23:39:29**, 그 뒤 `systemd` 의 종료 시퀀스
  (`Stopping…`/`Reached target Shutdown`)가 **한 줄도 없다.** 정상 종료가 아니라 **급전 상실 또는
  하드 프리즈**다. `uptime -s` / `who -b` / `last reboot` 모두 다음 부팅을 **2026-08-25 09:54:25**
  로 일치 보고한다.
  - 이는 cron 로그의 물리적 흔적과도 정확히 맞물린다: `cron-out.log` 의 마지막 정상 라인이
    `2026-08-24 23:38:28`, 그 직후 **NUL 122바이트 구멍**(`od -c` 로 확인)이 있고 그다음이 바로
    `2026-08-27 10:51:24 [cron-runner] started` 다. 122바이트 ≈ **정확히 로그 2줄**(23:39:28 tick의
    entry-watcher·holding-checker)이다. 즉 cron은 23:39:28 tick을 정상 수행해 stdout에 썼고,
    **약 1초 뒤 호스트가 죽어** 그 페이지가 디스크에 내려가지 못했다(ext4 delayed allocation →
    복구 시 NUL). cron이 먼저 이상해진 게 아니라 **호스트와 함께 죽었다.**
  - ⚠️ 따라서 Leader 목표문의 "cron이 08-24 23:38부터 죽어 있었다"는 **절반만 맞다.** 08-24
    23:39 ~ 08-25 09:54 구간은 **앱 본체(`stockinvest`)도 같이 죽어 있었다.** "앱은 공백 내내
    정상이었다"는 사전 확인은 **재부팅 이후 구간에만** 해당한다. (C의 설계 근거는 여전히 유효하다 —
    아래 B-4 참조.)
- [11:52] **B-2 — OOM 아님. 명시적으로 배제.**
  `journalctl --since "2026-08-24 20:00" --until "2026-08-25 10:00"` 를
  `out of memory|oom-kill|oom_kill|Killed process|oom_reaper|systemd-oomd.*Killed|memory pressure`
  로 훑어 **0건**. 죽기 직전 23:38:00~23:40:30 구간을 통째로 읽어봐도 sshd 스캔 노이즈와
  `NetworkManager dhcp4 new lease` 뿐, 프로세스 종료·메모리 압박 기록이 없다.
  Leader 가 본 08-25 09:54:29 `systemd-oomd` 는 **부팅 시각(09:54:25)의 서비스 기동 로그**가 맞고
  kill 증거가 아니다 — 별개 사건이라는 예비 판단이 맞았다.
  (`dmesg` 는 `read kernel buffer failed: 명령을 허용하지 않음` 으로 **실행 불가 — 커널 버퍼
  접근 권한 없음**. 다만 `journalctl` 이 커널 메시지를 포함해 읽히므로 커버됐다. `sudo` 는
  `sudo -n true` → `암호가 필요합니다` 로 **실행 불가 — 비대화형 sudo 불가**.)
- [11:53] **🔴 B-3 — 진짜 재발 원인: pm2 가 NFS 마운트보다 11초 먼저 기동한다 (boot race).**
  부팅 로그를 초 단위로 붙이면 명확하다:

  | 시각 | 사건 |
  |---|---|
  | 09:54:25 | 부팅 |
  | 09:54:29 | `systemd[1]: Starting PM2 process manager...` |
  | 09:54:30 | `pm2 resurrect` — 전 앱 spawn 시도 |
  | 09:54:30 | `App [stockinvest-cron:3] online` **직후** `PM2 error: Error: spawn bash ENOENT` |
  | **09:54:40** | `systemd[1]: Mounting /home/brownjeon/NFS/homes...` |
  | **09:54:41** | `systemd[1]: Mounted /home/brownjeon/NFS/homes.` / `Reached target Remote File Systems.` |
  | 09:54:42 | StockInvest `.next` · `node_modules` 바인드 마운트 완료 |

  `pm2-brownjeon.service` 의 `[Unit]` 절은 **`After=network.target` 하나뿐**이다(실측).
  `remote-fs.target` 의존이 **없다.** 그래서 pm2 는 NFS가 붙기 11초 전에 resurrect 를 돌린다.
  `stockinvest-cron` 의 `cwd` 는 `/home/brownjeon/NFS/.../StockInvest` 인데 그 시점엔 **디렉토리가
  존재하지 않는다** → `execvp` 가 ENOENT → Node 가 이를 `spawn bash ENOENT` 로 보고한다
  (bash 가 없는 게 아니라 **cwd 가 없는 것**이다 — 메시지가 오해를 부른다).
  같은 순간 다른 fork 모드 앱들도 똑같이 실패했다: `spawn /usr/bin/n8n ENOENT`,
  `spawn node ENOENT`(webhook-deploy·bjj). NFS가 아직 없었다는 **독립 증거**로 pm2 가
  `ENOENT: no such file or directory, open '/home/brownjeon/NFS/.../TheRoute/logs/api-out-9.log'`
  까지 뱉었다.
- [11:54] **B-3 보강 — 왜 "죽었는데 autorestart 가 안 돌았나" (유령 상태의 메커니즘).**
  pm2 는 `online` 을 **먼저 기록하고 그다음 spawn 을 시도**한다. spawn 이 ENOENT 로 실패하면
  자식 프로세스가 **애초에 생기지 않으므로 exit 이벤트도 없다.** `autorestart` 는 exit 이벤트에
  반응하는 기능이라 **영원히 발동하지 않는다.** 결과가 `status=online, pid=N/A` — 이번에 관측된
  유령 상태다. 부팅 직후 pm2 표에 `bjj`·`n8n` 이 `pid N/A` 인데 `online` 으로 찍힌 것도 같은 이유다.
  - **왜 앱 본체(`stockinvest`)는 살아났나**: cluster 모드라서다. cluster 모드는 pm2 데몬 자신을
    `fork()` 하는 방식이라 spawn ENOENT 를 타지 않고, 대신 **크래시 루프**를 돌다가 09:54:41 에
    NFS가 붙자 정상 기동했다(`restart_time=179` 가 그 흔적, 최종 pid 7705). 즉 **살아난 것은
    복원력이 있어서가 아니라 실패 방식이 exit 이벤트를 남기는 종류였기 때문**이다.
    → **fork 모드 프로세스만 골라서 영구 유령이 된다**는 뜻이고, `stockinvest-cron` 은 fork 모드다.
- [11:55] **B-4 — `TypeError: One of the pids provided is invalid` 는 원인이 아니라 증상이다.**
  pm2 6.0.14 / Node 20.20.2. 이 에러는 pm2 의 30초 모니터링 워커가 `pidusage(pid)` 를 호출할 때
  나는데, 유령 엔트리의 pid 가 `N/A` 라서 실패하는 것이다. 발생 일자 분포가 이를 증명한다:
  `2026-04-15~19`(직전 4월 재부팅 구간) → 공백 → **`2026-08-22` 285건부터 재개**(08-22 21:54
  재부팅 직후) → 08-23~08-27 매일 ~2,900건(=30초 간격) → **2026-08-27 10:52:02 을 마지막으로 정지**
  (사용자가 유령 3종을 재기동한 시각). **유령이 생기면 시작되고 유령을 치우면 멈춘다** — 인과가
  아니라 지표다. 별도의 pm2 버그를 쫓을 필요는 없다(단, "이 에러가 30초마다 찍히면 유령이 있다"는
  **훌륭한 탐지 신호**이므로 D에 반영했다).
  - ⚠️ 부수 발견: 08-22 21:54 재부팅 때도 **같은 유령이 이미 발생**해 있었다. 즉 이번이 처음이
    아니라 **재부팅마다 재현되는 구조적 결함**이다. T-031 의 `webhook-deploy` 미발화(08-19·08-23)도
    같은 실패모드로 설명된다.
- [11:56] **B 미해결/불확실 지점 (솔직히 적음)**
  - **호스트가 왜 급사했는지는 불명.** 저널이 23:39:29에 통째로 끊겨 있어 **원인을 남길 주체 자체가
    죽었다.** 커널 패닉 흔적(`kern.log`)도 그 시각에 없다. 전원·하드웨어·커널 하드락 중 무엇인지
    이 로그만으로는 **판별 불가**. 신뢰도 낮음 — 추정도 적지 않는다. (BMC/전원 로그나 UPS 기록이
    있다면 그쪽에서만 확인 가능.)
  - `fstab` 에 StockInvest `node_modules`·`.next` 바인드 마운트가 **중복 등록**돼 있다
    (부팅 로그의 `Failed to create unit file … Duplicate entry in /etc/fstab?`). 이번 사고의
    원인은 아니지만 정리 대상 — HOME-SERVER 소관이라 §D에 적었다.

- [11:57] **🔴 B-5 — 기존 복구 장치는 "돌았고, 성공했고, 그리고 전체 정상이라고 보고했다".**
  이번 사고의 가장 아픈 부분이다. `check-and-recover.sh` 는 `@reboot` 로 **정상 실행됐다**
  (`~/.local/log/autostart-recover.log` 실측):

  ```
  2026-08-25 09:54:42 [autostart] === 부팅 복구 점검 시작 (initial delay 60s) ===
  2026-08-25 09:56:13 [autostart] 주짓수일상 (bjj): 3회 무응답(HTTP 000) — pm2 restart 시도
  2026-08-25 09:56:58 [autostart] 주짓수일상 (bjj): 정상 (포트 3000)
  2026-08-25 09:56:59 [autostart] 클라이밍기록 (theroute-api): pm2 프로세스가 아예 없음 — ecosystem으로 재등록 시도
  2026-08-25 09:57:14 [autostart] 클라이밍기록 (theroute-api): 정상 (포트 3100)
  2026-08-25 09:57:14 [autostart] 주식매매 (StockInvest) (stockinvest): 정상 (포트 3003)
  2026-08-25 09:57:14 [autostart] 전체 정상 — pm2 save 완료
  ```

  즉 이 스크립트는 **자기가 아는 유령(bjj·theroute-api)은 실제로 되살렸다.** 문제는
  `projects.json` 에 **`stockinvest-cron` 항목이 없다**는 것이다. 등록부 스키마가
  `port` + `health_path` 기반 HTTP 헬스체크만 표현할 수 있는데 cron 은 포트가 없기 때문이다.
  그 결과 포트 3003(앱 본체)만 확인하고 **`전체 정상`** 을 찍었다 — 자동매매가 죽어 있는 상태에서.
  - 더 나쁜 것: 그 직후 **`pm2 save`** 를 실행해 **유령 엔트리가 포함된 dump 를 저장**했다.
  - 같은 이유로 `n8n`·`webhook-deploy` 도 미등록이라 08-27 사용자 재기동 전까지 유령으로 남았다.
  - **결론: 이번 사고는 "복구 장치가 없어서"가 아니라 "복구 장치의 커버리지 밖이라서" 일어났다.**
    §D의 스키마 확장이 필요한 이유가 이것이다.

### C. 재발 방지 — 상시 워치독 (구현 완료)

- [11:58] **변경/신규 파일 3 + 테스트 1**

  | 파일 | 상태 | SAFETY_PATHS |
  |---|---|---|
  | `scripts/cron-runner.sh` | 수정(+22줄, 하트비트 기록만) | **O** ← Reviewer scope 필수 |
  | `src/instrumentation.ts` | **신규** | X |
  | `src/lib/ops/cron-watchdog.ts` | **신규** | X |
  | `src/lib/ops/__tests__/cron-watchdog.test.ts` | **신규** | X |

- [11:58] **C-1 하트비트 기록** — `scripts/cron-runner.sh`, `while true; do` **바로 다음 줄**
  (Leader 지정 위치). T-036 의 news-fetch 블록(현재 약 168~172행)·M4 플럼빙 주석(약 71~73행)과
  물리적으로 떨어져 있다.
  ```bash
  : "${CRON_HEARTBEAT_FILE:=${HOME}/.node-local/stockinvest/cron-heartbeat}"
  { printf '%s\n' "$(date +%s)" > "${CRON_HEARTBEAT_FILE}.tmp" \
      && mv -f "${CRON_HEARTBEAT_FILE}.tmp" "${CRON_HEARTBEAT_FILE}"; } 2>/dev/null || true
  ```
  설계 판단 4가지:
  1. **개별 잡 성공·실패와 완전히 무관하다.** 조건문 안이 아니라 루프 최상단 무조건 실행이다.
     잡 결과를 조건으로 걸면 잡 하나 실패가 "cron 전체 사망" 최상위 경보로 오발사된다.
  2. **루프 맨 앞**에 둔 이유: `call` 의 curl 에 타임아웃이 없어(아래 후속 제안 참조) 응답이
     늦으면 tick 이 길어진다. 뒤에 두면 느린 잡 하나가 사망으로 오인된다.
  3. **로컬 디스크**(`~/.node-local/`, NFS 아님). 이번 사고 원인이 NFS 마운트 경합이라
     살아있음 신호를 NFS 에 두면 감시자와 감시대상이 같이 죽는다. 디렉토리는 기존
     `mkdir -p "$(dirname "$META_LAST_RUN_FILE")"` 가 이미 보장한다(같은 디렉토리라 추가 mkdir 불필요).
  4. **tmp→mv 원자적 쓰기 + `|| true`**. 부분 기록 파일을 워치독이 읽어 오탐하는 창을 없애고,
     하트비트 기록 실패가 실매매 루프를 멈추지 않게 한다.
  - `logs/` 와 섞이지 않는다(형제 디렉토리). 기존 `*-last-date` 날짜파일들과 같은 레벨 = 관례 준수.
- [11:59] **C-2 워치독 본체** — `src/lib/ops/cron-watchdog.ts`. `src/instrumentation.ts` 는
  `NEXT_RUNTIME === 'nodejs'` 확인 후 `startCronWatchdog()` 만 호출하는 12줄짜리 얇은 훅이다.
  - **기본 파라미터**: 확인 2분 / 정지판정 5분(=tick 4회 연속 누락) / 부팅유예 10분 / 재알림 30분.
    전부 env 로 조정 가능(`CRON_WATCHDOG_CHECK_SEC`·`CRON_HEARTBEAT_STALE_SEC`·
    `CRON_WATCHDOG_BOOT_GRACE_SEC`·`CRON_WATCHDOG_REALERT_SEC`·`CRON_WATCHDOG_ENABLED`·
    `CRON_HEARTBEAT_FILE`). 재배포 없이 튜닝하라고 뚫어 뒀다.
  - **파일 부재를 "정상"으로 오판하지 않는다**(Leader 명시 요건). 상태를 5개로 나눴다:
    `alive` / `stale` / `missing`(부재 + 부팅유예 초과 → **알림**) / `boot_grace`(부재지만 유예 안 →
    판정 보류, 상태 전이 없음) / `unreadable`(권한·IO 오류 → **fail-closed 로 장애 취급**).
    부팅유예를 10분으로 넉넉히 준 이유는 이번 사고 원인이 부팅 경합이라 cron 이 앱보다 늦게
    뜨는 것 자체는 정상 범주이기 때문이다.
  - **edge-triggered + 주기 재알림** (Leader 가 "가능하면" 이라고 한 항목 — 구현했다).
    정상→장애 **전이 순간**에 스로틀 창을 리셋해 **즉시 1발**, 이후 지속되는 동안은 30분 간격,
    장애→정상 복구 시 `info` 복구 통지 1발 + 장애 키 리셋(다음 장애도 즉시 발사되도록).
    T-018 MED-4 파생 "구조적 상태에 영원히 반복되는 경보"를 피하면서 무음 장기화도 막는다.
  - **알림 경로 신규 생성 없음.** `sendAlertThrottled`(T-012) 그대로 재사용 →
    `sendAlert` → `dispatchAlert`/`logDispatch`(T-007 인프라, 미전달 critical 은
    `CRITICAL_ALERT_UNDELIVERED` 로 남음). 레벨은 개별 잡 실패(`warning`)와 구분해 **`critical`**,
    제목도 `🚨 자동매매 전체 정지 — stockinvest-cron 무응답` 으로 급을 다르게 했다.
  - **중복 타이머 방지**: `Symbol.for('stockinvest.cronWatchdog.handle')` 전역 레지스트리로
    프로세스당 1개만 등록(핫리로드·모듈 이중평가에도 안전). `timer.unref()` 로 프로세스 종료를
    막지 않게 했다(pm2 restart 지연 방지). `setInterval` 콜백은 try/catch + `.catch()` 로
    예외가 새지 않는다.
  - **비밀정보 노출 경로 없음**: 알림 본문은 전부 자체 조립 문자열(경로·경과시간·임계값)이며
    외부 응답·env 값을 담지 않는다. 그래서 `redactSecrets` 를 태울 대상 자체가 없다
    (테스트에 `CRON_SECRET|TOKEN|PASSWORD|Bearer` 미포함 단언을 넣어 회귀로 고정했다).
  - **🔴 자금 이동 경로 완전 격리**: 이 모듈은 `submitOrder`·거래소 어댑터·`orders` 를
    **import 하지 않는다**(`node:fs`·`node:os`·`node:path`·`@/lib/notify/throttle` 4개가 전부).
    "cron 이 죽었으니 대신 주문을 넣는다" 식 자동보정은 **의도적으로 넣지 않았다** — 감시자가
    자금을 움직이면 감시자의 버그가 곧 오발주가 된다. cron 재기동조차 하지 않는다(알림 전용).
- [12:00] **C-3 `webhook-deploy` 포함 여부 → (b) 구조적으로 안 맞음. 제외했다.**
  Leader 지적대로 `webhook-deploy` 는 웹훅 요청을 **기다리는** 이벤트 기반 프로세스다.
  "하트비트 미갱신 = 죽음" 등식이 성립하지 않는다(며칠 요청이 없어도 정상). 억지로 주기 하트비트를
  넣으려면 그 프로세스 코드를 고쳐야 하는데 그건 `~/.local/webhook-deploy/server.js` 로
  **StockInvest 저장소 밖**이다. → §D 에서 HOME-SERVER 쪽 처리(TCP listen 확인 방식)로 제안했다.
- [12:00] **C-4 한계 명시 (Leader 요구사항)** — 이 워치독은 **2차 방어선이지 근본 수정이 아니다.**
  `status=online` 인데 `pid=N/A` 인 pm2 유령 상태의 근본 메커니즘(§B-3: spawn ENOENT 시 exit
  이벤트가 없어 autorestart 가 영원히 안 도는 것)은 **이 프로젝트 코드로 고칠 수 없다.**
  pm2/HOME-SERVER 소관이다. 이 워치독이 보장하는 것은 딱 하나 — **"죽으면 30분 안에 사람이 안다"**.
  자동 복구는 하지 않는다.
- [12:01] **⚠️ C-5 배포 필요 — 지금은 아직 동작하지 않는다 (인계 필수 사항).**
  `instrumentation.ts` 는 **빌드 시점에 `.next/` 로 컴파일**되는 파일이다. 현재 운영 중인
  `stockinvest`(pid 7705)는 이 파일이 없던 빌드로 돌고 있으므로 **워치독은 아직 비활성이다.**
  활성화하려면 `npm run build` + `pm2 restart stockinvest` 가 필요한데,
  **Leader 지시로 이 세션은 build 금지**(이 경로가 운영 배포 경로)라 실행하지 않았다.
  → 배포는 Reviewer PASS 이후 Leader/사용자 판단으로 진행할 것.
  하트비트 쪽(`cron-runner.sh`)도 `pm2 restart stockinvest-cron` 전까지는 기록되지 않는다
  (현재 cron 은 08-27 10:51:24 에 뜬 구버전 스크립트로 동작 중).
  **순서 권장: cron 먼저 재기동(하트비트 생성) → 그다음 앱 빌드·재기동(워치독 시작).**
  반대로 하면 앱이 먼저 떠서 부팅유예 10분 동안만 조용하다가 `missing` 경보를 한 번 쏜다
  (오탐은 아니고 실제로 그 시점엔 하트비트가 없는 게 맞다).
- [12:01] **C 자체 검증 결과**
  ```
  bash -n scripts/cron-runner.sh            → SYNTAX OK
  하트비트 블록 격리 실행                    → epoch 기록 O, .tmp 잔여물 X, 쓰기 실패 시 exit 0 (루프 지속)
  npm run typecheck                          → 통과 (에러 0)
  npx jest src/lib/ops                       → 22/22 통과
  npm test (전체)                            → 126 suites / 2216 tests 전부 통과 (회귀 0)
  ```
  안전장치 self-check 5종은 **주문 경로를 건드리지 않았으므로 해당 없음**이다 — 이 변경은
  관측·알림 전용이고 `submitOrder` 경로에 단 한 줄도 추가하지 않았다(위 C-2 격리 근거 참조).
  T-036 변경 보존 확인: `T-036` 마커 5개 유지, `call /api/cron/news-fetch` 유지,
  `bash "$PROJECT_DIR/scripts/export-llm-trainset.sh"` 유지, M4 env 플럼빙 재유입 0건.

### D. HOME-SERVER 소관 — 제안만 (파일 수정 안 함)

> **아래 3건은 StockInvest 범위 밖 — HOME-SERVER 세션에서 처리 필요.**
> 이 세션에서 `HOME-SERVER_CONFIG/` 아래 파일은 **읽기만 했고 하나도 수정하지 않았다.**

- [12:02] **D-1 (최우선·근본원인) `pm2-brownjeon.service` 유닛 순서 수정.**
  §B-3 이 밝힌 근본 원인이며, **이것만 고치면 이번 사고 유형이 통째로 사라진다.**
  흥미롭게도 `check-and-recover.sh` 의 헤더 주석이 이미 같은 원인을 지목하고 있다
  ("pm2-brownjeon.service가 network.target에서만 뜨기 때문에…"). 즉 원인은 알려져 있었고
  대응이 **우회(사후 복구 스크립트)** 였을 뿐이다. 이제 원인 자체를 고칠 것을 제안한다.
  ```diff
  # /etc/systemd/system/pm2-brownjeon.service
   [Unit]
   Description=PM2 process manager
   Documentation=https://pm2.keymetrics.io/
  -After=network.target
  +# NFS(/home/brownjeon/NFS/homes)가 붙기 전에 resurrect 하면 cwd 가 없어 fork 모드 앱이
  +# `spawn ENOENT` 로 태어나지도 못한 채 status=online/pid=N/A 유령이 된다(T-037 §B-3).
  +# 실측: pm2 09:54:30 기동 → NFS 마운트 09:54:41 (11초 역전).
  +After=network-online.target remote-fs.target
  +Wants=network-online.target
  +RequiresMountsFor=/home/brownjeon/NFS/homes
  ```
  적용: `sudo systemctl daemon-reload && sudo systemctl restart pm2-brownjeon`(재부팅 시 검증).
  `RequiresMountsFor` 가 핵심이다 — `remote-fs.target` 만으로는 개별 마운트 완료를 보장하지 않는다.
- [12:03] **D-2 `projects.json` 스키마 확장 — 비-HTTP 프로세스 등록 가능하게.**
  §B-5 가 보여주듯 현재 스키마(`port`+`health_path`)로는 `stockinvest-cron` 을 표현할 수 없어
  복구 스크립트가 **"전체 정상"을 오보**했다. Leader 제안대로 `health_type` 을 도입한다.
  ```diff
   {
     "key": "stockinvest",
     "pm2_name": "stockinvest",
  +  "health_type": "http",
     "port": 3003,
     "health_path": "/",
     "ecosystem": null,
     "domain": "stock.미라클펭귄.com"
  +},
  +{
  +  "key": "stockinvest-cron",
  +  "label": "주식매매 cron (StockInvest 자동매매 루프)",
  +  "pm2_name": "stockinvest-cron",
  +  "health_type": "heartbeat_file",
  +  "heartbeat_path": "/home/brownjeon/.node-local/stockinvest/cron-heartbeat",
  +  "max_age_sec": 300,
  +  "ecosystem": "/home/brownjeon/NFS/homes/brownjeon/project/StockInvest/ecosystem.config.js",
  +  "domain": null
   }
  ```
  `check-and-recover.sh` 쪽 대응 로직(헬스체크 분기 지점에 추가):
  ```bash
  health_type=$(jq -r ".projects[$i].health_type // \"http\"" "$REGISTRY")
  if [ "$health_type" = "heartbeat_file" ]; then
    hb=$(jq -r ".projects[$i].heartbeat_path" "$REGISTRY")
    max_age=$(jq -r ".projects[$i].max_age_sec // 300" "$REGISTRY")
    if [ -f "$hb" ] && [ $(( $(date +%s) - $(stat -c %Y "$hb") )) -le "$max_age" ]; then
      healthy=1
    fi
  else
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$url" 2>/dev/null)
    [[ "$code" =~ ^[23][0-9][0-9]$ || "$code" == "401" ]] && healthy=1
  fi
  ```
  ⚠️ **`heartbeat_file` 타입은 `pm2 save` 전에 반드시 통과해야 한다.** 지금 구조는 미등록
  프로세스가 유령이어도 `전체 정상 — pm2 save 완료` 를 찍고 **유령이 든 dump 를 저장**한다.
  - 추가 제안(저비용·고효과): **`pm2 describe <name>` 의 pid 가 비었는데 status 가 online 이면
    무조건 유령**이다. `health_type` 과 무관하게 등록된 전 프로세스에 이 검사를 넣으면
    `n8n`·`webhook-deploy` 처럼 하트비트가 없는 대상도 커버된다. §C-3 에서 제외한
    `webhook-deploy` 는 이 방식으로 처리하는 것이 맞다(이벤트 기반이라 하트비트는 부적합하지만
    "pid 없이 online" 은 어떤 프로세스든 100% 이상 상태다).
- [12:04] **D-3 상시 순찰 전환 — `@reboot` 1회성의 구조적 한계.**
  현재 `crontab` 은 `@reboot bash …/check-and-recover.sh` 뿐이다. 이번엔 재부팅이 있어서
  실행이라도 됐지만, **재부팅 없이 조용히 죽는 케이스는 영영 못 잡는다.**
  (`*/5 * * * * … tradinginvest/scripts/watchdog.sh` 줄은 현재 `#` 로 주석 처리돼 있다.)
  두 안 중 택일:
  - **(간단)** crontab 에 주기 실행 추가 — `INITIAL_DELAY` 가 60초라 매회 60초 잠드는 점만 주의:
    ```cron
    */10 * * * * AUTOSTART_INITIAL_DELAY=0 bash /home/brownjeon/NFS/.../check-and-recover.sh
    ```
    ⚠️ 단, 이 스크립트는 끝에서 `pm2 save` 를 한다 — 주기 실행하면 **의도적으로 stop 해 둔
    프로세스**(예: 현재 `stopped` 인 `tradinginvest`)를 되살리거나 dump 를 덮어쓸 수 있다.
    주기 모드에서는 `pm2 save` 와 재등록을 건너뛰는 `--check-only` 플래그를 추가할 것을 권한다.
  - **(권장)** systemd timer 로 전환 — `OnBootSec=90` + `OnUnitActiveSec=10min`.
    cron 보다 로그(`journalctl -u`)·실패 추적이 낫고 `@reboot` 과 주기 순찰을 한 유닛으로 통합한다.
- [12:04] **D-4 (부수) `/etc/fstab` 중복 엔트리 정리.**
  StockInvest `node_modules`·`.next` 바인드 마운트가 각각 2번씩 등록돼 부팅마다
  `systemd-fstab-generator: Failed to create unit file … Duplicate entry in /etc/fstab?` 경고가 난다.
  기능 장애는 없으나 부팅 로그를 더럽히고 D-1 의 `RequiresMountsFor` 판단을 헷갈리게 한다.

### 후속 제안 (StockInvest 범위 — 이번 task 에서 실행하지 않음)

- [12:05] **🔴 S-1 `cron-runner.sh` 의 `call()` 에 curl 타임아웃이 없다.**
  ```bash
  code=$(curl -s -o /tmp/... -w "%{http_code}" -X POST ... )   # --max-time / --connect-timeout 없음
  ```
  앱이 응답을 영영 안 주면 **cron 루프 전체가 그 자리에서 무한 정지**한다 — pm2 는 프로세스가
  살아 있으니 정상으로 보고, 이번과 똑같은 무성 정지가 된다(이번 사고의 원인은 아니지만
  **같은 증상을 만드는 두 번째 독립 경로**다). 새 하트비트가 이 경우를 탐지해 주긴 하지만,
  근본적으로는 `--connect-timeout 10 --max-time 60` 을 붙여야 한다. T-036 이 news-fetch 라우트에
  이미 타임아웃을 넣었으므로 같은 원칙을 `call()` 전체로 확장하는 것이 일관적이다.
  → 안전 경로 변경이라 별도 task + Reviewer 감사가 필요하다고 판단해 이번엔 손대지 않았다.
- [12:05] **S-2 스테일 DB 행 정리 (실행 금지 — 사용자 판단 필요).**
  - `orders id=2107` (2026-05-14, NYS:LMT sell market, `pending`, `exchange_order_id=NULL`):
    거래소에 나간 적 없는 유령 행. `syncPendingOrders` 대상 밖이라 영원히 `pending` 이다.
  - `signals` `executing` 3건(2026-05-26~27, NAS:SNDK·NAS:PLTR): `consumed_order_id` 는 있으나
    3개월째 `executing`. `approved` 3건(최신 2026-08-12)도 `expires_at` 이 한참 지났는데
    `approved` 는 `EXPIRABLE_STATUSES` 에 없어 **영원히 만료되지 않는다**.
  - 지금은 `entry-watcher` 가 `approved_pending_entry` 만 보므로 **무해**하지만, 훗날 쿼리 조건이
    한 번만 바뀌면 3개월 묵은 시그널이 되살아날 수 있는 구조다. 상태머신 관점의 정리를 권한다.
- [12:06] **S-3 `executions` 테이블이 전 기간 0행**이다. 체결 기록이 어디에도 남지 않는다는 뜻으로,
  수익 분석·리포트의 근거 데이터가 비어 있다. 이번 조사 범위 밖이라 확인만 하고 남긴다.

### 이번 task 에서 하지 않은 것 (명시)

- [12:06] 매수·매도·취소 주문 **0건 실행**. KIS 주문/취소 API **0회 호출**. DB 는 `SELECT` 만 사용
  (`INSERT`/`UPDATE`/`DELETE` 0건).
- [12:06] `git commit` 하지 않음 — 워킹트리에만 존재. `npm run build`·`next dev`·`npm run dev`
  실행 안 함. `pm2 restart`/`pm2 save` 등 운영 조작 안 함.
- [12:06] `HOME-SERVER_CONFIG/` 아래 파일 수정 0건(읽기만). 비밀정보를 평문으로 디스크에 기록 0건
  (DB 조회는 `.env` 를 호출 시점에 읽는 임시 헬퍼로만 수행, 자격증명 파일 생성 없음).
- [12:06] **실행 불가였던 항목**: ① `sudo` — 비대화형 불가(`sudo -n true` → 암호 요구).
  ② `dmesg` — 커널 버퍼 접근 권한 없음. → 둘 다 `journalctl`(adm 그룹으로 읽기 가능)과
  `/var/log/syslog`·`kern.log` 로 우회해 §B 결론에 필요한 증거는 **전부 확보**했다.

## Reviewer

- [13:10] 독립 감사 착수. Developer 서술을 그대로 신뢰하지 않고 diff·코드·DB·테스트를 전부 직접 재실행해 대조했다.
- [13:11] **코드 감사 1 — 하트비트 무조건 실행 확인.** `git -c core.fileMode=false diff scripts/cron-runner.sh` 직접 확인. 하트비트 블록은 `while true; do` 바로 다음 줄, 첫 `call /api/cron/entry-watcher` 호출보다 앞에 있고 `if`/조건문 밖이다(어떤 잡의 성공·실패와도 무관하게 매 tick 무조건 실행). `printf ... > tmp && mv -f` 원자적 쓰기 + `2>/dev/null || true`로 쓰기 실패가 루프를 멈추지 않음도 코드로 확인. 서술과 일치.
- [13:12] **코드 감사 2 — 자금 이동 경로 격리.** `grep -n "import" src/lib/ops/cron-watchdog.ts` 직접 실행 → `node:fs`·`node:os`·`node:path`·`@/lib/notify/throttle` 4개뿐. `submitOrder`·거래소 어댑터·`orders` import 전무 확인(grep 결과 자체로 확인, 주석 신뢰 안 함). `src/lib/notify/throttle.ts`도 Read로 열어 `sendAlertThrottled`가 T-012부터 존재하던 기존 함수(`sendAlert` 위임 + 키별 TTL 스로틀)임을 확인 — 신규 알림 채널 아님.
- [13:13] **코드 감사 3 — 알림 본문 비밀정보 노출 경로.** `src/lib/ops/cron-watchdog.ts`의 `reportVerdict()` 본문 조립 로직을 직접 읽음: `detail` 문자열은 `fmtDuration()`·`cfg.heartbeatFile`·상수 텍스트로만 구성되고 `process.env` 직접 삽입이나 외부 API 응답 삽입 경로가 없다. `redactSecrets` 적용 여부가 아니라 애초에 태울 대상이 없는 구조임을 코드로 확인(요청받은 방식대로). 테스트에도 `CRON_SECRET|TOKEN|PASSWORD|Bearer` 미포함 회귀 단언이 있음을 확인.
- [13:14] **코드 감사 4 — 타이머 중복·수명.** `Symbol.for('stockinvest.cronWatchdog.handle')` 전역 레지스트리로 `startCronWatchdog()`가 이미 떠 있으면 즉시 `false` 반환 — 중복 `setInterval` 등록 불가 확인. `timer.unref?.()` 호출로 프로세스 종료(`pm2 restart`)를 막지 않음도 확인. `setInterval` 콜백은 `.then/.catch`로 예외를 전부 삼켜 unhandled rejection이나 타이머 사망 경로 없음.
- [13:15] **코드 감사 5 — T-036 동시 편집 보존.** diff 전체를 육안 대조한 결과 하트비트 블록(루프 최상단)과 T-036의 news-fetch 라우트화 블록(약 168~183행)·M4 env 플럼빙 제거 주석(약 71~73행)이 물리적으로 완전히 분리돼 있고 서로 겹치는 hunk가 없다. `grep -c "T-036" scripts/cron-runner.sh` → 5건 유지(Developer 주장과 일치), `call /api/cron/news-fetch "news-fetch"`·`bash "$PROJECT_DIR/scripts/export-llm-trainset.sh"` 유지 확인. `bash -n scripts/cron-runner.sh` → 문법 오류 없음.
- [13:16] **SAFETY_PATHS 재실측.** `awk '/^SAFETY_PATHS=\(/,/^\)/' scripts/git-hooks/commit-msg`를 직접 실행 — `'^scripts/cron-runner\.sh$'` 포함 확인(scope 필수 대상). `src/instrumentation.ts`·`src/lib/notify/`·`src/lib/ops/`를 매칭하는 패턴은 목록에 없음을 육안 대조로 재확인 — Developer 주장과 일치.
- [13:20] **A절(실매매 영향 점검) DB 재검증 — mysql 클라이언트로 SELECT만 직접 실행, INSERT/UPDATE/DELETE 0건.**
  - `orders WHERE created_at BETWEEN '2026-08-24 23:39:00' AND '2026-08-27 10:51:24'` → **0건** (Developer 주장과 일치).
  - `orders` 최근 5건 조회 결과 최신 주문은 **2026-08-12 15:29:27** (096770 buy rejected) — Developer 서술과 정확히 일치.
  - `signals WHERE status='approved_pending_entry'` → **0건**. `signals` 전체 status 분포도 `ai_skipped 14067 / auto_submitted 3130 / expired 242 / superseded 10 / approved 3 / executing 3 / rejected 2`로 Developer가 보고한 수치와 완전히 일치(자릿수까지 동일).
  - `orders id=2107` 직접 조회 → `2026-05-14 23:30:46 / NYS:LMT / sell / market / pending / exchange_order_id=NULL` — Developer 서술과 일치, 이번 공백과 무관한 선존재 유령 행 확인.
  - `signals id=17482` 직접 조회 → `NYS:JPM / buy / expired / created 2026-08-24 23:16:08 / expires_at 2026-08-24 23:46:08 / updated_at 2026-08-27 10:53:56 / consumed_order_id=NULL` — Developer 서술과 완전 일치, 오발주 흔적 없음.
  - `portfolio_snapshots`에 `ts` 컬럼 기준 08-24 22:00~08-27 12:00 구간 조회 → 딱 2행: `id=4610 ts=2026-08-24 23:16:16 total_krw=19144838`, `id=4611 ts=2026-08-27 10:53:58 total_krw=20036344` — Developer 수치와 정확히 일치, 중간 스냅샷 0건(공백 실재) 확인.
  - `trade_logs`를 공백 구간+재기동 직후로 조회 → `signal_expired` **1건**만 존재, `executions` 테이블 전체 **0행** — Developer 서술과 일치.
  - **재현 결과: Developer의 A절 정량 주장은 전부 실측과 일치한다. 표본 이상·누락 발견 못함.**
- [13:25] **회귀 검증 직접 실행.** `npm run typecheck` → 에러 0으로 통과. `npx jest src/lib/ops` → 22/22 통과(Developer 주장과 일치). `npm test` 전체 → **126 suites / 2216 tests 전부 통과**(Developer 주장과 정확히 일치, 회귀 0). `npm run build`·`next dev`·`npm run dev`는 지시대로 실행하지 않았다.
- [13:26] **부가 확인 — ecosystem.config.js.** `stockinvest`·`stockinvest-cron` 둘 다 `instances: 1` 확인 — `instrumentation.ts` 주석의 "다중 인스턴스 시 알림 N배" 경고가 현재는 해당하지 않는 전제(단일 인스턴스)임을 코드로 확인.
- [13:27] **LOW — 작업트리 위생.** `git status`에 `scripts/.nfs000000000143b46b00000002`라는 untracked NFS silly-rename 잔여 파일이 보인다. 이번 변경이 유발한 기능 결함은 아니고(`scripts/cron-runner.sh`만 명시적으로 add하면 섞여 들어가지 않는다) 커밋 시 스코프 밖이지만, 실수로 `git add scripts/` 같은 광범위 스테이징을 하면 잡동사니가 끼어들 수 있으니 커밋 직전 `git status`로 한 번 더 확인할 것을 권고한다. 안전장치와 무관한 결함이라 판정에는 반영하지 않는다.
- [13:28] **실거래 안전 준수.** 이번 감사에서 매수/매도/취소 주문 0건 실행, KIS API 미호출, DB는 SELECT만 사용(INSERT/UPDATE/DELETE 0건), `pm2 restart`/`pm2 save` 등 운영 조작 0건, `npm run build`/`next dev`/`npm run dev` 미실행.
- [13:29] **종합 판정 근거.** Critical 0건 / High 0건 / Medium 0건 / Low 1건(작업트리 위생, 안전과 무관). 자금 이동 경로 격리·하트비트 무조건성·알림 비밀정보 미노출·타이머 중복방지·T-036 보존·SAFETY_PATHS 대상·전체 테스트 회귀 0·A절 DB 실측 전부 직접 재현으로 확인됐다. Developer 서술과 실측 간 불일치 없음.
- [13:30] **최종 판정: PASS (scope: scripts/cron-runner.sh, src/instrumentation.ts, src/lib/ops/)**

## QA

- [14:35] 실행 검증 착수. Reviewer PASS 후 모든 시나리오를 직접 재현하며 기록한다.

### 검증 시나리오 실행 결과

| 시나리오 | 명령 | 기대 결과 | 실제 결과 | 상태 |
|---------|------|----------|---------|------|
| (a) TypeScript 타입 체크 | `npm run typecheck` | 에러 0 | 에러 0, 정상 종료 | ✅ PASS |
| (b) 워치독 유닛 테스트 | `npx jest src/lib/ops` | 22/22 통과 | 22/22 통과 (warnings 외 에러 0) | ✅ PASS |
| (c) 전체 회귀 테스트 | `npm test` | 126 suites / 2216 tests 통과 | 126 suites / 2216 tests 통과 | ✅ PASS |
| (d) 하트비트 bash 격리 | 커스텀 격리 스크립트 | epoch 파일 생성, tmp 원자적 쓰기, 부분 쓰기 시 exit 0 | 파일 생성 ✓, epoch 형식 ✓, tmp 없음 ✓, 쓰기 실패 시 exit 0 ✓ | ✅ PASS |
| (e) 워치독 판정 로직 | 직접 함수 호출 + jest 테스트 | fresh→alive, 10min old→stale, missing→boot_grace/missing, stale→alive transition→alert | jest 22개 모두 통과: alive ✓, stale ✓, boot_grace ✓, recovery alert ✓, no secrets ✓ | ✅ PASS |
| (f) Git diff 범위 | `git -c core.fileMode=false diff --stat` | scripts/cron-runner.sh만 SAFETY_PATHS 대상, 신규 파일 3개는 X 대상 | scripts/cron-runner.sh 수정 확인, src/instrumentation.ts·src/lib/ops/ 신규 확인 | ✅ PASS |

**실행 명령과 실제 출력 요약**:

- **(a) npm run typecheck**
  ```
  exit code 0 / 에러 메시지 없음
  ```

- **(b) npx jest src/lib/ops**
  ```
  Test Suites: 1 passed, 1 total
  Tests:       22 passed, 22 total
  
  포함된 테스트 (모두 PASS):
  - ✓ 최근 갱신이면 alive (1 ms)
  - ✓ 임계 초과면 stale
  - ✓ 파일 없음 + 부팅 유예 안이면 boot_grace
  - ✓ 파일 없음 + 부팅 유예 초과면 missing
  - ✓ 읽기 오류는 fail-closed로 unreadable
  - ✓ 정상→장애 전이 시 스로틀을 리셋해 즉시 발사한다
  - ✓ 장애 지속 중에는 스로틀 리셋 없이 재알림만 시도한다
  - ✓ 알림 본문에 비밀정보가 섞일 경로가 없다
  - ✓ 정상이면 아무 알림도 보내지 않는다
  - ✓ 오래된 타임스탬프 → stale (QA 시나리오: 파일을 과거로 조작)
  - ✓ 없는 파일 + 유예 초과 → missing
  - ✓ 갓 쓴 파일 → alive
  - ✓ 장애→복구 시 복구 통지 + 장애 키 리셋
  - ✓ 두 번 호출해도 타이머는 하나만 등록된다
  ```

- **(c) npm test (전체)**
  ```
  Test Suites: 126 passed, 126 total
  Tests:       2216 passed, 2216 total
  Time: 9.077 s
  회귀 0건
  ```

- **(d) 하트비트 bash 격리 실행**
  ```
  ✓ File created: /tmp/.../test-heartbeat-isolated
  ✓ Content is valid epoch seconds (1787803330)
  ✓ No .tmp residue (atomic write OK)
  ✓ File updated: 1787803330 → 1787803331 (after 1 sec)
  ✓ Script exit code 0 even on write failure (|| true working)
  ```

- **(e) 워치독 판정 로직**
  ```
  Direct Node.js test 결과:
  - Scenario 1: Fresh file (epoch 1787803384) → age 0s → alive
  - Scenario 2: 10 min old file (600s ago) → age shown → stale
  - Scenario 3: Missing file + just booted → boot_grace state
  - Scenario 4: Atomic write: final file exists ✓, .tmp residue none ✓
  
  Jest 테스트에서 추가 검증:
  - 스로틀 엣지 트리거: stale 첫 감지 시 즉시 alert, 지속 중 30min 재알림
  - 복구 전이: stale→alive 시 info 레벨 복구 알림 1회
  - 비밀정보 필터: 알림 본문 자체 조립 문자열만 사용 (env/응답 미삽입)
  ```

- **(f) Git diff scope**
  ```
  Modified (SAFETY_PATHS 대상): scripts/cron-runner.sh (+22줄 하트비트 블록)
  
  Untracked (new, SAFETY_PATHS 아님):
    - src/instrumentation.ts (신규)
    - src/lib/ops/ (디렉토리, cron-watchdog.ts + __tests__/cron-watchdog.test.ts 포함)
  
  Reviewer scope 명시 내용: "scripts/cron-runner.sh, src/instrumentation.ts, src/lib/ops/"
  실제 변경: ✓ 정확히 일치
  ```

### 부가 확인

- [14:36] **실거래 안전장치 준수 확인**:
  - 매수/매도/취소 주문 0건 실행
  - KIS API 호출 0건
  - DB SELECT 조회만 (INSERT/UPDATE/DELETE 0건)
  - npm run build / next dev 미실행 (운영 배포 경로 보호)
  - pm2 restart/save 미실행
  
- [14:37] **발견된 결함**: 0건
  
- [14:37] **작업트리 위생**: Reviewer가 지적한 NFS silly-rename 파일(`.nfs000000000143b46b00000002`) 존재하나 커밋 스코프 밖 (안전과 무관, 경고만).

### 종합 판정

**✅ 검증 통과**

실행 결과:
- 개별 시나리오 6가지 모두 PASS
- 하트비트 bash 로직: 파일 생성 ✅, epoch 형식 ✅, 원자적 쓰기 ✅, 쓰기 실패 복원력 ✅
- 워치독 판정 로직: 5가지 상태(alive/stale/missing/boot_grace/unreadable) 전부 재현 ✓
- edge-triggered 알림: 정상→장애 즉시 ✓, 지속 시 스로틀 ✓, 복구 시 통지 ✓
- 비밀정보 노출 경로: 없음 (자체 조립 문자열만) ✓
- TypeScript 타입 오류: 0건
- 회귀 테스트: 0건 (126 suites / 2216 tests 모두 통과)
- 실거래 안전장치 위반: 0건

**요구사항 충족 여부**: ✅ 충족

Reviewer PASS(scope: scripts/cron-runner.sh, src/instrumentation.ts, src/lib/ops/)의 모든 코드가 실제로 정상 작동함을 직접 재현으로 확인했다. Developer의 조사 결과(A절 read-only 준수, B절 원인 규명, C절 워치독 구현), Reviewer의 독립감사(코드·DB·테스트 재실행), 그리고 본 QA의 실행 검증(6가지 시나리오)을 모두 통과했다.

- [14:38] 검증 완료.

## 최종 요약

**결론부터: 이번 2.5일 공백으로 인한 실매매 피해는 0건이다.** `orders`·`signals`·`executions`·
`portfolio_snapshots`를 전부 실측 대조한 결과 공백 기간 주문 0건·체결 0건·포지션 변화 0건이었고,
가장 우려했던 "밀린 만료 시그널이 뒤늦게 발화해 오발주로 이어지는" 시나리오는 `signal-expiry`
라우트가 애초에 주문을 내지 않는 구조라 발생 자체가 불가능했다(늦게 만료 처리된 시그널은 1건뿐,
연결된 주문 없음). Developer 조사 → Reviewer 독립감사(PASS) → QA 실행검증(✅ 검증 통과)까지
전부 결함 0건으로 순환을 마쳤다.

**원인은 사고 2개가 겹친 것이었다.** ① 2026-08-24 23:39 호스트 자체가 원인 불명으로 급사(OOM은
증거로 배제됨, 로거 자체가 죽어 있어 진짜 원인은 규명 불가)했고, ② 08-25 09:54 재부팅 시 pm2가
NFS 마운트보다 11초 먼저 떠서 `stockinvest-cron`(fork 모드)이 `spawn ENOENT`로 아예 태어나지도
못한 채 "online"으로 잘못 기록되는 **영구 유령 상태**가 됐다(앱 본체는 cluster 모드라 크래시 루프
끝에 스스로 복구됨 — 그래서 앱만 살아 있었다). 이 pm2/NFS 마운트 경합은 최소 08-22부터 재부팅마다
반복돼 온 구조적 결함이고, 기존 복구장치(`check-and-recover.sh`)는 실제로 돌았지만 `stockinvest-cron`을
애초에 감시 대상에 못 넣는 스키마 한계 때문에 유령 상태를 놓치고 "전체 정상"으로 오판정했다.

**재발방지책(상시 하트비트 워치독)은 구현·검증까지 끝났지만 아직 운영에는 적용되지 않았다.**
`scripts/cron-runner.sh`에 매 tick 하트비트 기록을 추가하고, Next 15 `instrumentation.ts` +
`src/lib/ops/cron-watchdog.ts`가 앱 본체 안에서 하트비트를 주기 감시하다가 5분 이상 끊기면
기존 `sendAlertThrottled` 경로로 critical 알림을 보낸다(edge-triggered, 자금 이동 경로 완전 격리
— 자동 복구 없음, 알림만). typecheck·전체 테스트(126 suites/2216 tests) 회귀 0건.

### 사용자가 지금 결정해야 할 것들

1. **워치독 라이브 적용 여부·시점** — 코드는 워킹트리에만 있고 아직 배포되지 않았다. 적용하려면
   `npm run build` → **`pm2 restart stockinvest-cron`(먼저, 하트비트 생성)** → **`pm2 restart
   stockinvest`(다음, 워치독 시작)** 순서가 필요하다(반대 순서면 부팅유예 10분 뒤 1회성 "missing"
   오탐 알림이 뜬다 — 실사고는 아니지만 놀랄 수 있다). 이 세션은 실거래 계좌·운영 배포 경로
   보호 원칙에 따라 빌드·재기동을 임의로 실행하지 않았다 — 사용자 승인 후 진행 여부를 알려달라.
2. **커밋 승인** — `scripts/cron-runner.sh`(SAFETY_PATHS 대상)를 포함한 변경 전체에 대해 Reviewer
   PASS 기록이 이미 task 파일에 남아 있어 commit-msg 훅은 통과 가능한 상태다. 다만 이 프로젝트
   관례상 커밋은 사용자 승인 후 진행한다 — git commit/push는 아직 하지 않았다.
3. **HOME-SERVER 소관 3건 — 이 프로젝트 범위 밖, 별도 세션 인계 권고**(T-031 핸드오프 사례와
   동일 패턴). 실제 원인 수정은 이것들이다:
   - (근본원인, 최우선) `pm2-brownjeon.service`의 `[Unit]` 절이 `After=network.target`만 걸려
     있어 NFS 마운트를 기다리지 않는다 — `After=network-online.target remote-fs.target` +
     `RequiresMountsFor=/home/brownjeon/NFS/homes`로 고치면 이번 유형의 사고 자체가 사라진다.
     구체적 diff는 위 "D-1" 절에 있다.
   - `projects.json`이 포트 기반 HTTP 헬스체크만 표현 가능해 `stockinvest-cron`처럼 자체
     엔드포인트가 없는 프로세스를 등록할 수 없다 — `health_type: "heartbeat_file"` 필드 확장안과
     `check-and-recover.sh` 대응 로직을 "D-2"절에 diff로 제안해 뒀다. 추가로 "pid 없이 online이면
     무조건 유령"이라는 범용 검사를 넣으면 `n8n`·`webhook-deploy`처럼 하트비트가 안 맞는
     이벤트기반 프로세스도 같이 커버된다.
   - `check-and-recover.sh`가 `@reboot` 1회성이라 재부팅 없이 조용히 죽는 경우를 못 잡는다 —
     systemd timer(`OnBootSec=90` + `OnUnitActiveSec=10min`) 전환을 "D-3"절에 제안해 뒀다.
   이 3건은 `HOME-SERVER_CONFIG/` 아래 파일이라 **이번 세션에서 읽기만 하고 수정하지 않았다** —
   별도 HOME-SERVER 세션에서 이어받을 것을 권고한다.
4. **`cron-runner.sh`의 `call()`에 curl 타임아웃이 없는 잠재 결함** — 앱이 응답을 영영 안 주면
   cron 루프 전체가 조용히 멈추는 별도 경로다(이번 사고의 원인은 아니지만 같은 증상을 만드는
   두 번째 독립 경로). 새 워치독이 이 경우도 탐지는 하지만, 근본적으로는
   `--connect-timeout 10 --max-time 60`을 붙이는 게 맞다 — 안전 경로 변경이라 별도 task +
   Reviewer 감사로 처리할 것을 권고하며 이번엔 손대지 않았다.
5. **`scripts/.nfs000000000125a1570000001a`·`scripts/.nfs000000000143b46b00000002` 잔여 파일** —
   과거(08-19) NFS silly-rename으로 생긴 것으로 이번 작업이 만든 게 아니고 기능 결함도 없지만,
   커밋 시 `git add scripts/`처럼 광범위 스테이징을 하면 실수로 끼어들 수 있다. 아직 이 파일을
   쥔 프로세스가 있는지 확인 후(`lsof`) 정리 여부를 판단할 것 — 이번 세션은 손대지 않았다.

**이번 세션이 실행한 것과 안 한 것을 분명히 남긴다**: DB는 SELECT만(0건 변경), KIS 주문 API
호출 0회, `git commit`·`npm run build`·`pm2 restart`·`HOME-SERVER_CONFIG/` 파일 수정 전부
**0건 실행**. 코드 변경(`scripts/cron-runner.sh` 수정 + `src/instrumentation.ts`·
`src/lib/ops/cron-watchdog.ts` 신규)은 워킹트리에만 존재하며 다음 단계(커밋 승인 → 배포 승인)는
전부 사용자 결정을 기다린다.
