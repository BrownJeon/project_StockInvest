/**
 * T-087 D1a — `scripts/cron-runner.sh` 의 broker-fills 블록 시험(**블록 단위 시뮬레이션** — 러너 루프를 기동하지 않는다).
 *
 * 러너 원문에서 "07시 해외 리서치 블록 ~ `# <<< broker-fills-daily`" 구간을 잘라 bash 로 한 틱씩 돌린다. `call` 은 가짜 함수(호출 기록만),
 * `date '+%M'`·`date '+%F %T'` 는 가짜 시계, 날짜파일은 임시 디렉터리. curl·네트워크·실제 HOME·.env 를 쓰지 않는다.
 *  1. 정상일: 07:19 는 안 돌고 07:20 첫 틱에 1회(--max-time 90), 날짜파일 = 오늘, 그 뒤 틱은 안 돈다. 08·06시는 안 돈다.
 *  2. 🔴 재기동(07:25 첫 틱 — research·edgar 날짜파일이 어제): 그 틱에 research·edgar 가 돌고 broker-fills 는 yield_tick(날짜파일 안 씀),
 *     다음 틱에 1회 — 날짜파일을 다시 읽으면 미루기가 발동하지 않는 N-2 함정을 고정한다.
 *  3. 둘 중 하나만 이 틱에 돌아도 미룬다 · 분을 읽을 수 없으면 돌지 않는다 · 호출 뒤 CALL_MAX_TIME 은 비운다.
 *  4. 정적: 상수 90, 호출 줄 1개, 블록이 edgar 블록 뒤, yield 판단이 LAST_* 변수, `bash -n`.
 *     (T-147) 「원래 줄 삭제·변경 0(HEAD 대비 추가만)」 케이스는 삭제했다 — 이유는 파일 끝 주석.
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
  const s = lines.findIndex((l) => l.includes('# 매일 07:00 KST: 해외 리서치 사이클 재계산'));
  const e = lines.findIndex((l) => l.trim() === '# <<< broker-fills-daily');
  if (s < 0 || e < 0 || e < s) throw new Error('block markers not found');
  return lines.slice(s, e + 1).join('\n');
}

interface Tick { hh: string; mm: string; today: string }
interface Sim { calls: string[]; out: string; files: Record<string, string>; callMaxAfter: string[] }

/** 틱들을 같은 임시 HOME 에서 차례로 돌린다. preset = 처음 날짜파일 내용. */
function simulate(ticks: Tick[], preset: Partial<Record<'research' | 'edgar' | 'broker', string>>): Sim {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't087-cron-'));
  try {
    const f = { research: path.join(dir, 'research'), edgar: path.join(dir, 'edgar'), broker: path.join(dir, 'broker') };
    for (const [k, v] of Object.entries(preset)) fs.writeFileSync(f[k as keyof typeof f], `${v}\n`);
    const callsFile = path.join(dir, 'calls');
    const cmaFile = path.join(dir, 'cma');
    const constLine = (SRC.match(/^BROKER_FILLS_CURL_MAX_TIME=.*$/m) ?? [''])[0];
    let out = '';
    for (const t of ticks) {
      const script = [
        'set -u',
        constLine,
        `RESEARCH_OVERSEAS_LAST_RUN_FILE='${f.research}'`,
        `EDGAR_SYNC_LAST_RUN_FILE='${f.edgar}'`,
        `BROKER_FILLS_LAST_RUN_FILE='${f.broker}'`,
        'CALL_MAX_TIME=""',
        `HH='${t.hh}'`,
        `TODAY='${t.today}'`,
        `date() { case "$1" in '+%M') echo '${t.mm}' ;; *) echo '${t.today} ${t.hh}:${t.mm}:00' ;; esac; }`,
        `call() { echo "${t.hh}:${t.mm} $1 max=\${CALL_MAX_TIME:-none}" >> '${callsFile}'; }`,
        block(),
        `echo "\${CALL_MAX_TIME:-empty}" >> '${cmaFile}'`,
      ].join('\n');
      out += execFileSync('bash', ['-c', script], { encoding: 'utf8', env: { ...process.env, PATH: process.env.PATH ?? '/usr/bin:/bin' } });
    }
    const rd = (p: string) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '');
    return {
      calls: rd(callsFile).split('\n').filter(Boolean),
      out,
      files: { research: rd(f.research).trim(), edgar: rd(f.edgar).trim(), broker: rd(f.broker).trim() },
      callMaxAfter: rd(cmaFile).split('\n').filter(Boolean),
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const D = '2026-11-03';
const Y = '2026-11-02';

describe('cron-runner broker-fills 블록(시뮬레이션)', () => {
  test('1. 정상일 — 07:19 안 돎, 07:20 첫 틱 1회(--max-time 90), 날짜파일 = 오늘, 07:21 이후 안 돎', () => {
    const s = simulate([{ hh: '07', mm: '19', today: D }, { hh: '07', mm: '20', today: D }, { hh: '07', mm: '21', today: D }, { hh: '07', mm: '59', today: D }],
      { research: D, edgar: D });
    expect(s.calls).toEqual(['07:20 /api/cron/broker-fills max=90']);
    expect(s.files.broker).toBe(D);
    expect(s.callMaxAfter).toEqual(['empty', 'empty', 'empty', 'empty']);   // 호출 뒤 상한을 비운다(다른 잡에 새지 않는다)
  });

  test('1b. 틱이 07:20 을 건너뛰어도(07:23 첫 틱) 그날 1회 · 08시·06시에는 안 돈다', () => {
    expect(simulate([{ hh: '07', mm: '23', today: D }], { research: D, edgar: D }).calls).toEqual(['07:23 /api/cron/broker-fills max=90']);
    expect(simulate([{ hh: '08', mm: '05', today: D }, { hh: '06', mm: '30', today: D }], { research: D, edgar: D }).calls).toEqual([]);
  });

  test('🔴 2. 재기동 07:25 — research·edgar 가 이 틱에 돌면 yield_tick(날짜파일 안 씀), 다음 틱(07:26)에 1회', () => {
    const s = simulate([{ hh: '07', mm: '25', today: D }, { hh: '07', mm: '26', today: D }, { hh: '07', mm: '27', today: D }],
      { research: Y, edgar: Y });
    expect(s.calls).toEqual([
      '07:25 /api/cron/research-cycle-overseas max=none',
      '07:25 /api/cron/edgar-sync max=none',
      '07:26 /api/cron/broker-fills max=90',
    ]);
    expect(s.out).toMatch(/broker-fills yield_tick/);
    expect(s.files).toEqual({ research: D, edgar: D, broker: D });
  });

  test('3. 둘 중 하나만 이 틱에 돌아도 미룬다(research 만 · edgar 만)', () => {
    const a = simulate([{ hh: '07', mm: '30', today: D }], { research: Y, edgar: D });
    expect(a.calls).toEqual(['07:30 /api/cron/research-cycle-overseas max=none']);
    expect(a.files.broker).toBe('');
    const b = simulate([{ hh: '07', mm: '30', today: D }], { research: D, edgar: Y });
    expect(b.calls).toEqual(['07:30 /api/cron/edgar-sync max=none']);
    expect(b.files.broker).toBe('');
  });

  test('3b. 날짜파일이 이미 오늘이면 안 돈다 · 분을 읽을 수 없으면 그 틱은 안 돈다', () => {
    expect(simulate([{ hh: '07', mm: '40', today: D }], { research: D, edgar: D, broker: D }).calls).toEqual([]);
    expect(simulate([{ hh: '07', mm: 'xx', today: D }], { research: D, edgar: D }).calls).toEqual([]);
  });

  test('3c. 날이 바뀌면 다시 1회(어제 날짜파일)', () => {
    const s = simulate([{ hh: '07', mm: '20', today: D }], { research: D, edgar: D, broker: Y });
    expect(s.calls).toEqual(['07:20 /api/cron/broker-fills max=90']);
  });
});

describe('cron-runner 정적', () => {
  test('상수 90 · 호출 줄 1개 · 상한은 그 호출 앞에서만 켜고 바로 비운다', () => {
    expect(SRC).toMatch(/^BROKER_FILLS_CURL_MAX_TIME=90$/m);
    expect(SRC.match(/call "\/api\/cron\/broker-fills"/g)?.length).toBe(1);
    expect(SRC).toMatch(/CALL_MAX_TIME="\$BROKER_FILLS_CURL_MAX_TIME".*\n\s*call "\/api\/cron\/broker-fills" "broker-fills"\n\s*CALL_MAX_TIME=""/);
  });

  test('블록 위치 — edgar-sync 블록 뒤, 국내 리서치 블록 앞 · yield 판단은 LAST_* 변수(날짜파일 재읽기 아님)', () => {
    const iEdgar = SRC.indexOf('call "/api/cron/edgar-sync"');
    const iBf = SRC.indexOf('# >>> broker-fills-daily');
    const iDom = SRC.indexOf('call "/api/cron/research-cycle-domestic"');
    expect(iEdgar).toBeGreaterThan(0);
    expect(iBf).toBeGreaterThan(iEdgar);
    expect(iDom).toBeGreaterThan(iBf);
    const b = SRC.slice(iBf, SRC.indexOf('# <<< broker-fills-daily'));
    expect(b).toMatch(/\[ "\$LAST_RESEARCH_OVS" != "\$TODAY" \] \|\| \[ "\$LAST_EDGAR" != "\$TODAY" \]/);
    expect(b).not.toMatch(/cat "\$(RESEARCH_OVERSEAS|EDGAR_SYNC)_LAST_RUN_FILE"/);
  });

  test('bash -n 통과', () => {
    expect(() => execFileSync('bash', ['-n', RUNNER])).not.toThrow();
  });

  /**
   * (T-147) 「기존 줄 변경 0 — HEAD 대비 추가만(부분 수열)」 케이스를 **삭제했다**.
   *  - 왜: T-147 이 메인 루프의 `stop-alert` 호출 3줄을 **의도적으로 뺐다**(알림 전용 잡을 분당 티커 자식으로 옮김 —
   *    러너의 `# >>> alert-ticker` 블록). HEAD 의 모든 줄이 현재 파일의 부분 수열이어야 한다는 단정은 그 삭제로 성립하지 않는다.
   *  - 그 단정의 뜻: T-087·T-145 가 "내 블록이 남의 줄을 건드리지 않았다"를 지키려 둔 **개발 중 가드**였고, 이후 작업이
   *    러너를 의도적으로 바꾸는 것을 금지하는 규칙이 아니었다. 금지·검토 규칙은 `SAFETY_PATHS` 커밋 훅(`^scripts/cron-runner\.sh$`)
   *    + Reviewer 독립감사가 맡는다 — 둘 다 이 테스트와 무관하게 그대로 돈다.
   *  - 나머지 단정(블록 존재·상수 90·호출 줄 1개·블록 순서·yield 판단 방식·`bash -n`)은 유지한다. 이 블록이 지키는 것은
   *    「07시 틱에 broker-fills 가 겹치지 않는다」이고, 그건 위 시뮬레이션과 아래 정적 단정들이 직접 본다.
   */
});
