import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import type { OrderSide, OrderType } from '@/lib/exchanges/types';
import {
  type AutopilotMode,
  DEFAULT_AUTOPILOT_MODE,
  inferAutopilotModeFromLegacy,
  parseAutopilotMode,
} from './autopilot';
import type { SignalStatus } from './statuses';

export type { SignalStatus } from './statuses';

export interface SignalInput {
  strategyId?: string;
  symbol: string;
  side: OrderSide;
  orderType: OrderType;
  price?: number;
  quantity?: number;
  amountKRW: number;
  reasoning?: string;
  indicators?: unknown;
  expiresAt?: Date | string | null;
}

export interface RouterConfig {
  defaultTtlMin: number;
}

export {
  AUTOPILOT_MODES,
  DEFAULT_AUTOPILOT_MODE,
  MAX_INFERRED_AUTOPILOT_MODE,
  clampInferredMode,
  inferAutopilotModeFromLegacy,
  legacySwitchesToMode,
  parseAutopilotMode,
  type AutopilotMode,
} from './autopilot';

/**
 * 엔진 스위치 2종 — 구 `ANALYST_ENABLED` 하나가 "엔진 마스터"와 "라우팅 정책"을
 * 겸직하던 이중 의미(T-003 사망원인 #1)를 분리한 것이다.
 *
 *  - `engineEnabled` : **신규 진입 생성** on/off. 꺼도 exit-engine(보유 종목 청산 보호)은 계속 돈다.
 *                      "전부 멈춤"은 KILL_SWITCH 의 역할이다 (Leader 결정 ①, T-006).
 *  - `autopilotMode` : 발화한 시그널을 어떤 경로로 보낼지.
 */
export interface EngineSwitches {
  engineEnabled: boolean;
  autopilotMode: AutopilotMode;
  /** 값을 어디서 읽었는지 — 진단·관측용 */
  source: 'config' | 'legacy' | 'env';
}

export interface RoutingDecision {
  /** 기존 호출부 호환용 경로 구분. 실제 저장 상태는 `status` 를 쓴다. */
  route: 'auto_submit' | 'pending_approval';
  /** signals.status 에 실제로 기록할 값 (§4-2 신규 어휘) */
  status: SignalStatus;
  expiresAt: Date;
  /** auto 모드에서 금액 상한 초과로 승인 경로로 격하됐는가 */
  demoted?: boolean;
  /** 모드와 무관하게 자동 제출되는 청산(hard_stop·eod_loss_cut)인가 */
  forcedExit?: boolean;
}

export async function getRouterConfig(): Promise<RouterConfig & { hybridModeEnabled: boolean }> {
  let defaultTtlMin = 30;
  let hybridModeEnabled = false;
  try {
    const pool = getPool();
    const [rows] = await pool.query<(RowDataPacket & { key: string; value: string })[]>(
      "SELECT `key`, value FROM system_config WHERE `key` IN (?, ?)",
      ['safety_signal_default_ttl_min', 'hybrid_mode_enabled'],
    );
    for (const row of rows) {
      if (row.key === 'safety_signal_default_ttl_min') {
        const ttl = Number(JSON.parse(row.value));
        if (Number.isFinite(ttl) && ttl > 0) defaultTtlMin = ttl;
      }
      if (row.key === 'hybrid_mode_enabled') {
        hybridModeEnabled = JSON.parse(row.value) === true;
      }
    }
  } catch { /* fall through */ }
  if (!hybridModeEnabled) {
    const envTtl = Number(process.env.SIGNAL_DEFAULT_TTL_MIN ?? 30);
    if (defaultTtlMin === 30) defaultTtlMin = Number.isFinite(envTtl) && envTtl > 0 ? envTtl : 30;
    hybridModeEnabled = String(process.env.HYBRID_MODE_ENABLED ?? 'false').toLowerCase() === 'true';
  }
  return { defaultTtlMin, hybridModeEnabled };
}

/**
 * `engine_enabled` / `autopilot_mode` 판독.
 *
 * 우선순위: system_config 신규 키 → system_config 구 키 → 환경변수 → 기본값.
 * **캐시하지 않는다** — 운영자가 UI 에서 끈 스위치가 캐시 때문에 몇 분 더 살아 있으면
 * 그것 자체가 사고다(자금이 오가는 스위치).
 */
