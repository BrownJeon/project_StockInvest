/**
 * 미국주식 정적 universe (KIS 시총 랭킹 API 부재 폴백).
 * 시가총액·유동성 기준 메이저 50종.
 * 운영자가 환경변수 OVERSEAS_UNIVERSE_SYMBOLS로 오버라이드 가능 (안전장치 화이트리스트와 무관).
 */
export const SP500_TOP50: ReadonlyArray<string> = [
  // Mega cap (NASDAQ)
  'NAS:AAPL', 'NAS:MSFT', 'NAS:NVDA', 'NAS:GOOGL', 'NAS:GOOG',
  'NAS:META', 'NAS:AMZN', 'NAS:TSLA', 'NAS:AVGO', 'NAS:PEP',
  'NAS:COST', 'NAS:ADBE', 'NAS:NFLX', 'NAS:CSCO', 'NAS:AMD',
  'NAS:CMCSA', 'NAS:INTC', 'NAS:QCOM', 'NAS:AMGN', 'NAS:HON',
  'NAS:INTU', 'NAS:ISRG', 'NAS:BKNG', 'NAS:VRTX', 'NAS:GILD',
  // NYSE 대표주
  'NYS:BRK.B', 'NYS:LLY', 'NYS:JPM', 'NYS:V', 'NYS:UNH',
  'NYS:WMT', 'NYS:XOM', 'NYS:JNJ', 'NYS:MA', 'NYS:PG',
  'NYS:HD', 'NYS:CVX', 'NYS:ABBV', 'NYS:KO', 'NYS:BAC',
  'NYS:MRK', 'NYS:ORCL', 'NYS:PFE', 'NYS:CRM', 'NYS:DIS',
  'NYS:NKE', 'NYS:MCD', 'NYS:WFC', 'NYS:TMO', 'NYS:ABT',
];

export function getStaticOverseasUniverse(): string[] {
  // OVERSEAS_UNIVERSE_SYMBOLS 우선, 호환 폴백으로 ALLOWED_SYMBOLS_OVERSEAS도 인정
  const raw = process.env.OVERSEAS_UNIVERSE_SYMBOLS ?? process.env.ALLOWED_SYMBOLS_OVERSEAS ?? '';
  const env = raw.split(',').map(s => s.trim()).filter(Boolean);
  return env.length > 0 ? env : [...SP500_TOP50];
}
