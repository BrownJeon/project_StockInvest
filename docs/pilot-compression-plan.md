# 파일럿 압축 계획 (Pilot Compression Plan)

> 최종 결정일: 2026-04-19
> 결정 주체: 사용자 + leader 에이전트 협의
> 근거: 암호화폐 유동성·24/7 특성을 고려한 일정 공격적 단축. 단, 검증 부족분은 **자산 변동폭 실시간 가드**로 보완.

---

## 1. 요약

기존 [trading-strategy.md](trading-strategy.md) § 4·5 의 단계별 진입 체계(검증 1주 → 파일럿 1주 → 정식 ~ → Stage 2~4 각 2주)를 다음과 같이 극단 압축한다.

- **수동 단계 총 6시간** (검증 3h + 파일럿 3h, D1 하루에 완료)
- **정식 수동 단계 삭제** → Stage 2 직행
- 보완 안전장치로 **자산 변동폭 모니터(Portfolio Volatility Guard)** 신규 도입

총 정식 자동매매(Stage 4) 진입까지 **약 3영업일**.

---

## 2. 새 일정

| Day · 시간 | 단계 | 주문 한도 | 최소 실주문/시그널 | 통과 조건 |
|-----------|------|-----------|-------------------|-----------|
| D1 09:00~12:00 (3h) | 검증 수동 | `ORDER_MAX=10,000` / `DAILY=50,000` | **3회** | 체결·DB 기록·API 응답 매핑 0건 누락 |
| D1 13:00~16:00 (3h) | 파일럿 수동 | `ORDER_MAX=50,000` / `DAILY=300,000` | **5회** | `DAILY_ORDER_MAX_KRW` 경계 1회 이상 접촉 |
| ~~정식 수동~~ | **삭제** | — | — | 변동폭 가드가 상시 대체 |
| D2 | Stage 2 시그널 알림 | `ORDER_MAX=300,000` / `DAILY=1,500,000` | **시그널 15회** | 백테스트 vs 라이브 예측 일치도 ±10% 내 |
| D3 | Stage 3 반자동 승인 | 위 유지 | **승인-주문 10회** | 오발동 0건 |
| D4+ | Stage 4 전면 자동 | 위 유지 | — | 진입 |

### 압축의 근거
- crypto 유동성으로 슬리피지·체결 불확실성 낮음
- 24/7 거래라 주말 포함 관찰 가능
- 한도 증액 간격(일 단위) 대신 시간 단위로 단축

### 압축의 한계
- 야간·장기 누적 버그는 6시간 내 발견 불가 → 변동폭 가드가 2차 방어선

---

## 3. 자산 변동폭 모니터 (Portfolio Volatility Guard)

### 3.1 데이터 모델

```sql
CREATE TABLE portfolio_snapshots (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  ts DATETIME NOT NULL,
  total_krw BIGINT NOT NULL,               -- KRW 환산 총자산
  positions JSON NOT NULL,                 -- [{symbol, qty, avg_price, krw_value}, ...]
  source VARCHAR(20) DEFAULT 'hourly',     -- 'hourly' | 'order' | 'manual'
  INDEX idx_ts (ts DESC)
);
```

수집 시점:
- **매시간 정각** — **NAS cron**이 `POST /api/cron/portfolio-snapshot` 호출 (확정)
- **모든 주문 체결 직후** (source='order')
- **대시보드 접속 시마다** (source='dashboard') — **Phase 2에서 이미 구현**. `/api/portfolio` 호출 시 자동 INSERT. 오늘 00:00 KST 기준 직전 스냅샷을 조회해 대시보드 "포트폴리오 오늘" 지표에 활용

NAS cron 선택 근거: 배포 환경이 NAS이고, Next.js 서버 재시작·핫리로드·crash와 무관하게 스케줄이 살아 있어 `setInterval`보다 안정적. `systemd timer`도 대안이나 NAS cron이 설정 단순함.

### 3.2 변동률 계산

스냅샷 저장 직후 다음 3개 계산:
- `change_1h` = (current − 1시간 전) / 1시간 전 × 100
- `change_6h` = (current − 6시간 전) / 6시간 전 × 100
- `change_24h` = (current − 24시간 전) / 24시간 전 × 100

### 3.3 3단계 임계치·액션