export async function getEngineSwitches(): Promise<EngineSwitches> {
  const cfg = new Map<string, unknown>();
  try {
    const pool = getPool();
    const [rows] = await pool.query<(RowDataPacket & { key: string; value: string })[]>(
      "SELECT `key`, value FROM system_config WHERE `key` IN (?, ?, ?, ?)",
      ['engine_enabled', 'autopilot_mode', 'strategy_analyst_enabled', 'hybrid_mode_enabled'],
    );
    for (const row of rows) {
      try { cfg.set(row.key, JSON.parse(row.value)); } catch { /* 파싱 불가 값은 없는 것으로 */ }
    }
  } catch { /* DB 실패 → 아래 env 폴백 */ }

  const hasNew = cfg.has('engine_enabled') || cfg.has('autopilot_mode');
  const hasLegacy = cfg.has('strategy_analyst_enabled') || cfg.has('hybrid_mode_enabled');

  if (hasNew) {
    const engineEnabled = cfg.has('engine_enabled')
      ? cfg.get('engine_enabled') === true
      : cfg.get('strategy_analyst_enabled') === true;
    // `autopilot_mode` 가 명시돼 있으면 그것이 진실이다 (auto 도 여기로만 도달 가능).
    // 없을 때의 구 키 파생은 **추론**이므로 assist 를 넘지 못한다.
    const autopilotMode = parseAutopilotMode(cfg.get('autopilot_mode'))
      ?? (hasLegacy
        ? inferAutopilotModeFromLegacy(cfg.get('strategy_analyst_enabled') === true, cfg.get('hybrid_mode_enabled') === true)
        : DEFAULT_AUTOPILOT_MODE);
    return { engineEnabled, autopilotMode, source: 'config' };
  }

  if (hasLegacy) {
    return {
      engineEnabled: cfg.get('strategy_analyst_enabled') === true,
      // 구 키만 있는 상태 = 추론. auto 로 승격되지 않는다.
      autopilotMode: inferAutopilotModeFromLegacy(
        cfg.get('strategy_analyst_enabled') === true,
        cfg.get('hybrid_mode_enabled') === true,
      ),
      source: 'legacy',
    };
  }

  // ── env 폴백 ──────────────────────────────────────────────────────────────
  //
  // 📌 **정확도 주의**: 이 분기는 위 두 분기가 모두 빗나갔을 때, 즉 `system_config` 에
  //    engine_enabled·autopilot_mode·strategy_analyst_enabled·hybrid_mode_enabled 가
  //    **하나도 없을 때만** 실행된다. 그런데 db.ts 부팅 시드가 engine_enabled 와
  //    autopilot_mode 를 INSERT IGNORE 로 심으므로, 부팅이 한 번이라도 성공한 뒤에는
  //    `hasNew` 가 항상 참이다.
  //    → **정상 운영에서 이 경로는 사실상 도달하지 않는다.** 실제로 여기 오는 경우는
  //      DB 조회 자체가 실패했을 때(위 catch)뿐이고, 그 상황에서는 다른 모든 것도 이미 멈춘다.
  //
  //    따라서 `AUTOPILOT_MODE` env 는 "명시적 동의 채널"이 **아니다** — 부팅 후에는 무력하다.
  //    `auto` 는 운영자가 `system_config.autopilot_mode` 를 명시적으로 저장할 때만 적용된다.
  //    (env 파싱을 남겨 둔 이유는 최초 부팅 전·DB 장애 시의 안전한 기본값 결정 때문이다.
  //     방향은 안전한 쪽 — auto 도달이 더 어려워지는 쪽 — 이라 그대로 둔다.)
  const envEngineRaw = process.env.ENGINE_ENABLED ?? process.env.ANALYST_ENABLED ?? 'false';
  const envEngine = String(envEngineRaw).toLowerCase() === 'true';
  // 구 env 조합에서의 파생은 추론 → assist 상한.
  const envMode = parseAutopilotMode(process.env.AUTOPILOT_MODE)
    ?? inferAutopilotModeFromLegacy(envEngine, String(process.env.HYBRID_MODE_ENABLED ?? 'false').toLowerCase() === 'true');
  return { engineEnabled: envEngine, autopilotMode: envMode, source: 'env' };
}

