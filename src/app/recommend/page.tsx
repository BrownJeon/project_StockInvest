'use client';

/**
 * 거래 탭 (`/recommend`) — T-108 에서 하단 탭 「거래」가 되었다. 옛 본문은 `TradeNowPanel`(운용 현황)로 옮겼고,
 * 이 파일은 틀(`TradePage`: 안전 상태 띠 → 세그먼트 → 본문)만 그린다. 옛 주소 `/recommend` 는 그대로 운용 현황이다.
 */
import { TradePage } from './TradePage';

export default function RecommendPage() {
  return <TradePage />;
}
