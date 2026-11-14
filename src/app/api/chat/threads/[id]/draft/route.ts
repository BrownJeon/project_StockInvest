import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { parseThreadId, ownedThread, requireChatUser } from '@/lib/chat/ownership';
import { runLlm, getActiveProvider, getProviderConfig } from '@/lib/llm/provider';
import { resolveSymbolsInText } from '@/lib/chat/symbol-resolver';
import { buildSymbolContexts, formatSymbolContextsAsText } from '@/lib/chat/context-builder';
import { cleanDraftPrompt } from '@/lib/chat/answer-format';
import { bodyText, checkChatTextLimits, explicitSymbols } from '@/lib/chat/request-guard';
import {
  CHAT_HISTORY_LIMIT,
  CHAT_NUM_CTX,
  buildDrafterRequest,
  chatModelLabel,
  formatRecentMessages,
} from '@/lib/chat/chat-request';
import { ANALYST_STYLE_LABEL, getStyleConfig } from '@/lib/strategy/style';

export const dynamic = 'force-dynamic';

const RECENT_HISTORY_LIMIT = CHAT_HISTORY_LIMIT;

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
  const auth = await requireChatUser(req);
  if (!auth.ok) return auth.res;
  const threadId = parseThreadId((await params).id);
  if (threadId === null) {
    return NextResponse.json({ ok: false, error: 'invalid thread id' }, { status: 400 });
  }
  const body = (await req.json().catch(() => ({}))) as BodyShape;
  const userContent = bodyText(body.content);
  if (!userContent) return NextResponse.json({ ok: false, error: 'content required' }, { status: 400 });
  // T-169 Reviewer M1 — 질문 2,000자 상한(DB·LLM 이전에 거절, 화면 오류 띠가 읽는 한국어 error)
  const limitError = checkChatTextLimits({ content: userContent });
  if (limitError) return NextResponse.json({ ok: false, error: limitError }, { status: 400 });

  const pool = getPool();
  // thread 존재 확인 (스레드 없는데 draft만 시도하는 경우 차단)
  if (!(await ownedThread(pool, threadId, auth.userId))) {
    return NextResponse.json({ ok: false, error: 'thread not found' }, { status: 404 });
  }

  // 종목 인식 + 컨텍스트
  const resolved = await resolveSymbolsInText(userContent);
  const explicit = explicitSymbols(body.attachedSymbols);
  const merged = [...resolved];
  for (const e of explicit) if (!merged.some(r => r.symbol === e.symbol)) merged.push(e);
  const contexts = await buildSymbolContexts(merged);
  const attachedSummary = formatSymbolContextsAsText(contexts);

  // 최근 대화 (이전 메시지 컨텍스트)
  const [historyRows] = await pool.query<RowDataPacket[]>(
    `SELECT m.role, m.content FROM chat_messages m
     INNER JOIN chat_threads t ON t.id = m.thread_id
     INNER JOIN users u ON u.id = t.user_id
     WHERE m.thread_id = ? AND t.user_id = ?
     ORDER BY m.id DESC LIMIT ?`,
    [threadId, auth.userId, RECENT_HISTORY_LIMIT],
  );
  const recentMessages = formatRecentMessages(historyRows.reverse());

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
  // T-169 A2·A3 — 지시는 system 메시지로 분리(home-m4-api 의 시그널 평가 JSON 지시 주입 차단)
  const drafter = buildDrafterRequest({ analystStyle, style, userInput: userContent, attachedSummary, recentMessages });

  const t0 = Date.now();
  const draftRaw = await runLlm(drafter.user, {
    system: drafter.system,
    numCtx: CHAT_NUM_CTX,
    timeoutMs: 60_000,
    responseFormat: 'text',
    model: draftModel,
  });
  const draftLatencyMs = Date.now() - t0;
  // T-169 A4 — JSON 이 섞이면 다듬은 질문 대신 사용자 원문을 돌려준다(사용자가 검토·편집한다)
  const draftPrompt = cleanDraftPrompt(draftRaw, userContent);

  // A thread can be removed or transferred while the model is running.
  if (!(await ownedThread(pool, threadId, auth.userId))) {
    return NextResponse.json({ ok: false, error: 'thread not found' }, { status: 404 });
  }
  return NextResponse.json({
    ok: true,
    draftPrompt,
    attachedContext: contexts,
    draftLatencyMs,
    draftProvider: provider,
    draftModel: chatModelLabel(provider, cfg, draftModel),   // T-169 A5 — hybrid 는 실제 호출 모델(stage1_model)
  });
}
