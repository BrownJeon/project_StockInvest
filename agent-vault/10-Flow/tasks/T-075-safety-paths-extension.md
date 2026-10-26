---
task_id: T-075
title: 커밋 안전장치(SAFETY_PATHS) 확장 — 전략 검증 입구·마이그레이션·DB 부팅 코드를 감사 대상에 추가
status: done
priority: medium
roles_involved: [leader, developer, reviewer, qa, judge, codex]
related_tasks: [T-025, T-072]
tags:
  - type/task
  - domain/safety
aliases:
  - SAFETY_PATHS확장
created: 2026-10-23
updated: 2026-10-26
base_ref: fa0669c9a651119e362100d1f711bd42eda9ec89
risk_level: R2
developer_model: opus
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

# T-075 — SAFETY_PATHS 확장

> **수익 경로 연결(제1원칙)**: 검증 없이 실매매가 나가지 않게 하는 장치(T-072)의 입구와 DB 구조 변경 경로가 감사 없이 바뀌면 그 장치가 무력화된다.

## 사용자 결정 (2026-10-23, 원문 "안전 감시목록에 대하여 '권고대로 추가'")
권고 항목만 추가한다 — 이전 보고의 '추가 권고' 3개:
1. `^src/app/api/strategies/` — 검증 상태(`validation_status`)를 바꿀 수 있는 입구. (T-072 는 현재 PATCH 가 이 필드를 받지 않게 코드+시험으로 막았지만, 누가 필드를 추가해도 훅이 감사를 요구하지 않는다.)
2. `^scripts/migrations/` — 개발·운영이 같은 DB 인 공유 DDL. 배포로 자동 실행되지 않지만 잘못된 SQL 이 감사 없이 커밋돼 사용자가 적용할 수 있다.
3. `^src/lib/db.ts` — 앱 부팅마다 `CREATE TABLE/ALTER` 를 도는 `setupDB` 가 있어 **배포 = DDL** 이 된다(T-059·T-070·T-072 가 이를 피하려고 별도 SQL 로 뺐다).

**넣지 않는다**(사용자 "권고대로" = 선택·제외 권고 항목은 미포함): `src/app/api/settings/risk-policy/`(선택 사항), `src/lib/reports/`(주문에 영향 없음 — 제외 권고).

## 범위
- `scripts/git-hooks/commit-msg` 의 `SAFETY_PATHS` 배열에 3개 추가 + **배열 위 주석에 항목별 근거**(이 프로젝트의 기존 규약: "목록을 고칠 때는 근거도 같이 적는다"). 정규식 앵커·기존 항목 순서/스타일 유지, 기존 항목 삭제 금지.
- `scripts/test-git-hooks.sh` 에 새 3경로 시나리오 추가: 해당 경로 변경 + Reviewer 판정 없음 → 차단, 유효 판정(scope 포함) → 통과, scope 밖 → 차단. (스크립트는 임시 index 를 쓰며 실제 index·커밋을 건드리지 않는다.)
- 프로젝트 `CLAUDE.md` 의 '커밋 안전장치' 절은 **목록을 복제하지 않는 정책**이라 수정하지 않는다(대분류 문구만 필요하면 보고하고 Leader 가 결정 — `CLAUDE.md` 는 타 세션 미커밋 변경이 있어 건드리지 않는다).
- 이미 스테이징·커밋 대기 중인 타 세션 변경 중 새 경로에 걸리는 파일이 있는지 `git status` 로 확인해 보고(있으면 그 세션이 영향받는다).

## 단계
Developer → Reviewer → (judge C2 → Codex 필요 시) → QA(훅 시험 직접 실행·새 경로 동작 E2E) → 명시 경로만 커밋 → push(= 배포이지만 앱 코드는 동일 — 오프아워 창에서) .

## 판단 기록 (judge)
- 2026-10-23 07:38 intake(규칙 엔진): risk R2, developer opus, 데모 none, next=assign.

## 데모 검토 (demo gate)

> 실행 판정 정본은 frontmatter `demo_gate` 이다. 이 표는 check.mjs 가 함께 기록하는 사람용 이력이다(docs/demo-review-gate.md).

| 버전 | 상태 | 저장소 파일 | Artifact | 사용자 결정 | 일시 |
|---|---|---|---|---|---|
| - | 해당없음 | - | - | judge: none | 10-23 07:38 |

## Developer

### Stage 1 — 구현 (2026-10-23 07:41~07:47, developer opus)

- [07:47] **결론**: `SAFETY_PATHS` 35 → 38개(추가만, 기존 항목 삭제·변경 0). 훅 시험 **52/52 → 62/62**, 실 커밋 E2E 차단 정상. 새 시나리오 9개는 변이(새 경로 없는 원본 훅)에서 **9/9 실패**해 실제로 잡아낸다는 것을 확인했다. git 쓰기 0, 다른 파일 수정 0.

#### 1. 변경 요약 (diff 요지)
- `scripts/git-hooks/commit-msg` (+28/−2, 모드 `-rwxr-xr-x` 유지)
  - 배열에 3개 추가(기존 앵커 양식): `'^src/lib/db\.ts$'`(`cron-auth` 다음), `'^src/app/api/strategies/'`(`analyst/` 다음), `'^scripts/migrations/'`(`cron-runner.sh` 다음).
  - 배열 위 주석에 `# T-075 추가` 절 신설(항목별 근거 + 넣지 않은 것 2개).
  - 기존 주석 2줄 수정(배열 항목 아님): 옛 "제외 판단 — `src/lib/db.ts`(공통 인프라·과도차단)" 두 곳에 "⚠ T-075 에서 포함으로 뒤집힘"을 덧붙였다. 원래 문구는 지우지 않았다. 그대로 두면 주석과 목록이 서로 모순된다(이 프로젝트가 가장 경계하는 드리프트).
- `scripts/test-git-hooks.sh` (+80/−2)
  - 헬퍼 `stage_and_run` 에 선택 단언 `EXPECT_OUT` 추가. 비어 있으면 종료코드만 본다 = 기존 52개 시나리오 동작 불변. 래퍼 `stage_and_run_expect` 는 함수 앞 임시 대입 대신 명시 대입·해제를 쓴다(POSIX 모드 오염 방지).
  - `[T-075 …]` 절: fixture 2개(T-985 = 세 경로 scope 포함, T-984 = 이웃 경로 scope `settings/strategies/`·`cron-runner.sh`·`src/lib/db/`)와 판정 미기록 fixture T-993(기존 것 재사용). 시나리오 10개: 경로당 ①·②·③(`strategies/[id]/route.ts`, `scripts/migrations/T-999-hooktest-new.sql`, `src/lib/db.ts`) + 미포함 결정 회귀(`settings/risk-policy`·`lib/reports` → 비차단).
  - ② 는 종료코드 0 만으로는 "안전경로가 아니라 조용히 통과"와 구분되지 않는다. 그래서 훅의 통과 문구("Reviewer 감사 기록 확인")까지 확인한다. 이 장치가 없으면 ② 는 변이를 못 잡는다.
  - E2E 끝 안내 문구의 fixture 범위를 `T-989~998` → `T-984~998` 로 고쳤다(기존 문구도 이미 T-986·987 을 빠뜨린 상태였다).

#### 2. 근거 주석 (훅에 실린 문구 요지)
- `src/app/api/strategies/` — `validation_status` 를 바꿀 수 있는 입구. 지금은 T-072 가 PATCH 에서 이 필드를 막았지만, 필드를 추가해도 감사를 요구하지 않았다. 같은 PATCH 가 `enabled`(전략 on/off)도 바꾼다 [확실 — `[id]/route.ts` 읽음]. 이미 포함된 `settings/strategies/` 와 같은 권한이다. 신규 라우트가 새지 않게 디렉토리 전체로 넣었다.
- `scripts/migrations/` — 개발·운영이 같은 NAS MariaDB 인 공유 DDL. 자동 실행은 안 되지만, 무감사 SQL 을 사용자가 그대로 적용할 수 있다. 신규 SQL 도 걸리게 디렉토리 전체로 넣었다.
- `src/lib/db.ts` — `getPool()` 첫 호출 → `ensureSetup()` → `setupDB()` 가 CREATE/ALTER TABLE 을 실행한다(grep 58줄) [확실]. 즉 **배포 = 운영 DB DDL**. 파일 하나만(정확 일치) 넣었다. `db.tsx`·`db/`·`dbx.ts` 는 안 걸리는 것을 확인했다.

#### 3. 시험 수치
| 시점 | 훅 | 시험 스크립트 | 결과 |
|---|---|---|---|
| 변경 전 | 원본 | 원본 | **52 통과 / 0 실패**, E2E 차단 정상 |
| 변이 | 원본(새 3경로 없음) | 신규 | **53 통과 / 9 실패** — 실패 9 = t075-a1~c3 전부(②는 "기대 문자열 없음"으로 실패). 실패 시 E2E 전에 끝나 실제 index 를 건드리지 않음 |
| 변경 후 | 신규 | 신규 | **62 통과 / 0 실패**, E2E 차단 정상(exit 1, HEAD `fa0669c` 불변), fixture 잔존 0, stage 0 |

- 시나리오마다 새 경로 파일을 **하나만** stage 하므로 "세 경로 모두 빼기" 변이가 경로별 변이와 같은 효과를 낸다. 한 경로만 빠져도 그 경로의 ①·②·③ 이 실패한다. 경로별 단독 변이는 따로 돌리지 않았다(허용 실행이 시험 스크립트 하나뿐이고, 약화된 훅을 작업 트리에 올리지 않기 위함).

#### 4. 반영 절차 (훅이 shim `exec bash "$SRC"` 로 작업 트리 원본을 즉시 실행하므로)
- 백업: `scratchpad/commit-msg.orig-T075`(sha256 `7f495486…`), `scratchpad/test-git-hooks.sh.orig-T075`(`ec2e9e5f…`).
- 수정본은 scratchpad 에서 만들고 `bash -n` 검사 → 같은 디렉토리 임시 파일(`cp -p` 로 모드 보존)에 쓴 뒤 `mv` 로 원자 교체(07:46:32). 교체 직후 시험이 실패하면 자동 복구하도록 묶어 실행했다(복구는 발생하지 않음). 새 sha256 `80a60697…`. 임시 파일은 남지 않았다.

#### 5. 타 세션 영향 평가
- 지금 미커밋·미추적 변경 중 새 3경로에 걸리는 파일은 **없다** [확실 — `git status --untracked-files=all -- <3경로>` 결과 0]. stage 된 변경도 0.
- 앞으로 영향: 위 경로를 건드리는 커밋은 Reviewer scope 에 그 경로가 있어야 한다. 과거 빈도는 `db.ts` 커밋 24건(09-22 이후 1건), `strategies/` 4건(1건), `migrations/` 3건(3건 — T-059·T-070·T-072). [추측] T-074(현금 흐름 장부, todo)는 DDL 을 추가할 가능성이 높아 첫 적용 대상이 될 것이다.
- 이 T-075 커밋 자체도 `scripts/git-hooks/`·`scripts/test-git-hooks.sh` 가 안전 경로라 Reviewer scope 에 두 파일이 필요하다.

#### 6. 남은 위험 · 미확인
- **(기존 결함, 범위 밖이라 고치지 않음) 시험 스크립트 머리말이 "실제 index 를 건드리지 않는다"고 쓰지만 사실과 다르다.** E2E 절은 stage 가 비어 있을 때 실제 index 에 가짜 blob(`src/lib/safety/dry-run.ts`)을 올리고 `git commit` 을 시도한 뒤 `git read-tree HEAD` 로 되돌린다. 그 몇 초 사이에 다른 세션이 stage 하면 그 stage 가 지워진다. 다른 세션이 그 순간 커밋하면 가짜 내용이 실릴 수도 있다. fixture 파일도 실행 중에는 실제 작업 트리 `agent-vault/10-Flow/tasks/` 에 잠깐 생긴다. 이번에 E2E 를 2회 돌렸고 그때마다 stage 0·fixture 0 을 확인했다. 머리말 정정이나 E2E 의 동시성 보호는 Leader 판단 사항이다.
- `CLAUDE.md` '커밋 안전장치' 대분류에 "DB 구조 변경(공유·부팅 DDL)·전략 검증 상태"를 넣을지는 Leader 결정 사항이다. 이번에는 수정하지 않았다(목록 복제 금지 정책, 타 세션 미커밋 변경 있음).
- `db.ts` 는 공통 인프라라 DDL 과 무관한 수정(풀 설정·재시도)도 감사를 요구하게 된다. 과도차단 마찰은 운영에서 관측해 Leader 가 재검토한다(근거 주석에 뒤집힌 판단으로 명시해 둠).
- 20-Log 한 줄 기록은 이번 수정 허용 파일 밖이라 남기지 않았다(Leader 몫).

