import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { runLlm, getActiveProvider, getProviderConfig } from '@/lib/llm/provider';
import { resolveSymbolsInText } from '@/lib/chat/symbol-resolver';
import { buildSymbolContexts, formatSymbolContextsAsText } from '@/lib/chat/context-builder';
import { buildDrafterSystemPrompt, buildDrafterUserMessage } from '@/lib/chat/system-prompt';
import { ANALYST_STYLE_LABEL, getStyleConfig } from '@/lib/strategy/style';

export const dynamic = 'force-dynamic';

const RECENT_HISTORY_LIMIT = 8;

interface BodyShape {
  content?: string;
  attachedSymbols?: string[];
  modelOverride?: string;
}

/**
 * 1단계: 사용자 자유 질의 → 정제 프롬프트 + 첨부 컨텍스트 생성 (DB 저장 안 함).
 * 응답을 사용자가 검토·편집 후 POST /messages로 확정 전송.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const threadId = Number((await params).id);
  if (!Number.isFinite(threadId) || threadId <= 0) {
    return NextResponse.json({ ok: false, error: 'invalid thread id' }, { status: 400 });
  }
  const body = (await req.json().catch(() => ({}))) as BodyShape;
  const userContent = (body.content ?? '').trim();
  if (!userContent) return NextResponse.json({ ok: false, error: 'content required' }, { status: 400 });

  const pool = getPool();
  // thread 존재 확인 (스레드 없는데 draft만 시도하는 경우 차단)
  const [threadRows] = await pool.query<RowDataPacket[]>(
    'SELECT id FROM chat_threads WHERE id = ? LIMIT 1', [threadId],
  );
  if (threadRows.length === 0) {
    return NextResponse.json({ ok: false, error: 'thread not found' }, { status: 404 });
  }

  // 종목 인식 + 컨텍스트
  const resolved = await resolveSymbolsInText(userContent);
  const explicit = (body.attachedSymbols ?? [])
    .filter((s): s is string => typeof s === 'string' && s.length > 0)
    .map(s => ({ symbol: s, name: s, matchedText: s }));
  const merged = [...resolved];
  for (const e of explicit) if (!merged.some(r => r.symbol === e.symbol)) merged.push(e);
  const contexts = await buildSymbolContexts(merged);
  const attachedSummary = formatSymbolContextsAsText(contexts);

  // 최근 대화 (이전 메시지 컨텍스트)
  const [historyRows] = await pool.query<RowDataPacket[]>(
    `SELECT role, content FROM chat_messages WHERE thread_id = ?
     ORDER BY id DESC LIMIT ?`,
    [threadId, RECENT_HISTORY_LIMIT],
  );
  const recentMessages = historyRows
    .reverse()
    .map(r => `${r.role === 'user' ? '사용자' : '분석가'}: ${String(r.content).slice(0, 300)}`)
    .join('\n');

  // 모델 — Claude 활성 시 사용자 modelOverride(허용 시) 또는 haiku, 로컬LLM은 설정값
  const provider = await getActiveProvider();
  const cfg = await getProviderConfig();
  const isAllowed = (m: unknown): m is 'sonnet' | 'opus' | 'haiku' =>
    typeof m === 'string' && (m === 'sonnet' || m === 'opus' || m === 'haiku');
  const draftModel = provider === 'claude'
    ? (isAllowed(body.modelOverride) ? body.modelOverride : 'haiku')
    : (cfg.homeM4ApiModel ?? 'qwen2.5:14b-instruct');

  const analystStyle = ANALYST_STYLE_LABEL;   // 프롬프트 표기용 라벨 (룰 선별과 무관 — D3)
  const style = await getStyleConfig();
  const drafterSystem = buildDrafterSystemPrompt({ analystStyle, style, attachedSummary, recentMessages });
  const drafterUser = buildDrafterUserMessage(userContent, attachedSummary);

  const t0 = Date.now();
  const draftPrompt = await runLlm(`${drafterSystem}\n\n${drafterUser}`, {
    timeoutMs: 60_000,
    responseFormat: 'text',
    model: draftModel,
  });
  const draftLatencyMs = Date.now() - t0;

  return NextResponse.json({
    ok: true,
    draftPrompt: draftPrompt.trim(),
    attachedContext: contexts,
    draftLatencyMs,
    draftProvider: provider,
    draftModel,
  });
}
