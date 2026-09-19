/** @type {import('pm2').StartOptions} */
// 이 파일은 **릴리스 디렉토리 안에서 평가된다**: /home/brownjeon/apps/stockinvest/releases/<타임스탬프>/
// 2026-09-19 컷오버로 운영이 NFS 편집 트리 직접 구동에서 blue/green 릴리스 구조로 옮겨졌다.
// 절차서: docs/deploy-order.md
//
// cwd 는 __dirname 이다 — Node 가 realpath 로 해석해 **구체적인 릴리스 경로**가 된다.
// 'current' 문자열을 넣으면 심볼릭 링크가 옮겨간 뒤에도 pm2 에 적힌 값은 그대로라
// "새 릴리스를 가리키는 것처럼" 보이지만 프로세스는 옛 코드를 돌린다 —
// 배포 스크립트가 그 상태를 감지하지 못해 **거짓 성공**이 된다
// (release.sh 의 ensure_current_cwd 가 이 비교에 의존한다).
const fs = require('node:fs')

// pm2 는 out_file/error_file 의 **상위 디렉토리를 만들어 주지 않는다** — 없으면 로그 파일을
// 열지 못해 기동에 실패하고, 그 실패 자체가 어떤 로그에도 남지 않는다
// (VoiceVault 2026-09-02 실장애: 204회 크래시 루프 → 502, 로그 0건).
//
// 로그는 릴리스가 아니라 `shared/` 에 둔다 — 릴리스는 5개만 보관하고 지워지므로
// 릴리스 안에 두면 과거 로그가 함께 사라진다.
const LOG_DIR = '/home/brownjeon/apps/stockinvest/shared/logs'
fs.mkdirSync(LOG_DIR, { recursive: true })

module.exports = {
  apps: [
    {
      name: 'stockinvest',
      script: './node_modules/next/dist/bin/next',
      args: 'start -H 0.0.0.0 -p 3003',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT: '3003',
        // IPv6 unreachable on this host (Telegram outbound ETIMEDOUT). 강제 IPv4-first DNS.
        NODE_OPTIONS: '--dns-result-order=ipv4first',
      },
      out_file: `${LOG_DIR}/pm2-out.log`,
      error_file: `${LOG_DIR}/pm2-err.log`,
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
    {
      // ⚠️ 이 앱이 **두 개 떠 있으면 주문·집계가 두 번 돈다.** 컷오버·배포 후 반드시
      //    `pm2 list | grep stockinvest-cron` 이 1행인지 확인한다.
      name: 'stockinvest-cron',
      script: './scripts/cron-runner.sh',
      interpreter: 'bash',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '128M',
      env: {
        NODE_ENV: 'production',
      },
      out_file: `${LOG_DIR}/cron-out.log`,
      error_file: `${LOG_DIR}/cron-err.log`,
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
}