| 임계 | 1h | 6h | 24h | 액션 |
|------|----|----|----|------|
| **경고** | -2% | -5% | -8% | 알림(Slack/이메일). 주문 계속 |
| **블록** | **-4%** | **-8%** | **-12%** | 신규 주문 차단 (`KILL_SWITCH=true`). 기존 포지션 유지. 수동 해제까지 |
| **패닉 청산** | **-7%** | **-12%** | **-18%** | 전 포지션 50% 시장가 매도 + `KILL_SWITCH=true` |

임계치는 `.env`로 조정 가능:
- `VOL_GUARD_WARN_1H`, `VOL_GUARD_BLOCK_1H`, `VOL_GUARD_PANIC_1H`
- `VOL_GUARD_WARN_6H`, `VOL_GUARD_BLOCK_6H`, `VOL_GUARD_PANIC_6H`
- `VOL_GUARD_WARN_24H`, `VOL_GUARD_BLOCK_24H`, `VOL_GUARD_PANIC_24H`

### 3.4 심볼별 개별 모니터 + 배율

**확정**: 심볼마다 변동성이 다르므로 **배율**을 곱해 임계치를 조정한다. 포트폴리오 전체 임계치(§3.3)는 그대로 두고, 단일 심볼 임계치에만 배율 적용.

| 심볼 | 배율 | 근거 |
|------|------|------|
| KRW-BTC | 1.0x | 기준 (일반적으로 가장 낮은 변동성) |
| KRW-ETH | 1.3x | BTC 대비 역사적 변동성 약 1.2~1.5배 |
| 신규 편입 시 | 기본 1.5x | 편입 후 30일 관측 데이터로 재조정 |

배율은 `.env`로 조정 가능: `VOL_GUARD_SYMBOL_SCALE_KRW_BTC=1.0`, `VOL_GUARD_SYMBOL_SCALE_KRW_ETH=1.3`.

포트폴리오 전체 외에 단일 심볼 급락도 감지:
- 단일 심볼 기본 **1시간 -10% 초과**(배율 적용 시 BTC -10%, ETH -13%) → 해당 심볼 포지션 50% 청산 + 해당 심볼 주문 차단
- 개별 토큰 급락(상장 폐지·해킹·러그풀·특정 이벤트) 대응

---

## 4. 구현 파일

| 파일 | 상태 | 역할 |
|------|------|------|
| `src/lib/safety/asset-profile.ts` | **신규** | 자산 클래스(crypto/stock) 프로파일 상태 판정. 현재 Stage(`verify`·`pilot`·`stage2+`) 반환 — §9 참조 |
| `src/lib/safety/volatility-guard.ts` | **신규** | 핵심 로직: 스냅샷 조회·변동률 계산·임계 판정·액션 |
| `src/lib/safety/kill-switch.ts` | 확장 | `tripBy(reason: string)` 함수 추가 — 변동폭 가드가 호출 |
| `src/lib/safety/order-limits.ts` | 확장 | `submitOrder()` 체크 순서에 `checkVolatilityGuard()` 주입 |
| `src/app/api/cron/portfolio-snapshot/route.ts` | **신규** | 매시간 cron 진입점 (Next.js API Route). **NAS cron이 HTTP로 호출** |
| `src/lib/db.ts` | 확장 | `portfolio_snapshots` 테이블 생성 (**Phase 2 완료**). cron 수집 CRUD 헬퍼는 V0.3에서 확장 |
| `docs/db-schema.md` | 수정 | `portfolio_snapshots` 테이블 스키마 추가 |
| `docs/architecture.md` | 수정 | 변동폭 가드 레이어 다이어그램 |
| `docs/trading-strategy.md` | 수정 | § 4·5·7·8 (아래 5장 참고) |
| `.env.example` | 수정 | `VOL_GUARD_*` 환경변수 기본값 추가 |

### 4.1 submitOrder() 체크 순서 (수정 후)

1. `DRY_RUN` 확인
2. `KILL_SWITCH` 확인
3. 심볼 화이트리스트 (`ALLOWED_SYMBOLS`)
4. `ORDER_MAX_KRW` 확인
5. `DAILY_ORDER_MAX_KRW` 확인 *(Phase 3에서 실제 집계 구현 예정)*
6. **`checkVolatilityGuard()` 추가 — 블록 상태면 거부**

---

## 5. trading-strategy.md 수정 TODO

구현 전 또는 구현과 동시에 아래 항목 문서 반영:

- [ ] **§ 4 Stage 진입 체크리스트**: "최소 2주" → "최소 3~24시간 + 주문·시그널 횟수 조건 + 변동폭 가드 가동 확인"
- [ ] **§ 5 초기 주문 한도 표**: 시간 단위로 재작성 (3h 검증 / 3h 파일럿 / Stage 2+)
- [ ] **§ 7 Kill Switch**: 변동폭 임계치 3단계(경고·블록·패닉) 추가, 심볼별 -10% 조건 추가, 자동 주문 폭주 탐지 추가
- [ ] **§ 8 성과 지표**: 변동폭 가드 발동 횟수(경고·블록·패닉), 블록 해제 평균 소요 시간 항목 추가

---

## 6. 검증 절차 (구현 완료 후)

1. **스냅샷 수집 정확성** — 1h 간격 3회 수집 시 `ts` 편차 ≤ 5분
2. **변동률 계산 단위 테스트** — Jest로 고정 데이터 3세트 검증
3. **임계치 판정** — 모의 스냅샷으로 경고·블록·패닉 3단계 각 발동 확인
4. **`submitOrder()` 차단 회로** — 블록 상태에서 호출 시 거부 반환 확인
5. **패닉 청산** — 모의 트리거 → 전 포지션 50% 시장가 주문 생성 확인
6. **D1 실행 체크리스트**
   - 09~12 검증 3회 실주문 + 스냅샷 2회 이상
   - 13~16 파일럿 5회 실주문 + DAILY 경계 접촉 1회 이상
   - 16시 체크리스트 통과 시 D2(Stage 2) 진입 승인
7. **D2~D4 각 단계 통과 조건 점검** — 표본 수·일치도·오발동 0건

각 단계에서 **한 번이라도 체크리스트 미달 시 해당 단계 기간 2배 연장**.

---

## 7. 이 계획이 잡지 못하는 리스크 (감수 항목)

1. **주간 패턴(주말·공휴일) 버그** — 3일 일정 내 포함 안 될 수 있음. 변동폭 가드가 24/7 작동하므로 1차 방어 가능
2. **장기 드리프트 버그** — 평균가·수수료 반영 누적 오차. 월간 정기 감사 루틴 별도 필요
3. **극단 블랙스완** — LUNA·FTX급 급락은 패닉 청산으로 손실 상한 제한되나 완전 회피 불가

---

## 8. 다음 세션 착수 지점 (Claude/사용자 공용)

### 구현 순서 권장

1. `docs/db-schema.md` 와 `docs/architecture.md` 문서 먼저 갱신 (스펙 확정)
2. `src/lib/db.ts` 의 `portfolio_snapshots` CRUD 추가 — **테이블 생성·dashboard 저장·오늘 00:00 조회는 Phase 2에서 이미 완료**. V0.3에서는 cron 호출 시 매시간 저장 로직만 추가
3. `src/lib/safety/asset-profile.ts` 작성 + Jest 단위 테스트 (§9)
4. `src/lib/safety/volatility-guard.ts` 작성 + Jest 단위 테스트
5. `src/lib/safety/kill-switch.ts` 의 `tripBy()` 확장
6. `src/lib/safety/order-limits.ts` 의 `submitOrder()` 에 가드 + 프로파일 기반 단계 한도 적용
7. `src/app/api/cron/portfolio-snapshot/route.ts` 작성
8. `.env.example` 에 `VOL_GUARD_*` · `ASSET_PROFILE_*` 추가 (ASSET_PROFILE은 설계 단계에서 이미 추가됨)
9. `docs/trading-strategy.md` 의 § 4·5·7·8 수정 (문서 일관성)

### 사전 확인 사항

- Phase 2 완료 여부 (시세·잔고 조회가 있어야 스냅샷 수집 가능)
- `DAILY_ORDER_MAX_KRW` 집계 구현 여부 (Phase 3 목표)
- cron 인프라 선택: Next.js API Route + 외부(Vercel Cron / NAS cron / systemd timer) vs 서버 내 `setInterval`

### 확정된 결정 (2026-04-19)

| # | 항목 | 확정 | 근거·후속 |
|---|------|------|-----------|
| 1 | 변동폭 가드 1h 임계치 | 경고 -2% / 블록 -4% / 패닉 -7% (§3.3 초안 유지) | BTC·ETH 일반 변동에 합리적. Phase 2 시세 실데이터로 1개월 관측 후 analyst가 재조정 권고 |
| 2 | cron 인프라 | NAS cron → `POST /api/cron/portfolio-snapshot` | NAS 배포 환경과 정합. 서버 재시작·크래시 무관. `systemd timer`는 대안으로 유지 |
| 3 | 패닉 청산 비율 | **50%** (§3.3 초안 유지) | 손실 제한과 반등 기회 유지의 균형점. 50%로 2회 이상 발동 후에도 지속 하락이면 수동 추가 청산 검토 |
| 4 | 심볼별 임계치 프리셋 | **심볼별 배율** (BTC 1.0x / ETH 1.3x) | §3.4 참조. 신규 편입 심볼은 기본 1.5x로 시작 → 30일 관측 후 재조정 |
| 5 | 자산 클래스별 절차 변형 | 프로파일 시스템 도입 — crypto는 검증 스킵 가능 | §9 참조. 첫 라이브 주문 1회 성공 후 자동 ON, 사용자 설정으로 override 가능 |