### Stage 1b — 시험 스크립트 머리말 정정 (2026-10-23 07:49, developer opus, 코디네이터 지시)

- [07:49] `scripts/test-git-hooks.sh` 머리말 8~10행(3줄)을 8~28행(21줄)으로 바꿨다. **주석만 바꿨다.** 바뀐 24줄이 모두 `#` 줄이고(주석이 아닌 변경 0줄), 주석 줄을 뺀 나머지 내용은 sha256 이 같다(diff·해시로 확인). `bash -n` 통과. 시험은 지시대로 다시 돌리지 않았다(E2E 가 실제 index 를 건드림).
- 절차: 백업 `scratchpad/test-git-hooks.sh.pre-1b-T075`(sha256 `531e36cc…`, Stage 1 반영본) → scratchpad 에서 수정·`bash -n` → `cp -p` 임시 파일 → `mv` 로 원자 교체(07:49:30). 새 sha256 `3c935b5b…`, 모드 `-rwxr-xr-x` 유지, 임시 파일 잔존 없음, stage 0.
- 고친 내용: 옛 문장 "실제 커밋을 만들지 않고, 워킹트리와 실제 index 도 건드리지 않는다"를 지우고 사실로 바꿨다.
  - ① 로직 단계는 임시 index 만 쓴다. 다만 fixture 를 실제 작업 트리에 잠시 쓰고(EXIT trap 으로 지움, 강제 종료면 남음), dangling blob 을 남긴다.
  - ② E2E 는 실제 index 에 가짜 `dry-run.ts` 를 올리고 실 커밋을 시도한 뒤 `git read-tree HEAD` 로 **index 전체를 덮어쓴다.** 그래서 그 시점에 어느 세션이 stage 한 변경이든 지워진다. 확인과 되돌리기 사이 수 초 동안의 경쟁도 위험이다. fail-open 이어서 커밋이 생기면 `reset --soft` 로 되돌린다.
  - 경고 "다른 세션이 stage 중이거나 커밋 직전이면 실행 금지"와 확인 명령 `git diff --cached --quiet && echo … || git diff --cached --name-only` 를 넣었다.
- **제안만 하고 구현하지 않음(동작 변경이라 Leader 판단)**:
  - (a) 시작부 점검(`git diff --cached --quiet || exit 1`): 단순하다. 다만 지금은 stage 가 있어도 로직 시험은 돌고 E2E 만 건너뛴다. 이 점검을 넣으면 로직 시험까지 못 돌게 된다. 또 E2E 에 이미 같은 점검이 있어서 실제 빈틈인 "점검 후 수 초 동안의 경쟁"은 못 막는다.
  - (b) 피해 범위 축소: `git read-tree HEAD` 대신 그 한 경로만 되돌린다(`git reset -q HEAD -- "$SAFETY_FILE"`). 그러면 다른 세션이 stage 한 다른 파일은 남는다. 변경 작고 효과 큼 — **최소안으로 권고** [가능성 높음].
  - (c) 근본안: E2E 를 일회용 `git worktree add --detach`(별도 index, 로컬 디스크 경로)에서 실행한다. 메인 index 를 전혀 건드리지 않고, `core.hooksPath` 가 공유돼 실 훅 호출 검증도 유지된다 [가능성 높음 — 직접 실행해 확인하지 않음]. 대신 worktree 생성·삭제가 git 쓰기라 별도 승인이 필요하다.

### Stage 2 — 인접 경로 시나리오·비 ASCII 파일명 (2026-10-23 08:01~08:08, developer opus, 코디네이터 지시 = 감사 지적 1·2)

- [08:08] **결론**: 시험 62 → **72/72**(임시 저장소, E2E 차단 정상). 기존 62개 시나리오의 `-v` 출력(1287줄)은 바이트가 같다. 변이 **14/14 포착** — 감사에서 살아남은 11개 전부와 지적 2 관련 3개. 실제 저장소에서는 시험을 한 번도 돌리지 않았다.
- **정정 1건** [확실]: 감사 권고 예시의 "`scripts/cron-runner.sh` 단독 → 통과"는 틀렸다. `'^scripts/cron-runner\.sh$'` 가 이미 목록에 있어 차단 대상이므로 비차단 시나리오에 넣지 않고 `scripts/other.sh` 를 썼다.

#### 1. 시험 환경
- `scratchpad/t075-dev-repo` 를 새로 만들었다. 원본 HEAD `fa0669c` 를 `git archive | tar -x` 로 풀고 `git init`·`add -A`·`commit -m base` 를 했다(임시 저장소 안에서만). `core.hooksPath=scripts/git-hooks` 도 **임시 저장소의 설정에만** 넣었다(E2E 실행용). 실 커밋 시도용 작성자 정보는 환경변수로 줬다.
- 두 파일은 작업 트리 현재본으로 덮어 얹고 시험했다. 변경 전 62/62(E2E 차단)로 감사 재현값과 같았다. 원본 저장소에는 `git archive`·해시·`diff --cached` 읽기만 했다. 원본 stage 는 시작·끝 모두 0이다.

#### 2. 지적 2 — 비 ASCII 파일명 (`scripts/git-hooks/commit-msg`, 주석 아닌 변경 2줄)
- 실측(임시 index, git 2.34.1) [확실]: 기본 출력은 `"src/lib/safety/\355\225\234\352\270\200.ts"` 이다. `-c core.quotePath=false` 를 붙이면 한글은 원문으로 나오지만 `a"b.ts`·`back\slash.ts`·탭이 든 이름은 **여전히 인용된다**. `-z` 는 모두 원문으로 나온다.
- 그래서 `-z` 를 골랐다: `STAGED="$(set -o pipefail; git diff --cached --name-only --no-renames -z | tr '\0' '\n')"`(HEAD 없는 분기도 같게). NUL→줄바꿈이라 기존 줄 단위 파싱(grep·while read)과 출력 형식이 그대로다.
- `pipefail` 은 필수다. 없으면 파이프 종료코드가 `tr` 의 것이 되어 git 이 실패해도 0 이 되고, "목록을 읽지 못하면 차단"이 fail-open 으로 바뀐다(실측: pipefail 있을 때 rc 129, 없을 때 rc 0). 명령 치환 안에서만 켰다.
- 이름에 줄바꿈이 든 파일은 여러 줄로 쪼개진다. 그래도 첫 조각이 원래 경로의 앞부분이라 디렉토리 항목은 그대로 매치되고, 파일 항목은 과도차단 쪽으로만 틀린다(근거는 훅 주석에 적었다). 그 밖의 훅 로직은 바꾸지 않았다.

#### 3. 추가 시나리오 10개 (`scripts/test-git-hooks.sh`, 추가만·삭제 0줄)
- 지적 1, 비차단 3개(묶음 — 통과 기대는 하나만 잘못 매치돼도 실패하므로 묶어도 약해지지 않는다):
  - n1 `src/lib/db.ts.bak`·`db.test.ts`·`db_ts`·`foo/src/lib/db.ts`
  - n2 `strategies-foo/x.ts`·`mockups/src/app/api/strategies/route.ts`
  - n3 `scripts/migrations-old/x.sql`·`scripts/other.sh`·`docs/scripts/migrations/x.sql`
- 지적 1, 차단 2개(경로 하나씩 — 차단 기대는 묶으면 서로 가려 준다): p1 `strategies/[id]/__tests__/route.test.ts`(하위·대괄호), p2 `scripts/migrations/sub/rollback.sh`(하위 폴더·비 .sql).
- 지적 2, 5개:
  - k1 `src/lib/safety/한글.ts` + task ID 없음 → 차단
  - k2 같은 파일 + T-995(scope `src/lib/safety/`) → 통과(통과 문구까지 확인)
  - k3 `scripts/migrations/한글.sql` → 차단
  - k4 `src/lib/safety/a"b.ts` → 차단(quotePath=false 로는 못 막는 경우)
  - k5 깨진 index 로 git diff 실패 → exit 1 + "staged 파일 목록을 읽지 못했습니다"(pipefail 고정용, 이 하나만 헬퍼 대신 직접 호출)

#### 4. 변이 결과 (임시 저장소, 변이마다 치환이 실제로 됐는지 확인한 뒤 실행 → 끝나면 원복)
| 변이 | 결과 | 잡은 시나리오 |
|---|---|---|
| M01 db `$` 삭제 · M02 db `^` 삭제 · M07 `^src/lib/db` 확대 · M09 db.test.ts 까지 · M10 db `.` 이스케이프 누락 | 각 71/1 | n1 |
| M03 strategies 끝 `/` 삭제 · M04 strategies `^` 삭제 | 각 71/1 | n2 |
| M05 migrations 끝 `/` 삭제 · M06 migrations `^` 삭제 · M08 `^scripts/` 확대 | 각 71/1 | n3 |
| M11 migrations 를 최상위 `.sql` 로 축소 | 71/1 | p2 |
| M12 지적 2 수정 되돌림(= 이전 훅) | 68/4 | k1·k2·k3·k4 |
| M13 `core.quotePath=false` 만 | 71/1 | k4 |
| M14 `pipefail` 삭제 | 71/1 | k5 |
- 감사가 생존으로 보고한 11개(앵커 약화 6, 과대 확장 3, 이스케이프 누락 1, 과소 확장 1)를 M01~M11 로 그대로 적용해 **11/11** 을 잡았다. 각 변이는 겨냥한 시나리오 하나만 실패시켰다(다른 시나리오 오염 없음).

#### 5. 반영
- 백업: `scratchpad/commit-msg.pre-s2-T075`(sha256 `80a60697…`), `scratchpad/test-git-hooks.sh.pre-s2-T075`(`3c935b5b…`).
- scratchpad 에서 작성 → `bash -n` → 교체 직전 작업 트리 해시가 백업과 같은지 확인(그사이 다른 세션이 바꾸지 않았음) → 같은 디렉토리 임시 파일(`cp -p`) → `mv` 로 원자 교체(08:07:20, 두 파일).
- 새 sha256: 훅 `40c70ee3…`, 시험 `45a1b1e8…`. 임시 저장소에서 시험한 파일과 같다. 모드 `-rwxr-xr-x` 유지, 임시 파일 잔존 없음, 원본 stage 0, HEAD `fa0669c` 불변.

#### 6. 남은 위험 · 미확인
- 훅의 staged 목록 읽기는 **모든 세션의 모든 커밋**이 거치는 경로라, 이번 변경은 안전 경로가 아닌 커밋에도 실행된다. 같은 바이트의 훅으로 임시 저장소의 실 `git commit`(E2E)까지 확인했지만, 실제 저장소의 shim 경유 실행은 지시대로 시험하지 않았다. 다음 실제 커밋이 첫 실운영 확인이 된다 [가능성 높음 — 동작 동일].
- 이 task 커밋 scope 는 그대로 `scripts/git-hooks/commit-msg, scripts/test-git-hooks.sh` 다. 다만 기존 판정은 Stage 2 이전 내용을 검토한 것이므로 Stage 2 를 다시 감사해야 한다(차용된 정당성 방지).
- 감사가 짚은 머리말의 사소한 부정확("hooksPath 미설정이면 E2E 를 건너뛴다"고 읽히지만 실제로는 exit 1)은 이번 범위 밖이라 고치지 않았다.
- [08:10] **도구 주의** [확실]: 이 에이전트 셸의 `grep` 은 Claude Code 가 덮어씌운 함수(ugrep)다. 그래서 훅의 판정 단어 ERE(`(^|[^A-Za-z])` + 대문자 판정 단어)가 `/usr/bin/grep` 과 다르게 동작했다(`x <대문자 판정 단어> y` 비매치). 함수가 export 되지 않으므로 `bash 스크립트` 로 도는 훅·시험은 영향이 없다(하위 셸의 `type grep` = `/usr/bin/grep`). 시험·변이 수치도 유효하다. 다만 Stage 1 에서 셸로 직접 돌린 점검 두 가지("대문자 판정 단어 없음"·정규식 대조)는 `command grep` 으로 다시 확인해 같은 결론을 얻었다(대문자 토큰은 감사 판정 줄 1개뿐). 셸에서 훅 정규식을 손으로 검증하는 역할은 `command grep` 을 써야 한다.

