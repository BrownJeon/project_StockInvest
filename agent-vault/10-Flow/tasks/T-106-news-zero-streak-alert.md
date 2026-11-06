---
task_id: T-106
title: 뉴스가 연속 3회 0건이면 알림 — 수집 단계·분석 검색 단계 감시 (T-105 재발 방지)
status: done
priority: high
project: StockInvest
created: 2026-10-28
updated: 2026-10-28
base_ref: dfc8831
risk_level: R2
roles_involved: [leader, judge, developer, reviewer, qa, codex, deployer]
related_tasks: [T-105-news-rag-zero-hits, T-103-news-fetch-market-split, T-036-news-fetch-silent-failure]
tags:
  - type/task
  - domain/rag
  - domain/observability
aliases:
  - 뉴스0건감시
waiting: [10-29 06:00 수집 관측, T-105 후보 E 사용자 결정]
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

# T-106 뉴스 0건 연속 감시 알림

## 사용자 지시 (2026-10-28, 발화 그대로)

"후속작업의 낡은 기사는 삭제하고 뉴스 수집에서 수집이 0이 3번이상 발생하면 알림주는것 추가해줘" (낡은 기사 삭제는 M4 쪽 별도 작업 — 아래 "연결" 참고)

## 배경

[[T-105-news-rag-zero-hits]]: 분석에 뉴스가 0건 반영된 상태가 최소 5주간 아무 알림 없이 이어졌다(국내 분석 31/31회 `news=0`). 수집 로그는 "OK upserted=20" 으로 보였기 때문에 **수집 성공 여부만 보는 감시로는 못 잡는다** — 해외는 낡은 기사 20건을 매일 다시 저장해 `upserted` 가 항상 20 이었다. 그래서 감시 지점은 둘이다.

## 해석 (Leader — "수집이 0이 3번 이상")

- 두 채널을 모두 감시하고, 각각 **같은 시장의 연속 3일(거래일 아님, KST 날짜 기준)** 이면 알림, 한 번이라도 0 이 아니면 연속 횟수 초기화. "누적 3번"이 아니라 "연속"으로 해석한다(누적은 한 번 쌓이면 영원히 울린다). 사용자가 누적을 원하면 바꾼다.
- ① 수집 채널(`fetch`): `/api/cron/news-fetch` 시장별 결과가 0. 0 의 정의 = 실패(3회 소진)이거나 `upserted === 0`, M4 응답에 `fresh`(최근 3일 날짜를 가진 항목 수) 필드가 있으면 `fresh === 0` 도 0 으로 센다(필드가 없으면 `upserted` 만 — M4 task-008 이 `fresh` 를 추가할 예정).
- ② 검색 채널(`retrieval`): 장마감 후 분석(국내·해외)의 `retrieveRagContext()` 결과 `recentNews.length === 0`. **지식베이스 오류가 있었던 실행(`errors.length > 0`, 회로 차단 등)은 세지 않는다** — 뉴스가 없는 게 아니라 조회 장애이고, 그건 기존 알림 소관.

## 설계

1. 신규 `src/lib/rag/news-health.ts`
   - `recordNewsOutcome({ channel: 'fetch'|'retrieval', market: 'domestic'|'overseas', count: number, now?: Date }): Promise<{ streak: number; alerted: boolean }>`
   - 상태는 `system_config` 키 `news_zero_streak:<channel>:<market>` 에 JSON `{ streak, lastDate, lastCount }` (기존 패턴 `INSERT … ON DUPLICATE KEY UPDATE value = VALUES(value)` 재사용, `getPool()`).
   - **같은 KST 날짜의 재실행은 하루로 센다**: `lastDate === 오늘` 이면 streak 를 늘리지 않는다. 같은 날 앞선 실행이 0 이고 지금은 >0 이면 초기화(그날 뉴스가 들어왔으므로). 같은 날 앞선 실행이 >0 인데 지금 0 이면 streak 를 건드리지 않는다(오늘은 이미 정상 수집).
   - 임계 `NEWS_ZERO_ALERT_STREAK = 3`(상수, 환경변수 `NEWS_ZERO_ALERT_STREAK` 로 덮어쓰기 가능, 최솟값 2). streak ≥ 임계이면 `sendAlertThrottled('news-zero:<channel>:<market>', 'warning', 제목, 본문)`. 본문에 채널·시장·연속 일수·마지막 정상일·가능한 원인 안내 한 줄(원천 피드 정지/날짜 형식/M4 장애 → T-105 문서 경로). 임계 이후에도 하루 1회는 계속 울린다(고쳐질 때까지 — in-memory throttle 로 하루 1회).
   - **절대 던지지 않는다**: DB 오류·JSON 손상은 `console.warn` 후 `{ streak: 0, alerted: false }` — 분석·수집 흐름에 영향 0. 손상된 값은 0 으로 취급.
   - 날짜 계산은 KST(`src/lib/time.ts` 의 기존 헬퍼 확인 후 재사용).
2. 호출 지점(최소 변경, 모두 try/catch 안, await 하되 실패가 흐름을 바꾸지 않음)
   - `src/app/api/cron/news-fetch/route.ts`: 시장별 결과 확정 뒤. 응답 형식·알림 키·T-103 동작 불변. M4 응답에서 `fresh`(숫자) 가 있으면 읽는다(없으면 무시).
   - `src/lib/strategy/post-market-engine.ts`(`retrieveRagContext` 호출 직후, 약 530행)와 `src/lib/strategy/post-market-overseas.ts`(약 623행): `errors.length === 0` 일 때만 `recordNewsOutcome({channel:'retrieval', market, count: ragCtx.recentNews.length})`.
   - `ai-filter-stage1.ts` 의 장중 호출은 **세지 않는다**(하루 수십 번 호출되어 연속 일수 의미가 없다).
3. 시험(jest, 실제 DB 없이 mock): 연속 증가·임계 도달 알림·초기화·같은 날 재실행 불변·같은 날 0 → >0 초기화·KB 오류 실행 미집계·손상 JSON·DB 오류 삼킴·환경변수 임계·알림 키/심각도·news-fetch 라우트 통합(응답 불변, 실패 시도 집계, `fresh` 반영)·post-market 호출 지점이 던지지 않음. 기존 news-fetch·post-market 시험 전부 회귀 없음, `npx tsc --noEmit` 오류 0.

## 하지 않는 것

- 앱 화면·알림 채널 추가, `ai-filter-stage1` 장중 호출 집계, M4 코드(별도 task-008), 기존 알림 키·심각도 변경, 필터를 `ingested_at` 로 바꾸는 우회

## 연결

- M4 `task-007`(발행일 정규화+해외 피드 교체, 감사 중)·`task-008`(여러 피드·`fresh` 필드, 예정). 낡은 2025-01 기사 삭제는 M4 푸시 확인 뒤 **사용자 승인된 삭제 작업**으로 별도 실행(목록 대조·백업 후).

## 소유 파일 (훅 감시 — `^src/app/api/cron/`·`^src/lib/strategy/`)

- 신규 `src/lib/rag/news-health.ts`(+시험), 수정 `src/app/api/cron/news-fetch/route.ts`(+시험), `src/lib/strategy/post-market-engine.ts`, `src/lib/strategy/post-market-overseas.ts`(+각 시험 최소 추가)

## 배포

- push = 배포. 기본 창 15:40~22:20 KST(사용자가 직접 지시하면 예외 가능 — T-103 선례). 롤백 `git revert <커밋>`.

## 판단 기록 (judge)

- [10-28] intake `judge-result@2` — risk R1, developer_model opus(`MD-judge-failed-opus`), demo none, next assign. **override: R1 → R2** — 무인 실행(cron)·`src/lib/strategy/` 영역을 건드리므로 R2 취급.
- [10-28 12:3x] C2 `codex_gate` — `codex_required: true`(규칙 `CX-r2-post-review`), mode review, focus none, budget `CX-limit-unknown-r2`(한도 값 없음 → R2 라 진행), codex_switch on.

## 진행 기록

