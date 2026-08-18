/**
 * 즐겨찾기 "재무 갱신" 동작 (T-030).
 *
 * 갱신은 `DELETE /api/fundamentals/{symbol}` 로 **서버 캐시를 먼저 비운 뒤**
 * `GET` 으로 AI 재분석을 시도하는 2단계다. 그래서 AI 재분석이 실패하면
 * 서버에는 데이터가 없는데 화면에는 갱신 전 옛 값이 남는 상태가 된다.
 * 원래 코드는 실패 시 재동기화 없이 `return` 했기 때문에
 * 목록은 30초 폴링이 돌 때까지, 상세는 **수동 새로고침 전까지 무기한**
 * "OO월 OO일 기준" 옛 날짜를 계속 보여줬다(사용자 신고: "데이터없음으로 처리되지 않는다").
 *
 * 같은 결함이 `FavoritesPage.tsx` / `[symbol]/FavoriteDetailPage.tsx` 에 복붙돼 있었으므로
 * 세 번째 복사본이 생기지 않도록 흐름을 이 모듈 하나로 모으고, 화면별로 다른 부분
 * (진행표시 위치·재동기화 대상)만 주입받는다.
 *
 * RTL·jsdom 미설치 + `npm install` 금지 환경이라 컴포넌트를 렌더할 수 없어,
 * 검증 가능한 순수 함수로 분리한다.
 * (동일 선례: `src/components/scenario-view-model.ts`, `SettingsPage` 의 `patchSetting`)
 */

export interface RefreshProgress {
  step: number;
  label: string;
}

/** 실패 메시지를 사용자가 읽을 수 있도록 화면에 유지하는 시간. */
export const FAILURE_NOTICE_MS = 2500;

export interface RefreshFundamentalsDeps {
  symbol: string;
  /** 진행 단계 표시. `null` 이면 표시를 지운다. */
  setProgress: (info: RefreshProgress | null) => void;
  /** 갱신 성공 후 화면 상태를 서버 최신값으로 재동기화한다. */
  resync: () => Promise<void>;
  /**
   * 갱신 실패 후 재동기화. DELETE 로 서버 캐시가 **이미 비워졌으므로**
   * 실패했을 때도 반드시 화면을 서버 상태(= 데이터 없음)에 맞춰야 한다.
   * 생략하면 `resync` 를 그대로 쓴다.
   */
  resyncOnFailure?: () => Promise<void>;
  /** 실패 메시지 노출 시간. 테스트에서만 바꾼다. */
  failureNoticeMs?: number;
}

export type RefreshOutcome = 'refreshed' | 'failed';

/**
 * 성공·실패 **어느 경로로 끝나든** 재동기화 함수를 호출한다.
 * 실패 경로에서는 실패 메시지를 `failureNoticeMs` 만큼 노출한 **뒤에** 재동기화해
 * 사용자가 실패 원인을 읽을 시간을 뺏지 않는다.
 */
export async function runFundamentalsRefresh(deps: RefreshFundamentalsDeps): Promise<RefreshOutcome> {
  const {
    symbol,
    setProgress,
    resync,
    resyncOnFailure = resync,
    failureNoticeMs = FAILURE_NOTICE_MS,
  } = deps;
  const url = `/api/fundamentals/${encodeURIComponent(symbol)}`;

  setProgress({ step: 1, label: '캐시 초기화 중' });
  try {
    await fetch(url, { method: 'DELETE' });
    setProgress({ step: 2, label: 'AI 분석 중' });
    const res = await fetch(url);
    const json = await res.json() as { ok: boolean; error?: string };
    if (!json.ok) {
      setProgress({ step: 2, label: `분석 실패 (${json.error ?? 'unknown'})` });
      await new Promise(r => setTimeout(r, failureNoticeMs));
      // 서버 캐시는 위 DELETE 로 이미 비었다 — 화면도 "데이터 없음"으로 되돌린다.
      await resyncOnFailure();
      return 'failed';
    }
    setProgress({ step: 3, label: '데이터 적용 중' });
    await resync();
    return 'refreshed';
  } finally {
    setProgress(null);
  }
}
