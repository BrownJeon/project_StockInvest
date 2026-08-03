---
project: StockInvest
updated: 2026-08-03
tags:
  - type/context
aliases:
  - 이어서 작업
  - RESUME
---

# ▶ 이어서 작업 — 재개 진입점

> 사용자가 **"이어서 작업해줘"** 라고 하면 이 파일부터 읽고, 아래 "다음 할 일"의 1번부터 진행한다.
> 다른 PC에서 재개할 수 있으므로 **모든 맥락은 이 vault 안에 있다** (세션 메모리·플랜 파일에 의존하지 말 것).

## 한 줄 요약

시그널이 안 나오고 수익도 없어 방치된 자동매매 앱을 재구성 중이다. **진짜 원인은 DB 스키마 불일치(제1사인)였고 그 수정은 이미 코드에 들어갔다.** Phase 1(관측 + 시그널 소생 핫픽스)은 **구현·검증 완료, 배포만 남았다.**

## 현재 상태 (2026-08-03 기준)

| 항목 | 상태 |
|---|---|
| 원인 분석 | ✅ 완료 (운영 DB 실측 포함) — [[2026-08-02-restructure-plan]] |
| 재구성 설계 | ✅ 완료 (Phase 0~5) — [[2026-08-02-restructure-plan]] |
| Phase 0 안전 기반 | 🟡 developer 완료 / **reviewer 재검증 미완 · QA 미실시** — [[T-001-phase0-safety-foundation]] |
| Phase 1 관측+핫픽스 | ✅ **구현·독립 reviewer 감사·typecheck·테스트(40 suites/410건) 전항 완료. 배포(커밋·push) 대기 중** — [[T-002-phase1-eval-funnel]] |
| Phase 2 파이프라인 수술 | ⬜ analyst 사양 완료, 구현 대기 — [[T-003-phase2-pipeline-redesign]] |
| 운영 서버 | ✅ 가동 중이나 **워킹트리의 오늘자 수정은 미반영** (운영은 여전히 이전 코드로 서빙) |

## 다음 할 일 (이 순서대로)

### 1. 배포 승인 받기 — 최우선

오늘 세션에서 Phase 1 잔여 구현을 전부 끝냈고 typecheck·테스트·독립 reviewer 감사까지 통과했지만, **커밋·push는 사용자 승인 없이 하지 않는다** (push = Gitea Actions 자동배포). 사용자에게 배포 여부를 확인하고, 승인되면:

```bash
git -c core.fileMode=false status   # 실변경 파일만 확인
git add <실제 변경된 파일들>
git commit -m "..."
git push
```

**배포 직후 `stockinvest-cron` 프로세스도 수동 재시작해야 한다** — `deploy.yml`이 `pm2 reload stockinvest`만 수행하므로 cron 프로세스는 옛 코드로 계속 남는다.

```bash
pm2 restart stockinvest-cron --update-env
```

### 2. 장중 실측 — 오늘 고친 것들이 실제로 반영됐는지 확인 (배포 후 개장 중)

```bash
mysql -h <NAS_HOST> -u <USER> -p stockinvest -e "
SELECT stage, reason, COUNT(*) FROM eval_funnel WHERE gate='final' AND ts >= CURDATE() GROUP BY stage, reason ORDER BY 3 DESC LIMIT 20;
SELECT status, COUNT(*) FROM signals WHERE created_at >= CURDATE() GROUP BY status;
"
```

- `final` 행의 `stage`가 더 이상 전부 0이 아니어야 한다 (오늘 고친 핵심 버그) — reason별로 stage가 4/5/7/8/9/10/99 등으로 다양하게 찍혀야 정상.
- `strategy_unregistered` verdict가 post-market 3종(`eod-high-close-v1`/`inside-bar-v1`/`oversold-bounce-daily-v1`)에 대해 더 이상 `error`가 아니라 `skip`이어야 한다.
- 대시보드 "오늘의 평가 깔때기" 카드와 trade-report 메시지(강제 발송 `POST /api/cron/trade-report?force=1`)가 실데이터로 정상 렌더되는지 눈으로 확인.

### 3. Phase 0 마무리
- reviewer 최종 재검증(next 14.2.35 반영분) → QA
- QA 체크리스트에 **배포 후 `x-middleware-subrequest` 헤더로 CVE 차단 확인** 포함할 것 (로컬에서는 검증 불가, lock만 갱신된 상태)

