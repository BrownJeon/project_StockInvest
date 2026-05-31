import mysql from 'mysql2/promise';

let pool: mysql.Pool | null = null;
let setupPromise: Promise<void> | null = null;

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

  for (const [key, val] of [
    ['backtest_period_days',   '90'],
    ['backtest_fee_pct',       '0.05'],
    ['backtest_slip_pct',      '0.10'],
    ['backtest_incl_inactive', 'false'],
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
  try {
    await p.query(`
      ALTER TABLE signals MODIFY COLUMN status
        ENUM('pending','approved','rejected','auto_submitted','expired','superseded',
             'ai_skipped','approved_pending_entry','executing')
        NOT NULL DEFAULT 'pending'
    `);
  } catch { /* 이미 존재 */ }
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
