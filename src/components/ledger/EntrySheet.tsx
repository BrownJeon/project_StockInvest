'use client';

/**
 * T-074 — 기록 추가·정정 시트 (데모 `entryForm` → `entryConfirm`, 2단계).
 *
 * 폼: 종류(라디오, 부호 입력 없음) · 발생 날짜·시각(기준 뒤만 — `min`·차단 상자) · 금액(만 단위 읽기) 또는 환전 양쪽 금액(적용 환율·비용 추정) ·
 *     경고(큰 금액·24시간 같은 금액·환율 차이) · 메모. 검증은 서버와 같은 `validateEntryInput`.
 * 확인: "들어온/빠져나간" 문장 · 반영 예측과 손익 전→후(클라이언트 `compute.ts` — 서버와 같은 함수) · "두 번 눌러도 한 번".
 * 저장: clientEntryId(폼을 열 때 만든 `draft.cid`)를 다시 시도에도 그대로 보낸다. 응답별 상태 — 저장 중 · 실패(500·네트워크, 입력 유지) ·
 *       충돌(409 baseline_version → 새 기준으로 다시 기록) · 다른 기기에서 먼저 처리(409 already_voided → 닫기) · 중복(409 duplicate).
 * 닫을 때 폼 단계였으면 초안을 돌려준다(페이지가 보관 → 다시 열면 "이어서 씁니다").
 */
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import type { EntryKind, EntryWriteResponse, LedgerFeed } from '@/lib/ledger/types';
import { isUsd } from '@/lib/ledger/rules';
import { usdToKrw } from '@/lib/ledger/compute';
import { parseAmount } from '@/lib/ledger/validate';
import { formatKstMinute, instantToWallMs } from '@/lib/ledger/kst';
import { krRead } from '@/lib/ledger/korean-amount';
import { Sheet } from '@/components/ui/Sheet';
import { BusyFoot, ErrBox, failNode, St, WarnList, type SheetDecision, type SheetErr } from './Parts';
import {
  fromCurrency, previewEntry, switchDir, toCurrency, toRequest, validateDraft, whyText, type EntryDraft,
} from './entry-draft';
import { createSubmitter, urls, write, type WriteOutcome } from './actions';
import { amtOf, candidateDelta, entryOne, hm, KIND, md, rt, spct, swon, usd, won } from './view';

export interface SheetFrameProps {
  returnFocusIds: () => readonly (string | null | undefined)[];
  onAfterClose: () => void;
}

const KIND_ID: Record<EntryKind, string> = { deposit: 'dep', withdrawal: 'wd', exchange: 'exch' };

function nowWall(): number {
  return instantToWallMs(Date.now());
}

function ReadLine({ ccy, raw, fx }: { ccy: 'KRW' | 'USD'; raw: string; fx: number | null }) {
  const p = parseAmount(raw, ccy);
  if (!('value' in p)) return null;
  if (isUsd(ccy)) {
    return (
      <>= <b>{usd(p.value)}</b>{fx != null && <> <span className="muted">· 참고 ≈ {won(usdToKrw(p.value, fx))}(앱 환율 {rt(fx)}, 반영되면 그 시각 환율로 다시 환산)</span></>}</>
    );
  }
  return <>= <b>{won(p.value)}</b> <span className="muted">· {krRead(p.value)}</span></>;
}

function MoneyField(p: {
  k: 'amt' | 'from' | 'to'; label: string; ccy: 'KRW' | 'USD'; value: string; error: string | null; fx: number | null;
  onChange: (v: string) => void;
}) {
  const bad = !!p.error && p.value !== '';
  const usdC = isUsd(p.ccy);
  return (
    <div className="field">
      <label className="fl" htmlFor={`sh-${p.k}`}>{p.label}</label>
      <div className={`inwrap${bad ? ' bad' : ''}`} id={`sh-w-${p.k}`}>
        <span className="cur" aria-hidden="true">{usdC ? '$' : '₩'}</span>
        <input
          id={`sh-${p.k}`} type="text" inputMode={usdC ? 'decimal' : 'numeric'} autoComplete="off" enterKeyHint="done"
          value={p.value} placeholder={usdC ? '0.00' : '0'} aria-describedby={`sh-${p.k}-r sh-${p.k}-m`} aria-invalid={bad ? 'true' : 'false'}
          onChange={(ev) => p.onChange(ev.target.value)}
        />
        <span className="unit" aria-hidden="true">{usdC ? '달러' : '원'}</span>
      </div>
      <div className="read" id={`sh-${p.k}-r`} aria-live="polite"><ReadLine ccy={p.ccy} raw={p.value} fx={p.fx} /></div>
      <div className="msgs" id={`sh-${p.k}-m`}>{bad && <St kind="warn" icon="!">{p.error}</St>}</div>
    </div>
  );
}

