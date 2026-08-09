/**
 * T-012 — `price=0` 오염 스냅샷 정리 (1회성 부팅 마이그레이션).
 *
 * **2회차(round 2)가 있는 이유**: 1회차 목록(12행)은 2026-08-09 16:1x 측정 시점의 스냅샷이다.
 * 그 뒤로도 `/api/portfolio` 의 `?? 0` 버그가 18:06 배포 전까지 라이브였기 때문에 오염 행이
 * 계속 늘었다. 잔여 4행(3708·3732·3733·3739)은 **승인된 12행 목록을 넓히지 않고** 별도 마커의
 * 2차 마이그레이션으로 정리한다 — 이미 승인·감사된 목록을 사후에 바꾸면 "승인된 것"과 "실행된
 * 것"이 달라지기 때문이다. 로직은 1회차와 완전히 동일하며(아래 `purgeByIds`), 마커·아카이브
 * 키만 다르다.
 *
 * ## 왜 "플래그"가 아니라 "삭제"인가
 *
 * 세 선택지를 놓고 판단했다.
 *
 *  - **방치**: 오늘자 4행(3558·3591·3599·3628)은 지금도 24h median·킬스위치 기준선·
 *    변동성 가드가 읽는 창 안에 있다. 4월~5월 8행은 라이브 창 밖이지만 analytics 자산곡선에
 *    없던 -22% 급락과 회복을 그려 넣는다. 둘 다 남길 이유가 없다.
 *  - **플래그(valid 컬럼 추가)**: 12행을 위해 스키마를 바꾸고, 이 테이블을 읽는 **9개 쿼리**
 *    (kill-switch ×2, volatility-guard ×3, analytics ×3, trade-report ×2, portfolio ×1)에
 *    전부 `AND valid=1` 을 넣어야 한다. 하나라도 빠뜨리면 안전장치는 여전히 오염값을 읽는데
 *    문서상으로는 "처리 완료"가 된다 — 12행짜리 정리에 그 위험은 남는 이득보다 크다.
 *  - **삭제(채택)**: `portfolio_snapshots` 는 약 4분 간격으로 재생성되는 파생 텔레메트리다
 *    (3.5개월 2,954행). 12행은 0.4% 이고, 각 행의 몇 초~몇 분 옆 이웃 행이 같은 정보를
 *    올바르게 담고 있다. 분석적으로 잃는 것이 없다.
 *
 * 삭제는 되돌릴 수 없으므로 **지우기 전에 원본 전체를 `system_config` 에 JSON 으로 보관**한다.
 *
 * ## 안전 장치
 *
 *  1. 대상은 id **명시 목록**뿐이다. 조건 검색으로 지우지 않는다.
 *  2. 각 행을 다시 읽어 `qty>0 && price<=0` 인 보유가 **실제로 있는지** JSON 파싱으로
 *     재검증한다. 재검증에 실패한 행은 건너뛰고 로그만 남긴다(삭제하지 않는다).
 *  3. `DELETE ... WHERE id=? AND total_krw=?` — 값이 다르면 아무것도 지우지 않는다.
 *  4. 대상이 없으면 `{ skipped }` 를 돌려 마커를 남기지 않는다(재실행 안전).
 */
import type { RowDataPacket } from 'mysql2';

/** `system_config` 마커 키 — db.ts 의 `runOnceMigration` 이 이 값으로 재실행을 막는다. */
export const ZERO_PRICE_SNAPSHOT_MARKER = 'migration_t012_zero_price_snapshots';

/** 삭제 전 원본을 보관하는 키. */
export const ZERO_PRICE_SNAPSHOT_ARCHIVE = 'archive_t012_zero_price_snapshots';

/**
 * 삭제 대상 — 2026-08-09 전체 이력 조회로 오염이 확인된 12행.
 * 전부 `source='dashboard'` 이며 각 행의 Σvalue_krw 는 total_krw 와 정확히 일치한다
 * (= 0원으로 읽힌 종목이 총액에서 그대로 빠졌다는 뜻).
 * 총액 과소 폭: id 3558/3591/3599 -73.7%, 1186 -22.1%, 1224 -23.6%, 1276 -23.1%,
 * 1313 -15.4%, 1287 -10.3%, 1425 -8.5%, 1149 -5.4%, 3628 -6.8%, 1077(구 FX 오류 구간).
 */
export const ZERO_PRICE_SNAPSHOT_IDS = [
  1077, 1149, 1186, 1224, 1276, 1287, 1313, 1425, 3558, 3591, 3599, 3628,
] as const;

// ─── 2회차 (round 2) — 1차 측정 이후 배포 전까지 새로 쌓인 잔여 4행 ─────────────

/** `system_config` 마커 키 — 1회차와 **반드시 달라야** 한다(같으면 둘 중 하나만 실행된다). */
export const ZERO_PRICE_SNAPSHOT_MARKER_R2 = 'migration_t012b_remaining_zero_price_snapshots';

