/**
 * T-108 안전 상태 — `GET /api/ops/safety-state` 의 본체 (가이드 §4.2).
 *
 * **같은 판독기**: 주문 경로가 쓰는 `isDryRun`(safety/dry-run) · `isKillSwitchActive`(safety/kill-switch) ·
 * `readExitEngineSwitch`(strategy/exit-switch) 를 그대로 부른다. 설정 GET 의 `overrides` 재해석을 따라 하지 않는다 —
 * 화면이 엔진과 다른 해석을 하는 순간 「손절이 지켜 주고 있다」는 거짓 표시가 된다(설정 라우트 주석과 같은 이유).
 * `GET /api/settings/safety` 는 부르지 않는다 — 그 라우트는 조회 중 기본값을 써 넣는다(seedIfEmpty).
 *
 * 순서: `ping()` 실패 → `db_unreachable`, 나머지 null, `unknown`. 성공 → 병렬 판독.
 *
 * ⚠ 판독기의 DB 오류 동작(정정 — Reviewer R-DATA Major-3): `isDryRun`·`isKillSwitchActive` 는 DB 조회가 실패하면 예외 대신
 * **환경변수로 떨어진다**(`DRY_RUN` 미설정 = ON, `KILL_SWITCH` 미설정 = **OFF**). ping 직후 DB 가 순간 끊기면 판독기는 「모든거래차단 OFF」를
 * 돌려줄 수 있다 — 주문 경로와 같은 값이라 송신 판단과는 맞지만, 화면이 DB 값을 모르는 채 「OFF」로 안심시키면 안 된다.
 * 그래서 같은 요청에서 `system_config` 의 `safety_dry_run`·`safety_kill_switch` 를 **직접 한 번 더 읽어** 판독 결과와 대조한다:
 *  - cfg 읽기 실패 → 두 값 null(`dry_run_read_error`·`kill_switch_read_error`) → 단계 unknown
 *  - 키가 있고 판독 결과와 다름(판독기가 env 로 떨어졌거나 두 읽기 사이에 값이 바뀜) → null(`*_mismatch`) → unknown
 *  - 키가 없음 → 판독기의 env 해석이 곧 실제 값이므로 그대로 쓴다
 * 청산 스위치(`readExitEngineSwitch`)는 DB 오류를 `source='db_error'` 로 알려 주므로(그때 비활성) 그 표지를 그대로 쓴다.
 *
 * 부작용: `isKillSwitchActive` 는 값 해석 불가 때 경보를 낼 수 있다(기존 `/api/health` 와 같은 판독기 — 스로틀됨). 쓰기 없음.
 */
import { ping } from '@/lib/db';
import { isDryRun } from '@/lib/safety/dry-run';
import { isKillSwitchActive } from '@/lib/safety/kill-switch';
import { parseBoolFlag } from '@/lib/safety/flags';
import { liveTradingFromDryRun } from '@/lib/safety/live-trading';
import { VALIDATED_STATUSES } from '@/lib/safety/validation-gate';
import { readExitEngineSwitch } from '@/lib/strategy/exit-switch';
import { withDeadline } from '@/lib/strategy/records/safe-text';
import { count, createReader, OPS_SAFETY_GATE, type OpsReader } from './read-only';
import { kstIso, toMs } from './sessions';
import { deriveOpsStage } from './stage';
import type { SafetyStateDTO } from './types';

/** 판독기 1개당 상한 — 판독기 자체에는 상한이 없다. 넘으면 null(읽기 실패)로 본다. */
export const SAFETY_READ_DEADLINE_MS = 2500;

export interface SafetyStateDeps {
  ping: () => Promise<boolean>;
  isDryRun: () => Promise<boolean>;
  isKillSwitchActive: () => Promise<boolean>;
  readExitEngineSwitch: typeof readExitEngineSwitch;
  reader: () => OpsReader;
}

export const STRATEGIES_SQL = 'SELECT validation_status, enabled, COUNT(*) AS n FROM strategies GROUP BY validation_status, enabled';
export const SAFETY_CFG_SQL =
  "SELECT `key`, value, updated_at FROM system_config WHERE `key` IN ('notify_signal_auto_submit', 'safety_kill_switch', 'safety_dry_run')";

/**
 * 안전 판독 전용 reader — **예약 레인**(OPS_SAFETY_GATE, 전역 관문과 별개)을 쓰고 위 두 문장만 보낼 수 있다.
 * 홈 질의가 전역 관문을 채우고 있어도 안전 띠(30초 재조회)가 그 뒤에 줄 서지 않는다(Reviewer R-DATA — 새 관문 Major).
 */
export function createSafetyReader(nowMs?: number): OpsReader {
  return createReader({ nowMs, gate: OPS_SAFETY_GATE, allowedSql: [STRATEGIES_SQL, SAFETY_CFG_SQL] });
}

const DEFAULT_DEPS: SafetyStateDeps = {
  ping, isDryRun, isKillSwitchActive, readExitEngineSwitch,
  reader: () => createSafetyReader(),
};

/** 안전 상태와 함께 홈 「확인 필요」가 쓰는 부가 값(모든거래차단 마지막 변경 시각). */
export interface SafetyStateExtra { killSwitchSince: string | null }

async function deadline<T>(p: Promise<T>): Promise<T | null> {
  try {
    const v = await withDeadline(p, SAFETY_READ_DEADLINE_MS);
    return v === undefined ? null : v;
  } catch {
    return null;
  }
}

