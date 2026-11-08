---
task_id: T-113
title: 챗봇 대화 소유권과 서버 인가
status: done
waiting: "사용자 화면 확인 — /ai 에 기존 대화 **13건**이 보이는지(2026-11-06 23:19 백필 후). 2026-11-08 사용자가 실기기에서 비서 챗봇 화면을 확인했으나 대화 건수는 항목별 보고가 없다."
project: StockInvest
created: 2026-11-04
updated: 2026-11-06
execution_context:
  schema_version: 1
  origin_tool: unknown
  current_tool: claude
  current_procedure: claude_standard
  current_scope: "재개 — 막힌 운영 이관(차단·drain·실백업)의 전제 재검토와 단일 사용자 조건의 대안 순서 제안. 운영 DB 변경·배포·서비스 조작 제외"
  last_event_id: exec-002
base_ref: 41cc3c0e9661d5b5bb00f002cb5bef07111042be
risk_level: R2
roles_involved: [leader, judge, developer, reviewer, qa]
related_tasks: [T-108, T-152]
tags: [type/task, domain/security, domain/adoption]
aliases: [ADP-010-C01-ownership]
---

# T-113 챗봇 대화 소유권과 서버 인가

- 사용자 지시: StockInvest 챗봇 실제 연동의 선행 조건인 T-113 소유권·서버 인가를 확인하고 진행한다.
- 목표: 로그인한 사용자만 자신의 대화를 읽고 쓰고 삭제하며, 타인 또는 미분류 대화에 대한 접근 및 LLM 호출 전에 서버에서 거부한다. 기존 채팅 업무 기능을 보존한다.
- 범위: 대화 API 서버 인가·소유권, 스키마 및 수동 이관안, 격리 시험. 화면·비서 탭·T-152 실제 연결, 운영 DB/설정 변경·주문·운영 배포는 별개다.
- 기존 이력: 2026-08-04 승인 멀티유저 설계 `docs/superpowers/specs/2026-08-04-multi-user-kis-accounts-design.md`는 chat_threads/chat_messages의 과거 행을 첫 가입자에게 일괄 귀속하는 계획을 적었다. 운영 읽기 전용 집계(22:28) 사용자 1명·대화 13건·메시지 32건은 확인했으나 역사적 첫 가입자 동일성·각 대화 소유권 및 과거 계획의 적용 가능성은 미확인. 과거 승인을 없는 것으로 취급하지 않되 미확인 상태에서 임의 귀속·삭제하지 않는다. 이관·롤백은 사용자에게 검토 가능한 구체안으로 준비한다.
- 경계: 기존 이력 귀속의 실행 가능성 판단을 위한 운영 DB 스키마·행 수·첫 가입자 순서의 최소 집계만 읽기 전용으로 확인한다. 대화 본문·식별 개인정보는 읽지 않는다. 운영 DDL·백필·배포는 수행하지 않는다. 운영과 개발이 DB를 공유하므로 쓰기 시험은 격리 일회용 DB·모의 테스트만. 관련 코드 이외의 기존 병행 변경을 유지한다.
- 관련 과거 이력: T-108은 T-113 소유권 배포 뒤 비서 탭을 노출; T-152 공통 UI는 격리 합성 시범이며 실제 연결 전 T-113 선행. `issues related 인증 소유권 대화`: 관련 승인 교훈 없음.

## 실행 도구·절차 이력

| 이벤트 ID | 시각(KST) | 사건 | 이전 → 현재 담당 / 현재 절차 | 범위·인계 대상·남은 일 | 근거 |
|---|---|---|---|---|---|
| exec-001 | 2026-11-06 22:40 기록 | metadata_corrected | unknown → unknown / unknown | 2026-11-04 작성분의 최초 시작 도구 미확인. 「Codex 모델 라우터」·「Claude 검토」 절은 정황일 뿐 시작 근거가 아니어서 단정하지 않음 | 규약 `docs/task-tool-context.md` §5 |
| exec-002 | 2026-11-06 22:40 | resume | unknown → claude / claude_standard | 이관 전제 재검토·대안 순서 제안까지. DDL·백필·push 는 사용자 결정 대기 | 사용자 지시 「T-113 먼저 진행」(Claude Code 데스크톱 세션, T-152 후속 선택지에서) |

## 판단 기록 (judge)

- Jev intake `judge-result@2` R2, feature, complexity 2.9, needs_info=true, next=ask_user, demo=delta. 사용자가 소유권·서버 인가 착수를 명시했고 현재 작업은 실제 DB 변경 없이 기존 데이터 보존·인가 구현·이관안 작성으로 진행 가능하다: `override: user_scope_explicit`. 실제 변경 범위는 서버 API·DB 이관안·시험이며 화면 파일/메뉴/UI 행동 변경은 범위 밖이므로 `override: backend_only_no_screen_change`; UI 연동·메뉴 공개 때는 별도 데모 게이트 적용. 운영 이관의 기존 승인 요건은 유지한다.

- Codex 모델 라우터 결과 `gpt-6.1-sol` (complexity 2.9 / threshold 1.5). Agent 도구 호출은 상위 모델 상속으로 실행했으므로 결과 모델 명시 배정으로 주장하지 않는다.

## Leader

- 장시간 LLM 호출 전 소유권 확인, 결과 저장 시 재검증과 삭제 경합, 미마이그레이션 fail closed를 중점 설계한다. schema와 API 작업 파일을 구분한다.

## Developer

- 스키마 초안: `chat_threads.user_id` nullable, 기존 NULL 보존, 메시지는 부모 소유권으로 스코핑. 신규 DB의 CREATE 정의와 수동 DDL 제안만 작성하며 기존 테이블 자동 ALTER·백필 없음. 과거 승인된 양 테이블 user_id/첫 가입자 귀속과 다른 중간안이므로 차이와 운영 이관 조건은 별도 설계에 기록. 실제 DB 사용 없음. 채팅 API 세션·사용자 존재·소유권 범위 및 LLM 전후 검사, 짧은 트랜잭션에 의한 재검증·원자 저장과 테스트 구현 완료. 상세 QA는 아래를 따른다.

## Reviewer

