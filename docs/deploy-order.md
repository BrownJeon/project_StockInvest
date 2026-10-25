# 주식 자동매매 (StockInvest) — 배포 작업절차서

> **이 프로젝트 배포의 정본.** 배포를 실행하기 전에 이 문서를 먼저 읽는다.
> 작성 2026-09-19 · 근거: VoiceVault 파일럿 실배포(`VoiceVault/docs/task-038-deploy-order.md`)와
> 워크스페이스 정본 [`dev-deploy-workflow.md`](../../docs/dev-deploy-workflow.md).
>
> | 문서 | 다루는 것 |
> |---|---|
> | [`../../docs/dev-deploy-workflow.md`](../../docs/dev-deploy-workflow.md) | 배포 **메커니즘** (스크립트·매니페스트·blue/green) |
> | [`../../docs/deployer-integration-procedure.md`](../../docs/deployer-integration-procedure.md) | 에이전트 **연계 정책**·게이트 |
> | **이 문서** | **이 프로젝트에서 실제로 무엇을 어떤 순서로 하는가** |
> | [`../deploy.yml`](../deploy.yml) | 이 프로젝트의 배포 매니페스트 |

---

## 0. 한 줄 요약

**맥에서 소스를 고치고 → 커밋·푸시하고 → `scripts/deploy.sh StockInvest --yes` 한 번.**
그 뒤는 우분투가 알아서 한다 — 새 릴리스 디렉토리에 빌드하고, 헬스체크가 통과해야만
`current` 심볼릭 링크를 옮긴다. 빌드가 깨져도 운영은 이전 릴리스로 계속 서 있다.

```
맥: NAS 소스 편집 → npm run dev (:3003) → 브라우저 검증 → git push
                                          │
                                scripts/deploy.sh StockInvest --yes  (SSH 한 번)
                                          ▼
우분투: 릴리스 전개 → 빌드 → 헬스체크 ─┬─ 통과 → current 전환 → 완료
                                       └─ 실패 → 자동 롤백 (운영 그대로)
```

> **현재 상태 (2026-09-19)**: ✅ **blue/green 컷오버 완료** — 릴리스 `20260919-225120-31f4ea26`, `RELEASE_RESULT status: ok`.
> pm2 `stockinvest + stockinvest-cron` 가 `/home/brownjeon/apps/stockinvest/releases/…` 에서 돈다.
> **webhook 도 release.sh 위임으로 교체했다** — 이제 `git push` 가 곧 blue/green 배포다
> (종전 스크립트는 `webhook-deploy/pre-bluegreen-backup-20260919/` 에 보관).
> NFS 편집 트리에 빌드해도 운영에 반영되지 않는다.
>
> **안드로이드 앱 "주식캐기"(T-084~)** 의 APK 공개·`app_release` 기록은 웹 배포와 별개 경로다 — §9 와 §10 사이의 「앱(APK) 배포」 절. 사용자 승인 게이트가 따로 있다.

---

## 1. 🔴 선결 조건 — 해소 전에는 배포하지 않는다

| # | 항목 | 상태 | 조치 주체 |
|---|---|---|---|
| 1 | 🔴 운영이 NFS 편집 트리에서 직접 구동 중 | 미해소 | 사용자 (컷오버, §9) |
| 2 | 🔴 **cron 중복 기동 위험** — 이 프로젝트 최대 위험 | 미해소 | 사용자 (§9) |
| 3 | 🔴 webhook 자동배포가 이미 등록됨 → 이중 배포 위험 | 미해소 | 사용자 (§9) |
| 4 | 🔴 `@workspace/auth-oauth` 의 `file:` 상대경로가 릴리스 깊이에서 깨짐 | 미해소 | developer + 사용자 승인 |
| 5 | 🔴 실매매 중단 시간 합의 | 미해소 | 사용자 |
| 6 | `shared/.env` 서버 배치 | 미해소 | 사용자 (§9) |

> **2026-09-19 실측 — 운영 루트는 이미 준비돼 있다.**
> `/home/brownjeon/apps/` 는 존재하고 현재 `voicevault/` 하나가 들어 있다.
> **프로젝트별 base 디렉토리는 사람이 만들 필요가 없다** — `release.sh` 가 첫 배포에서
> `git clone --mirror` 와 `mkdir -p "$BASE/shared"` 로 만든다.
> 사람이 미리 해야 하는 것은 **`shared/.env` 배치 하나뿐**이다(없으면 첫 배포가 의도적으로 실패한다).


### 2번 상세 — cron 중복 기동

`stockinvest-cron` 이 **두 개 떠 있으면 주문·집계가 두 번 돈다.** 컷오버 과정에서
옛 경로의 cron 과 새 릴리스의 cron 이 동시에 존재하는 순간이 생길 수 있다.

컷오버 시 **반드시 `pm2 delete stockinvest-cron` 을 먼저** 하고 재등록한다(§9).
배포 후에도 매번 확인한다:

```bash
ssh home_ubuntu 'pm2 list | grep stockinvest-cron'   # 정확히 1행이어야 한다
```

2행 이상이면 **즉시 중단하고 사용자에게 보고**한다. 스스로 하나를 지우지 않는다 —
어느 쪽이 정상인지 판단이 필요하고, 그 판단은 deployer 의 권한 밖이다.

### 4번 상세 — `npm ci` 가 깨지는 이유

`package.json` 이 공용 OAuth 패키지를 **저장소 상대경로**로 참조한다.

```json
"@workspace/auth-oauth": "file:../shared/auth-oauth"
```

