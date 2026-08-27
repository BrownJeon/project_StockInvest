/**
 * `stockinvest-cron` 상시 워치독 (T-037).
 *
 * ## 무엇을 막으려는 장치인가
 *
 * 2026-08-24 23:39 ~ 2026-08-27 10:51 (2일 11시간) 동안 `stockinvest-cron` 이 멈춰 있었는데
 * **아무도, 아무것도 알려주지 않았다.** pm2 는 `status=online` 으로 표시하고 있었고(실제로는
 * `pid=N/A` 유령), 개별 잡의 실패 알림은 "잡이 아예 호출되지 않는" 상황을 잡지 못한다.
 * entry-watcher(자동 주문)·holding-checker·strategy-eval·signal-expiry 가 전부 정지한
 * **자동매매 전체 정지** 상태였는데도 침묵했다.
 *
 * → cron 루프가 매 tick 남기는 하트비트를 **앱 본체(next server) 안에서** 주기적으로 확인한다.
 *
 * ## 왜 앱 본체 안인가
 *
 * 이번 사고에서 cron 은 죽고 앱은 살아 있었다(T-037 §B-3: pm2 fork 모드만 `spawn ENOENT` 로
 * 유령이 되고, cluster 모드인 앱은 크래시 루프 끝에 정상 복귀). **서로 다른 실패모드를 갖는
 * 두 프로세스**이므로 앱이 cron 을 감시하는 구성이 성립한다.
 *
 * ## 🔴 이 모듈이 하지 않는 것 — 경계를 명시한다
 *
 * - **주문을 내지 않는다.** `submitOrder`·거래소 어댑터·`orders` 테이블을 import 조차 하지 않는다.
 *   "cron 이 죽었으니 대신 주문을 넣는다" 같은 자동 보정은 **의도적으로 구현하지 않는다** —
 *   감시자가 자금을 움직이기 시작하면 감시자의 버그가 곧 오발주가 된다.
 * - **cron 을 재기동하지 않는다.** 복구는 사람이 판단한다(알림만).
 * - **pm2 유령 상태 자체를 고치지 못한다.** 그건 pm2/HOME-SERVER 소관이고(T-037 §D),
 *   이 워치독은 "죽었을 때 우리가 알아채는" **2차 방어선**이지 근본 수정이 아니다.
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resetAlertThrottle, sendAlertThrottled } from '@/lib/notify/throttle';

/** 스로틀 키 — 장애 경보. */
export const CRON_WATCHDOG_ALERT_KEY = 'cron_heartbeat_down';
/** 스로틀 키 — 복구 통지. */
export const CRON_WATCHDOG_RECOVERY_KEY = 'cron_heartbeat_recovered';

export interface WatchdogConfig {
  enabled: boolean;
  /** 하트비트 파일 경로 (cron-runner.sh 의 `CRON_HEARTBEAT_FILE` 과 같은 값이어야 한다). */
  heartbeatFile: string;
  /** 확인 주기(ms). */
  checkIntervalMs: number;
  /** 이 시간 넘게 갱신이 없으면 정지로 본다(ms). */
  staleAfterMs: number;
  /** 앱 부팅 직후 이 시간 동안은 "파일 없음"을 장애로 보지 않는다(ms). */
  bootGraceMs: number;
  /** 장애가 지속될 때 재알림 간격(ms). */
  reAlertTtlMs: number;
}

export type HeartbeatVerdict =
  /** 정상 — 최근에 갱신됨. */
  | { state: 'alive'; ageMs: number }
  /** 파일은 있으나 너무 오래됐다 = cron 루프 정지. */
  | { state: 'stale'; ageMs: number }
  /** 파일이 없고 부팅 유예도 지났다 = cron 이 한 번도 못 떴다. */
  | { state: 'missing'; sinceBootMs: number }
  /** 파일이 없지만 아직 부팅 유예 안 — 정상으로도 장애로도 치지 않는다. */
  | { state: 'boot_grace'; sinceBootMs: number }
  /** 읽기 자체가 실패 — "살아있음을 확인하지 못했다"이므로 fail-closed 로 장애 취급. */
  | { state: 'unreadable'; error: string };

