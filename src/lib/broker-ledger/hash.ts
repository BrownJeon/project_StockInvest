/**
 * T-087 (T-081 WP-D1a) — 원문 행의 **민감 필드 제거 + 안정 직렬화 + raw_hash**(순수 함수). DB·네트워크 import 없음.
 *
 * 설계 §3.2 ⑦: `raw_hash` = 민감 필드를 제거하고 **키를 정렬한** 원문 JSON 의 SHA-256(hex 64자). KIS 가 필드를 더해도 "바뀜"으로
 * 기록된다(과탐 방향 — 안전). `raw_json` 열에는 **해시를 만든 바로 그 문자열**을 넣는다(`stableJson`) — 저장 원문과 해시가 어긋날 수 없다.
 *
 * 값은 바꾸지 않는다(트림·숫자 변환 없음). 같은 원문 → 같은 해시, 키 순서만 다른 원문 → 같은 해시, 값 한 글자 차이 → 다른 해시.
 */
import { createHash } from 'node:crypto';

/**
 * 저장 전에 지우는 키(설계 §2.3 — 캡처 키에 존재: 연락 전화번호·조회 IP·주문 사번).
 * 계좌 관련 키도 지운다 — 설계는 "계좌번호는 응답 행에 없다"고 보았으나, 캡처 도구가 `cano|acnt|acct|account` 키를 **이미 지운 뒤** 저장해
 * 원래 응답 행에 계좌 키가 있었는지 확인할 수 없다(기존 해외 잔고 TTTS3012R 디버그 로그는 행마다 `cano`·`acnt_prdt_cd` 를 찍는다).
 * 민감정보 불변 조건(raw_json 에 계좌번호 금지)을 지키려고 키 이름으로 넓게 지운다.
 */
export const SENSITIVE_KEYS: readonly string[] = ['ctac_tlno', 'inqr_ip_addr', 'ordr_empno'];
const ACCOUNT_KEY_RE = /cano|acnt|acct|account/i;

export function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase();
  return SENSITIVE_KEYS.includes(k) || ACCOUNT_KEY_RE.test(k);
}

/** 민감 키를 (중첩 객체·배열까지) 지운 사본. 원본은 바꾸지 않는다. */
export function sanitizeRawRow(row: unknown): unknown {
  if (Array.isArray(row)) return row.map(sanitizeRawRow);
  if (row && typeof row === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
      if (isSensitiveKey(k)) continue;
      out[k] = sanitizeRawRow(v);
    }
    return out;
  }
  return row;
}

/**
 * 키를 사전순으로 정렬한 JSON(공백 없음). `undefined` 값 키는 JSON.stringify 와 같게 빠진다.
 * 순환 참조·BigInt·함수 같은 JSON 이 아닌 값은 던진다(KIS 응답 JSON 에서는 나오지 않는다 — 나오면 프로그램 오류).
 */
export function stableJson(value: unknown): string {
  const seen = new Set<object>();
  const walk = (v: unknown): unknown => {
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) throw new TypeError('stableJson: 유한하지 않은 숫자');
      return v;
    }
    if (Array.isArray(v)) {
      if (seen.has(v)) throw new TypeError('stableJson: 순환 참조');
      seen.add(v);
      const r = v.map((x) => (x === undefined ? null : walk(x)));
      seen.delete(v);
      return r;
    }
    if (typeof v === 'object') {
      if (seen.has(v as object)) throw new TypeError('stableJson: 순환 참조');
      seen.add(v as object);
      const o: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        const x = (v as Record<string, unknown>)[k];
        if (x === undefined) continue;
        o[k] = walk(x);
      }
      seen.delete(v as object);
      return o;
    }
    throw new TypeError(`stableJson: JSON 이 아닌 값(${typeof v})`);
  };
  return JSON.stringify(walk(value));
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** 원문 행 → `{ rawJson, rawHash }`. 민감 키 제거 → 안정 직렬화 → SHA-256. */
export function rawHashOf(row: unknown): { rawJson: string; rawHash: string } {
  const rawJson = stableJson(sanitizeRawRow(row));
  return { rawJson, rawHash: sha256Hex(rawJson) };
}