- [10-28 12:0x] 접수·설계 확정. 다음: 격리 워크트리 → Developer(Opus).
- [10-28 12:3x] Developer 2라운드(상한 4초·검색 오류 채널) 완료 → Reviewer 델타 재감사 **PASS**(중간 0·낮음 2). 낮음 2건 처리 결정(Leader): **D-1**(`.catch` 를 구분하는 시험이 없음 — 호출부 3곳이 try/catch 로 감싸 실제 영향 없음)과 **D-2**(`CAUSE_HINT.retrieval` 문장이 매듭 없이 끝남 — 시험이 문자열을 고정) 모두 **이번에는 반영하지 않는다**. 이유: 동작·안전 영향이 없고, 코드를 바꾸면 Reviewer 재확인 한 바퀴가 더 든다. 후속 후보로만 남긴다(T-104 크론 정리 때 손볼 수 있음). Reviewer 임시 시험 두 건은 스크래치패드 `t106-rev-mut2/keep/` 에 있다.
- [10-28 12:3x] 메인 트리 ↔ 워크트리(`~/.node-local/stockinvest-t106`) 변경 9개 파일 sha256 일치 확인(Reviewer 도 재확인). 커밋은 명시한 경로만(남의 세션 미추적 파일 2개 제외).
- [10-28 16:09] **16:00 국내 분석 첫 관측 — 감시 경로 정상.** DB `news_zero_streak:retrieval:domestic` = `{streak:1, lastDate:2026-10-28, lastCount:0, lastOkDate:null}`, `retrieval_error:domestic` = `{streak:0, lastCount:1}`(검색 오류 아님으로 판정), 로그 `[news-health] retrieval:domestic 0 관측 — 연속 1일(기준 3)`, 16시대 로그에 경고 줄 없음(기준 3 미만 — 오탐 없음). 다만 지시서가 기대한 `lastCount>0` 은 아니다 — 뉴스 0건의 실제 원인이 검색 유사도 임계(T-105 후보 E)로 확인돼, 감시가 의도대로 실제 0건을 잡은 것. 그대로 두면 10-30 16:00 에 연속 3일째 경고. `fetch` 채널 키는 아직 없음(10-29 06:00 수집 때 생성 예정).

## Developer

## Reviewer

