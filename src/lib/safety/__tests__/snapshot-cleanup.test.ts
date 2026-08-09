/**
 * T-012 — `price=0` 오염 스냅샷 12행 정리 마이그레이션.
 *
 * 운영 DB 는 SELECT only 원칙이라, 이 정리는 부팅 시 `runOnceMigration` 이 1회 실행하는
 * 코드로만 존재한다. 테스트는 (a) 아카이브가 삭제보다 먼저인지, (b) 재검증에 실패한 행을
 * 건드리지 않는지, (c) 재실행이 안전한지를 본다.
 */
import {
  purgeZeroPriceSnapshots,
  purgeZeroPriceSnapshotsRound2,
  hasZeroPricedHolding,
  ZERO_PRICE_SNAPSHOT_IDS,
  ZERO_PRICE_SNAPSHOT_ARCHIVE,
  ZERO_PRICE_SNAPSHOT_MARKER,
  ZERO_PRICE_SNAPSHOT_IDS_R2,
  ZERO_PRICE_SNAPSHOT_ARCHIVE_R2,
  ZERO_PRICE_SNAPSHOT_MARKER_R2,
  type SqlExecutor,
} from '@/lib/safety/snapshot-cleanup';

const CORRUPT_POSITIONS = JSON.stringify([
  { currency: 'KRW', qty: 78218, price: 1, value_krw: 78218 },
  { currency: 'NAS:SNPS', qty: 23, price: 0, value_krw: 0 },
]);
const CLEAN_POSITIONS = JSON.stringify([
  { currency: 'KRW', qty: 78218, price: 1, value_krw: 78218 },
  { currency: 'NAS:SNPS', qty: 23, price: 588_999, value_krw: 13_546_977 },
]);

interface Call { sql: string; params: unknown[] }

function makeDb(
  rows: Array<{ id: number; ts: Date; total_krw: number; positions: string; source: string }>,
  opts: { existingArchive?: unknown; deleteAffected?: number } = {},
) {
  const calls: Call[] = [];
  const db: SqlExecutor = {
    async query(sql: string, params: unknown[] = []) {
      calls.push({ sql, params });
      if (/SELECT id, ts, total_krw, positions, source/.test(sql)) return [rows, []];
      if (/SELECT value FROM system_config/.test(sql)) {
        return [opts.existingArchive === undefined ? [] : [{ value: JSON.stringify(opts.existingArchive) }], []];
      }
      if (/DELETE/.test(sql)) return [{ affectedRows: opts.deleteAffected ?? 1 }, []];
      return [{ affectedRows: 1 }, []];
    },
  };
  return { db, calls };
}

const archivePayload = (calls: Call[]): { rows: { id: number }[] } => {
  const c = calls.find((x) => /INSERT INTO system_config/.test(x.sql))!;
  return JSON.parse(String(c.params[1])) as { rows: { id: number }[] };
};

const row = (id: number, positions: string, total = 4_828_256) => ({
  id, ts: new Date('2026-08-09T06:45:27Z'), total_krw: total, positions, source: 'dashboard',
});

const silent = { log: () => {}, warn: () => {} };

describe('hasZeroPricedHolding', () => {
  test('보유 중(qty>0)인데 price=0 이면 true', () => {
    expect(hasZeroPricedHolding(CORRUPT_POSITIONS)).toBe(true);
  });
  test('정상 행은 false', () => {
    expect(hasZeroPricedHolding(CLEAN_POSITIONS)).toBe(false);
  });
  test('qty=0 이고 price=0 이면 false (정상 상태)', () => {
    expect(hasZeroPricedHolding(JSON.stringify([{ currency: 'USD', qty: 0, price: 0, value_krw: 0 }]))).toBe(false);
  });
  test('파싱 불가·비배열은 false (모르는 것을 지우지 않는다)', () => {
    expect(hasZeroPricedHolding('not json')).toBe(false);
    expect(hasZeroPricedHolding(null)).toBe(false);
    expect(hasZeroPricedHolding({})).toBe(false);
  });
  test('이미 파싱된 배열도 받는다 (mysql2 JSON 컬럼)', () => {
    expect(hasZeroPricedHolding([{ currency: 'NAS:SNPS', qty: 23, price: 0, value_krw: 0 }])).toBe(true);
  });
});

