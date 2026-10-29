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

## 7. 세션 이관 (10-29 10:15 — 사용자 지시: "다른 세션에서 이어서 작업. 지금 하는 작업이 끝나면 이 세션은 마무리")

이 세션(이름 `작업이관 _ 종목분석작업 _ 주식매매`)은 진행 중이던 개발 검증 단계가 끝나는 대로 마무리한다. **새 세션은 §0 → §7 순서로 읽고, 이 세션이 만든 예약 메모·서브에이전트가 사라졌다고 가정한다**(세션 전용이라 같이 끝난다).

### 7-1. 지금 상태 (10:15 실측)
| 작업 | 상태 | 새 세션이 할 일 |
|---|---|---|
| T-117 일봉 크론 등록 | **로컬 커밋 `159c4a7`**(러너+시험 4+isolation, Reviewer PASS·Judge C2·Codex(L-5 후속)·**QA PASS 09:32**). push 안 함 | 15:40~20:00 창(07:35~07:57 피함)에 push → Deployer 점검 (a)~(f) → 독립 검증 → **다음 날 07:40~07:54 첫 실행 관측** |
| T-118 해외 peek 확대 | worktree `~/.node-local/stockinvest-t118`(base 0761fec) **미커밋**. Developer 가 러너 시험 4종 통과(news-peek 81/0·news-split 119/0·pmo-retry 76/0·stop-alert 22/0), 변이 시험 R1~R4 확인, 전체 jest·mutation(jest-mut) 진행 중이었음 | Developer 최종 보고(task `## Developer`) 확인 → Reviewer(Sonnet) → 병합 → Codex(R2 필수) → QA |
| T-119 보유종목 개장 전 공시 | worktree `~/.node-local/stockinvest-t119`(base 0761fec) **미커밋**. 러너 시험·전체 시험 체인 진행 중이었음 | 위와 같음. 켜기 스위치 `holdings_premarket_enabled` 는 배포 확인 뒤(사용자 Q2⑤ 승인) |
| T-121 Node 20→24 | 기록만(`T-121-node24-transition.md`), 코드 변경 없음 | 배포 이후 judge 접수 → 골든 시험 1건 정리. **T-117 Deployer 조건 (f)**: stockinvest·stockinvest-cron 이 Node 24 로 처음 기동하므로 `pm2 jlist` node_version 과 build 성공을 기록 |
| T-105 후보 E / T-120 | 16:00 국내 분석 `news>0` 여부로 사전 결정(Q6) | 16:12 판정. `news=0` 이면 T-120 접수(임계 변경 전 Analyst 필수). T-106 알림이 10-30 16:00(국내)·10-31(해외)에 울릴 수 있음을 사용자에게 알림 |

### 7-2. 이 세션이 만든 예약 3개 — 새 세션에서 다시 만들 것 (한 번 쓰는 예약, 세션 전용)
1. **15:42** — 배포 창 열림. push 전 점검: 킬스위치 ON(`safety_kill_switch`)·최근 3시간 주문 0건·`git log origin/main..HEAD` 목록·미커밋에 T-118/T-119 변경이 섞이지 않았는지. T-118/T-119 가 못 끝났으면 T-117 만 먼저(묶음1).
2. **15:47** — T-115 국내 15:30 추가 수집(`news-fetch-domestic-pm`) 첫 실제 실행 검증(cron 로그·`ci_raw_item`·news-health).
3. **16:12** — 국내 16:00 분석 `news>0` 판정(위 T-105/T-120).

### 7-3. 안 올라간 것 (push 대상 — 사용자 지시 "필요한 문서·소스는 push 까지")
- StockInvest 로컬 커밋 12개: 문서 11개 + `159c4a7`. push 하면 배포가 일어나므로 **창 안에서, T-117 과 한 번에**. T-118/T-119 의 미커밋 task 문서 변경은 Developer 몫이라 섞지 말 것.
- home-m4-api 로컬 커밋 2개(`3467d9d`·`6841f8a`, 문서 전용): **M4 push 는 위임 범위 밖 — 사용자 승인 필요**(M4 푸시 배포는 Mac pip 단계 고장 이력 있음).

