/**
 * 부팅 DDL 을 **보내지 않아도 되는지**만 판단하는 메타데이터 스냅샷 (T-156 도입, T-179 확장).
 *
 * 원칙 — 양(+)의 확인만 쓴다:
 *  - "있다(=원하는 상태다)"를 확인했을 때만 그 DDL 을 건너뛴다. 없거나, 조회가 실패·시간 초과되거나,
 *    응답 형태가 낯설면 "모름"이며 호출부는 **지금처럼 DDL 을 보낸다**(보수적 — 건너뛰어서 생기는 손해가 없게).
 *  - 이름이 허용 목록과 **정확히** 같은 것만 본다(대소문자 포함). 목록 밖 객체는 판단하지 않는다.
 *  - 정의까지 비교하는 것은 `columnIs` 하나뿐이며 **완전 일치**일 때만 참이다. 스키마 검증기가 아니다
 *    (signals.status ENUM 검증은 db.ts 의 fail-closed 경로가 따로 맡는다 — 이 모듈은 그 경로에 쓰지 않는다).
 *
 * 조회는 INFORMATION_SCHEMA 읽기 2회(COLUMNS·STATISTICS)로 묶는다 — 문장마다 조회하지 않는다.
 * 스냅샷은 setupDB 시작 시점의 상태다. setupDB 는 객체를 더하기만 하므로 "시작 때 있었다"는
 * "나중에도 있다"를 뜻한다. 시작 때 없던 것은 그대로 DDL 을 보낸다(기존 동작과 같다).
 */
export interface BootstrapMetadataQuery {
  query(options: {sql: string; timeout: number}): Promise<unknown>;
}

/** 존재를 확인할 컬럼. 키 = 테이블. */
const COLUMNS: Readonly<Record<string, readonly string[]>> = {
  strategies: ['backtest_interval_h', 'applicable_styles'],
  signals: ['price_at_skip','price_1h_after','price_change_pct','price_4h_after','price_change_pct_4h','price_24h_after','price_change_pct_24h','market','scenario_source','valid_from'],
  orders: ['market'],
  symbol_universe: ['market', 'tier', 'rs_rating', 'near_52w_high', 'vol_ratio_20d', 'rs_updated_at'],
  position_state: ['scenario_exit', 'holding_deadline'],
  stock_favorites: ['research_enabled'],
  research_rally_results: ['today_active_rule_ids', 'price_targets'],
};
/** 존재를 확인할 인덱스. 키 = 테이블. */
const INDEXES: Readonly<Record<string, readonly string[]>> = {
  signals: ['idx_signals_market', 'idx_signals_valid_from'],
  orders: ['idx_orders_market'],
  symbol_universe: ['idx_universe_tier', 'idx_rs_rating'],
  position_state: ['idx_position_state_deadline'],
};
const TIMEOUT_MS = 3000;

/** 테이블 이름은 위 상수에서만 온다(입력값 없음) — 그래도 식별자 모양을 확인하고 넣는다. */
function tableList(targets: Readonly<Record<string, readonly string[]>>): string {
  const names = Object.keys(targets);
  for (const n of names) if (!/^[a-z_]+$/.test(n)) throw new Error('bootstrap_presence_bad_table_name');
  return names.map(n => `'${n}'`).join(',');
}

/** 컬럼 정의(완전 일치 비교용). INFORMATION_SCHEMA 의 값 그대로다. */
export interface ColumnDefinition {
  columnType: string;
  isNullable: 'YES' | 'NO';
  /** INFORMATION_SCHEMA.COLUMNS.COLUMN_DEFAULT 원문(MariaDB 10.2+ 표기). 기본값이 없으면 null. */
  columnDefault: string | null;
}

interface Snapshot {
  names: Set<string>;
  definitions: Map<string, ColumnDefinition>;
  /** 조회가 성공해 결과를 믿을 수 있는가. false 면 모든 판단이 "모름"이다. */
  known: boolean;
}

