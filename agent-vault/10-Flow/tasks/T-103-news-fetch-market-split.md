---
task_id: T-103
title: 뉴스 수집 크론 잡을 국내·해외 두 개의 독립 잡으로 분리 (수집 잡 시장별 그룹 관리의 1단계)
status: done
priority: medium
project: StockInvest
created: 2026-10-28
updated: 2026-10-28
base_ref: bf8450d
risk_level: R2
roles_involved: [leader, judge, developer, reviewer, qa, codex, deployer]
related_tasks: [T-036-news-fetch-silent-failure, T-037-cron-watchdog, T-062-post-market-overseas]
tags:
  - type/task
  - domain/cron
  - domain/data-collection
aliases:
  - 뉴스크론분리
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

# T-103 뉴스 수집 크론 잡을 국내·해외로 분리

## 사용자 지시 (2026-10-28 10시대, 발화 그대로)

"그렇다면 우선은 뉴스에 대한 수집에 대하여 국내 뉴스와 해외뉴스 수집하는 작업을 나누고 크게는 잡들에 대하여 해외주식정보 수집과 국내주식정보 수집으로 그룹을 나누어서 잡을 관리하는 것으로 변경해줘. 일단은 국내뉴스와 해외뉴스의 크론잡을 분리하는 작업 진행 후에 크론잡 정리작업도 진행하자"

- 이 task 는 **1단계(뉴스 잡 분리)만** 다룬다. 전체 수집 잡의 해외/국내 그룹 관리(크론 잡 정리)는 **후속 task**(T-104 예정)다 — 이번에 섞지 않는다.

## 현재 구조 (이번 세션에서 코드로 확인)

- `scripts/cron-runner.sh`(pm2 `stockinvest-cron`, 60초 틱) 가 매일 06시(HH=06)에 `POST /api/cron/news-fetch` 를 **한 번** 부른다. 날짜 파일 `~/.node-local/stockinvest/news-fetch-last-date` 에 성공·실패 무관하게 기록(T-036 규칙).
- 라우트 `src/app/api/cron/news-fetch/route.ts` 는 `MARKETS = ['domestic','overseas']` 두 시장을 `Promise.all` 로 **병렬** 처리한다. 시장별 최대 3회 시도(시도당 60초 상한, 재시도 사이 3초), M4 `POST {AI_API_BASE}/v1/news/fetch {market, limit: 20}`. 부분 실패 `news-fetch:partial_failed`(warning)·전체 실패 `news-fetch:all_failed`(critical) 알림, 토큰 누락 `news-fetch:config`(critical) 후 스킵. 응답은 항상 HTTP 200(진짜 예외만 500).
- 하트비트 워치독은 `CRON_HEARTBEAT_STALE_SEC` 기본 **300초** 동안 틱 시작 기록이 갱신되지 않으면 "크론 정지" critical 을 보낸다(`src/lib/ops/cron-watchdog.ts`). 틱 안의 `call` 은 동기다.
- 소비처: 해외 post-market(08:00)은 `news.us_market`, 국내 post-market(16:00)은 `news.kr_market` 을 RAG 로 검색한다.

## 설계 (Leader — 동작 보존형 분리)

목표: 두 시장 수집을 **독립된 잡**(별도 호출·별도 날짜 파일·별도 알림 키)으로 만든다. 실행 시각(06시)·건수(20)·재시도(3회)·60초 상한은 **그대로** 둔다 — 시각 재배치(예: 국내 뉴스를 국내 분석 직전으로)는 후속 "크론 잡 정리"에서 사용자와 정한다.

1. **라우트** `POST /api/cron/news-fetch?market=domestic|overseas`
   - `market` 지정 시 그 시장만 처리. 응답 형식 `{ ok, markets: [{ market, ok, upserted, attempts, error? }] }` 유지(배열 길이 1).
   - `market` 미지정 시 **기존과 동일하게 두 시장 모두**(하위 호환 — 수동 호출, 배포 중 옛 러너 호출, 롤백).
   - 허용 밖 값은 **인증 통과 후** `400 { ok:false, error:'invalid_market' }`, M4 호출 0.
   - 인증(`checkCronAuth`)이 항상 먼저. 토큰 누락 fail-safe(알림 후 스킵)는 단일 시장 호출에서도 그대로.
   - 알림: 두 시장 호출(미지정) 경로는 **기존 키·심각도 불변**(`partial_failed` warning / `all_failed` critical). 단일 시장 호출이 전량 소진 실패하면 키 `news-fetch:<market>:failed`, 심각도 `critical`(뉴스 공백이 조용히 분석에 반영된 T-036 사고의 교훈 — 한 시장 전체 실패도 숨기지 않는다), 본문에 시장명.
   - `trackCall('m4','news.fetch')` 의 op 이름·호출 지점 문자열(`api-usage-callsites.test.ts` 가 고정)은 **바꾸지 않는다.**
