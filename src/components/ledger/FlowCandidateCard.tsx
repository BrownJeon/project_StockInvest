/**
 * T-074 — 기록 안 된 입출금 같은 변화 카드 (데모 `candHtml` + designer 구현 점검 P2-2).
 * 자동으로 기록하지 않는다(task "하지 않는 것"): [입금으로 기록]은 폼을 채워 줄 뿐이고 저장은 사용자가 확인한 뒤에만 한다.
 * [입출금 아님]은 사유와 함께 남기고 되돌릴 수 있다. 알림 기준 문장은 `rules.ts` 상수로 찍는다.
 *
 * 여러 건(designer P2-2 — 기준은 건수, 기간으로 숨기지 않는다):
 *  - 열린 후보 1건 = 데모 카드 그대로 / 2건 이상 = 카드 1장으로 묶음(제목 "… N건", 줄마다 시각·통화 현금 ±금액·두 버튼,
 *    "위 손익에 섞여 있습니다" 문장은 한 번 — 제목 바로 아래(단일 카드와 같은 '사실 → 이유 → 버튼 → 기준' 순서, designer 델타 점검 2-1), 알림 기준 문장도 한 번).
 *  - '입출금 아님' 표시는 가장 최근에 표시한 1건만 지금 모양으로, 2건째부터 접힘 "입출금 아님으로 표시한 변화 n건"(펼치기 ▾ / 접기 ▴)에 넣는다.
 *    표시된 카드 테두리는 경고색이 아니라 중립(`--border2` 점선 — LedgerStyles `.cand.done`).
 */
import type { CandidateView } from '@/lib/ledger/types';
import { candidateRuleSentence, type LedgerRules } from '@/lib/ledger/rules';
import { St } from './Parts';
import { candidateDelta, hm, KIND, md, swon } from './view';

export const candIds = (key: string) => ({
  title: `lg-cd-t-${key}`, rec: `lg-cand-rec-${key}`, dis: `lg-cand-dis-${key}`, undo: `lg-cand-undo-${key}`, row: `lg-cd-r-${key}`,
});
export const CAND_GROUP_TITLE_ID = 'lg-cd-t-group';

export interface CandidateHandlers {
  P: number;
  rules: LedgerRules;
  busyKey?: string | null;
  onRecord: (c: CandidateView, triggerId: string) => void;
  onDismiss: (c: CandidateView, triggerId: string) => void;
  onUndo: (c: CandidateView, triggerId: string) => void;
}

/** 후보 배치 — 열린 것(서버 순서 = 최신순) · 가장 최근 표시 1건 · 나머지 표시(접힘) */
export function arrangeCandidates(cands: readonly CandidateView[]) {
  const open = cands.filter((c) => c.state === 'open');
  const dismissed = cands
    .filter((c) => c.state === 'dismissed')
    .sort((a, b) => {
      const da = a.dismissedAt ?? '';
      const db = b.dismissedAt ?? '';
      if (da !== db) return da < db ? 1 : -1;
      return a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0;
    });
  return { open, dismissedTop: dismissed[0] ?? null, dismissedRest: dismissed.slice(1) };
}

/** 기록하기 전까지 섞여 있다는 문장 — 2건 이상이면 '이 변화들은', 방향이 섞이면 '입금·출금이었다면 줄마다 … 번 돈·잃은 돈처럼' (designer 델타 점검 2-1) */
function mixSentence(cands: readonly CandidateView[], P: number) {
  const dirs = new Set(cands.map((c) => c.direction));
  const subject = cands.length > 1 ? '이 변화들은' : '이 돈은';
  if (dirs.size === 1) {
    const dep = cands[0].direction === 'deposit';
    return <p>{dep ? '입금' : '출금'}이었다면 기록해 주세요. 기록하기 전까지 {subject} 위 손익({swon(P)})에 <b>투자로 {dep ? '번' : '잃은'} 돈처럼 섞여 있습니다.</b></p>;
  }
  return <p>입금·출금이었다면 줄마다 기록해 주세요. 기록하기 전까지 {subject} 위 손익({swon(P)})에 <b>투자로 번 돈·잃은 돈처럼</b> 섞여 있습니다.</p>;
}

