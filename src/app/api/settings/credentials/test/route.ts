import { NextRequest, NextResponse } from 'next/server';
import { kis } from '@/lib/exchanges/kis';
import { getKisToken } from '@/lib/exchanges/kis-auth';
import { getCredential } from '@/lib/credentials';
import { trackCall, type ApiId, type Op } from '@/lib/api-usage';

export const dynamic = 'force-dynamic';

type TestTarget = 'exchange' | 'telegram' | 'slack';

interface TestBody { target?: TestTarget; }

interface TestResult {
  ok: boolean;
  target: TestTarget;
  durationMs: number;
  detail?: string;
  error?: string;
  hint?: string;
}

async function testExchange(): Promise<TestResult> {
  const startedAt = Date.now();
  try {
    // 1) 토큰 발급으로 키 자체 검증
    const token = await getKisToken();
    if (!token) throw new Error('토큰 발급 실패');
    // 2) 잔고 조회로 계좌 검증
    const balances = await kis.getBalances();
    const krw = balances.find(b => b.currency === 'KRW');
    const heldCount = balances.filter(b => b.currency !== 'KRW' && b.currency !== 'USD' && (Number(b.free) + Number(b.locked)) > 0).length;
    return {
      ok: true,
      target: 'exchange',
      durationMs: Date.now() - startedAt,
      detail: `토큰 발급 + 잔고 조회 성공 — KRW ${krw ? Math.round(Number(krw.free)).toLocaleString('ko-KR') : 0}원, 보유 종목 ${heldCount}개`,
    };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    let hint = '';
    if (/KIS_APP_KEY|KIS_APP_SECRET|미설정|not set/i.test(error))   hint = 'App Key / App Secret 등록 여부 확인';
    else if (/EGW00133|1분당 1회/i.test(error))                     hint = 'KIS는 1분당 1회 토큰 재발급 제한 — 1분 후 재시도';
    else if (/EGW00123|만료/i.test(error))                          hint = '토큰 만료 — 자동 재발급되지만 키 자체 문제일 수 있음';
    else if (/401|invalid|unauthor/i.test(error))                   hint = '인증 실패 — App Key/Secret 정확성·KIS_MOCK 환경 일치 여부 확인';
    else if (/CANO|계좌|account/i.test(error))                      hint = '계좌번호 / 상품코드 확인';
    else if (/network|fetch failed|ECONNREFUSED/i.test(error))      hint = '네트워크 오류 — KIS API 접속 가능 여부 확인';
    return { ok: false, target: 'exchange', durationMs: Date.now() - startedAt, error, hint };
  }
}

/** `api`·`op` 는 T-040 호출 기록용 코드 상수 — 시도 1번 = 한 줄. URL(토큰·웹훅 주소 포함)은 기록되지 않는다. */
async function fetchWithRetry(api: ApiId, op: Op, url: string, init: RequestInit, attempts = 3, backoffMs = 500): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10_000);
      try {
        const res = await trackCall(api, op, () => fetch(url, { ...init, signal: ctrl.signal }),
          { err: () => (ctrl.signal.aborted ? 'timeout' : undefined) });
        return res;
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      // fetch failed / abort / ECONNRESET 류는 재시도
      if (i < attempts - 1 && /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|aborted|UND_ERR/i.test(msg)) {
        await new Promise(r => setTimeout(r, backoffMs * (i + 1)));
        continue;
      }
      throw e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('unreachable');
}

