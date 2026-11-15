---
task_id: T-174
title: 비서 채팅 후처리 보완 — 질문 다듬기의 지어낸 종목 식별자 제거(N1) + 본문 안 참고용 고지 중복 제거(N2)
status: doing
waiting: [user_push_approval]
priority: medium
project: StockInvest
created: 2026-11-15
updated: 2026-11-15
risk_level: R1
roles_involved: [leader, judge, developer, reviewer, qa]
base_ref: c62bc7a
tags:
  - type/task
  - domain/chat
  - domain/llm
aliases:
  - 비서 drafter 종목 코드 지어냄
  - 비서 고지 중복
related_tasks:
  - T-169
execution_context:
  schema_version: 1
  origin_tool: claude
  current_tool: claude
  current_procedure: claude_standard
  current_scope: "설계·구현·시험·Reviewer·QA·서버 worktree 커밋까지. push(=운영 배포)는 메인 세션이 사용자 승인을 따로 받는다. DB 쓰기·DDL·system_config/.env·home-m4-api 변경 없음."
  last_event_id: exec-001
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
  active: true
---

# T-174 — 비서 채팅 후처리 보완 (N1·N2)

## 목표

[[T-169-assistant-chat-data-context]] QA 가 남긴 Low 2건을 고친다.

- **N1**: 질문 다듬기(drafter) 결과에 사용자 원문·첨부 종목에 없는 **종목 식별자**가 들어가면 그 식별자만 지운다. QA 재현: 「엔비디아 어때?」의 다듬은 질문에 `NVIDIA (NVIDIA, 210140)` — 원문에 없는 국내 6자리 코드. 다듬은 질문은 사용자 편집창에 보이고, 확정되면 분석 모델에 그대로 들어가므로 엉뚱한 종목 이야기를 부를 수 있다(첨부 종목은 원문에서 인식하므로 첨부 자체는 영향 없음 — `messages/route.ts` 가 `userContent` 로 `resolveSymbolsInText`).
- **N2**: 답 본문 **단락 안**에 들어간 참고용 고지 문장(「…검증된 전략 판정이 아니라 참고용…」)을 지워, 끝 줄 고지 한 줄만 남긴다. 지금은 홀로 선 짧은 줄만 모아서, 단락 안 문장은 그대로 남아 고지가 두 번 보인다.

- 승인: 사용자 2026-11-15 메인 세션 「N1·N2 진행」(메인 세션이 보류를 권했으나 사용자가 진행을 선택).
- 범위: 구현·시험·Reviewer·QA·서버 worktree 커밋까지. push(=운영 배포)는 메인 세션이 따로 승인받는다.

## 실행 도구·절차 이력

- exec-001 (2026-11-15, claude, claude_standard): 메인 세션(Leader 겸임)이 task 작성·설계·주 작업 담당. 근거 = 위 사용자 지시. 남은 일 = developer → reviewer → judge C2 → qa → 커밋 → push 승인.

## 관련 과거 이력 요약

- `/이슈기록 관련 llm`·`chat` 승인 교훈 없음(2026-11-15 조회).
- [[T-169-assistant-chat-data-context]]: `src/lib/chat/answer-format.ts` 가 새 답 후처리(`finalizeNewChatAnswer`·`normalizeNewChatAnswer`)와 다듬은 질문 정리(`cleanDraftPrompt` — JSON 이 섞이면 사용자 원문으로 대체)를 맡는다. 과거 답 화면 표시(`normalizeChatAnswer`, GET)는 고지를 붙이지 않는다(사용자 결정 D2 「문장만」) — 이번에도 바꾸지 않는다.
- 운영 실측(2026-11-15 09:56, 읽기 전용): 원래 질문의 새 답은 고지 1줄로 정상. N2 는 QA 질문 ③ 에서 1회 재현, N1 은 QA 질문 ② 에서 1회 재현 — 빈도 미확인.

## 설계 (Leader → Developer 구현 가이드)

### N1 — 다듬은 질문의 지어낸 종목 식별자 제거

