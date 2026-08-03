import mysql from 'mysql2/promise';

let pool: mysql.Pool | null = null;
let setupPromise: Promise<void> | null = null;

/**
 * 코드가 signals.status 로 실제 기록하는 값 목록 (setupDB 사후 검증용).
 * signals/service.ts · router.ts · engine.ts 에서 INSERT/UPDATE 되는 상태만 나열한다.
 * ENUM 에 없는 값이 있으면 STRICT 모드에서 INSERT 가 하드 에러 → 시그널 전멸 (T-002 H1 사고).
 */
export const REQUIRED_SIGNAL_STATUSES = [
  'pending',
  'pending_approval',
  'approved',
  'approved_pending_entry',
  'auto_submitted',
  'executing',
  'rejected',
  'expired',
  'superseded',
  'ai_skipped',
] as const;

function createPool(): mysql.Pool {
  return mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PWD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
    // DB 서버가 Asia/Seoul(KST) 기준으로 운영되므로 mysql2 timezone을 KST로 맞춤.
    // mysql2가 DATETIME 값을 KST로 해석해 올바른 UTC Date 객체를 생성함.
    timezone: '+09:00',
  });
}

export function getPool(): mysql.Pool {
  if (!pool) {
    pool = createPool();
    ensureSetup().catch((e) => console.error('[db] setup failed:', e));
  }
  return pool;
}

export async function withRetry<T>(fn: () => Promise<T>, attempts = 3, baseDelayMs = 200): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i === attempts - 1) break;
      await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** i));
    }
  }
  throw lastErr;
}

export async function ping(): Promise<boolean> {
  try {
    const p = getPool();
    await withRetry(() => p.query('SELECT 1'));
    return true;
  } catch (e) {
    console.error('[db] ping failed:', e);
    return false;
  }
}

export function ensureSetup(): Promise<void> {
  if (!setupPromise) setupPromise = setupDB();
  return setupPromise;
}

/**
 * **일회성** 데이터 마이그레이션 실행기.
 *
 * `system_config` 에 마커 키가 없을 때만 fn 을 실행하고, 성공 시 마커를 남긴다.
 * → 부팅마다 사용자 설정을 덮어쓰는 재동기화(예: applicable_styles 강제 UPDATE)와 달리,
 *   마이그레이션 이후 사용자가 UI 에서 바꾼 값은 영구히 보존된다.
 * fn 이 실패하면 마커를 남기지 않아 다음 부팅에 재시도된다 (fn 은 idempotent 여야 함).
 */
