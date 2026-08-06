import mysql from 'mysql2/promise';
import { inferAutopilotModeFromLegacy } from '@/lib/signals/autopilot';
import { DEFAULT_ACTIVE_RULES, DEFAULT_INACTIVE_RULES } from '@/lib/strategy/rules/defaults';
import {
  SIGNAL_STATUSES,
  SchemaVerificationError,
  assertSignalStatusEnum,
  buildSignalStatusEnumDDL,
  findMissingSignalStatuses,
  isSchemaFatalError,
} from '@/lib/signals/statuses';

let pool: mysql.Pool | null = null;
let setupPromise: Promise<void> | null = null;

/**
 * 코드-DB 스키마 불일치처럼 **회복 불가능한** 부팅 오류. 설정되면 getPool() 이 계속 throw 해
 * 이 프로세스의 모든 DB 접근(=주문·시그널·조회 전부)이 차단된다 — fail-closed.
 */
let setupFatalError: Error | null = null;

/**
 * 코드가 signals.status 로 기록하는 값 목록.
 * @deprecated `@/lib/signals/statuses` 의 `SIGNAL_STATUSES` 를 직접 쓴다. (하위 호환용 별칭)
 */
export const REQUIRED_SIGNAL_STATUSES = SIGNAL_STATUSES;

/** 부팅 시 signals.status ENUM 자동 확장(ALTER)을 끈다. QA 의 fail-closed 검증용 스위치. */
function isSignalStatusAutoAlterEnabled(): boolean {
  return String(process.env.SIGNAL_STATUS_ENUM_AUTO_ALTER ?? 'true').toLowerCase() !== 'false';
}

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
  // fail-closed — 스키마 불일치 상태로는 단 한 건도 쓰지 않는다 (T-003 §4-2).
  if (setupFatalError) throw setupFatalError;
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

/**
 * 치명 상황 알림 — `sendAlert` 는 다른 안전 이벤트와 동일한 경로다.
 * db.ts ← notify ← db.ts 정적 순환을 피하려고 동적 import 를 쓰고, 알림 실패는 삼킨다
 * (알림이 안 나가는 것보다 기동 차단 자체가 더 중요한 방어선이다).
 */
function notifyCritical(title: string, body: string): void {
  void import('@/lib/notify')
    .then(m => m.sendAlert('critical', title, body))
    .catch(() => { /* 알림 실패는 무시 */ });
}

export function ensureSetup(): Promise<void> {
  if (!setupPromise) {
    setupPromise = setupDB().catch((e) => {
      if (isSchemaFatalError(e)) {
        setupFatalError = e as Error;
        const msg = e instanceof Error ? e.message : String(e);
        console.error(
          '\n' +
          '████████████████████████████████████████████████████████████████\n' +
          '█ [db] FATAL — 스키마 검증 실패. DB 접근을 전면 차단합니다.      █\n' +
          '████████████████████████████████████████████████████████████████\n' +
          `${msg}\n` +
          '조치: src/lib/signals/statuses.ts 의 SIGNAL_STATUSES 로 ENUM 을 확장하는 ALTER 가\n' +
          '      부팅 시 자동 실행된다. 그래도 남아 있다면 DDL·INFORMATION_SCHEMA 권한과\n' +
          '      테이블 락을 확인하라.\n' +
          '      (SIGNAL_STATUS_ENUM_AUTO_ALTER=false 로 자동 ALTER 를 끈 상태인지도 확인)\n',
        );
        // reviewer #3 — 다른 안전 이벤트와 동일하게 알린다. 이 상태는 조용히 지나가면 안 된다.
        notifyCritical(
          '🚨 스키마 검증 실패 — DB 접근 차단 (주문·시그널 전면 중단)',
          `${msg}\n\n/api/health 의 schemaFatal=true 이며 ok=false 로 응답합니다.`,
        );
      }
      throw e;
    });
  }
  return setupPromise;
}

