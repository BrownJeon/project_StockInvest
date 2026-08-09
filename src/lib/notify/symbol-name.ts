/**
 * 알림 표시용 종목명 조회 (T-013, 2026-08-09).
 *
 * 텔레그램/슬랙 시그널 알림이 종목코드(`000660`)를 그대로 노출하던 것을
 * 한글 종목명(`SK하이닉스`)으로 바꾸기 위한 단일 진입점.
 * 5개 호출부(`signals/service.ts` ×2, `signals/custom/confirm`,
 * `cron/holding-checker`, `cron/entry-watcher`)가 같은 SELECT 를 중복하지 않도록 추출했다.
 *
 * ## 설계 제약 (반드시 유지)
 *
 * 1. **DB 캐시(`stock_meta`)만 조회한다.** `/api/symbols/lookup` 처럼 캐시 미스 시
 *    KIS 라이브 조회로 폴백하지 **않는다** — 호출부 5곳이 전부 시그널 생성·주문 실행
 *    경로(critical path)라, 표시 문자열 하나 때문에 외부 API 지연·타임아웃을 끌어들이면
 *    매매 자체가 늦어진다. 캐시는 `sync-stock-meta` 일일 cron 과 `universe.ts` 갱신이 채운다.
 * 2. **절대 던지지 않는다.** DB 장애·테이블 미생성 등 어떤 실패에서도 심볼 코드로
 *    폴백해 알림 발송 자체는 그대로 진행시킨다(T-007 의 "조용한 알림 유실" 재발 방지).
 * 3. **해외 종목**은 `stock_meta` 에 한글명이 없을 수 있다 — 이름이 비어 있으면 티커 그대로.
 *
 * ## 왜 여기서 escape 하는가
 *
 * 반환값은 곧바로 `sendAlert(level, title, body)` 의 문자열에 꽂히고, 그 본문은
 * 텔레그램 `parse_mode:'HTML'` · 슬랙 `mrkdwn` 양쪽으로 **그대로** 나간다.
 * 국내 종목명에는 `S&T모티브`·`S&TC` 처럼 `&` 가 실제로 존재하므로, 미이스케이프 상태로
 * 보내면 텔레그램이 HTTP 400 으로 거절해 알림이 통째로 유실될 수 있다(T-007 이 잡았던 유형).
 * 전송 함수에서 일괄 escape 할 수 없는 이유는 `notify/escape.ts` 주석 참고 —
 * holding-checker 처럼 본문에 `<b>` 를 의도적으로 넣는 호출부가 있어, **값을 주입하는
 * 지점에서** escape 하는 것이 이 코드베이스의 규약이다. 그래서 이 함수는
 * "알림에 그대로 넣어도 안전한 표시 문자열"을 반환한다.
 */
import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { escapeAlertText } from './escape';

/**
 * 종목코드 → 알림에 표시할 라벨.
 *
 * - `stock_meta` 에 이름이 있으면 그 이름 (예: `000660` → `SK하이닉스`)
 * - 없거나 조회 실패면 심볼 코드 그대로 (기존 동작과 동일)
 *
 * 반환값은 이미 텔레그램 HTML·슬랙 mrkdwn 에 안전하게 이스케이프된 상태다.
 */
export async function getSymbolLabel(symbol: string): Promise<string> {
  const fallback = escapeAlertText(symbol);
  if (!fallback) return fallback;

  try {
    const pool = getPool();
    const [rows] = await pool.query<(RowDataPacket & { name: string | null })[]>(
      'SELECT name FROM stock_meta WHERE symbol = ? LIMIT 1',
      [symbol],
    );
    const name = rows[0]?.name;
    if (typeof name === 'string' && name.trim()) return escapeAlertText(name.trim());
  } catch (e) {
    // 알림 표시용 조회 실패는 알림 발송을 막지 않는다 — 코드로 폴백하고 로그만 남긴다.
    console.warn(
      `[notify/symbol-name] stock_meta 조회 실패 — symbol=${symbol}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  return fallback;
}
