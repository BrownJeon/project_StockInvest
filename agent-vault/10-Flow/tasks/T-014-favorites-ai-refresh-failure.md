---
task-id: T-014
project: StockInvest
created: 2026-08-09
updated: 2026-08-09
status: done
tags:
  - type/task
  - domain/infra
  - domain/ai
aliases:
  - 재무갱신 AI 분석실패
  - favorites AI analysis failure
related_tasks: []
---

# T-014 · 즐겨찾기 "재무 갱신" 클릭 시 AI 분석실패

## 목표 (Leader 작성)

사용자 신고: 즐겨찾기 메뉴에서 "재무 갱신" 클릭 시 AI 분석실패 발생. 원인 확인 후 수정.

## 조사 (Leader, 읽기전용 → 원인 확정 후 인프라 조치)

1. **UI 흐름 확인**: `FavoritesPage.tsx`/`FavoriteDetailPage.tsx`의 `refreshFundamentals()` → `DELETE /api/fundamentals/[symbol]`(캐시 삭제) → `GET /api/fundamentals/[symbol]`("AI 분석 중" 단계). `json.ok===false`면 `분석 실패 (${json.error})` 표시.
2. **API 경로 확인**: `src/app/api/fundamentals/[symbol]/route.ts` → `fetchFromClaude()` → `runLlm()`(`src/lib/llm/provider.ts`) 호출. AI 실패 시 캐시 있으면 캐시 반환, 없으면 `{ok:false, error:'claude_unavailable'}`.
3. **운영 로그 실측**(`/home/brownjeon/.node-local/stockinvest/logs/pm2-err.log`): 최근(2026-08-09 16:17 / 18:02 / 18:02:46 / 22:24:58) `[fundamentals] Claude parse error: TypeError: fetch failed` 반복 확인. 과거(7월) 로그의 `claude exit 143`(claude CLI 중첩실행 감지)와는 **다른 유형** — `fetch failed`는 HTTP 레벨 네트워크 실패.
4. **provider 설정 확인**: `.env`의 `LLM_PROVIDER=home-m4-api`, `AI_API_BASE=http://192.168.219.163:8001` → `HomeM4ApiCaller`(fetch 기반, `src/lib/llm/home-m4-api.ts`)가 실제 호출자.
5. **네트워크 실측**: `192.168.219.163`(맥미니 M4)는 ping 정상(같은 LAN, ~1ms) — **호스트는 살아있음**. `curl :8001/health` → `Connection refused`(타임아웃이 아니라 즉시 거부) = **해당 포트에 리스닝 프로세스 자체가 없음**, 네트워크 장애가 아니라 서비스 다운.
6. **맥미니 M4 원격 확인**(SSH, 홈서버 관리 권한 범위): `launchctl list`에 `com.miraclepenguin.ai-api`(LaunchAgent, `~/Library/LaunchAgents/`) **미등록**. `ollama serve`(포트 11434)는 정상 기동 중 — Ollama 자체는 살아있고, 그 위의 FastAPI 게이트웨이만 죽어있었음.
7. **로그 mtime**: `home-m4-api/logs/stderr.log` 마지막 수정 **7월 16일** — 최소 3주 이상 이 게이트웨이가 죽어 있었던 것으로 추정(StockInvest 외 다른 프로젝트의 AI 기능도 같은 기간 조용히 영향받았을 가능성 — [[project_home_m4_api]] 메모의 "AI 게이트웨이 다운" 미해결 이상징후와 일치).
8. **재기동 시도**: `launchctl load`/`bootstrap gui/501/...` 전부 `"Domain does not support specified action"`(에러 125) — **맥미니에 GUI 로그인 세션이 없어 per-user LaunchAgent(`gui/<uid>` 도메인)를 launchd가 관리할 수 없는 상태**. `KeepAlive:true`가 있어도 애초에 로드가 안 되니 무의미했음. 직전 정상 기동 로그(마지막 실행분)를 보면 `AnimateDiffPipeline`(비디오 생성) 요청 2건을 연속 처리(각 7분·6.75분) 후 `Shutting down`으로 정상 종료된 흔적 — 그 이후 재기동되지 않은 채 방치된 것으로 보임(원인 불명: 재부팅으로 GUI 세션이 끊겼거나, 누군가 수동 종료 후 재기동을 잊었을 가능성).

