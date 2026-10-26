---
task_id: T-038
title: Hybrid 모드에서 M4 API 주소를 볼 수도 고칠 수도 없다 — 1단계 AI 필터가 죽은 주소(163:8001)를 호출 중
status: todo
waiting: [보류 — 화면·알림 후속(요구 1·2·4)은 사용자 10-26 "권고대로" 보류, 즉시 복구(요구 3)는 완료]
roles_involved: [leader, developer, reviewer, qa]
related_tasks: [T-037]
tags:
  - type/task
  - domain/llm
  - domain/settings
aliases:
  - LLM 주소 설정
  - home_m4_api_base 옛 주소
created: 2026-09-22
updated: 2026-10-26
---

## 배경 (사용자 요청, 2026-09-22)

> "LLM 설정에 대하여 주식매매 설정화면에는 모델과 timeout 에 대한 설정이 있고 주소에 대한 설정은 없어.
> 이건 수정작업을 할 수 있도록 작업절차서 작성해서 주식매매 세션을 생성해서 작업할 수 있도록 준비해줘"

발견 경위: 워크스페이스 세션(TheCareerMng 작업 중)에서 M4 게이트웨이 API 키 레지스트리를 점검하다가
StockInvest `AI_API_KEY` 가 게이트웨이에 **미등록(401)** 인 것을 확인해 09-22 재발급·재배포(11:49)했고,
그 검증 과정에서 이 문제가 드러났다. 키 재발급 경위는 워크스페이스 메모리 `project_home_m4_api.md` 참고.

## 사실 (Leader 사전 조사 — 09-22 11:5x, 전부 읽기 전용으로 실측)

1. **DB `system_config` 값** (운영 DB 직접 SELECT):
   `llm_provider="hybrid"` · `home_m4_api_base="http://192.168.219.163:8001"` · `home_m4_api_model`/`stage1_model="qwen2.5:14b-instruct"` · `rag_enabled="true"`
2. **그 주소는 죽었다**: `curl http://192.168.219.163:8001/health` → 응답 없음(000), `…163:8000` 도 000.
   살아 있는 게이트웨이는 `http://192.168.219.100:8000`(`/health` 200). 08-19 M4 IP 이전(163→100)·포트 표준화(8000) 때 DB 값이 따라오지 않았다.
3. **우선순위**: `src/lib/llm/provider.ts` — "DB system_config > env > 기본값". `.env` 의 `AI_API_BASE`(=.100:8000) 는 **DB 값이 있으면 무시**된다.
4. **hybrid 1단계가 그 DB 주소를 쓴다**: `buildCaller()` hybrid·stage 1 → `new HomeM4ApiCaller(cfg.homeM4ApiBase ?? '…100:8000', AI_API_KEY, …)`.
   → 08-19 이후 **1단계 AI 필터가 매번 실패** → `ai-filter-stage1.ts` 주석대로 "throw → 호출자가 legacy single-stage 로 fallback". 로그 `errors: [ 'ai_fail:fetch failed' ]`.
   즉 사용자가 [권장] 으로 고른 hybrid 가 실제로는 한 달 넘게 legacy 로 돌고 있었다.
5. **화면이 그 주소를 숨긴다**: `src/app/settings/LlmProviderSection.tsx:197` — `API Base URL` 입력칸은 `provider === 'home-m4-api'` 일 때만 렌더링.
   hybrid 세부 설정(L223~)에는 Stage 1 모델·Timeout 만 있다. 연결 테스트도 "home-m4-api 만 지원"(L106).
   API(`POST /api/settings/llm-provider`)는 `homeM4ApiBase` 를 이미 받는다 — **막힌 것은 화면뿐**.
6. RAG(`src/lib/rag/m4-kb.ts`)는 DB 가 아니라 env `AI_API_BASE` 를 쓴다 → 09-22 키 재발급으로 RAG 는 복구됐다(재기동 전엔 시그널마다 `rag-upsert … 401`).
7. TradingInvest 도 같은 구조(`home_m4_api_base=163:8000`)지만 **프로젝트 비활성**이라 범위 밖.

## 해결 방향 (Leader 제안 — 세션에서 확정)

1. **화면**: hybrid 세부 설정에 `M4 API Base URL` 칸을 노출한다(home-m4-api 와 **같은 필드** `homeM4ApiBase` 공유 — 값이 두 곳으로 갈라지지 않게).
   placeholder/hint 는 `.env AI_API_BASE` 값. 현재 저장값이 env 와 다르면 그 사실을 표시.