1. `cleanDraftPrompt(raw, userContent)` 에 선택 인자(허용 심볼 목록, 예: `allowedSymbols: string[]`)를 더한다. 인자가 없으면 지금과 **완전히 같은** 결과(기존 호출·시험 불변).
2. JSON 정규화가 `text` 로 끝난 경우에만, 결과 문장에서 아래 식별자 꼴을 찾는다.
   - 국내 6자리 코드: 홀로 선 6자리 숫자. **숫자·금액·날짜 맥락은 건드리지 않는다** — 앞뒤가 숫자·쉼표·소수점이거나 바로 뒤가 단위(원·주·%·년·월·일·개·명·건·회·배·달러·시·분·초 등)면 코드로 보지 않는다.
   - 해외 `거래소:티커` 꼴(앱 표기 `NAS:`·`NYS:`·`AMS:` — 대소문자 무시).
3. 허용 = 사용자 원문에 글자 그대로 있는 식별자 ∪ `allowedSymbols`(route 가 원문에서 인식한 종목 + 명시 첨부 종목의 앱 심볼). 허용 밖 식별자만 지운다. **종목 이름(한글·영문 회사명)과 단독 티커(`NVDA`)는 지우지 않는다**(문장이 망가지고 오탐이 크다).
4. 지운 뒤 남는 구두점을 정리한다: `(NVIDIA, 210140)` → `(NVIDIA)`, `삼성전자(999999)` → `삼성전자`, 빈 괄호·겹친 공백·쉼표 앞 공백 제거. 줄바꿈 구조는 유지.
5. 정리 결과가 비면 사용자 원문으로 대체(기존 대체 규칙과 같은 뜻).
6. 호출부: `draft/route.ts` 와 `messages/route.ts`(즉석 drafter 경로)에서 `merged`(인식 + 명시 첨부)의 `symbol` 목록을 넘긴다. **사용자가 편집해 보낸 `body.draftPrompt` 는 손대지 않는다**(사용자 글).

### N2 — 본문 안 참고용 고지 문장 제거

1. `finalizeNewChatAnswer` 에서 홀로 선 고지 줄 제거(기존)에 더해, 본문 줄 **안의 문장** 중 `DISCLAIMER_LINE_RE` 에 맞는 문장(길이 상한을 둔다 — 예: 120자)만 지운다. 같은 줄의 다른 문장은 남긴다.
2. 문장 경계는 `.`·`!`·`?`·`。` 뒤 공백 기준으로 단순하게 나눈다. 코드 펜스 안은 건드리지 않는다(기존 `splitFences` 흐름과 같은 방식).
3. 그 결과 빈 줄·빈 단락이 생기면 기존 규칙대로 정리하고, 끝 줄 고지는 기존대로 한 줄 붙인다.
4. 과거 답 표시(GET `normalizeChatAnswer`)는 바꾸지 않는다.

### 공통

- 버전 0.13.0 → **0.14.0**(`package.json`·`package-lock.json` 최상위·`packages[""]` 3곳). 앱(APK) 무관.
- 시험: 새 파일 `src/lib/chat/__tests__/answer-format-t174.test.ts` — N1(QA 재현 문장, 허용 코드 보존, 원문 코드 보존, 금액·날짜 숫자 보존, `NAS:` 꼴, 인자 없을 때 기존과 같음, 전부 지워져 원문 대체), N2(단락 안 고지 제거·같은 줄 다른 문장 보존·끝 줄 고지 정확히 1번·변형 문구·펜스 안 보존). route 호출부 인자 전달은 기존 `chat-routes-t169` 방식으로 확인.
- 금지: DB 쓰기·DDL, system_config·.env, home-m4-api, 프롬프트 문구(`system-prompt.ts`) 변경, 화면 파일 변경. 무거운 시험은 `flock /tmp/stockinvest-heavy-tests.lock nice -n 10` 로만, 이름 패턴 종료(`pkill -f`) 금지.

## 역할별 지시사항

- Developer(sonnet — judge 판정): 위 설계대로 구현·시험. 결과를 아래 「Developer」 절에 `- [HH:MM]` 줄로 남긴다(변경 파일, 실행한 시험과 결과, 미실행 범위).
- Reviewer: 의도 충족·오탐(지우면 안 되는 숫자·이름을 지우는지)·기존 동작 불변을 독립 감사. 「Reviewer」 절 마지막 줄에 `최종 판정: <판정> (scope: …)`.
- QA: 단위 시험 재실행 + 실제 문장 표본(T-169 QA 질문 ①~③ 재현 문장 포함)으로 확인.

