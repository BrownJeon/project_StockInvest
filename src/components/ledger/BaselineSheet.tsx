'use client';

/**
 * T-074 — 손익 기준 정하기·바꾸기·현금 확인 시트 (데모 `baseSheet`·`refreshBase`).
 *  - 정하기·바꾸기: 기준 스냅샷 고르기(서버 `baselineOptions` — 오늘 아침 권장·최신·어제 아침) + 기준 시각의 현금 확인(선택).
 *  - 현금 확인: 지금 기준 스냅샷의 원화·달러 현금을 KIS 앱 값으로 확인. 비운 칸은 스냅샷 값(= '기준 미확정').
 *  - 미리보기: 기준 총자산 전→후 · 달러 차이 × 환율 · 원화 차이 · 확인 상태(클라이언트 `baseTotal` — 서버와 같은 정수 산술).
 *  - 충돌 409 version → 최신 기준을 불러오고 [최신 기준 쓰기] / [내 값으로 저장](최신 버전으로 다시 보냄 — 덮어씀).
 * 데모와 다른 점(근거 Stage 2): 현금 확인 시트는 이미 확인한 값을 칸에 채워 연다(데모는 늘 빈 칸 — 그대로 저장하면 확인값이 지워져
 * '기준 미확정'으로 돌아간다). 스냅샷에 달러 현금 행이 없으면 달러 칸을 그리지 않는다(서버가 no_fx 로 거부하는 입력).
 * 현금 0 은 실제 확인값이라 허용(`parseCash`, WP-A 설계 차이 9).
 * 현금 확인 미리보기는 **지금 기준 총자산·지금 확인값**과 비교한다(designer 구현 점검 P2-1 — 스냅샷 값과 비교하면 아무것도 안 바꿔도
 * "→ …" 로 바뀌는 것처럼 읽혔다). 아무것도 안 바꾸면 "(지금과 같음)". 정하기·바꾸기는 새 스냅샷 값과 비교(데모 그대로).
 * 확인값이 스냅샷 값과 후보 탐지 기준 이상 다르면 미리보기 아래에 경고(저장은 막지 않음, QA D-1 — `cashGaps`). 경고가 있으면
 * 미리보기의 '두 값 모두 확인'은 초록 ✓ 대신 중립 ◌, 경고 상자는 aria-live 밖 + 저장 버튼 aria-describedby(designer Stage 6 점검).
 */
import { useCallback, useRef, useState, type ReactNode } from 'react';
import type { BaselineOption, BaselineWriteResponse, Currency, LedgerFeed } from '@/lib/ledger/types';
import { baseTotal, toCents, usdToKrw } from '@/lib/ledger/compute';
import { fmtSignedUsd } from '@/lib/ledger/korean-amount';
import { isUsd, RULE, type LedgerRules } from '@/lib/ledger/rules';
import { parseCash } from '@/lib/ledger/validate';
import { Sheet } from '@/components/ui/Sheet';
import { BusyFoot, ErrBox, failNode, St, type SheetDecision, type SheetErr } from './Parts';
import { createSubmitter, urls, write, type WriteOutcome } from './actions';
import type { SheetFrameProps } from './EntrySheet';
import { isoMin, MINUS, md, n0, rt, swon, usd, won } from './view';

export type BaseMode = 'set' | 'change' | 'confirm';

const TAG_LABEL: Record<BaselineOption['tags'][number], string> = {
  today_morning: '오늘 아침 · 권장', latest: '최신', yesterday_morning: '어제 아침',
};

interface Ref { ts: string; id: number; v: number; krw: number; usd: number | null; fx: number | null }

function refOf(mode: BaseMode, feed: LedgerFeed, snapId: number | null): Ref | null {
  if (mode === 'confirm' && feed.baseline) {
    const B = feed.baseline;
    return { ts: B.at, id: B.snapshotId, v: B.totalKrw, krw: B.krwCash, usd: B.usdCash, fx: B.fx };
  }
  const opts = feed.baselineOptions;
  const o = opts.find((x) => x.id === snapId) ?? opts[0];
  return o ? { ts: o.ts, id: o.id, v: o.totalKrw, krw: o.krwCash ?? 0, usd: o.usdCash, fx: o.fx } : null;
}

