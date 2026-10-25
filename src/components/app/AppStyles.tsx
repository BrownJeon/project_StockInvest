/**
 * T-084 — 앱 업데이트 띠(`.aub`)·설정 › 앱 섹션(`.aps`) 스타일. 승인 데모 v1(`mockups/T-084-app-shell-v1.html`)의
 * "B. 앱 업데이트 띠"·"C. 설정 › 앱 섹션" CSS 를 그대로 옮기고 각 루트 클래스 범위로 가뒀다(T-074 `LedgerStyles` 의 `.lg` 와 같은 방식).
 * 데모 공통(`.card`·`.row`·`.st`·`.btn-pri`·`.btn-ghost`·`.spin`·`.s`)은 `.aps` 아래로만 복사했다 — 전역 클래스와 섞이지 않게.
 * 데모의 `@container (min-width: 900px)` 는 `@media (min-width: 900px)` 로 바꿨다(설정 화면은 컨테이너 쿼리 틀이 없다).
 * 색은 globals.css 토큰 이름만 쓴다. 위험 톤 `#fca5a5`·`rgba(239,68,68,…)`·`#2a1416`/`#4a2226` 과 버튼 글자 `#221a05` 는
 * 기존 코드 관용값(authStyles.noteDanger·submit)이다(가이드 머리 "기존 코드 관용값").
 */

export const BANNER_CSS = `
.aub { display: flex; align-items: center; gap: 4px; min-height: 56px; padding: var(--safe-top) 4px 0 16px; background: var(--bg2); border-bottom: 1px solid var(--border); }
.aub :focus-visible { outline: 2px solid var(--text); outline-offset: 2px; }
.aub .num { font-variant-numeric: tabular-nums; }
.aub .bar { flex: none; width: 3px; height: 32px; border-radius: 2px; background: var(--accent); }
.aub .txt { flex: 1; min-width: 0; min-height: 44px; padding: 6px 8px; text-align: left; display: flex; flex-direction: column; justify-content: center; }
.aub .t { display: block; font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.aub .ss { display: block; font-size: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.aub .get { flex: none; min-height: 44px; padding: 0 14px; border-radius: 8px; background: var(--accent); color: #221a05; font-size: 13px; font-weight: 700; }
.aub .x { flex: none; width: 44px; height: 44px; display: grid; place-items: center; color: var(--muted); border-radius: 8px; }
.aub.forced { background: rgba(239,68,68,.12); border-bottom-color: rgba(239,68,68,.45); padding-right: 12px; align-items: center; }
.aub.forced .bar { background: var(--danger); align-self: stretch; height: auto; margin: 10px 0; }
.aub.forced .t { color: #fca5a5; white-space: normal; }
.aub.forced .ss { color: var(--text); white-space: normal; line-height: 1.45; }
@media (hover: hover) { .aub .x:hover { background: var(--bg3); } }
`;

