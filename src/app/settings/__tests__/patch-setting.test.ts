/**
 * 설정 저장 요청의 실패 판정 (2026-08-06).
 *
 * `handleSave` 는 fetch 의 네트워크 예외만 잡고 **HTTP 4xx/5xx 를 성공으로 취급**해
 * 거부된 저장에도 "저장됨 ✓" 를 표시했다 — T-007 이 없애려는 false-success 와 같은 결함이
 * UI 한 층 위에서 반복된 것.
 *
 * `/api/settings/strategies` 는 이미 `backtestIntervalM` 범위 위반을 400 으로 거절하고
 * 있었으므로 잠재 결함이 아니라 실제로 살아있던 오표시다.
 *
 * React 테스트 인프라(RTL·jsdom)가 없고 `npm install` 이 금지된 환경이라
 * 컴포넌트 대신 판정 로직(`patchSetting`)을 직접 검증한다 — DOM 을 쓰지 않는 순수 fetch 함수다.
 */
import { patchSetting, revertSafetyState } from '@/app/settings/SettingsPage';

function mockFetch(impl: jest.Mock): void {
  (global as unknown as { fetch: unknown }).fetch = impl;
}

const jsonRes = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

afterEach(() => jest.clearAllMocks());

describe('성공 판정', () => {
  test('200 + {ok:true} 면 실패 없음(null)', async () => {
    mockFetch(jest.fn().mockResolvedValue(jsonRes(200, { ok: true })));
    await expect(patchSetting('/api/settings/safety', { a: 1 })).resolves.toBeNull();
  });

  test('본문이 JSON 이 아니어도 2xx 면 성공으로 본다', async () => {
    mockFetch(jest.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => { throw new Error('not json'); },
    }));
    await expect(patchSetting('/api/settings/safety', {})).resolves.toBeNull();
  });

  test('PATCH + JSON 헤더로 보낸다', async () => {
    const f = jest.fn().mockResolvedValue(jsonRes(200, { ok: true }));
    mockFetch(f);
    await patchSetting('/api/settings/safety', { reportChannel: 'telegram' });
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/settings/safety');
    expect(init.method).toBe('PATCH');
    expect(init.body).toBe(JSON.stringify({ reportChannel: 'telegram' }));
  });
});

describe('거부 판정 — 서버가 준 사유를 그대로 노출한다', () => {
  test('400 + error 면 rejected 이고 사유를 담는다', async () => {
    mockFetch(jest.fn().mockResolvedValue(
      jsonRes(400, { ok: false, error: '잘못된 설정 값 — reportChannel="sms" (허용: slack|telegram|both|none)' }),
    ));
    const r = await patchSetting('/api/settings/safety', { reportChannel: 'sms' });
    expect(r?.kind).toBe('rejected');
    expect(r?.message).toContain('reportChannel');
    expect(r?.message).toContain('slack|telegram|both|none');
  });

  test('strategies 의 기존 400(backtestIntervalM 범위)도 거부로 잡힌다', async () => {
    mockFetch(jest.fn().mockResolvedValue(
      jsonRes(400, { ok: false, error: 'backtestIntervalM must be 1–10080' }),
    ));
    const r = await patchSetting('/api/settings/strategies', { id: 'x', backtestIntervalM: 0 });
    expect(r?.kind).toBe('rejected');
    expect(r?.message).toBe('backtestIntervalM must be 1–10080');
  });

  test('사유 없는 4xx/5xx 는 상태코드로 대체 안내', async () => {
    mockFetch(jest.fn().mockResolvedValue(jsonRes(500, {})));
    const r = await patchSetting('/api/settings/safety', {});
    expect(r?.kind).toBe('rejected');
    expect(r?.message).toContain('HTTP 500');
  });

  test('200 인데 본문이 {ok:false} 인 경우도 거부로 본다 (형제 섹션과 동일 판정)', async () => {
    mockFetch(jest.fn().mockResolvedValue(jsonRes(200, { ok: false, error: 'id required' })));
    const r = await patchSetting('/api/settings/strategies', {});
    expect(r?.kind).toBe('rejected');
    expect(r?.message).toBe('id required');
  });
});

