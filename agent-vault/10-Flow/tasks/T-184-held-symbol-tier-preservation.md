---
task_id: T-184
title: 코어 비율 가드의 보유 종목 등급 보존 — 등급 저장을 전략 점수 선별과 분리하고 가드가 최신성 한도 안의 값만 쓰게
status: review
waiting: [post_deploy_observation]
priority: medium
project: StockInvest
created: 2026-11-20
updated: 2026-11-21
base_ref: 774bef64ac8f4674cb117a3682da320b1e5cf9fb
risk_level: R2
roles_involved: [leader, judge, developer, reviewer, qa]
related_tasks: [T-181-domestic-market-cap-ranking-params]
tags:
  - type/task
  - domain/strategy
aliases:
  - 보유 종목 등급 보존
  - lookupTier 최신성
execution_context:
  schema_version: 1
  origin_tool: claude
  current_tool: claude
  current_procedure: claude_standard
  current_scope: 설계·구현·감사·QA·서버 worktree 커밋·PR 생성까지. 머지(=운영 배포)는 사용자 승인 후
  last_event_id: E2
---

# T-184 코어 비율 가드의 보유 종목 등급 보존

작업 worktree: 서버 `~/.node-local/stockinvest-t184` (detached, base `774bef6` = origin/main = 운영 릴리스 `20261120-231945-774bef64`, 0.20.0). `node_modules` 는 공유 트리 `node_modules` 링크(스테이징하지 않는다). 커밋은 이 worktree 에서 한다(`src/lib/strategy/` 는 `SAFETY_PATHS`).

⚠ 같은 시각 다른 세션이 `~/.node-local/stockinvest-t183`(T-183 매크로 국면 관문, `engine.ts` 1508행 부근·`macro.ts`·`exchanges/*`)에서 작업 중이다. 이 task 의 `engine.ts` 변경은 1231행 문구 한 줄이라 겹치지 않지만, 둘 다 버전을 올리면 `package.json` 이 충돌한다 — 나중에 머지되는 쪽이 리베이스하며 버전을 다시 올린다.

## 목표·배경 (Leader)

근거: [[T-181-domestic-market-cap-ranking-params]] 의 Analyst §6(엣지 케이스 5)·Reviewer 23:12 판정·Codex C2 지적. 그 task 의 「남은 일」 1번을 별도 task 로 올린 것이다(T-181 세션의 지시로 시작).

- [확실 — 코드] T-181 부터 국내 등급은 universe 갱신 때 시세의 지수 편입 표시로 매기지만(`tierFromIndexTag`), 저장(`symbol_universe`)은 전략 점수 선별(30·40·30)을 통과한 종목에만 일어난다. 코어 비율 가드의 `lookupTier` 는 행의 나이를 보지 않고 `ORDER BY refreshed_at DESC LIMIT 1` 로 읽고, 행은 48시간 뒤 지워진다.
- 결과 두 방향(같은 뿌리): ① 보유 종목이 강등되며 선별에서 빠지면 과거 core 행이 최대 48시간 남아 가드가 낡은 core 로 통과한다 ② 선별에서 빠진 채 48시간이 지나면 unknown 이 되어 국내 매수가 전면 차단된다.
- [확실 — 운영 DB 읽기 전용, 2026-11-20 23:28] 국내 `symbol_universe` 최신 갱신은 11-20 15:28:37(배포 전)이라 아직 전부 speculative 41종목이다. 005930 은 120행(전부 speculative). `system_config` 에 `domestic_index_tier` 키 없음(충돌 없음).
- 위험 크기: 현 국내 실보유는 삼성전자 1종목이고 KOSPI200 에서 빠질 가능성이 낮아 실현 가능성은 낮다. 이 가드는 집중도 선호 가드이고 그 뒤에 검증 관문(전략 전부 미검증)·DRY_RUN·KILL_SWITCH(현재 발동 중)가 그대로다.

## 사용자 지시·승인 (원문 보존)

- T-181 세션(상위 세션)의 지시: 「새 task … 로 「코어 비율 가드의 보유 종목 등급 보존」을 설계·구현한다 … 완료 기준: 시험(보유 종목 탈락 시 등급 유지 / 강등+탈락 연속에서 낡은 core 로 통과하지 않음 / 한도 초과 시 unknown) 통과, 전체 jest 새 실패 0, tsc·next build 통과, Reviewer PASS·QA pass, PR 생성 후 사용자 머지 승인 대기」. DDL 이 필요하면 사용자 승인 사항 — 이 설계는 DDL 이 없다.
- 2026-11-21 10:14 KST 사용자(이 세션 대화 직접 입력) 원문: 「머지 승인」 — PR #9 를 검토한 head `cee7d8b` 기준으로 머지(=운영 배포)하는 승인. 토요일 오전이라 국내 장 영향 없음.

## 설계 (Leader)

Reviewer(T-181 23:12) 권고안 ①+② 결합. `lookupTier` 만 최신 행으로 바꾸는 단독 수정은 ② 를 키우므로 하지 않는다.

1. **등급 보존소 — `src/lib/strategy/index-tier-store.ts`(신규)**: `system_config` 한 행(키 `domestic_index_tier`, JSON 값 `{ v:1, symbols: { <종목>: { tier, at(ISO) } } }`). **DDL 없음** — `system_config` 는 이미 기계가 쓰는 상태값(토큰·알림 상태 등)을 담는 선례가 있고 `value` 가 JSON 열이다. `symbol_universe` 에 전략과 무관한 행을 섞지 않는 이유: `getUniverseSymbols`·`ai-filter`·`rs-rating` 이 profile·rank_pos 로 읽어 후보가 오염된다.
   - 병합: 이번 갱신에서 시세를 받은 종목은 지금 시각으로 덮고, 못 받은 종목은 이전 관측(그 시각 그대로)을 남긴다. 마지막 관측이 48시간을 넘은 종목은 저장할 때 지운다(크기 상한 — 지금 42종목, 약 3KB).
   - 읽기 검증: 등급 값 3개 외·시각 손상·빈/32자 초과 심볼은 버린다(버린 종목은 unknown). MariaDB JSON 이 문자열로 와도 읽는다.