- 독립 정적 감사 PASS: 삭제 계정 유효 세션 차단, 안전하지 않은 BIGINT 출력/생성 rollback, 채팅 전 라우트 owner 범위와 LLM 전·후 재검증 등 확인. 기존 이력 NULL 비노출 및 8월 승인 이관안과 차이, 운영·MariaDB·실세션·롤백 혼재는 미검증이므로 실제 적용 PASS 아님.
- [22:59] **2026-11-06 재개 감사(독립, 코드·문서 읽기만 — 운영 DB·서비스 접근 없음, 코드·설계 문서 무수정).** 대상: 「재개 검토 — 단일 사용자 조건의 이관 순서 대안」과 「사용자 결정과 T-152 후속 영향 점검」.
- [22:59] [사실] 구버전(git HEAD `8984f69`) 호환성 반증 시도 — 반증 실패(=대안 순서의 전제 성립). `git grep -i chat_threads|chat_messages HEAD`(문서·agent-vault·md 제외, 저장소 전체)가 히트하는 비문서 파일은 `src/lib/db.ts`(CREATE)와 `src/app/api/chat/**` 5개 라우트뿐이다. 스크립트·cron·`packages`·`android` 쪽 작성자 0건. 구버전의 chat_threads 문장은 전부 열 이름 명시(`SELECT id`/`SELECT id,title`/컬럼 나열 SELECT, `INSERT (title, symbol)`, `UPDATE … SET message_count…, title`, `UPDATE … SET ${fields}`(fields 는 title·archived 만 조립), `DELETE … WHERE id=?`), `SELECT *`·`t.*` 없음. 따라서 nullable `user_id` + 복합 인덱스 추가는 구버전 읽기·쓰기를 바꾸지 않고, 구버전이 만든 새 대화는 NULL 로 남는다. DDL 은 `ADD COLUMN … NULL DEFAULT NULL`+`ADD INDEX` 단일 ALTER(+`lock_wait_timeout=5`)이고 행 값·`updated_at` 을 건드리지 않는다. 한계: 저장소 밖 서버 crontab·DB 백업 도구·수동 쿼리는 이 증명에 포함되지 않는다.
- [22:59] [사실] 신규 코드(작업 트리) 소유 로직: 5개 라우트 전부 `requireChatUser`(서명 세션 → `findUserById` 로 계정 존재 확인, DB 오류는 전파=fail closed) 선행. 목록/메시지/draft/messages POST 모두 `INNER JOIN users` + `t.user_id = ?` 라 NULL 대화는 목록·읽기·쓰기·LLM 호출 모두 404 로 숨겨진다. 대화 생성은 `INSERT … (title, symbol, user_id) SELECT ?, ?, u.id FROM users u WHERE u.id = ?` 로 항상 소유자를 채우고(affectedRows≠1 이면 401 롤백), PATCH/DELETE 도 `user_id = ?` 조건이라 신규 코드는 NULL 행을 만들지도 건드리지도 않는다 → ④ 이후 생기는 NULL 행의 유일한 출처는 아직 살아 있는 구버전뿐이다. messages POST 는 LLM 전 소유 확인 → LLM 대기(트랜잭션 밖) → 짧은 트랜잭션에서 `FOR UPDATE` 재확인 후 INSERT 2건+UPDATE → 안전하지 않은 ID 면 롤백(503). 열이 없을 때: 모든 문장이 `t.user_id` 를 참조하므로 `Unknown column` 으로 즉시 500(데이터 노출 없음, 채팅만 중단) → **DDL 이 배포보다 먼저**여야 한다는 요구는 코드로 확인됨. `setupDB` 의 `CREATE TABLE IF NOT EXISTS chat_threads` 는 기존 테이블에선 no-op 이고 `ALTER … chat_threads`/`SET user_id` 문장은 db.ts 에 없다(계약 테스트가 정적으로 보장). 코드 롤백: 구버전은 열을 읽지도 쓰지도 않으므로 안전하고, 남는 `user_id` 값·인덱스는 무해하다(배포 시스템도 `health_failed` 시 자동 이전 릴리스 복귀).
- [22:59] [사실] 백필 `UPDATE chat_threads SET user_id=?, updated_at=updated_at WHERE user_id IS NULL`: 단일 문장이라 InnoDB 에서 원자적이다. `chat_messages` 에는 소유자 열이 없고 UPDATE 대상이 아니라 불변, `message_count`·`archived`·title 도 SET 에 없다. `updated_at` 보존은 QA(2026-11-04, MariaDB 10.11.11 = 운영 버전, 18 assertion)가 이 표현식으로 실측했다(코드로는 재확인 불가, 재실행 안 함). 진행 중이던 구버전 요청이 배포 뒤 끝나는 경우: messages POST 는 기존 대화에 `chat_messages` 2행+`UPDATE message_count/title` 만 하고 대화를 만들지 않는다(대화 생성 `POST /threads` 는 LLM 없는 즉시 쓰기라 장시간 잔존 요청이 아님). 이 효과는 NULL 행에 대해선 ⑤ 이전이면 무해하고, ⑤ 이후면 이미 귀속된 행의 `message_count`·`updated_at` 만 갱신한다(귀속은 유지).
- [22:59] [Medium, 운영 절차] ⑤ 의 `<재측정 ID>` 리터럴 UPDATE 는 사용자 수·대상 존재를 문장 안에서 재확인하지 않는다. 가입은 초대코드가 필요해 가능성은 낮지만, ①~⑤ 사이 사용자가 늘면 NULL 행을 옛 단일 사용자에게 귀속할 수 있다. 권고(구현 변경 아님, 실행 절차): 같은 연결에서 `START TRANSACTION` 후 `SELECT COUNT(*) FROM users`=1 과 `SELECT id` 일치를 확인하고 `UPDATE … WHERE user_id IS NULL AND (SELECT COUNT(*) FROM users)=1`, `ROW_COUNT()` 를 「그 시점 재측정한 NULL 행 수」와 대조한 뒤 COMMIT. 대조 기준을 11-04 실측 13 이 아니라 ⑤ 직전 재측정값으로 해야 한다(④~⑤ 사이 구버전이 만든 NULL 행이 있을 수 있음). 또 「구버전 종료 확인」은 포트 3003 의 `next-server` PID/cwd 가 새 릴리스 하나뿐임을 확인하는 것이어야 하고, ⑤ 뒤 `COUNT(user_id IS NULL)=0` 을 재확인해야 한다(앱이 `0.0.0.0` 바인딩이라 구 프로세스가 남으면 직접 접근 가능). 이 항목은 본 판정의 조건이다.
- [22:59] [Medium, 커밋 구성] 조정자 후보 목록은 `src/lib/chat/__tests__/t113-*.test.ts` 3개를 포함하지만 `t113-backfill-contract.test.ts` 는 `scripts/migrations/T-113-chat-ownership-backfill.mjs` 를 `spawnSync` 로 실행하는데 그 스크립트는 커밋하지 않기로 했다. 그대로 커밋하면 이 테스트 3건이 저장소에서 실패하는 상태가 된다(jest `testMatch` 가 `src/**` 전체를 잡음; tsconfig 는 `__tests__` 를 제외하므로 `next build` 는 영향 없음). 권고: 이 테스트는 backfill 스크립트와 함께 두거나 커밋에서 뺀다. 나머지 2개(`t113-ownership-routes`, `t113-migration-contract`)는 커밋 대상 파일만 읽는다(`db.ts`, `T-113-chat-ownership.sql`, 라우트).
- [22:59] [Low] ④~⑤ 사이 기존 대화 13건이 목록에서 사라져 보인다 — 메인 세션이 이미 기재한 사용자 영향이며 fail closed 의 정상 동작이다. ⑤ 를 ④ 직후 바로 이어 하면 몇 분 이내다.
- [22:59] [Low] 백필 롤백은 테이블 복원이 아니라 `docs/design/T-113-backup-restore.md` §4 의 정확한 행 단위 소유자·시각 복원이어야 한다(`chat_threads` 를 DROP/복원하면 `chat_messages` FK `ON DELETE CASCADE` 로 메시지가 사라질 수 있음). 문서가 이미 「백업 전체를 운영 DB 에 자동 복원하지 않는다」로 명시하고 있어 절차 숙지만 확인하면 된다(문서 §4 는 본 감사에서 정독하지 않고 grep 으로만 확인).
- [22:59] [사실] 「T-152 후속 영향 점검」 판정(막는 특이사항 없음) 동의. 근거 재확인: 신규 라우트의 성공 응답 필드는 구버전과 같다(threads `{id,title,symbol,createdAt,updatedAt,messageCount,archived}`, POST `{ok,id}`, messages 필드 동일; 차이는 ID 가 안전 정수가 아니면 503). 기존 `src/app/ai/ChatPage.tsx`(HEAD 와 작업 트리 동일, 변경 없음) 정적 확인: 모든 호출이 `await r.json()` 후 `d.ok` 검사이고 401/404/503 응답도 `{ok:false,error}` JSON 이라 **깨지지 않는다** — 초기 목록·모델·메시지 로드는 `d.ok` 가 아니면 조용히 무시(빈 목록 유지, 재로그인 안내 없음; 페이지 자체는 middleware 가 /login 으로 보냄), 전송 경로(`handleSend`/`handleConfirmDraft`)는 `setError(d.error)` 로 `thread not found`/`unauthorized` 를 표시, DELETE 는 결과를 보지 않고 로컬 목록에서 제거(404 여도 화면만 제거, 해로움 없음), PATCH 호출은 이 화면에 없다. 보완 6항목은 타당하다. 추가 보완 후보(차단 아님): (a) 503 은 `unsafe identifier` 와 `auth_not_configured` 두 의미이므로 어댑터는 상태코드가 아니라 `error` 문자열로 구분한다. (b) 열이 없는 배포 순서 오류나 서버 500 은 JSON 이 아니라 `r.json()` 이 던진다 — 기존 ChatPage 의 초기 로드 `fetch().then(r=>r.json())` 과 `handleSend` 의 `ensureThread`(try 밖)는 이를 잡지 않아 처리되지 않은 Promise 거부가 되고 화면에는 아무 표시가 없다. 현재 화면은 그대로 두는 배포이므로 영향은 DDL 선행 순서를 지키면 없다(Low). (c) 메시지 GET 404 시 이전 대화의 `messages` 가 화면에 남는다(Low, T-152 연결 시 처리).
- [22:59] [사실] 11-04 정적 통과 판정 이후 변경 여부: T-113 관련 작업 트리 파일의 수정 시각이 모두 11-04 22:13~23:30(ownership.ts 22:19, 라우트 22:19, db.ts 22:13, DDL 22:14, 라우트 테스트 22:20)이고 11-06 이후 수정 흔적 없음. 단, 미커밋 파일이라 git 이력으로 통과 판정 시점 대비 내용 동일성은 증명할 수 없고, QA 의 11파일 매니페스트 해시는 정규화 방식을 몰라 재현하지 못했다. base `41cc3c0..HEAD` 20커밋(과업 서술은 19; 개수 불일치는 서술 오차)의 비문서 변경은 `src/lib/safety/kill-switch.ts`·그 테스트·`TradeLogPanel.tsx`·`EvalFunnelCard.tsx`·`t108-trade-render.test.ts` 5개뿐이고, `src/app/api/chat`·`src/lib/chat`·`src/lib/db.ts`·`src/lib/auth`·`src/middleware.ts`·`src/app/ai`·`scripts/migrations` 는 base→HEAD 사이 diff 0. 조정자 메모의 `origin/main 6d15894`(HEAD 보다 9커밋 앞)도 로컬 ref 로 대조했다: 비문서 변경은 `src/app/api/settings/safety/autopilot/**`·`src/app/settings/**`·`src/lib/signals/**` 뿐이고 위 채팅 경로와 `src/lib/db.ts` 는 HEAD↔origin/main diff 0 이라 작업 트리 변경이 그대로 얹힌다.
- [22:59] [미검증] 현재 HEAD(또는 origin/main) 기준 jest·tsc 재실행(QA 24/24·8/8 은 base 기준 사본), 운영 DB 실제 상태·앱 계정의 ALTER/INDEX 권한, 배포 시 `stockinvest-cron` 동반 재시작의 매매 영향(배포 게이트 소관), 운영 `next-server` 단일성, MariaDB 에서 `updated_at=updated_at` 재실측, `docs/design/T-113-cutover-access-drain.md`·`T-113-chat-ownership-migration.md` 정독(판정 근거에 쓰지 않음).
- [22:59] **최종 판정: PASS (scope: src/app/api/chat/models/route.ts, src/app/api/chat/threads/route.ts, src/app/api/chat/threads/[id]/route.ts, src/app/api/chat/threads/[id]/messages/route.ts, src/app/api/chat/threads/[id]/draft/route.ts, src/lib/chat/ownership.ts, src/lib/db.ts, scripts/migrations/T-113-chat-ownership.sql, src/lib/chat/__tests__/t113-migration-contract.test.ts, src/lib/chat/__tests__/t113-backfill-contract.test.ts, src/app/ai/ChatPage.tsx; 읽기 전용 참조: HEAD 전체 git grep, base..HEAD·HEAD..origin/main 변경 파일 목록)** — 이관 순서(재측정→백업→DDL→배포→백필→확인)는 구버전 호환·신규 코드 fail closed·DDL 선행 요건이 코드로 확인되어 안전하다고 판단한다. Critical 0·High 0·Medium 2·Low 3. 조건: 위 ⑤ 가드·종료 확인(Medium)과 커밋 구성(Medium)을 실행 전에 반영할 것. 본 판정은 DDL·백필·배포 실행 승인이 아니며 `docs/design/T-113-*.md` 와 `T-113-chat-ownership-backfill-plan.sql` 은 scope 밖이다(db.ts 는 chat_threads 정의 부분 diff 와 ALTER 부재 확인만).