### Stage 3 — grep 종료코드 fail-closed (2026-10-23 08:29~08:35, developer opus, 코디네이터 지시 = Codex C2 지적 1, 감사 채택)

- [08:35] **결론**: 시험 72 → **76/76**(임시 저장소 `t075-dev-repo`, E2E 실 커밋 차단 정상). 기존 72개 시나리오의 `-v` 출력 1427줄은, mktemp 임시 경로가 찍히는 k5 의 git 오류 1줄만 빼면 바이트가 같다. 변이 9개 중 **동치가 아닌 7개 전부 포착**했고 동치 2개는 예상대로 생존했다. `SAFETY_PATHS` 오타 상황이 "조용한 전면 통과"에서 "시끄러운 전면 차단"으로 바뀐 것을 실측했다. 실제 저장소에서는 시험을 돌리지 않았다.
- 지적 2(grant SQL 경로)는 지시대로 넣지 않았고, 그 파일들은 열지 않았다.

#### 1. 시제품 검토 (`scratchpad/hook.fix`·`test.fix` — 직접 읽고 판단)
- 훅 수정은 맞다 [확실]:
  - `MATCHED="$(… | LC_ALL=C grep -aE …)"` 직후의 `MATCH_RC=$?` 는 파이프 마지막 명령인 grep 의 종료코드다. `printf` 실패는 무시해도 된다.
  - 훅에는 이 판별 앞에 grep 호출이 없어서(awk 로 확인), k6 의 grep 대역이 처음 닿는 곳이 정확히 이 판별이다.
  - 그 밖의 grep(task ID·판정 줄·scope)은 비면 차단 쪽으로 기우므로 같은 결함이 없다.
- **시제품과 다르게 한 부분 (근거)**:
  1. 훅 오류 분기에 안내 한 줄을 더했다("원인 후보: SAFETY_PATHS 정규식 오타… 위 grep 오류 문구를 확인하세요"). 오타 하나로 **모든 세션의 모든 커밋**이 막히므로 복구 시간을 줄이려는 것이다.
  2. k7 의 `LC_ALL=C.UTF-8 stage_and_run …`(함수 앞 임시 대입)을 명시적 `export` 후 원래 값 복원으로 바꿨다. POSIX 모드에서는 임시 대입이 호출 뒤에도 남는다. Stage 1 의 `stage_and_run_expect` 와 같은 이유다.
  3. k6 출력을 다른 시나리오처럼 `-v` 일 때도 찍고, 실패 시 "기대 문자열 없음"을 표시하며, 끝나면 대역 디렉토리를 지운다.
  4. 절 제목(`[T-075 Stage 3 …]`)을 넣었다. 비 UTF-8 바이트는 `\xb0\xa1` 대신 같은 값의 8진수 `\260\241` 로 적었다(이식성).
- 확인한 전제: 이 머신에 `C.utf8`·`ko_KR.utf8` 로케일이 있다(없으면 k7 이 조용히 무력해진다). `WORK` 가 noexec 마운트여서 대역이 안 돌면 k6 은 안내 문구가 없어 **실패**한다(조용히 통과하지 않는다 — 주석에 적음).

#### 2. 변경 (diff 로 범위 확인)
- `scripts/git-hooks/commit-msg`: 346행 한 곳(`346c346,361`)만 바꿨다. 판별 줄 1줄 교체 + `MATCH_RC=$?` + `if [ "$MATCH_RC" -gt 1 ]` 차단 분기(say 2줄·`exit 1`) + 주석 9줄. 다른 로직은 그대로다.
- `scripts/test-git-hooks.sh`: 추가만 했다(`627a628,674`, 삭제 0줄). k6(rc 2·127·137 세 번)·k7.

#### 3. 변이 (임시 저장소, 치환이 실제로 됐는지 확인한 뒤 실행 → 원복)
| 변이 | 결과 | 잡은 시나리오 |
|---|---|---|
| S1 종료코드 검사 제거 | 73/3 | k6×3 |
| S2 `-a`·`LC_ALL=C` 모두 제거 | 75/1 | k7 |
| S3 `-gt 1` → `-gt 2` | 75/1 | k6(rc 2) |
| S4 `-gt 1` → `-ge 1`(정상 비매치까지 차단) | 67/9 | 통과 기대 9개((d)·(n)·(t42d)·(u)·(z4)·t075-x·n1·n2·n3) |
| S5 오류 분기 `exit 0` | 73/3 | k6×3 |
| S6 `MATCH_RC` 를 다른 명령 뒤에서 읽음 | 73/3 | k6×3 |
| S9 Stage 3 전체 되돌림(= Stage 2 훅) | 72/4 | k6×3·k7 |
| S7 `-a` 만 제거 · S8 `LC_ALL=C` 만 제거 | 각 76/0 | 생존 — 동치(둘 중 하나만으로도 비 UTF-8 이름이 막힌다. 감사 판단과 같다) |

#### 4. 오타 상황 (같은 오타 `'^src/lib/db\.ts$('` 를 주입해 임시 저장소에서 대조)
- Stage 2 훅: 시험 21/55. 훅을 직접 부르면 `README.md`·`src/lib/safety/dry-run.ts`(task ID 없음) **둘 다 exit 0** 이다 — 안전 파일이 조용히 통과하고, 흔적은 stderr 의 grep 오류 한 줄뿐이다.
- Stage 3 훅: 시험 52/24(통과 기대 시나리오가 전부 실패해 바로 드러남). 직접 호출은 둘 다 **exit 1** + "안전 경로 판별(grep)이 오류로 끝났습니다 (rc=2)" + 원인 후보 안내다.

#### 5. 반영
- 백업(Stage 2 본): `scratchpad/commit-msg.pre-s3-T075`(sha256 `40c70ee3…`), `scratchpad/test-git-hooks.sh.pre-s3-T075`(`45a1b1e8…`).
- scratchpad 작성 → `bash -n` → 교체 직전 작업 트리 해시가 백업과 같은지 확인 → 같은 디렉토리 임시 파일(`cp -p`) → `mv` 원자 교체(08:34:49, 두 파일).
- 새 sha256: 훅 `957e09ca…`, 시험 `0a469f1f…`. 임시 저장소에서 시험한 파일과 같다. 모드 `-rwxr-xr-x` 유지, 임시 파일 잔존 없음, 원본 stage 0, HEAD `fa0669c` 불변.

#### 6. 자기 정정 · 남은 것
- **정정** [확실]: Stage 2 변이 루프가 `awk > tmp && mv` 로 파일을 갈아 끼우면서 **임시 저장소의 훅 실행 권한을 잃게 했다**. 그 뒤 첫 실행에서 E2E 가 "실행 불가"로 실패했다. 임시 저장소에서만 권한을 되살리고 다시 돌렸고, 이번 변이 루프는 `cat >` 로 써서 권한을 지켰다. 실제 저장소 파일은 늘 `cp -p` 로 교체해 영향이 없다(교체 후 모드 확인). Stage 2 에 보고한 수치(72/72·E2E 정상)는 변이 루프 **전** 실행분이라 유효하다.
- 남은 것: ① 감사의 이전 지적 1(MINOR, 기존) — "비안전 파일이 정렬상 먼저, 안전 파일이 나중"인 혼합 목록 시나리오가 아직 없다(`| head -n 1` 변이 생존). 이번 지시 범위 밖이라 넣지 않았다. ② HEAD 없는 분기는 계속 시험 밖이다. ③ 실제 shim 경유 첫 실행은 다음 실제 커밋이다. ④ 조건부 통과의 조건(재확인)은 감사 몫이다.

### Stage 3b — 혼합 목록 시나리오 (2026-10-23 08:36~08:39, developer opus, 코디네이터 지시 = 감사 이전 MINOR)

- [08:39] **결론**: 시험만 바꿨다. 훅은 그대로다(sha256 `957e09ca…`). 임시 저장소 `t075-dev-repo` 에서 76 → **87/87**, E2E 실 커밋 차단 정상. 기존 76개 시나리오의 `-v` 출력 1465줄은 mktemp 경로 1줄만 가리면 바이트가 같다. head/tail 변이 **6/6 포착** — 그중 "첫 파일만" 계열 3개는 기존 76개로는 0 실패로 살아남던 것이다. 실제 저장소에서는 시험을 돌리지 않았다.
- 추가(`scripts/test-git-hooks.sh`, `674a675,725`): 시나리오 11개 + fixture T-983(scope `src/lib/strategy/`).
  - 안전 파일 위치 3종 × ①·②·③:
    - 뒤 = `docs/aaa.md`·`src/lib/safety/zzz.ts`
    - 앞 = `src/lib/safety/aaa.ts`·`zzz/notes.md`
    - 가운데 = `README.md`·`docs/a.md`·`src/lib/safety/mid.ts`·`zzz/b.md`
    - ① 판정 미기록 T-993 → 차단 · ② T-995(scope 포함) → 통과(통과 문구까지 확인) · ③ T-984(안전 파일 빠뜨림) → 차단 → m1~m9
  - 안전 파일 2개(`src/lib/safety/aaa.ts` < `src/lib/strategy/zzz.ts`) + 비안전 2개 → m10·m11:
    - m10: 첫 파일만 덮는 T-995 → 차단
    - m11: 마지막 파일만 덮는 T-983 → 차단
    - 판정 대조가 첫/마지막 안전 파일만 보는 회귀를 잡는다(지시 예시를 넘어선 추가 — 아래 H5 근거).
  - git 은 목록을 바이트 순으로 정렬해 내보내므로 stage 순서가 아니라 경로 이름으로 위치를 정했다.
- 그 밖: fixture 범위 문구 2곳(머리말 주석·E2E 안내)을 `T-984~998` → `T-983~998` 로 고쳤다(13행·803행).

| 변이(임시 저장소 훅, `cat >` 로 써서 실행 권한 유지) | 기존 76 | 신규 87 | 새로 잡은 시나리오 |
|---|---|---|---|
| H1 STAGED 줄 끝 `\| head -n 1`(감사 R10 그대로) | 76/0 **생존** | 79/8 | m1~m3·m7~m11 |
| H2 STAGED 줄 끝 `\| tail -n 1` | 73/3 | 76/11 | m4~m11 |
| H3 목록을 첫 줄로 자르는 줄 삽입 | 76/0 **생존** | 79/8 | m1~m3·m7~m11 |
| H4 목록을 마지막 줄로 자르는 줄 삽입 | 73/3 | 76/11 | m4~m11 |
| H5 안전 파일 목록(MATCHED) 첫 줄만 | 76/0 **생존** | 86/1 | m10 |
| H6 안전 파일 목록(MATCHED) 마지막 줄만 | 73/3 | 83/4 | m11 |
- "마지막만" 계열은 기존에도 (z6b)·(ac2)·(ad) 가 잡았다. "첫 파일만" 계열은 기존에 빈틈이었고 이제 막혔다. H5 는 안전 파일이 2개 이상일 때만 드러나서 m10 이 필요했다.
- 반영: 백업 `scratchpad/test-git-hooks.sh.pre-s3b-T075`(sha256 `0a469f1f…`, Stage 3 본) → scratchpad 작성·`bash -n` → 교체 직전 해시가 백업과 같은지 확인 → `cp -p` 임시 파일 → `mv` 원자 교체(08:39:18). 새 sha256 `63302586…`, 모드 `-rwxr-xr-x`, 임시 파일 잔존 없음, 원본 stage 0, HEAD `fa0669c` 불변.
- 남은 것: HEAD 없는 분기는 계속 시험 밖이다. 이번 변경(시험 스크립트)은 감사 재확인 대상이다.

## Reviewer

