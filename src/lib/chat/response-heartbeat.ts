export const CHAT_HEARTBEAT_HEADER = 'X-Stock-Chat-Heartbeat';
const HEARTBEAT_MS = 15_000;

/** Browser opt-in keeps a long chat response active across the existing reverse proxy. */
export function chatPostResponse(req: Request, handle: () => Promise<Response>): Response | Promise<Response> {
  if (req.headers.get(CHAT_HEARTBEAT_HEADER) !== '1') return handle();

  const encoder = new TextEncoder();
  let cancelled = false;
  let interval: ReturnType<typeof setInterval>;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const heartbeat = encoder.encode('\n');
      controller.enqueue(heartbeat);
      interval = setInterval(() => controller.enqueue(heartbeat), HEARTBEAT_MS);

      void (async () => {
        let status = 500;
        let body: unknown = { ok: false, error: '챗봇 응답을 완료하지 못했습니다. 다시 시도해 주세요.' };
        try {
          const result = await handle();
          body = await result.json();
          status = result.status;
        } catch (error) {
          console.error('[chat] response failed', error instanceof Error ? error.name : 'unknown');
        } finally {
          clearInterval(interval);
          if (!cancelled) {
            controller.enqueue(encoder.encode(JSON.stringify({ status, body })));
            controller.close();
          }
        }
      })();
    },
    cancel() {
      cancelled = true;
      clearInterval(interval);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      'X-Accel-Buffering': 'no',
      [CHAT_HEARTBEAT_HEADER]: '1',
    },
  });
}
