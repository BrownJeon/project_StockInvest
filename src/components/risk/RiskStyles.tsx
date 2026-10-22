/**
 * T-066 리스크 정책 화면 스타일 — 승인 데모 v3 의 앱 화면 CSS 를 그대로 옮기고 `.rp` 범위로 가뒀다.
 * (데모의 container query 는 실제 구현에서 `@media (min-width: 900px)` 로 바꾼다 — 데모 주석대로.)
 * 위험·초과·오류는 amber(--warn) + 기호 + 글자. 빨강/파랑(--up/--down)은 손익 뜻이라 쓰지 않는다.
 */
export const RISK_CSS = `
.rp code { font-size: 12px; background: var(--bg3); padding: 1px 4px; border-radius: 4px; overflow-wrap: anywhere; }
.rp .sr { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
.rp :focus-visible { outline: 2px solid var(--text); outline-offset: 2px; }
.rp button:disabled { cursor: not-allowed; }
.rp .app-body { padding: 12px 16px; display: flex; flex-direction: column; gap: 12px; }
.rp .chev { font-size: 18px; color: var(--muted); flex-shrink: 0; }

.rp .mode { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 6px; white-space: nowrap; line-height: 1.5; }
.rp .mode.live { color: var(--ok); border: 1px solid rgba(34,197,94,.55); background: rgba(34,197,94,.10); }
.rp .mode.disp { color: var(--muted); border: 1px dashed var(--muted); }
.rp .strip { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 8px 16px; border-bottom: 1px solid var(--border); font-size: 12px; color: var(--muted); line-height: 1.5; }
.rp .strip b { color: var(--text); }

.rp .st { display: inline-flex; align-items: baseline; gap: 4px; font-size: 12px; font-weight: 700; line-height: 1.45; }
.rp .st i { font-style: normal; display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; border-radius: 4px; font-size: 11px; flex-shrink: 0; transform: translateY(2px); }
.rp .st.warn { color: var(--warn); } .rp .st.warn i { background: rgba(245,158,11,.18); }
.rp .st.ok { color: var(--ok); } .rp .st.ok i { background: rgba(34,197,94,.16); }
.rp .st.na { color: var(--muted); font-weight: 600; } .rp .st.na i { background: var(--bg3); }
.rp .st.info { color: var(--text); font-weight: 600; } .rp .st.info i { background: var(--bg4); }
.rp .src { display: inline-flex; align-items: center; gap: 3px; font-size: 11px; font-weight: 700; padding: 1px 6px; border-radius: 6px; white-space: nowrap; line-height: 1.5; }
.rp .src.user { color: var(--ok); border: 1px solid rgba(34,197,94,.55); }
.rp .src.prop { color: var(--warn); border: 1px dashed rgba(245,158,11,.75); }
.rp .src.doc { color: var(--muted); border: 1px solid var(--border2); }

.rp .rk-sum { padding: 12px 16px; display: flex; flex-direction: column; gap: 6px; font-size: 13px; line-height: 1.5; }
.rp .rk-sum .l1 { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.rp .rk-body { display: flex; flex-direction: column; gap: 14px; }
.rp .rk-col { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
.rp .subh { margin: 0; font-size: 13px; font-weight: 700; }
.rp .subh small { display: block; font-weight: 400; font-size: 12px; color: var(--muted); margin-top: 2px; }

.rp .bar { position: relative; height: 12px; border-radius: 6px; background: var(--bg3); margin: 10px 0 6px; overflow: hidden; border: 1px solid var(--border2); }
.rp .bar .fill { position: absolute; left: 0; top: 0; bottom: 0; }
.rp .bar .fill.okc { background: var(--ok); } .rp .bar .fill.warnc { background: var(--warn); }
.rp .bar-scale { display: flex; justify-content: space-between; font-size: 11px; color: var(--muted); }
.rp .pv { font-size: 11px; font-weight: 700; padding: 1px 6px; border-radius: 6px; border: 1px dashed var(--muted); color: var(--muted); }
.rp .pv.saved { border-style: solid; border-color: var(--border2); color: var(--muted); }
.rp .warnbox { padding: 10px 12px; border-radius: 8px; background: rgba(245,158,11,.10); border: 1px solid rgba(245,158,11,.40); font-size: 12px; line-height: 1.6; }
.rp .warnbox b { color: var(--warn); }
.rp .infobox { display: flex; gap: 8px; padding: 10px 12px; border-radius: 8px; background: var(--bg3); border: 1px solid var(--border2); font-size: 12px; line-height: 1.6; }
.rp .infobox .ic { flex-shrink: 0; font-weight: 700; color: var(--muted); }

.rp .inwrap { flex: 1; min-width: 0; display: flex; align-items: center; background: var(--bg3); border: 1px solid var(--border2); border-radius: 8px; min-height: 44px; padding: 0 10px; }
.rp .inwrap:focus-within { border-color: var(--accent); }
.rp .inwrap.bad { border-color: var(--warn); border-width: 2px; }
.rp .inwrap input { flex: 1; min-width: 0; background: none; border: 0; color: var(--text); font-size: 15px; font-weight: 700; font-variant-numeric: tabular-nums; outline: none; padding: 0; min-height: 42px; align-self: stretch; text-align: right; font-family: inherit; }
.rp .inwrap input:disabled { opacity: .6; }
.rp .inwrap .unit { color: var(--muted); font-size: 13px; margin-left: 6px; flex-shrink: 0; }

.rp .savebar { position: sticky; bottom: calc(8px + var(--nav-h) + var(--safe-bottom)); z-index: 5; display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; border-radius: 10px; background: #1b1f27; border: 1px solid rgba(245,158,11,.45); box-shadow: 0 4px 16px rgba(0,0,0,.45); }
.rp .savebar.err { border-color: rgba(245,158,11,.8); }
.rp .savebar.done { border-color: rgba(34,197,94,.45); }
.rp .savebar .msg { font-size: 12px; font-weight: 600; line-height: 1.5; }
.rp .savebar .sub { font-size: 11px; color: var(--muted); line-height: 1.5; }
.rp .savebar .btns { display: flex; gap: 8px; justify-content: flex-end; }
.rp .btn { min-height: 44px; padding: 0 16px; border-radius: 8px; font-size: 13px; font-weight: 700; }
.rp .btn.pri { background: var(--accent); color: #000; }
.rp .btn.sec { border: 1px solid var(--border2); color: var(--text); }
.rp .btn:disabled { opacity: .45; }

.rp table.pol { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 13px; border: 1px solid var(--border); border-radius: 10px; }
.rp table.pol caption { text-align: left; padding: 0 0 8px; font-size: 13px; font-weight: 700; }
.rp table.pol caption small { display: block; font-size: 12px; font-weight: 400; color: var(--muted); margin-top: 2px; }
.rp table.pol th, .rp table.pol td { padding: 9px 8px; border-top: 1px solid var(--border); vertical-align: top; text-align: left; line-height: 1.5; overflow-wrap: anywhere; }
.rp table.pol thead th { font-size: 11px; font-weight: 700; color: var(--muted); }
.rp table.pol .grp th { background: var(--bg3); font-size: 12px; font-weight: 700; color: var(--muted); padding-top: 5px; padding-bottom: 5px; }
.rp table.pol .name { font-size: 13px; font-weight: 600; margin-bottom: 4px; }
.rp table.pol .v { font-weight: 700; }
.rp table.pol .v small, .rp table.pol .cur small { display: block; font-weight: 400; font-size: 12px; color: var(--muted); }
.rp col.c-name { width: 34%; } .rp col.c-val { width: 30%; } .rp col.c-cur { width: 36%; }
.rp .ro-foot { font-size: 12px; color: var(--muted); line-height: 1.6; margin: 0; }
.rp .ro-foot b { color: var(--text); }

.rp .skel { background: var(--bg3); border-radius: 6px; height: 14px; margin: 8px 0; }
.rp .skel.m { width: 70%; } .rp .skel.s { width: 45%; }

.rp .rp-head { display: flex; align-items: center; gap: 8px; padding: calc(8px + var(--safe-top)) 8px 8px; border-bottom: 1px solid var(--border); }
.rp .back { display: inline-flex; align-items: center; min-height: 44px; min-width: 44px; padding: 0 8px; font-size: 14px; color: var(--muted); border-radius: 8px; }
.rp .rp-head h2 { margin: 0; font-size: 16px; font-weight: 700; flex: 1; min-width: 0; }
.rp .rp-head .mode { margin-right: 8px; }
.rp.riskrow, .rp .riskrow { display: block; background: var(--bg2); border: 1px dashed var(--border2); border-radius: 12px; overflow: hidden; }
.rp .riskrow .top { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 16px 0; }
.rp .riskrow .top b { font-size: 14px; }
.rp .riskrow .go { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 44px; padding: 8px 16px; border-top: 1px solid var(--border); font-size: 13px; font-weight: 600; color: var(--accent); }
.rp .fresh { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; font-size: 12px; color: var(--muted); line-height: 1.5; }
.rp .fresh .dot { font-weight: 700; }
.rp .fresh .dot.live { color: var(--ok); } .rp .fresh .dot.busy { color: var(--muted); } .rp .fresh .dot.warn { color: var(--warn); }
.rp .sync .line { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }

.rp .setcard { border: 1px solid var(--border2); border-radius: 10px; padding: 12px; display: flex; flex-direction: column; gap: 14px; background: var(--bg2); }
.rp .setcard h4 { margin: 0; font-size: 13px; font-weight: 700; display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.rp .setcard h4 .ver { font-size: 11px; font-weight: 400; color: var(--muted); }
.rp .field .fl { display: block; font-size: 13px; font-weight: 600; margin-bottom: 4px; }
.rp .field .hint { font-size: 12px; color: var(--muted); margin-top: 4px; line-height: 1.5; }
.rp .field .inwrap { max-width: 220px; }
.rp .field .msgs { margin-top: 4px; display: flex; flex-direction: column; gap: 2px; }
.rp .seg2 { display: flex; gap: 6px; flex-wrap: wrap; border: 0; padding: 0; margin: 0; min-width: 0; }
.rp .seg2 legend { font-size: 13px; font-weight: 600; margin-bottom: 4px; padding: 0; }
.rp .seg2 label { flex: 1 1 140px; position: relative; min-width: 0; }
.rp .seg2 input { position: absolute; opacity: 0; width: 1px; height: 1px; }
.rp .seg2 span { display: flex; flex-direction: column; justify-content: center; min-height: 52px; padding: 6px 10px; border-radius: 8px; border: 1px solid var(--border2); background: var(--bg3); font-size: 13px; font-weight: 600; line-height: 1.35; cursor: pointer; }
.rp .seg2 span small { font-weight: 400; font-size: 11px; color: var(--muted); }
.rp .seg2 input:checked + span { border: 2px solid var(--accent); background: rgba(245,158,11,.10); }
.rp .seg2 input:focus-visible + span { outline: 2px solid var(--text); outline-offset: 2px; }
.rp .seg2 input:disabled + span { opacity: .5; cursor: not-allowed; }
.rp .res { border: 1px solid var(--border); border-radius: 10px; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.rp .res .head { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.rp .res .big { font-size: 22px; font-weight: 800; }
.rp .res p { margin: 0; font-size: 13px; line-height: 1.6; }
.rp .inv { font-size: 13px; padding: 8px 10px; border-radius: 8px; background: var(--bg3); border: 1px solid var(--border2); line-height: 1.6; }
.rp .inv .eq { color: var(--muted); font-size: 12px; }
.rp .hlist { display: flex; flex-direction: column; border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
.rp .hrow { padding: 10px 12px; border-bottom: 1px solid var(--border); }
.rp .hrow:last-child { border-bottom: 0; }
.rp .hrow.below { background: rgba(245,158,11,.06); }
.rp .hrow .t { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.rp .hrow .t b { font-size: 14px; }
.rp .hrow .t .mk { font-size: 12px; color: var(--muted); margin-left: 6px; }
.rp .hrow dl { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px 8px; margin: 8px 0 0; }
.rp .hrow dt { font-size: 11px; color: var(--muted); }
.rp .hrow dd { margin: 0; font-size: 13px; font-weight: 700; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.rp .hrow dd small { display: block; font-weight: 400; font-size: 11px; color: var(--muted); }
.rp .hrow .why { margin-top: 6px; font-size: 12px; line-height: 1.5; }
.rp table.hold { width: 100%; border-collapse: collapse; font-size: 13px; border: 1px solid var(--border); }
.rp table.hold caption { text-align: left; padding: 0 0 8px; font-size: 13px; font-weight: 700; }
.rp table.hold th, .rp table.hold td { padding: 8px; border-top: 1px solid var(--border); text-align: right; vertical-align: top; font-variant-numeric: tabular-nums; line-height: 1.45; }
.rp table.hold th:first-child, .rp table.hold td:first-child, .rp table.hold td.l, .rp table.hold th.l { text-align: left; }
.rp table.hold thead th { font-size: 11px; color: var(--muted); font-weight: 700; }
.rp table.hold td small { display: block; font-size: 11px; color: var(--muted); }
.rp table.hold tr.below td { background: rgba(245,158,11,.06); }
.rp .only-d { display: none; }

/* T-068 데모 v5 — 배지가 길어져 412·360px 에서 줄바꿈 허용 */
.rp .rp-head { flex-wrap: wrap; row-gap: 4px; }
.rp .rp-head h2 { flex: 1 0 auto; white-space: nowrap; }
.rp .rp-head .mode { margin-left: 8px; }
.rp .riskrow .top { flex-wrap: wrap; row-gap: 4px; }
.rp .riskrow .top b { flex: 1 0 auto; white-space: nowrap; }
.rp .mode.disp { white-space: normal; }

/* T-068 데모 v5 — 손절가 도달 알림 안내 + 텔레그램 메시지 예시 */
.rp .alertbox { border: 1px solid var(--border2); border-radius: 10px; padding: 12px; display: flex; flex-direction: column; gap: 10px; }
.rp .alertbox h4 { margin: 0; font-size: 13px; font-weight: 700; display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.rp .alertbox ul { margin: 0; padding-left: 18px; font-size: 13px; line-height: 1.6; }
.rp .alertbox ul li { margin-bottom: 2px; }
.rp .alertbox .now { font-size: 12px; line-height: 1.6; padding: 8px 10px; border-radius: 8px; background: var(--bg3); border: 1px solid var(--border2); }
.rp .tgprev { display: flex; flex-direction: column; gap: 6px; }
.rp .tgprev .cap { font-size: 11px; color: var(--muted); }
.rp .bubble { max-width: 340px; background: var(--bg4); border: 1px solid var(--border2); border-radius: 4px 12px 12px 12px; padding: 10px 12px; font-size: 13px; line-height: 1.55; }
.rp .bubble .bt { font-weight: 700; margin-bottom: 4px; }
/* 말풍선 본문은 실제 발송 문구(formatStopAlert) 줄 그대로 — 데모의 dl 2열 대신 줄 단위 (Leader 결정 10-22) */
.rp .bubble .ln { font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.rp .bubble .foot { margin-top: 6px; font-weight: 600; }
.rp .bubble .tm { display: block; text-align: right; font-size: 11px; color: var(--muted); margin-top: 4px; }

/* T-068 데모 v5 — 분할 매수 행 '집행 중인 제한' */
.rp .exl { display: flex; flex-direction: column; gap: 6px; }
.rp .exl > small:first-child { margin: 0; }

@media (min-width: 900px) {
  .rp .app-body { padding: 20px 24px; }
  .rp .rk-body { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); gap: 20px; align-items: start; }
  .rp .only-d { display: block; }
  .rp .only-m { display: none; }
}
`;

export function RiskStyles() {
  return <style dangerouslySetInnerHTML={{ __html: RISK_CSS }} />;
}