## 조치 (Leader)

- **즉시 복구**: SSH로 `.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8001 --workers 1`을 `nohup … & disown`으로 수동 기동(2026-08-09 22시경). `curl :8001/health` → `{"status":"ok"}` 정상 확인.
- **실사용 경로와 동일한 방식으로 검증**: `.env`의 실제 `AI_API_KEY`로 `HomeM4ApiCaller`와 동일한 요청(`POST /v1/chat`, 동일 헤더·바디 형식)을 보내 **HTTP 200 + 정상 JSON 응답** 확인 — StockInvest 코드 변경 없이 원인(게이트웨이 다운)만 해소하면 기능이 복구됨을 실측으로 증명.
- StockInvest 측 코드는 **변경 없음** — 문제가 애플리케이션 로직이 아니라 외부 인프라(다른 프로젝트가 소유한 공용 AI 게이트웨이)였기 때문. `runLlm()`의 재시도 로직(`fetch failed`는 이미 retriable 패턴에 포함)·에러 처리·프론트엔드 실패 표시는 전부 의도대로 정상 동작하고 있었음.

## ⚠️ 이번 조치의 한계 — 사용자 확인 필요

지금 살려놓은 프로세스는 **launchd 관리 밖의 수동 기동**이라 아래 상황에서 다시 죽으면 **아무도 자동으로 재기동하지 않는다**:
- 맥미니 재부팅
- 프로세스 크래시(예: 조사 중 발견한 것처럼 무거운 비디오 생성 요청 처리 후 다운되는 패턴이 반복될 가능성)

**근본 원인**은 `com.miraclepenguin.ai-api`가 `~/Library/LaunchAgents`(GUI 세션 필요한 per-user LaunchAgent)로 등록돼 있는데 맥미니에 GUI 로그인 세션이 없다는 것. 영구 해결책 후보:
1. 맥미니에 자동 로그인(GUI) 설정 — LaunchAgent가 부팅 시 자연히 로드되게
2. `/Library/LaunchDaemons`의 시스템 LaunchDaemon으로 전환(로그인 불필요, `sudo` 필요, 여러 프로젝트가 공유하는 게이트웨이라 홈서버/home-m4-api 프로젝트 소관)

둘 다 맥미니에 `sudo`/시스템 설정 변경이 필요하거나 이 세션의 관할(StockInvest 팀)을 벗어나는 인프라 결정이라 **직접 진행하지 않고 사용자 확인만 받아둠**. [[project_home_m4_api]]에 짧게 크로스노트 남김.

## 최종 요약 (사용자용)

즐겨찾기 "재무 갱신" 버튼을 누르면 AI가 재무 데이터를 분석해주는데, 이 AI 호출이 나가는 곳(맥미니 M4의 AI 게이트웨이, `192.168.219.163:8001`)이 **최소 3주 이상 꺼져 있었습니다.** StockInvest 코드 자체는 문제가 없었고 — 실패를 감지해서 "분석 실패"로 정직하게 보여주는 것까지는 의도대로 동작하고 있었습니다.

원인은 그 게이트웨이가 맥미니의 "로그인된 사람이 있어야만 도는" 방식(LaunchAgent)으로 등록돼 있는데, 지금 맥미니에 아무도 GUI로 로그인해 있지 않아서 자동 재시작이 아예 안 걸리는 상태였습니다. 지난번(7/16 로그 기준) 무거운 비디오 생성 요청을 처리한 뒤 꺼진 뒤로 계속 이 상태였던 것으로 보입니다.

지금은 SSH로 직접 프로세스를 살려서 **재무 갱신 기능이 정상 복구됐습니다**(실제 호출 경로로 재현 테스트 완료). 다만 이건 임시조치라 맥미니가 재부팅되거나 이 프로세스가 다시 죽으면 똑같은 문제가 재발합니다. 영구적으로 고치려면 맥미니 자동로그인 설정 또는 시스템 서비스(sudo 필요) 전환이 필요한데, 이건 홈서버/맥미니 쪽 인프라 결정이라 사용자 확인 후 진행하는 게 맞다고 판단해 지금은 건드리지 않았습니다.
