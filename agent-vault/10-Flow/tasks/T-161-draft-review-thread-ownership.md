---
task_id: T-161
title: 초안 검토 카드의 대화 소속 고정 + 전송 뒤 재조회 실패 문구
status: done
project: StockInvest
created: 2026-11-07
updated: 2026-11-08
waiting: "결정 1건(QA-L1 수정 여부)"
execution_context:
  schema_version: 1
  origin_tool: claude
  current_tool: claude
  current_procedure: claude_standard
  current_scope: "ChatPage 초안 검토 카드의 대화 소속(ⓑ)·전송 뒤 재조회 실패 문구 — 구현·검증·웹 배포"
  last_event_id: exec-001
base_ref: 5fdfc19d
risk_level: R2
roles_involved: [leader, judge, developer, reviewer, qa, deployer]
related_tasks: [T-157, T-113, T-152]
tags: [type/task, domain/ui]
demo_gate:
  required: true
  level: "delta"
  status: "approved"
  version: 1
  repo_path: "mockups/T-161-draft-review-ownership-v1.html"
  artifact_url: ""
  content_sha256: "959795523a1564a5e191a250345555c9f0f7585995f894b21eaa09635007c203"
  decided_by: "judge"
  rule_id: "JV-ui_change"
  approved_by: "user"
  approved_at: "2026-11-07T18:08:11+09:00"
  approval_quote: "권고안으로 승인"
  waived_by: ""
  waived_at: ""
  waiver_quote: ""
  active: false
---

# T-161 초안 검토 카드의 대화 소속 고정 + 전송 뒤 재조회 실패 문구

## Leader

- **사용자 지시(2026-11-07)**: T-157 최종 보고의 「결정할 것 1」에 **「ⓑ로 진행」**. 선택지는 ⓐ 대화를 전환하면 검토 카드를 지운다(사용자가 고친 초안이 사라진다) vs **ⓑ 확인을 원래 보낸 대화로 보낸다** 였고 사용자가 ⓑ 를 택했다. T-157 최종 요약의 「남은 일」에 있던 **QA Low 1건(전송 뒤 재조회 실패 문구)** 도 같은 함수·같은 흐름이라 이 task 에 함께 넣는다.
- **지금 무엇이 잘못됐나** — `src/app/ai/ChatPage.tsx` 의 `handleConfirmDraft` 가 **클릭 시점의 `activeThreadId`** 를 쓴다. 초안(검토 카드)은 어느 대화에서 만들어졌는지를 기억하지 않는다. 그래서 검토 카드가 열린 채 활성 대화가 바뀌면 다섯 갈래로 어긋난다.
  1. **검토 중 다른 대화 선택** → 「확정 전송」이 **그 다른 대화**로 간다. 초안은 옛 대화 이력(`/draft` 가 `RECENT_HISTORY_LIMIT` 로 읽은 그 대화의 최근 메시지)으로 만들어졌는데 저장은 남의 대화에 된다 — T-157 Reviewer Medium(08:38, 「7번 질문이 8번에 들어간다」).
  2. **검토 중 「+ 새 대화」** → `activeThreadId = null` → `handleConfirmDraft` 가 즉시 반환해 **버튼이 무반응**(아무 안내도 없다).
  3. **검토 중 선택한 대화의 메시지 조회가 404**(삭제됨·남의 대화) → `handleThreadGone` 이 선택을 해제 → 같은 **무반응** — T-157 Codex C2 low 지적 2(`ChatPage.tsx:122`).
  4. **검토 중인 대화를 목록에서 삭제** → 선택 해제 → 같은 **무반응**.
  5. **정제 요청이 도는 중(stage `drafting`) 대화 전환** → 초안은 옛 대화 이력으로 만들어지고 메시지는 새 대화에 저장된다(1 과 같은 결과, 시작 시점만 다르다).
- **목표 1 (ⓑ)**: 초안 검토 카드가 **자기 대화를 기억**한다. 「확정 전송」은 지금 보고 있는 대화가 아니라 **초안을 만든 대화**로 보낸다. 보낸 대화가 지금 보고 있는 대화가 아니면 **기존 안내 띠**로 어디로 보냈는지 알린다. 보낼 대화가 사라졌으면(404·삭제) 검토 카드를 닫고 안내한다 — 보낼 곳이 없으므로 이때만 초안을 버린다.
- **목표 2 (QA Low 1)**: 전송 POST 는 200 인데 뒤이은 메시지 재조회가 실패하면 지금은 입력칸이 비고 목록에 새 메시지도 없이 「메시지 조회 실패 (HTTP 500)」만 뜬다 — **전송이 됐는지 문구가 말하지 않는다**. 「전송은 됐고 화면 갱신만 실패했다」로 구분해 알린다.
- **경계**: 웹 코드만(네이티브·APK 변경 없음 — 앱은 다시 열면 반영). **화면 요소를 새로 추가하지 않는다** — 새 버튼·카드·배지 없이 동작과 안내 문구만 바꾸고, 안내는 T-157 `THREAD_GONE_MESSAGE` 와 같은 기존 띠(`ChatErrorBar`)를 쓴다. 채팅 API·DB·인증 코드는 건드리지 않는다(`/draft` 는 DB 에 저장하지 않으므로 서버 변경이 필요 없다). T-152 공통 UI 연결은 하지 않는다. 검토 카드에 「어느 대화로 보낼지」를 **미리** 보여 주는 표시는 화면 추가라 이 task 에서 하지 않고 후속 후보로 남긴다.
- **관련 과거 이력**: [[T-157-assistant-tab-and-chat-errors]](이 task 의 출처 — Reviewer Medium 08:38 · Codex C2 low 지적 2 · QA 신규 Low 09:38 · 최종 요약의 결정 1) · [[T-113-chat-ownership-authorization]](채팅 소유권·권한, 서버 쪽은 그대로) · [[T-152-independent-chat-library]](별개, 연결 안 함).
- **작업 위치**: 공유 NFS 트리에서 `src/app/ai/ChatPage.tsx` 와 그 시험 `src/app/ai/__tests__/chat-page-errors-t157.test.ts` 만 고치고, 서버 로컬 clone(`~/.node-local/stockinvest-t157`, `origin/main`=`5fdfc19` 로 reset 함 — 이름만 T-157 이고 내용은 이번 작업)으로 옮겨 jest·tsc 실행 후 커밋·push 한다. **`SAFETY_PATHS` 실측 결과 이 두 파일은 감시 대상이 아니다**(`awk '/^SAFETY_PATHS=\(/,/^\)/' scripts/git-hooks/commit-msg` 에 `src/app/ai/` 없음) — 그래도 Reviewer 판정 줄은 남긴다.

### 구현 가이드 (Leader, 데모 v1 승인 뒤)

- [18:10] **사용자 승인**: 「권고안으로 승인」 → `check.mjs approve --version 1` 기록 완료(gate `approved`, sha256 `959795523a15…`). 채택안: **결정 1 = A**(검토 카드 머리글 조건부 한 줄), **결정 2 = B**(안내 띠 호박색 + `role="status"`), **문구 3종 = designer 권고안 그대로**. 다룰 파일은 `src/app/ai/ChatPage.tsx` 와 `src/app/ai/__tests__/chat-page-errors-t157.test.ts` **둘뿐**이다.
- [18:10] **Leader 판단 1건**(designer 가 지정하지 않은 지점): 상태 5(전송 200 + 재조회 실패) 띠도 **호박색/`role="status"`** 로 간다 — 「전송 완료」로 시작하는 안내이고 사용자의 다음 행동이 「대화를 다시 열기」라 오류 복구 조작이 아니다. 빨강으로 두면 실패로 읽혀 중복 전송을 유도하고 이는 목표 2 와 정면으로 충돌한다. 반면 상태 4(보낼 대화 삭제)는 **실제 전송 실패**라 빨강/`role="alert"` 유지. Reviewer 가 이 구분을 함께 본다.
- [18:10] **띠 종류 판별은 상태를 늘리지 않고 문구로 유도한다**: `SENT_NOTICE_PREFIX = '전송 완료 — '` 를 내보내고 `ChatErrorBar` 가 `message.startsWith(SENT_NOTICE_PREFIX)` 일 때만 호박색 + `role="status"`. 근거: `error` 는 단일 문자열 상태이고 `setError` 호출이 14곳이라(실측: 127·137·145·172·201·238·242·259·270·292·314·323·348 + 신규) tone 상태를 더하면 전 호출을 손봐야 하고 한 곳만 빠져도 색이 틀린다. 서버 오류 문자열이 이 접두와 겹칠 가능성은 색만 바뀌는 문제라 감수한다.

#### 상태·참조 (ChatPage.tsx)

- `const [draftThreadId, setDraftThreadId] = useState<number|null>(null)` — 초안이 만들어진 대화.
- `const [draftContent, setDraftContent] = useState('')` — 초안을 만든 **그 글**(클릭 시점의 입력칸 값이 아니다).
- `const draftThreadIdRef = useRef<number|null>(null)` — `activeIdRef` 와 같은 기존 패턴. 바꾸는 지점에서 즉시 대입해 비동기 가드에서 읽는다(콜백 deps 를 늘리지 않기 위함).

#### 내보낼 문구 (데모 승인 값 그대로)

- `DRAFT_THREAD_GONE_MESSAGE` = `보낼 대화가 삭제돼 전송하지 못했습니다. 검토 중이던 초안도 닫혔습니다 — 질문을 다시 입력해 주세요.`
- `SENT_TO_OTHER_THREAD_MESSAGE(title)` = `전송 완료 — 「<title>」 대화에 저장했습니다. 보려면 그 대화를 여세요.`
- `SENT_RELOAD_FAILED_PREFIX` = `전송 완료 — 화면 갱신만 실패했습니다` (뒤에 기존 형식대로 ` (HTTP 500).` + `대화를 다시 열면 답변이 보입니다.`)
- `SENT_NOTICE_PREFIX` = `전송 완료 — ` (띠 종류 판별용 — 위 두 문구가 모두 이 접두로 시작한다)
- 기존 `THREAD_GONE_MESSAGE` 는 **다른 404 경로에 그대로 둔다**(초안이 걸린 경우에만 새 문구).

#### 함수 변경

- `clearDraft()`: 초안 관련 상태(`draftPrompt`·`draftContext`·`draftMeta`·`draftThreadId`·`draftContent`) + `draftThreadIdRef` 비움. **stage 는 건드리지 않는다.**
- `discardDraft()`: `clearDraft()` + `setStage(s => s === 'review' ? 'idle' : s)` — 전송 중(`generating`) stage 를 덮지 않는다.
- `handleSend` 1단계(정제) 성공 직후: `draftThreadIdRef.current = tid; setDraftThreadId(tid); setDraftContent(content)`.
- `handleConfirmDraft`:
  - `const tid = draftThreadIdRef.current` — **`activeThreadId` 를 쓰지 않는다**(ⓑ 핵심).
  - `tid == null` → `discardDraft()` + `setError(DRAFT_THREAD_GONE_MESSAGE)` + return(무반응 제거).
  - 본문 `content` 는 `draftContent`.
  - `not_found` → `handleThreadGone(tid)`.
  - 성공 → `await reloadMessages(tid, { afterSend: true })` → `clearSentInput(content)` → `away = activeIdRef.current !== tid` 를 **응답 뒤에** 판정해 away 면 `setError(SENT_TO_OTHER_THREAD_MESSAGE(제목))`. 제목은 `threads` 에서 찾고 없으면 기존 목록 표기 규칙을 따른다.
  - `finally { clearDraft(); setStage('idle') }` — 성공·실패 모두 카드가 닫히는 현재 동작을 유지.
- `handleCancelDraft`: `setStage('idle')` + `clearDraft()`.
- `handleThreadGone(tid)`: `draftThreadIdRef.current === tid` 면 `discardDraft()` 후 `DRAFT_THREAD_GONE_MESSAGE`, 아니면 기존 `THREAD_GONE_MESSAGE`.
- `handleDeleteThread(id)` 성공 뒤: `draftThreadIdRef.current === id` 면 `discardDraft()` + `DRAFT_THREAD_GONE_MESSAGE`.
- `reloadMessages(tid, opts?: { afterSend?: boolean })`: 실패 시 `afterSend` 면 `SENT_RELOAD_FAILED_PREFIX` 형식 문구, 아니면 **기존 `메시지 조회 실패 (HTTP nnn)` 그대로**. 호출 2곳(`handleSend` 직진 경로·`handleConfirmDraft`)만 `afterSend: true`.
- `DraftReview`: `awayTitle?: string | null` prop 을 받아 **머리글에 조건부 한 줄**(결정 1-A) `↩ 「<제목>」 대화로 전송합니다`(12px·`--accent`, `↩` 는 `aria-hidden`). 보고 있는 대화와 같으면 렌더하지 않는다. 버튼 라벨·요소 구성은 현행 유지(새 버튼·카드·배지 없음).
- `ChatErrorBar`: `message.startsWith(SENT_NOTICE_PREFIX)` 면 `role="status"` + `background:'rgba(245,158,11,.15)'` + `color:'var(--accent)'`, 아니면 현행 빨강 `role="alert"` 그대로.

#### 시험 (⑫ T-161 — `__tests__` 는 데모 게이트 `exclude_globs` 라 게이트 밖)

1. 검토 중 다른 대화(8) 선택 뒤 확정 → POST 가 `/threads/7/messages` + 본문 `content` 가 원래 글 + 8 화면은 그대로 + 안내 띠.
2. 검토 중 「+ 새 대화」 뒤 확정 → 7 로 전송(무반응 아님).
3. 다른 대화 404 로 선택이 해제돼도 초안은 살아 있고 확정은 7 로 간다.
4. 검토 중인 **그** 대화가 404 → 카드 닫힘 + `DRAFT_THREAD_GONE_MESSAGE`.
5. 검토 중인 대화 삭제 → 카드 닫힘 + 같은 안내.
6. 정제 중(`drafting`) 대화 전환 → 확정은 **정제를 요청한** 대화로(Reviewer Medium 회귀).
7. 같은 대화에서 확정 → 안내 띠 **없음**(away 오탐 회귀).
8. 직진 전송 200 + 재조회 500 → `SENT_RELOAD_FAILED_PREFIX` 문구.
9. 확정 전송 200 + 재조회 500 → 같은 문구.
10. 대화 전환 로드 500 → 기존 `메시지 조회 실패 (HTTP 500)` 그대로(`afterSend` 아님).
11. 안내 띠는 `role="status"`+호박색, 오류 띠는 `role="alert"`+빨강(결정 2-B 회귀).
12. 머리글 조건부 한 줄: away 면 제목이 나오고 같은 대화면 나오지 않는다(결정 1-A 회귀).
- 기존 42건 전부 통과해야 한다 — 특히 ⑥ 확정 전송 경합 2건(`tid` 가 7 로 고정돼 결과가 같아야 한다)과 543행(띠 style 문자열 고정)은 결정 2-B 로 **1줄 수정**이 필요하다.

