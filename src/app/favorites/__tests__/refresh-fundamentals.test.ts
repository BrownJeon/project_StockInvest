/**
 * T-030 회귀 방지 — 재무갱신 실패 시 화면이 "데이터 없음"으로 전환되지 않던 결함.
 *
 * 사용자 신고: "즐겨찾기 메뉴에서 종목에 대한 재무갱신 호출시 데이터없음으로 처리되지 않는다."
 *
 * 결함 코드(수정 전, 목록·상세 두 파일에 동일하게 복붙돼 있었다):
 *   await fetch(DELETE);           // 서버 캐시 실제 삭제
 *   const json = await (await fetch(GET)).json();
 *   if (!json.ok) { ...실패 메시지...; return; }   // ← 재동기화 없이 끝
 *   await load();                  // 성공했을 때만 재동기화
 *
 * DELETE 로 `stock_fundamentals` 행이 이미 지워졌는데 AI 재분석이 실패하면 화면 상태를
 * 다시 읽지 않아, 갱신 전 옛 날짜("OO월 OO일 기준")가 계속 남았다.
 *
 * 검증 방식: RTL·jsdom 미설치 + `npm install` 금지 환경이라 컴포넌트를 렌더할 수 없다.
 * 그래서 갱신 흐름을 순수 함수(`runFundamentalsRefresh`)로 추출해 직접 검증한다.
 * (동일 선례: `src/components/__tests__/safety-bar-outcome.test.ts`,
 *  `src/app/settings/__tests__/patch-setting.test.ts`)
 */
import {
  runFundamentalsRefresh,
  FAILURE_NOTICE_MS,
  type RefreshProgress,
} from '@/app/favorites/refresh-fundamentals';

function mockFetch(impl: jest.Mock): void {
  (global as unknown as { fetch: unknown }).fetch = impl;
}

/** DELETE 는 항상 성공하고, 이어지는 GET 이 주어진 본문을 돌려주는 fetch 목. */
function fetchWithGetBody(body: unknown): jest.Mock {
  return jest.fn().mockImplementation((_url: string, init?: RequestInit) => {
    if (init?.method === 'DELETE') return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
    return Promise.resolve({ ok: true, json: async () => body });
  });
}

/**
 * setProgress 호출과 재동기화 호출을 **하나의 타임라인**으로 기록한다.
 * "재동기화가 실패 메시지를 즉시 덮어쓰지 않는가"는 순서 문제이므로 순서까지 봐야 한다.
 */
function makeRecorder() {
  const timeline: string[] = [];
  return {
    timeline,
    setProgress: (info: RefreshProgress | null) =>
      timeline.push(info === null ? 'progress:cleared' : `progress:${info.step}:${info.label}`),
    resync: jest.fn(async () => { timeline.push('resync'); }),
    resyncOnFailure: jest.fn(async () => { timeline.push('resyncOnFailure'); }),
  };
}

afterEach(() => jest.clearAllMocks());