function envInt(name: string, defaultSec: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return defaultSec * 1000;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    console.warn(`[cron-watchdog] ${name} 값을 해석할 수 없음(${JSON.stringify(raw)}) → 기본값 ${defaultSec}s 사용`);
    return defaultSec * 1000;
  }
  return n * 1000;
}

/** `cron-runner.sh` 의 기본 경로와 **반드시 동일**해야 한다. 한쪽만 바꾸면 워치독이 영구 오탐한다. */
export function defaultHeartbeatFile(): string {
  const home = process.env.HOME && process.env.HOME.trim() !== '' ? process.env.HOME : os.homedir();
  return path.join(home, '.node-local', 'stockinvest', 'cron-heartbeat');
}

export function resolveWatchdogConfig(override: Partial<WatchdogConfig> = {}): WatchdogConfig {
  return {
    // 기본 ON. 끄려면 명시적으로 'false'.
    enabled: String(process.env.CRON_WATCHDOG_ENABLED ?? 'true').toLowerCase() !== 'false',
    heartbeatFile: process.env.CRON_HEARTBEAT_FILE?.trim() || defaultHeartbeatFile(),
    // 확인 2분 / 정지판정 5분: cron tick 은 60초이므로 4회 연속 누락에 해당한다.
    // 잡 하나가 느려 tick 이 한두 번 밀리는 정상 변동을 장애로 오인하지 않을 만큼의 여유.
    checkIntervalMs: envInt('CRON_WATCHDOG_CHECK_SEC', 120),
    staleAfterMs: envInt('CRON_HEARTBEAT_STALE_SEC', 300),
    // 부팅 유예 10분: 이번 사고의 원인이 **부팅 시 NFS 마운트 경합**이라 cron 이 앱보다 늦게
    // 뜨는 것은 정상 범주다. 다만 유예가 지나도 파일이 없으면 그건 "영영 안 떴다"이므로 알린다.
    bootGraceMs: envInt('CRON_WATCHDOG_BOOT_GRACE_SEC', 600),
    // 재알림 30분. edge-trigger(아래 reportVerdict)와 조합돼 첫 발생은 즉시, 이후는 30분마다.
    reAlertTtlMs: envInt('CRON_WATCHDOG_REALERT_SEC', 1800),
    ...override,
  };
}

/**
 * 순수 판정 함수 — IO 없음. 테스트가 모든 분기를 시간 조작 없이 검증할 수 있게 분리했다.
 *
 * `content`(epoch 초)를 1순위로 쓰고, 파싱 불가하면 `mtimeMs` 로 폴백한다.
 * 둘 다 없으면 판정 불가이므로 `unreadable`.
 */
export function evaluateHeartbeat(args: {
  now: number;
  bootAt: number;
  content: string | null;
  mtimeMs: number | null;
  exists: boolean;
  readError?: string | null;
  cfg: Pick<WatchdogConfig, 'staleAfterMs' | 'bootGraceMs'>;
}): HeartbeatVerdict {
  const { now, bootAt, content, mtimeMs, exists, readError, cfg } = args;
  const sinceBootMs = Math.max(0, now - bootAt);

  if (readError) return { state: 'unreadable', error: readError };

  if (!exists) {
    return sinceBootMs < cfg.bootGraceMs
      ? { state: 'boot_grace', sinceBootMs }
      : { state: 'missing', sinceBootMs };
  }

  let beatMs: number | null = null;
  if (content !== null) {
    const n = Number(content.trim());
    // epoch 초. 0 이하·NaN 은 무효로 보고 mtime 폴백.
    if (Number.isFinite(n) && n > 0) beatMs = n * 1000;
  }
  if (beatMs === null && mtimeMs !== null && Number.isFinite(mtimeMs)) beatMs = mtimeMs;
  if (beatMs === null) return { state: 'unreadable', error: 'heartbeat 내용·mtime 모두 판독 불가' };

  // 시계 역전(미래 타임스탬프)은 0 으로 클램프한다. NTP 보정·시간대 착오로 미래 값이 들어와도
  // 음수 age 때문에 "정상"이 되는 건 맞지만, 그 반대(과거로 보정되어 오탐)를 만들지 않는 게 중요.
  const ageMs = Math.max(0, now - beatMs);
  return ageMs > cfg.staleAfterMs ? { state: 'stale', ageMs } : { state: 'alive', ageMs };
}

