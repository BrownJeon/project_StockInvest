/**
 * T-017 — KIS 유량 스로틀 계약.
 *
 * 검증 대상은 넷이다.
 *  1. **속도**: 설정한 초당 요청수대로 배분되는가 (버스트가 평탄해지는가)
 *  2. **유한 대기열**: 상한을 넘으면 **기다리지 않고 즉시 실패**하는가
 *  3. **우선순위**: 주문(critical)이 대량 스캔(bulk) 뒤에 서지 않는가
 *  4. **lane 격리**: bulk 가 넘쳐도 critical/normal 의 대기 자리를 잠식하지 않는가
 */
import {
  acquireKisSlot,
  withKisPriority,
  currentKisPriority,
  mapWithLimit,
  clampRatePerSec,
  getKisThrottleStats,
  describeKisThrottle,
  KisThrottleQueueFullError,
  KisThrottleTimeoutError,
  isKisThrottleQueueFull,
  isKisThrottleTimeout,
  isKisThrottleFailure,
  DEFAULT_MAX_QUEUE_WAIT_MS,
  DEFAULT_RATE_PER_SEC,
  __resetKisThrottleForTest,
  __LANE_CAPACITY,
} from '@/lib/exchanges/kis-throttle';

/** 대기열이 정리될 때까지 이벤트 루프를 실제로 흘려보낸다. */
const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

afterEach(() => {
  __resetKisThrottleForTest();
});

describe('유량 — 설정한 초당 요청수대로 배분한다', () => {
  it('버킷 용량(=1초치)을 넘는 요청은 즉시 통과하지 않고 뒤로 밀린다', async () => {
    __resetKisThrottleForTest(5);   // 5 req/s, 버스트 5

    const done: number[] = [];
    const started = Date.now();
    // 8건 동시 요청 — 앞 5건은 버스트로 즉시, 나머지 3건은 1/5초 간격으로 나와야 한다.
    const all = Array.from({ length: 8 }, (_, i) =>
      acquireKisSlot('normal').then(() => { done.push(i); }));

    await wait(0);
    expect(done.length).toBe(5);          // 버스트 용량만큼만 즉시 통과

    await Promise.all(all);
    const elapsed = Date.now() - started;
    expect(done.length).toBe(8);
    // 남은 3건 × 200ms = 최소 ~600ms. 타이머 오차를 감안해 넉넉히 하한만 본다.
    expect(elapsed).toBeGreaterThanOrEqual(450);
  });

  it('초당 요청수를 낮추면 같은 건수가 더 오래 걸린다', async () => {
    __resetKisThrottleForTest(4);   // 4 req/s
    const started = Date.now();
    await Promise.all(Array.from({ length: 8 }, () => acquireKisSlot('normal')));
    // 버스트 4건 + 4건 × 250ms ≈ 1s
    expect(Date.now() - started).toBeGreaterThanOrEqual(700);
  });

  it('150건 동시 발사(universe 스캔)를 버스트 없이 흘려보낸다', async () => {
    __resetKisThrottleForTest(100);  // 테스트 시간을 줄이려 높게 잡는다
    const granted: number[] = [];
    await Promise.all(Array.from({ length: 150 }, () =>
      acquireKisSlot('bulk').then(() => granted.push(Date.now()))));
    expect(granted.length).toBe(150);
    // 버스트 100 + 50건/100rps ≈ 0.5초. "150건이 전부 즉시 통과"가 아님을 확인한다.
    expect(granted[149] - granted[0]).toBeGreaterThanOrEqual(300);
  });
});

