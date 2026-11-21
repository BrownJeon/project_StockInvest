/**
 * T-182 — 거래 리포트 원문 보관(`trade_report_archive`) 읽기·쓰기.
 *
 * 테이블은 `scripts/migrations/T-182-trade-report-archive.sql` 로 **명시 적용**한다(사용자 승인 사항).
 * 부팅 DDL(`src/lib/db.ts` `ensureSetup`)에는 넣지 않았다(T-179 부팅 DDL 경합 이력).
 * → 테이블이 아직 없으면 쓰기는 `null`/false 를 돌려주고(크론은 버튼 없는 요약으로 계속 발송),
 *   읽기는 `archive_not_ready` 로 실패를 드러낸다(화면이 「비어 있음」으로 오해하지 않게).
 *
 * 🔴 이 모듈은 보관 테이블 외에는 쓰지 않는다. 주문·신호·설정 테이블에 쓰는 코드는 없다.
 */
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';

export const REPORT_ARCHIVE_TABLE = 'trade_report_archive';
/** 보관 기간(결정 ③ — 1년) */
export const REPORT_RETENTION_DAYS = 365;
/** 한 번에 지우는 최대 행 수 — 정리가 발송을 오래 붙잡지 않게 */
export const REPORT_PRUNE_BATCH = 500;
/** 화면 회차 목록 길이(가이드 §3 권고 60) */
export const REPORT_HISTORY_LIMIT = 60;