function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}초`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}분 ${s % 60}초`;
  const h = Math.floor(m / 60);
  return `${h}시간 ${m % 60}분`;
}

/** 워치독이 본 직전 상태 — edge-trigger 판정용. */
export type WatchdogPhase = 'unknown' | 'up' | 'down';

/**
 * 판정 → 알림. **edge-triggered + 주기 재알림** 조합이다.
 *
 * - 정상 → 장애로 **바뀌는 순간**: 스로틀 창을 초기화해 **즉시 1발** 보낸다.
 * - 장애 **지속** 중: `reAlertTtlMs` 간격으로만 재알림(무음 장기화 방지 ↔ 스팸 방지).
 * - 장애 → 정상 **복구**: 복구 통지 1발 + 장애 키 초기화(다음 장애도 즉시 알리도록).
 *
 * (T-018 MED-4 파생 "구조적 상태에 영원히 반복되는 경보" 사례를 참고해 edge 성격을 넣었다.)
 *
 * @returns 갱신된 phase
 */
export function reportVerdict(
  verdict: HeartbeatVerdict,
  prevPhase: WatchdogPhase,
  cfg: WatchdogConfig,
  send: typeof sendAlertThrottled = sendAlertThrottled,
  reset: typeof resetAlertThrottle = resetAlertThrottle,
): WatchdogPhase {
  // 부팅 유예 구간은 상태를 바꾸지 않는다 — 아직 아무것도 판정하지 않았다는 뜻.
  if (verdict.state === 'boot_grace') return prevPhase;

  if (verdict.state === 'alive') {
    if (prevPhase === 'down') {
      reset(CRON_WATCHDOG_ALERT_KEY);
      send(
        CRON_WATCHDOG_RECOVERY_KEY,
        'info',
        '✅ stockinvest-cron 하트비트 복구',
        `cron 루프가 다시 동작한다. 마지막 갱신 ${fmtDuration(verdict.ageMs)} 전.\n` +
        `하트비트: ${cfg.heartbeatFile}`,
        cfg.reAlertTtlMs,
      );
    }
    return 'up';
  }

  // ── 장애 ────────────────────────────────────────────────────────────────
  if (prevPhase !== 'down') reset(CRON_WATCHDOG_ALERT_KEY);   // edge → 즉시 발사
  reset(CRON_WATCHDOG_RECOVERY_KEY);

  let detail: string;
  if (verdict.state === 'stale') {
    detail = `하트비트가 ${fmtDuration(verdict.ageMs)} 동안 갱신되지 않았다 ` +
             `(정지 판정 기준 ${fmtDuration(cfg.staleAfterMs)}).`;
  } else if (verdict.state === 'missing') {
    detail = `하트비트 파일이 없다. 앱 부팅 후 ${fmtDuration(verdict.sinceBootMs)} 이 지났는데 ` +
             `cron 이 한 번도 기록하지 않았다 — **cron 이 아예 뜨지 못했을 가능성이 높다** ` +
             `(pm2 가 NFS 마운트보다 먼저 기동하는 부팅 경합: T-037 §B-3).`;
  } else {
    detail = `하트비트 파일을 읽지 못했다: ${verdict.error}`;
  }

  send(
    CRON_WATCHDOG_ALERT_KEY,
    'critical',
    '🚨 자동매매 전체 정지 — stockinvest-cron 무응답',
    `${detail}\n\n` +
    `정지 중인 잡: entry-watcher(자동 주문) · holding-checker · strategy-eval · ` +
    `signal-followup · signal-expiry · portfolio-snapshot · trade-report\n` +
    `하트비트: ${cfg.heartbeatFile}\n\n` +
    `확인: pm2 list — status=online 인데 pid 가 비어 있으면 유령 상태다.\n` +
    `복구: pm2 restart stockinvest-cron\n` +
    `※ 이 알림은 개별 잡 실패가 아니라 **cron 루프 자체의 정지**를 뜻한다.`,
    cfg.reAlertTtlMs,
  );
  return 'down';
}