- [12:10] 감사 범위·방법. 메인 트리(HEAD dfc8831)와 워크트리 `/home/brownjeon/.node-local/stockinvest-t106` 의 변경 9개 파일(수정 6·신규 3)을 `sha256sum` 전체 해시로 직접 대조해 모두 일치함을 확인했다. `git diff --stat -- scripts/` 출력 0줄(scripts 변경 0). Developer 자기 보고는 믿지 않고 diff·소스·시험을 직접 읽고 돌렸다. 변이 시험은 scratchpad 새 폴더 `t106-rev-mut/ws`(src 복사본)에서만 했고 워크트리·메인 트리는 쓰지 않았다. 확신 [확실].
- [12:10] 직접 돌린 숫자(워크트리). `npx jest src/app/api/cron src/lib/rag src/lib/strategy src/lib/__tests__/api-usage-callsites.test.ts` → 59 suites pass · 1242 tests pass(Developer 주장과 일치). 새·수정 시험 5개 suite만 → 360 tests pass(news-health 2개 suite는 110). `tsc --noEmit`(워크트리 tsbuildinfo 갱신을 피하려고 동일 src 복사본에서 `--incremental false`) → 오류 0, 프로젝트 505개 파일에 변경 4개 소스 포함 확인(참고: tsconfig 가 `__tests__`·`*.test.ts` 를 exclude 하므로 tsc 는 시험 파일 타입을 보지 않는다). `bash scripts/test-cron-runner-pmo-retry.sh` → 76 pass / 0 fail, `bash scripts/test-cron-runner-stop-alert.sh` → 22 pass / 0 fail. `test-cron-runner-news-split.sh` 는 3분 넘게 걸리고 `scripts/` 변경이 0이라 입력이 같으므로 생략. 새 시험을 `--detectOpenHandles` 로 돌려 열린 핸들 0(큰 실행의 worker 종료 경고는 이 변경의 시험이 아닌 기존 suite 에서 나온다). 서버 TZ 를 UTC·America/Los_Angeles·Pacific/Auckland·Asia/Seoul 로 바꿔 news-health 110개 모두 pass.
- [12:12] 요구사항 대조 1(설계 반영) — 모두 확인. 두 채널(fetch·retrieval)×두 시장 → 상태 키 `news_zero_streak:<channel>:<market>`(news-health.ts:103-105, 가장 긴 키 35자라 `system_config.key VARCHAR(64)` 안, value 컬럼 JSON 에 유효 JSON 문자열 저장). 같은 KST 날짜 재실행은 하루(nextNewsZeroState 182-191), 새 날짜는 0 이면 +1·0 이 아니면 초기화(202-207). 임계 3, 환경변수 덮어쓰기·최솟값 2·비정상값은 3(119-124). 알림 키 `news-zero:<channel>:<market>`, 심각도 warning, 제목·본문(채널·시장·연속 일수·기준·마지막 확인일·마지막 정상일·원인 안내 한 줄 + T-105 경로). 전체가 try/catch 로 감싸져 던지지 않고(270-332), DB 읽기·쓰기 오류와 손상 JSON 은 경고 후 `{0,false}`. `ai-filter-stage1.ts` 에는 news-health 참조가 없다(grep 으로 확인, 시험에도 정적 가드). news-fetch 응답은 `markets: results`(= outcomes.map(o=>o.result))라 `fresh` 가 응답에 새지 않고, 기존 알림 3종 키·심각도·`?market=` 400/단일 시장 동작·토큰 누락 스킵·trackCall 지점은 diff 상 한 줄도 바뀌지 않았다(api-usage-callsites 시험 pass). 신규 호출 지점은 3곳(route.ts:233, post-market-engine.ts:533, post-market-overseas.ts:626)뿐이다. 하지 않는 것(화면·알림 채널 추가·장중 집계·M4 코드·`ingested_at` 우회) 위반 없음. [확실]
- [12:16] 요구사항 대조 2(a) `isNewsRetrievalReliable` — 실제 retrieval.ts 와 직접 대조. 오류 문자열은 `settledOr` 의 `${label}: ${message}`(retrieval.ts:59) 한 경로로만 컬렉션 라벨이 붙고, 전역 실패 두 경로(getKbClient 실패 :136 → 메시지 그대로, 전체 타임아웃 :203 → `RAG retrieval timeout …ms`)는 라벨이 없다. 라벨 목록(signals.stockinvest·signals.tradinginvest·news.kr_market·news.us_market·news.macro)은 chooseSignalsCollection(:71-73)·chooseNewsCollection(:63-69)·고정 'news.macro'(:156)와 정확히 같고, 국내→news.kr_market·해외→news.us_market 매핑도 같다. Developer 문자열을 믿지 않고, 실제 `retrieveRagContext()` 를 목 KB 클라이언트로 돌려 나온 errors 를 판정기에 먹이는 임시 시험 9개를 만들어 확인했다(모두 pass): 뉴스 컬렉션만 실패→`['news.kr_market: KB search HTTP 500: x']` 불신뢰, 해외 us_market 만 실패 불신뢰, macro 만 실패 신뢰(센다), signals 만 실패 신뢰, 세 컬렉션 모두 실패(AI_API_KEY 미설정 형태) 불신뢰, 서킷 차단 문구 불신뢰, 전체 타임아웃 불신뢰, 전부 성공·점수 컷으로 뉴스 0 → errors 비어 센다. 후보가 0 인 날은 두 호출부 모두 RAG 호출 전에 반환(post-market-engine.ts:512, post-market-overseas.ts:612)해 관측 자체가 없고, queryText 는 후보가 1개 이상이면 항상 비어 있지 않아 빈 쿼리(errors 비고 recentNews 비는 EMPTY 경로)는 도달 불가다. 확신 [확실].
- [12:20] 요구사항 대조 2(b) 관측 공백 상한 `NEWS_ZERO_MAX_GAP_DAYS = 7` — 구현 정확. 간격 7일은 이어 세고 8일 이상은 새로 시작(news-health.ts:194 `gap > 7`), 역행(gap<0)은 새로 시작+경고, `Date.UTC` 달력 산술이라 월·연·윤년 경계가 정확하다(시험에 월·연·2028 윤년 28→29·29→3/1·평년 2/28→3/1·연 경계 7일·자릿수 같은 9/29→10/7=8일 포함, 실재하지 않는 날짜는 손상 취급). 변이 `>`→`>=`·상한 제거·역행 처리 제거 모두 시험이 잡는다. 운영 시나리오 검토: (1) 국내 retrieval 은 평일마다 관측하고 공휴일은 건너뛰지 않는다(post-market-engine.ts:473 이 주말만 스킵) → 정상 운영의 최대 간격은 금→월 3일, 추석·설 연휴가 공백을 만들지 않는다(news-health.ts 주석의 "연휴 5~6일 공백" 근거는 국내에는 맞지 않으나 상한이 넉넉한 쪽이라 해가 없다); (2) 해외 retrieval 은 미국 새 세션이 있는 날만 관측하고 정상 최대 간격은 약 4일(성금요일·추수감사절+주말); (3) fetch 는 매일 06시(주말 포함, scripts/cron-runner.sh news-fetch-split)라 간격 1~2일, 러너 장기 정지 때만 벌어진다. 결론: 정상 달력에서 상한 때문에 생기는 오경보·누락은 찾지 못했다. 남는 경계는 두 가지뿐이다 — (오경보 쪽) 스위치 on/off 등으로 7일 이하 간격을 두고 0 관측이 3번 쌓이면(예: 해외 분석을 6일씩 껐다 켜며 월요일마다 0) 14일에 걸쳐도 알림이 울린다("관측된 날 기준 연속"이라는 의미상 허용 범위), (누락 쪽) 8일 이상 끊겼다 재개되면 연속이 1부터 다시 시작해 알림이 최대 2관측 늦어진다(의도된 보수 방향). 확신 [확실](코드·시험·cron-runner 확인), 운영 달력 추정은 [가능성 높음].
- [12:24] 발견 M-1 MEDIUM — 감시 기록의 DB 대기에 상한이 없다. 위치: news-health.ts:289·310(`getPool().query`, 타임아웃·`Promise.race` 없음), 호출 지점 news-fetch/route.ts:233 `await recordFetchHealth(outcomes)`, post-market-engine.ts:533, post-market-overseas.ts:626. 풀 설정(db.ts:33-49)은 `queueLimit: 0`·쿼리 타임아웃 없음이라 DB 가 끊긴 척 멈추는 상황(NAS 망 단절로 반쯤 열린 연결, 풀 고갈)에서는 이 await 가 끝나지 않는다. 재현: 임시 시험(scratchpad `t106-rev-mut/keep/rev-hang.test.ts`)에서 `query` 를 영원히 끝나지 않는 Promise 로 두면 `recordNewsOutcome`·`recordRetrievalNewsOutcome` 모두 400ms 경쟁에서 타임아웃 쪽이 이겼다. 영향: 분석 두 경로는 직후 DB INSERT 를 어차피 하므로 새 위험 종류가 아니다. 그러나 news-fetch 라우트는 지금까지 DB 의존이 0 이었는데(trackCall 은 파일 기록) 이 변경으로 처음 DB 에 묶인다 — scripts/cron-runner.sh 의 news-fetch 호출은 `--max-time` 이 없고(CALL_MAX_TIME 비어 있음) 러너는 순차 루프라 라우트가 멈추면 그 틱의 다른 잡과 하트비트 워치독(300초)에 영향을 준다. 확률은 낮다(DB 연결이 끊기면 보통 즉시 ECONNRESET 으로 실패하고 새 연결은 connectTimeout 10초에 끊긴다). 권고(작은 변경): 호출 지점 또는 `recordNewsOutcome` 안에서 `Promise.race([작업, 3~5초 타이머])` 로 상한을 두거나, route.ts 한 곳만이라도 `void recordFetchHealth(outcomes)`(내부가 이미 전부 catch)로 응답을 기다리지 않게 한다. 변이 `await`→`void` 가 시험에 안 잡힌다는 점(아래)은 이 변경이 시험상 자유롭다는 뜻이다. 고치면 해당 줄을 Reviewer 가 다시 본다. 확신 [확실](코드·재현), 운영 발생 확률 [추측].
- [12:27] 발견 M-2 MEDIUM — 요구사항 정본의 전제 하나가 사실과 다르다. "지식베이스 오류가 있던 실행은 세지 않는다 — 그건 기존 알림 소관"이라 했으나, 분석 경로의 RAG 오류에는 기존 알림이 없다. 근거: `grep sendAlert` 를 src/lib/rag·post-market-engine.ts·post-market-overseas.ts 에서 돌리면(news-health 제외) 결과 0건이고, 서킷 차단(m4-kb.ts:149-171)은 `console.warn` 뿐이며 `/api/health` 도 KB 상태를 보지 않는다. T-105 에도 M4 장애일 2회가 `errors=3` 로그만 남았다. 영향: 뉴스 컬렉션 조회가 지속적으로 실패하는 경우(AI_API_KEY 재발급·401 — 09-22 M4 키 재발급 전례, 컬렉션 삭제·서킷 반복 차단)는 retrieval 채널이 "신뢰 불가"로 건너뛰므로 streak 도 알림도 없고 다른 알림도 없다 — T-105 와 같은 침묵이 오류 형태로 재현된다. 구현은 Leader 가 요청한 규칙을 정확히 따르므로 코드 결함이 아니라 설계 전제 결함이다. 권고(Leader 결정): (A) 신뢰 불가 실행도 별도 키(`news_zero_streak:retrieval-error:<market>`)로 "검색 오류 N일 연속"을 세어 같은 임계로 알린다, 또는 (B) 이번엔 범위 밖으로 두되 전제 문구를 정정하고 후속 task 로 접수한다. 이 항목은 pass 판정을 막지 않는다(High 아님). 확신 [확실](기존 알림 부재는 grep 으로 확인).
- [12:30] 발견 L-1 LOW — 읽기-수정-쓰기 경합(news-health.ts:287-317, 트랜잭션·낙관적 락 없음). 같은 키를 동시에 두 번 부르면(수동 재실행과 cron 겹침, 국내 분석은 single-flight 없음) 둘 다 같은 prev 로 계산해 마지막 쓰기가 이긴다. 같은 날 두 실행이 서로 다른 건수(5 와 0)로 겹치면 "오늘 뉴스가 들어왔는데 0 쪽이 이겨" streak 가 +1 인 상태가 남아 임계 직전이면 하루 거짓 알림이 가능하고, 다음 정상 관측에서 스스로 풀린다. 두 호출이 같은 값이면 결과가 같아 무해. 시장 분리 호출은 서로 다른 키라 무관. 권고: 지금은 허용(발생 조건이 좁음), 필요하면 후속에서 `INSERT … ON DUPLICATE KEY UPDATE` 한 문장 원자화. 확신 [가능성 높음].
- [12:31] 발견 L-2 LOW — 알림 스로틀 창(20시간, 프로세스 메모리)과 "같은 KST 날짜" 규칙이 서로 다른 시계다. 정상 운영(fetch 06시·국내 16시·해외 08시 하루 1회)에서는 24시간 간격이라 매일 한 번 울린다(news-health-throttle.test.ts 가 23시간 45분 뒤 재발송·같은 날 재실행 차단을 실제 throttle 로 확인). 다만 임계 이후 전날 늦은 시각의 수동 재실행(예: 23시)이 있으면 다음 날 06시 정기 알림이 20시간 창에 걸려 하루 건너뛴다. pm2 앱은 instances 1 이라 인스턴스 분산 중복은 없다. 권고: 허용. 확신 [가능성 높음].
- [12:32] 발견 L-3 LOW — 알림 본문의 원인 안내가 retrieval 채널의 흔한 원인 하나를 빠뜨린다. 뉴스가 저장돼 있어도 `minScore 0.5`(retrieval.ts:35, filterByScore)에 모두 걸러지면 recentNews 가 0 이 되어 센다(시험에도 이 경우 0 으로 센다고 고정). 이 판단 자체는 "분석에 뉴스 0건"이라는 사용자 의도에 맞지만, 본문의 "원천 피드 정지 / 날짜 형식 / M4 장애"만 보고는 점수 컷을 의심하지 못한다. 또 fetch 채널은 M4 가 `fresh` 를 주기 전까지 `upserted` 로만 세므로 낡은 기사 재저장(T-105 해외)은 못 잡는다 — 지금 T-105 형 사고를 실제로 잡는 센서는 retrieval 채널이다(route.ts 주석에 이미 적혀 있음). 권고: retrieval 채널 본문에 "관련도 점수 컷" 한 줄을 추가하는 정도(필수 아님). 확신 [확실].
- [12:33] 발견 L-4 LOW — 배포 직후 동작 고지(결함 아님). 국내 분석은 5주간 31/31 `news=0`·errors 비어 있었으므로 M4 task-007 이 배포되기 전에 이 변경이 먼저 나가면 retrieval:domestic 은 배포 후 평일 3번째 관측 날(예: 오늘 배포 후 첫 분석이 10-29 이면 11-02 16:00 국내 분석 시) warning 알림이 실제로 울린다 — 의도된 동작이지만 사용자가 놀라지 않게 보고에 적을 것. 해외 분석은 스위치가 꺼져 있어 관측이 없다. 소급 집계는 없고 첫 0 은 streak 1 에서 시작한다.
- [12:34] 안전 경로·훅. 변경 파일 중 `SAFETY_PATHS` 에 걸리는 것: `^src/app/api/cron/` (route.ts + 그 `__tests__/route.test.ts`), `^src/lib/strategy/` (post-market-engine.ts·post-market-overseas.ts + 두 시험). 신규 `src/lib/rag/news-health.ts` 와 그 시험 2개는 감시 밖이다(`awk '/^SAFETY_PATHS=\(/,/^\)/' scripts/git-hooks/commit-msg` 에 rag 항목 없음). 의견: 감시 밖이어도 문제 없다고 본다 — 이 모듈은 주문·킬스위치·한도·submitOrder·`src/lib/safety`·`src/lib/exchanges` 를 import 하지도 호출하지도 않고(import 는 mysql2 타입·`@/lib/db`·`@/lib/notify/throttle`·`@/lib/time` 뿐), diff 에 safety/exchanges 변경이 없으며(변경 파일 6+3 외 없음), 쓰기 대상은 `system_config` 의 새 키 `news_zero_streak:*` 뿐이고(기존 LIKE 패턴 safety_%·strategy_%·vol_guard_%·report_trade_%·style_%·notify_signal_% 와 겹치지 않음) 분석 흐름에는 호출 지점의 try/catch 가 이중 방어로 남는다. 다만 이 모듈의 "절대 던지지 않는다"가 감시된 분석 흐름의 안전 전제라서, 모듈 본문이 나중에 이 성질을 잃어도 훅이 모른다는 점은 알려 둔다. 선택 사항으로 `^src/lib/rag/news-health\.ts$` 를 훅에 추가할 수 있으나 필수로 보지 않는다(M-1 을 호출 지점에서 막으면 더 필요 없다). 이번 커밋의 `scope` 는 staged 안전 파일(route.ts·두 strategy 소스·세 시험)을 모두 포함해야 훅을 통과하며, 이 감사의 scope 가 그렇게 적혀 있다. 메인 트리에는 이번 작업과 무관한 미추적 파일 2개(`agent-vault/10-Flow/handoffs/2026-10-28-automation-menu-home-claude-handoff.md`, `docs/design/2026-10-27-navigation-icon-decisions.md`)가 있으니 커밋은 변경 9개 파일과 이 task 문서만 명시적으로 스테이징할 것.
- [12:38] 분석·수집 경로 안전(점검 4). 세 호출 지점 모두 try/catch 안이고 예외를 위로 올리지 않는다 — route 는 `recordFetchHealth` 내부 map 별 try/catch + 외부 handler catch, 분석 두 곳은 안쪽 try/catch 와 바깥 `rag_fail` catch 이중. 안쪽 catch 제거 변이는 시험이 잡는다(rag_fail 이 errors 에 남아 `errors: []` 단언 실패). `getPool()` 사용은 기존 관례(`import { getPool } from '@/lib/db'`, 호출 시점 지연 생성, 스키마 fatal 이면 throw 하는 fail-closed)와 같고 throw 는 바깥 try/catch 가 흡수한다(시험 있음). 파라미터 바인딩 사용·SQL 문자열 삽입 없음·키는 검증된 채널/시장에서만 조립(프로토타입 키 `toString` 거부 시험 있음). 알림 `sendAlert` 는 fire-and-forget 이고 내부에서 catch 하므로 미처리 거부가 없다. 알림 본문에 `<`·`&` 가 없어 T-042 때의 텔레그램 이스케이프 문제도 해당 없음. 남는 위험은 M-1 의 무기한 대기뿐이다. 기존 시험의 `jest.mock('@/lib/rag/news-health')` 는 시험 의미를 약화하지 않는다 — 목을 제거한 임시 복사본으로 돌려 보니 기존(비 T-106) 시험 233개는 그대로 pass 이고 T-106 신규 17개만 mHealth 가 목이 아니라 실패하며, 같은 실행에서 실제 mysql 풀이 만들어져 `[db] setup failed: Access denied for user ''@'localhost'` 가 28회 찍혔다(실제 DB 연결 시도). 즉 목은 시험의 실 DB 접촉을 막는 데 필요하고(Developer 보고가 맞다, 다만 post-market-engine 시험은 이미 `@/lib/db` 를 목으로 두고 있어 그 파일에서는 실제 풀이 생기지 않는다), 기존 단언을 가리지 않는다. 신규·수정 시험은 `@/lib/db`·`@/lib/notify`·`@/lib/notify/throttle`·fetch 를 모두 목으로 막아 실제 DB·네트워크·Slack 에 닿지 않는다.
- [12:46] 시험의 질(점검 6) — 변이 시험 결과. ws 복사본에서 변이 40개(두 번에 26개+14개)를 만들어 돌렸고 37개를 시험이 잡았다. 잡힌 것(요청 목록 포함): 같은 날 재실행도 세기, 0 이 아니어도 초기화 안 함, `>=`→`>`, KST→UTC 날짜, 갭 상한 제거, 갭 `>`→`>=`, 역행 허용, 신뢰 게이트 반전·삭제, 뉴스 라벨 검사 삭제, 시장 라벨 오매핑(us→kr), macro 라벨 누락, 비문자열 오류 통과, 접두 `: ` 제거, route 가 fresh 무시, 실패를 0 이 아닌 값으로 기록, route 기록 호출 삭제, 엔진·해외 호출 지점 삭제, 엔진 호출 시장 인자 오류, 안쪽 try/catch 제거(엔진·해외), 알림 TTL 인자 삭제, 심각도 critical, 알림 키 오류, 최솟값 2→1, 같은 날 lastCount 덮어쓰기, 건수 내림 제거, 음수 streak 허용, 달력 유효성 제거, 쓰기 실패해도 알림, 본문의 마지막 정상일·원인 문구 삭제, route 시장 인자 고정, 환경변수 임계 무시, 같은 날 판정 삭제, 건수 +1. 살아남은 3개는 모두 실질 결함이 아니다 — (i) `await recordFetchHealth`→`void recordFetchHealth`: 응답 대기 여부를 시험이 구분하지 않는다(의도적 선택이 없으니 M-1 의 해법으로 바꿔도 시험이 깨지지 않음), (ii) `newsLabel` 에서 `: ` 제거: 어느 쪽이든 이후 "알려진 라벨" 검사에서 같은 결과가 나오는 동등 변이. 읽기 실패 시 `throw e` 변이도 바깥 catch 가 같은 결과를 내는 동등 변이였다. 시험 한계(차단 사유 아님): route 시험은 `recordNewsOutcome` 을 목으로 두므로 route→실제 news-health 통합은 단위·호출 지점 시험의 합으로만 보장된다(타입은 tsc 로 확인). 전체적으로 새 시험은 설계의 핵심 불변식을 의미 있게 고정한다.
- [12:48] QA 에게 넘기는 high_risk_areas. (1) news-health.ts:177-208 `nextNewsZeroState`(같은 날/새 날/갭/역행 분기)와 :270-333 `recordNewsOutcome`(읽기→계산→쓰기→알림 순서·fallback 반환). (2) news-health.ts:237-245 `isNewsRetrievalReliable` 라벨 판정 — 운영 `[rag-retrieval] … errors=N` 로그와 대조할 것. (3) route.ts:105-120·233 (`fresh` 해석, 실패=0, 응답 형식 불변), post-market-engine.ts:533·post-market-overseas.ts:626 (RAG 직후·LLM 전, 후보 0 일 때 호출 없음). (4) 운영 확인 제안(배포 후): 국내 16:00 분석 직후 `system_config` 의 `news_zero_streak:retrieval:domestic` 이 `{streak:1,lastDate:오늘,lastCount:0,…}` 으로 생겼는지, 06시 fetch 후 `fetch:overseas`·`fetch:domestic` 키가 `lastCount>0`·streak 0 인지(읽기 전용 조회), 같은 날 재호출해도 streak 가 늘지 않는지. 위 두 MEDIUM 은 Leader 결정 사항이다 — M-1 을 반영해 코드를 바꾸면 바뀐 줄을 Reviewer 가 다시 확인해야 하며 이 판정은 지금 해시의 파일에 대한 것이다.
- [12:49] **최종 판정: PASS (scope: src/lib/rag/news-health.ts, src/lib/rag/__tests__/news-health.test.ts, src/lib/rag/__tests__/news-health-throttle.test.ts, src/app/api/cron/news-fetch/route.ts, src/app/api/cron/news-fetch/__tests__/route.test.ts, src/lib/strategy/post-market-engine.ts, src/lib/strategy/post-market-overseas.ts, src/lib/strategy/__tests__/post-market-engine.test.ts, src/lib/strategy/__tests__/post-market-overseas.test.ts)**
- [12:25] 델타 재감사 시작(M-1·M-2·LOW 반영분). 위 첫 라운드 bullet 들의 HH:MM 은 작성 중 추정 표기라 실제 시계(이 라운드는 12:25 전후)와 최대 약 30분 어긋난다(첫 라운드는 12:10~12:49 로 적었으나 실제로는 12:0x~12:2x 였다) — 순서는 파일 위치가 정본이다. 대상은 `src/lib/rag/news-health.ts`(333→399줄)와 `src/lib/rag/__tests__/news-health.test.ts`(504→682줄)뿐이다. 메인 트리와 워크트리의 변경 9개 파일은 `sha256sum` 전체 해시가 모두 일치하고, 호출 지점 3개 소스(route.ts·post-market-engine.ts·post-market-overseas.ts)와 그 시험 3개, `news-health-throttle.test.ts` 7개는 첫 라운드에 내가 감사한 복사본과 해시가 같다(바뀐 파일은 위 2개뿐). `git diff --stat -- scripts/` 0줄. 변이 시험은 scratchpad 새 폴더 `t106-rev-mut2/ws` 복사본에서만 했다. 확신 [확실].
- [12:25] 직접 돌린 숫자(워크트리). `npx jest src/app/api/cron src/lib/rag src/lib/strategy src/lib/__tests__/api-usage-callsites.test.ts` → 59 suites pass · 1260 tests pass(Developer 주장과 일치). news-health 2개 suite만 → 128 tests pass. `tsc --noEmit --incremental false`(동일 src 복사본) → 오류 0(news-health.ts 포함 확인). 변경 시험 묶음(news-health·news-fetch route·post-market-engine·post-market-overseas) 378 tests 를 서버 TZ 4종(UTC·America/Los_Angeles·Pacific/Auckland·Asia/Seoul) 모두 pass. `--detectOpenHandles` 로 news-health 시험을 돌려 열린 핸들 0. 확신 [확실].
- [12:25] M-1(DB 대기 상한) 해소 확인 — 코드와 시험으로 직접 검증. `recordNewsOutcome`(news-health.ts:314-334)이 본문 `recordNewsOutcomeBody` 전체(읽기·계산·쓰기·알림 전송)를 `Promise.race([본문.catch(→폴백), 4초 타이머])` 로 감싸므로 상한이 모든 경로를 덮는다: 읽기 hang·쓰기 hang 둘 다 같은 경주에 걸리고(알림은 동기 호출이라 별도 대기 없음), 타이머는 `finally { clearTimeout(timer) }` 로 정상·상한 모두에서 해제된다(시험이 `jest.getTimerCount()===0` 로 고정, `clearTimeout` 삭제 변이를 시험이 잡음). 검색 두 채널은 `Promise.all` 병렬이라 최악 4초이고(순차로 바꾼 변이를 시험이 잡음), 불신뢰 분기는 단일 기록이라 4초, route 의 두 시장 기록도 병렬 4초다. 상한 뒤 늦게 끝난 본문은 계속 진행해 뒤늦게 쓰기·알림을 할 수 있으나 해가 없다: 알림은 `sendAlertThrottled` 의 키 창(20시간)이 먼저 찍은 쪽만 보내므로 이중 알림이 생기지 않고(호출자는 `alerted:false` 를 받지만 호출부 3곳이 반환값을 쓰지 않는다), 늦은 쓰기는 첫 라운드에서 수용한 "마지막 쓰기가 이긴다" 경합과 같은 종류이며 이제 머리말 "알려진 한계"에 적혔다. 늦게 끝나지 않는 쿼리는 풀 연결 1개를 연결이 죽을 때까지 쥐지만 호출은 하루 약 4~6회이고 풀 한도는 10이라 이것만으로 풀이 마르지는 않는다(DB 가 멎으면 그 뒤 분석 INSERT 도 멎는 기존 특성은 그대로). 확신 [확실](코드·시험·변이), 풀 고갈 비현실성은 [가능성 높음].
- [12:25] P7(`.catch` 제거) "동치" 주장 검증 — 부분적으로만 맞다. 늦은 거부는 `Promise.race` 가 본문에 이미 핸들러를 달기 때문에 `.catch` 가 없어도 unhandled 가 생기지 않아 시험이 구분하지 못하는 것이 맞다(P7=내 N09 변이가 생존). 그러나 본문이 상한 **전에** 거부하면 차이가 난다: 본문의 catch 블록 안 `console.warn` 이 던지는 상황(로거 고장)에서 `.catch` 를 빼면 `recordNewsOutcome` 이 거부로 끝난다. 임시 시험(`t106-rev-mut2/keep/rev-p7.test.ts`)에서 DB 읽기 실패+`console.warn` 이 던지도록 한 뒤, 원본 코드는 `{0,false}` 로 resolve 하고 `.catch` 제거본은 "logger down" 으로 reject 하는 것을 확인했다. 즉 `.catch` 는 "절대 던지지 않는다"를 지키는 실질 방어이고 헛 코드가 아니다. 호출부 3곳이 try/catch 로 감싸므로 영향은 없다 → LOW(D-1). 권고: `.catch` 는 그대로 두고, 원하면 이 한 시나리오를 시험에 추가(필수 아님). 확신 [확실](재현).
- [12:25] M-2(검색 오류 채널) 해소 확인 — 기록 내용이 설명과 같다. 믿을 수 있는 실행: `Promise.all([retrieval(count=recentNews.length), retrieval_error(count=1)])`, 믿을 수 없는 실행: `retrieval_error` 에 count 0 한 건뿐이고 `retrieval` 은 건드리지 않는다(news-health.ts:289-307). 같은 날·갭·임계 규칙은 `nextNewsZeroState` 를 그대로 재사용한다. 실제 동작을 임시 시험으로 확인했다: 같은 날 불신뢰→신뢰 전환은 streak 를 0 으로 초기화(이미 보낸 알림은 남음 — fetch 채널의 "같은 날 앞선 실행 0 → 지금 >0" 규칙과 동일한 의도된 동작), 같은 날 신뢰→불신뢰는 streak 불변(lastCount 1 유지, "오늘은 이미 정상")이다. 현실과의 차이: 이 규칙은 "그날 한 번이라도 정상 실행이 있으면 정상일"이라는 뜻이라, 국내 분석은 하루 1회라 영향이 없고 해외 분석 재시도(LLM/파싱/저장 실패 때만 재시도, RAG 는 매번 다시 조회)에서 앞 시도는 정상·뒤 시도는 오류인 드문 경우에만 그날 오류가 안 세어진다 → INFO, 수용 가능. 오류 실행이 `retrieval` 을 끊지도 늘리지도 않는다는 점, 신뢰 실행이 `retrieval_error` 를 초기화한다는 점 모두 시험과 변이로 고정되어 있다. 확신 [확실].
- [12:26] 상태 키 길이·반환형·알림 본문. 가장 긴 새 키 `news_zero_streak:retrieval_error:overseas` 는 41자이고 `system_config.key` 는 `VARCHAR(64)`(src/lib/db.ts:311 `CREATE TABLE IF NOT EXISTS system_config`, 같은 정의가 `t074-disposable-mariadb.test.ts:61`·`t087-collector-disposable-mariadb.test.ts:49` 의 DDL 에도 `varchar(64)`) 한도 안이다. `docs/db-schema.md`·`scripts/migrations/` 에는 system_config 의 CREATE 정의가 없어 운영 DB 의 실제 컬럼은 DESCRIBE 를 못 해 직접 보지 못했다 — 코드의 `CREATE TABLE IF NOT EXISTS` 가 정본이므로 [가능성 높음]. 반환형 `Promise<RetrievalHealthResult | null>` 변경은 호출 지점 두 곳(post-market-engine.ts:533, post-market-overseas.ts:626)이 반환값을 쓰지 않는 문장이라 안전하고, tsc 0 오류, 그 두 시험의 목은 `async () => null` 이라 영향 없음. `NewsChannel` 을 쓰는 곳은 news-health.ts 뿐이다. 알림 본문: 제목 `뉴스 검색 오류 3일 연속 — 국내 분석 검색`, 본문에 채널·시장·`연속 검색 오류: N일`·마지막 정상일(= 마지막 신뢰 실행일)·원인(M4 장애·연결 / API 키 재발급(401) / 컬렉션 삭제·이름 변경 / 응답 5초 제한 초과 — retrieval.ts 기본 timeoutMs 5000 과 일치)과 T-105 경로가 있어 오류 형태와 맞는다. `<`·`>`·`&` 가 없어 텔레그램 HTML 모드(parse_mode HTML)에서도 안전하다. 확신 [확실].
- [12:26] 발견 D-1 LOW — 위 P7 항목(`.catch` 는 실질 방어, 시험은 이 시나리오를 구분하지 못함). 발견 D-2 LOW(문구) — retrieval 채널 원인 안내가 "…검색 유사도 점수 임계(0.5) 미달로 전부 제외됐거나(로그 `droppedByScore`)" 로 끝나 문장이 매듭 없이 이어진다(news-health.ts 의 `CAUSE_HINT.retrieval`). 시험이 그 문자열을 고정하고 있어 고치려면 시험도 같이 바꿔야 하므로 선택 사항이다. 첫 라운드 LOW 중 경합·스로틀/KST 불일치는 합의대로 수용되어 머리말 "알려진 한계"(news-health.ts 머리 주석)에 두 건 모두 적혔고, 점수 컷 안내(L-3)는 반영됐으며, 공백 상한 근거 주석도 정정됐다(L-4 는 코드 변경 아님).
- [12:26] 변이 시험(점검 4) — 새 로직에 16개를 직접 만들어 돌렸고 15개를 시험이 잡았다(생존 1개는 위 P7). 잡힌 것: 불신뢰 분기가 `retrieval` 에도 기록, 신뢰 분기의 `retrieval_error` count 1→0(초기화 누락), 신뢰 분기에서 `retrieval_error` 기록 누락, 신뢰 분기에서 `retrieval` 기록 누락, 상한(`Promise.race`) 제거, `clearTimeout` 삭제, 두 기록을 병렬이 아닌 순차로 변경, 상한 폴백 값 오류, 상한 상수 4000→40000, 상한 도달 경고 로그 삭제, `retrieval_error` 를 채널 허용 목록에서 제거, 불신뢰 분기 count 0→1, 오류 채널 제목/문구 분기 제거, retrieval 안내문의 점수 임계 문구 삭제, 반환 `reliable` 플래그 반전. 새 시험의 질은 충분하다. 시험 한계(차단 사유 아님): 같은 날 신뢰→불신뢰 전환(streak 불변)은 retrieval_error 전용 시험이 없고 공용 `nextNewsZeroState` 시험에 의존한다.
- [12:26] QA 에게 넘기는 high_risk_areas(델타). news-health.ts:289-307(`recordRetrievalNewsOutcome` 두 분기), :314-334(`recordNewsOutcome` 상한 래퍼 — 타이머 해제·폴백), :233-252(`buildNewsZeroAlert` 채널별 제목·본문). 운영 확인 제안(배포 후, 읽기 전용): 국내 16:00 분석 뒤 `news_zero_streak:retrieval:domestic` 과 `news_zero_streak:retrieval_error:domestic` 두 키가 모두 생기고 후자는 `{streak:0,lastCount:1}` 인지(오류 없는 정상 실행일 때), 알림은 3일째에만 가능. 이번 델타는 코드만 바꿨고 M-1·M-2 모두 해소되어 남은 MEDIUM 은 없다. 이 판정은 위 9개 파일의 현재 해시 기준이며 이후 수정은 재확인이 필요하다.
- [12:26] **최종 판정: PASS (scope: src/lib/rag/news-health.ts, src/lib/rag/__tests__/news-health.test.ts, src/lib/rag/__tests__/news-health-throttle.test.ts, src/app/api/cron/news-fetch/route.ts, src/app/api/cron/news-fetch/__tests__/route.test.ts, src/lib/strategy/post-market-engine.ts, src/lib/strategy/post-market-overseas.ts, src/lib/strategy/__tests__/post-market-engine.test.ts, src/lib/strategy/__tests__/post-market-overseas.test.ts)**