describe('유한 대기열 — 가득 차면 기다리지 않고 즉시 실패한다', () => {
  it('lane 상한을 넘는 요청은 KisThrottleQueueFullError 로 즉시 거절된다', async () => {
    __resetKisThrottleForTest(0.2);   // 사실상 배분이 멈춘 상태 — 대기열만 쌓인다
    const cap = __LANE_CAPACITY.critical;

    // 상한까지는 (완료되지 않더라도) 거절되지 않는다.
    const queued = Array.from({ length: cap }, () =>
      acquireKisSlot('critical').catch(() => { /* 정리 시 reject */ }));
    expect(queued.length).toBe(cap);

    // 상한을 넘는 순간 **기다리지 않고** 던진다.
    await expect(acquireKisSlot('critical')).rejects.toThrow(KisThrottleQueueFullError);
  });

  it('거절 오류는 식별 가능해야 한다 (잔고 0건과 혼동되면 안 됨)', async () => {
    __resetKisThrottleForTest(0.2);
    const cap = __LANE_CAPACITY.normal;
    Array.from({ length: cap }, () => acquireKisSlot('normal').catch(() => {}));

    const err = await acquireKisSlot('normal').catch(e => e);
    expect(isKisThrottleQueueFull(err)).toBe(true);
    expect(err.name).toBe('KisThrottleQueueFullError');
    expect(String(err.message)).toContain('대기열 초과');
    // 실패 사유가 사람에게 전달되어야 한다 — 조용한 빈 결과가 아니다.
    expect(String(err.message)).toContain('kis_rate_limit_per_sec');
  });

  it('거절은 즉시 일어난다 — 무한 대기로 바뀌지 않는다', async () => {
    __resetKisThrottleForTest(0.2);
    const cap = __LANE_CAPACITY.bulk;
    Array.from({ length: cap }, () => acquireKisSlot('bulk').catch(() => {}));

    const t0 = Date.now();
    await acquireKisSlot('bulk').catch(() => {});
    expect(Date.now() - t0).toBeLessThan(50);
  });

  it('통계에 거절 건수가 집계된다', async () => {
    __resetKisThrottleForTest(0.2);
    Array.from({ length: __LANE_CAPACITY.critical }, () => acquireKisSlot('critical').catch(() => {}));
    await acquireKisSlot('critical').catch(() => {});
    expect(getKisThrottleStats().rejected).toBe(1);
  });
});

describe('우선순위 — 주문이 대량 스캔 뒤에 서지 않는다', () => {
  it('나중에 들어온 critical 이 먼저 대기 중이던 bulk 보다 앞선다', async () => {
    __resetKisThrottleForTest(10);
    const order: string[] = [];

    // 버스트(10)를 먼저 소진시킨다.
    await Promise.all(Array.from({ length: 10 }, () => acquireKisSlot('normal')));

    // 대량 스캔 20건이 줄을 선다 (= 150건 스캔의 축소판).
    const bulk = Array.from({ length: 20 }, (_, i) =>
      acquireKisSlot('bulk').then(() => order.push(`bulk${i}`)));

    // 그 **뒤에** 주문이 들어온다.
    const critical = acquireKisSlot('critical').then(() => order.push('ORDER'));

    await critical;
    // 주문이 20건 스캔을 기다리지 않고 첫 번째로 나왔다.
    expect(order[0]).toBe('ORDER');

    await Promise.all(bulk);
    expect(order).toHaveLength(21);
  });

  it('critical → normal → bulk 순으로 배분된다', async () => {
    __resetKisThrottleForTest(4);
    const order: string[] = [];
    await Promise.all(Array.from({ length: 4 }, () => acquireKisSlot('normal')));

    const pending = [
      acquireKisSlot('bulk').then(() => order.push('bulk')),
      acquireKisSlot('normal').then(() => order.push('normal')),
      acquireKisSlot('critical').then(() => order.push('critical')),
    ];
    await Promise.all(pending);
    expect(order).toEqual(['critical', 'normal', 'bulk']);
  });

  it('bulk 대기열이 가득 차도 critical 은 거절되지 않는다 (lane 격리)', async () => {
    __resetKisThrottleForTest(0.2);
    // bulk lane 을 상한까지 채운다.
    Array.from({ length: __LANE_CAPACITY.bulk }, () => acquireKisSlot('bulk').catch(() => {}));
    await expect(acquireKisSlot('bulk')).rejects.toThrow(KisThrottleQueueFullError);

    // 같은 순간 critical 은 자기 자리를 갖는다 — 거절되지 않는다.
    let criticalRejected = false;
    const c = acquireKisSlot('critical').catch(e => {
      if (isKisThrottleQueueFull(e)) criticalRejected = true;
    });
    await wait(10);
    expect(criticalRejected).toBe(false);
    void c;
  });
});

