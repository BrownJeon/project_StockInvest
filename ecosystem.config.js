/** @type {import('pm2').StartOptions} */
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
      },
      out_file: `${process.env.HOME}/.node-local/stockinvest/logs/pm2-out.log`,
      error_file: `${process.env.HOME}/.node-local/stockinvest/logs/pm2-err.log`,
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
    {
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
      out_file: `${process.env.HOME}/.node-local/stockinvest/logs/cron-out.log`,
      error_file: `${process.env.HOME}/.node-local/stockinvest/logs/cron-err.log`,
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