2. **러너** `scripts/cron-runner.sh`: 06시 블록 하나를 시장별 둘로 나눈다.
   - 해외 `news-fetch-overseas` → `/api/cron/news-fetch?market=overseas`, 날짜 파일 `news-fetch-overseas-last-date`.
   - 국내 `news-fetch-domestic` → `/api/cron/news-fetch?market=domestic`, 날짜 파일 `news-fetch-domestic-last-date`.
   - 날짜 파일은 T-036 규칙 그대로 **성공·실패 무관, 하루 1회**.
   - **서로 다른 틱에 배치**한다(워치독 300초 한도): 현재는 두 시장이 한 호출 안에서 병렬이라 최악 약 186초(3×60+2×3)인데, 같은 틱에 순차로 호출하면 최악 약 372초로 한도를 넘는다. 해외(08:00 분석이 소비) 먼저, 국내는 같은 틱에 해외가 막 돈 경우 다음 틱으로 미룬다(broker-fills 의 `yield_tick` 선례 — 호출 **전** 값으로 판단). `call()` 을 병렬화하지 않는다(임시 파일명 `$$` 충돌).
   - 알려진 가장자리: 해외가 06:59 틱에 처음 도는 경우(러너가 06시 거의 내내 꺼져 있었던 날) 국내는 07시로 넘어가 그날 건너뛴다 — 국내 뉴스는 16:00 에 소비되고 하루 공백은 다음 날 정상 복구되므로 허용하되 주석에 명시하고 Reviewer 가 평가한다. 07시 틱(EDGAR·research)에 합류시키지 않는다(틱 시간 악화).
   - 옛 날짜 파일 `news-fetch-last-date` 는 읽지 않는다. 배포가 06시대에 걸리면 당일 1회 추가 수집이 일어나지만 멱등이라 무해 — **배포는 15:40 이후**라 해당 없음.
   - 헤더 주석의 잡 목록 갱신.
3. **테스트**
   - `src/app/api/cron/news-fetch/__tests__/route.test.ts` 확장: `market=domestic`(M4 호출 1회, 해외 0)·`market=overseas`·미지정(두 시장, 기존 알림 키 불변)·잘못된 값 400(M4 호출 0, 인증 우선)·단일 시장 전량 실패 알림 키/심각도·토큰 누락 단일 시장.
   - 신규 `scripts/test-cron-runner-news-split.sh`(`test-cron-runner-pmo-retry.sh` 의 curl·date·sleep 스텁 방식): 05:58~06:12 틱 모사 — 각 시장 정확히 1회 호출, **같은 틱에 두 번 호출하지 않음**, 실패(502)여도 하루 1회, 날짜 파일 2개, 다른 잡 호출 목록이 변경 전과 같음, 06:59 가장자리 동작.
   - 기존 `bash scripts/test-cron-runner-pmo-retry.sh`·`test-cron-runner-stop-alert.sh`·news-fetch·api-usage-callsites·cron 관련 jest 전부 회귀 없음.

## 하지 않는 것

- 실행 시각·건수·재시도·M4 API 변경, `news.macro` 컬렉션 손대기
- 다른 수집 잡(edgar-sync·kis-fundamentals-snapshot·research-cycle 등) 변경, 해외/국내 그룹 관리 구조 도입(= 후속 T-104)
- `call()` 함수 수정, 병렬 호출
- 운영 DB·M4 쓰기 실험(검증은 스텁·mock). 배포 후 검증은 잘못된 시장 값 400 확인과 다음날 06시 로그 확인.

## 소유 파일 (예상, 모두 훅 감시 — `^src/app/api/cron/`·`^scripts/cron-runner\.sh$`)

- `src/app/api/cron/news-fetch/route.ts`, `src/app/api/cron/news-fetch/__tests__/route.test.ts`
- `scripts/cron-runner.sh`, `scripts/test-cron-runner-news-split.sh`(신규 — 훅 목록에는 없음)

## 배포

- push = webhook blue/green 배포. **장외 창 15:40~22:20 KST**(docs/deploy-order.md). 현재 10:0x 라 구현·감사는 먼저 하고 push 는 15:40 이후. 로컬 앞선 커밋 `bf8450d`(문서 전용)와 이번 task 가 함께 나간다 — 같은 배포에 실린 작업으로 기록.
- 롤백: 이 task 커밋 `git revert` 후 push(라우트는 하위 호환이라 옛 러너와도 동작).
- 검증: 배포 후 `pm2 list` 에서 `stockinvest-cron` 정확히 1행, 하트비트 갱신, 잘못된 시장 값 → 400, 다음날 06시 로그에 두 시장 각 1회·서로 다른 틱.

## 판단 기록 (judge)

- [10-28 10:1x] intake `judge-result@2` — 규칙 엔진 폴백(`budget_window_closed`): risk R1, developer_model opus, demo none(화면 변경 없음), next assign. **override: R1 → R2** — judge.md "프로젝트 맞춤" 절의 무인 실행(cron) 영역(`src/app/api/cron/**`·`scripts/cron-runner.sh`)을 건드리므로 Leader 가 R2 로 취급. Codex 연계 on.
- 관련 교훈(`/이슈기록 관련 cron 크론 배포 워치독`): 승인된 교훈 없음.

## 진행 기록

- [10-28 10:1x] task 생성. 설계 확정(위). 다음: Codex C1 여부 판단 → Developer.
- [10-28 10:2x] judge C1: `codex_required: false`(CX-limit-unknown-r2, 한도 값 stale) → 따라 건너뜀. 격리 워크트리 생성·Developer(Opus) 소환.
- [10-28 10:4x] Developer 완료 → Reviewer(Sonnet) 독립 감사 **PASS**(CRITICAL/HIGH/MEDIUM 0, LOW 4 조치 불필요; 러너 변이 9·라우트 변이 10 전부 잡힘). 메인 트리에 5개 파일 커밋 없이 반영(sha256 워크트리와 동일).
- [10-28 10:43] judge C2: `codex_required: true`(mode review) → Codex 호출 1/4: **지적 0건**(base_source=task_file).
- [10-28 10:5x] QA(Haiku) 직접 실행: 6/8 통과, 항목 7 은 시험 고정값 더미 1건 — Leader 가 위반 아님으로 재판정(QA 절 참고). 예상 실패 1건(broker-fills '기존 줄 변경 0')은 판정 사유 아님. 다음: 커밋(훅 PASS 검사) → 15:40 이후 push.
- [10-28 11:xx] 사용자 질문(뉴스 RAG 0건 원인)에서 발견: 이 task 와 **별개 문제** — 해외 뉴스 원천 피드가 2025-01-27 이후 멈춤, 국내는 날짜 형식(RFC 822 vs ISO 필터) 추정. 후속 task 후보(T-105).

