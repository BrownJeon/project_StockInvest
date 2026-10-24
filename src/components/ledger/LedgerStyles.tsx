/**
 * T-074 입출금 기록 화면 스타일 — 승인 데모 v1(`mockups/T-074-cash-flow-ledger-v1.html`)의 앱 화면 CSS 를 그대로 옮기고 `.lg` 범위로 가뒀다
 * (T-066 `RiskStyles` 의 `.rp` 와 같은 방식). 데모 문서 틀(`.page`·`.phone`·`.desk`·컨트롤·주석)과 데모 전용 하단 탭·가짜 토글은 뺐다.
 * 데모의 `@container (min-width: 900px)` 는 `@media (min-width: 900px)` 로 바꿨다(데모 주석·가이드 7절).
 * 시트 틀(`.sheet-root`·`.sh-*`)은 공용 `components/ui/Sheet.tsx` 가 가진다 — 시트 루트에도 `lg` 클래스를 붙여 아래 내용 스타일이 적용된다.
 * 토스트는 z-index 45 — 시트(50) 아래(designer 점검 P1-1 보조, 시트를 열 때 토스트도 지운다). 접힌 목록 행의 메모·메타는 2줄 말줄임(P2-4).
 * 색: 빨강/파랑(--up/--down)은 손익에만. 입금·출금 금액은 중립색 + 부호 + 종류 칩. 경고·차단·기록 취소는 amber(--warn) + 기호 + 글자.
 */