### 7-4. 지켜야 할 규칙 (그대로)
- 무거운 시험은 반드시 `flock /tmp/stockinvest-heavy-tests.lock nice -n 10 …`, jest `--maxWorkers=3`, `NODE_OPTIONS=--max-old-space-size=2048`(10-28 23:49 서버 정지 재발 방지). 지금도 락 아래에서 T-118·T-119 시험이 돌고 있을 수 있으니 `ps -eo pid,etimes,args | grep -E "jest|flock|chain.sh"` 로 먼저 확인.
- 전체 jest 의 알려진 실패 1건(`scenario-card-domestic-golden.test.ts`)은 T-121 로 분리된 기존 실패 — 고치지 말 것.
- 위임 범위 밖(계속 사용자 확인): DDL, T-108 화면 구현(데모 승인), M4 push, KIS 호출 확대, 킬스위치·자동 청산 스위치, DB 비밀번호(평문 유지 — 값은 어디에도 적지 않기).
- 커밋은 명시 경로만, 워크트리→메인 복사 뒤 sha256 일치 확인, `node_modules` 심볼릭 링크·`hooktest`·`tsbuildinfo` 가 스테이징에 없는지 확인.
- 서브에이전트(T-117 QA `a0ea0513…`, T-118 Dev `ae600b9f…`, T-119 Dev `a6981698…`)는 이 세션 소속이다. 새 세션에서 이어 쓸 수 있는지는 확인 못 함 [추측: 불가] — 안 되면 task 파일 `## Developer` 섹션과 worktree 를 읽고 새로 띄운다.

### 7-5. 갱신 (10:14) — M4 문서 커밋 push 완료
- 사용자가 "M4서버의 문서 커밋 2개는 푸시해줘" 로 직접 지시해, home-m4-api 로컬 커밋 `3467d9d`·`6841f8a`(문서 전용 2파일)를 push 했다(`0e3b0d0..6841f8a`, fast-forward — 원격 main 을 `ls-remote` 로 직접 확인). **§7-3 의 "M4 push 는 사용자 승인 필요" 항목은 이 2개 커밋에 한해 해소됐다.** 앞으로 M4 코드 push 는 여전히 사용자 확인.
- 자동 배포 결과: webhook 로그 `project_home-m4-api.log` 마지막 줄 `OK sha=6841f8aef4… port=8000 exit=0`(로그 시각은 UTC 01:13 = KST 10:13), M4 `/health` 200. **이번엔 Python 의존성 설치 단계가 정상 통과**했다(pip 안내 문구만 출력) — 10-28 의 "Mac pip 단계 고장 → exit=126, 수동 재시작" 증상은 이번 배포에서 재현되지 않았다 [확실: 로그 직접 확인. 항구적으로 고쳐졌는지는 한 번의 관측이라 [추측]].
- `git fetch` 가 "필요한 오브젝트를 모두 보내지 않았습니다" 오류를 내는 것은 M4 저장소에서도 보였다(기존 현상). push 는 영향 없었고, fast-forward 여부는 fetch 대신 `git ls-remote origin refs/heads/main` 과 `git merge-base --is-ancestor` 로 확인했다.
- home-m4-api 작업 트리에는 이 세션과 무관한 미커밋 변경(`.claude/agents/*.md` 등)이 남아 있다 — 건드리지 않았고 push 에도 포함되지 않았다.

### 7-6. 갱신 (10:35) — T-118 Developer 최종 보고 도착 (구현 완료, Reviewer 대기)
**상태**: worktree `~/.node-local/stockinvest-t118`(base `0761fec`) **미커밋**. 커밋·배포·운영 DB·M4 호출 없음. 사양 1~7 구현 완료. 단계별 기록은 task `T-118-…md` `## Developer` 절(05:10~10:33), 시험 로그·체인은 `~/.node-local/t118-work/`(`chain.sh`·`chain-result.txt`·`mut/`·`jest-full.log`).