`package-lock.json` 도 같은 상대경로로 굳어 있다. 릴리스 디렉토리에서 설치하면

```
/home/brownjeon/apps/stockinvest/releases/<타임스탬프>/../shared/auth-oauth
  = /home/brownjeon/apps/stockinvest/releases/shared/auth-oauth     ← 존재하지 않는다
```

로 풀려 `npm ci` 가 ENOENT 로 깨진다.

**조치 — 사용자 판단 사항이다.**

| | 방법 | 평가 |
|---|---|---|
| A | `$BASE/releases/shared` → NAS `shared/` 심볼릭 링크 | 동작하지만 **취약하다.** `releases/` 는 prune 대상이라 보관 슬롯을 잡아먹고 언젠가 지워질 수 있다 |
| B | **(권장)** `.npmrc` 에 `install-links=true` + `file:` 을 NFS 절대경로로 | TheMeal·VoiceVault 방식. 설치 시 실제 파일로 복사되므로 런타임에 경로가 필요 없다 |

> `shared/auth-oauth` 는 git 밖 NAS 상주 패키지라 릴리스에 포함되지 않고 롤백되지도 않는다.
> DB 마이그레이션과 같은 등급의 공유 자원으로 취급한다.

> **이 절에 미해소 항목이 하나라도 있으면 deployer 는 기동하지 않는다.**
> 배포하지 않고 "무엇이 남았는지"를 그대로 보고하는 것이 올바른 행동이다.

---

## 2. 배포 전 확인

```bash
cd /Volumes/homes/brownjeon/project/StockInvest

# ① 배포되는 것은 작업본이 아니라 origin 의 ref 다. 푸시 안 된 커밋이 있으면 그게 빠진다.
git status -sb | head -1          # "[ahead N]" 이 보이면 N 개가 아직 origin 에 없다
git log --oneline origin/main..HEAD

# ② 브랜치 확인 — deploy.yml 의 source.ref 와 같아야 한다
git branch --show-current         # 기대: main

# ③ 커밋되지 않은 변경
git status --short | head
```

- `ahead` 가 0 이 아니면 **푸시하거나**, 올리지 않을 커밋이면 사용자에게 확인받는다.
  `deploy.sh` 가 경고하지만 `--yes` 로 넘기면 그 경고도 지나간다.
- QA(`verdict=PASS`, 결함 0건) 보고가 없으면 기동하지 않는다.


### 🔴 `npm run build` 를 `deploy.yml` 에 그대로 쓰면 안 되는 이유

`package.json` 의 `build` 는 `~/.node-local/stockinvest` 에서 빌드한다. 그대로 쓰면
빌드 산출물(`.next`)이 릴리스 디렉토리가 아니라 **모든 릴리스가 공유하는 단일 미러**에
떨어져, `current` 를 되돌려도 앱이 이전 버전으로 돌아가지 않는다 — **blue/green 이 무력화된다.**

그래서 `deploy.yml` 의 `build.command` 는 npm 스크립트를 우회해 릴리스에서 직접 빌드한다.
미러는 NFS `noexec` 회피책인데, 운영 경로(`/home/brownjeon/apps`)는 **ext4 라 우회가 불필요**하다.
**맥 개발에서는 `npm run build` 를 그대로 쓴다** — SMB 위에서는 미러가 여전히 필요하다.


---

## 3. 배포 실행

```bash
# ① 계획만 확인 — SSH 하지 않는다. 대상 호스트·경로·ref 를 눈으로 본다
scripts/deploy.sh StockInvest --dry-run

# ② 배포
scripts/deploy.sh StockInvest --yes
```



> ⚠️ **`--with-migrate` 를 스스로 붙이지 않는다.** 개발과 운영이 같은 NAS MariaDB
> (`192.168.219.154:3306`)를 본다. blue/green 롤백은 **코드만** 되돌리므로 마이그레이션은
> 되돌아가지 않는다. 필요하다고 판단되면 그 사실만 보고하고 사용자 승인을 기다린다.

---

## 4. 결과 판정

스크립트는 마지막에 `RELEASE_RESULT <json>` 한 줄을 출력한다.
**출력 문구가 아니라 이 JSON 의 `status` 로 판정한다.**

| `status` | 운영 상태 | 다음 조치 |
|---|---|---|
| `ok` | 새 릴리스 | §5 배포 후 확인으로 |
| `build_failed` | **영향 없음** (current 불변) | 빌드 로그 발췌 → developer. 수정 후 Reviewer 부터 재순환 |
| `health_failed` | **이전 릴리스로 자동 롤백됨** | pm2 로그 발췌 → developer. 수정 후 Reviewer 부터 재순환 |
| `rolled_back` | 이전 릴리스 (수동 롤백) | 사용자 지시로만 발생 |
| `rollback_unhealthy` | 🔴 **비정상** | 즉시 에스컬레이션. **추가 배포 시도 금지** |

```bash
scripts/deploy.sh StockInvest --status
scripts/deploy.sh StockInvest --logs 100
```

---

## 5. 배포 후 확인 — 여기가 핵심

`status: ok` 는 "프로세스가 떴다" 는 뜻이지 "기능이 동작한다" 는 뜻이 아니다.
아래를 **실제로 열어서** 확인한다. 확인하지 않은 항목은 "미확인"이라고 그대로 적는다.

### 🔴 가장 먼저 — cron 중복

```bash
ssh home_ubuntu 'pm2 list | grep stockinvest-cron'
```

- [ ] `stockinvest-cron` 이 **정확히 1행**인가 — 2행 이상이면 즉시 중단·보고

### 안전장치·연동