describe('우선순위 컨텍스트 (withKisPriority)', () => {
  it('기본 lane 은 normal 이다', () => {
    expect(currentKisPriority()).toBe('normal');
  });

  it('비동기 하위 전체가 lane 을 상속한다', async () => {
    const seen = await withKisPriority('bulk', async () => {
      await wait(1);
      const nested = await (async () => {
        await wait(1);
        return currentKisPriority();
      })();
      return nested;
    });
    expect(seen).toBe('bulk');
    // 블록을 벗어나면 원상복귀
    expect(currentKisPriority()).toBe('normal');
  });

  it('컨텍스트가 bulk 여도 명시 priority 가 우선한다 (주문 경로 보호)', async () => {
    __resetKisThrottleForTest(4);
    const order: string[] = [];
    await Promise.all(Array.from({ length: 4 }, () => acquireKisSlot('normal')));

    await withKisPriority('bulk', async () => {
      const scan = Array.from({ length: 4 }, (_, i) =>
        acquireKisSlot().then(() => order.push(`scan${i}`)));   // 컨텍스트 = bulk
      // 같은 bulk 컨텍스트 안에서 나가는 주문 — 명시 critical 이라 앞선다.
      await acquireKisSlot('critical').then(() => order.push('ORDER'));
      expect(order[0]).toBe('ORDER');
      await Promise.all(scan);
    });
  });
});

describe('설정 값 방어 (clampRatePerSec)', () => {
  it.each([
    [0,        DEFAULT_RATE_PER_SEC],
    [-1,       DEFAULT_RATE_PER_SEC],
    [NaN,      DEFAULT_RATE_PER_SEC],
    [Infinity, DEFAULT_RATE_PER_SEC],
    [0.01,     0.2],    // 하한 — 0 에 가까운 값이 시스템을 멈추게 두지 않는다
    [500,      50],     // 상한 — 오타가 레이트리밋을 다시 유발하지 않게
    [8,        8],
  ])('clampRatePerSec(%p) === %p', (input, expected) => {
    expect(clampRatePerSec(input)).toBe(expected);
  });
});

describe('진단 표기', () => {
  it('요약 문구가 "공표 한도가 아님"을 명시한다', () => {
    __resetKisThrottleForTest(5);
    const s = describeKisThrottle();
    expect(s).toContain('5 req/s');
    expect(s).toContain('추정치');
  });

  it('통계에 lane 별 대기 건수가 보인다', async () => {
    __resetKisThrottleForTest(4);
    await Promise.all(Array.from({ length: 4 }, () => acquireKisSlot('normal')));  // 버스트 소진
    const p = acquireKisSlot('bulk').catch(() => {});
    await wait(0);
    expect(getKisThrottleStats().queued.bulk).toBe(1);
    await p;
  });
});

describe('mapWithLimit — 한 호출이 대기열을 통째로 채우지 않게', () => {
  it('동시 실행 수를 제한한다', async () => {
    let inFlight = 0;
    let peak = 0;
    await mapWithLimit(Array.from({ length: 20 }, (_, i) => i), 4, async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await wait(2);
      inFlight--;
      return n;
    });
    expect(peak).toBe(4);
  });

  it('Promise.allSettled 와 동일한 형태·순서를 반환한다', async () => {
    const out = await mapWithLimit([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error('boom');
      return n * 10;
    });
    expect(out).toEqual([
      { status: 'fulfilled', value: 10 },
      { status: 'rejected', reason: expect.any(Error) },
      { status: 'fulfilled', value: 30 },
    ]);
  });

  it('빈 배열은 즉시 빈 결과', async () => {
    expect(await mapWithLimit([], 4, async () => 1)).toEqual([]);
  });

  it('limit 이 항목 수보다 크면 항목 수만큼만 동시 실행', async () => {
    let peak = 0; let cur = 0;
    await mapWithLimit([1, 2], 10, async (n) => {
      cur++; peak = Math.max(peak, cur); await wait(1); cur--; return n;
    });
    expect(peak).toBe(2);
  });
});