// ─────────────────────────────────────────────────────────────────────────────
describe('🔴 T-030 결함 재현 — AI 재분석 실패 경로', () => {
  test('실패해도 재동기화 함수를 호출한다 (수정 전에는 호출 없이 return 했다)', async () => {
    mockFetch(fetchWithGetBody({ ok: false, error: 'claude_unavailable' }));
    const r = makeRecorder();

    const outcome = await runFundamentalsRefresh({
      symbol: '005930', setProgress: r.setProgress, resync: r.resync, failureNoticeMs: 0,
    });

    expect(outcome).toBe('failed');
    expect(r.resync).toHaveBeenCalledTimes(1);
  });

  test('서버 캐시는 실제로 지워진다 — 그래서 재동기화가 필수다', async () => {
    const f = fetchWithGetBody({ ok: false, error: 'claude_unavailable' });
    mockFetch(f);

    await runFundamentalsRefresh({
      symbol: '005930', setProgress: () => {}, resync: async () => {}, failureNoticeMs: 0,
    });

    const [delUrl, delInit] = f.mock.calls[0] as [string, RequestInit];
    expect(delInit.method).toBe('DELETE');
    expect(delUrl).toBe('/api/fundamentals/005930');
    expect(f).toHaveBeenCalledTimes(2); // DELETE 후 GET 재분석
  });

  test('별도 실패용 재동기화(resyncOnFailure)를 주면 그쪽이 호출된다 — 상세 화면용', async () => {
    mockFetch(fetchWithGetBody({ ok: false, error: 'claude_unavailable' }));
    const r = makeRecorder();

    await runFundamentalsRefresh({
      symbol: '005930',
      setProgress: r.setProgress,
      resync: r.resync,
      resyncOnFailure: r.resyncOnFailure,
      failureNoticeMs: 0,
    });

    expect(r.resyncOnFailure).toHaveBeenCalledTimes(1);
    expect(r.resync).not.toHaveBeenCalled();
  });

  test('HTTP 500 + {ok:false} 도 같은 실패 경로 — 재동기화한다', async () => {
    mockFetch(jest.fn().mockImplementation((_u: string, init?: RequestInit) =>
      init?.method === 'DELETE'
        ? Promise.resolve({ ok: true, json: async () => ({ ok: true }) })
        : Promise.resolve({ ok: false, status: 500, json: async () => ({ ok: false, error: 'db down' }) })));
    const r = makeRecorder();

    await runFundamentalsRefresh({
      symbol: '005930', setProgress: r.setProgress, resync: r.resync, failureNoticeMs: 0,
    });

    expect(r.resync).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('실패 메시지 UX 보존 — 재동기화가 메시지를 덮어쓰지 않는다', () => {
  test('실패 메시지 → 재동기화 → 진행표시 해제 순서', async () => {
    mockFetch(fetchWithGetBody({ ok: false, error: 'claude_unavailable' }));
    const r = makeRecorder();

    await runFundamentalsRefresh({
      symbol: '005930', setProgress: r.setProgress, resync: r.resync, failureNoticeMs: 0,
    });

    expect(r.timeline).toEqual([
      'progress:1:캐시 초기화 중',
      'progress:2:AI 분석 중',
      'progress:2:분석 실패 (claude_unavailable)',
      'resync',
      'progress:cleared',
    ]);
  });

  test('error 가 없으면 unknown 으로 표시한다', async () => {
    mockFetch(fetchWithGetBody({ ok: false }));
    const r = makeRecorder();

    await runFundamentalsRefresh({
      symbol: '005930', setProgress: r.setProgress, resync: r.resync, failureNoticeMs: 0,
    });

    expect(r.timeline).toContain('progress:2:분석 실패 (unknown)');
  });

  test('기본 노출시간은 2.5초이고, 그 시간이 지나기 전에는 재동기화하지 않는다', async () => {
    expect(FAILURE_NOTICE_MS).toBe(2500);
    jest.useFakeTimers();
    try {
      mockFetch(fetchWithGetBody({ ok: false, error: 'claude_unavailable' }));
      const r = makeRecorder();

      const pending = runFundamentalsRefresh({
        symbol: '005930', setProgress: r.setProgress, resync: r.resync,
      });

      await jest.advanceTimersByTimeAsync(0); // fetch/json 마이크로태스크 플러시
      expect(r.timeline).toContain('progress:2:분석 실패 (claude_unavailable)');
      expect(r.resync).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(FAILURE_NOTICE_MS - 1);
      expect(r.resync).not.toHaveBeenCalled(); // 아직 메시지를 읽는 중

      await jest.advanceTimersByTimeAsync(1);
      await pending;
      expect(r.resync).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('성공 경로 회귀 없음', () => {
  test('성공하면 3단계 표시 후 resync — 실패용 함수는 호출하지 않는다', async () => {
    mockFetch(fetchWithGetBody({ ok: true, data: { symbol: '005930' } }));
    const r = makeRecorder();

    const outcome = await runFundamentalsRefresh({
      symbol: '005930',
      setProgress: r.setProgress,
      resync: r.resync,
      resyncOnFailure: r.resyncOnFailure,
    });

    expect(outcome).toBe('refreshed');
    expect(r.resyncOnFailure).not.toHaveBeenCalled();
    expect(r.timeline).toEqual([
      'progress:1:캐시 초기화 중',
      'progress:2:AI 분석 중',
      'progress:3:데이터 적용 중',
      'resync',
      'progress:cleared',
    ]);
  });

  test('성공 경로에는 실패 대기(2.5초)가 없다', async () => {
    jest.useFakeTimers();
    try {
      mockFetch(fetchWithGetBody({ ok: true, data: {} }));
      const r = makeRecorder();
      const pending = runFundamentalsRefresh({
        symbol: '005930', setProgress: r.setProgress, resync: r.resync,
      });
      await jest.advanceTimersByTimeAsync(0);
      await pending;
      expect(r.resync).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  test('심볼은 URL 인코딩된다', async () => {
    const f = fetchWithGetBody({ ok: true, data: {} });
    mockFetch(f);
    await runFundamentalsRefresh({ symbol: 'AAPL/US', setProgress: () => {}, resync: async () => {} });
    expect((f.mock.calls[0] as [string, RequestInit])[0]).toBe('/api/fundamentals/AAPL%2FUS');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('진행표시 정리(finally)', () => {
  test('재동기화가 throw 해도 진행표시는 해제된다 (버튼이 영구 비활성되지 않는다)', async () => {
    mockFetch(fetchWithGetBody({ ok: false, error: 'claude_unavailable' }));
    const r = makeRecorder();

    await expect(runFundamentalsRefresh({
      symbol: '005930',
      setProgress: r.setProgress,
      resync: jest.fn(async () => { throw new Error('network'); }),
      failureNoticeMs: 0,
    })).rejects.toThrow('network');

    expect(r.timeline[r.timeline.length - 1]).toBe('progress:cleared');
  });
});