async function runOnceMigration(
  p: mysql.Pool,
  markerKey: string,
  label: string,
  fn: () => Promise<void>,
): Promise<void> {
  try {
    const [rows] = await p.query<mysql.RowDataPacket[]>(
      'SELECT `key` FROM system_config WHERE `key` = ? LIMIT 1',
      [markerKey],
    );
    if (rows.length > 0) return;   // 이미 적용됨 — 사용자 설정 존중, 재실행 금지
    await fn();
    await p.query(
      'INSERT IGNORE INTO system_config (`key`, value) VALUES (?, ?)',
      [markerKey, JSON.stringify(new Date().toISOString())],
    );
    console.log(`[db] one-time migration applied: ${label}`);
  } catch (e) {
    console.warn(`[db] one-time migration 실패 (${markerKey}): ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function setupDB(): Promise<void> {
  const p = pool ?? (pool = createPool());

  await p.query(`
    CREATE TABLE IF NOT EXISTS accounts (
      id INT PRIMARY KEY AUTO_INCREMENT,
      exchange VARCHAR(16) NOT NULL,
      label VARCHAR(64) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_exchange_label (exchange, label)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS holdings (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      account_id INT NOT NULL,
      currency VARCHAR(16) NOT NULL,
      balance DECIMAL(36,18) NOT NULL DEFAULT 0,
      locked DECIMAL(36,18) NOT NULL DEFAULT 0,
      avg_buy_price DECIMAL(36,8) NULL,
      snapshot_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_account_snapshot (account_id, snapshot_at DESC),
      CONSTRAINT fk_holdings_account FOREIGN KEY (account_id) REFERENCES accounts(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await p.query(
    `INSERT IGNORE INTO accounts (exchange, label) VALUES ('kis', 'default')`,
  );

  await p.query(`
    CREATE TABLE IF NOT EXISTS portfolio_snapshots (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      ts DATETIME NOT NULL,
      total_krw BIGINT NOT NULL,
      positions JSON NOT NULL,
      source VARCHAR(20) NOT NULL DEFAULT 'hourly',
      INDEX idx_ts (ts DESC)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      account_id INT NOT NULL,
      client_order_id VARCHAR(64) NOT NULL,
      exchange_order_id VARCHAR(64) NULL,
      asset_class VARCHAR(16) NOT NULL DEFAULT 'stock',
      symbol VARCHAR(32) NOT NULL,
      side ENUM('buy','sell') NOT NULL,
      type ENUM('limit','market') NOT NULL,
      price DECIMAL(36,8) NULL,
      quantity DECIMAL(36,18) NULL,
      amount_krw DECIMAL(18,2) NULL,
      status ENUM('pending','accepted','partially_filled','filled','cancelled','rejected','failed','dry_run','blocked') NOT NULL DEFAULT 'pending',
      blocked_by VARCHAR(32) NULL,
      source ENUM('manual','signal','auto') NOT NULL DEFAULT 'manual',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_client_order_id (client_order_id),
      INDEX idx_account_created (account_id, created_at DESC),
      INDEX idx_symbol_status (symbol, status),
      CONSTRAINT fk_orders_account FOREIGN KEY (account_id) REFERENCES accounts(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS executions (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      order_id BIGINT NOT NULL,
      price DECIMAL(36,8) NOT NULL,
      quantity DECIMAL(36,18) NOT NULL,
      fee DECIMAL(36,8) NOT NULL DEFAULT 0,
      executed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_order (order_id, executed_at DESC),
      CONSTRAINT fk_exec_order FOREIGN KEY (order_id) REFERENCES orders(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS trade_logs (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      order_id BIGINT NULL,
      event VARCHAR(32) NOT NULL,
      payload JSON NOT NULL,
      occurred_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_occurred (occurred_at DESC),
      INDEX idx_order_event (order_id, event),
      CONSTRAINT fk_log_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS strategies (
      id                   VARCHAR(64) PRIMARY KEY,
      name                 VARCHAR(64)  NOT NULL,
      description          VARCHAR(255) NOT NULL DEFAULT '',
      tags                 JSON,
      enabled              TINYINT(1)   NOT NULL DEFAULT 0,
      backtest_interval_h  FLOAT        NOT NULL DEFAULT 6,
      last_backtest_at     DATETIME     NULL,
      next_backtest_at     DATETIME     NULL,
      backtest_running     TINYINT(1)   NOT NULL DEFAULT 0,
      last_backtest_result JSON         NULL,
      stats_cache          JSON         NULL,
      created_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Migrate backtest_interval_h from INT to FLOAT to support sub-hour intervals (e.g. 1 min = 1/60 h)
  await p.query(`
    ALTER TABLE strategies MODIFY COLUMN backtest_interval_h FLOAT NOT NULL DEFAULT 6
  `).catch(() => { /* already FLOAT or alter failed — non-fatal */ });

  // applicable_styles: 전략별 적용 가능한 투자 성향 (SET — 다중 선택 가능)
  // engine.ts에서 현재 analystStyle이 set에 포함된 전략만 후보 평가
  // 기본값 'aggressive,neutral,stable' (모두 허용 — 기존 전략 영향 없음)
  await p.query(`
    ALTER TABLE strategies
      ADD COLUMN applicable_styles SET('aggressive','neutral','stable')
        NOT NULL DEFAULT 'aggressive,neutral,stable'
        AFTER tags
  `).catch(() => { /* already exists */ });

  await p.query(`
    CREATE TABLE IF NOT EXISTS system_config (
      \`key\`     VARCHAR(64) PRIMARY KEY,
      value      JSON        NOT NULL,
      updated_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  const strategySeed = [
    {
      id: 'rsi-oversold-v1', name: 'RSI 과매도 반등 매수',
      description: 'RSI(14) 과매도 반등 매수 전용 — 국내·해외주식 30분봉 (매도는 rsi-overbought-exit-v1로 분리)',
      tags: JSON.stringify(['RSI · MA20', '30m', '매수 전용', '국내·해외 universe']),
      applicable_styles: 'aggressive,neutral',
      enabled: 1, backtest_interval_h: 6,
      last_backtest_at: new Date(Date.now() - 6 * 3600000),
      next_backtest_at: new Date(Date.now() + 6 * 3600000),
      last_backtest_result: JSON.stringify({ sharpe: 1.24, mdd: -8.2, winRate: 61.3, period: '90일' }),
      stats_cache: JSON.stringify({ return7d: 8.3, winRate: 64, signalCount: 11 }),
    },
    {
      id: 'rsi-overbought-exit-v1', name: 'RSI 과열 청산',
      description: 'RSI(14) 과열 청산 전용 (보유 차익실현) — RSI > sellT+3 + 거래량 가드, 30분봉',
      tags: JSON.stringify(['RSI · MA20 · Volume', '30m', '매도 전용', '국내·해외 universe']),
      applicable_styles: 'aggressive,neutral,stable',
      enabled: 1, backtest_interval_h: 6,
      last_backtest_at: null, next_backtest_at: null,
      last_backtest_result: null,
      stats_cache: JSON.stringify({ return7d: 0, winRate: 0, signalCount: 0 }),
    },
    {
      id: 'ma-cross-v1', name: 'MA 골든크로스',
      description: 'MA5 > MA20 돌파 시 매수, 데드크로스 청산 — 1h봉 추세 추종',
      tags: JSON.stringify(['MA5 · MA20', '1h', '국내·해외 universe']),
      applicable_styles: 'neutral,stable',
      enabled: 1, backtest_interval_h: 6,
      last_backtest_at: null, next_backtest_at: null,
      last_backtest_result: JSON.stringify({ sharpe: 0.87, mdd: -11.5, winRate: 55.0, period: '90일' }),
      stats_cache: JSON.stringify({ return7d: 3.1, winRate: 58, signalCount: 4 }),
    },
    {
      id: 'bb-breakout-v1', name: '볼린저 돌파',
      description: '밴드 상단 돌파 시 추세 추종 — 국내·해외주식 30분봉',
      tags: JSON.stringify(['BB(20,2)', '30m', '국내·해외 universe']),
      applicable_styles: 'aggressive,neutral',
      enabled: 0, backtest_interval_h: 6,
      last_backtest_at: new Date(Date.now() - 3 * 86400000), next_backtest_at: null,
      last_backtest_result: null,
      stats_cache: JSON.stringify({ return7d: 0, winRate: 0, signalCount: 0 }),
    },
    {
      id: 'rsi-macd-reversal-v1', name: 'RSI+MACD 반전',
      description: 'RSI 상승 전환 + MACD 히스토그램 반등 + 양봉 — 모멘텀 반전 (공격적투자 전용)',
      tags: JSON.stringify(['RSI · MACD', '30m', 'aggressive']),
      applicable_styles: 'aggressive',
      enabled: 0, backtest_interval_h: 6,
      last_backtest_at: null, next_backtest_at: null,
      last_backtest_result: null,
      stats_cache: JSON.stringify({ return7d: 0, winRate: 0, signalCount: 0 }),
    },
    {
      id: 'bb-squeeze-expansion-v1', name: '볼린저 Squeeze 확장',
      description: '5봉 squeeze(width ≤ ATR×1.5) 직후 상단/하단 돌파 + 거래량 — 저변동→고변동 전환',
      tags: JSON.stringify(['BB · ATR · Volume', '30m', 'breakout']),
      applicable_styles: 'aggressive,neutral',
      enabled: 0, backtest_interval_h: 6,
      last_backtest_at: null, next_backtest_at: null,
      last_backtest_result: null,
      stats_cache: JSON.stringify({ return7d: 0, winRate: 0, signalCount: 0 }),
    },
    {
      id: 'rsi-divergence-v1', name: 'RSI 다이버전스',
      description: '가격 신저가/신고가 ↔ RSI 미동행 + 반전 봉 — 추세 약화 조기 포착',
      tags: JSON.stringify(['RSI Divergence', '30m', '전 성향']),
      applicable_styles: 'aggressive,neutral,stable',
      enabled: 0, backtest_interval_h: 6,
      last_backtest_at: null, next_backtest_at: null,
      last_backtest_result: null,
      stats_cache: JSON.stringify({ return7d: 0, winRate: 0, signalCount: 0 }),
    },
    {
      id: 'triple-confirmation-v1', name: '3중 확인',
      description: 'RSI<35 + MACD bullish cross + 거래량 ×1.5 + 양봉 — 강한 합의 진입 (공격적투자 전용)',
      tags: JSON.stringify(['RSI · MACD · Volume', '30m', 'aggressive']),
      applicable_styles: 'aggressive',
      enabled: 0, backtest_interval_h: 6,
      last_backtest_at: null, next_backtest_at: null,
      last_backtest_result: null,
      stats_cache: JSON.stringify({ return7d: 0, winRate: 0, signalCount: 0 }),
    },
    {
      id: 'volume-spike-breakout-v1', name: '거래량 폭발 돌파',
      description: '거래량 ×3 + 신고가 돌파 + ATR 이격 — 단발 급등 추격 매수 (공격적투자 전용)',
      tags: JSON.stringify(['Volume · Price · ATR', '30m', 'aggressive']),
      applicable_styles: 'aggressive',
      enabled: 0, backtest_interval_h: 6,
      last_backtest_at: null, next_backtest_at: null,
      last_backtest_result: null,
      stats_cache: JSON.stringify({ return7d: 0, winRate: 0, signalCount: 0 }),
    },
    {
      id: 'pullback-trend-v1', name: '추세 눌림목',
      description: '종가 > MA20 우상향 + RSI 40~50 눌림 후 반등 + 양봉 — 추세 진행 중 풀백 매수',
      tags: JSON.stringify(['MA · RSI · 양봉', '30m', '전 성향']),
      applicable_styles: 'aggressive,neutral,stable',
      enabled: 0, backtest_interval_h: 6,
      last_backtest_at: null, next_backtest_at: null,
      last_backtest_result: null,
      stats_cache: JSON.stringify({ return7d: 0, winRate: 0, signalCount: 0 }),
    },
    {
      id: 'weekly-trend-follow-v1', name: '주봉 추세 추종',
      description: '일봉 MA60 > MA200 + 종가 > MA60 + RSI(14) < 60 — 장기 추세 진행 중 매수 (중립·안정)',
      tags: JSON.stringify(['MA60 · MA200 · RSI', '1d', 'neutral·stable']),
      applicable_styles: 'neutral,stable',
      enabled: 0, backtest_interval_h: 24,
      last_backtest_at: null, next_backtest_at: null,
      last_backtest_result: null,
      stats_cache: JSON.stringify({ return7d: 0, winRate: 0, signalCount: 0 }),
    },
    {
      id: 'dividend-quality-buyback-v1', name: '품질주(저변동·우량) 매수',
      description: '일봉 종가 > MA200 + MA60 > MA200 + ATR% < 1.5% + RSI 40~65 + 유동성 — 안정 우량주 진입 (배당·자사주 프록시)',
      tags: JSON.stringify(['MA60 · MA200 · ATR · RSI', '1d', 'stable·neutral']),
      applicable_styles: 'neutral,stable',
      enabled: 0, backtest_interval_h: 24,
      last_backtest_at: null, next_backtest_at: null,
      last_backtest_result: null,
      stats_cache: JSON.stringify({ return7d: 0, winRate: 0, signalCount: 0 }),
    },
    {
      // T-002 H4 — 기본 **비활성**. 최근 14일 후보의 73%(3,304건)를 이 룰 하나가 생성했고,
      // 코인 24h 고저 로직이 주식 "당일 고저"로 오작동한 결과다(자체 조건이 사실상 없음).
      // Phase 2 재설계 요건: "전일 고가 돌파 + 거래량 ≥1.5× + 5봉 누적 상승 < momentumChaseMaxPct"
      // 를 룰에 흡수하기 전엔 재활성 금지.
      id: 'price-breakout-v1', name: '당일 고저 돌파',
      description: '당일 고가 0.8% 근접 돌파 / 저가 근접 이탈 — 노이즈 과다로 기본 비활성 (Phase 2 재설계 대상)',
      tags: JSON.stringify(['Price · High/Low', '30m', '재설계 대기']),
      applicable_styles: 'aggressive,neutral',
      enabled: 0, backtest_interval_h: 6,
      last_backtest_at: null, next_backtest_at: null,
      last_backtest_result: null,
      stats_cache: JSON.stringify({ return7d: 0, winRate: 0, signalCount: 0 }),
    },
    // 장 마감 후 익일 시나리오 전략 (post-market-engine 사용)
    {
      id: 'eod-high-close-v1', name: '당일 고점 마감',
      description: '당일 종가가 고저 범위 상위 30% + 거래량 1.5x + RSI 50~75 — 익일 갭업·모멘텀 지속 기대',
      tags: JSON.stringify(['종가위치 · 거래량 · RSI', '1d', '장마감후 시나리오']),
      applicable_styles: 'aggressive,neutral',
      enabled: 1, backtest_interval_h: 24,
      last_backtest_at: null, next_backtest_at: null,
      last_backtest_result: null,
      stats_cache: JSON.stringify({ return7d: 0, winRate: 0, signalCount: 0 }),
    },
    {
      id: 'inside-bar-v1', name: '인사이드 바',
      description: '전일봉 내에서 완전히 형성된 봉 + 거래량 감소 — 에너지 응축 후 방향성 돌파 기대',
      tags: JSON.stringify(['캔들 패턴 · 거래량', '1d', '장마감후 시나리오']),
      applicable_styles: 'neutral,stable',
      enabled: 1, backtest_interval_h: 24,
      last_backtest_at: null, next_backtest_at: null,
      last_backtest_result: null,
      stats_cache: JSON.stringify({ return7d: 0, winRate: 0, signalCount: 0 }),
    },
    {
      id: 'oversold-bounce-daily-v1', name: '일봉 과매도 반등',
      description: 'RSI(14) < 30 + 당일 양봉 반전 + MA20 지지 — 단기 과매도 후 기술적 반등 기대',
      tags: JSON.stringify(['RSI · MA20 · 양봉', '1d', '장마감후 시나리오']),
      applicable_styles: 'aggressive,neutral',
      enabled: 1, backtest_interval_h: 24,
      last_backtest_at: null, next_backtest_at: null,
      last_backtest_result: null,
      stats_cache: JSON.stringify({ return7d: 0, winRate: 0, signalCount: 0 }),
    },
  ];

  // 크립토 잔재 시드를 주식 기준으로 일괄 갱신 (사용자가 수정한 description은 보존: WHERE에서 옛 문구 정확 일치 시에만 갱신)
  const legacyMigrations: { id: string; oldDesc: string; oldTags: string }[] = [
    { id: 'rsi-oversold-v1', oldDesc: 'RSI(14) 과매도 반등 매수 / 과매수 청산',
      oldTags: JSON.stringify(['RSI · MA20', '1h', 'KRW-BTC']) },
    { id: 'rsi-oversold-v1', oldDesc: 'RSI(14) 과매도 반등 매수 / 과매수 청산 — 국내·해외주식 30분봉',
      oldTags: JSON.stringify(['RSI · MA20', '30m', '국내·해외 universe']) },
    { id: 'ma-cross-v1', oldDesc: 'MA5 > MA20 돌파 시 매수, 데드크로스 청산',
      oldTags: JSON.stringify(['MA5 · MA20', '4h', 'KRW-BTC · KRW-ETH']) },
    { id: 'bb-breakout-v1', oldDesc: '밴드 상단 돌파 시 추세 추종',
      oldTags: JSON.stringify(['BB(20,2)', '1h', 'KRW-ETH']) },
  ];

  for (const s of strategySeed) {
    await p.query(
      `INSERT IGNORE INTO strategies
       (id, name, description, tags, applicable_styles, enabled, backtest_interval_h,
        last_backtest_at, next_backtest_at, last_backtest_result, stats_cache)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [s.id, s.name, s.description, s.tags, s.applicable_styles, s.enabled, s.backtest_interval_h,
       s.last_backtest_at, s.next_backtest_at, s.last_backtest_result, s.stats_cache],
    );
    // applicable_styles는 신규 컬럼이라 기존 행은 default('aggressive,neutral,stable') 상태 →
    // strategySeed의 매핑값으로 한 번 동기화 (사용자가 직접 수정한 enabled·description은 건드리지 않음)
    await p.query(
      'UPDATE strategies SET applicable_styles = ? WHERE id = ?',
      [s.applicable_styles, s.id],
    ).catch(() => { /* non-fatal */ });
  }

  for (const m of legacyMigrations) {
    const fresh = strategySeed.find(s => s.id === m.id);
    if (!fresh) continue;
    // description이 옛 값과 정확히 일치할 때만 갱신 (사용자 수정 description은 보존)
    await p.query(
      'UPDATE strategies SET description = ?, tags = ? WHERE id = ? AND description = ?',
      [fresh.description, fresh.tags, m.id, m.oldDesc],
    ).catch(() => { /* non-fatal */ });
  }

  // ── 일회성 마이그레이션 (T-002 H4) ────────────────────────────────────────
  // 위 applicable_styles 재동기화(무조건 UPDATE)와 달리, **딱 한 번만** 실행되고
  // 이후 사용자가 UI에서 바꾼 값은 코드가 절대 되돌리지 않는다.
  // system_config 에 마커 키를 남겨 재실행을 막는다.
  await runOnceMigration(
    p,
    'migration_disable_price_breakout_v1',
    'price-breakout-v1 기본 비활성 (노이즈 73% 지배 — Phase 2 재설계 전까지)',
    async () => {
      await p.query(`UPDATE strategies SET enabled = 0 WHERE id = 'price-breakout-v1' AND enabled = 1`);
    },
  );

  // system_config value 는 JSON 문자열로 저장한다 (settings/safety PATCH 가 JSON.stringify 사용).
  // 숫자는 '5', 불리언은 'true'/'false', 문자열은 '"..."' 형태.
  //
  // Phase 0 (2026-08-02): 안전 기본값 시드 추가.
  // safety_order_max_pct / safety_daily_order_max_pct 가 없으면 getEffectiveOrderMax 가 0을 반환해
  // 신규 매수가 전면 차단된다(fail-safe). 부팅 시 최소 기본값을 심어 운영 중단을 막는다.
  // INSERT IGNORE — 사용자가 설정 메뉴에서 지정한 기존 값은 절대 덮어쓰지 않는다.
  for (const [key, val] of [
    ['backtest_period_days',   '90'],
    ['backtest_fee_pct',       '0.05'],
    ['backtest_slip_pct',      '0.10'],
    ['backtest_incl_inactive', 'false'],
    ['safety_order_max_pct',       '5'],   // 1회 주문 = 해당 시장 평가액의 5%
    ['safety_daily_order_max_pct', '10'],  // 일일 누적 = 해당 시장 평가액의 10%
  ] as [string, string][]) {
    await p.query('INSERT IGNORE INTO system_config (`key`, value) VALUES (?,?)', [key, val]);
  }

  await p.query(`
    CREATE TABLE IF NOT EXISTS signals (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      strategy_id VARCHAR(64) NULL,
      symbol VARCHAR(32) NOT NULL,
      side ENUM('buy','sell') NOT NULL,
      order_type ENUM('limit','market') NOT NULL,
      price DECIMAL(36,8) NULL,
      quantity DECIMAL(36,18) NULL,
      amount_krw DECIMAL(18,2) NOT NULL,
      reasoning TEXT NULL,
      indicators JSON NULL,
      status ENUM('pending','approved','rejected','auto_submitted','expired','superseded') NOT NULL DEFAULT 'pending',
      expires_at DATETIME NULL,
      consumed_order_id BIGINT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_signals_status (status, created_at DESC),
      INDEX idx_signals_symbol (symbol, created_at DESC),
      INDEX idx_signals_consumed (consumed_order_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // ai_skipped 상태 추가 (기존 DB에도 적용, 중복 실행 무해)
  try {
    await p.query(`
      ALTER TABLE signals MODIFY COLUMN status
        ENUM('pending','approved','rejected','auto_submitted','expired','superseded','ai_skipped')
        NOT NULL DEFAULT 'pending'
    `);
  } catch { /* 이미 존재하는 경우 무시 */ }

  // AI 스킵 시점의 시세 기록 + 후속 변화율 추적 컬럼 (signal-followup cron 용)
  // Phase Q: 4h/24h 장기 추적 컬럼 추가 — fine-tune 학습 라벨 노이즈 감소 목적
  for (const col of [
    ['price_at_skip',         'DECIMAL(36,8) NULL'],
    ['price_1h_after',        'DECIMAL(36,8) NULL'],
    ['price_change_pct',      'DECIMAL(10,4) NULL'],
    ['price_4h_after',        'DECIMAL(36,8) NULL'],
    ['price_change_pct_4h',   'DECIMAL(10,4) NULL'],
    ['price_24h_after',       'DECIMAL(36,8) NULL'],
    ['price_change_pct_24h',  'DECIMAL(10,4) NULL'],
  ] as const) {
    try {
      await p.query(`ALTER TABLE signals ADD COLUMN ${col[0]} ${col[1]}`);
    } catch { /* 이미 존재하는 경우 무시 */ }
  }

  // 듀얼 시장 (국내/해외) 컬럼 — signals/orders/symbol_universe
  for (const tbl of ['signals', 'orders', 'symbol_universe'] as const) {
    try {
      await p.query(
        `ALTER TABLE ${tbl} ADD COLUMN market ENUM('domestic','overseas') NOT NULL DEFAULT 'domestic'`,
      );
    } catch { /* 이미 존재하는 경우 무시 */ }
  }
  try {
    await p.query(`CREATE INDEX idx_signals_market ON signals (market, created_at DESC)`);
  } catch { /* 이미 존재 */ }
  try {
    await p.query(`CREATE INDEX idx_orders_market ON orders (market, created_at DESC)`);
  } catch { /* 이미 존재 */ }

  // 사용자 시나리오 진입 감시 관련 status + 컬럼 추가
  //
  // ⚠️ T-002 H1 (2026-08-02) — `pending_approval` 추가.
  //   운영 config `hybrid_mode_enabled=true` 이면 service.ts:175 가 status='pending_approval' 로
  //   INSERT 하는데 이 값이 ENUM 에 없었다. MariaDB `sql_mode=STRICT_TRANS_TABLES` 에서
  //   ENUM 범위 밖 값은 **하드 에러** → AI 통과 후보·exit 청산 시그널이 전부 INSERT 예외로 사망하고,
  //   미보호 createSignal 호출 때문에 그 예외가 runMarket 전체를 중단시켰다 (7/19 이후 시그널 0건/일).
  //
  //   **합집합 확장만 한다.** 기존 값 제거·재배열 금지 — ENUM 끝에 값을 append 하는 것은
  //   메타데이터만 바꾸는 인플레이스 ALTER 지만, 값 제거·재배열은 테이블 리빌드 + 기존 row 손상 위험.
  try {
    await p.query(`
      ALTER TABLE signals MODIFY COLUMN status
        ENUM('pending','approved','rejected','auto_submitted','expired','superseded',
             'ai_skipped','approved_pending_entry','executing','pending_approval')
        NOT NULL DEFAULT 'pending'
    `);
  } catch { /* 이미 존재 */ }

  // H1 사후 검증 — ALTER 가 조용히 실패하면 시그널이 다시 전멸한다.
  // 코드가 쓰는 status 가 ENUM 에 실제로 존재하는지 부팅 시 1회 확인하고, 없으면 크게 경고한다.
  // (fail-closed 기동 차단은 Phase 2 §4-2 에서 SIGNAL_STATUSES 상수와 함께 도입)
  try {
    const [colRows] = await p.query<mysql.RowDataPacket[]>(
      `SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'signals' AND COLUMN_NAME = 'status'
        LIMIT 1`,
    );
    const colType = String(colRows[0]?.COLUMN_TYPE ?? '');
    const missing = REQUIRED_SIGNAL_STATUSES.filter(s => !colType.includes(`'${s}'`));
    if (colType && missing.length > 0) {
      console.error(
        `[db] ⚠️ signals.status ENUM 에 코드가 사용하는 상태가 없습니다: ${missing.join(', ')}. ` +
        `해당 상태의 시그널 INSERT 는 STRICT 모드에서 전부 실패합니다. 수동 ALTER 필요. (현재: ${colType})`,
      );
    }
  } catch { /* 검증 실패는 비치명 */ }
  try {
    await p.query(`ALTER TABLE signals ADD COLUMN scenario_source VARCHAR(32) NULL`);
  } catch { /* 이미 존재 */ }

  // Phase AC: 장 마감 후 익일 시나리오 사전 등록용 — valid_from 시점 이전엔 entry-watcher가 무시
  try {
    await p.query(`ALTER TABLE signals ADD COLUMN valid_from DATETIME NULL AFTER expires_at`);
  } catch { /* 이미 존재 */ }
  try {
    await p.query(`CREATE INDEX idx_signals_valid_from ON signals (valid_from, status)`);
  } catch { /* 이미 존재 */ }

  await p.query(`
    CREATE TABLE IF NOT EXISTS symbol_universe (
      id           BIGINT PRIMARY KEY AUTO_INCREMENT,
      refreshed_at DATETIME NOT NULL,
      profile      VARCHAR(20) NOT NULL,
      symbol       VARCHAR(32) NOT NULL,
      rank_pos     INT NOT NULL,
      score        DECIMAL(10,6) NOT NULL,
      vol_rank     INT NOT NULL,
      atr_pct      DECIMAL(8,4) NULL,
      score_detail JSON NULL,
      INDEX idx_universe_refresh (refreshed_at DESC, profile)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // tier 컬럼 추가 — 'core'(시총 상위 100) / 'satellite'(101~200) / 'speculative'(거래대금 보강)
  // universeSource(style.ts)가 kospi100/kospi200/volume-top일 때 필터에 사용
  try {
    await p.query(`
      ALTER TABLE symbol_universe
        ADD COLUMN tier ENUM('core','satellite','speculative') NOT NULL DEFAULT 'speculative'
        AFTER atr_pct
    `);
  } catch { /* already exists */ }
  try {
    await p.query(`CREATE INDEX idx_universe_tier ON symbol_universe (tier)`);
  } catch { /* already exists */ }

  // 종목별 변동성 → 적응형 interval 추천
  // ATR(14) / 종가 × 100 → atr_pct
  // suggested_interval: 변동성 bucket 기준 (>=3% → 30m, 1~3% → 1h, <1% → 1d)
  await p.query(`
    CREATE TABLE IF NOT EXISTS symbol_volatility (
      symbol             VARCHAR(32) PRIMARY KEY,
      atr_pct            DECIMAL(8,4) NOT NULL,
      suggested_interval VARCHAR(8)   NOT NULL,
      sample_count       INT          NOT NULL DEFAULT 0,
      refreshed_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // 시장별 공휴일 (KR + US)
  await p.query(`
    CREATE TABLE IF NOT EXISTS market_holidays (
      market       ENUM('domestic','overseas') NOT NULL,
      holiday_date DATE NOT NULL,
      name         VARCHAR(64) NULL,
      half_day     TINYINT(1) NOT NULL DEFAULT 0,
      PRIMARY KEY (market, holiday_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // 환율 (USD/KRW) 캐시
  await p.query(`
    CREATE TABLE IF NOT EXISTS fx_rates (
      pair        VARCHAR(8) PRIMARY KEY,
      rate        DECIMAL(10,4) NOT NULL,
      fetched_at  DATETIME NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // 종목 메타 캐시 — 검색용(코드 ↔ 이름)
  await p.query(`
    CREATE TABLE IF NOT EXISTS stock_meta (
      symbol      VARCHAR(32) PRIMARY KEY,
      name        VARCHAR(128) NOT NULL,
      market      ENUM('domestic','overseas') NOT NULL DEFAULT 'domestic',
      updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_meta_market (market)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // ── 분석가 채팅 (Phase H, 2026-04-28) ─────────────────────────────────────
  await p.query(`
    CREATE TABLE IF NOT EXISTS chat_threads (
      id            BIGINT PRIMARY KEY AUTO_INCREMENT,
      title         VARCHAR(120) NOT NULL DEFAULT '새 대화',
      symbol        VARCHAR(32) NULL,
      created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      message_count INT NOT NULL DEFAULT 0,
      archived      TINYINT(1) NOT NULL DEFAULT 0,
      INDEX idx_threads_updated (updated_at DESC)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await p.query(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id               BIGINT PRIMARY KEY AUTO_INCREMENT,
      thread_id        BIGINT NOT NULL,
      role             ENUM('user','assistant','system') NOT NULL,
      content          MEDIUMTEXT NOT NULL,
      draft_prompt     MEDIUMTEXT NULL,
      draft_prompt_raw MEDIUMTEXT NULL,
      context_attached JSON NULL,
      llm_provider     VARCHAR(32) NULL,
      llm_model        VARCHAR(64) NULL,
      latency_ms       INT NULL,
      created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_msgs_thread (thread_id, id),
      FOREIGN KEY (thread_id) REFERENCES chat_threads(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // 공휴일 시드 — 2025~2027 KR + US (NYSE) 정적. INSERT IGNORE로 중복 무해.
  const HOLIDAY_SEED: Array<[string, string, string, number?]> = [
    // ── 2025 KR ────────────────────────────────────────────────
    ['domestic', '2025-01-01', '신정'],
    ['domestic', '2025-01-28', '설날'], ['domestic', '2025-01-29', '설날'], ['domestic', '2025-01-30', '설날'],
    ['domestic', '2025-03-01', '삼일절'],
    ['domestic', '2025-05-05', '어린이날'],
    ['domestic', '2025-05-06', '대체공휴일'],
    ['domestic', '2025-06-06', '현충일'],
    ['domestic', '2025-08-15', '광복절'],
    ['domestic', '2025-10-03', '개천절'],
    ['domestic', '2025-10-06', '추석'], ['domestic', '2025-10-07', '추석'], ['domestic', '2025-10-08', '추석'],
    ['domestic', '2025-10-09', '한글날'],
    ['domestic', '2025-12-25', '성탄절'],
    // ── 2026 KR ────────────────────────────────────────────────
    ['domestic', '2026-01-01', '신정'],
    ['domestic', '2026-02-16', '설날'], ['domestic', '2026-02-17', '설날'], ['domestic', '2026-02-18', '설날'],
    ['domestic', '2026-03-01', '삼일절'],
    ['domestic', '2026-05-05', '어린이날'],
    ['domestic', '2026-05-25', '석가탄신일'],
    ['domestic', '2026-06-06', '현충일'],
    ['domestic', '2026-08-15', '광복절'],
    ['domestic', '2026-09-24', '추석'], ['domestic', '2026-09-25', '추석'], ['domestic', '2026-09-26', '추석'],
    ['domestic', '2026-10-03', '개천절'],
    ['domestic', '2026-10-09', '한글날'],
    ['domestic', '2026-12-25', '성탄절'],
    // ── 2027 KR ────────────────────────────────────────────────
    ['domestic', '2027-01-01', '신정'],
    ['domestic', '2027-02-06', '설날'], ['domestic', '2027-02-07', '설날'], ['domestic', '2027-02-08', '설날'],
    ['domestic', '2027-03-01', '삼일절'],
    ['domestic', '2027-05-05', '어린이날'],
    ['domestic', '2027-05-13', '석가탄신일'],
    ['domestic', '2027-06-06', '현충일'],
    ['domestic', '2027-08-15', '광복절'],
    ['domestic', '2027-09-14', '추석'], ['domestic', '2027-09-15', '추석'], ['domestic', '2027-09-16', '추석'],
    ['domestic', '2027-10-03', '개천절'],
    ['domestic', '2027-10-09', '한글날'],
    ['domestic', '2027-12-25', '성탄절'],
    // ── 2025 US (NYSE) ─────────────────────────────────────────
    ['overseas', '2025-01-01', "New Year's Day"],
    ['overseas', '2025-01-20', 'MLK Day'],
    ['overseas', '2025-02-17', "Presidents' Day"],
    ['overseas', '2025-04-18', 'Good Friday'],
    ['overseas', '2025-05-26', 'Memorial Day'],
    ['overseas', '2025-06-19', 'Juneteenth'],
    ['overseas', '2025-07-03', 'Independence Day Eve', 1],
    ['overseas', '2025-07-04', 'Independence Day'],
    ['overseas', '2025-09-01', 'Labor Day'],
    ['overseas', '2025-11-27', 'Thanksgiving'],
    ['overseas', '2025-11-28', 'Day after Thanksgiving', 1],
    ['overseas', '2025-12-24', 'Christmas Eve', 1],
    ['overseas', '2025-12-25', 'Christmas'],
    // ── 2026 US (NYSE) ─────────────────────────────────────────
    ['overseas', '2026-01-01', "New Year's Day"],
    ['overseas', '2026-01-19', 'MLK Day'],
    ['overseas', '2026-02-16', "Presidents' Day"],
    ['overseas', '2026-04-03', 'Good Friday'],
    ['overseas', '2026-05-25', 'Memorial Day'],
    ['overseas', '2026-06-19', 'Juneteenth'],
    ['overseas', '2026-07-03', 'Independence Day (observed)'],
    ['overseas', '2026-09-07', 'Labor Day'],
    ['overseas', '2026-11-26', 'Thanksgiving'],
    ['overseas', '2026-11-27', 'Day after Thanksgiving', 1],
    ['overseas', '2026-12-24', 'Christmas Eve', 1],
    ['overseas', '2026-12-25', 'Christmas'],
    // ── 2027 US (NYSE) ─────────────────────────────────────────
    ['overseas', '2027-01-01', "New Year's Day"],
    ['overseas', '2027-01-18', 'MLK Day'],
    ['overseas', '2027-02-15', "Presidents' Day"],
    ['overseas', '2027-03-26', 'Good Friday'],
    ['overseas', '2027-05-31', 'Memorial Day'],
    ['overseas', '2027-06-18', 'Juneteenth (observed)'],
    ['overseas', '2027-07-05', 'Independence Day (observed)'],
    ['overseas', '2027-09-06', 'Labor Day'],
    ['overseas', '2027-11-25', 'Thanksgiving'],
    ['overseas', '2027-11-26', 'Day after Thanksgiving', 1],
    ['overseas', '2027-12-23', 'Christmas Eve', 1],
    ['overseas', '2027-12-24', 'Christmas (observed)'],
    // ── 2028 KR ────────────────────────────────────────────────
    ['domestic', '2028-01-01', '신정'],
    ['domestic', '2028-01-26', '설날'], ['domestic', '2028-01-27', '설날'], ['domestic', '2028-01-28', '설날'],
    ['domestic', '2028-03-01', '삼일절'],
    ['domestic', '2028-04-12', '국회의원선거'],
    ['domestic', '2028-05-02', '석가탄신일'],
    ['domestic', '2028-05-05', '어린이날'],
    ['domestic', '2028-06-06', '현충일'],
    ['domestic', '2028-08-15', '광복절'],
    ['domestic', '2028-10-03', '개천절'],
    ['domestic', '2028-10-03', '추석'], ['domestic', '2028-10-04', '추석'], ['domestic', '2028-10-05', '추석'],
    ['domestic', '2028-10-09', '한글날'],
    ['domestic', '2028-12-25', '성탄절'],
    // ── 2029 KR ────────────────────────────────────────────────
    ['domestic', '2029-01-01', '신정'],
    ['domestic', '2029-02-12', '설날'], ['domestic', '2029-02-13', '설날'], ['domestic', '2029-02-14', '설날'],
    ['domestic', '2029-03-01', '삼일절'],
    ['domestic', '2029-05-05', '어린이날'],
    ['domestic', '2029-05-21', '석가탄신일'],
    ['domestic', '2029-06-06', '현충일'],
    ['domestic', '2029-08-15', '광복절'],
    ['domestic', '2029-09-21', '추석'], ['domestic', '2029-09-22', '추석'], ['domestic', '2029-09-23', '추석'],
    ['domestic', '2029-10-03', '개천절'],
    ['domestic', '2029-10-09', '한글날'],
    ['domestic', '2029-12-25', '성탄절'],
    // ── 2030 KR ────────────────────────────────────────────────
    ['domestic', '2030-01-01', '신정'],
    ['domestic', '2030-02-02', '설날'], ['domestic', '2030-02-03', '설날'], ['domestic', '2030-02-04', '설날'],
    ['domestic', '2030-03-01', '삼일절'],
    ['domestic', '2030-05-05', '어린이날'],
    ['domestic', '2030-05-09', '석가탄신일'],
    ['domestic', '2030-06-06', '현충일'],
    ['domestic', '2030-08-15', '광복절'],
    ['domestic', '2030-09-11', '추석'], ['domestic', '2030-09-12', '추석'], ['domestic', '2030-09-13', '추석'],
    ['domestic', '2030-10-03', '개천절'],
    ['domestic', '2030-10-09', '한글날'],
    ['domestic', '2030-12-25', '성탄절'],
    // ── 2028 US (NYSE) ─────────────────────────────────────────
    ['overseas', '2028-01-17', 'MLK Day'],
    ['overseas', '2028-02-21', "Presidents' Day"],
    ['overseas', '2028-04-14', 'Good Friday'],
    ['overseas', '2028-05-29', 'Memorial Day'],
    ['overseas', '2028-06-19', 'Juneteenth'],
    ['overseas', '2028-07-03', 'Independence Day Eve', 1],
    ['overseas', '2028-07-04', 'Independence Day'],
    ['overseas', '2028-09-04', 'Labor Day'],
    ['overseas', '2028-11-23', 'Thanksgiving'],
    ['overseas', '2028-11-24', 'Day after Thanksgiving', 1],
    ['overseas', '2028-12-25', 'Christmas'],
    // ── 2029 US (NYSE) ─────────────────────────────────────────
    ['overseas', '2029-01-01', "New Year's Day"],
    ['overseas', '2029-01-15', 'MLK Day'],
    ['overseas', '2029-02-19', "Presidents' Day"],
    ['overseas', '2029-03-30', 'Good Friday'],
    ['overseas', '2029-05-28', 'Memorial Day'],
    ['overseas', '2029-06-19', 'Juneteenth'],
    ['overseas', '2029-07-03', 'Independence Day Eve', 1],
    ['overseas', '2029-07-04', 'Independence Day'],
    ['overseas', '2029-09-03', 'Labor Day'],
    ['overseas', '2029-11-22', 'Thanksgiving'],
    ['overseas', '2029-11-23', 'Day after Thanksgiving', 1],
    ['overseas', '2029-12-24', 'Christmas Eve', 1],
    ['overseas', '2029-12-25', 'Christmas'],
    // ── 2030 US (NYSE) ─────────────────────────────────────────
    ['overseas', '2030-01-01', "New Year's Day"],
    ['overseas', '2030-01-21', 'MLK Day'],
    ['overseas', '2030-02-18', "Presidents' Day"],
    ['overseas', '2030-04-19', 'Good Friday'],
    ['overseas', '2030-05-27', 'Memorial Day'],
    ['overseas', '2030-06-19', 'Juneteenth'],
    ['overseas', '2030-07-03', 'Independence Day Eve', 1],
    ['overseas', '2030-07-04', 'Independence Day'],
    ['overseas', '2030-09-02', 'Labor Day'],
    ['overseas', '2030-11-28', 'Thanksgiving'],
    ['overseas', '2030-11-29', 'Day after Thanksgiving', 1],
    ['overseas', '2030-12-24', 'Christmas Eve', 1],
    ['overseas', '2030-12-25', 'Christmas'],
  ];
  for (const row of HOLIDAY_SEED) {
    const [market, date, name, halfDay] = row;
    try {
      await p.query(
        `INSERT IGNORE INTO market_holidays (market, holiday_date, name, half_day) VALUES (?, ?, ?, ?)`,
        [market, date, name, halfDay ?? 0],
      );
    } catch { /* ignore */ }
  }

  // ─── position_state — exit-engine 트레일링 peak·진입가 추적 ─────────
  // 보유 종목당 1행. 청산 후 row 삭제. 재시작 후에도 트레일링 high 보존.
  // (avg_entry_price 는 KIS 잔고에서도 조회되지만 trailing peak 추적엔 자체 저장 필요)
  await p.query(`
    CREATE TABLE IF NOT EXISTS position_state (
      symbol           VARCHAR(32) NOT NULL,
      market           ENUM('domestic','overseas') NOT NULL,
      entry_price      DECIMAL(36,8) NOT NULL,
      peak_price       DECIMAL(36,8) NOT NULL,
      qty              DECIMAL(36,18) NULL,
      scenario_exit    JSON NULL,
      holding_deadline DATETIME NULL,
      first_seen_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (symbol, market),
      INDEX idx_position_state_market (market, updated_at DESC),
      INDEX idx_position_state_deadline (holding_deadline)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  // 기존 테이블에 신규 컬럼 추가 (idempotent)
  await p.query(`ALTER TABLE position_state ADD COLUMN IF NOT EXISTS scenario_exit JSON NULL`).catch(() => {});
  await p.query(`ALTER TABLE position_state ADD COLUMN IF NOT EXISTS holding_deadline DATETIME NULL`).catch(() => {});
  await p.query(`ALTER TABLE position_state ADD INDEX IF NOT EXISTS idx_position_state_deadline (holding_deadline)`).catch(() => {});

  await p.query(`
    CREATE TABLE IF NOT EXISTS backtests (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      strategy_id VARCHAR(64) NOT NULL,
      symbol VARCHAR(32) NOT NULL,
      interval_str VARCHAR(8) NOT NULL DEFAULT '1h',
      period_days INT NOT NULL,
      fee_pct DECIMAL(5,4) NOT NULL DEFAULT 0.0500,
      slip_pct DECIMAL(5,4) NOT NULL DEFAULT 0.1000,
      initial_krw BIGINT NOT NULL DEFAULT 1000000,
      status ENUM('running','done','failed') NOT NULL DEFAULT 'running',
      result JSON NULL,
      error TEXT NULL,
      started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      finished_at DATETIME NULL,
      INDEX idx_bt_strategy (strategy_id, started_at DESC)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // ── 즐겨찾기 종목 (Phase A) ─────────────────────────────────────────────
  await p.query(`
    CREATE TABLE IF NOT EXISTS stock_favorites (
      id          BIGINT PRIMARY KEY AUTO_INCREMENT,
      symbol      VARCHAR(32) NOT NULL UNIQUE,
      name        VARCHAR(128),
      memo        TEXT,
      sort_order  INT NOT NULL DEFAULT 0,
      added_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // ── 재무·가치 캐시 (Phase A) — 1일 TTL ──────────────────────────────────
  await p.query(`
    CREATE TABLE IF NOT EXISTS stock_fundamentals (
      symbol          VARCHAR(32) PRIMARY KEY,
      pbr             DECIMAL(10,4),
      per             DECIMAL(10,4),
      eps             DECIMAL(18,2),
      market_cap_bn   DECIMAL(18,2),
      dividend_yield  DECIMAL(8,4),
      roe             DECIMAL(8,4),
      key_factors     JSON,
      ai_summary      TEXT,
      data_source     VARCHAR(32),
      updated_at      DATETIME
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // ── AI 차트 분석 캐시 — 30분 TTL ─────────────────────────────────────────
  await p.query(`
    CREATE TABLE IF NOT EXISTS stock_chart_analysis (
      symbol       VARCHAR(32)  NOT NULL,
      interval_str VARCHAR(8)   NOT NULL DEFAULT '30m',
      ai_analysis  TEXT,
      indicators   JSON,
      data_source  VARCHAR(32),
      updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (symbol, interval_str)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // ── 거래 일지 — 종목당 1개 매매 여정 (watching→active→closed) ─────────────
  await p.query(`
    CREATE TABLE IF NOT EXISTS trade_journals (
      id           BIGINT PRIMARY KEY AUTO_INCREMENT,
      symbol       VARCHAR(32) NOT NULL,
      name         VARCHAR(128),
      status       ENUM('watching','active','closed') NOT NULL DEFAULT 'watching',
      entry_price  DECIMAL(36,8),
      entry_qty    DECIMAL(36,18),
      exit_price   DECIMAL(36,8),
      pnl_pct      DECIMAL(10,4),
      created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      closed_at    DATETIME,
      INDEX idx_journals_symbol (symbol, created_at DESC),
      INDEX idx_journals_status (status, created_at DESC)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // ── 거래 일지 단계별 메모 ────────────────────────────────────────────────
  // phase: analysis(분석) → plan(계획) → entry(매수) → holding(관찰) → exit(매도) → review(회고)
  await p.query(`
    CREATE TABLE IF NOT EXISTS trade_journal_entries (
      id          BIGINT PRIMARY KEY AUTO_INCREMENT,
      journal_id  BIGINT NOT NULL,
      phase       ENUM('analysis','plan','entry','holding','exit','review') NOT NULL,
      content     TEXT NOT NULL,
      price_at    DECIMAL(36,8),
      created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_entries_journal (journal_id, created_at ASC),
      CONSTRAINT fk_journal_entries FOREIGN KEY (journal_id)
        REFERENCES trade_journals(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // ── eval_funnel — 평가 깔때기 관측 (T-002 Phase 1) ───────────────────────
  // "왜 시그널이 없는가"를 게이트 단위로 추적한다. 기록 정책 (T-002 §2):
  //   run 1행/런 + collect 1행/심볼/런 + 실제 죽은 후보의 개별 skip 행 + final 1행/심볼/런.
  //   (symbol×strategy) 전건 기록은 일 7만행이라 기각 — pass 는 요약, skip 은 심볼 단위 전건.
  // 보존 30일 롤링 (eval-funnel.ts pruneOldRows 가 배치 삭제).
  await p.query(`
    CREATE TABLE IF NOT EXISTS eval_funnel (
      id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
      run_id VARCHAR(40) NOT NULL,
      ts DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      market ENUM('domestic','overseas') NOT NULL,
      symbol VARCHAR(32) NULL,
      strategy_id VARCHAR(64) NULL,
      side ENUM('buy','sell') NULL,
      stage TINYINT UNSIGNED NOT NULL,
      gate VARCHAR(48) NOT NULL,
      verdict ENUM('pass','skip','error') NOT NULL,
      reason VARCHAR(64) NULL,
      detail JSON NULL,
      INDEX idx_ef_run (run_id),
      INDEX idx_ef_ts (ts),
      INDEX idx_ef_gate (gate, ts),
      INDEX idx_ef_market (market, ts, stage)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // ── symbol_universe: RS Rating 컬럼 추가 (Phase D) ──────────────────────
  await p.query(`ALTER TABLE symbol_universe ADD COLUMN IF NOT EXISTS rs_rating     TINYINT UNSIGNED`).catch(() => {});
  await p.query(`ALTER TABLE symbol_universe ADD COLUMN IF NOT EXISTS near_52w_high BOOLEAN DEFAULT FALSE`).catch(() => {});
  await p.query(`ALTER TABLE symbol_universe ADD COLUMN IF NOT EXISTS vol_ratio_20d DECIMAL(8,4)`).catch(() => {});
  await p.query(`ALTER TABLE symbol_universe ADD COLUMN IF NOT EXISTS rs_updated_at DATETIME`).catch(() => {});
  await p.query(`ALTER TABLE symbol_universe ADD INDEX IF NOT EXISTS idx_rs_rating (rs_rating DESC)`).catch(() => {});
}

export async function getAccountId(exchange: string, label = 'default'): Promise<number> {
  const p = getPool();
  const [rows] = await p.query<mysql.RowDataPacket[]>(
    'SELECT id FROM accounts WHERE exchange=? AND label=? LIMIT 1',
    [exchange, label],
  );
  const row = rows[0];
  if (!row) throw new Error(`account not found: ${exchange}/${label}`);
  return Number(row.id);
}
