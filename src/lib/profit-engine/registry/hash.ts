/**
 * T-096 사전 등록 §B 해시 잠금. 규칙(v1.0 문서 머리·§B-11):
 *   "`## B. 사전 등록 본문` 제목 줄부터 `## C. P3 구현 명세` 제목 줄 직전까지를 이어 붙여 끝의 공백과 `---` 를 제거한 UTF-8 문자열"의 sha256.
 *   줄은 '\n' 으로 잇는다(문서는 LF). CR 이 섞이면 거부한다(해시가 조용히 달라지는 것을 막기 위해).
 * 순수 함수 — 파일 읽기는 호출자(러너)가 한다.
 */
import { createHash } from 'crypto';

export const SECTION_B_HEADING = '## B. 사전 등록 본문';
export const SECTION_C_HEADING = '## C. P3 구현 명세';

export function extractSectionB(doc: string): string {
  if (doc.includes('\r')) throw new Error('section B: CR 문자가 있다(LF 문서만 허용)');
  const lines = doc.split('\n');
  const s = lines.findIndex((l) => l.startsWith(SECTION_B_HEADING));
  const e = lines.findIndex((l) => l.startsWith(SECTION_C_HEADING));
  if (s < 0) throw new Error('section B: 시작 제목 줄 없음');
  if (e < 0) throw new Error('section B: 끝(§C) 제목 줄 없음');
  if (e <= s) throw new Error('section B: §C 제목이 §B 앞에 있다');
  if (lines.filter((l) => l.startsWith(SECTION_B_HEADING)).length !== 1) throw new Error('section B: 시작 제목 줄이 하나가 아니다');
  if (lines.filter((l) => l.startsWith(SECTION_C_HEADING)).length !== 1) throw new Error('section B: 끝(§C) 제목 줄이 하나가 아니다');
  let body = lines.slice(s, e).join('\n');
  let prev: string;
  do {
    prev = body;
    body = body.replace(/\s+$/, '').replace(/---$/, '');
  } while (body !== prev);
  return body;
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function sectionBSha256(doc: string): string {
  return sha256Hex(extractSectionB(doc));
}

/** 문서에서 다시 계산한 해시가 기대값과 같은가. 형식이 틀린 기대값은 false. */
export function verifySectionB(doc: string, expected: string): { ok: boolean; actual: string | null; reason?: string } {
  if (!/^[0-9a-f]{64}$/.test(expected)) return { ok: false, actual: null, reason: 'expected_malformed' };
  try {
    const actual = sectionBSha256(doc);
    return actual === expected ? { ok: true, actual } : { ok: false, actual, reason: 'hash_mismatch' };
  } catch (e) {
    return { ok: false, actual: null, reason: e instanceof Error ? e.message : String(e) };
  }
}

/* ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
 * registry 수치 잠금(H_r) — Reviewer H-1 대응(v1.1).
 *
 * 정규화 JSON 규칙(바꾸면 모든 H_r 가 바뀐다 — 바꾸지 말 것):
 *   1. 값의 종류는 객체·배열·문자열·유한 숫자·true/false/null 만. undefined·NaN·Infinity·함수는 오류.
 *   2. 객체 키는 [A-Za-z0-9_] 만 허용하고, JS 기본 문자열 정렬(UTF-16 코드 단위 = ASCII 순)로 정렬한다.
 *   3. 배열은 순서를 그대로 둔다.
 *   4. 숫자는 ECMAScript Number::toString 최단 왕복 표기(= JSON.stringify), −0 은 0. 그래서 1.0 과 1 은 같은 값이다.
 *   5. 문자열은 NFC 여야 한다(아니면 오류). 표기는 JSON.stringify 이스케이프.
 *   6. 공백 없음 — 구분자는 ',' 와 ':' 뿐.
 *   7. UTF-8 바이트의 sha256, 소문자 16진수 64자.
 * H_r 의 대상 = registry 전체에서 `document.section_b_sha256`(docHash) 하나만 뺀 것. (H_r 자신은 registry 에 저장하지 않는다 —
 *   H_r 은 문서 §B 본문의 한 줄 `registry-numeric-sha256: <hex>` 로만 존재하고, 그 §B 의 해시가 docHash 다 → 순환 없음.)
 * 동결 절차(Leader): registry 수치 확정 → `node scripts/profit-engine/backtest-runner.mjs --print-registry-hash` 로 H_r 출력 →
 *   문서 §B 안에 정확히 한 줄 `registry-numeric-sha256: <H_r>` 를 넣음 → §B 해시 재계산 → registry document.section_b_sha256 갱신.
 * 'registryFull' 지문 = 같은 정규화로 registry 전체(docHash 포함)의 sha256 — IS·OOS 실행 기록용.
 * ────────────────────────────────────────────────────────────────────────────────────────────────────────────── */

export const REGISTRY_MARKER_RE = /^registry-numeric-sha256: ([0-9a-f]{64})$/;

export function canonicalJson(v: unknown, at = '$'): string {
  if (v === null) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error(`canonicalJson: 유한하지 않은 숫자 ${at}`);
    return JSON.stringify(Object.is(v, -0) ? 0 : v);
  }
  if (typeof v === 'string') {
    if (v.normalize('NFC') !== v) throw new Error(`canonicalJson: NFC 아닌 문자열 ${at}`);
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return `[${v.map((x, i) => canonicalJson(x, `${at}[${i}]`)).join(',')}]`;
  if (typeof v === 'object') {
    const keys = Object.keys(v as Record<string, unknown>);
    for (const k of keys) if (!/^[A-Za-z0-9_]+$/.test(k)) throw new Error(`canonicalJson: 허용되지 않은 키 ${at}.${k}`);
    keys.sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k], `${at}.${k}`)}`).join(',')}}`;
  }
  throw new Error(`canonicalJson: 지원하지 않는 값 ${at}`);
}

