'use client';

import { useEffect, useState } from 'react';
import { useToast } from '@/components/ui/Toast';

type Provider = 'claude' | 'home-m4-api' | 'hybrid';

interface ApiResponse {
  ok: boolean;
  active: {
    provider: Provider;
    homeM4ApiBase?: string;
    homeM4ApiModel?: string;
    homeM4ApiTemperature?: number;
    stage1Model?: string;
    stage1TimeoutMs?: number;
    ragEnabled?: boolean;
    ragTopKSignals?: number;
    ragTopKNews?: number;
    ragLookbackDays?: number;
  };
  overrides?: Record<string, unknown>;
  env?: Record<string, string | null>;
}

const LABEL: Record<Provider, string> = {
  claude:        'Claude CLI',
  'home-m4-api': '로컬 LLM (home-m4-api)',
  hybrid:        '🔀 Hybrid (M4 + Claude) [권장]',
};

const DESC: Record<Provider, string> = {
  claude:        '~/.claude 구독 인증으로 호출. 추가 비용 없음.',
  'home-m4-api': '자체 운영 Mac M4 API 허브 호출 (POST /v1/chat). 인증키는 .env(AI_API_KEY) 전용.',
  hybrid:        'Stage 1(M4 Ollama)이 광역 스크리닝 → 회색 영역만 Stage 2(Claude)로 escalate. 평균 80%+ Claude 호출 절감.',
};

interface TestResult {
  ok: boolean;
  durationMs?: number;
  responseSample?: string;
  jsonOk?: boolean;
  parsed?: unknown;
  error?: string;
  hint?: string;
}