- [ ] KIS OpenAPI 연동 상태가 정상인가
- [ ] 안전장치(DRY_RUN·주문 한도 등)가 배포 전과 동일한가
- [ ] 감사 로그에 이상한 신규 행이 생기지 않았는가

### T-056(해외 USD 예수금 스냅샷) 배포 직후 추가 확인

배포 시점은 **양시장 폐장 + 킬스위치 OFF** 구간(05:10~08:30 또는 15:40~22:20 KST)이다. 배포 직후 스냅샷을 1회 강제로 찍고(`POST /api/cron/portfolio-snapshot`, 헤더 `x-cron-secret`, 본문 `{"force":true}`) **읽기 전용으로** 아래를 본다. 확인하지 않은 항목은 "미확인"이라고 적는다.

- [ ] 최신 `portfolio_snapshots` 행의 `positions` 에 `currency:'USD'` 행이 있고, `value_krw` = `qty` × `price`, `price` = 그 시각 `fx_rates` 값인가
- [ ] 행 합계 = `total_krw` 인가(항등), 총액이 직전 행보다 **그 시각 USD 평가액만큼** 커졌는가 — 과거 행에는 USD 가 없어 USD 잔액이 있으면 **1회성 불연속**이다. 잔액이 0 이면 `qty 0`·`value_krw 0` 행이 기록되고 불연속은 없다(2026-10-20 오전 368.51달러=약 49만 원이었고 같은 날 23:07 실측에서는 0 이었다 — 배포 시점 값을 먼저 읽어 기대값을 정한다)
- [ ] `snapshot:usd_cash_unavailable` critical 경보와 `skipped:'usd_cash_unavailable'` 응답이 **없는가**(있으면 CTRP6504R 응답 모양이 실측과 다르다는 뜻 — 파서를 고치기 전에는 킬스위치가 stale 로 멈춘다. 즉시 보고)
- [ ] `/api/health` 의 해외 1회·일일 한도가 USD 평가액 × 비율만큼만 늘었는가, 국내 한도는 불변인가
- [ ] 킬스위치 `drawdown` 결과가 `evaluated`(또는 전환 규칙 사유 문구) 이고 발동 보류 경보가 없는가

> 🟡 **배포 후 24시간은 킬스위치 전환 구간이다.** 기준선(24시간 전 행)에 USD 행이 없어서 킬스위치가 양쪽에서 USD 를 빼고 비교한다(전환 규칙 E). 이 구간에 **해외 손절 매도**가 있으면 USD 유입이 거래 정황으로 잡히지 않아 **발동 대신 "보류 + critical" 알림**으로 간다(오늘의 운영 동작과 같다). 알림이 오면 "같은 조건 비교" 수치만 보지 말고 **USD 를 포함한 실제 총액 변화율**을 확인하고, 실손실이면 설정 > 안전장치에서 킬스위치를 수동으로 켠다. 24시간 뒤 기준선이 새 형식이 되면 자연히 사라진다.
> 첫 해외 매도 직후에는 스냅샷 `output3.ustl_sll_amt_smtl`(미결제 매도)과 USD 행을 비교해 매도 대금이 체결기준으로 들어오는지 확인한다(T-056 단계 4, T-055 2단계 관문).

### T-059 Part A(미국 종목 데이터 수집 P1) 배포 직후 추가 확인

배포만으로는 테이블이 생기지 않는다 — `scripts/migrations/T-059-us-data-collector.sql` 적용은 **별도 사용자 승인**이다(`--with-migrate` 는
`deploy.yml` 에 migrate 가 없어 거부된다. 승인 후 `mysql … < scripts/migrations/T-059-us-data-collector.sql` 로 사람이 적용). 확인하지 않은 항목은 "미확인"이라고 적는다.

> ✅ **2026-10-21 12:42 KST 마이그레이션 적용됨**(사용자 승인 "둘 다 승인", MariaDB 10.11.11, 5개 테이블·CHECK 제약 동작 확인, 전부 0행). KIS `HHDFS76200200` 실응답 1회 확인도 같은 날 완료(INTC). 아래 "마이그레이션 전" 항목은 이미 지난 단계라 건너뛴다.

