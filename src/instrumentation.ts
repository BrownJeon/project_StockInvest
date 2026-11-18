/**
 * Next.js instrumentation hook (T-037).
 *
 * `register()` 는 **서버 프로세스당 1회**, 요청 처리 전에 호출된다(Next 15 에서 정식 기능 —
 * `experimental.instrumentationHook` 플래그 불필요. 이 프로젝트는 next 15.5.22).
 *
 * 여기서는 외부 접속 연결 시도 시간 설정(T-175)·`stockinvest-cron` 하트비트 워치독·텔레그램 폴러만 띄운다.
 * 무거운 초기화·DB 접근·주문 경로는 절대 넣지 않는다 — 이 훅이 실패하면 서버 기동 전체가 흔들린다.
 *
 * 배치 근거(T-037 §B-3): 이번 사고에서 cron(pm2 fork 모드)은 `spawn ENOENT` 로 유령이 됐지만
 * 앱(cluster 모드)은 크래시 루프 끝에 정상 복귀했다. **실패모드가 서로 달라서** 앱이 cron 을
 * 감시하는 구성이 성립한다.
 *
 * ⚠️ 다중 인스턴스 주의: `ecosystem.config.js` 는 `instances: 1` 이라 워치독도 1개만 돈다.
 *    인스턴스를 늘리면 같은 장애에 인스턴스 수만큼 알림이 나간다 — 그때는
 *    `CRON_WATCHDOG_ENABLED` 를 인스턴스별로 제어하거나 알림을 외부로 옮겨야 한다.
 */
/** T-175 — 외부 접속의 주소당 연결 시도 시간(ms). Node 기본 250. 근거는 아래 register() 주석. */
const OUTBOUND_CONNECT_ATTEMPT_TIMEOUT_MS = 2000;

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
    // T-175 — 외부 접속의 주소당 연결 시도 시간(Happy Eyeballs) 250ms → 2000ms. **맨 앞에 둔다**(워치독·폴러의 첫 fetch 보다 먼저).
    //
    // 이 서버는 IPv6 기본 경로가 없는데(`ip -6 route show default` 0줄) 외부 호스트 다수는 A·AAAA 를 둘 다 돌려준다.
    // Node 24 의 fetch(undici)는 `autoSelectFamily` 가 기본 켜져 있어, `--dns-result-order=ipv4first`(ecosystem.config.js)로
    // IPv4 를 먼저 시도하되 **250ms 안에 연결되지 않으면 끊고 IPv6 로 넘어간다** → `ENETUNREACH` → 요청 전체 실패
    // (`fetch failed` / `ETIMEDOUT <IPv4>` + `ENETUNREACH <IPv6>`). 텔레그램 TCP 연결은 실측 0.22~0.28초라 이 경계에 걸려 있었다.
    // 실측(2026-11-18, 서버, 매번 새 연결 90회): 기본 250ms → ETIMEDOUT 27·27회 / 2000ms → 0·3회. 근거·수치: T-175 이력서.
    //
    // 2000 을 고른 이유: IPv4 TCP 연결 시간(200회) p50 244ms·p90 278ms·1초 초과 7회·2초 초과 2회 — SYN 1회 재전송(약 1.25초)까지 덮는다.
    // 3초를 넘는 드문 연결(SYN 2회 재전송)은 기다리기보다 빨리 실패시키고 위쪽 재시도(텔레그램 1회 재시도·공시 알림 재시도)가
    // 새 연결을 여는 편이 낫다 — 공시 알림의 시도당 대기 상한이 5초다. IPv4 가 정말 죽은 호스트에서 IPv6 로 넘어가는 시점은
    // 이 값만큼 늦어지지만, 이 서버는 IPv6 가 원래 안 된다.
    //
    // 정본은 여기 하나다 — NODE_OPTIONS 의 `--network-family-autoselection-attempt-timeout` 은 쓰지 않는다. 배포(release.sh 의
    // `pm2 startOrReload --update-env`)로도 반영되겠지만, 코드에 두면 `npm run dev`·수동 기동 등 어떤 방식으로 떠도 같은 값이고
    // 단위 시험으로 고정할 수 있다. 이 설정은 이 웹 프로세스에만 적용된다(cron 러너는 curl 이라 무관).
    try {
      const net = await import('node:net');
      net.setDefaultAutoSelectFamilyAttemptTimeout(OUTBOUND_CONNECT_ATTEMPT_TIMEOUT_MS);
    } catch (e) {
      // 설정 실패가 서버 기동을 막아서는 안 된다 — 기본값(250ms)으로 계속 뜬다.
      console.error('[instrumentation] 연결 시도 시간 설정 실패:', e instanceof Error ? e.message : String(e));
    }

    try {
      const { startCronWatchdog } = await import('@/lib/ops/cron-watchdog');
      startCronWatchdog();
    } catch (e) {
      // 워치독 기동 실패가 **서버 기동을 막아서는 안 된다.** 감시가 없는 상태로라도 앱은 떠야 한다
      // (감시는 2차 방어선이고, 앱 정지는 그 자체로 1차 사고다).
      console.error('[instrumentation] cron 워치독 기동 실패:', e instanceof Error ? e.message : String(e));
    }

    // T-042 — 텔레그램 버튼 콜백 폴러. 같은 양수 조건 블록 안에 둔다(조기 return 형태 금지 — 위 설명 참조).
    // 지연 시작(30초)·모든 예외 삼킴·두 스위치(telegram_poller_enabled / telegram_approval_enabled, 기본 꺼짐).
    // 이 루프가 실패해도 서버 기동과 웹 승인 경로는 영향받지 않는다. 폴러는 거래 승인 권한을 가진 경로라
    // 이 파일은 훅 SAFETY_PATHS 에 포함돼 있다.
    try {
      const { startTelegramApprovalPoller } = await import('@/lib/signals/telegram-poller');
      startTelegramApprovalPoller();
    } catch (e) {
      console.error('[instrumentation] 텔레그램 폴러 기동 실패:', e instanceof Error ? e.message : String(e));
    }
  }
}
