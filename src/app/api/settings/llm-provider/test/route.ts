import { NextRequest, NextResponse } from 'next/server';
import { HomeM4ApiCaller } from '@/lib/llm/home-m4-api';
import { getProviderConfig } from '@/lib/llm/provider';
import { isStage1Model, STAGE1_SCREEN_TIMEOUT_MS } from '@/lib/llm/stage1-models';
import type { LlmProvider } from '@/lib/llm/types';

export const dynamic = 'force-dynamic';

interface TestBody {
  provider?: LlmProvider;
  // home-m4-api (AI_API_KEY는 서버 .env에서 자동 주입)
  homeM4ApiBase?: string;
  homeM4ApiModel?: string;
  homeM4ApiTemperature?: number;
  stage1Model?: unknown;
}

const TEST_PROMPT = `당신은 연결 테스트입니다. 아래 형식의 JSON으로만 응답하세요:
{"ok": true, "echo": "pong"}`;

const STAGE1_SAMPLE = {
  symbol: 'STAGE1_TEST',
  verdict: 'escalate',
  confidence: 0.5,
  ev_estimate_pct: 0,
};

const STAGE1_TEST_SYSTEM = 'StockInvest Stage 1 모델 점검입니다. 사용자 메시지의 JSON만 그대로 출력하세요.';
const STAGE1_TEST_PROMPT = JSON.stringify({
  decisions: [{ ...STAGE1_SAMPLE, reasoning_short: '점검용 응답' }],
});

async function checkStage1Model(model: unknown) {
  if (!isStage1Model(model)) {
    return NextResponse.json({ ok: false, error: '목록에서 Stage 1 모델을 선택해 주세요.' }, { status: 400 });
  }
  const startedAt = Date.now();
  try {
    const { homeM4ApiBase, homeM4ApiTemperature } = await getProviderConfig();
    const caller = new HomeM4ApiCaller(
      (homeM4ApiBase ?? '').replace(/\/+$/, ''),
      process.env.AI_API_KEY ?? '',
      model,
      homeM4ApiTemperature ?? 0.3,
    );
    const raw = await caller.call(STAGE1_TEST_PROMPT, {
      timeoutMs: STAGE1_SCREEN_TIMEOUT_MS,
      responseFormat: 'json',
      system: STAGE1_TEST_SYSTEM,
      requireModelMatch: true,
    });
    let matches = false;
    try {
      const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? '');
      const decisions = parsed?.decisions;
      const decision = decisions?.[0];
      matches = Array.isArray(decisions) && decisions.length === 1
        && decision?.symbol === STAGE1_SAMPLE.symbol
        && decision?.verdict === STAGE1_SAMPLE.verdict
        && decision?.confidence === STAGE1_SAMPLE.confidence
        && decision?.ev_estimate_pct === STAGE1_SAMPLE.ev_estimate_pct
        && typeof decision?.reasoning_short === 'string'
        && decision.reasoning_short.trim().length > 0;
    } catch { /* JSON 형식이 올바르지 않음 */ }
    return NextResponse.json({
      ok: matches,
      model,
      durationMs: Date.now() - startedAt,
      ...(!matches && { error: '응답이 Stage 1 점검 형식과 일치하지 않습니다.' }),
    });
  } catch (error) {
    let reason = '모델 호출에 실패했습니다.';
    if (error instanceof Error) {
      if (/timeout/i.test(error.message)) reason = '모델 응답 시간 초과';
      if (error.message === 'home-m4-api model mismatch') reason = '다른 모델이 응답했습니다.';
    }
    return NextResponse.json({
      ok: false,
      model,
      durationMs: Date.now() - startedAt,
      error: reason,
    });
  }
}

export async function POST(req: NextRequest) {
  let body: TestBody;
  try {
    body = (await req.json()) as TestBody;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400 });
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400 });
  }
  const provider: LlmProvider = body.provider ?? 'home-m4-api';

  if (provider === 'hybrid') return checkStage1Model(body.stage1Model);

  if (provider !== 'home-m4-api') {
    return NextResponse.json({ ok: false, error: '연결 테스트는 home-m4-api 만 지원합니다' }, { status: 400 });
  }

  const url   = String(body.homeM4ApiBase ?? '').trim();
  const model = String(body.homeM4ApiModel ?? '').trim();
  if (!url || !/^https?:\/\//.test(url)) {
    return NextResponse.json({ ok: false, error: 'API Base URL은 http:// 또는 https:// 로 시작해야 합니다' }, { status: 400 });
  }
  if (!model) {
    return NextResponse.json({ ok: false, error: '모델명을 입력해주세요' }, { status: 400 });
  }
  const apiKey = process.env.AI_API_KEY ?? '';
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: 'AI_API_KEY 가 .env에 설정되어 있지 않습니다' }, { status: 400 });
  }
  const temp = Number.isFinite(Number(body.homeM4ApiTemperature)) ? Number(body.homeM4ApiTemperature) : 0.3;
  const caller = new HomeM4ApiCaller(url, apiKey, model, temp);
  const tested: Record<string, unknown> = { provider, url, model, temperature: temp };

  const startedAt = Date.now();

  try {
    const raw = await caller.call(TEST_PROMPT, { timeoutMs: 30000, responseFormat: 'json' });
    const durationMs = Date.now() - startedAt;

    // JSON 파싱 시도 (실패해도 연결 자체는 성공으로 본다)
    let parsedSample: unknown = null;
    let jsonOk = false;
    try {
      const cleaned = raw.replace(/```(?:json)?/g, '').replace(/```/g, '').trim();
      const start = cleaned.indexOf('{');
      const end = cleaned.lastIndexOf('}');
      if (start !== -1 && end !== -1) {
        parsedSample = JSON.parse(cleaned.slice(start, end + 1));
        jsonOk = true;
      }
    } catch { /* ignore */ }

    return NextResponse.json({
      ok: true,
      durationMs,
      responseSample: raw.slice(0, 500),
      jsonOk,
      parsed: parsedSample,
      tested,
    });
  } catch (e) {
    const durationMs = Date.now() - startedAt;
    const error = e instanceof Error ? e.message : String(e);
    let hint = '';
    if (/ECONNREFUSED|fetch failed|ENOTFOUND/i.test(error))      hint = '서버 주소가 올바른지·LLM 서버가 실행 중인지 확인하세요.';
    else if (/timeout/i.test(error))                              hint = '타임아웃 — 모델 로딩 중이거나 응답이 느립니다. 잠시 후 재시도.';
    else if (/HTTP 401|HTTP 403/i.test(error))                    hint = '인증 실패 — AI_API_KEY 가 올바른지 확인하세요.';
    else if (/HTTP 404/i.test(error))                             hint = '모델명 또는 endpoint가 잘못되었을 수 있습니다.';
    else if (/HTTP 5\d\d/i.test(error))                           hint = 'LLM 서버 내부 오류. 서버 로그를 확인하세요.';
    return NextResponse.json({
      ok: false,
      durationMs,
      error,
      hint,
      tested,
    }, { status: 200 });
  }
}
