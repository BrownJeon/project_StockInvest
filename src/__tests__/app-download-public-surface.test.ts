/**
 * T-084 R1 — 공개 경로 `/app/download/` 아래 라우트 고정(가드 테스트).
 *
 * 왜: `src/middleware.ts` 는 `PUBLIC_PREFIX` 의 `'/app/download/'` 를 **접두어로만** 본다. 그래서 앞으로 누가
 * `src/app/app/download/` 아래에 라우트(page·route·하위 폴더)를 하나 더 만들면 그 화면·API 는 **아무 검토 없이 무인증 공개**된다.
 * 이 테스트는 그 아래 파일을 `[file]/route.ts` 하나(테스트 폴더 제외)로 고정한다 — 실패하면 미들웨어 공개 범위를 다시 판단하고
 * (보통은 다른 경로에 만들 것) 이 목록을 함께 고친다. 라우트 그룹 `(이름)`·병렬 슬롯 `@이름` 은 URL 에 나오지 않으므로
 * 그것을 걷어 낸 URL 기준으로 `src/app` 전체를 훑어, 그룹을 끼워 같은 URL 을 만드는 우회도 잡는다.
 *
 * T-084 R2 Low ① 보강: 다른 곳에 만든 라우트가 `/app/download/<깊은 경로>` 를 **가로채는** 경우도 막는다.
 *  - catch-all 세그먼트(`[...x]`·`[[...x]]`)는 `src/app` 어디에도 두지 않는다 — 최상위 `src/app/[...rest]/page.tsx` 하나면
 *    `/app/download/a/b` 가 공개 접두어 아래에서 그 페이지로 간다(Reviewer R2 변이로 확인).
 *  - 동적 세그먼트(`[x]`)를 섞어 `/app/download/…` 와 겹칠 수 있는 라우트도 `[file]/route.ts` 말고는 없어야 한다.
 *  - `next.config.js` 에 경로 변환(`rewrites`·`redirects`·`headers`·`basePath`·`i18n`)이 없어야 한다. 미들웨어는 요청 경로의
 *    접두어만 보므로 rewrite 가 `/app/download/*` 를 다른 라우트로 돌리면 공개 범위가 넓어진다. 이런 설정이 생겨 이 시험이
 *    실패하면 **그 설정과 `/app/download/` 공개 접두어의 상호작용을 사람이 다시 검토**하고, 문제없음을 확인한 뒤에만 시험을 고친다.
 */
import fs from 'node:fs';
import path from 'node:path';

const APP_DIR = path.join(__dirname, '..', 'app');

function walk(dir: string, out: string[] = []): string[] {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === '__tests__') continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** src/app 기준 상대 경로 → URL 세그먼트(라우트 그룹·병렬 슬롯·인터셉트 접두 제거). */
function urlSegments(rel: string): string[] {
  return rel
    .split(path.sep)
    .filter((seg) => !/^\(.*\)$/.test(seg) && !seg.startsWith('@'))
    .map((seg) => seg.replace(/^(\(\.{1,3}\))+/, ''));
}

describe('공개 접두어 /app/download/ 아래 라우트 고정', () => {
  const files = walk(APP_DIR).map((f) => path.relative(APP_DIR, f));

  test('src/app/app/download/ 아래(테스트 폴더 제외)는 [file]/route.ts 하나뿐이다', () => {
    const under = files.filter((f) => f.startsWith(path.join('app', 'download') + path.sep)).sort();
    expect(under).toEqual([path.join('app', 'download', '[file]', 'route.ts')]);
  });

  test('라우트 그룹을 걷어 낸 URL 이 /app/download 로 시작하는 파일도 그 하나뿐이다', () => {
    const hits = files
      .filter((f) => {
        const segs = urlSegments(f);
        return segs[0] === 'app' && segs[1] === 'download';
      })
      .sort();
    expect(hits).toEqual([path.join('app', 'download', '[file]', 'route.ts')]);
  });

  test('src/pages 라우터는 없다(있으면 /app/download 아래 페이지를 따로 만들 수 있다)', () => {
    expect(fs.existsSync(path.join(__dirname, '..', 'pages'))).toBe(false);
  });

  test('catch-all 세그먼트([...x]·[[...x]]) 디렉터리는 src/app 어디에도 없다', () => {
    const catchAll = walkDirs(APP_DIR)
      .map((d) => path.relative(APP_DIR, d))
      .filter((rel) => urlSegments(rel).some(isCatchAll))
      .sort();
    expect(catchAll).toEqual([]);
  });

  test('동적 세그먼트로 /app/download/<경로> 와 겹칠 수 있는 라우트도 [file]/route.ts 하나뿐이다', () => {
    const overlapping = files
      .filter((f) => ROUTE_FILE_RE.test(path.basename(f)))
      .filter((f) => canMatchDownloadPath(urlSegments(path.dirname(f)).filter((s) => s !== '.')))
      .sort();
    expect(overlapping).toEqual([path.join('app', 'download', '[file]', 'route.ts')]);
  });
});