| 시험 | 결과 |
|---|---|
| 러너: news-peek / news-split / pmo-retry / stop-alert | 81/0 · 119/0 · 76/0 · 22/0 |
| 전체 jest(Node 24) | 8,613건 중 8,462 통과·149 skip·**2 실패(둘 다 예상됨)** — ① `broker-fills/__tests__/cron-runner-block.test.ts` "기존 줄 변경 0 — HEAD 대비 추가만"(T-103 선례처럼 **커밋 전에는 반드시 실패** — 빠진 HEAD 24줄은 전부 상단 잡 목록 주석 3줄·peek 블록 안, **커밋 뒤 재실행해 통과 확인**) ② 골든 시험(T-121 분리, 기존 실패) |
| tsc / bash -n / 훅 시험 | 통과 / 통과 / 410·0 |
| 변이 시험 | 러너 4건(R1~R4)·jest 14건 **전부 잡힘**, 원본 sha256 복원 14/14 |

**변경 파일**: `scripts/cron-runner.sh`(+42/−24), `src/app/api/cron/news-fetch/route.ts`, `src/lib/corp-intel/{raw-capture,status}.ts`, 신규 `src/lib/corp-intel/feed-check.ts`, 러너 시험 3개(news-peek 재작성·news-split·pmo-retry 하네스), jest 시험 5개(신규 `route-feed-check`·`feed-check`).
**Reviewer scope 후보**: `scripts/cron-runner.sh`, `src/app/api/cron/news-fetch/`, `src/lib/corp-intel/` (+ 러너 시험 3개 하네스 수정도 같이 보게 할 것).

**Reviewer 가 특히 확인할 Developer 판단 6가지**
1. 슬롯을 21개 나열하지 않고 규칙으로 구현 — 해외 "매시, 단 06·07·08·15·16시 제외", 국내 10·13시. 날짜파일 이름이 T-116 과 같아 배포 당일 이미 돈 T-116 슬롯은 다시 돌지 않는다.
2. 겹침 검사 조회를 저장(INSERT)과 **나란히** 실행(사양은 저장 전 실행을 전제). DB 가 느리면 상태 기록이 조회(최대 1초)를 기다리다 `partial` 이 될 수 있다.
3. `feed_host` 인덱스가 없어(DDL 금지) 발행시각 7일 하한 — 7일 넘게 행이 없던 피드는 gap 이 아니라 bootstrap 으로 보인다.
4. M4 응답을 못 받은 시도(fetch_failed·no_items)는 직전 `feeds` 를 그대로 옮긴다(연속 gap 수 보존). 응답에 없는 피드는 상태에서 빠진다. 피드 수 상한 8.
5. ingest 가 쌓은 행도 직전 값에 넣고 ingest 도 같은 검사를 한다.
6. 기존 러너 시험 하네스를 기대값 약화 없이 수정(news-split: curl 스텁이 `--max-time` 준수·단언 2곳을 ingest 호출로 좁힘 / pmo-retry: 09시 해외 peek 가 `market=overseas` 필터에 걸려 단언 3곳을 post-market 경로로 좁힘).

**남은 위험·병합 메모**
- Yahoo 피드는 매일 **09·17시에 gap 이 찍힐 가능성이 높다**(06→09, 14→17 이 3시간 공백인데 Yahoo 창은 1.0~1.6시간). 07·08·15·16시를 빼기로 한 사양의 직접 결과 — 운영 관측 때 오경보로 오해하지 말 것.
- 미래 날짜 발행시각이나 오래된 고정 기사가 섞이면 gap 을 놓칠 수 있다(거짓 '이어짐').
- 병합: news-peek 시험 P7 정적 비교는 기준 ref `0761fec` 대비다. **T-117·T-119 와 합친 뒤에는 `T118_BASE_REF` 를 두 변경이 들어간 ref 로 줘야 통과**한다. 상단 잡 목록 주석 31~33행을 고쳤으므로 T-117(`159c4a7`, 이미 main 에 커밋)·T-119 가 같은 근처를 고쳤다면 충돌할 수 있다 — T-118 을 main 위에 `git apply --3way` 로 얹을 것.
- 20-Log 한 줄은 아직 안 썼다(Developer 지시 범위 밖) — Leader 가 커밋 때 쓴다.