2. **갱신 — `universe.ts` 국내 분기**: 시세를 받은 직후(분석·선별 전) `tierMap` 전체를 보존소에 병합 저장. 실패는 경고 한 줄(`[universe:domestic] 등급 보존 저장 실패 — …`, 줄바꿈 제거·200자)만 남기고 갱신을 계속한다. 시세 0건·해외는 건드리지 않는다. 분석이 전부 실패해 `refreshed:false` 여도 등급은 저장된다.
3. **가드 — `portfolio-stability.ts`**: `lookupTier`(symbol_universe 읽기) 삭제. 검사 1회에 보존소를 한 번 읽고 같은 시각 기준으로 보유·매수 종목 등급을 정한다(`resolveHeldTier`). 없음·**관측 후 24시간 초과**·5분 넘는 미래 시각 → `unknown`(코어로 세지 않음 — 차단 방향). 경계(정확히 24h)는 유효. DB 오류는 종전처럼 던진다.
   - 24시간 근거: 국내 strategy-eval 은 장중에만 돌고 매 회차 가드 전에 갱신(TTL 15분)을 먼저 하므로, 장중 정상이면 관측 나이는 20분 안팎이다. 월요일 첫 회차도 가드 전에 갱신한다. 24시간을 넘는 것은 갱신(시세)이 하루 넘게 실패한 경우뿐이고 그때는 차단이 맞다.
4. **문구**: 「코어(KOSPI 100) 비율 미달」→「코어(KOSPI200 편입) 비율 미달」(`engine.ts` 사용자 문구·`skip-reason-formatter.ts` 설명·`ai-filter.ts` 프롬프트 두 줄·`portfolio-stability.ts` 주석). 판정 로직 변화 없음.
5. **정적 목록**: 상장폐지 코드 `042670`(T-181 실측: 가격·시총·상장주수 0, `symbol_universe` 저장 이력 0)·`091990`(2023-12 셀트리온에 합병) 삭제 → 42종목. DB `universe_always_include` 값에는 두 코드가 없다(읽기 전용 확인).
6. **버전**: 0.20.0 → 0.21.0(마이너).

알려진 한계(범위 밖, 후속 후보): 정적 목록 밖의 국내 보유 종목(예: 347700)은 시세를 받지 않아 여전히 unknown 이다(종전과 같음 — 보유 종목을 시세 대상에 넣는 것은 별도 설계). 배포 직후 첫 갱신 전(최대 15분, 장중일 때)에는 보존소가 비어 국내 매수 후보가 차단 쪽으로 판정된다.

## Judge

- [2026-11-20 23:30] intake engine=jev(Leader 가 판정 도구를 직접 실행 — `node ../.claude/tools/jev-judge/judge.mjs --input /tmp/judge-T-184-intake.json`) → task_type=feature · complexity=2.16 · risk=R2 · developer_model=opus · next=ask_user(blocking=requirements) · demo=delta(DM-low-confidence, DM-kw-delta). 원문 `/tmp/judge-T-184-intake.out.json`(서버).
- Leader 처리: requirements 는 상위 세션 지시의 완료 기준으로 확정돼 있어 추가 질문 없이 진행(사용자 판단 사항은 아래 최종 요약 「결정할 것」에 모은다). 데모 delta: 화면 구조 변경이 없고 분석 화면의 차단 사유 문구 한 줄(「KOSPI 100」→「KOSPI200 편입」)뿐이라 데모를 만들지 않았다 — `demo_gate` 는 기록하지 않았고 사용자에게 보고한다.

## Analyst

- 별도 소환하지 않았다. 근거 분석은 [[T-181-domestic-market-cap-ranking-params]] Analyst §6·Reviewer 23:12 판정을 그대로 쓰고, 최신성 한도·저장 위치 판단은 위 설계에 Leader 가 적었다(실행 도구 claude, 메인 세션).

## Developer

- [23:32] 실행 도구 claude(메인 세션이 Leader 겸 Developer, Opus). 편집은 scratch 미러 → tar over ssh. KIS 호출·DB 쓰기·pm2·cron·커밋 0건(DB 는 `dbq.py` 읽기 전용 조회만).
- 변경 파일: `src/lib/strategy/index-tier-store.ts`(신규) · `universe.ts` · `portfolio-stability.ts` · `engine.ts`(문구 1줄) · `ai-filter.ts`(프롬프트 문구 2줄) · `skip-reason-formatter.ts`(설명 1줄) · 시험 `__tests__/index-tier-store-t184.test.ts`(신규) · `__tests__/portfolio-stability.test.ts` · `__tests__/universe-index-tier-t181.test.ts` · `package.json`·`package-lock.json`(0.21.0).
- 바꾼 기존 단언과 이유: ① `portfolio-stability.test.ts` 모의 DB — 등급을 `symbol_universe WHERE symbol = ?` 대신 `system_config` 보존소(관측 시각 = 지금)로 돌려준다. 단언은 하나도 바꾸지 않았다. ② `universe-index-tier-t181.test.ts` — `ALL_SYMBOLS` 길이 44 → 42(죽은 코드 2개 삭제), 두 코드가 없다는 단언 추가.
- 새 시험(`index-tier-store-t184.test.ts`): 파싱(손상 항목 버림·문자열/객체·왕복) · 병합(덮기·이전 시각 유지·48h 정리·입력 불변) · 최신성(없음·정확히 24h·24h+1ms·미래 5분 경계) · 갱신 통합(분석 실패 종목도 저장·`refreshed:false` 여도 저장·시세 0건/해외는 미접촉·저장 실패 시 경고 1줄로 계속) · 완료 기준 (가) 선별 탈락해도 통과 (나) core 저장 뒤 강등+탈락 → skip(그때 `symbol_universe` 에는 과거 core 행만 남아 있음을 함께 단언) (다) 24h 경계 통과·초과 unknown, 시세 일시 실패 종목 유지·만료 · 보존소 빈 상태 unknown · 무보유 부트스트랩 유지. 가드가 `symbol_universe` 를 읽으면 모의 DB 가 예외를 던진다.
- 실행 증빙: 관련 jest 4 suites/67 tests 통과(`~/.node-local/t184-logs/jest-related-1.log`) · `tsc --noEmit` rc 0, 출력 0줄(`tsc.log`). 전체 jest 기준 대비·`next build` 는 아래에 덧붙인다.