/** 확인 칸 해석 — 빈 칸 = null(스냅샷 값) */
export function cashVals(krw: string, usdRaw: string, hasUsd: boolean) {
  const k = parseCash(krw, 'KRW');
  const u = hasUsd ? parseCash(usdRaw, 'USD') : ({ empty: true } as const);
  return {
    k: 'value' in k ? k.value : null,
    u: 'value' in u ? u.value : null,
    kErr: 'error' in k ? k.error.message : null,
    uErr: 'error' in u ? u.error.message : null,
  };
}

/** 지금 기준(현금 확인 시트의 비교 기준점) */
export interface CurrentBase { totalKrw: number; krwCash: number | null; usdCash: number | null }

/**
 * 미리보기 계산 (데모 refreshBase). `cur` 가 없으면(정하기·바꾸기) 스냅샷 값과 비교, 있으면(현금 확인) 지금 기준 총자산·지금 확인값과 비교.
 * 새 총자산은 늘 스냅샷 값에서 정수 산술로 다시 낸다(서버 `baseTotal` 과 같은 함수). 빈 칸 = 스냅샷 값.
 */
export function basePreview(r: Ref, k: number | null, u: number | null, cur?: CurrentBase) {
  const b1 = baseTotal({ totalKrw: r.v, krwCash: r.krw, usdCash: r.usd, fx: r.fx, confirmed: { krwCash: k, usdCash: u, at: null, note: null } });
  const from = cur ? cur.totalKrw : r.v;
  const refK = cur ? cur.krwCash ?? r.krw : r.krw;
  const refU = cur ? cur.usdCash ?? r.usd : r.usd;
  const newK = cur ? k ?? r.krw : k;
  const newU = cur ? u ?? r.usd : u;
  const parts: string[] = [];
  if (newU != null && refU != null && r.fx != null && toCents(newU) !== toCents(refU)) {
    const diff = newU - refU;
    parts.push(`달러 ${diff > 0 ? '+' : MINUS}${usd(diff)} × ${rt(r.fx)}원/$`);
  }
  if (newK != null && Math.round(newK) !== Math.round(refK)) parts.push(`원화 ${swon(newK - refK)}`);
  const unc = k == null || (r.usd != null && u == null);
  return { from, b1, same: b1 === from, parts, unc };
}

/** 확인값과 스냅샷 값의 큰 차이 한 통화분 (QA D-1) */
export interface CashGap { currency: Currency; snap: number; input: number; diff: number; diffKrw: number }

/**
 * QA D-1 — 확인한 현금이 스냅샷 값과 크게 다른가. 기준 총자산만 그 차이만큼 바뀌고 현재 총자산은 스냅샷 값 그대로라,
 * 차이가 이후 모든 손익에 상수로 남는다(스냅샷이 틀린 값을 읽는 경우 가짜 손익). **경고만 하고 저장은 막지 않는다.**
 * 임계는 새 상수 없이 '기록 안 된 입출금 후보' 기준을 그대로 쓴다(RULE.krw 5만원·RULE.usd $50, 같은 '이상' 비교 — candidates.ts).
 * 빈 칸(스냅샷 값 사용)은 차이가 없으므로 경고하지 않는다. 산술은 정수(원·센트), 달러 차이의 원화 환산은 스냅샷 환율(compute.usdToKrw).
 */
export function cashGaps(
  r: { krw: number; usd: number | null; fx: number | null }, k: number | null, u: number | null,
  rules: Pick<LedgerRules, 'krw' | 'usd'> = RULE,
): CashGap[] {
  const out: CashGap[] = [];
  if (k != null) {
    const d = Math.round(k) - Math.round(r.krw);
    if (Math.abs(d) >= rules.krw) out.push({ currency: 'KRW', snap: r.krw, input: k, diff: d, diffKrw: d });
  }
  if (u != null && r.usd != null && r.fx != null) {
    const dc = toCents(u) - toCents(r.usd);
    if (Math.abs(dc) >= Math.round(rules.usd * 100)) {
      out.push({ currency: 'USD', snap: r.usd, input: u, diff: dc / 100, diffKrw: usdToKrw(dc / 100, r.fx) });
    }
  }
  return out;
}

