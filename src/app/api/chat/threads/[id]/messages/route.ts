import { chatPostResponse } from '@/lib/chat/response-heartbeat';
import { NextRequest, NextResponse } from 'next/server';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { databaseId, parseThreadId, ownedThread, requireChatUser } from '@/lib/chat/ownership';
import { STOCK_CHAT_MODEL, STOCK_CHAT_PROVIDER, runStockChat } from '@/lib/chat/model';
import { resolveSymbolsInText } from '@/lib/chat/symbol-resolver';
import { buildSymbolContexts, formatSymbolContextsAsText, type SymbolContext } from '@/lib/chat/context-builder';
import { cleanDraftPrompt, normalizeChatAnswer } from '@/lib/chat/answer-format';
import { buildOverviewContext } from '@/lib/chat/overview-context';
import { answerStockChat } from '@/lib/chat/grounded-answer';
import { bodyText, checkChatTextLimits, explicitSymbols, validAttachedContext } from '@/lib/chat/request-guard';
import {
  CHAT_HISTORY_LIMIT,
  buildAnalystRequest,
  buildDrafterRequest,
  formatRecentMessages,
} from '@/lib/chat/chat-request';
import { ANALYST_STYLE_LABEL, getStyleConfig } from '@/lib/strategy/style';

export const dynamic = 'force-dynamic';

const RECENT_HISTORY_LIMIT = CHAT_HISTORY_LIMIT;

interface BodyShape {
  content?: string;
  attachedSymbols?: string[];      // 명시 첨부 종목 코드
  attachedContext?: SymbolContext[]; // /draft 응답 echo (재계산 회피)
  draftPrompt?: string;             // 사용자가 편집·확정한 정제 프롬프트
  modelOverride?: string;           // 계약상 수용만 한다(무시) — 채팅 모델은 Gemma 고정
  skipDraftStage?: boolean;
}

/**
 * GET — thread 메시지 목록.
 * T-169 A4: assistant 메시지 본문은 **표시용으로만** 정규화한다(예전에 저장된 JSON 답도 문장으로 — 안내 문구 없이 문장만, 사용자 결정).
 * DB 원본은 바꾸지 않는다. 사용자 메시지는 그대로.
 */
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
      content:        r.role === 'assistant' ? normalizeChatAnswer(r.content) : (r.content as string),
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
  return chatPostResponse(req, () => handlePost(req, params));
}

