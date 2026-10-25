/**
 * T-040 — `kisFetch` 의 외부 API 호출 기록(`@workspace/api-usage`).
 *
 * 🔴 절대 조건 1: **기록 실패·지연이 주문 흐름에 영향 0.**
 *   - 기록이 정상으로 쌓일 때와 `API_USAGE_LOG_DIR` 를 쓸 수 없을 때, `kisFetch` 의 반환값·예외·재시도·스로틀
 *     동작이 {@link EXPECTED_OUTCOMES} 와 한 글자도 다르지 않다.
 *   - (패키지 함수가 던지는 경우는 jest.mock 이 파일 단위라 `kis-usage-isolation.test.ts` 에 둔다.)
 *   - 주문 경로(`submitOrder` → 국내 `createOrder` → `kisFetch`)도 세 조건에서 같은 결과·같은 DB 기록.
 *
 * 사용자 결정(2026-10-10):
 *   - 레이트리밋(HTTP 500, 재시도)은 **시도마다** 실패 한 줄(ok=false, err=http, status 500).
 *   - HTTP 200 + 본문 rt_cd 업무 실패도 실패(ok=false, status 200, err=other — 전송 계층 실패가 아니므로 http 가 아니다).
 *
 * 🔒 절대 조건 2: 줄에 계좌번호·종목·수량·금액·토큰·URL·쿼리·본문·오류 원문 0.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { _internal, checkOp } from '@workspace/api-usage';
import { opOf } from '@/lib/api-usage';
import {
  SCENARIOS, EXPECTED_OUTCOMES, FORBIDDEN_FRAGMENTS, KIS_LABELS, runAll, runScenario,
} from './kis-usage-scenarios';

const ORIGINAL_DIR = process.env.API_USAGE_LOG_DIR;
let tmpRoot: string;

function todayFile(dir: string): string {
  return path.join(dir, `api-usage-${new Date().toISOString().slice(0, 10)}.jsonl`);
}
function readLines(dir: string): Array<Record<string, unknown>> {
  const f = todayFile(dir);
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
}
function rawText(dir: string): string {
  const f = todayFile(dir);
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
}

beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 't040-kis-'));
});
afterAll(() => {
  if (ORIGINAL_DIR === undefined) delete process.env.API_USAGE_LOG_DIR;
  else process.env.API_USAGE_LOG_DIR = ORIGINAL_DIR;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

let logDir: string;
beforeEach(() => {
  _internal.reset();
  logDir = fs.mkdtempSync(path.join(tmpRoot, 'logs-'));
  process.env.API_USAGE_LOG_DIR = logDir;
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe('기록 규칙 — 시나리오별 줄', () => {
  it.each(SCENARIOS.map((s) => [s.name, s] as const))('%s', async (_n, s) => {
    const out = await runScenario(s);
    expect(out).toEqual(EXPECTED_OUTCOMES[s.name]);
    const lines = readLines(logDir).map(({ ts, ms, ...rest }) => {
      expect(typeof ts).toBe('string');
      expect(Number.isInteger(ms)).toBe(true);
      expect(ms as number).toBeGreaterThanOrEqual(0);
      return rest;
    });
    expect(lines).toEqual(s.expectLines.map((l) => ({ api: 'kis', ...l })));
  });

  it('레이트리밋 HTTP 500 은 재시도 시도마다 실패 한 줄 — 기본 재시도 2회면 3줄(결정: 오류율에 포함)', async () => {
    const s = SCENARIOS.find((x) => x.name === 'rate-limit-exhausted')!;
    // 기본값(rateLimitRetries 미지정 = 2)으로 실제 백오프까지 돈다(400·1200ms + 지터).
    const out = await runScenario({ ...s, opts: {} });
    expect(out).toMatchObject({ kind: 'response', status: 500, rateLimited: true, attempts: 3, fetchCalls: 3 });
    const lines = readLines(logDir);
    expect(lines).toHaveLength(3);
    for (const l of lines) expect(l).toMatchObject({ api: 'kis', op: 'domestic.get-balances', ok: false, status: 500, err: 'http' });
  }, 10_000);
});

/**
 * 템플릿 문자열 label — 호출부가 시장별로 만들므로 **가능한 값 전부를 여기에 고정**한다(2026-10-25 추가).
 * 이 상수는 시험 파일(*.test.ts)에만 둔다: 매매 경로 파일에는 profit-engine 모듈명이 나오면 안 된다(profit-engine isolation 시험).
 * 대상 호출부는 T-070 일봉 수집기의 `label: \`profit-engine daily-bars ${req.market}\`` (시장 = 'KR' | 'US') 1곳이다.
 * 템플릿 label 이 새로 생기면 아래 시험이 먼저 깨져 checkOp 점검을 강제한다.
 */
const KIS_DYNAMIC_LABELS = ['profit-engine daily-bars KR', 'profit-engine daily-bars US'];