describe('purgeZeroPriceSnapshots', () => {
  test('대상 12개 id 를 명시적으로만 조회한다 (조건 검색 삭제 아님)', async () => {
    const { db, calls } = makeDb([]);
    await purgeZeroPriceSnapshots({ db, logger: silent });
    expect(calls[0].params).toEqual([...ZERO_PRICE_SNAPSHOT_IDS]);
    expect(ZERO_PRICE_SNAPSHOT_IDS).toHaveLength(12);
  });

  test('대상 행이 없으면 skipped 를 반환한다 (마커를 남기지 않아 재실행 안전)', async () => {
    const { db, calls } = makeDb([]);
    const r = await purgeZeroPriceSnapshots({ db, logger: silent });
    expect(r).toEqual({ skipped: expect.any(String) });
    expect(calls.some((c) => /DELETE/.test(c.sql))).toBe(false);
  });

  test('🔴 아카이브가 반드시 삭제보다 먼저 실행된다', async () => {
    const { db, calls } = makeDb([row(3558, CORRUPT_POSITIONS)]);
    await purgeZeroPriceSnapshots({ db, logger: silent });
    const archiveIdx = calls.findIndex((c) => /INSERT INTO system_config/.test(c.sql));
    const deleteIdx  = calls.findIndex((c) => /DELETE FROM portfolio_snapshots/.test(c.sql));
    expect(archiveIdx).toBeGreaterThanOrEqual(0);
    expect(deleteIdx).toBeGreaterThan(archiveIdx);
    expect(calls[archiveIdx].params[0]).toBe(ZERO_PRICE_SNAPSHOT_ARCHIVE);
    const payload = JSON.parse(String(calls[archiveIdx].params[1])) as { rows: { id: number }[] };
    expect(payload.rows.map((r) => r.id)).toEqual([3558]);
  });

  test('DELETE 는 id + total_krw 동시 일치 조건으로만 실행된다', async () => {
    const { db, calls } = makeDb([row(3558, CORRUPT_POSITIONS)]);
    await purgeZeroPriceSnapshots({ db, logger: silent });
    const del = calls.find((c) => /DELETE FROM portfolio_snapshots/.test(c.sql))!;
    expect(del.sql).toContain('WHERE id = ? AND total_krw = ?');
    expect(del.params).toEqual([3558, 4_828_256]);
  });

  test('🔴 재검증에 실패한 행(0원 보유 없음)은 삭제하지 않는다', async () => {
    const { db, calls } = makeDb([
      row(3558, CORRUPT_POSITIONS),
      row(3628, CLEAN_POSITIONS, 17_126_702),   // 그 사이 정상화됐다면 건드리지 않는다
    ]);
    await purgeZeroPriceSnapshots({ db, logger: silent });
    const deleted = calls.filter((c) => /DELETE FROM portfolio_snapshots/.test(c.sql));
    expect(deleted).toHaveLength(1);
    expect(deleted[0].params[0]).toBe(3558);
  });

  test('모든 행이 재검증 실패면 아무것도 지우지 않고 skipped', async () => {
    const { db, calls } = makeDb([row(3558, CLEAN_POSITIONS)]);
    const r = await purgeZeroPriceSnapshots({ db, logger: silent });
    expect(r).toEqual({ skipped: expect.any(String) });
    expect(calls.some((c) => /DELETE|INSERT INTO system_config/.test(c.sql))).toBe(false);
  });

  test('아카이브 실패 시 예외가 올라가고 삭제로 진행하지 않는다', async () => {
    const calls: Call[] = [];
    const db: SqlExecutor = {
      async query(sql: string, params: unknown[] = []) {
        calls.push({ sql, params });
        if (/SELECT id, ts, total_krw/.test(sql)) return [[row(3558, CORRUPT_POSITIONS)], []];
        if (/INSERT INTO system_config/.test(sql)) throw new Error('archive failed');
        return [{ affectedRows: 1 }, []];
      },
    };
    await expect(purgeZeroPriceSnapshots({ db, logger: silent })).rejects.toThrow('archive failed');
    expect(calls.some((c) => /DELETE/.test(c.sql))).toBe(false);
  });

  test('마커 키는 T-012 전용이다', () => {
    expect(ZERO_PRICE_SNAPSHOT_MARKER).toBe('migration_t012_zero_price_snapshots');
  });
});

