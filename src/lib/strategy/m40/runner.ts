import type { JsonValue, SignalDraft, StoredAnalysisRun, StoredJudgment } from '@/lib/analysis-data/types';
import { planM40 } from './core';
import type { M40EvidenceIssue } from './load-evidence';
import type { M40Input, M40Plan } from './types';
import {
  advisoryPrompt, contentHash, eligiblePatternReferences, M40_ADVISORY_POLICY,
  M40_STAGES, parseAdvisoryAnswer, stableJson, stageTriggers, validateEvidence,
  type AdvisoryAnswer, type AdvisoryRequest, type AdvisoryTrigger,
  type M40Evidence, type M40PatternReference, type M40PatternQueryStarts,
} from './advisory';

export const M40_RUN_POLICY = 't156-m40-v1';
const agentFlights = new Map<string, Promise<AdvisoryAnswer>>();

export interface M40RunStore {
  saveAnalysisRun(run: StoredAnalysisRun): Promise<string>;
  putJudgment(judgment: StoredJudgment): Promise<void>;
  findJudgment(stage: StoredJudgment['stage'], eventHash: string): Promise<StoredJudgment | null>;
  putSignalDraft(draft: SignalDraft): Promise<void>;
}

export interface M40RunOptions {
  input: M40Input;
  evidence?: readonly M40Evidence[];
  patterns?: readonly M40PatternReference[];
  triggers?: readonly AdvisoryTrigger[];
  /** Explicitly opting into the existing provider is required. Default false. */
  modelEnabled?: boolean;
  /** Audit version identifying the caller/model configuration, not self confidence. */
  modelPolicyVersion?: string;
  timeoutMs?: number;
  optionalDataIssues?: readonly M40EvidenceIssue[];
}

export interface M40RunDependencies {
  store: M40RunStore;
  /** Caller receives no credentials, private account identifiers or future outcomes. */
  askAgent?: (prompt: string, request: AdvisoryRequest, timeoutMs: number) => Promise<string>;
  now?: () => Date;
}

export interface M40RunResult {
  runId: string;
  inputSha256: string;
  plan: M40Plan;
  judgments: StoredJudgment[];
  patterns: M40PatternReference[];
  queryStartSessionByWindow: M40PatternQueryStarts;
  draftCount: number;
  executionMode: 'shadow';
}

function json(value: unknown): JsonValue {
  return JSON.parse(stableJson(value)) as JsonValue;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

async function deadline<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('advisory_timeout')), timeoutMs); }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Existing configured provider only; this adapter does not create credentials or change providers. */
export async function askConfiguredM40Agent(prompt: string, _request: AdvisoryRequest, timeoutMs: number): Promise<string> {
  const { runLlm } = await import('@/lib/llm/provider');
  return runLlm(prompt, { timeoutMs, responseFormat: 'json', toolFree: true, domain: 'overseas' });
}

/**
 * Persist the deterministic base plan before any optional model call. Agent output
 * lives in its own shadow records and can never modify this plan or submit orders.
 */