### 4. Phase 2 착수 — [[T-003-phase2-pipeline-redesign]]
Phase 1 관측 데이터 3영업일 확보 후(배포일 기준 재기산). 게이트 50→26 재편, 스위치 의미 분리, 장중 AI 제거, 룰 파라미터 재도출(RSI 35→38 등).

### (낮은 우선순위) `oversold-bounce-daily-v1` strategy_id 드리프트
2026-08-03 reviewer 감사 중 발견한 **기존(pre-existing) 버그**: `post-market-engine.ts`가 시그널 생성 시 `strategy_id`를 `oversold-bounce-v1`로 쓰는데 `strategies.id`는 `oversold-bounce-daily-v1`이라 `signals ⋈ strategies` 조인 기반 통계에서 이 전략만 영구 누락된다. Phase 1 범위 밖 — Phase 2나 별도 task로.

## 반드시 지킬 제약

- **git commit/push 금지** — push가 곧 운영 배포다(Gitea Actions가 `git reset --hard` → `npm ci` → build → `pm2 reload stockinvest`). 커밋은 사용자 승인 후.
- **커밋은 리눅스 호스트에서** — Windows에서 NAS를 SMB 마운트해 작업하면 파일 권한 비트가 다수 파일에서 바뀐 것으로 잡히고 `public/mockups` 심볼릭 링크가 삭제로 표시된다. `git -c core.fileMode=false status`로 실변경만 볼 수 있다.
- **`npm install`을 Windows에서 실행 금지** — node_modules가 리눅스 바이너리 트리라 SWC 바이너리가 교체되어 운영이 깨진다. 패키지 변경이 필요하면 `npm install --package-lock-only --save-exact`로 lock만 갱신하고 실제 설치는 배포 `npm ci`에 맡긴다.
- **빌드 시 `.next` 오염 주의** — 이 작업 경로(NFS)가 운영 배포 경로 그 자체다. **검증은 `npm run typecheck` + `npm test`만 사용하고 `npm run build`는 실행하지 않는다** (실행하면 pm2가 서빙 중인 `.next`를 덮어씀). 정말 빌드 검증이 필요하면 `distDir`을 임시 오버라이드해 격리하고 끝나면 원복·삭제한다.
- **DB는 운영 MariaDB** — 파괴적 SQL 금지. 스키마 변경은 `src/lib/db.ts` 코드로만(부팅 시 idempotent). 조회는 SELECT만.
- Windows에서 git은 dubious ownership 에러가 난다: `git -c safe.directory='%(prefix)///brownjeon_nas/homes/brownjeon/project/StockInvest' <cmd>` 형태로 일회성 지정(글로벌 config 변경 금지).
- **배포 시 cron 프로세스도 재시작해야 한다** — `deploy.yml`이 `pm2 reload stockinvest`만 하므로 `stockinvest-cron`은 옛 코드로 남는다.

## 미해결 이상징후 (확인 필요)

1. **재시작 315회** — `stockinvest` 누적 재시작이 315회(tradinginvest도 171회). 원인 불명. `pm2 logs stockinvest --err --lines 60 --nostream`으로 확인.
2. **AI 게이트웨이 다운** — `.env`의 `AI_API_BASE`(192.168.219.163:8001, 맥미니 M4)에 연결 실패가 err.log에 기록됨. RAG 검색·hybrid stage1이 무력화된다. `curl -sS -m 5 http://192.168.219.163:8001/health`로 확인.
3. **`undici` 빌드 실패 이력** — 초기 커밋부터 package.json 미선언인데 `telegram.ts`가 import했다. 제거로 해결했으나, 그 사이 CI가 계속 실패해 왔을 가능성이 있다.

## 오늘(2026-08-03) 세션에서 한 일

[[T-002-phase1-eval-funnel]] "최종 요약" 절 참조 — Phase 1 잔여 구현 전항 완료(H2 테스트, H3/H4 검증, 대시보드 카드, trade-report 요약) + 세션 중 신규 발견 결함 2건 수정(stage 8/9/10 계측 공백, `createSignal` 무보호 호출 — 후자는 안전 관련) + 독립 reviewer 감사 통과.

## 개선 메모 (Phase 2에서)

- `AUTH_PIN`이 로그인 PIN과 세션 쿠키 HMAC 서명 키를 **겸하고 있다.** 짧은 PIN을 쓰면 쿠키 하나로 오프라인 키 복원이 가능하고, PIN 교체 시 전 세션이 무효화된다. `AUTH_SESSION_SECRET`을 분리할 것. (현재는 긴 무작위 문자열을 PIN으로 써서 우회)