- [ ] **마이그레이션 전**: `POST /api/cron/edgar-sync`·`/api/cron/kis-fundamentals-snapshot`(헤더 `x-cron-secret`)이 200 + `skipped:'tables_missing'`, 앱 로그에 SEC·KIS 호출 흔적 없음
- [ ] **마이그레이션 후**(읽기 전용 확인): `information_schema.TABLES` 에 5개(`symbol_cik_map`·`us_filings`·`us_financial_facts`·`us_earnings_events`·`us_fundamentals_snapshot`) 존재, 기존 테이블 변경 없음
- [ ] `edgar-sync` 1회 수동 실행 결과: `targets`·`mapped`·`unmapped`(SMH 등 ETF 는 정상적으로 unmapped)·`ciksDone`·`ciksFailed`·`requests`, **`aborted` 없음**(= SEC 429/403 0건), `durationMs` < 100,000 대(예산 100초 + 마지막 CIK 처리분 — 넘으면 `partial:true` 로 다음 날 이어짐)
- [ ] 같은 날 두 번째 수동 실행에서 `ciksUnchanged` 가 대부분이고 `requests` ≈ 1 + CIK 수(companyfacts 재호출 거의 없음 — 증분 확인)
- [ ] 행 수(읽기 전용 `SELECT COUNT(*)`): 5개 테이블 각각. `us_earnings_events` 의 `estimated` 행은 전부 `event_date_et IS NULL`
- [ ] `kis-fundamentals-snapshot` 1회 실행: `written`·`failed` 목록, `aborted` 없음. `tomv` 단위(USD)와 PER 산출(현재가÷`epsx`, EDGAR GAAP 과 기준이 다름)은 2026-10-21 INTC 실응답 1건으로 **확인됨**. **아직 미확인**: 손실 기업의 PER 표기(0·음수·빈 문자열) — 첫 실행의 `raw_output` 에서 `epsx` 가 0·음수인 종목을 찾아 확인
- [ ] `GET /api/fundamentals/NAS:INTC` 응답의 `data`·`cached` 는 배포 전과 같고(기존 LLM 경로, `stock_fundamentals` 캐시 불변 — R-1), 스냅샷이 생긴 뒤에는 **별도 필드 `observed`** 에 `data_source:'kis_price_detail'`·`observed_at`·원값이 붙는다(스냅샷 전에는 `observed:false`). 국내(`005930`) 응답은 배포 전과 같은 형식(`observed` 키 없음). 화면은 `observed` 를 읽지 않으므로 화면 변화 없음
- [ ] 스냅샷 `per`·`pbr` 이 KIS 원문 `0.00` 인 종목은 NULL 로 저장돼 있는가(R-2 — `raw_output.perx` 와 대조)
- [ ] 다음 날 07시·08시 tick 의 cron 로그에 `edgar-sync OK`·`kis-fundamentals-snapshot OK`, 하트비트 워치독 경보 없음
- [ ] (R-9) 첫 수동 `edgar-sync` 직후 `pm2 describe stockinvest` 로 RSS·재시작 횟수 확인(큰 회사 companyfacts 는 수 MB JSON 을 한 번에 파싱한다)

> **알려진 한계(P1, 코드로 막지 않음)** — R-5: 창이 지난 `estimated` 행은 활성처럼 남는다 → 소비 쿼리(P2)는 `superseded_by IS NULL AND window_end_et >= 오늘(ET)` 를 붙인다. R-3: companyfacts 워터마크가 날짜 단위라 같은 날 두 번째 정기보고서(정정)는 다음 보고서 때 반영된다. R-6: SEC 쿨다운·동시 실행 방지는 프로세스 메모리(pm2 재시작 시 초기화, 다중 인스턴스 미공유). R-8: KIS 스냅샷 job 은 레이트리밋 응답이 계속돼도 남은 종목을 끝까지 시도한다(유량 대기 실패에서만 중단).

### 화면·API

- [ ] `https://stock.미라클펭귄.com` 메인 화면이 렌더링되는가
- [ ] `GET /api/health` 가 200 인가

### 프로세스

```bash
scripts/deploy.sh StockInvest --status
scripts/deploy.sh StockInvest --logs 100
```

- [ ] **두 앱 모두** pm2 재시작 횟수가 늘지 않는가
- [ ] cron 로그에 기동 직후 예외가 없는가

> ℹ️ **이 프로젝트는 Prisma 를 쓰지 않는다** — DB 접근은 `mysql2` 직결이다.
> 다른 프로젝트 절차서에 있는 `prisma generate` 검증 항목은 여기 해당 없음.
> (2026-09-19 첫 컷오버에서 `deploy.yml` 에 `prisma generate` 가 들어가 있어 `build_failed` 가 났고, 제거했다.)

---

## 6. 실패했을 때

### 롤백

```bash
scripts/deploy.sh StockInvest --rollback      # 직전 릴리스로
scripts/deploy.sh StockInvest --rollback 2    # 두 단계 전으로
```

`current` 심볼릭 링크를 되돌리고 pm2 를 reload 할 뿐이라 수 초면 끝난다.
**수동 롤백은 사용자 지시가 있을 때만** 한다 — 자동 롤백은 스크립트가 이미 한다.

> 🔴 **DB 마이그레이션은 되돌아가지 않는다.** 마이그레이션을 동반한 배포를 롤백하면
> 스키마와 코드가 어긋난 상태가 된다.
>
> 🔴 **T-056 이후 롤백 주의 — USD 비중이 크면 킬스위치가 오발동한다.** 옛 코드로 되돌리면 스냅샷에서 USD 행이 다시 사라져 총액이 그 값만큼 내려가고, 그 순간 24시간 기준선(USD 포함)과 비교된다(옛 코드에는 전환 규칙 E 가 없다). **롤백 전에** 최신 스냅샷의 USD 행 비중을 읽기 전용으로 확인한다. **5% 이상이면(킬스위치 임계 10% 의 절반 — 시장 변동과 겹칠 수 있다) 먼저 킬스위치를 수동 ON** 한 뒤 롤백하고, 롤백 24시간 뒤 기준선이 옛 형식으로 돌아오면 해제 여부를 판단한다. 10% 이상이면 예외 없이 선행 ON 이다. USD 가 작을 때(실측 2.4%)라도 롤백 직후 첫 스냅샷의 킬스위치 결과를 확인한다.
>
> ⚠️ **컷오버 직후 첫 롤백 주의.** 컷오버 이전에 만들어진 릴리스는 옛 `ecosystem.config.js`
> (미러·NFS 를 가리키는 cwd)를 담고 있다. 그리로 롤백하면 재등록이 옛 경로로 떨어져 실패한다.
> 새 ecosystem 으로 만든 릴리스가 2개 이상 쌓인 뒤에 롤백을 연습한다.

### ⚠️ 첫 컷오버에서 `health_failed` 가 났지만 실제로는 정상이었다 (2026-09-19)