async function handlePost(req: NextRequest, params: Promise<{ id: string }>) {
  const auth = await requireChatUser(req);
  if (!auth.ok) return auth.res;
  const threadId = parseThreadId((await params).id);
  if (threadId === null) {
    return NextResponse.json({ ok: false, error: 'invalid thread id' }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as BodyShape;
  const userContent = bodyText(body.content);
  if (!userContent) return NextResponse.json({ ok: false, error: 'content required' }, { status: 400 });
  // T-169 Reviewer M1 — 질문·다듬은 질문 각각 2,000자 상한(DB·LLM 이전에 거절, 화면 오류 띠가 읽는 한국어 error)
  const limitError = checkChatTextLimits({ content: userContent, draftPrompt: bodyText(body.draftPrompt) });
  if (limitError) return NextResponse.json({ ok: false, error: limitError }, { status: 400 });

  const pool = getPool();

  // thread 존재 확인
  const [threadRows] = await pool.query<RowDataPacket[]>(
    'SELECT t.id FROM chat_threads t INNER JOIN users u ON u.id = t.user_id WHERE t.id = ? AND t.user_id = ? LIMIT 1', [threadId, auth.userId],
  );
  if (threadRows.length === 0) {
    return NextResponse.json({ ok: false, error: 'thread not found' }, { status: 404 });
  }

  // 컨텍스트 — body.attachedContext 가 검증을 통과하면(최대 3개·필드 타입) echo, 아니면 서버에서 재계산(T-169 M1·L3)
  let symbolContexts: SymbolContext[];
  const echoed = validAttachedContext(body.attachedContext);
  if (echoed) {
    symbolContexts = echoed;
  } else {
    const resolved = await resolveSymbolsInText(userContent);
    const explicit = explicitSymbols(body.attachedSymbols);
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
  // T-169 — 메시지당 300자(B2), assistant 의 예전 JSON 답은 문장으로 바꿔 넣는다(다시 JSON 답을 부르지 않게)
  const recentMessages = formatRecentMessages(historyRows.reverse());

  // T-169 B1·B2 — 시스템 수집 데이터 요약. 읽기 전용, 절별 실패 격리라 던지지 않는다. drafter 와 겹쳐 돌린다.
  const overviewPromise = buildOverviewContext({ userId: auth.userId, now: new Date() });

  // 정제 프롬프트 — skipDraftStage=true이거나 body.draftPrompt 미지정 시 즉석 생성
  const confirmedQuestion = bodyText(body.draftPrompt);
  let draftPrompt = confirmedQuestion;
  let draftPromptRaw: string | null = null;

  const analystStyle = ANALYST_STYLE_LABEL;   // 프롬프트 표기용 라벨 (룰 선별과 무관 — D3)
  const style = await getStyleConfig();
  // 채팅 전용 호출자(Gemma 고정)의 표시·저장 이름 — 전역 제공자·모델 설정은 읽지 않는다
  const provider = STOCK_CHAT_PROVIDER;
  const recordedModel = STOCK_CHAT_MODEL;

  if (!draftPrompt) {
    // skipDraftStage 또는 누락 — 서버에서 즉석 정제 (T-169: 지시는 system 으로 분리, JSON 이면 원문 질문으로 대체)
    const drafter = buildDrafterRequest({ analystStyle, style, userInput: userContent, attachedSummary });
    // 호출이 던지면(모드·정상 완료 검증 실패 포함) 그대로 전파 — 빈 정제문으로 저장·성공 처리하지 않는다
    draftPromptRaw = await runStockChat(drafter, 'draft');
    draftPrompt = cleanDraftPrompt(draftPromptRaw, userContent, symbolContexts.map(c => c.symbol), historyRows.map((r) => String(r.content ?? '')).join('\n'));
  }

  // 본 응답 생성 — 지시는 system 메시지로(home-m4-api 의 시그널 평가 JSON 지시 주입 차단), 수집 데이터 요약 첨부
  const overview = await overviewPromise;
  const analyst = buildAnalystRequest({
    analystStyle, style, refinedPrompt: draftPrompt, attachedSummary, recentMessages, overviewText: overview.text,
  });
  let latencyMs = 0;
  // 계산·확인은 사용자 원문(userContent)으로만 한다 — 다듬은 질문의 수치로 계산하지 않는다.
  // 정규화(JSON → 문장) → 승률·계산 제한 → 새 답 후처리(굵게·제목 기호 제거, 끝 줄 참고용 고지,
  //   언급한 엔진 후보의 상태 줄 = 요약을 만들 때 쓴 후보 목록, 자료 기준 시각 줄 = 요약 빌더가 넣은 절의 값)를 저장 **전**에 한다.
  // 복합 계산의 확인된 출력 한도만 서버 계산으로 대체하며, 모델·사고 모드가 맞지 않으면 저장하지 않는다.
  const normalized = await answerStockChat(
    { question: userContent, confirmedQuestion, rows: symbolContexts, style, request: analyst, attachedSummary },
    async (prompt, think) => {
      const t0 = Date.now();
      try {
        return await runStockChat(prompt, 'answer', think);
      } finally {
        latencyMs = Date.now() - t0;
      }
    },
    {
      overviewText: overview.text,
      sources: { news: (overview.sections ?? []).includes('news') },
      finalize: { candidates: overview.candidates ?? [], sourceTimes: overview.sourceTimes ?? [] },
    },
  );
  if (normalized.source !== 'text') {
    console.warn(`[chat] answer normalized source=${normalized.source} provider=${provider} model=${recordedModel}`);
  }
  const responseText = normalized.text;

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
      [threadId, responseText, provider, recordedModel, latencyMs],
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
    llmModel: recordedModel,
    latencyMs,
    contextAttached: symbolContexts,
    threadTitle: newTitle,
  });
}