/** 1회 확인 — IO 를 수행하고 판정까지 반환한다(타이머와 분리해 테스트 가능하게). */
export async function checkHeartbeatOnce(
  cfg: WatchdogConfig,
  bootAt: number,
  now: number = Date.now(),
): Promise<HeartbeatVerdict> {
  let content: string | null = null;
  let mtimeMs: number | null = null;
  let exists = false;
  let readError: string | null = null;

  try {
    const st = await fs.stat(cfg.heartbeatFile);
    exists = true;
    mtimeMs = st.mtimeMs;
    try {
      content = await fs.readFile(cfg.heartbeatFile, 'utf8');
    } catch {
      content = null;   // 내용 못 읽어도 mtime 으로 판정 가능 — 치명적이지 않다
    }
  } catch (e) {
    const code = (e as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') {
      exists = false;
    } else {
      // 권한·IO 오류 등 — "없음"과 구분한다. 없음은 부팅 유예 대상이지만 이건 아니다.
      readError = e instanceof Error ? e.message : String(e);
    }
  }

  return evaluateHeartbeat({ now, bootAt, content, mtimeMs, exists, readError, cfg });
}

interface WatchdogHandle {
  timer: NodeJS.Timeout;
  bootAt: number;
  phase: WatchdogPhase;
  cfg: WatchdogConfig;
}

/**
 * 프로세스 전역 단일 인스턴스 보장.
 *
 * `Symbol.for` 로 전역 레지스트리에 둔다 — dev 핫리로드나 모듈 이중 평가로 `register()` 가
 * 여러 번 불려도 **타이머가 중복 등록되지 않는다**(중복되면 같은 장애에 알림이 N배로 나간다).
 */
const HANDLE_KEY = Symbol.for('stockinvest.cronWatchdog.handle');

function getHandle(): WatchdogHandle | null {
  return (globalThis as Record<symbol, unknown>)[HANDLE_KEY] as WatchdogHandle | null ?? null;
}

/**
 * 워치독 시작. 이미 돌고 있으면 아무 것도 하지 않고 `false` 를 반환한다.
 * @returns 이번 호출로 실제 시작했으면 true
 */
export function startCronWatchdog(override: Partial<WatchdogConfig> = {}): boolean {
  if (getHandle()) return false;

  const cfg = resolveWatchdogConfig(override);
  if (!cfg.enabled) {
    console.warn('[cron-watchdog] CRON_WATCHDOG_ENABLED=false — cron 정지를 감시하지 않는다.');
    return false;
  }

  const bootAt = Date.now();
  const timer = setInterval(() => {
    const h = getHandle();
    if (!h) return;
    // setInterval 콜백에서 예외가 새면 타이머가 죽거나 unhandled rejection 이 된다 — 전부 삼킨다.
    void checkHeartbeatOnce(h.cfg, h.bootAt)
      .then((verdict) => { h.phase = reportVerdict(verdict, h.phase, h.cfg); })
      .catch((e) => { console.error('[cron-watchdog] 확인 중 예외:', e instanceof Error ? e.message : String(e)); });
  }, cfg.checkIntervalMs);

  // 이 타이머가 프로세스 종료를 막지 않게 한다 (pm2 restart/stop 이 지연되면 안 된다).
  timer.unref?.();

  (globalThis as Record<symbol, unknown>)[HANDLE_KEY] = { timer, bootAt, phase: 'unknown', cfg } satisfies WatchdogHandle;

  console.log(
    `[cron-watchdog] 시작 — file=${cfg.heartbeatFile} check=${cfg.checkIntervalMs / 1000}s ` +
    `stale=${cfg.staleAfterMs / 1000}s bootGrace=${cfg.bootGraceMs / 1000}s realert=${cfg.reAlertTtlMs / 1000}s`,
  );
  return true;
}

/** 정지 — 테스트·정리용. */
export function stopCronWatchdog(): void {
  const h = getHandle();
  if (!h) return;
  clearInterval(h.timer);
  (globalThis as Record<symbol, unknown>)[HANDLE_KEY] = null;
}

/** 진단용 — 현재 워치독 상태 스냅샷. */
export function describeCronWatchdog(): { running: boolean; phase: WatchdogPhase; cfg: WatchdogConfig | null } {
  const h = getHandle();
  return { running: Boolean(h), phase: h?.phase ?? 'unknown', cfg: h?.cfg ?? null };
}