```
재등록 완료: stockinvest (/home/brownjeon/apps/stockinvest/releases/20260919-224638-49f01e77)
재등록 완료: stockinvest-cron (…같은 릴리스…)
⚠️  헬스체크 실패 — 자동 롤백한다
RELEASE_RESULT {"status":"health_failed", ... ,"rolled_back_to":"none"}
```

**`rolled_back_to: none` 이 중요하다** — 최초 배포라 되돌아갈 이전 릴리스가 없어
`current` 는 새 릴리스를 가리킨 채로 남았고, 옛 NFS pm2 등록은 이미 지워진 뒤였다.
즉 **판정은 실패인데 시스템은 새 릴리스로 넘어간 상태**였다.

직후 실측한 실제 상태는 정상이었다.

| 확인 | 결과 |
|---|---|
| `pm2 list` | `stockinvest` online · `stockinvest-cron` **정확히 1개** |
| 앱 로그 | `✓ Ready in 207ms` · 포트 3003 LISTEN |
| `/api/health` | **200**, `safetyStatus: "green"`, 안전장치 값이 컷오버 전과 동일 |
| 운영 도메인 | 307 (로그인 리다이렉트 — 정상) |

**원인은 `health.timeout: 30` 이 짧았던 것이다.** Next.js 기동 자체는 빠른데
부팅 시 설정 로딩(KIS 유량·청산 엔진 상태 등)이 이어져 첫 응답까지 30초를 넘겼다.
120초로 올렸다.

> **최초 배포에서 헬스 실패는 위험하다.** 되돌아갈 릴리스가 없어 자동 롤백이 작동하지
> 않는다. 그래서 **첫 컷오버일수록 `health.timeout` 을 넉넉히** 잡아야 한다.
> 실패 판정을 받으면 **반드시 실제 상태(pm2·포트·헬스 본문)를 직접 확인**하고,
> 정상이면 재배포해 릴리스를 2개로 만들어 롤백 경로를 확보한다.

### 흔할 만한 실패와 원인

| 증상 | 원인 | 조치 |
|---|---|---|
| `SSH 접속 불가` | **포트가 22 가 아니다** (이 환경은 **993**) | `deploy.yml` 의 `target.port` 확인 |
| `shared 파일이 없다: .../shared/.env` | 첫 배포 전 `.env` 미배치 | `scp` 로 올린다 (§9) |
| `ref 를 찾을 수 없다` | 커밋이 origin 에 push 되지 않음 / 브랜치명 오기 | push 후 재시도. 이 프로젝트 기본 ref 는 `main` |
| 배포는 됐는데 **옛 코드가 돈다** | `ecosystem.config.js` 의 `cwd` 가 릴리스를 가리키지 않음 | `cwd: __dirname` 으로 고친 뒤 `pm2 delete` → 재배포 |
| `npm ci` ENOENT (`file:` 의존성) | lock 의 상대경로가 릴리스 깊이에서 어긋남 | §1 의 해당 선결 과제 참고 |
| 빌드는 맥에서 되는데 우분투에서 깨진다 | 네이티브 모듈·파일명 대소문자·경로 가정 | **코드가 환경을 가정한 것이다.** Reviewer 재순환 대상 |
| `배포가 이미 진행 중이다` | flock 점유 | 진행 중인 배포를 기다린다. 비정상 종료였다면 `$BASE/.deploy.lock` 확인 |
| `stockinvest-cron` 이 2개 | 컷오버 시 옛 프로세스 미삭제 | 🔴 즉시 중단·보고. 스스로 지우지 않는다 |

---

## 7. 하지 말 것

- ❌ 우분투에 직접 ssh 해서 `pm2` / `git pull` / `npm run build` 조작 — 배포 경로는 하나다
- ❌ `--with-migrate` 자체 판단 사용
- ❌ 사용자 승인 없는 수동 `--rollback`
- ❌ QA PASS 없이 배포
- ❌ 운영 릴리스 디렉토리 직접 편집 — 다음 배포에 사라진다. 편집 대상은 NAS 소스뿐이다
- ❌ 실패를 "환경 문제"로 단정하고 같은 명령 재시도
- ❌ cron 앱을 "어차피 스케줄러니까" 하고 검증에서 빼지 않는다
- ❌ 중복 기동한 cron 중 하나를 임의로 지우지 않는다 — 어느 쪽이 정상인지는 사용자 판단이다
- ❌ 장중 임의 배포 — 사용자 합의 없이 하지 않는다
- ❌ 앱 APK `--publish`·`app_release` INSERT·DDL 을 사용자 승인 없이 — 「앱(APK) 배포」 절의 하지 말 것 참고

---

## 8. 보고 형식

**실측치만 적고, 확인하지 않은 항목은 "미확인"이라고 그대로 적는다.**

```
[배포 — 주식 자동매매 (StockInvest)]
- git log -1 / origin 대비 ahead:
- --dry-run 결과: (대상 호스트·경로·ref)
- RELEASE_RESULT: (JSON 원문 그대로)
- --status 결과: (current 릴리스·pm2·헬스)

[배포 후 확인]
- stockinvest-cron 프로세스 수: (정확히 1이어야 한다)
- KIS 연동 상태:
- 안전장치 상태: 배포 전 → 배포 후
- /api/health:
- 메인 화면 렌더링: 예/아니오
- 두 앱의 pm2 재시작 횟수 변화:

[앱(APK) — 이번 배포에 APK 공개가 있을 때만, 없으면 "해당 없음"]
- apk_version: (versionName / versionCode)
- apk_sha256: (64자 전체)
- 크기(바이트):
- reinstall_required: (true/false — 사용자가 새 APK 를 설치해야 하는가) · 삭제 후 재설치 필요: (예/아니오 — 서명 키가 바뀌었을 때만 예, 원칙상 없어야 한다)
- app_release INSERT: (사용자 승인 원문·실행 시각 / 미실행)
- /app/download/latest.apk 무인증 200·sha256 일치: 예/아니오/미확인
- 보호 경로 유지(/app/download·/app/downloads·/app/download/../api/orders·/api/app/version 무인증): 결과
- 실기기 확인: (사용자 확인 전이면 "대기" — 이 전에는 "완료"라고 쓰지 않는다)

[이상 징후]
- 로그의 ERROR·스택트레이스:
- 그 밖에 예상과 달랐던 것:
```

