import { NextRequest, NextResponse } from 'next/server';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { databaseId, parseThreadId, ownedThread, requireChatUser } from '@/lib/chat/ownership';
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
import { ANALYST_STYLE_LABEL, getStyleConfig } from '@/lib/strategy/style';

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
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireChatUser(req);
  if (!auth.ok) return auth.res;
  const threadId = parseThreadId((await params).id);
  if (threadId === null) {
    return NextResponse.json({ ok: false, error: 'invalid thread id' }, { status: 400 });
  }
  const pool = getPool();
  if (!(await ownedThread(pool, threadId, auth.userId))) {
    return NextResponse.json({ ok: false, error: 'thread not found' }, { status: 404 });
  }
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT m.id, m.role, m.content, m.draft_prompt, m.draft_prompt_raw, m.context_attached,
            m.llm_provider, m.llm_model, m.latency_ms, m.created_at
     FROM chat_messages m INNER JOIN chat_threads t ON t.id = m.thread_id
     INNER JOIN users u ON u.id = t.user_id
     WHERE m.thread_id = ? AND t.user_id = ? ORDER BY m.id ASC`,
    [threadId, auth.userId],
  );
  if (rows.some(r => databaseId(r.id) === null)) {
    return NextResponse.json({ ok: false, error: 'unsafe identifier' }, { status: 503 });
  }
  return NextResponse.json({
    ok: true,
    messages: rows.map(r => ({
      id:             databaseId(r.id),
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
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireChatUser(req);
  if (!auth.ok) return auth.res;
  const threadId = parseThreadId((await params).id);
  if (threadId === null) {
    return NextResponse.json({ ok: false, error: 'invalid thread id' }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as BodyShape;
  const userContent = (body.content ?? '').trim();
  if (!userContent) return NextResponse.json({ ok: false, error: 'content required' }, { status: 400 });

  const pool = getPool();

  // thread 존재 확인
  const [threadRows] = await pool.query<RowDataPacket[]>(
    'SELECT t.id FROM chat_threads t INNER JOIN users u ON u.id = t.user_id WHERE t.id = ? AND t.user_id = ? LIMIT 1', [threadId, auth.userId],
  );
  if (threadRows.length === 0) {
    return NextResponse.json({ ok: false, error: 'thread not found' }, { status: 404 });
  }

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
    `SELECT m.role, m.content FROM chat_messages m
     INNER JOIN chat_threads t ON t.id = m.thread_id
     INNER JOIN users u ON u.id = t.user_id
     WHERE m.thread_id = ? AND t.user_id = ?
     ORDER BY m.id DESC LIMIT ?`,
    [threadId, auth.userId, RECENT_HISTORY_LIMIT],
  );
  const recentMessages = historyRows
    .reverse()
    .map(r => `${r.role === 'user' ? '사용자' : '분석가'}: ${String(r.content).slice(0, 500)}`)
    .join('\n');

  // 정제 프롬프트 — skipDraftStage=true이거나 body.draftPrompt 미지정 시 즉석 생성
  let draftPrompt = (body.draftPrompt ?? '').trim();
  let draftPromptRaw: string | null = null;

  const analystStyle = ANALYST_STYLE_LABEL;   // 프롬프트 표기용 라벨 (룰 선별과 무관 — D3)
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

  // Lock only the short persistence transaction, never while waiting for the LLM.
  // Re-check ownership under lock so concurrent deletion/reassignment cannot write
  // a response into a thread that no longer belongs to this user.
  const connection = await pool.getConnection();
  let userMessageId: number;
  let assistantMessageId: number;
  let newTitle: string;
  try {
    await connection.beginTransaction();
    const [locked] = await connection.query<RowDataPacket[]>(
      'SELECT t.id, t.title FROM chat_threads t INNER JOIN users u ON u.id = t.user_id WHERE t.id = ? AND t.user_id = ? FOR UPDATE',
      [threadId, auth.userId],
    );
    if (locked.length === 0) {
      await connection.rollback();
      return NextResponse.json({ ok: false, error: 'thread not found' }, { status: 404 });
    }
    const contextJson = symbolContexts.length > 0 ? JSON.stringify(symbolContexts) : null;
    const [userIns] = await connection.query<ResultSetHeader>(
      `INSERT INTO chat_messages (thread_id, role, content, draft_prompt, draft_prompt_raw, context_attached)
       VALUES (?, 'user', ?, ?, ?, ?)`,
      [threadId, userContent, draftPrompt, draftPromptRaw, contextJson],
    );
    const [asstIns] = await connection.query<ResultSetHeader>(
      `INSERT INTO chat_messages (thread_id, role, content, llm_provider, llm_model, latency_ms)
       VALUES (?, 'assistant', ?, ?, ?, ?)`,
      [threadId, responseText, provider, finalModel, latencyMs],
    );
    const currentTitle = String(locked[0].title);
    newTitle = currentTitle === '새 대화' && userContent.length > 0
      ? userContent.slice(0, 30) : currentTitle;
    await connection.query(
      `UPDATE chat_threads SET message_count = message_count + 2, title = ? WHERE id = ? AND user_id = ?`,
      [newTitle, threadId, auth.userId],
    );
    const safeUserMessageId = databaseId(userIns.insertId);
    const safeAssistantMessageId = databaseId(asstIns.insertId);
    if (safeUserMessageId === null || safeAssistantMessageId === null) {
      await connection.rollback();
      return NextResponse.json({ ok: false, error: 'unsafe identifier' }, { status: 503 });
    }
    await connection.commit();
    userMessageId = safeUserMessageId;
    assistantMessageId = safeAssistantMessageId;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  return NextResponse.json({
    ok: true,
    userMessageId,
    assistantMessageId,
    response: responseText,
    llmProvider: provider,
    llmModel: finalModel,
    latencyMs,
    contextAttached: symbolContexts,
    threadTitle: newTitle,
  });
}
