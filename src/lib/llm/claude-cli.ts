import { spawn } from 'node:child_process';
import { trackChild } from '@/lib/api-usage';
import type { LlmCallOptions, LlmCaller, ClaudeModel } from './types';

const ALLOWED_MODELS: ReadonlyArray<ClaudeModel> = ['sonnet', 'opus', 'haiku'];

function resolveModel(input?: string): ClaudeModel {
  if (input && (ALLOWED_MODELS as readonly string[]).includes(input)) return input as ClaudeModel;
  return 'sonnet';
}

// 모듈 레벨 전역 큐 — ClaudeCliCaller 인스턴스 수와 무관하게 항상 직렬화
let globalCliQueue: Promise<unknown> = Promise.resolve();

/**
 * Claude CLI subprocess 호출.
 *
 * 과거 이슈 + 해결책:
 *  - `--tools ''`, `--system-prompt`, `--no-session-persistence`은 현재 CLI 버전에서 "Execution error" 유발 → 사용 금지
 *  - `--output-format json`은 effortLevel null 버그 → 사용 금지
 *  - 부모 프로세스에 `CLAUDECODE=1` 있으면 중첩 실행 감지로 SIGTERM(exit 143) → env에서 제거 필수
 *  - `ANTHROPIC_API_KEY`에 크레딧 소진 키가 있으면 hang → 제거하고 ~/.claude 구독 인증 fallback
 *  - **동시 호출 시 100% "Execution error" 자종료** → provider.ts 의 cliQueue 로 직렬화
 *  - **순차 호출도 ~30% 간헐 "Execution error"** → provider.ts 에서 2회까지 재시도
 *  - cwd=/tmp : 프로젝트 CLAUDE.md 컨텍스트 격리
 *  - 정상 작동 조합: `claude -p <prompt> --permission-mode bypassPermissions --model sonnet`
 */
export class ClaudeCliCaller implements LlmCaller {
  call(prompt: string, opts: LlmCallOptions = {}): Promise<string> {
    // 전역 큐에 직렬화 — 동시 호출 시 100% Execution error / exit 143 방지
    const prev = globalCliQueue;
    const next = prev.then(() => this._invoke(prompt, opts), () => this._invoke(prompt, opts));
    globalCliQueue = next.catch(() => {});
    return next;
  }

  private _invoke(prompt: string, opts: LlmCallOptions = {}): Promise<string> {
    const timeoutMs = opts.timeoutMs ?? 90000;
    const model = resolveModel(opts.model);
    // T-169 — system 지시는 `--system-prompt`(위 주석: 이 CLI 버전에서 Execution error)를 쓰지 않고 본문 앞에 합친다.
    // system 이 없으면(다른 모든 호출부) 인자는 T-169 이전과 같다. numCtx 는 Ollama 전용이라 무시한다.
    const fullPrompt = typeof opts.system === 'string' && opts.system.length > 0
      ? `${opts.system}\n\n${prompt}`
      : prompt;
    return new Promise((resolve, reject) => {
      // 부모가 Claude Code 세션일 때 claude CLI가 중첩 실행 감지 → SIGTERM(exit 143) 자종료.
      // 관련 감지 env 전부 제거해야 정상 동작.
      const cleanEnv: NodeJS.ProcessEnv = { ...process.env };
      for (const k of [
        'CLAUDECODE',
        'CLAUDE_CODE_ENTRYPOINT',
        'CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING',
        'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS',
        'CLAUDE_CODE_EXECPATH',
        'CLAUDE_AGENT_SDK_VERSION',
        'VSCODE_IPC_HOOK_CLI',
        'VSCODE_CLI_REQUIRE_TOKEN',
        'VSCODE_HANDLES_UNCAUGHT_ERRORS',
        'VSCODE_HANDLES_SIGPIPE',
        'VSCODE_ESM_ENTRYPOINT',
        'VSCODE_L10N_BUNDLE_LOCATION',
        'VSCODE_NLS_CONFIG',
        'VSCODE_AGENT_FOLDER',
        'VSCODE_CWD',
        'ELECTRON_RUN_AS_NODE',
        // 크레딧 소진된 API key가 설정되어 있으면 CLI가 그 키로 호출하다 hang → exit 143.
        // 제거하면 ~/.claude 구독 인증으로 fallback되어 정상 작동.
        'ANTHROPIC_API_KEY',
      ]) delete cleanEnv[k];

      const proc = spawn('claude', [
        '--print', fullPrompt,
        ...(opts.toolFree
          ? ['--tools', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
              '--setting-sources', '', '--settings', '{"disableAllHooks":true}',
              '--disable-slash-commands', '--no-session-persistence']
          : ['--permission-mode', 'bypassPermissions']),
        '--model', model,
      ], {
        timeout: timeoutMs,
        cwd: '/tmp',
        env: cleanEnv,
        // stdin을 ignore로 차단 — PM2에서 부모 pipe가 열려있으면 CLI가 입력 대기로 hang.
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      // T-040 호출 기록 — close/error 때 한 줄(종료 코드만, 프롬프트·출력 없음). spawn timeout 으로 죽으면 timeout.
      trackChild('claude-cli', 'llm.call', proc, { err: (info) => (info.killed ? 'timeout' : undefined) });

      let out = '';
      let err = '';
      proc.stdout.on('data', (d: Buffer) => { out += d.toString(); });
      proc.stderr.on('data', (d: Buffer) => { err += d.toString(); });
      proc.on('error', (e: NodeJS.ErrnoException) => {
        if (e.code === 'ENOENT') reject(new Error('claude CLI not found in PATH'));
        else reject(e);
      });
      proc.on('close', (code: number | null) => {
        if (code !== 0 && code !== null) return reject(new Error(err.trim() || `claude exit ${code}`));
        const trimmed = out.trim();
        if (trimmed === 'Execution error' || trimmed.startsWith('Execution error\n')) {
          return reject(new Error(`claude Execution error: ${err.trim() || 'no stderr'}`));
        }
        resolve(trimmed);
      });
    });
  }
}
