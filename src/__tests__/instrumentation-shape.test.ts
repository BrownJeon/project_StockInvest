/**
 * T-042 — `instrumentation.ts` 의 **빌드타임 분기 형태**를 고정한다.
 *
 * 이 프로젝트에는 Edge 미들웨어가 있어 Next 가 instrumentation 을 Node·Edge 양쪽 번들로 컴파일한다.
 * `if (process.env.NEXT_RUNTIME === 'nodejs') { …import()… }` (양수 조건 블록)만 Edge 컴파일에서 블록째 제거된다.
 * 조기 `return` 형태는 `import()` 가 모듈 그래프에 남아 `mysql2`·`crypto`·`node:fs` 때문에 **빌드가 통째로 깨진다**
 * (T-037 재순환에서 실제로 발생). 텔레그램 폴러가 같은 파일에 추가되므로 형태를 소스 텍스트로 못박는다.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(__dirname, '..', 'instrumentation.ts'), 'utf8')
  // 주석 안의 예시 코드가 검사를 속이지 않도록 주석을 지운다
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

/** `needle` 이 처음 나오는 `{` 부터 짝이 맞는 `}` 까지의 본문 */
function blockAfter(text: string, needle: string): string {
  const at = text.indexOf(needle);
  if (at < 0) return '';
  const open = text.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return text.slice(open + 1, i);
  }
  return '';
}

describe('instrumentation.ts — 빌드타임 분기', () => {
  const guarded = blockAfter(src, "if (process.env.NEXT_RUNTIME === 'nodejs')");

  test('🔴 양수 조건 블록이 있다', () => {
    expect(guarded.length).toBeGreaterThan(0);
  });

  test('🔴 조기 return 형태(`!== \'nodejs\'`)를 쓰지 않는다', () => {
    expect(src).not.toMatch(/NEXT_RUNTIME\s*!==\s*['"]nodejs['"]/);
    expect(src).not.toMatch(/NEXT_RUNTIME\s*!=\s*['"]nodejs['"]/);
  });

  test.each(['@/lib/ops/cron-watchdog', '@/lib/signals/telegram-poller'])('🔴 %s 는 블록 안에서만 동적 import 된다', (mod) => {
    expect(guarded).toContain(`import('${mod}')`);
    expect(src.split(`import('${mod}')`).length - 1).toBe(1);        // 블록 밖에 중복 import 없음
  });

  test('모듈 최상단에서 Node 전용 모듈을 정적 import 하지 않는다', () => {
    expect(src).not.toMatch(/^import\s/m);
  });

  test('🔴 각 기동은 서로 독립된 try/catch 로 감싸져 있다 — 하나가 실패해도 다른 하나·서버 기동은 계속', () => {
    const tries = guarded.match(/\btry\s*\{/g) ?? [];
    const catches = guarded.match(/\bcatch\s*\(/g) ?? [];
    expect(tries.length).toBeGreaterThanOrEqual(2);
    expect(catches.length).toBe(tries.length);
  });
});
