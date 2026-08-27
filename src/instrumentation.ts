/**
 * Next.js instrumentation hook (T-037).
 *
 * `register()` 는 **서버 프로세스당 1회**, 요청 처리 전에 호출된다(Next 15 에서 정식 기능 —
 * `experimental.instrumentationHook` 플래그 불필요. 이 프로젝트는 next 15.5.22).
 *
 * 여기서는 `stockinvest-cron` 하트비트 워치독만 띄운다. 무거운 초기화·DB 접근·주문 경로는
 * 절대 넣지 않는다 — 이 훅이 실패하면 서버 기동 전체가 흔들린다.
 *
 * 배치 근거(T-037 §B-3): 이번 사고에서 cron(pm2 fork 모드)은 `spawn ENOENT` 로 유령이 됐지만
 * 앱(cluster 모드)은 크래시 루프 끝에 정상 복귀했다. **실패모드가 서로 달라서** 앱이 cron 을
 * 감시하는 구성이 성립한다.
 *
 * ⚠️ 다중 인스턴스 주의: `ecosystem.config.js` 는 `instances: 1` 이라 워치독도 1개만 돈다.
 *    인스턴스를 늘리면 같은 장애에 인스턴스 수만큼 알림이 나간다 — 그때는
 *    `CRON_WATCHDOG_ENABLED` 를 인스턴스별로 제어하거나 알림을 외부로 옮겨야 한다.
 */
export async function register(): Promise<void> {
  // Edge 런타임에는 fs·타이머 수명이 다르다. Node 런타임에서만 띄운다.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  try {
    const { startCronWatchdog } = await import('@/lib/ops/cron-watchdog');
    startCronWatchdog();
  } catch (e) {
    // 워치독 기동 실패가 **서버 기동을 막아서는 안 된다.** 감시가 없는 상태로라도 앱은 떠야 한다
    // (감시는 2차 방어선이고, 앱 정지는 그 자체로 1차 사고다).
    console.error('[instrumentation] cron 워치독 기동 실패:', e instanceof Error ? e.message : String(e));
  }
}