#### 검증 위치

서버 clone `~/.node-local/stockinvest-t157`(`origin/main`=`5fdfc19` 로 reset — 이름만 T-157 이고 내용은 이번 작업), `node_modules` 는 `stockinvest-t155` 심볼릭 링크. **`trap` 으로 `node_modules` 링크를 지우지 않는다**(T-157 에서 reviewer 재측정을 깬 원인). 기준선 실측: `npx jest src/app/ai/__tests__/chat-page-errors-t157.test.ts src/components/__tests__/bottom-tabs-t108.test.ts` → 2 suites / **80 passed**.

## 실행 도구·절차 이력

| 이벤트 ID | 시각(KST) | 사건 | 이전 → 현재 담당 / 현재 절차 | 범위·인계 대상·남은 일 | 근거 |
|---|---|---|---|---|---|
| exec-001 | 2026-11-07 13:40 | start | 없음 → claude / claude_standard | 초안 소속(ⓑ)·재조회 실패 문구 구현부터 웹 배포까지 | 사용자 지시 「ⓑ로 진행」(Claude Code 데스크톱 세션) |

## 판단 기록 (judge)

- [2026-11-07 13:48] intake engine=jev → task_type=local_fix · risk=R2 · developer_model=opus · next=demo_first · demo=delta/designer · actions=prepare_demo,request_demo_approval,assign_developer | overrides=R2-kw-auth,MD-r2-opus | fallback=- | tokens=1350

## Designer

- [14:03] 실행 도구: Claude Code(designer 서브에이전트). 데모 **v1 작성 완료** — `mockups/T-161-draft-review-ownership-v1.html` (한 파일 HTML·인라인 CSS·스크립트 0줄·외부 참조 0건). `node ../.claude/tools/demo-gate/check.mjs lint --file mockups/T-161-draft-review-ownership-v1.html --expect T-161-v1` → **DEMO_LINT_PASSED**. 토큰 값은 `src/app/globals.css@sha256:04e7b5bc8394` 에서 복사해 `<style>` 에 고정.
- [14:03] 읽은 현행: `src/app/ai/ChatPage.tsx`(전문) · `src/app/globals.css` · `src/components/BottomTabs.tsx`(탭 라벨 홈·거래·분석·비서·설정) · `src/app/ai/__tests__/chat-page-errors-t157.test.ts`(543행이 띠의 style 문자열을 글자 단위로 고정하고 있다). 데모의 화면 복제는 ChatPage 의 실제 수치(헤더 38px·메시지 gap 10·검토 카드 `border-top:2px var(--accent)`·버튼 `6px 12px`/12px·띠 `padding:8px; background:rgba(239,68,68,.15); color:var(--down); font-size:12px`)를 그대로 옮겼고, 띠가 **입력칸 아래·하단 탭 바 위**에 뜨는 위치를 보이려고 탭 바까지 그렸다.
- [14:03] 데모 내용(delta 범위): 상태 1 기준(변화 없음 1컷) · 상태 2 누르기 전(현재 vs 제안) · 상태 3 전송 성공 후(현재 vs 제안 + 「+ 새 대화」 변형) · 상태 4 보낼 대화 소멸(현재 vs 제안) · 상태 5 200+재조회 500(현재 vs 제안) · 문구 3종 각 2안+권고 · 폭 확인(360/412/1280) · 승인 시 볼 지점 · 미확인 목록. **결정 필요 2건**을 데모 안 패널에 A/B 로 넣었다(대화로 묻지 않음).
- [14:03] **결정 1 — 「다른 대화로 간다」를 미리 알리는 방법.** A(권고) 검토 카드 머리글에 조건부 한 줄 `↩ 「<대화 제목>」 대화로 전송합니다`(12px·`--accent`, 보고 있는 대화와 같으면 나타나지 않음) + 버튼 라벨은 현행 유지. B 버튼 라벨을 `다른 대화로 전송 ▶` 로 교체. **A 권고 근거**: B 는 *어느* 대화인지 말하지 못하고, 편집 여부와 곱해져 라벨이 네 가지가 되며, 같은 버튼의 글자가 상황에 따라 바뀐다. 폭은 B 의 약점이 **아니다** — 360px 실측 취소 47px + 확정 164px = 217px / 쓸 수 있는 340px 로 한 줄에 들어간다(초안에 「두 줄로 내려앉는다」고 적었다가 실측으로 정정했다).
- [14:03] **결정 2 — 안내 띠 색.** A(기준안) 빨강 그대로·문구만 구분 — delta 범위 안. B(권고) 안내만 호박색(`rgba(245,158,11,.15)` + `--accent`) — **새 색이 아니다**(`--accent` 재사용이고 같은 패턴이 `src/app/settings/SettingsPage.tsx:704` 의 `role="alert"` 띠에 이미 있다). 근거: 상태 3 은 **전송이 성공한** 경우인데 빨강이면 실패로 읽혀 중복 전송을 유도한다 — 이 task 의 목표 2 와 같은 위험이다. 명암비(토큰 값 계산, 실기기 측정 아님): 현재 빨강 배경+파랑 글자 **4.43:1**(12px 기준 4.5:1 미달), 호박색 **6.87:1**. B 는 띠에 종류 구분 1개 + 위 시험 543행 1줄 수정이 필요해 「문구만 바꾸기」보다 조금 넓다 → **사용자 결정 사항**으로 올린다.
- [14:03] **문구 3종 권고**(각 2안은 데모 참조) — ① 상태 3: `전송 완료 — 「<대화 제목>」 대화에 저장했습니다. 보려면 그 대화를 여세요.` ② 상태 4: `보낼 대화가 삭제돼 전송하지 못했습니다. 검토 중이던 초안도 닫혔습니다 — 질문을 다시 입력해 주세요.`(기존 `THREAD_GONE_MESSAGE` 는 다른 404 경로에서 그대로 두고 이 경우에만 새 문구) ③ 상태 5: `전송 완료 — 화면 갱신만 실패했습니다 (HTTP 500). 대화를 다시 열면 답변이 보입니다.` 공통 규칙: 성공·실패를 첫 단어로, 금지문(「다시 보내지 마세요」) 대신 성공을 먼저 알려 중복 전송 동기를 없앤다, 대화는 「제목」으로 가리킨다, HTTP 코드는 기존 띠 형식대로 끝에 붙인다.
- [14:03] 폭·치수 실측(브라우저, 데모 페이지 기준 — **갤럭시 S25+ 실기기 측정 아님**): 360·412px 모두 가로 스크롤 0·뷰포트 초과 요소 0건, 1280px 에서 현재/제안 2단·문구 3단 복원 확인. 띠 문구는 권고안 3종 모두 360·412px 에서 **두 줄(53px)** — 지금의 한 줄 띠(35px)보다 18px 높아 메시지 영역이 그만큼 줄어든다.
- [14:03] 디자인 스킬: ui-component-builder · project-ui-system(부분 — 원칙만) · ui-design-reviewer · ui-accessibility-reviewer / 자체 점검 **P0 0 · P1 0 · P2 3**, a11y **Critical 0 · Major 0 · Minor 2**. P2: ① 머리글 한 줄이 생겼다 사라지며 카드 높이 ~22px 변동 ② 머리글 메타줄 10px 과 새 안내줄 12px 이 섞인다(중요도 차이라 의도) ③ 띠 두 줄로 메시지 영역 18px 감소. Minor: ① 상태 3 성공 안내를 `role="alert"` 로 읽으면 긴급으로 들린다 → 결정 2-B 채택 시 `role="status"` 로 함께 바꾸길 권고 ② ↩ 는 `aria-hidden`, 정보는 전부 글로 담아 색만으로 전달하지 않음.
- [14:03] **범위 밖 기존 결함**(이번 작업에서 손대지 않음 · 후속 후보): 검토 카드 취소·확정 버튼 높이 **31px**, 띠 × 닫기 버튼은 그보다 작다 — 둘 다 권장 터치 44px 미만. 머리글 메타 10px·composer 힌트 9px 은 11px 미만. 띠의 빨강 배경+파랑 글자 4.43:1.
- [14:03] 다음: Leader 가 Artifact 게시·사용자 승인 기록(`check.mjs`). **승인(또는 생략) 전에는 구현 가이드를 developer 에게 넘기지 않는다.** 승인 뒤 결정 1·2 의 선택에 맞춰 구현 가이드를 쓴다 — 가이드에서 다룰 파일은 `src/app/ai/ChatPage.tsx` 와 `src/app/ai/__tests__/chat-page-errors-t157.test.ts` 뿐이고, 결정 2-B 를 택하면 그 시험의 543행(띠 style 문자열)이 함께 바뀐다.

## Developer