/**
 * 2회차 아카이브 키. 1회차와 **분리**한다 — 두 마이그레이션은 마커가 달라 서로 다른 부팅에서
 * 실행될 수 있고, 감사 시 "어느 승인 건으로 지운 행인지"가 키만 보고 구분돼야 한다.
 */
export const ZERO_PRICE_SNAPSHOT_ARCHIVE_R2 = 'archive_t012b_remaining_zero_price_snapshots';

/**
 * 2회차 삭제 대상 — 2026-08-09 전체 이력 재조회로 확인된 잔여 4행. **이 4개뿐이다.**
 *
 * 전부 `source='dashboard'`, 16:58~17:14 KST 기록(18:06 수정 배포 이전).
 * 각 행마다 `Σvalue_krw == total_krw` 가 성립 = 0원으로 읽힌 종목이 총액에서 그대로 빠졌다.
 *
 * | id   | 0원 종목      | total_krw  | 중앙값 대비 |
 * |------|---------------|------------|-------------|
 * | 3708 | `NYS:ORCL` ×6 | 17,126,702 | -6.8%       |
 * | 3732 | `NAS:SNPS` ×23|  4,828,256 | **-73.7%**  |
 * | 3733 | `NYS:ORCL` ×6 | 17,126,702 | -6.8%       |
 * | 3739 | `NYS:ORCL` ×6 | 17,126,702 | -6.8%       |
 *
 * 운영 DB 전수 재검증(2026-08-09, SELECT only): 전체 3,595행 중 `qty>0 && price<=0` 인 행은
 * 1회차 12행 + 이 4행 = **정확히 16행**이며 그 밖에는 없다.
 */
export const ZERO_PRICE_SNAPSHOT_IDS_R2 = [3708, 3732, 3733, 3739] as const;

/** 조건 미충족 — 실패가 아니다. 마커를 남기지 않는다. */
export interface MigrationSkipped { skipped: string }

export interface SqlExecutor {
  query(sql: string, params?: unknown[]): Promise<unknown>;
}

/** 아카이브에 보관되는 행의 모양. 병합 시 id 를 키로 쓴다. */
interface ArchivedRow {
  id:        number;
  ts:        string;
  total_krw: number;
  source:    string;
  positions: unknown;
}

interface SnapshotRow extends RowDataPacket {
  id:        number;
  ts:        Date;
  total_krw: number;
  positions: string | unknown;
  source:    string;
}

/** 이 행이 정말 "보유 중인데 단가 0" 항목을 담고 있는가. */
export function hasZeroPricedHolding(positions: unknown): boolean {
  const parsed: unknown = typeof positions === 'string'
    ? safeParse(positions)
    : positions;
  if (!Array.isArray(parsed)) return false;
  return parsed.some((p) => {
    if (!p || typeof p !== 'object') return false;
    const rec = p as Record<string, unknown>;
    const qty   = Number(rec.qty);
    const price = Number(rec.price);
    return Number.isFinite(qty) && qty > 0 && (!Number.isFinite(price) || price <= 0);
  });
}

function safeParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
}

export interface CleanupDeps {
  db: SqlExecutor;
  logger?: Pick<Console, 'log' | 'warn'>;
}

/** 한 회차의 정의 — 대상 id·아카이브 키·로그 태그만 다르고 절차는 완전히 동일하다. */
interface PurgeSpec {
  /** 로그 접두사 (`t012` / `t012b`) */
  tag:        string;
  ids:        readonly number[];
  archiveKey: string;
  reason:     string;
}

const SPEC_R1: PurgeSpec = {
  tag:        't012',
  ids:        ZERO_PRICE_SNAPSHOT_IDS,
  archiveKey: ZERO_PRICE_SNAPSHOT_ARCHIVE,
  reason:     'T-012 price=0 오염 스냅샷 (보유 종목이 0원으로 평가되어 총액이 과소 기록됨)',
};

const SPEC_R2: PurgeSpec = {
  tag:        't012b',
  ids:        ZERO_PRICE_SNAPSHOT_IDS_R2,
  archiveKey: ZERO_PRICE_SNAPSHOT_ARCHIVE_R2,
  reason:
    'T-012 2회차 — 1차 측정 이후 배포 전까지 추가로 쌓인 price=0 오염 스냅샷 '
    + '(보유 종목이 0원으로 평가되어 총액이 과소 기록됨)',
};

/**
 * 오염 스냅샷 아카이브 후 삭제 — **1회차(승인된 12행)**.
 * `runOnceMigration` 에서 1회만 실행된다.
 * 예외는 호출부(`runOnceMigration`)가 삼키고 마커를 남기지 않으므로 다음 부팅에 재시도된다.
 */
export async function purgeZeroPriceSnapshots(
  deps: CleanupDeps,
): Promise<void | MigrationSkipped> {
  return purgeByIds(deps, SPEC_R1);
}

/**
 * 오염 스냅샷 아카이브 후 삭제 — **2회차(잔여 4행)**.
 *
 * 1회차와 절차·안전장치가 완전히 동일하고 마커·아카이브 키·대상 id 만 다르다.
 * 두 목록은 서로 겹치지 않는다(아래 불변식 검사로 강제).
 */
