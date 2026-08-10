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

## 영구 조치 — LaunchDaemon 시도 실패 → 원인 재규명 → cron 워치독으로 최종 해결 (2026-08-09 23:00~08-10 06:12)

사용자 확인 후 영구 조치를 진행했으나 예상과 다른 근본 원인이 추가로 드러나 여러 라운드 반복.

**1차 시도: `/Library/LaunchDaemons` 시스템 데몬 전환** — `sudo launchctl bootstrap system/...` 매번 `Bootstrap failed: 5: Input/output error`.
- 원인 A(확정·수정됨): `/Users/brownjeon` 홈 디렉토리가 `drwxr-x---`(750)라 root가 "other"로 취급돼 그 아래 NFS 경로를 아예 통과(traverse)하지 못함 → `chmod o+x /Users/brownjeon`로 해결(사용자 소유라 sudo 불필요, 목록조회 권한은 그대로 막아둠).
- 이후 `last exit code = 78: EX_CONFIG`로 진행은 됐으나 여전히 실패, 로그 파일 0바이트(프로세스가 아예 시작 안 됨을 시사).

**2차 시도: 셔뱅 스크립트 대신 `python3.14` 바이너리 직접 호출** — 동일하게 `EX_CONFIG(78)`. NFS 경로 자체(exec 대상이든 아니든)에 launchd가 접근하는 것 자체가 문제라는 정황.

**3차 시도: `/bin/zsh -c 'cd ... && exec ...'` 래퍼로 launchd의 직접 검증 대상을 로컬 바이너리로 우회** — 처음으로 `exit code 1`(EX_CONFIG 아님) + 실제 에러 메시지 확보: `zsh:1: operation not permitted: logs/stdout.log`. **NFS 쓰기가 launchd 컨텍스트에서 EPERM.**

**분기점 — 사용자 이의 제기**: "포트 확인은 했냐"는 질문에 확인(8001 비어있음, 문제 아님) — 동시에 반복되는 실패 패턴에 대한 정당한 문제제기였고, 이후 접근을 단순화하는 계기가 됨.

**4차: launchd 대신 이미 이 맥미니에 실사용 중인 cron으로 전환** — `crontab`에 매분 헬스체크→재기동 워치독 스크립트 추가(기존 데일리리포트 잡은 보존). **그런데 cron 컨텍스트에서도 동일하게 NFS 쓰기가 EPERM.** 로그를 로컬(`/tmp`)로 돌려서 재확인한 결과, 이번엔 **쓰기가 아니라 읽기**(`.venv/pyvenv.cfg` 읽기)에서도 EPERM 확인 — `PermissionError: [Errno 1] Operation not permitted: '.../home-m4-api/.venv/pyvenv.cfg'`, `Fatal Python error: init_import_site`.

**근본 원인 확정**: 세션 없는(session-less) 백그라운드 프로세스(launchd LaunchDaemon이든 cron이든 동일)는 이 NFS 마운트(`/Users/brownjeon/NFS/...`, `/etc/fstab` 아닌 수동 마운트)에 대해 **읽기·쓰기 모두 EPERM**을 받는다. 반대로 SSH 대화형 세션(및 그 안에서의 `sudo -u brownjeon`)은 동일 경로에서 항상 완전히 정상 동작(수십 회 재현). 이는 Unix 퍼미션 비트 문제가 아니라(전부 777 확인됨) macOS TCC/세션 기반 네트워크 볼륨 접근 제어로 추정 — 정확한 TCC 메커니즘까지는 미확인(추가 조사는 범위 밖).

**최종 해결(우회, 채택)**: NFS와 아예 씨름하지 않는다. `.venv`(802MB) + `app/` + `data/` 등 실행에 필요한 파일 전체를 **로컬 디스크**(`/Users/brownjeon/home-m4-api-run`, rsync)로 복사하고, cron 워치독이 이 로컬 사본에서 프로세스를 기동하도록 변경. `.env`는 원래도 로컬(`/Users/brownjeon/services/home-m4-api/.env`) 심볼릭 링크라 그대로 유지됨.

**검증**: cron이 자동으로 로컬 사본 기동(수동 개입 없음) → `/health` 200 → 실제 호출 경로(`/v1/chat`)로 HTTP 200 재현 → 2회 cron 주기(약 65초×2) 동안 재기동 로그 증가 없이 `health=200` 유지·프로세스 1개 안정 확인(플래핑 없음).

## 남은 정리(선택, 급하지 않음)

- 실패한 `/Library/LaunchDaemons/com.miraclepenguin.ai-api.plist`가 여전히 등록돼 있어 백그라운드에서 계속 실패·재시도 중(무해하나 리소스·로그 낭비). `sudo launchctl bootout system/com.miraclepenguin.ai-api && sudo rm /Library/LaunchDaemons/com.miraclepenguin.ai-api.plist`로 정리 권장(사용자 여유될 때, sudo 필요).
- 이제 코드 소스(NFS, git 관리)와 실행 사본(로컬)이 분리됐다 — **향후 home-m4-api 코드를 수정·배포하면 로컬 사본을 다시 rsync해야 반영된다.** 배포 스크립트에 편입하는 개선은 home-m4-api 프로젝트 소관, 이번 범위 밖.
- `qdrant_client` "Collection already exists" 409 트레이스백이 기동 로그에 매번 찍힘(무해, idempotency 처리 안 된 기존 앱 코드 결함으로 추정) — home-m4-api 프로젝트에서 별도 정리 권장.

## 최종 요약 (사용자용)

즐겨찾기 "재무 갱신"이 안 되던 원인은 AI 호출이 나가는 맥미니 M4 게이트웨이(`192.168.219.163:8001`)가 최소 3주 이상 꺼져 있었던 것이었습니다. StockInvest 코드는 문제 없었습니다.

**진짜 근본 원인은 예상보다 훨씬 미묘했습니다**: 이 서비스가 있는 폴더가 NFS(네트워크 공유 폴더)인데, macOS에서 **로그인 세션이 없는 백그라운드 프로세스(자동 재시작 담당자, launchd든 cron이든)는 이 NFS 폴더를 읽지도 쓰지도 못하는** 제약이 있었습니다. 반대로 사람이 터미널로 접속해서 실행하면 항상 멀쩡히 됐습니다 — 그래서 "분명 되는데 자동재시작만 안 되는" 혼란스러운 상황이 반복됐습니다(LaunchDaemon 전환 시도 중 홈 디렉토리 권한 문제도 하나 발견해서 같이 고쳤지만, 그건 진짜 원인이 아니었습니다).

최종적으로는 이 제약과 싸우는 대신 **실행에 필요한 파일을 로컬 디스크에 통째로 복사**해두고, 1분마다 상태를 확인해서 죽어있으면 로컬 사본에서 재시작하는 방식(cron)으로 우회했습니다. 이제 맥미니가 재부팅되거나 프로세스가 다시 죽어도 최대 1분 안에 자동으로 복구됩니다(실제로 두 번의 재시작 주기 동안 안정적으로 유지되는 것까지 확인했습니다).

StockInvest 쪽 코드는 이번에도 변경 없습니다. 남은 건 실패한 LaunchDaemon 등록 정리(선택, 급하지 않음) 정도이고, 이건 원하시면 나중에 sudo로 간단히 지우시면 됩니다.