- [08:00] 감사 개시 — 대상은 scripts/git-hooks/commit-msg · scripts/test-git-hooks.sh 두 파일뿐. 원본 저장소는 읽기만 했다(git archive/diff/show/status/config --get, 파일 읽기). 모든 시험은 scratchpad 임시 저장소(t075-rev-repo: HEAD fa0669c 의 git archive + 자체 git init)에서만 실행했고, 이 저장소의 index·작업 트리·git 설정은 건드리지 않았다. 감사 중 작업 트리 sha256 은 훅 80a60697…, 시험 3c935b5b…(Developer 보고와 일치), stage 0건.
- [08:00] A 의도 — 확실. SAFETY_PATHS 35→38, 추가 3줄만(commit-msg:271 `^src/lib/db\.ts$`, :291 `^src/app/api/strategies/`, :299 `^scripts/migrations/`). 신규 3줄을 빼면 원본 목록과 내용·순서가 동일(awk 추출 diff 로 확인), 중복 0. risk-policy·lib/reports 는 목록에 없다(항목을 넣는 변이가 t075-x 로 포착됨). 과업 문구의 `^src/lib/db.ts` 는 이스케이프와 `$` 앵커를 붙여 구현됐다 — 기존 단일 파일 항목(cron-auth 등)과 같은 양식이고 "파일 하나만"이라는 결정에 더 정확하다.
- [08:00] B 정규식 — 확실. 훅은 `git diff --cached --name-only` 결과에 결합 ERE 를 `grep -E` 로 매치한다(commit-msg:336). 대괄호는 글롭이 아니라 텍스트라 `[id]` 경로도 정상. 임시 저장소에서 경로 35개(인덱스에 올릴 수 없는 3개 제외)를 구 훅·신 훅에 넣어 대조했다. 신규 매치(구 훅은 통과): src/lib/db.ts, strategies/ 아래 route.ts·[id]/route.ts·[id]/__tests__/route.test.ts·new/route.ts, migrations/ 아래 T-072-validation-gate.sql·신규 .sql·하위 폴더 파일·공백 포함 이름. 비매치(구·신 모두 통과): db.ts.bak, db.test.ts, db.tsx, db.js, db/index.ts, dbx.ts, DB.ts, foo/src/lib/db.ts, strategies-foo/, strategiesx/, strategy/, Strategies/, app/strategies/page.tsx, migrations-old/, migrationsx/, migration/, Migrations/, docs/scripts/migrations/, settings/risk-policy, lib/reports. 기존 항목이 이미 잡는 settings/strategies/ 는 구·신 모두 차단. 과소·과대 매칭은 없다.
- [08:00] C 훅 로직 불변 — 확실. 주석 줄과 SAFETY_PATHS 배열을 뺀 나머지 281줄이 원본과 바이트 동일(cmp). 바뀐 줄은 모두 `#` 주석 또는 배열 항목 3개. 모드 100755 유지, git diff --check 공백 오류 0, bash -n 통과. Developer 가 지시 밖으로 고친 기존 주석 2줄(commit-msg:221-222, :228)은 정확하고 필요하다 — 옛 '제외 판단: src/lib/db.ts(공통 인프라·과도차단)' 가 새 항목과 정면 모순이 되는데 이 프로젝트가 가장 경계하는 것이 주석-목록 드리프트이고, 원문은 지우지 않고 뒤집힘만 덧붙였다. 새 근거 주석(:242-262)의 사실 주장도 직접 확인: getPool→ensureSetup→setupDB(db.ts:56·97·184), CREATE/ALTER TABLE 58줄, strategies/[id]/route.ts 의 PATCH 는 enabled 등만 받고 validation_status 는 받지 않으며 route.test.ts 가 이를 고정, db.ts 전용 테스트 없음, migrations 커밋 3건(T-059·T-070·T-072)은 모두 09-22 이후. (validation_status 를 쓰는 곳은 migrations SQL 뿐이라 이 3경로가 실제 입구와 맞다.)
- [08:00] D 시험 스크립트 — 확실. 새 시나리오 10개(경로당 차단·통과·scope 밖 차단 3종 + 미포함 결정 회귀 1)의 의미가 맞다. 이웃 scope fixture(T-984: settings/strategies/·cron-runner.sh·src/lib/db/)는 파일과 디렉토리의 구분을 실제로 찌른다. EXPECT_OUT 이 비면 판정식이 기존과 동일하고(test-git-hooks.sh:78-95) 초기화(:109)가 첫 호출 앞이라 set -u 에도 안전하다. 기존 52개 시나리오: 원본 시험+원본 훅의 출력과 신 시험+신 훅의 해당 구간 출력이 diff 0(바이트 동일), 삭제된 줄은 머리말 3줄·판정식 1줄·안내 문구 1줄뿐. 머리말(8~28행) 사실 확인: 로직 단계는 GIT_INDEX_FILE 임시 index, fixture 는 실제 작업 트리에 쓰고 EXIT trap 으로 삭제, [E2E] 는 실제 index 에 가짜 blob 을 올려 실 커밋을 시도한 뒤 `git read-tree HEAD`(:623)로 index 전체를 덮어쓴다 — 코드와 일치한다. 사소한 부정확: 머리말은 hooksPath 가 설정된 때만 E2E 가 돈다고 읽히지만, 미설정이면 건너뛰는 것이 아니라 exit 1 로 끝난다(오해 소지 낮음).
- [08:00] E 독립 재현(임시 저장소) — ① 변경 전(HEAD 의 두 파일) 52 통과/0 실패 ② 변경 후 62 통과/0 실패. Developer 수치와 같다. hooksPath 를 임시 저장소에만 지정해 [E2E]까지 실행: 실 커밋 차단·HEAD 불변·fixture 잔존 0. ③ 변이 26개 중 13개 포착(훅 20개 중 9, 시험 6개 중 4). 훅 포착 9: 항목 삭제 3종(각 3개 시나리오 실패), 3개 모두 삭제(9개 실패), risk-policy 추가·reports 추가(t075-x), db 오타, strategies 최상위만, strategies 를 ^src/app/api/ 로 확대((u)+t075-x). 훅 생존 11: 앵커 약화 6(db `$` 삭제·db `^` 삭제·strategies 끝 `/` 삭제·`^` 삭제·migrations 끝 `/` 삭제·`^` 삭제), 과대 확장 3(`^src/lib/db`·`^scripts/`·db.test.ts 까지 매치), 이스케이프 누락 1(`db.ts`), 과소 확장 1(migrations 를 최상위 .sql 만으로 축소). 시험 변이: EXPECT_OUT 반전·미초기화·fixture scope 변경 2종은 포착, EXPECT_OUT 검사 제거·rc 검사 제거는 올바른 훅에서는 동치 변이라 생존이 당연하다. 짝 변이로 보강: 훅 통과 문구 변경+정상 헬퍼 → t075-a2·b2·c2 포착, 훅 항목 삭제+rc 검사 제거 → t075-a2 포착, 훅 문구 변경+EXPECT_OUT 제거 → 생존. 즉 EXPECT_OUT 은 실제로 이빨이 있지만 항목 삭제 변이는 ①·③ 만으로도 잡히므로 고유 포착력은 문구 회귀에 한정된다(무해).
- [08:00] F 적용 방식 — 확실. core.hooksPath 는 로컬 shim 디렉토리(~/.local/share/stockinvest-git-hooks/361294826755)이고 shim 은 `exec bash "$SRC"` 로 작업 트리 원본을 실행한다. 따라서 파일 교체(mtime 07:46:32)가 곧 모든 세션에 적용된다. 위험: (1) 미커밋 상태의 안전장치라 다른 세션의 git stash·checkout -- .·restore 가 훅을 조용히 35개 시절로 되돌릴 수 있다 — 서둘러 커밋하는 것이 최선의 완화, (2) 교체 중간 상태 노출은 Developer 가 같은 디렉토리 임시 파일+mv 로 피했다고 보고했고 현재 파일의 해시·mtime 과 모순이 없다, (3) 실제 노출: 새 3경로에 걸리는 미커밋·미추적 파일 0건(git status --untracked-files=all 로 확인), stage 0건 — 지금 영향받는 세션은 없다. 첫 적용 대상은 T-074(scripts/migrations/T-074-*.sql 예정, 해당 task 파일 153행)일 가능성이 높다.
- [08:00] G Developer 제안에 대한 의견(구현 안 함) — 최소안(되돌리기를 `git reset -q HEAD -- 그 파일` 한 경로로)은 피해를 "전체 stage 삭제"에서 "그 한 경로"로 줄이지만 가짜 blob 이 실제 index 에 올라가는 창은 그대로다. 근본안(일회용 worktree)은 .git/worktrees 메타 쓰기와 정리가 필요해 무겁다. 세 번째 안을 임시 저장소에서 직접 검증했다: E2E 의 read-tree·update-index·git commit 을 모두 `GIT_INDEX_FILE=<임시 파일>` 로 실행하면(약 4줄) 실제 git commit 이 hooksPath 의 훅을 호출해 차단되고(rc 1, HEAD 불변) 실제 index 에 미리 올려 둔 다른 세션 stage 가 그대로 남는다. 권고: 이 task 에 넣지 않고 별도 후속 task 로 분리한다 — 정책 목록 변경과 시험 하네스 동작 변경을 한 감사에 섞으면 책임이 흐려지고, 위험은 T-075 가 만든 것이 아니라 기존 것이며 머리말 정정으로 이미 명시됐다. 단 이 task 의 QA 는 이 저장소에서 test-git-hooks.sh 를 실행하지 말고 임시 clone(git archive + git init + 임시 저장소에만 core.hooksPath 지정)에서 실행해야 한다. 지금 t072·t074·t076 세션이 동시에 stage 할 수 있다.
- [08:00] H 커밋 준비 — 두 파일 모두 안전 경로라 이 task 커밋은 새 훅의 검사를 받는다. 임시 저장소에서 새 훅으로 모사: scope 가 `scripts/git-hooks/commit-msg, scripts/test-git-hooks.sh` 또는 `scripts/git-hooks/, scripts/test-git-hooks.sh` 면 통과(실제 git commit 도 rc 0), 한쪽만 적거나 끝 `/` 없는 `scripts/git-hooks` 면 차단, 새 3경로만 적으면 차단, 커밋 메시지에 T-075 가 없으면 차단. 훅은 task 파일을 index 가 아니라 작업 트리에서 읽으므로 이 task 파일을 stage 하지 않아도 판정은 인식되지만, 기록이 남도록 task 파일도 함께 커밋하는 것을 권한다(명시 경로만: 두 파일 + 이 task 파일).
- [08:00] 지적 1 (MINOR, 시험 공백, 비차단) — test-git-hooks.sh:509-562: 새 시나리오가 "인접하지만 매치되면 안 되는 경로"를 시험하지 않아 앵커·과대 확장 변이 11개가 생존한다(위 E). 가장 쓸모 있는 둘: migrations 가 최상위 .sql 만으로 줄어도(하위 폴더·비 .sql 미시험) 모르고, `^scripts/` 나 `^src/lib/db` 로 넓어져 다른 스크립트가 막혀도 모른다. 재현: 해당 항목 줄만 바꾼 훅으로 임시 저장소에서 62/62 유지. 권고: 시나리오 1~2개 추가(src/lib/db.ts.bak·src/app/api/strategies-foo/route.ts·scripts/migrations-old/x.sql·scripts/cron-runner.sh 단독 → 통과, scripts/migrations/sub/x.sh → 차단). 기존 52개 시나리오에도 같은 종류의 앵커 시험은 없으므로 이 task 의 결함이라기보다 기존 관행의 연장이다.
- [08:00] 지적 2 (MINOR, 기존 결함 — 이 변경이 만든 것이 아님) — commit-msg:318·336: staged 이름을 `git diff --cached --name-only` 로 읽는데 core.quotePath 기본값(true)이라 비 ASCII 파일명은 따옴표와 8진수 이스케이프로 나와 `^` 앵커가 맞지 않는다. 재현(임시 저장소, 구·신 훅 모두): src/lib/safety/한글.ts 를 stage 하면 통과(exit 0) — 새 디렉토리 항목(scripts/migrations/한글.sql, src/app/api/strategies/한글/route.ts)도 같은 방식으로 새어 나간다. 이 저장소에 core.quotePath 설정은 없다. 현실 위험은 낮지만(안전 경로에 한글 파일명을 쓸 일이 드묾) 안전장치의 fail-open 이다. 권고: 후속 task 로 `git -c core.quotePath=false diff --cached --name-only -z` 처리. 이번 판정과 무관.
- [08:00] 지적 3 (INFO) — scripts/grant-stockinvest-user.sql·scripts/grant-llm-readonly-user.sql 은 같은 공유 DB 에 권한을 부여하는 SQL 이지만 scripts/migrations/ 밖이라 여전히 감사 대상이 아니다. 사용자 결정 범위 밖이므로 관찰만 Leader 에게 전달한다.
- [08:00] 지적 4 (INFO) — 앞으로 src/lib/__tests__/db*.test.ts 가 생기면 `^src/lib/db\.ts$` 는 그것을 잡지 않는다(주석에 명시, "테스트 파일 제외 안 함" 원칙에 따라 그때 항목 추가 필요). db.ts 는 DDL 과 무관한 수정(풀 설정·재시도)도 감사를 요구하게 되는데, Developer 가 이미 보고한 과도차단 마찰이고 사용자 결정으로 수용된 것이다.
- [08:00] 종합 의견: 위험 등급 CRITICAL 0 · MAJOR 0 · MINOR 2 · INFO 2. 의도·정규식·훅 로직 불변·재현 수치가 모두 확인됐고 MINOR 는 비차단 후속 후보다. QA 인계 high_risk_areas: commit-msg:264-303(배열)과 test-git-hooks.sh:508-563(새 절). QA 는 임시 clone 에서 실행할 것. 20-Log 한 줄은 이번 쓰기 허용 범위 밖이라 남기지 않았다(Leader 몫).
- [08:00] **최종 판정: PASS (scope: scripts/git-hooks/commit-msg, scripts/test-git-hooks.sh)**
- [08:17] 재감사 개시(Stage 2) — 위 판정은 Stage 1 까지의 내용이라 이 변경을 포함하지 않는다. 현재 작업 트리 sha256: 훅 40c70ee3…, 시험 45a1b1e8…(Developer 보고와 일치, mtime 08:07:20). 훅은 Stage 1 본(80a60697…)과 주석 10줄 + 코드 2줄(commit-msg:328·331)만 다르고, 시험은 추가만(567행 이후, 삭제 0줄). 시험은 이번에도 scratchpad 임시 저장소(t075-rev2: HEAD fa0669c 의 git archive + 자체 git init, hooksPath 는 임시 저장소에만)에서만 실행했다. 원본 저장소는 읽기만 했고 시작·끝 stage 0건·HEAD fa0669c 불변, 08:07 이후 vault 밖에서 바뀐 파일은 이 두 파일뿐(find -mmin 로 확인).
- [08:17] 1-ⓐ pipefail 범위 — 확실. `set -o pipefail` 은 `$(…)` 서브셸 안에만 있다. 훅 전역의 셸 옵션은 `set -u` 하나뿐이고(commit-msg:60) set -e·pipefail 은 다른 곳에 없다. 계측 복사본으로 STAGED 계산 직후와 MATCHED 계산 직전에 `set -o` 를 찍어 pipefail=off·errexit=off·nounset=on 을 확인했다 — 번지지 않는다. 참고로 전역 pipefail 변이(R6)도 72/72 라 훅의 다른 파이프라인은 어차피 종료코드를 보지 않는다(동치).
- [08:17] 1-ⓑ 개행 든 파일명 — 확실(실측). -z 후 tr 이 줄로 쪼갠다: 'src/lib/safety/nl⏎foo.ts' → 'src/lib/safety/nl' / 'foo.ts'. 안전 경로에 해당하려면 이름이 디렉토리 접두어(개행 없음)나 정확한 파일명(개행 없음)으로 시작해야 하므로 첫 조각이 항상 매치돼 우회가 불가능하고, 오탐은 조각이 우연히 매치하는 과도차단 방향뿐이다(fail-closed). 훅 주석(commit-msg:322-324)의 설명과 일치.
- [08:17] 1-ⓒ git 실패 시 차단 유지 — 확실(실측). 깨진 index 에서 `$(set -o pipefail; git diff … | tr)` 는 rc 128, pipefail 을 빼면 rc 0 으로 STAGED 가 빈 문자열이 되어 훅이 "커밋할 것 없음"으로 통과한다(= 전 커밋 fail-open). 그래서 pipefail 은 필수이고 t075-k5 가 고정한다. `if [ $? -ne 0 ]`(commit-msg:333)는 if/else 의 마지막 명령인 STAGED 대입의 상태를 그대로 받는다.
- [08:17] 1-ⓓ 이전과 결과 동일 — 확실(실측, 구 방식 vs 신 방식 직접 대조). 빈 목록: 둘 다 빈 문자열. ASCII 경로 11개(공백·`[id]`·`{}`·`$x`·`*`·`?`·선행 `-`·`#` 포함) 동일. 5002개 파일 목록(순서 포함) 동일. 달라지는 것은 인용이 필요했던 이름(한글·따옴표·역슬래시·탭)뿐이고 그쪽이 의도된 수정이다. 혼합 목록(비안전 파일이 정렬상 먼저)도 3종 모두 차단. 최초 커밋(HEAD 없음) 분기도 별도 임시 저장소에서 확인: 문서만 통과, 한글 안전 파일 차단.
- [08:18] 2 독립 재현 — 변경 전(Stage 1 쌍) 62 통과/0 실패, 변경 후 72 통과/0 실패(E2E 차단·HEAD 불변). Developer 수치와 같다. 기존 62개 시나리오의 -v 출력(훅 출력 포함)은 바이트 동일: 말미 빈 줄을 포함해 세면 1287줄로 Developer 수치와 같고, 말미를 자르면 1285줄이다.
- [08:18] 2 변이 — Developer 변이 14개 전부 직접 적용해 14/14 포착(M01~M11 각 71/1, M12 68/4, M13 71/1, M14 71/1, 겨냥한 시나리오가 Developer 표와 같다). 이전 감사에서 생존한 11개는 M01~M11 과 같은 변이라 모두 포착됐다(이전 지적 1 해소). 내 새 변이 11개 중 6개 포착: R1(-z 제거) 68/4, R2(tr 제거) 69/3, R3(NUL→공백) 58/14, R5(git 실패 시 exit 0) 71/1, R7(HEAD 분기 pipefail 제거) 71/1, R8(NUL 삭제) 69/3. 생존 5: R4·R9(HEAD 없는 분기만 변이 — 시험은 항상 HEAD 가 있는 저장소라 미시험), R6(전역 pipefail — 동치), R11(목록 역순 정렬 — 순서 무관이라 동치), R10(첫 파일만 검사하는 `| head -n 1`).
- [08:18] 지적 1 (MINOR, 시험 공백 — 이번 변경이 만든 것은 아니고 기존부터 있음, 비차단) — test-git-hooks.sh 전체: R10 이 생존한다. "비안전 파일이 정렬상 먼저, 안전 파일이 나중"인 혼합 목록 시나리오가 원본 52·Stage 1 62·Stage 2 72 어디에도 없다(원본 훅+원본 시험에 같은 변이를 넣어도 52/52 로 생존, 마지막 파일만 보는 변이는 3개 시나리오가 포착). 훅 자체는 올바르다(혼합 3종 직접 확인, 모두 차단). 그러나 Stage 2 가 바로 이 목록 읽기 줄을 바꿨고, 이 줄이 틀리면 코드+문서가 섞인 대부분의 실제 커밋이 새는 가장 비싼 회귀다. 재현: STAGED 대입 줄 끝에 `| head -n 1` 만 붙여 임시 저장소에서 72/72 유지. 권고: 시나리오 1개 추가(예: AAA/doc.md + src/lib/safety/x.ts, task ID 없음 → 차단). 이 task 에 넣어도 되고 후속으로 미뤄도 된다.
- [08:18] 지적 2 (INFO) — HEAD 없는 분기(commit-msg:329-331)는 시험 밖이다(R4·R9). 동작은 직접 확인했고, 이 저장소에는 커밋이 있어 실제로 타지 않는다.
- [08:18] 지적 3 (INFO) — 실제 shim 경유 첫 실행은 다음 실제 커밋이 된다(Developer 도 명시). 훅 파일은 08:07:20 부터 모든 세션의 커밋에 적용 중이지만 위 재현으로 결함은 찾지 못했으므로 즉시 복구는 필요 없다. 필요해지면 Stage 2 직전 본은 scratchpad/commit-msg.pre-s2-T075(sha256 80a60697…, Stage 1 본과 동일 — 해시 확인함)이다.
- [08:18] 3 실제 커밋 흐름 모사(임시 저장소에서 실제 git commit, hooksPath=scripts/git-hooks, Stage 2 훅) — ① 훅·시험 두 파일 + task 파일 + 한글 이름 vault 메모, 메시지에 T-075, scope 두 파일 → 통과·커밋 생성 ② 훅 파일 + src/app/api/strategies/[id]/route.ts, scope 두 파일 → 차단(대괄호 경로가 목록에 표시됨) ③ 한글 이름의 비안전 vault 메모만, task ID 없음 → 출력 없이 통과·커밋 생성 ④ 한글 이름 안전 파일 src/lib/safety/한글-신규.ts, task ID 없음 → 차단(이름이 원문으로 표시됨). 이 task 자신의 커밋은 scope 가 정확히 `scripts/git-hooks/commit-msg, scripts/test-git-hooks.sh` 이면 통과한다.
- [08:18] 5 Developer 정정의 사실 여부 — ① "cron-runner.sh 단독 → 통과"는 내 예시 오류가 맞다: `^scripts/cron-runner\.sh$` 가 이미 목록에 있어(commit-msg:298) 차단 대상이다. Developer 정정이 옳다. ② 에이전트 셸의 grep 은 함수(ugrep 래퍼)라 훅의 `(^|[^A-Za-z])` 판정어 정규식 결과가 /usr/bin/grep 과 다르다(대문자 판정어가 공백으로 둘러싸인 줄에서 함수 rc 1, 외부 rc 0) — 사실. 함수는 export 되지 않아(BASH_FUNC 0개, `bash -c 'type grep'` 은 /usr/bin/grep) 훅·시험은 영향이 없다. 내 모든 시험도 bash 하위 프로세스에서 실행했다. ③ "quotePath=false 만으로는 따옴표·역슬래시·탭 이름이 여전히 인용된다"는 git 2.34.1 에서 직접 확인했다. Developer 가 pipefail 실패 시 rc 129 라고 쓴 부분은 내 재현(깨진 index)에서는 128 이지만, 핵심(없으면 0)은 같다.
- [08:19] 이전 지적의 해소: 지적 1(인접 경로 시험 공백)은 n1~n3·p1·p2 로 11개 생존 변이를 모두 포착해 해소. 지적 2(비 ASCII 파일명 fail-open)는 -z 로 한글·따옴표·역슬래시·탭이 모두 차단돼 해소(k1~k4). 위험 등급: CRITICAL 0 · MAJOR 0 · MINOR 1 · INFO 2. QA 인계 high_risk_areas: commit-msg:316-331(목록 읽기)와 test-git-hooks.sh:567-627(Stage 2 절). QA 는 이번에도 임시 clone 에서 실행할 것.
- [08:19] **최종 판정: PASS (scope: scripts/git-hooks/commit-msg, scripts/test-git-hooks.sh)**
- [08:28] Codex C2 지적 2건 독립 판정 개시 — Leader 의견 없이 코드로 확인했다. 원본 저장소는 읽기만, 시험·재현·프로토타입은 전부 scratchpad 임시 저장소(t075-rev2)에서만 했다. 작업 트리 sha256 은 훅 40c70ee3…, 시험 45a1b1e8…(Stage 2 본 그대로), stage 0건.
- [08:28] 지적 1 판정 — 채택(사실), 기존 결함. 수정 필요, 이 task 에서 함께 고칠 것을 권고(조건부, 아래). ① 사실관계 — 확실: commit-msg:346 은 `MATCHED="$(printf '%s\n' "$STAGED" | grep -E "$SAFETY_RE")"` 이고 :349 `[ -z "$MATCHED" ] && exit 0` 이 바로 이어진다. 치환의 종료 상태를 어디서도 보지 않으며, 훅에서 "출력이 비면 통과"로 읽히는 유일한 지점이다(다른 grep·awk 는 비면 차단 쪽으로 기운다). 재현(bash 하위 프로세스라 ugrep 함수와 무관): grep 을 항상 실패하는 대역으로 PATH 맨 앞에 두면, 안전 파일(src/lib/safety/x.ts)·task ID 없음 커밋이 대역 rc 2·127·137 모두에서 훅 exit 0 이다(정상 grep 에서는 exit 1). ② 기존/신규 — 확실: HEAD 의 같은 줄(HEAD:commit-msg:310)과 동일하고 원본 훅도 똑같이 통과한다. 이번 변경이 만든 결함이 아니다. ③ 현실 조건: (가) SAFETY_PATHS 편집 오타가 가장 그럴듯하다 — 닫히지 않은 괄호 한 글자(`'^src/lib/db\.ts$('`)면 grep 이 rc 2 로 끝나 모든 커밋이 조용히 통과한다. 재현: 같은 입력이 정상 훅에서는 exit 1, 오타 훅에서는 exit 0(오류는 stderr 한 줄뿐). 이 훅 파일은 오늘만 세 번 교체됐다(Stage 1·1b·2). 시험 스크립트를 돌리면 오타는 곧바로 드러나지만(프로토타입 시험 76개 중 55개 실패) 커밋 경로에서 자동으로 돌지 않는다. (나) grep 강제 종료(OOM)·실행 불가는 확률이 낮다. ④ 영향은 크다(검사가 통째로 꺼짐).
- [08:28] 지적 1 관련 추가 발견(같은 줄·같은 부류, MINOR, 기존) — 비 UTF-8 바이트 이름: Stage 2 의 -z 는 한글(UTF-8)·따옴표·역슬래시·탭을 해결했지만, EUC-KR 같은 비 UTF-8 이름은 UTF-8 로케일(이 사용자 LANG=ko_KR.UTF-8)의 grep 3.7 이 stderr 에 "binary file matches" 만 내고 stdout 은 비운 채 rc 0 으로 끝난다. 재현: 로케일 C.UTF-8 에서 src/lib/safety/<EUC-KR 바이트>.ts 를 stage 하면 훅 exit 0, 로케일 C 에서는 exit 1. 구 훅도 통과였으므로 퇴행은 아니다. 같은 줄을 고치므로 `LC_ALL=C grep -aE` 로 함께 닫는 비용은 사실상 0 이다.
- [08:28] 지적 1 최소 수정안(프로토타입은 scratchpad/hook.fix·test.fix 에 있고 프로젝트 파일은 건드리지 않았다): 훅 :346 을 `MATCHED="$(printf '%s\n' "$STAGED" | LC_ALL=C grep -aE "$SAFETY_RE")"` 로 바꾸고 바로 뒤에 `MATCH_RC=$?` 와 `if [ "$MATCH_RC" -gt 1 ]; then say "❌ [commit-msg] 안전 경로 판별(grep)이 오류로 끝났습니다 (rc=$MATCH_RC) — 안전상 커밋을 차단합니다."; exit 1; fi` 를 둔다(0=매치·1=정상 비매치·2 이상=차단). 시험은 k6(grep 대역 rc 2·127·137 → 차단·안내 문구)과 k7(UTF-8 로케일에서 비 UTF-8 이름 → 차단)을 추가한다. 검증(임시 저장소): 수정본 76 통과/0 실패(72+4). 변이 7개를 적용해 5개가 해당 시나리오에서 포착됐다 — 수정 되돌림 72/4(k6×3·k7), 비교를 `-gt 2` 로 약화 75/1(k6), `-ge 1` 로 과차단 67/9, 오류 분기 exit 0 로 반전 73/3(k6×3), -a 와 LC_ALL=C 를 모두 제거 75/1(k7). 생존 2개는 동치다: `LC_ALL=C` 만 있는 경우와 `-a` 만 있는 경우는 각각 비 UTF-8 이름을 막으므로 한쪽만으로도 충분하다(둘 다 넣어도 무해). 오타 훅에 수정을 적용하면 오류가 소리 나게 모든 커밋을 차단한다(조용한 전면 통과 → 시끄러운 전면 차단, fail-closed). 수정 범위는 commit-msg 약 9줄·test-git-hooks.sh 약 30줄이다.
- [08:28] 지적 2 판정 — 부분 채택: 사실은 맞으나 사용자 결정 범위 밖이라 이 task 의 수정 사항이 아니다(비차단). 별도 사용자 결정으로 올릴 것. ① 사실관계 — 확실: scripts/grant-stockinvest-user.sql 은 NAS MariaDB 관리자가 수동 실행하는 스크립트(CREATE DATABASE IF NOT EXISTS, CREATE USER, GRANT ALL PRIVILEGES ON stockinvest.*, FLUSH PRIVILEGES)이고, scripts/grant-llm-readonly-user.sql 은 외부 서버(home-m4-api)용 읽기 전용 계정(SELECT 만, 주석에 ALL PRIVILEGES 를 외부 서버에 노출하면 위험하다고 명시)을 만든다. 임시 저장소 프로브에서 두 파일 모두 현재 훅을 통과(비차단)한다. 비-migrations 위치에서 DB 쓰기 SQL 문자열을 가진 파일은 이 둘과 시험 파일 하나뿐이라 Codex 가 권고한 "운영 SQL 허용 위치 정책·자동 검사"는 과설계다. ② 범위: 사용자 결정 원문은 "권고대로 추가"였고 task 범위가 권고 3개만 추가하고 나머지는 넣지 않는다고 못 박았으며, grant 파일은 그 권고 목록에 없었다(내가 1차 감사에서 관찰로만 전달). 같은 의도(사람이 공유 DB 에 수동 적용하기 전 감사)의 자연스러운 연장이지만 사용자가 항목을 열거해 승인한 사안이므로 Leader 가 임의로 넣지 말고 사용자에게 한 줄 결정으로 올리길 권한다. 내 권고는 "추가"다(외부 서버 계정의 권한이 감사 없이 넓어질 수 있는 곳이라서). ③ 위험·비용: 변경되면 운영 DB 권한이 바뀌는 SQL 이지만 자동 실행 경로는 없고 사람이 관리자 계정으로 실행하는 마지막 관문이 있다. 두 파일 모두 이력상 커밋 1회(2026-04)뿐이라 오차단 비용은 사실상 0 이다. 항목은 정확 일치 두 개(`^scripts/grant-stockinvest-user\.sql$`, `^scripts/grant-llm-readonly-user\.sql$`) 또는 `^scripts/grant-[A-Za-z0-9_-]+\.sql$` 한 줄이면 된다. ④ 이 task 의 블로킹 여부: 아니다.
- [08:28] 지적 2 관련 부가 발견(범위 밖, 사용자 확인 필요): scripts/grant-stockinvest-user.sql 에 IDENTIFIED BY 뒤 비밀번호 리터럴이 들어 있다. 파일은 "PLACEHOLDER 를 교체하라"고 하지만 값이 PLACEHOLDER 표기가 아니다(같은 폴더의 다른 파일은 CHANGE_ME_… 로 명확히 표기). 실제 운영 비밀번호일 수 있다. 값은 여기 적지 않았고 .env 와 대조하지도 않았다. 사용자가 운영 DB 비밀번호와 같은지 확인하고, 같다면 회전·파일 정리를 별도로 결정해야 한다.
- [08:28] 종합: 위험 등급 — 지적 1 MAJOR(기존·저확률·영향 큼, 수정 쉬움), 비 UTF-8 이름 MINOR(기존), 지적 2 INFO(사용자 결정 사항). 이전 MINOR 1(혼합 목록 시험 공백)과 INFO 2 는 그대로다. 조건: (1) 위 최소 수정(commit-msg 의 종료코드 검사와 `LC_ALL=C grep -aE`, test-git-hooks.sh 의 k6·k7)을 두 파일에 적용하고 (2) reviewer 가 임시 저장소에서 기존 72개와 신규가 모두 통과하고 위 변이가 포착되는지 재확인하면 통과로 되돌린다. 참고: 이 훅은 조건부 판정도 통과로 인식하므로 조건 이행은 기계가 아니라 Leader 가 지켜야 한다. 이미 라이브인 훅이 미커밋이라 다른 세션의 stash·checkout 이 되돌릴 위험이 있으므로, 수정이 길어지면 현재 본을 먼저 커밋하고 수정을 후속으로 돌리는 것도 방어 가능한 선택이다(결함이 기존 것이라 노출이 커지지 않는다) — 단 그 경우에도 후속을 잊지 않도록 task 로 남길 것.
- [08:29] **최종 판정: CONDITIONAL_PASS (scope: scripts/git-hooks/commit-msg, scripts/test-git-hooks.sh)**
- [08:49] 재감사 개시(Stage 3·3b) — 위 조건부 판정은 Stage 2 본까지의 내용이다. 현재 작업 트리 sha256: 훅 957e09ca…(mtime 08:34:49), 시험 63302586…(08:39:18), Developer 보고와 일치. 훅은 Stage 2 본과 346행 한 곳(`346c346,361` — 판별 줄 교체 + 종료코드 검사 + 주석)만 다르고 그 밖 로직 diff 는 0이다(diff 로 확인). 시험은 추가만이고 fixture 범위 문구 2곳이 바뀌었다. 시험은 이번에도 새 scratchpad 임시 저장소(t075-rev4: HEAD fa0669c 의 git archive + 자체 git init)에서만 실행했다. 원본 저장소는 읽기만 했고 stage 0건·HEAD fa0669c 불변.
- [08:49] 1 독립 재현 — 변경 전(HEAD 본) 52/52, Stage 2 본 72/72, Stage 3 본(시험 3b 이전) 76/76, 현재 87/87, 전부 [E2E] 실 커밋 차단·HEAD 불변. Developer 수치와 같다. 기존 시나리오의 -v 출력은 mktemp 경로가 찍히는 k5 의 git 오류 1줄만 정규화하면 바이트 동일하다(Stage 2 본 72개 구간 대 현재 72개 구간, Stage 3 본 76개 구간 대 현재 76개 구간). 말미 빈 줄을 자르면 1425/1463줄이고 Developer 의 1427/1465 는 말미 포함 집계라 같은 내용이다.
- [08:49] 2-ⓐ 로케일 — 확실(실측). C.UTF-8·ko_KR.utf8·C·POSIX·ko_KR.euckr 다섯 로케일 × 9개 입력(UTF-8 한글 이름·EUC-KR 이름·개행으로 쪼개지는 이름·대괄호 경로·정확 일치 파일·이웃 파일·비안전·혼합 목록)에서 현재 훅은 전부 일관되다(차단 입력 7종은 모두 1, 비차단 2종은 모두 0). Stage 2 본은 EUC-KR 이름이 UTF-8 계열 로케일에서 통과했고 UTF-8 한글 이름이 EUC-KR 로케일에서 통과했다 — 현재 훅이 둘 다 막는다. 정규식 의미는 로케일에 따라 달라지지 않는다: SAFETY_PATHS 는 `^`·`$`·`\.`·`/`·리터럴뿐이고 문자 범위·클래스·대소문자 처리가 없다.
- [08:49] 2-ⓑ~ⓓ 종료코드 분기·정상 경로 — 확실. `MATCH_RC=$?` 는 파이프의 마지막 명령(grep)의 상태다(printf 는 내장). 0=매치, 1=정상 비매치(그대로 `[ -z "$MATCHED" ] && exit 0` 로 통과), 2 이상=차단이고 set -u 와는 대입 후 사용이라 충돌이 없다. 대역 grep 이 rc 2·127·137 이면 차단+안내(k6), rc 1 이면 README 만 커밋은 통과한다. 오류 분기는 stderr 안내 + exit 1 이라 기존 차단 규약과 같고 grep 자신의 오류 문구도 남는다(LC_ALL=C 라 영어). 정상 경로가 바뀌지 않음을 차분 시험으로 확인했다: 안전·비안전·이웃·한글·따옴표 이름·대괄호·0~6개 목록 × 메시지 10종(task ID 없음·정상 판정·fail 판정·섹션 없음·다중 task·없는 task 등) 무작위 702건에서 Stage 2 훅과 현재 훅의 종료코드와 출력 전체가 702/702 동일했다. 의도한 유일한 차이는 EUC-KR 이름(UTF-8 로케일에서 Stage 2 본은 통과 → 현재 훅은 차단)이다.
- [08:49] 2-ⓔ 오타 재현 — 확실. `'^src/lib/db\.ts$('` 를 넣으면 Stage 2 훅은 README 만 커밋도 안전 파일 커밋도 exit 0 이고 흔적은 stderr 의 grep 오류 한 줄뿐이다. 현재 훅은 둘 다 exit 1 + "안전 경로 판별(grep)이 오류로 끝났습니다 (rc=2)" + 원인 후보 안내를 낸다 — 조용한 전면 통과가 시끄러운 전면 차단으로 바뀌었다. 복구 경로: shim 이 작업 트리의 훅 파일을 직접 실행하므로 오타를 고치면 커밋 없이 즉시 풀린다. 빈 staged 목록은 판별 전에 종료해 이전처럼 통과한다.
- [08:49] 3 독립 변이 — 훅 변이 17개와 시험·환경 변이 4개, 포착 16/21. 포착: 종료코드 검사 블록 제거(k6×3), `-gt 2`(k6), `-gt 0`(통과 기대 9개), 오류 분기 exit 0(k6×3), MATCH_RC 를 다른 명령 뒤에서 읽음(k6×3), `-ne 1`(18개), `-aF`(63개), STAGED 첫 줄만(m1~m3·m7~m10 등 8개)·마지막 줄만(11개), MATCHED 첫 파일만(m10)·마지막 파일만(z6b·ac2·ad·m11), grep 에 head 파이프(k6×3+m10), `-a` 와 `LC_ALL=C` 를 모두 제거(k7), k6 대역의 실행 권한 제거(k6×3 — 조용히 통과하지 않고 시끄럽게 실패), 그리고 -a·LC_ALL 이 없는 훅을 LC_ALL=C 환경에서 돌려도 k7 이 포착(k7 의 명시적 export 덕에 환경 독립). 생존 5: `-a` 만 제거와 `LC_ALL=C` 만 제거는 둘 중 하나만으로 비 UTF-8 이름이 막히는 동치(Developer 와 같은 결론), 목록 역순 정렬은 판정이 순서와 무관해 동치, HEAD 없는 분기의 pipefail 제거는 시험 밖(아래 INFO), k7 에서 export 를 뺀 변이는 export 가 환경 독립의 근거임을 보이는 대조군이라 생존이 정상이다. Developer 수치(Stage 3 변이 7/7 동치 2 제외, head/tail 6/6)와 내 결과가 모순되지 않는다.
- [08:49] 4 혼합 목록 시나리오 11개 — 의미 확인. git 은 이름을 바이트 순으로 정렬해 내보내므로 stage 순서를 일부러 뒤집어 stage 해도 훅이 보는 순서는 의도와 같다: [docs/aaa.md, 안전 zzz] · [안전 aaa, zzz/notes.md] · [README.md, docs/a.md, 안전 mid, zzz/b.md] · [docs/aaa.md, 안전 aaa, 안전 strategy zzz, zzz/notes.md]. 입력 4종 × 메시지 3종(판정 미기록 T-993, 안전 파일을 덮는 T-995, 안전 파일을 빠뜨린 T-984/T-983)이라 서로 다른 입력-메시지 쌍 11개로 중복이 없다. 기대값은 scope 규칙(staged 안전 파일 전부가 판정 scope 안)과 맞는다 — m10 은 T-995(scope src/lib/safety/)가 strategy 파일을 못 덮고 m11 은 T-983(scope src/lib/strategy/)이 safety 파일을 못 덮는다. 순서 의존 검증은 실증됐다: STAGED 첫 줄만 보는 변이 8개·마지막 줄만 11개·MATCHED 첫 파일만 m10·마지막 파일만 m11 이 각각 포착된다. 이전 MINOR(첫 파일만 검사하는 변이가 생존)는 이제 포착된다. 한계(INFO): 안전 파일 2개 입력에는 "둘 다 덮으면 통과"하는 짝이 없지만 합집합 통과는 기존 (ac) 가 이미 확인한다.
- [08:49] 5 자기 정정 확인 — 확실. 원본 저장소의 훅·시험 파일은 모두 -rwxr-xr-x, git 모드 100755 유지, git diff --summary 에 모드 변경 없음, 해시는 Developer 보고와 같다. 임시 저장소의 실행 권한 소실은 실제 저장소 파일에 영향이 없다. 08:20 이후 vault 밖에서 바뀐 파일은 이 두 파일과 다른 task 의 mockups/T-074-… 뿐이다.
- [08:49] 6 실제 커밋 흐름(임시 저장소에서 실제 git commit, hooksPath=scripts/git-hooks) — ① 훅·시험 두 파일 + task 파일 + 한글 이름 vault 메모 + 문서, scope 두 파일 → 통과·커밋 생성 ② scope 에 훅 파일만 있고 두 파일 staged → 차단(시험 스크립트가 목록에 표시됨) ③ 훅 + strategies/[id]/route.ts → 차단(대괄호 경로 표시) ④ 한글 이름 비안전 메모만 → 통과 ⑤ UTF-8 로케일의 EUC-KR 이름 안전 파일 → 차단 ⑥ 문서가 정렬상 앞서고 안전 파일이 뒤인 혼합 커밋 + 덮는 scope → 통과. 이 task 자신의 커밋은 scope 가 정확히 `scripts/git-hooks/commit-msg, scripts/test-git-hooks.sh` 이면 통과하고 한쪽만 적으면 차단된다. 새 3경로(strategies/·migrations/·db.ts)에 걸리는 미커밋·미추적 파일은 지금도 0건이고 stage 도 0건이다.
- [08:49] 7 이전 MINOR 상태 — 혼합 목록 시험 공백: 해소(m1~m11, 첫 파일만 검사 변이 포착). HEAD 없는 분기 시험 부재: 여전히 열림(INFO) — 동작은 별도 임시 저장소 2곳에서 직접 확인했고(문서만 통과, 한글·EUC-KR 안전 이름 차단) 이 저장소에는 커밋이 있어 실제로 타지 않는다. 그 밖의 INFO: k7 은 C.UTF-8 로케일이 없는 머신에서는 무력해진다(이 머신에는 있음), 실제 shim 경유 첫 실행은 다음 실제 커밋이다. grant-*.sql 경로 추가는 지시대로 이번 판정 범위 밖이다.
- [08:49] 조건 이행 확인 — 직전 조건은 (1) 최소 수정 적용 (2) reviewer 재확인이었다. (1)은 훅 346행의 종료코드 검사와 `LC_ALL=C grep -aE`, 시험 k6·k7 로 이행됐다. 시제품과 다른 두 곳(오류 분기의 원인 안내 1줄, k7 의 명시적 export·복원)은 각각 복구 시간 단축과 POSIX 모드 값 잔존 방지로 정당하다. (2)는 위 재현·차분·변이로 완료했다. 위험 등급: CRITICAL 0 · MAJOR 0 · MINOR 0 · INFO 3. 즉시 복구는 필요 없다. QA 인계 high_risk_areas: commit-msg:346-361, test-git-hooks.sh:628-725. QA 는 이번에도 임시 clone 에서 실행할 것.
- [08:50] **최종 판정: PASS (scope: scripts/git-hooks/commit-msg, scripts/test-git-hooks.sh)**

