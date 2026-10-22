'use client';

import { useId } from 'react';
import type { StopBasis } from '@/lib/risk/defaults';
import { StatusText } from './StatusText';
import { describePolicy, type Draft, type DraftCheck, type SavedPolicy } from './draft';
import { kstMdHm, won } from './fmt';

export type SaveState = 'idle' | 'saving' | 'saved' | 'failed' | 'conflict';

export interface SettingsFormProps {
  draft: Draft;
  check: DraftCheck;
  saved: SavedPolicy | null;
  dirty: number;
  totalKrw: number;
  saveState: SaveState;
  saveError: string | null;
  savedAtText: string;
  /** 편집 중 다른 기기에서 저장된 값 (충돌 안내) */
  remote: SavedPolicy | null;
  syncNote: string | null;
  onChange: (patch: Partial<Draft>) => void;
  onSave: () => void;
  onCancel: () => void;
  onTakeServer: () => void;
  onKeepMine: () => void;
}

function SaveBar(p: SettingsFormProps) {
  const sub = <div className="sub">저장해도 매도 주문은 만들지 않습니다. 예상 손절가에 닿으면 텔레그램으로 알림만 보냅니다. 이 저장은 안전장치 저장과 별개입니다.</div>;
  const errs = p.check.errs;
  if (p.saveState === 'saving') {
    return (
      <div className="savebar" aria-busy="true">
        <div className="msg" role="status">저장 중… 화면에는 먼저 반영했습니다(서버 확인 전).</div>
        {sub}
        <div className="btns">
          <button type="button" className="btn sec" disabled>취소</button>
          <button type="button" className="btn pri" disabled>저장 중…</button>
        </div>
      </div>
    );
  }
  if (p.saveState === 'failed') {
    return (
      <div className="savebar err">
        <div className="msg" role="alert">
          <StatusText kind="warn" icon="!">저장하지 못했습니다 — {p.saveError ?? '알 수 없는 오류'}</StatusText>
          <br /><span style={{ color: 'var(--text)' }}>저장된 값으로 되돌렸고, 입력한 값은 그대로 있습니다.</span>
        </div>
        {sub}
        <div className="btns">
          <button type="button" className="btn sec" onClick={p.onCancel}>입력 취소</button>
          <button type="button" className="btn pri" onClick={p.onSave} disabled={errs > 0}>다시 시도</button>
        </div>
      </div>
    );
  }
  if (p.saveState === 'conflict') {
    return (
      <div className="savebar err">
        <div className="msg" role="alert">
          <StatusText kind="warn" icon="!">저장하지 않았습니다 — 다른 기기에서 먼저 바뀌었습니다</StatusText>
          <br />
          <span style={{ color: 'var(--text)' }}>
            {p.saved
              ? `최신 저장값(${describePolicy(p.saved, null)}, 버전 ${p.saved.version})을 불러왔습니다.`
              : '최신 저장값을 불러왔습니다.'}{' '}
            내 입력은 그대로 있으니 확인 뒤 다시 저장하면 덮어씁니다.
          </span>
        </div>
        {sub}
        <div className="btns">
          <button type="button" className="btn sec" onClick={p.onCancel}>서버 값 쓰기</button>
          <button type="button" className="btn pri" onClick={p.onSave} disabled={errs > 0}>내 값으로 저장</button>
        </div>
      </div>
    );
  }
  if (p.saveState === 'saved' && p.dirty === 0 && p.saved) {
    return (
      <div className="savebar done">
        <div className="msg" role="status">
          <StatusText kind="ok" icon="✓">저장됨 {p.savedAtText}</StatusText> 서버 확정값(버전 {p.saved.version})으로 갱신했습니다.
        </div>
        <div className="sub">매도 주문은 만들지 않았습니다. 바뀐 손절가로 첫 확인 때는 알림 없이 기준만 새로 맞추고, 그다음부터 새 손절가에 닿으면 알립니다.</div>
      </div>
    );
  }
  if (p.dirty === 0) return null;
  return (
    <div className="savebar">
      <div className="msg">
        {p.saved ? <>변경 <span className="num">{p.dirty}</span>건</> : '정책을 처음 저장합니다'} · 아래 값은 저장 전 값 기준입니다
        {errs > 0 && <><br /><StatusText kind="warn" icon="!">잘못된 값 {errs}건을 고쳐야 저장할 수 있습니다</StatusText></>}
      </div>
      {sub}
      <div className="btns">
        {p.saved && <button type="button" className="btn sec" onClick={p.onCancel}>취소</button>}
        <button type="button" className="btn pri" onClick={p.onSave} disabled={errs > 0} aria-disabled={errs > 0 || undefined}>저장</button>
      </div>
    </div>
  );
}

