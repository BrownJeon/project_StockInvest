'use client';

import { useEffect, useState } from 'react';
import { useToast } from '@/components/ui/Toast';

type Channel = 'none' | 'telegram' | 'slack' | 'both';

interface CredState {
  masked: string;
  set: boolean;
  source: 'db' | 'env' | 'none';
  dbSet: boolean;
  dbMasked: string;
  /** 비밀이 아닌 키(NOTIFY_PROJECT_TAG 등) 평문 값 — 일반 자격은 undefined */
  raw?: string;
}

interface CredApi { ok: boolean; credentials: Record<string, CredState>; }
interface ChApi { ok: boolean; channel: Channel; }

const TG_FIELDS = [
  { key: 'TELEGRAM_BOT_TOKEN', label: 'Bot Token', type: 'password' as const, hint: '@BotFather → /newbot' },
  { key: 'TELEGRAM_CHAT_ID',   label: 'Chat ID',   type: 'text' as const,     hint: 'getUpdates 로 확인' },
];
const SLACK_FIELDS = [
  { key: 'SLACK_WEBHOOK_URL', label: 'Webhook URL', type: 'password' as const, hint: 'https:// 로 시작' },
];

const CHANNEL_LABEL: Record<Channel, string> = {
  none:     '사용 안 함',
  telegram: 'Telegram',
  slack:    'Slack',
  both:     'Telegram + Slack',
};

interface TestResult {
  ok: boolean;
  durationMs: number;
  detail?: string;
  error?: string;
  hint?: string;
}