/** 저장 요청 — 정정이면 correct 경로. 기준 버전은 409 baseline_version 뒤면 서버의 최신 버전(새 기준으로 다시 기록) */
export function entryRequest(d: EntryDraft, feed: Pick<LedgerFeed, 'baseline'>, err: SheetErr | null) {
  if (!feed.baseline) return null;
  const baseVersion = Math.max(feed.baseline.version, err?.kind === 'conflict' ? err.latestVersion ?? 0 : 0);
  return {
    url: d.mode === 'correct' ? urls.correct(d.target as number) : urls.entries(),
    body: toRequest(d, baseVersion),
  };
}

/**
 * 기록 시트의 결과 — 공용 결정에 하나를 더한다: 'stale' = 같은 요청 번호(clientEntryId)로 이미 다른 내용이 저장됨(409 client_entry_conflict).
 * 이때는 같은 입력을 새 번호로 다시 보내게 두지 않는다(먼저 저장된 기록과 이중 기록될 위험) — 시트를 닫고 목록을 새로 읽어 저장된 기록을 보인다.
 */
/** '#17로' / '#13으로' — 숫자 끝자리 읽기(영·삼·육은 받침 → '으로', 일·칠·팔은 ㄹ 받침 → '로', 나머지는 받침 없음 → '로') */
export function idWithRo(id: number): string {
  return `#${id}${/[036]$/.test(String(id)) ? '으로' : '로'}`;
}

/**
 * M1 충돌(409 client_entry_conflict) 토스트 — designer Stage 6 점검 문구. 저장된 기록 번호는 서버 응답 `existingId` 로 보간한다.
 * 번호가 없으면(비정상 응답) 펼칠 기록이 없으므로 '펼쳐 두었습니다' 대신 목록 확인을 안내한다.
 */
export function clientConflictToast(existingId: number | null): ReactNode {
  return existingId != null
    ? <><St kind="warn" icon="!">방금 고친 값은 저장되지 않았습니다.</St> 먼저 보낸 내용이 이미 {idWithRo(existingId)} 저장되어 있어 펼쳐 두었습니다. 다르면 정정해 주세요.</>
    : <><St kind="warn" icon="!">방금 고친 값은 저장되지 않았습니다.</St> 먼저 보낸 내용이 이미 저장되어 있습니다. 목록에서 확인하고 다르면 정정해 주세요.</>;
}

export type EntryDecision = SheetDecision | { type: 'stale'; data: LedgerFeed | null; existingId: number | null; toast: ReactNode };

