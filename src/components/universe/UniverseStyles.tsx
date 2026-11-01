'use client';

/**
 * T-143 WP-B 해외 분석 대상 화면 스타일 — 승인 데모 v1(`mockups/T-143-universe-watch-v1.html`)의 앱 화면 CSS 를
 * `.uv` 범위로 가뒀다(T-066 `RiskStyles` 와 같은 방식).
 *
 * - 데모의 `@container fr (min-width: 900px)` 판정은 **`@media (min-width: 900px)`** 로 바꿨다(T-084·T-108 선례).
 * - **머리 숫자 4칸·탭·섹션·오류 줄·뼈대·버튼·결과 줄은 여기 없다** — `components/ops/ui/**`(`ops.module.css`)를 그대로 쓴다
 *   (가이드 §2.0). 여기 있는 것은 데모가 새로 그린 것 — 제안 카드 · 대조 목록 · 종목 목록 · 출처 칩 줄 · 붙여넣기 칸뿐이다.
 * - **`--up`(빨강)·`--down`(파랑)을 쓰지 않는다** — 이 앱의 빨강·파랑은 상승·하락이라 「목록에 넣기」에 빨강을 쓰면
 *   「오른다」로 읽힌다(가이드 §9.3). 강조는 `--accent`, 위험은 `--danger`, 성공은 `--ok`.
 * - 색만으로 뜻을 말하지 않는다 — 출처는 **글자**(수동·자동·즐겨찾기·보유), 대조는 **기호 + 글자**(`+` 넣기 · `−` 빼기 ·
 *   `!` 형식 오류 · `=` 중복). 기호는 `aria-hidden`(옆 글자가 뜻을 말한다 — `CheckRow` 규칙).
 */

