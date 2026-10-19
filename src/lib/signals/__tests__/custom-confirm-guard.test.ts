/**
 * T-052 — 사용자 시나리오 확정(custom/confirm) 하드닝 헬퍼 단위 시험.
 * 라우트 시험(`api/signals/custom/confirm/__tests__/route.test.ts`)이 흐름을, 이 파일이 순수 계산을 맡는다.
 */
import {
  CONFIRM_BUSY_MESSAGE,
  CONFIRM_LOCK_WAIT_SEC,
  CONFIRM_TTL_MS,
  activeDuplicateMessage,
  confirmLockName,
  sourceAlreadyHandledMessage,
  findActiveZoneDuplicate,
  holdingDeadlineEndMs,
  resolveConfirmExpiry,
  zoneKey,
} from '../custom-confirm-guard';

describe('holdingDeadlineEndMs — entry-watcher resolveHoldingDeadline 과 같은 해석', () => {
  test('YYYY-MM-DD → 그날 23:59:59 KST 시점', () => {
    expect(holdingDeadlineEndMs('2026-10-19')).toBe(Date.parse('2026-10-19T14:59:59Z'));
  });

  test('유효한 날짜에서 entry-watcher 식 `new Date(`${dl}T23:59:59+09:00`)` 과 1ms 도 다르지 않다 (2026~2029 전 일자)', () => {
    let mismatches = 0;
    for (let t = Date.UTC(2026, 0, 1); t < Date.UTC(2029, 0, 1); t += 86_400_000) {
      const dl = new Date(t).toISOString().slice(0, 10);
      if (holdingDeadlineEndMs(dl) !== new Date(`${dl}T23:59:59+09:00`).getTime()) mismatches++;
    }
    expect(mismatches).toBe(0);
  });

  test.each([
    ['2026/10/19'], ['20261019'], ['2026-10-19T00:00'], [' 2026-10-19'], ['2026-02-30'], ['2026-13-01'], ['0050-01-01'],
    [''], [null], [undefined], [20261019], [{}],
  ])('형식·달력 오류 %p → null (거절 근거로 쓰지 않는다)', (raw) => {
    expect(holdingDeadlineEndMs(raw)).toBeNull();
  });

  test('윤일 2028-02-29 는 유효, 2027-02-29 는 무효', () => {
    expect(holdingDeadlineEndMs('2028-02-29')).toBe(Date.parse('2028-02-29T14:59:59Z'));
    expect(holdingDeadlineEndMs('2027-02-29')).toBeNull();
  });
});

describe('resolveConfirmExpiry — min(now+24h, 마감) · 지난 마감 거절', () => {
  const NOW = Date.parse('2026-10-19T00:00:00Z');   // 10-19 09:00 KST
  const sc = (holding_deadline: unknown) => ({ exit: { holding_deadline } });

  test('마감 없음 → now+24h', () => {
    expect(resolveConfirmExpiry({}, NOW)).toEqual({ ok: true, expiresAtMs: NOW + CONFIRM_TTL_MS, clampedToDeadline: false });
    expect(resolveConfirmExpiry(null, NOW)).toEqual({ ok: true, expiresAtMs: NOW + CONFIRM_TTL_MS, clampedToDeadline: false });
    expect(resolveConfirmExpiry({ exit: 'x' }, NOW)).toEqual({ ok: true, expiresAtMs: NOW + CONFIRM_TTL_MS, clampedToDeadline: false });
  });

  test('마감이 더 이르면 마감으로 당긴다', () => {
    expect(resolveConfirmExpiry(sc('2026-10-19'), NOW))
      .toEqual({ ok: true, expiresAtMs: Date.parse('2026-10-19T14:59:59Z'), clampedToDeadline: true });
  });

  test('now+24h 가 더 이르면 now+24h', () => {
    expect(resolveConfirmExpiry(sc('2026-10-20'), NOW)).toEqual({ ok: true, expiresAtMs: NOW + CONFIRM_TTL_MS, clampedToDeadline: false });
  });

  test('둘이 같으면 그 값(어느 쪽이든 같은 시각)', () => {
    const now = Date.parse('2026-10-19T14:59:59Z');
    const r = resolveConfirmExpiry(sc('2026-10-20'), now);
    expect(r.ok && r.expiresAtMs).toBe(Date.parse('2026-10-20T14:59:59Z'));
  });

  test('지난 마감 → ok:false 와 날짜가 들어간 한국어 메시지', () => {
    const r = resolveConfirmExpiry(sc('2026-10-18'), NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain('2026-10-18');
      expect(r.error).toContain('보유 마감일');
    }
  });

  test('경계: now === 마감 → 거절, now = 마감 − 1ms → 통과', () => {
    const end = Date.parse('2026-10-19T14:59:59Z');
    expect(resolveConfirmExpiry(sc('2026-10-19'), end).ok).toBe(false);
    expect(resolveConfirmExpiry(sc('2026-10-19'), end - 1)).toEqual({ ok: true, expiresAtMs: end, clampedToDeadline: true });
  });

  test('구형 holding_days 만 있으면 24h (당기지 않는다)', () => {
    expect(resolveConfirmExpiry({ exit: { holding_days: '당일' } }, NOW))
      .toEqual({ ok: true, expiresAtMs: NOW + CONFIRM_TTL_MS, clampedToDeadline: false });
  });
});

