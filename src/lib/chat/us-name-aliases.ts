/**
 * T-169 B3 — 미국 대형주 한글 별칭 고정 표(비서 채팅 종목 인식 전용).
 *
 * `stock_meta` 해외 행의 이름은 영문(`NAS:NVDA` = `NVIDIA CORP`)이고 한글 미국 종목명 원천이 DB 에 없어(KIS 해외 마스터 한글명 수집은
 * 후속 후보) 자주 묻는 종목만 손으로 적는다. 실행 때 `stock_meta` 에 있는 심볼(NAS→NYS→AMS 순)만 채택하고 없으면 버린다
 * (`symbol-resolver.ts`).
 *
 * `blockedSuffixes`: 별칭 바로 뒤에 이 글자가 오면 다른 낱말이라 인식하지 않는다(예: 「메타버스」의 「메타」, 「애플리케이션」의 「애플」).
 * 조사(「엔비디아는」·「애플이」)는 막지 않는다.
 */
export interface UsNameAlias {
  alias: string;
  /** 거래소 접두어 없는 티커 — 실행 때 NAS:/NYS:/AMS: 순으로 stock_meta 에서 찾는다 */
  ticker: string;
  blockedSuffixes?: readonly string[];
}

export const US_NAME_ALIASES: readonly UsNameAlias[] = [
  { alias: '엔비디아', ticker: 'NVDA' },
  { alias: '애플', ticker: 'AAPL', blockedSuffixes: ['리케이션', '파이', '망고'] },
  { alias: '테슬라', ticker: 'TSLA' },
  { alias: '마이크로소프트', ticker: 'MSFT' },
  { alias: '아마존', ticker: 'AMZN', blockedSuffixes: ['강'] },
  { alias: '알파벳', ticker: 'GOOGL' },
  { alias: '구글', ticker: 'GOOGL' },
  { alias: '메타', ticker: 'META', blockedSuffixes: ['버스', '데이터', '포', '인지', '물질', '볼릭', '모델'] },
  { alias: '브로드컴', ticker: 'AVGO' },
  { alias: '넷플릭스', ticker: 'NFLX' },
  { alias: '팔란티어', ticker: 'PLTR' },
  { alias: '에이엠디', ticker: 'AMD' },
  { alias: '인텔', ticker: 'INTC', blockedSuffixes: ['리', '렉'] },
  { alias: '퀄컴', ticker: 'QCOM' },
  { alias: '마이크론', ticker: 'MU' },
  { alias: '샌디스크', ticker: 'SNDK' },
  { alias: '오라클', ticker: 'ORCL' },
  { alias: '세일즈포스', ticker: 'CRM' },
  { alias: '어도비', ticker: 'ADBE' },
  { alias: '코스트코', ticker: 'COST' },
  { alias: '월마트', ticker: 'WMT' },
  { alias: '일라이릴리', ticker: 'LLY' },
  { alias: '일라이 릴리', ticker: 'LLY' },
  { alias: '코카콜라', ticker: 'KO' },
  { alias: '맥도날드', ticker: 'MCD' },
  { alias: '디즈니', ticker: 'DIS', blockedSuffixes: ['랜드'] },
  { alias: '나이키', ticker: 'NKE' },
  { alias: '스타벅스', ticker: 'SBUX' },
  { alias: '보잉', ticker: 'BA' },
  { alias: '제이피모건', ticker: 'JPM' },
  { alias: 'JP모건', ticker: 'JPM' },
  { alias: '마스터카드', ticker: 'MA' },
  { alias: '코인베이스', ticker: 'COIN' },
  { alias: '슈퍼마이크로', ticker: 'SMCI' },
  { alias: '시놉시스', ticker: 'SNPS' },
  { alias: '마벨', ticker: 'MRVL' },
  { alias: '마이크로칩', ticker: 'MCHP' },
  { alias: '포티넷', ticker: 'FTNT' },
  { alias: '데이터독', ticker: 'DDOG' },
  { alias: '크라우드스트라이크', ticker: 'CRWD' },
  { alias: '서비스나우', ticker: 'NOW' },
  { alias: '스노우플레이크', ticker: 'SNOW' },
  { alias: '쇼피파이', ticker: 'SHOP' },
  { alias: '우버', ticker: 'UBER' },
  { alias: '아이온큐', ticker: 'IONQ' },
  { alias: '로빈후드', ticker: 'HOOD' },
  { alias: '엑슨모빌', ticker: 'XOM' },
  { alias: '셰브론', ticker: 'CVX' },
  { alias: '버티브', ticker: 'VRT' },
  { alias: '티에스엠씨', ticker: 'TSM' },
  { alias: '에이에스엠엘', ticker: 'ASML' },
];