## QA

- [12:38] 점검 1 해시·범위. 메인 트리와 워크트리(`~/.node-local/stockinvest-t106`) 변경 9개 파일 sha256 전부 일치(news-health.ts 앞 12자리 `8495a08c8e07`). `git diff --stat dfc8831` = 수정 6개(+267/-9)뿐이고 신규 3개(news-health.ts·시험 2)는 미추적. `src/lib/safety/`·`src/lib/exchanges/`·`src/app/api/orders/`·`scripts/`·`src/middleware.ts` 변경 0줄(메인 트리 `diff HEAD` 도 0줄). `post-market-engine.ts`·`post-market-overseas.ts` 는 각 +3/-0 이고 내용은 import 1줄 + 주석 1줄 + `try { await recordRetrievalNewsOutcome(...) } catch {}` 1줄뿐(diff 로 직접 확인). 워크트리의 미추적 `node_modules` 심볼릭 링크는 시험 실행 부산물로 메인 트리에는 없다. 판정 pass.
- [12:38] 점검 2 시험 실행(워크트리, 직접 실행). `npx jest src/app/api/cron src/lib/rag src/lib/strategy src/lib/__tests__/api-usage-callsites.test.ts` → 59 suites pass · 1260 tests pass(기대치와 일치). `npx jest src/lib/rag` 단독 → 7 suites · 185 tests pass. `npx jest src/lib/safety src/app/api/orders` → 38 suites pass · 1098 tests pass · 1 suite(14 tests)는 skipped — `t081b-daily-limit-race-disposable-mariadb.test.ts` 가 환경변수 PORT 가 있어야 도는 일회용 MariaDB 시험(`describe.skip` 분기, 파일 안 주석 확인)이라 이 변경과 무관하고 실패는 0. 기준선 비교는 필요 없었다. 판정 pass.
- [12:38] 점검 3 타입. `npx tsc --noEmit --incremental false` 종료코드 0·출력 0바이트(로그 파일 크기 0 확인). `--listFiles` 로 news-health.ts·news-fetch/route.ts·post-market-engine.ts·post-market-overseas.ts 가 컴파일 대상에 들어 있음을 확인(워크트리 파일 504개). 참고: tsconfig 가 `__tests__`·`*.test.ts` 를 exclude 하므로 tsc 는 시험 파일 타입을 보지 않는다(Reviewer 지적과 동일, 시험은 swc 로 실행). 판정 pass.
- [12:38] 점검 4 범위 안전. 위 점검 1 과 같은 근거로 pass. 새 모듈의 import 는 `mysql2` 타입·`@/lib/db`·`@/lib/notify/throttle`·`@/lib/time` 뿐이고 주문·킬스위치·한도·`submitOrder`·거래소 어댑터를 부르지 않는다(news-health.ts 직접 읽음). 쓰기 대상은 `system_config` 의 새 키 `news_zero_streak:*` 하나이며 `INSERT … ON DUPLICATE KEY UPDATE` 파라미터 바인딩(`?`)이라 SQL 삽입 경로가 없다. 실매매 안전장치(DRY_RUN·킬스위치·주문 한도·심볼 차단·감사 로그) 코드는 한 줄도 바뀌지 않았고 안전 관련 기존 시험 1098개가 그대로 pass 라 영향 없음.
- [12:38] 점검 5 무중단(핵심) — 코드 추적. `recordNewsOutcome` 은 본문(`recordNewsOutcomeBody`)에 `.catch`(로그 실패까지 흡수)를 달고 4초 타이머와 `Promise.race`, `finally { clearTimeout }` 로 감싼다. 본문 안은 입력 검증 → SELECT(try) → 계산 → INSERT(try) → 알림이 모두 바깥 try/catch 에 들어 있어 어떤 예외도 `{streak:0, alerted:false}` 로 돌아간다. 호출 3곳: route.ts 는 `recordFetchHealth` 가 시장별 try/catch + `Promise.all`(병렬)이고 바깥 handler 의 500 catch 가 한 번 더 받으며 응답 JSON 은 `results = outcomes.map(o => o.result)` 라 `fresh` 가 응답에 새지 않는다; post-market-engine.ts:533 과 post-market-overseas.ts:626 은 `retrieveRagContext` 직후 안쪽 try/catch 가 있고 그 바깥 try 는 `rag_fail` 을 errors 에 쌓는 구조라 기록이 던져도 `rag_fail` 이 생기지 않고 LLM·INSERT 로 진행한다. `sendAlert` 는 `void dispatchAlert(...).catch()`(dispatchAlert 는 async)라 실제 환경에서 동기로 던지지 않는다.
- [12:38] 점검 5 무중단 — 임시 시험 결과(스크래치패드 `t106-qa/ws` 복사본, 실제 news-health + 실제 sendAlertThrottled, DB·sendAlert 만 목; 워크트리·메인 트리에는 파일 없음). ① DB 읽기가 영원히 끝나지 않을 때: SELECT hang 4001ms·INSERT hang 4001ms 후 `{0,false}`(알림 없음); `recordRetrievalNewsOutcome` 신뢰 분기 4000~4001ms·불신뢰 분기 4000ms(두 기록이 병렬이라 8초가 아님); route.ts 를 실제 news-health 와 붙이고 DB hang 으로 POST 하면 4003ms 만에 `{ok:true, markets:[{market,ok,upserted,attempts}×2]}` — 필드 4개뿐, `fresh` 키 없음, HTTP 200(응답 형식 불변). 그 밖에 getPool 동기 throw·SELECT reject·INSERT reject 는 즉시 `{0,false}`, 잘못된 입력 11종(null·undefined·`{}`·NaN·-1·'x'·Infinity·미지원 채널·시장·`toString`·`__proto__`)은 던지지 않고 DB 기록 0건, sendAlert 동기 throw 와 console.warn(로거) throw 에도 reject 하지 않음.
- [12:38] 점검 5 ② 같은 날 두 번. KST 날짜가 같고 UTC 로는 이틀에 걸친 두 시각(10-28 01:00 KST·23:59 KST)에 0 두 번 → streak 1→1, 저장 JSON `{streak:1,lastDate:'2026-10-28'}`; KST 자정(10-29 00:00)을 넘기면 2. 같은 날 0 을 5번 → 1 유지, 같은 날 0 뒤 7 → 0 으로 초기화, 7 뒤 0 → 0 유지(lastCount 7). retrieval 채널도 같은 날 두 번 모두 1. 판정 pass.
- [12:38] 점검 5 ③ 3일 연속 0 에서만 알림. 날짜 순서로 측정(06:00 KST, 정기 크론 간격): 1일차 streak 1·알림 0건 → 같은 날 재실행 1 → 2일차 2·알림 0건 → 3일차 streak 3 `alerted:true`·sendAlert 1건(level `warning`, 제목 `뉴스 0건 3일 연속 — 국내 수집`) → 같은 날 3시간 뒤 재실행 `alerted:false`(총 1건 유지). 2일 0 뒤 3일째 건수>0 이면 streak 0 으로 초기화되고 이후 다시 3일 0 이 이어져야 알림(10-31 에 1건). domestic 3일 0 이 overseas·retrieval 키를 만들지 않음(시장·채널 독립). 환경변수 `NEWS_ZERO_ALERT_STREAK=5` 면 3일차 알림 없음·5일차에 알림. route 통합: M4 가 `{upserted:20, fresh:0}` 를 주면 upserted 20 이어도 0 으로 세어 3일차에 국내·해외 알림 정확히 2건(각 warning), `fresh:'abc'`(비숫자)는 무시하고 upserted 20 으로 세어 streak 0.
- [12:38] 발견 N-1 INFO(요청 문구와 구현의 차이 — 결함 아님, Leader 인지 필요). 요청서 점검 5③ 의 "4일째는 스로틀로 재알림 없음" 은 구현과 다르다. 정기 간격(06:00 KST, 24시간 간격)으로 측정하면 4일차 streak 4 `alerted:true`(누적 2건), 4일차 같은 날 3시간 뒤 재실행은 `alerted:false`, 5일차 streak 5 `alerted:true`(누적 3건)이다. 즉 고쳐질 때까지 하루 1회 계속 울린다. 이것은 지시서 설계("임계 이후에도 하루 1회는 계속 울린다 — in-memory throttle 로 하루 1회")·news-health.ts 머리 주석·`news-health-throttle.test.ts` 와 일치하는 의도된 동작이고, 스로틀 창(20시간) 안의 재호출(예: 3일차 06:00 알림 뒤 4일차 00:10 KST 의 새 날짜 관측 = 18시간 10분 뒤)은 `alerted:false` 로 막힌다(측정). 사용자가 "한 번만" 을 원하면 설계 변경 사항이다.
- [12:38] 발견 N-2 INFO. `sendAlert` 가 동기로 던지는 가상 상황에서는 상태가 이미 저장됐는데도 반환이 `{0,false}` 이고 스로틀 키는 이미 소모돼 그 알림은 20시간 동안 다시 안 나간다. 실제 `sendAlert` 는 async `dispatchAlert` 를 `void … .catch()` 로 부르므로 동기 throw 가 불가능해 운영에서는 발생하지 않는다. 조치 불필요.
- [12:38] 점검 6 시간대. 워크트리에서 `TZ=Asia/Seoul`·`TZ=America/Los_Angeles` 로 `npx jest src/lib/rag` → 둘 다 7 suites·185 tests pass. 추가로 변경 범위 전체 묶음(59 suites·1260 tests)도 두 TZ 에서 모두 pass, 내 임시 시험 19개(3 suites)는 America/Los_Angeles·Pacific/Auckland 에서 모두 pass. 판정 pass.
- [12:38] 점검 7 비밀·민감 정보. 변경 9개 파일의 추가된 줄(수정 6개는 diff 의 `+` 줄 전부, 신규 3개는 전체 1422줄)을 grep: 토큰·키·비밀번호·bearer 패턴 hit 은 시험 문자열 `'AI_API_KEY not configured'`(오류 메시지 예시, 값 아님)와 route 시험의 기존 더미 `'test-admin-token'` 뿐; 32자 이상 토큰형 문자열 0건; URL·IP·이메일 0건; 전화·주민번호형 0건; `process.env` 읽기는 `NEWS_ZERO_ALERT_STREAK`(임계) 하나(소스). 알림 본문은 `buildNewsZeroAlert` 가 채널 라벨·시장·연속 일수·기준·마지막 확인일·마지막 정상일·원인 안내 한 줄·T-105 문서 경로만 담고 `errors` 원문이나 설정값을 받지 않는다(실제 알림 문자열을 뽑아 token/secret/password/bearer/sk-/AKIA/xox, URL, IP 정규식 부재 확인). 판정 pass.
- [12:38] 점검 8 시험 신뢰도 — 변이 12건을 스크래치패드 복사본 `t106-qa/ws-mut`(기준선 128 tests pass)에서 돌려 12건 모두 시험이 잡았다. news-health.ts 변이: 같은 날 판정 끄기 6 fail, 임계 `>=`→`>` 19 fail, 0 아님일 때 초기화 제거 6 fail, 4초 상한(`Promise.race`) 제거 3 fail, KST→UTC 날짜 23 fail, 알림 키 고정 6 fail. 호출 지점 변이: 엔진 호출 삭제 1 fail, 엔진 안쪽 try/catch 제거 1 fail, 해외 안쪽 try/catch 제거 1 fail, route 가 `fresh` 무시 2 fail, route 기록 호출 삭제 10 fail, route 실패를 5 로 기록 2 fail. 생존 변이 0건. 변이는 모두 복사본에서만 했고 끝에 `cmp` 로 원본과 동일 복원을 확인했다.
- [12:38] 정리 사항. 내 임시 시험 첫 실행에서 3건이 실패했으나 원인은 내 시험 코드(앞 시험이 설정한 `sendAlert` 던지기 목이 다음 시험으로 새는 문제, route 시험의 `jest.resetModules()` 로 목 모듈이 갈라지는 문제)였고 제품 코드 결함이 아니다 — 목 초기화로 고쳐 재실행해 전부 통과했다. 워크트리·메인 트리에는 파일을 만들거나 고치지 않았다(`git status` 가 실행 전후 동일). 임시 시험 파일은 `t106-qa/ws/src/qa-t106/` 에 남아 있다(커밋 대상 아님). 20-Log 한 줄은 요청서 지시(기록은 `## QA` 절에만)에 따라 남기지 않았다.
- [12:38] 결함 요약: Critical 0 · High 0 · Medium 0 · Low 0 · INFO 2(N-1 요청 문구와 일일 재알림 설계 차이, N-2 가상 시나리오). 실매매 안전장치 체크(DRY_RUN·킬스위치·주문 한도·심볼 차단·감사 로그)는 이 변경이 해당 코드를 건드리지 않고 관련 기존 시험 1098개가 pass 라 영향 없음으로 판정. 배포 인계 시 `post_deploy_checks` 제안(읽기 전용): 06시 fetch 직후 `system_config` 의 `news_zero_streak:fetch:domestic`·`:overseas` 키 생성과 `lastCount`, 국내 16:00 분석 직후 `news_zero_streak:retrieval:domestic` 과 `:retrieval_error:domestic` 두 키 생성, 같은 날 재호출 시 streak 불변; 국내 retrieval 은 M4 task-007 배포 전이면 3번째 평일 관측일에 warning 이 실제로 울릴 수 있음(Reviewer L-4 와 동일).
- [12:38] **QA 판정: PASS**