describe('zoneKey · findActiveZoneDuplicate', () => {
  test('수치 구간은 공백·표기 차이를 흡수한다', () => {
    expect(zoneKey('68600~69300')).toBe('68600~69300');
    expect(zoneKey(' 68600 ~ 69300 ')).toBe('68600~69300');
    expect(zoneKey('68600.0~69300')).toBe('68600~69300');
    expect(zoneKey('abc~def')).toBe('abc~def');
    expect(zoneKey('')).toBe('');
  });

  const row = (id: number, zone: unknown) => ({ id, indicators: JSON.stringify({ ai: { scenario: { entry: { price_zone: zone } } } }) });

  test('같은 구간 → 그 행', () => {
    expect(findActiveZoneDuplicate([row(1, '1~2'), row(2, '68600~69300')], ['68600~69300'])).toEqual({ id: 2, zone: '68600~69300' });
  });

  test('다른 구간·깨진 JSON·구간 없음 → null', () => {
    expect(findActiveZoneDuplicate([row(1, '1~2')], ['68600~69300'])).toBeNull();
    expect(findActiveZoneDuplicate([{ id: 3, indicators: '{bad' }], ['68600~69300'])).toBeNull();
    expect(findActiveZoneDuplicate([{ id: 4, indicators: null }], ['68600~69300'])).toBeNull();
    expect(findActiveZoneDuplicate([row(5, 123)], ['123'])).toBeNull();
    expect(findActiveZoneDuplicate([], ['68600~69300'])).toBeNull();
  });

  test('indicators 가 이미 객체(드라이버가 JSON 으로 파싱한 경우)여도 비교한다', () => {
    expect(findActiveZoneDuplicate([{ id: 6, indicators: { ai: { scenario: { entry: { price_zone: '1~2' } } } } }], ['1~2']))
      .toEqual({ id: 6, zone: '1~2' });
  });
});

