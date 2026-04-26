import { NextRequest, NextResponse } from 'next/server';
import { OllamaCaller } from '@/lib/llm/ollama';

export const dynamic = 'force-dynamic';

interface TestBody {
  ollamaBaseUrl?: string;
  ollamaModel?: string;
  ollamaTemperature?: number;
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

  const url = String(body.ollamaBaseUrl ?? '').trim();
  const model = String(body.ollamaModel ?? '').trim();
  if (!url || !/^https?:\/\//.test(url)) {
    return NextResponse.json({ ok: false, error: '서버 URL은 http:// 또는 https:// 로 시작해야 합니다' }, { status: 400 });
  }
  if (!model) {
    return NextResponse.json({ ok: false, error: '모델명을 입력해주세요' }, { status: 400 });
  }
  const temp = Number.isFinite(Number(body.ollamaTemperature)) ? Number(body.ollamaTemperature) : 0.3;

  const caller = new OllamaCaller(url, model, temp);
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
      tested: { url, model, temperature: temp },
    });
  } catch (e) {
    const durationMs = Date.now() - startedAt;
    const error = e instanceof Error ? e.message : String(e);
    let hint = '';
    if (/ECONNREFUSED|fetch failed|ENOTFOUND/i.test(error))      hint = '서버 주소가 올바른지·Ollama가 실행 중인지 확인하세요.';
    else if (/timeout/i.test(error))                              hint = '타임아웃 — 모델 로딩 중이거나 응답이 느립니다. 잠시 후 재시도.';
    else if (/HTTP 404/i.test(error))                             hint = '모델명이 잘못되었을 수 있습니다. (Ollama에 해당 모델이 pull 되어 있는지 확인)';
    else if (/HTTP 5\d\d/i.test(error))                           hint = 'Ollama 서버 내부 오류. 서버 로그를 확인하세요.';
    return NextResponse.json({
      ok: false,
      durationMs,
      error,
      hint,
      tested: { url, model, temperature: temp },
    }, { status: 200 });   // 200으로 응답 (UI에서 결과 객체로 표시)
  }
}
