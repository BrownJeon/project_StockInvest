/**
 * T-074 — 작은 공용 조각: 상태 어휘(`St`, 데모 `st()`), 종류 칩(`KindChip`, 데모 `kchip`), 화면 배지(`LedgerBadge`).
 *
 * 구현 가이드 5절은 T-066 리스크 정책 화면의 StatusText 재사용을 제안했지만, T-066 경계 시험(리스크 모듈 isolation 시험)이
 * 허용 목록 밖 파일이 리스크 컴포넌트 폴더를 참조하는 것을 0건으로 고정한다(리스크 정책 = 표시 전용 경계). 그 시험은 이번 수정 범위 밖이라
 * **같은 마크업(`.st` + 기호 aria-hidden + 글자)** 의 원장 전용 조각을 여기 둔다. 클래스·모양은 StatusText 와 같다.
 */
import type { ReactNode } from 'react';
import type { EntryKind, LedgerFeed } from '@/lib/ledger/types';
import { KIND, type StKind } from './view';

/** 상태 어휘 — 색 + 기호 + 글자. 기호는 aria-hidden, 뜻은 글자로 전달한다 */
export function St({ kind, icon, children }: { kind: StKind; icon: string; children: ReactNode }) {
  return (
    <span className={`st ${kind}`}>
      <i aria-hidden="true">{icon}</i>
      <span>{children}</span>
    </span>
  );
}

/** 종류 칩 — 입금(+)·출금(−)·환전(⇄). 금액은 중립색(손익 빨강/파랑을 쓰지 않는다) */
export function KindChip({ kind }: { kind: EntryKind }) {
  const k = KIND[kind];
  return <span className="kchip"><i aria-hidden="true">{k.icon}</i>{k.label}</span>;
}

/** 기록·계산 전용 배지 (데모 `.mode.disp`) */
export function LedgerBadge() {
  return <span className="mode disp">◌ 기록·계산 전용</span>;
}

// ─── 시트 공용 (데모 `errBox`·`busyFoot`·경고 상자) ─────────────────────────

/** 시트 저장 결과 오류 — fail(500·네트워크, 입력 유지) · dup(중복) · conflict(기준 버전, 다시 기록 가능) · conflictClose(다른 기기에서 먼저 처리, 닫기만) · baseConflict(기준 저장 충돌) */
export type SheetErrKind = 'fail' | 'dup' | 'conflict' | 'conflictClose' | 'baseConflict';
export interface SheetErr {
  kind: SheetErrKind;
  node: ReactNode;
  /** conflict·baseConflict: 서버의 최신 기준 버전 — '새 기준으로 기록하기'·'내 값으로 저장' 이 이 버전으로 보낸다 */
  latestVersion?: number | null;
}

/** 저장 응답을 시트가 어떻게 처리할지 — 성공(데이터 교체·토스트·닫기) / 오류 상태(+ 최신 데이터 교체 또는 조용한 재조회) */
export type SheetDecision =
  | { type: 'done'; data: LedgerFeed; toast: ReactNode }
  | { type: 'err'; err: SheetErr; feed: LedgerFeed | null; refresh: boolean };

export function ErrBox({ err }: { err: SheetErr | null }) {
  if (!err) return null;
  return <div className="errbox" role="alert">{err.node}</div>;
}

/** 저장 실패 문구 — "저장하지 못했습니다 — 서버 응답 500 / 입력한 내용은 그대로 있습니다. (기록이면) 다시 눌러도 두 번 기록되지 않습니다." */
export function failNode(reason: string, entry: boolean): ReactNode {
  return (
    <>
      <St kind="warn" icon="!">저장하지 못했습니다 — {reason}</St><br />
      입력한 내용은 그대로 있습니다.{entry ? ' 다시 눌러도 두 번 기록되지 않습니다.' : ''}
    </>
  );
}

/** 저장 중 발판 — 두 버튼 모두 비활성, 주 버튼 aria-busy */
export function BusyFoot({ label }: { label: string }) {
  return (
    <div className="btns">
      <button type="button" className="btn sec" disabled>‹ 고치기</button>
      <button type="button" className="btn pri" id="sh-primary" disabled aria-busy="true">{label}</button>
    </div>
  );
}

export function WarnList({ items }: { items: readonly { message: string }[] }) {
  if (!items.length) return null;
  return (
    <div className="warnbox" role="note">
      {items.map((w, i) => <div key={i}><St kind="warn" icon="!">{w.message}</St></div>)}
    </div>
  );
}
