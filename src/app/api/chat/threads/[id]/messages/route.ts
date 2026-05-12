import { NextRequest, NextResponse } from 'next/server';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { runLlm } from '@/lib/llm/provider';
import { getActiveProvider, getProviderConfig } from '@/lib/llm/provider';
import { resolveSymbolsInText } from '@/lib/chat/symbol-resolver';
import { buildSymbolContexts, formatSymbolContextsAsText, type SymbolContext } from '@/lib/chat/context-builder';
import {
  buildAnalystSystemPrompt,
  buildAnalystUserMessage,
  buildDrafterSystemPrompt,
  buildDrafterUserMessage,
} from '@/lib/chat/system-prompt';
import { getAnalystStyle, getStyleConfig } from '@/lib/strategy/style';

export const dynamic = 'force-dynamic';

const RECENT_HISTORY_LIMIT = 8;

interface BodyShape {
  content?: string;
  attachedSymbols?: string[];      // 명시 첨부 종목 코드
  attachedContext?: SymbolContext[]; // /draft 응답 echo (재계산 회피)
  draftPrompt?: string;             // 사용자가 편집·확정한 정제 프롬프트
  modelOverride?: string;
  skipDraftStage?: boolean;
}

/** GET — thread 메시지 목록 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const threadId = Number(params.id);
  if (!Number.isFinite(threadId) || threadId <= 0) {
    return NextResponse.json({ ok: false, error: 'invalid thread id' }, { status: 400 });
  }
  const pool = getPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, role, content, draft_prompt, draft_prompt_raw, context_attached,
            llm_provider, llm_model, latency_ms, created_at
     FROM chat_messages WHERE thread_id = ?
     ORDER BY id ASC`,
    [threadId],
  );
  return NextResponse.json({
    ok: true,
    messages: rows.map(r => ({
      id:             Number(r.id),
      role:           r.role as 'user' | 'assistant' | 'system',
      content:        r.content as string,
      draftPrompt:    r.draft_prompt as string | null,
      draftPromptRaw: r.draft_prompt_raw as string | null,
      contextAttached: r.context_attached
        ? (typeof r.context_attached === 'string' ? JSON.parse(r.context_attached) : r.context_attached)
        : null,
      llmProvider:    r.llm_provider ?? null,
      llmModel:       r.llm_model ?? null,
      latencyMs:      r.latency_ms != null ? Number(r.latency_ms) : null,
      createdAt:      r.created_at,
    })),
  });
}

/** POST — 사용자 정제 프롬프트(또는 원문)로 본 응답 생성 + DB 저장 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const threadId = Number(params.id);
  if (!Number.isFinite(threadId) || threadId <= 0) {
    return NextResponse.json({ ok: false, error: 'invalid thread id' }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as BodyShape;
  const userContent = (body.content ?? '').trim();
  if (!userContent) return NextResponse.json({ ok: false, error: 'content required' }, { status: 400 });

  const pool = getPool();

  // thread 존재 확인
  const [threadRows] = await pool.query<RowDataPacket[]>(
    'SELECT id, title FROM chat_threads WHERE id = ? LIMIT 1', [threadId],
  );
  if (threadRows.length === 0) {
    return NextResponse.json({ ok: false, error: 'thread not found' }, { status: 404 });
  }
  const currentTitle = String(threadRows[0].title);

  // 컨텍스트 — body.attachedContext가 있으면 echo, 없으면 재계산
  let symbolContexts: SymbolContext[];
  if (Array.isArray(body.attachedContext) && body.attachedContext.length > 0) {
    symbolContexts = body.attachedContext;
  } else {
    const resolved = await resolveSymbolsInText(userContent);
    const explicit = (body.attachedSymbols ?? [])
      .filter((s): s is string => typeof s === 'string' && s.length > 0)
      .map(s => ({ symbol: s, name: s, matchedText: s }));
    const merged = [...resolved];
    for (const e of explicit) if (!merged.some(r => r.symbol === e.symbol)) merged.push(e);
    symbolContexts = await buildSymbolContexts(merged);
  }
  const attachedSummary = formatSymbolContextsAsText(symbolContexts);

  // 최근 8개 메시지 (컨텍스트 윈도우)
  const [historyRows] = await pool.query<RowDataPacket[]>(
    `SELECT role, content FROM chat_messages WHERE thread_id = ?
     ORDER BY id DESC LIMIT ?`,
    [threadId, RECENT_HISTORY_LIMIT],
  );
  const recentMessages = historyRows
    .reverse()
    .map(r => `${r.role === 'user' ? '사용자' : '분석가'}: ${String(r.content).slice(0, 500)}`)
    .join('\n');

  // 정제 프롬프트 — skipDraftStage=true이거나 body.draftPrompt 미지정 시 즉석 생성
  let draftPrompt = (body.draftPrompt ?? '').trim();
  let draftPromptRaw: string | null = null;

  const analystStyle = await getAnalystStyle();
  const style = await getStyleConfig();
  const provider = await getActiveProvider();
  const cfg = await getProviderConfig();

  // 모델 화이트리스트 (Claude 한정)
  const isAllowedClaudeModel = (m: unknown): m is 'sonnet' | 'opus' | 'haiku' =>
    typeof m === 'string' && (m === 'sonnet' || m === 'opus' || m === 'haiku');
  const finalModel = provider === 'claude'
    ? (isAllowedClaudeModel(body.modelOverride) ? body.modelOverride : 'sonnet')
    : (cfg.homeM4ApiModel ?? 'qwen2.5:14b-instruct');

  if (!draftPrompt) {
    // skipDraftStage 또는 누락 — 서버에서 즉석 정제
    const drafterSystem = buildDrafterSystemPrompt({ analystStyle, style, attachedSummary, recentMessages });
    const drafterUser = buildDrafterUserMessage(userContent, attachedSummary);
    const drafterModel = provider === 'claude' ? 'haiku' : (cfg.homeM4ApiModel ?? 'qwen2.5:14b-instruct');
    draftPromptRaw = await runLlm(`${drafterSystem}\n\n${drafterUser}`, {
      timeoutMs: 60_000,
      responseFormat: 'text',
      model: drafterModel,
    });
    draftPrompt = draftPromptRaw.trim();
  }

  // 본 응답 생성
  const analystSystem = buildAnalystSystemPrompt({ analystStyle, style, attachedSummary, recentMessages });
  const analystUser = buildAnalystUserMessage(draftPrompt, attachedSummary, recentMessages);
  const t0 = Date.now();
  const responseText = await runLlm(`${analystSystem}\n\n${analystUser}`, {
    timeoutMs: 120_000,
    responseFormat: 'text',
    model: finalModel,
  });
  const latencyMs = Date.now() - t0;

  // DB 저장 — user 메시지 + assistant 메시지
  const contextJson = symbolContexts.length > 0 ? JSON.stringify(symbolContexts) : null;
  const [userIns] = await pool.query<ResultSetHeader>(
    `INSERT INTO chat_messages (thread_id, role, content, draft_prompt, draft_prompt_raw, context_attached)
     VALUES (?, 'user', ?, ?, ?, ?)`,
    [threadId, userContent, draftPrompt, draftPromptRaw, contextJson],
  );
  const [asstIns] = await pool.query<ResultSetHeader>(
    `INSERT INTO chat_messages (thread_id, role, content, llm_provider, llm_model, latency_ms)
     VALUES (?, 'assistant', ?, ?, ?, ?)`,
    [threadId, responseText, provider, finalModel, latencyMs],
  );

  // thread 갱신 — message_count 증가, title 자동 (첫 메시지면)
  const newTitle = currentTitle === '새 대화' && userContent.length > 0
    ? userContent.slice(0, 30)
    : currentTitle;
  await pool.query(
    `UPDATE chat_threads SET message_count = message_count + 2, title = ? WHERE id = ?`,
    [newTitle, threadId],
  );

  return NextResponse.json({
    ok: true,
    userMessageId: userIns.insertId,
    assistantMessageId: asstIns.insertId,
    response: responseText,
    llmProvider: provider,
    llmModel: finalModel,
    latencyMs,
    contextAttached: symbolContexts,
    threadTitle: newTitle,
  });
}