> ⚠️ VoiceVault 파일럿에서 QA 에이전트 3인이 테스트를 실행하지 않은 채 "PASS·결함 0건"을
> 보고했고 전부 사실이 아니었다. 배포는 운영을 바꾸는 행동이라 같은 일이 벌어지면 피해가
> 즉시 사용자에게 간다. **돌리지 않은 것을 돌렸다고 적지 않는다.**

---

## 9. 최초 컷오버 절차 (1회성)

운영 중인 서비스를 blue/green 구조로 옮기는 단계다. **되돌릴 수 있는 순서로 진행한다.**
`pm2 delete` 는 순간적인 서비스 중단을 동반하고 deployer 의 권한 경계 밖이므로 **사용자가 수행**한다.

```bash
# (1) 운영 루트와 shared 준비
ssh home_ubuntu 'mkdir -p /home/brownjeon/apps/stockinvest/shared'

# (2) .env 배치 — 없으면 첫 배포가 실패한다 (의도된 동작)
scp StockInvest/.env brownjeon@125.177.194.26:/home/brownjeon/apps/stockinvest/shared/.env   # 포트 993 필요 시 -P 993

# (3) 계획 확인 (SSH 하지 않는다)
scripts/deploy.sh StockInvest --dry-run

# (4) 첫 릴리스 전개 + 빌드 + 헬스체크
#     이 시점에는 pm2 가 아직 옛 경로로 돌고 있다 — 운영은 영향받지 않는다
scripts/deploy.sh StockInvest

# (5) 헬스체크 통과를 확인한 뒤에만 pm2 재등록  ← 여기서 짧은 중단이 발생한다
ssh home_ubuntu 'pm2 delete stockinvest; pm2 delete stockinvest-cron; cd /home/brownjeon/apps/stockinvest/current && pm2 startOrReload ecosystem.config.js --only stockinvest --only stockinvest-cron --update-env && pm2 save'

# (6) 확인
scripts/deploy.sh StockInvest --status
ssh home_ubuntu "pm2 jlist | python3 -c \"import sys,json;[print(a['name'],a['pm2_env']['pm_cwd']) for a in json.load(sys.stdin)]\""
#   기대: pm_cwd 가 /home/brownjeon/apps/stockinvest/releases/... 다
```

**실패 시 복귀** — pm2 를 옛 경로로 되돌린다. `apps/` 구조는 남겨둬도 운영에 영향이 없다.

```bash
ssh home_ubuntu 'pm2 delete stockinvest; pm2 delete stockinvest-cron; cd <옛 경로> && pm2 start ecosystem.config.js --only stockinvest --only stockinvest-cron && pm2 save'
```

### 컷오버 완료 판정 — 전부 참일 때만 완료다

- [ ] `scripts/deploy.sh StockInvest --yes` 가 `RELEASE_RESULT {"status":"ok",...}` 로 끝난다
- [ ] `pm2 jlist` 의 `pm_cwd` 가 `/home/brownjeon/apps/stockinvest/releases/...` 다 (stockinvest stockinvest-cron 전부)
- [ ] 운영 실화면이 정상이다 (§5)
- [ ] `--rollback` 으로 이전 릴리스 복귀가 되고, **다시 배포해 원복**했다
      (릴리스가 2개 이상 쌓인 뒤에 한다)
- [ ] `deploy.yml`·`deployer.md`·이 문서가 커밋되고 **푸시**됐다
- [ ] 🔴 `stockinvest-cron` 이 정확히 1개다
- [ ] 안전장치 상태가 컷오버 전후로 동일하다
- [ ] webhook 훅 충돌을 (A) 또는 (B) 로 정리했다 (아래)

> **롤백을 실제로 한 번 돌려보는 것**이 가장 중요하다. 롤백은 사고 났을 때 처음 쓰게 되는데,
> 그때 처음 돌려보면 늦는다.
### ⚠️ webhook 자동배포와의 충돌 정리 (컷오버와 함께)

이 프로젝트는 Gitea webhook 자동배포가 **이미 등록돼 있다** (`project_StockInvest, hook_id 2` → `/home/brownjeon/.local/webhook-deploy/deploy-stockinvest.sh`).
blue/green 으로 컷오버하면서 이 훅을 그대로 두면 **push 한 번에 두 경로가 동시에 배포**된다.

컷오버 시 둘 중 하나를 택한다 — 사용자 판단 사항이다.
- **(A)** 훅 스크립트를 `release.sh` 경유로 교체 ([`../../docs/webhook-deploy-guide.md`](../../docs/webhook-deploy-guide.md))
  → push 만으로 blue/green 배포가 된다
- **(B)** 훅을 비활성화하고 `scripts/deploy.sh` 로만 배포
  → 배포 시점을 명시적으로 통제할 수 있다 (실매매·운영 민감 프로젝트에 권장)


---

## 앱(APK) 배포 — 주식캐기 (T-084)

