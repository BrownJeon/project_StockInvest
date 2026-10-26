/**
 * T-096 백테스트 엔진 진입점 — 러너(scripts/profit-engine/backtest-runner.mjs)가 이 파일 하나를 싣는다.
 * 앱 매매 경로는 이 폴더를 참조하지 않는다(격리 시험).
 */
export * from './types';
export * from './frames';
export * from './costs';
export * from './fill';
export * from './episodes';
export * from './baseline';
export * from './metrics';
export * from './regime';
export * from './portfolio';
export * from './pipeline';
export { SIGNALS, signalModule } from './signals';
export type { SignalModule } from './signals';
export * from '../registry/hash';
export * from '../registry/registry';
export * from '../registry/oos-ledger';
export * from '../registry/evaluate-pass';