## Developer

- [10:4x] Developer(Opus, 격리 워크트리 `~/.node-local/stockinvest-t103`, 커밋 없이 완료) — `route.ts` `resolveTargetMarkets()`(미지정=두 시장·`domestic`/`overseas`=한 시장·그 밖=400)와 인증→시장 값 검사→토큰 확인→수집 순서, 단일 시장 전량 실패 알림 `news-fetch:<market>:failed` critical. `cron-runner.sh` 06시 블록을 `# >>> news-fetch-split` 으로 교체(해외 먼저·국내는 호출 **전** 값 `LAST_NEWS_OVS` 로 미루기, 날짜파일 시장별 2개·성공 실패 무관 하루 1회). 시험: route.test.ts +22건(총 33), 신규 `scripts/test-cron-runner-news-split.sh`(PASS 59), `test-cron-runner-pmo-retry.sh` 변수 목록 3줄 갱신(지시 밖이나 필요 — 사라진 변수를 찾다 실패하므로, Reviewer 가 시험 목적 약화 없음 확인). 변이 시험 3건 모두 잡힘. 보고 원문 요약일 뿐이며 전문은 세션 기록.
- 개발 중 발견: 기존 시험 `broker-fills/__tests__/cron-runner-block.test.ts` '기존 줄 변경 0 — HEAD 대비 추가만' 은 옛 06시 뉴스 블록(9줄)을 지우므로 **커밋 전에는 반드시 실패**한다 — Reviewer 가 빠진 9줄이 전부 뉴스 관련임을 직접 대조해 확인. 이 시험은 HEAD 와 비교하므로 커밋 후엔 자명하게 통과한다(검증이 아님) — 실질 증거는 신규 시험 E(뉴스 외 실행 190줄이 bf8450d 와 동일)·D(뉴스 외 호출 5,073건 동일). 시험은 고치지 않는다(범위 밖·SAFETY 경로). **후속 개선 후보**: 이 시험의 비교 기준을 T-087 커밋으로 고정하거나 broker-fills 블록만 보도록.

## Reviewer