/**
 * reviewer LOW — 아카이브 유실 경로.
 *
 * 1회차에 12행을 아카이브하고 일부를 지운 뒤 예외가 나면 `runOnceMigration` 은 마커를 남기지
 * 않아 다음 부팅에 재시도한다. 그때 SELECT 는 **남은 행만** 찾는다. 아카이브를 덮어쓰면
 * 이미 지워진 행의 원본이 사라져, "삭제 전 아카이브"라는 이 마이그레이션의 유일한 안전
 * 속성이 조용히 무너진다.
 */
describe('아카이브 유실 방지 — 재시도 시 병합', () => {
  test('🔴 기존 아카이브를 덮어쓰지 않고 병합한다 (이미 삭제된 행의 원본 보존)', async () => {
    const existing = {
      archivedAt: '2026-08-09T00:00:00.000Z',
      reason: 'T-012',
      rows: [
        { id: 1077, ts: '2026-04-27T05:39:17.000Z', total_krw: 22_036_689, source: 'dashboard', positions: [] },
        { id: 1149, ts: '2026-04-28T04:43:47.000Z', total_krw: 22_041_589, source: 'dashboard', positions: [] },
      ],
    };
    // 재시도 시점 — 1077·1149 는 이미 삭제됐고 3558 만 남아 있다
    const { db, calls } = makeDb([row(3558, CORRUPT_POSITIONS)], { existingArchive: existing });
    await purgeZeroPriceSnapshots({ db, logger: silent });

    const ids = archivePayload(calls).rows.map((r) => r.id);
    expect(ids).toEqual([1077, 1149, 3558]);   // 이전 2행이 살아남았다
  });

  test('아카이브 병합은 id 기준 — 같은 행이 중복되지 않는다', async () => {
    const existing = {
      rows: [{ id: 3558, ts: 'old', total_krw: 4_828_256, source: 'dashboard', positions: [] }],
    };
    const { db, calls } = makeDb([row(3558, CORRUPT_POSITIONS)], { existingArchive: existing });
    await purgeZeroPriceSnapshots({ db, logger: silent });
    const rows = archivePayload(calls).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(3558);
  });

  test('기존 아카이브가 깨져 있어도 이번 회차분은 정상 기록된다', async () => {
    const { db, calls } = makeDb([row(3558, CORRUPT_POSITIONS)]);
    // existingArchive 미지정 = system_config 조회 결과 없음
    await purgeZeroPriceSnapshots({ db, logger: silent });
    expect(archivePayload(calls).rows.map((r) => r.id)).toEqual([3558]);
  });

  test('🔴 DELETE 가 0행이면 삭제된 것으로 세지 않고 경고한다', async () => {
    const warn = jest.fn();
    const { db } = makeDb([row(3558, CORRUPT_POSITIONS)], { deleteAffected: 0 });
    await purgeZeroPriceSnapshots({ db, logger: { log: () => {}, warn } });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('3558');
  });

  test('삭제 성공 건만 로그에 집계된다', async () => {
    const log = jest.fn();
    const { db } = makeDb([row(3558, CORRUPT_POSITIONS), row(3591, CORRUPT_POSITIONS)]);
    await purgeZeroPriceSnapshots({ db, logger: { log, warn: () => {} } });
    expect(String(log.mock.calls[0][0])).toContain('2/2행 삭제');
  });
});

/**
 * 2회차 — 1차 목록 측정 이후 수정 배포 전까지 새로 쌓인 잔여 4행.
 *
 * 1회차와 **절차가 같아야** 하고(아카이브 우선·재검증·id+total 동시 일치·재실행 안전),
 * **마커와 아카이브 키는 달라야** 한다(같으면 둘 중 하나만 실행되거나 감사 기록이 섞인다).
 */