## 판단 기록 (judge)

- [2026-11-15 20:57] intake engine=jev → task_type=feature · risk=R1 · developer_model=sonnet · next=assign · demo=none | overrides=- | fallback=- | tokens=1422 → leader.md 대로 developer 를 sonnet 으로 호출. demo none 이라 `demo_gate.status=not_required`(`check.mjs` 는 서버 worktree 미등록이라 frontmatter 수기 — T-168·T-169 와 같음).
- [2026-11-15 21:06] Leader: Reviewer 1차 conditional_pass(M1·M2·M3·L1~L4) 판단 → Developer 2차 수정. ① M1 고침(허용 `NAS:NVDA.` 끝 마침표·하이픈 때문에 허용 식별자가 지워짐 — 티커 끝 `.`·`-` 는 토큰에서 뺀다, `BRK.B` 처럼 영숫자 사이 `.` 는 유지). ② M2 고침(쉼표 목록 정리에서 앞뒤 낱말이 붙음 — 쉼표 하나는 남긴다). ③ M3: **정보 손실보다 고지 중복이 낫다** — 문장 단위 고지 제거 길이 상한을 120 → 60자로 낮춘다(정식 고지 37자, 흔한 변형 60자 안쪽). 그 결과 긴 혼합 문장은 남고 고지가 두 번 보일 수 있다(L4 와 같은 쪽으로 수용). ④ L1: 맨 6자리 숫자는 **괄호 안**(예: `(NVIDIA, 210140)`·`삼성전자(005930)`)이거나 바로 앞이 「코드」·「종목코드」일 때만 종목 코드로 본다 — `매수가 100000 이하로`·`093000 기준`·`202611 기준` 은 지우지 않는다. 괄호 밖 맨 코드(`SK하이닉스 000660`)는 남는 것을 수용(피해 낮음). `거래소:티커` 꼴은 모호하지 않으므로 어디서든 대상 유지. ⑤ L2: N1 도 코드 펜스 안은 건드리지 않는다. ⑥ L3: 허용 목록에 최근 대화(route 가 이미 읽는 `historyRows`) 본문에 글자 그대로 있는 식별자도 넣는다. Reviewer 재현 입력 전부를 시험으로 고정한다.
- [2026-11-15 21:09] Leader: Developer 2차 보고의 남은 경우(문장 1개짜리 80자 이하 혼합 줄은 T-169 의 홀로 선 고지 줄 규칙 때문에 줄 전체가 지워진다)도 ③과 같은 원칙(정보 손실보다 고지 중복)으로 맞춘다 — 홀로 선 고지 줄 상한 `DISCLAIMER_LINE_MAX` 를 80 → 60 으로 낮춰 문장 단위 상한과 같게 한다. 61~80자 순수 고지 변형 줄은 남아 중복될 수 있음을 수용.
- [2026-11-15 21:10] Leader: Developer 2b 의 절 단위 자르기(`trimDisclaimerSentence` — 섞인 문장을 마지막 쉼표 앞까지 남김)는 `단기 반등 가능성은 있으나.` 같은 끊긴 조각을 만든다. 조각보다 원문이 낫다 — **섞인 문장(고지 절 앞에 8자 이상 내용이 있는 문장)은 길이와 관계없이 통째로 남기고**, 고지만으로 된 문장(앞 내용 8자 미만)만 지운다. 자르기 함수는 판별용으로만 쓰거나 없앤다. 중복 고지 노출은 수용.
- [2026-11-15 21:12] Leader: Reviewer 2차 conditional_pass(R2-M1·M2·L1~L3) → Developer 3차. ① R2-M1·M2: 섞인 문장 판별을 쉼표에서 떼어 낸다 — 문장에서 고지 구절(앞머리 「이 내용은」「이는」「본 답변은」「다만」 등 흔한 머리말과 「이 시스템의」, 끝맺음 「입니다/이며/이고/입니다만」 포함)을 빼고 남은 내용 글자(한글·영숫자)가 8자 이상이면 앞뒤 어디에 있든 섞인 문장으로 보고 통째로 남긴다. 정식 고지 문장은 순수 고지로 분류돼야 한다. ② R2-L1: 괄호 안 6자리 숫자는 **목록 한 항목으로 홀로 설 때만**(왼쪽이 `(` 또는 `,`, 오른쪽이 `,` 또는 `)` — 공백 허용) 코드로 본다. `(목표가 100000 이하)` 는 보존. ③ R2-L2: 빈 괄호를 지운 뒤 겹친 쉼표(`,,`)를 하나로. ④ R2-L3: 최근 대화 허용은 부분 문자열이 아니라 토큰 경계 일치로. 앞선 답이 지어낸 코드가 다시 허용되는 관대함은 수용(대화 맥락 유지 쪽).
- [2026-11-15 21:13] Leader: 시각 정정 — 위 Leader 줄 둘은 처음에 21:28·21:42 로 잘못 적었다(서버 `date` 를 보지 않고 적음, 실제 21:09·21:10 으로 고침). Developer 절의 `[21:05]`·`[21:25]`·`[21:40]`·`[21:50]` 도 실제와 다르다 — 시험 로그 수정 시각(`~/.node-local/t174-dev/`)으로는 1차 21:03, 2차 21:08, 2b 21:10:04, 2c 21:10:50 이다(역할 기록이라 원문은 두고 여기서 정정). 같은 줄의 「Leader 21:28·21:42」 인용도 각각 21:09·21:10 을 뜻한다.
- [2026-11-15 21:16] codex_gate/C2 engine=jev → codex_required=false (wanted_before_budget=false), budget_rule=CX-limit-unknown-hold, codex_switch=on | overrides=- | fallback=- | tokens=928 → Codex 검토 없이 QA. Leader: Reviewer 3차 PASS 의 Low 4건(R3-L1 짧은 분석 절 8자 미만은 순수 고지로 분류 — 한 줄 답이면 고정 안내문, R3-L2 괄호 안 금액 목록 일부 삭제, R3-L3 쉼표 하나 남음, R3-L4 목록 밖 끝맺음은 내용으로 셈)은 이번 범위에서 수용하고 후속 후보로 둔다(빈도 낮음, R1).
- [2026-11-15 21:20] Leader: QA PASS 확인. QA 가 짚은 운영 id 44 재처리 시 끝 고지 앞 빈 줄 1개 추가는 「이미 후처리된 글을 한 번 더 후처리」할 때만 생기는 차이이고 기준 코드도 같다 — 실제 경로는 모델 원문에 한 번만 적용하므로 결함 아님. 서버 worktree 커밋 → push(=운영 배포)는 사용자 승인 대기. 커밋 훅 SAFETY_PATHS 해당 파일 0.