export async function runM40Analysis(options: M40RunOptions, dependencies: M40RunDependencies): Promise<M40RunResult> {
  const input = deepFreeze(JSON.parse(stableJson(options.input)) as M40Input);
  const evidence = deepFreeze(JSON.parse(stableJson(options.evidence ?? [])) as M40Evidence[]);
  const coverageIssues = [...new Set(options.optionalDataIssues ?? [])].sort();
  const requestedTriggers = [...new Set(options.triggers ?? [])];
  const suppliedPatterns = JSON.parse(stableJson(options.patterns ?? [])) as M40PatternReference[];
  const inputSha256 = contentHash(input);
  const idempotencyKey = contentHash({ policy: M40_RUN_POLICY, inputSha256 });
  const runId = `m40-${idempotencyKey}`;
  const plan = deepFreeze(planM40(input));
  const asOfIndex = input.sessions.indexOf(input.asOfSession);
  const queryStartSessionByWindow: M40PatternQueryStarts = {
    20: asOfIndex >= 19 ? input.sessions[asOfIndex - 19] : null,
    60: asOfIndex >= 59 ? input.sessions[asOfIndex - 59] : null,
  };
  const patterns = eligiblePatternReferences(suppliedPatterns, input.decisionTime, input.asOfSession, queryStartSessionByWindow);
  await dependencies.store.saveAnalysisRun({
    runId, idempotencyKey, sessionDate: input.asOfSession, decisionAt: new Date(input.decisionTime).toISOString(),
    policyVersion: M40_RUN_POLICY, inputSha256, input: json(input), plan: json(plan),
    status: plan.status, createdAt: (dependencies.now?.() ?? new Date()).toISOString(),
  });

  // Drafts do not invoke createSignal, order submission, notifications or position writes.
  let draftCount = 0;
  for (const decision of plan.decisions) {
    if (decision.action === 'hold') continue;
    await dependencies.store.putSignalDraft({
      runId, symbol: decision.symbol, side: decision.action,
      status: plan.status === 'ready' ? 'shadow' : 'blocked',
      payload: json({ policyVersion: M40_RUN_POLICY, decision, executionMode: 'shadow',
        validationStatus: 'unvalidated', requiresExecutionRecheck: true }),
    });
    draftCount++;
  }

  const judgments: StoredJudgment[] = [];
  // Caller arrays are cloned before awaiting any provider and cannot change the audit hash mid-call.
  const evidenceIssue = validateEvidence(evidence, input.decisionTime);
  const triggers = requestedTriggers;
  if (plan.isReviewSession && !triggers.includes('review_session')) triggers.push('review_session');
  const modelPolicyVersion = options.modelPolicyVersion ?? 'unspecified';
  const enabled = options.modelEnabled === true && !!dependencies.askAgent && modelPolicyVersion !== 'unspecified';
  const timeoutMs = Math.min(Math.max(options.timeoutMs ?? 15_000, 1), 30_000);

  for (const stage of M40_STAGES) {
    const stageReasons = stageTriggers(stage, triggers);
    const base = { asOfSession: plan.asOfSession, isReviewSession: plan.isReviewSession,
      gates: plan.gates, candidates: plan.candidates };
    const eventHash = contentHash({ policy: M40_ADVISORY_POLICY, modelPolicyVersion, enabled, timeoutMs, stage,
      inputSha256, reasons: stageReasons, evidence, patterns, queryStartSessionByWindow, coverageIssues });
    const request: AdvisoryRequest = { stage, policyVersion: M40_ADVISORY_POLICY, eventHash,
      decisionTime: input.decisionTime, triggers: stageReasons, evidence, base, coverageIssues };
    let status = 'skipped';
    let payload: JsonValue;
    if (!stageReasons.length) {
      payload = { reason: 'no_intervention_condition', policyVersion: M40_ADVISORY_POLICY, patterns: json(patterns), queryStartSessionByWindow: json(queryStartSessionByWindow) };
    } else if (!enabled) {
      payload = { reason: 'model_disabled_or_unversioned', policyVersion: M40_ADVISORY_POLICY, triggers: json(stageReasons), patterns: json(patterns), queryStartSessionByWindow: json(queryStartSessionByWindow) };
    } else if (evidenceIssue || !evidence.length) {
      status = 'unknown';
      payload = { reason: evidenceIssue ?? 'no_eligible_evidence', policyVersion: M40_ADVISORY_POLICY };
    } else {
      try {
        // Cache contents are validated against exactly the same evidence and symbol scope.
        const cached = await dependencies.store.findJudgment(stage, eventHash);
        let answer: AdvisoryAnswer;
        let cachedFrom: string | null = null;
        if (cached?.runId === runId && cached.status === 'unknown') {
          judgments.push(cached);
          continue;
        }
        if (cached?.status === 'shadow' && cached.payload && typeof cached.payload === 'object'
          && !Array.isArray(cached.payload) && cached.payload.answer) {
          answer = parseAdvisoryAnswer(JSON.stringify(cached.payload.answer), request);
          if (cached.runId === runId) {
            judgments.push(cached);
            continue;
          }
          cachedFrom = cached.runId;
        } else {
          let flight = agentFlights.get(eventHash);
          if (!flight) {
            flight = (async () => {
              const raw = await deadline(dependencies.askAgent!(advisoryPrompt(request), request, timeoutMs), timeoutMs);
              return parseAdvisoryAnswer(raw, request);
            })();
            agentFlights.set(eventHash, flight);
          }
          try { answer = await flight; }
          finally { if (agentFlights.get(eventHash) === flight) agentFlights.delete(eventHash); }
        }
        status = 'shadow';
        payload = json({ policyVersion: M40_ADVISORY_POLICY, modelPolicyVersion, executionMode: 'shadow',
          triggers: stageReasons, sourceIds: evidence.map(e => e.id), answer, cachedFrom, patterns, queryStartSessionByWindow });
      } catch (error) {
        // Provider exception text may contain credentials or document snippets: retain a bounded fixed code only.
        status = 'unknown';
        const message = error instanceof Error ? error.message : '';
        const safeCode = /^advisory_[a-z_]+$/.test(message) ? message : 'advisory_provider_or_cache_failure';
        payload = { reason: safeCode, policyVersion: M40_ADVISORY_POLICY, modelPolicyVersion };
      }
    }
    const judgment: StoredJudgment = { runId, stage, eventHash, status, payload: json({ ...(payload as Record<string, JsonValue>), coverageIssues, request }) };
    await dependencies.store.putJudgment(judgment);
    judgments.push(judgment);
  }
  return { runId, inputSha256, plan, judgments, patterns, queryStartSessionByWindow, draftCount, executionMode: 'shadow' };
}
