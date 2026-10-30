import type { ReactNode } from 'react';
import { cx, ops } from './styles';

/**
 * 지표 칸 1개 — 데모 `tile()`. 순서: 이름(lb) → 값(v) → 줄(mk, 칸 안 국내·해외 두 줄) → 칩 → meta.
 * `dim` = 오래됨(값 회색). 시장 줄은 `<MarketLine m="국내">…</MarketLine>` 로 그린다.
 * 값이 없으면 `value` 를 `—` 로 주고 칩으로 사유를 말한다 — 0 을 넣지 않는다.
 */
export function MetricTile(props: { label: ReactNode; value?: ReactNode; lines?: ReactNode[]; chip?: ReactNode; meta?: ReactNode; wide?: boolean; dim?: boolean }) {
  const { label, value, lines, chip, meta, wide, dim } = props;
  return (
    <div className={cx(ops.tile, wide && ops.wide, dim && ops.dim)}>
      <span className={ops.lb}>{label}</span>
      {value != null ? <span className={ops.v}>{value}</span> : null}
      {(lines ?? []).map((ln, i) => <span key={i} className={ops.mk}>{ln}</span>)}
      {chip ?? null}
      {meta ? <span className={ops.meta}>{meta}</span> : null}
    </div>
  );
}

/** 칸 안 시장 줄 — `<i>국내</i>44종목 · 10-30 16:00` (데모 `.mk i`). */
export function MarketLine({ m, children }: { m: ReactNode; children?: ReactNode }) {
  return <><i>{m}</i>{children}</>;
}

/** 값 + 단위(작은 글자) — 데모 `8<small>건</small>`. */
export function ValueUnit({ n, unit }: { n: ReactNode; unit: string }) {
  return <>{n}<small>{unit}</small></>;
}

/** 로딩 칸 — 데모 `skelTile()` (읽기 도구에는 숨김). */
export function SkeletonTile({ wide }: { wide?: boolean }) {
  return (
    <div className={cx(ops.tile, wide && ops.wide)} aria-hidden="true">
      <span className={cx(ops.skel, ops.w50)} />
      <span className={cx(ops.skel, ops.big)} />
      <span className={cx(ops.skel, ops.w80)} />
    </div>
  );
}

/** 2열 칸 격자(`.grid2`). */
export function TileGrid({ children }: { children?: ReactNode }) {
  return <div className={ops.grid2}>{children}</div>;
}
