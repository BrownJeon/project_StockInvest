/**
 * T-145 ⑨ — `scripts/cron-runner.sh` 의 kis-fundamentals-snapshot 블록 시험(**블록 단위 시뮬레이션** — 러너 루프를 기동하지 않는다).
 *
 * 선례와 하네스가 같다: `src/app/api/cron/broker-fills/__tests__/cron-runner-block.test.ts`.
 * 러너 원문에서 `# >>> kis-fundamentals-snapshot` ~ `# <<< kis-fundamentals-snapshot` 을 잘라 bash 로 한 틱씩 돌린다.
 * `call` 은 가짜 함수(호출 기록만), `date` 는 가짜 시계, 날짜파일은 임시 디렉터리. curl·네트워크·실제 HOME·.env 를 쓰지 않는다.
 *
 * 🔴 **무엇을 고정하나** — ⑨ 의 핵심은 「08시 틱 길이를 종목 수와 무관하게 묶는다」이고 그 절반이 이 블록이다:
 *  1. 창 = 08시 **30~55분**. 08:00~08:29·08:56~·다른 시(07·09)에는 **호출 0** — `post-market-overseas`(curl 120초)와
 *     같은 틱에 겹치지 않게 하는 것이 슬롯 분리의 목적이다(실측 10-29 틱 282초 / 한도 300초).
 *  2. 창 안에서는 **매 틱** 부른다(하루 1회가 아니다) — 라우트가 90초 마감으로 끊고 DB 로 이어받으므로 완료까지 여러 틱이 필요하다.
 *     날짜파일은 남지만 **판정에 쓰이지 않는다**(러너는 이 잡의 진행 상태를 갖지 않는다 — 사양 9-2).
 *  3. 이 틱이 이미 `KIS_FUND_TICK_YIELD_SEC` 이상 지났으면 **건너뛴다**(pmo 재시도가 창에 들어온 경우 — 틱 340초 방지).
 *  4. `CALL_MAX_TIME` 이 그 호출에만 붙고 **뒤에서 비워진다**(다른 잡에 새지 않는다).
 *  5. 분을 읽을 수 없으면 그 틱은 돌지 않는다 · 시각을 읽을 수 없으면 **미루지 않는다**(판단 불가로 잡을 멈추지 않는다).
 *  6. 정적: 상수 2개 · 호출 줄 1개 · **기존 줄 삭제·변경 0**(HEAD 대비 추가만).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REPO = path.join(__dirname, '..', '..', '..', '..', '..', '..');
const RUNNER = path.join(REPO, 'scripts', 'cron-runner.sh');
const SRC = fs.readFileSync(RUNNER, 'utf8');

function block(): string {
  const lines = SRC.split('\n');
  const s = lines.findIndex((l) => l.trim().startsWith('# >>> kis-fundamentals-snapshot'));
  const e = lines.findIndex((l) => l.trim() === '# <<< kis-fundamentals-snapshot');
  if (s < 0 || e < 0 || e < s) throw new Error('block markers not found');
  return lines.slice(s, e + 1).join('\n');
}

/** 한 틱: 시·분·날짜 + 그 틱이 이 블록에 닿을 때까지 이미 지난 초(`elapsed`). */
interface Tick { hh: string; mm: string; today?: string; elapsed?: number }
interface Sim { calls: string[]; dateFile: string; callMaxAfter: string[] }

const D = '2026-11-03';