/**
 * 경고 한 줄의 조각 — 이름과 [스냅샷 값, 입력값, 차이]. 화면은 조각마다 줄바꿈을 막는다(360px 에서 '−' 와 '$1,800.00' 이 갈라지던 것 — Stage 6 캡처).
 * 달러 차이의 원화 환산은 천 원 단위로 반올림해 '약'.
 */
export function cashGapParts(g: CashGap): { label: string; parts: [string, string, string] } {
  if (isUsd(g.currency)) {
    return { label: '달러 현금', parts: [`스냅샷 ${usd(g.snap)}`, `입력 ${usd(g.input)}`, `차이 ${fmtSignedUsd(g.diff)}(약 ${swon(Math.round(g.diffKrw / 1000) * 1000)})`] };
  }
  return { label: '원화 현금', parts: [`스냅샷 ${won(g.snap)}`, `입력 ${won(g.input)}`, `차이 ${swon(g.diff)}`] };
}

/** 경고 한 줄 — "달러 현금: 스냅샷 $1,918.60 · 입력 $118.60 · 차이 −$1,800.00(약 −2,383,000원)" */
export function cashGapLine(g: CashGap): string {
  const { label, parts } = cashGapParts(g);
  return `${label}: ${parts.join(' · ')}`;
}

function CashGapRow({ g }: { g: CashGap }) {
  const { label, parts } = cashGapParts(g);
  return (
    <div>
      {label}: {parts.map((t, i) => <span key={i}>{i ? ' · ' : ''}<span style={{ whiteSpace: 'nowrap' }}>{t}</span></span>)}
    </div>
  );
}

export const CASH_GAP_TITLE = '! 확인한 현금이 스냅샷 값과 크게 다릅니다';

/**
 * 경고 끝 문장(designer Stage 6 점검 문구). 손익 영향 = −(통화별 차이의 원화 환산 합): 입력이 스냅샷보다 낮으면 기준 총자산이 낮아져
 * 손익이 '많게', 높으면 '적게' 보인다. 금액은 합계 절댓값을 천 원 단위로 반올림(환산은 `cashGaps` 의 `usdToKrw` 값 그대로).
 * 비워 둘 칸은 이름으로 가리킨다(두 통화 모두면 '두 칸'). 두 차이가 정확히 상쇄되면(합 0) 방향이 없어 금액 문장을 뺀다.
 */
export function cashGapNote(gaps: readonly CashGap[]): string {
  const which = gaps.length > 1 ? '두' : isUsd(gaps[0].currency) ? '달러 현금' : '원화 현금';
  const sum = gaps.reduce((a, g) => a + g.diffKrw, 0);
  const tail = `왜 다른지 모르면 ${which} 칸을 비우고 저장하세요. 확인되면 나중에 넣을 수 있습니다.`;
  if (sum === 0) return `그대로 저장해도 두 차이가 서로 상쇄되어 손익은 바뀌지 않습니다. 다만 두 값 모두 스냅샷과 크게 달라 어느 쪽이 맞는지 확인이 필요합니다. ${tail}`;
  const amount = Math.round(Math.abs(sum) / 1000) * 1000;
  const amt = amount > 0 ? `약 ${won(amount)}` : '1,000원 미만';
  return `그대로 저장할 수 있지만, 그러면 손익이 스냅샷 값으로 계산할 때보다 ${amt} ${sum < 0 ? '많게' : '적게'} 보이고 이 차이가 앞으로도 남습니다. ${tail}`;
}

/** 저장 요청 — 빈 칸 = null(스냅샷 값). 409 version 뒤면 서버의 최신 버전으로(내 값으로 덮어쓰기) */
export function baselineRequest(r: { id: number }, krw: string, usdRaw: string, hasUsd: boolean, currentVersion: number, err: SheetErr | null) {
  return {
    snapshotId: r.id,
    confirmed: { krwCash: krw.trim() === '' ? null : krw, usdCash: !hasUsd || usdRaw.trim() === '' ? null : usdRaw },
    baseVersion: Math.max(currentVersion, err?.kind === 'baseConflict' ? err.latestVersion ?? 0 : 0),
  };
}