## Codex 검토

### [2026-10-23 08:20] C2 adversarial-review focus=design_assumption — done
- judge 판정: codex_gate C2 — codex_required: true (override CX-r2-post-review, budget CX-limit-unknown-r2). 이 task 의 `## 판단 기록 (judge)` 에는 해당 줄이 없고, 판정값은 Leader 전달분이다 / 호출 차수: 1/4
- 대상: repo=/home/brownjeon/NFS/homes/brownjeon/project/StockInvest base=fa0669c(task_file) snapshot=2c405a1
- 지적 2건:
  - [medium] scripts/git-hooks/commit-msg:346 — staged 경로를 판별하는 grep 이 자원 부족·실행 실패 등으로 출력 없이 종료할 때 → MATCHED 명령 치환의 종료 상태를 검사하지 않아 빈 문자열이 "안전 경로 없음"으로 해석되고 exit 0 이 된다. 안전 파일이 staged 되어 있어도 Reviewer 감사 없이 커밋될 수 있다 (권고: grep 종료 상태를 0=매치, 1=비매치, 2 이상=차단으로 구분하고 오류 시나리오를 시험에 추가)
  - [medium] scripts/git-hooks/commit-msg:299 — scripts/migrations/ 밖의 운영 SQL(예: 저장소의 scripts/grant-stockinvest-user.sql, CREATE DATABASE IF NOT EXISTS stockinvest 포함)이 변경될 때 → 보호 패턴이 scripts/migrations/ 만 포함하므로 공유 DB 생성·권한 SQL 이 독립감사 없이 바뀔 수 있다 (권고: 정확 일치 안전 경로로 추가하고, 운영 SQL 허용 위치 정책 또는 위치 위반 자동 검사를 도입)