- [23:39] 전체 jest(1차 변경본): base `774bef6`(임시 worktree `stockinvest-t184base`, 실행 뒤 `git worktree remove` 확인)와 변경본을 같은 방법(`--json`, flock 직렬)으로 돌려 실패 이름 대조 — base 실패 427건(28 suites) / 변경본 427건(28 suites), **새 실패 0 · 사라진 실패 0**, 통과 12,482 → 12,510(+28), 총 13,199 → 13,227(`jest-base.json`·`jest-new.json`). base 실패 28 suites 는 화면 렌더 시험(t108·t156·t162·t178·settings·components 등)과 fence·isolation·job-slots 로 전부 이번 변경 밖이다. `next build` rc 0(`build.log`).
- [23:46] Codex C2 지적 2건 대응 수정(Reviewer 재판정 전, Leader 겸 Developer) — 아래 Codex 검토 절의 high·medium 을 고쳤다:
  - high(겹친 갱신의 읽기-병합-쓰기 경합으로 강등이 core 로 되돌려짐): ① 관측 시각을 **시세 요청 전 시각**으로 받아(`universe.ts` `tierObservedAtMs`) ② 병합은 종목마다 **관측 시각이 늦은 쪽**만 남기고(`mergeIndexTierObservations`) ③ 쓰기를 문서 `rev` 비교 조건부 갱신(CAS — 행 없으면 `INSERT IGNORE`, 있으면 `UPDATE … AND COALESCE(JSON_VALUE(value,'$.rev'),'0') = ?`)으로 바꿔 충돌 시 다시 읽어 병합(최대 3회, 계속 충돌하면 던짐 → 호출부 경고). 운영 MariaDB 10.11.11 에서 `JSON_VALUE` 동작 읽기 전용 확인.
  - medium(저장 실패 시 확인된 강등이 가드에 반영 안 됨): 같은 프로세스의 마지막 관측을 메모리에도 두고(`processSnapshot`), 가드는 DB 값과 종목마다 관측 시각이 늦은 쪽으로 합쳐 쓴다(`combineIndexTierSnapshots`). pm2 `stockinvest` 는 instances 1 이라 갱신과 가드가 같은 프로세스다(`ecosystem.config.js` 확인). 재시작 뒤에는 DB 값만 남고 24시간 한도가 상한이다. 경고 문구를 그에 맞게 바꿨다.
  - 시험 추가: 늦은 관측 우선 병합·`combineIndexTierSnapshots`·`parseIndexTierRev`·겹친 갱신(나중 시세 먼저 저장)·CAS 충돌 재시도(다른 갱신 관측 보존, rev 3)·3회 충돌 시 던짐·DB 쓰기 실패 뒤 같은 프로세스 가드 skip → 재시작 뒤 DB core 통과 → 24h 초과 skip. 기존 `universe-ranking-fallback-t176.test.ts`·`universe-index-tier-t181.test.ts` 모의 DB 에 system_config 응답 한 줄을 더했다(CAS 가 `affectedRows` 를 보므로 — 없으면 저장 실패 경고가 떠 「경고 없음」 단언이 깨졌다. 단언은 바꾸지 않음).
  - 실행: 관련 6 suites/86 tests 통과(`jest-related-3.log` — strategy-eval-lane·engine-universe-refresh-isolation 포함) · `tsc --noEmit` rc 0, 0줄(`tsc-2.log`). 전체 jest 재대조·`next build` 재실행은 백그라운드 진행 중(`jest-new2.json`·`build2.log`).

- [23:49] 수정본 전체 jest 재대조: base 427 실패(28 suites) / 수정본 427(28 suites), **새 실패 0 · 사라진 실패 0**, 통과 12,482 → 12,517(+35), 총 13,199 → 13,234(`jest-new2.json`). `next build` rc 0(`build2.log`). 로그 위치 서버 `~/.node-local/t184-logs/`.