- [00:20] **2026-11-07 후속 커밋 감사(독립, 코드·문서 읽기와 서버 시험 2건만 — 운영 DB·서비스 접근 없음, 코드·문서 무수정).** 이 감사의 범위는 사용자 지시 「T-113 미커밋 산출물 커밋 및 푸시」로 추가될 파일(operator·backfill·drill 스크립트 6개, 백필 계약 시험, 설계 문서 4개, 인계문, 이력서)뿐이다. 앞선 c33e467 커밋(소유권 코드·DDL) 때의 판정과는 별개이며, 아래 마지막 판정 줄이 이번 커밋 범위의 판정이다.
- [00:20] [사실] 자동 실행 경로 없음. `package.json` scripts(dev/build/start/lint/typecheck/test)는 `scripts/migrations/`를 참조하지 않는다. `deploy.yml`의 migrate 는 주석(미사용)이고 build 는 `npm ci` + `next build`뿐이다. `ecosystem.config.js` 두 앱은 `next start`·`scripts/cron-runner.sh`이며 cron-runner 와 git-hooks 는 migrations 를 glob 하지 않는다. 훅 문서(commit-msg L254)도 「배포가 자동 실행하지는 않는다」고 적었다. `tsconfig.json`은 `allowJs:false`라 `.mjs` 를 타입검사에 넣지 않고 `__tests__`·`*.test.ts` 를 제외한다.
- [00:20] [사실] 루트 jest(`roots:[src]`, testMatch `**/*.test.ts`)는 `t113-backfill-contract.test.ts` 만 수집하고 `T-113-operator.test.mjs`(scripts/ 아래, `.mjs`)는 수집하지 않는다. 후자는 `node --test` 로 수동 실행하는 시험이다(package.json 에 연결 없음). 서버(`home_ubuntu`, node v24.22.2)에서 공용 락 + `env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp TZ=Asia/Seoul` 로 직접 실행: jest `src/lib/chat/__tests__/t113-backfill-contract.test.ts` 3/3 통과(0.27s), `node --test scripts/migrations/T-113-operator.test.mjs` 7/7 통과. 두 시험 모두 DB 연결을 만들지 않는다(계약 시험은 소켓 정규식 검사에서 mysql2 import 전에 종료, operator 시험은 모의 db 객체).
- [00:20] [사실] 계약 시험은 repo 루트 cwd 를 가정(`process.cwd()` + 상대경로)하지만 jest 는 항상 루트에서 돈다. backfill.mjs 단독 커밋 상태(ownership.ts 없음)에서도 의존성이 없어 통과한다.
- [00:20] [사실] operator.mjs 는 기본 비활성이다. `T113_UNREVIEWED_PROTOTYPE` 정확한 문자열이 없으면 `PROTOTYPE_DISABLED` 로 첫 줄에서 종료하고, 켜도 호스트·포트·CA 경로·계정은 0600 소유자 전용 설정 파일에서만 받으며(`protectedRead`: O_NOFOLLOW·mode&077·uid·5MB), `expectedHost/Port/serverId` 가 실제 서버 신원과 다르면 중단하고, apply 는 manifest sha256 인자와 서버 신원까지 일치해야 한다. 저장소에 기본 대상 호스트·비밀·실데이터는 없다(fixture 값 `fixture-password`·합성 제목뿐). 오류는 코드명으로만 출력해 설정·행 내용을 찍지 않는다. 한계: 환경변수 문자열은 저장소에 공개된 리터럴이라 권한이 아니라 실수 방지 장치일 뿐이다.
- [00:20] [사실] 현재 운영 상태에서 operator 는 사실상 불활성이다. DDL·백필이 이미 끝나 `chat_threads.user_id` 가 존재하고 13건이 모두 소유 상태라, capture 는 `OWNER_COLUMN_STATE`, apply 는 `NON_NULL_OWNER_FOUND`(또는 데이터 지문 불일치)로 UPDATE 이전에 중단된다. 다만 apply 는 SERIALIZABLE 트랜잭션에서 읽기 잠금을 잡은 뒤 롤백하므로 「접속하면 무변경」이지 「접속하지 않음」은 아니다(명시 설정이 있어야만 일어난다).
- [00:20] [사실] backfill.mjs 는 `--fixture-only` 인자 정확히 1개와 `T113_FIXTURE_SOCKET=/tmp/t113-own-fixture.<영숫자 8자>/mysql.sock`(부모 realpath 동일·소켓 파일) 만 받고, 서버 `@@hostname='t113-fixture-node'`·`skip_networking=1`·DB `t113_fixture_demo` 와 고정된 합성 행 전체가 일치해야 UPDATE 한다. URL·호스트·DB·소유자·ID 를 인자로 줄 수 없고 `.env` 를 읽지 않는다. 운영 MariaDB 는 원격 TCP 라 이 소켓 경로로 도달할 수 없다. `root`/빈 비밀번호는 이 고정 합성 서버 전용 값이다.
- [00:20] [사실] drill 스크립트 2개는 인자를 받지 않고(`$# -ne 0` 거부) 외부 DB 설정을 읽지 않는다. 대상은 `docker run --network none --pull never --tmpfs … mariadb:10.11.11 --skip-networking` 일회용 컨테이너뿐이며 비밀번호는 빈 root(컨테이너 안 한정), GPG 문구는 매 실행 `/dev/urandom`, 작업 디렉터리는 `mktemp -d` 이고 trap 에서 컨테이너·gpg-agent·임시 디렉터리를 정리한다. `rm -rf -- "$work"` 는 mktemp 결과에만 쓴다. 운영 호스트·계정·DB 를 기본값으로 갖지 않는다. 이번 감사에서 drill 은 실행하지 않았다(미검증).
- [00:20] [사실] `T-113-chat-ownership-backfill-plan.sql` 은 비어 있지 않은 모든 줄이 `--` 주석이다(비주석 줄 0건 확인). `mysql < 파일` 로 실행해도 문장이 없다.
- [00:20] [사실] 하드코딩 비밀 점검: 6개 스크립트·계약 시험·문서 4개·인계문·이력서에서 IPv4(`0.0.0.0`·`127.0.0.1` 외 없음)·토큰·API 키·개인 키·실제 비밀번호 값 패턴은 발견되지 않았다. 문서에는 내부 구성 정보(호스트명 `home-dev-x600`, 3003 `0.0.0.0` 리슨, 백업 파일·복호 비밀 파일의 경로와 백업 SHA-256)가 있으나 비밀 값 자체는 없다.
- [00:20] [Low] 설계 문서가 「사용되지 않은 다중 사용자 이관 설계」라는 점을 스스로 밝히지 않는다. 문서 4개는 11-04 작성 시점의 상태 문구를 그대로 갖는다 — `T-113-cutover-access-drain.md` 「진행 불가(BLOCKED)」, `T-113-backfill-execution.md` 「운영 실행 불가」, `T-113-backup-restore.md`·`T-113-chat-ownership-migration.md` 「실행 전 검토안/검토용」 — 그리고 11-06 의 실제 이관(단일 사용자 전제의 대안 순서: 백업 → DDL → 배포 → `BEGIN NOT ATOMIC` 한 블록 UPDATE)이 이 문서·operator·drill 과 무관하게 끝났다는 문구가 없다(문서 안의 `11-06`·`완료`·`대체` 검색 0건, 연관 언급은 이력서 최종 요약 한 곳). 인계문(`T-113-T-152-claude-handover-2026-11-05.md`)도 「최종 검증 전」 상태 그대로다. 오해 위험: 이관이 아직 안 끝났다고 읽히거나, 이 도구·차단 절차가 실제 사용된 검증된 경로로 읽히거나, 다중 사용자 상황에 그대로 재사용될 수 있다. 권고: 각 문서 맨 위에 2~3줄 배너(「2026-11-06 단일 사용자 대안 순서로 이관 완료 · 이 문서/도구는 미사용 · 다중 사용자 전제의 보관용 · 재사용 전 재검토」)를 넣거나 최소한 커밋 메시지·이력서에 같은 문장을 남긴다. 문서는 이번에 수정하지 않았다.
- [00:20] [Low, 커밋 절차] 이 Mac 작업 트리의 로컬 `main`(HEAD `f47cf28`)은 `origin/main`(`c33e467`)보다 한 커밋 뒤처져 있다(`HEAD` 가 `origin/main` 의 조상, merge-base=HEAD). 여기서 커밋하면 push 는 non-fast-forward 로 거절되고, 당겨오려 하면 미추적/수정 상태의 T-113 파일 10개(`ownership.ts`·`T-113-chat-ownership.sql`·시험 2개·`db.ts`·라우트 5개)가 「덮어쓰기」 충돌을 낸다. 10개 모두 `git hash-object` 가 `origin/main` blob 과 같음을 확인했다(내용 동일). 앞선 배포가 서버 로컬 clone(`~/.node-local/stockinvest-t113-clone`)에서 만들어 push 한 이유다. 권고: 같은 서버 clone 에서 origin/main 위에 이번 파일만 복사해 커밋·push 하거나, Mac 트리 정리(동일 10개 정리 후 pull)는 다른 세션의 병행 변경을 건드리지 않도록 사용자 확인 뒤 수행한다.
- [00:20] [Low] 파일 모드. 디스크상 7개 모두 `rwx------`(0700)라 `core.fileMode=true` 인 서버 clone 에서 커밋하면 `.sql`·`.test.mjs` 까지 100755 로 들어간다(기존 `T-113-chat-ownership.sql` 이 이미 100755, 다른 마이그레이션 SQL 은 100644). 실행 위험은 없다(plan.sql 은 전부 주석, operator 는 환경변수 가드). 권고: `.sql`·`.test.mjs` 는 `git update-index --chmod=-x`.
- [00:20] [참고] push 는 webhook 으로 `stockinvest`·`stockinvest-cron` 두 pm2 앱을 새 릴리스로 재기동한다. 이번 커밋은 런타임 코드 변경이 없고(스크립트·시험·문서만) 앞선 배포 때도 같은 절차로 헬스 200 이었으나, 재기동 시점(현재 미국장 시간대)은 Deployer 와 사용자 판단이다.
- [00:20] [미검증] drill 두 스크립트의 실제 실행(Docker 필요, 앞선 작성자 실행 기록만 문서에 있음), operator.mjs 의 실 MariaDB TLS 동작(모의 시험 7건과 작성자 기록뿐), 문서 4개·인계문·이력서 전문 정독(상태 문구·키워드 검색·머리말 위주로 확인), 전체 jest·tsc·lint·next build 재실행, 훅 자체의 실제 통과 여부(커밋 시점 확인 필요), 서버 clone 의 origin 최신 여부.
- [00:20] **최종 판정: PASS (scope: scripts/migrations/T-113-backup-restore-drill.sh, scripts/migrations/T-113-chat-ownership-backfill-plan.sql, scripts/migrations/T-113-chat-ownership-backfill.mjs, scripts/migrations/T-113-chat-ownership-operator.mjs, scripts/migrations/T-113-gpg-pipeline-drill.sh, scripts/migrations/T-113-operator.test.mjs, scripts/migrations/T-113-chat-ownership.sql, src/lib/chat/__tests__/t113-backfill-contract.test.ts, docs/design/T-113-backfill-execution.md, docs/design/T-113-backup-restore.md, docs/design/T-113-chat-ownership-migration.md, docs/design/T-113-cutover-access-drain.md, docs/handovers/T-113-T-152-claude-handover-2026-11-05.md, jest.config.js, package.json, deploy.yml, ecosystem.config.js, tsconfig.json, scripts/git-hooks/commit-msg)**