/** 부팅 검증 실패로 DB 접근이 차단된 상태인가 (health 엔드포인트 진단용). */
export function getSetupFatalError(): Error | null {
  return setupFatalError;
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
    // ⛔ D3 — 여기 있던 `UPDATE strategies SET applicable_styles = ?` **부팅 재동기화를 삭제했다.**
    //
    //    이 무조건 UPDATE 가 D3 가 지목한 안티패턴의 원본이다: 부팅마다 코드 값이 DB 를 덮어써
    //    사용자가 UI 에서 바꾼 설정이 재시작 한 번에 되돌아갔다. 게다가 엔진이 이 컬럼을
    //    FIND_IN_SET 으로 룰 선별에 썼기 때문에, 되돌아간 값이 곧 "룰이 조용히 꺼짐"이었다.
    //
    //    이제 실행 경로는 `applicable_styles` 를 읽지 않고(engine.ts 는 `enabled` 만 본다),
    //    컬럼은 화면 표시용으로만 남는다. **코드가 이 컬럼을 다시 쓰는 일은 없다.**
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

  // ── Phase 2 Step 4 (D3) — 기본 활성 룰 5종 적용 ────────────────────────────
  //
  // **왜 INSERT IGNORE 시드로는 안 되는가**: `strategies` 행이 이미 전부 존재하므로
  // INSERT IGNORE 는 아무 일도 하지 않는다. 운영 DB 는 16종 중 15종이 enabled=1 이라
  // 그대로 두면 게이트 체인 재편(Step 3)과 함께 15개 룰이 동시에 발화한다.
  //
  // **왜 부팅 재동기화로는 안 되는가**: 그게 바로 위에서 제거한 안티패턴이다.
  //
  // → `runOnceMigration` 마커 패턴. **딱 한 번** 실행되고, 이후 `strategies.enabled` 의
  //   주인은 영구히 UI 다. 코드가 다시 되돌리는 일은 없다.
  //
  // 선별 기준 (§3): 서로 다른 국면 커버(과매도 반등 / 상승추세 눌림 / 횡보→확장 / 장기추세 /
  // 보유 청산) + 자체 조건 완결성 + 반자동 승인 리듬 적합성. 예상 일 3~9건 후보.
  await runOnceMigration(
    p,
    'migration_phase2_default_active_rules',
    'Phase 2 D3 기본 활성 룰 5종 적용 (이후 strategies.enabled 는 UI 소유)',
    async () => {
      await p.query(
        `UPDATE strategies SET enabled = 1
          WHERE id IN (${DEFAULT_ACTIVE_RULES.map(() => '?').join(',')}) AND enabled = 0`,
        [...DEFAULT_ACTIVE_RULES],
      );
      await p.query(
        `UPDATE strategies SET enabled = 0
          WHERE id IN (${DEFAULT_INACTIVE_RULES.map(() => '?').join(',')}) AND enabled = 1`,
        [...DEFAULT_INACTIVE_RULES],
      );
    },
  );

  // ── Phase 2 Step 4 (Leader 결정 ②) — backtest_interval_h 정상화 ────────────
  //
  // 운영값 0.0833333h(5분)은 백테스트 주기로 무의미하다. Phase 2 에서 `next_backtest_at` 이
  // 평가 경로에서 완전히 분리됐으므로(§4-4) 이 컬럼은 백테스트 스케줄 의미만 남는다.
  //
  // 범위를 **좁게** 잡는다:
  //   - `< 1` 인 행만 6 으로. FLOAT 등가 비교(= 0.0833333)는 부동소수 오차로 불안정해 부등호를 쓴다.
  //   - 24 인 행(일봉 전략: eod-high-close·inside-bar·oversold-bounce-daily)은 정당한 값 → **미변경**
  //   - `next_backtest_at` 은 NULL 로 초기화 (백테스트 스케줄러가 재계산)
  //   - **`enabled` 은 절대 건드리지 않는다** — UI 가 진실이다
  await runOnceMigration(
    p,
    'migration_phase2_backtest_interval_reset',
    'backtest_interval_h 5분(0.0833) → 6h 리셋 (24h 행·enabled 는 미변경)',
    async () => {
      await p.query(
        `UPDATE strategies SET backtest_interval_h = 6, next_backtest_at = NULL
          WHERE backtest_interval_h < 1`,
      );
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
    // 비용 모델 교정 (§3) — 구 0.05%/편도는 **과소**였다(명시 왕복 0.178%).
    // 비대칭(매수 0.014% / 매도 0.164%)이 더 정확하지만 백테스터가 편도 단일값만 받으므로
    // 왕복 0.18% 의 절반인 0.09%/편도를 쓴다.
    ['backtest_fee_pct',       '0.09'],
    ['backtest_slip_pct',      '0.15'],
    ['backtest_incl_inactive', 'false'],
    ['safety_order_max_pct',       '5'],   // 1회 주문 = 해당 시장 평가액의 5%
    ['safety_daily_order_max_pct', '10'],  // 일일 누적 = 해당 시장 평가액의 10%
  ] as [string, string][]) {
    await p.query('INSERT IGNORE INTO system_config (`key`, value) VALUES (?,?)', [key, val]);
  }

  // ── Phase 2 Step 4 (§3) — 룰·비용 파라미터 DB override 시드 ────────────────
  //
  // 백테스트로 검증되지 않은 파라미터는 **코드 default 를 바꾸지 않고 DB 로만** 적용한다
  // (기존 가이드). 롤백은 해당 키를 지우면 코드 default 로 즉시 복귀한다.
  // INSERT IGNORE — 운영자가 이미 정한 값은 어떤 경우에도 덮어쓰지 않는다.
  for (const [key, val] of [
    // rsiBuyThreshold 35 → 38. KOSPI 대형주 15종 일봉 2년(n=7,290) 실측:
    //   P(RSI<35)=5.8% (개별 종목 연 ~14거래일 — 희귀 이벤트) / P(RSI<38)=10.9% (빈도 1.9배)
    //   40(P=15.6%)은 "과매도"라 부르기 어려운 구간까지 진입해 질이 떨어져 기각.
    ['style_default_rsiBuyThreshold', '38'],
    // pullback-trend 눌림 창 42~48 → 40~50 원복 (장중 AI 관문 소멸에 따른 빈도 회복)
    ['style_default_pullbackRsiMin',  '40'],
    ['style_default_pullbackRsiMax',  '50'],
    // bb-squeeze 거래량비 0.7 → 1.2 강화 (AI 부재 보상 — 가짜 돌파 필터)
    ['style_default_bbSqueezeVolRatioMin', '1.2'],
    // 왕복 비용 분리 — 명시 0.18% + 슬리피지 0.15% (구 하드코딩 0.43% 는 2.4배 과대)
    ['style_default_feePct',      '0.18'],
    ['style_default_slippagePct', '0.15'],
  ] as [string, string][]) {
    await p.query('INSERT IGNORE INTO system_config (`key`, value) VALUES (?,?)', [key, val]);
  }

  // 백테스트 비용 키는 Phase 0 에서 이미 시드돼 있어 INSERT IGNORE 로는 교정되지 않는다.
  // → 일회성 마이그레이션으로 **구 기본값과 정확히 일치할 때만** 교정한다.
  //   (운영자가 손대 값이 다르면 그 값이 진실이므로 건드리지 않는다 — legacyMigrations 와 동일 원칙)
  await runOnceMigration(
    p,
    'migration_phase2_backtest_cost_model',
    '백테스트 비용 모델 교정 (fee 0.05→0.09 / slip 0.10→0.15, 구 기본값 일치 시에만)',
    async () => {
      await p.query(
        "UPDATE system_config SET value='0.09' WHERE `key`='backtest_fee_pct'  AND value IN ('0.05','0.0500')",
      );
      await p.query(
        "UPDATE system_config SET value='0.15' WHERE `key`='backtest_slip_pct' AND value IN ('0.10','0.1000')",
      );
    },
  );

  // ── Phase 2 D2 (T-003 §4-1) — 엔진 스위치 이관 ──────────────────────────
  // 구 2×2(strategy_analyst_enabled × hybrid_mode_enabled) → engine_enabled + autopilot_mode.
  //
  //   analyst=F,hybrid=F → assist  /  analyst=T,hybrid=F → auto  /  hybrid=T → assist
  //   engine_enabled 는 구 strategy_analyst_enabled 값을 그대로 이관 (키가 없으면 false = 보수적)
  //
  // ⚠️ **INSERT IGNORE 만 쓴다.** 이미 값이 있으면 그것은 운영자가 UI 에서 정한 값이므로 절대
  //    덮어쓰지 않는다 — applicable_styles 부팅 재동기화가 사용자 토글을 무효화했던 전례(D3)를
  //    다시 만들지 않기 위함이다.
  // ⚠️ **구 키는 지우지 않는다.** 롤백 시 구 코드가 그대로 읽어야 한다.
  try {
    const [legacyRows] = await p.query<mysql.RowDataPacket[]>(
      "SELECT `key`, value FROM system_config WHERE `key` IN ('strategy_analyst_enabled','hybrid_mode_enabled')",
    );
    const legacy = new Map<string, unknown>();
    for (const r of legacyRows) {
      try { legacy.set(String(r.key), JSON.parse(String(r.value))); } catch { /* 파싱 불가 값은 무시 */ }
    }
    const analystOn = legacy.get('strategy_analyst_enabled') === true;
    const hybridOn = legacy.get('hybrid_mode_enabled') === true;
    // 🚨 부팅 시드도 **추론 상한(assist)** 을 적용한다 (T-006 reviewer HIGH).
    //
    //    사양 §4-1 표를 그대로 쓰면 `analyst=T, hybrid=F` 첫 부팅이 `auto` 를 시드한다.
    //    "과거에 실제로 auto 였다"는 점에서 표 자체는 옳지만, 그 결과 **아무도 명시적으로
    //    동의하지 않은 무인 주문 송신 상태로 기동**하게 된다.
    //
    //    부팅과 런타임에 서로 다른 매핑을 두면 같은 구 설정이 경로에 따라 다른 모드를 낳는
    //    (이번 재설계가 제거하려는) 이중 의미가 다시 생긴다. 그래서 양쪽 모두 상한을 적용해
    //    **불변식 하나**로 만든다: `auto` 는 오직 `autopilot_mode` 직접 기입으로만 존재한다.
    //
    //    운영값은 hybrid=true → 'assist' 라 이 클램프의 영향을 받지 않는다.
    //    영향받는 조합(analyst=T, hybrid=F)에서도 방향은 auto→assist, 즉 사람 승인이 늘어나는
    //    안전한 쪽뿐이다.
    const autopilotMode = inferAutopilotModeFromLegacy(analystOn, hybridOn);
    for (const [key, val] of [
      ['engine_enabled', JSON.stringify(analystOn)],
      ['autopilot_mode', JSON.stringify(autopilotMode)],
    ] as [string, string][]) {
      await p.query('INSERT IGNORE INTO system_config (`key`, value) VALUES (?,?)', [key, val]);
    }
  } catch (e) {
    console.warn(`[db] engine_enabled/autopilot_mode 시드 실패: ${e instanceof Error ? e.message : String(e)}`);
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
      status ${buildSignalStatusEnumDDL()} NOT NULL DEFAULT 'pending',
      expires_at DATETIME NULL,
      consumed_order_id BIGINT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_signals_status (status, created_at DESC),
      INDEX idx_signals_symbol (symbol, created_at DESC),
      INDEX idx_signals_consumed (consumed_order_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

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

  // ── signals.status ENUM — 코드 상수(SIGNAL_STATUSES)가 유일한 진실 ─────────
  //
  // ⚠️ T-002 H1 (2026-08-02) 사고: 운영 config `hybrid_mode_enabled=true` 이면 service.ts 가
  //   status='pending_approval' 로 INSERT 하는데 이 값이 ENUM 에 없었다. MariaDB
  //   `sql_mode=STRICT_TRANS_TABLES` 에서 ENUM 범위 밖 값은 **하드 에러** → AI 통과 후보·exit 청산
  //   시그널이 전부 INSERT 예외로 사망하고, 미보호 createSignal 호출 때문에 그 예외가 runMarket
  //   전체를 중단시켰다 (7/19 이후 시그널 0건/일). 근본 원인은 "코드 목록"과 "DB 목록"이 따로 있었던 것.
  //
  //   → T-003 §4-2 구조적 재발 방지:
  //     (1) DDL 을 코드 상수에서 **생성**한다 (두 목록이 갈라질 수 없다)
  //     (2) 부팅 시 INFORMATION_SCHEMA 와 대조해 코드 상태가 없으면 **기동을 중단**한다 (fail-closed)
  //
  //   **합집합 확장만 한다.** 기존 값 제거·재배열 금지 — ENUM 끝에 값을 append 하는 것은
  //   메타데이터만 바꾸는 인플레이스 ALTER 지만, 값 제거·재배열은 테이블 리빌드 + 기존 row 손상 위험.
  //   그래서 ALTER 는 "빠진 값이 있을 때만" 실행한다 (부팅마다 운영 테이블을 건드리지 않는다).
  //
  // ⚠️ 검증기 자신의 실패는 **조용하면 안 된다** (reviewer #2). INFORMATION_SCHEMA 권한 문제로
  //   메타데이터 조회만 막히고 일반 쿼리는 되는 상황이 실재하는데, 그때 검증이 자기 자신을
  //   조용히 건너뛰면 가드는 장식품이 되고 원래 사고(무증상 전멸)가 그대로 재현된다.
  //   → 조회 실패는 throw 해서 `assertSignalStatusEnum` 과 같은 fail-closed 경로를 타게 한다.
  const readSignalStatusColumnType = async (): Promise<string> => {
    try {
      const [colRows] = await p.query<mysql.RowDataPacket[]>(
        `SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'signals' AND COLUMN_NAME = 'status'
          LIMIT 1`,
      );
      return String(colRows[0]?.COLUMN_TYPE ?? '');
    } catch (e) {
      throw new SchemaVerificationError(
        `signals.status COLUMN_TYPE 조회 실패 — ENUM 검증을 수행할 수 없습니다. ` +
        `INFORMATION_SCHEMA 조회 권한을 확인하라. (${e instanceof Error ? e.message : String(e)})`,
        e,
      );
    }
  };

  let statusColType = await readSignalStatusColumnType();
  if (findMissingSignalStatuses(statusColType).length > 0) {
    if (isSignalStatusAutoAlterEnabled()) {
      // ⚠️ ALTER 알고리즘을 **명시적으로 고정한다** (reviewer #1).
      //    지정하지 않으면 서버가 조용히 COPY 로 폴백해 13,811행 운영 테이블을 배포 도중
      //    락 걸 수 있다. 값 append 는 메타데이터만 바꾸므로 INSTANT 로 끝나야 정상이다.
      //    INSTANT 가 거부되면 **LOCK=NONE 을 유지한 INPLACE 로만** 재시도하고, 그 사실을
      //    크게 로그·알림으로 남긴다. 알고리즘 미지정(=COPY 가능) 형태로는 절대 재시도하지 않는다.
      const ddl = `ALTER TABLE signals MODIFY COLUMN status ${buildSignalStatusEnumDDL()} NOT NULL DEFAULT 'pending'`;
      try {
        await p.query(`${ddl}, ALGORITHM=INSTANT, LOCK=NONE`);
      } catch (instantErr) {
        const msg = instantErr instanceof Error ? instantErr.message : String(instantErr);
        console.error(
          `[db] ⚠️ signals.status ENUM 확장이 ALGORITHM=INSTANT 로 수행되지 않았습니다: ${msg}\n` +
          `      LOCK=NONE 을 유지한 INPLACE 로 재시도합니다 (테이블 COPY·락은 여전히 허용하지 않음).`,
        );
        notifyCritical(
          'signals.status ENUM 확장 — INSTANT 불가',
          `ALGORITHM=INSTANT 가 거부돼 INPLACE(LOCK=NONE) 로 재시도합니다.\n사유: ${msg}`,
        );
        try {
          await p.query(`${ddl}, ALGORITHM=INPLACE, LOCK=NONE`);
        } catch (inplaceErr) {
          // ⚠️ reviewer MEDIUM #2 — 재시도까지 실패하면(락 타임아웃 등) 원시 예외에는
          //    `isSchemaFatal` 마커가 없어 setupFatalError·notifyCritical·/api/health red 가
          //    **전부 우회**된다. 읽기 경로에 적용한 "검증기 자신의 실패도 조용하면 안 된다"는
          //    원칙을 실행 경로에도 똑같이 적용해 동일한 fail-closed 경로로 수렴시킨다.
          throw new SchemaVerificationError(
            `signals.status ENUM 확장 ALTER 실패 — INSTANT/INPLACE 모두 거부됐습니다. ` +
            `코드가 사용하는 상태를 INSERT 할 수 없으므로 기동을 중단합니다. ` +
            `(INSTANT: ${msg} / INPLACE: ${inplaceErr instanceof Error ? inplaceErr.message : String(inplaceErr)})`,
            inplaceErr,
          );
        }
      }
      statusColType = await readSignalStatusColumnType();
    } else {
      console.warn('[db] SIGNAL_STATUS_ENUM_AUTO_ALTER=false — ENUM 자동 확장을 건너뜁니다.');
    }
  }
  // fail-closed 검증. 여기서 throw 하면 ensureSetup 이 setupFatalError 를 세우고
  // 이후 모든 getPool() 이 throw 한다 (= 이 프로세스는 아무것도 쓰지 못한다).
  assertSignalStatusEnum(statusColType);

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
      fee_pct DECIMAL(5,4) NOT NULL DEFAULT 0.0900,
      slip_pct DECIMAL(5,4) NOT NULL DEFAULT 0.1500,
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

  // ── cooldowns — 통합 쿨다운 (T-003 §4-3, Phase 2 Step 1) ─────────────────
  // 현행 3중 쿨다운(ai-dedup 60분 / cooldown_rebuy 5분 / exit 5분)을 한 테이블로 통합한다.
  // **signals 상태에 의존하던 쿨다운 쿼리가 사망 원인 중 하나였으므로**(T-002 H3 — 실존하지 않는
  // 'executed','accepted' 를 조회해 exit 쿨다운이 영구 무효 = 중복 청산 위험) 상태 테이블에서 분리한다.
  //
  //   scope=entry : (symbol, strategy_id, side)  TTL 봉주기×2=2h, 사람 reject 시 4h
  //   scope=rebuy : (symbol)                     TTL 30분 (매도 체결 직후 재매수 = 거래세 왕복 낭비)
  //   scope=exit  : (symbol, exit_kind)          TTL 15분 (활성 sell 시그널 체크가 1차, 쿨다운은 2차)
  //
  // ⚠️ NULL 금지 — **MySQL/MariaDB 의 UNIQUE 인덱스는 NULL 을 서로 다른 값으로 취급**한다.
  //    사양 문안대로 strategy_id/side 를 NULL 허용으로 두면 scope='rebuy' 처럼 해당 키가 없는
  //    행에서 UNIQUE 가 전혀 걸리지 않아 (symbol 당 1행이어야 할 것이) 무한 증식하고,
  //    `INSERT ... ON DUPLICATE KEY UPDATE until=?` 가 매번 새 행을 만들어 **쿨다운 갱신·해제가
  //    불가능**해진다. 그래서 세 키 컬럼을 NOT NULL DEFAULT '' 로 두고 "해당 없음"을 빈 문자열
  //    센티넬로 표현한다. 의도한 dedup 의미(scope+키 조합당 정확히 1행)가 이때만 성립한다.
  //
  // ⚠️ exit_kind 컬럼은 사양 §4-3 의 DDL 문안에는 없지만 같은 절의 키 정의표가 exit 키를
  //    (symbol, exit_kind) 로 규정한다 — DDL 문안 쪽이 누락으로 판단해 컬럼을 추가했다.
  await p.query(`
    CREATE TABLE IF NOT EXISTS cooldowns (
      id          BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
      scope       ENUM('entry','rebuy','exit') NOT NULL,
      symbol      VARCHAR(32) NOT NULL,
      strategy_id VARCHAR(64) NOT NULL DEFAULT '',
      side        VARCHAR(8)  NOT NULL DEFAULT '',
      exit_kind   VARCHAR(24) NOT NULL DEFAULT '',
      until       DATETIME    NOT NULL,
      reason      VARCHAR(64) NULL,
      created_at  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_cooldown (scope, symbol, strategy_id, side, exit_kind),
      INDEX idx_cooldown_lookup (scope, symbol, until),
      INDEX idx_cooldown_until (until)
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