describe('confirmLockName', () => {
  test('결정적이고 (종목·방향)을 구분하며 64자 이내', () => {
    expect(confirmLockName('005930', 'buy')).toBe(confirmLockName('005930', 'buy'));
    expect(confirmLockName('005930', 'buy')).not.toBe(confirmLockName('005930', 'sell'));
    expect(confirmLockName('005930', 'buy')).not.toBe(confirmLockName('000660', 'buy'));
    expect(confirmLockName('x'.repeat(500), 'buy').length).toBeLessThanOrEqual(64);
  });

  test('구분자 충돌 없음 — ("a|b","c") 와 ("a","b|c") 가 다르다', () => {
    expect(confirmLockName('a|b', 'c')).not.toBe(confirmLockName('a', 'b|c'));
  });

  // Reviewer R-8: DB 의 중복 비교(`symbol = ? AND side = ?`, utf8mb4_general_ci)는 대소문자·후행 공백을 무시하는데
  //   락 이름이 철자 그대로면 같은 종목·방향의 동시 요청이 서로 다른 락을 쥐고 둘 다 통과했다(실DB 5/5). → 락 이름만 정규화한다.
  test.each([
    ['NAS:AAPL', 'buy', 'nas:aapl', 'buy'],
    ['005930', 'buy', '005930 ', 'buy'],
    ['005930', 'buy', '005930', 'BUY'],
    ['NAS:AAPL', 'sell', ' Nas:Aapl ', ' Sell '],
  ])('🔴 철자만 다른 같은 키 (%p,%p) ≡ (%p,%p) → 같은 락 이름', (s1, d1, s2, d2) => {
    expect(confirmLockName(s2, d2)).toBe(confirmLockName(s1, d1));
  });

  test('정규화해도 다른 종목·다른 방향은 다른 이름, 64자 이내', () => {
    expect(confirmLockName('nas:aapl', 'BUY')).not.toBe(confirmLockName('NAS:AAPL', 'sell'));
    expect(confirmLockName('nas:aapl', 'BUY')).not.toBe(confirmLockName('NAS:MSFT', 'buy'));
    expect(confirmLockName('005930 ', 'buy')).not.toBe(confirmLockName('000660', 'buy'));
    expect(confirmLockName(' x'.repeat(300), 'BUY').length).toBeLessThanOrEqual(64);
  });
});

describe('사용자 문구 (Reviewer R-4) · 락 대기 상한 (R-5)', () => {
  // 라운드3 R-7: 승인 경로는 곧바로 주문하기도 하고 auto_submitted 는 자동 제출이라 "진입 감시 또는 주문이 시작된" 으로 바꿨다
  test('이미 진입 감시·주문으로 넘어간 원본 → "이미 진입 감시 또는 주문이 시작된", 영문 상태 없음', () => {
    for (const st of ['approved', 'approved_pending_entry', 'executing', 'auto_submitted']) {
      const m = sourceAlreadyHandledMessage(7, st);
      expect(m).toContain('이미 진입 감시 또는 주문이 시작된 시나리오입니다(#7)');
      expect(m).not.toContain(st);
    }
  });

  test('처리·만료된 원본 → "이미 처리되었거나 만료되어", 라벨은 한국어, 모르는 상태는 "처리됨", "중복" 이라 말하지 않는다', () => {
    expect(sourceAlreadyHandledMessage(7, 'expired')).toBe('이 시그널(#7)은 이미 처리되었거나 만료되어 등록할 수 없습니다(만료됨).');
    expect(sourceAlreadyHandledMessage(7, 'rejected')).toContain('(거절됨)');
    expect(sourceAlreadyHandledMessage(7, 'superseded')).toContain('(새 시그널로 대체됨)');
    expect(sourceAlreadyHandledMessage(7, 'ai_skipped')).toContain('(처리됨)');
    expect(sourceAlreadyHandledMessage(7, 'ai_skipped')).not.toContain('ai_skipped');
    expect(sourceAlreadyHandledMessage(7, 'expired')).not.toContain('중복');
  });

  test('직접 경로 중복·락 대기 문구', () => {
    expect(activeDuplicateMessage({ id: 9, zone: '1~2' })).toContain('같은 종목·방향·구간(1~2)의 시나리오 #9');
    expect(activeDuplicateMessage({ id: 9, zone: '1~2' })).toContain('이미 진행 중입니다');
    expect(CONFIRM_BUSY_MESSAGE).toContain('잠시 후 다시 시도해 주세요');
  });

  // 라운드3(Codex C2 medium, Leader 결정): 2 → 0 — 기다리는 동안 풀 연결을 쥐지 않는다
  test('락 대기 0초', () => {
    expect(CONFIRM_LOCK_WAIT_SEC).toBe(0);
  });
});