export const UNIVERSE_CSS = `
.uv { min-width: 0; }
.uv :focus-visible { outline: 2px solid var(--text); outline-offset: 2px; }
.uv button:disabled { cursor: not-allowed; }
.uv code { font-size: 12px; background: var(--bg3); padding: 1px 4px; border-radius: 4px; overflow-wrap: anywhere; }
.uv .sr { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }

/* 앱바 — /settings/risk-policy·/settings/cash-ledger 와 같은 모양 */
.uv .uv-head { display: flex; align-items: center; gap: 8px; padding: calc(8px + var(--safe-top)) 8px 8px; border-bottom: 1px solid var(--border); }
.uv .uv-head h2 { margin: 0; font-size: 16px; font-weight: 700; flex: 1; min-width: 0; }
.uv .uv-head .at { font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
.uv .back { display: inline-flex; align-items: center; min-height: 44px; min-width: 44px; padding: 0 8px; font-size: 14px; color: var(--muted); border-radius: 8px; }
.uv .tabwrap { padding: 8px 12px; border-bottom: 1px solid var(--border); background: var(--bg2); }

/* 출처 칩 — 데모 .st.manual/.auto/.fav/.held. 테두리 모양도 함께 바꿔 색만으로 구분하지 않는다 */
.uv .chip { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 700; padding: 2px 6px; border-radius: 6px; border: 1px solid var(--border2); color: var(--text); background: var(--bg); line-height: 1.4; white-space: nowrap; }
.uv .chip.manual { border-color: rgba(245,158,11,.55); color: var(--accent); }
.uv .chip.auto { border-color: rgba(59,130,246,.5); color: #93c5fd; }
.uv .chip.fav { border-style: dashed; border-color: var(--border2); color: var(--muted); }
.uv .chip.held { border-color: rgba(34,197,94,.5); color: #86efac; }
.uv .chip.prop { border-color: var(--danger); color: #fca5a5; }

/* 제안 카드 */
.uv .pcard { margin: 10px 12px; background: var(--bg3); border: 1px solid var(--border2); border-radius: 10px; padding: 10px 12px; font-size: 13px; line-height: 1.5; }
.uv .pcard.settled { opacity: .6; }
.uv .pcard .ph { display: flex; align-items: flex-start; gap: 8px; flex-wrap: wrap; }
.uv .pcard .sym { font-size: 14px; font-weight: 700; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.uv .pcard dl { margin: 8px 0 0; display: grid; grid-template-columns: 52px minmax(0, 1fr); gap: 4px 8px; font-size: 12px; line-height: 1.5; }
.uv .pcard dt { color: var(--muted); font-weight: 600; }
.uv .pcard dd { margin: 0; overflow-wrap: anywhere; word-break: keep-all; }
.uv .pcard .warnline { margin-top: 8px; padding: 6px 8px; border-radius: 6px; border: 1px solid rgba(245,158,11,.45); background: rgba(245,158,11,.08); font-size: 12px; color: var(--accent); line-height: 1.5; word-break: keep-all; }
.uv .pcard .acts { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 10px; }
.uv .pcard .acts .wide { grid-column: 1 / -1; }
.uv .pcard .rl { margin-top: 8px; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--border2); font-size: 12px; line-height: 1.55; word-break: keep-all; }
.uv .pcard .rl.ok { border-color: rgba(34,197,94,.5); color: #86efac; }
.uv .pcard .rl.bad { border-color: var(--danger); color: #fca5a5; }

/* 종목 목록 */
.uv .filters { display: flex; gap: 6px; overflow-x: auto; padding: 10px 12px; border-bottom: 1px solid var(--border); -webkit-overflow-scrolling: touch; scrollbar-width: thin; }
.uv .filters button { flex: none; min-height: 44px; padding: 0 12px; border-radius: 10px; font-size: 12px; font-weight: 600; background: var(--bg3); border: 1px solid var(--border); color: var(--muted); white-space: nowrap; }
.uv .filters button[aria-pressed="true"] { background: var(--bg4); border-color: var(--accent); color: var(--accent); }
.uv .filters button:focus-visible { outline: 2px solid var(--text); outline-offset: -2px; }
.uv .ulist { border-top: 1px solid var(--border); }
.uv .urow { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: center; min-height: 56px; padding: 8px 12px 8px 16px; border-bottom: 1px solid var(--border); }
.uv .urow:last-child { border-bottom: 0; }
.uv .urow .sy { font-size: 14px; font-weight: 600; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.uv .urow .sy small { display: block; font-size: 11px; color: var(--muted); font-weight: 500; margin-top: 2px; }
.uv .urow .tags { display: flex; gap: 4px; flex-wrap: wrap; justify-content: flex-end; }
.uv .listfoot { padding: 12px; border-top: 1px solid var(--border); }
.uv .listfoot a { width: 100%; }

/* 일괄 교체 */
.uv .bulk { padding: 12px 16px; display: flex; flex-direction: column; gap: 8px; }
.uv .bulk label { display: block; font-size: 13px; font-weight: 600; word-break: keep-all; }
.uv .bulk .hint { font-size: 12px; color: var(--muted); line-height: 1.55; margin: 0; word-break: keep-all; }
/* 16px 이상으로 둬 iOS 자동 확대를 막는다(가이드 §9.1 — 모바일 글자 규칙의 유일한 예외) */
.uv .bulk textarea { width: 100%; min-height: 180px; background: var(--bg3); border: 1px solid var(--border2); border-radius: 8px; color: var(--text); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 16px; line-height: 1.6; padding: 8px 10px; resize: vertical; }
.uv .bulk .bar2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.uv .bulk .bar1 { display: grid; grid-template-columns: 1fr; gap: 8px; }

/* 대조 결과 */
.uv .diff { border: 1px solid var(--border2); border-radius: 8px; overflow: hidden; }
.uv .diff .dh { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1px; background: var(--border); }
.uv .diff .dh div { background: var(--bg3); padding: 8px 6px; text-align: center; }
.uv .diff .dh .k { display: block; font-size: 11px; color: var(--muted); line-height: 1.4; }
.uv .diff .dh .n { display: block; font-size: 18px; font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1.3; }
.uv .diff ul { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--border); max-height: 50vh; overflow-y: auto; overscroll-behavior: contain; }
.uv .diff li { display: grid; grid-template-columns: 22px minmax(0, 1fr); gap: 8px; align-items: baseline; padding: 7px 12px; border-bottom: 1px solid var(--border); font-size: 13px; line-height: 1.5; }
.uv .diff li:last-child { border-bottom: 0; }
.uv .diff li .mk { font-weight: 800; font-size: 14px; text-align: center; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.uv .diff li .sy { font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.uv .diff li .sy em { font-style: normal; color: var(--muted); font-size: 12px; margin-left: 6px; }
.uv .diff li.add { background: rgba(245,158,11,.06); }
.uv .diff li.add .mk { color: var(--accent); }
.uv .diff li.rm .mk { color: var(--muted); }
.uv .diff li.bad { background: rgba(239,68,68,.09); }
.uv .diff li.bad .mk { color: #fca5a5; }
.uv .diff .dnote { padding: 8px 12px; font-size: 12px; color: var(--muted); line-height: 1.55; border-top: 1px solid var(--border); word-break: keep-all; }
.uv .diff .dnote.alert { color: #fca5a5; }
.uv .diff .dnote.warn { color: var(--accent); }

/* 시트 본문 */
.uv-sheet p { margin: 6px 0; font-size: 13px; line-height: 1.55; word-break: keep-all; }
.uv-sheet .tail { color: var(--muted); font-size: 12px; }
.uv-sheet .warnline { padding: 6px 8px; border-radius: 6px; border: 1px solid rgba(245,158,11,.45); background: rgba(245,158,11,.08); font-size: 12px; color: var(--accent); line-height: 1.5; word-break: keep-all; }
.uv-sheet .alertline { color: #fca5a5; }
.uv-sheet .bt { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }

/* 설정 요약 행 — RiskPolicySummaryRow·CashLedgerSummaryRow 와 같은 56px 행, 행 전체가 누르는 영역(T-130 규칙) */
.uv-row { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 10px; align-items: center; min-height: 56px; padding: 8px 12px 8px 16px; border-bottom: 1px solid var(--border); width: 100%; text-align: left; }
.uv-row .ic { width: 22px; height: 22px; flex: none; display: inline-flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 800; border-radius: 6px; border: 1px solid var(--border2); color: var(--muted); }
.uv-row .ic.w { border-color: rgba(245,158,11,.6); color: var(--accent); }
.uv-row .t { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 14px; line-height: 1.4; }
.uv-row .s { display: block; font-size: 12px; color: var(--muted); line-height: 1.45; margin-top: 2px; overflow-wrap: anywhere; word-break: keep-all; }
.uv-row .r { font-size: 12px; color: var(--muted); white-space: nowrap; }
.uv-row:focus-visible { outline: 2px solid var(--text); outline-offset: -2px; }

/* 1280px 에서 폭 720px 중앙 고정. 데스크톱 전용 2열 레이아웃은 만들지 않는다(가이드 §0.4·§9.1) */
@media (min-width: 900px) {
  .uv .pcard { margin-left: 16px; margin-right: 16px; }
}
@media (min-width: 1280px) {
  .uv { max-width: 720px; margin: 0 auto; }
}
`;

export function UniverseStyles() {
  return <style dangerouslySetInnerHTML={{ __html: UNIVERSE_CSS }} />;
}
