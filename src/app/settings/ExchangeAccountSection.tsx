'use client';

import { useEffect, useState } from 'react';
import { useToast } from '@/components/ui/Toast';

interface CredState {
  masked: string;
  set: boolean;
  source: 'db' | 'env' | 'none';
  dbSet: boolean;
  dbMasked: string;
}

interface ApiResp {
  ok: boolean;
  credentials: Record<string, CredState>;
}

interface FieldDef {
  key: string;
  label: string;
  type?: 'text' | 'password';
  hint?: string;
}

const FIELDS: FieldDef[] = [
  { key: 'KIS_APP_KEY',         label: 'App Key',     type: 'password', hint: 'KIS OpenAPI 발급' },
  { key: 'KIS_APP_SECRET',      label: 'App Secret',  type: 'password', hint: 'KIS OpenAPI 발급' },
  { key: 'KIS_ACCOUNT_NO',      label: '계좌번호',    type: 'text',     hint: '8자리 숫자' },
  { key: 'KIS_ACCOUNT_PRODUCT', label: '상품코드',    type: 'text',     hint: '주식현물=01' },
];

interface TestResult {
  ok: boolean;
  durationMs: number;
  detail?: string;
  error?: string;
  hint?: string;
}

export function ExchangeAccountSection() {
  const [creds, setCreds]     = useState<Record<string, CredState>>({});
  const [drafts, setDrafts]   = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving]   = useState(false);
  const toast = useToast();
  const [testing, setTesting]       = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const runTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/settings/credentials/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: 'exchange' }),
      });
      const j = await res.json() as TestResult;
      setTestResult(j);
    } catch (e) {
      setTestResult({ ok: false, durationMs: 0, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setTesting(false);
    }
  };

  const reload = () => {
    setLoading(true);
    fetch('/api/settings/credentials')
      .then(r => r.json() as Promise<ApiResp>)
      .then(d => { if (d.ok) setCreds(d.credentials); })
      .finally(() => setLoading(false));
  };
  useEffect(() => { reload(); }, []);

  const allRegistered = FIELDS.every(f => creds[f.key]?.dbSet);
  const someRegistered = FIELDS.some(f => creds[f.key]?.dbSet);

  const startEdit = () => { setEditing(true); setDrafts({}); };
  const cancel    = () => { setEditing(false); setDrafts({}); };

  const setDraft = (k: string, v: string) => setDrafts(prev => ({ ...prev, [k]: v }));

  const save = async () => {
    const values: Record<string, string> = {};
    for (const f of FIELDS) {
      const v = drafts[f.key];
      if (v && v.trim() !== '') values[f.key] = v.trim();
    }
    if (!allRegistered) {
      const missing = FIELDS.filter(f => !values[f.key]);
      if (missing.length > 0) {
        toast.show(`필수 항목 누락: ${missing.map(m => m.label).join(', ')}`, 'error');
        return;
      }
    }
    if (Object.keys(values).length === 0) {
      toast.show('변경된 값이 없습니다', 'warning');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/settings/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values }),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.errors?.join(', ') ?? j.error ?? 'failed');
      toast.show('저장됨 — 60초 내 반영', 'success');
      setEditing(false);
      setDrafts({});
      reload();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div style={{ padding: 16, color: 'var(--muted)', fontSize: 13 }}>거래소 계정 불러오는 중...</div>;

  return (
    <div style={{ background: 'var(--bg2)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>한국투자증권 (KIS)</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>국내 · 해외 주식 실매매</div>
        </div>
        <span style={{
          fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 10,
          background: someRegistered ? 'rgba(34,197,94,.15)' : 'rgba(239,68,68,.12)',
          color: someRegistered ? 'var(--ok)' : 'var(--down)',
        }}>
          {someRegistered ? (allRegistered ? '등록 완료' : '일부 등록') : '미등록'}
        </span>
      </div>

      {!editing && (
        <>
          {FIELDS.map((f, idx) => {
            const c = creds[f.key];
            const isDb = c?.dbSet;
            return (
              <div key={f.key} style={{
                padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                borderBottom: idx < FIELDS.length - 1 ? '1px solid var(--border)' : 'none',
              }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{f.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'monospace', marginTop: 2 }}>
                    {isDb ? c.dbMasked : <span style={{ color: 'var(--down)' }}>(미등록)</span>}
                  </div>
                </div>
              </div>
            );
          })}
          <div style={{ padding: '10px 16px', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            {someRegistered && (
              <button
                onClick={runTest}
                disabled={testing}
                style={{
                  padding: '7px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                  background: 'var(--bg3)', color: 'var(--text)',
                  border: '1px solid var(--border)', cursor: testing ? 'not-allowed' : 'pointer',
                  opacity: testing ? 0.6 : 1,
                }}
              >
                {testing ? '테스트 중...' : '🔌 연결 테스트'}
              </button>
            )}
            <button
              onClick={startEdit}
              style={{
                padding: '7px 16px', borderRadius: 8, fontSize: 13, fontWeight: 700,
                background: 'var(--accent)', color: '#000', border: 'none', cursor: 'pointer',
              }}
            >
              {someRegistered ? '수정' : '등록'}
            </button>
          </div>
          {testResult && <TestResultView result={testResult} />}
        </>
      )}

      {editing && (
        <>
          {FIELDS.map((f, idx) => {
            const c = creds[f.key];
            return (
              <div key={f.key} style={{
                padding: '10px 16px', display: 'flex', flexDirection: 'column', gap: 4,
                borderBottom: idx < FIELDS.length - 1 ? '1px solid var(--border)' : 'none',
              }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{f.label}</div>
                {c?.dbSet && (
                  <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'monospace' }}>
                    현재: {c.dbMasked}
                  </div>
                )}
                <input
                  type={f.type ?? 'text'}
                  value={drafts[f.key] ?? ''}
                  onChange={e => setDraft(f.key, e.target.value)}
                  placeholder={c?.dbSet ? '비워두면 변경 없음' : '신규 등록값 입력'}
                  autoComplete="new-password"
                  style={{
                    padding: '6px 10px', borderRadius: 6, fontSize: 13,
                    background: 'var(--bg)', color: 'var(--text)',
                    border: '1px solid var(--border)', outline: 'none',
                  }}
                />
                {f.hint && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{f.hint}</div>}
              </div>
            );
          })}
          <div style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--muted)', flex: 1 }}>
              평문으로 DB에 저장됩니다
            </span>
            <button
              onClick={cancel}
              disabled={saving}
              style={{
                padding: '7px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                background: 'var(--bg3)', color: 'var(--muted)',
                border: '1px solid var(--border)', cursor: saving ? 'not-allowed' : 'pointer',
              }}
            >취소</button>
            <button
              onClick={save}
              disabled={saving}
              style={{
                padding: '7px 16px', borderRadius: 8, fontSize: 13, fontWeight: 700,
                background: 'var(--accent)', color: '#000',
                border: 'none', cursor: saving ? 'not-allowed' : 'pointer',
                opacity: saving ? 0.6 : 1,
              }}
            >{saving ? '저장 중...' : '저장'}</button>
          </div>
        </>
      )}

    </div>
  );
}

function TestResultView({ result }: { result: TestResult }) {
  return (
    <div style={{
      margin: '0 16px 12px', padding: '10px 12px', borderRadius: 8,
      background: result.ok ? 'rgba(34,197,94,.08)' : 'rgba(239,68,68,.08)',
      border: `1px solid ${result.ok ? 'rgba(34,197,94,.3)' : 'rgba(239,68,68,.3)'}`,
      fontSize: 12, lineHeight: 1.6,
    }}>
      <div style={{ fontWeight: 700, color: result.ok ? 'var(--ok)' : 'var(--down)' }}>
        {result.ok ? '✓ 연결 성공' : '✗ 연결 실패'}
        <span style={{ marginLeft: 8, fontWeight: 400, color: 'var(--muted)' }}>{result.durationMs}ms</span>
      </div>
      {result.detail && <div style={{ marginTop: 4, color: 'var(--text)' }}>{result.detail}</div>}
      {result.error && <div style={{ marginTop: 6, color: 'var(--down)', wordBreak: 'break-all' }}>{result.error}</div>}
      {result.hint && <div style={{ marginTop: 4, color: 'var(--muted)' }}>💡 {result.hint}</div>}
    </div>
  );
}
