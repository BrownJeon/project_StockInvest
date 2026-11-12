/**
 * 🔴 T-165 의존 경계 (Leader G4-6) — 라벨이 판단 경로로 새지 않게.
 *
 * `src/` 전체에서 macro-regime 모듈을 import 하는 파일은 `src/lib/strategy/engine.ts` 와 이 디렉터리
 * (자기 자신·시험)뿐이어야 한다. 승격(C1 프롬프트·B 사이징)은 별 task 다 — 그때 이 시험을 의도적으로 고친다.
 *
 * T-167 (Leader G5-4) 의도적 갱신 — 장기 보관 표 기록기(`label-log.ts`)가 생겼다:
 *  - engine.ts 안 허용 사용 = kick 1회 · `const macroRegime = getMacroRegimeRecord();` 1회 · `macroRegime` 은 최종 pass run 행 detail 과
 *    flush 뒤 `recordMacroRegimeLabel(…)` 인자로만(그 밖의 사용 0). 다른 파일은 여전히 0.
 *  - index.ts 는 세 함수(kick·get·recordMacroRegimeLabel)만 노출한다.
 *  - DB 를 쓰는 것은 `label-log.ts` 하나뿐이고(Leader G3 — `getPool` + `records/bounded-conn`), 그 import 도 정해진 목록 밖으로 넓어지지 않는다.
 *    나머지 파일은 예전처럼 같은 디렉터리(`./`)만 import 한다. 주문·시그널·알림 경로는 어느 파일도 import 하지 않는다.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SRC = join(__dirname, '..', '..', '..', '..');           // <repo>/src
const MODULE_DIR = join(__dirname, '..');                      // src/lib/strategy/macro-regime
const ENGINE = join(SRC, 'lib', 'strategy', 'engine.ts');
const LABEL_LOG = join(MODULE_DIR, 'label-log.ts');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(name)) out.push(p);
  }
  return out;
}
/** import/export-from/require/jest.mock/dynamic import 중 macro-regime 을 가리키는 것 */
const REF_RE = /(?:from\s*|require\s*\(\s*|import\s*\(\s*|jest\.(?:mock|requireActual|doMock)\s*\(\s*)['"`][^'"`]*macro-regime(?:\/[^'"`]*)?['"`]/;

/** 한 줄의 `//` 주석을 뗀다(engine.ts 의 macroRegime 사용 줄 판별용 — 문자열 안 `//` 가 없는 줄에만 쓴다). */
const stripLineComment = (l: string) => l.replace(/\/\/.*$/, '').trim();

describe('macro-regime 의존 경계', () => {
  const files = walk(SRC);

  it('src/ 를 실제로 훑었다 (빈 스캔 방지)', () => {
    expect(files.length).toBeGreaterThan(200);
    expect(files).toContain(ENGINE);
  });

  it('macro-regime 을 참조하는 파일은 engine.ts 와 macro-regime 디렉터리 안뿐이다', () => {
    const offenders = files
      .filter((f) => !f.startsWith(MODULE_DIR + sep) && f !== ENGINE)
      .filter((f) => REF_RE.test(readFileSync(f, 'utf8')))
      .map((f) => relative(SRC, f));
    expect(offenders).toEqual([]);
  });

  it('engine.ts 는 index 의 세 함수만 가져오고, kick 1회·기록 1회·장기 보관 시작 1회만 부른다', () => {
    const src = readFileSync(ENGINE, 'utf8');
    const imports = src.split('\n').filter((l) => REF_RE.test(l));
    expect(imports).toEqual([`import { kickMacroRegimeRefresh, getMacroRegimeRecord, recordMacroRegimeLabel } from './macro-regime';`]);
    expect(src.match(/kickMacroRegimeRefresh\(/g)).toHaveLength(1);
    expect(src.match(/getMacroRegimeRecord\(/g)).toHaveLength(1);
    expect(src.match(/recordMacroRegimeLabel\(/g)).toHaveLength(1);
  });

  it('T-167 — engine.ts 의 macroRegime 값은 run 행 detail 과 flush 뒤 기록기 인자로만 쓰인다(객체 1회 생성·같은 참조)', () => {
    const lines = readFileSync(ENGINE, 'utf8').split('\n');
    // 주석을 뗀 코드에서 `macroRegime` 식별자가 나오는 줄은 정확히 이 셋이다
    const uses = lines
      .map((l, i) => ({ i, code: stripLineComment(l) }))
      .filter((x) => /\bmacroRegime\b/.test(x.code));
    expect(uses.map((u) => u.code)).toEqual([
      'const macroRegime = getMacroRegimeRecord();',
      'macroRegime,',
      'try { recordMacroRegimeLabel(rec.runId, market, macroRegime); } catch { /* 기록 전용 — 엔진에 넘기지 않는다 */ }',
    ]);
    // 배치: 객체 생성 → 최종 pass run 행 기록(detail 의 macroRegime) → flush → 기록기 시작. 그 사이에 다른 run 행·return 이 없다.
    const [decl, inDetail, call] = uses.map((u) => u.i);
    const between = (a: number, b: number) => lines.slice(a + 1, b).map((l) => l.trim());
    const recordBlock = between(decl, inDetail);
    expect(recordBlock[0]).toBe('rec.record({');
    expect(recordBlock).toContain("gate: 'run',");
    expect(recordBlock).toContain("verdict: 'pass',");
    expect(recordBlock.filter((l) => /^gate:/.test(l))).toHaveLength(1);
    const afterDetail = between(inDetail, call).filter((l) => l !== '' && !l.startsWith('//'));
    expect(afterDetail).toEqual(['},', '});', 'await rec.flush();']);
    // 기록기 호출 바로 다음 코드 줄은 그 런의 반환이다(조기 종료 run 행 3곳에는 기록기가 없다 — 호출이 1회뿐인 것과 함께)
    const next = lines.slice(call + 1).map((l) => l.trim()).find((l) => l !== '' && !l.startsWith('//'));
    expect(next).toMatch(/^return \{ ran: symbols\.length,/);
  });

  it('index.ts 는 세 함수만 노출한다', () => {
    const mod = jest.requireActual('../index') as Record<string, unknown>;
    expect(Object.keys(mod).sort()).toEqual(['getMacroRegimeRecord', 'kickMacroRegimeRefresh', 'recordMacroRegimeLabel']);
  });

  it('모듈은 주문·시그널·알림 경로를 import 하지 않는다 — DB 는 label-log.ts 하나만, 정해진 목록 안에서', () => {
    const own = walk(MODULE_DIR).filter((f) => !f.includes(`${sep}__tests__${sep}`));
    expect(own.length).toBeGreaterThanOrEqual(8);
    expect(own).toContain(LABEL_LOG);
    const LABEL_LOG_ALLOWED = new Set([
      '@/lib/exchanges/kis-symbols',   // type Market 만
      '@/lib/db',                      // getPool — Leader G3
      '../records/bounded-conn',       // withBoundedConn — 상한·연결 destroy (T-126 R1 · T-135)
      '../records/exit-judgment',      // exitEngineReleaseFromCwd(L3 — 세 번째 사본 금지)·decimalOrNull
      '../records/job-slots',          // kstDatetime
      '../records/safe-text',          // truncateCodePoints·isNoSuchTable·…
      './types',
    ]);
    for (const f of own) {
      const src = readFileSync(f, 'utf8');
      // import/export … from '…' 문장만(문자열 안의 'from' — 예: 열 이름 'rate_upper_effective_from' — 은 import 가 아니다)
      const specs = [...src.matchAll(/^(?:import|export)\b[^;]*?\sfrom\s*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
      if (f === LABEL_LOG) expect(specs).toEqual(expect.arrayContaining(['@/lib/db', '../records/bounded-conn']));   // 빈 스캔 방지
      for (const s of specs) {
        expect(s).not.toMatch(/signals|safety|notify|orders?\b|exchanges\/kis['"]?$|telegram|llm/);
        if (f === LABEL_LOG) expect(LABEL_LOG_ALLOWED.has(s)).toBe(true);
        else expect(s.startsWith('./')).toBe(true);
      }
    }
  });
});
