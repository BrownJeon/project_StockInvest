import { NextRequest, NextResponse } from 'next/server';
import { HomeM4ApiCaller } from '@/lib/llm/home-m4-api';
import type { LlmProvider } from '@/lib/llm/types';

export const dynamic = 'force-dynamic';

interface TestBody {
  provider?: LlmProvider;
  // home-m4-api (AI_API_KEY는 서버 .env에서 자동 주입)
  homeM4ApiBase?: string;
  homeM4ApiModel?: string;
  homeM4ApiTemperature?: number;
}

const TEST_PROMPT = `당신은 연결 테스트입니다. 아래 형식의 JSON으로만 응답하세요:
{"ok": true, "echo": "pong"}`;

export async function POST(req: NextRequest) {
  let body: TestBody;
  try {
    body = (await req.json()) as TestBody;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400 });
  }

  const provider: LlmProvider = body.provider ?? 'home-m4-api';

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
