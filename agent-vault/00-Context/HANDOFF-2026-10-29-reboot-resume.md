---
project: StockInvest
updated: 2026-10-29
tags:
  - type/context
aliases:
  - 재기동 후 재개
  - HANDOFF-2026-10-29
---

# 재개 인수인계 — 2026-10-29 05:1x (사용자 PC 업데이트·재기동 직전)

> 이 문서는 서버 재기동으로 세션·서브에이전트·세션 전용 예약(CronCreate)이 모두 사라질 것에 대비한 **재개 진입점**이다. "StockInvest 작업 이어서 진행해줘"라고 하면 이 문서부터 읽고, 읽은 값은 확인 시각을 밝히고 다시 확인한다(운영 상태 값은 낡는다).

## 0. 가장 먼저 (재기동 직후)

1. `date`·`uptime`·`pm2 list`(두 앱 online·`stockinvest-cron` 정확히 1개)·`curl -s -o /dev/null -w '%{http_code}' http://localhost:3003/api/health` — 재부팅 직후 NFS가 늦게 올라오면 pm2 재시작이 몰려 ↺ 숫자가 크게 보일 수 있다(10-29 04:43 재부팅 때 `stockinvest-cron` ↺ 1865).
2. 읽기 전용 DB 도구: `python3 -I ~/.node-local/tools/dbq.py -e "SELECT …"` (SELECT/SHOW 만, 쓰기는 `DBQ_ALLOW_WRITE=1` + 사용자 승인). **스크래치패드의 옛 도구는 재부팅 때 사라졌다.**
3. 킬스위치 ON·최근 3시간 주문 0건 재확인(`system_config.safety_kill_switch`, `orders`). 건드리지 않는다.
4. **서버 부하 규칙(필수)**: 10-28 23:49 서버 정지 사고(아래 §1) 때문에 무거운 명령(`npx jest`·`npx tsc`·`bash scripts/test-*.sh`)은 전부 `flock /tmp/stockinvest-heavy-tests.lock nice -n 10 <명령>` 으로 **한 번에 하나만**, jest 는 `--maxWorkers=3`·관련 폴더만. 병렬 에이전트 브리프에 이 규칙을 넣는다. `cat /proc/loadavg` 가 18(코어 12×1.5) 이상이면 새 시험을 시작하지 않는다.

## 1. 사고 기록 (10-28 23:49 ~ 10-29 04:43)

서버가 23:49:13 에 통째로 멈췄다(저널 끊김, OOM·커널 오류 기록 없음) 04:43 에 재부팅. 약 4시간 54분 동안 **모든 pm2 앱(타 프로젝트 포함)과 StockInvest 크론 러너가 내려가 있었다** — stop-alert(미국 보유 종목 손절 알림)·holding-checker·portfolio-snapshot·02:00 뉴스 peek(최초 관측 증거 영구 누락)·03:00 학습 데이터 내보내기 누락. 킬스위치 ON·주문 0건·자동 청산 스위치 OFF 라 매매 피해 없음. **원인은 확정 아님[추측]**: 정지 직전 10분간 에이전트 3개가 jest(워커 최대 11개씩)·tsc·러너 시험을 동시에 돌렸고, worktree 의 `node_modules` 가 NFS 의 메인 트리를 가리키는 심볼릭 링크라 NFS I/O 가 막혔을 가능성. 대책: 위 flock 직렬화(적용됨), `node_modules` 로컬 복사는 사용자 결정 대기. 메모리 `feedback_parallel_agent_test_load.md`.

## 2. 진행 중 작업 표 (격리 worktree `~/.node-local/stockinvest-t117|t118|t119`, 모두 미커밋)