- [10:41] 감사 대상: 격리 워크트리 `/home/brownjeon/.node-local/stockinvest-t103`(브랜치 t103-news-split, 기준 bf8450d)의 커밋 전 변경 5개 — route.ts · route.test.ts · scripts/cron-runner.sh · scripts/test-cron-runner-pmo-retry.sh(지시 밖 수정) · scripts/test-cron-runner-news-split.sh(신규). 코드는 읽기·시험 실행만 했고 워크트리·메인 트리 파일은 고치지 않았다(변이 시험은 scratchpad 임시 복사본에서만). git commit/push·DB·M4·KIS 실호출·.env 읽기 없음. 판정: critical 0 · high 0 · medium 0 · low 4(전부 조치 불필요 또는 선택) → pass.
- [10:41] 의도 검증(지시서 설계 1~3항) [확실] — (a) market 미지정 = 기존과 동일: route.ts:57-62 `raw===null → MARKETS`, 알림은 `else if` 분기에 기존 키·심각도·문구 그대로(`news-fetch:partial_failed` warning / `all_failed` critical), 시험 2건이 고정. (b) 잘못된 값(빈 값·대소문자·`all`·`domestic,overseas`·앞 공백): `checkCronAuth` → 그 다음 `resolveTargetMarkets` → 400 `invalid_market`, 토큰 확인·M4 호출보다 앞이라 M4 0·알림 0, 인증 실패면 잘못된 값이어도 401. (c) 단일 시장 전량 실패: 키 `news-fetch:<market>:failed`·critical·본문에 시장명, HTTP 200·ok=false. (d) 토큰 누락 fail-safe: 단일 시장에서도 `news-fetch:config` critical 1회 후 스킵(markets []). (e) trackCall 호출 지점 문자열·op `('m4', 'news.fetch'` 불변(diff 로 직접 확인, api-usage-callsites 통과). (f) 응답 `{ok, markets}` 유지(배열 길이 1). 실제 `NextRequest` 로도 쿼리 파싱을 확인했다(`?market=overseas`→overseas, 쿼리 없음→null, `?market=`→'' → 400).
- [10:41] 러너 감사 [확실] — 해외(06:00) 먼저, 국내는 `LAST_NEWS_OVS`(블록 안에서 해외 호출 **전에** 읽은 값)가 오늘이 아니면 yield_tick 으로 다음 틱에 미룬다. 두 호출은 한 틱에 절대 겹치지 않는다(국내 호출 조건이 "해외 블록이 이 틱에 안 돈다"와 동치). 날짜파일은 두 곳 모두 호출했으면 성공·실패 무관 기록(T-036). `git diff scripts/cron-runner.sh` 로 직접 확인: 바뀐 곳은 헤더 주석·NEWS_FETCH_* 선언 2줄·06시 블록 하나뿐이고 `call()` 본문과 다른 잡의 실행 줄은 한 글자도 안 바뀌었다(새 시험 E 도 같은 결론: 뉴스 밖 실행 190줄 동일, call() 해시 동일). 워치독: 해외 호출 한 번의 최악은 라우트 시장 하나 186초(3×60+2×3)로 분리 전(두 시장 병렬 186초)과 같다 — 하트비트 간격 최악 186+60=246초(스텁 시계), 실제 분 단위 잡 약 30초를 더해도 약 276초 < 300초. 즉 기존 대비 악화 없음(여유 24초 자체는 분리 전과 같은 기존 한계).
- [10:41] 06:59·느린 M4 가장자리 [확실] — 시험으로 재확인: 해외가 06:59 에 처음 돌면 국내는 07시로 넘어가 그날 건너뛰고(yield 로그 1줄) 다음 날 06:00/06:01 정상 복구, 07시 틱에는 뉴스 호출이 없다(합류 안 함). 느린 M4(시장당 186초)는 해외 06:00 → 국내 06:04, 06:57 시작이면 해외만 돌고 국내는 그날 건너뜀. 주석 내용과 동작이 일치한다. 이 가장자리는 "러너가 06시 거의 내내 꺼져 있던 날"에만 생기고 국내 뉴스는 16:00 에 소비되며 다음 날 복구되므로 허용에 동의한다.
- [10:41] 시험 실행(직접 재실행) — `npx jest src/app/api/cron src/lib/__tests__/api-usage-callsites.test.ts`: 19 스위트 중 18 pass · 1 fail, 306 테스트 중 305 pass · 1 fail(실패 1건 = broker-fills cron-runner-block '기존 줄 변경 0', 아래 별도 항목). news-fetch route.test.ts 33/33 pass, api-usage-callsites pass. `bash scripts/test-cron-runner-pmo-retry.sh` pass=76 fail=0 · `bash scripts/test-cron-runner-stop-alert.sh` pass=22 fail=0 · `bash scripts/test-cron-runner-news-split.sh` pass=59 fail=0(3분 13초; 섹션 A 이틀·B 06:59·C 느린 M4·D 1440틱 하루 전체·E 정적) · `npx tsc --noEmit -p .` 와 `--incremental false` 모두 종료 0·출력 없음 · `git diff --check` 깨끗 · `bash -n` 통과.
- [10:41] 변이 시험(시험의 질) [확실] — 러너 변이 9개를 scratchpad 복사본으로 만들어 새 시험(시간 절약을 위해 D 섹션 제외, A·B·C·E)에 걸었고 **전부 잡혔다**: m1 yield 를 날짜파일 재읽기로(fail 12+, 같은 틱에 2회 호출·하트비트 432초 ≥ 300) · m2 해외 날짜파일을 성공(200)일 때만 기록(fail 8, 502 에서 하루 13회 폭주) · m2b 국내 날짜파일 성공 조건부(fail 4) · m3 yield 제거(fail 12+) · m5 국내를 07시에도 실행(fail 3) · m6 국내 호출에서 market 파라미터 제거(fail 9) · m7 두 시장이 날짜파일 공유(fail 10) · m8 해외 날짜파일 미기록(fail 20) · m9 해외 호출 뒤 날짜파일 재읽기(fail 15). 라우트 변이 10개(별도 복사본에서 jest)도 전부 잡혔다: 인증을 시장 해석 뒤로 · 대소문자 무시 · 빈 값을 두 시장으로 · 단일 실패 warning · 400 을 200 으로 · 잘못된 값을 두 시장으로 폴백 · market 무시 · 단일 실패에 all_failed 키 · 단일 시장 config 알림 삭제 · trackCall op 이름 변경.
- [10:41] 시험 격리 [확실] — 러너 하네스: PATH 앞 스텁(curl·date·sleep), `HOME`·`PROJECT_DIR` 는 mktemp 임시 디렉터리의 가짜 `.env`, `BASE_URL=http://stub` 이라 실제 HOME·.env·네트워크에 닿지 않는다. 시험 중·후 운영 러너(pid 2546057, 릴리스 20261028-051140)는 그대로이고 남은 프로세스·/tmp/cron-runner-* 잔여 없음. 라우트 시험: `checkCronAuth`·`sendAlertThrottled` 모킹, `globalThis.fetch` 모킹·복원, fake timers.
- [10:41] 지시 밖 수정(test-cron-runner-pmo-retry.sh) [확실] — 변경은 "뉴스 날짜파일 변수가 하나(NEWS_FETCH_LAST_RUN_FILE)에서 둘(OVERSEAS·DOMESTIC)로 나뉨"에 맞춘 구조 점검 루프의 변수 목록 갱신 3줄뿐이다. 안 고치면 존재하지 않는 변수를 찾아 fail 하므로 필요한 수정이고, 점검 대상은 8개에서 9개로 늘어 시험의 목적(다른 하루 1회 잡이 T-036 규칙 = 무조건 기록을 유지하는지)은 약화되지 않았다. 시험 본문(post-market-overseas 시나리오)은 그대로이고 pass=76.
- [10:41] 기존 시험 1건 — broker-fills cron-runner-block '기존 줄 변경 0 — HEAD 대비 추가만' [확실] — 커밋 전에는 반드시 fail 한다(처음 없는 줄에서 멈춤: 옛 헤더의 `news-fetch` 잡 설명). 구현자 주장(빠진 HEAD 줄 9줄 전부 뉴스 관련)을 직접 검증했다: HEAD 줄을 부분 수열로 대조하는 스크립트와 `diff` 둘 다 정확히 9줄이 빠졌고 전부 뉴스(헤더 설명 2줄 · `NEWS_FETCH_LAST_RUN_FILE` 선언 1줄 · 옛 06시 블록 6줄: 주석 2·`LAST_NEWS`·`if`·`call`·`echo`)이며, 그 시험이 보호하는 07시/broker-fills 구간은 한 줄도 안 건드렸다(같은 파일의 나머지 9개 테스트는 pass). 의견: Leader 가 이 fail 을 "예상된 것"으로 처리하는 것은 타당하다. 단 "커밋 후 재실행으로 확인"은 검증이 아니다 — 커밋 후에는 HEAD 가 작업 트리와 같아서 어떤 변경이든 자명하게 통과한다. 이번 변경에 대한 실질 증거는 (1) 위 9줄 직접 대조(이 기록)와 (2) 새 시험 E(뉴스 밖 실행 줄 190줄이 bf8450d 와 동일)·D(뉴스 외 호출 5073건 동일)다. QA 에게는 "이 1건 fail 은 검증 완료된 예상 실패이니 시험을 고치지 말고 커밋 후 통과만 확인"이라고 전달할 것. 이 시험은 커밋 훅·배포 파이프라인이 실행하지 않아(jest 미실행) 커밋을 막지 않는다.
- [10:41] 배포 호환성(관점 7) [확실/가능성 높음] — 옛 러너(파라미터 없는 호출) → 새 라우트: market 미지정 = 두 시장 병렬 186초, 알림 키·심각도 불변이라 분리 전과 동일하게 동작. 새 러너 → 옛 라우트: 옛 라우트는 `market` 을 무시하고 두 시장을 받는다 → 해외 호출이 두 시장을 받고 국내 호출도 두 시장을 다시 받는다(멱등 upsert, M4 부하 2배·실패 시 옛 키 알림). 실해는 없고 러너가 뉴스를 부르는 06시 밖에서는 아무 일도 안 일어난다. 15:40 이후 배포라 두 버전이 06시에 섞일 일이 없다(러너·라우트는 같은 릴리스로 함께 전환). 롤백(커밋 revert)도 같은 이유로 안전; 라우트만 되돌리고 러너를 두는 부분 롤백만 피하면 된다.
- [10:41] 날짜파일 이행(관점 8) [확실] — 옛 `news-fetch-last-date` 를 읽지 않아도 15:40 이후 배포에서는 문제없다: 새 날짜파일이 없어도 HH=06 이 아니면 뉴스 블록은 아무것도 안 하고, 다음 날 06:00 에 해외 → 06:01 국내가 정상 실행된다. 06시대에 배포가 걸리면 당일 1회 중복 수집(멱등)뿐. 옛 파일은 롤백 시 옛 러너가 그대로 쓴다.
- [10:41] 보안·안전(관점 6) [확실] — 인증 우회 경로 없음(`checkCronAuth` 가 첫 줄, 시장 해석은 그 뒤). 새 쿼리 값은 `MARKETS.find(m => m === raw)` 정확 일치 화이트리스트라 인젝션 표면 없음(M4 본문·알림에는 화이트리스트로 확정된 값만 들어가고, 400 경로는 원본 값을 로그에도 남기지 않는다). 알림 스팸: 키가 시장별이고 30분 throttle 인데 러너는 하루 1회만 부르므로 하루 최대 critical 2건(+config 1건). 심각도 critical 승격은 지시서 설계 그대로이며, 러너 경로에서는 모든 시장 실패가 이제 critical 이 되어 M4 뉴스 엔드포인트가 불안정한 날(T-031 이력)에는 알림이 늘 수 있다 — 의도된 선택이라 결함 아님. 비밀 값 로그 노출 없음(M4 응답 본문 200자 발췌는 기존 동작).
- [10:41] LOW-1 `scripts/cron-runner.sh:323-337` [확실] — 날짜파일 쓰기 실패 시 최악의 동작: 해외 날짜파일을 쓸 수 없으면 해외가 06시 내내 매 분 호출되고(시뮬레이션 06:00~06:12 13회) 국내는 매 틱 yield 라 그날 한 번도 안 돈다. 국내 날짜파일만 못 쓰면 국내가 매 분 호출된다. 이는 날짜파일을 쓰는 모든 잡이 가진 T-036 유형의 폭주이고 하트비트 쓰기도 같은 디스크라 시스템 전체 장애 상황이다. 새로 생긴 효과는 국내 굶김뿐 — 조치 불필요. 재현: 날짜파일 경로를 디렉터리로 만들어 하네스로 실행(scratchpad `mut/exp-datefile.sh`).
- [10:41] LOW-2 `scripts/test-cron-runner-news-split.sh:19,30,171-177` [확실] — 시험이 bf8450d 를 기준선으로 고정해 "다른 잡 = 변경 전" 을 비교한다. 후속 T-104(수집 잡 그룹 정리)가 다른 잡을 정당하게 바꾸면 이 시험이 설계상 fail 하고, 얕은 clone 이면 기준 러너를 못 읽어 exit 1 이다. 권고: 시험 머리말에 "T-103 범위 회귀 시험 — T-104 에서 기준선 재설정 또는 폐기"를 적고 T-104 task 에 인계(지금 코드 수정 불필요).
- [10:41] LOW-3 `src/app/api/cron/news-fetch/route.ts:58` [확실] — 중복 파라미터 `?market=overseas&market=domestic` 는 첫 값(overseas)만 쓰고 조용히 받는다(실제 NextRequest 로 확인). 크론 시크릿이 있어야 도달하고 러너는 중복을 보내지 않아 위험은 없다. 선택: `getAll('market').length > 1` 이면 400.
- [10:41] LOW-4 `scripts/test-cron-runner-pmo-retry.sh:241-243` [확실] — 구조 점검이 부분 문자열 grep 이라 `[ "$CALL_LAST_CODE" = "200" ] && echo "$TODAY" > "$VAR"`(성공 조건부 기록)도 통과한다(진짜 GNU grep 으로 변이본에 확인). T-103 이 만든 약점이 아니라 기존 한계이고, 뉴스 두 잡은 새 시험(m2·m2b 변이 모두 잡음)이 막는다. 조치 불필요.
- [10:41] QA 에 넘기는 high_risk_areas — `scripts/cron-runner.sh:318-337`(yield 판단이 호출 전 변수인지·날짜파일 두 개), `src/app/api/cron/news-fetch/route.ts:143-149`(인증→시장 해석→400 순서)·`:168-177`(단일 시장 실패 키·critical). 배포 후 확인(지시서 검증 항목 그대로): `pm2 list` 에서 `stockinvest-cron` 정확히 1행, 하트비트 갱신, 잘못된 시장 값 → 400, 다음 날 06시 로그에 두 시장 각 1회·서로 다른 틱.
- [10:41] **최종 판정: PASS (scope: src/app/api/cron/news-fetch/route.ts, src/app/api/cron/news-fetch/__tests__/route.test.ts, scripts/cron-runner.sh, scripts/test-cron-runner-pmo-retry.sh, scripts/test-cron-runner-news-split.sh)**