/** src/app 아래 디렉터리 전부(테스트 폴더 제외). */
function walkDirs(dir: string, out: string[] = []): string[] {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!ent.isDirectory() || ent.name === '__tests__') continue;
    const full = path.join(dir, ent.name);
    out.push(full);
    walkDirs(full, out);
  }
  return out;
}

/** 라우트가 되는 파일(App Router 규칙 파일 + 병렬 슬롯 default). */
const ROUTE_FILE_RE = /^(page|route|default)\.(t|j)sx?$/;

const isCatchAll = (seg: string) => /^\[\[?\.\.\..+\]\]?$/.test(seg);
const isDynamic = (seg: string) => /^\[[^.[\]][^\]]*\]$/.test(seg);

/**
 * 이 URL 세그먼트 패턴이 `/app/download/<한 개 이상의 세그먼트>` 형태의 어떤 경로와 일치할 수 있는가.
 * 정적 세그먼트는 같아야 하고, `[x]` 는 아무 한 세그먼트, catch-all 은 남은 전부와 일치한다고 본다(보수적으로 — 겹칠 수 있으면 잡는다).
 */
function canMatchDownloadPath(segs: string[]): boolean {
  const prefix = ['app', 'download'];
  for (let i = 0; i < segs.length; i += 1) {
    const seg = segs[i];
    if (isCatchAll(seg)) return true;
    if (i < prefix.length) {
      if (!isDynamic(seg) && seg !== prefix[i]) return false;
      continue;
    }
    // 접두어를 다 지난 뒤의 세그먼트가 하나라도 있으면 `/app/download/<x…>` 와 일치할 수 있다.
    return true;
  }
  return false;
}

describe('next.config 에 /app/download/ 를 바꿀 경로 변환이 없다', () => {
  const ROOT = path.join(__dirname, '..', '..');
  const PATH_TRANSFORM_KEYS = ['rewrites', 'redirects', 'headers', 'basePath', 'i18n'] as const;

  test('설정 파일은 next.config.js 하나뿐이다(mjs·ts 가 생기면 어느 쪽이 쓰이는지부터 다시 본다)', () => {
    const configs = fs.readdirSync(ROOT).filter((n) => /^next\.config\.[cm]?[jt]s$/.test(n)).sort();
    expect(configs).toEqual(['next.config.js']);
  });

  test('내보낸 설정은 객체이고 경로 변환 키가 없다', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const cfg: unknown = require(path.join(ROOT, 'next.config.js'));
    // 함수형 설정(phase 별)이면 정적으로 판단할 수 없으므로 실패시켜 사람이 보게 한다.
    expect(typeof cfg).toBe('object');
    const present = PATH_TRANSFORM_KEYS.filter((k) => cfg !== null && typeof cfg === 'object' && k in (cfg as object));
    expect(present).toEqual([]);
  });

  test('소스 글자로도 경로 변환 키가 없다(조건부로 붙이는 경우 대비)', () => {
    const src = fs.readFileSync(path.join(ROOT, 'next.config.js'), 'utf8');
    for (const k of PATH_TRANSFORM_KEYS) expect(src).not.toMatch(new RegExp(`\\b${k}\\b`));
  });
});
