import { NextRequest, NextResponse } from 'next/server';
import { checkCronAuth } from '@/lib/cron-auth';
import { loadM40Input } from '@/lib/strategy/m40/load-input';
import { runM40Analysis, askConfiguredM40Agent } from '@/lib/strategy/m40/runner';
import { saveAnalysisRun, putJudgment, findJudgment, putSignalDraft } from '@/lib/analysis-data/store';

export const dynamic = 'force-dynamic';

/** Analysis/archive writes only. No active signal, broker, or order path is invoked. */
export async function POST(req: NextRequest) {
  const authError = checkCronAuth(req);
  if (authError) return authError;
  const session = req.nextUrl.searchParams.get('session') ?? undefined;
  const decisionAt = req.nextUrl.searchParams.get('decision_at') ?? undefined;
  if ((session !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(session))
    || (decisionAt !== undefined && (!/(?:Z|[+-]\d{2}:\d{2})$/.test(decisionAt)
      || !Number.isFinite(Date.parse(decisionAt)) || Date.parse(decisionAt) > Date.now()))) {
    return NextResponse.json({ ok: false, error: 'invalid_session_or_cutoff' }, { status: 400 });
  }
  try {
    const input = await loadM40Input({ session, decisionAt });
    const result = await runM40Analysis({ input,
      modelEnabled: process.env.T156_M40_AGENT_ENABLED === 'true',
      modelPolicyVersion: process.env.T156_M40_AGENT_POLICY_VERSION,
    }, { store: { saveAnalysisRun, putJudgment, findJudgment, putSignalDraft }, askAgent: askConfiguredM40Agent });
    return NextResponse.json({ ok: result.plan.status === 'ready', ...result },
      { status: result.plan.status === 'ready' ? 200 : 503 });
  } catch (error) {
    // Source/config errors remain fail closed and never leak DB/provider exception text.
    const message = error instanceof Error ? error.message : '';
    const safeCode = ['m40_policy_not_configured', 'm40_input_not_published', 'm40_input_stale', 'm40_input_invalid'].includes(message)
      ? message : 'm40_input_or_archive_unavailable';
    return NextResponse.json({ ok: false, error: safeCode, executionMode: 'shadow' }, { status: 503 });
  }
}