## QA

- [10:52] 실행 환경: 시험은 격리 워크트리 `/home/brownjeon/.node-local/stockinvest-t103` 에서 실행했다. 메인 트리·워크트리 파일은 수정하지 않았고, 운영 pm2·DB·M4·KIS·.env·cron 라우트 호출은 없다. 메인 트리 `git status --short` 에서 src/·scripts/ 변경은 지시된 5개뿐이고 나머지는 agent-vault 문서다.
- [10:52] 항목 1 (동일성) 통과 — sha256 5개가 메인·워크트리에서 전부 일치: route.ts `db310c1f…`, route.test.ts `cc04272c…`, cron-runner.sh `b0963712…`, test-cron-runner-pmo-retry.sh `b640c361…`, test-cron-runner-news-split.sh `8f8c5938…`.
- [10:52] 항목 2 (자동 시험) 통과, 예상 실패 1건 외 없음 — `npx jest src/app/api/cron src/lib/__tests__/api-usage-callsites.test.ts`: 19 스위트 중 18 통과·1 실패, 306 테스트 중 305 통과·1 실패. 실패는 broker-fills/__tests__/cron-runner-block.test.ts 의 '기존 줄 변경 0 — HEAD 대비 추가만' 1건뿐이고, 이 파일 단독 실행에서도 10개 중 9 통과·1 실패로 같았다.
- [10:52] 항목 3 통과 — `npx jest src/app/api/cron/news-fetch`: Tests 33 passed, 33 total.
- [10:52] 항목 4 통과 — `bash scripts/test-cron-runner-pmo-retry.sh`: 결과 PASS=76 FAIL=0 · `bash scripts/test-cron-runner-stop-alert.sh`: 결과 PASS=22 FAIL=0 · `bash scripts/test-cron-runner-news-split.sh`: 결과 PASS=59 FAIL=0, 종료 코드 0.
- [10:52] 항목 5 통과 — `npx tsc --noEmit -p .`: 종료 코드 0, 출력 없음.
- [10:52] 항목 6 (설계 대조, 코드 직접 확인) 통과 — (a) route.ts:139 `checkCronAuth` 가 :144 `resolveTargetMarkets` 보다 앞이다. (b) :146-147 에서 허용 밖 값은 `400 invalid_market` 으로 return 하고, M4 `fetch` 는 :97 `fetchMarketWithRetry` 안에만 있어 이 경로에 도달하지 않는다. (c) `trackCall('m4', 'news.fetch', …)` 호출 지점은 route.ts:97 이고, `git show HEAD` 의 72행과 op 문자열이 같다. (d) cron-runner.sh 에서 해외 블록이 국내 블록보다 앞이고, 국내 블록은 틱 시작에 읽은 `LAST_NEWS_OVS` 로 yield 를 판단한다. (e) `git diff scripts/cron-runner.sh` 로 확인한 변경 범위는 헤더 주석, `NEWS_FETCH_*` 선언, 06시 블록뿐이다.
- [10:52] 항목 7 (비밀·위생) 실패 — 경미, Leader 판단 필요. 실제 토큰·키·운영 URL은 찾지 못했다. 다만 `scripts/test-cron-runner-news-split.sh:654` 의 `printf 'CRON_SECRET=test-secret\n' > "$R/proj/.env"` 는 임시 디렉터리에 쓰는 시험용 더미 값 리터럴이라 체크리스트의 "값 리터럴 금지"에 걸린다. 실비밀은 아니다. 처리 방법은 Leader 가 정한다(값을 변수로 바꾸거나 허용 판단). 파일을 바꾸면 sha256 과 Reviewer scope 를 다시 확인해야 한다. 참고로 `git diff` 의 docs·agent-vault 변경에 있는 URL 2건은 공개 보도자료 링크이고 운영 URL이 아니다. 신규 스크립트는 `mktemp` 임시 HOME·PROJECT_DIR·`BASE_URL=http://stub` 을 쓰고(:88) 실제 HOME 을 건드리지 않았다. 시험 전후 `~/.node-local/stockinvest/` 를 비교했다: news-fetch-last-date 수정 시각은 10-28 06:00:19 그대로, news-fetch-overseas·news-fetch-domestic 날짜 파일은 없고 시험으로 생기지 않았다. cron-heartbeat 는 운영 러너가 계속 갱신해 10:44:58 → 10:49:53 으로 바뀌었고, 시험과는 무관하다.
- [10:52] 항목 8 (사후 배포 점검표, 실행하지 않음 — 문서화만): (1) `pm2 list` 에서 stockinvest-cron 이 정확히 1행인지 확인. (2) `~/.node-local/stockinvest/cron-heartbeat` 수정 시각이 분 단위로 갱신되는지 확인. (3) 인증 헤더를 붙인 잘못된 시장 값 호출이 400 `invalid_market` 을 주는지 확인. (4) 다음 날 06시 로그에 `news-fetch-overseas`(06:00) 1회, `news-fetch-domestic`(06:01 또는 yield 뒤 다음 틱) 1회가 서로 다른 틱에 찍히는지 확인하고, 날짜 파일 `news-fetch-overseas-last-date`·`news-fetch-domestic-last-date` 2개가 생겼는지 확인. (5) 옛 `news-fetch-last-date` 는 더 갱신되지 않는지 확인.
- [10:52] QA 결과: FAIL — 통과 6/8 항목(1·2·3·4·5·6), 항목 7 실패(경미, 시험 더미 값 1건), 항목 8 문서화만. 예상 실패 1건 포함 여부: 포함(broker-fills '기존 줄 변경 0' 1건은 예상 실패로 분류했고, 판정 사유는 항목 7 이다).

