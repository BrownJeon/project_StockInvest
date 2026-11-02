/**
 * T-112 크론 잡 매핑·슬롯 표 — 공동 인계서 J8 의 **"현행 하드코딩 표"**(DDL 초안 §2.4). 순수 모듈(DB·환경변수 없음, 시각은 인자로).
 *
 * `scripts/cron-runner.sh` 의 `call()` 은 경로·라벨·본문만 안다 — 예정 슬롯을 모른다(초안 §4.3 E11). 그래서 기록 라우트가 이 표로
 * 라벨·실제 시작 시각에서 `scheduled_slot_at`·`session_date_kst/et`·`run_kind`·`market`·`target` 을 정한다.
 * T-104 단계 1(잡 정의·스케줄 DB 화)이 시작되면 이 표를 검증된 스케줄로 바꾼다. 그때까지 러너 라벨과 이 표가 어긋나면 안 된다 —
 * `__tests__/job-slots.test.ts` 가 러너 소스의 `call … "<라벨>"` 과 peek 슬롯 규칙을 읽어 이 표와 대조한다(E11).
 *
 * ## 슬롯 규칙
 * - `tick`(매 분 잡 3개)·`periodic`(5·15·30·60틱): 시계 슬롯이 없다(T-104 C 에서 "마지막 실행 + N분"). 재전송 중복을 막으려고
 *   `scheduled_slot_at` 에 **실제 시작을 분 단위로 내린 값**(의사 슬롯)을 넣는다. `missing` 합성 대상이 아니다(R4 — v1 은 합성 안 함).
 * - `rollup: true`(사용자 결정 U2 — 60분 미만 주기 잡 = 매 분 3개 + strategy-eval·trade-report·signal-followup·signal-expiry): 실행마다
 *   행을 남기지 않고 **KST 정시 슬롯의 시간 롤업 1줄**(`recorder=runner_rollup`)에 모으고, **실패한 실행만 즉시 1줄**(`runner_hook`,
 *   의사 슬롯)을 따로 남긴다. portfolio-snapshot(60틱)은 60분 미만이 아니라 실행마다 1줄.
 * - `daily`: KST `HH:MM` 슬롯. 실제 시작이 [슬롯, 슬롯 + windowMin분) 안이면 그 슬롯(재시도 = 같은 슬롯 → ODKU 로 attempt+1).
 *   windowMin 은 러너가 그 잡을 부를 수 있는 창 + 같은 틱 앞 잡이 늘어질 여유 5분이다(예: 08시 틱은 최악 약 290초라 08:59 에 시작한
 *   틱의 kis-fundamentals-snapshot 이 09:03 에 시작할 수 있다 → 08:00 + 65분). 창 밖이면 의사 슬롯(분 단위)으로 남긴다(재전송 멱등 유지).
 * - `et_daily`(holdings-premarket): America/New_York `HH:MM`(서머타임은 Intl 이 처리). `session_date_et` = 그 ET 날짜.
 * - `session_date_kst` = 슬롯(없으면 시작) 시각의 KST 날짜. `session_date_et` = 해외(`market='overseas'`) 잡만, 같은 시각의 ET 날짜.
 */

export type RunKind = 'ingest' | 'peek' | 'drain' | 'reconcile' | 'analysis' | 'other';
/** DDL `run_kind VARCHAR(24)` 의 앱 허용 목록(초안 §2.2 — ENUM 이 아니라 앱이 검사). */
export const RUN_KINDS: readonly RunKind[] = ['ingest', 'peek', 'drain', 'reconcile', 'analysis', 'other'];
export type JobMarket = 'domestic' | 'overseas' | 'common';
export type SlotKind = 'tick' | 'periodic' | 'daily' | 'et_daily';

export interface JobSpec {
  jobId: string;
  runKind: RunKind;
  market: JobMarket;
  target: string | null;
  kind: SlotKind;
  /** tick·periodic: 러너 틱 주기(i % N). */
  everyTicks?: number;
  /** daily(KST)·et_daily(ET): 'HH:MM'. */
  slotTime?: string;
  /** daily·et_daily: 슬롯 시각부터 이 분 수 안에 시작하면 그 슬롯. */
  windowMin?: number;
  /** U2 — 시간 롤업 + 실패 즉시 1줄. */
  rollup: boolean;
  /** 러너가 HTTP 200 이면 본문을 싣지 않는 잡(매 분 잡 3개 — 초안 §5.1). 러너의 `jrl_hook` case 줄과 같아야 한다. */
  bodyOmittedOnOk: boolean;
}

/** 해외 peek 시각(T-118 — 06·07·08·15·16시 제외 매시 19회), 국내 peek 10·13시. 러너 peek 블록과 같아야 한다(시험이 대조). */
export const PEEK_OVERSEAS_HOURS: readonly string[] = [
  '00', '01', '02', '03', '04', '05', '09', '10', '11', '12', '13', '14', '17', '18', '19', '20', '21', '22', '23',
];
export const PEEK_DOMESTIC_HOURS: readonly string[] = ['10', '13'];