/** H_r — registry 에서 document.section_b_sha256 만 뺀 정규화 JSON 의 sha256. 원본 객체는 바꾸지 않는다. */
export function registryNumericSha256(registry: unknown): string {
  const r = JSON.parse(JSON.stringify(registry)) as Record<string, unknown>;
  const doc = r.document as Record<string, unknown> | undefined;
  if (!doc || typeof doc !== 'object') throw new Error('registry.document 없음');
  delete doc.section_b_sha256;
  return sha256Hex(canonicalJson(r));
}

export function registryFullSha256(registry: unknown): string {
  return sha256Hex(canonicalJson(registry));
}

/** §B 본문 안의 마커 줄. 없으면 null, 두 줄 이상이면 오류. */
export function extractRegistryMarker(doc: string): string | null {
  const lines = extractSectionB(doc).split('\n').map((l) => REGISTRY_MARKER_RE.exec(l)).filter(Boolean) as RegExpExecArray[];
  if (lines.length > 1) throw new Error('registry-numeric-sha256 마커 줄이 둘 이상');
  return lines.length ? lines[0][1] : null;
}

/** 문서 §B 마커와 registry 의 H_r 대조. */
export function verifyRegistryNumeric(doc: string, registry: unknown): { ok: boolean; marker: string | null; actual: string | null; reason?: string } {
  let actual: string | null = null;
  try { actual = registryNumericSha256(registry); } catch (e) { return { ok: false, marker: null, actual: null, reason: e instanceof Error ? e.message : String(e) }; }
  let marker: string | null;
  try { marker = extractRegistryMarker(doc); } catch (e) { return { ok: false, marker: null, actual, reason: e instanceof Error ? e.message : String(e) }; }
  if (marker === null) return { ok: false, marker, actual, reason: 'marker_missing' };
  return marker === actual ? { ok: true, marker, actual } : { ok: false, marker, actual, reason: 'registry_numeric_mismatch' };
}
