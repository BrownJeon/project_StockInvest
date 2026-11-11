/**
 * 🔴 T-165 의존 경계 (Leader G4-6) — 라벨이 판단 경로로 새지 않게.
 *
 * `src/` 전체에서 macro-regime 모듈을 import 하는 파일은 `src/lib/strategy/engine.ts` 와 이 디렉터리
 * (자기 자신·시험)뿐이어야 하고, engine.ts 안에서도 kick 1회·기록 1회(최종 run 행 detail 의 `macroRegime:` 값)만
 * 허용한다. 승격(C1 프롬프트·B 사이징)은 별 task 다 — 그때 이 시험을 의도적으로 고친다.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SRC = join(__dirname, '..', '..', '..', '..');           // <repo>/src
const MODULE_DIR = join(__dirname, '..');                      // src/lib/strategy/macro-regime
const ENGINE = join(SRC, 'lib', 'strategy', 'engine.ts');

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

  it('engine.ts 는 index 의 두 함수만 가져오고, kick 1회·기록 1회만 부른다', () => {
    const src = readFileSync(ENGINE, 'utf8');
    const imports = src.split('\n').filter((l) => REF_RE.test(l));
    expect(imports).toEqual([`import { kickMacroRegimeRefresh, getMacroRegimeRecord } from './macro-regime';`]);
    expect(src.match(/kickMacroRegimeRefresh\(/g)).toHaveLength(1);
    expect(src.match(/getMacroRegimeRecord\(/g)).toHaveLength(1);
    // 기록 값은 run 행 detail 의 macroRegime 속성으로만 쓰인다(변수에 담아 다른 곳에 쓰지 않는다)
    expect(src).toMatch(/^\s*macroRegime: getMacroRegimeRecord\(\),\s*$/m);
  });

  it('index.ts 는 두 함수만 노출한다', () => {
    const mod = jest.requireActual('../index') as Record<string, unknown>;
    expect(Object.keys(mod).sort()).toEqual(['getMacroRegimeRecord', 'kickMacroRegimeRefresh']);
  });

  it('모듈은 DB·주문·시그널·알림 경로를 import 하지 않는다', () => {
    const own = walk(MODULE_DIR).filter((f) => !f.includes(`${sep}__tests__${sep}`));
    expect(own.length).toBeGreaterThanOrEqual(7);
    for (const f of own) {
      const src = readFileSync(f, 'utf8');
      const specs = [...src.matchAll(/from\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
      for (const s of specs) expect(s.startsWith('./')).toBe(true);
    }
  });
});
