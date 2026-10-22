/**
 * T-029 — `POST /api/signals/custom/confirm` 수치·shape 가드 (순수 함수 단위).
 *
 * 라우트 레벨 검증은 `src/app/api/signals/custom/confirm/__tests__/route.test.ts` 에 있다.
 * 여기서는 판정 규칙 자체를 고정한다.
 */
import { MAX_SCENARIO_SPLITS, invalidConfirmField, warnConfirmFieldRejected } from '../scenario-confirm-fields';
import { isFiniteNumber } from '../numeric-fields';

/**
 * ⚠️ `NaN`·`Infinity` 는 아래 목록에 없다 — **JSON 으로 전송 자체가 불가능**하다
 * (`JSON.stringify({v: NaN})` → `{"v":null}`). 그 사실은 route 테스트에서 별도로 고정한다.
 */
const NON_NUMBERS: Array<[string, unknown]> = [
  ['숫자 모양 문자열', '70000'],
  ['소수 모양 문자열', '3.7'],
  ['비숫자 문자열', 'abc'],
  ['빈 문자열', ''],
  ['객체', { v: 1 }],
  ['배열', [1]],
  ['boolean', true],
];

describe('isFiniteNumber — 세 라우트가 공유하는 판정 규칙 (T-029에서 공용화)', () => {
  test.each(NON_NUMBERS)('%s 는 수가 아니다', (_label, value) => {
    expect(isFiniteNumber(value)).toBe(false);
  });

  test.each([[0], [1], [-1], [3.7], [1e9]])('%p 는 수다', (value) => {
    expect(isFiniteNumber(value)).toBe(true);
  });

  test('전역 isFinite 와 다르다 — 강제변환하지 않는 것이 이 가드의 핵심이다', () => {
    // 전역 isFinite 는 인자를 Number() 로 강제변환한다 — 숫자 문자열을 통과시킨다.
    expect(isFinite('3.7' as unknown as number)).toBe(true);
    expect(isFiniteNumber('3.7')).toBe(false);
  });
});

// ── 과도차단 회귀 방지 (최우선) ───────────────────────────────────────────────
describe('invalidConfirmField — 정상·선택 필드 미지정은 전부 통과한다', () => {
  test('빈 body(전 필드 미지정)는 통과한다 — 전부 선택 필드다', () => {
    expect(invalidConfirmField({})).toBeNull();
  });

  test('UI 호출자가 보내는 형태(manualSlices 포함)는 통과한다', () => {
    expect(invalidConfirmField({
      symbol: '005930',
      currentPrice: 70000,
      splits: 2,
      manualSlices: [
        { zoneLo: 68600, zoneHi: 69300, qty: 3 },
        { zoneLo: 69400, zoneHi: 70000, qty: 2 },
      ],
      sourceSignalId: 41,
    })).toBeNull();
  });

  test.each([['currentPrice'], ['holdingQty'], ['splits'], ['sourceSignalId'], ['entryZonePct'], ['manualSlices']])(
    '%s = null 은 "미지정"이지 오류가 아니다',
    (field) => {
      expect(invalidConfirmField({ [field]: null })).toBeNull();
    },
  );

  test('manualSlices: [] 는 통과한다 — 라우트가 기본 분할 계산으로 분기하는 기존 경로다', () => {
    expect(invalidConfirmField({ manualSlices: [] })).toBeNull();
  });

  test('currentPrice = 0 은 통과한다 — scenario.entry.price_zone 폴백 경로의 정상 입력이다', () => {
    expect(invalidConfirmField({ currentPrice: 0 })).toBeNull();
  });

  test('holdingQty = 0 은 통과한다', () => {
    expect(invalidConfirmField({ holdingQty: 0 })).toBeNull();
  });

  test('entryZonePct 기본값과 같은 형태 [-0.5, 0.5] 는 통과한다', () => {
    expect(invalidConfirmField({ entryZonePct: [-0.5, 0.5] })).toBeNull();
  });

  test.each([[1], [2], [3], [4]])('UI 가 쓰는 splits %p 은 통과한다', (splits) => {
    expect(invalidConfirmField({ splits })).toBeNull();
  });

  test('값의 의미는 판정하지 않는다 — lo>hi·qty 음수는 이 가드의 소관이 아니다', () => {
    expect(invalidConfirmField({
      entryZonePct: [0.5, -0.5],
      manualSlices: [{ zoneLo: 200, zoneHi: 100, qty: -1 }],
    })).toBeNull();
  });
});