export const APP_SECTION_CSS = `
.aps { display: flex; flex-direction: column; gap: 12px; }
.aps :focus-visible { outline: 2px solid var(--text); outline-offset: 2px; }
.aps .num { font-variant-numeric: tabular-nums; }
.aps .muted { color: var(--muted); }
.aps code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
.aps button:disabled { cursor: not-allowed; }
.aps .sec-h { font-size: 13px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: .5px; padding: 8px 0 4px; scroll-margin-top: 12px; }
.aps .card { background: var(--bg2); border-radius: 12px; border: 1px solid var(--border); overflow: hidden; }
.aps .s { font-size: 12px; color: var(--muted); margin-top: 2px; line-height: 1.5; }
.aps .row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--border); min-height: 48px; flex-wrap: wrap; }
.aps .row .l { font-size: 14px; min-width: 0; }
.aps .row .v { font-size: 14px; font-weight: 700; flex-shrink: 0; text-align: right; }
.aps .st { display: inline-flex; align-items: baseline; gap: 4px; font-size: 12px; font-weight: 700; line-height: 1.45; white-space: nowrap; }
.aps .st.ok { color: var(--ok); } .aps .st.warn { color: var(--warn); } .aps .st.bad { color: #fca5a5; } .aps .st.na { color: var(--muted); }
.aps .btn-pri { display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 48px; width: 100%; border-radius: 10px; background: var(--accent); color: #221a05; font-size: 15px; font-weight: 700; text-align: center; }
.aps .btn-pri:disabled { opacity: .6; }
.aps .btn-ghost { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 0 14px; border-radius: 8px; border: 1px solid var(--border2); background: var(--bg3); font-size: 13px; font-weight: 600; flex-shrink: 0; }
.aps .spin { display: inline-block; width: 14px; height: 14px; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: ti-spin .8s linear infinite; }
@media (prefers-reduced-motion: reduce) { .aps .spin { animation: none; border-right-color: currentColor; opacity: .6; } }

.apc .ap-top { display: flex; align-items: center; gap: 12px; padding: 14px 16px; border-bottom: 1px solid var(--border); }
.apc .ap-top svg { flex: none; width: 44px; height: 44px; }
.apc .ap-top .nm { font-size: 15px; font-weight: 700; }
.apc .ap-main { padding: 12px 16px; display: flex; flex-direction: column; gap: 10px; }
.apc .meta { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 12px; color: var(--muted); }
.apc .meta b { color: var(--text); font-weight: 600; }
.apc ol.steps { margin: 0; padding: 0; list-style: none; counter-reset: st; display: flex; flex-direction: column; gap: 10px; }
.apc ol.steps li { counter-increment: st; position: relative; padding-left: 32px; font-size: 13px; line-height: 1.55; }
.apc ol.steps li::before { content: counter(st); position: absolute; left: 0; top: 0; width: 22px; height: 22px; border-radius: 50%; background: var(--bg3); border: 1px solid var(--border2); font-size: 12px; font-weight: 700; display: grid; place-items: center; }
.apc ol.steps li b { display: block; font-size: 13px; }
.apc ol.steps li span { color: var(--muted); }
.apc details.guide { border-top: 1px solid var(--border); }
.apc details.guide summary { list-style: none; display: flex; align-items: center; justify-content: space-between; min-height: 48px; padding: 0 16px; font-size: 13px; font-weight: 600; cursor: pointer; }
.apc details.guide summary::-webkit-details-marker { display: none; }
.apc details.guide summary::after { content: "›"; color: var(--muted); font-size: 18px; transition: transform .2s; }
.apc details.guide[open] summary::after { transform: rotate(90deg); }
.apc details.guide .gbody { padding: 0 16px 14px; font-size: 12px; color: var(--muted); line-height: 1.6; }
.apc details.guide .gbody code.full { word-break: break-all; }
.apc .nt { background: var(--bg3); border: 1px solid var(--border2); border-left: 3px solid var(--accent); border-radius: 8px; padding: 10px 12px; font-size: 12px; color: var(--muted); line-height: 1.55; }
.apc .nt.red { background: #2a1416; border-color: #4a2226; border-left-color: var(--danger); }
.apc .nt.red b { color: #fca5a5; }
.apc .ldg { padding: 18px 16px; font-size: 13px; color: var(--muted); display: flex; align-items: center; gap: 8px; }
.apc .hash { font-size: 12px; color: var(--muted); }
.apc .hash code, .apc .gbody code { color: var(--text); background: var(--bg3); border: 1px solid var(--border2); border-radius: 4px; padding: 1px 6px; }
.apc .chk { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 4px 16px 4px; border-top: 1px solid var(--border); font-size: 12px; color: var(--muted); min-height: 52px; }
.apc ul.notes { margin: 0; padding-left: 18px; font-size: 12px; color: var(--muted); line-height: 1.6; }
@media (min-width: 900px) {
  .apc .ap-cols { display: grid; grid-template-columns: minmax(0, 360px) minmax(0, 1fr); }
  .apc .ap-cols > .ap-main + .ap-main { border-left: 1px solid var(--border); }
}
@media (hover: hover) {
  .apc details.guide summary:hover, .aps .btn-ghost:hover { background: var(--bg3); }
}
`;

export function BannerStyles() {
  return <style dangerouslySetInnerHTML={{ __html: BANNER_CSS }} />;
}

export function AppSectionStyles() {
  return <style dangerouslySetInnerHTML={{ __html: APP_SECTION_CSS }} />;
}

/**
 * 설정 카드의 44px 앱 아이콘. ICON-SLOT — 앱 아이콘 ② "지층형 + 금덩이"(2026-10-25 사용자 확정).
 * `mockups/T-084-app-icon-v1.html` 의 SRC.o2 배경+전경을 그대로 옮기고, 보이는 영역 72×72(viewBox 18 18 72 72)를
 * 둥근 사각(시안 m-s 마스크 rx 16/72 = 22.222%)으로 자른다. 자르기는 CSS border-radius 라 SVG `id`(clipPath)가 없다 —
 * 한 페이지에 여러 번 그려도 id 충돌이 없다. 안드로이드 `drawable/ic_launcher_{background,foreground}.xml`·
 * `public/app-shell/index.html` 로고와 같은 도형이다(바꾸면 셋 다). 곡괭이 시안(v1 A)은 쓰지 않는다.
 */
export function AppIcon({ size = 44 }: { size?: number }) {
  return (
    <svg
      viewBox="18 18 72 72"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      style={{ display: 'block', borderRadius: '22.222%', overflow: 'hidden' }}
    >
      <rect width="108" height="108" fill="#171a21" />
      <path d="M0 60 Q27 55 54 59 T108 57 V108 H0 Z" fill="#1f2430" />
      <path d="M0 82 Q30 77 60 81 T108 79 V108 H0 Z" fill="#262b36" />
      <polygon points="27,69.4 36,65.4 46,67.8 58,65.3 70,68.4 81,68.4 81,69.6 70,73.6 58,71.7 46,74.2 36,70.6 27,70.6" fill="#f59e0b" />
      <rect x="34.8" y="48" width="2.4" height="14.5" rx="1.2" fill="#ef4444" />
      <rect x="31.5" y="51" width="9" height="9" rx="1.5" fill="#ef4444" />
      <rect x="46.8" y="37" width="2.4" height="27.5" rx="1.2" fill="#ef4444" />
      <rect x="43.5" y="41" width="9" height="18" rx="1.5" fill="#ef4444" />
      <rect x="58.8" y="27" width="2.4" height="36" rx="1.2" fill="#ef4444" />
      <rect x="55.5" y="31" width="9" height="26" rx="1.5" fill="#ef4444" />
      <polygon points="68,36 73,31.5 78.5,34.5 80,40.5 75,44.5 69,42" fill="#f59e0b" />
      <path
        d="M69 42 L72.5 38 L80 40.5 M72.5 38 L73 31.5"
        fill="none"
        stroke="#171a21"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