- [10:5x][Leader] **QA 항목 7 재판정 — 결함 아님(QA FAIL 기록은 그대로 두고 Leader 결정을 덧붙인다)**. 사유: QA 가 지적한 `scripts/test-cron-runner-news-split.sh:44` 의 `printf 'CRON_SECRET=test-secret\n' > "$R/proj/.env"` 는 `mktemp -d` 임시 디렉터리 안에 만드는 시험용 고정값이고 실제 비밀이 아니다. 이미 커밋된 `test-cron-runner-pmo-retry.sh:113`·`test-cron-runner-stop-alert.sh:33` 에 **글자까지 같은 줄**이 있다(HEAD 에서 직접 확인). 체크리스트의 "값 리터럴 금지"는 Leader 가 실제 값 유출을 막으려고 쓴 문구가 지나치게 넓었던 것으로, 시험 고정값까지 겨냥한 것이 아니다. 시험 파일을 바꾸면 sha256 과 Reviewer scope 재확인이 필요하고 관례에서 벗어나므로 **수정하지 않는다**. 나머지 항목 1~6·8 은 QA 직접 실행으로 통과(항목 2 의 예상 실패 1건 제외). → 실질 판정: QA 통과로 처리, 위반 아님. QA 에이전트 재호출은 하지 않는다(새로운 사실이 아니라 체크리스트 해석 정정).

