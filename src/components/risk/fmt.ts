/**
 * T-066 리스크 정책 화면 표시 포맷 (데모 v3 의 won·swon·fmt·p2·sp 와 같은 규칙).
 * 로케일·호스트 시간대에 흔들리지 않게 숫자 구분과 KST 시각을 직접 만든다.
 */

function group(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** 1,234원 / -1,234원 */
export function won(n: number): string {
  const r = Math.round(Math.abs(n));
  return (n < 0 && r !== 0 ? '-' : '') + group(r) + '원';
}

/** 부호 있는 원 (+1,234원) */
export function swon(n: number): string {
  return (Math.round(n) > 0 ? '+' : '') + won(n);
}

/** 소수 2자리 % */
export function p2(n: number): string {
  return n.toFixed(2) + '%';
}

/** 부호 있는 소수 1자리 % */
export function sp(n: number): string {
  return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
}

/** 정책 % 값 표시 (3 → "3", 2.5 → "2.5") */
export function pv(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/**
 * 시장별 가격 — 국내 원(정수), 미국 $ (원화 ÷ 환율, 센트 반올림).
 * 환율을 모르면 원화로 보인다.
 */
export function price(market: 'domestic' | 'overseas', krw: number, fx: number | null): string {
  if (market === 'overseas' && fx && fx > 0) {
    const usd = Math.round((krw / fx) * 100) / 100;
    return '$' + usd.toFixed(2);
  }
  return group(Math.round(krw)) + '원';
}

/** 'NAS:MU' → 'MU' */
export function shortSymbol(symbol: string): string {
  const i = symbol.indexOf(':');
  return i >= 0 ? symbol.slice(i + 1) : symbol;
}

const KST_MS = 9 * 3600 * 1000;
const z = (n: number) => (n < 10 ? '0' : '') + n;

function kst(ts: string | number | Date): Date | null {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getTime() + KST_MS);
}

/** HH:MM (KST) */
export function kstHm(ts: string | number | Date): string {
  const d = kst(ts);
  return d ? `${z(d.getUTCHours())}:${z(d.getUTCMinutes())}` : '-';
}

/** HH:MM:SS (KST) */
export function kstHms(ts: string | number | Date): string {
  const d = kst(ts);
  return d ? `${z(d.getUTCHours())}:${z(d.getUTCMinutes())}:${z(d.getUTCSeconds())}` : '-';
}

/** MM-DD HH:MM (KST) */
export function kstMdHm(ts: string | number | Date): string {
  const d = kst(ts);
  return d ? `${z(d.getUTCMonth() + 1)}-${z(d.getUTCDate())} ${z(d.getUTCHours())}:${z(d.getUTCMinutes())}` : '-';
}
