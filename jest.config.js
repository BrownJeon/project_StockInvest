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