## Reviewer
- [23:36] 실행 도구 claude(Reviewer 서브에이전트). 서버 worktree diff(base 774bef6)와 신규 파일 2개를 직접 읽고, 3개 시험 파일을 `flock` 직렬로 재실행했다(3 suites/62 tests 통과). 코드 수정·커밋·KIS 호출·DB 쓰기·pm2·cron 0건, DB 는 `dbq.py` 읽기 전용(`SHOW CREATE TABLE system_config`·키 충돌 조회)만.
- [23:36] 의도 대조: 완료 기준 (가) 선별 탈락 시 유지 (나) 강등+탈락에서 낡은 core 로 통과 안 함 (다) 24h 초과 unknown 을 시험이 실제로 잡는다. (나)는 `symbol_universe` 에 과거 core 행이 남아 있음을 함께 단언하고 가드가 그 테이블을 읽으면 모의 DB 가 예외를 던지게 해 되돌림 회귀를 막는다 [확실]. 기존 `portfolio-stability.test.ts` 단언은 하나도 약화되지 않았고 모의 DB 의 등급 공급처만 보존소로 바뀌었다(미등록 종목 = unknown 도 유지) [확실].
- [23:36] ① 가드 완화 경로: 새로 생긴 완화 경로 없음. 없음·손상·24h 초과·5분 넘는 미래 시각은 모두 unknown(차단), 등급 값은 3개 리터럴만 인정, `at` 은 문자열만 인정 [확실]. 이전(행 나이 무시·48h)보다 엄격하다. 잔존 완화(LOW-1): 병합이 시세를 못 받은 종목의 이전 관측을 그 시각 그대로 남기므로, 시세 일시 실패+그 사이 강등이 겹치면 최대 24h 동안 낡은 core 로 통과할 수 있다 — 설계에 명시돼 있고 시험 (다-2)가 고정한다, 종전 48h 무검사보다 좁아 수용 가능 [확실].
- [23:36] ② `system_config` 저장소: `domestic_index_tier` 키는 코드·DB 어디에도 충돌 없음(조회 확인), 컬럼은 longtext+json_valid·PK=key 라 DDL 불필요하고 직렬화 결과도 유효 JSON [확실]. 설정 화면·다른 코드는 키 이름 고정/`LIKE safety_%` 등 접두어 조회뿐이라 이 행을 읽거나 지우지 않는다(`RETIRED_KEYS` 삭제 목록에도 없음) [확실]. 크기는 정적 42종목 × 약 70B ≈ 3KB, 48h 정리로 상한 있음(기존 최대 값 11KB 수준) [확실]. 경합(LOW-2): `saveIndexTierObservations` 는 읽기-병합-쓰기가 비원자적이라 strategy-eval 이 겹쳐 돌면 더 최근 관측이 이전 값으로 덮일 수 있다 — 두 갱신이 같은 전 종목을 쓰고 최신성 한도 24h 가 상한이라 실해는 작다 [가능성 높음]. 권고(필수 아님): 문서에 한계 명시 또는 후속에서 `GET_LOCK`/조건부 갱신.
- [23:36] ③ 실패 동작: 저장 실패는 `universe.ts` 에서 잡혀 경고 1줄(줄바꿈 제거·200자)만 남기고 갱신·회차를 계속한다(시험이 고정) [확실]. 가드 쪽 보존소 읽기 DB 오류는 던져진다 — 종전 `lookupTier` 와 동일하며 호출 `applyPortfolioGuard` 에 try/catch 가 없어 그 종목 평가가 실패 처리(매수 신호 미생성, 차단 방향)다 [확실]. 보존소가 비었거나 손상되면 빈 스냅샷=unknown=차단. 배포 직후 첫 갱신 전(최대 15분)은 차단 쪽이며 task 에 한계로 적혀 있다.
- [23:36] ⑤ 주문·DRY_RUN·KILL_SWITCH·한도·블랙리스트·검증 관문 경로 미접촉: 변경 파일 9개 중 이 경로 파일은 0개, `engine.ts` 는 문구 1줄뿐 [확실]. `submitOrder`·`safety/` 호출 추가 없음, 신규 모듈은 거래소를 부르지 않는다 [확실]. 가드의 `calcCoreRatio`·임계 로직은 변경 없음.
- [23:36] ⑥ 문구·죽은 코드: `042670`·`091990` 은 `src`·`scripts`·`docs` 어디에서도 다른 참조가 없고(grep) `ALL_SYMBOLS` 길이 단언은 한 곳뿐이라 부작용 없음 [확실]. 판정 로직이 아닌 문구만 바뀐 `ai-filter.ts` 프롬프트 2줄은 LLM 입력이 바뀌므로 응답 캐시 키가 프롬프트 해시라면 1회 무효화될 수 있다(미확인, 영향 미미). `universe.ts:318` 의 `kospi100` 주석은 이미 정정돼 있고 잔여 「KOSPI 100」 표기는 없다.
- [23:36] LOW-3: `parseIndexTierSnapshot` 의 `Date.parse` 는 관대해 임의 문자열이 과거 시각으로 해석될 수 있으나 그 경우 24h 초과로 unknown 이 되어 차단 방향이라 무해. INFO: 커밋은 서버 worktree 에서만(`SAFETY_PATHS` 훅이 Mac 에서는 돌지 않음). `package.json` 0.21.0 은 T-183 과 충돌 가능(Leader 기록대로 나중 머지가 재상승).
- [23:36] 미확인 범위: 전체 jest 기준 대비·`next build`·`tsc`(Leader 백그라운드 실행 중, 이 감사에서 미실행), 실제 MariaDB 에 대한 쓰기/읽기 왕복(모의 DB 로만 확인 — longtext 문자열 반환·`ON DUPLICATE KEY` 문법은 정적으로만 확인), 두 갱신 동시 실행 재현, 프롬프트 캐시 키. Critical 0 · High 0 · Medium 0 · Low 3.
- [23:36] **최종 판정: PASS (scope: src/lib/strategy/index-tier-store.ts, src/lib/strategy/universe.ts, src/lib/strategy/portfolio-stability.ts, src/lib/strategy/engine.ts, src/lib/strategy/ai-filter.ts, src/lib/strategy/skip-reason-formatter.ts, src/lib/strategy/__tests__/index-tier-store-t184.test.ts, src/lib/strategy/__tests__/portfolio-stability.test.ts, src/lib/strategy/__tests__/universe-index-tier-t181.test.ts)**
- [23:50] 재감사(Codex C2 반영분). 실행 도구 claude(Reviewer). `index-tier-store.ts` 전체·`universe.ts`·`portfolio-stability.ts` diff·t176 시험 diff·새 시험 목록을 직접 읽었고, 4개 시험 파일을 `flock` 직렬로 재실행해 4 suites/74 tests 통과를 확인했다. 코드 수정·커밋·DB 쓰기·KIS·pm2·cron 0건, DB 는 읽기 전용 `SELECT JSON_VALUE(...)`·`VERSION()` 만.
- [23:50] Codex high(겹친 갱신 읽기-병합-쓰기 경합으로 강등이 core 로 복원): **채택**. 이전 코드는 읽기-병합-쓰기 사이에 잠금·비교가 없어 A 가 읽은 뒤 B 가 강등을 저장하고 A 가 덮으면 core 가 복원되고 24h 안이라 가드를 통과한다 — 내 23:36 LOW-2 와 같은 결함이며 영향은 「최대 24h 낡은 core 통과」로, 실제 겹침 빈도는 낮지만 가드를 완화하는 경로이므로 심각도 high 판단에 이의 없음 [확실]. 수정(요청 전 시각 관측·종목별 늦은 관측 우선·`rev` CAS 3회)이 원인을 막는다: 병합이 교환·결합 법칙을 만족하고(늦은 관측이 이김) 쓰기는 읽은 rev 와 같을 때만 갱신 [확실].
- [23:50] Codex medium(DB 쓰기만 실패하면 확인한 강등이 가드에 반영 안 됨): **채택**. 이전 시험은 빈 보존소에서 시작해 이 경로를 놓쳤다 [확실]. 수정은 메모리 관측(`processSnapshot`)을 DB 쓰기 전에 갱신하고 가드가 DB ⊕ 메모리를 종목별 늦은 관측으로 합친다. `universe.ts` 와 `portfolio-stability.ts` 는 같은 strategy-eval 호출 체인(같은 프로세스)이고 pm2 `stockinvest` 는 `instances: 1` 이라 성립한다 [확실]. 시험(DB 쓰기 실패 뒤 skip → 재시작 뒤 DB core 통과 → 24h 초과 skip)이 고정한다.
- [23:50] CAS 정확성: 운영 MariaDB 10.11.11 에서 `JSON_VALUE` 는 rev 없음 → NULL(COALESCE → `0`), `rev:3` → `3` 문자열로 `= "3"` 이 참임을 읽기 전용으로 확인 [확실]. 조건에 쓰인 값이 새 본문에서 rev+1 로 바뀌므로 매칭 행 수와 변경 행 수가 같아 `affectedRows` 의미가 FOUND_ROWS 여부와 무관하다. 행 없음은 `INSERT IGNORE`(중복이면 0 → 재시도 시 존재로 읽음)로 처리돼 둘이 동시에 만들어도 한쪽만 성공한다 [확실]. 진짜 MariaDB 로 CAS 왕복·동시 실행은 재현하지 못했다(모의 DB 시험 + 정적 확인) — 미확인.
- [23:50] LOW-4 rev 손상: `parseIndexTierRev` 가 0 으로 읽는 값(`1.0`·`1.5`·`"3"`·음수·2^53 초과·숫자 아님)이 DB 에 실제로 있으면 `JSON_VALUE` 문자열(예: `1.0` — 위 조회로 `1.0` 문자열 반환 확인)과 파라미터 `0`/`1` 이 영구 불일치 → 3회 후 던짐 → 경고만 남고 DB 는 갱신되지 않는다 [확실]. 그때 동작은 fail-closed: 이 프로세스는 메모리 관측으로 정확히 판단하고, 재시작·다른 프로세스는 낡은 DB 값을 24h 한도까지만 쓰고 이후 unknown(차단) — 느슨해지는 경로는 없다(낡은 core 가 24h 남는 것은 LOW-1 과 같은 한도) [확실]. 다만 자동 복구가 없고(수동 편집 외에는 생길 수 없는 값이라 실현 가능성 매우 낮음) 경고가 갱신마다 반복된다. 권고(필수 아님): 연속 충돌 시 rev 가 비정상이면 경고 문구에 그 사실을 밝히거나 운영 절차에 「행 삭제로 복구」를 적을 것.
- [23:50] 메모리 관측의 완화 가능성: 없음. 합치기 규칙은 관측 시각이 **더 늦은** 쪽만 이기고(동률은 메모리), 메모리 병합도 같은 규칙이라 더 이른 관측이 더 늦은 관측을 못 덮는다. 메모리가 DB 를 이기려면 더 늦게 관측한 값이어야 하고, 그 값도 `resolveHeldTier` 의 24h·미래 5분 검사를 똑같이 통과해야 한다 [확실]. 관측 시각을 요청 전 시각으로 둔 탓에 24h 시계가 요청 소요만큼 일찍 시작하는 것은 더 엄격한 쪽이다. 동률(같은 ms 에 서로 다른 등급)은 한 프로세스 안에서만 가능해 사실상 없다.
- [23:50] 프로세스 재시작·다중 인스턴스: 재시작 시 메모리가 사라지고 DB 값+24h 한도가 상한(시험 고정). 다중 프로세스(blue/green 겹침 1~3초 등)에서 한쪽의 DB 쓰기가 실패하면 다른 프로세스는 낡은 DB 값을 최대 24h 본다(LOW-1 과 같은 한도). 현재 `instances: 1`·단일 호출 체인이라 가정이 성립하나, instances 를 늘리면 medium 수정의 보호는 그 프로세스에만 적용됨을 문서에 명시하길 권한다 [확실]. 번들 간 모듈 공유(Next 라우트별 모듈 인스턴스)는 갱신·가드가 같은 `strategy-eval` 체인이라 영향 없음 [가능성 높음].
- [23:50] 테스트 전용 export: `resetIndexTierProcessStateForTest` 의 사용처는 `index-tier-store-t184.test.ts` 두 곳뿐이고 운영 코드 import 는 0건 [확실]. 호출되면 메모리의 강등 관측이 사라져 DB 값으로 되돌아가므로 이론상 완화 방향이나, 노출 위험은 낮다(번들 최적화로 제거되지 않지만 호출 경로 없음). 권고(선택): 이름이 이미 `ForTest` 이므로 유지 가능, 더 엄격히는 `process.env.NODE_ENV===test` 일 때만 동작하게 한다.
- [23:50] t176/t181 시험의 모의 DB 한 줄: `system_config` 응답(읽기=행 없음, 쓰기=affectedRows 1)만 추가됐고 기존 단언은 바뀌지 않았다 — CAS 가 `affectedRows` 를 보므로 필요한 변경이며 단언 약화 아님 [확실]. 미확인 범위: 전체 jest 대조·`next build`·`tsc`(Leader 백그라운드), 실 MariaDB 동시 실행·CAS 왕복, 프롬프트 캐시 키. Critical 0 · High 0 · Medium 0 · Low 4.
- [23:50] **최종 판정: PASS (scope: src/lib/strategy/index-tier-store.ts, src/lib/strategy/universe.ts, src/lib/strategy/portfolio-stability.ts, src/lib/strategy/engine.ts, src/lib/strategy/ai-filter.ts, src/lib/strategy/skip-reason-formatter.ts, src/lib/strategy/__tests__/index-tier-store-t184.test.ts, src/lib/strategy/__tests__/portfolio-stability.test.ts, src/lib/strategy/__tests__/universe-index-tier-t181.test.ts, src/lib/strategy/__tests__/universe-ranking-fallback-t176.test.ts)**

