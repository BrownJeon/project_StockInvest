/**
 * T-112 job-slots — 잡 매핑·슬롯 표(공동 인계서 J8 "현행 하드코딩 표") 시험.
 *  1. 🔴 E11 정합: 러너 소스(scripts/cron-runner.sh)의 `call … "<라벨>"` 정적 라벨 + peek 슬롯 규칙(제외 시·국내 시) = 표의 jobId 전부
 *     · 주기(i % N) · 하루 1회 잡의 시(HH) 조건 · 매 분 잡의 본문 생략 목록(러너 jrl_hook case 줄) · call() 을 안 거치는 잡(export-llm-trainset)
 *  2. 슬롯: 하루 1회 창 안/밖 · 재시도 같은 슬롯 · 자정 넘김(peek 23시) · 08시 틱 늘어짐(09:03) · 의사 슬롯(분) · 롤업(정시)
 *  3. 🔴 서머타임: holdings-premarket = ET 08:00 → KST 21:00(EDT, 10-30) / 22:00(EST, 11-02), session_date_et 정확
 *  4. session_date_et 는 해외 잡만, KST 날짜와 다를 수 있다(08:00 KST = 전날 ET)
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  JOBS_NOT_RECORDED,
  JOB_SPECS,
  PEEK_DOMESTIC_HOURS,
  PEEK_OVERSEAS_HOURS,
  RUN_KINDS,
  etDate,
  etWallToMs,
  fallbackSpec,
  hourSlotMs,
  kstDatetime,
  minuteSlotMs,
  rollupSlot,
  slotFor,
  specFor,
} from '../job-slots';

const RUNNER = path.resolve(__dirname, '..', '..', '..', '..', '..', 'scripts', 'cron-runner.sh');
const src = fs.readFileSync(RUNNER, 'utf8');
const lines = src.split('\n');
const codeLines = lines.map((l, i) => ({ l, i })).filter(({ l }) => !/^\s*#/.test(l));

/** KST 벽시계 → epoch ms */
const kst = (s: string) => Date.parse(`${s.replace(' ', 'T')}+09:00`);
const spec = (id: string) => {
  const s = specFor(id);
  if (!s) throw new Error(`표에 없음: ${id}`);
  return s;
};