## Claude 검토

- C1 공식 runner `files=[]`, `design_uncertain=true` gate-only 결과 `incomplete / bad_file_list`, attempt=null. 실행 순서상 gate 통과 후 빈 파일 검증에서 중단된 것으로 확인. 소스/문서 0개 전송, Claude 실행 0; 실제 외부 검토 아님. 미커밋 범위 우회 금지. Reviewer PASS 뒤 C2도 동일한 공식 runner gate-only `files=[]`에서 `incomplete / bad_file_list`, attempt=null. 실제 C1/C2 Claude 검토 및 파일 전송은 없으며 해당 소스 전체가 Claude 미검토다.

## QA

- [2026-11-04] **격리 범위 조건부 PASS:** Reviewer의 최종 코드 정적 PASS 이후 기준 `41cc3c0e9661d5b5bb00f002cb5bef07111042be` git archive에 변경 11파일만 반영. 원본과 Ubuntu `/tmp/stockinvest-t113-qa.2NLEmQgW` 사본의 SHA-256 일치 및 시험 후 원본 불변을 확인했다. 11파일 정규화 매니페스트 SHA-256 `768371774356858fab5c121dd7af5950b27284863e43ae90dd684252a75df11d`.
- [2026-11-04] Ubuntu Node 24.22.2 격리 사본에서 공용 `flock /tmp/stockinvest-heavy-tests.lock`으로 focused Jest `t113-ownership-routes.test.ts` 및 `t113-migration-contract.test.ts` **2 suite, 24/24 통과**, `tsc --noEmit --incremental false` exit 0. Jest는 세션·DB·LLM을 모의한 라우트/정적 계약 테스트이며 라이브 API가 아니다.
- [2026-11-04] 공용 잠금 안에서 일회용 MariaDB 10.11.11 Docker (`--network=none`, `--skip-networking`, DB tmpfs, 전용 `/tmp` Unix socket, 외부 포트 0)로 수동 ALTER를 격리 적용했다. 기존 예시 대화·메시지 유지 및 owner NULL, 재실행 실패를 확인. 임시 QA 전용 테스트 2 suite 8/8 통과: 실제 signed session·`findUserById` 및 MariaDB SQL로 두 계정·무세션/위조/만료/삭제 계정·NULL·타인 격리, 사용자 ID 조작·모의 LLM 이전 인가, LLM 대기 중 소유권 변경·삭제, 메시지 부분 INSERT 실패의 트랜잭션 롤백을 확인. 모델·심볼은 가짜이며 HTTP 서버 실행이나 외부 LLM 호출은 없다.
- [2026-11-04] 최초 두 일회용 DB 실행은 테스트 6/6 각각 통과했지만 wrapper가 빈 디렉터리와 socket 정리 단계에서 exit 1. 남은 임시 디렉터리/소켓만 별도 정리했고 cleanup을 수정해 다음 실행은 전체 exit 0. 컨테이너·socket 정리 완료. 이 QA 시험 과정에서는 실제 운영 DB·계정·데이터에 접근하지 않았다. 별도의 Leader 읽기 전용 집계는 아래 기록한다.
- 명령(모두 격리 사본, `env -i`, `HOME=/tmp`, `TZ=Asia/Seoul`): `flock -w 120 /tmp/stockinvest-heavy-tests.lock nice -n 10 node ./node_modules/jest/bin/jest.js --runInBand --no-cache src/lib/chat/__tests__/t113-ownership-routes.test.ts src/lib/chat/__tests__/t113-migration-contract.test.ts`; `flock -w 120 /tmp/stockinvest-heavy-tests.lock nice -n 10 node ./node_modules/typescript/bin/tsc --noEmit --incremental false`; `flock -w 120 /tmp/stockinvest-heavy-tests.lock bash /tmp/t113-qa-db-run.sh` (후자는 로컬 이미지·격리 DB 생성, DDL 및 QA 임시 Jest만 실행 후 제거).
- [2026-11-04] **백필 표현식의 합성 격리 검증:** Ubuntu `env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp TZ=Asia/Seoul flock -w 120 /tmp/stockinvest-heavy-tests.lock bash /tmp/t113-qa-backfill-run.sh` exit 0. 로컬 MariaDB 10.11.11 이미지, `--network=none`, `--skip-networking`, DB tmpfs, 전용 임시 Unix socket, 외부 포트 0. 가상 사용자 2명, NULL 스레드 2개(보관 1 포함), 다른 사용자 소유 스레드 1개, 메시지 3개만 생성. 운영 DB·계정·실데이터 접근 없음.
- 동일 시험의 18개 assertion: `SET user_id=?, updated_at=updated_at`는 대상 NULL 2건만 귀속하고 기존 소유 행을 바꾸지 않았으며, thread ID·제목·보관 상태·메시지 수·기존 updated_at과 메시지 ID·부모·역할·내용·생성시각을 보존했다. ROLLBACK은 변경 전 thread/message를 복원했고 COMMIT 후 검증한 상태가 유지됐다.
- **중요: STOP 조건은 `/tmp/t113-qa-backfill.cjs`가 시험 목적으로 별도 구현한 모의 guard다.** 이 하네스에서는 대상 사용자 부재, 기존 소유자 존재, updated_at 차이, 새 NULL 행 발생 때 STOP 및 무변경을 확인했다. 주석-only `T-113-chat-ownership-backfill-plan.sql`은 guard를 실행하지 않으므로 운영에서 자동 STOP 보장·실행 가능하다는 뜻이 아니다. READ COMMITTED의 별도 연결 표본에서 확인 대상 2개 행만 잠근 동안 별도 NULL 행 INSERT가 성공했다. 행 잠금만으로 신규 쓰기/범위 변동을 차단할 수 없음을 보이는 사례이며, 모든 격리 수준·경합의 완전 검증이 아니다. 기존/신규 writer 차단 및 cutover는 별도 구현·검증해야 한다.
- 시험 종료 후 자기 소유 컨테이너와 소켓 디렉터리 잔여 0 확인. 실제 최초 가입자 식별·실데이터 귀속·범위 증명·백업/복구·운영 전환·구/신 버전 공존 및 응답 유실 후 실제 복구는 미검증이다. 이 결과는 백필 실행 승인이나 운영 적용 PASS가 아니다.
- **미검증/주의:** 이전 8월 승인 명세의 chat_threads/chat_messages 양쪽 user_id 및 첫 가입자 귀속은 아직 이행되지 않았다. 실제 가입자·대화 이력·이관 효과·DB DDL 승인, 실서비스 API/세션, 기존 UI, 대규모 부하·동시 트래픽, 패키지 통합·배포·롤백은 이번 조건부 PASS 범위가 아니다. 구버전 앱 혼재 시 우회 가능성도 차단됐다고 주장하지 않는다. 운영 적용·사용자 이관 결정은 별도 절차로 다룬다.
- [2026-11-06 23:10] **재실행 판정: CONDITIONAL_PASS.** 서버 측 인가·소유권·백필·구버전 호환은 실 MariaDB 시험으로 통과. 브라우저 화면, 실 HTTP 서버, 구·신 인스턴스 동시 쓰기는 미검증. 기준은 base origin/main `6d15894`(운영 릴리스 기준)이며 로컬 HEAD `8984f69`는 9커밋 뒤처져 있다. 두 기준 사이 채팅 라우트·`src/lib/db.ts` 변경은 0건(git diff 공백)이다.
- [2026-11-06 23:10] 격리 사본 `/tmp/stockinvest-t113-qa6.VRq0thTS`는 `git archive 6d15894`에 작업 트리 T-113 파일 17개를 overlay했다(채팅 라우트 5, db.ts 1, ownership.ts 1, t113 테스트 3, scripts/migrations/T-113-* 7). 원본 17개 SHA-256을 시험 전후로 기록해 `SOURCE_UNCHANGED=yes`, 사본 해시 17/17 일치를 확인했다. node_modules는 원본 심볼릭 링크를 재사용했다.
- [2026-11-06 23:10] focused Jest 3개 suite(t113-ownership-routes, t113-migration-contract, t113-backfill-contract) **27/27 PASS**, `tsc --noEmit --incremental false` **exit 0**. 두 명령은 `flock -w 120 /tmp/stockinvest-heavy-tests.lock` 안에서 `env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp TZ=Asia/Seoul`로 실행했다. 저장소 전체 Jest 스위트는 실행하지 않았다.
- [2026-11-06 23:10] 일회용 MariaDB 10.11.11을 시험 단계마다 새로 띄웠다(network=none, 게시 포트 0, skip-networking, tmpfs, 전용 Unix socket). 공식 이미지의 임시 서버 종료 중 소켓이 사라지는 레이스를 "ready for connections" 2회 대기로 막았다. 1차 실행의 시드 누락과 기대값 오류 3건은 고쳐서 전체를 다시 돌렸고, 아래 수치는 최종 실행 기준이다. 종료 후 컨테이너·소켓 디렉터리 잔여 0.
- [2026-11-06 23:10] 소유권 인가(DDL 적용 후 신규 코드) **16/16 PASS**. 실제 signSession 쿠키와 실제 라우트, 실 MariaDB를 썼고 LLM·심볼 해석만 모의했다. 무세션·위조·만료·삭제 계정은 모두 401. 타인 대화의 GET·메시지 POST·draft·PATCH·DELETE는 모두 404이고 LLM 호출 0회, 행 불변. 목록은 본인 것만 보인다. 소유자 없는 구 NULL 행은 누구에게도 404이고 목록에 나오지 않는다. 잘못된 ID 7종은 모두 400이다.
- [2026-11-06 23:10] 강제 DB 실패(트리거 SIGNAL)에서 사용자·assistant 메시지와 message_count가 롤백됐다(before/after 해시 동일). LLM 호출 중 소유권 변경은 404이고 저장 행 0, LLM 호출 중 삭제는 404이고 고아 메시지 0이다. draft 경로도 재검사 후 404다. 계정 삭제 후 기존 유효 쿠키는 401이다.
- [2026-11-06 23:10] 백필 `UPDATE chat_threads SET user_id = ?, updated_at = updated_at WHERE user_id IS NULL`(owner=1)은 NULL 3건을 영향 3행으로 귀속했다. 생성·수정 시각, 제목, symbol, message_count, archived, 메시지 해시가 보존됐고 타인 소유 행은 그대로다. **주의: WHERE에 대상 ID 제한이 없어 NULL 행 전부가 귀속된다.** 단일 사용자 전제를 실행 직전에 재측정하지 않으면 위험하다.
- [2026-11-06 23:10] DDL을 두 번째 실행하면 `ERROR 1060 Duplicate column 'user_id'`로 중단된다(fail-stop). 인덱스 `idx_chat_threads_user_archived_updated`는 (user_id, archived, updated_at) 3열로 생성됐다.
- [2026-11-06 23:10] 구버전 라우트 시험(DDL만 적용, 6d15894 원본 채팅 파일): 생성·목록·메시지 POST·GET·PATCH·DELETE가 모두 200으로 동작했다. 구버전이 만든 행은 user_id NULL이다. 이 행은 백필 전 신규 코드의 목록·메시지에서 모두 숨겨진다(404, 목록 빈 배열).
- [2026-11-06 23:10] 백필 후 신규 코드: 소유자의 목록에 'legacy-1-renamed'가 보인다(user_id NULL→1, message_count 2, updated_at 보존, 메시지 2건 내용·해시 동일). 타인(bob)의 목록과 메시지에서는 보이지 않고 404다.
- [2026-11-06 23:10] DDL 미적용 DB에서 신규 코드를 호출하면 목록 GET·생성 POST·메시지 GET·POST가 모두 `ER_BAD_FIELD_ERROR` 예외를 던진다. 라우트 직접 호출 기준이며, Next 서버에서는 500이 될 수 있다. 응답 데이터 0건, 행 추가 0건, LLM 호출 0회라 데이터는 닫혀 있다. 그러나 **코드보다 DDL이 먼저 적용돼야** 채팅이 동작한다. 배포 순서의 근거다.
- [2026-11-06 23:10] 결함: Critical·High 0건. ChatPage 정적 검토(브라우저 미검증, 저~중 등급): (a) 401·404 응답에서 `d.ok`가 false면 상태를 조용히 유지해서, 접근 불가 대화를 선택하면 이전 대화 메시지가 남을 수 있다. (b) 삭제 버튼은 응답을 보지 않고 목록에서 제거한다. 서버가 404·401을 줘도 UI는 삭제된 것으로 보인다. (c) 401에 로그인 화면 이동이 없고 오류 문자열만 표시된다. 수정 여부는 개발자와 사용자 판단이다.
- [2026-11-06 23:10] **미검증(NOT_VERIFIED):** 실 Next 서버와 미들웨어 세션 경로, 브라우저 UI(412px·1280px, 다크모드), 구·신 인스턴스 동시 가동 중 쓰기, 부하와 실제 동시 트랜잭션 간섭, 운영 DB·운영 데이터, 원격 main의 나머지 9커밋 회귀, 전체 Jest 스위트. ChatPage 자동 테스트는 저장소에 없고 tsc로 타입만 확인했다.
- [2026-11-06 23:10] **조건:** (1) 배포 전에 DDL을 먼저 적용한다. 코드만 먼저 배포하면 채팅 API 전체가 예외가 된다. (2) 백필은 실행 직전에 사용자 수와 NULL 행 집합을 재측정한 뒤에만 한다. (3) 구버전 인스턴스가 완전히 내려간 것을 확인한 뒤 백필한다. 동시 쓰기는 이번에 시험하지 않았다. (4) 브라우저 화면 확인과 ChatPage (a)(b) 보완 또는 수용 결정이 필요하다. 배포 승인은 Leader와 사용자 몫이다.
- [2026-11-06 23:10] 산출물: 실행 로그, 결과 JSON, 하네스 원본은 `/private/tmp/claude-501/-Users-brownjeon-Library-Application-Support-Claude-scratch-workspaces-1f19715e-0787-4d39-8868-21fe57284cbf-e23e1e67-3eda-4ba7-9bfa-a6cf3abdfcb6-scratch-2026-11-06-a719ef/78627dba-1cfc-472c-a12a-4580d9aa4dff/scratchpad/t113-qa6-evidence`에 보관했다. Ubuntu의 격리 사본·실행 디렉터리·소켓·컨테이너는 정리했다. 저장소 파일은 변경하지 않았다. QA 전용 시험 파일 2개는 격리 사본에만 있었다.

