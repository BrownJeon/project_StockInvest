/**
 * T-087 정적 시험 공용 — 소스의 모듈 참조를 **모든 형태**로 뽑는다(주석 제외):
 *  `import … from 'm'` · `export … from 'm'` · `import type …` · 부수효과 `import 'm'` · 동적 `import('m')` · `require('m')`.
 * `from` 형태만 보는 정규식은 부수효과·동적·require import 를 통과시킨다(T-087 Reviewer R1 — 변이 M28 생존).
 */
export interface ModuleRef { stmt: string; mod: string; typeOnly: boolean }

export function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
}

export function moduleRefs(src: string): ModuleRef[] {
  const code = stripComments(src);
  const refs: ModuleRef[] = [];
  for (const m of code.matchAll(/\b(import|export)\s+(type\s+)?[^;'"]*?\bfrom\s+['"]([^'"]+)['"]/g)) {
    refs.push({ stmt: m[0], mod: m[3], typeOnly: !!m[2] });
  }
  for (const m of code.matchAll(/\bimport\s+['"]([^'"]+)['"]/g)) refs.push({ stmt: m[0], mod: m[1], typeOnly: false });
  for (const m of code.matchAll(/\b(?:import|require)\(\s*['"`]([^'"`]+)['"`]\s*\)/g)) refs.push({ stmt: m[0], mod: m[1], typeOnly: false });
  return refs;
}