/**
 * 구 스위치 키를 바꾼 **직후** 호출해 신규 키를 같은 의미로 맞춘다.
 *
 * 왜 필요한가: 설정 UI 는 아직 `strategy_analyst_enabled` / `hybrid_mode_enabled` 만 쓴다.
 * 신규 키가 시드된 뒤에는 `getEngineSwitches()` 가 신규 키를 우선 읽으므로, 동기화가 없으면
 * **사용자가 UI 에서 토글해도 파이프라인이 옛 값에 갇히는** 무반응 스위치가 된다
 * (db.ts 부팅 재동기화가 UI 토글을 무효화했던 것과 같은 종류의 사고).
 *
 * ⚠️ 여기서만 덮어쓴다 — **사용자가 방금 누른 행위**를 반영하는 것이기 때문이다.
 *    부팅 경로(db.ts)는 INSERT IGNORE 만 쓰고 기존 값을 절대 건드리지 않는다.
 *
 * 🚨 **이 경로는 절대 `auto` 를 만들지 않는다** (T-006 reviewer HIGH).
 *
 *    사양 §4-1 의 매핑표는 *마이그레이션* 의미다 — "과거 이 조합에서 시스템이 실제로 어떻게
 *    동작했는가". 그 표를 **런타임 재파생**에 그대로 쓰면, 자율성을 한 마디도 언급하지 않는
 *    구 "하이브리드 모드" 토글을 OFF 로 내리는 순간 (운영 `strategy_analyst_enabled=true` 와
 *    맞물려) 파이프라인 전체가 `auto` 로 바뀐다. auto 에서는 `duplicate_active_signal` 검사가
 *    생략되고 후보마다 `submitOrder()` 가 호출된다 — 지금 이를 막고 있는 건 KILL_SWITCH 뿐이고,
 *    그건 Step 5 에서 해제할 대상이다.
 *
 *    "자동 주문 송신에 동의한다"는 의사표시는 `autopilot_mode` 를 직접 쓰는 명시적 행위로만
 *    성립한다. 레이블이 그 사실을 말하지 않는 스위치는 동의가 될 수 없다.
 */