## 사용자 확인

- [2026-11-04] 기존 대화 13건의 실제 소유자는 현재 계정이며 이전에 삭제된 다른 계정이 없다는 사용자 응답을 받았다. 과거 첫 가입자 귀속 결정과 함께 기존 이관안의 소유자 판단 근거로 사용한다. 응답은 운영 DB 이관·DDL·배포 실행 승인과는 구분한다.

## 운영 상태 읽기 전용 확인

- 2026-11-04 22:28:21 KST 운영 MariaDB에서 `SET SESSION TRANSACTION READ ONLY; START TRANSACTION READ ONLY` 후 SELECT/information_schema만 수행. users 1, chat_threads 13, chat_messages 32, chat_threads.user_id 열·해당 인덱스 없음. 현재 사용자 최저 생성시각 동률 없음. 과거 계정 삭제·현재 사용자가 역사적 첫 가입자인지, 개별 대화 소유권은 미확인. 사용자 ID·이메일·대화 본문·비밀값 미조회/미출력. 시점 한정 집계이며 이후 변동 가능. DB 변경·앱 getPool 호출·서비스 조작 없음.

## 사용자 확인 반영 및 이관 준비

- 사용자 응답 원문: “현재 계정이 기존 대화의 소유자이고 삭제된 이전 계정이 없습니다.” 기존 첫 가입자 귀속 방향에 대한 소유권 확인이며, 운영 DDL 실행 승인과는 구분한다. 같은 사실을 다시 묻지 않는다.
- `docs/design/T-113-chat-ownership-migration.md`와 주석 전용 `scripts/migrations/T-113-chat-ownership-backfill-plan.sql`에 사용자 확인, 단일 계정과 비공개 일치 확인, 전환 시 대상 재측정·백업·쓰기 차단·트랜잭션·시각 보존·구버전 차단·결과 불명 중단·복구 조건을 보완했다. 현재 파일은 자동 실행 가능한 운영 백필 도구가 아니다.
- 독립 감사에서 QA가 실제 실행한 `updated_at=updated_at`과 계획의 다른 JOIN 표현식을 구분하고, 사전 조회와 명시적 transaction 내부 동일 연결 `FOR UPDATE`를 분리했다. 계획 JOIN SQL·STOP 자동화 및 백업/복구·전환은 미검증이다.

## 전환 접근 경로 읽기 전용 확인

- 2026-11-04 22:52 KST: 운영 확인 담당이 `/proc/net/tcp`에서 3003 LISTEN이 `0.0.0.0`인 것을 관찰했고, 릴리스 cwd 기준 next-server 1개 및 릴리스 `20261104-180613-a6b7605f`를 확인했다. 활성 stock nginx 설정의 `location /`는 127.0.0.1:3003으로 연결되며 채팅 전용 차단은 확인되지 않았다. UFW 비활성 설정 확인, nft 규칙은 권한 부재로 미확인. 실제 외부/LAN 접속 가능성, 다른 경로·구버전 인스턴스 전체 부재는 입증되지 않았다. 앱 호출·인증 시도·설정 변경·sudo 비밀번호 요구·서비스 조작 없음.
- 실제 리슨과 방화벽·내부 접근을 모두 다루는 채팅 쓰기 차단·진행 중 LLM 요청 drain, 백업/복구·구버전 롤백 안전 조치가 구체화되지 않아 운영 전환 불가. Git HEAD `41cc3c0e…`와 관찰된 운영 릴리스 SHA `a6b7605f…`는 다르며 배포 전 최신 원격 및 동승 커밋 대조 필요. 전체 git status는 NFS 지연으로 exit 130, 미확인.

## 운영 이관 사전 준비 (2026-11-04)

- 사용자의 요청 범위는 운영 이관 준비와 적용 전 보고까지다. 운영 DB 변경, 배포 및 서비스 조작은 수행하지 않았다.
- 접근 경로·요청 정리: `docs/design/T-113-cutover-access-drain.md`. 프록시, 직접 포트, 로컬 호출·cron, 기존 인스턴스 및 LLM 큐를 구분했다. 로컬 모의 시험에서 프록시 차단을 우회하는 직접 접근과 연결 종료 후 계속되는 작업을 재현했다. 운영 방화벽과 진행 중 작업 전체 종료는 미검증이며 차단·drain은 BLOCKED다.
- 백업·복원: `docs/design/T-113-backup-restore.md`, 합성 전용 `scripts/migrations/T-113-backup-restore-drill.sh`. 격리 MariaDB에서 12개 DB 검사와 임시 키를 사용한 GnuPG 암복호·변조 거부 2개가 통과했다. QA가 독립 재실행했다. 초기 실행에서 임시 DB 준비 판정 오류가 있었고 수정 후 통과했다. 감사에서 복호 중 DB에 직접 import하면 일부 적용될 수 있음을 발견해 복호 완료 후 import하도록 문서를 수정하고 재검토했다. 운영 age 절차, 실제 키·DB 백업 및 복원은 미검증이다.
- 백필: `docs/design/T-113-backfill-execution.md`와 `scripts/migrations/T-113-chat-ownership-backfill.mjs`는 합성 fixture 전용이다. 독립 QA에서 계약 테스트 3/3과 격리 DB 백필·재실행 거부·시각 및 메시지 보존을 확인했다. 실제 운영용 입력·manifest 비교·전환 통제는 미구현이다. QA 초기 실행은 검사는 통과했으나 임시 디렉터리 정리 단계에서 실패했고 정리 코드를 수정한 재실행은 exit 0이었다.
- 독립 Reviewer는 준비 문서와 합성 실험 범위에서 조건부 PASS; 운영 이관 승인이 아니다. 차단·drain 입증, 운영용 실행 도구 구현과 감사, 실제 백업의 격리 복원 및 키 관리 검증, 구·신 릴리스 및 기존 승인 설계 차이 확인, 운영 승인과 회귀 검증이 남아 있다.