/** 손절 설정 — 여기서만 변경 (데모 v3 `setCard`) */
export function RiskSettingsForm(p: SettingsFormProps) {
  const id = useId();
  const saving = p.saveState === 'saving';
  const { stop, cap } = p.check;
  const msgs = (f: { error: string | null; warning: string | null }) => (
    <>
      {f.error && <StatusText kind="warn" icon="!">{f.error}</StatusText>}
      {f.warning && <StatusText kind="warn" icon="!">{f.warning}</StatusText>}
    </>
  );
  const basis = (v: StopBasis, title: string, sub: string) => (
    <label>
      <input
        type="radio" name={`${id}-basis`} value={v}
        checked={p.draft.stopBasis === v} disabled={saving}
        onChange={() => p.onChange({ stopBasis: v })}
      />
      <span>{title}<small>{sub}</small></span>
    </label>
  );

  return (
    <div className="setcard" role="group" aria-labelledby={`${id}-t`}>
      <h4>
        <span id={`${id}-t`}>손절 설정 — 여기서만 변경</span>
        <span className="ver">
          {p.saved ? `저장된 버전 ${p.saved.version}${p.saved.updatedAt ? ` · ${kstMdHm(p.saved.updatedAt)}` : ''}` : '아직 저장 안 됨'}
        </span>
      </h4>

      <div className="field">
        <label className="fl" htmlFor={`${id}-stop`}>① 손절폭 (모든 보유 종목 공통)</label>
        <div className={`inwrap${stop.error ? ' bad' : ''}`}>
          <input
            id={`${id}-stop`} inputMode="decimal" autoComplete="off"
            value={p.draft.stopPct} disabled={saving}
            aria-invalid={stop.error ? 'true' : 'false'}
            aria-describedby={`${id}-stop-h ${id}-stop-m`}
            onChange={e => p.onChange({ stopPct: e.target.value })}
          />
          <span className="unit" aria-hidden="true">%</span>
        </div>
        <div className="hint" id={`${id}-stop-h`}>0.5 ~ 20 · 제안 3% · 10 넘으면 경고</div>
        <div className="msgs" id={`${id}-stop-m`}>{msgs(stop)}</div>
      </div>

      <div className="field">
        <label className="fl" htmlFor={`${id}-cap`}>② 손실 손절 합 한도 (한 번에 감내할 손실)</label>
        <div className={`inwrap${cap.error ? ' bad' : ''}`}>
          <input
            id={`${id}-cap`} inputMode="decimal" autoComplete="off"
            value={p.draft.heatCapPct} disabled={saving}
            aria-invalid={cap.error ? 'true' : 'false'}
            aria-describedby={`${id}-cap-h ${id}-cap-m`}
            onChange={e => p.onChange({ heatCapPct: e.target.value })}
          />
          <span className="unit" aria-hidden="true">%</span>
        </div>
        <div className="hint" id={`${id}-cap-h`}>
          0.5 ~ 10 · 사용자 확정 2%{p.totalKrw > 0 && <> · 지금 총자산 기준 <span className="num">≈{won(p.totalKrw * p.check.eff.heatCapPct / 100)}</span></>}
        </div>
        <div className="msgs" id={`${id}-cap-m`}>{msgs(cap)}</div>
      </div>

      <fieldset className="seg2">
        <legend>③ 손절 기준가</legend>
        {basis('avg', '평균단가 기준 (권고)', '자동 청산 엔진·전략 문서와 같은 정의')}
        {basis('peak', '고점 대비 (이동 손절)', '보유 중 최고가에서 따라 내려옴')}
      </fieldset>

      {p.remote ? (
        <div className="warnbox sync" role="alert">
          <b>! 다른 기기에서 저장됐습니다(버전 {p.remote.version}) — {describePolicy(p.remote, p.saved)}.</b> 지금 바꾸는 값을 저장하면 그 값을 덮어씁니다.
          <div className="line">
            <button type="button" className="btn sec" onClick={p.onTakeServer}>서버 값 쓰기</button>
            <button type="button" className="btn sec" onClick={p.onKeepMine}>내 값 유지</button>
          </div>
        </div>
      ) : p.syncNote ? (
        <div className="infobox sync" role="status"><span className="ic" aria-hidden="true">ⓘ</span><div>{p.syncNote}</div></div>
      ) : null}

      <SaveBar {...p} />
    </div>
  );
}