> 앱은 운영 웹(`server.url`)을 띄우는 껍데기라 **웹 변경 = 웹 배포**(위 §2~§6)다. APK 는 **네이티브 변경**
> (`android/**`·`capacitor.config.ts`·`AndroidManifest.xml`·Gradle 설정·`@capacitor/*` 추가·버전·`public/app-shell/index.html`·아이콘 리소스)이
> 있거나 처음 공개할 때만 만든다. 구조·결정은 [`mobile-app-procedure.md`](./mobile-app-procedure.md), 실행 주체는 [`deployer.md`](../.claude/agents/deployer.md) `<apk_release>`.
> 이 절의 승인 게이트(DDL·`--publish`·INSERT)는 **각각 사용자 명시 승인**이 필요하다 — QA PASS 나 웹 배포 승인으로 대신하지 않는다.

### 순서 (첫 공개 기준 — 이후 공개는 ③부터)

| # | 단계 | 게이트 | 확인 |
|---|---|---|---|
| ① | `scripts/migrations/T-084-app-release.sql` 적용 — **장외 창, 웹 코드 배포보다 먼저** | 사용자 명시 승인(실행: Leader 또는 deployer, 승인 원문을 task 에 기록). `--with-migrate` 는 `deploy.yml` 에 migrate 가 없어 거부되므로 사람이 `mysql … < scripts/migrations/T-084-app-release.sql` 로 적용 | `CREATE TABLE IF NOT EXISTS` 라 멱등. 적용 뒤 `SHOW CREATE TABLE app_release` — CHECK **9개**(`chk_app_release_*`) — 개수만으로는 옛 DDL 로 만든 테이블과 구별되지 않으니 `chk_app_release_code` 식이 **`version_code <= 2100000000`**, `chk_app_release_size` 식이 **`size_bytes <= 9007199254740991`** 을 포함하는지도 본다(R4)·UNIQUE 2개(`uq_app_release_code`·`uq_app_release_file`)·`apk_file`·`sha256`·`cert_sha256` **3열이 `ascii_bin`**, `SELECT COUNT(*) FROM app_release` = 0 |
| ② | 웹 코드 배포(push = blue/green, 위 §2~§6) | 기존 웹 배포 게이트(QA PASS·장외) | 순서를 어겨 새 코드가 테이블보다 먼저 떠도 `/api/app/version` 503 `not_migrated`·`/app/download/*` 404 라 무해하다 — 그래도 ①→② 를 지킨다 |
| ③ | `bash scripts/build-apk.sh --publish > <로그> 2>&1; echo $?` — **우분투**, 배포한 커밋과 같은 내용에서 | 사용자 명시 승인 | 종료 코드 0. 로그에 서명 지문 일치·debuggable no·권한 화이트리스트·비밀 검사 통과. APK 는 저장소 밖 `APP_RELEASE_DIR`(기본 `/home/brownjeon/apps/stockinvest/shared/app-releases`, 없으면 이 명령이 만든다)에 `stockinvest-<versionName>.apk` 로 복사되고, **같은 이름·다른 내용이면 거부**된다. 마지막에 INSERT SQL 이 **출력만** 된다 |
| ④ | 출력된 `INSERT INTO app_release …` 실행 | **사용자 명시 승인**(③ 승인과 별개). `min_supported`(필수 업데이트 기준, 출력 기본 0)·`notes` 를 바꿀지도 이때 사용자에게 확인 | 실행 전 `sha256sum $APP_RELEASE_DIR/stockinvest-<v>.apk` = SQL 의 sha256, `SELECT MAX(version_code) FROM app_release` < 새 versionCode |
| ⑤ | 공개 확인(아래 명령) | — | 전 항목 기대값과 같을 때만 다음으로 |
| ⑥ | 사용자 설치 안내 → **실기기 확인** | 사용자 | [`mobile-app-procedure.md`](./mobile-app-procedure.md) §9-C. 사용자 확인 전에는 "완료"라고 보고하지 않는다 |

③ 전에 확인할 것:
- 빌드할 트리가 배포한 커밋과 같은가 — `git rev-parse HEAD` = 배포 커밋, `git status --short -- android capacitor.config.ts public/app-shell package.json package-lock.json scripts/build-apk.sh` 가 비어 있는가(다른 세션의 미커밋 네이티브 변경이 APK 에 섞이지 않게).
- `android/app/build.gradle` 의 `stockVersionCode` 가 직전 공개본보다 크고 `stockVersionName` 도 새 값인가(같으면 developer 반송).
- 연결 실패 화면(`public/app-shell/index.html`)·아이콘·스플래시가 **승인된 디자인**인가 — 자리표시자 화면·Capacitor 기본 아이콘이 든 APK 는 공개하지 않는다(`--publish` 는 이것을 막지 못한다).
- 운영 `shared/.env` 에 `APP_RELEASE_DIR` 를 따로 두었다면 ③ 에도 같은 값을 준다(서버와 빌드 스크립트의 기본값은 같다). 현재 운영 값은 **미확인**.

⑤ 공개 확인(무인증 요청, `B=https://stock.xn--lh0b87pnudm10a4vd.com`):

```bash
curl -sS -D /tmp/apk.h -o /tmp/apk.bin "$B/app/download/latest.apk"; head -1 /tmp/apk.h; grep -i '^content-length' /tmp/apk.h; sha256sum /tmp/apk.bin
#   기대: 200 · Content-Length = app_release.size_bytes · sha256 = app_release.sha256
for p in /app/download /app/downloads /api/app/version; do printf '%s ' "$p"; curl -s -o /dev/null -w '%{http_code}\n' "$B$p"; done
curl -s --path-as-is -o /dev/null -w '%{http_code}\n' "$B/app/download/../api/orders"
#   기대: 페이지 경로는 307(로그인), /api/* 는 401 — 200·파일 본문이 나오면 즉시 중단·보고(공개 범위가 넓어진 것)
```