describe('purgeZeroPriceSnapshotsRound2 — 잔여 4행', () => {
  const ORCL_ZERO = JSON.stringify([
    { currency: 'KRW', qty: 78_218, price: 1, value_krw: 78_218 },
    { currency: 'NYS:ORCL', qty: 6, price: 0, value_krw: 0 },
  ]);
  const r2row = (id: number, positions: string, total: number) => ({
    id, ts: new Date('2026-08-09T07:58:09Z'), total_krw: total, positions, source: 'dashboard',
  });

  test('🔴 대상은 정확히 3708·3732·3733·3739 네 건뿐이다', () => {
    expect([...ZERO_PRICE_SNAPSHOT_IDS_R2]).toEqual([3708, 3732, 3733, 3739]);
    expect(ZERO_PRICE_SNAPSHOT_IDS_R2).toHaveLength(4);
  });

  test('🔴 1회차 승인 목록(12행)과 한 건도 겹치지 않는다', () => {
    const r1 = new Set<number>(ZERO_PRICE_SNAPSHOT_IDS);
    expect(ZERO_PRICE_SNAPSHOT_IDS_R2.filter((id) => r1.has(id))).toEqual([]);
    expect(ZERO_PRICE_SNAPSHOT_IDS).toHaveLength(12);   // 1회차 목록은 넓히지 않았다
  });

  test('🔴 마커·아카이브 키가 1회차와 다르다 (T-012 마커 재사용 금지)', () => {
    expect(ZERO_PRICE_SNAPSHOT_MARKER_R2).not.toBe(ZERO_PRICE_SNAPSHOT_MARKER);
    expect(ZERO_PRICE_SNAPSHOT_ARCHIVE_R2).not.toBe(ZERO_PRICE_SNAPSHOT_ARCHIVE);
    expect(ZERO_PRICE_SNAPSHOT_MARKER_R2).toBe('migration_t012b_remaining_zero_price_snapshots');
  });

  test('🔴 목록 밖 id 는 조회조차 하지 않는다 (조건 검색 삭제 아님)', async () => {
    const { db, calls } = makeDb([]);
    await purgeZeroPriceSnapshotsRound2({ db, logger: silent });
    expect(calls[0].params).toEqual([3708, 3732, 3733, 3739]);
    expect(calls[0].sql).toContain('WHERE id IN (?,?,?,?)');
  });

  test('아카이브가 반드시 삭제보다 먼저 실행되고, 2회차 전용 키에 쓴다', async () => {
    const { db, calls } = makeDb([r2row(3732, CORRUPT_POSITIONS, 4_828_256)]);
    await purgeZeroPriceSnapshotsRound2({ db, logger: silent });
    const archiveIdx = calls.findIndex((c) => /INSERT INTO system_config/.test(c.sql));
    const deleteIdx  = calls.findIndex((c) => /DELETE FROM portfolio_snapshots/.test(c.sql));
    expect(archiveIdx).toBeGreaterThanOrEqual(0);
    expect(deleteIdx).toBeGreaterThan(archiveIdx);
    expect(calls[archiveIdx].params[0]).toBe(ZERO_PRICE_SNAPSHOT_ARCHIVE_R2);
  });

  test('아카이브에 positions 를 포함한 원본 전체가 들어간다', async () => {
    const { db, calls } = makeDb([r2row(3708, ORCL_ZERO, 17_126_702)]);
    await purgeZeroPriceSnapshotsRound2({ db, logger: silent });
    const payload = JSON.parse(String(
      calls.find((c) => /INSERT INTO system_config/.test(c.sql))!.params[1],
    )) as { rows: Array<{ id: number; total_krw: number; source: string; positions: unknown[] }> };
    expect(payload.rows).toHaveLength(1);
    expect(payload.rows[0]).toMatchObject({ id: 3708, total_krw: 17_126_702, source: 'dashboard' });
    expect(payload.rows[0].positions).toEqual([
      { currency: 'KRW', qty: 78_218, price: 1, value_krw: 78_218 },
      { currency: 'NYS:ORCL', qty: 6, price: 0, value_krw: 0 },
    ]);
  });

  test('DELETE 는 id + total_krw 동시 일치 조건으로만 실행된다', async () => {
    const { db, calls } = makeDb([r2row(3708, ORCL_ZERO, 17_126_702)]);
    await purgeZeroPriceSnapshotsRound2({ db, logger: silent });
    const del = calls.find((c) => /DELETE FROM portfolio_snapshots/.test(c.sql))!;
    expect(del.sql).toContain('WHERE id = ? AND total_krw = ?');
    expect(del.params).toEqual([3708, 17_126_702]);
  });

  test('🔴 재검증에 실패한 행(0원 보유 없음)은 삭제하지 않는다', async () => {
    const { db, calls } = makeDb([
      r2row(3732, CORRUPT_POSITIONS, 4_828_256),
      r2row(3733, CLEAN_POSITIONS, 17_126_702),
    ]);
    await purgeZeroPriceSnapshotsRound2({ db, logger: silent });
    const deleted = calls.filter((c) => /DELETE FROM portfolio_snapshots/.test(c.sql));
    expect(deleted).toHaveLength(1);
    expect(deleted[0].params[0]).toBe(3732);
  });

  test('대상 행이 이미 없으면 skipped — 마커를 남기지 않아 재실행 안전', async () => {
    const { db, calls } = makeDb([]);
    const r = await purgeZeroPriceSnapshotsRound2({ db, logger: silent });
    expect(r).toEqual({ skipped: expect.any(String) });
    expect(calls.some((c) => /DELETE|INSERT INTO system_config/.test(c.sql))).toBe(false);
  });

  test('아카이브 실패 시 예외가 올라가고 삭제로 진행하지 않는다', async () => {
    const calls: Call[] = [];
    const db: SqlExecutor = {
      async query(sql: string, params: unknown[] = []) {
        calls.push({ sql, params });
        if (/SELECT id, ts, total_krw/.test(sql)) return [[r2row(3732, CORRUPT_POSITIONS, 4_828_256)], []];
        if (/INSERT INTO system_config/.test(sql)) throw new Error('archive failed');
        return [{ affectedRows: 1 }, []];
      },
    };
    await expect(purgeZeroPriceSnapshotsRound2({ db, logger: silent })).rejects.toThrow('archive failed');
    expect(calls.some((c) => /DELETE/.test(c.sql))).toBe(false);
  });

  test('🔴 재시도 시 기존 2회차 아카이브를 덮어쓰지 않고 id 로 병합한다', async () => {
    const existing = {
      rows: [
        { id: 3708, ts: 'x', total_krw: 17_126_702, source: 'dashboard', positions: [] },
        { id: 3733, ts: 'x', total_krw: 17_126_702, source: 'dashboard', positions: [] },
      ],
    };
    const { db, calls } = makeDb([r2row(3739, ORCL_ZERO, 17_126_702)], { existingArchive: existing });
    await purgeZeroPriceSnapshotsRound2({ db, logger: silent });
    expect(archivePayload(calls).rows.map((r) => r.id)).toEqual([3708, 3733, 3739]);
  });

  test('DELETE 가 0행이면 삭제된 것으로 세지 않고 경고한다', async () => {
    const warn = jest.fn();
    const { db } = makeDb([r2row(3739, ORCL_ZERO, 17_126_702)], { deleteAffected: 0 });
    await purgeZeroPriceSnapshotsRound2({ db, logger: { log: () => {}, warn } });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('3739');
  });

  test('로그 태그가 1회차(t012)와 구분된다', async () => {
    const log = jest.fn();
    const { db } = makeDb([r2row(3708, ORCL_ZERO, 17_126_702)]);
    await purgeZeroPriceSnapshotsRound2({ db, logger: { log, warn: () => {} } });
    expect(String(log.mock.calls[0][0])).toContain('[t012b]');
    expect(String(log.mock.calls[0][0])).toContain(ZERO_PRICE_SNAPSHOT_ARCHIVE_R2);
  });
});