function tick(jobId: string, target: string | null): JobSpec {
  return { jobId, runKind: 'other', market: 'common', target, kind: 'tick', everyTicks: 1, rollup: true, bodyOmittedOnOk: true };
}
function periodic(jobId: string, runKind: RunKind, target: string | null, everyTicks: number): JobSpec {
  return { jobId, runKind, market: 'common', target, kind: 'periodic', everyTicks, rollup: everyTicks < 60, bodyOmittedOnOk: false };
}
function daily(jobId: string, runKind: RunKind, market: JobMarket, target: string | null, slotTime: string, windowMin: number): JobSpec {
  return { jobId, runKind, market, target, kind: 'daily', slotTime, windowMin, rollup: false, bodyOmittedOnOk: false };
}

/** 현행 하드코딩 표(초안 §2.4). 순서 = 러너 안 등장 순서(읽기 편의 — 의미 없음). */
export const JOB_SPECS: readonly JobSpec[] = [
  tick('entry-watcher', 'kis'),
  tick('holding-checker', null),
  tick('stop-alert', 'kis'),
  periodic('strategy-eval', 'analysis', null, 5),
  periodic('signal-followup', 'other', 'm4', 15),
  periodic('signal-expiry', 'other', null, 30),
  periodic('portfolio-snapshot', 'other', 'kis', 60),
  periodic('trade-report', 'other', null, 5),
  daily('sync-stock-meta', 'ingest', 'domestic', 'kis', '17:00', 65),
  daily('rs-update-domestic', 'analysis', 'domestic', null, '17:30', 35),
  daily('post-market-overseas', 'analysis', 'overseas', 'llm', '08:00', 65),
  daily('kis-fundamentals-snapshot', 'ingest', 'overseas', 'kis', '08:00', 65),
  daily('post-market-domestic', 'analysis', 'domestic', 'llm', '16:00', 65),
  daily('research-cycle-overseas', 'analysis', 'overseas', null, '07:00', 65),
  daily('edgar-sync', 'ingest', 'overseas', 'sec', '07:00', 65),
  daily('broker-fills', 'ingest', 'common', 'kis', '07:20', 45),
  daily('daily-bars', 'ingest', 'common', 'kis', '07:40', 20),
  daily('research-cycle-domestic', 'analysis', 'domestic', null, '16:00', 65),
  daily('news-fetch-overseas', 'ingest', 'overseas', 'rss', '06:00', 65),
  daily('news-fetch-domestic', 'ingest', 'domestic', 'rss', '06:00', 65),
  daily('news-fetch-domestic-pm', 'ingest', 'domestic', 'rss', '15:30', 35),
  ...PEEK_OVERSEAS_HOURS.map((hh) => daily(`news-peek-overseas-${hh}`, 'peek', 'overseas', 'rss', `${hh}:00`, 65)),
  ...PEEK_DOMESTIC_HOURS.map((hh) => daily(`news-peek-domestic-${hh}`, 'peek', 'domestic', 'rss', `${hh}:00`, 65)),
  {
    jobId: 'holdings-premarket', runKind: 'ingest', market: 'overseas', target: 'sec', kind: 'et_daily',
    slotTime: '08:00', windowMin: 65, rollup: false, bodyOmittedOnOk: false,
  },
  // (T-143 WP-A) 해외 분석 대상 월간 산출 — 매월 첫째 일요일 01:10~05:50 KST 창에서 2분마다 호출된다.
  //   창 전체(285분 = 01:10~05:55)를 **한 슬롯**으로 둔다 → 같은 run 의 청크 호출이 전부 01:10 슬롯으로 모여
  //   ODKU attempt+1 이 되고 기록은 **run 1건 = 행 1건**이다. 창 ÷ 간격 = 최대 140회라 attempt(TINYINT, 255) 안이다.
  //   `missing` 합성은 v1 에 없으므로(job-run-log.ts) 매일 돌지 않아도 「데이터 이상」이 뜨지 않는다.
  daily('overseas-universe-refresh', 'ingest', 'overseas', 'kis', '01:10', 285),
];

/**
 * 러너가 부르지만 `call()` 을 거치지 않아 후크로 기록되지 않는 잡(초안 §0-6) — 표에 넣지 않는다.
 * export-llm-trainset 은 bash 스크립트를 직접 돌린다(러너 03시 블록).
 */
export const JOBS_NOT_RECORDED: readonly string[] = ['export-llm-trainset'];

const SPEC_BY_ID = new Map<string, JobSpec>(JOB_SPECS.map((s) => [s.jobId, s]));

/** 표에 없는 라벨(러너에 새 잡이 생겼는데 표를 안 고친 경우) — 기록은 하되 분류는 보수적으로. 정합 시험이 이 경우를 막는다. */
export function fallbackSpec(jobId: string): JobSpec {
  return { jobId, runKind: 'other', market: 'common', target: null, kind: 'periodic', rollup: false, bodyOmittedOnOk: false };
}