describe('🔒 금지 정보 — 줄에 URL·토큰·계좌·종목·금액·본문·오류 원문 0', () => {
  it('모든 시나리오를 돈 뒤 파일 전체에 금지 조각이 없고, 키는 고정 7개 안에서만 나온다', async () => {
    await runAll();
    const text = rawText(logDir);
    expect(text.length).toBeGreaterThan(0);
    for (const frag of FORBIDDEN_FRAGMENTS) expect(text).not.toContain(frag);
    expect(text).not.toMatch(/https?:|Bearer|@/);   // 패키지 README 체크리스트 5
    const allowed = new Set(['ts', 'api', 'op', 'ok', 'status', 'ms', 'err']);
    for (const l of readLines(logDir)) for (const k of Object.keys(l)) expect(allowed.has(k)).toBe(true);
  });

  it('op 는 label 22종 + 시장별 동적 label 2종(코드 상수)에서만 만들어지고 전부 형식 검사(checkOp — 식별자 모양 거부 포함)를 통과한다', () => {
    const all = [...KIS_LABELS, ...KIS_DYNAMIC_LABELS];
    const ops = all.map(opOf);
    for (const op of ops) expect(checkOp(op)).toBeNull();
    expect(new Set(ops).size).toBe(all.length);   // label 끼리 op 가 겹치지 않는다
  });

  it('src 의 kisFetch( 호출 수와 그 호출 안의 label: 수가 같다 — 라벨 없는 새 호출(unlabeled 로 조용히 섞임)을 막는다(Reviewer L-3)', () => {
    const root = path.resolve(__dirname, '../../..');   // src/
    let calls = 0;
    let labeled = 0;
    const unlabeled: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) { if (e.name !== '__tests__') walk(p); continue; }
        if (!/\.tsx?$/.test(e.name)) continue;
        // 주석 줄을 지운 소스에서 센다(문서 주석의 `kisFetch({ timeoutMs })` 같은 언급 제외)
        const src = fs.readFileSync(p, 'utf8').split('\n')
          .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');
        let i = src.indexOf('kisFetch(');
        while (i !== -1) {
          const isDef = /function\s+$/.test(src.slice(Math.max(0, i - 20), i));
          if (!isDef) {
            // 괄호 짝을 맞춰 호출 인자 전체를 잘라낸다
            let depth = 0;
            let j = i + 'kisFetch'.length;
            for (; j < src.length; j++) {
              if (src[j] === '(') depth++;
              else if (src[j] === ')') { depth--; if (depth === 0) break; }
            }
            const args = src.slice(i, j + 1);
            calls++;
            if (/label:\s*'[^']+'/.test(args) || /label:\s*`profit-engine daily-bars \$\{req\.market\}`/.test(args)) labeled++;
            else unlabeled.push(`${path.relative(root, p)}: ${args.slice(0, 60)}`);
          }
          i = src.indexOf('kisFetch(', i + 1);
        }
      }
    };
    walk(root);
    expect(unlabeled).toEqual([]);
    expect(labeled).toBe(calls);
    expect(calls).toBeGreaterThanOrEqual(KIS_LABELS.length);   // 2026-10-18 HEAD 22곳
  });

  it('src 의 kisFetch label 이 KIS_LABELS 와 일치한다 — label 이 늘면 이 시험이 먼저 깨져 checkOp 점검을 강제한다', () => {
    const root = path.resolve(__dirname, '../../..');   // src/
    const found = new Set<string>();
    const templates: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) { if (e.name !== '__tests__') walk(p); continue; }
        if (!/\.tsx?$/.test(e.name)) continue;
        const src = fs.readFileSync(p, 'utf8');
        if (!src.includes('kisFetch(')) continue;
        for (const m of src.matchAll(/label:\s*'([^']+)'/g)) found.add(m[1]);
        for (const m of src.matchAll(/label:\s*`([^`]*)`/g)) templates.push(m[1]);
      }
    };
    walk(root);
    expect([...found].sort()).toEqual([...KIS_LABELS].sort());
    // 템플릿 label 은 알려진 1곳(T-070 daily-bars, 값은 KIS_DYNAMIC_LABELS 로 고정)뿐이어야 한다 — 새 템플릿 label 은 점검 없이 못 늘어난다
    expect(templates).toEqual(['profit-engine daily-bars ${req.market}']);
  });
});

describe('🔴 절대 조건 1 — 쓸 수 없는 API_USAGE_LOG_DIR 에서도 동작 동일', () => {
  it('일반 파일 아래 경로(디렉터리를 만들 수 없음)여도 모든 시나리오 결과가 기대값과 같고, 아무 파일도 생기지 않는다', async () => {
    const blocker = path.join(tmpRoot, `blocker-${Date.now()}`);
    fs.writeFileSync(blocker, 'not a directory');
    const bad = path.join(blocker, 'logs');
    process.env.API_USAGE_LOG_DIR = bad;
    _internal.reset();

    const out = await runAll();
    expect(out).toEqual(EXPECTED_OUTCOMES);
    expect(fs.existsSync(bad)).toBe(false);
    expect(fs.readFileSync(blocker, 'utf8')).toBe('not a directory');
  });

  it('읽기 전용 디렉터리(0500)여도 결과가 같다', async () => {
    if (process.getuid?.() === 0) return;   // root 는 권한을 무시한다 — 위 시험이 같은 성질을 덮는다
    const ro = fs.mkdtempSync(path.join(tmpRoot, 'ro-'));
    fs.chmodSync(ro, 0o500);
    try {
      process.env.API_USAGE_LOG_DIR = ro;
      _internal.reset();
      const out = await runAll();
      expect(out).toEqual(EXPECTED_OUTCOMES);
      expect(fs.readdirSync(ro)).toEqual([]);
    } finally {
      fs.chmodSync(ro, 0o700);
    }
  });

  it('정상 기록 조건과 결과가 같다(같은 시나리오를 두 조건에서 돌려 직접 비교)', async () => {
    const good = await runAll();
    const blocker = path.join(tmpRoot, `blocker2-${Date.now()}`);
    fs.writeFileSync(blocker, 'x');
    process.env.API_USAGE_LOG_DIR = path.join(blocker, 'sub');
    _internal.reset();
    const bad = await runAll();
    expect(bad).toEqual(good);
  });
});
