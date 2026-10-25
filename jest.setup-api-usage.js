/**
 * jest 공통 setup — 외부 API 호출 기록(T-040, `@workspace/api-usage`)이 시험 중 `<cwd>/logs` 에 쌓이지 않게 한다.
 *
 * 패키지는 `API_USAGE_LOG_DIR` 이 비어 있으면 `<cwd>/logs` 에 쓴다. 시험이 그대로 돌면 개발 미러의
 * `logs/api-usage-*.jsonl` 에 시험 줄이 섞인다. 그래서 **값이 비어 있을 때만** 시험 파일마다 임시 디렉터리
 * (os.tmpdir() 아래 mkdtemp)로 돌리고, 그 파일의 시험이 끝나면 지운다.
 *
 * - 이미 값이 있으면(밖에서 지정했거나) 손대지 않는다.
 * - 시험이 스스로 `API_USAGE_LOG_DIR` 를 바꾸는 경우(쓸 수 없는 경로 시험 등)도 그대로 동작한다 —
 *   이 파일은 시작 값만 정하고, 지우는 것은 자신이 만든 디렉터리뿐이다.
 * - `setupFilesAfterEnv` 에 둔 이유: 시험 파일 단위 정리(afterAll)가 필요해서다(`setupFiles` 에서는 쓸 수 없다).
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let created = null;
if (!(process.env.API_USAGE_LOG_DIR || '').trim()) {
  created = fs.mkdtempSync(path.join(os.tmpdir(), 'stockinvest-jest-api-usage-'));
  process.env.API_USAGE_LOG_DIR = created;
}

afterAll(() => {
  if (!created) return;
  try {
    fs.rmSync(created, { recursive: true, force: true });
  } catch {
    /* 임시 디렉터리 정리 실패는 시험 결과와 무관하다 */
  }
});