export async function syncEngineSwitchesFromLegacy(): Promise<EngineSwitches | null> {
  try {
    const pool = getPool();
    const [rows] = await pool.query<(RowDataPacket & { key: string; value: string })[]>(
      "SELECT `key`, value FROM system_config WHERE `key` IN (?, ?)",
      ['strategy_analyst_enabled', 'hybrid_mode_enabled'],
    );
    const cfg = new Map<string, unknown>();
    for (const row of rows) {
      try { cfg.set(row.key, JSON.parse(row.value)); } catch { /* 무시 */ }
    }
    const analystOn = cfg.get('strategy_analyst_enabled') === true;
    const hybridOn = cfg.get('hybrid_mode_enabled') === true;

    // ✅ 동기화하는 것: `engine_enabled` 뿐. 이게 무반응 토글 버그를 고친 부분이다.
    await pool.query(
      'INSERT INTO system_config (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
      ['engine_enabled', JSON.stringify(analystOn)],
    );

    // 🚫 동기화하지 **않는** 것: `autopilot_mode`.
    //
    //    구 토글 어느 쪽도 자율성에 대해 아무 말을 하지 않는다. `hybrid_mode_enabled` 는
    //    "승인 후 진입 감시" vs "즉시 승인" — **둘 다 assist 계열**이고, 그 구분은
    //    `/api/signals/[id]/approve` 가 `hybrid_mode_enabled` 를 직접 읽어 이미 처리한다.
    //    따라서 이 토글로 `autopilot_mode` 를 재파생할 이유가 애초에 없다 (Step 2 의 과잉).
    //
    //    쓰지 않음으로써 양방향 사고를 동시에 막는다:
    //      - 상향(assist→auto): 레이블이 말하지 않는 무인 주문 송신 활성화 — reviewer HIGH
    //      - 하향(auto→assist): 명시적으로 정한 모드를 무관한 토글이 조용히 되돌림
    //
    //    키가 없으면 `getEngineSwitches()` 가 구 키에서 **추론(assist 상한)** 하므로 공백도 없다.
    const autopilotMode = inferAutopilotModeFromLegacy(analystOn, hybridOn);
    return { engineEnabled: analystOn, autopilotMode, source: 'legacy' };
  } catch (e) {
    console.warn(`[switch-sync] engine_enabled/autopilot_mode 동기화 실패: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

/**
 * 엔진(신규 진입 생성) 활성 여부.
 * @deprecated 이름이 구 이중 의미를 상기시킨다 — 신규 코드는 `isEngineEnabled()` 를 쓴다.
 */
export async function isAnalystEnabled(): Promise<boolean> {
  return isEngineEnabled();
}

export async function isEngineEnabled(): Promise<boolean> {
  return (await getEngineSwitches()).engineEnabled;
}

/**
 * auto 모드 자동 제출 금액 상한. 미설정·비정상 값이면 상한 없음(Infinity)으로 둔다
 * — 없던 제한을 코드 배포만으로 새로 거는 것은 사양 밖 동작 변경이다.
 */
export function getAutoSubmitMaxKRW(): number {
  const raw = process.env.SIGNAL_AUTO_SUBMIT_MAX_KRW;
  if (raw == null || raw === '') return Number.POSITIVE_INFINITY;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : Number.POSITIVE_INFINITY;
}

/** 모드와 무관하게 즉시 자동 제출되는 청산 종류 (§4-1 — 손실 확대 방지 = 포지션판 Kill Switch). */
const FORCED_AUTO_EXIT_KINDS = new Set(['hard_stop', 'eod_loss_cut']);

export function readExitKind(indicators: unknown): string | null {
  if (indicators == null || typeof indicators !== 'object') return null;
  const v = (indicators as Record<string, unknown>)['exit_kind'];
  return typeof v === 'string' ? v : null;
}

/**
 * ENGINE_ENABLED × AUTOPILOT_MODE 전이표 (T-003 §4-1).
 *
 * | 모드   | 룰 발화 시 status                   | 주문 경로            |
 * |--------|-------------------------------------|----------------------|
 * | manual | `detected`                          | 없음 (사람이 수동)   |
 * | assist | `awaiting_approval`                 | 승인 후 submitOrder  |
 * | auto   | `auto_submitted` (한도 초과분 격하) | 즉시 submitOrder     |
 *
 * exit-engine 의 `hard_stop`·`eod_loss_cut` 은 **모드 무관 자동 제출**한다.
 * `engineEnabled` 는 여기서 보지 않는다 — 엔진 스위치는 "신규 진입 후보를 만들 것인가"의
 * 상류 게이트이고, 꺼진 상태에서도 exit 시그널은 계속 생성돼야 하기 때문이다 (Leader 결정 ①).
 */
export function routeSignal(
  input: SignalInput,
  cfg: RouterConfig,
  switches: EngineSwitches,
  now: Date = new Date(),
): RoutingDecision {
  const expiresAt = resolveExpiry(input.expiresAt, cfg.defaultTtlMin, now);

  const exitKind = readExitKind(input.indicators);
  if (exitKind != null && FORCED_AUTO_EXIT_KINDS.has(exitKind)) {
    return { route: 'auto_submit', status: 'auto_submitted', expiresAt, forcedExit: true };
  }

  switch (switches.autopilotMode) {
    case 'manual':
      return { route: 'pending_approval', status: 'detected', expiresAt };
    case 'auto': {
      // ⚠️ 미해결 결정 — auto 모드를 켜기 전에 반드시 판단할 것.
      //    (T-154 설정 UI는 사용자 확인 뒤 `system_config.autopilot_mode` 를 저장한다.)
      //    (T-006 reviewer #4 / Leader 2026-08-06: 현재는 의도적으로 그대로 둔다)
      //
      //    비보호 청산(target_profit / trailing_stop)이 신규 진입과 **같은 금액 상한·격하 경로**를
      //    탄다. 사양 §4-1 auto 행의 "전부 auto 제출"과 충돌할 소지가 있다 — 보유 물량이 상한을
      //    넘으면 익절·트레일링이 승인 대기로 격하돼 청산이 지연될 수 있기 때문이다.
      //    (hard_stop·eod_loss_cut 은 위 forcedExit 분기에서 이미 상한을 타지 않는다.)
      //    운영 모드가 assist 라 오늘의 영향 범위는 0. auto 전환 시 재검토 필수.
      if (input.amountKRW <= getAutoSubmitMaxKRW()) {
        return { route: 'auto_submit', status: 'auto_submitted', expiresAt };
      }
      return { route: 'pending_approval', status: 'awaiting_approval', expiresAt, demoted: true };
    }
    case 'assist':
    default:
      return { route: 'pending_approval', status: 'awaiting_approval', expiresAt };
  }
}

function resolveExpiry(raw: Date | string | null | undefined, defaultTtlMin: number, now: Date): Date {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw;
  if (typeof raw === 'string' && raw.length > 0) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date(now.getTime() + defaultTtlMin * 60_000);
}