- 검토하지 못한 범위: 상태를 바꾸는 scripts/test-git-hooks.sh 실행은 READ-ONLY 제약으로 수행하지 않았다 / 허용 범위 밖 파일은 보호 범위 판단을 위한 읽기 전용 검색에만 사용했고, 그 파일들의 구현 정확성은 검토하지 않았다
- 원본: /home/brownjeon/NFS/homes/brownjeon/project/.claude/state/codex-review/runs/20261022T231915Z-T-075-C2/raw.txt

## QA

- [08:56] QA 개시 — 대상은 scripts/git-hooks/commit-msg(sha256 957e09ca…, mtime 08:34:49)와 scripts/test-git-hooks.sh(63302586…, mtime 08:39:18). 두 파일 모두 -rwxr-xr-x. 원본 저장소에서는 git archive·show·diff·status(GIT_OPTIONAL_LOCKS=0)·config --get·sha256sum·stat·파일 읽기만 했다. 모든 실행은 scratchpad 의 새 임시 저장소(t075-qa-repo, repo2, repo3, 변형용 사본)에서 했고 임시 저장소의 core.hooksPath·작성자 설정도 그 저장소 로컬에만 넣었다. 감사 시작·끝에 원본 HEAD fa0669c, staged 0, 두 파일 해시 동일, index.lock 없음, vault 의 hooktest fixture 0.
- [08:56] Q1 독립 재현 — 확실(직접 실행). 임시 저장소 = 원본 HEAD 의 git archive + 자체 git init + base 커밋(c28cb3e). 두 파일은 원본 작업 트리 현재본을 cp -p 로 얹었고 복사 전후 sha256 동일. ① bash -n: 임시본·원본 양쪽 두 파일 모두 문법 통과. ② 현재본 `bash scripts/test-git-hooks.sh`: **87 통과 / 0 실패**, [E2E] 실 커밋 차단(exit 1, HEAD 불변), 종료코드 0, 실행 뒤 워킹트리 변경은 두 파일뿐(fixture 잔존 0). 기대 87/87 과 일치. ③ HEAD 본 훅(7f495486…)+HEAD 본 시험(ec2e9e5f…): **52 통과 / 0 실패**, E2E 차단 정상. 대조로 HEAD 훅+현재 시험을 돌리면 68 통과 / 19 실패 — 새 시나리오가 새 훅 동작에 실제로 의존한다. ④ 원본 저장소 index 비어 있음(staged 0), HEAD fa0669c 불변.
- [08:56] Q2 훅 파일 무결성 — 확실. core.hooksPath=/home/brownjeon/.local/share/stockinvest-git-hooks/361294826755(ext4 로컬 디스크). shim 은 -rwxrwxr-x(08-16 생성)이고 내용은 `exec bash "$SRC"`(SRC=원본 작업 트리의 scripts/git-hooks/commit-msg)다 — 원본이 NFS noexec 라도 bash 가 읽어 실행하므로 실행 비트는 무관하고, 작업 트리 파일을 교체하면 모든 세션에 즉시 적용된다. 원본 두 파일 bash -n 통과·권한 755·git 모드 100755 유지. 문법·권한으로 다른 세션 커밋이 막히는 상태가 아님을 두 방식으로 확인했다: (a) 실제 shim 을 임시 저장소에서 호출(훅은 cwd 의 저장소를 보므로 원본 저장소를 건드리지 않음)해 비안전 커밋 통과·안전 커밋 차단/통과가 정상, (b) 임시 저장소에 core.hooksPath=실제 shim 경로를 걸고 실제 `git commit`: 새 3경로 + task ID 없음 3회 모두 차단(exit 1, HEAD 불변), 유효 판정 인용 시 통과·커밋 생성, 문서 전용은 출력 없이 통과. 이 훅은 아직 미커밋이라 다른 세션의 stash·checkout 으로 옛 본으로 되돌아갈 수 있다(감사가 이미 지적, 커밋이 최선의 완화).
- [08:56] Q3 새 규칙 E2E — 확실. 기존 시험 스크립트와 별개로 내가 만든 시나리오 47개를 실제 shim 경유로 실행: **47/47 기대대로**. 새 3경로(`src/app/api/strategies/[id]/route.ts`·`scripts/migrations/T-0xx-test.sql`·`src/lib/db.ts`) 각각: task ID 없음·판정줄 없는 task·fail 판정·이웃 scope(`src/lib/db/`·`scripts/migrations-old/`·`strategies-foo/`)·디렉토리 scope 에 끝 `/` 없음·없는 task ID → 전부 차단, scope 포함 유효 판정 → 통과(통과 문구 확인). db.ts 는 정확 파일 scope(`src/lib/db.ts`)로도 통과, `strategies/` 만 덮는 판정은 migrations 를 못 덮어 차단, 합집합(T-906+T-908)은 통과하고 한 경로 모자라면 차단. 인접 경로 `db.ts.bak`·`db.tsx`·`dbx.ts`·`db/index.ts`·`strategies-foo/x.ts`·`migrations-old/x.sql`·`scripts/other.sh`·`docs/scripts/migrations/x.sql`·`mockups/src/app/api/strategies/route.ts` → 판정 없이 출력 없이 통과(안전 경로로 인식되지 않음; 안전 경로면 같은 조건에서 차단 배너가 나온다). 한글 `src/lib/safety/한글.ts`·`scripts/migrations/한글.sql`·`strategies/한글/route.ts` → 차단, 비안전 `docs/한글.md` → 통과, 한글 안전 파일은 scope 맞는 판정이면 통과. 혼합 목록(비안전이 정렬상 앞·뒤)도 차단/통과가 정확. 삭제(`git rm --cached`)와 rename(안전→비안전)도 옛 경로가 목록에 잡혀 차단(db.ts·migrations·strategies 각각 확인). 로케일 C·C.UTF-8·ko_KR.utf8·POSIX × (UTF-8 한글·EUC-KR 바이트 이름·비안전 한글) 12조합 모두 일관(앞 둘은 1, 뒤 하나는 0). **오타 시나리오**: SAFETY_PATHS 에 `'^src/lib/db\.ts$('`(닫히지 않은 괄호) 또는 `'^src/app/api/strategies/[id'`(닫히지 않은 대괄호)를 넣은 훅 사본은 README 만 커밋·안전 파일·유효 판정·문서까지 4입력 모두 **exit 1** + "안전 경로 판별(grep)이 오류로 끝났습니다 (rc=2)" + 원인 후보 안내를 낸다 — 조용한 통과가 아니라 시끄러운 전면 차단.
- [08:56] Q4 15:40 이후 커밋 모사 — 확실. 임시 저장소(repo3)에 요청한 9개 파일(훅·시험은 현재본, T-075/T-074/T-076/T-072 task 문서·mockups/T-074 목업·board.md 는 원본 작업 트리 현재본, HANDOFF-2026-10-22.md 는 한 줄 덧붙인 사본)을 staged 하고 실제 shim 으로 검사했다. staged 중 안전 경로에 걸리는 것은 **정확히 2개: scripts/git-hooks/commit-msg, scripts/test-git-hooks.sh**(기존 항목 `^scripts/git-hooks/`·`^scripts/test-git-hooks\.sh$`). 나머지 7개(agent-vault·mockups)는 새 3경로·기존 38개 어디에도 걸리지 않는다. 결과: 메시지에 T-075 만 있으면 **통과**(`Reviewer 감사 기록 확인: T-075`), T-072·T-074·T-076 을 함께 적어도 통과(T-072 도 유효 판정으로 인식돼 scope 합집합에 들어갈 뿐 차단 요인이 되지 않음), 소문자 t-075 도 통과, 실제 `git commit` 도 exit 0 으로 커밋 생성. 대조군: task ID 없음 → 차단, T-074 만 인용 → 차단(그 문서에 감사 섹션이 없음). 다른 task 문서의 감사 섹션 파싱이 이 커밋을 막을 위험은 없다 — 그 문서들은 메시지가 인용할 때만 읽힌다(T-072 문서는 4단계 소제목에 'Reviewer' 단어가 있어 섹션 스캔이 넓지만 지금 판정 결과에는 영향 없음). **Leader 주의**: (1) 훅은 task 문서를 index 가 아니라 작업 트리에서 읽고 `## Reviewer` 섹션의 마지막 '최종 판정' 줄만 본다 — T-075 문서의 마지막 판정은 08:50 줄(scope 두 파일)이어야 하며, 그 뒤에 감사 섹션 소제목이나 같은 단어가 든 줄을 새로 넣으면 판정이 바뀐다. (2) 이 QA 섹션은 감사 섹션이 아니라서 판정에 영향이 없다(추가 후 repo3 에서 재확인함 — 아래 줄). (3) scope 두 파일 중 하나라도 빠지면 차단되므로 커밋은 두 훅 파일을 한 커밋에 담아야 한다.
- [08:56] Q5 타 세션 영향 — 확실(원본 `git status --porcelain=v1 -z --untracked-files=all` 74건을 훅 배열 38개 정규식으로 계산). staged 0건. **새 3경로(db.ts·strategies/·migrations/)에 걸리는 변경 0건.** 어떤 안전 경로에든 걸리는 것은 16건: 이 task 자신의 두 훅 파일, 그리고 기존 항목에 걸리는 타 세션 변경 14건 — src/app/api/cron/news-fetch/route.ts, src/app/api/settings/credentials/test/route.ts, src/lib/auth/kis-verify.ts, src/lib/auth/oauth/providers.ts, src/lib/exchanges/fx.ts·kis-http.ts·kis-master.ts, src/lib/notify/telegram-api.ts, src/lib/strategy/ai-filter.ts·market-context-client.ts(이상 수정 10건), src/lib/exchanges/__tests__/ 아래 미추적 4건(kis-http-usage.test.ts·kis-order-usage-scenario.ts·kis-usage-isolation.test.ts·kis-usage-scenarios.ts). 이 14건은 T-075 와 무관하게 원래 감사 대상이다(API 사용량 계측 계열로 보이며 T-040 문서가 미추적 상태) — 해당 세션이 커밋할 때 자기 task 의 감사 판정(scope 에 위 경로 포함)이 필요하다. T-075 로 새로 판정이 필요해지는 파일은 지금 없다.
- [08:56] Q6 문서 정합 — 확실. ① 개발 기록의 변경량: 훅 +56/−5, 시험 +262/−5(git diff --numstat)는 단계별 기록의 합과 정확히 맞는다(훅 28+12+16 / 삭제 2+2+1, 시험 80+21+63+47+51 / 삭제 2+3). 기존 항목 삭제·변경 0 — 배열 diff 는 추가 3줄뿐, 개수 35→38, 위치 commit-msg:271·291·299 가 기록과 같다. 코드 변경 비주석 줄은 배열 3줄 + STAGED 2줄 + MATCHED/MATCH_RC/분기 몇 줄뿐이다. ② 시험 머리말 8~28행의 경고가 코드와 일치: 로직 단계는 GIT_INDEX_FILE 임시 index(8곳), fixture 는 실제 작업 트리에 쓰고 EXIT trap 으로 지움, E2E 는 실제 index 에 가짜 blob 을 올려 `git commit` 을 시도하고 `git read-tree HEAD` 로 index 전체를 덮어씀(782행), 시작 전 stage 가 있으면 건너뜀(759행), 커밋이 생기면 `reset --soft`(786행). fixture 범위 문구 T-983~998 도 사용 ID 와 맞다. 사소한 부정확 하나는 감사가 이미 지적한 대로 머리말이 hooksPath 미설정 시 E2E 를 '건너뛴다'고 읽히나 실제로는 exit 1(754행).
- [08:56] 결함 목록 — CRITICAL 0 · MAJOR 0 · MINOR 0 · INFO 3. INFO-1 (commit-msg:355-361): 이번 grep 종료코드 가드는 **문법 오류가 나는 오타**(괄호·대괄호 짝)만 막는다. 문법은 유효하지만 뜻이 바뀌는 오타는 조용히 안전 항목을 약화시킨다 — 재현: `'^scripts/migrations/\'` 로 바꾼 사본은 `\|` 가 리터럴 `|` 로 읽혀 migrations 와 git-hooks 두 항목이 융합돼, task ID 없는 scripts/migrations/x.sql·scripts/git-hooks/commit-msg 커밋이 exit 0 으로 통과한다(db.ts 는 여전히 차단). 같은 사본으로 새 시험 스크립트를 돌리면 81 통과 / 6 실패로 즉시 드러나지만, 시험은 커밋 경로에서 자동 실행되지 않는다. 훅 파일을 고친 직후 시험을 돌리는 규율이 유일한 방어다 — 이번 변경이 만든 결함이 아니고 수정 요청이 아니다. INFO-2 (test-git-hooks.sh): fixture 이름 T-986·T-987 이 서로 다른 시나리오에서 중복 사용된다(HEAD 본에도 있던 기존 구조, 시험 결과에 영향 없음). INFO-3: 이 저장소에서는 test-git-hooks.sh 를 한 번도 실행하지 않았다(지시) — 그래서 '실제 shim 경유 + 실제 저장소 index' 조합의 E2E 는 확인하지 못했다.
- [08:56] 확인하지 못한 것 — (1) 실제 저장소에서의 test-git-hooks.sh 실행(index 를 쓰므로 금지됨; 임시 저장소에서 같은 바이트로 87/87·E2E 차단 확인으로 대체). (2) 실제 저장소에서의 실 `git commit`(지시상 금지) — 같은 shim·같은 훅 바이트를 임시 저장소에서 실제 git commit 으로 실행한 것으로 대체했다. (3) 15:40 이후 실제 커밋 시점의 task 문서 최종본·실제 커밋 메시지 — 지금 시점의 문서 사본으로 모사했으며, 그 사이에 T-075 문서의 감사 섹션 마지막 '최종 판정' 줄이 바뀌면 결과가 달라진다. (4) HEAD 가 없는 최초 커밋 분기(시험 밖, 이 저장소에는 해당 없음). (5) Windows/다른 머신의 shim 설치 상태.
- [08:56] Q4 재확인 — 위 QA 섹션을 덧붙인 뒤의 T-075 문서 현재본을 새 임시 저장소(repo5, repo3 와 같은 9개 파일 구성)에 얹어 다시 검사했다: 감사 섹션의 마지막 '최종 판정' 줄은 여전히 08:50 줄(scope 두 훅 파일)이고, 실제 shim 훅 exit 0·실제 git commit exit 0 으로 커밋이 생성됐다. QA 섹션의 추가는 훅 판정에 영향이 없다(내 섹션에는 대문자 판정 리터럴이 마지막 줄 외에 없고, 제목에 감사 단어도 없다). 임시 저장소는 모두 scratchpad(t075-qa-*)에 있으며 원본 저장소는 시작부터 끝까지 변하지 않았다(HEAD fa0669c, staged 0).
- [08:56] **QA 판정: PASS (범위: Q1 임시 저장소 재현 87/87·HEAD 본 52/52·원본 읽기 검증, Q2 shim 경유 실행·문법·권한, Q3 새 3경로·인접·한글·혼합·삭제/rename·로케일·오타 E2E 47건과 실 커밋, Q4 커밋 모사, Q5 타 세션 명단, Q6 문서 정합 — 실제 저장소에서의 test-git-hooks.sh 실행과 실제 저장소 실 커밋은 지시상 미실행)**