function DismissedCard({ c, h }: { c: CandidateView; h: CandidateHandlers }) {
  const ids = candIds(c.key);
  const d = candidateDelta(c);
  return (
    <div className="cand done">
      <p><St kind="na" icon="—">입출금 아님으로 표시한 변화 1건</St> {md(c.ts)} · {d.word} {d.signed} · 사유: {c.reason ?? ''}</p>
      <div><button type="button" className="btn sec" id={ids.undo} disabled={h.busyKey === c.key} onClick={() => h.onUndo(c, ids.undo)}>되돌리기</button></div>
    </div>
  );
}

/** 열린 후보 1건 — 데모 카드 그대로 */
export function FlowCandidateCard(p: CandidateHandlers & { c: CandidateView }) {
  const { c } = p;
  const ids = candIds(c.key);
  const d = candidateDelta(c);
  if (c.state === 'dismissed') return <DismissedCard c={c} h={p} />;
  if (c.state !== 'open') return null;
  return (
    <section className="cand" aria-labelledby={ids.title}>
      <h3 id={ids.title}><span aria-hidden="true">!</span>기록 안 된 입출금 같은 변화 1건</h3>
      <p>
        <b>{md(c.ts)} 스냅샷 · {d.word} 현금 {d.signed}</b><br />
        <span className="muted">직전 {hm(c.prevTs)} 스냅샷 대비 · 보유 종목 수량 변화 없음</span>
      </p>
      {mixSentence([c], p.P)}
      <div className="btns">
        <button type="button" className="btn pri" id={ids.rec} onClick={() => p.onRecord(c, ids.rec)}>{KIND[c.direction].label}으로 기록</button>
        <button type="button" className="btn sec" id={ids.dis} onClick={() => p.onDismiss(c, ids.dis)}>입출금 아님</button>
      </div>
      <p className="rule">{candidateRuleSentence(p.rules)}</p>
    </section>
  );
}

/** 열린 후보 2건 이상 — 카드 1장 */
export function FlowCandidateGroup(p: CandidateHandlers & { cands: readonly CandidateView[] }) {
  return (
    <section className="cand" aria-labelledby={CAND_GROUP_TITLE_ID}>
      <h3 id={CAND_GROUP_TITLE_ID}><span aria-hidden="true">!</span>기록 안 된 입출금 같은 변화 {p.cands.length}건</h3>
      {mixSentence(p.cands, p.P)}
      <ul className="cand-rows">
        {p.cands.map((c) => {
          const ids = candIds(c.key);
          const d = candidateDelta(c);
          return (
            <li key={c.key}>
              <p id={ids.row}><b>{md(c.ts)} · {d.word} 현금 {d.signed}</b></p>
              <div className="btns">
                <button type="button" className="btn pri" id={ids.rec} aria-describedby={ids.row} onClick={() => p.onRecord(c, ids.rec)}>{KIND[c.direction].label}으로 기록</button>
                <button type="button" className="btn sec" id={ids.dis} aria-describedby={ids.row} onClick={() => p.onDismiss(c, ids.dis)}>입출금 아님</button>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="rule">{candidateRuleSentence(p.rules)}</p>
    </section>
  );
}

/** 후보 영역 전체 — 열린 후보(1건 카드 / 묶음) + 표시한 후보(최근 1건 + 접힘) + 스캔 잘림 안내 */
export function FlowCandidates(p: CandidateHandlers & { cands: readonly CandidateView[]; scanTruncated?: boolean }) {
  const { open, dismissedTop, dismissedRest } = arrangeCandidates(p.cands);
  return (
    <>
      {open.length === 1 && <FlowCandidateCard {...p} c={open[0]} />}
      {open.length >= 2 && <FlowCandidateGroup {...p} cands={open} />}
      {dismissedTop && <DismissedCard c={dismissedTop} h={p} />}
      {dismissedRest.length > 0 && (
        <details className="more">
          <summary>입출금 아님으로 표시한 변화 {dismissedRest.length}건</summary>
          <div className="more-body">{dismissedRest.map((c) => <DismissedCard key={c.key} c={c} h={p} />)}</div>
        </details>
      )}
      {p.scanTruncated && <p className="muted scan-note">스냅샷이 많아 최근 것만 대조했습니다 — 그보다 오래된 기록 안 된 변화는 여기 보이지 않을 수 있습니다.</p>}
    </>
  );
}