## QA
- [23:52] QA 실행 검증 (실행 도구 claude, QA 서브에이전트). 서버 worktree `~/.node-local/stockinvest-t184`(base 774bef6, 변경 미커밋 상태 그대로). 코드 수정·커밋·push·KIS 호출·DB 쓰기·pm2·cron 0건. 무거운 실행은 `flock /tmp/stockinvest-heavy-tests.lock nice -n 10` 직렬, 로그 `~/.node-local/t184-logs/qa-*.log`, 판정 순서 1→7 은 아래 항목 번호와 같다.
- [23:52] 1. 변경·신규 시험 6파일(index-tier-store-t184·portfolio-stability·universe-index-tier-t181·universe-ranking-fallback-t176·engine-universe-refresh-isolation-t176·strategy-eval-lane): **6 suites / 86 tests 전부 통과, rc 0** (`qa-1.log`·`qa-1.json`). `src/lib/strategy` 디렉터리 jest 1회: 105 suites 중 102 통과·2 skipped·**1 실패**, 2708 tests 중 2601 통과·106 skipped·**1 실패**. 실패 1건은 `records/__tests__/job-slots.test.ts` 「E11 — 슬롯 표 ↔ 러너 라벨 정합」으로, base 실패 목록(`jest-base.json`)에 같은 이름으로 있는 **기존 실패**이며 신규 실패 0 (`qa-2.log`·`qa-2.json`). 전체 jest 재대조는 하지 않았고 Leader 가 남긴 `jest-base.json`·`jest-new2.json` 두 JSON 을 대조해 재확인만 했다: base 실패 427건 / 수정본 427건, **새 실패 0·사라진 실패 0**, 통과 12,482 → 12,517.
- [23:52] 2. `npx tsc --noEmit`: **rc 0, 출력 0바이트** (`qa-tsc.log`).
- [23:52] 3. 완료 기준 시험 고정 확인(시험 코드 직접 읽음, 전부 통과): (가) 보유 종목이 선별에서 빠져도 pass — 시험 「(가)」(index-tier-store-t184 L276)가 universe 행 부재를 단언하고 `symbol_universe` 조회가 0건임을 확인. (나) core 저장 뒤 강등+탈락 → skip(`core_ratio_below_min`) — 「(나)」(L288)가 `symbol_universe` 에 과거 core 행이 남아 있음을 단언, 가드가 그 테이블을 읽으면 모의 DB 가 예외를 던지게 해 되돌림을 막는다. (다) 정확히 24h 는 pass, 24h+1ms 는 unknown 으로 skip(L311), 시세 일시 실패 종목 한도 안 유지·초과 unknown(다-2, L325). 추가 Codex C2 대응 시험도 존재·통과: 겹친 갱신(L356), CAS 충돌 뒤 재읽기 병합(L364, UPDATE 2회 단언), 3회 충돌 throw(L382), DB 쓰기 실패 뒤 같은 프로세스 가드 skip → 재시작 뒤 DB core 통과 → 24h 초과 skip(L396).
- [23:52] 4. 안전장치 회귀: `git diff -- src` 의 추가·삭제 줄과 신규 파일 2개(`index-tier-store.ts`·`index-tier-store-t184.test.ts`)에서 `submitOrder`·`createOrder`·`DRY_RUN`·`KILL_SWITCH`·`ORDER_MAX`·`DAILY_ORDER`·블랙리스트·`safety/`·`orders`·`trade_logs` 토큰 **0건**. 변경 파일 10개 중 `src/lib/safety/` 와 주문 경로 파일 없음. 안전장치 묶음 시험 `src/lib/safety/__tests__/submit-order*`(5파일)·`service-validation-audit-only-t168`·`approve-validation-gate`·`engine-validation-gate`·`engine-adaptive-validation-audit-t168`: **9 suites / 194 tests 전부 통과, rc 0** (`qa-3.log`). `t142-submit-order-raw-flag` 는 glob 「submit-order*」에 해당하지 않아 실행 대상에서 뺐다.
- [23:52] 5. 엣지: 보존소 비어 있음(배포 직후) → unknown·차단(L341) · 무보유 부트스트랩 pass 유지(L347) · 해외 갱신은 보존소 미접촉(L259) · 시세 0건은 보존소 미접촉(L253) — 전부 시험 통과로 확인.
- [23:52] 6. 버전: `package.json` 0.20.0 → **0.21.0**, `package-lock.json` 루트 최상위 `version`과 `packages[""]` 둘 다 **0.21.0**(base 774bef6 의 두 곳은 0.20.0). 마이너 1단계 일치.
- [23:52] 7. 문구: `src/lib/strategy` 운영 코드에서 「KOSPI 100」 **표시 문구는 0건**(engine.ts 사용자 문구·skip-reason-formatter.ts 설명·ai-filter.ts 프롬프트 2곳 교체 확인, portfolio-stability.ts 주석 교체). 잔존은 (a) `universe.ts:320` 주석 「이름과 달리 KOSPI 100 이 아니다」(의도된 설명 주석) (b) 식별자 `'kospi100'`(universeSource 값, engine.ts:460·universe.ts:328·342 — 문구 아님, 코드 호환을 위해 그대로). `docs/design/` 과거 기록은 범위 밖.
- [23:52] 결함 목록: **Critical 0 · High 0 · Medium 0 · Low 0** (QA 가 새로 찾은 결함 없음). 기존 실패 1건(job-slots E11, base 에도 실패)은 이번 변경과 무관하고 신규가 아니다.
- [23:52] **NOT_VERIFIED (검증 못 한 것)**: (1) 실 MariaDB 에서 CAS 왕복(`JSON_VALUE` 비교·`INSERT IGNORE` 후 `affectedRows`)과 두 universe 갱신의 **실제 동시 실행 재현** — 모의 DB 시험과 정적 확인만. (2) KIS 실제 시세 응답 경로 — 전부 mock. (3) 장중 갱신 주기 20분 가정의 운영 로그 확인(근거 없음). (4) `next build` 재실행은 이번 QA 범위 밖(Leader `build2.log` rc 0 기록만 인용). (5) 프롬프트 문구 변경이 LLM 응답 캐시 키에 미치는 영향(Reviewer 미확인 항목, 영향 미미로 추정).
- [23:52] 권고(판정에 영향 없음): Reviewer 23:50 LOW-4(손상된 `rev` 값 때문에 CAS 가 계속 충돌하는 경우의 실제 MariaDB 동작)는 모의 DB 로만 봤다. 운영 반영 전 실 MariaDB 에서 동시 갱신 1회를 확인하면 더 안전하다.
- [23:52] QA 결과: pass

