/**
 * T-084 — 연결 실패 화면 public/app-shell/index.html (승인 데모 v1 "A").
 * 외부 자원 0 · 토큰 hex 가 globals.css 와 같고 머리 주석의 sha256 앞 12자가 실제와 같음 · 문구(거짓 안심 금지) ·
 * 운영 주소 = capacitor.config.ts server.url · [다시 시도] 동작(location.replace·8초 잠금·online 자동 1회·주기 재시도 없음).
 * 스크립트는 작은 가짜 DOM 위에서 vm 으로 실행한다(jest node 환경).
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

const ROOT = path.resolve(__dirname, '../../../..');
const HTML = fs.readFileSync(path.join(ROOT, 'public/app-shell/index.html'), 'utf8');
const GLOBALS = fs.readFileSync(path.join(ROOT, 'src/app/globals.css'), 'utf8');

describe('정적 검사', () => {
  test('외부 자원 0 — script src·link·img·@import·url() 없음, 운영 주소 외 http(s) 없음', () => {
    expect(HTML).not.toMatch(/<script[^>]+src=/i);
    expect(HTML).not.toMatch(/<link\b/i);
    expect(HTML).not.toMatch(/<img\b/i);
    expect(HTML).not.toMatch(/@import/i);
    expect(HTML).not.toMatch(/url\(/i);
    const urls = HTML.match(/https?:\/\/[^\s'"<)]+/g) ?? [];
    expect(urls).toEqual(['https://stock.xn--lh0b87pnudm10a4vd.com/']);
  });
  test('머리 주석의 globals.css sha256 앞 12자 = 실제 값', () => {
    const sha12 = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'src/app/globals.css'))).digest('hex').slice(0, 12);
    expect(HTML).toContain(`원본 globals.css sha256 앞 12자 ${sha12}`);
  });
  test('복사한 토큰 hex 가 globals.css 의 같은 이름 값과 같다', () => {
    const rootBlock = (s: string) => s.slice(s.indexOf(':root'), s.indexOf('}', s.indexOf(':root')));
    const vars = (s: string) => Object.fromEntries([...rootBlock(s).matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
    const g = vars(GLOBALS);
    const a = vars(HTML);
    expect(Object.keys(a).length).toBeGreaterThanOrEqual(9);
    for (const [k, v] of Object.entries(a)) expect([k, v]).toEqual([k, g[k]]);
  });
  test('운영 주소 = capacitor.config.ts server.url', () => {
    const cap = fs.readFileSync(path.join(ROOT, 'capacitor.config.ts'), 'utf8');
    const url = cap.match(/url:\s*'([^']+)'/)![1];
    expect(HTML).toContain(`var APP_URL = '${url}/';`);
  });
  test('문구: 이름·h1·foot("주문·승인은 서버에 연결된 뒤에만") · 거짓 안심 문구 없음 · aria-live · 버튼', () => {
    expect(HTML).toContain('<p class="nm">주식캐기</p>');
    expect(HTML).toContain('<h1 id="t">');
    expect(HTML).toContain('<div aria-live="polite" id="live">');
    expect(HTML).toContain('<button type="button" class="retry" id="retry">다시 시도</button>');
    expect(HTML).toContain('이 화면은 앱 안에 들어 있는 안내 화면입니다. 주문·승인은 서버에 연결된 뒤에만 할 수 있습니다.');
    const visible = HTML.replace(/<!--[\s\S]*?-->/g, '');
    expect(visible).not.toMatch(/안전합니다|안전하게 보호|걱정하지/);
    expect(HTML).toContain('계속 안 되면 PC 브라우저로 stock.미라클펭귄.com 을 열어 보세요. PC 에서도 열리지 않으면 서버 문제입니다.');
  });
  test('아이콘 자리 = ICON-SLOT 주석 + 확정 아이콘 ②(곡괭이 시안 아님) · reduced-motion 시 스피너 정지 · 버튼 48px', () => {
    expect(HTML).toContain('<!-- ICON-SLOT:');
    expect(HTML).not.toContain('rotate(-38');
    expect(HTML).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \.spin \{ animation: none;/);
    expect(HTML).toMatch(/\.sh \.retry \{[^}]*min-height: 48px/);
  });
  test('로고 = 시안 SRC.o2 배경+전경 요소 그대로(순서 포함) · 보이는 72 영역 · CSS 둥근 사각(16px) · clipPath·id 없음', () => {
    const logo = HTML.match(/<svg class="logo" viewBox="18 18 72 72" aria-hidden="true" focusable="false">\n([\s\S]*?)\n\s*<\/svg>/);
    expect(logo).not.toBeNull();
    expect(logo![1].split('\n').map((l) => l.trim())).toEqual([...O2_BG, ...O2_FG]);
    expect(HTML).toMatch(/\.sh \.logo \{[^}]*width: 72px; height: 72px;[^}]*border-radius: 16px; overflow: hidden;/);
    expect(logo![0]).not.toMatch(/clipPath|\sid=|<circle/);
  });
});

// ─── 앱 아이콘 ② "지층형 + 금덩이" — 시안 원본(mockups/T-084-app-icon-v1.html SRC.o2)과 안드로이드 리소스 ─────────
// 시안 파일은 저장소의 이 브랜치에 없어서 원본 문자열을 여기에 고정한다(2026-10-25 사용자 확정 소스, 바꾸지 않는다).
const O2_BG = [
  '<rect width="108" height="108" fill="#171a21"/>',
  '<path d="M0 60 Q27 55 54 59 T108 57 V108 H0 Z" fill="#1f2430"/>',
  '<path d="M0 82 Q30 77 60 81 T108 79 V108 H0 Z" fill="#262b36"/>',
];
const O2_FG = [
  '<polygon points="27,69.4 36,65.4 46,67.8 58,65.3 70,68.4 81,68.4 81,69.6 70,73.6 58,71.7 46,74.2 36,70.6 27,70.6" fill="#f59e0b"/>',
  '<rect x="34.8" y="48" width="2.4" height="14.5" rx="1.2" fill="#ef4444"/>',
  '<rect x="31.5" y="51" width="9" height="9" rx="1.5" fill="#ef4444"/>',
  '<rect x="46.8" y="37" width="2.4" height="27.5" rx="1.2" fill="#ef4444"/>',
  '<rect x="43.5" y="41" width="9" height="18" rx="1.5" fill="#ef4444"/>',
  '<rect x="58.8" y="27" width="2.4" height="36" rx="1.2" fill="#ef4444"/>',
  '<rect x="55.5" y="31" width="9" height="26" rx="1.5" fill="#ef4444"/>',
  '<polygon points="68,36 73,31.5 78.5,34.5 80,40.5 75,44.5 69,42" fill="#f59e0b"/>',
  '<path d="M69 42 L72.5 38 L80 40.5 M72.5 38 L73 31.5" fill="none" stroke="#171a21" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>',
];
// 단색: 전경과 같은 도형을 흰색으로, 금덩이 결 선은 뺀다.
const O2_MONO = O2_FG.slice(0, 8).map((s) => s.replace(/fill="#[0-9a-f]{6}"/, 'fill="#ffffff"'));

const RES = path.join(ROOT, 'android/app/src/main/res');
const res = (rel: string) => fs.readFileSync(path.join(RES, rel), 'utf8');

/** SVG 요소 → VectorDrawable 속성(rect·polygon 은 pathData, rx 는 원호 A — SVG 명세의 등가 경로). */
function toVd(el: string) {
  const at = (k: string) => el.match(new RegExp(`\\s${k}="([^"]*)"`))?.[1];
  const f = (n: number) => String(+n.toFixed(3));
  const tag = el.match(/^<(\w+)/)![1];
  let d: string;
  if (tag === 'rect') {
    const x = +(at('x') ?? 0), y = +(at('y') ?? 0), w = +at('width')!, hh = +at('height')!;
    const rx = Math.min(+(at('rx') ?? 0), w / 2, hh / 2);
    const a = `A${f(rx)},${f(rx)} 0,0 1,`;
    d = rx
      ? `M${f(x + rx)},${f(y)}H${f(x + w - rx)}${a}${f(x + w)},${f(y + rx)}V${f(y + hh - rx)}${a}${f(x + w - rx)},${f(y + hh)}` +
        `H${f(x + rx)}${a}${f(x)},${f(y + hh - rx)}V${f(y + rx)}${a}${f(x + rx)},${f(y)}Z`
      : `M${f(x)},${f(y)}H${f(x + w)}V${f(y + hh)}H${f(x)}Z`;
  } else if (tag === 'polygon') {
    const pts = at('points')!.trim().split(/\s+/).map((p) => p.split(',').map(Number).map(f).join(','));
    d = 'M' + pts[0] + pts.slice(1).map((p) => 'L' + p).join('') + 'Z';
  } else d = at('d')!;
  const fill = at('fill');
  return {
    fillColor: fill && fill !== 'none' ? fill : undefined,
    strokeColor: at('stroke'),
    strokeWidth: at('stroke-width'),
    strokeLineCap: at('stroke-linecap'),
    strokeLineJoin: at('stroke-linejoin'),
    fillType: undefined as string | undefined,
    pathData: d,
  };
}
/** VectorDrawable XML 의 <path> 속성 목록(주석 제외). */
function vdPaths(xml: string) {
  const body = xml.replace(/<!--[\s\S]*?-->/g, '');
  const keys = ['fillColor', 'strokeColor', 'strokeWidth', 'strokeLineCap', 'strokeLineJoin', 'fillType', 'pathData'] as const;
  return [...body.matchAll(/<path\b([\s\S]*?)\/>/g)].map((m) => {
    const attrs = [...m[1].matchAll(/android:(\w+)="([^"]*)"/g)];
    for (const a of attrs) expect(keys as readonly string[]).toContain(a[1]); // 모르는 속성(그라디언트·변환 등) 없음
    return Object.fromEntries(keys.map((k) => [k, attrs.find((a) => a[1] === k)?.[2]]));
  });
}
const vdHead = (xml: string) => xml.replace(/<!--[\s\S]*?-->/g, '').match(/<vector\b[^>]*>/)![0];