// ── 가드 본체 ────────────────────────────────────────────────────────────────
describe('invalidConfirmField — 최상위 스칼라', () => {
  test.each(NON_NUMBERS)('currentPrice=%s → 거절', (_label, value) => {
    expect(invalidConfirmField({ currentPrice: value })).toMatchObject({
      message: 'currentPrice must be a finite number',
    });
  });

  test.each(NON_NUMBERS)('holdingQty=%s → 거절', (_label, value) => {
    expect(invalidConfirmField({ holdingQty: value })).toMatchObject({
      message: 'holdingQty must be a finite number',
    });
  });

  test.each(NON_NUMBERS)('splits=%s → 거절', (_label, value) => {
    expect(invalidConfirmField({ splits: value })).toMatchObject({
      message: 'splits must be an integer >= 1',
    });
  });

  test.each([[0], [-1], [2.5]])(
    'splits=%p → 거절 — 반복 횟수라 "수"만으로는 부족하다(0이면 시그널 0건 + 알람 단계 500)',
    (value) => {
      expect(invalidConfirmField({ splits: value })).toMatchObject({
        message: 'splits must be an integer >= 1',
      });
    },
  );

  test.each([...NON_NUMBERS, ['소수', 1.5] as [string, unknown]])(
    'sourceSignalId=%s → 거절 (SQL 바인딩 파라미터로 직행하는 값)',
    (_label, value) => {
      expect(invalidConfirmField({ sourceSignalId: value })).toMatchObject({
        message: 'sourceSignalId must be an integer',
      });
    },
  );
});

describe('invalidConfirmField — entryZonePct 배열 shape', () => {
  const expected = 'entryZonePct must be an array of exactly 2 finite numbers';

  test.each([
    ['배열이 아님 (숫자)', 0.5],
    ['배열이 아님 (문자열)', '-0.5,0.5'],
    ['배열이 아님 (객체)', { lo: -0.5, hi: 0.5 }],
    ['길이 0', []],
    ['길이 1', [-0.5]],
    ['길이 3', [-0.5, 0, 0.5]],
    ['원소가 문자열', ['-0.5', '0.5']],
    ['원소 하나만 문자열', [-0.5, '0.5']],
    ['원소가 null', [null, 0.5]],
    ['중첩 배열', [[-0.5], [0.5]]],
  ])('%s → 거절', (_label, value) => {
    expect(invalidConfirmField({ entryZonePct: value })).toMatchObject({ message: expected });
  });

  test('`as [number, number]` 캐스트가 못 잡던 케이스 — 길이 3 문자열 배열', () => {
    // 컴파일 타임에는 캐스트로 전부 통과했다. 런타임 판정이 유일한 방어선이다.
    expect(invalidConfirmField({ entryZonePct: ['a', 'b', 'c'] })).not.toBeNull();
  });
});

describe('invalidConfirmField — manualSlices[] (T-029 핵심)', () => {
  test('배열이 아니면 거절', () => {
    expect(invalidConfirmField({ manualSlices: { zoneLo: 1, zoneHi: 2, qty: 1 } })).toMatchObject({
      message: 'manualSlices must be an array',
    });
  });

  test.each([
    ['null 원소', null],
    ['문자열 원소', 'x'],
    ['숫자 원소', 1],
    ['배열 원소', [1, 2]],
  ])('원소가 객체가 아니면 거절 — %s', (_label, value) => {
    expect(invalidConfirmField({ manualSlices: [value] })).toMatchObject({
      message: 'manualSlices[0] must be an object',
    });
  });

  test.each(['zoneLo', 'zoneHi', 'qty'])('%s 누락 → 거절 (원소 내부 필드는 필수다)', (field) => {
    const slice: Record<string, number> = { zoneLo: 100, zoneHi: 200, qty: 3 };
    delete slice[field];
    expect(invalidConfirmField({ manualSlices: [slice] })).toMatchObject({
      message: `manualSlices[0].${field} must be a finite number`,
    });
  });

  describe.each(['zoneLo', 'zoneHi', 'qty'])('%s', (field) => {
    test.each(NON_NUMBERS)('=%s → 거절', (_label, value) => {
      expect(invalidConfirmField({
        manualSlices: [{ zoneLo: 100, zoneHi: 200, qty: 3, [field]: value }],
      })).toMatchObject({ message: `manualSlices[${0}].${field} must be a finite number` });
    });
  });

  test('몇 번째 원소인지 밝힌다 — 앞 원소가 정상이어도 index 가 정확해야 고칠 수 있다', () => {
    expect(invalidConfirmField({
      manualSlices: [
        { zoneLo: 100, zoneHi: 200, qty: 3 },
        { zoneLo: 210, zoneHi: 300, qty: 2 },
        { zoneLo: 310, zoneHi: '400', qty: 1 },
      ],
    })).toMatchObject({ message: 'manualSlices[2].zoneHi must be a finite number' });
  });

  test('첫 위반에서 멈춘다 — 여러 개가 틀려도 하나를 정확히 지목한다', () => {
    expect(invalidConfirmField({
      manualSlices: [
        { zoneLo: '100', zoneHi: '200', qty: '3' },
        { zoneLo: 'x', zoneHi: 'y', qty: 'z' },
      ],
    })).toMatchObject({ message: 'manualSlices[0].zoneLo must be a finite number' });
  });
});