## 배포 기록

- [10-28 13:27] 푸시 `414cc3b..0825250`(커밋 `dfc8831` 문서 + `0825250` T-106). **사용자 지시**(원문): "커밋 및 푸시해서 배포작업 진행해줘". 예약했던 15:43 푸시를 사용자 지시로 앞당겼다(장중 푸시 — T-103 과 같은 방식). 푸시 직전 확인: 킬스위치 `true`(ON), 최근 3시간 `orders` 0건, 푸시 대상 커밋 2개 모두 이번 세션 작성분. 예약 작업(15:43)은 취소.
- [10-28 13:29] 웹훅 blue/green 배포 완료 — `RELEASE_RESULT ok`, 릴리스 `20261028-132733-08252507`, 이전 `20261028-112124-414cc3b4`, `migrated=false`(DB 변경 없음). pm2 `stockinvest`·`stockinvest-cron` online(재시작 0), `/api/health` ok(`killSwitch:true`, safetyStatus green).
- 롤백: `git revert 0825250` 후 푸시(코드만 되돌림, 상태 키 `news_zero_streak:*` 는 남아도 무해).

## Codex 검토

### [2026-10-28 12:3x] C2 review focus=none — done
- judge 판정: 위 판단 기록 C2 줄 / 호출 차수: 1/4 (Leader 가 래퍼를 직접 실행 — codex 역할 에이전트를 따로 부르지 않음)
- 대상: repo=`~/.node-local/stockinvest-t106`(격리 워크트리) base=`dfc8831`(arg) snapshot=`9d0392a`
- 지적 1건: [medium] `node_modules:1` — 워크트리의 `node_modules` 심볼릭 링크(`~/.node-local/stockinvest-p3s1/node_modules` 가리킴)가 변경으로 잡혀 "머신 전용 절대경로를 커밋한다"는 지적. → **Leader 판정: 검토 대상의 부산물이라 코드 결함 아님.** 이 링크는 시험 실행용으로 워크트리에만 둔 미추적 파일이고 `.gitignore` 가 `node_modules/` 를 제외하며, 실제 커밋은 메인 트리에서 명시한 9개 경로만 스테이징한다(링크는 커밋되지 않음). 코드 변경 자체에 대한 지적은 0건.
- 검토하지 못한 범위: 지시서 사본이 스냅샷에 없어 대조 못 함(메인 트리에만 있음) · M4 `fresh` 필드 제공 구현은 이 저장소 밖이라 집계 정확성 미검증 · 실제 DB 지연·텔레그램 전송 통합 동작은 제약상 미실행
- 원본: `.claude/state/codex-review/runs/20261028T032722Z-T-106-C2/raw.txt`

