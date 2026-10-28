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
| **T-117** 일봉 정기 수집 크론(R13, 07:40~07:54) | Developer 완료(+H-1 수정: `src/lib/profit-engine/__tests__/isolation.test.ts` 긍정 단언 4개) · Reviewer 1차 FAIL(H-1) → 수정 → **재검증 PASS(05:17)** · **Judge C2 완료(`codex_required=true`)** · **Codex 완료(06:38, 지적 1건 → Reviewer 가 후속 L-5 로 강등, 06:45 PASS 유지)** · **QA 진행 중(06:5x 시작, 직렬 약 40분 — 진행은 task `## QA` 에 한 줄씩)** · 남은 것: QA 결과 → 커밋(5개 파일) → push(오늘 15:40~20:00) · 변경 5개 파일(러너 sha256 `3e646908…fdd60`) | ① ✅ Reviewer PASS(05:17) ② ✅ judge C2(결과는 T-117 task 「판단 기록」에 옮겨 적음 — 다시 돌릴 필요 없음) ③ **Codex 필수(R2)**: `codex` 역할 문서(`.claude/agents/codex.md`)대로 인계 묶음을 만들어 `bash ~/NFS/homes/brownjeon/project/.claude/tools/codex-review/codex-review.sh run --task T-117 --checkpoint C2 --mode review --focus none --handoff <파일>` 를 worktree `~/.node-local/stockinvest-t117` 에서 실행(신규 미추적 파일이 스냅샷에 들어가는지 확인; `node_modules` 심볼릭 링크는 스냅샷 부산물이라 지적 시 Reviewer 가 기각 판단)  ④ QA(직렬: 새 러너 시험 81, news-split 119, news-peek 46, pmo-retry 76, stop-alert 22, 전체 jest, 훅 시험 410, tsc) ⑤ 메인 트리로 5개 파일 복사·sha256 대조·명시 경로만 `git add`·커밋 전 확인(`mode 120000`·`node_modules`·`hooktest`·`tsbuildinfo` 0건) ⑥ push 전 점검(킬스위치 ON·최근 3시간 주문 0건) ⑦ **push 창**: 05:10~06:50 은 **06:36 에 지났고(미배포 확정, T-117 `## 배포 기록` 참조)** **오늘 15:40~20:00**(첫 실행은 다음 날 07:40~07:54). **07:35~07:57 에 cron 재시작을 일으키는 배포는 피한다**(날짜파일이 호출 뒤에 기록돼 재시작 시 두 번 호출될 수 있음) |
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

## 5b. 06:5x 상태 갱신

서버 재기동은 **아직 안 됐다**(06:43 가동 2시간, `/var/run/reboot-required` 는 05:05 생성 — 패키지 업데이트는 05:47 에 끝남, 사용자가 재기동하면 이 세션·에이전트는 끝나며 위 §2·§6 으로 이어 간다). 사용자 알림 없이 06:50 에 시험을 재개했다(업데이트 종료 확인 후, `flock` 직렬). T-117 QA·T-118 체인·T-119 시험이 같은 락을 공유하며 순서대로 돈다 — 각자 단계마다 task 에 한 줄씩 기록한다.

## 6. Developer 중간 보고 요약과 Leader 결정 (05:15)

**공통**: 두 Developer 모두 구현은 끝났고 일관된 상태로 worktree 에 있다. 서버 정지·재기동 공지 때문에 **무거운 시험·변이 시험·전체 jest 는 재실행 전까지 전부 미검증**이다(재기동 전 "통과" 출력은 근거로 쓰지 않는다). 지금까지 재개 후 실제로 확인된 것: T-118 — `bash -n`·`tsc` 0·`jest corp-intel+news-fetch+rag` 526/526·`jest src/app/api/cron` 346/347(예상 실패 1)·`test-git-hooks.sh` 410/0 / T-119 — `bash -n`·`tsc` 0·`jest corp-intel+api/cron+us-edgar` 705/705.