describe('warnConfirmFieldRejected — 흔적 없는 거절을 남기지 않는다', () => {
  test('routeTag·symbol·필드 경로·타입·값이 모두 로그에 남는다', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const v = invalidConfirmField({ symbol: '005930', manualSlices: [{ zoneLo: '100', zoneHi: 200, qty: 3 }] })!;
      warnConfirmFieldRejected('api/signals/custom/confirm POST', v, { symbol: '005930' });

      const line = warn.mock.calls[0][0] as string;
      expect(line).toContain('api/signals/custom/confirm POST');
      expect(line).toContain('005930');
      expect(line).toContain('manualSlices[0].zoneLo');
      expect(line).toContain('string');
      expect(line).toContain('100');
    } finally {
      warn.mockRestore();
    }
  });

  test('직렬화 불가 값(순환 참조)에도 던지지 않는다', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const circular: Record<string, unknown> = {};
      circular.self = circular;

      expect(() =>
        warnConfirmFieldRejected('t', { message: 'x must be a finite number', value: circular }, {}),
      ).not.toThrow();
      expect(warn.mock.calls[0][0]).toContain('<직렬화 불가>');
    } finally {
      warn.mockRestore();
    }
  });
});

describe('T-068 WP-B — 시나리오 분할 상한 4', () => {
  const slice = (i: number) => ({ zoneLo: 100 + i, zoneHi: 200 + i, qty: 1 });

  test('상한 상수는 4', () => {
    expect(MAX_SCENARIO_SPLITS).toBe(4);
  });

  test('splits 4 통과 / 5 거절', () => {
    expect(invalidConfirmField({ splits: 4 })).toBeNull();
    expect(invalidConfirmField({ splits: 5 })).toEqual({ message: 'splits must be an integer between 1 and 4', value: 5 });
  });

  test.each([[6], [20], [1e9]])('splits=%p → 거절', (value) => {
    expect(invalidConfirmField({ splits: value })).toMatchObject({ message: 'splits must be an integer between 1 and 4' });
  });

  test('하한 위반 문구는 기존 그대로(0 → integer >= 1)', () => {
    expect(invalidConfirmField({ splits: 0 })).toMatchObject({ message: 'splits must be an integer >= 1' });
  });

  test('manualSlices 4개 통과 / 5개 거절', () => {
    expect(invalidConfirmField({ manualSlices: [0, 1, 2, 3].map(slice) })).toBeNull();
    expect(invalidConfirmField({ manualSlices: [0, 1, 2, 3, 4].map(slice) })).toEqual({
      message: 'manualSlices must be an array of at most 4 slices',
      value: 'length=5',
    });
  });

  test('manualSlices 빈 배열은 계속 통과', () => {
    expect(invalidConfirmField({ manualSlices: [] })).toBeNull();
  });

  test('splits 가 4 이하여도 manualSlices 가 5개면 거절(슬라이스 수가 시그널 수)', () => {
    expect(invalidConfirmField({ splits: 2, manualSlices: [0, 1, 2, 3, 4].map(slice) })).toMatchObject({
      message: 'manualSlices must be an array of at most 4 slices',
    });
  });
});