2. **연결 테스트**를 hybrid 에서도 허용 — 대상은 Stage 1 이 실제로 부를 `homeM4ApiBase`. 저장 전에 `/health` 또는 짧은 chat 으로 검증해, **죽은 주소를 저장하지 못하게**(최소한 경고) 한다.
3. **즉시 복구**: `home_m4_api_base` 를 `http://192.168.219.100:8000` 으로. 새 화면 배포 후 화면에서 저장하는 것이 정석(감사 로그·검증 경로를 탄다). DB 직접 수정은 사용자 승인 사항.
4. (선택) 운영 관측: Stage 1 이 연속 실패하면 1회 알림(`sendAlertThrottled`) — "hybrid 가 조용히 legacy 로 떨어진" 상태가 한 달간 아무에게도 안 보였다는 게 이번 건의 본질.

## ⚠️ 적용 시 주의 (협상 불가)

- **Stage 1 이 살아나면 매매 판단 경로가 바뀐다**(legacy single-stage → hybrid: pass/reject 는 Stage 2 를 건너뜀). 사용자가 원래 의도한 모드로 돌아가는 것이지만, **주소 변경·재기동은 장 마감(15:30) 이후**, 사용자 확인 후.
- `src/app/api/settings/**`·`src/lib/llm/**`·`src/lib/strategy/**` 는 `SAFETY_PATHS`(매매 설정·시그널 발화) — Reviewer 게이트 대상. 목록: `awk '/^SAFETY_PATHS=\(/,/^\)/' scripts/git-hooks/commit-msg`.
- 배포는 `scripts/deploy.sh StockInvest` 한 경로. 우분투 세션에서도 같은 명령이 로컬로 돈다(09-21 `deploy.sh` 로컬 실행 분기) — 단 **에이전트의 운영 배포 실행은 auto 모드 분류기가 막으므로 사용자가 직접 실행**한다.
- 배포는 앱을 **두 번 기동**한다(`release.sh` 의 `startOrReload` → `ensure_current_cwd` 의 delete+start). 기동 직후 알림이 중복될 수 있다 — [[T-039-alert-dup-and-telegram-timeout]].

## 검증 체크리스트 (QA)

- [ ] provider=hybrid 에서 `M4 API Base URL` 칸이 보이고 현재 DB 값(`163:8001`)이 표시된다
- [ ] 죽은 주소로 연결 테스트 → 실패 표시, 살아 있는 `.100:8000` → 성공
- [ ] 저장 후 `system_config.home_m4_api_base` 갱신(SELECT 로 확인), home-m4-api 모드로 바꿔도 같은 값
- [ ] 재기동 후 strategy-eval 로그에서 `ai_fail:fetch failed` 가 사라지고 Stage 1 verdict(pass/reject/escalate) 통계가 찍힌다
- [ ] M4 게이트웨이 사용량(새 stockinvest 키)이 증가한다 — 관리자 `GET /admin/usage/<key>`

## Leader 기록

- **2026-10-26 16:29 상태 정리(T-083 R01 후속)** — 사용자 발화 그대로: "2. T-042·T-044 상태는 권고대로 진행해줘 / 3. T-038, T-039도 권고대로 진행해줘"(10-26 16:29 이전, T-083 `## Leader 기록` 4개 task 대조표의 권고에 대한 답). **완료와 미완을 분리해 기록한다.** ✅ 완료: 요구 3 "즉시 복구" — DB `system_config.home_m4_api_base` 가 이미 `http://192.168.219.100:8000` 로 교체됨(updated_at 2026-10-11 18:13:21; 누가·어떤 승인으로 바꿨는지는 이 task 에 기록 없음 [확인 못 함]). ⏸ 미완·**보류**: 요구 1·2 설정 화면 — `LlmProviderSection.tsx` 의 `API Base URL` 칸은 `provider === 'home-m4-api'` 일 때만(L197), 연결 테스트도 home-m4-api 만(L106), hybrid 에서 주소를 보거나 고칠 수 없다. 요구 4(조용히 legacy 로 떨어진 상태 알림)도 보류. 재개 조건: M4 주소가 다시 바뀌어 hybrid 1단계가 죽을 때 또는 사용자 지시. 근거: [[T-083-s00-follow-up-hygiene]] 대조표. frontmatter `status` 는 todo 로 두고 `waiting` 에 보류 사유를 적었다.


- [09-22] 워크스페이스 세션이 사실 조사·작업서 작성. 코드·DB 변경 없음.

## Developer

## Reviewer

## QA

## 최종 요약 (사용자용)