---

## 9. 자산 클래스 프로파일 (Asset Class Profile)

### 9.1 배경

암호화폐는 변동성이 주식 대비 높고 24/7 거래되므로, 고정된 "검증 3h → 파일럿 3h" 진입 절차가 시장 타이밍을 놓치게 할 수 있다. 반면 주식(KIS, 미국주식)은 장시간 제한·수동 승인 관행이 있어 기존 검증 절차가 오히려 적합하다.

→ **자산 클래스별로 절차를 다르게** 가져갈 수 있는 프로파일 계층을 도입한다. 기존 §2 일정표와 trading-strategy.md §4 Stage 체계는 **그대로 유지**하고, 그 위에 "스킵 허용 여부" 플래그만 얹는다.

### 9.2 프로파일 정의

| 프로파일 | 대상 거래소 | 검증 단계 기본 | 스킵 허용 |
|----------|-------------|-----------------|-----------|
| `crypto` | coinone / upbit(확장) / binance | **스킵 가능** (자동 ON 조건 충족 시) | 예 |
| `stock` | KIS (미국주식) | **필수** (기존 절차 준수) | 예 (사용자 명시 override 시) |

### 9.3 상태 판정 규칙

설정 소스 우선순위: **환경변수 > 자동 판정**. 환경변수 미지정 시 자동 판정 규칙 적용.

환경변수 `ASSET_PROFILE_CRYPTO_SKIP_VERIFY` 허용값:
- `true` — 강제 스킵 ON
- `false` — 강제 스킵 OFF (안전 모드)
- `auto` (**기본값**) — 아래 자동 판정 규칙 적용

**자동 판정 규칙** (`auto`일 때):
- `orders` 테이블에서 해당 자산 클래스의 **체결 성공 주문이 1건 이상** 있으면 스킵 ON
- 아직 없으면 OFF (최초 설치 후 첫 실주문 전까지는 검증 진입)

주식 프로파일(`ASSET_PROFILE_STOCK_SKIP_VERIFY`)은 기본 `false`. 사용자가 명시적으로 `true`로 바꾸지 않는 한 기존 절차 유지.

### 9.4 적용 지점

`src/lib/safety/asset-profile.ts`가 다음 두 함수를 export:

```ts
export async function getCurrentStage(assetClass: 'crypto' | 'stock'):
  Promise<'verify' | 'pilot' | 'stage2_plus'>;

export async function isVerifySkipActive(assetClass: 'crypto' | 'stock'):
  Promise<boolean>;
```

`submitOrder()`가 `ORDER_MAX_KRW`/`DAILY_ORDER_MAX_KRW`를 적용하기 전에 현재 Stage를 조회해 해당 단계의 한도로 치환한다.

### 9.5 변경 가능성

- 현재는 환경변수 기반 — 변경하려면 `.env` 수정 후 서버 재기동
- **Phase 5+에서 DB 테이블(`asset_profiles`)로 이관** → 최소 설정 UI 제공 → 사용자가 런타임에 전환 가능
- 이관 후에도 환경변수는 "긴급 오버라이드" 용도로 유지

### 9.6 안전장치와의 상호작용

- 검증 스킵 ON이어도 Kill Switch·DRY_RUN·ORDER_MAX·ALLOWED_SYMBOLS·Volatility Guard는 **전부 작동**
- 스킵되는 것은 "Stage 1 → 2 진입을 위한 소액 실주문 체크리스트" 뿐
- 첫 실주문 실패(거부·에러) 누적 시 자동 판정은 여전히 OFF 유지 → 이력이 없으므로 안전

### 남은 사전 확인

- [ ] Phase 2 완료 여부 — 시세·잔고 조회가 있어야 스냅샷 수집 가능
- [ ] `DAILY_ORDER_MAX_KRW` 실제 집계 구현 여부 (Phase 3 목표)