## Developer

- [21:05] 실행 도구 claude(developer, sonnet). 변경: src/lib/chat/answer-format.ts(N1 cleanDraftPrompt 3번째 인자 allowedSymbols + stripInventedSymbolIds, N2 stripInlineDisclaimerSentences·상한 120자), draft/route.ts·messages/route.ts(인자 전달), package.json·package-lock.json(0.13.0→0.14.0, 최상위 version 2곳만 diff 확인), 신규 시험 answer-format-t174.test.ts·chat-routes-t174.test.ts.
- [21:05] 편차: messages route 는 merged 가 else 분기 안에만 있어 symbolContexts.map(c=>c.symbol)을 넘김(인식+명시 첨부, 클라이언트 echo 경로 포함). 6자리 YYYYMM(202611 등)은 단위가 없으면 코드로 간주해 지워질 수 있음(실제 코드와 구분 불가). 기존 홀로 선 고지 줄 필터(80자)는 펜스 안 줄에도 적용되는 기존 동작이라 그대로 둠.
- [21:05] 시험(flock+nice): typecheck exit 0 / jest src/lib/chat/__tests__ + src/lib/llm/__tests__ 12 suites 206 passed exit 0 / 신규 2파일 23 passed / 경계 3종 5 failed 98 passed — base(변경 stash 후) 동일 5 failed 103 total, 신규 실패 없음. 로그 ~/.node-local/t174-dev/{typecheck,jest-t174,jest-chat-llm,jest-boundary,jest-boundary-base}.log. 미실행: 전체 jest, 실서버·실제 LLM 호출, 커밋·push 없음.
- [21:25] 2차(Reviewer M1~M3·L1~L3, Leader 21:06 결정): answer-format.ts — M1 티커 끝 .·- 제외(영숫자 사이만 유지), M2 쉼표 목록 구분자 1개 유지, M3 문장 상한 120→60, L1 맨 6자리는 괄호 안 또는 앞이 코드/종목코드일 때만, L2 코드 펜스 안 제외(splitFences), L3 cleanDraftPrompt 4번째 인자 historyText(route 두 곳이 historyRows 본문을 넘김, 인자 없으면 기존 동일). Reviewer 재현 입력 전부를 answer-format-t174.test.ts·chat-routes-t174.test.ts 에 시험으로 고정.
- [21:25] 편차 2건(구현 중 발견): (a) 단위 예외가 「210140 분석」의 분(分)을 단위로 오인 → 공백 뒤 단위는 뒤에 한글이 이어지면 단위로 보지 않음. (b) M3 입력이 80자 이하라 기존 홀로 선 고지 줄 필터가 줄 전체를 지워 분석 문장이 사라짐 → 문장이 둘 이상인 줄은 그 필터에서 제외(문장 단위 제거만 적용). 한 문장짜리 80자 이하 혼합 줄은 기존대로 통째 제거(기존 동작).
- [21:25] 시험 결과는 최종 답변 참조(로그 ~/.node-local/t174-dev/*-r2.log).
- [21:40] 2b(Leader 21:28): DISCLAIMER_LINE_MAX 80→60. 구현 보완: 60자 이하 혼합 한 문장은 trimDisclaimerSentence 가 마지막 쉼표 앞 분석 부분(8자 이상)만 남김(예 「단기 반등 가능성은 있으나.」), 쉼표 앞이 없으면 통째 제거 / 홀로 선 줄 필터도 같은 함수가 빈 값일 때만 줄 제거 / 고지만 있던 줄은 빈 줄을 남기지 않고 줄째 제거 / 60자 초과 혼합 문장은 통째 보존. 시험: 정식 고지 줄·61~80자 순수 변형 보존·혼합 한 문장·상한 초과 혼합·M3 입력 추가. 편차: 이전 2차의 MULTI_SENTENCE_RE 제거(상한 통일로 불필요).
- [21:40] 2b 시험: typecheck exit 0 / T-174 2파일 + chat+llm jest 결과·경계 3종 이름 비교는 최종 답변 참조, 로그 ~/.node-local/t174-dev/*-r2b.log.
- [21:50] 2c(Leader 21:42): 조각 출력 폐지 — trimDisclaimerSentence 를 isPureDisclaimerSentence(분류만)로 교체. 쉼표 앞 8자 이상 분석이 있는 혼합 문장은 길이와 무관하게 통째 보존(고지 중복 수용), 순수 고지(60자 이하)만 문장·줄 단위로 제거. 시험: 혼합 짧은 문장 보존·M3 입력 보존·정식 고지 줄 제거·61~80자 순수 변형 보존. 경계 3종은 건드린 파일이 그 대상이 아니라 미재실행(2b 결과 유지). 결과: typecheck exit 0, T-174 2파일, chat+llm jest — 로그 ~/.node-local/t174-dev/*-r2c.log.
- [21:14] 3차(Leader 21:12 결정, 시각은 서버 date): answer-format.ts — R2-M1/M2 isPureDisclaimerSentence 를 쉼표 대신 「고지 구절(머리말·끝맺음 포함) 제거 후 남은 내용 글자 8자 이상이면 혼합」으로 교체(DISCLAIMER_CLAUSE_RE). R2-L1 괄호 안 6자리는 목록 항목으로 홀로 설 때(왼쪽 ( 또는 ,, 오른쪽 , 또는 ))만 코드. R2-L2 빈 괄호 제거 뒤 겹친 쉼표 하나로. R2-L3 사용자 원문·최근 대화 허용을 토큰 경계 일치(NAS:..|숫자열)로. Reviewer 2차 재현 입력 전부 answer-format-t174.test.ts 에 시험 추가.
- [21:14] 편차: 「…참고용으로 보시기 바랍니다」처럼 Leader 목록에 없는 끝맺음은 내용으로 세어 문장이 보존됨(중복 수용) — 기존 시험의 기대를 그에 맞게 수정. 시험: typecheck exit 0, T-174 2파일, chat+llm jest, 경계 3종(base와 실패 이름 대조) — 결과·로그 ~/.node-local/t174-dev/*-r3.log.

## Reviewer
- [21:12] round-1 판정: conditional_pass(medium 3·low 4 — 티커 뒤 마침표로 허용 심볼 삭제, 쉼표 목록 낱말 붙음, 120자 혼합 문장 손실). 당시 bullet 이 Developer 작업 중 덮여 있어 요약만 복원. Leader 21:06·21:28·21:42 결정으로 수정됨.
- [21:12] round-2 독립 재감사(전체 diff): answer-format.ts, draft·messages route, package.json·lock. 재실행 typecheck exit 0(typecheck-r2.log), jest T-174 2파일+chat-routes-t169 3 suites 66 passed exit 0(jest-t174-r2.log), 적대 입력 ~/.node-local/t174-review/adv3.test.ts(adv3.log, exit 0). 쓰기·DB·LLM 호출 없음.
- [21:12] 확인된 수정: M1 `NAS:NVDA.`·`NAS:NVDA-미국` 허용 심볼 보존, `BRK.B` 유지. M2 `(A, 123456, B)` → `(A, B)`. 맨 6자리(`100000 이하`·`093000`·`202611`)는 괄호 밖이면 보존. 단위·쉼표·소수점 숫자 보존. 코드 펜스 안 보존(닫힌 펜스). 이력 허용: 이력에 `005931` 만 있으면 `005930` 은 허용 안 됨(정확 문자열 대조, 부분 문자열 포함은 관대 — 무해). 인자 없는 호출(3·4번째 모두, 또는 4번째만)은 입력 그대로 — 바이트 동일 확인. GET 표시 경로는 DISCLAIMER 상수를 쓰지 않아 불변. 정규식 비용: 4만자 공백·괄호 반복·200만자 이력까지 모두 5ms 이하.
- [21:12] R2-M1(Medium) 쉼표 없는 혼합 문장은 순수 고지로 오분류되어 분석이 사라진다. isPureDisclaimerSentence 가 쉼표가 있어야만 혼합으로 본다. 재현 finalizeNewChatAnswer("영업이익이 30% 늘었으나 검증된 전략 판정이 아니라 참고용입니다. 다음.") → 본문이 "다음." 만 남음(기대: 문장 보존). 한 줄 답 "검증된 전략 판정이 아니라 참고용입니다만 PER 12배 매력적, 결론 매수." → 전체가 실패 안내문으로 대체됨. Leader 21:42 원칙(정보 손실보다 중복)과 어긋남. 권고: 고지 구절 앞뒤에 내용(8자 이상)이 있으면 쉼표 유무와 무관하게 혼합으로 보고, 순수 판정은 고지 구절을 뺀 나머지가 8자 미만일 때만.
- [21:12] R2-M2(Medium) 고지가 앞에 오고 분석이 쉼표 뒤에 오는 문장도 지워진다. 재현 "검증된 전략 판정이 아니라 참고용이며, PER은 12배입니다. 다음." → "다음." 만 남음. 같은 원인(분류가 마지막 쉼표 앞만 봄). 같은 권고로 해결.
- [21:12] R2-L1(Low) 괄호 안 금액은 여전히 지워진다: "(목표가 100000 이하)" → "(목표가 이하)", "(2026년 202611 기준)" → "(2026년 기준)". 괄호 규칙의 의도된 잔여로 보이나 가격 삭제는 조용함. R2-L2(Low) "삼성전자, (123456), SK" → "삼성전자,, SK" (빈 괄호 정리가 앞뒤 쉼표를 합치지 않음). R2-L3(Low) 이력 허용은 과거 assistant 답에 지어진 코드도 허용해 버리고, 이력에 코드가 부분 문자열로만 있어도(1005930) 허용한다.
- [21:12] Critical·High 0건, Medium 2건(N2 분류 오류 한 곳), Low 3건. 안전장치(주문·한도·인증) 경로 변경 없음. R2-M1·M2 는 수정 후 재검토를 권하며, 영향이 답변 문장 손실에 한정되어 조건부로 판정한다.
- [21:12] round-2 판정: conditional_pass (scope: src/lib/chat/answer-format.ts, src/app/api/chat/threads/[id]/draft/route.ts, src/app/api/chat/threads/[id]/messages/route.ts, package.json, package-lock.json, src/lib/chat/__tests__/answer-format-t174.test.ts, src/lib/chat/__tests__/chat-routes-t174.test.ts)
- [21:15] round-3 독립 재감사(전체 diff). 재실행 typecheck exit 0(typecheck-r3.log), jest T-174 2파일+chat-routes-t169 3 suites 73 passed exit 0(jest-t174-r3.log), 적대 입력 adv4.test.ts exit 0(adv4.log) — 모두 ~/.node-local/t174-review/. 쓰기·DB·LLM 호출 없음.
- [21:15] 확인된 수정: R2-M1·M2 — 쉼표 없는 혼합 문장("영업이익이 30% 늘었으나 …참고용입니다. 다음.")·고지 앞선 혼합("…참고용이며, PER은 12배입니다.")·영문 혼합·8자리 숫자 혼합 모두 보존. 정식 고지·머리말/끝맺음 변형("다만, 이 시스템의 …입니다만", "단 …일 뿐입니다", "…으로 보세요")은 순수로 제거, 끝 줄 고지는 정확히 1번. 두 고지 절 문장은 순수면 제거, 사이에 내용이 있으면 보존. 사용자 원문 토큰 허용: "삼성전자 005930 어때"·"005930을 어떻게 봐?"·"(005930) 분석"·"종목005930분석" 모두 005930 보존, "nas:nvda" 대소문자 무시 보존, 이력 "005930" 토큰 허용, "0059301"은 불허(부분 일치 아님). 괄호 목록 항목 규칙: "(목표가 100000 이하)"·"(2026년 202611 기준)" 보존, "(NVIDIA, 210140)"·"삼성전자(005930, 000660)"·"(123456 , 654321 )" 는 제거. 인자 없는 호출은 입력 그대로(바이트 동일). 정규식 비용: 머리말 반복 2만 회·공백 5만자·이력 100만 토큰·쉼표 4만 개 모두 30ms 이하(분류기는 60자 이하 문장에만 호출됨).
- [21:15] R3-L1(Low) 내용 글자 8자 미만의 짧은 분석 절은 여전히 순수 고지로 보아 지워진다. "PER 12배, 검증된 전략 판정이 아니라 참고용입니다." (답이 이 한 줄이면 실패 안내문으로 대체), "ROE 15%이나 …참고용입니다."(7자) 도 동일. 다중 문장 답에서는 그 문장만 사라진다. 8자 기준의 의도된 한계이나 숫자 지표는 짧아서 손실 가능. 권고: 숫자가 들어 있으면 기준을 낮추거나 숫자 포함 문장은 혼합으로 간주.
- [21:15] R3-L2(Low) 괄호 안 목록의 금액이 목록 항목 규칙에 걸린다: "(매수가 90000, 100000) 이하" → "(매수가 90000) 이하". R3-L3(Low) 제거 후 쉼표 잔여: "삼성, (123456), SK, (654321) 비교" → "삼성, SK, 비교". R3-L4(Low) 규칙에 없는 끝맺음("…참고용으로 보시기 바랍니다")은 내용으로 세어져 고지가 두 번 보인다(Leader 가 수용한 쪽).
- [21:15] Critical·High·Medium 0건, Low 4건. 안전장치(주문·한도·인증) 경로 변경 없음, 버전 변경은 3곳뿐. 남은 Low 는 모두 질문 문구·답 문장의 사소한 손실/중복이라 출시를 막지 않는다.
- [21:15] **최종 판정: PASS (scope: src/lib/chat/answer-format.ts, src/app/api/chat/threads/[id]/draft/route.ts, src/app/api/chat/threads/[id]/messages/route.ts, package.json, package-lock.json, src/lib/chat/__tests__/answer-format-t174.test.ts, src/lib/chat/__tests__/chat-routes-t174.test.ts)**

## QA

- [21:19] QA 실행 도구 claude(qa). 대상 worktree ~/.node-local/stockinvest-t174 (base c62bc7a, 변경 5파일 + 신규 시험 2파일). DB 쓰기·LLM·KIS 호출·커밋·push 없음. 로그·산출물 ~/.node-local/t174-qa/.
- [21:19] 1 typecheck `npm run typecheck` exit 0 (01-typecheck.log, flock+nice).
- [21:19] 1 jest `src/lib/chat/__tests__` + `src/lib/llm/__tests__` 12 suites, 227 passed, exit 0 (02-jest-chat-llm.log). 신규 answer-format-t174·chat-routes-t174 PASS.
- [21:19] 1 경계 3종(profit-engine isolation·corp-intel isolation·currency-mixing-fence) 5 failed / 98 passed / 103, exit 1. 실패 테스트 이름 5개가 base 로그(t174-dev/jest-boundary-base.log)와 동일(03-boundary-failed-names*.txt diff 0). 신규 실패 0.
- [21:19] 1 build `npm run build` exit 0 (04-build.log).
- [21:19] 2 N1 실측(replay-out.json): 실제 drafter 원문 6건(r1 3건은 draft.head 사용 — r1 실행에 rawFull 미기록). 「엔비디아 어때?」 원문 `NVIDIA (NVIDIA, 210140)` → `NVIDIA (NVIDIA)`, 210140 만 제거·허용 NAS:NVDA 는 유지. 나머지 5건 무변경. 인자 없는 호출 6/6 base 와 바이트 동일.
- [21:19] 2 N2 실측: 질문 ③ 「삼성전자 지금 어때?」 답 — base 는 고지 2회(단락 안 1 + 끝 줄 1), new 는 1회(끝 줄만). 나머지 본문 문장 불변. 질문 ①·② 답은 고지 1회·base 와 동일.
- [21:19] 2 과거 JSON 답 15건(DB 원문, past-json-b64.tsv): new 와 base 의 normalizeNewChatAnswer 결과 15/15 동일, 고지 1회·끝 줄 15/15. 옛 파이프라인 출력 3건을 finalize 에 재투입하면 base 와 동일하게 끝 고지 앞에 빈 줄 1개가 추가됨(고지 1회 유지).
- [21:19] 2 운영 chat_messages id 44 (START TRANSACTION READ ONLY → ROLLBACK, SELECT 1건, 쓰기 0): 고지 1회·끝 줄 고지. finalize(new) 결과는 저장본과 바이트 동일하지 않음 — 끝 고지 앞 빈 줄 1개 추가(공백 제거 시 동일, 고지 1회). base 결과도 같아 이번 변경의 차이가 아님. 저장본은 건드리지 않음(finalize 는 저장 전 새 답에만 도는 경로).
- [21:19] 3 GET normalizeChatAnswer: 실제 답·drafter 샘플 18건 base 와 차이 0건, 과거 답 15건 차이 0건.
- [21:19] 판정 근거: Critical·High·Medium 0건. 두 route 호출부(draft/route.ts:96, messages/route.ts:165) 인자 전달은 코드 확인과 chat-routes-t174 시험으로 확인(실 HTTP 호출은 안 함).
- [21:19] 정리: base worktree 제거(node_modules 링크 unlink → git worktree remove → prune). 실 node_modules 링크 무변경.
- [21:19] NOT_VERIFIED: 전체 jest(chat·llm·경계 3종만 실행). 실 LLM·KIS 호출·라이브 route 호출. 실제 route 의 finalize opts(candidates·sourceTimes)와 history 는 기록에 없어 빈 값으로 재현 → 자료 기준 줄·상태 줄과 고지 제거의 상호작용 미검증. N1 은 실 출력 6건 중 1건에서만 재현(빈도 미확인). N2 실측 1건. 화면 검증 해당 없음(UI 변경 없음).
- [21:19] **QA 판정: PASS**

## Codex 검토

## 최종 요약