describe('앱 아이콘 ② — 안드로이드 리소스(적응형 아이콘·스플래시)', () => {
  test.each([
    ['drawable/ic_launcher_background.xml', O2_BG],
    ['drawable/ic_launcher_foreground.xml', O2_FG],
    ['drawable/ic_launcher_monochrome.xml', O2_MONO],
  ])('%s = 시안 레이어를 그대로 변환(108dp · viewport 108 · 순서·색 동일)', (file, src) => {
    const xml = res(file);
    expect(vdHead(xml)).toMatch(/android:width="108dp"[\s\S]*android:height="108dp"[\s\S]*android:viewportWidth="108"[\s\S]*android:viewportHeight="108"/);
    expect(vdPaths(xml)).toEqual(src.map(toVd));
  });
  test('단색 레이어는 흰색만 · 금덩이 결 선(stroke) 없음 · 전경은 결 선 1개', () => {
    expect(res('drawable/ic_launcher_monochrome.xml')).not.toMatch(/strokeColor/);
    expect(vdPaths(res('drawable/ic_launcher_monochrome.xml')).every((p) => p.fillColor === '#ffffff')).toBe(true);
    expect(vdPaths(res('drawable/ic_launcher_foreground.xml')).filter((p) => p.strokeColor)).toEqual([
      expect.objectContaining({ strokeColor: '#171a21', strokeWidth: '1.4', strokeLineCap: 'round', strokeLineJoin: 'round', fillColor: undefined }),
    ]);
  });
  test('적응형 아이콘: ic_launcher·ic_launcher_round 가 배경·전경·단색 drawable 을 쓴다 · Manifest 참조 일치', () => {
    for (const n of ['ic_launcher', 'ic_launcher_round']) {
      const xml = res(`mipmap-anydpi-v26/${n}.xml`).replace(/<!--[\s\S]*?-->/g, '');
      expect(xml).toContain('<background android:drawable="@drawable/ic_launcher_background"/>');
      expect(xml).toContain('<foreground android:drawable="@drawable/ic_launcher_foreground"/>');
      expect(xml).toContain('<monochrome android:drawable="@drawable/ic_launcher_monochrome"/>');
    }
    const manifest = fs.readFileSync(path.join(ROOT, 'android/app/src/main/AndroidManifest.xml'), 'utf8');
    expect(manifest).toContain('android:icon="@mipmap/ic_launcher"');
    expect(manifest).toContain('android:roundIcon="@mipmap/ic_launcher_round"');
  });
  test('템플릿 기본 아이콘·스플래시(Capacitor 로고·안드로이드 로봇)가 남지 않는다 — res 아래 PNG 0개 · drawable-v24 없음', () => {
    const all: string[] = [];
    const walk = (d: string) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : all.push(path.relative(RES, path.join(d, e.name)))));
    walk(RES);
    expect(all.filter((f) => /\.(png|webp|jpg)$/i.test(f))).toEqual([]);
    expect(all.some((f) => f.startsWith('drawable-v24'))).toBe(false);
    expect(all.join('\n')).not.toMatch(/values\/ic_launcher_background\.xml/);
    for (const f of all.filter((x) => x.endsWith('.xml'))) expect([f, /#26A69A|#3DDC84/i.test(res(f))]).toEqual([f, false]);
  });
  test('스플래시: 바탕 #0f1115(= globals --bg) + ic_splash_icon(배경+전경 합성, 원 r=36 밖은 바탕색 고리) · 12+ 테마 속성 · 예전 방식 @drawable/splash', () => {
    const bg = GLOBALS.match(/--bg:\s*(#[0-9a-f]{6})/i)![1];
    expect(res('values/colors.xml')).toContain(`<color name="splash_background">${bg}</color>`);
    const styles = res('values/styles.xml');
    const launch = styles.match(/<style name="AppTheme\.NoActionBarLaunch" parent="Theme\.SplashScreen">([\s\S]*?)<\/style>/)![1];
    expect(launch).toContain('<item name="windowSplashScreenBackground">@color/splash_background</item>');
    expect(launch).toContain('<item name="windowSplashScreenAnimatedIcon">@drawable/ic_splash_icon</item>');
    expect(launch).toContain('<item name="android:background">@drawable/splash</item>');
    const splash = res('drawable/splash.xml').replace(/<!--[\s\S]*?-->/g, '');
    expect(splash).toContain('<item android:drawable="@color/splash_background" />');
    expect(splash).toMatch(/android:drawable="@drawable\/ic_splash_icon"\s+android:gravity="center"\s+android:width="288dp"\s+android:height="288dp"/);
    const icon = res('drawable/ic_splash_icon.xml');
    expect(vdHead(icon)).toMatch(/android:width="288dp"[\s\S]*android:viewportWidth="108"/);
    const ring = { fillColor: bg, strokeColor: undefined, strokeWidth: undefined, strokeLineCap: undefined, strokeLineJoin: undefined, fillType: 'evenOdd',
      pathData: 'M0,0H108V108H0Z M54,18A36,36 0,1 0,54,90A36,36 0,1 0,54,18Z' };
    expect(vdPaths(icon)).toEqual([...[...O2_BG, ...O2_FG].map(toVd), ring]);
  });
  test('앱 이름: strings.xml app_name·title_activity_main = 주식캐기', () => {
    const s = res('values/strings.xml');
    expect(s).toContain('<string name="app_name">주식캐기</string>');
    expect(s).toContain('<string name="title_activity_main">주식캐기</string>');
  });
});

// ─── 가짜 DOM 위에서 스크립트 실행 ─────────────────────────────────────

class FakeNode {
  children: FakeNode[] = [];
  attrs: Record<string, string> = {};
  className = '';
  hidden = false;
  disabled = false;
  private _text = '';
  listeners: Record<string, (() => void)[]> = {};
  constructor(public tag: string, public isText = false, text = '') { this._text = text; }
  get firstChild() { return this.children[0] ?? null; }
  appendChild(c: FakeNode) { this.children.push(c); return c; }
  removeChild(c: FakeNode) { this.children = this.children.filter((x) => x !== c); return c; }
  setAttribute(k: string, v: string) { this.attrs[k] = v; }
  addEventListener(t: string, fn: () => void) { (this.listeners[t] ??= []).push(fn); }
  get textContent(): string { return this.isText ? this._text : this._text + this.children.map((c) => c.textContent).join(''); }
  set textContent(v: string) { this.children = []; this._text = v; }
  find(cls: string): FakeNode | null {
    if (this.className.split(' ').includes(cls)) return this;
    for (const c of this.children) { const f = c.find(cls); if (f) return f; }
    return null;
  }
}

function boot(online: boolean) {
  const ids: Record<string, FakeNode> = Object.fromEntries(['t', 'd', 'live', 'retry', 'hint'].map((id) => [id, new FakeNode(id)]));
  const winListeners: Record<string, (() => void)[]> = {};
  const replaced: string[] = [];
  const timers: { fn: () => void; ms: number }[] = [];
  const intervals: unknown[] = [];
  const nav = { onLine: online };
  const document = {
    getElementById: (id: string) => ids[id],
    createElement: (tag: string) => new FakeNode(tag),
    createTextNode: (t: string) => new FakeNode('#text', true, t),
  };
  const window = {
    location: { replace: (u: string) => { replaced.push(u); } },
    addEventListener: (t: string, fn: () => void) => { (winListeners[t] ??= []).push(fn); },
  };
  const script = HTML.slice(HTML.indexOf('<script>') + 8, HTML.indexOf('</script>'));
  vm.runInNewContext(script, {
    document, window, navigator: nav,
    setTimeout: (fn: () => void, ms: number) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: () => {},
    setInterval: (...a: unknown[]) => { intervals.push(a); return 0; },
  });
  const fire = (t: string) => (winListeners[t] ?? []).forEach((f) => f());
  const click = () => (ids.retry.listeners.click ?? []).forEach((f) => f());
  return { ids, replaced, timers, intervals, nav, fire, click, winListeners };
}

describe('[다시 시도]·온라인 복귀 동작', () => {
  test('오프라인 시작: 인터넷 끊김 문구 · ! 경고 상태 · 힌트 숨김', () => {
    const b = boot(false);
    expect(b.ids.t.textContent).toBe('인터넷에 연결되어 있지 않습니다');
    expect(b.ids.live.textContent).toBe('!휴대폰 인터넷: 연결 안 됨');
    expect(b.ids.live.find('warn')).not.toBeNull();
    expect(b.ids.hint.hidden).toBe(true);
    expect(b.ids.retry.textContent).toBe('다시 시도');
  });
  test('온라인 시작(서버 무응답): 서버 문구 · ✓ 연결됨 · 힌트 보임', () => {
    const b = boot(true);
    expect(b.ids.t.textContent).toBe('서버에 연결하지 못했습니다');
    expect(b.ids.d.textContent).toBe('휴대폰 인터넷은 연결되어 있지만 서버가 응답하지 않습니다. 점검이나 재시작 중일 수 있습니다.');
    expect(b.ids.live.textContent).toBe('✓휴대폰 인터넷: 연결됨');
    expect(b.ids.hint.hidden).toBe(false);
  });
  test('누르면 운영 주소로 location.replace · "연결 중…" 잠김 · 약 8초 뒤 풀림 · 잠긴 동안 다시 눌러도 무시', () => {
    const b = boot(true);
    b.click();
    expect(b.replaced).toEqual(['https://stock.xn--lh0b87pnudm10a4vd.com/']);
    expect(b.ids.retry.disabled).toBe(true);
    expect(b.ids.retry.textContent).toBe('연결 중…');
    expect(b.ids.live.textContent).toBe('다시 불러오는 중…');
    b.click();
    expect(b.replaced).toHaveLength(1);
    expect(b.timers.map((t) => t.ms)).toEqual([8000]);
    b.timers[0].fn();
    expect(b.ids.retry.disabled).toBe(false);
    expect(b.ids.retry.textContent).toBe('다시 시도');
  });
  test('online 이벤트: 한 번만 자동 시도 · 주기적 재시도(setInterval) 없음', () => {
    const b = boot(false);
    b.nav.onLine = true;
    b.fire('online');
    expect(b.replaced).toHaveLength(1);
    b.timers[0].fn();
    b.fire('online');
    expect(b.replaced).toHaveLength(1);
    expect(b.intervals).toHaveLength(0);
    expect(HTML).not.toContain('setInterval');
  });
  test('offline 이벤트는 문구만 바꾼다(요청 없음)', () => {
    const b = boot(true);
    b.nav.onLine = false;
    b.fire('offline');
    expect(b.ids.t.textContent).toBe('인터넷에 연결되어 있지 않습니다');
    expect(b.replaced).toHaveLength(0);
  });
});