export function specFor(jobId: string): JobSpec | undefined {
  return SPEC_BY_ID.get(jobId);
}

// ─────────────────────────────────────────────────────────────────────────────
// 시각 계산 (KST 는 고정 +9, ET 는 Intl)
// ─────────────────────────────────────────────────────────────────────────────

const KST_OFFSET_MS = 9 * 3600_000;
const MIN_MS = 60_000;
const HOUR_MS = 3600_000;
const DAY_MS = 86_400_000;

function pad2(n: number): string { return n < 10 ? `0${n}` : String(n); }

/** epoch ms → KST 'YYYY-MM-DD HH:MM:SS'(초 미만 버림). `src/lib/time.ts` toKstDatetime 과 같은 결과. */
export function kstDatetime(ms: number): string {
  return new Date(Math.floor(ms / 1000) * 1000 + KST_OFFSET_MS).toISOString().slice(0, 19).replace('T', ' ');
}
export function kstDate(ms: number): string {
  return kstDatetime(ms).slice(0, 10);
}

const ET_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
});
interface WallParts { y: number; mo: number; d: number; h: number; mi: number }
function etParts(ms: number): WallParts {
  const o: Record<string, string> = {};
  for (const p of ET_FMT.formatToParts(new Date(ms))) o[p.type] = p.value;
  return { y: Number(o.year), mo: Number(o.month), d: Number(o.day), h: Number(o.hour) % 24, mi: Number(o.minute) };
}
/** epoch ms → America/New_York 'YYYY-MM-DD'. */
export function etDate(ms: number): string {
  const p = etParts(ms);
  return `${p.y}-${pad2(p.mo)}-${pad2(p.d)}`;
}
/** ET 벽시계(날짜 'YYYY-MM-DD' + 'HH:MM') → epoch ms. EDT(−4)·EST(−5) 중 벽시계가 맞는 쪽. 둘 다 아니면(전환 틈) null. */
export function etWallToMs(date: string, hhmm: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m || !t) return null;
  const base = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(t[1]), Number(t[2]));
  for (const offH of [4, 5]) {
    const ms = base + offH * HOUR_MS;
    const p = etParts(ms);
    if (p.y === Number(m[1]) && p.mo === Number(m[2]) && p.d === Number(m[3]) && p.h === Number(t[1]) && p.mi === Number(t[2])) return ms;
  }
  return null;
}

function kstWallToMs(date: string, hhmm: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m || !t) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(t[1]), Number(t[2])) - KST_OFFSET_MS;
}

export interface SlotResult {
  /** epoch ms — 의사 슬롯 포함. 롤업은 `hourSlotMs` 를 쓴다. */
  slotMs: number;
  /** true = 표의 예정 슬롯(daily·et_daily 창 안), false = 의사 슬롯(분 단위 내림). */
  scheduled: boolean;
  sessionDateKst: string;
  sessionDateEt: string | null;
}

/** 시작 시각을 분 단위로 내린 의사 슬롯. */
export function minuteSlotMs(startMs: number): number {
  return Math.floor(startMs / MIN_MS) * MIN_MS;
}
/** KST 정시 슬롯(롤업). KST 오프셋이 정시 단위라 UTC 정시 내림과 같다. */
export function hourSlotMs(startMs: number): number {
  return Math.floor(startMs / HOUR_MS) * HOUR_MS;
}

function sessionDates(spec: JobSpec, ms: number, etOverride?: string): { sessionDateKst: string; sessionDateEt: string | null } {
  return {
    sessionDateKst: kstDate(ms),
    sessionDateEt: spec.market === 'overseas' ? (etOverride ?? etDate(ms)) : null,
  };
}

/** 실행 1건(시작 시각)의 슬롯·세션 날짜. 롤업 행은 {@link rollupSlot}. */
export function slotFor(spec: JobSpec, startMs: number): SlotResult {
  if ((spec.kind === 'daily' || spec.kind === 'et_daily') && spec.slotTime && spec.windowMin) {
    const win = spec.windowMin * MIN_MS;
    const dates = spec.kind === 'daily'
      ? [kstDate(startMs), kstDate(startMs - DAY_MS)]
      : [etDate(startMs), etDate(startMs - DAY_MS)];
    for (const d of dates) {
      const s = spec.kind === 'daily' ? kstWallToMs(d, spec.slotTime) : etWallToMs(d, spec.slotTime);
      if (s !== null && startMs >= s && startMs < s + win) {
        return { slotMs: s, scheduled: true, ...sessionDates(spec, s, spec.kind === 'et_daily' ? d : undefined) };
      }
    }
  }
  const s = minuteSlotMs(startMs);
  return { slotMs: s, scheduled: false, ...sessionDates(spec, s) };
}

/** 롤업 행의 슬롯(KST 정시)·세션 날짜. */
export function rollupSlot(spec: JobSpec, startMs: number): SlotResult {
  const s = hourSlotMs(startMs);
  return { slotMs: s, scheduled: false, ...sessionDates(spec, s) };
}