- [10:54] 항목 7 재판정 — 통과: `scripts/test-cron-runner-news-split.sh:44` 의 `printf 'CRON_SECRET=test-secret\n' > "$R/proj/.env"` 는 `mktemp -d` 임시 디렉터리($W 아래 $R/proj)에만 쓰고, 시험 88행에서 HOME="$R/home"·PROJECT_DIR="$R/proj"·BASE_URL=http://stub 로 지정해 실제 HOME·PROJECT_DIR 로 새지 않는다(trap 으로 $W 삭제). 같은 고정 더미 줄이 `git show bf8450d` 와 HEAD 의 `test-cron-runner-pmo-retry.sh:113`·`test-cron-runner-stop-alert.sh:33` 에 이미 있다. 따라서 체크리스트의 "값 리터럴 금지"는 실비밀 유출 방지 취지로 읽고, 시험용 고정 더미는 위반으로 보지 않는다. 실제 토큰·키·운영 URL 은 없다.
- [10:54] QA 결과(재판정 반영): PASS — 통과 7/8 (항목 1~7 통과, 항목 2 의 예상 실패 1건은 판정 사유 아님. 항목 8 은 문서화만이라 실행 검증 대상이 아니다.)

## 배포 기록

- **2026-10-28 11:21 KST push `5ac9119..414cc3b`(3커밋) → 웹훅 blue/green → `RELEASE_RESULT ok`, 릴리스 `20261028-112124-414cc3b4`, `migrated=false`.** 사용자 지시 "푸시해주고 …" 에 따라 **예정(15:47)보다 앞당겨 11:21 에 실행** — 배포 창 문서(`docs/deploy-order.md` T-056 절)의 "양시장 폐장 + 킬스위치 OFF" 구간 밖이다(국내장 개장 중). 이유와 안전 확인: 사용자가 push 를 직접 지시했고, **킬스위치 ON(`safety_kill_switch=true`)·최근 24시간 주문 0건(orders 최대 id 3229 불변)·청산 엔진 OFF·원격에 남의 커밋 0** 을 push 직전에 읽기 전용으로 확인해 주문이 나갈 수 없는 상태였다. 15:47 예약 크론(652d7dae)은 삭제.
  - 같은 배포에 함께 실린 작업: **T-103**(코드 `8b1e712`), 문서 커밋 `414cc3b`([[T-061-adp006-c01-analyst-policy-trial]] ADP-006 2단계 노트·팩·절차서), `bf8450d`([[T-101-settings-post-market-overseas-switch]]·[[T-102-usd-cash-unsettled-buy]] 문서). 문서 커밋은 코드 없음.
- 배포 직후 검증(직접 실행): pm2 `stockinvest`·`stockinvest-cron` 둘 다 online·재시작 0·`pm_cwd` 가 새 릴리스 / cron 프로세스 정확히 1행·실제 러너 프로세스 1개(새 릴리스 경로, `ps` 의 두 번째 줄은 점검 명령 자신) / 하트비트 71초 전(한도 300초) / `/api/health` 200 / 인증 없이 `POST /api/cron/news-fetch?market=bad` → **401**(인증이 시장 값 검사보다 먼저임을 운영에서 확인) / `[cron-runner] started` 가 11:21:53·11:21:56 두 줄(pm2 재등록 과정의 기동 흔적으로 보이며 실제 러너는 1개) / 기동 직전 첫 틱의 `HTTP=000`(strategy-eval 등)은 앱이 아직 뜨기 전의 일시 현상. 킬스위치 ON·주문 0 유지.
- 못 한 것: **실제 06시 동작(해외 06:00 → 국내 다음 틱, 각 1회, 날짜 파일 2개)은 내일 아침에야 볼 수 있다** — 10-29 06:10 에 로그로 확인하도록 예약(아래 진행 기록). 운영 `?market=domestic|overseas` 호출 자체는 M4 에 쓰기를 하므로 하지 않았다.
- 롤백: `git revert 8b1e712` 후 push. 라우트만 되돌리고 러너를 두는 부분 롤백은 피한다(새 러너가 옛 라우트를 부르면 두 호출이 각각 두 시장을 받아 M4 부하만 2배).
- [2026-10-29 06:13] **첫 실제 06시 동작 검증(읽기 전용, 예약 점검)**: ① cron 로그 `06:00:31 news-fetch-overseas OK` → 같은 틱 `news-fetch-domestic yield_tick`(정확히 1줄) → `06:01:38 news-fetch-domestic OK` — 각 1회, 같은 틱에 두 호출 없음 ② 앱 로그 `overseas OK upserted=78 attempt=1 fresh=77` · `domestic OK upserted=100 attempt=1 fresh=100`(T-115 건수 100 이 국내에서 처음 실제로 100건) ③ 날짜파일 `news-fetch-overseas-last-date`·`news-fetch-domestic-last-date` = 2026-10-29, 옛 `news-fetch-last-date` = 2026-10-28 그대로 ④ `cron-watchdog` critical 없음(시작 줄만: 22:57 배포·04:44 재부팅) ⑤ M4 502 없음 → 시장별 critical 알림 문구는 이 날 검증할 기회가 없었다(실패일이 아님). 참고: 10-28 23:49~10-29 04:43 서버 정지는 이 06시 수집과 무관(04:43 재부팅 후 정상 기동). T-106 `news_zero_streak:fetch:*` 는 양 시장 streak 0.

