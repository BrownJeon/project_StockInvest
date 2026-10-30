/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts', '**/*.test.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  // T-040: 시험 중 api-usage 기록이 <cwd>/logs 에 쌓이지 않게 임시 디렉터리로 돌린다(값이 비어 있을 때만).
  setupFilesAfterEnv: ['<rootDir>/jest.setup-api-usage.js'],
  moduleNameMapper: {
    // T-108: CSS Module(ops.module.css)은 시험에서 클래스 이름 그대로 돌려주는 스텁으로 — 반드시 `@/` 보다 앞(첫 일치만 쓴다)
    '\\.module\\.css$': '<rootDir>/src/components/ops/__tests__/helpers/css-module-proxy.js',
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  transform: {
    '^.+\\.(t|j)sx?$': [
      '@swc/jest',
      {
        jsc: {
          parser: { syntax: 'typescript', tsx: true },
          target: 'es2022',
        },
      },
    ],
  },
};
