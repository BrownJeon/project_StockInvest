/**
 * T-108 — jest 전용 CSS Module 스텁 (jest.config.js moduleNameMapper `\.module\.css$` 가 가리킨다).
 *
 * jest 는 CSS 를 해석하지 못한다(transform 은 ts/js 만). `import s from "./x.module.css"` 의 `s.tile` 이
 * 클래스 이름 그대로 `"tile"` 이 되게 해, 화면 시험(renderToStaticMarkup)이 데모와 같은 class 이름을 대조할 수 있게 한다.
 * 빌드·런타임 영향 0 — Next.js 빌드는 이 파일을 쓰지 않는다(시험 파일 이름 `*.test.ts` 가 아니라 시험으로도 실행되지 않음).
 */
const proxy = new Proxy({}, {
  get(_target, key) {
    if (typeof key === "symbol") return undefined;
    if (key === "__esModule") return true;
    if (key === "default") return proxy;
    return key;
  },
});
module.exports = proxy;