## Codex 검토

### [2026-10-28 10:43] C2 review focus=none — done
- judge 판정: judge codex_gate C2 (risk R2, codex_required true, budget_rule CX-limit-unknown-r2) / 호출 차수: 1/4
- 대상: repo=/home/brownjeon/NFS/homes/brownjeon/project/StockInvest base=bf8450d(task_file) snapshot=7fe4f5a
- 지적 0건
- 검토하지 못한 범위: T-103 허용 파일 밖의 agent-vault T-061 및 ADP-006 자료, handoff 문서, 로그, navigation design 문서의 내용 정확성
- 원본: /home/brownjeon/NFS/homes/brownjeon/project/.claude/state/codex-review/runs/20261028T014356Z-T-103-C2/raw.txt

## 최종 요약

### [T-103] 뉴스 수집 크론을 국내·해외 두 개의 독립 잡으로 분리 (파라미터 방식)

- **상태**: ✅ 완료(배포·운영 기본 검증) · 실제 06시 동작은 내일 확인(AI 가 10-29 06:13 예약 검증)
- **무엇이 바뀌었나**: 뉴스 수집이 `?market=overseas`·`?market=domestic` 두 호출로 나뉘었다. 해외가 06시 첫 틱, 국내가 다음 틱에 돌고 날짜 파일(`news-fetch-overseas-last-date`·`news-fetch-domestic-last-date`)과 실패 알림이 시장별로 따로다. 실행 시각(06시)·건수(20)·재시도(3회)·60초 상한은 그대로. 시장을 안 붙인 호출은 예전처럼 두 시장을 받아 옛 러너·수동 호출도 동작한다.
- **배포**: ✅ 운영 반영 — 커밋 `8b1e712` · 2026-10-28 11:21 KST · push(webhook blue/green) · `RELEASE_RESULT ok`(릴리스 `20261028-112124-414cc3b4`)
  - 같은 배포에 함께 실린 작업: T-061 문서 `414cc3b`(ADP-006 2단계), T-101·T-102 문서 `bf8450d` (코드 없음)
  - 시각 예외: 배포 창(양시장 폐장) 밖인 11:21 에 실행 — 사용자가 push 를 직접 지시, 킬스위치 ON·24시간 주문 0 확인 후 실행
- **AI 가 검증한 것**: Reviewer 독립 감사 PASS(변이 시험 러너 9·라우트 10 모두 검출) · Codex C2 지적 0 · QA 직접 실행 PASS(항목 7 은 시험용 더미 값 1줄을 처음 FAIL 로 기록했다가 재판정으로 PASS) · 커밋된 상태에서 cron 시험 306/306 · 배포 후 pm2/cron 1행/하트비트/health 200/`?market=bad` 인증 없이 401 직접 확인
  - 검증 못 한 것: 실제 06시 동작(내일 아침), 운영에서 `?market=…` 정상 호출(M4 쓰기라 하지 않음)
- **👉 사용자가 확인할 것**: 없음. 알아 둘 것 — 시장 하나가 실패하면 이제 `partial_failed`(warning)가 아니라 시장별 critical 알림이 간다.
- **👉 사용자가 결정할 것**: 없음(후속 T-104 크론 정리는 다음 단계로 별도 접수 예정).
- **남은 일**: T-104 크론 잡 정리(해외/국내 그룹 관리). broker-fills '기존 줄 변경 0' 시험의 비교 기준을 고정하는 개선(후속 후보). 새 시험이 기준선을 `bf8450d` 로 고정했으므로 T-104 가 다른 잡을 바꾸면 기준선을 재설정하거나 폐기한다(Reviewer LOW-2).
- **이슈·위험**: 해외가 06:59 틱에 처음 도는 날에는 국내 뉴스를 그날 건너뜀(주석 명시). 롤백 `git revert 8b1e712` 후 push(라우트만 되돌리는 부분 롤백 금지). **뉴스 RAG 가 분석에 0건인 문제는 이 task 와 별개**(→ [[T-105-news-rag-zero-hits]]).

## 데모 검토 (demo gate)

> 실행 판정 정본은 frontmatter `demo_gate` 이다. 이 표는 check.mjs 가 함께 기록하는 사람용 이력이다(docs/demo-review-gate.md).

| 버전 | 상태 | 저장소 파일 | Artifact | 사용자 결정 | 일시 |
|---|---|---|---|---|---|
| - | 해당없음 | - | - | judge: none | 10-28 10:09 |