describe('🔴 E11 — 슬롯 표 ↔ 러너 라벨 정합', () => {
  const CALL_RE = /^\s*call\s+(?:"[^"]*"|\S+)\s+"([^"$]+)"\s*$/;
  const staticLabels = codeLines.map(({ l }) => CALL_RE.exec(l)?.[1]).filter((x): x is string => !!x);

  it('정적 call 라벨을 읽었다(하네스 확인)', () => {
    expect(staticLabels.length).toBeGreaterThanOrEqual(20);
    // (T-147) 라벨 중복은 `stop-alert` 하나만 허용한다 — 호출 줄이 2개다(알림 티커 자식 · 메인 루프 fallback).
    //   둘은 플래그 `ALERT_TICKER_ACTIVE` 로 **동시에 참이 될 수 없어** 호출자는 항상 하나이고(그 배타성은
    //   scripts/test-cron-runner-alert-ticker.sh A 절이 정적으로 고정한다), 라벨·슬롯·주기는 하나 그대로다.
    //   나머지 라벨은 여전히 중복이 없어야 한다(같은 잡을 두 번 부르는 실수를 잡는 원래 목적).
    const dups = staticLabels.filter((l, i) => staticLabels.indexOf(l) !== i);
    expect(dups).toEqual(['stop-alert']);
    expect(staticLabels.filter((l) => l === 'stop-alert')).toHaveLength(2);
    expect(new Set(staticLabels).size).toBe(staticLabels.length - 1);
  });

  it('peek 규칙 = 표의 시각 목록(해외 19 · 국내 2)', () => {
    const ex = /^\s+([0-9|]+)\) PEEK_SLOTS="" ;;/.exec(lines.find((l) => /PEEK_SLOTS="" ;;\s+#\s*무거운/.test(l)) ?? '');
    expect(ex).not.toBeNull();
    const excluded = new Set(ex![1].split('|'));
    const all = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'));
    expect(all.filter((h) => !excluded.has(h))).toEqual([...PEEK_OVERSEAS_HOURS]);
    expect(PEEK_OVERSEAS_HOURS).toHaveLength(19);
    const dom = /^\s+([0-9|]+)\) PEEK_SLOTS="\$PEEK_SLOTS domestic:\$HH" ;;/.exec(lines.find((l) => /domestic:\$HH" ;;/.test(l)) ?? '');
    expect(dom).not.toBeNull();
    expect(dom![1].split('|')).toEqual([...PEEK_DOMESTIC_HOURS]);
    expect(src).toContain('PEEK_LABEL="news-peek-${PEEK_MKT}-${PEEK_HH}"');
    expect(codeLines.some(({ l }) => /^\s*call "\/api\/cron\/news-fetch\?market=\$\{PEEK_MKT\}&mode=peek" "\$PEEK_LABEL"$/.test(l))).toBe(true);
  });

  it('🔴 표의 jobId 집합 = 러너 정적 라벨 + peek 21개 (빠진 것·남는 것 없음)', () => {
    const expected = new Set([
      ...staticLabels,
      ...PEEK_OVERSEAS_HOURS.map((h) => `news-peek-overseas-${h}`),
      ...PEEK_DOMESTIC_HOURS.map((h) => `news-peek-domestic-${h}`),
    ]);
    const table = new Set(JOB_SPECS.map((s) => s.jobId));
    expect([...expected].filter((x) => !table.has(x))).toEqual([]);
    expect([...table].filter((x) => !expected.has(x))).toEqual([]);
    expect(JOB_SPECS).toHaveLength(table.size);
  });

  it('call() 을 거치지 않는 잡은 표에 없다(export-llm-trainset — 러너가 bash 로 직접 돌린다)', () => {
    for (const id of JOBS_NOT_RECORDED) {
      expect(specFor(id)).toBeUndefined();
      expect(staticLabels).not.toContain(id);
      expect(src).toContain(`echo "[$ts] ${id} start"`);
    }
  });

  it('주기 잡의 everyTicks = 러너의 i % N, 매 분 잡은 조건 없이 매 틱', () => {
    for (const s of JOB_SPECS.filter((x) => x.kind === 'periodic' || x.kind === 'tick')) {
      const idx = codeLines.findIndex(({ l }) => CALL_RE.exec(l)?.[1] === s.jobId);
      expect(idx).toBeGreaterThan(-1);
      const prev = codeLines[idx - 1].l;
      const m = /if \[ \$\(\(i % (\d+)\)\) -eq 0 \]; then/.exec(prev);
      if (s.kind === 'periodic') expect(m && Number(m[1])).toBe(s.everyTicks);
      else expect(m).toBeNull();
    }
  });

  it('하루 1회 잡의 슬롯 시(HH 또는 HH:MM)가 러너 조건에 있다(호출 위 14줄 안)', () => {
    for (const s of JOB_SPECS.filter((x) => x.kind === 'daily' && !x.jobId.startsWith('news-peek-'))) {
      const idx = lines.findIndex((l) => !/^\s*#/.test(l) && CALL_RE.exec(l)?.[1] === s.jobId);
      expect(idx).toBeGreaterThan(-1);
      const above = lines.slice(Math.max(0, idx - 14), idx).filter((l) => !/^\s*#/.test(l)).join('\n');
      const [hh, mm] = s.slotTime!.split(':');
      const hit = above.includes(`"$HH" = "${hh}"`) || above.includes(`"$HH_MM" = "${hh}:${mm}"`);
      expect({ job: s.jobId, hit }).toEqual({ job: s.jobId, hit: true });
      if (mm !== '00' && !above.includes(`"$HH_MM" = "${hh}:${mm}"`)) expect(above).toMatch(new RegExp(`-ge ${Number(mm)} \\]`));
    }
    // holdings-premarket 은 ET 08시
    const hp = lines.findIndex((l) => CALL_RE.exec(l)?.[1] === 'holdings-premarket');
    expect(lines.slice(hp - 14, hp).join('\n')).toContain('"${HP_ET_HH:-}" = "08"');
    expect(src).toContain("HP_ET=$(TZ=America/New_York date '+%F %H %u %Z')");
  });

  it('🔴 러너 jrl_hook 의 본문 생략 목록 = 표의 bodyOmittedOnOk', () => {
    const m = /^\s+([a-z|-]+)\) \[ "\$hc" = "200" \] && b64_skip=1 ;;/m.exec(src);
    expect(m).not.toBeNull();
    expect(m![1].split('|').sort()).toEqual(JOB_SPECS.filter((s) => s.bodyOmittedOnOk).map((s) => s.jobId).sort());
  });

  it('표 값의 형식(run_kind 허용 목록·job_id 64자·롤업 = 60분 미만 주기 잡)', () => {
    for (const s of JOB_SPECS) {
      expect(RUN_KINDS).toContain(s.runKind);
      expect(s.jobId.length).toBeLessThanOrEqual(64);
      expect(['domestic', 'overseas', 'common']).toContain(s.market);
      if (s.kind === 'tick') expect(s.rollup).toBe(true);
      if (s.kind === 'periodic') expect(s.rollup).toBe((s.everyTicks ?? 0) < 60);
      if (s.kind === 'daily' || s.kind === 'et_daily') {
        expect(s.rollup).toBe(false);
        expect(s.slotTime).toMatch(/^\d{2}:\d{2}$/);
        expect(s.windowMin).toBeGreaterThan(0);
      }
    }
    expect(JOB_SPECS.filter((s) => s.rollup).map((s) => s.jobId).sort()).toEqual(
      ['entry-watcher', 'holding-checker', 'signal-expiry', 'signal-followup', 'stop-alert', 'strategy-eval', 'trade-report'].sort(),
    );
    expect(fallbackSpec('new-job')).toMatchObject({ runKind: 'other', market: 'common', rollup: false });
  });
});

describe('슬롯 계산', () => {
  it('하루 1회: 창 안이면 예정 슬롯, 재시도 08:10·08:20 도 같은 슬롯', () => {
    const s = spec('post-market-overseas');
    for (const t of ['2026-10-30 08:00:02', '2026-10-30 08:10:05', '2026-10-30 08:20:01', '2026-10-30 09:04:59']) {
      const r = slotFor(s, kst(t));
      expect(r.scheduled).toBe(true);
      expect(kstDatetime(r.slotMs)).toBe('2026-10-30 08:00:00');
      expect(r.sessionDateKst).toBe('2026-10-30');
      expect(r.sessionDateEt).toBe('2026-10-29'); // 08:00 KST = 10-29 19:00 EDT
    }
  });
  it('08시 틱이 늘어져 kis-fundamentals-snapshot 이 09:03 에 시작해도 08:00 슬롯', () => {
    const r = slotFor(spec('kis-fundamentals-snapshot'), kst('2026-10-30 09:03:10'));
    expect([r.scheduled, kstDatetime(r.slotMs)]).toEqual([true, '2026-10-30 08:00:00']);
  });
  it('창 밖(수동·이상 시각)은 의사 슬롯(분 단위 내림), 시작 전이면 전날 창도 보지만 맞지 않으면 의사 슬롯', () => {
    const r = slotFor(spec('post-market-overseas'), kst('2026-10-30 12:34:56'));
    expect([r.scheduled, kstDatetime(r.slotMs)]).toEqual([false, '2026-10-30 12:34:00']);
    const early = slotFor(spec('daily-bars'), kst('2026-10-30 07:39:59'));
    expect([early.scheduled, kstDatetime(early.slotMs)]).toEqual([false, '2026-10-30 07:39:00']);
    const late = slotFor(spec('daily-bars'), kst('2026-10-30 08:00:00'));
    expect(late.scheduled).toBe(false);
    const inDb = slotFor(spec('daily-bars'), kst('2026-10-30 07:59:59'));
    expect([inDb.scheduled, kstDatetime(inDb.slotMs)]).toEqual([true, '2026-10-30 07:40:00']);
  });
  it('자정 넘김: peek 23시 슬롯이 00:03 에 시작하면 전날 23:00', () => {
    const r = slotFor(spec('news-peek-overseas-23'), kst('2026-10-31 00:03:00'));
    expect([r.scheduled, kstDatetime(r.slotMs), r.sessionDateKst]).toEqual([true, '2026-10-30 23:00:00', '2026-10-30']);
  });
  it('news-fetch-domestic 은 해외 다음 틱(06:01)이어도 슬롯 06:00, 국내라 session_date_et 없음', () => {
    const r = slotFor(spec('news-fetch-domestic'), kst('2026-10-30 06:01:07'));
    expect([r.scheduled, kstDatetime(r.slotMs), r.sessionDateEt]).toEqual([true, '2026-10-30 06:00:00', null]);
  });
  it('rs-update-domestic 17:30 슬롯 · broker-fills 07:20 이후 창', () => {
    expect(kstDatetime(slotFor(spec('rs-update-domestic'), kst('2026-10-30 17:31:20')).slotMs)).toBe('2026-10-30 17:30:00');
    expect(kstDatetime(slotFor(spec('broker-fills'), kst('2026-10-30 07:58:00')).slotMs)).toBe('2026-10-30 07:20:00');
    expect(slotFor(spec('broker-fills'), kst('2026-10-30 07:19:00')).scheduled).toBe(false);
  });
  it('매 분·주기 잡: 의사 슬롯(분), 롤업 = KST 정시, 공통 잡은 session_date_et 없음', () => {
    const t = kst('2026-10-30 23:59:58');
    expect(kstDatetime(slotFor(spec('entry-watcher'), t).slotMs)).toBe('2026-10-30 23:59:00');
    const r = rollupSlot(spec('entry-watcher'), t);
    expect([kstDatetime(r.slotMs), r.sessionDateKst, r.sessionDateEt]).toEqual(['2026-10-30 23:00:00', '2026-10-30', null]);
    expect(kstDatetime(hourSlotMs(kst('2026-10-31 00:00:00')))).toBe('2026-10-31 00:00:00');
    expect(kstDatetime(minuteSlotMs(kst('2026-10-31 00:00:59')))).toBe('2026-10-31 00:00:00');
    expect(kstDatetime(slotFor(spec('portfolio-snapshot'), kst('2026-10-30 10:00:31')).slotMs)).toBe('2026-10-30 10:00:00');
  });
});

describe('🔴 서머타임 — holdings-premarket(ET 08:00 평일)', () => {
  it('EDT(10-30 금): ET 08:00 = KST 21:00, session_date_et 10-30', () => {
    expect(kstDatetime(etWallToMs('2026-10-30', '08:00')!)).toBe('2026-10-30 21:00:00');
    const r = slotFor(spec('holdings-premarket'), kst('2026-10-30 21:01:05'));
    expect([r.scheduled, kstDatetime(r.slotMs), r.sessionDateKst, r.sessionDateEt]).toEqual([true, '2026-10-30 21:00:00', '2026-10-30', '2026-10-30']);
  });
  it('EST(11-02 월, 11-01 서머타임 종료 뒤): ET 08:00 = KST 22:00, 21:30 시작은 슬롯 밖', () => {
    expect(kstDatetime(etWallToMs('2026-11-02', '08:00')!)).toBe('2026-11-02 22:00:00');
    const r = slotFor(spec('holdings-premarket'), kst('2026-11-02 22:00:40'));
    expect([r.scheduled, kstDatetime(r.slotMs), r.sessionDateEt]).toEqual([true, '2026-11-02 22:00:00', '2026-11-02']);
    expect(slotFor(spec('holdings-premarket'), kst('2026-11-02 21:30:00')).scheduled).toBe(false);
  });
  it('전환일 경계: 11-01 01:30 ET 는 두 번 있다(EDT 먼저), 3-08 02:30 ET 는 없다(null)', () => {
    expect(etWallToMs('2026-11-01', '01:30')).toBe(Date.parse('2026-11-01T05:30:00Z'));
    expect(etWallToMs('2026-03-08', '02:30')).toBeNull();
    expect(etWallToMs('bad', '08:00')).toBeNull();
  });
  it('etDate: KST 08:00 은 전날 ET', () => {
    expect(etDate(kst('2026-10-30 08:00:00'))).toBe('2026-10-29');
    expect(etDate(kst('2026-10-30 14:00:00'))).toBe('2026-10-30');
  });
});