### 7-7. 정정 (10:35) — Node 업그레이드 주체는 미확인
- T-121 QA 보강(10:16)이 `/var/log/apt/history.log` 를 확인했다: **08:35:01 `apt-get install -y nodejs`, `Requested-By: brownjeon (1000)`, 20.20.2 → 24.22.2.** 이 계정으로 실행됐다는 것만 알 수 있고, **사용자가 직접 한 것인지 다른 에이전트 세션이 한 것인지는 모른다.** 이 인수인계 §7 과 T-121 에서 "사용자 PC 업데이트"라고 쓴 것은 추정이었다 — 새 세션은 사용자에게 "08:35 에 Node 를 24 로 올린 게 의도한 업그레이드인지" 한 번 물어볼 것(기억에 없다면 다른 세션의 부작용이다). 같은 시험 파일 A/B 로 확인: **골든 시험은 Node 20.20.2 에서 7/7 통과, 24.22.2 에서 6/7**, Node 20 으로 돌린 전체 jest 는 8429 통과·0 실패.

### 7-8. 갱신 (13:0x) — T-117·T-118 로컬 커밋 완료, T-119 병합본 검증 중 (사용자 지시: "T-118 커밋·푸시, T-119 도 완료되면 커밋·푸시")
- **로컬 커밋(origin/main 이후, push 안 함)**: `159c4a7`(T-117) → `f91cd94`(T-118) + 문서 커밋 11개. T-118 은 Reviewer PASS(11:29)·Judge C2·Codex(medium 1 기각·low 3 → T-122)·QA PASS(직접 실행)를 거쳤고, 커밋 뒤 broker-fills "추가만" 시험 10/10 통과 확인. **push 는 15:42 이후 배포 창에서** (사용자가 즉시 push 를 원하지 않는 한 — 지금은 국내 장중이라 배포가 크론을 재시작함).
- **T-119**: 병합 worktree `~/.node-local/stockinvest-m119`(HEAD=`f91cd94`, 미커밋 변경 = T-119 몫 10개 파일: 러너 블록, 신규 라우트·모듈·시험, 러너 시험 3개의 범위 조정, isolation 시험). 충돌 13곳 Leader 수동 해소(`/tmp/m119base/resolve2.py`), isolation 시험 충돌은 Developer 패치(승인), 기대값 21:00→21:01(T-118 의 21·22시 peek 양보)·`T119_BASE_REF` 기본값은 `f91cd94bb292e2f20e733a97c9070d9129cdadb8`. Developer 시험: holdings 53/53·daily-bars 81/81·jest(corp-intel+holdings) 317/317·변이 7/7. **진행 중**: ① 병합본 체인 `~/.node-local/m119-work/chain-result.txt`(러너 6종→부분 jest→tsc→해시 대조) ② Reviewer 2차 감사 ③ Codex(C2, Judge `codex_required=true`) → 끝나면 QA → 커밋(T-119 코드 10개 + T-119 task 문서 + 20-Log) → push. T-119 1차 Reviewer PASS 의 M-1·L-5 는 T-123 으로 분리, M-2 는 DB 읽기 조회로 해소(보유 4종목 AAPL·MU·ORCL·SMH 중 3개 CIK 매핑, SMH 는 ETF).
- **푸시 시퀀스 권고**: 15:42 이후 `git push` 한 번에 T-117+T-118(+T-119 가 끝났으면 포함) — 같은 push 로 문서 커밋 11개도 간다. T-119 가 15:42 이후에 끝나면 별도 push. push 전 점검(킬스위치 ON·최근 3시간 주문 0건), push 후 Deployer 점검 (a)~(f) + **T-118 확인**(`stockinvest-cron` 정확히 1개, 첫 정시 해외 슬롯 `news-peek-overseas-NN OK` 로그와 `ci_raw_item` 신규 행, `ci_capture_status:overseas.feeds` — Yahoo 가 09·17시에 gap 으로 찍히는 것은 사양 결과) + **T-119 확인**(배포 후 `holdings_premarket_enabled` 스위치를 켜는 것은 사용자 Q2⑤ 승인됨, 켠 첫 주 `holdings_premarket_status` 매일 확인, 첫 실행은 EDT 21:01(peek 가 같은 틱이라 양보)). 11-01 DST 종료 후에는 22:01.
- QA 가 본 부수 관측: 운영 러너의 curl 인자에 `x-cron-secret` 값이 `ps` 출력에 보인다(기존 구조, 이번 변경 아님, 같은 서버 사용자만 보임) — 보안 위생 후보로 `/이슈기록` 등록을 사용자에게 제안할 것.

