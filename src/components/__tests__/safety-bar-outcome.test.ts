/**
 * 비상 청산(cancel-all) 결과 분류 — T-007 #5 (2026-08-06).
 *
 * 기존 UI 는 `res.ok` 도 본문 `ok` 도 검사하지 않아, 실패 응답이 `{cancelled:0, failed:0}`
 * 으로 읽히며 **"✓ 취소 완료 — 0건 성공"** 으로 표시됐다.
 * 즉 정반대 의미인 세 가지가 한 문구로 뭉개졌다:
 *   ① 요청 실패  ② 취소할 주문이 없음  ③ 실제로 전부 취소함
 * ①은 `emState='failed'` 로 분리했고, ②·③은 이 함수가 나눈다.
 *
 * RTL·jsdom 미설치 + `npm install` 금지 환경이라 렌더 대신 분류 로직을 직접 검증한다.
 */
import { classifyCancelAll } from '@/components/SafetyBar';

describe('classifyCancelAll', () => {
  test('0건 취소 · 0건 실패 → nothing_to_cancel (작업 완료가 아니다)', () => {
    expect(classifyCancelAll({ cancelled: 0, failed: 0 })).toBe('nothing_to_cancel');
  });

  test('취소만 있으면 success', () => {
    expect(classifyCancelAll({ cancelled: 3, failed: 0 })).toBe('success');
  });

  test('실패가 하나라도 있으면 partial — 취소가 더 많아도 성공으로 표시하지 않는다', () => {
    expect(classifyCancelAll({ cancelled: 9, failed: 1 })).toBe('partial');
  });

  test('전부 실패도 partial (요청은 성공했고 개별 취소가 실패한 상태)', () => {
    expect(classifyCancelAll({ cancelled: 0, failed: 4 })).toBe('partial');
  });

  test('"취소할 주문 없음" 과 "전부 실패" 는 절대 같은 분류가 아니다', () => {
    expect(classifyCancelAll({ cancelled: 0, failed: 0 }))
      .not.toBe(classifyCancelAll({ cancelled: 0, failed: 3 }));
  });
});