## Codex 검토

### [2026-11-20 23:43] C2 adversarial-review focus=concurrency — done
- judge 판정: judge-result@2 C2 `codex_required=true`·mode=adversarial-review·focus=concurrency·budget_rule=CX-limit-unknown-r2 (`/tmp/judge-T-184-C2.out.json`, 서버) / 호출 차수: 1/4 (재시도 없음)
- 실행: 서버 worktree `~/.node-local/stockinvest-t184`, `CODEX_BIN=/home/brownjeon/.local/bin/codex`(codex-cli 0.167.0), 래퍼 `codex-review.sh run`, 소요 267초, rc 0. 실행 전후 worktree 상태(HEAD·status·diff·미추적 파일 해시) 동일 확인.
- 대상: repo=/home/brownjeon/.node-local/stockinvest-t184 base=774bef6(task_file) snapshot=deeec85
- 지적 2건:
  - [high] src/lib/strategy/index-tier-store.ts:118 — 중첩된 universe 갱신 A·B에서 A가 core를 읽고 B가 강등을 저장한 뒤 A가 덮어쓰면 core가 복원되어 가드가 pass. 읽기·병합·쓰기에 잠금·버전 비교가 없음. 복원 관측이 24시간 이내면 최신성 검사를 통과. 권고: DB 잠금 또는 CAS 재시도로 원자화, 부분 시세 실패와 강등 저장을 교차시키는 회귀시험 추가.
  - [medium] src/lib/strategy/universe.ts:232 — 보존소 쓰기만 실패(경고 처리 후 폐기)하면 이미 확인한 강등이 반영되지 않고 이전 core로 pass 가능. 기존 저장 실패 시험은 빈 보존소에서 시작해 가드를 검사하지 않음. 권고: 저장 실패 상태 전달 시 국내 auto 매수 차단 또는 이번 관측을 가드에 직접 적용, 이전 core 존재 상태의 저장 실패 후 가드 시험 추가.
