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