/** 틱들을 같은 임시 날짜파일로 차례로 돌린다. `preset` = 처음 날짜파일 내용. */
function simulate(ticks: Tick[], preset?: string, opts: { noClock?: boolean } = {}): Sim {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't145-kisfund-'));
  try {
    const f = path.join(dir, 'kis-fund-last-date');
    if (preset !== undefined) fs.writeFileSync(f, `${preset}\n`);
    const callsFile = path.join(dir, 'calls');
    const cmaFile = path.join(dir, 'cma');
    const consts = ['KIS_FUND_CURL_MAX_TIME', 'KIS_FUND_TICK_YIELD_SEC']
      .map((k) => (SRC.match(new RegExp(`^${k}=.*$`, 'm')) ?? [''])[0]);
    for (const c of consts) if (!c) throw new Error('constant line not found');
    for (const t of ticks) {
      const today = t.today ?? D;
      const t0 = 1_762_000_000;                       // 틱 시작(가짜 epoch)
      const now = t0 + (t.elapsed ?? 0);
      const script = [
        'set -u',
        ...consts,
        `KIS_FUNDAMENTALS_LAST_RUN_FILE='${f}'`,
        'CALL_MAX_TIME=""',
        `HH='${t.hh}'`,
        `TODAY='${today}'`,
        // 시각을 읽을 수 없는 경우(`noClock`)는 `date '+%s'` 가 빈 값을 준다
        `date() { case "$1" in '+%M') echo '${t.mm}' ;; '+%s') ${opts.noClock ? "echo ''" : `echo '${now}'`} ;; *) echo '${today} ${t.hh}:${t.mm}:00' ;; esac; }`,
        opts.noClock ? 'KIS_FUND_TICK_T0=""' : `KIS_FUND_TICK_T0='${t0}'`,
        `call() { echo "${t.hh}:${t.mm} $1 max=\${CALL_MAX_TIME:-none}" >> '${callsFile}'; }`,
        block(),
        `echo "\${CALL_MAX_TIME:-empty}" >> '${cmaFile}'`,
      ].join('\n');
      execFileSync('bash', ['-c', script], { encoding: 'utf8', env: { ...process.env, PATH: process.env.PATH ?? '/usr/bin:/bin' } });
    }
    const rd = (p: string) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '');
    return {
      calls: rd(callsFile).split('\n').filter(Boolean),
      dateFile: rd(f).trim(),
      callMaxAfter: rd(cmaFile).split('\n').filter(Boolean),
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const CALL = (hhmm: string, max = '110') => `${hhmm} /api/cron/kis-fundamentals-snapshot max=${max}`;

describe('cron-runner kis-fundamentals-snapshot 블록(시뮬레이션)', () => {
  test('🔴 1. 창은 08시 30~55분이다 — 그 앞(08:00·08:29)·뒤(08:56·08:59)에는 호출 0', () => {
    const s = simulate([
      { hh: '08', mm: '00' }, { hh: '08', mm: '29' }, { hh: '08', mm: '30' },
      { hh: '08', mm: '55' }, { hh: '08', mm: '56' }, { hh: '08', mm: '59' },
    ]);
    expect(s.calls).toEqual([CALL('08:30'), CALL('08:55')]);
  });

  test('🔴 1b. `post-market-overseas` 가 도는 08:00 틱에는 **절대** 돌지 않는다(슬롯 분리의 핵심)', () => {
    expect(simulate([{ hh: '08', mm: '00' }, { hh: '08', mm: '02' }, { hh: '08', mm: '20' }]).calls).toEqual([]);
  });

  test('1c. 다른 시에는 돌지 않는다(07·09·16시의 30~55분도)', () => {
    for (const hh of ['07', '09', '16', '00']) {
      expect(simulate([{ hh, mm: '30' }, { hh, mm: '45' }]).calls).toEqual([]);
    }
  });

  test('🔴 2. 창 안에서는 **매 틱** 부른다 — 날짜파일이 오늘이어도(하루 1회가 아니다)', () => {
    const s = simulate([{ hh: '08', mm: '30' }, { hh: '08', mm: '31' }, { hh: '08', mm: '32' }]);
    expect(s.calls).toEqual([CALL('08:30'), CALL('08:31'), CALL('08:32')]);
    expect(s.dateFile).toBe(D);                        // 쓰기는 남지만 판정에 쓰이지 않는다
  });

  test('2b. 날짜파일이 미리 오늘로 채워져 있어도 창 안에서는 부른다(종전에는 그 한 줄이 하루를 끝냈다)', () => {
    expect(simulate([{ hh: '08', mm: '40' }], D).calls).toEqual([CALL('08:40')]);
  });

  test('2c. 날짜파일이 없어도(첫 실행) 창 밖에서는 부르지 않는다 — 날짜파일이 조건이 아니다', () => {
    expect(simulate([{ hh: '08', mm: '10' }]).calls).toEqual([]);
    expect(simulate([{ hh: '08', mm: '10' }]).dateFile).toBe('');
  });

  test('🔴 3. 이 틱이 이미 오래 걸렸으면 건너뛰고 다음 틱에 부른다(pmo 재시도가 창에 들어온 경우)', () => {
    const s = simulate([{ hh: '08', mm: '30', elapsed: 150 }, { hh: '08', mm: '32', elapsed: 5 }]);
    expect(s.calls).toEqual([CALL('08:32')]);
  });

  test('3b. 경계: 59초는 부르고 60초(`KIS_FUND_TICK_YIELD_SEC`)는 건너뛴다', () => {
    expect(simulate([{ hh: '08', mm: '34', elapsed: 59 }]).calls).toEqual([CALL('08:34')]);
    expect(simulate([{ hh: '08', mm: '34', elapsed: 60 }]).calls).toEqual([]);
  });

  test('🔴 4. `CALL_MAX_TIME` 은 110 으로 붙고 호출 뒤 **비워진다**(다른 잡에 새지 않는다)', () => {
    const s = simulate([{ hh: '08', mm: '30' }, { hh: '08', mm: '10' }]);
    expect(s.calls).toEqual([CALL('08:30', '110')]);
    expect(s.callMaxAfter).toEqual(['empty', 'empty']);
  });

  test('5. 분을 읽을 수 없으면 그 틱은 돌지 않는다', () => {
    for (const mm of ['xx', '', '60', '7']) {
      expect(simulate([{ hh: '08', mm }]).calls).toEqual([]);
    }
  });

  test('🔴 5b. 시각을 읽을 수 없으면 **미루지 않는다** — 판단 불가로 잡을 멈추지 않는다', () => {
    expect(simulate([{ hh: '08', mm: '30' }], undefined, { noClock: true }).calls).toEqual([CALL('08:30')]);
  });
});

describe('cron-runner kis-fundamentals-snapshot 정적', () => {
  const BLK = block();

  test('블록 표식이 정확히 한 번 · 호출 줄 1개', () => {
    expect(SRC.split('\n').filter((l) => l.trim().startsWith('# >>> kis-fundamentals-snapshot'))).toHaveLength(1);
    expect(SRC.split('\n').filter((l) => l.trim() === '# <<< kis-fundamentals-snapshot')).toHaveLength(1);
    expect(BLK.match(/call "\/api\/cron\/kis-fundamentals-snapshot"/g)?.length).toBe(1);
  });

  test('🔴 상수 2개가 코드에 있다 — curl 상한 110(라우트 마감 90보다 길다) · 틱 yield 60', () => {
    expect(SRC).toMatch(/^KIS_FUND_CURL_MAX_TIME=110$/m);
    expect(SRC).toMatch(/^KIS_FUND_TICK_YIELD_SEC=60$/m);
  });

  test('🔴 상한은 그 호출 앞에서 켜고 바로 뒤에서 끈다', () => {
    expect(BLK).toMatch(/CALL_MAX_TIME="\$KIS_FUND_CURL_MAX_TIME".*\n\s*call "\/api\/cron\/kis-fundamentals-snapshot" "kis-fundamentals-snapshot"\n\s*CALL_MAX_TIME=""/);
  });

  test('블록 실행 줄에 비밀(CRON_SECRET·x-cron-secret)·curl 직접 호출 없음(call() 경유)', () => {
    const exec = BLK.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    expect(/cron_secret|x-cron-secret|curl /i.test(exec)).toBe(false);
  });

  test('🔴 틱 시작 시각은 T-112 의 `JRL_TICK_T0` 가 아니라 **이 잡의 변수**다(관찰 전용 규약을 깨지 않는다)', () => {
    expect(SRC).toMatch(/^\s*KIS_FUND_TICK_T0=\$\(date \+%s 2>\/dev\/null\)$/m);
    expect(BLK).not.toContain('JRL_TICK_T0');
  });

  test('bash -n 통과', () => {
    expect(() => execFileSync('bash', ['-n', RUNNER])).not.toThrow();
  });

  test('🔴 기존 줄 변경 0 — HEAD 대비 추가만(git 이 있을 때)', () => {
    let head: string;
    try {
      head = execFileSync('git', ['-C', REPO, 'show', 'HEAD:scripts/cron-runner.sh'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      return;   // git 없는 환경(배포 사본 등) — 건너뜀
    }
    const cur = SRC.split('\n');
    let j = 0;
    for (const line of head.split('\n')) {
      while (j < cur.length && cur[j] !== line) j++;
      expect([line, j < cur.length]).toEqual([line, true]);
      j++;
    }
  });
});
