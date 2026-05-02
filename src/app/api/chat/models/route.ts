import { NextResponse } from 'next/server';
import { getActiveProvider, getProviderConfig } from '@/lib/llm/provider';

export const dynamic = 'force-dynamic';

/**
 * 채팅 입력창 모델 셀렉터용 — 현재 active provider에 따라 선택 가능 모델 목록.
 *  - claude: sonnet/opus/haiku 중 사용자 선택
 *  - home-m4-api: 설정값으로 고정 (단일 옵션, fixed=true)
 */
export async function GET() {
  const provider = await getActiveProvider();
  if (provider === 'claude') {
    return NextResponse.json({
      ok: true,
      provider,
      models: [
        { id: 'sonnet', label: 'Sonnet (균형)' },
        { id: 'opus',   label: 'Opus (고성능)' },
        { id: 'haiku',  label: 'Haiku (빠름)' },
      ],
      fixed: false,
      default: 'sonnet',
    });
  }
  // home-m4-api: 설정에 정의된 모델 1개 고정
  const cfg = await getProviderConfig();
  const modelId = cfg.homeM4ApiModel ?? 'llama3';
  return NextResponse.json({
    ok: true,
    provider,
    models: [{ id: modelId, label: `${modelId} (설정값 고정)` }],
    fixed: true,
    default: modelId,
  });
}
