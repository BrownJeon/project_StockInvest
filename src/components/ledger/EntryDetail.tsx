/**
 * T-074 — 기록 펼친 상세 (데모 `entryDetail`·`reflectText`): 발생·기록 시각 · 반영 근거 · 환율·비용 · 원화 환산 · 메모 · 정정·취소 이력 + 동작.
 * 동작: 살아 있는 기록 = [환전으로 정정(제안이 있을 때)] [정정하기] [기록 취소] / 취소된 기록 = [되살리기] / 정정된 기록 = 안내 문장.
 * 목록(모바일)과 표(데스크톱)가 둘 다 이 조각을 쓰므로 버튼 id 앞머리(`prefix`)를 달리해 id 가 겹치지 않게 한다.
 */
import type { ReactNode } from 'react';
import type { LedgerEntryView, LedgerFeed } from '@/lib/ledger/types';
import { isUsd } from '@/lib/ledger/rules';
import { St } from './Parts';
import { exchangeRefFx, exCost, exRate, isoMin, keq, md, rt, spct, usdFxSource, won } from './view';

export type EntryAction = 'corr' | 'corrExch' | 'cancel' | 'restore';

export const actionId = (prefix: string, id: number, a: EntryAction) =>
  `${prefix}-ac-${id}-${a === 'corr' ? 'cor' : a === 'corrExch' ? 'cx' : a === 'cancel' ? 'can' : 'res'}`;

export function ReflectText({ e, feed }: { e: LedgerEntryView; feed: LedgerFeed }) {
  if (e.void) return <>계산에서 빠져 있습니다.</>;
  if (e.beforeBaseline && feed.baseline) return <>기준 시각({md(feed.baseline.at)}) 이전 기록이라 계산에서 빠져 있습니다.</>;
  if (e.anchor.status === 'pending') {
    return <>최신 스냅샷({md(feed.snapshot?.ts)})보다 뒤라 다음 스냅샷을 기다립니다. <b>지금 손익에는 빠져 있습니다.</b></>;
  }
  if (e.anchor.status === 'unmatched') {
    const why = e.anchor.detail || '이 시각 뒤 스냅샷에서 맞는 현금 변화를 찾지 못했습니다.';
    // P2-2: 환전은 손익 영향이 없어 '확인 전'(중립) — 계산에 넣지 않는다
    return e.kind === 'exchange'
      ? <><St kind="na" icon="◌">확인 전</St> {why} 환전이라 손익 영향은 없습니다.</>
      : <><St kind="warn" icon="!">불일치</St> {why} 기록대로 계산에 넣었습니다.</>;
  }
  return <>{md(e.anchor.snapshotTs)} 스냅샷 · {e.anchor.detail ?? ''}</>;
}

export function EntryDetail(p: {
  e: LedgerEntryView;
  feed: LedgerFeed;
  prefix: string;
  onAction: (a: EntryAction, e: LedgerEntryView, triggerId: string) => void;
}) {
  const { e, feed, prefix } = p;
  const snapFx = feed.snapshot?.fx ?? null;
  const rows: [string, ReactNode][] = [
    ['발생 시각', `${isoMin(e.occurredAt)} (KST)`],
    ['기록한 시각', md(e.createdAt)],
    ['반영', <ReflectText e={e} feed={feed} key="r" />],
  ];
  if (e.kind === 'exchange') {
    const r = exRate(e);
    const app = exchangeRefFx(e, snapFx);
    const cost = exCost(e, snapFx);
    rows.push(['환율·비용', (
      <>
        적용 {r != null ? rt(r) : '—'}원/$
        {app != null && r != null && <> · 앱 환율 {rt(app)} 대비 {spct(((r - app) / app) * 100, 2)}</>}
        {cost != null && <> · 비용(추정) {won(cost)}</>}
        <br /><span className="muted">추정: 기준 = 앱 환율(스냅샷), KIS 고시환율 아님. 계좌 안 이동이라 순입금·손익에 넣지 않습니다.</span>
      </>
    )]);
  }
  if (e.kind !== 'exchange' && isUsd(e.currency)) {
    const k = keq(e, snapFx);
    const src = usdFxSource(e);
    rows.push(['원화 환산', (
      <>
        {k != null ? won(k) : '—'}
        {src === 'anchor' && ` — 반영된 스냅샷의 환율 ${rt(e.fxRateUsed as number)}원/$`}
        {src === 'first_after' && ` — 기록 시각 뒤 첫 스냅샷의 환율 ${rt(e.fxRateUsed as number)}원/$`}
        {src === 'latest' && snapFx != null && ` — 임시(최신 환율 ${rt(snapFx)}), 반영되면 그 스냅샷 환율로 다시 환산`}
      </>
    )]);
  }
  rows.push(['메모', e.memo ? e.memo : <span className="muted">없음</span>]);
  if (e.supersedes != null) rows.push(['정정', `#${e.supersedes} 를 대신하는 기록`]);
  if (e.void) {
    const by = e.void.by ?? e.supersededBy;
    rows.push([
      e.void.type === 'cancel' ? '취소' : '정정됨',
      `${e.void.reason ?? ''} · ${md(e.void.at)}${e.void.type === 'super' ? ` · 새 기록 #${by ?? ''}` : ''}`,
    ]);
  }

  let act: ReactNode;
  if (!e.void) {
    act = (
      <div className="btns">
        {e.anchor.suggest && (
          <button type="button" className="btn sec" id={actionId(prefix, e.id, 'corrExch')} onClick={() => p.onAction('corrExch', e, actionId(prefix, e.id, 'corrExch'))}>환전으로 정정</button>
        )}
        <button type="button" className="btn sec" id={actionId(prefix, e.id, 'corr')} onClick={() => p.onAction('corr', e, actionId(prefix, e.id, 'corr'))}>정정하기</button>
        <button type="button" className="btn warnline" id={actionId(prefix, e.id, 'cancel')} onClick={() => p.onAction('cancel', e, actionId(prefix, e.id, 'cancel'))}>기록 취소</button>
      </div>
    );
  } else if (e.void.type === 'cancel') {
    act = (
      <div className="btns">
        <button type="button" className="btn sec" id={actionId(prefix, e.id, 'restore')} onClick={() => p.onAction('restore', e, actionId(prefix, e.id, 'restore'))}>되살리기</button>
      </div>
    );
  } else {
    act = <p className="muted" style={{ margin: 0, fontSize: 12 }}>정정으로 대체된 기록은 되살리지 않습니다. 바꾸려면 새 기록 #{e.void.by ?? e.supersededBy} 를 정정하세요.</p>;
  }

  return (
    <>
      <dl className="kd">
        {rows.map(([dt, dd]) => [<dt key={`${dt}-t`}>{dt}</dt>, <dd key={`${dt}-d`}>{dd}</dd>])}
      </dl>
      {act}
    </>
  );
}
