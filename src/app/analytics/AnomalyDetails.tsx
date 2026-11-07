'use client';

import { useEffect, useRef } from 'react';
import { fmtCount, fmtKstHm } from '@/components/ops/format';
import { EmptyNote, RetryButton, Rows, Section, SectionBody, StatusChip, ops } from '@/components/ops/ui';
import type { AnalysisAnomalyRow, AnalysisDataDTO } from '@/lib/ops/metrics/types';
import { LoadingBody } from './panel-parts';
import styles from './anomaly-details.module.css';

const HEADING_ID = 'run-anomalies';
const GROUPS = [
  { kind: 'source', title: '데이터 원천 문제' },
  { kind: 'job', title: '작업 실행 문제' },
] as const;

function reveal(title: HTMLElement, shell: HTMLElement | null | undefined) {
  const strip = shell?.querySelector(`.${ops.strip}`)?.getBoundingClientRect().height ?? 0;
  const tabs = shell?.querySelector(`.${ops.subnav}`)?.getBoundingClientRect().height ?? 0;
  title.style.scrollMarginTop = `${strip + tabs + 8}px`;
  title.scrollIntoView({ block: 'start' });
}

function AnomalyRow({ row }: { row: AnalysisAnomalyRow }) {
  return (
    <details className={styles.row}>
      <summary className={ops.rowl}>
        <span>
          <strong>{row.label}</strong>
          <small className="num">{row.at ? `${fmtKstHm(row.at)} · ` : ''}{row.summary}</small>
        </span>
        <span className={styles.chevron} aria-hidden="true" />
      </summary>
      <dl>
        <dt>사유</dt><dd>{row.reason}</dd>
        <dt>근거</dt><dd>{row.evidence ?? '세부 근거 미기록'}</dd>
        <dt>이후 상태</dt>
        {row.kind === 'source' ? <dd>최신 데이터 아직 미확인</dd>
          : row.laterOkAt ? <dd className={styles.ok}>이후 정상 실행 확인 · <span className="num">{fmtKstHm(row.laterOkAt)}</span></dd>
            : <dd>이후 정상 실행 미확인</dd>}
      </dl>
    </details>
  );
}

export function AnomalyDetails({ details, loading, onRetry }: {
  details?: AnalysisDataDTO['anomalyDetails'];
  loading: boolean;
  onRetry: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function followHash() {
      if (window.location.hash !== `#${HEADING_ID}`) return;
      const title = panel.current?.querySelector<HTMLElement>('h2');
      if (!title) return;
      title.focus({ preventScroll: true });
      reveal(title, panel.current?.parentElement);
    }
    followHash();
    window.addEventListener('hashchange', followHash);
    return () => window.removeEventListener('hashchange', followHash);
  }, []);

  useEffect(() => {
    // 첫 응답으로 위 영역의 높이가 바뀌어도 제목이 초점을 가진 경우에만 다시 맞춘다.
    if (!loading && window.location.hash === `#${HEADING_ID}`) {
      const title = panel.current?.querySelector<HTMLElement>('h2');
      if (title && document.activeElement === title) reveal(title, panel.current?.parentElement);
    }
  }, [loading]);

  const result = details?.state === 'ok' ? details.data : null;
  let body;
  if (loading) body = <LoadingBody />;
  else if (!result) body = (
    <SectionBody>
      <StatusChip kind="error">이상 내역 조회 실패</StatusChip>
      <p className={styles.message}>현재 내역을 확인할 수 없습니다.</p>
      <RetryButton onClick={() => {
        panel.current?.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
        onRetry();
      }} label="다시 조회" />
    </SectionBody>
  );
  else if (result.rows.length === 0) body = <EmptyNote>이 날짜에 기록된 이상 내역이 없습니다.</EmptyNote>;
  else body = GROUPS.map(({ kind, title }) => {
    const rows = result.rows.filter((row) => row.kind === kind);
    if (rows.length === 0) return null;
    return (
      <section key={kind} aria-labelledby={`${HEADING_ID}-${kind}`}>
        <h3 id={`${HEADING_ID}-${kind}`}>{title}</h3>
        <Rows>{rows.map((row) => <AnomalyRow key={row.id} row={row} />)}</Rows>
      </section>
    );
  });

  return (
    <div className={styles.panel} ref={panel}>
      <Section id={HEADING_ID} title="데이터 이상·실행 실패 내역" focusHeading busy={loading}
        small={result ? <span className="num">{fmtCount(result.rows.length)}</span> : undefined}>
        {result && <SectionBody><p className={`${styles.date} num`}>{result.date.replaceAll('-', '.')} · 한국 시간(KST)</p></SectionBody>}
        {body}
        <p className={styles.announcement} role="status">
          {loading ? '이상 내역을 불러오는 중입니다.' : result ? `이상 내역 ${fmtCount(result.rows.length)}` : '이상 내역 조회 실패'}
        </p>
      </Section>
    </div>
  );
}