**T-118**
- 재개용 시험 체인: `bash ~/.node-local/t118-work/chain.sh`(로컬 디스크) — 러너 시험 4개 → 러너 변이 4건 → jest 변이 14건 → sha256 대조 → 전체 jest 1회 → tsc, 단계마다 `flock … nice -n 10` 직렬, 결과 `~/.node-local/t118-work/chain-result.txt`, 약 1시간 30분. T-117 의 QA 시험과 락을 두고 경쟁하므로 **순서를 정해 하나씩**(T-117 QA 먼저).
- 예상 실패 1건(고장 아님): `src/app/api/cron/broker-fills/__tests__/cron-runner-block.test.ts` '기존 줄 변경 0 — HEAD 대비 추가만' — T-118 이 T-116 peek 블록·잡 목록 주석 3줄을 고쳐 HEAD 대비 삭제 24줄이 생긴다(T-103 선례처럼 커밋 전에는 반드시 실패, **커밋 뒤 같은 시험을 다시 돌려 통과를 확인**하는 것이 QA 조건).
- Developer 판단 → **Leader 수락**: 슬롯을 21개 나열하지 않고 규칙으로 표현(제외 시 규칙 한 줄 삭제를 시험이 잡음) · 겹침 검사 조회를 저장과 나란히 실행(`first_seen_at < 이번 캡처 시각` 조건으로 순서 무관) · `feed_host` 인덱스가 없어 발행시각 7일 하한(DDL 금지) · 응답 못 받은 시도는 직전 `feeds` 승계 · 피드 상한 8 · ingest 도 같은 검사를 하고 ingest 행도 직전 값에 포함. **알려진 한계(받아들임)**: Yahoo 는 07·08·15·16시 제외 때문에 매일 09·17시에 gap 이 찍힐 가능성이 높다(사양의 직접 결과, 알림 없음 — 상태에만 기록).
- 병합 주의: 상단 잡 목록 주석 31~33행을 고쳤으므로 T-117·T-119 가 같은 주석 근처를 고쳤다면 충돌 가능. 시험 `T118_BASE_REF` 는 합친 뒤 "T-117·T-119 가 들어간 ref" 를 줘야 통과.

**T-119**
- Developer 판단 → **Leader 수락**: 보유 목록 = `portfolio_snapshots` 최신 1행의 `positions[].currency` 가 `NAS:/NYS:/AMS:` 이고 qty>0 (3시간 넘은 스냅샷이면 `stale_holdings` 로 SEC 0회 — stop-alert 는 `position_state` 를 써서 두 목록이 다를 수 있음 → 배포 뒤 실제 개수를 DB 로 확인해 보고) · 양식 집합 = `us_filings` 와 같은 KEPT_FORMS(8-K·10-Q·10-K·20-F·40-F·6-K 와 각 /A) — **S-1·SC 13D/G 는 넣지 않는다**(사양 예시였으나 parse.ts 에 별도 집합이 필요) · `sec_filing` source_key = 접수번호 원문(설계서 §6.2 "SEC 공시 = 접수번호", 단계 2 의 `us_filings`→ci 리더와 같은 키) · 새 공시 판정 = 접수 시각이 (지금−24h, 지금+10분], `us_filings` 에 없고 `ci_raw_item` 사전 SELECT 에도 없으며 INSERT affectedRows=1(mysql2 FOUND_ROWS 때문에 사전 SELECT 병용) · CIK 없는 종목은 `unmapped` 보고 · 알림 10건 초과는 요약 1건 · 요청 상한 8(재시도 포함) · HTTP: failed/blocked 503, 나머지 200 · 스위치 꺼짐이어도 상태 키에 `switch_off` 기록.
- **알려진 한계(받아들임)**: 알림 발송이 실패하면 행은 이미 기록돼 다음 날 다시 알리지 않는다(24시간 창이라 그 알림은 유실; 07:00 수집이 `us_filings` 로 같은 공시를 가져와 분석엔 반영됨). 필요하면 후속으로 `alertFailed` 상태 보강.
- 알림 문구 예(시험 픽스처): 제목 `보유 종목 개장 전 공시` / 본문 `AAPL 8-K(실적 발표 Item 2.02) — 접수 ET 07:12 (KST 20:12). 분석에 아직 반영되지 않은 새 공시입니다. 알림만, 주문 없음.` + SEC 링크. 텔레그램 표시 `[StockInvest] ℹ️ 보유 종목 개장 전 공시`. 실패 알림 `보유 종목 개장 전 공시 확인 실패`(warning), 요약 `보유 종목 개장 전 공시 N건(요약)`.
- 재개 시험(직렬): 새 러너 시험 `scripts/test-cron-runner-holdings-premarket.sh`(H0~H9) → news-split → news-peek → pmo-retry → stop-alert → test-git-hooks → jest 변이 10건 + 러너 변이 5건 → 전체 jest 1회. 숨은 가드: `broker-fills/__tests__/cron-runner-block.test.ts`(추가만 확인)·`profit-engine/__tests__/isolation.test.ts`(T-117 이 이미 긍정 단언으로 교체) — 병합 때 확인. `T119_BASE_REF` 기본값 0761fec 는 병합 뒤 "T-119 를 뺀 합본" 커밋으로 지정.

**병합 순서 제안(재개 후)**: ① T-117 먼저 단독으로 Reviewer→C2→Codex→QA→커밋·push(창이 허용하는 시각) ② 그 커밋 위에 T-118·T-119 를 합쳐 하나의 후보로 만들고(러너 충돌은 Leader 가 `git apply --3way` 로 해결), 합친 러너로 T-118 체인·T-119 시험을 직렬 1회, Reviewer(두 task 별도 판정 줄 또는 합본 1개 — scope 가 스테이징 파일을 모두 덮어야 함)→C2→Codex→QA→push(묶음 2).