export function NotifyChannelSection() {
  const [creds, setCreds]     = useState<Record<string, CredState>>({});
  const [channel, setChannel] = useState<Channel>('none');
  const [savedChannel, setSavedChannel] = useState<Channel>('none');
  const [drafts, setDrafts]   = useState<Record<string, string>>({});
  const [tagDraft, setTagDraft] = useState<string>('');
  const [tagSaving, setTagSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const toast = useToast();
  const [testing, setTesting]       = useState<'telegram' | 'slack' | null>(null);
  const [testResults, setTestResults] = useState<Partial<Record<'telegram' | 'slack', TestResult>>>({});

  const runTest = async (target: 'telegram' | 'slack') => {
    setTesting(target);
    setTestResults(prev => ({ ...prev, [target]: undefined }));
    try {
      const res = await fetch('/api/settings/credentials/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target }),
      });
      const j = await res.json() as TestResult;
      setTestResults(prev => ({ ...prev, [target]: j }));
    } catch (e) {
      setTestResults(prev => ({ ...prev, [target]: { ok: false, durationMs: 0, error: e instanceof Error ? e.message : String(e) } }));
    } finally {
      setTesting(null);
    }
  };

  const reload = async () => {
    setLoading(true);
    try {
      const [credRes, chRes] = await Promise.all([
        fetch('/api/settings/credentials').then(r => r.json() as Promise<CredApi>),
        fetch('/api/settings/notify-channel').then(r => r.json() as Promise<ChApi>),
      ]);
      if (credRes.ok) setCreds(credRes.credentials);
      if (chRes.ok)   { setChannel(chRes.channel); setSavedChannel(chRes.channel); }
    } finally { setLoading(false); }
  };
  useEffect(() => { reload(); }, []);

  const startEdit = () => { setEditing(true); setDrafts({}); };
  const cancel    = () => { setEditing(false); setDrafts({}); setChannel(savedChannel); };

  const setDraft = (k: string, v: string) => setDrafts(prev => ({ ...prev, [k]: v }));

  const activeFields = (() => {
    if (channel === 'telegram') return TG_FIELDS;
    if (channel === 'slack')    return SLACK_FIELDS;
    if (channel === 'both')     return [...TG_FIELDS, ...SLACK_FIELDS];
    return [];
  })();

  const save = async () => {
    setSaving(true);
    try {
      // 1) 채널 저장
      const chRes = await fetch('/api/settings/notify-channel', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel }),
      }).then(r => r.json());
      if (!chRes.ok) throw new Error(chRes.error ?? 'channel save failed');

      // 2) 자격값 저장 (입력된 것만, none이면 스킵)
      if (channel !== 'none') {
        const values: Record<string, string> = {};
        for (const f of activeFields) {
          const v = drafts[f.key];
          if (v && v.trim() !== '') values[f.key] = v.trim();
        }
        // 신규 등록(해당 채널 필드가 모두 미등록)이면 모든 필드 필수
        const anyDbSet = activeFields.some(f => creds[f.key]?.dbSet);
        if (!anyDbSet) {
          const missing = activeFields.filter(f => !values[f.key]);
          if (missing.length > 0) {
            toast.show(`필수 항목 누락: ${missing.map(m => m.label).join(', ')}`, 'error');
            setSaving(false);
            return;
          }
        }
        if (Object.keys(values).length > 0) {
          const credRes = await fetch('/api/settings/credentials', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ values }),
          }).then(r => r.json());
          if (!credRes.ok) throw new Error(credRes.errors?.join(', ') ?? credRes.error ?? 'credentials save failed');
        }
      }

      toast.show('저장됨 — 30초 내 반영', 'success');
      setEditing(false);
      setDrafts({});
      reload();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setSaving(false);
    }
  };

  const saveProjectTag = async () => {
    setTagSaving(true);
    try {
      const v = tagDraft.trim();
      const values: Record<string, string> = { NOTIFY_PROJECT_TAG: v === '' ? '__reset__' : v };
      const res = await fetch('/api/settings/credentials', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values }),
      }).then(r => r.json());
      if (!res.ok) throw new Error(res.errors?.join(', ') ?? res.error ?? 'save failed');
      toast.show('저장됨 — 60초 내 반영', 'success');
      setTagDraft('');
      reload();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setTagSaving(false);
    }
  };

  if (loading) return <div style={{ padding: 16, color: 'var(--muted)', fontSize: 13 }}>알람 설정 불러오는 중...</div>;

  const hasAnyConfigured = ['TELEGRAM_BOT_TOKEN', 'SLACK_WEBHOOK_URL'].some(k => creds[k]?.dbSet);
  const tagState = creds['NOTIFY_PROJECT_TAG'];

  return (
    <div style={{ background: 'var(--bg2)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden' }}>
      {/* 헤더 — 현재 채널 + 등록/수정 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>알람 채널</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>현재: {CHANNEL_LABEL[savedChannel]}</div>
        </div>
        <span style={{
          fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 10,
          background: hasAnyConfigured ? 'rgba(34,197,94,.15)' : 'rgba(239,68,68,.12)',
          color: hasAnyConfigured ? 'var(--ok)' : 'var(--down)',
        }}>{hasAnyConfigured ? '등록됨' : '미등록'}</span>
      </div>

      {/* 프로젝트 태그 — 알람 메시지 [Header] 부분 */}
      <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>🏷️ 프로젝트 태그 (알람 헤더)</div>
        <div style={{ fontSize: 11, color: 'var(--muted)' }}>
          현재 헤더: <span style={{ fontFamily: 'monospace', color: 'var(--text)' }}>
            [{tagState?.raw && tagState.raw.trim() !== '' ? tagState.raw : 'StockInvest'}]
          </span>
          {tagState?.source === 'env' && (
            <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--muted)' }}>(env)</span>
          )}
          {tagState?.source === 'db' && (
            <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--ok)' }}>(DB 저장)</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            type="text"
            value={tagDraft}
            onChange={e => setTagDraft(e.target.value)}
            placeholder={tagState?.dbSet ? '비워두고 저장 시 default 로 reset' : '예: stockinvest-prod'}
            style={{
              flex: 1, padding: '6px 10px', borderRadius: 6, fontSize: 13,
              background: 'var(--bg)', color: 'var(--text)',
              border: '1px solid var(--border)', outline: 'none',
            }}
          />
          <button
            onClick={saveProjectTag}
            disabled={tagSaving}
            style={{
              padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 700,
              background: 'var(--accent)', color: '#000',
              border: 'none', cursor: tagSaving ? 'not-allowed' : 'pointer',
              opacity: tagSaving ? 0.6 : 1,
            }}
          >{tagSaving ? '저장 중...' : '저장'}</button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)' }}>
          여러 인스턴스를 동일 텔레그램 chat 에 보낼 때 구분용. 미설정 시 <code>StockInvest</code> 사용.
        </div>
      </div>

      {/* 보기 모드 */}
      {!editing && (
        <>
          {savedChannel !== 'none' && (
            <>
              {(savedChannel === 'telegram' || savedChannel === 'both') && TG_FIELDS.map((f, idx) => {
                const c = creds[f.key];
                return (
                  <div key={f.key} style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>📱 Telegram · {f.label}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'monospace', marginTop: 2 }}>
                      {c?.dbSet ? c.dbMasked : <span style={{ color: 'var(--down)' }}>(미등록)</span>}
                    </div>
                    {void idx}
                  </div>
                );
              })}
              {(savedChannel === 'slack' || savedChannel === 'both') && SLACK_FIELDS.map(f => {
                const c = creds[f.key];
                return (
                  <div key={f.key} style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>💬 Slack · {f.label}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'monospace', marginTop: 2 }}>
                      {c?.dbSet ? c.dbMasked : <span style={{ color: 'var(--down)' }}>(미등록)</span>}
                    </div>
                  </div>
                );
              })}
            </>
          )}
          {savedChannel === 'none' && (
            <div style={{ padding: '14px 16px', fontSize: 12, color: 'var(--muted)' }}>
              알람이 비활성 상태입니다. 등록하려면 우측 버튼을 눌러 채널을 선택하세요.
            </div>
          )}
          {/* 채널별 테스트 버튼 (보기 모드 + 등록된 채널) */}
          {(savedChannel === 'telegram' || savedChannel === 'both') && creds['TELEGRAM_BOT_TOKEN']?.dbSet && (
            <ChannelTestRow
              label="📱 Telegram 테스트 메시지 발송"
              testing={testing === 'telegram'}
              onClick={() => runTest('telegram')}
              result={testResults.telegram}
            />
          )}
          {(savedChannel === 'slack' || savedChannel === 'both') && creds['SLACK_WEBHOOK_URL']?.dbSet && (
            <ChannelTestRow
              label="💬 Slack 테스트 메시지 발송"
              testing={testing === 'slack'}
              onClick={() => runTest('slack')}
              result={testResults.slack}
            />
          )}

          <div style={{ padding: '10px 16px', display: 'flex', justifyContent: 'flex-end' }}>
            <button
              onClick={startEdit}
              style={{
                padding: '7px 16px', borderRadius: 8, fontSize: 13, fontWeight: 700,
                background: 'var(--accent)', color: '#000', border: 'none', cursor: 'pointer',
              }}
            >{savedChannel === 'none' ? '등록' : '수정'}</button>
          </div>
        </>
      )}

      {/* 편집 모드 */}
      {editing && (
        <>
          <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8, borderBottom: '1px solid var(--border)' }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>채널 선택</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {(['none', 'telegram', 'slack', 'both'] as Channel[]).map(c => (
                <label key={c} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '6px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 13,
                  background: channel === c ? 'rgba(245,158,11,.1)' : 'var(--bg3)',
                  border: `1px solid ${channel === c ? 'var(--accent)' : 'var(--border)'}`,
                }}>
                  <input
                    type="radio"
                    name="notify-channel"
                    checked={channel === c}
                    onChange={() => setChannel(c)}
                  />
                  {CHANNEL_LABEL[c]}
                </label>
              ))}
            </div>
          </div>

          {/* 선택된 채널의 필드 입력 */}
          {activeFields.map((f, idx) => {
            const c = creds[f.key];
            const isTg = f.key.startsWith('TELEGRAM_');
            return (
              <div key={f.key} style={{
                padding: '10px 16px', display: 'flex', flexDirection: 'column', gap: 4,
                borderBottom: idx < activeFields.length - 1 ? '1px solid var(--border)' : 'none',
              }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{isTg ? '📱 Telegram' : '💬 Slack'} · {f.label}</div>
                {c?.dbSet && (
                  <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'monospace' }}>
                    현재: {c.dbMasked}
                  </div>
                )}
                <input
                  type={f.type}
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

          <div style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, borderTop: '1px solid var(--border)' }}>
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

function ChannelTestRow({ label, testing, onClick, result }: {
  label: string;
  testing: boolean;
  onClick: () => void;
  result?: TestResult;
}) {
  return (
    <div style={{ borderTop: '1px solid var(--border)' }}>
      <div style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>{label}</span>
        <button
          onClick={onClick}
          disabled={testing}
          style={{
            padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600,
            background: 'var(--bg3)', color: 'var(--text)',
            border: '1px solid var(--border)', cursor: testing ? 'not-allowed' : 'pointer',
            opacity: testing ? 0.6 : 1,
          }}
        >
          {testing ? '발송 중...' : '🔌 테스트'}
        </button>
      </div>
      {result && (
        <div style={{
          margin: '0 16px 10px', padding: '8px 10px', borderRadius: 6,
          background: result.ok ? 'rgba(34,197,94,.08)' : 'rgba(239,68,68,.08)',
          border: `1px solid ${result.ok ? 'rgba(34,197,94,.3)' : 'rgba(239,68,68,.3)'}`,
          fontSize: 11, lineHeight: 1.6,
        }}>
          <div style={{ fontWeight: 700, color: result.ok ? 'var(--ok)' : 'var(--down)' }}>
            {result.ok ? '✓ 발송 성공' : '✗ 발송 실패'}
            <span style={{ marginLeft: 6, fontWeight: 400, color: 'var(--muted)' }}>{result.durationMs}ms</span>
          </div>
          {result.detail && <div style={{ marginTop: 3, color: 'var(--text)' }}>{result.detail}</div>}
          {result.error && <div style={{ marginTop: 4, color: 'var(--down)', wordBreak: 'break-all' }}>{result.error}</div>}
          {result.hint && <div style={{ marginTop: 3, color: 'var(--muted)' }}>💡 {result.hint}</div>}
        </div>
      )}
    </div>
  );
}