export function LlmProviderSection() {
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [provider, setProvider] = useState<Provider>('claude');
  // home-m4-api
  const [m4Base, setM4Base]   = useState('http://192.168.219.163:8000');
  const [m4Model, setM4Model] = useState('qwen2.5:14b-instruct');
  const [m4Temp, setM4Temp]   = useState('0.3');
  const [apiKeySet, setApiKeySet] = useState<boolean>(false);
  // Hybrid + RAG (Phase AB)
  const [stage1Model, setStage1Model] = useState('qwen2.5:14b-instruct');
  const [stage1Timeout, setStage1Timeout] = useState('30000');
  const [ragEnabled, setRagEnabled] = useState<boolean>(true);
  const [ragTopKSignals, setRagTopKSignals] = useState('5');
  const [ragTopKNews, setRagTopKNews] = useState('3');
  const [ragLookback, setRagLookback] = useState('7');

  const [activeProvider, setActiveProvider] = useState<Provider>('claude');
  const toast = useToast();
  const [testing, setTesting]       = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  useEffect(() => {
    fetch('/api/settings/llm-provider')
      .then(r => r.json() as Promise<ApiResponse>)
      .then(d => {
        if (!d.ok) return;
        setProvider(d.active.provider);
        setActiveProvider(d.active.provider);
        if (d.active.homeM4ApiBase)             setM4Base(d.active.homeM4ApiBase);
        if (d.active.homeM4ApiModel)            setM4Model(d.active.homeM4ApiModel);
        if (d.active.homeM4ApiTemperature != null) setM4Temp(String(d.active.homeM4ApiTemperature));
        setApiKeySet(d.env?.AI_API_KEY_set === 'yes');
        // Phase AB
        if (d.active.stage1Model)        setStage1Model(d.active.stage1Model);
        if (d.active.stage1TimeoutMs != null) setStage1Timeout(String(d.active.stage1TimeoutMs));
        if (d.active.ragEnabled != null) setRagEnabled(!!d.active.ragEnabled);
        if (d.active.ragTopKSignals != null) setRagTopKSignals(String(d.active.ragTopKSignals));
        if (d.active.ragTopKNews != null)    setRagTopKNews(String(d.active.ragTopKNews));
        if (d.active.ragLookbackDays != null) setRagLookback(String(d.active.ragLookbackDays));
      })
      .finally(() => setLoading(false));
  }, []);

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      let body: Record<string, unknown> = { provider };
      if (provider === 'home-m4-api') {
        const t = Number(m4Temp);
        body = {
          provider: 'home-m4-api',
          homeM4ApiBase: m4Base.trim(),
          homeM4ApiModel: m4Model.trim(),
          homeM4ApiTemperature: Number.isFinite(t) ? t : undefined,
        };
      } else {
        setTestResult({ ok: false, error: '연결 테스트는 home-m4-api 만 지원' });
        setTesting(false);
        return;
      }
      const res = await fetch('/api/settings/llm-provider/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as TestResult;
      setTestResult(json);
    } catch (e) {
      setTestResult({ ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = { provider };
      if (provider === 'home-m4-api') {
        body.homeM4ApiBase = m4Base.trim();
        body.homeM4ApiModel = m4Model.trim();
        const t = Number(m4Temp);
        if (Number.isFinite(t)) body.homeM4ApiTemperature = t;
      }
      if (provider === 'hybrid') {
        body.stage1Model = stage1Model.trim() || 'qwen2.5:14b-instruct';
        const t1 = Number(stage1Timeout);
        if (Number.isFinite(t1)) body.stage1TimeoutMs = t1;
        body.ragEnabled = ragEnabled;
        const k1 = Number(ragTopKSignals); if (Number.isFinite(k1)) body.ragTopKSignals = k1;
        const k2 = Number(ragTopKNews);    if (Number.isFinite(k2)) body.ragTopKNews = k2;
        const k3 = Number(ragLookback);    if (Number.isFinite(k3)) body.ragLookbackDays = k3;
      }
      const res = await fetch('/api/settings/llm-provider', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json() as ApiResponse & { error?: string };
      if (!json.ok) throw new Error(json.error ?? 'save failed');
      setActiveProvider(json.active.provider);
      toast.show('저장됨 — 다음 cron tick부터 적용', 'success');
    } catch (e) {
      toast.show(`저장 실패: ${e instanceof Error ? e.message : String(e)}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div style={{ padding: 16, color: 'var(--muted)', fontSize: 13 }}>AI 제공자 설정 불러오는 중...</div>;
  }

  const isDirty = provider !== activeProvider;

  return (
    <div style={{ background: 'var(--bg2)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden' }}>
      {/* 현재 활성 표시 */}
      <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', fontSize: 12, color: 'var(--muted)' }}>
        현재 활성: <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{LABEL[activeProvider]}</span>
      </div>

      {/* 라디오 그룹 */}
      <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {(['claude', 'home-m4-api', 'hybrid'] as Provider[]).map(p => (
          <label key={p} style={{
            display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px',
            borderRadius: 8, cursor: 'pointer',
            background: provider === p ? 'rgba(245,158,11,.1)' : 'var(--bg3)',
            border: `1px solid ${provider === p ? 'var(--accent)' : 'var(--border)'}`,
          }}>
            <input
              type="radio"
              name="llm-provider"
              checked={provider === p}
              onChange={() => setProvider(p)}
              style={{ marginTop: 2, cursor: 'pointer' }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{LABEL[p]}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2, lineHeight: 1.5 }}>{DESC[p]}</div>
            </div>
          </label>
        ))}
      </div>

      {/* home-m4-api 설정 입력 */}
      {provider === 'home-m4-api' && (
        <div style={{ padding: '0 16px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Field label="API Base URL" hint="예: http://192.168.219.163:8000 (.env AI_API_BASE 가 초기값)">
            <input value={m4Base} onChange={e => setM4Base(e.target.value)} placeholder="http://host:port" style={inputStyle} />
          </Field>
          <Field label="모델명" hint="예: qwen2.5:14b-instruct · llama3.3 · glm-4.7-flash (.env AI_API_MODEL 이 초기값)">
            <input value={m4Model} onChange={e => setM4Model(e.target.value)} placeholder="qwen2.5:14b-instruct" style={inputStyle} />
          </Field>
          <Field label="Temperature" hint="0.0 ~ 2.0 (낮을수록 일관성 ↑)">
            <input type="number" step="0.1" min="0" max="2" value={m4Temp} onChange={e => setM4Temp(e.target.value)} style={{ ...inputStyle, width: 100 }} />
          </Field>
          <div style={{
            padding: '8px 10px', borderRadius: 6, fontSize: 11,
            background: apiKeySet ? 'rgba(34,197,94,.1)' : 'rgba(239,68,68,.1)',
            color: apiKeySet ? 'var(--ok)' : 'var(--down)',
            border: `1px solid ${apiKeySet ? 'rgba(34,197,94,.3)' : 'rgba(239,68,68,.3)'}`,
          }}>
            {apiKeySet
              ? '🔑 AI_API_KEY .env에 설정됨 (보안상 UI 표시·수정 불가)'
              : '⚠ AI_API_KEY 가 .env에 없습니다 — 호출이 실패합니다'}
          </div>
          <TestButton testing={testing} disabled={!m4Base.trim() || !m4Model.trim() || !apiKeySet} onClick={test} />
          <TestResultView result={testResult} />
        </div>
      )}

      {/* hybrid 세부 설정 — Phase AB */}
      {provider === 'hybrid' && (
        <div style={{ padding: '0 16px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Field label="Stage 1 모델 (도메인 통합)" hint="default glm-4.7-flash. 도메인 fine-tune 후 stockinvest-* 로 변경.">
            <input value={stage1Model} onChange={e => setStage1Model(e.target.value)} placeholder="qwen2.5:14b-instruct" style={inputStyle} />
          </Field>
          <Field label="Stage 1 Timeout (ms)" hint="5000~120000">
            <input type="number" value={stage1Timeout} onChange={e => setStage1Timeout(e.target.value)} style={{ ...inputStyle, width: 120 }} />
          </Field>

          <div style={{ marginTop: 6, padding: '10px 12px', borderRadius: 8, background: 'var(--bg3)', border: '1px solid var(--border)' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={ragEnabled} onChange={e => setRagEnabled(e.target.checked)} style={{ cursor: 'pointer' }} />
              <span style={{ fontSize: 13, fontWeight: 600 }}>📚 RAG 활성 (과거 시그널·뉴스·매크로 컨텍스트 자동 첨부)</span>
            </label>
            {ragEnabled && (
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <Field label="top_k 과거시그널" hint="0~20">
                  <input type="number" value={ragTopKSignals} onChange={e => setRagTopKSignals(e.target.value)} style={{ ...inputStyle, width: 80 }} />
                </Field>
                <Field label="top_k 뉴스" hint="0~20">
                  <input type="number" value={ragTopKNews} onChange={e => setRagTopKNews(e.target.value)} style={{ ...inputStyle, width: 80 }} />
                </Field>
                <Field label="lookback days" hint="1~90">
                  <input type="number" value={ragLookback} onChange={e => setRagLookback(e.target.value)} style={{ ...inputStyle, width: 80 }} />
                </Field>
              </div>
            )}
          </div>

          <div style={{
            padding: '8px 10px', borderRadius: 6, fontSize: 11,
            background: 'rgba(245,158,11,.08)',
            color: 'var(--muted)',
            border: '1px solid rgba(245,158,11,.3)',
          }}>
            <div style={{ marginBottom: 4 }}>
              <strong>Stage 1 → Stage 2 임계값 (read-only):</strong>
            </div>
            <div>· pass     : EV ≥ +0.5% AND confidence ≥ 70%</div>
            <div>· reject   : EV ≤ -0.3% OR confidence &lt; 40%</div>
            <div>· escalate : 그 외 (Claude Sonnet 최종 결정)</div>
          </div>
          <div style={{
            padding: '8px 10px', borderRadius: 6, fontSize: 11,
            background: apiKeySet ? 'rgba(34,197,94,.1)' : 'rgba(239,68,68,.1)',
            color: apiKeySet ? 'var(--ok)' : 'var(--down)',
            border: `1px solid ${apiKeySet ? 'rgba(34,197,94,.3)' : 'rgba(239,68,68,.3)'}`,
          }}>
            {apiKeySet
              ? '🔑 AI_API_KEY .env에 설정됨 (Stage 1 + RAG 호출에 사용)'
              : '⚠ AI_API_KEY 가 .env에 없습니다 — Stage 1·RAG 호출 실패'}
          </div>
        </div>
      )}

      {/* 저장 버튼 + 메시지 */}
      <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ fontSize: 12, color: 'var(--muted)', minHeight: 16, flex: 1 }}>
          {isDirty ? '변경사항 있음 — 저장하면 다음 cron tick부터 적용' : ''}
        </div>
        <button
          onClick={save}
          disabled={saving}
          style={{
            padding: '7px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600,
            background: 'var(--accent)', color: '#000',
            border: 'none', cursor: saving ? 'not-allowed' : 'pointer',
            opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? '저장 중...' : '저장'}
        </button>
      </div>
    </div>
  );
}

function TestButton({ testing, disabled, onClick }: { testing: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
      <button
        onClick={onClick}
        disabled={testing || disabled}
        style={{
          padding: '7px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600,
          background: 'var(--bg3)', color: 'var(--text)',
          border: '1px solid var(--border)',
          cursor: testing || disabled ? 'not-allowed' : 'pointer',
          opacity: testing || disabled ? 0.6 : 1,
        }}
      >
        {testing ? '테스트 중... (최대 30초)' : '🔌 연결 테스트'}
      </button>
      <span style={{ fontSize: 11, color: 'var(--muted)' }}>저장 전에 작성한 경로로 실제 호출해 검증</span>
    </div>
  );
}

function TestResultView({ result }: { result: TestResult | null }) {
  if (!result) return null;
  return (
    <div style={{
      marginTop: 4, padding: '10px 12px', borderRadius: 8,
      background: result.ok ? 'rgba(34,197,94,.08)' : 'rgba(239,68,68,.08)',
      border: `1px solid ${result.ok ? 'rgba(34,197,94,.3)' : 'rgba(239,68,68,.3)'}`,
      fontSize: 12, lineHeight: 1.6,
    }}>
      <div style={{ fontWeight: 700, color: result.ok ? 'var(--ok)' : 'var(--down)' }}>
        {result.ok ? '✓ 연결 성공' : '✗ 연결 실패'}
        {result.durationMs != null && (
          <span style={{ marginLeft: 8, fontWeight: 400, color: 'var(--muted)' }}>{result.durationMs}ms</span>
        )}
        {result.ok && result.jsonOk != null && (
          <span style={{ marginLeft: 8, fontWeight: 400, color: result.jsonOk ? 'var(--ok)' : 'var(--accent)' }}>
            {result.jsonOk ? 'JSON 파싱 OK' : 'JSON 파싱 실패 (모델 응답 형식 부적합)'}
          </span>
        )}
      </div>
      {result.error && (
        <div style={{ marginTop: 6, color: 'var(--down)', wordBreak: 'break-all' }}>{result.error}</div>
      )}
      {result.hint && (
        <div style={{ marginTop: 4, color: 'var(--muted)' }}>💡 {result.hint}</div>
      )}
      {result.responseSample && (
        <div style={{ marginTop: 6 }}>
          <div style={{ color: 'var(--muted)', marginBottom: 2 }}>응답 샘플:</div>
          <pre style={{
            margin: 0, padding: 8, borderRadius: 6, background: 'var(--bg)',
            color: 'var(--text)', fontSize: 11, fontFamily: 'monospace',
            whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 120, overflow: 'auto',
          }}>{result.responseSample}</pre>
        </div>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '6px 10px', borderRadius: 6, fontSize: 13,
  background: 'var(--bg)', color: 'var(--text)',
  border: '1px solid var(--border)', outline: 'none',
};

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ fontSize: 12, fontWeight: 600 }}>{label}</div>
      {children}
      {hint && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{hint}</div>}
    </div>
  );
}