## 운영 이관 후속 준비 (2026-11-04)

- 사용자 후속 지시에 따라 운영 적용 전 준비를 진행했다. 운영 DB·데이터 변경, 배포, 서비스 제어는 수행하지 않았다. 운영 앱 호스트 읽기 전용 확인에서 `age`와 호스트 MariaDB 클라이언트는 없고 GnuPG 2.2.27과 Docker가 있음을 확인했다. DB 호스트는 별개이며 그 환경은 미확인이다.
- `docs/design/T-113-cutover-access-drain.md`: 구버전 요청 소급 계측의 한계와 웹 프로세스 전환 후보, cron·매매·DB 작성자·provider 및 차단 중 테스트 경로와 종료 조건을 보완했다. 차단·드레인 장치는 미구현·미검증이다.
- `docs/design/T-113-backup-restore.md`: 실제 스키마 전체 컬럼과 논리값 대조 및 drift 중단을 보완했다. 합성 MariaDB 덤프의 GnuPG 암복호·복원과 생성 오류 전파를 격리 검증했다. 운영 키와 운영 데이터 백업·복원은 미검증이다.
- `scripts/migrations/T-113-chat-ownership-operator.mjs`: 기본 비활성 연구용 초안. 명시적 설정 시 실제 DB 연결·변경이 가능하므로 운영에서 실행하지 않는다. 정확한 ID 제한, 스키마/가시성 비교, 서버 논리값 HEX, ENUM 인덱스, 트리거 직접 권한 및 크기 제한을 구현했다. 인가된 외부 쓰기 차단, 요청 정리, 백업 복원을 보장하지 않는다. 검증 파일 SHA-256 `2fddbf2a159a401158f6637045e0077eeed0f171b4ed385fb5a2335d74024c8d`.
- 독립 Reviewer는 최초 HIGH(열 가시성·드라이버 변환)로 FAIL 후 수정과 재검토를 거쳐 **격리 연구용 범위 정적 PASS**. 이어진 독립 QA는 격리 MariaDB 10.11.11에서 단위 7/7, 부분 트리거 권한·ENUM·4MB 초과·JSON/내용 변경 거부 및 정상 백필·재실행 거부·시각 보존을 확인했다. 제한 컬럼 계정의 열 가시성 및 SHOW CREATE 실패는 별도 관찰했으나 operator 전체 실행 거부로는 미검증. TLS는 Unix socket을 지정하는 시험용 패치에서 세션 암호화 확인이며 TCP·운영 인증서는 미검증이다. 행 수 초과와 커밋 결과 불명 주입, 운영 환경 동시성은 미검증. 작성자 측 초기 fixture 환경 오류 2회 수정 후 성공했으며 독립 QA 최종 실행은 exit 0이다.
- 운영 이관은 차단/drain, 실제 백업·격리 복원, 실제 스키마·권한·인증서, 실패·동시성 및 운영 릴리스/승인 설계 차이 확인이 남아 있다. 이 격리 시험은 운영 이관 PASS가 아니다.

## 운영 환경 검증과 실백업 시도 (2026-11-04)

- 사용자 지시는 운영 접근 차단·진행 요청 정리 및 실백업 격리 복원 수행, 단 운영 DB 변경 전 결과 보고다. 운영 DB 변경·배포·서비스 중단·차단 설정은 하지 않았다.
- 읽기 전용 조회: 운영 MariaDB 10.11.11, 세 테이블 InnoDB, 사용자 1·대화 13·메시지 32, `chat_threads.user_id` 부재. 앱 계정에서 두 테이블 SHOW CREATE 가능, 대상 DB 직접 권한과 보이는 trigger 0. 범위와 시점이 한정되며 다른 작성자의 부재 증명이 아니다.
- 앱과 동일한 연결의 `Ssl_cipher`는 빈 값, `have_ssl=DISABLED`·`require_secure_transport=OFF`: 해당 연결의 전송 암호화 부재 및 서버 TLS 비활성을 확인. DB 호스트에 기존 키와 확인된 계정으로 비대화 SSH를 Ubuntu·Mac에서 시도했으나 인증 거부. 보안된 실데이터 전송 경로를 확보하지 못해 운영 데이터 백업·복원은 미수행이다.
- Mac의 LAN에서 앱 3003 포트 TCP 연결을 확인했다(HTTP 요청·대화 데이터 송수신 없음). nginx 차단만으로는 해당 직접 경로를 막을 수 없다. nginx 쓰기·비대화 sudo·실효 방화벽 조회 권한이 없고 공유 cron과 앱의 안전한 분리 및 실행 중 큐 종료 입증도 불가해 실제 차단·드레인을 수행하지 않았다. 별도 Claude 프로세스를 구분 없이 중단하지 않았다.
- 앱 호스트 MySQL 8.0.46 mysqldump/mysql로 격리 MariaDB 10.11.11 합성 데이터의 덤프·복원이 성공했다. 한글·ENUM·시각·FK 및 행 수 확인으로 범위가 한정되며 실제 스키마 전체/trigger 호환성은 미검증. 초기 64MB tmpfs 부족으로 실패, 512MB로 합성 환경을 조정해 성공했다. 운영 데이터 사용 없음.
- 독립 Reviewer는 두 실측 문서의 표현과 범위에 한해 정적 PASS, 운영 관찰 재실행 및 운영 차단·실복원·이관 PASS 아님. 관리자 네트워크 권한과 NAS 로컬 접근 또는 검증된 암호화 터널이 필요해 사용자에게 접속 방법을 요청했다(비밀번호·키 내용 제외).

## 재개 검토 — 단일 사용자 조건의 이관 순서 대안 (2026-11-06, 메인 세션)

- 이 절은 메인 세션의 분석·제안이다. Reviewer·QA 를 부르지 않았으므로 독립 감사 결과가 아니며, 기존 설계 문서(`docs/design/T-113-*.md`)를 고치지 않았다.
- **막힌 이유의 전제**: `docs/design/T-113-cutover-access-drain.md` 「현재 판정」은 "소유권 인가가 없는 구버전으로 새 스키마를 개방"하는 상황을 막으려고 모든 접근 경로 차단과 구버전 요청 0건 증명을 DB 작업보다 먼저 요구한다. 이는 **다른 사용자가 있는** 위협 모델이다. 11-04 실측은 users 1·대화 13·메시지 32이고, 기존 대화 소유자는 현재 계정이며 삭제된 계정이 없다는 사용자 확인이 있다. 가입은 초대코드 필요(`src/lib/auth/signup-gate.ts:78`).
- **확인한 사실(이번 세션, 코드 읽기)**:
  - 운영 코드(HEAD `8984f69`)의 `chat_threads` 쓰기는 전부 열 이름을 명시한다 — `INSERT INTO chat_threads (title, symbol)`(`threads/route.ts:37`), `UPDATE … SET message_count…`·`SET ${fields}`·`DELETE … WHERE id = ?`. `SELECT *` 없음. 다른 작성자(cron·스크립트)는 `git grep` 결과 0건. 따라서 nullable `user_id` 열 추가(`scripts/migrations/T-113-chat-ownership.sql`)는 **구버전 동작을 바꾸지 않는다**(구버전이 만든 새 대화는 `user_id` NULL).
  - 새 코드의 대화 생성은 `INSERT … (title, symbol, user_id) SELECT ?, ?, u.id FROM users u WHERE u.id = ?`(작업 트리 `threads/route.ts:51`)로 항상 소유자를 채우고, 조회는 `INNER JOIN users … AND t.user_id = ?`(`src/lib/chat/ownership.ts:27`)라 NULL 대화는 보이지 않는다(fail closed).
  - base `41cc3c0` 이후 HEAD 까지 19커밋 중 `src/app/api/chat`·`src/lib/chat`·`src/lib/db.ts` 를 건드린 커밋 0건 — 작업 트리 변경은 그대로 얹힌다. 다만 QA 24/24·8/8 은 base 기준 사본이라 **현재 HEAD 기준 재실행은 하지 않았다.** 채팅 경로는 커밋 훅 `SAFETY_PATHS` 밖이다.
- **대안 순서(제안, 미실행)**: ① 실행 직전 읽기 전용 재측정(users 수·NULL 대화 수·대상 사용자 ID) → ② 두 테이블 백업(행 수가 작음, 저장 시 GnuPG 암호화) → ③ DDL(열 추가 — 구버전 호환) → ④ 새 코드 배포(blue/green, 이 시점부터 NULL 대화는 숨겨지고 새 대화는 소유자 보유) → ⑤ 구버전 인스턴스 종료 확인 뒤 `UPDATE chat_threads SET user_id=<재측정한 ID>, updated_at=updated_at WHERE user_id IS NULL` 1회 + 행 수·메시지 수 대조 → ⑥ 화면에서 기존 대화 확인. 롤백: 코드만 되돌려도 구버전은 열을 무시하므로 안전하다. ④~⑤ 사이 몇 분 동안 기존 대화 목록이 비어 보이는 것이 사용자 영향이다.
- **이 순서가 차단·drain 을 대체하는 근거** [가능성 높음]: 구버전이 DDL 뒤에 만든 대화도 NULL 이라 ⑤ 에서 함께 귀속되고, ⑤ 는 구버전이 사라진 뒤에만 실행하므로 백필 중 새 NULL 행이 생길 작성자가 없다. 진행 중이던 구버전 요청이 배포 뒤 끝나도 `chat_messages` 를 기존 대화에 붙일 뿐이다(메시지 표에는 소유자 열이 없다). 구버전에 소유자 조건이 없다는 점은 **지금 운영 상태와 같다** — 이 순서가 노출을 새로 만들지 않는다. 사용자가 2명 이상이면 이 근거는 무너진다(① 에서 확인).
- **남는 판단(사용자 결정)**: (a) 이 대안으로 갈지, 기존 차단·drain 설계를 유지할지. (b) 백업 경로 — DB 연결은 TLS 비활성(11-04 실측)이지만 앱이 같은 연결로 이 데이터를 이미 매번 주고받는다. 같은 경로로 백업해도 새 종류의 노출은 아니라고 본다 [가능성 높음]. (c) DDL 실행 명시 승인(`--with-migrate` 아님, 수동 1회). (d) push=배포 시점.
- **진행 시 필수 단계(생략 불가)**: 현재 HEAD 기준 QA 재실행, 대안 순서 자체에 대한 Reviewer 감사, Deployer 배포·판정.