export async function purgeZeroPriceSnapshotsRound2(
  deps: CleanupDeps,
): Promise<void | MigrationSkipped> {
  return purgeByIds(deps, SPEC_R2);
}

/**
 * 두 회차의 id 목록은 **절대 겹치면 안 된다.** 겹치면 2회차 SELECT 가 이미 삭제된 행을 찾지
 * 못해 조용히 `skipped` 되거나, 최악의 경우 같은 행을 두 아카이브에 중복 기록한다.
 * 상수 편집 실수를 부팅 전에 잡기 위해 모듈 로드 시점에 확인한다.
 */
const OVERLAP = ZERO_PRICE_SNAPSHOT_IDS_R2.filter(
  (id) => (ZERO_PRICE_SNAPSHOT_IDS as readonly number[]).includes(id),
);
if (OVERLAP.length > 0) {
  throw new Error(`[t012] 삭제 대상 id 가 1·2회차에 중복 등록됨: ${OVERLAP.join(', ')}`);
}

async function purgeByIds(
  deps: CleanupDeps,
  spec: PurgeSpec,
): Promise<void | MigrationSkipped> {
  const { db } = deps;
  const log = deps.logger ?? console;
  const ids = [...spec.ids];

  const [rows] = await db.query(
    `SELECT id, ts, total_krw, positions, source FROM portfolio_snapshots
      WHERE id IN (${ids.map(() => '?').join(',')})`,
    ids,
  ) as [SnapshotRow[], unknown];

  if (!Array.isArray(rows) || rows.length === 0) {
    return { skipped: '대상 행이 이미 없음 (정리 완료 상태)' };
  }

  const verified: SnapshotRow[] = [];
  for (const r of rows) {
    if (hasZeroPricedHolding(r.positions)) verified.push(r);
    else log.warn(`[${spec.tag}] id=${r.id} 는 0원 보유가 없어 삭제 대상에서 제외 (총액=${r.total_krw})`);
  }

  if (verified.length === 0) {
    return { skipped: '재검증 결과 삭제 대상 없음' };
  }

  /**
   * 1) 원본 보관 — 삭제보다 반드시 먼저. 실패하면 예외가 올라가 삭제로 진행하지 않는다.
   *
   * ⚠️ **덮어쓰기가 아니라 병합**이다. 1회차에 12행을 아카이브하고 5행을 지운 뒤 예외가 나면
   * `runOnceMigration` 은 마커를 남기지 않아 다음 부팅에 재시도한다. 그때 SELECT 는 남은 7행만
   * 찾으므로, 덮어쓰면 **이미 지워진 5행의 원본이 아카이브에서 사라진다** — 아카이브 우선이라는
   * 이 마이그레이션의 유일한 안전 속성이 조용히 무너지는 경로다. id 기준으로 합쳐 보존한다.
   */
  const [prevRows] = await db.query(
    'SELECT value FROM system_config WHERE `key` = ? LIMIT 1',
    [spec.archiveKey],
  ) as [{ value?: string }[], unknown];

  const merged = new Map<number, ArchivedRow>();
  const prevRaw = Array.isArray(prevRows) ? prevRows[0]?.value : undefined;
  if (typeof prevRaw === 'string') {
    const parsed = safeParse(prevRaw) as { rows?: unknown } | null;
    if (parsed && Array.isArray(parsed.rows)) {
      for (const row of parsed.rows as ArchivedRow[]) {
        if (row && typeof row.id === 'number') merged.set(row.id, row);
      }
    }
  }
  for (const r of verified) {
    merged.set(r.id, {
      id:        r.id,
      ts:        new Date(r.ts).toISOString(),
      total_krw: Number(r.total_krw),
      source:    r.source,
      positions: typeof r.positions === 'string' ? safeParse(r.positions) : r.positions,
    });
  }

  await db.query(
    'INSERT INTO system_config (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
    [
      spec.archiveKey,
      JSON.stringify({
        archivedAt: new Date().toISOString(),
        reason: spec.reason,
        rows: [...merged.values()].sort((a, b) => a.id - b.id),
      }),
    ],
  );

  // 2) 삭제 — id + total_krw 동시 일치 조건. 값이 다르면 0행 삭제되며, 그 사실을 남긴다.
  const deleted: number[] = [];
  for (const r of verified) {
    const [res] = await db.query(
      'DELETE FROM portfolio_snapshots WHERE id = ? AND total_krw = ?',
      [r.id, Number(r.total_krw)],
    ) as [{ affectedRows?: number }, unknown];
    if (Number(res?.affectedRows ?? 0) > 0) deleted.push(r.id);
    else log.warn(`[${spec.tag}] id=${r.id} DELETE 0행 — total_krw 가 조회 시점과 달라졌을 수 있음(미삭제)`);
  }

  log.log(
    `[${spec.tag}] price=0 오염 스냅샷 ${deleted.length}/${verified.length}행 삭제 `
    + `(원본 ${merged.size}행은 system_config.${spec.archiveKey} 에 보관): `
    + deleted.join(', '),
  );
}