export function decideBaselineOutcome(out: WriteOutcome<BaselineWriteResponse>): SheetDecision {
  if (out.kind === 'ok') {
    const nb = out.body.baseline;
    return { type: 'done', data: out.body.data, toast: <><St kind="ok" icon="✓">기준을 저장했습니다 (버전 {nb.version})</St> 기준 총자산 {won(nb.baselineTotalKrw)}{nb.unconfirmed ? ' · 기준 미확정' : ''}</> };
  }
  if (out.kind === 'versionConflict') {
    const lv = out.latest?.version ?? null;
    return {
      type: 'err', feed: out.data, refresh: !out.data,
      err: {
        kind: 'baseConflict', latestVersion: lv,
        node: <><St kind="warn" icon="!">저장하지 않았습니다 — 다른 기기에서 기준이 먼저 바뀌었습니다{lv != null ? `(버전 ${lv})` : ''}</St><br />최신 기준을 불러왔습니다. 입력한 값은 그대로 있으니 확인 뒤 다시 저장하면 덮어씁니다.</>,
      },
    };
  }
  if (out.kind === 'invalid') return { type: 'err', feed: null, refresh: false, err: { kind: 'fail', node: failNode(out.message, false) } };
  if (out.kind === 'fail') return { type: 'err', feed: null, refresh: false, err: { kind: 'fail', node: failNode(out.reason, false) } };
  const data = 'data' in out ? out.data : null;
  return { type: 'err', feed: data, refresh: !data, err: { kind: 'fail', node: failNode(out.message || '저장하지 못했습니다', false) } };
}