/**
 * 판독기 결과와 같은 요청의 DB 행 대조 — 순수. 판독기(dry-run.ts·kill-switch.ts)와 같은 해석(`parseBoolFlag(JSON.parse(value))`):
 * 해석됨 → 그 값, 해석 불가 → true(두 판독기 모두 안전 쪽 활성), 키 없음 → 판독기 값(env 해석) 그대로. 다르면 'mismatch'.
 * 판독기 자체가 상한 초과·실패(null)면 'read_error'.
 */
export function crossCheck(reader: boolean | null, row: { value: unknown } | undefined): boolean | 'mismatch' | 'read_error' {
  if (typeof reader !== 'boolean') return 'read_error';
  if (!row) return reader;
  let raw: unknown;
  try { raw = typeof row.value === 'string' ? JSON.parse(row.value) : row.value; } catch { return 'mismatch'; }
  const f = parseBoolFlag(raw);
  const expected = f.state === 'parsed' ? f.value : f.state === 'unparsable' ? true : reader;
  return expected === reader ? reader : 'mismatch';
}

/** notify_signal_auto_submit — 키 없으면 true(설정 라우트 기본값과 같은 규칙: Boolean(값)). */
export function notifyFromRow(rows: { value: unknown }[]): boolean {
  if (rows.length === 0) return true;
  const raw = rows[0].value;
  let v: unknown = raw;
  if (typeof raw === 'string') { try { v = JSON.parse(raw); } catch { v = raw; } }
  return Boolean(v);
}

export async function readSafetyState(nowMs: number = Date.now(), deps: SafetyStateDeps = DEFAULT_DEPS): Promise<SafetyStateDTO & SafetyStateExtra> {
  const readAt = kstIso(nowMs);
  const errors: string[] = [];
  const alive = await deadline(deps.ping());
  if (alive !== true) {
    return {
      readAt, stage: 'unknown', liveTrading: null, killSwitch: null, exitEngine: null, strategies: null,
      notifyAutoSubmit: null, errors: ['db_unreachable'], killSwitchSince: null,
    };
  }

  const r = deps.reader();
  const validated = VALIDATED_STATUSES as readonly string[];
  const [dry, kill, exit, strat, cfg] = await Promise.all([
    deadline(deps.isDryRun()),
    deadline(deps.isKillSwitchActive()),
    deadline(deps.readExitEngineSwitch()),
    r.rows<{ validation_status: unknown; enabled: unknown; n: unknown }>(STRATEGIES_SQL).then((rows) => rows, () => null),
    r.rows<{ key: unknown; value: unknown; updated_at: unknown }>(SAFETY_CFG_SQL).then((rows) => rows, () => null),
  ]);

  // 판독기 값 ↔ DB 행 대조(위 머리 주석). cfg 를 못 읽으면 두 값 모두 모름.
  const cfgRow = (k: string) => cfg?.find((c) => String(c.key) === k);
  const dryChecked = cfg ? crossCheck(dry, cfgRow('safety_dry_run')) : 'read_error';
  const killChecked = cfg ? crossCheck(kill, cfgRow('safety_kill_switch')) : 'read_error';
  const liveTrading = typeof dryChecked === 'boolean' ? liveTradingFromDryRun(dryChecked) : null;
  if (liveTrading === null) errors.push(dryChecked === 'mismatch' ? 'dry_run_mismatch' : 'dry_run_read_error');
  const killSwitch = typeof killChecked === 'boolean' ? killChecked : null;
  if (killSwitch === null) errors.push(killChecked === 'mismatch' ? 'kill_switch_mismatch' : 'kill_switch_read_error');

  let exitEngine: SafetyStateDTO['exitEngine'] = null;
  if (exit) {
    exitEngine = { enabled: exit.enabled, hardStopEnabled: exit.hardStopEnabled, source: exit.source };
    if (exit.source === 'db_error') errors.push('exit_switch_db_error');
  } else {
    errors.push('exit_switch_db_error');
  }

  let strategies: SafetyStateDTO['strategies'] = null;
  if (strat) {
    const s = { total: 0, enabled: 0, validated: 0, validatedEnabled: 0 };
    for (const row of strat) {
      const n = count(row.n);
      const on = Number(row.enabled) === 1;
      const ok = validated.includes(String(row.validation_status));
      s.total += n;
      if (on) s.enabled += n;
      if (ok) s.validated += n;
      if (on && ok) s.validatedEnabled += n;
    }
    strategies = s;
  } else {
    errors.push('strategies_error');
  }

  let notifyAutoSubmit: boolean | null = null;
  let killSwitchSince: string | null = null;
  if (cfg) {
    notifyAutoSubmit = notifyFromRow(cfg.filter((c) => String(c.key) === 'notify_signal_auto_submit'));
    const ks = cfg.find((c) => String(c.key) === 'safety_kill_switch');
    const ms = ks ? toMs(ks.updated_at) : null;
    killSwitchSince = ms == null ? null : kstIso(ms);
  } else {
    errors.push('notify_read_error');
  }

  const stage = deriveOpsStage({ liveTrading, killSwitch, validatedEnabled: strategies?.validatedEnabled ?? null }, errors);
  return { readAt, stage, liveTrading, killSwitch, exitEngine, strategies, notifyAutoSubmit, errors, killSwitchSince };
}

/** 응답에서 부가 값을 뺀 DTO 모양. */
export function toSafetyDTO(s: SafetyStateDTO & SafetyStateExtra): SafetyStateDTO {
  const { killSwitchSince: _drop, ...dto } = s;
  return dto;
}