### 7-9. 갱신 (13:45) — 세 코드 커밋 모두 로컬 완료, push 만 남음
- **로컬 커밋(origin/main 이후 14개)**: 코드 3개 `159c4a7`(T-117 일봉 크론) → `f91cd94`(T-118 peek 확대·feeds) → `3568ebc`(T-119 개장 전 공시) + 문서 11개. 셋 다 Reviewer PASS·Judge C2·Codex(R2 필수)·QA PASS(직접 실행) 통과. 커밋 뒤 main 트리 사후 확인 4개 스위트 128건 통과(broker-fills "추가만" 포함), 전체 jest 의 알려진 실패는 Node 24 골든 1건(T-121)뿐.
- **남은 것**: ① 15:43 이후 `git push origin main` 한 번(세 커밋 한 배포) — 사전 점검(킬스위치 ON·최근 3시간 주문 0건·코드 파일 미커밋 0·국내 장 마감 후) ② Deployer 기준 점검(RELEASE_RESULT ok·pm2 두 앱 1개씩·**node_version(첫 Node 24 기동)**·health 200·cron 로그 예외 없음) ③ 배포 확인 뒤 스위치 `holdings_premarket_enabled`=true(사용자 Q2⑤ 승인) ④ 관측: 오늘 21:01 hp 첫 실행(21:00 은 peek 양보 — cron 로그에 `holdings-premarket yield_tick` 1줄 → 21:01 `holdings-premarket OK`, 상태 ok·holdings 4·checked 3·`unmapped=NAS:SMH`), 첫 정시 해외 peek, 10-30 07:40~07:54 daily-bars 첫 실행, 11-01 DST 종료 뒤 11-02 22:01 hp.
- **후속 task**: T-121(Node 24 골든 시험·전환), T-122(feeds 정확도 L-1~L-3), T-123(조용히 건너뜀 알림·오류 상세·동시 실행 중복 — 켠 첫 주 `holdings_premarket_status` 매일 확인 후 착수), 그 밖 L-5(T-117 날짜파일 쓰기 실패 공통 처리)는 T-104 흡수 때.
- **정리 대기(push·배포 확인 뒤)**: 임시 worktree 5개 `~/.node-local/stockinvest-{t117,t118,t119,m118,m119}`(`git worktree remove` — 미커밋 내용은 main 에 복사·커밋돼 있음)와 시험 로그 디렉터리 `~/.node-local/{t118-work,m118-work,m119-work,t119-scratch,m119-qa,...}`, dangling 임시 커밋(`e565c07b…`, gc 가 정리).
- 이 세션의 서브에이전트들(T-117 QA, T-118 Dev/Reviewer/QA/Codex, T-119 Dev/Reviewer/QA/Codex)은 모두 끝났다.

