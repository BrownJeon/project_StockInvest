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
  // 🔴 이 `if` 의 형태를 바꾸지 말 것 — 런타임 분기가 아니라 **빌드타임 분기**다.
  //
  // 이 프로젝트에는 `src/middleware.ts`(Edge)가 있다. 그래서 Next 는 `instrumentation` 을
  // Node 컴파일러와 **Edge 컴파일러 양쪽 엔트리로 등록**한다(`next/dist/build/entries.js` —
  // 엔트리를 지우는 최적화는 "Edge 컴파일러에 instrumentation 하나뿐일 때"만 적용되는데,
  // 미들웨어가 있으니 해당되지 않는다). 즉 이 파일은 **Edge 번들로도 컴파일된다.**
  //
  // 한편 `process.env.NEXT_RUNTIME` 은 컴파일러별 DefinePlugin 상수다
  // (`next/dist/build/define-env.js`: edge → 'edge', node → 'nodejs').
  // 따라서 아래를 **양수 조건의 `if` 블록**으로 쓰면 Edge 컴파일에서 `if ('edge' === 'nodejs')`
  // 가 되어 webpack ConstPlugin 이 블록째로 제거하고, 그 안의 `import()` 는 모듈 그래프에
  // 아예 등록되지 않는다. 반대로 `if (... !== 'nodejs') return;` 같은 **조기 return** 형태로
  // 쓰면 webpack 이 return 이후 구문을 죽은 코드로 판정하지 못해 `import()` 가 그대로 남고,
  // `cron-watchdog → notify/throttle → notify/index → db → mysql2` 체인의 Node 전용 모듈
  // (`crypto`·`timers`·`stream`)과 `node:fs`·`node:os`·`node:path` 가 Edge 번들에서
  // 해석 불가가 되어 **빌드가 통째로 깨진다.** (T-037 재순환에서 실제로 발생한 사고)
  //
  // 요약: 조기 return = 런타임 가드일 뿐, 번들 제외를 보장하지 않는다. 아래가 공식 패턴이다.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    try {
      const { startCronWatchdog } = await import('@/lib/ops/cron-watchdog');
      startCronWatchdog();
    } catch (e) {
      // 워치독 기동 실패가 **서버 기동을 막아서는 안 된다.** 감시가 없는 상태로라도 앱은 떠야 한다
      // (감시는 2차 방어선이고, 앱 정지는 그 자체로 1차 사고다).
      console.error('[instrumentation] cron 워치독 기동 실패:', e instanceof Error ? e.message : String(e));
    }
  }
}