- Codex 요약: 단일 가드의 같은 스냅샷 평가, 손상·만료·미래 시각의 unknown 처리, 가드 DB 오류의 전파(매수 생성 중단)는 확인. 선별 탈락·순차 강등·24시간 만료 시험과 요청된 두 되돌림 탐지는 확인. 비원자적 저장 경합과 강등 관측 후 저장 실패는 기존 시험이 놓침.
- 검토하지 못한 범위: 실제 MariaDB 잠금·오류·동시 실행 재현, 전체 Jest·tsc·next build, 운영 환경에서 중첩 발생 빈도. 판단 주의: 이 지적은 Codex 출력 요약이며 채택·기각은 Reviewer 몫이다.
- 원본: /home/brownjeon/NFS/homes/brownjeon/project/.claude/state/codex-review/runs/20261120T143844Z-T-184-C2/raw.txt


## 배포 기록

- [23:59] 서버 worktree 브랜치 `t184-held-symbol-tier` 커밋 `812e0fd`(코드+기록, 커밋 훅 「Reviewer 감사 기록 확인: T-184」 — 다른 task ID 없음) → 브랜치 push(웹훅은 `/main` 으로 끝나는 ref 만 배포 — 배포 없음) → **PR #9** https://git.xn--lh0b87pnudm10a4vd.com/brownjeon/project_StockInvest/pulls/9 (head `812e0fd`, base `main`=`774bef6`, 본문 U+FFFD 0·원본 일치 확인). 머지(=운영 배포)는 사용자 승인 대기.

## 실행 도구·절차 이력

- E1 2026-11-20 23:30 KST — 시작 도구 claude(T-181 세션이 시작한 하위 세션의 메인 세션이 Leader 역할 겸임), 절차 claude_standard. 범위: 설계·구현·감사·QA·서버 커밋·PR 생성. 근거: 상위 세션 지시(위 원문). 남은 일: Reviewer → judge C2/Codex → QA → PR.

- E2 2026-11-20 23:55 KST — 같은 도구(claude)·절차(claude_standard). 구현·Reviewer PASS(23:36)·judge C2·Codex(1/4, done, high 1·medium 1)·Codex 지적 수정·Reviewer 재감사 PASS(23:50, 두 건 채택)·QA pass(23:52)까지 끝. 서버 worktree 브랜치 커밋 → 브랜치 push → PR 생성. 남은 일: 사용자 PR 검토·머지 승인 → 머지(=운영 배포) → 다음 국내 장중 관측.