### 7-10. 최종 (14:05) — 세 코드 모두 배포 완료, 스위치 켬. **이 세션 마무리, 새 세션이 이어받는 곳**
- **배포**: 2026-10-29 13:49:04 push(`0761fec..5ca7817`) → 13:51 릴리스 `20261029-134931-5ca78174` ok(migrated=false, 헬스 정상). 독립 확인: pm2 `stockinvest`(Node 24.22.2, 첫 Node 24 기동 정상)·`stockinvest-cron` 각 1개·restarts 0, health 200, 구 러너 잔존 없음, 크론 틱 13:55 재개(재기동 직후 `strategy-eval` 첫 호출 3~5분은 10-26 장중 재기동 때와 같은 정상 패턴). 롤백 필요 시 `git revert` 후 push(이전 릴리스 `20261028-225643-0761feca`).
- **스위치**: 13:58:22 `holdings_premarket_enabled`=true(사용자 사전 승인 Q2⑤). `ci_capture_enabled`=true 유지, `safety_kill_switch`=true·`exit_engine_enabled`=false·`exit_hard_stop_enabled`=false 유지(손대지 말 것).
- **Node 20→24 업그레이드는 사용자가 의도해 다른 세션에서 한 정상 작업**(사용자 확인). T-121 상태 in-progress(골든 시험 1건만 남음).
- **로컬에만 있는 커밋**: 이 시점 이후의 문서 전용 커밋(배포 기록·최종 요약·대장·인계)이 origin 보다 앞서 있다 — 문서만이라 급하지 않다. push 하면 또 한 번 blue/green 배포(크론 재기동)가 나가므로 **다음 코드 push 에 동승시키거나 장 마감(15:30) 뒤 배포 창(15:40~20:00)에 한 번에**. M4 저장소는 문서 커밋 push 완료(`6841f8a`).
- **새 세션 첫 확인(순서대로)**: ① 15:47 T-115 국내 15:30 추가 수집 첫 실행(cron 로그 `news-fetch-domestic-pm` OK 1줄·`ci_raw_item` 신규 행·news-health) ② 16:12 국내 16:00 분석 `news>0` 여부(T-105 후보 E / T-120 사전 결정 Q6: `news=0` 이면 T-120 접수, 임계 변경 전 Analyst 점검 필수, T-106 알림이 10-30 16:00(국내)·10-31(해외)에 울릴 수 있음을 사용자에게 알림) ③ **21:01 hp 첫 실행**(cron 로그 21:00 `holdings-premarket yield_tick` 1줄 → 21:01 `holdings-premarket OK`, DB `holdings_premarket_status` ok·holdings 4·checked 3·`unmapped=NAS:SMH`; `stale_holdings`/`checked=0`/`failed` 이면 이상) ④ 10-30 05:30·06:15 해외 장마감 후 분석(스위치 켜짐)·06:00 뉴스 수집 ⑤ **10-30 07:55 이후 daily-bars 첫 실행**(cron 로그 `daily-bars OK` 1줄·날짜파일·앱 로그 `[daily-bars] done … aborted=`·`daily_bars` 최신일) ⑥ 11-01(일) DST 종료 → 11-02(월) 22:01 hp 호출·토·일 무호출.
- **세션 전용 예약은 모두 사라진다**(이 세션이 끝나면): 위 ①~⑥ 을 새 세션이 `CronCreate` 로 다시 만들거나 직접 확인할 것.
- **정리 대기**: 임시 worktree 5개 `~/.node-local/stockinvest-{t117,t118,t119,m118,m119}`(`git worktree remove`; 미커밋 내용은 이미 main 에 커밋됨)·시험 로그 디렉터리 `~/.node-local/{t118-work,m118-work,m119-work,t119-scratch,t119-scratch,m119-scratch,m119-qa,...}`·dangling 임시 커밋(`e565c07b…`, gc 가 정리).
- **후속 task**: T-120(예약: T-105 후보 E), T-121(골든 시험), T-122(feeds), T-123(hp 조용히 건너뜀 등 — 켠 첫 주 상태 확인 후), 그 밖 T-104 흡수 단계·T-108 화면 개편(데모 승인 필요)은 통합 계획 `docs/design/2026-10-28-collection-menu-integrated-plan.md` §5.
- **보안 위생 후보(사용자 확인 후 `/이슈기록`)**: 운영 러너의 `curl` 인자에 `x-cron-secret` 값이 있어 `ps` 출력에 보인다(같은 서버 사용자에게만; 이번 변경이 만든 것 아님, QA·내 점검 중 `ps` 출력에 두 번 노출됨 — 로그·문서에는 적지 않았다). 인자 대신 환경변수/헤더 파일로 넘기는 개선 후보. 값은 어디에도 기록하지 말 것.

### 7-11. 갱신 (14:15) — 완료 처리 지시 (사용자)
- **T-118 은 `status: done` 으로 변경했다**(첫 운영 관측 정상: 13:53 `news-peek-overseas-13`·14:00 `news-peek-overseas-14` OK, `feeds` 4개 gap 없음). **T-117·T-119 는 첫 관측 후 이상 없으면 `done` 으로 변경**하라는 사용자 지시 — 새 세션 할 일: ① T-119: 오늘 21:01 첫 실행 관측(§7-10 ③) 정상이면 `T-119-holdings-premarket-check.md` frontmatter `status: done` + 최종 요약 「상태」 줄에 완료 시각 ② T-117: 내일 10-30 07:55 이후 첫 실행 관측(§7-10 ⑤) 정상이면 `T-117-daily-bars-cron-registration.md` 를 `done`. 이상이 보이면 `done` 으로 올리지 말고 원인 조사 task 를 열어 사용자에게 보고(롤백 필요 시 `git revert` 후 push). 두 task 문서 「최종 요약」 상태 줄에 이 조건을 적어 두었다.