- 로그인한 화면에서 설정 › 앱 (안드로이드)에 새 버전·sha256 앞 8자가 보이는지(웹), 낮은 versionCode 앱에서 업데이트 띠가 뜨는지(실기기) 확인한다.
- nginx(ModSecurity)를 거친 실서비스 다운로드는 T-084 감사에서 재현하지 못했다 — 첫 공개 때 위 `curl` 결과가 그 첫 확인이다.

⑥ 사용자 안내에 넣을 것: 받을 곳(휴대폰 Chrome → 설정 › 앱 (안드로이드) → [APK 내려받기], 앱 안이면 업데이트 띠 [받기]) · 버전·바뀐 점 · **재설치 필요 여부**(네이티브 변경이면 새 APK 를 설치해야 한다 — 같은 키로 서명돼 있어 덮어 설치되고 로그인은 남는다. "앱이 설치되지 않았습니다"가 나오면 삭제 후 재설치·재로그인) · Chrome 이 **"유해할 수 있는 파일입니다"** 라고 물으면 [다운로드](플레이스토어 밖 앱이라 매번 뜬다 — 이 확인에서 멈춘 듯 보일 수 있다, TheKaiwa 실측) · 처음 한 번 "출처를 알 수 없는 앱 설치" 허용.

### 롤백

| 대상 | 방법 |
|---|---|
| 배포본(업데이트 띠·`latest.apk`) | 최신 `app_release` 행 삭제 — `DELETE FROM app_release WHERE version_code = <되돌릴 코드>;`(**INSERT 때 받은 승인과 별도로 롤백 시점에 사용자 명시 승인**). 그 아래 행이 다시 최신이 되어 띠·`latest.apk` 가 이전 배포본을 가리킨다. **APK 파일은 지우지 않는다**(행이 없으면 `/app/download` 는 404) |
| 이미 설치된 앱 | 더 낮은 versionCode 는 덮어 설치되지 않는다 — 이전 소스를 **더 높은 versionCode** 로 다시 빌드해 공개하거나, 삭제 후 재설치 |
| 웹 | 기존 절차(§6, `--rollback` 은 사용자 지시 시). 코드 롤백이면 `/app/download/` 공개도 함께 사라진다(정상). `app_release` 테이블은 되돌아가지 않지만 옛 코드는 읽지 않아 무해 |
| 테이블 자체 | 앱 기능을 통째로 철회할 때만 `DROP TABLE IF EXISTS app_release;`(사용자 승인) |

### 하지 말 것

- ❌ 자리표시자 화면·미승인 아이콘이 든 APK 공개
- ❌ `versionCode` 증가 없이 네이티브 변경을 배포·공개(웹 배포로는 앱에 반영되지 않는다)
- ❌ 디버그 키로 서명, 서명 비밀(`stockinvest-signing.env`·키스토어 비밀번호)을 출력·로그·문서에 남기기
- ❌ 사용자 승인 없이 `--publish`, 사용자 승인 없이 `app_release` INSERT·DELETE·DDL
- ❌ APK·키스토어를 저장소 안에 두거나 커밋
- ❌ 실기기 확인 전에 "앱 배포 완료" 보고

---

## 10. 부록 — 경로·값 표

| 용도 | 값 |
|---|---|
| 편집 대상(유일한 SSOT) | `/Volumes/homes/brownjeon/project/StockInvest` (맥) / `/home/brownjeon/NFS/homes/brownjeon/project/StockInvest` (리눅스) |
| 맥 개발 실행 | `~/.node-local/stockinvest/` (`.devmirror` 없음 — 수동 관리) |
| 운영 경로 | `/home/brownjeon/apps/stockinvest/current` |
| 릴리스 보관 | `/home/brownjeon/apps/stockinvest/releases/` (최근 5개) |
| 릴리스 간 유지 | `/home/brownjeon/apps/stockinvest/shared/` |
| pm2 앱 | `stockinvest` + `stockinvest-cron` (**2개**) |
| 포트 | 3003 (헬스체크는 web 앱만 본다) |
| 헬스 | `GET /api/health` — ⚠️ web 앱만 판정한다. cron 앱은 pm2 상태로만 확인된다 |
| 운영 도메인 | https://stock.미라클펭귄.com |
| 저장소 / ref | Gitea `project_StockInvest` / `main` |
| 우분투 호스트 | `home-dev-x600` `125.177.194.26` · **sshd 993 포트** |
| DB | `192.168.219.154:3306` — **개발과 운영이 공유** |
| 매니페스트 | [`../deploy.yml`](../deploy.yml) |
| 실행 주체 | [`../.claude/agents/deployer.md`](../.claude/agents/deployer.md) |
| 앱 APK 공개 위치 | `/home/brownjeon/apps/stockinvest/shared/app-releases/`(`APP_RELEASE_DIR` 기본값, 릴리스 prune 과 무관) |
| 앱 APK 빌드 작업 디렉터리 | `~/.node-local/stockinvest-apk`(로그 `logs/`, 산출물 `out/stockinvest-<versionName>-<versionCode>.apk`) |
| 앱 서명 키(경로만) | `~/.android/stockinvest-release.keystore` · `~/.android/stockinvest-signing.env`(600) · 백업 `NFS/homes/brownjeon/backup/android-signing/stockinvest/` |