## 최종 요약

**[T-106] 뉴스가 3일 연속 0건이면 텔레그램 알림 — 운영 반영 완료, 첫 관측 대기**

- 상태: 배포됨(13:29 KST, 릴리스 `20261028-132733-08252507`). 관측 전.
- 무엇이 바뀌었나: 뉴스 수집(06:00)과 국내·해외 장마감 후 분석(국내 16:00, 해외는 스위치 켠 뒤)이 뉴스 건수를 일 단위로 기록하고, 같은 채널이 연속 3일 0건이면 텔레그램 경고를 보낸다(20시간 스로틀 — 해결될 때까지 하루 1회 반복, 의도된 설계). 수집은 정상인데 검색에서 0건인 경우와 검색 자체가 실패한 경우도 따로 센다. 기록·알림은 4초 상한이라 수집·분석을 막지 않는다. 주문·시그널·안전장치 경로 변경 없음.
- 배포: 위 배포 기록 참조(사용자 지시로 앞당긴 장중 푸시, 킬스위치 ON·최근 3시간 주문 0건 확인 후).
- AI 가 검증한 것: Reviewer 2라운드 PASS(중간 2건 반영), Codex C2 코드 지적 0건, QA PASS(jest 59 suites·1260 tests, 서버 시간대 2종, 변이 12종 모두 검출, DB 멈춤 4초 폴백·같은 날 중복 미증가·3일째에만 알림 임시 시험). 못 한 것: 운영 DB·텔레그램 실제 연동(제약상 미실행) — 아래 관측으로 확인.
- 👉 사용자가 확인할 것(AI 가 먼저 확인하고 결과를 보고한다): 오늘 16:00 국내 분석 직후 DB `system_config` 에 `news_zero_streak:retrieval:domestic`·`news_zero_streak:retrieval_error:domestic` 키가 생기고 `lastCount` 가 0 이 아닌지(M4 수정 task-007 로 뉴스가 검색되기 시작했으므로 정상 기준은 5 이하의 양수), 내일 06:00 수집 뒤 `news_zero_streak:fetch:domestic`·`:overseas` 키 생성. 정상 기준: 텔레그램 경고가 오지 않는다.
- 남은 일: 위 관측 기록, T-105 종료 조건(분석 로그 `[rag-retrieval] news>0`) 확인, 낮음 2건(D-1 `.catch` 구분 시험 추가·D-2 경고 문구 매듭) 후속 후보.
- 이슈·위험: 해외 장마감 후 분석은 스위치가 꺼져 있어 해외 검색 감시는 스위치를 켠 뒤부터 시작된다. 연휴·휴장일에는 건수가 0 이어도 경고가 날 수 있다(3일 연속 기준).

## 데모 검토 (demo gate)

> 실행 판정 정본은 frontmatter `demo_gate` 이다. 이 표는 check.mjs 가 함께 기록하는 사람용 이력이다(docs/demo-review-gate.md).

| 버전 | 상태 | 저장소 파일 | Artifact | 사용자 결정 | 일시 |
|---|---|---|---|---|---|
| - | 해당없음 | - | - | judge: none | 10-28 11:36 |