## 사용자 결정과 T-152 후속 영향 점검 (2026-11-06, 메인 세션)

- 사용자 결정 원문: 「대안 순서로 진행하되, T-113작업 후에 T-152작업을 했을 경우 고려해야하거나 보완해야하는 사항에 대해서 점검해보고 특이사항이 없다면 대안대로 진행해줘」. 위 「재개 검토」의 대안 순서(재측정 → 백업 → DDL → 배포 → 백필 → 확인)와 그 안의 DDL·push 를 이 조건부 승인 범위로 본다. 단, 1단계 재측정에서 사용자 2명 이상이면 중단한다.
- **판정: 막는 특이사항 없음.** 근거:
  - v4 구현 가이드(`adoption/ADP-010-assistant-ui/33-v4-구현가이드.md` §3)는 실제 연결 때 기존 `/api/chat/threads`·`/messages`·`/draft`·`/models` 만 쓰고 새 저장 항목이 없다 → T-152 를 위해 이번 DDL 에 열을 더 넣을 필요가 없다.
  - `packages/chat-ui` 는 표시 전용(HTTP·저장·계정 없음, `README.md`)이라 T-113 서버 인가와 겹치는 코드가 없다.
  - T-113 은 성공 응답 형식을 바꾸지 않았다(목록 `threads[]` 필드·`{ok, id}` 동일, ID 는 계속 JS 숫자 — BIGINT 안전 범위 밖이면 503).
- **T-152 연결 때 보완할 것(후속, 이번 배포 차단 아님)**:
  1. 새 오류 코드 처리 — 401(세션 없음·계정 삭제), 404(남의 대화·삭제된 대화·백필 전 NULL 대화), 503(안전하지 않은 ID). 어댑터가 `ChatView` 의 `error` 상태와 재로그인 이동으로 매핑해야 한다. 기존 `src/app/ai/ChatPage.tsx` 의 처리 여부는 이번 QA 회귀에서 확인한다.
  2. `conversationKey` 는 계정이 바뀌면 바뀌어야 하는데 API 응답에 사용자 ID 가 없다 → 세션 사용자 식별값을 함께 써야 한다.
  3. LLM 대기 중 대화가 삭제·소유권 변경되면 서버가 저장을 거부한다 — 화면은 지연 응답 폐기(T-152 시범에 구현)와 함께 서버 오류도 표시해야 한다.
  4. 직진(번개) 모드는 서버가 정제 프롬프트 없이 내부 정제를 하므로 「정제 생략」이 아니다(가이드 §4 에 이미 기재).
  5. 배포 순서: 새 채팅 코드는 `t.user_id` 를 읽으므로 **DDL 이 배포보다 먼저**여야 한다. T-152 실제 연결 배포는 T-113 백필 확인 뒤에만 한다.
  6. 루트 `tsconfig.json` 이 `packages/chat-ui` 를 운영 빌드 타입검사에 포함한다(T-152 「재개 확인」 절).

## 운영 이관 실행 (2026-11-06, 메인 세션)

- 근거: 위 사용자 결정(조건부 승인) + Reviewer PASS(22:59, Medium 2건 반영) + QA CONDITIONAL_PASS(23:10, 조건 1~3 은 이 순서에 포함, 조건 4 ChatPage 보완은 후속).
- **① 재측정(22:57, 읽기 전용)**: MariaDB 10.11.11, users 1, chat_threads 13(보관 0), chat_messages 32, 고아 메시지 0, message_count 불일치 0, `user_id` 열·인덱스 없음, 관련 트리거 0, `users.id` `int(10) unsigned`. 접속은 앱 호스트에서 `shared/.env` 를 0600 임시 설정으로 바꿔 사용(값 미출력, 종료 시 삭제).
- **② 백업(22:59)**: `mysqldump --single-transaction`(MySQL 8.0.46 클라이언트) 두 표만 → GnuPG AES256 대칭 암호화, 평문 디스크 기록 없음. 파일 `~/backups/stockinvest-t113/chat-before-T113-20261106-225904.sql.gpg`(앱 호스트, 0700/0600) 13,485바이트, SHA-256 `3857b640cda1bddc7913442c4eb46e357e8ee894e0caaa093081e9bdc8657ec6`. 복호 비밀은 **Mac** `~/.stockinvest-secrets/t113-chat-backup-20261106.pass`(0600)에만 있다 — 백업 파일과 다른 기계. 네트워크 없는 일회용 `mariadb:10.11.11` 에 복호 완료 후 복원 → 전체 열 지문(대화 7열·메시지 11열 MD5) 운영 `39fe07ea…`/`09151467…` 과 **일치**(13/32). 컨테이너·서버 임시 비밀 삭제. 첫 시도는 클라이언트 설정의 `database=` 를 mysqldump 가 거부해 빈 암호문(70바이트)이 생겼고, 즉시 삭제 후 수정 재실행했다.
- **③ DDL(23:12:08)**: `scripts/migrations/T-113-chat-ownership.sql` 그대로 1회. 실행 전 가드(users 1·열 없음·지문이 백업과 같음) 통과. 결과 `user_id int(10) unsigned NULL DEFAULT NULL`, 인덱스 `(user_id, archived, updated_at)`, NULL 대화 13, 지문 불변. 직후 구버전(릴리스 `20261106-230448-f47cf28a`) health 200, 무세션 채팅 401, pm2 두 앱 online·재시작 0.
- 백필 가드(Reviewer Medium 1 반영): `BEGIN NOT ATOMIC` 한 블록에서 users `FOR UPDATE` 로 1명 확인, NULL 대상 수가 직전 재측정값과 같은지, `ROW_COUNT()`=대상 수, 잔여 NULL 0 — 하나라도 어긋나면 ROLLBACK. 일회용 MariaDB 10.11.11 시험 4경우(대상 수 불일치·사용자 2명 → 무변경 / 정상 → 2건 귀속·`updated_at` 보존 / 재실행 → 0건) 확인. 실행 전 3003 리스너 1개·새 릴리스 cwd 를 확인한다.
- 커밋 구성(Reviewer Medium 2 반영): 백필 계약 시험(`t113-backfill-contract.test.ts`)과 operator·backfill·drill 스크립트, `docs/design/T-113-*.md` 는 커밋하지 않는다(미커밋으로 남김).

## Deployer

- 판정: **성공(ok)**. 롤백 없음.
- 커밋: `c33e467 feat(T-113): 챗봇 대화 소유권·서버 인가` (부모 `f47cf28`, 운영 직전 릴리스와 동일). 11개 파일 +693/-71.
- push 전 확인(23:15): 서버 clone `/home/brownjeon/.node-local/stockinvest-t113-clone` `git fetch origin` 결과 origin/main = `f47cf28`(움직이지 않음). 동승 커밋 없음(`f47cf28..c33e467` 는 이 커밋 1개). `git-refs-clean.sh --check` exit 0(실제 ref 2개, 사이드카 없음).
- push: `git push origin main` 23:15:53 KST, `f47cf28..c33e467`. 공유 NFS 저장소에서는 push 하지 않았다.
- 배포 경로: webhook(`deploy-stockinvest.sh` → `release.sh`), `--migrate` 없음(`migrated:false`). 빌드·헬스·전환 로그 `project_StockInvest.log` 의 START sha=c33e467 ~ END exit=0(KST 23:15:57 ~ 23:18:12).
- 릴리스: `20261106-231601-c33e4678`. `RELEASE_RESULT {"status":"ok","release":"20261106-231601-c33e4678","sha":"c33e467848ad59dfad59849fa5ceed1aade6c3eb","previous":"/home/brownjeon/apps/stockinvest/releases/20261106-230448-f47cf28a","migrated":false}`
- 전환: `current` → `releases/20261106-231601-c33e4678` (23:16:33 확인). 직전 릴리스 `20261106-230448-f47cf28a` 는 보관(롤백 지점, 실행 안 함).
- 확인 결과(23:18):
  - `/api/health` 200 (로컬 `127.0.0.1:3003`, 응답 4.2초). `ok:true, db:true, schemaFatal:false, safetyStatus:green, dryRun:true, killSwitch:true, limitsConfigured:true, authConfigured:true, cronSecretConfigured:true, engine.enabled:true, autopilotMode:auto`. 킬스위치·DRY_RUN 값은 건드리지 않았다. 이 응답의 `dryRun:true` 는 배포 전 값을 기록하지 않아 비교하지 못했다(미확인 항목 아님, 현재 값만 기록).
  - 무세션 `GET /api/chat/threads` → 401.
  - pm2: `stockinvest` id 141 online, pid 511094, restarts 0, cwd 새 릴리스. `stockinvest-cron` id 142 online, pid 511163, restarts 0, cwd 새 릴리스. `stockinvest-cron` 은 정확히 1개(이전 id 140 은 release.sh 가 삭제 후 재등록).
  - 3003 LISTEN 1행(소켓 소유 프로세스 `PM2 v6.0.14: Go` pid 1928 = God Daemon). 실제 서빙 워커 511094 의 cwd 가 새 릴리스.
  - 최근 에러 로그(`pm2-err.log`·`pm2-out.log`·`cron-out.log`): `Unknown column`/`ER_BAD_FIELD` 0건. 23:15 이후 err 로그 1줄: `[strategy/records/job-run-log] 503 reason=timeout (deadline=2500ms)`(기동 직후 23:16:34, 러너가 스풀 후 재전송 — 같은 메시지가 22:59 에도 있었음).
  - 부팅 로그: `자동 청산 엔진 ON`(system_config.exit_engine_enabled=true) 기록. 설정은 바꾸지 않았다.