- [18:24] 실행 도구: Claude Code(developer 서브에이전트, Opus). 데모 게이트 확인: `node ../.claude/tools/demo-gate/check.mjs check --task agent-vault/10-Flow/tasks/T-161-draft-review-thread-ownership.md` → `DEMO_GATE_PASSED` / `task: T-161` (status approved · approved_version v1 · hash verified). 가이드의 승인 데모 v1 기준으로 구현했고 `mockups/**` 는 건드리지 않았다. 고친 파일은 가이드가 지정한 **둘뿐**이다 — `src/app/ai/ChatPage.tsx` · `src/app/ai/__tests__/chat-page-errors-t157.test.ts`. 서버·API·DB·인증 코드 변경 0건, 새 화면 요소(버튼·카드·배지) 0건. `SAFETY_PATHS` 비대상(실측 — `src/app/ai/` 없음).
- [18:24] `ChatPage.tsx` 변경 요지 — ① 내보낸 문구 4종 + 조립 함수(`SENT_NOTICE_PREFIX`·`DRAFT_THREAD_GONE_MESSAGE`·`SENT_TO_OTHER_THREAD_MESSAGE(title)`·`SENT_RELOAD_FAILED_PREFIX`·`sentReloadFailedMessage()`) ② 상태 `draftThreadId`·`draftContent` + ref `draftThreadIdRef`(렌더에서 되비추지 않는다 — 초안 생존 판정에 쓰므로) ③ `clearDraft()`(stage 불변)·`discardDraft()`(`review` 일 때만 `idle`) ④ `handleSend` 정제 성공 직후 `draftThreadIdRef.current = tid` 고정 ⑤ `handleConfirmDraft` 가 `activeThreadId` 대신 `draftThreadIdRef.current` 로 전송, 본문은 `draftContent`, `tid == null` 이면 `discardDraft()` + 안내(무반응 제거), 성공 뒤 `away` 를 **응답 도착 후** 판정 ⑥ `reloadMessages(tid, { afterSend })` ⑦ `handleThreadGone`·`handleDeleteThread` 가 초안이 걸린 대화면 초안을 버리고 `DRAFT_THREAD_GONE_MESSAGE` ⑧ `DraftReview` 에 `awayTitle` prop → 머리글 조건부 한 줄(결정 1-A, `↩` 는 `aria-hidden`) ⑨ `ChatErrorBar` 가 접두로 안내/오류를 갈라 호박색+`role="status"` / 빨강+`role="alert"`(결정 2-B).
- [18:24] 추가한 시험 12건(기존 ⑫ 묶음 신규) — 1 다른 대화를 보는 중 확정 → POST 는 `/threads/7/messages`·본문 content 는 원래 글·8 화면 불변·안내 띠 / 2 「+ 새 대화」 뒤 확정도 7 로(무반응 아님, 새 대화 생성 안 함) / 3 다른 대화 404 로 선택 해제돼도 초안 생존·확정은 7 로 / 4 확정 POST 404 → 카드 닫힘·`DRAFT_THREAD_GONE_MESSAGE`·입력칸에 쓴 글 유지 / 5 검토 중인 대화 삭제 → 카드 닫힘·같은 안내·POST 없음 / 6 정제 중 대화 전환 → 확정은 정제를 요청한 7 로(Reviewer Medium 회귀) / 7 같은 대화 확정 → 안내 띠 없음(away 오탐) / 8 직진 200 + 재조회 500 → `전송 완료 — 화면 갱신만 실패했습니다 (HTTP 500). 대화를 다시 열면 답변이 보입니다.`·기존 메시지 유지 / 9 확정 200 + 재조회 500 → 같은 문구 / 10 대화 전환 로드 500 → 기존 `메시지 조회 실패 (HTTP 500)` 그대로 / 11 띠 role·색 2종(+ 재조회 안내는 status, 보낼 대화 소멸은 alert) / 12 머리글 조건부 한 줄(같은 대화면 없음·다른 대화면 「제목」·`aria-hidden`).
- [18:24] **기존 시험 1건을 고쳤다 — 가이드의 「기존 42건 전부 통과」는 ⑥#2 에서 성립하지 않는다.** `chat-page-errors-t157.test.ts` 의 「확정 전송(2단계) — 대화 8 로 옮긴 뒤 도착한 응답이 메시지를 바꾸지 않는다」가 `expect(p.errorBars()).toEqual([])` 였는데, 그 시나리오(7 에서 확정 → 8 로 전환 → 응답 도착)가 바로 ⓑ 가 안내 띠를 띄워야 하는 상황이다. ~~T-157 에서는 전송 자체가 활성 대화(8)로 가고 늦은 응답만 버려 띠가 없었다.~~ → **[18:48 정정 — L-2]** 사실이 아니다: T-157 에서도 전송은 클릭 시점의 대화(7)로 갔다(이 시험은 `POST …/7/messages` 만 모의하므로 8 로 가면 no route 로 깨진다). 달라진 것은 「어디에 저장했는지 알린다」뿐이고 그래서 그때는 띠가 없었다. 단언을 `[SENT_TO_OTHER_THREAD_MESSAGE('대화7')]` 로 바꿨다(그 묶음의 다른 단언 — 재조회 2회·메시지 `['B 질문']`·activeId 8 — 은 그대로 통과). 변이 M2 가 이 시험도 죽인다.
- [18:24] 실행 결과(서버 clone `~/.node-local/stockinvest-t157`, `origin/main`=`5fdfc19`, `node_modules` 는 `stockinvest-t155` 심볼릭 링크 — **`trap`·`rm` 없이** 그대로 두었고 작업 뒤 링크 유지 확인). 기준선 직접 재측정 `npx jest src/app/ai/__tests__/chat-page-errors-t157.test.ts src/components/__tests__/bottom-tabs-t108.test.ts` → **2 suites / 80 passed**(가이드 수치와 일치). 변경 후 같은 명령 → **2 suites / 92 passed, 0 failed**(80 + 신규 12). `npx tsc --noEmit` → **exit 0 · 출력 0줄**. 공유 트리와 clone 의 두 파일 md5 동일 확인.
- [18:24] 변이(mutation) 검증 — 변이를 넣고 같은 suite 를 돌려 해당 시험이 **실제로 실패하는지** 확인한 뒤 전부 원복(원복 후 파일 바이트 동일 확인). 요청받은 3건: **M1** `tid = draftThreadIdRef.current` → `activeThreadId` ⇒ 4 failed(시험 1·2·3·6) / **M2** away 판정 블록 제거 ⇒ 4 failed(1·2·3 + 기존 ⑥#2) / **M3** `afterSend` 분기 제거 ⇒ 2 failed(8·9). 추가로 **M4** `handleThreadGone` 초안 분기 제거 ⇒ 4 / **M5** `handleDeleteThread` 초안 분기 제거 ⇒ 5 / **M6** `ChatErrorBar` 안내 판별 제거 ⇒ 11 / **M7** `DraftReview` 머리글 한 줄 제거 ⇒ 12 / **M9** away 조건에서 활성 대화 비교 제거(항상 안내) ⇒ 7·9 / **M10** 로드 effect 의 기본 문구를 전송 안내로 바꿈 ⇒ 10 + 기존 2건. 신규 12건 **전부** 최소 1개 변이로 죽는다.
- [18:24] **죽지 않은 변이 1건(보고 대상)** — **M8** `const content = draftContent` → `input.trim()` ⇒ 54 passed(실패 0). 가이드가 지시한 변경이고 넣어 두었지만 **현재 UI 로는 두 값이 갈라질 수 없어** 시험으로 죽일 수 없다: 검토 단계(`stage === 'review'`)에서는 Composer 가 렌더되지 않아 `setInput` 을 부를 주체가 없고(`clearSentInput` 은 전송 경로 안에서만 불린다), 확정은 한 번만 눌릴 수 있다. 즉 이 한 줄은 동작 변경이 아니라 「입력칸이 멈춰 있다」는 불변식에 기대지 않게 하는 **방어적 변경**이다. 시험을 억지로 만들지 않고 사실만 남긴다.
- [18:24] 구현 전에 짚은 사양 문제 3건(가이드대로 끝까지 구현함) — ① 위 ⑥#2 단언(가이드 수정 필요) ② **`ChatErrorBar` 닫기 버튼의 `aria-label="오류 닫기"` 가 성공 안내에도 남는다** — 가이드 line 93 이 ChatErrorBar 변경을 role·background·color 로만 열거했고 승인 데모는 중립적인 `닫기` 로 그렸다. 스크린리더로는 「전송 완료 — … 오류 닫기 버튼」으로 읽힌다. 임의로 바꾸지 않고 **Reviewer·designer 판단에 올린다**(한 줄 수정안: `aria-label={notice ? '안내 닫기' : '오류 닫기'}`, 이 레이블로 요소를 찾는 시험은 없다 — 실측). ③ 재조회 실패 문구에 HTTP 코드를 넣는 방법이 가이드에 없었다 — `reloadMessages` 는 상태코드를 못 보고 `r.error` 문자열만 받는다. `chatFetch` 의 `fallback` 을 `SENT_RELOAD_FAILED_PREFIX` 로 넘기면 승인 문구와 글자까지 일치하지만 서버가 JSON `error` 를 주면 그 값이 fallback 을 이겨 접두가 사라지고 **띠 색 판별까지 빗나간다**(실패로 읽힘 = 목표 2 와 정면 충돌). `sentReloadFailedMessage()` 가 접두를 반드시 보장하게 했다(기본 경로는 승인 문구 그대로, 서버 문구는 `전송 완료 — 화면 갱신만 실패했습니다 — <서버문구>.` 로 감싼다).
- [18:24] 설계상 남겨 둔 비대칭(의도) — away 안내는 **확정 전송 경로에만** 넣었다. 직진(`skipDraft`) 전송은 검토 카드가 없어 대화가 갈릴 수 없고(전송 직후 경합뿐), 가이드도 `handleConfirmDraft` 만 지정했다. 그래서 기존 ⑥#1(직진) 의 `errorBars() === []` 는 그대로 통과한다. 재조회가 404 로 끝난 뒤에는 away 안내로 그 404 안내를 덮지 않게 `draftThreadIdRef.current === tid` 로 가드했다. ~~이때 문구가 「전송하지 못했습니다」로 남는 것은 T-157 부터의 기존 동작이라 바꾸지 않았다.~~ → **[18:48 정정 — L-1·L-2]** 사실이 아니다: T-157 은 같은 경로에서 `THREAD_GONE_MESSAGE` 를 냈고 「전송하지 못했습니다」는 **이번 task 가 새로 만든 문구**였다. 아래 18:48 bullet 에서 고쳤다.
- [18:24] 🔴 **커밋 위치 주의(Leader 판단 필요) — 공유 NFS 트리에서 커밋하면 T-157 의 변경이 T-161 커밋에 섞인다.** 실측: 공유 트리(`/Volumes/homes/brownjeon/project/StockInvest`)는 `main` @ `f47cf28` 이고 그 이력에 이 task 의 `base_ref` 인 **`5fdfc19`(T-157)가 들어 있지 않다**(`git merge-base --is-ancestor 5fdfc19 HEAD` → NO · `git branch -a --contains 5fdfc19` → 0건). → **[18:48 정정 — Reviewer 18:41]** 「다른 갈래」라고 읽히게 쓴 것은 틀렸다. `merge-base --is-ancestor HEAD 5fdfc19` → exit 0 이고 `rev-list --count HEAD..5fdfc19` = 6, 역방향 0 — **갈라진 게 아니라 공유 트리 HEAD 가 `5fdfc19` 의 조상(6커밋 뒤처짐)** 이다. 섞임이 생기는 사실과 서버 clone 에서 커밋해야 한다는 결론은 그대로다(뒤처진 HEAD 기준으로 커밋하면 그 6커밋의 ChatPage 변경이 내 diff 에 들어온다). 그 트리의 `origin/main` ref 는 `fb3b9bb` 로 **낡았다**(실제 원격 tip 은 `5fdfc19` — 서버 clone 의 `origin/main` 으로 확인). 그래서 공유 트리에서는 `src/app/ai/__tests__/` 가 **untracked** 로 보이고 `git diff HEAD -- ChatPage.tsx` 가 **290/59**(T-157 + 내 것)로 나온다. 반면 `git diff 5fdfc19 -- ChatPage.tsx` 는 **123/25 = 내 변경만**이고, 서버 clone(HEAD=`5fdfc19`)의 작업트리 diff 도 두 파일 합쳐 **356 ins / 26 del**(ChatPage 123/25 + 시험 233/1)로 동일하다 — 두 트리의 파일은 md5 까지 같다. ⇒ **커밋은 서버 clone `~/.node-local/stockinvest-t157` 에서 한다.** 공유 트리의 ref 갱신(ISS-0013 `.git/refs` 사이드카 가능성 포함)은 내 범위 밖이라 손대지 않았다. 참고로 Mac 세션은 `core.hooksPath` 가 없어 commit-msg 훅이 아예 돌지 않는다(CLAUDE.md 🔴) — 이번 두 파일은 `SAFETY_PATHS` 비대상이지만 위 섞임 때문에 서버 커밋이 맞다.
- [18:24] **못 한 것** — 브라우저·실기기 확인 0건(갤럭시 S25+ 실측 없음, 360/412px 레이아웃·띠 두 줄 높이·터치는 designer 의 데모 실측치만 근거). `npm run lint` **미실행** — 이 저장소에 ESLint 설정이 없어(`.eslintrc*` 0건·`package.json eslintConfig` null) `next lint` 가 대화형 설정 프롬프트를 띄우고 exit 1 한다(저장소의 기존 상태, 이번 변경과 무관). dev 서버·운영 스모크 미실행. 커밋·push 하지 않았다(Leader 가 Reviewer·QA 뒤에 한다). 변경은 공유 트리와 서버 clone 양쪽에 같은 내용으로 있고 clone 은 커밋하지 않은 작업트리 상태다.
- [18:48] **Reviewer 독립감사 통과 뒤 후속 4건 반영 완료**(Leader 지시: ① aria-label ② M-1 회귀망 ③ L-1 ④ L-2 서술). 실행 도구: Claude Code(developer 서브에이전트). 파일은 여전히 `src/app/ai/ChatPage.tsx` 와 `src/app/ai/__tests__/chat-page-errors-t157.test.ts` 둘뿐이고, 새 화면 요소·새 문구 0건. I-1~I-4 는 지시대로 손대지 않았다.
- [18:48] ① **aria-label** — `ChatErrorBar` 닫기 버튼을 `aria-label={notice ? '안내 닫기' : '오류 닫기'}` 로. 기존 오류 경로의 문자열은 그대로라 회귀 면적 0. 시험 11 번에 네 단언을 넣었다(안내 띠: `안내 닫기` 있음·`오류 닫기` 없음 / 오류 띠: 반대) — 삼항을 `"오류 닫기"` 로 되돌리는 변이에 시험 11 이 죽는다.
- [18:48] ③ **L-1 수정** — `handleThreadGone(tid, opts?: { sent?: boolean })` 로 옵션을 더하고, `reloadMessages` 의 `not_found` 분기에서만 `{ sent: afterSend }` 를 넘긴다. `sent` 면 초안은 그대로 버리되 문구는 **승인된 기존 `THREAD_GONE_MESSAGE`** 를 쓴다(새 문구 만들지 않음). 근거: POST 가 200 으로 끝난 순간 초안은 소비됐으니 「보낼 대화가 삭제돼 전송하지 못했습니다」가 더 이상 사실이 아니다. **호출처 영향 확인(지시한 멈춤 조건 점검)**: `handleThreadGone` 호출 5곳 중 의미가 바뀌는 곳은 `reloadMessages` 하나뿐이다 — 로드 effect·`handleSend` POST 404·`handleConfirmDraft` POST 404·`handleDeleteThread` DELETE 404 는 모두 **전송이 실패한** 경우라 옵션 없이 그대로 두는 것이 맞다(특히 확정 POST 404 는 시험 4 가 `DRAFT_THREAD_GONE_MESSAGE` 로 고정). 기존 ⑪ 시험(남의 대화 404)도 `sent` 없이 호출돼 영향 0 — 98건 전원 통과로 확인. 번지지 않았으므로 멈추지 않았다.
- [18:48] ② **M-1 회귀망 — 시험 6건 추가**(13~18, 전부 ⑫ 묶음). 13 재조회 500 에 **서버 JSON `error`** 를 줘서 접두가 유지되는지[R1] / 14 확정 200 + 재조회 404 → 띠는 `THREAD_GONE_MESSAGE` 하나, 「전송하지 못했습니다」 아님[R2·L-1] / 15 확정 성공 뒤 그 대화 삭제 → 초안 안내 없음[R5] / 16 검토 취소 뒤 그 대화 삭제 → 초안 안내 없음[R4] / 17 확정 전송 보류 중 그 대화 삭제 → composer `disabled` 유지, 전송 종료 뒤 해제[R3] / 18 검토 **이전에** 잡아 둔 `onInputChange` 핸들로 검토 중 입력칸만 바꿔도 초안의 글이 전송된다[M8 — Reviewer 가 제시한 기존 하네스 관용구, 시험 519~520행과 같은 방식].
- [18:48] 변이 재검증 — Reviewer 가 살아남는다고 실측한 5건 + 신규 3건이 **전부 죽는다**(각 변이 적용 → 해당 suite 실행 → 원복, 원복 후 바이트 동일 확인): R1 → 13 / R2 → 14 / R3 → 17 / R4 → 14·15·16 / R5 → 15 / L1opt(`opts?.sent` 분기 제거) → 14 / ARIA(삼항 되돌림) → 11 / M8 → 18. 처음 라운드의 M1 → 1·2·3·6 · M2 → 1·2·3 + ⑥#2 · M3 → 8·9·**13**(새로 추가) 도 재확인했다. **R14**(away 를 클릭 시점 값으로 판정) → **⑥#2 1건만** 죽는 것도 재확인 — Reviewer 말대로 그 단언이 「응답 뒤 판정」을 지키는 유일한 시험이라 `[]` 로 되돌리지 않았고, 주석에 그 사실을 적었다.
- [18:48] ④ **L-2 서술 정정 2곳** — 시험 ⑥#2 자리 주석과 내 18:24 기록 두 bullet 을 고쳤다(취소선 + 정정 표기). 추가로 Reviewer 가 18:41 에 바로잡은 **기준선 분기 서술**(「공유 트리 HEAD 가 5fdfc19 를 포함하지 않는 다른 갈래」)도 내 오류였으므로 같은 방식으로 정정했다 — 갈라진 게 아니라 **HEAD 가 5fdfc19 의 조상(6커밋 뒤처짐)** 이다. 커밋을 서버 clone 에서 해야 한다는 결론은 그대로다.
- [18:48] 실행 결과(서버 clone `~/.node-local/stockinvest-t157`, HEAD=`5fdfc19`) — `npx jest src/app/ai/__tests__/chat-page-errors-t157.test.ts src/components/__tests__/bottom-tabs-t108.test.ts` → **2 suites / 98 passed, 0 failed**(이전 92 + 신규 6). `npx tsc --noEmit` → **exit 0 · 출력 0줄**. `git diff --numstat` → ChatPage **132/28** · 시험 **346/1**. `git status` 변경은 두 파일뿐. 공유 트리와 clone 의 두 파일 md5 동일. `node_modules` 심볼릭 링크와 그 대상(t155) 그대로(`node_modules/.bin/jest` 접근 확인).
- [18:48] 고치지 않은 것(지시 범위 밖) — I-1(직진 경로 away 안내 없음) · I-2(안내 띠가 목적지 대화를 열어도 남는다·동명 대화 모호) · I-3(`role="status"` 삽입 시 낭독) · I-4(effect 주석의 「setter·ref 만 쓴다」). Reviewer 가 질문 4 에 적은 **사소한 외관 1건**(서버 `error` 가 마침표로 끝나면 재조회 안내가 `..` 로 끝난다)도 손대지 않았다 — 문구 조립 규칙 변경이라 designer 소관으로 본다. 전송 중 삭제(`handleDeleteThread`) 경로는 여전히 `DRAFT_THREAD_GONE_MESSAGE` 다(사용자가 직접 지운 경우라 L-1 처방 대상이 아니고 Leader 지시도 `reloadMessages` 만 지정했다 — 시험 17 이 그 경로의 stage 보존만 고정한다).
- [18:48] 못 한 것(변동 없음) — 브라우저·실기기·스크린리더 확인 0건(aria-label 변경도 마크업 문자열 단언까지만 확인했다). `npm run lint` 미실행(저장소에 ESLint 설정 없음). dev 서버·운영 스모크 미실행. 커밋·push 하지 않았다.

## Reviewer

- [18:41] 실행 도구: Claude Code(reviewer 서브에이전트, Sonnet). 검토 범위(내가 실제로 읽은 것): `src/app/ai/ChatPage.tsx` 전문 · `src/app/ai/__tests__/chat-page-errors-t157.test.ts` 하네스·⑥·⑫ 구간과 5fdfc19 대비 diff 전문 · 승인 데모 `mockups/T-161-draft-review-ownership-v1.html`(문구·스타일 grep) · 서버 `messages`/`draft` route 의 소유권 검사 줄(grep 만, 본문 정독 아님). 두 파일 외 본문은 판단 근거로 쓰지 않았다. 코드는 한 줄도 고치지 않았다(변이·탐침은 서버의 격리 복사본에서만 돌렸고 끝나고 지웠다 — 서버 clone 의 두 파일 md5 불변 확인).
- [18:41] **기준선 분기 사실 정정 [확실]**: 「공유 트리 HEAD 가 5fdfc19 를 포함하지 않는 다른 갈래」는 사실과 다르다. `git merge-base --is-ancestor 5fdfc19 HEAD` → exit 1, 그러나 `git merge-base --is-ancestor HEAD 5fdfc19` → exit 0 이고 `git rev-list --count HEAD..5fdfc19` = 6, `5fdfc19..HEAD` = 0 이다. 즉 공유 트리 HEAD(f47cf28)는 5fdfc19 의 **조상**이다(갈라진 게 아니라 6커밋 뒤처졌다: c33e467·2ce0186·fb3b9bb(T-159)·f712c1b(T-160)·013d88f·5fdfc19). 그 트리의 로컬 `origin/main` ref 는 fb3b9bb(낡음, 5fdfc19 의 조상)이고 `git ls-remote origin main` 은 5fdfc19d91d0… 로 base_ref 와 일치한다. 시험 파일은 공유 트리에서 untracked(`?? src/app/ai/__tests__/`)라 `git diff 5fdfc19 -- 시험` 이 0/863(삭제)로 나오므로 시험은 `git show 5fdfc19:경로` 와 직접 diff 했다(+219줄/−1줄). 결론 — 공유 트리에서 커밋하면 T-157 변경이 섞인다는 Developer 의 판단과 서버 clone 커밋 방침에는 동의한다.
- [18:41] 재현 [확실]: 서버 clone `~/.node-local/stockinvest-t157` HEAD=5fdfc19, `git status` 변경은 두 파일뿐(+node_modules 링크), `git diff --numstat` ChatPage 123/25 · 시험 233/1 로 보고와 일치, 공유 트리와 clone 의 두 파일 md5 동일. `flock … npx jest chat-page-errors-t157 bottom-tabs-t108` → 2 suites / 92 passed, `npx tsc --noEmit` → exit 0. `node_modules` 링크와 그 대상(t155)은 건드리지 않았고 끝난 뒤에도 있다.
- [18:41] 데모 검토 게이트 [확실]: `check.mjs check --task` 재실행 → 통과(status approved · v1 · hash verified). `evidence.jsonl` 의 T-161 줄은 1건(approve, 18:08:11, v1, content_sha256 일치). quote_sha256 이 「권고안으로 승인」 의 sha256 과 일치하고, 그 줄의 transcript_uuid 는 대화 기록에서 user 역할·비 sidechain 메시지(18:07:36 KST)다 — 에이전트가 approve/waive 를 대신 실행했거나 state 파일을 직접 쓴 흔적은 찾지 못했다. 승인 데모 v1 대 구현 비교: 문구 3종 글자 일치, 호박색(`rgba(245,158,11,.15)`+`--accent`)·머리글 한 줄(12px·accent·600, 제목 700·말줄임, `↩` aria-hidden) 값 일치, 새 화면 요소 0 → material 차이 0건 · defect 0건. implementation 차이 1건: 닫기 버튼 aria-label(데모는 모든 띠 `닫기`, 구현은 `오류 닫기`) — 아래 질문 5.
- [18:41] 범위·안전 경계 [확실]: clone 변경은 두 파일뿐이라 서버·API·DB·인증·안전장치 코드 변경 0건, `mockups/**` 불변. `awk '/^SAFETY_PATHS=\(/,/^\)/' scripts/git-hooks/commit-msg` 에 `src/app/ai/` 없음. 서버는 요청마다 `ownedThread`(소유권)를 검사하고 쓰기 전 락 안에서 다시 확인하므로, 클라이언트가 옛 대화 번호를 보내도 남의 대화에는 쓰이지 않는다 — ⓑ 로 새로 열린 서버 쪽 표면은 없다.
- [18:41] **질문 1 — ⑥#2 단언 변경은 정당한 기대값 갱신이다 [확실, 변이로 확인]**. 근거 ① 제거된 줄은 이 한 줄뿐이고 test() 는 38→50(+12), `.only`/`.skip` 0건 ② 같은 시험의 나머지 단언(재조회 2회·메시지 `['B 질문']`·activeId 8)은 그대로 ③ 새 단언 `[SENT_TO_OTHER_THREAD_MESSAGE('대화7')]` 는 `[]` 보다 엄격한 정확 일치라 엉뚱한 띠가 끼면 여전히 잡는다 ④ 그 시나리오(7 에서 확정 → 8 로 전환 → 응답 도착)는 ⓑ 설계상 안내가 떠야 하는 바로 그 경우다. 오히려 이 단언이 **「응답 뒤에 판정」을 지키는 유일한 시험**이다 — away 를 클릭 시점 `activeThreadId` 로 판정하는 변이(R14)는 이 시험 1건만 죽이고 신규 ⑫ 12건은 전부 통과한다. 그러니 이 단언을 `[]` 로 되돌리면 안 된다. 다만 같은 자리 주석 「T-157 때는 전송 자체가 활성 대화(8)로 갔고」 는 **사실이 아니다**: 이 시험은 `POST …/7/messages` 만 모의하고(8 로 가면 no route 로 깨진다) T-157 코드도 클릭 시점의 7 로 보냈다. 달라진 것은 「어디에 저장했는지 알린다」 뿐이다(L-2).
- [18:41] **질문 2 — `draftThreadIdRef` 미러링 [확실, 코드 읽기+탐침]**: 렌더 중 대입도 effect 대입도 아니라 **핸들러/콜백 안 즉시 대입**이다(쓰는 곳은 `clearDraft` 의 null 과 `handleSend` 정제 성공 직후 2곳뿐이고, 둘 다 `setDraftThreadId` 와 같은 블록이라 ref 와 state 가 어긋나지 않는다). `activeIdRef`(렌더 미러+변경 지점 즉시 대입)·`msgSeqRef`(핸들러 안 증가)와 방식이 다르지만 Developer 가 주석에 적은 대로 의도적이고(ref 하나로 초안 생존을 판정) 충돌하지 않는다. 낡은 tid 경로 점검: 연속 정제 — review 에서는 Composer 가 unmount, drafting/generating 에서는 disabled, `handleSend` 도 stage 가드라 불가 / 취소 뒤 재정제 — 취소가 `clearDraft` 로 ref 를 비우고 새 정제가 새 tid 를 쓴다 / 전송 중 삭제 — `discardDraft` 가 ref 만 비우고 stage 는 `generating` 그대로(탐침 S3 에서 composer disabled 유지 확인). 남는 경로는 정제 요청이 도는 동안 대화가 삭제되는 경우뿐인데, 그때는 삭제된 대화를 가리키는 초안이 잠깐 생겨도 확정 POST 가 404 로 돌아와 카드가 닫힌다(서버가 존재·소유를 검증). 낡은 tid 를 만드는 코드는 현재 없다. 다만 ref 를 비우는 두 곳을 지키는 시험이 없다 — 아래 M-1.
- [18:41] **질문 3 — `away` 판정 [확실]**: 응답 뒤 `activeIdRef.current` 와 비교하므로 전송 중 두 번 옮겨(7→8→7) 최종 활성이 7 이면 안내가 없고 8 이면 있다(맞다). 재조회가 404 인 뒤 안내가 `DRAFT_THREAD_GONE_MESSAGE` 를 덮는 경로는 `draftAlive` 가드가 막는다 — 탐침 S1(확정 200 + 재조회 404)에서 띠가 `DRAFT_THREAD_GONE_MESSAGE` 하나만 남는 것을 확인. 그러나 그 가드를 지워도(R2) 54건이 전부 통과한다 — 시험이 없다(M-1). 또 비활성 대화의 재조회 404 는 `reloadMessages` 가드에서 먼저 버려져 away 안내가 「저장했습니다」 로 나가는데, POST 200 이라는 사실에만 의존하므로 문구는 맞다(탐침 S4).
- [18:41] **질문 4 — 접두 판별 [확실]**: `src/` 전체 grep 에서 `전송 완료` 로 시작하는 서버 error 문자열은 0건(KIS 시험 fixture `주문 전송 완료` 1건은 접두 불일치이고 채팅 경로가 아니다). 띠에 오르는 문자열 출처는 서버 JSON `error`·`chatFetch` 의 fallback 7종·`String(e)` 뿐이라 접두와 겹칠 경로는 현재 없고, 겹쳐도 결과는 색·role 변화에 그친다. Developer 의 「`sentReloadFailedMessage()` 가 서버 JSON error 에 접두를 빼앗기지 않게 막았다」는 **코드와 탐침으로 사실이다** — 서버 `{error:'DB down'}` 500 이면 `전송 완료 — 화면 갱신만 실패했습니다 — DB down. 대화를 다시 열면 답변이 보입니다.` 로 접두가 유지돼 호박색 판별을 통과한다(S2). 그러나 **이 보증을 지키는 시험이 없다**: 접두 보장 분기를 지워도(R1) 54건 통과 — 신규 8·9 는 HTML 500(fallback 경로)만 쓴다(M-1). 사소한 점: 서버 error 가 마침표로 끝나면 `..` 이 된다(외관).
- [18:41] **질문 5 — aria-label: 채택에 동의한다 [확실]**. `ChatErrorBar` 는 바깥 띠와 `ThreadListOverlay` 안 띠가 같은 컴포넌트라 한 줄 수정이 두 곳에 모두 적용된다. `aria-label={notice ? '안내 닫기' : '오류 닫기'}` 는 기존 오류 경로의 문자열을 바꾸지 않아 회귀 면적이 0 이고, 이 레이블로 요소를 찾는 시험·코드는 `src/scripts/docs` 전수 grep 에서 `ChatPage.tsx` 1곳뿐이다. 데모의 `닫기` 단일화는 더 낫지 않다(기존 오류 레이블까지 바꾼다). 데모와의 차이는 보이지 않는 속성이라 implementation 으로 분류하며 재승인은 필요 없다. 이 한 줄이 Leader 가 말한 그대로(레이블 삼항 한 줄, 다른 변경 없음)라면 별도 재순환 없이 반영해도 된다고 본다. 단 시험 11번에 두 레이블 단언(`aria-label="안내 닫기"` / `"오류 닫기"`)을 같이 넣지 않으면 되돌려도 잡히지 않는다(M-1 (e)).
- [18:41] **질문 6 — M8 [주장 절반만 맞다]**: 「현재 UI 로는 두 값이 갈라질 수 없다」는 **맞다 [확실]**. `setInput` 호출처는 `clearSentInput`(전송 성공 경로 안)과 Composer `onInputChange` 둘뿐이고, review 에서 Composer 는 렌더되지 않으며(`stage !== 'review'` 조건) drafting/generating 에서는 `disabled` 다 — 그러니 억지 시험은 요구하지 않는다. 그러나 「시험으로 죽일 수 없다」는 **틀리다**: 이 스위트가 이미 쓰는 방식(전송 중 입력칸 가드 시험의 「가드가 UI 상태에 기대지 않는다」, 시험 519~520행 주석)대로 review 이전에 잡아 둔 `onInputChange` 핸들을 review 중에 부르면 6줄로 죽는다(탐침 S5 — 원본은 `7번 질문`, M8 변이는 `다른 글` 을 전송). 선택 사항이며 Leader 판단에 맡긴다.
- [18:41] **질문 7 — 중복 전송 유도·반대 방향 오인 [확실]**: 재조회 실패 두 경로(직진·확정) 모두 `reloadMessages` 가 던지지 않고 돌아온 뒤 `clearSentInput` 이 실행되어 입력칸이 비고, 문구가 `전송 완료 —` 로 시작해 호박색·`role="status"` 로 나가므로 같은 글을 다시 보내게 만드는 경로는 찾지 못했다. 반대로 실패를 성공으로 읽게 하는 경로도 없다 — 안내 문구는 POST 가 `ok:true` 로 돌아온 뒤에만 `setError` 된다. 남는 반대 방향은 성공을 실패로 읽게 하는 L-1 하나다.
- [18:41] **M-1 (Medium) 이 task 가 스스로 내건 안전장치 5건 중 4~5건이 시험으로 고정되어 있지 않다**: 서버의 격리 복사본에서 변이를 넣어 돌린 결과(전부 원복): R1 `sentReloadFailedMessage` 접두 보장 제거 → 54 passed(실패 0) / R2 `draftAlive` 가드 제거 → 54 passed / R3 `discardDraft` 가 stage 를 무조건 `idle` 로 → 54 passed / R4 `clearDraft` 가 ref 를 안 비움 → 54 passed / R5 확정 `finally` 의 `clearDraft()` 제거 → 54 passed / R14 away 를 클릭 시점 값으로 판정 → ⑥#2 1건만 실패(위 질문 1). 현재 코드는 R1~R5 모두 의도대로 동작한다(탐침 S1~S4 로 확인)는 점에서 결함이 아니라 **회귀망의 구멍**이다. R4·R5 가 살아남으면 이후 같은 대화의 404/삭제 때 「초안도 닫혔습니다」 가 엉뚱하게 뜨는 낡은 tid 회귀가 조용히 생긴다. 제안(시험 파일만 변경, 각 6~10줄): (a) 확정 200 + 재조회 500 에 서버 JSON `error` 를 줘서 띠가 `SENT_NOTICE_PREFIX` 로 시작하는지 [R1] (b) 확정 200 + 재조회 404 → 띠 1개 [R2] (c) 확정 POST 보류 중 검토 대화 삭제 → composer 가 계속 disabled [R3] (d) 확정 뒤 같은 대화가 404 → 기존 `THREAD_GONE_MESSAGE` (초안 안내 아님) [R4·R5] (e) 시험 11번에 두 aria-label 단언. 블로킹은 아니다 — 변경이 시험 파일뿐이면 나머지 재검토는 diff 대조로 갈음할 수 있다.
- [18:41] **L-1 (Low) 전송은 이미 됐는데 「전송하지 못했습니다」 가 뜨는 좁은 경로** — 탐침 S1: 확정 POST 200 뒤 재조회가 404 이면 띠가 `보낼 대화가 삭제돼 전송하지 못했습니다. 검토 중이던 초안도 닫혔습니다 — …` 로 나간다(`handleThreadGone` 이 ref 가 아직 tid 라 초안 소멸로 해석). 탐침 S3 도 같다 — 확정 POST 가 도는 중 그 대화를 지우면 「검토 중이던 초안」(이미 카드가 없다)·「전송하지 못했습니다」 가 먼저 뜬다. 창이 좁고(POST 200 과 다음 GET 사이에 대화가 사라져야 한다) 사용자가 잃는 것은 없지만, Developer 기록 18:24 의 「T-157 부터의 기존 동작이라 바꾸지 않았다」 는 **사실이 아니다** — T-157 은 같은 경로에서 `삭제됐거나 열 수 없는 대화입니다…` 를 냈고 「전송하지 못했습니다」 는 이번 task 의 새 문구다. 처방 후보: 확정 POST 가 `ok` 로 돌아온 뒤에는 초안 소멸 해석을 하지 않게 한다(예: POST 성공 직후 `clearDraft()` 하고 away 판정은 로컬 플래그로, 또는 `reloadMessages` 가 결과를 돌려주게). 고치지 않을 거면 기록의 서술만 바로잡는다.
- [18:41] **L-2 (Low) 부정확한 설명 2곳**: (i) 시험 파일 496~497행 주석 「T-157 때는 전송 자체가 활성 대화(8)로 갔고」 → 위 질문 1 대로 사실과 다르다. 「T-157 에서도 전송은 클릭 시점의 대화(7)로 갔고, 어디에 저장했는지는 알리지 않았다」 로 고친다. (ii) Developer 기록 18:24 의 같은 서술(Developer 절은 내가 고치지 않는다 — Leader 최종 요약에서 되풀이하지 않도록 알린다).
- [18:41] 정보(블로킹 아님): I-1 직진 전송 경로에는 away 안내가 없다 — Leader 가 확정 경로만 지정했고 T-157 동작이라 회귀는 아니지만, 직진 전송 중 대화를 옮기면 답이 어디로 갔는지 알려 주지 않는다(후속 후보). I-2 안내 띠는 목적지 대화를 열어도 사라지지 않고 ×·다음 전송 때만 지워진다. 안내 제목은 확정 클릭 시점의 `threads` 값이라, 첫 전송에서 서버가 제목을 바꾸는 새 대화는 「새 대화」 로 나가고(제목이 같은 대화가 여럿이면 모호하기도 하다) 이는 화면 문제라 designer 후속 후보로 넘긴다. I-3 `role="status"` 요소를 내용과 함께 새로 삽입하면 일부 스크린리더는 읽지 않을 수 있다 — 접근성 설계 판단이라 결함으로 올리지 않고 Leader 를 통해 designer 에게 넘긴다(결정 2-B 승인 사항). I-4 `handleThreadGone` 의 effect 주석 「setter·ref 만 쓴다」 는 `loadThreads`/`discardDraft` 가 추가돼 정확하지 않지만 둘 다 deps 가 비어 있는 안정 콜백이라 동작에는 영향이 없다.
- [18:41] 미확인(검토하지 않은 것): 실제 브라우저·실제 React 렌더·갤럭시 S25+·스크린리더 확인은 0건이다. 시험 하네스는 훅을 가짜로 바꿔(`useState` 즉시 반영·`useCallback` 비메모이제이션) 배칭·클로저 갱신 의미가 실제 React 와 다르므로, ref/state 일관성과 stale 클로저는 코드 읽기로만 확인했다(정제 성공 직후의 일괄 갱신은 React 18 배칭에서 한 번의 렌더로 합쳐지므로 tid·글·초안이 한 렌더에 같이 보인다는 추론은 [가능성 높음]). 데모와의 시각 일치는 마크업·스타일 문자열 대조이지 화면 비교가 아니다. judge C2·Codex 검토 단계는 아직 없다 — 그 결과가 오면 지적마다 채택/오탐/범위 밖을 이 절에 이어서 판정한다.
- [18:41] QA 에 넘기는 high_risk_areas: `src/app/ai/ChatPage.tsx` 365~399(`handleConfirmDraft` — 목적지 ref·응답 뒤 away·finally) · 181~193(`handleThreadGone` 의 초안 분기) · 414~424(`handleDeleteThread` 의 초안 분기) · 339~360(`reloadMessages` 의 afterSend) · 547~555(`ChatErrorBar` 접두 판별) · 652~658(머리글 한 줄). 실제 화면 확인 시나리오: ① 검토 카드를 띄운 채 다른 대화 선택 → 확정 → 원래 대화로 저장·안내 ② 검토 중 「+ 새 대화」 → 확정(무반응 아님) ③ 확정 POST 가 도는 중 대화 전환·삭제 ④ 재조회만 실패하게 만든 직진/확정 전송(입력칸이 비고 호박색 안내, 다시 보내지 않음) ⑤ 같은 대화에서 확정 시 안내 없음. 집계: critical 0 · high 0 · medium 1(M-1) · low 2(L-1·L-2) · info 4(I-1~I-4).
- [18:41] **최종 판정: PASS (scope: src/app/ai/ChatPage.tsx, src/app/ai/__tests__/chat-page-errors-t157.test.ts)**
- [18:55] [라운드 2] 재검증 시작 — 수정 발생에 따른 재순환. 실행 도구: Claude Code(reviewer 서브에이전트, Sonnet). 위 1라운드 판정 줄은 지우지 않고 이 절 맨 아래에 라운드 2 판정을 추가한다. 읽은 것: `ChatPage.tsx` 전체와 `git diff 5fdfc19 -- ChatPage.tsx` 전 hunk · 시험 파일의 ⑫ 후반(11~18)과 ⑥#2 주석 · Developer 절의 18:48 보고. 변이·탐침은 서버의 격리 복사본에서만 돌렸고 끝난 뒤 지웠다(복사본의 `node_modules` 링크만 unlink, clone 의 링크와 그 대상 t155 는 그대로 — 확인함).
- [18:55] 재현 [확실]: 서버 clone HEAD=5fdfc19, `git status` 변경은 두 파일뿐, `git diff --numstat` ChatPage 132/28 · 시험 346/1 로 보고와 일치, 공유 트리와 clone 의 md5 동일(ChatPage `373a35e6…`·시험 `34c770c9…`). `flock … npx jest chat-page-errors-t157 bottom-tabs-t108` → 2 suites / **98 passed**, `npx tsc --noEmit` → exit 0. 데모 게이트 `check.mjs check --task` 재실행 → 통과(approved · v1 · hash verified), 승인 뒤 데모 파일 변경 없음.
- [18:55] **프로덕션 코드 변경 범위 [확실 — 단 1라운드 사본이 없어 바이트 비교가 아니라 diff 출력의 hunk 단위 대조]**: 1라운드에서 읽은 diff 와 이번 diff 를 hunk 별로 맞춰 보면 달라진 곳은 세 군데뿐이다. ① `handleThreadGone(tid, opts?: { sent?: boolean })` — 문구를 `draftGone && opts?.sent !== true` 일 때만 초안 안내로, 아니면 기존 안내로(초안은 어느 쪽이든 버린다) + 설명 주석 ② `reloadMessages` 의 `not_found` 한 줄이 `handleThreadGone(tid, { sent: afterSend })` + 주석 ③ `ChatErrorBar` 닫기 버튼 `aria-label={notice ? '안내 닫기' : '오류 닫기'}` (1라운드 질문 5 에서 합의한 그대로의 삼항 한 줄). `handleConfirmDraft` 안 주석 한 문장의 표현이 바뀐 것 외에 다른 로직 변경은 끼어들지 않았다. numstat 의 증가분(123/25 → 132/28)과도 맞는다.
- [18:55] **변이 재현 — 보고 숫자가 맞다 [확실]** (60건 전체 시험을 변이마다 다시 돌림, 원복 후 파일 동일 확인). 1라운드 생존 5건: R1 접두 보장 제거 → 13 / R2 `draftAlive` 가드 제거 → 14 / R3 `discardDraft` 가 stage 를 무조건 idle → 17 / R4 `clearDraft` 가 ref 를 안 비움 → 14·15·16 / R5 확정 `finally` 의 `clearDraft()` 제거 → 15. 신규: `opts?.sent` 무시 → 14 / reloadMessages 가 sent 를 안 넘김 → 14 / aria 삼항 되돌림·두 값 뒤바꿈 → 11 / M8(`input.trim()`) → 18. R14(away 를 클릭 시점 값으로) → 기존 ⑥#2 1건만(그대로 — 아래 N-3). 1라운드 변이 재확인: M1 → 1·2·3·6 / M2 → ⑥#2·1·2·3 / M3 → 8·9·13 / M4 → 4·14 / M5 → 5 / M6 → 11 / M7 → 12 / M9 → 7·9·13·15. 내가 더한 변이: X2(정제 성공 때 ref 를 안 세움) → 13건 / X3(draftContent 를 안 세움) → 1·3·6·7·18 / X4(확정 뒤 clearSentInput 제거) → 7 / X9(away 제목 고정) → ⑥#2·1·2·3 / X10(재조회 안내 꼬리 문구 변경) → 8·9·13. R4·R5 같은 정리 계열은 시험 15·16 이 「정리한 뒤 그 대화를 지워도 초안 안내가 없다」는 **사용자에게 보이는 결과**로 정리 누락을 잡는다 — 내부 상태를 베낀 단언이 아니라서 구현을 바꿔야만 죽는다.
- [18:55] **동어반복 점검**: 신규 6건은 구현의 가드를 바꿔야 죽는다(위 목록). 문구 상수를 바꾸면 통과하는 부분은 있다 — C1 변이(`DRAFT_THREAD_GONE_MESSAGE` 글자 변경)는 60건 전부 통과한다. 시험이 상수를 import 해 같은 값과 비교하기 때문이다. 다만 13 은 꼬리(`— DB down. 대화를 다시 열면 답변이 보입니다.`)를, 14 는 `전송하지 못했습니다` 부재를 리터럴로 고정한다. 승인 문구 6종(`전송 완료 — `·`대화에 저장했습니다. 보려면 그 대화를 여세요.`·초안 소멸 문구·`화면 갱신만 실패했습니다`·`대화를 다시 열면 답변이 보입니다.`·`대화로 전송합니다`)은 코드에 각 1회 있고 데모에도 있음을 grep 으로 재확인했다. 승인 문구와의 글자 일치는 시험이 아니라 리뷰가 지킨다(N-2).
- [18:55] **L-1 수정이 다른 404 경로의 의미를 바꾸지 않았다 [확실 — 코드 읽기+변이+탐침]**. `handleThreadGone` 호출처는 6곳이다: 로드 effect(230) · 직진 POST 404(296) · 정제 POST 404(317) · `reloadMessages`(361) · 확정 POST 404(387) · DELETE 404(424). 인자가 붙은 곳은 361 하나뿐이고 나머지 5곳은 이전과 호출이 같다. 확정 POST 404 에 `sent:true` 를 붙이는 변이는 시험 4(확정 POST 404 → `DRAFT_THREAD_GONE_MESSAGE`)가 죽이고, 기존 ⑪ 들은 그대로 통과한다. 탐침으로 실제 문구 확인: 직진 200 + 재조회 404 → `삭제됐거나 열 수 없는 대화입니다…`(초안이 없으니 이전과 같다, 입력칸 비워짐) / 검토 대화를 다시 열었더니 로드 404 → 초안 안내 + 카드 닫힘 / 검토 대화 DELETE 404 → 같은 초안 안내 + 카드 닫힘 — 셋 다 의도대로다. 확정 200 뒤 재조회 404 는 이제 시험 14 가 고정한다. `draftAlive` 가드는 그대로라 away 안내가 그 404 안내를 덮지 않는다.
- [18:55] **N-1 (Low) 로드 404·DELETE 404 로 검토 대화가 사라지는 두 경로는 시험이 고정하지 않는다**: 호출처에 `sent:true` 를 붙이는 변이(DELETE 404 용·로드 effect 용)가 둘 다 60건 통과하고, `handleThreadGone` 이 `discardDraft` 를 부르지 않게 하는 변이(X7)는 시험 14 한 건만 죽인다. 위 탐침으로 현재 동작은 맞음을 확인했고 **1라운드부터 있던 공백이지 이번 수정이 만든 구멍이 아니다**. 필요하면 각 6줄 정도의 시험 2건(로드 404 → 카드 닫힘+초안 안내, DELETE 404 → 같은 안내)으로 메울 수 있다. 블로킹 아님.
- [18:55] 정보: N-2 승인 문구 상수의 글자는 시험이 import 값과 비교하므로 문구 표류를 시험이 잡지 못한다 — 리뷰가 지키는 영역이고, 원하면 승인 문구 3종을 리터럴로 고정하는 시험 1건이면 된다. N-3 away 를 「응답 뒤」 로 판정한다는 보증은 여전히 ⑥#2 한 건이 혼자 진다(R14) — 그 시험의 주석에 이 사실이 적혀 있고, 이전 `[]` 로 되돌리지 않았다. 신규 ⑫ 안에 같은 보증을 하나 더 두면 단일 실패점이 사라진다(선택).
- [18:55] **developer 가 남긴 2건 — 둘 다 남겨 둘 만하다**. ① 서버 `error` 가 마침표로 끝나면 `..` : `src/app/api/chat`·`src/lib/chat` 의 서버 error 문자열 중 마침표로 끝나는 것은 0건이다(grep). 남는 유일한 경로는 외부 LLM CLI 가 내는 오류 텍스트인데, 그때도 접두는 유지되어 호박색·`status` 판별은 그대로이고 외관만 어색하다. 조립 규칙(마침표 정리) 변경은 designer 소관이라는 판단에 동의한다. ② 전송 중 사용자가 직접 지운 경로가 `DRAFT_THREAD_GONE_MESSAGE` 인 것: 사용자가 방금 지운 대화로 가는 POST 라, 이어서 404 가 오면 기존 안내로 덮이고(탐침 S3b 와 시험 17), 200 이 와도 보낸 글이 남을 대화가 없다는 점에서 문구가 결과와 어긋나지 않는다 [가능성 높음 — 삭제가 메시지를 함께 지우는지는 서버 삭제 코드를 읽지 않았다]. 「검토 중이던 초안도 닫혔습니다」 가 이미 확정한 뒤라 어색한 건 문구 문제라 designer 소관이다. 시험 17 이 stage 보존만 고정한다.
- [18:55] Developer 기록 정정 확인: 시험 ⑥#2 주석과 Developer 18:24 기록 두 곳이 취소선+정정으로 바뀌었고(T-157 도 클릭 시점 대화(7)로 보냈다), 기준선 서술도 「HEAD 가 5fdfc19 의 조상(6커밋 뒤처짐)」 으로 바로잡혔다 — 내가 잰 값과 같다. 1라운드 판정 줄·내 bullet 19건은 그대로다.
- [18:55] 미확인(변동 없음): 실제 브라우저·실제 React·갤럭시 S25+·스크린리더 확인 0건. 닫기 버튼의 새 레이블은 마크업 문자열 단언까지만 확인됐다. judge C2·Codex 검토 단계는 아직 없다 — 결과가 오면 지적마다 채택/오탐/범위 밖을 이어서 판정한다.
- [18:55] QA 에 덧붙일 시나리오(이번 수정으로 늘어난 것): ⑥ 확정 전송 200 뒤 재조회만 404 가 되게 한 경우(네트워크 가로채기가 아니면 재현이 어렵다 — 불가하면 시험 14 로 갈음) → 띠는 하나, 문구는 `삭제됐거나 열 수 없는 대화입니다…`, 「전송하지 못했습니다」 가 아니어야 한다 ⑦ 안내 띠(호박색)의 × 를 TalkBack 으로 읽으면 「안내 닫기」, 오류 띠(빨강)는 「오류 닫기」 ⑧ 확정 전송이 도는 중 그 대화를 지우면 입력칸이 계속 막혀 있다가 전송이 끝나야 풀린다(같은 글을 다시 보낼 수 없어야 한다). 1라운드 시나리오 ①~⑤ 는 유효하다. 소스 위치 갱신: `src/app/ai/ChatPage.tsx` 186~198(`handleThreadGone` 의 sent 분기)·344~366(`reloadMessages`)·368~406(`handleConfirmDraft`)·420 부근(`handleDeleteThread`)·553~561(`ChatErrorBar`). 집계(라운드 2): critical 0 · high 0 · medium 0(M-1 해소) · low 1(N-1) · info 2(N-2·N-3). L-1·L-2 는 해소 확인.
- [18:55] **최종 판정: PASS (scope: src/app/ai/ChatPage.tsx, src/app/ai/__tests__/chat-page-errors-t157.test.ts)**
- [23:45] **라운드 3 (N-2 회귀망 시험 독립감사 — 시험 전용 변경)**: 라운드 1·2 는 구현 감사였고 이 라운드는 서버 clone `ad3c383` 의 작업 트리 변경 1개(`src/app/ai/__tests__/chat-page-errors-t157.test.ts`, +93/-0)만 본다. 구현(`ChatPage.tsx`)은 HEAD 와 차이 0줄이고 나는 고치지 않았다. 변이 실험은 요청자 clone 을 건드리지 않도록 **격리 사본**(`~/.node-local/rev-t161-r3-scratch`, `node_modules` 는 링크만 걸고 감사 뒤 링크·사본 삭제, 대상 `stockinvest-t155/node_modules` 무사 확인)에서만 했다. 감사 전후 요청자 clone 의 `git status` 는 동일(시험 파일 1개 수정 + `node_modules` 링크), `git diff --numstat` 93/0.
- [23:45] **재현 [확실]**: `npx jest src/app/ai/__tests__/chat-page-errors-t157.test.ts` → 66 passed(기준선 재현). 같은 파일 `--randomize` 2회(시드 36191833·-1156807310) 66 passed, `-t "⑬"` 단독 6 passed(순서·선행 시험 의존 없음). `src/app/ai` + `bottom-tabs-t108` → 104 passed. `npx tsc --noEmit` exit 0. (모두 `flock /tmp/stockinvest-heavy-tests.lock` 직렬.)
- [23:45] **글자 대조 [확실] — 리터럴은 승인 원본과 같다**: 데모 파일 sha256 `959795523a15…c203` 가 이 task frontmatter `demo_gate.content_sha256`(승인본)과 일치한다(= 내가 대조한 파일이 승인된 v1 그대로). ⑬ 의 리터럴 6종을 파이썬(`-I`)으로 데모 HTML 에서 문자열 일치로 찾았다 — 문구 1 문장(데모 5곳)·문구 2 문장(3곳)·문구 3 완성형(2곳)·접두 `전송 완료 — `(7곳)·`전송 완료 — 화면 갱신만 실패했습니다`(2곳) 전부 존재. 머리글은 데모 결정 1-A 샘플(`<span aria-hidden>↩</span> <b>「반도체 섹터 전망」</b> 대화로 전송합니다`)의 태그를 지우고 한 칸으로 이으면 `↩ 「반도체 섹터 전망」 대화로 전송합니다` 로 ⑬-6 기대값과 같다. 문자 종류: 대시는 EM DASH(U+2014) 한 종류, 꺾쇠는 U+300C/U+300D, ASCII 외 공백 없음. 결정 1-A·2-B(권고)·문구 3종 2안(권고)이 승인 범위와 맞는지도 데모 본문(L160·L220·L508~548)으로 확인했다.
- [23:45] **데모 예시 제목(`반도체 섹터 전망`) 재사용은 도움이 된다 [확실]**: ① 문장 전체가 데모 HTML 에서 grep 으로 찾아져 「글자 단위 대조」가 기계적으로 된다. ② 대화 7 의 제목(`반도체…`)과 보고 있는 대화 8 의 제목(`대화8`)이 달라, 안내 문구의 제목을 **엉뚱한 대화에서** 가져오는 변이(S3e: 활성 대화 제목)를 ⑬-4 와 ⑫-1·2·3·⑥ 이 함께 죽인다. 제목이 같았다면 이 변이는 살았을 것이다. 반대 비용은 데모가 v2 로 바뀌어 예시 제목이 달라지면 리터럴도 같이 고쳐야 한다는 것뿐인데, 주석이 이미 「문구를 바꿀 때는 데모를 다시 승인받고 이 줄도 같이 고친다」로 의도된 중복이라고 적었다.
- [23:45] **요청자 변이 6종 재현 [확실] — 숫자가 한 줄도 다르지 않다**: M-N1 → ⑬-1·4 / M-N2 → ⑬-2 / M-N3 → ⑬-3·5 / M-N4 → ⑬-3·5 와 **기존 ⑫-8·9·13**(= 문구 3 뒤 문장은 이미 ⑫ 의 `RELOAD_FAILED` 조립과 ⑫-13 기대값에 리터럴로 들어 있었다) / M-N5 → ⑬-1·3·4·5 / M-N6 → ⑬-6 만. 각 변이 뒤 `ChatPage.tsx` 를 원본 바이트로 복원하고 `assert` 로 확인했다.
- [23:45] **내가 더한 변이 — 죽는 것**: 질문 ② 조립 순서 5종 전부 killed — S2a(꼬리/머리 순서 교환)·S2b(`else` 구분자 ` — `→`: `, ⑫-13 만)·S2c(`reloadMessages` 가 조립 함수를 생략)·S2d(`startsWith` 무시)·S2e(마침표 누락). 질문 ③ 문구 2 경로 바꿔치기 — S3a(`handleThreadGone` 의 문구 2 → `THREAD_GONE_MESSAGE`)는 ⑫-4, S3b(삭제 경로)는 ⑫-5, S3d(그 분기에 문구 1 상수를 끼움)는 ⑫-4 가 죽인다. **답: ⑬-2 는 상수만 보지만 경로를 바꿔치기하는 변이는 ⑫-4·5 가 `errorBars()`/`overlay().error` 를 상수와 비교해 잡는다**(둘이 합쳐 문구 2 의 「글자」와 「어느 경로에서 나오는가」를 지킨다). 머리글 S1c(제목 뒤 단어 삽입)·S1d(`↩`→`→`)·S1e(`aria-hidden` 제거)·S1f(`보냅니다`)도 killed(⑬-6·⑫-12).
- [23:45] **F-1 (Low) 머리글 ⑬-6 은 `toContain` 이라 앞뒤에 덧붙는 글자를 못 잡는다 — 살아남는 변이 2종 실측**: S1a(`대화로 전송합니다` 뒤에 ` (초안 기준)` 덧붙임)와 S1b(`↩` 앞에 `<span>주의</span>` 삽입)가 **66건 전부 통과**한다(⑫-12 도 `toContain` 2건이라 마찬가지). 승인된 머리글은 정확히 `↩ 「제목」 대화로 전송합니다` 한 줄인데, ⑬-6 의 주석(「승인된 한 줄 그대로인지 본다」)보다 시험이 약하다. M-N6(순서 교환)은 잡지만 **덧붙임**은 못 잡는다. 질문 ① 의 답: 부분열을 유지한 채 글자를 바꾸는 변이는 살아남는다.
- [23:45] **F-2 (Low) ⑬-4·5 는 띠가 렌더한 글자가 아니라 `ChatErrorBar` 의 `message` prop 을 읽는다 — S5b 생존**: `errorBars()` 는 요소의 props 만 읽는다. `ChatErrorBar` 의 본문 `{message}` 를 `{message.replace(SENT_NOTICE_PREFIX, '')}` 로 바꾸는 S5b 는 66건 통과한다(문구가 props 에는 맞고 화면에는 접두가 빠짐). S5a(오류 띠에 `⚠ ` 장식)는 기존 T-157 시험 「error 가 있으면 목록 안에 role=alert 띠」 가 죽이지만 그것은 접두 없는 오류 띠만 본다. ⑬-4 주석의 「**사용자가 보는 띠**의 글자」는 한 칸 못 미친다. 마지막 한 칸(렌더)이 단순 통과라 실제 위험은 낮다.
- [23:45] **F-3 (Low, 주석 정확성)**: ⑬ 머리 주석의 「⑫ 의 단언은 **전부** `SENT_*`·`DRAFT_*` 상수를 가져다 써서 … **전 시험이 그대로 통과한다**」와 「승인받은 글자를 지키는 시험이 없었다」는 과하다. M-N4 가 ⑫-8·9·13 을 죽이고(문구 3 뒤 문장), ⑫-12 가 `「대화7」`·`대화로 전송합니다`·`aria-hidden="true"` 를, ⑫-11 이 띠 style 문자열을 리터럴로 이미 고정한다. 정확한 서술은 「문구 1(본문·접두)·문구 2·문구 3 앞부분이 비어 있었다(4개 중 3개)」이며 요청자가 task 에 정정한 숫자와 같다. 시험 코드는 맞고 **주석만** 고치면 된다. 권고 문구: 「⑫ 의 문구 단언은 대부분 상수를 가져다 써서 비교하므로 문구 1·2 와 문구 3 앞부분을 다시 쓰면 상수와 단언이 함께 바뀌어 통과한다(문구 3 뒤 문장과 머리글 글자는 ⑫-8·9·12·13 이 리터럴로 이미 고정 — M-N4 가 그 증거)」.
- [23:45] **수정안 검증 [확실] — 격리 사본의 시험 파일에서 직접 돌렸다(요청자 clone 은 무변경)**: ① `textOf(html)`(태그→`\u0000`→분리→trim→filter→`join(' ')`)와 `renderedBar(p)`(`ChatErrorBar` 요소를 `renderToStaticMarkup` 해 `textOf` 후 끝의 `×` 제거) 헬퍼 2개를 ⑬ 안에 추가 ② ⑬-4·5 끝에 `expect(renderedBar(p)).toBe(<띠 문구 그대로>)` 1줄씩 ③ ⑬-6 의 `runs…toContain` 을 `const row = html.match(/<div[^>]*>(?:(?!<div)[\s\S])*?aria-hidden="true">↩[\s\S]*?<\/div>/)?.[0] ?? ''; expect(textOf(row)).toBe('↩ 「반도체 섹터 전망」 대화로 전송합니다');` 로 교체(`↩` 를 품은 가장 안쪽 div 하나만 떼어 통째 비교). 결과: 원본 구현에서 66 passed, S1a·S1b·S1c·S5a·S5b **전부 killed**, M-N1·N3·N6·S1d~S1f 는 여전히 killed. 추가 시험 건수는 늘지 않는다(기존 3건에 단언을 보강).
- [23:45] **기존 단언을 약화시키지 않았다 [확실]**: 삭제 0줄. 바뀐 곳은 import 줄에 `sentReloadFailedMessage` 1개와 파일 끝 append 뿐이다. 모듈 수준 상태(`routes`·`calls`·`fetchMock`·`replace`·`confirmMock`)는 파일 최상단 `beforeEach` 가 시험마다 초기화해 ⑬ 에도 적용되고(`routes` 의 배열 응답은 `shift()` 로 소모되지만 각 `toReview` 가 새 배열을 만든다), ⑬ 의 `DRAFT`·`prop`·`toReview` 는 ⑬ `describe` 안의 지역 상수라 ⑫ 의 동명 헬퍼와 **별개**(스코프 분리, 덮어쓰기 없음). 헬퍼 `routes`·`mount`·`T`·`M`·`MODELS`·`findAll`·`typeName`·`HTML`·`Spec` 은 읽기 전용 재사용이다. 순서 무작위·단독 실행 통과가 그 증거다.
- [23:45] **거짓 안심 점검 [확실]**: 항상 참인 단언은 없다. ⑬-1·2·3 은 상수 대 리터럴(서로 독립), ⑬-4·5 는 `toEqual([...])` 로 띠가 **정확히 1개**임을 강제하고 `DraftReview` 가 없으면 `TypeError` 로 실패하며(공회전하지 않음), 전제 `prompt === '정제됨'` 단언이 흐름 도달을 보증한다. ⑬-3 의 `sentReloadFailedMessage('전송 완료 — 화면 갱신만 실패했습니다 (HTTP 500)')` 는 접두 상수가 바뀌면 `startsWith` 가 거짓이 되어 다른 분기를 타 기대값과 어긋나므로 접두 변이(M-N3)를 오히려 더 잘 잡는다. 지적할 자기 비교는 없다.
- [23:45] **Info (범위 밖·선택)**: (I-1) 확정 버튼 라벨(`확정 전송 ▶`·`편집됨 — 전송 ▶`)과 `취소` 는 저장소 어느 시험도 단언하지 않는다 — S6a(기각안 B 의 `편집됨 — 다른 대화로 전송 ▶`)·S6b·S6c 가 66건 통과한다. 데모 결정 1 의 근거 중 하나가 「버튼 라벨이 지금의 두 가지로 유지된다」인데, 이 task 가 만든 구멍은 아니고 기존 공백이며 N-2(문구 3종·머리글)의 범위도 아니다. 원하면 ⑫ 에 1건. (I-2) S4a·S4b — 목록에 없는 대화의 제목 폴백 `'대화'` 를 바꿔도 통과한다. 폴백은 데모에 없는 문구이고 읽으면 `「대화」 대화에 저장했습니다` 로 어색하다 — 시험보다 designer 판단 사안이라 판정하지 않고 Leader 에게 넘긴다. (I-3) S3c — `handleConfirmDraft` 의 `tid == null` 분기 문구를 바꿔도 통과한다. 이 분기는 `draftThreadIdRef` 가 검토 단계 진입 전(L325)에 채워지고 `clearDraft`/`discardDraft` 에서만 비워져 정상 흐름으로는 도달하지 않는 방어 코드다(도달 불가 확인은 코드 읽기까지, 실행 증명은 아님).
- [23:45] 미확인: 실제 브라우저·실제 React 렌더러·갤럭시 S25+·스크린리더 확인 0건(전부 `renderToStaticMarkup`/하네스까지). judge C2·Codex 검토는 호출하지 않았다. QA 에 넘길 집중 지점은 운영 코드 변경이 없어 없고, 시험 자체의 재실행뿐이다(`chat-page-errors-t157.test.ts:1211~1301` ⑬ 절, F-1·F-2 는 ⑬-4~6). 집계(라운드 3): critical 0 · high 0 · medium 0 · low 3(F-1·F-2·F-3) · info 3(I-1~I-3). F-1·F-2 는 검증된 수정안이 있으므로 커밋 전에 반영하는 편이 낫고, 반영하지 않아도 N-2 의 목적(문구 3종의 글자 고정)은 달성됐다.
- [23:45] **최종 판정: PASS (라운드 3 — N-2 회귀망 시험 감사; scope: src/app/ai/__tests__/chat-page-errors-t157.test.ts, src/app/ai/ChatPage.tsx(읽기·변이 기준, 변경 없음), mockups/T-161-draft-review-ownership-v1.html(대조 원본))**

## QA

- [19:02] 실행 도구: Claude Code(qa 서브에이전트). 기준은 서버 clone `~/.node-local/stockinvest-t157`(HEAD=`5fdfc19`, 변경 2파일). 무거운 명령은 `flock /tmp/stockinvest-heavy-tests.lock nice -n 10` 으로 직렬 실행했다. node_modules 링크는 건드리지 않았고 끝난 뒤 `.bin/jest` 실행 가능을 확인했다.
- [19:02] 명령 ① jest `npx jest src/app/ai/__tests__/chat-page-errors-t157.test.ts src/components/__tests__/bottom-tabs-t108.test.ts` → exit 0 · `Test Suites: 2 passed, 2 total` · `Tests: 98 passed, 98 total`. 기대값 98 과 일치. 로그 `~/.node-local/qa-t161-jest-185802.log`.
- [19:02] 명령 ② tsc `npx tsc --noEmit` → exit 0 · 출력 0줄.
- [19:02] 범위·안전 경계 [확실]: `git status --porcelain` = 두 파일 + `?? node_modules`(링크). `git diff --numstat 5fdfc19` = ChatPage 132/28 · 시험 346/1, 그 밖 0. `src/lib/safety/`·`src/lib/exchanges/`·`src/app/api/`·DB·인증·`mockups/` 변경 0건. `scripts/git-hooks/commit-msg` 의 `SAFETY_PATHS` 에 `src/app/ai` 없음(awk 실측 0건). 승인 데모 `mockups/T-161-draft-review-ownership-v1.html` sha256 `959795523a15…c203` = 게이트 `content_sha256` 일치. ChatPage md5 `373a35e6…` 은 공유 트리와 clone 이 같다.
- [19:02] 승인 문구 글자 대조 [확실]: ① `전송 완료 — 「<제목>」 대화에 저장했습니다. 보려면 그 대화를 여세요.` 는 접두(`SENT_NOTICE_PREFIX`)와 본문이 데모 5곳(예시 제목 「반도체 섹터 전망」)과 같다(em dash U+2014 대조). ② `보낼 대화가 삭제돼 …` 는 데모 3곳과 ChatPage 리터럴 1곳이 글자 단위로 같다. ③ 조립 결과 `전송 완료 — 화면 갱신만 실패했습니다 (HTTP 500). 대화를 다시 열면 답변이 보입니다.` 는 데모 2곳과 같다. 차이 0건.
- [19:02] 시나리오 ①~⑧ (하네스 기준 — 실제 화면이 아니다): ① 다른 대화 선택 후 확정 = ⑫#1 PASS · ② 「+ 새 대화」 후 확정 = ⑫#2 PASS · ③ 확정 응답 전 대화 전환 = ⑥#2·⑫#1 PASS, 정제 중 전환 = ⑫#6 PASS, 확정 중 삭제 = ⑫#17 PASS · ④ 재조회만 실패 → 입력칸 비움·호박색 = ⑫#8·⑫#9 PASS · ⑤ 같은 대화 확정 → 안내 없음 = ⑫#7 PASS · ⑥ 확정 200 + 재조회 404 → 「전송하지 못했습니다」 아님 = ⑫#14 PASS · ⑦ × 라벨 = ⑫#11 PASS(마크업 단언까지, 낭독은 미확인) · ⑧ 확정 중 삭제 → 입력칸 막힘 유지 = ⑫#17 PASS.
- [19:02] 엣지케이스 ① 검토 중 401 [확실 — 탐침 P1]: 확정 POST 401 → `window.location.replace('/login?next=%2Fai')` 1회, 안내 띠 0, 카드 닫힘, 메시지 유지. 검토 중 고친 초안과 입력 글은 페이지 이동으로 사라진다. T-157 과 같은 동작이며 T-161 목표 밖이다(QA-I1).
- [19:02] 엣지케이스 ② 확정 연타 [가능성 높음 — 탐침 P2]: 첫 클릭 직후 `DraftReview` 가 사라지고 POST 는 1회다 → 두 번째 확정 대상이 없다. 하네스는 상태를 즉시 반영하므로 React 18 실제 flush 는 브라우저로 확인하지 못했다(NOT_VERIFIED). 같은 계열의 기존 결함은 QA-L2 로 따로 적는다.
- [19:02] 엣지케이스 ③ 긴 제목·「」 [확실 — 탐침 P4]: 「」 가 든 제목과 120자 제목에서도 안내가 접두로 시작해 띠 색 판별이 유지된다. 서버 제목 상한은 120자(`slice(0, 120)`). 헤더는 말줄임, 안내 띠는 말줄임 없이 줄바꿈 — 시각은 미확인. 같은 항목에서 새 결함 QA-L1 을 찾았다.
- [19:02] 엣지케이스 ④ 새로고침 [확실 — 코드, 브라우저 미실행]: 초안 저장 경로가 없다 — `draft/route.ts` 에 INSERT·UPDATE·DELETE·query 0건, localStorage 키는 `chat_skip_draft`·`chat_claude_model` 두 개뿐. 「새 대화」에서 시작했다면 `ensureThread` 가 만든 빈 대화는 남는다(기존 동작).
- [19:02] 엣지케이스 ⑤ 서버 오류의 `전송 완료 — ` 접두 [확실]: `src/` 전체 리터럴 0건. `주문 전송 완료` 는 KIS 시험 픽스처 1건으로 접두가 다르고 채팅 경로가 아니다. `dangerouslySetInnerHTML` 은 `ChatPage.tsx` 에 0건이라 대화 제목·서버 오류는 JSX 텍스트로만 그려진다.
- [19:02] 발견 결함 **QA-L1 [Low · T-161 도입]** 안내 제목이 전송 전 제목으로 나온다. 재현: 「새 대화」에서 첫 질문 전송 → 검토 카드 → 다른 대화 선택 → 확정. 기대: 실제 저장된 대화 제목(또는 번호 표기). 실제: 안내는 「새 대화」, 목록은 서버가 바꾼 첫 30자 제목. 원인 [확실 — 코드]: `handleConfirmDraft` 의 `threads.find(...)` 가 클릭 시점 스냅샷이고, 서버는 `messages/route.ts` 188~196행에서 「새 대화」를 첫 30자로 바꾼다. 영향: 정보 오류(데이터 영향 없음), 같은 이름 대화가 여럿이면 찾기 어렵다. 처리 여부는 Leader 판단.
- [19:02] 발견 결함 **QA-L2 [Low · 기존, T-161 이전부터]** 「새 대화」 상태에서 전송 버튼을 응답 전에 연타하면 대화가 2개 생기고 정제 요청도 2회 나간다(탐침 P3: `POST /api/chat/threads` 2회·초안 2회). 원인 [확실 — 기준 HEAD 코드]: `handleSend` 가 224행 `await ensureThread()` 뒤에야 250행 `setStage('drafting')` 를 부르므로 그 사이 stage 가드가 통과한다. 영향: 빈 대화 1개 잔존·첫 초안 덮임. 확정은 한 번뿐이라 중복 전송은 없다. 실제 브라우저 연타는 미재현(NOT_VERIFIED).
- [19:02] 발견 [QA-I1 · Info · 기존] 401 로그인 만료 시 검토 중 초안·입력 글이 사라진다 — T-161 은 대화 전환 경로만 막았다. [QA-I2 · Info · T-161 도입] 재조회 네트워크 예외 시 안내에 `TypeError: Failed to fetch` 원문이 붙는다(`chatFetch` 의 `String(e)`). 외관 문제.
- [19:02] 결함 집계: Critical 0 · High 0 · Medium 0 · Low 2(QA-L1·QA-L2) · Info 2(QA-I1·QA-I2). Reviewer 잔여 항목(N-1~N-3·I-1~I-4)은 재판정하지 않았다.
- [19:02] NOT_VERIFIED (이 QA 에서 실행하지 않음): 브라우저 렌더 · 412/360/1280px 가로 스크롤 0 · 다크 토큰 반전 · 터치 44px · 갤럭시 S25+ 실기기 · TalkBack 「안내 닫기」 낭독 · `↩` 줄 실측 · 재조회 404 실재현(네트워크 가로채기 없이 ⑫#14 로 갈음) · 화면 XSS 리터럴(코드 근거는 `dangerouslySetInnerHTML` 0건뿐) · `npm run lint`(ESLint 설정 없음 — Developer 기록과 같음) · judge C2·Codex 검토.
- [19:03] 산출물 정리: 서버 탐침 복사본 `~/.node-local/qa-t161-probe`(파일 7개 + node_modules 링크 1개) 삭제. 링크는 unlink 후 제거했고 대상 `stockinvest-t155/node_modules` 는 그대로다. 스크린샷 0장. 실행 로그 3개는 서버 홈 `~/.node-local/` 에 남겼다(프로젝트 밖).
- [19:03] **QA 판정: PASS** — 근거: jest 98/98 · tsc 0 · 범위 · 승인 문구 글자 대조 · 탐침이 모두 통과했고 Critical·High·Medium 0, Low 2 는 기록. 다만 화면·실기기 항목이 NOT_VERIFIED 라 전체 검증 통과가 아니며, 배포 인계와 QA-L1 처리 여부는 Leader 판단이다.

## Deployer

- [19:06] 실행 도구: Claude Code **메인 세션(Leader 겸 배포 실행)** — deployer 서브에이전트는 호출하지 않았다. 커밋 `bc845fa`(서버 clone `~/.node-local/stockinvest-t157`, 두 파일만 stage) → 19:06:39 `git push origin HEAD:main`(`5fdfc19..bc845fa`) = webhook blue/green.
- [19:06] `RELEASE_RESULT {"status":"ok","release":"20261107-190639-bc845fa1","sha":"bc845fa1f95ccdaa2a3f01950694037b5841ed40","previous":"/home/brownjeon/apps/stockinvest/releases/20261107-120604-5fdfc19d","migrated":false}` — DB 마이그레이션 없음. 롤백 지점은 `previous` 다.
- [19:08] 배포 후 확인(직접 실행): `current` → `20261107-190639-bc845fa1` · pm2 `stockinvest`·`stockinvest-cron` 각 **1행** online(cron 중복 0) · `GET /api/health` **200**, `ok:true`·`db:true`·`safetyStatus:"green"`·`safetyReasons:[]` · 안전장치 값은 T-157 배포 때와 **같다**(`dryRun:true`·`killSwitch:false`·`limitsConfigured:true`·`effectiveLimitsResolved` 국내·해외 true).
- [19:06] **커밋을 서버 clone 에서 한 이유**: 공유 NFS 트리의 HEAD(`f47cf28`)가 `5fdfc19` 의 **조상**(6커밋 뒤처짐 — `merge-base --is-ancestor HEAD 5fdfc19` → 0, `rev-list --count HEAD..5fdfc19` = 6, 그쪽만 가진 커밋 0건)이라 그 트리에서는 T-157 이 추가한 시험 파일이 untracked 이고 `ChatPage` diff 에 T-157 변경이 섞인다. Mac 세션에서 `commit-msg` 훅이 돌지 않는 사정도 같은 방향이다. 이번 두 파일은 `SAFETY_PATHS` 비대상이라 훅은 검사 없이 통과했다(Reviewer 판정 줄은 남겼다).
- [19:12] 기록 커밋 `ad3c383`(이 task 이력서 + 승인 데모 v1, 코드 0건) push → 릴리스 `20261107-191215-ad3c3837`, `RELEASE_RESULT ok`·`migrated:false`. 배포 후 health 200·`safetyStatus green`·cron 1행 재확인. `board.md`·`ACTIVE.md`·`20-Log/2026-11-07.md` 는 공유 트리에 다른 세션의 미커밋 변경이 섞여 있어(그 트리는 원격보다 6커밋 뒤처져 있다) 이 커밋에 넣지 않았다 — 기록은 공유 트리에만 있다. T-159·T-160 의 데모도 같은 이유로 미커밋 상태다.
- [19:06] **앱(APK) 변경 없음** — `android/**`·`capacitor.config.ts`·`public/app-shell/` 변경 0건이라 재설치가 필요 없다. 앱은 WebView 라 다시 열면 반영된다.
- [23:51] 후속 1(N-2 시험) 배포 — 커밋 `24027b7`(시험 1파일 + 이 이력서) → 23:49:50 push = webhook blue/green → 릴리스 `20261107-235004-24027b7f`, `RELEASE_RESULT {"status":"ok",…,"migrated":false}`, END exit=0. 롤백 지점 `20261107-191215-ad3c3837`. 배포 후 확인: `current` 전환 · pm2 `stockinvest`·`stockinvest-cron` 각 1행 online · `GET /api/health` 200(`ok:true`·`db:true`·`safetyStatus:"green"`·`safetyReasons:[]`) · 안전장치 값 배포 전과 동일(`dryRun:true`·`killSwitch:false`·`limitsConfigured:true`). **시험 전용이라 런타임 동작 변화 0건.** 다만 push 시각이 미국장 개장(23:30 KST) 뒤라 blue/green 컷오버가 웹·cron 프로세스를 재시작했다 — `DRY_RUN=true` 라 주문 영향은 없다.
- [2026-11-08 08:30] **후속 1 종료** — 사용자 지시 「여기서 멈추고 작업 마무리해줘」(2026-11-08)로 **N-1 은 메우지 않고 보류**한다. 위 배포 결과 줄은 이 커밋에 함께 넣었다 — 미국장이 06:00 KST 에 닫혀 「기록 한 줄 때문에 장중 재시작」 우려가 사라졌다. push(=운영 blue/green 배포) 는 사용자 승인 사항이라 별도로 받는다. `board.md`·`ACTIVE.md`·`20-Log` 는 여전히 공유 트리에만 있다(그 트리가 원격보다 6커밋 뒤처져 다른 세션 변경이 섞인다).
- [2026-11-08 09:08] 기록 커밋 `6c67160`(이 이력서 1파일, 코드 0건) 사용자 승인 후 push(09:06:32 KST) → 릴리스 `20261108-090655-6c671602`, `RELEASE_RESULT {"status":"ok",…,"migrated":false}`, END exit=0. 롤백 지점 `20261107-235004-24027b7f`. 배포 후 확인: `current` 전환 · pm2 `stockinvest`·`stockinvest-cron` 각 1행 online(restarts=0) · `GET /api/health` 200(`ok:true`·`db:true`·`safetyStatus:"green"`·`safetyReasons:[]`·`dryRun:true`·`killSwitch:false`·`limitsConfigured:true`). 미국장 마감(06:00 KST) 뒤라 컷오버가 장중 재시작을 만들지 않았다. **이 줄과 `board.md`·`ACTIVE.md`·`20-Log` 는 공유 트리에만 있는 미커밋 기록이다**(서버 clone 사본은 `6c67160` 상태로 깨끗하게 둔다).


## 최종 요약

### [T-161] 비서(채팅)에서 초안을 검토하다 다른 대화로 옮겨도 「확정 전송」이 원래 대화로 간다

- **상태**: 운영 배포 완료 · 👉 사용자 화면 확인 대기
- **무엇이 바뀌었나**
  - 초안 검토 카드가 **자기 대화를 기억**한다. 「확정 전송」은 보고 있는 대화가 아니라 **초안을 만든 대화**로 간다. 종전에는 ① 남의 대화에 저장되거나(「7번 질문이 8번에 들어간다」) ② 「+ 새 대화」·③ 404·④ 삭제·⑤ 정제 중 전환에서 **버튼이 아무 반응도 없었다**.
  - 보낸 대화가 보고 있는 대화와 다르면 어디에 저장했는지 알린다 — `전송 완료 — 「<제목>」 대화에 저장했습니다. 보려면 그 대화를 여세요.`
  - 보낼 대화가 404·삭제로 사라지면 검토 카드를 닫고 그 사실을 알린다(보낼 곳이 없을 때만 고친 초안을 버린다).
  - 전송이 200 인데 뒤이은 화면 갱신이 실패하면 `전송 완료 — 화면 갱신만 실패했습니다 (HTTP nnn). 대화를 다시 열면 답변이 보입니다.` 로 **전송 여부를 먼저** 말한다(T-157 QA Low 1건). 전송 성공 뒤의 404 는 「전송하지 못했다」고 말하지 않는다.
  - 성공 안내 띠는 **호박색 + `role="status"`**(닫기 레이블도 「안내 닫기」), 오류 띠는 기존 빨강 + `role="alert"` 그대로. 검토 카드 머리글에는 **다른 대화로 갈 때만** 한 줄(`↩ 「…」 대화로 전송합니다`)이 나타난다 — 같은 대화면 화면이 지금과 똑같다.
- **배포**: 커밋 `bc845fa` · 2026-11-07 19:06:39 push(= webhook blue/green) · 릴리스 `20261107-190639-bc845fa1` · `RELEASE_RESULT status: ok`, `migrated:false` · 롤백 지점 `20261107-120604-5fdfc19d`. **같은 배포에 실린 다른 작업 없음**(커밋 1개, 파일 2개). 웹 전용이라 **앱 재설치 불필요**.
- **AI 가 검증한 것**: 커밋되는 트리에서 jest **2 suites / 98 passed**(기준선 80 → +18)·`tsc --noEmit` exit 0 — developer·Reviewer·QA 가 각각 독립 실행. 변이 시험 **13종**으로 새 가드가 각각 죽는지 확인(접두 보장·away 가드·stage 보존·ref 비움·확정 뒤 정리·`sent` 분기·aria 삼항·`draftContent` 등). 데모 승인 문구 3종과 코드의 **글자 단위 일치**(QA 사람 대조). 변경 범위 2파일, 안전장치·거래소·API·DB·인증·`mockups/**` 변경 0건. 배포 후 health 200·cron 1행·안전장치 값 불변.
- **AI 가 못 한 것**: 브라우저 실화면·갤럭시 S25+ 실기기·TalkBack 낭독·412/360px 레이아웃·다크 토큰·터치 크기 — **전부 미확인**(시험 하네스는 React 훅을 가짜로 대체하므로 실제 배칭·렌더와 다르다). `npm run lint` 는 저장소에 ESLint 설정이 없어 실행 불가(이번 변경과 무관한 기존 상태). judge C2·Codex 외부 검토 없음.
- **👉 사용자가 확인할 것**: `/ai`(비서 탭)에서 ① 질문을 보내 **검토 카드가 뜬 상태**로 다른 대화를 고르면 카드 머리글에 `↩ 「…」 대화로 전송합니다` 한 줄이 보이는가 ② 그 상태로 「확정 전송」을 누르면 **원래 대화**에 저장되고 호박색 안내 띠가 어디로 갔는지 말하는가 ③ 검토 중 「+ 새 대화」를 눌러도 확정이 **무반응이 아닌가** ④ 같은 대화에서 확정할 때는 머리글 한 줄과 안내 띠가 **나타나지 않는가**(평소 화면 불변) ⑤ 412px·360px 에서 안내 띠가 두 줄이 되며(약 53px) 메시지 영역이 18px 줄어드는 것이 거슬리지 않는가. 지금부터 바로 확인할 수 있다(앱은 다시 열면 적용).
- **👉 사용자가 결정할 것**: (1) **QA-L1 을 고칠지** — 「새 대화」에서 첫 질문을 보낸 뒤 다른 대화로 옮겨 확정하면 안내가 바뀐 제목 대신 「새 대화」라고 말한다(데이터 영향 없음). 고치려면 재조회 뒤 목록 갱신을 `await` 해야 하는데 T-157 의 늦은 응답 가드 경합을 다시 건드린다 — **권고: 후속으로 둔다.** ~~(2) N-1 도 시험으로 메울지~~ — **종료.** N-2(승인 문구의 글자)는 2026-11-07 사용자 지시로 메웠고(아래 「후속 1」), N-1(검토 중인 대화가 로드 404·DELETE 404 로 사라지는 두 경로)은 2026-11-08 「여기서 멈추고 작업 마무리해줘」로 **보류**한다 — 현재 동작은 맞고 그 동작을 지키는 시험만 없는 상태로 남는다.
- **남은 일**: 위 결정 1건(QA-L1) · 회귀망 N-1 (보류 — 다시 꺼내려면 「후속 1」의 방식 그대로 시험만 추가하면 된다) · 범위 밖으로 남긴 UI 결함(검토 카드 버튼 31px·띠 닫기 × 가 터치 44px 미만, 머리글 10px·composer 9px 이 11px 미만, 빨강 띠 명암비 4.43:1) · 직진 전송에는 away 안내 없음 · 안내 띠가 목적지 대화를 열어도 사라지지 않음 · 동명 대화가 여럿이면 안내가 모호 · 서버 `error` 가 마침표로 끝나면 안내가 `..` 로 끝남(문구 조립 규칙 — designer 소관) · QA-L2(「새 대화」에서 전송 연타 시 대화 2개·정제 2회 — 이번 작업 전부터) · QA-I2(네트워크 예외 원문이 안내에 붙음).
- **이슈·위험**: 없음(안전장치·주문 경로 무관, DB 변경 없음). 단 **실제 브라우저 확인이 0건**이라 화면에서 처음 드러나는 문제가 있을 수 있다 — 위 「사용자가 확인할 것」이 그 창구다.


## 데모 검토 (demo gate)

> 실행 판정 정본은 frontmatter `demo_gate` 이다. 이 표는 check.mjs 가 함께 기록하는 사람용 이력이다(docs/demo-review-gate.md).

| 버전 | 상태 | 저장소 파일 | Artifact | 사용자 결정 | 일시 |
|---|---|---|---|---|---|
| - | 작성중 | - | - | judge: delta (JV-ui_change) | 11-07 13:51 |
| v1 | 검토요청 | mockups/T-161-draft-review-ownership-v1.html | - | 사용자 검토 요청 | 11-07 14:05 |
| v1 | 승인 | mockups/T-161-draft-review-ownership-v1.html | - | "권고안으로 승인" | 11-07 18:08 |
## 후속 1 — N-2(승인 문구 글자 고정) 회귀망 보강 · 2026-11-07

- [23:50] 실행 도구: Claude Code **메인 세션**(Leader 겸 구현). 사용자 지시: 「N-2(승인 문구 글자 고정) 1건을 시험으로 메워줘」. 변경은 `src/app/ai/__tests__/chat-page-errors-t157.test.ts` **한 파일**(+104/−0, **삭제 0줄**) — 운영 코드·구현 변경 0건, 런타임 동작 변화 0건.
- [23:50] 새 절 `⑬ 띠·머리글 문구는 승인 데모 v1 글자 그대로다 (T-161 N-2)` 6건: ① 문구 1 리터럴 + `SENT_NOTICE_PREFIX` ② 문구 2 리터럴 ③ 문구 3 접두 + 조립 완성형 ④⑤ 실제 확정 전송 경로가 띠에 올린 글자(props 와 **렌더된 글자** 둘 다) ⑥ 머리글 한 줄을 통째로 비교(순서·앞뒤 덧붙임까지).
- [23:50] 방식: 상수를 import 해 비교하지 않고 **데모 v1 의 글자를 리터럴로 중복 기재**했다(의도된 중복 — 「DRY 하게」 상수 import 로 바꾸면 이 시험은 아무것도 지키지 않는다). 데모의 합성 예시 제목 `반도체 섹터 전망` 을 그대로 써서 데모 HTML 과 기계적으로 대조된다.
- [23:50] 검증(직접 실행): 이 파일 **66 passed**(기준선 60 → +6) · `--randomize` 66 passed · `jest src/app/ai src/components/__tests__/bottom-tabs-t108.test.ts` **104 passed**(98 → +6) · `npx tsc --noEmit` **exit 0**. 전부 `flock /tmp/stockinvest-heavy-tests.lock nice -n 10` 직렬.
- [23:50] 변이 **9종 전부 포착**(각 변이 뒤 `git checkout --` + md5 로 원본 복원 확인): 문구 1 본문(M-N1) → ⑬-1·4 / 문구 2 첫 문장(M-N2) → ⑬-2 / 문구 3 접두(M-N3) → ⑬-3·5 / 문구 3 뒤 문장(M-N4) → ⑬-3·5 **와 기존 ⑫-8·9·13** / 안내 접두(M-N5) → ⑬-1·3·4·5 / 머리글 두 span 순서(M-N6) → ⑬-6 / 머리글 꼬리 덧붙임(S1a)·머리글 앞 span 삽입(S1b) → ⑬-6 / 띠 본문에서 접두만 떼어 렌더(S5b) → ⑬-4·5. M-N1·N2·N3·N5·N6·S1a·S1b·S5b 는 **새 시험만** 깨진다 = 공백이 실재했다.
- [23:50] Reviewer 라운드 3 PASS 의 Low 3건을 **커밋 전에 전부 반영**했다 — F-1(머리글을 `toContain` 에서 「`↩` 를 품은 가장 안쪽 div 통째 비교」로) · F-2(`renderedBar` 헬퍼로 props 가 아니라 **렌더된 글자**까지) · F-3(머리 주석의 과한 서술 정정). 반영 뒤 Reviewer 가 생존을 실측했던 S1a·S1b·S5b 가 죽는 것과 M-N1·N3·N6 이 여전히 죽는 것을 **내가 다시 측정**했다(위 9종).
- [23:50] **정정**: 배포 보고의 N-2 서술(「승인 문구를 시험이 지키지 않는다」)은 과했다. 문구 3 의 뒤 문장(`. 대화를 다시 열면 답변이 보입니다.`)·머리글 조각·띠 style 문자열은 ⑫-8·9·11·12·13 이 이미 리터럴로 고정하고 있었다(M-N4 가 그 증거). 실제 공백은 **문구 1·2 전체와 문구 3 접두, 머리글 한 줄의 순서·덧붙임**이었다.
- [23:50] 넣지 않은 것: Reviewer I-1(확정 버튼 라벨 `확정 전송 ▶`·`편집됨 — 전송 ▶`·`취소` 가 어느 시험에도 고정되지 않음 — 기존 공백) · I-2(목록에 없는 대화의 제목 폴백 `'대화'` 가 데모에 없고 `「대화」 대화에 저장했습니다` 로 어색 — designer 판단) · I-3(`tid == null` 방어 분기의 문구). 이 지시 범위(승인 문구 3종·머리글) 밖이라 「남은 일」로 넘긴다.
- [23:50] 미확인: 브라우저 실화면·실제 React 렌더러·갤럭시 S25+·TalkBack — 0건(시험은 전부 하네스·`renderToStaticMarkup`). 시험 전용 변경이라 화면 동작은 바뀌지 않는다. judge C2·Codex 검토 없음, QA 재실행 없음(운영 코드 변경 0건 — Reviewer 가 jest·tsc 를 독립 재실행했다).

## 사용자 확인 (2026-11-08)

- [09:20] 사용자 발화: 「실기기에서 비서메뉴의 챗봇화면 확인했으며 지금까지의 작업들에 대해서 미커밋된 것들을 커밋 및 푸시진행해줘」(2026-11-08). 실기기(안드로이드 「주식캐기」)에서 **비서 메뉴의 챗봇 화면을 확인**했고 이상 보고는 없었다.
- 그래서 frontmatter `waiting` 에서 화면 확인 항목을 뺀다. 다만 **항목별 결과를 보고받은 것은 아니다** — 화면 진입·표시가 정상이라는 확인으로만 기록한다. 개별 항목(아래 「사용자가 확인할 것」)의 결과가 필요하면 다시 확인받는다.