| task | 상태 (05:1x) | 남은 순서 |
|---|---|---|
| **T-117** 일봉 정기 수집 크론(R13, 07:40~07:54) | Developer 완료(+H-1 수정: `src/lib/profit-engine/__tests__/isolation.test.ts` 긍정 단언 4개) · Reviewer 1차 **FAIL**(H-1) → 수정 후 **재검증 진행 중**(새 판정 줄 대기) · 변경 5개 파일 | ① Reviewer 새 판정 줄(scope: `scripts/cron-runner.sh`, `scripts/test-cron-runner-daily-bars.sh`, `scripts/test-cron-runner-news-split.sh`, `scripts/test-cron-runner-news-peek.sh`, `src/lib/profit-engine/__tests__/isolation.test.ts`) ② judge C2: `node ~/NFS/homes/brownjeon/project/.claude/tools/jev-judge/judge.mjs --input <json>` — 입력 JSON 초안은 `/tmp/claude-1000/-home-brownjeon-NFS-homes-brownjeon-project/b8b8f031-34f7-4edc-8621-4a61edd4f906/scratchpad/judge/judge-T-117-c2.json`(재부팅으로 사라졌을 수 있음 — 같은 형식으로 다시 쓴다, `user_requested=false`) ③ **Codex 필수(R2)** ④ QA(직렬: 새 러너 시험 81, news-split 119, news-peek 46, pmo-retry 76, stop-alert 22, 전체 jest, 훅 시험 410, tsc) ⑤ 메인 트리로 5개 파일 복사·sha256 대조·명시 경로만 `git add`·커밋 전 확인(`mode 120000`·`node_modules`·`hooktest`·`tsbuildinfo` 0건) ⑥ push 전 점검(킬스위치 ON·최근 3시간 주문 0건) ⑦ **push 창**: 05:10~06:50 이 지났으면 **오늘 15:40~20:00**(첫 실행은 다음 날 07:40~07:54). **07:35~07:57 에 cron 재시작을 일으키는 배포는 피한다**(날짜파일이 호출 뒤에 기록돼 재시작 시 두 번 호출될 수 있음) |
| **T-118** 해외 peek 19슬롯+피드별 겹침 검사+peek 재시도 1회/20초 | Developer 구현 거의 완료(신규 `src/lib/corp-intel/feed-check.ts` 등), 시험 재실행 전 — Developer 재개용 인수인계는 task `## Developer` 절 | Developer 시험·변이(직렬) → Reviewer → T-119 와 합쳐 러너 시험 1회 → judge C2 → Codex 필수 → QA → push(묶음 2) |
| **T-119** 보유 종목 개장 전 공시 확인(B) | Developer 구현 거의 완료(신규 `holdings-premarket` 라우트·모듈·러너 블록), 시험 재실행 전 | 동일. 스위치 `holdings_premarket_enabled`(키 없음=꺼짐)는 **배포·검증 뒤 Leader 가 켠다**(사용자 승인 Q2⑤). 첫 실행 ET 08:00(KST 21:00) |

- 묶음 2(T-118+T-119) 배포 목표: **오늘 15:40~20:00**. 늦으면 10-30 05:10~06:50.
- 로컬에 푸시 안 된 문서 커밋 `5021584`(T-114 v1.0·T-104 2차·통합 계획 등)가 있다 — 다음 코드 push 에 동승. `origin/main` 은 `0761fec`.

## 3. 재생성해야 하는 예약 점검 (세션 전용이라 재기동 때 사라진다)

| 시각(KST) | 점검 | 조건 |
|---|---|---|
| 10-29 06:13·06:27 | T-103/T-115 첫 06시 수집·건수 100 검증(읽기 전용: cron 로그·`ci_raw_item`·M4 `fresh`) | 재기동이 06:27 이후면 그냥 지금 읽어 확인 |
| 10-29 07:47 | T-117 첫 실행 관측(앱 로그 `[daily-bars] done …`, `daily_bars` 최신 거래일) | **T-117 이 배포된 뒤에만** (배포일의 다음 07:40) |
| 10-29 08:12 | 해외 장마감 후 분석 첫 실행(08:00, 스위치 ON 10-28 13:33) 관측 — 호출·재시도·`[rag-retrieval] (overseas)` | 배포와 무관 |
| 10-29 15:47 | T-115 국내 15:30 추가 수집 첫 실행 검증 | 배포와 무관 |
| 10-29 16:12 | 국내 16:00 분석 `news>0`? (T-105 후보 E 사전 결정 Q6: 0 이면 T-120 접수, 임계 변경 전 Analyst 점검 필수) | 배포와 무관 |
| T-119 배포 당일 21:05 | T-119 첫 실행(ET 08:00) 관측 | T-119 스위치 ON 후 |

## 4. 위임·게이트 (그대로 유효)

- 사용자 위임(10-28 23시대): "모두 권고안으로 작업 진행해줘. 이후 작업은 사용자 승인여부 묻지 않고 작업 진행하고 완료 후 결과 정리해서 리포팅해줘." — 결정 Q1~Q7 전부 권고대로.
- **위임이 덮지 않는 것**: 단계 1a 이상의 DDL 적용(+사용량 고지), T-108 화면 구현(데모 승인), M4 push, KIS 호출 확대, 킬스위치·자동 청산 스위치, 비밀번호 교체. DB 비밀번호 평문은 사용자 결정으로 유지(재질문 금지, 값은 어디에도 적지 않는다).
- 정본: 설계 `docs/design/2026-10-28-corporate-intelligence-second-design.md`(v1.0) · 통합 계획 `docs/design/2026-10-28-collection-menu-integrated-plan.md` · T-104 task ★ 절 · 공동 인계서 `agent-vault/10-Flow/handoffs/2026-10-28-joint-collection-integration-and-menu-home-handoff.md`.

## 5. 서브에이전트 재개 방법

서브에이전트는 재기동으로 사라지지만 대화 기록은 저장돼 있다 — `SendMessage` 의 `to` 에 agentId 를 넣어 재개할 수 있다(10-29 04:5x 에 이 방식으로 재개했다): T-117 Developer `ab17dcfef45e35721` · T-117 Reviewer `a61d93829f1d61f33` · T-118 Developer `ae600b9f3a6b56405` · T-119 Developer `a6981698a1234800f`. 재개 메시지에는 항상 현재 상태 재확인(git status·task 의 Developer/Reviewer 절)과 §0-4 부하 규칙을 넣는다. 재기동 전 시험 결과는 재실행 전까지 미검증으로 취급한다.