export interface ArchiveInsert {
  sentAt: Date;
  rangeStart: Date;
  rangeEnd: Date;
  isTest: boolean;
  summaryText: string;
  fullText: string;
  payload: unknown;
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** 테이블이 없다(마이그레이션 전) */
export function isMissingTableError(e: unknown): boolean {
  const o = e as { code?: unknown; errno?: unknown } | null;
  return !!o && (o.code === 'ER_NO_SUCH_TABLE' || o.errno === 1146);
}

/**
 * 회차 1행을 넣고 id 를 돌려준다. **던지지 않는다** — 실패(테이블 없음 포함)면 null 과 오류 로그.
 * 처음에는 `delivered=0` 으로 넣고, 발송 결과를 본 뒤 `markReportDelivered` 로 바꾼다.
 */
export async function insertReportArchive(row: ArchiveInsert): Promise<number | null> {
  try {
    const [res] = await getPool().query<ResultSetHeader>(
      `INSERT INTO ${REPORT_ARCHIVE_TABLE}
         (sent_at, range_start, range_end, is_test, delivered, summary_text, full_text, payload)
       VALUES (?, ?, ?, ?, 0, ?, ?, ?)`,
      [row.sentAt, row.rangeStart, row.rangeEnd, row.isTest ? 1 : 0, row.summaryText, row.fullText, JSON.stringify(row.payload)],
    );
    const id = Number((res as Partial<ResultSetHeader> | undefined)?.insertId);
    if (!Number.isSafeInteger(id) || id <= 0) {
      console.error('[trade-report-archive] 보관 INSERT 가 id 를 돌려주지 않았다 — 버튼 없는 요약으로 발송한다');
      return null;
    }
    return id;
  } catch (e) {
    console.error(
      `[trade-report-archive] 보관 INSERT 실패${isMissingTableError(e) ? '(테이블 없음 — 마이그레이션 T-182 적용 전)' : ''}: ${errText(e)} — 버튼 없는 요약으로 발송한다`,
    );
    return null;
  }
}

/** 발송 결과 기록. 던지지 않는다. */
export async function markReportDelivered(id: number, delivered: boolean): Promise<void> {
  try {
    await getPool().query(`UPDATE ${REPORT_ARCHIVE_TABLE} SET delivered = ? WHERE id = ?`, [delivered ? 1 : 0, id]);
  } catch (e) {
    console.error(`[trade-report-archive] delivered 갱신 실패(id=${id}): ${errText(e)}`);
  }
}

/** 보관 기간이 지난 행 삭제(한 번에 상한). 지운 행 수, 실패면 null. 던지지 않는다. */
export async function pruneReportArchive(): Promise<number | null> {
  try {
    const [res] = await getPool().query<ResultSetHeader>(
      `DELETE FROM ${REPORT_ARCHIVE_TABLE}
        WHERE sent_at < DATE_SUB(NOW(), INTERVAL ${REPORT_RETENTION_DAYS} DAY)
        ORDER BY id ASC
        LIMIT ${REPORT_PRUNE_BATCH}`,
    );
    const n = Number((res as Partial<ResultSetHeader> | undefined)?.affectedRows ?? 0);
    return Number.isFinite(n) ? n : 0;
  } catch (e) {
    console.warn(`[trade-report-archive] 보관 기간 정리 실패: ${errText(e)}`);
    return null;
  }
}

/** `system_config.app_public_url` — 없거나 읽기 실패면 null. JSON 문자열·원문 둘 다 읽는다(기존 읽기 방식과 같다). */
export async function readAppPublicUrl(): Promise<string | null> {
  try {
    const [rows] = await getPool().query<RowDataPacket[]>(
      'SELECT `key`, value FROM system_config WHERE `key` = ? LIMIT 1', ['app_public_url'],
    );
    const row = (rows ?? []).find((r) => r?.key === 'app_public_url');
    const raw = row?.value;
    if (raw == null) return null;
    let v = String(raw).trim();
    try { const p = JSON.parse(v); if (typeof p === 'string') v = p.trim(); } catch { /* 비 JSON 원문 */ }
    return v || null;
  } catch {
    return null;
  }
}

// ─── 화면 조회 ─────────────────────────────────────────────────────────────

export interface ArchiveHistoryItem { id: number; sentAt: string }

export interface ArchiveReportRow {
  id: number;
  sentAt: string;
  rangeStart: string;
  rangeEnd: string;
  isTest: boolean;
  delivered: boolean;
  summaryText: string;
  /** 저장된 payload 원본(JSON 문자열 또는 객체) — 화면이 `parseReportPayload` 로 읽는다 */
  payload: unknown;
}

export type ArchiveView =
  | { status: 'ok'; report: ArchiveReportRow; history: ArchiveHistoryItem[] }
  | { status: 'not_found'; report: null; history: ArchiveHistoryItem[] }
  | { status: 'empty'; report: null; history: ArchiveHistoryItem[] };

function iso(v: unknown): string {
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

/**
 * 화면용 조회. `id` 없으면 최신(발송 성공·시험 아님) 회차.
 *  - 회차 목록·최신 판정은 `is_test=0 AND delivered=1` 만(시험 발송·발송 실패 회차 제외).
 *  - `id` 를 직접 주면 시험·발송 실패 회차도 보여 준다(텔레그램 시험 발송의 버튼으로 들어오는 경로) —
 *    화면이 그 사실(「시험 발송」·「발송 실패 — 화면 기록만」)을 표시한다.
 * 던진다(테이블 없음 포함) — 라우트가 오류로 응답한다.
 */
export async function getReportArchiveView(id: number | null): Promise<ArchiveView> {
  const pool = getPool();
  const [hist] = await pool.query<RowDataPacket[]>(
    `SELECT id, sent_at FROM ${REPORT_ARCHIVE_TABLE}
      WHERE is_test = 0 AND delivered = 1
      ORDER BY sent_at DESC, id DESC
      LIMIT ${REPORT_HISTORY_LIMIT}`,
  );
  const history: ArchiveHistoryItem[] = (hist ?? []).map((r) => ({ id: Number(r.id), sentAt: iso(r.sent_at) }));

  const targetId = id ?? history[0]?.id ?? null;
  if (targetId == null) return { status: 'empty', report: null, history };

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, sent_at, range_start, range_end, is_test, delivered, summary_text, payload
       FROM ${REPORT_ARCHIVE_TABLE} WHERE id = ? LIMIT 1`,
    [targetId],
  );
  const r = rows?.[0];
  if (!r) return { status: 'not_found', report: null, history };
  return {
    status: 'ok',
    history,
    report: {
      id: Number(r.id),
      sentAt: iso(r.sent_at),
      rangeStart: iso(r.range_start),
      rangeEnd: iso(r.range_end),
      isTest: Number(r.is_test) === 1,
      delivered: Number(r.delivered) === 1,
      summaryText: String(r.summary_text ?? ''),
      payload: r.payload,
    },
  };
}