## 최종 요약

### [T-184] 코어 비율 가드가 보유 종목의 최신 등급을 쓰게 하기

- **상태**: ⏳ 구현·감사·QA 완료, **PR 검토·머지(=운영 배포) 승인 대기**.
- **무엇이 바뀌었나**
  - 원인: 국내 종목 등급(KOSPI200 → core 등)이 전략 점수 선별을 통과한 종목에만 저장되고, 코어 비율 가드는 그 기록의 나이를 보지 않았다. 그래서 보유 종목이 선별에서 빠지면 강등돼도 옛 core 로 최대 48시간 통과하거나, 48시간 뒤에는 등급 없음으로 국내 매수가 전부 막힐 수 있었다.
  - 이제 universe 갱신 때 시세를 받은 **모든** 국내 종목의 등급을 따로 보존하고(설정 표 `system_config` 한 행, DB 구조 변경 없음), 가드는 **24시간 안에 확인된 등급만** 쓴다. 없거나 낡았으면 「등급 모름」 → 코어로 세지 않는다(막는 쪽).
  - 외부 검토(Codex) 지적 2건도 고쳤다: 갱신이 겹쳐도 더 늦게 확인한 등급이 이기게(조건부 저장·재시도), DB 저장이 실패해도 방금 확인한 강등이 같은 프로세스의 가드에 바로 반영되게.
  - 차단 사유 문구 「코어(KOSPI 100) 비율 미달」 → 「코어(KOSPI200 편입) 비율 미달」(분석 화면·AI 프롬프트 문구 포함, 판정 로직 변화 없음). 정적 후보 목록에서 상장폐지 코드 2개(`042670`·`091990`) 삭제(44 → 42종목). 웹 버전 0.20.0 → 0.21.0.
- **배포**: ⏸ 미배포 — PR 머지가 곧 main push = 운영 blue/green 배포라 사용자 승인 뒤. 같은 배포에 실릴 다른 작업: 없음(base `774bef6` 위 이 task 커밋만). DB 구조 변경·앱(APK) 변경 없음. ⚠ T-183(다른 세션, 진행 중)도 버전을 올리면 `package.json` 이 충돌한다 — 나중에 머지되는 쪽이 리베이스하며 버전을 다시 올린다.
- **AI 가 검증한 것**: 완료 기준 시험 (가) 선별에서 빠져도 등급 유지 (나) 강등+탈락에서 옛 core 로 통과하지 않음 (다) 24시간 초과 시 등급 모름 — 전부 통과 · 겹친 갱신·저장 충돌·저장 실패 시험 통과 · 관련 6 suites/86 tests · 전체 jest base 대비 새 실패 0(기존 실패 427건은 base 와 이름까지 동일) · `tsc` 0 · `next build` rc 0 · Reviewer PASS(재감사 포함, Low 4) · QA pass(안전장치 경로 diff 0, 안전장치 시험 194건 통과) · 운영 MariaDB 의 `JSON_VALUE` 동작(읽기 전용).
  - 검증 못 한 것: 실제 DB 에 대한 저장 왕복·동시 실행 재현(모의 DB 시험만) · 운영 갱신에서의 실제 저장 결과(배포 뒤 첫 국내 장중에 읽기 전용 확인) · lint(설정 없음) · 데모 게이트 기록(화면 구조 변경 없이 문구 1줄이라 데모를 만들지 않음 — judge 는 delta 판정).
- **👉 사용자가 확인할 것**: PR 의 소스 검토. 배포 뒤 화면 확인은 필수 아님 — 다음 국내 장중(월 11-23 09:00~) 이후 AI 가 `system_config.domestic_index_tier` 행 생성(약 42종목, 005930 core)과 `portfolio_core_ratio` 차단 사유의 `tier=` 값을 읽기 전용으로 확인한다. 이상 기준: 장중인데 그 행이 없거나 1시간 넘게 갱신되지 않음 / 로그에 「등급 보존 저장 실패」가 반복.
- **👉 사용자가 결정할 것**: ① PR 머지(=배포) 승인 — 권고: 장 마감 뒤 창(15:40~20:00 또는 05:10~06:50 KST)에 머지. 지금(금요일 밤)도 국내 장이 닫혀 있어 영향이 없다. ② 최신성 한도 24시간 — 권고값 그대로(장중엔 15~20분마다 갱신, 하루 넘게 갱신이 실패하면 막는 것이 맞다). 바꾸려면 말씀해 주시면 된다.
- **남은 일 (후속 후보)**
  - 정적 후보 목록 **밖**의 국내 보유 종목은 여전히 등급을 알 수 없다(종전과 같음 — 지금 보유는 삼성전자뿐이라 해당 없음). 보유 종목을 시세 대상에 넣는 설계가 필요하다.
  - 보존 행의 `rev` 가 손으로 잘못 고쳐지면 저장이 계속 충돌한다(Reviewer LOW-4, 막는 쪽으로 동작). 복구: 그 행(`system_config` 키 `domestic_index_tier`)을 지우면 다음 갱신이 새로 만든다.
  - 서버를 여러 인스턴스로 늘리면 「저장 실패 시 메모리 반영」 보호가 그 프로세스 안에만 적용된다(지금은 1개).
- **이슈·위험**: 배포 직후 첫 국내 갱신 전(장중이면 최대 15분)에는 보존 행이 비어 국내 매수 후보가 「등급 모름」으로 막힌다(막는 쪽, 다음 갱신에 자동 해소). 실주문은 DRY_RUN·검증 관문(전략 전부 미검증)·킬스위치(11-20 21:42 자동 발동, 해제는 사용자 전용)로 계속 막혀 있다.