/** 저장 응답 → 시트 처리 (데모 `success`·`conflict`·`commit` 의 결과별 문구) */
export function decideEntryOutcome(
  out: WriteOutcome<EntryWriteResponse>,
  ctx: { correct: boolean; target: number | null; beforeP: number | null },
): EntryDecision {
  if (out.kind === 'clientConflict') {
    return { type: 'stale', data: out.data, existingId: out.existingId, toast: clientConflictToast(out.existingId) };
  }
  if (out.kind === 'ok') {
    const r = out.body;
    const a = r.entry.anchor;
    const c1 = r.data.summary?.P;
    const pl = ctx.beforeP != null && c1 != null ? ` 손익 ${swon(ctx.beforeP)} → ${swon(c1)}` : '';
    const tail = a.status === 'matched' ? `${md(a.snapshotTs)} 스냅샷과 맞아 바로 반영했습니다.${pl}`
      : a.status === 'pending' ? `다음 스냅샷에서 반영 여부를 확인합니다.${ctx.correct ? pl : ''}`
        // P2-2: 환전 불일치는 '확인 전'(손익 영향 없음)
        : r.entry.kind === 'exchange' ? '맞는 스냅샷 변화를 찾지 못해 ‘확인 전’으로 표시했습니다(손익 영향 없음).'
          : `맞는 현금 변화를 찾지 못해 ‘불일치’로 표시했고, 기록대로 계산에 넣었습니다.${pl}`;
    return { type: 'done', data: r.data, toast: <><St kind="ok" icon="✓">{ctx.correct ? '정정했습니다' : '기록했습니다'} (#{r.entry.id})</St> {tail}</> };
  }
  if (out.kind === 'dup') {
    return {
      type: 'err', feed: null, refresh: false,
      err: {
        kind: 'dup',
        node: <><St kind="warn" icon="!">기록하지 않았습니다 — 같은 종류·통화·금액·시각(분)의 기록이 이미 있습니다{out.existingId != null ? `(#${out.existingId})` : ''}</St><br />같은 돈이면 더 넣지 않아도 됩니다. 다른 돈이면 시각을 1분 이상 다르게 넣으세요.</>,
      },
    };
  }
  if (out.kind === 'baseConflict') {
    return {
      type: 'err', feed: null, refresh: true,
      err: {
        kind: 'conflict', latestVersion: out.latestVersion,
        node: <><St kind="warn" icon="!">기록하지 않았습니다 — 다른 기기에서 기준이 먼저 바뀌었습니다{out.latestVersion != null ? `(버전 ${out.latestVersion})` : ''}</St><br />입력은 그대로 있습니다. 새 기준으로 아래 내용을 다시 확인한 뒤 기록하세요.</>,
      },
    };
  }
  if (out.kind === 'handledElsewhere') {
    const now = out.data?.entries.find((e) => e.id === ctx.target);
    const word = now?.void?.type === 'super' ? '정정됐습니다' : '취소됐습니다';
    return {
      type: 'err', feed: out.data, refresh: !out.data,
      err: {
        kind: 'conflictClose',
        node: <><St kind="warn" icon="!">정정하지 않았습니다 — 이 기록(#{ctx.target})은 다른 기기에서 먼저 {word}</St><br />최신 목록을 불러왔습니다. 필요하면 되살리거나 새로 기록하세요.</>,
      },
    };
  }
  if (out.kind === 'conflict' || out.kind === 'versionConflict') {
    return {
      type: 'err', feed: out.data, refresh: !out.data,
      err: { kind: 'conflictClose', node: <><St kind="warn" icon="!">{out.message || '기록하지 않았습니다'}</St><br />최신 목록을 불러왔습니다.</> },
    };
  }
  // 실패(500·네트워크·시간 초과·422) — 입력 유지, 같은 clientEntryId 로 다시 보내도 두 번 기록되지 않는다
  return { type: 'err', feed: null, refresh: false, err: { kind: 'fail', node: failNode(out.kind === 'invalid' ? out.message : out.reason, true) } };
}

export interface EntrySheetProps {
  feed: LedgerFeed;
  initial: EntryDraft;
  /** 닫기 전에 쓰던 초안을 다시 연 것 */
  restored: boolean;
  frame: SheetFrameProps;
  /** 닫기(저장 없이) — 폼 단계였으면 초안 보관용으로 돌려준다 */
  onClose: (draft: EntryDraft, step: 'form' | 'confirm') => void;
  /** 저장 성공 — 페이지가 데이터 교체·토스트·닫기 */
  onDone: (data: LedgerFeed, toast: ReactNode) => void;
  /** 충돌 응답에 실린 최신 데이터로 교체 */
  onFeed: (data: LedgerFeed) => void;
  /** 최신 데이터가 실리지 않은 충돌 — 조용히 다시 읽기 */
  onRefresh: () => void;
  /** 같은 요청 번호로 이미 다른 내용이 저장됨 — 페이지가 시트를 닫고(초안 버림) 목록을 새로 읽어 저장된 기록을 보인다 */
  onStale: (data: LedgerFeed | null, existingId: number | null, toast: ReactNode) => void;
  /** 시험·미리보기용 초기 상태(평소엔 비운다) */
  initialState?: { step?: 'form' | 'confirm'; err?: SheetErr | null; saving?: boolean };
  /** 시험용 — 요청 함수 바꿔 끼우기 */
  writeImpl?: typeof write;
}

export function EntrySheet(p: EntrySheetProps) {
  const { feed } = p;
  const [d, setD] = useState<EntryDraft>(p.initial);
  const [step, setStep] = useState<'form' | 'confirm'>(p.initialState?.step ?? 'form');
  const [saving, setSaving] = useState(!!p.initialState?.saving);
  const sub = useRef(createSubmitter()).current;
  const [err, setErr] = useState<SheetErr | null>(p.initialState?.err ?? null);
  const [focusReq, setFocusReq] = useState<{ id: string; seq: number } | null>(null);
  const focusTo = useCallback((id: string) => setFocusReq((f) => ({ id, seq: (f?.seq ?? 0) + 1 })), []);

  const v = useMemo(() => validateDraft(d, { nowWallMs: nowWall(), feed }), [d, feed]);
  const B = feed.baseline;
  const S = feed.snapshot;
  const fx = S?.fx ?? null;
  const exch = d.kind === 'exchange';
  const correct = d.mode === 'correct';
  const original = correct ? feed.entries.find((e) => e.id === d.target) ?? null : null;

  const set = (patch: Partial<EntryDraft>) => setD((x) => ({ ...x, ...patch }));
  const close = () => { if (!sub.busy && !saving) p.onClose(d, step); };

  const next = () => {
    if (validateDraft(d, { nowWallMs: nowWall(), feed }).count) return;
    setStep('confirm'); setErr(null); focusTo('sh-t');
  };
  const back = () => { setStep('form'); setErr(null); focusTo('sh-next'); };

  const commit = async () => {
    if (sub.busy) return;
    if (validateDraft(d, { nowWallMs: nowWall(), feed }).count) return;
    const req = entryRequest(d, feed, err);
    if (!req) return;
    const beforeP = feed.summary?.P ?? null;
    setSaving(true); focusTo('sh-primary');
    const out = await sub.run(() => (p.writeImpl ?? write)<EntryWriteResponse>('POST', req.url, req.body));
    if (out === null) return;
    setSaving(false);
    const dec = decideEntryOutcome(out, { correct, target: d.target, beforeP });
    if (dec.type === 'done') { p.onDone(dec.data, dec.toast); return; }
    if (dec.type === 'stale') { p.onStale(dec.data, dec.existingId, dec.toast); return; }
    if (dec.feed) p.onFeed(dec.feed); else if (dec.refresh) p.onRefresh();
    setErr(dec.err);
    focusTo('sh-primary');
  };

  // ─── 폼 ─────────────────────────────────────────────────────────────────
  if (step === 'form') {
    const title = correct ? `기록 정정 — #${d.target}` : '입출금 기록 추가';
    let pre: ReactNode = null;
    if (correct && original) {
      pre = <div className="infobox" role="note"><span className="ic" aria-hidden="true">ⓘ</span><div>원래 기록 <b>#{original.id} {entryOne(original)}</b>은 지우지 않고 <b>‘정정됨’</b>으로 남깁니다. 아래 새 기록이 대신 계산에 들어갑니다.</div></div>;
    }
    const cand = d.mode === 'cand' ? feed.candidates.find((c) => c.key === d.candKey) ?? null : null;
    if (cand) {
      const cd = candidateDelta(cand);
      pre = <div className="infobox" role="note"><span className="ic" aria-hidden="true">ⓘ</span><div>{md(cand.ts)} 스냅샷의 <b>{cd.word} {cd.signed}</b> 변화로 채웠습니다. 실제와 다르면 고치세요. 시각은 직전 스냅샷({hm(cand.prevTs)})과 이 스냅샷 사이면 됩니다.</div></div>;
    }
    if (d.mode === 'new' && p.restored) {
      pre = <div className="infobox" role="status"><span className="ic" aria-hidden="true">ⓘ</span><div>닫기 전에 쓰던 내용을 이어서 씁니다.</div></div>;
    }
    const whenErr = v.errors.occurredAt?.message ?? null;
    const whenBad = !!whenErr || v.blocked;
    const amountErr = v.errors.amount?.message ?? null;
    const counterErr = v.errors.counterAmount?.message ?? null;
    const why = whyText(v, d.kind);
    const fromC = fromCurrency(d);
    const toC = toCurrency(d);
    const minD = B ? B.at.slice(0, 10) : '';
    const maxD = formatKstMinute(nowWall()).slice(0, 10);

    return (
      <Sheet
        title={title} onClose={close} busy={saving} className="lg"
        initialFocus={exch ? 'sh-from' : 'sh-amt'} focusRequest={focusReq}
        returnFocusIds={p.frame.returnFocusIds} onAfterClose={p.frame.onAfterClose}
        footer={(
          <>
            <div className="sh-why" id="sh-why" aria-live="polite">{why}</div>
            <div className="btns">
              <button type="button" className="btn sec" onClick={close}>닫기</button>
              <button type="button" className="btn pri" id="sh-next" disabled={v.count > 0} aria-describedby={v.count > 0 ? 'sh-why' : undefined} onClick={next}>확인하기</button>
            </div>
          </>
        )}
      >
        {pre}
        <fieldset className="kseg">
          <legend>종류</legend>
          <div className="opts">
            {(['deposit', 'withdrawal', 'exchange'] as const).map((k) => (
              <label key={k}>
                <input type="radio" name="sh-kind" id={`sh-k-${KIND_ID[k]}`} value={k} checked={d.kind === k} onChange={() => set({ kind: k })} />
                <span>{KIND[k].label}<small>{KIND[k].desc}</small></span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="kseg field">
          <legend>발생 날짜·시각 (한국 시간)</legend>
          <div className="inrow">
            <div>
              <label className="sr" htmlFor="sh-date">날짜</label>
              <input className="dtin" type="date" id="sh-date" value={d.date} min={minD} max={maxD} aria-describedby="sh-when-h sh-when-m" aria-invalid={whenBad ? 'true' : 'false'} onChange={(ev) => set({ date: ev.target.value })} />
            </div>
            <div>
              <label className="sr" htmlFor="sh-time">시각</label>
              <input className="dtin" type="time" id="sh-time" step={60} value={d.time} aria-describedby="sh-when-h sh-when-m" aria-invalid={whenBad ? 'true' : 'false'} onChange={(ev) => set({ time: ev.target.value })} />
            </div>
          </div>
          <div className="hint" id="sh-when-h">기준 {B ? md(B.at) : '—'} 뒤만 기록합니다. KIS 거래내역의 시각을 넣고, 모르면 조금 이르게 넣으세요.</div>
          <div className="msgs" id="sh-when-m" aria-live="polite">{whenErr && <St kind="warn" icon="!">{whenErr}</St>}</div>
        </fieldset>
        <div id="sh-block">
          {v.blocked && B && (
            <div className="blockbox" role="alert">
              <b>! 기준 시각({md(B.at)}) 이전이라 기록할 수 없습니다.</b><br />
              그 전에 넣고 뺀 돈은 기준 총자산 {won(B.baselineTotalKrw)}에 이미 들어 있습니다. 여기 다시 넣으면 같은 돈을 두 번 빼게 되어 손익이 그만큼 틀어집니다.<br />
              <span className="muted">더 이른 때부터 세고 싶다면 화면 아래 ‘손익 기준’에서 기준을 바꾸세요.</span>
            </div>
          )}
        </div>
        {exch ? (
          <>
            <fieldset className="kseg">
              <legend>방향</legend>
              <div className="opts">
                <label><input type="radio" name="sh-dir" id="sh-d-ku" value="ku" checked={d.dir === 'ku'} onChange={() => setD((x) => switchDir(x, 'ku'))} /><span>원화 → 달러</span></label>
                <label><input type="radio" name="sh-dir" id="sh-d-uk" value="uk" checked={d.dir === 'uk'} onChange={() => setD((x) => switchDir(x, 'uk'))} /><span>달러 → 원화</span></label>
              </div>
            </fieldset>
            <MoneyField k="from" label={`낸 ${isUsd(fromC) ? '달러' : '원화'}`} ccy={fromC} value={d.from} error={amountErr} fx={fx} onChange={(x) => set({ from: x })} />
            <MoneyField k="to" label={`받은 ${isUsd(toC) ? '달러' : '원화'}`} ccy={toC} value={d.to} error={counterErr} fx={fx} onChange={(x) => set({ to: x })} />
            <div id="sh-derived" aria-live="polite">
              {v.derived.rate != null ? (
                <div className="derived">
                  적용 환율 <span className="big">{rt(v.derived.rate)}원/$</span> <span className="muted">(원화 ÷ 달러)</span>
                  {fx != null && v.derived.diffPct != null && <><br />앱 환율 {rt(fx)}원/$ 대비 <b>{spct(v.derived.diffPct, 2)}</b> · 환전 비용(추정) 약 <b>{won(Math.max(0, v.derived.costKrw ?? 0))}</b></>}
                  <br /><span className="muted">추정: 기준 = 앱 환율(최신 스냅샷), KIS 고시환율 아님.</span>
                </div>
              ) : (
                <div className="derived muted">두 금액을 넣으면 적용 환율과 환전 비용(추정)을 계산해 보여 드립니다.</div>
              )}
            </div>
            <div className="infobox" role="note"><span className="ic" aria-hidden="true">ⓘ</span><div>환전은 계좌 안 이동이라 순입금·손익에 넣지 않습니다. 기록하지 않아도 손익은 맞고, 기록하면 환전 비용(추정)을 볼 수 있습니다.</div></div>
          </>
        ) : (
          <>
            <fieldset className="kseg">
              <legend>통화</legend>
              <div className="opts">
                <label><input type="radio" name="sh-ccy" id="sh-c-KRW" value="KRW" checked={!isUsd(d.ccy)} onChange={() => set({ ccy: 'KRW' })} /><span>원화 (원)</span></label>
                <label><input type="radio" name="sh-ccy" id="sh-c-USD" value="USD" checked={isUsd(d.ccy)} onChange={() => set({ ccy: 'USD' })} /><span>달러 ($)</span></label>
              </div>
            </fieldset>
            <MoneyField k="amt" label="금액" ccy={d.ccy} value={d.amt} error={amountErr} fx={fx} onChange={(x) => set({ amt: x })} />
          </>
        )}
        <div id="sh-warn"><WarnList items={v.warnings} /></div>
        <div className="field">
          <label className="fl" htmlFor="sh-memo">메모 <span className="muted" style={{ fontWeight: 400 }}>(선택 · 200자)</span></label>
          <div className="inwrap txt"><input id="sh-memo" type="text" maxLength={200} autoComplete="off" value={d.memo} placeholder="예: 생활비 통장에서" onChange={(ev) => set({ memo: ev.target.value })} /></div>
          <div className="hint">배당·이자·수수료는 투자 손익이라 여기 기록하지 않습니다.</div>
        </div>
      </Sheet>
    );
  }

  // ─── 확인 ───────────────────────────────────────────────────────────────
  const n = v.value;
  const pv = previewEntry(d, v, feed, nowWall());
  const c0 = pv.before;
  const c1 = pv.after;
  const title = correct ? `정정 확인 — #${d.target}` : '기록 확인';
  let stmt: ReactNode = null;
  let subText: ReactNode = null;
  if (n && exch && n.counterCurrency && n.counterAmount != null) {
    stmt = <><b>{amtOf(n.currency, n.amount)}</b>을 내고 <b>{amtOf(n.counterCurrency, n.counterAmount)}</b>를 받은 <b>환전</b>으로 기록합니다.</>;
    subText = <>계좌 안 이동이라 손익 숫자는 바뀌지 않습니다.{v.derived.costKrw != null ? ` 환전 비용(추정) 약 ${won(Math.max(0, v.derived.costKrw))}.` : ''}</>;
  } else if (n) {
    const a = `${amtOf(n.currency, n.amount)}${isUsd(n.currency) ? (v.derived.krw != null ? `(참고 ≈ ${won(v.derived.krw)})` : '') : `(${krRead(n.amount)})`}`;
    stmt = n.kind === 'deposit'
      ? <>계좌에 <b>{a}</b>이 <b>들어온</b> 것으로 기록합니다.</>
      : <>계좌에서 <b>{a}</b>이 <b>빠져나간</b> 것으로 기록합니다.</>;
    subText = n.kind === 'deposit' ? '총자산이 이만큼 늘어난 것은 투자로 번 돈으로 보지 않고 손익에서 뺍니다.' : '총자산이 이만큼 줄어든 것은 투자 손실로 보지 않습니다.';
  }
  const rows: [string, ReactNode][] = [['종류', KIND[d.kind].label], ['발생 시각', n ? `${n.occurredAt} (KST)` : '—']];
  if (!exch) rows.push(['통화', isUsd(d.ccy) ? '달러' : '원화']);
  rows.push(['메모', d.memo.trim() ? d.memo.trim() : <span className="muted">없음</span>]);
  if (correct && original) rows.push(['대체할 기록', `#${original.id} ${entryOne(original)} → ‘정정됨’으로 남김`]);

  const flowLine = c0 && c1 ? <>순입금 {won(c0.net)} → <b>{won(c1.net)}</b> · 입출금 뺀 손익 {swon(c0.P)} → <b>{swon(c1.P)}</b></> : null;
  let imp: ReactNode;
  if (exch) imp = '손익 변화 없음 (환전은 순입금에 넣지 않음)';
  else if (pv.predicted.status === 'matched') imp = <><b>바로 반영</b> — {md(pv.predicted.anchorTs)} 스냅샷의 변화와 맞습니다.{flowLine && <><br />{flowLine}</>}</>;
  else if (pv.predicted.status === 'pending') {
    imp = <><b>반영 대기</b> — 최신 스냅샷({md(S?.ts)})보다 뒤라 다음 스냅샷을 기다립니다. 반영되면 총자산도 같이 바뀌어 손익은 거의 그대로입니다.{correct && c0 && c1 && <><br />원래 기록이 빠지면서: 입출금 뺀 손익 {swon(c0.P)} → <b>{swon(c1.P)}</b></>}</>;
  } else imp = <><b>스냅샷과 맞춰 봅니다</b> — 맞는 현금 변화를 찾지 못하면 ‘불일치’로 표시하고 기록대로 계산에 넣습니다.{flowLine && <><br />그 경우 {flowLine}</>}</>;

  let foot: ReactNode;
  if (saving) foot = <BusyFoot label="기록 중…" />;
  else if (err?.kind === 'dup') foot = <div className="btns"><button type="button" className="btn sec" id="sh-back" onClick={back}>‹ 고치기</button><button type="button" className="btn pri" id="sh-primary" onClick={close}>목록으로</button></div>;
  else if (err?.kind === 'conflictClose') foot = <div className="btns"><button type="button" className="btn pri" id="sh-primary" onClick={close}>닫고 최신 목록 보기</button></div>;
  else if (err?.kind === 'conflict') foot = <div className="btns"><button type="button" className="btn sec" id="sh-back" onClick={back}>‹ 고치기</button><button type="button" className="btn pri" id="sh-primary" onClick={commit}>새 기준으로 기록하기</button></div>;
  else foot = <div className="btns"><button type="button" className="btn sec" id="sh-back" onClick={back}>‹ 고치기</button><button type="button" className="btn pri" id="sh-primary" onClick={commit}>{err ? '다시 시도' : correct ? '정정 기록하기' : '기록하기'}</button></div>;

  return (
    <Sheet
      title={title} onClose={close} busy={saving} className="lg" initialFocus="title" focusRequest={focusReq}
      returnFocusIds={p.frame.returnFocusIds} onAfterClose={p.frame.onAfterClose} footer={foot}
    >
      <ErrBox err={err} />
      <p className="cbig">{stmt}</p>
      <p className="csub">{subText}</p>
      <dl className="kd">{rows.map(([dt, dd]) => [<dt key={`${dt}-t`}>{dt}</dt>, <dd key={`${dt}-d`}>{dd}</dd>])}</dl>
      <div className="impact">{imp}</div>
      <WarnList items={v.warnings} />
      <p className="csub" style={{ fontSize: 12 }}>‘기록하기’를 두 번 눌러도 한 번만 기록됩니다.</p>
    </Sheet>
  );
}
