export const STAGE1_MODEL_OPTIONS = [
  { id: 'gemma4:12b', label: 'Gemma 4 12B' },
  { id: 'qwen3:8b', label: 'Qwen3 8B' },
  { id: 'qwen2.5:14b-instruct', label: 'Qwen2.5 14B Instruct' },
] as const;

export type Stage1Model = (typeof STAGE1_MODEL_OPTIONS)[number]['id'];

export const DEFAULT_STAGE1_MODEL: Stage1Model = STAGE1_MODEL_OPTIONS[0].id;
export const STAGE1_SCREEN_TIMEOUT_MS = 30_000;

export function isStage1Model(value: unknown): value is Stage1Model {
  return STAGE1_MODEL_OPTIONS.some(({ id }) => id === value);
}
