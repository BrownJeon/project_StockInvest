import { CHAT_HEARTBEAT_HEADER, chatPostResponse } from '../response-heartbeat';

const liveRequest = () => new Request('http://example.invalid/api/chat/threads/1/messages', {
  method: 'POST', headers: { [CHAT_HEARTBEAT_HEADER]: '1' },
});

test('전송 대기 중 빈 줄을 보내고 준비된 결과와 원래 HTTP 상태를 전달한다', async () => {
  jest.useFakeTimers();
  try {
    let complete!: (res: Response) => void;
    const pending = new Promise<Response>(resolve => { complete = resolve; });
    const response = await chatPostResponse(liveRequest(), () => pending);
    expect(response.headers.get('X-Accel-Buffering')).toBe('no');
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    expect(decoder.decode((await reader.read()).value)).toBe('\n');
    jest.advanceTimersByTime(15_000);
    expect(decoder.decode((await reader.read()).value)).toBe('\n');
    complete(Response.json({ ok: false, error: 'thread not found' }, { status: 404 }));
    expect(JSON.parse(decoder.decode((await reader.read()).value))).toEqual({
      status: 404, body: { ok: false, error: 'thread not found' },
    });
    expect((await reader.read()).done).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    jest.useRealTimers();
  }
});

test('기존 요청은 원래 응답 객체와 상태를 그대로 반환한다', async () => {
  const status = Response.json({ ok: false }, { status: 404 });
  const request = new Request('http://example.invalid/api/chat/threads/1/messages', { method: 'POST' });
  expect(await chatPostResponse(request, async () => status)).toBe(status);
});

test('연결을 닫으면 타이머를 정리하고 늦은 결과를 스트림에 쓰지 않는다', async () => {
  jest.useFakeTimers();
  try {
    let complete!: (res: Response) => void;
    const pending = new Promise<Response>(resolve => { complete = resolve; });
    const response = await chatPostResponse(liveRequest(), () => pending);
    await response.body!.cancel();
    expect(jest.getTimerCount()).toBe(0);
    complete(Response.json({ ok: true }));
    await pending;
  } finally {
    jest.useRealTimers();
  }
});
