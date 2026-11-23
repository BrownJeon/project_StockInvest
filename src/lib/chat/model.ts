import { HomeM4ApiCaller } from '@/lib/llm/home-m4-api';
import { getHomeM4ApiBase } from '@/lib/llm/provider';

export const STOCK_CHAT_MODEL = 'gemma4:12b';
export const STOCK_CHAT_PROVIDER = 'home-m4-api';

export interface StockChatPrompt {
  system: string;
  user: string;
}

/** Only chat endpoints use this caller. Shared provider and model settings are read by their existing callers. */
export async function runStockChat(prompt: StockChatPrompt, stage: 'draft' | 'answer', complex = false) {
  const think = stage === 'answer' && complex;
  const caller = new HomeM4ApiCaller(
    (await getHomeM4ApiBase()).replace(/\/+$/, ''),
    process.env.AI_API_KEY ?? '',
    STOCK_CHAT_MODEL,
    0.3,
  );
  const timeoutMs = think ? 180_000 : stage === 'draft' ? 60_000 : 120_000;
  return caller.call(prompt.user, { timeoutMs, responseFormat: 'text' }, {
    system: prompt.system,
    think,
    contextTokens: 8192,
    outputTokens: think ? 6144 : 2048,
  });
}