describe('네트워크 오류는 거부와 구분한다', () => {
  test('fetch 자체가 실패하면 kind=network', async () => {
    mockFetch(jest.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const r = await patchSetting('/api/settings/safety', {});
    expect(r?.kind).toBe('network');
    expect(r?.message).toContain('네트워크');
  });

  test('네트워크 실패에서도 예외를 던지지 않는다 — Promise.all 이 첫 실패에서 끊기면 안 된다', async () => {
    mockFetch(jest.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const results = await Promise.all([
      patchSetting('/a', {}),
      patchSetting('/b', {}),
    ]);
    expect(results).toHaveLength(2);
    expect(results.every(r => r?.kind === 'network')).toBe(true);
  });
});

/**
 * DRY_RUN·KILL_SWITCH 는 낙관적 토글이라, 저장 실패 시 알리는 것만으로는 부족하다.
 * 사용자가 KILL_SWITCH 를 켜고 요청이 실패했는데 토글이 켜진 채로 남으면
 * **매매가 멈춘 줄 알고 자리를 뜨는** 상태가 된다 — 실거래 시스템에서 가장 위험한 오표시.
 */
describe('revertSafetyState — 실패한 안전 토글의 복구', () => {
  const current = { dryRun: false, killSwitch: true, orderMaxPct: 6, dailyOrderMaxPct: 10 } as never;

  test('토글한 키는 서버 재조회 값이 진실 — 낙관적 값도 직전 값도 아니다', () => {
    const server = { dryRun: true, killSwitch: false, orderMaxPct: 1, dailyOrderMaxPct: 2 } as never;
    expect(revertSafetyState(current, { killSwitch: false }, server))
      .toMatchObject({ killSwitch: false });
  });

  /**
   * 되돌림 범위를 토글한 키로 한정하는 이유: 서버 전체 객체로 덮으면 같은 폼의 다른
   * 미저장 편집이 경고 없이 사라진다. 모바일 네트워크가 한 번 끊기는 것만으로
   * 사용자 입력이 날아가는 데이터 손실 경로다.
   */
  test('서버 재조회 성공 시에도 토글하지 않은 필드의 미저장 편집은 살아남는다', () => {
    const edited = { dryRun: false, killSwitch: true, orderMaxPct: 99, dailyOrderMaxPct: 77 } as never;
    const server = { dryRun: false, killSwitch: false, orderMaxPct: 6, dailyOrderMaxPct: 10 } as never;

    const next = revertSafetyState(edited, { killSwitch: false }, server) as unknown as {
      killSwitch: boolean; orderMaxPct: number; dailyOrderMaxPct: number;
    };
    expect(next.killSwitch).toBe(false);      // 토글한 키 → 서버 실제 값
    expect(next.orderMaxPct).toBe(99);        // 편집 중이던 값 → 보존
    expect(next.dailyOrderMaxPct).toBe(77);   // 편집 중이던 값 → 보존
  });

  test('서버 객체를 그대로 반환하지 않는다 (전체 덮어쓰기 금지)', () => {
    const server = { dryRun: true, killSwitch: false, orderMaxPct: 1, dailyOrderMaxPct: 2 } as never;
    expect(revertSafetyState(current, { killSwitch: false }, server)).not.toBe(server);
    // 토글하지 않은 dryRun 은 서버 값(true)이 아니라 로컬 값(false)이 유지된다
    expect(revertSafetyState(current, { killSwitch: false }, server))
      .toMatchObject({ dryRun: false });
  });

  test('재조회 실패 시에만 직전 값으로 되돌린다', () => {
    const next = revertSafetyState(current, { killSwitch: false }, null);
    expect(next).toMatchObject({ killSwitch: false, dryRun: false, orderMaxPct: 6 });
    expect(next).not.toBe(current);
  });

  test('되돌림은 해당 키만 건드리고 나머지 편집 상태는 보존한다', () => {
    const edited = { ...(current as object), orderMaxPct: 99 } as never;
    expect(revertSafetyState(edited, { dryRun: true }, null))
      .toMatchObject({ dryRun: true, orderMaxPct: 99 });
  });

  test('현재 상태가 null 이면 null 을 유지한다 (초기 로드 실패)', () => {
    expect(revertSafetyState(null, { killSwitch: false }, null)).toBeNull();
  });

  test('현재 상태가 null 이고 서버 값이 있으면 서버 값을 채택 (보존할 편집분이 없다)', () => {
    const server = { dryRun: true, killSwitch: false } as never;
    expect(revertSafetyState(null, { killSwitch: false }, server)).toBe(server);
  });

  test('서버 값이 undefined 로 와도 폴백 경로를 탄다', () => {
    expect(revertSafetyState(current, { killSwitch: false }, undefined))
      .toMatchObject({ killSwitch: false });
  });
});