const EMPTY = (): Snapshot => ({ names: new Set(), definitions: new Map(), known: false });

function readDefinition(row: Record<string, unknown>): ColumnDefinition | null {
  const { column_type: columnType, is_nullable: isNullable, column_default: columnDefault } = row;
  if (typeof columnType !== 'string') return null;
  if (isNullable !== 'YES' && isNullable !== 'NO') return null;
  if (columnDefault !== null && typeof columnDefault !== 'string') return null;
  return { columnType, isNullable, columnDefault };
}

async function present(db: BootstrapMetadataQuery, kind: 'COLUMN'|'INDEX', targets: Readonly<Record<string, readonly string[]>>): Promise<Snapshot> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const sql = kind === 'COLUMN'
      ? `SELECT TABLE_NAME AS table_name, COLUMN_NAME AS object_name, COLUMN_TYPE AS column_type, IS_NULLABLE AS is_nullable, COLUMN_DEFAULT AS column_default FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${tableList(targets)})`
      : `SELECT TABLE_NAME AS table_name, INDEX_NAME AS object_name FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${tableList(targets)})`;
    // Driver timeout bounds SQL execution; race also bounds pool acquisition. A late read
    // cannot mutate this returned snapshot or suppress any subsequent DDL.
    const result = await Promise.race([db.query({sql, timeout: TIMEOUT_MS}), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('bootstrap_metadata_timeout')), TIMEOUT_MS);
    })]);
    if (!Array.isArray(result) || !Array.isArray(result[0])) return EMPTY();
    const snap: Snapshot = { names: new Set(), definitions: new Map(), known: true };
    for (const row of result[0]) {
      if (!row || typeof row !== 'object' || typeof row.table_name !== 'string' || typeof row.object_name !== 'string') return EMPTY();
      if (!Object.prototype.hasOwnProperty.call(targets, row.table_name) || !targets[row.table_name].includes(row.object_name)) continue;
      const key = row.table_name + '.' + row.object_name;
      snap.names.add(key);
      if (kind === 'COLUMN') {
        const def = readDefinition(row as Record<string, unknown>);
        if (def) snap.definitions.set(key, def);
      }
    }
    return snap;
  } catch { return EMPTY(); }
  finally { if (timer !== undefined) clearTimeout(timer); }
}

export interface BootstrapPresence {
  /** 컬럼이 있다고 확인됐는가. false = 없음 또는 모름. */
  hasColumn(table: string, column: string): boolean;
  /** 인덱스가 있다고 확인됐는가. false = 없음 또는 모름. */
  hasIndex(table: string, index: string): boolean;
  /** 컬럼이 있고 정의가 `want` 와 **완전히** 같다고 확인됐는가. 하나라도 다르거나 모르면 false. */
  columnIs(table: string, column: string, want: ColumnDefinition): boolean;
  /** 메타데이터 조회가 성공했는가 — 호출부가 "없어서 보냈는데 실패"를 경고할지 판단하는 데만 쓴다. */
  readonly columnsKnown: boolean;
  readonly indexesKnown: boolean;
}

export async function readBootstrapPresence(db: BootstrapMetadataQuery): Promise<BootstrapPresence> {
  const columns = await present(db,'COLUMN',COLUMNS);
  const indexes = await present(db,'INDEX',INDEXES);
  return {
    hasColumn: (table: string, column: string) => columns.names.has(table+'.'+column),
    hasIndex: (table: string, index: string) => indexes.names.has(table+'.'+index),
    columnIs: (table: string, column: string, want: ColumnDefinition) => {
      const got = columns.definitions.get(table+'.'+column);
      return !!got && got.columnType === want.columnType && got.isNullable === want.isNullable && got.columnDefault === want.columnDefault;
    },
    columnsKnown: columns.known,
    indexesKnown: indexes.known,
  };
}