describe('대기 데드라인 (reviewer HIGH-2) — 무한 대기가 cron 루프를 멈추지 않게', () => {
  // 데드라인 만료는 **의도적으로** console.error 를 낸다. 테스트 출력이 그 소음에 묻히지
  // 않도록 여기서 잡아 두고, 아래 "조용하지 않다" 테스트는 이 스파이를 그대로 검사한다.
  let errSpy: jest.SpyInstance;
  beforeEach(() => { errSpy = jest.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(() => { errSpy.mockRestore(); });

  it('기본 상한은 30초다', () => {
    expect(DEFAULT_MAX_QUEUE_WAIT_MS).toBe(30_000);
  });

  it('제한 시간 내 차례가 오지 않으면 KisThrottleTimeoutError 로 실패한다', async () => {
    __resetKisThrottleForTest(1);              // 버스트 1건, 그 뒤로는 1초에 1건
    await acquireKisSlot('normal');            // 버스트 소진 — 다음 요청은 ~1초 대기
    await expect(acquireKisSlot('normal', { maxWaitMs: 120 }))
      .rejects.toThrow(KisThrottleTimeoutError);
  });

  it('대기열 초과(QueueFull)와 **구분되는** 오류다', async () => {
    __resetKisThrottleForTest(1);
    await acquireKisSlot('normal');
    const err = await acquireKisSlot('normal', { maxWaitMs: 60 }).catch(e => e);

    expect(isKisThrottleTimeout(err)).toBe(true);
    expect(isKisThrottleQueueFull(err)).toBe(false);   // 섞이면 대응이 달라진다
    expect(isKisThrottleFailure(err)).toBe(true);
    expect(err.name).toBe('KisThrottleTimeoutError');
  });

  it('실패 사유가 조용하지 않다 — console.error 로 크게 남긴다', async () => {
    __resetKisThrottleForTest(1);
    await acquireKisSlot('normal');
    await acquireKisSlot('normal', { maxWaitMs: 60 }).catch(() => {});

    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('대기 시간 초과'));
    const msg = String(errSpy.mock.calls[0][0]);
    expect(msg).toContain('lane=normal');
    expect(msg).toContain('kis_rate_limit_per_sec');   // 조치 방법까지 담는다
  });

  it('만료된 대기자는 줄에서 빠져 토큰을 낭비하지 않는다', async () => {
    __resetKisThrottleForTest(4);
    await Promise.all(Array.from({ length: 4 }, () => acquireKisSlot('normal')));

    // 먼저 선 요청은 만료시키고, 뒤에 선 요청은 정상 통과해야 한다.
    const expired = acquireKisSlot('normal', { maxWaitMs: 30 }).catch(e => e);
    await wait(60);
    expect(isKisThrottleTimeout(await expired)).toBe(true);
    expect(getKisThrottleStats().queued.normal).toBe(0);   // 줄에서 제거됨

    await expect(acquireKisSlot('normal', { maxWaitMs: 2000 })).resolves.toBeUndefined();
  });

  it('차례가 제때 오면 데드라인은 발동하지 않는다', async () => {
    __resetKisThrottleForTest(10);
    await Promise.all(Array.from({ length: 10 }, () => acquireKisSlot('normal')));
    await expect(acquireKisSlot('normal', { maxWaitMs: 5000 })).resolves.toBeUndefined();
    expect(getKisThrottleStats().timedOut).toBe(0);
  });

  it('통계에 timedOut 이 집계된다', async () => {
    __resetKisThrottleForTest(1);
    await acquireKisSlot('normal');
    await acquireKisSlot('bulk', { maxWaitMs: 40 }).catch(() => {});
    expect(getKisThrottleStats().timedOut).toBe(1);
  });
});