- 미실행: 백필(`BEGIN NOT ATOMIC` 블록), DB 쓰기, pm2 조작(배포 스크립트 외), 롤백. 실화면(브라우저)과 로그인 세션을 통한 채팅 소유권 동작은 확인하지 않았다(미확인).
- 이상 징후: 없음. 헬스 최초 몇 분간 3003 health 000(기동 중) — 재기동 직후 정상 전환 범위.


- **2차 배포 (2026-11-07 00:23 KST, 문서·스크립트 보관 커밋)**: 사용자 명시 지시로 `git push origin main` 실행. 범위 `c33e467..2ce0186` (커밋 1개: `2ce0186 docs(T-113): 미커밋 산출물 보관 + 메뉴 구현 가이드 비서 탭 갱신`). push 직전 `git fetch` 로 origin/main = `c33e467` 확인(움직이지 않음), `git-refs-clean.sh --check` 깨끗함. push 00:23:20 KST. 서버 clone `/home/brownjeon/.node-local/stockinvest-t113-clone` 에서 실행, 공유 NFS 저장소에서는 push 하지 않았다. 런타임 src 변화 없음(`c33e467..2ce0186` 의 src 변경은 시험 파일 1개 추가뿐).
- 배포 경로: webhook(release.sh), `--migrate` 없음. `RELEASE_RESULT {"status":"ok","release":"20261107-002331-2ce01869","sha":"2ce01869cd95992a49b35ec198cbed1a72193037","previous":"/home/brownjeon/apps/stockinvest/releases/20261106-231601-c33e4678","migrated":false}`. 로그 START 00:23:25 ~ END 00:24:50 KST, exit=0. `current` → `releases/20261107-002331-2ce01869`. 롤백 지점 `20261106-231601-c33e4678` 보관, 실행하지 않음.
- 확인 결과(00:25 KST): `/api/health` 200, `ok:true`, `db:true`, `schemaFatal:false`, `safety.dryRun:true`, `safety.killSwitch:true`(건드리지 않음). pm2 `stockinvest` id 143 online·restarts 0·cwd 새 릴리스, `stockinvest-cron` id 144 online·restarts 0·cwd 새 릴리스, cron 정확히 1개. 릴리스 디렉터리 밖에서 도는 StockInvest 프로세스 0. 무세션 `GET /api/chat/threads` 401. 00:23:31 이후 pm2-err·cron-err 에 `Unknown column`·예외 0건.
- **판정 주의: `safetyStatus: red`** (`safetyReasons: ["order_limits_unconfigured"]`). DB `system_config` 의 `safety_order_max_pct`·`safety_daily_order_max_pct` 가 미설정으로 읽혀 1회·일일 한도가 0이 되었고, 신규 매수는 차단된다(fail-safe). 11-06 23:18 점검 때는 green 이었다. 로그상 첫 `미설정` 은 00:00:40 KST 이며, 그 약 1분 전 23:59:43 에 `[settings:safety]`(자동 청산 엔진 ON, KIS 유량 5 req/s) 저장 로그가 있다. 이번 배포는 src 를 바꾸지 않았으므로 배포가 직접 원인은 아니다(배포 전 00:00:40 부터 발생). 원인은 확정하지 못했다(운영 DB 직접 조회 금지로 미확인). 조치하지 않았다(DB 쓰기 금지, 롤백 무의미). **한도 값 확인·재설정은 사용자 판단 사항이다.**
- 이상 징후·미확인: `shared/.env` mtime 2026-11-07 00:02(내용 미열람). 자동 청산 엔진이 ON 상태이며, 킬스위치 true 에서 매도가 실제로 막히는지는 미확인. 로그인 세션 기반 채팅 화면 동작은 미확인. 이 배포 커밋에는 이 task 파일이 포함되어 있어 이 기록은 다음 커밋 때 올라간다.

## 운영 이관 완료 (2026-11-06 23:19, 메인 세션)

- **⑤ 백필(23:19:03)**: 가드 통과 — current = `20261106-231601-c33e4678`, 릴리스 디렉터리에서 도는 프로세스 전부 새 릴리스(구 릴리스 0, next-server 1). 직전 재측정 NULL 13 → `BEGIN NOT ATOMIC` 블록 `COMMITTED 13 0`. 귀속 13·NULL 0·소유 대화의 메시지 32. 백필 전후 다른 열 지문(대화 7열·메시지 11열, `updated_at` 포함) 동일. 대상 목록(id·이전 owner·updated_at)은 앱 호스트 `~/backups/stockinvest-t113/backfill-targets-*.tsv`(0600)에 남겼다 — 되돌릴 때는 이 목록으로 행 단위 `user_id=NULL` 복원(표 복원 금지, Reviewer Low).
- **⑥ 화면 확인**: 운영 `/ai` 는 로그인 필요라 AI 가 확인하지 못했다(계정 로그인은 하지 않는다) → 사용자 확인 대기.
- 배포 커밋 `c33e467`(부모 `f47cf28`)은 공유 NFS 작업 트리가 아니라 서버 로컬 clone `~/.node-local/stockinvest-t113-clone` 에서 만들고 push 했다(서버 commit-msg 훅 「Reviewer 감사 기록 확인: T-113」 통과). 처음 만든 공유 저장소 worktree 는 다른 세션의 정리로 메타데이터가 사라져 버렸다(남은 디렉터리 `~/.node-local/stockinvest-t113-deploy` 는 미사용).

## 최종 요약

### [T-113] 챗봇 대화 소유권·서버 인가 — 운영 반영 (2026-11-06)
- **상태**: done · 사용자 화면 확인 대기(`waiting`).
- **무엇이 바뀌었나**: 채팅 API 5개가 로그인 계정 본인의 대화만 읽기·쓰기·삭제하고, 남의 대화·소유자 없는 대화는 404, 세션 없음·삭제 계정은 401. LLM 호출 전후로 소유권을 다시 확인한다. DB `chat_threads.user_id` 추가, 기존 대화 13건을 현재 계정으로 귀속.
- **배포**: 커밋 `c33e467` → 2026-11-06 23:15:53 push → 릴리스 `20261106-231601-c33e4678`(23:18:12 완료, `migrated:false`, 롤백 지점 `20261106-230448-f47cf28a`). 같은 배포에 실린 다른 작업 없음. DDL 23:12:08(수동 1회), 백필 23:19:03.
- **AI 가 검증한 것**: 운영 재측정(users 1·13/32), 암호화 백업의 격리 복원 지문 일치, DDL 전후·백필 전후 데이터 지문 불변, 배포 후 health 200·pm2 정상·무세션 401·`Unknown column` 0. QA(origin/main 기준) Jest 27/27·tsc 0·실 MariaDB 인가 16/16·구버전 호환. Reviewer PASS.
- **AI 가 못 한 것**: 로그인한 실제 화면·실제 계정 세션으로의 채팅 동작, 브라우저 UI, 구·신 인스턴스 동시 쓰기.
- **👉 사용자가 확인할 것**: 웹/앱 `/ai`(AI 탭)에서 **기존 대화 13건이 목록에 보이고, 하나를 열어 메시지가 보이며, 새 질문 1건이 저장되는지**. 비어 보이거나 오류가 나면 바로 알려 주세요(백필 대상 목록으로 즉시 되돌릴 수 있다).
- **남은 일**: ① `ChatPage.tsx` 오류 처리 보완(QA — 401 에서 로그인 이동 없음, 404 때 이전 메시지 잔존, 삭제 버튼이 응답을 보지 않음; 저~중) — T-152 연결 어댑터와 함께 다루는 것을 권고. ② 커밋하지 않은 T-113 산출물: 설계 문서 4개·operator/backfill/drill 스크립트·백필 계약 시험(공유 작업 트리에 미추적으로 남음 — 보관 또는 정리 결정 필요). ③ 공유 NFS 작업 트리의 `main` 은 origin 보다 뒤처져 있고 T-113 파일이 미커밋 상태로 남아 있어, 다음 `git pull` 때 「덮어쓰기」 충돌이 날 수 있다(내용은 origin 과 같다).
- **이슈·위험**: 11-04 의 차단·drain 설계는 다중 사용자 전제로 대체하지 않고 남겨 두었다 — **사용자가 2명 이상이 되기 전에** 구버전 호환 경로 없이 운영하므로 문제없지만, 같은 방식의 이관을 다중 사용자 상황에 재사용하면 안 된다. 킬스위치 true·DRY_RUN true 는 그대로다.

### 이전 요약 (2026-11-04)

- 상태: 소유권·서버 인가 코드 및 수동 DDL/백필 검토안 작성, 독립 정적 감사 PASS·격리 QA 조건부 PASS. 운영 스키마 이관·기존 이력 귀속·실제 채팅 연동은 미완료.
- 변경: `src/app/api/chat/` 라우트·`src/lib/chat/ownership.ts`·신규 생성 스키마·수동 DDL·시험과 이관 계획. 기존 채팅 API를 소유자별로 제한하되, 기존 미분류 대화는 백필 전 비노출이다.
- 배포: 커밋·push·DDL·백필·서비스 조작 없음. 사전 집계는 읽기 전용으로만 수행했다.
- 검증: 모의 24/24, 일회용 MariaDB·실제 세션 기반 8/8, 타입검사 통과. 백필 표현식은 격리 18 assertion; 자동 STOP은 테스트 하네스일 뿐 계획 파일엔 없다. 운영 전환·백업 복구·실데이터 귀속·구버전 차단 및 실제 앱 연결은 미검증.
- 미결·다음: 기존 대화 소유자·삭제 계정 여부는 사용자 확인을 받았다. 현행 차단·드레인·백업 복구 및 릴리스 차이 검증이 남았으며, 실제 DDL은 AGENTS.md의 DB 마이그레이션 명시 승인 및 배포 절차를 따라야 한다. 대상 집합·백업·쓰기/구버전 차단·원자 대조와 정밀 복원 경로 검증 후 전환 계획을 구체화한다. 공통 라이브러리의 기존 화면 연동·데모 게이트는 별도 후속이다.
- 이슈: 8월 승인 양 테이블 user_id/첫 사용자 귀속 명세와 현재 단일 부모 owner·NULL 보류는 차이 있는 중간안. Claude C1/C2 실제 외부 검토 미실시, 정식 runner `incomplete / bad_file_list`; 소스 전송 없음. 전체 task 및 안전성 통과로 오인 금지.