async function testTelegram(): Promise<TestResult> {
  const startedAt = Date.now();
  const [token, chatId, projectTag] = await Promise.all([
    getCredential('TELEGRAM_BOT_TOKEN'),
    getCredential('TELEGRAM_CHAT_ID'),
    getCredential('NOTIFY_PROJECT_TAG'),
  ]);
  if (!token || !chatId) {
    return { ok: false, target: 'telegram', durationMs: Date.now() - startedAt,
      error: 'Bot Token 또는 Chat ID 가 등록되어 있지 않습니다.', hint: '두 값 모두 등록 후 재시도' };
  }
  const project = projectTag.trim() || 'StockInvest';
  try {
    const text = `<b>[${project}] 🔌 연결 테스트</b>\n알람 연동 성공\n🕐 ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} KST`;
    const res = await fetchWithRetry('telegram', 'test.send-message', `https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, parse_mode: 'HTML', text }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      let hint = '';
      if (res.status === 401)        hint = 'Bot Token 이 유효하지 않습니다.';
      else if (res.status === 400)   hint = 'Chat ID 가 잘못되었거나 봇이 해당 채팅에 추가되지 않았습니다.';
      return { ok: false, target: 'telegram', durationMs: Date.now() - startedAt,
        error: `HTTP ${res.status}: ${body.slice(0, 200)}`, hint };
    }
    return { ok: true, target: 'telegram', durationMs: Date.now() - startedAt,
      detail: '테스트 메시지 발송 성공 — 텔레그램 앱에서 확인하세요.' };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    // 메시지 발송 실패 시 getMe 로 진단 시도 (Bot Token 자체는 유효한지 빠르게 확인)
    let diag = '';
    try {
      const probe = await fetchWithRetry('telegram', 'test.get-me', `https://api.telegram.org/bot${token}/getMe`, { method: 'GET' }, 2, 300);
      if (probe.ok) {
        const j = (await probe.json().catch(() => null)) as { result?: { username?: string } } | null;
        diag = ` (Bot Token 검증 OK${j?.result?.username ? ` — @${j.result.username}` : ''}, 메시지 발송만 실패)`;
      } else {
        diag = ` (Bot Token 자체 유효성 의심: getMe ${probe.status})`;
      }
    } catch { /* getMe 도 실패 — 순수 네트워크 문제 */ }
    return { ok: false, target: 'telegram', durationMs: Date.now() - startedAt,
      error: error + diag,
      hint: diag.includes('Bot Token 검증 OK')
        ? 'Bot Token 자체는 유효 — 일시적 네트워크 흔들림 또는 sendMessage rate-limit. 재시도 권장.'
        : '서버에서 api.telegram.org 로의 outbound 네트워크 차단 또는 DNS 문제 가능성.',
    };
  }
}

async function testSlack(): Promise<TestResult> {
  const startedAt = Date.now();
  const [url, projectTag] = await Promise.all([
    getCredential('SLACK_WEBHOOK_URL'),
    getCredential('NOTIFY_PROJECT_TAG'),
  ]);
  if (!url) {
    return { ok: false, target: 'slack', durationMs: Date.now() - startedAt,
      error: 'Slack Webhook URL 이 등록되어 있지 않습니다.', hint: 'Webhook URL 등록 후 재시도' };
  }
  const project = projectTag.trim() || 'StockInvest';
  try {
    const payload = {
      attachments: [{
        color: '#22c55e',
        blocks: [
          { type: 'section', text: { type: 'mrkdwn', text: `*[${project}] 🔌 연결 테스트*\n알람 연동 성공` } },
          { type: 'context', elements: [{ type: 'mrkdwn', text: `🕐 ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} KST` }] },
        ],
      }],
    };
    const res = await fetchWithRetry('slack', 'test.webhook', url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      let hint = '';
      if (res.status === 404 || /no_team/i.test(body))      hint = 'Webhook URL 이 유효하지 않거나 만료되었습니다.';
      else if (res.status === 403)                          hint = 'Webhook 권한이 없습니다.';
      return { ok: false, target: 'slack', durationMs: Date.now() - startedAt,
        error: `HTTP ${res.status}: ${body.slice(0, 200)}`, hint };
    }
    return { ok: true, target: 'slack', durationMs: Date.now() - startedAt,
      detail: '테스트 메시지 발송 성공 — Slack 채널에서 확인하세요.' };
  } catch (e) {
    return { ok: false, target: 'slack', durationMs: Date.now() - startedAt,
      error: e instanceof Error ? e.message : String(e),
      hint: '네트워크 연결을 확인하세요.' };
  }
}

export async function POST(req: NextRequest) {
  let body: TestBody;
  try {
    body = (await req.json()) as TestBody;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400 });
  }
  const target = body.target;
  if (target !== 'exchange' && target !== 'telegram' && target !== 'slack') {
    return NextResponse.json({ ok: false, error: 'target must be exchange|telegram|slack' }, { status: 400 });
  }
  const result =
    target === 'exchange' ? await testExchange()
    : target === 'telegram' ? await testTelegram()
    : await testSlack();
  return NextResponse.json(result);
}