export const LEDGER_CSS = `
.lg .num { font-variant-numeric: tabular-nums; }
.lg .sr { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
.lg :focus-visible { outline: 2px solid var(--text); outline-offset: 2px; }
.lg .muted { color: var(--muted); }
.lg .hide, .lg [hidden] { display: none !important; }
.lg button:disabled { cursor: not-allowed; }

.lg .app-body { padding: 12px 16px; display: flex; flex-direction: column; gap: 12px; }
.lg .card { background: var(--bg2); border-radius: 12px; border: 1px solid var(--border); overflow: hidden; }
.lg .chev { font-size: 18px; color: var(--muted); flex-shrink: 0; }
.lg .mode { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 6px; white-space: nowrap; line-height: 1.5; }
.lg .mode.disp { color: var(--muted); border: 1px dashed var(--muted); white-space: normal; }
.lg .strip { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 8px 16px; border-bottom: 1px solid var(--border); font-size: 12px; color: var(--muted); line-height: 1.5; }
.lg .strip b { color: var(--text); }
.lg .st { display: inline-flex; align-items: baseline; gap: 4px; font-size: 12px; font-weight: 700; line-height: 1.45; }
.lg .st i { font-style: normal; display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; border-radius: 4px; font-size: 11px; flex-shrink: 0; transform: translateY(2px); }
.lg .st.warn { color: var(--warn); } .lg .st.warn i { background: rgba(245,158,11,.18); }
.lg .st.ok { color: var(--ok); } .lg .st.ok i { background: rgba(34,197,94,.16); }
.lg .st.na { color: var(--muted); font-weight: 600; } .lg .st.na i { background: var(--bg3); }
.lg .st.info { color: var(--text); font-weight: 600; } .lg .st.info i { background: var(--bg4); }
.lg .warnbox { padding: 10px 12px; border-radius: 8px; background: rgba(245,158,11,.10); border: 1px solid rgba(245,158,11,.40); font-size: 12px; line-height: 1.6; }
.lg .warnbox b { color: var(--warn); }
.lg .infobox { display: flex; gap: 8px; padding: 10px 12px; border-radius: 8px; background: var(--bg3); border: 1px solid var(--border2); font-size: 12px; line-height: 1.6; }
.lg .infobox .ic { flex-shrink: 0; font-weight: 700; color: var(--muted); }
.lg .btn { min-height: 44px; padding: 0 16px; border-radius: 8px; font-size: 13px; font-weight: 700; }
.lg .btn.pri { background: var(--accent); color: #000; }
.lg .btn.sec { border: 1px solid var(--border2); color: var(--text); }
.lg .btn.warnline { border: 1px solid var(--warn); color: var(--warn); }
.lg .btn.wide { width: 100%; }
.lg .btn:disabled { opacity: .45; }
.lg .btns { display: flex; gap: 8px; flex-wrap: wrap; }
.lg .btns .btn { flex: 1 1 130px; }
.lg .rp-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; row-gap: 4px; padding: calc(8px + var(--safe-top)) 8px 8px; border-bottom: 1px solid var(--border); }
.lg .back { display: inline-flex; align-items: center; min-height: 44px; min-width: 44px; padding: 0 8px; font-size: 14px; color: var(--muted); border-radius: 8px; }
.lg .rp-head h2 { margin: 0; font-size: 16px; font-weight: 700; flex: 1 0 auto; white-space: nowrap; }
.lg .rp-head .mode { margin: 0 8px; }
.lg.riskrow, .lg .riskrow { display: block; background: var(--bg2); border: 1px dashed var(--border2); border-radius: 12px; overflow: hidden; }
.lg .riskrow .top { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; row-gap: 4px; padding: 10px 16px 0; }
.lg .riskrow .top b { font-size: 14px; flex: 1 0 auto; white-space: nowrap; }
.lg .riskrow .go { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 44px; padding: 8px 16px; border-top: 1px solid var(--border); font-size: 13px; font-weight: 600; color: var(--accent); }
.lg .rk-sum { padding: 12px 16px; display: flex; flex-direction: column; gap: 6px; font-size: 13px; line-height: 1.5; }
.lg .rk-sum .chips { display: flex; flex-wrap: wrap; gap: 4px 12px; }
.lg .skel { background: var(--bg3); border-radius: 6px; height: 14px; margin: 8px 0; }
.lg .skel.m { width: 70%; } .lg .skel.s { width: 45%; } .lg .skel.big { height: 30px; width: 55%; }

.lg .pl { font-variant-numeric: tabular-nums; }
.lg .pl.up { color: var(--up); } .lg .pl.down { color: var(--down); } .lg .pl.flat { color: var(--text); }
.lg .ptag { font-size: 11px; font-weight: 700; padding: 1px 6px; border-radius: 6px; border: 1px dashed rgba(245,158,11,.75); color: var(--warn); white-space: nowrap; }
.lg .lg-body { display: flex; flex-direction: column; gap: 12px; }
.lg .lg-top, .lg .lg-bot, .lg .lg-list { display: flex; flex-direction: column; gap: 12px; min-width: 0; }

.lg .sumcard { background: var(--bg2); border: 1px solid var(--border); border-radius: 12px; padding: 12px 16px 14px; display: flex; flex-direction: column; gap: 8px; }
.lg .sc-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.lg .sc-top h3 { margin: 0; font-size: 14px; font-weight: 700; outline: none; }
.lg .sc-big { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.lg .sc-big .pl { font-size: 26px; font-weight: 800; line-height: 1.2; }
.lg .sc-big .w { font-size: 13px; font-weight: 700; }
.lg .sc-r { display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; font-size: 13px; }
.lg .sc-r b { font-size: 14px; }
.lg .sc-sub { margin: 0; font-size: 12px; color: var(--muted); line-height: 1.5; }
.lg .formula { font-size: 12px; line-height: 1.6; padding: 8px 10px; border-radius: 8px; background: var(--bg3); border: 1px solid var(--border2); overflow-wrap: anywhere; }
.lg .formula b { color: var(--text); }
.lg .sc-dl { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 12px; margin: 0; }
.lg .sc-dl dt { font-size: 11px; color: var(--muted); }
.lg .sc-dl dd { margin: 2px 0 0; font-size: 14px; font-weight: 700; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.lg .sc-dl dd small { display: block; font-weight: 400; font-size: 11px; color: var(--muted); margin-top: 2px; line-height: 1.45; }
.lg .sc-dl dd small .st { font-size: 11px; }
.lg details.mini { font-size: 12px; color: var(--muted); }
.lg details.mini summary { display: inline-flex; align-items: center; min-height: 44px; cursor: pointer; color: var(--muted); font-weight: 600; list-style: none; }
.lg details.mini summary::-webkit-details-marker { display: none; }
.lg details.mini summary::before { content: "ⓘ "; margin-right: 2px; }
.lg details.mini p { margin: 4px 0 0; line-height: 1.6; }

.lg .cand { border: 1px solid rgba(245,158,11,.55); background: rgba(245,158,11,.07); border-radius: 12px; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.lg .cand h3 { margin: 0; font-size: 14px; color: var(--warn); display: flex; gap: 6px; align-items: baseline; }
.lg .cand p { margin: 0; font-size: 13px; line-height: 1.6; }
.lg .cand .rule { font-size: 12px; color: var(--muted); }
.lg .cand.done { border: 1px dashed var(--border2); background: none; }
/* 열린 후보 2건 이상 묶음 · 표시한 후보 접힘 (designer 구현 점검 P2-2) */
.lg .cand-rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.lg .cand-rows li { display: flex; flex-direction: column; gap: 6px; padding: 8px 0; border-top: 1px solid rgba(245,158,11,.25); }
.lg .cand-rows li:first-child { border-top: 0; padding-top: 0; }
.lg details.more { font-size: 12px; color: var(--muted); }
.lg details.more summary { display: inline-flex; align-items: center; gap: 8px; min-height: 44px; cursor: pointer; color: var(--muted); font-weight: 600; list-style: none; }
.lg details.more summary::-webkit-details-marker { display: none; }
/* 기록 안내(details.guide)와 같은 펼치기/접기 표시 — 대체 텍스트 문법으로 기호는 읽지 않게(지원 안 하면 앞 선언이 쓰인다) */
.lg details.more summary::after { content: "펼치기 ▾"; content: "펼치기 ▾" / "펼치기"; font-size: 12px; font-weight: 600; color: var(--muted); flex-shrink: 0; }
.lg details.more[open] summary::after { content: "접기 ▴"; content: "접기 ▴" / "접기"; }
.lg details.more .more-body { display: flex; flex-direction: column; gap: 8px; }
.lg .scan-note { margin: 0; font-size: 12px; line-height: 1.5; }
.lg .cand.done p { font-size: 12px; color: var(--muted); }
.lg .sigs { display: flex; flex-direction: column; gap: 8px; }
.lg .sigs .lnk { display: inline-flex; align-items: center; min-height: 44px; padding: 0 4px; font-size: 12px; font-weight: 700; color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }

.lg .lh { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.lg .lh h3 { margin: 0; font-size: 14px; outline: none; }
.lg .tgl { min-height: 44px; padding: 0 12px; border-radius: 8px; border: 1px solid var(--border2); font-size: 12px; font-weight: 600; color: var(--muted); }
.lg .tgl.on { color: var(--text); border-color: var(--muted); background: var(--bg3); }
@media (hover: hover) {
  .lg .btn:hover:not(:disabled), .lg .tgl:hover, .lg .rowbtn:hover { filter: brightness(1.12); }
  .lg .erow-h:hover, .lg details.guide summary:hover, .lg .riskrow:hover { background: var(--bg3); }
}
.lg .elist { list-style: none; margin: 0; padding: 0; border: 1px solid var(--border); border-radius: 12px; overflow: hidden; background: var(--bg2); }
.lg .erow { border-top: 1px solid var(--border); }
.lg .erow:first-child { border-top: 0; }
.lg .erow-h { width: 100%; text-align: left; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 10px; padding: 12px 16px; min-height: 56px; }
.lg .erow-h .k { display: flex; align-items: center; gap: 6px; }
.lg .erow-h .id { font-size: 11px; color: var(--muted); }
.lg .erow-h .a { font-size: 15px; font-weight: 700; text-align: right; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.lg .erow-h .m { font-size: 12px; color: var(--muted); line-height: 1.5; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.lg .erow-h .s { text-align: right; }
.lg .erow-h .x { grid-column: 1 / -1; font-size: 12px; color: var(--muted); line-height: 1.5; overflow-wrap: anywhere; }
.lg .erow.void .erow-h .a, .lg .etable tr.void td.amt { text-decoration: line-through; color: var(--muted); }
.lg .erow.void { background: rgba(0,0,0,.18); }
.lg .erow-d { padding: 0 16px 14px; display: flex; flex-direction: column; gap: 10px; }
.lg .kchip { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; font-weight: 700; padding: 2px 8px; border-radius: 6px; border: 1px solid var(--border2); background: var(--bg3); white-space: nowrap; }
.lg .kchip i { font-style: normal; color: var(--muted); }
.lg .kd { display: grid; grid-template-columns: 88px minmax(0, 1fr); gap: 6px 10px; margin: 0; font-size: 12px; line-height: 1.55; }
.lg .kd dt { color: var(--muted); }
.lg .kd dd { margin: 0; overflow-wrap: anywhere; }
.lg .emptyl { border: 1px dashed var(--border2); border-radius: 12px; padding: 16px; display: flex; flex-direction: column; gap: 8px; font-size: 13px; line-height: 1.6; }
.lg .emptyl p { margin: 0; color: var(--muted); }
.lg .basecard .bc-h { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 12px 16px 0; }
.lg .basecard h3 { margin: 0; font-size: 14px; }
.lg .basecard .kd { padding: 10px 16px; font-size: 13px; grid-template-columns: 96px minmax(0, 1fr); }
.lg .basecard .btns { padding: 0 16px 12px; }
.lg details.guide { background: var(--bg2); border: 1px solid var(--border); border-radius: 12px; }
.lg details.guide summary { min-height: 48px; display: flex; align-items: center; justify-content: space-between; gap: 8px; cursor: pointer; font-weight: 700; font-size: 13px; padding: 0 16px; list-style: none; }
.lg details.guide summary::-webkit-details-marker { display: none; }
.lg details.guide summary::after { content: "펼치기 ▾"; font-size: 12px; font-weight: 600; color: var(--muted); flex-shrink: 0; }
.lg details.guide[open] summary::after { content: "접기 ▴"; }
.lg details.guide ul { margin: 0; padding: 0 16px 14px 32px; font-size: 13px; line-height: 1.6; }
.lg details.guide li { margin-bottom: 6px; }
.lg .nobase { padding: 16px; display: flex; flex-direction: column; gap: 10px; font-size: 13px; line-height: 1.6; }
.lg .nobase h3 { margin: 0; font-size: 15px; }
.lg .nobase p { margin: 0; }

.lg table.etable { width: 100%; border-collapse: collapse; font-size: 13px; border: 1px solid var(--border); background: var(--bg2); }
.lg table.etable th, .lg table.etable td { padding: 9px 8px; border-top: 1px solid var(--border); text-align: left; vertical-align: top; line-height: 1.5; }
.lg table.etable thead th { font-size: 11px; font-weight: 700; color: var(--muted); }
.lg table.etable td.r, .lg table.etable th.r { text-align: right; font-variant-numeric: tabular-nums; }
.lg table.etable td.nw { white-space: nowrap; }
.lg table.etable td small { display: block; font-size: 11px; color: var(--muted); }
.lg table.etable tr.void td { color: var(--muted); }
.lg table.etable tr.dt td { background: var(--bg); padding: 12px 16px; }
.lg .rowbtn { min-height: 44px; min-width: 64px; padding: 0 10px; border-radius: 8px; border: 1px solid var(--border2); font-size: 12px; font-weight: 600; }
.lg .only-d { display: none; }

/* 시트 안 내용 (시트 틀은 components/ui/Sheet.tsx) */
.lg .sh-foot .btns .btn { flex: 1 1 0; }
.lg .csub { margin: 0; font-size: 13px; color: var(--muted); line-height: 1.6; }
.lg fieldset.kseg { border: 0; padding: 0; margin: 0; min-width: 0; }
.lg fieldset.kseg legend, .lg .fl { display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px; padding: 0; }
.lg .kseg .opts { display: flex; gap: 6px; }
.lg .kseg .opts > label { flex: 1 1 0; position: relative; min-width: 0; }
.lg .kseg .opts input[type="radio"] { position: absolute; opacity: 0; width: 1px; height: 1px; }
.lg .kseg .opts > label > span { display: flex; flex-direction: column; justify-content: center; min-height: 52px; padding: 6px 8px; border-radius: 8px; border: 1px solid var(--border2); background: var(--bg3); font-size: 14px; font-weight: 700; line-height: 1.3; cursor: pointer; text-align: center; }
.lg .kseg .opts > label > span small { font-weight: 400; font-size: 11px; color: var(--muted); margin-top: 2px; }
.lg .kseg .opts input[type="radio"]:checked + span { border: 2px solid var(--accent); background: rgba(245,158,11,.10); }
.lg .kseg .opts input[type="radio"]:focus-visible + span { outline: 2px solid var(--text); outline-offset: 2px; }
.lg .kseg .opts input[type="radio"]:disabled + span { opacity: .5; cursor: not-allowed; }
.lg .kseg.list .opts { flex-direction: column; }
.lg .kseg.list .opts > label > span { text-align: left; font-size: 13px; min-height: 48px; }
.lg .kseg.list .opts .ln { display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.lg .field .hint, .lg .kseg > .hint { font-size: 12px; color: var(--muted); margin-top: 4px; line-height: 1.5; }
.lg .field .msgs { margin-top: 4px; display: flex; flex-direction: column; gap: 2px; }
.lg .inrow { display: flex; gap: 8px; }
.lg .inrow > * { flex: 1 1 0; min-width: 0; }
.lg .dtin { width: 100%; min-height: 48px; padding: 0 10px; border-radius: 8px; border: 1px solid var(--border2); background: var(--bg3); color: var(--text); font: inherit; font-size: 15px; color-scheme: dark; }
.lg .dtin:focus { border-color: var(--accent); outline: none; }
.lg .dtin[aria-invalid="true"] { border: 2px solid var(--warn); }
.lg .inwrap { display: flex; align-items: center; background: var(--bg3); border: 1px solid var(--border2); border-radius: 8px; min-height: 52px; padding: 0 12px; }
.lg .inwrap:focus-within { border-color: var(--accent); }
.lg .inwrap.bad { border-color: var(--warn); border-width: 2px; }
.lg .inwrap .cur { color: var(--muted); font-size: 15px; margin-right: 6px; flex-shrink: 0; }
.lg .inwrap input { flex: 1; min-width: 0; background: none; border: 0; color: var(--text); font-size: 18px; font-weight: 700; font-variant-numeric: tabular-nums; outline: none; padding: 0; min-height: 50px; text-align: right; font-family: inherit; }
.lg .inwrap input::placeholder { color: var(--muted); font-weight: 400; font-size: 14px; }
.lg .inwrap .unit { color: var(--muted); font-size: 14px; margin-left: 6px; flex-shrink: 0; }
.lg .inwrap.txt input { font-size: 15px; font-weight: 400; text-align: left; }
.lg .read { font-size: 13px; line-height: 1.5; margin-top: 6px; }
.lg .read b { font-variant-numeric: tabular-nums; }
.lg .blockbox { border: 2px solid var(--warn); background: rgba(245,158,11,.10); border-radius: 10px; padding: 10px 12px; font-size: 13px; line-height: 1.6; }
.lg .blockbox b { color: var(--warn); }
.lg .derived { font-size: 13px; line-height: 1.6; padding: 10px 12px; border-radius: 8px; background: var(--bg3); border: 1px solid var(--border2); }
.lg .derived .big { font-size: 17px; font-weight: 800; font-variant-numeric: tabular-nums; }
.lg .cbig { font-size: 16px; line-height: 1.6; font-weight: 600; margin: 0; }
.lg .cbig b { color: var(--accent); }
.lg .impact { font-size: 13px; line-height: 1.6; padding: 10px 12px; border-radius: 8px; background: var(--bg3); border: 1px solid var(--border2); }
.lg .impact b { font-variant-numeric: tabular-nums; }
.lg .errbox { padding: 10px 12px; border-radius: 8px; background: rgba(245,158,11,.12); border: 1px solid rgba(245,158,11,.7); font-size: 13px; line-height: 1.6; }
.lg .errbox b { color: var(--warn); }
.lg .rtext { width: 100%; min-height: 44px; margin-top: 6px; padding: 0 10px; border-radius: 8px; border: 1px solid var(--border2); background: var(--bg3); color: var(--text); font: inherit; }
.lg .toast { position: fixed; left: 50%; transform: translateX(-50%); bottom: calc(var(--nav-h) + 16px + var(--safe-bottom)); width: calc(100% - 32px); max-width: 380px; background: #1b1f27; border: 1px solid var(--border2); border-radius: 10px; padding: 10px 12px; font-size: 13px; line-height: 1.5; z-index: 45; box-shadow: 0 4px 16px rgba(0,0,0,.5); }
.lg .toast:empty { display: none; }

/* 넓은 화면(≥900px) — 데모의 container query 를 미디어 쿼리로 */
@media (min-width: 900px) {
  .lg .app-body { padding: 20px 24px; }
  .lg .lg-body { display: grid; grid-template-columns: minmax(0, 420px) minmax(0, 1fr); grid-template-rows: auto 1fr; grid-template-areas: "top list" "bot list"; column-gap: 20px; row-gap: 12px; align-items: start; }
  .lg .lg-top { grid-area: top; } .lg .lg-list { grid-area: list; } .lg .lg-bot { grid-area: bot; }
  .lg .only-d { display: block; } .lg .only-m { display: none; }
}
`;

export function LedgerStyles() {
  return <style dangerouslySetInnerHTML={{ __html: LEDGER_CSS }} />;
}