export function BaselineSheet(p: {
  feed: LedgerFeed;
  mode: BaseMode;
  frame: SheetFrameProps;
  onClose: () => void;
  onDone: (data: LedgerFeed, toast: ReactNode) => void;
  onFeed: (data: LedgerFeed) => void;
  onRefresh: () => void;
  /** 시험·미리보기용 초기 상태 */
  initialState?: { err?: SheetErr | null; saving?: boolean; krw?: string; usd?: string };
  writeImpl?: typeof write;
}) {
  const { feed, mode } = p;
  const B = feed.baseline;
  const [snapId, setSnapId] = useState<number | null>(feed.baselineOptions[0]?.id ?? null);
  const cf = mode === 'confirm' && B ? B.confirmed : null;
  const [krw, setKrw] = useState(p.initialState?.krw ?? (cf?.krwCash != null ? String(cf.krwCash) : ''));
  const [usdIn, setUsdIn] = useState(p.initialState?.usd ?? (cf?.usdCash != null ? String(cf.usdCash) : ''));
  const [saving, setSaving] = useState(!!p.initialState?.saving);
  const sub = useRef(createSubmitter()).current;
  const [err, setErr] = useState<SheetErr | null>(p.initialState?.err ?? null);
  const [focusReq, setFocusReq] = useState<{ id: string; seq: number } | null>(null);
  const focusTo = useCallback((id: string) => setFocusReq((f) => ({ id, seq: (f?.seq ?? 0) + 1 })), []);

  const r = refOf(mode, feed, snapId);
  const hasUsd = !!r && r.usd != null && r.fx != null;
  const cv = cashVals(krw, usdIn, hasUsd);
  const errs = (cv.kErr ? 1 : 0) + (cv.uErr ? 1 : 0);
  const cur: CurrentBase | undefined = mode === 'confirm' && B
    ? { totalKrw: B.baselineTotalKrw, krwCash: B.confirmed.krwCash, usdCash: B.confirmed.usdCash }
    : undefined;
  const pv = r ? basePreview(r, cv.k, cv.u, cur) : null;
  const gaps = r ? cashGaps(r, cv.k, hasUsd ? cv.u : null, feed.rules) : [];
  const title = mode === 'set' ? '기준 정하기' : mode === 'change' ? '기준 바꾸기' : '기준 현금 확인';
  const close = () => { if (!sub.busy && !saving) p.onClose(); };

  const commit = async () => {
    if (sub.busy || errs > 0 || !r) return;
    const body = baselineRequest(r, krw, usdIn, hasUsd, B?.version ?? 0, err);
    setSaving(true); focusTo('sh-primary');
    const out = await sub.run(() => (p.writeImpl ?? write)<BaselineWriteResponse>('PUT', urls.baseline(), body));
    if (out === null) return;
    setSaving(false);
    const dec = decideBaselineOutcome(out);
    if (dec.type === 'done') { p.onDone(dec.data, dec.toast); return; }
    if (dec.feed) p.onFeed(dec.feed); else if (dec.refresh) p.onRefresh();
    setErr(dec.err);
    focusTo('sh-primary');
  };

  const takeServer = () => {
    const v = feed.baseline?.version ?? err?.latestVersion;
    p.onDone(feed, <St kind="ok" icon="✓">최신 기준(버전 {v ?? '—'})을 그대로 씁니다.</St>);
  };

  const why = errs ? '금액 형식을 고쳐 주세요.' : '';
  // 차이 경고는 live 영역 밖에 두고(입력마다 다시 낭독하지 않게) 저장 버튼 설명으로만 잇는다(designer Stage 6 점검)
  const gapDesc = gaps.length > 0 ? 'sh-bgap' : undefined;
  const foot = saving ? <BusyFoot label="저장 중…" />
    : err?.kind === 'baseConflict' ? (
      <div className="btns">
        <button type="button" className="btn sec" id="sh-take" onClick={takeServer}>최신 기준 쓰기</button>
        <button type="button" className="btn pri" id="sh-primary" aria-describedby={gapDesc} onClick={commit}>내 값으로 저장</button>
      </div>
    ) : (
      <>
        <div className="sh-why" id="sh-why" aria-live="polite">{why}</div>
        <div className="btns">
          <button type="button" className="btn sec" onClick={close}>닫기</button>
          <button type="button" className="btn pri" id="sh-primary" disabled={errs > 0 || !r} aria-describedby={gapDesc} onClick={commit}>{err ? '다시 시도' : '기준 저장'}</button>
        </div>
      </>
    );

  return (
    <Sheet
      title={title} onClose={close} busy={saving} className="lg" initialFocus="title" focusRequest={focusReq}
      returnFocusIds={p.frame.returnFocusIds} onAfterClose={p.frame.onAfterClose} footer={foot}
    >
      <ErrBox err={err} />
      {mode !== 'confirm' && (
        <>
          <p className="csub">이 시각부터 손익을 셉니다. 이 시각의 총자산이 ‘기준 총자산’이 되고, 그 뒤에 넣고 뺀 돈만 기록합니다.</p>
          {mode === 'change' && B && (
            <div className="warnbox" role="note">
              <b>! 기준을 바꾸면 새 기준 이전 기록은 계산에서 빠집니다(지우지 않음).</b> 지금 기준({isoMin(B.at)}, 버전 {B.version})은 이력으로 남습니다. 살아 있는 기록 {feed.entries.filter((e) => !e.void).length}건 중 새 기준 이전 기록은 ‘기준 이전 · 계산 제외’로 표시됩니다.
            </div>
          )}
          <fieldset className="kseg list">
            <legend>기준 스냅샷</legend>
            <div className="opts">
              {feed.baselineOptions.map((o) => (
                <label key={o.id}>
                  <input type="radio" name="sh-bsnap" id={`sh-b-${o.id}`} value={o.id} checked={(r?.id ?? null) === o.id} onChange={() => setSnapId(o.id)} />
                  <span>
                    <span className="ln"><b>{md(o.ts)}</b><span className="muted">{o.tags.map((t) => TAG_LABEL[t]).join(' · ')}</span></span>
                    <span className="ln"><span>총자산 {won(o.totalKrw)}</span><span className="muted">#{o.id}</span></span>
                  </span>
                </label>
              ))}
            </div>
            <div className="hint">아침 07~09시 스냅샷을 권장합니다. 밤 스냅샷에는 일부 달러 현금이 빠져 보일 때가 있습니다.</div>
          </fieldset>
        </>
      )}
      {r && (
        <fieldset className="kseg field">
          <legend>기준 시각의 현금 확인 {mode === 'confirm' ? '' : <span className="muted" style={{ fontWeight: 400 }}>(선택)</span>}</legend>
          <p className="csub" style={{ fontSize: 12, margin: '0 0 8px' }}>KIS 앱에서 본 값을 넣습니다. 기준 시각 뒤 입출금·매매가 없었다면 지금 보이는 값과 같습니다. 비워 두면 스냅샷 값을 쓰고 ‘기준 미확정’으로 표시합니다.</p>
          <div className="field">
            <label className="fl" htmlFor="sh-bkrw">원화 현금</label>
            <div className={`inwrap${cv.kErr ? ' bad' : ''}`}>
              <span className="cur" aria-hidden="true">₩</span>
              <input id="sh-bkrw" type="text" inputMode="numeric" autoComplete="off" value={krw} placeholder={n0(r.krw)} aria-describedby="sh-bkrw-h sh-bkrw-m" aria-invalid={cv.kErr ? 'true' : 'false'} onChange={(ev) => setKrw(ev.target.value)} />
              <span className="unit" aria-hidden="true">원</span>
            </div>
            <div className="hint" id="sh-bkrw-h">스냅샷 값 {won(r.krw)} · KIS 앱 ‘원화 예수금’ 기준. 확실하지 않으면 비워 두세요.</div>
            <div className="msgs" id="sh-bkrw-m">{cv.kErr && <St kind="warn" icon="!">{cv.kErr}</St>}</div>
          </div>
          {hasUsd && (
            <div className="field" style={{ marginTop: 10 }}>
              <label className="fl" htmlFor="sh-busd">달러 현금</label>
              <div className={`inwrap${cv.uErr ? ' bad' : ''}`}>
                <span className="cur" aria-hidden="true">$</span>
                <input id="sh-busd" type="text" inputMode="decimal" autoComplete="off" value={usdIn} placeholder={(r.usd as number).toFixed(2)} aria-describedby="sh-busd-h sh-busd-m" aria-invalid={cv.uErr ? 'true' : 'false'} onChange={(ev) => setUsdIn(ev.target.value)} />
                <span className="unit" aria-hidden="true">달러</span>
              </div>
              <div className="hint" id="sh-busd-h">스냅샷 값 {usd(r.usd as number)} · KIS 앱 <b>‘외화예수금’</b> 기준(‘주문가능금액’은 미체결 주문에 묶인 돈이 빠져 더 작을 수 있음). 확실하지 않으면 비워 두세요.</div>
              <div className="msgs" id="sh-busd-m">{cv.uErr && <St kind="warn" icon="!">{cv.uErr}</St>}</div>
            </div>
          )}
        </fieldset>
      )}
      <div id="sh-bprev" aria-live="polite">
        {r && pv && (
          <div className="impact">
            기준 총자산 <b>{won(pv.from)}{pv.same ? '' : ` → ${won(pv.b1)}`}</b>{cur && pv.same ? ' (지금과 같음)' : ''}
            {pv.parts.length > 0 && <><br /><span className="muted">{pv.parts.join(' · ')}</span></>}
            <br />
            {pv.unc ? <St kind="warn" icon="!">비운 칸은 스냅샷 값 — 저장하면 ‘기준 미확정’</St>
              : gaps.length > 0 ? <St kind="na" icon="◌">두 값 모두 확인 — 저장하면 ‘현금 확인됨’</St>
                : <St kind="ok" icon="✓">두 값 모두 확인 — 저장하면 ‘현금 확인됨’</St>}
          </div>
        )}
      </div>
      {gaps.length > 0 && (
        <div className="warnbox" role="note" id="sh-bgap">
          <b>{CASH_GAP_TITLE}</b>
          {gaps.map((g) => <CashGapRow key={g.currency} g={g} />)}
          <div>{cashGapNote(gaps)}</div>
        </div>
      )}
    </Sheet>
  );
}
