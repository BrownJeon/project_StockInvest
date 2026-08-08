'use client';

/**
 * /profile — 내 계정 (T-008 Step 1, 2026-08-07).
 *
 * 화면이 지켜야 하는 단 하나의 원칙: **저장되는 것과 적용되는 것을 구분해서 말한다.**
 *
 * 사용자 결정 Q4 로 안전장치 4개는 편집·저장이 가능해졌다. 그런데 이 값들은 Step 4
 * (엔진 멀티테넌트 전환) 전까지 cron·strategy-eval·exit-engine 어디에서도 읽히지 않는다.
 * 즉 회원이 `긴급 정지`를 켜도 **아무것도 멈추지 않는다.**
 * T-007 에서 다룬 "성공했다고 표시하지만 실패한 화면"과 같은 종류의 거짓말이므로,
 *   - 페이지 상단에 상시 경고 배너
 *   - 위험 방향(보호받는다고 착각할 수 있는) 스위치 2개에는 **컨트롤 옆에 직접** 경고
 *   - 저장 성공 문구도 "저장됨"이지 "적용됨"이 아니다
 * 를 모두 둔다. 저장 자체는 막지 않는다 — 그 값이 Step 4 의 시작값이 된다.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { requestJson } from '@/lib/http';

interface ProfileSettings {
  dryRun: boolean;
  killSwitch: boolean;
  orderMaxPct: number;
  dailyOrderMaxPct: number;
}

interface ProfileData {
  user: { id: number; email: string; createdAt: string | null };
  kis: {
    connected: boolean;
    mock: boolean;
    accountMasked: string | null;
    accountProduct: string;
    connectedAt: string | null;
    credentialError: boolean;
    encryptionConfigured: boolean;
  };
  settings: ProfileSettings;
  engineWired: boolean;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export function ProfilePage() {
  const [data, setData] = useState<ProfileData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [welcome, setWelcome] = useState(false);

  useEffect(() => {
    setWelcome(new URLSearchParams(window.location.search).get('welcome') === '1');
  }, []);

  const load = useCallback(async () => {
    // 세션이 끊긴 상태(401)에서 "불러오지 못했습니다"만 띄우면 막다른 길이 된다 — 로그인으로 보낸다.
    let res: Response;
    try {
      res = await fetch('/api/profile');
    } catch {
      setLoadError('네트워크 오류로 요청하지 못했습니다. 연결을 확인하고 다시 시도하세요.');
      return;
    }
    if (res.status === 401) { window.location.replace('/login?next=/profile'); return; }
    const body = await res.json().catch(() => null) as (ProfileData & { ok?: boolean; error?: string }) | null;
    if (!res.ok || !body?.ok) {
      setLoadError(body?.error ?? `서버가 요청을 거부했습니다 (HTTP ${res.status})`);
      return;
    }
    setLoadError(null);
    setData(body);
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (loadError) {
    return <div style={S.centerMsg} role="alert">프로필을 불러오지 못했습니다 — {loadError}</div>;
  }
  if (!data) return <div style={S.centerMsg}>불러오는 중…</div>;

  return (
    <div style={S.page}>
      <header style={{ marginBottom: 4 }}>
        <h1 style={S.h1}>내 계정</h1>
        <p style={S.email}>{data.user.email}</p>
      </header>

      {welcome && (
        <div style={{ ...S.note, borderLeftColor: 'var(--ok)' }}>
          가입이 완료됐습니다. 매매를 시작하려면 아래 <b style={S.strong}>한국투자증권 연결</b>에서
          본인 계좌를 연결하세요.
        </div>
      )}

      <EngineNotWiredBanner />

      <SettingsSection settings={data.settings} onSaved={load} />

      <KisSection kis={data.kis} onConnected={load} />

      <SecuritySection />
    </div>
  );
}

// ─── Q4: 상시 경고 배너 ──────────────────────────────────────────────────────

function EngineNotWiredBanner() {
  return (
    <section style={S.banner} role="note">
      <div style={S.bannerTitle}>⚠️ 아래 매매 설정은 아직 매매 엔진에 연결되지 않았습니다</div>
      <p style={S.bannerBody}>
        여기서 바꾼 값은 <b style={S.strong}>저장은 되지만 실제 매매를 바꾸지 않습니다.</b> 지금 매매를
        결정하는 것은 서버 공용 설정(<code style={S.code}>.env</code> · 설정 → 안전장치)입니다.
        회원별 설정이 실제로 적용되는 시점은 멀티테넌트 전환 <b style={S.strong}>4단계</b>입니다.
      </p>
      <Link href="/settings" style={S.bannerLink}>지금 적용 중인 값 보기 (설정 → 안전장치) →</Link>
    </section>
  );
}

// ─── 내 매매 설정 ────────────────────────────────────────────────────────────

function SettingsSection({ settings, onSaved }: { settings: ProfileSettings; onSaved: () => void | Promise<void> }) {
  const [form, setForm] = useState<ProfileSettings>(settings);
  const [state, setState] = useState<SaveState>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setForm(settings); }, [settings]);

  const dirty =
    form.dryRun !== settings.dryRun ||
    form.killSwitch !== settings.killSwitch ||
    form.orderMaxPct !== settings.orderMaxPct ||
    form.dailyOrderMaxPct !== settings.dailyOrderMaxPct;

  async function save() {
    setState('saving');
    setError(null);
    const r = await requestJson('/api/profile/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    if (!r.ok) {
      setState('error');
      setError(r.failure.message);
      return;
    }
    setState('saved');
    await onSaved();
  }

  return (
    <section>
      <SectionHeader title="내 매매 설정" />
      <div style={S.card}>
        <ToggleRow
          label="모의 매매"
          desc="켜져 있으면 주문을 실제로 보내지 않습니다"
          checked={form.dryRun}
          onChange={(v) => setForm({ ...form, dryRun: v })}
          warning="⚠️ 지금은 이 스위치가 주문 송신을 막지 못합니다. 실제 주문 여부는 서버 공용 DRY_RUN 값이 결정합니다 (4단계에서 연결)."
        />
        <ToggleRow
          label="긴급 정지"
          desc="켜면 모든 주문을 차단합니다"
          checked={form.killSwitch}
          danger
          onChange={(v) => setForm({ ...form, killSwitch: v })}
          warning="⚠️ 지금 이 스위치를 켜도 매매는 멈추지 않습니다. 즉시 멈추려면 설정 → 안전장치의 긴급 정지를 사용하세요."
        />
        <NumberRow
          label="1회 주문 한도"
          desc="보유자산 대비 %"
          value={form.orderMaxPct}
          onChange={(v) => setForm({ ...form, orderMaxPct: v })}
        />
        <NumberRow
          label="하루 주문 한도"
          desc="보유자산 대비 %"
          value={form.dailyOrderMaxPct}
          onChange={(v) => setForm({ ...form, dailyOrderMaxPct: v })}
          last
        />
      </div>

      <div style={S.saveRow}>
        <span
          role={state === 'error' ? 'alert' : undefined}
          style={{
            fontSize: 12, fontWeight: 600, flex: 1, minWidth: 0, wordBreak: 'break-word',
            color: state === 'error' ? 'var(--danger)' : state === 'saved' ? 'var(--ok)' : 'var(--muted)',
          }}
        >
          {state === 'saving' ? '저장 중…'
            : state === 'error' ? `저장 실패 — ${error ?? '알 수 없는 오류'}`
            // "적용됨"이 아니다 — 저장만 됐다는 사실을 문구가 정확히 말한다.
            : state === 'saved' ? '저장됨 ✓ (매매 엔진에는 아직 반영되지 않습니다)'
            : dirty ? '변경 사항 있음' : '가입 시 기본값으로 저장돼 있습니다'}
        </span>
        <button
          type="button"
          onClick={save}
          disabled={!dirty || state === 'saving'}
          style={{ ...S.saveBtn, opacity: !dirty || state === 'saving' ? 0.5 : 1 }}
        >
          {state === 'error' ? '다시 시도' : '저장'}
        </button>
      </div>
    </section>
  );
}

// ─── 한국투자증권 연결 ───────────────────────────────────────────────────────

function KisSection({ kis, onConnected }: { kis: ProfileData['kis']; onConnected: () => void | Promise<void> }) {
  const [open, setOpen] = useState(false);

  return (
    <section>
      <SectionHeader title="한국투자증권 연결" />
      <div style={S.card}>
        <div style={{ ...S.row, borderBottom: 'none' }}>
          <div style={{ minWidth: 0 }}>
            <div style={S.rowLabel}>계좌</div>
            <div style={S.rowDesc}>
              {kis.connected
                ? `${kis.accountMasked ?? '****'}-${kis.accountProduct} · ${kis.mock ? '모의투자' : '실전투자'}`
                : '아직 연결되지 않았습니다'}
            </div>
          </div>
          <span style={kis.connected ? (kis.credentialError ? S.pillDanger : S.pillOk) : S.pillOff}>
            {kis.connected ? (kis.credentialError ? '복호화 실패' : '연결됨') : '미연결'}
          </span>
        </div>
      </div>

      {kis.credentialError && (
        <div style={{ ...S.note, borderLeftColor: 'var(--danger)' }}>
          저장된 KIS 키를 복호화하지 못했습니다(암호화 키가 바뀌었을 수 있습니다).
          아래에서 키를 다시 입력해야 사용할 수 있습니다.
        </div>
      )}
      {!kis.encryptionConfigured && (
        <div style={{ ...S.note, borderLeftColor: 'var(--danger)' }}>
          서버에 <code style={S.code}>CREDENTIALS_ENCRYPTION_KEY</code> 가 없어 키를 저장할 수 없습니다.
          서버 관리자에게 문의하세요.
        </div>
      )}

      {!open ? (
        <button type="button" onClick={() => setOpen(true)} style={S.ghostBtn}>
          {kis.connected ? 'KIS 키 다시 입력' : '증권계좌 연결하기'}
        </button>
      ) : (
        <KisConnectForm
          defaultMock={kis.connected ? kis.mock : false}
          onCancel={() => setOpen(false)}
          onDone={async () => { setOpen(false); await onConnected(); }}
        />
      )}

      <p style={{ ...S.hint, textAlign: 'center' }}>
        저장된 키는 화면에 다시 표시되지 않습니다. 바꾸려면 전체를 새로 입력하세요.
      </p>
    </section>
  );
}

function KisConnectForm({
  defaultMock,
  onCancel,
  onDone,
}: {
  defaultMock: boolean;
  onCancel: () => void;
  onDone: () => void | Promise<void>;
}) {
  const [appKey, setAppKey] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [accountNo, setAccountNo] = useState('');
  const [accountProduct, setAccountProduct] = useState('01');
  // 사용자 결정 Q2 — 기본값은 실전투자(mock=false).
  const [mock, setMock] = useState(defaultMock);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = appKey.trim() && appSecret.trim() && accountNo.trim() && accountProduct.trim() && !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    const r = await requestJson('/api/profile/kis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appKey, appSecret, accountNo, accountProduct, mock }),
    });
    if (!r.ok) {
      setError(r.failure.message);
      setBusy(false);
      return;
    }
    setAppKey(''); setAppSecret(''); setAccountNo('');
    setBusy(false);
    await onDone();
  }

  return (
    <form onSubmit={submit} style={{ ...S.card, padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={S.note}>
        KIS 개발자센터에서 발급받은 본인 키를 입력하세요. 저장 전에 <b style={S.strong}>실제로 접속해 확인</b>하고,
        연결되지 않으면 저장하지 않습니다.
      </div>

      <Field label="App Key">
        <input value={appKey} onChange={(e) => setAppKey(e.target.value)} autoComplete="off" spellCheck={false}
          placeholder="PS4x…" style={{ ...S.input, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }} />
      </Field>
      <Field label="App Secret">
        <input value={appSecret} onChange={(e) => setAppSecret(e.target.value)} type="password" autoComplete="off"
          placeholder="••••••••••••" style={{ ...S.input, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }} />
      </Field>
      <Field label="계좌번호">
        <input value={accountNo} onChange={(e) => setAccountNo(e.target.value)} inputMode="numeric" autoComplete="off"
          placeholder="50123456" style={S.input} />
      </Field>
      <Field label="상품코드" hint="보통 01 (종합계좌)">
        <input value={accountProduct} onChange={(e) => setAccountProduct(e.target.value)} inputMode="numeric"
          autoComplete="off" placeholder="01" style={S.input} />
      </Field>

      <Field label="계좌 종류">
        <div style={S.seg}>
          <button type="button" onClick={() => setMock(false)}
            style={{ ...S.segItem, ...(mock ? {} : S.segItemLive) }} aria-pressed={!mock}>실전투자</button>
          <button type="button" onClick={() => setMock(true)}
            style={{ ...S.segItem, ...(mock ? S.segItemOn : {}) }} aria-pressed={mock}>모의투자</button>
        </div>
      </Field>

      {/* 사용자 결정 Q2 — 실전투자를 골랐다고 해서 실매매가 시작되는 것이 아님을 명확히 한다. */}
      <div style={{ ...S.note, borderLeftColor: 'var(--warn)' }}>
        <b style={S.strong}>계좌 종류와 모의 매매는 서로 다른 스위치입니다.</b><br />
        · <b style={S.strong}>계좌 종류</b>(실전/모의) — 어느 KIS 서버에 접속할지 고르는 값입니다.
        실전투자를 선택해도 그것만으로 주문이 나가지는 않습니다.<br />
        · <b style={S.strong}>모의 매매</b>(위 &lsquo;내 매매 설정&rsquo;) — 주문을 실제로 보낼지 결정하는 값입니다.
        가입 시 <b style={S.strong}>켜짐</b>으로 시작합니다.<br />
        → 실제로 돈이 움직이려면 <b style={S.strong}>실전투자 계좌 + 모의 매매 꺼짐</b>이 동시에 필요하고,
        모의 매매 해제는 4단계에서 엔진에 연결된 뒤에야 효력이 생깁니다.
      </div>

      <div style={{ ...S.note, borderLeftColor: 'var(--muted)' }}>
        연결 확인은 실제 토큰 발급 호출입니다(1~2초). 다른 프로그램이 <b style={S.strong}>같은 App Key</b>를
        쓰고 있다면 그쪽 토큰이 무효화돼 최대 1분간 조회·주문이 실패할 수 있습니다
        (KIS는 앱키당 토큰 1개, 재발급은 1분에 1회).
      </div>

      {error && <div role="alert" style={S.errorText}>{error}</div>}

      <button type="submit" disabled={!canSubmit} style={{ ...S.primaryBtn, opacity: canSubmit ? 1 : 0.5 }}>
        {busy ? 'KIS 연결 확인 중…' : '연결 확인하고 저장'}
      </button>
      <button type="button" onClick={onCancel} style={S.ghostBtn}>취소</button>
    </form>
  );
}

// ─── 보안 ───────────────────────────────────────────────────────────────────

function SecuritySection() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (next !== confirm) { setMsg({ kind: 'err', text: '새 비밀번호가 서로 다릅니다' }); return; }
    setBusy(true);
    setMsg(null);
    const r = await requestJson('/api/profile/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: current, newPassword: next }),
    });
    setBusy(false);
    if (!r.ok) { setMsg({ kind: 'err', text: r.failure.message }); return; }
    setCurrent(''); setNext(''); setConfirm('');
    setOpen(false);
    setMsg({ kind: 'ok', text: '비밀번호가 변경됐습니다' });
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => { /* 쿠키 만료로도 로그아웃된다 */ });
    window.location.replace('/login');
  }

  return (
    <section>
      <SectionHeader title="보안" />
      {msg && (
        <div role="alert" style={{ ...S.note, borderLeftColor: msg.kind === 'ok' ? 'var(--ok)' : 'var(--danger)' }}>
          {msg.text}
        </div>
      )}

      {!open ? (
        <button type="button" onClick={() => setOpen(true)} style={S.ghostBtn}>비밀번호 변경</button>
      ) : (
        <form onSubmit={submit} style={{ ...S.card, padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="현재 비밀번호">
            <input type="password" autoComplete="current-password" value={current}
              onChange={(e) => setCurrent(e.target.value)} style={S.input} />
          </Field>
          <Field label="새 비밀번호" hint="8자 이상">
            <input type="password" autoComplete="new-password" value={next}
              onChange={(e) => setNext(e.target.value)} style={S.input} />
          </Field>
          <Field label="새 비밀번호 확인">
            <input type="password" autoComplete="new-password" value={confirm}
              onChange={(e) => setConfirm(e.target.value)} style={S.input} />
          </Field>
          <button type="submit" disabled={busy} style={{ ...S.primaryBtn, opacity: busy ? 0.5 : 1 }}>
            {busy ? '변경 중…' : '변경하기'}
          </button>
          <button type="button" onClick={() => { setOpen(false); setMsg(null); }} style={S.ghostBtn}>취소</button>
        </form>
      )}

      <button type="button" onClick={logout} style={S.dangerBtn}>로그아웃</button>
    </section>
  );
}

// ─── 공통 조각 ──────────────────────────────────────────────────────────────

function SectionHeader({ title }: { title: string }) {
  return <div style={S.sectionHeader}>{title}</div>;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column' }}>
      <span style={S.fieldLabel}>{label}</span>
      {children}
      {hint && <span style={S.hint}>{hint}</span>}
    </label>
  );
}

function ToggleRow({
  label, desc, checked, onChange, warning, danger, last,
}: {
  label: string; desc: string; checked: boolean; onChange: (v: boolean) => void;
  warning: string; danger?: boolean; last?: boolean;
}) {
  return (
    <div style={{ ...S.rowBlock, borderBottom: last ? 'none' : '1px solid var(--border)' }}>
      <div style={{ ...S.row, borderBottom: 'none', paddingBottom: 4 }}>
        <div style={{ minWidth: 0 }}>
          <div style={S.rowLabel}>{label}</div>
          <div style={S.rowDesc}>{desc}</div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          aria-label={label}
          onClick={() => onChange(!checked)}
          style={S.switchHit}
        >
          <span style={{
            position: 'relative', width: 44, height: 24, borderRadius: 12, display: 'block',
            background: checked ? (danger ? 'var(--danger)' : 'var(--ok)') : 'var(--bg4)',
            transition: 'background .2s',
          }}>
            <span style={{
              position: 'absolute', top: 2, left: checked ? 22 : 2,
              width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: 'left .2s',
            }} />
          </span>
        </button>
      </div>
      {/* 배너만으로는 부족하다 — 보호받는다고 착각하기 쉬운 스위치에는 컨트롤 바로 옆에도 경고를 둔다. */}
      <div style={S.inlineWarn}>{warning}</div>
    </div>
  );
}

function NumberRow({
  label, desc, value, onChange, last,
}: { label: string; desc: string; value: number; onChange: (v: number) => void; last?: boolean }) {
  return (
    <div style={{ ...S.row, borderBottom: last ? 'none' : '1px solid var(--border)' }}>
      <div style={{ minWidth: 0 }}>
        <div style={S.rowLabel}>{label}</div>
        <div style={S.rowDesc}>{desc}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        <input
          type="number"
          inputMode="decimal"
          min={0}
          max={100}
          step={0.5}
          value={Number.isFinite(value) ? value : 0}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label={label}
          style={{ ...S.input, width: 84, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
        />
        <span style={{ fontSize: 13, color: 'var(--muted)' }}>%</span>
      </div>
    </div>
  );
}

// ─── 스타일 (모바일 412px 기준, 터치 타겟 ≥44px) ────────────────────────────

const S: Record<string, React.CSSProperties> = {
  page: { padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 },
  centerMsg: { textAlign: 'center', padding: 48, color: 'var(--muted)', fontSize: 13 },
  h1: { fontSize: 18, fontWeight: 700, margin: '4px 0 2px' },
  email: { fontSize: 13, color: 'var(--muted)', margin: 0, wordBreak: 'break-all' },

  banner: {
    background: 'rgba(239,68,68,.10)', border: '1px solid rgba(239,68,68,.45)',
    borderRadius: 12, padding: '12px 14px', margin: '10px 0 2px',
  },
  bannerTitle: { fontSize: 13.5, fontWeight: 700, color: '#fca5a5', lineHeight: 1.45 },
  bannerBody: { fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.6, margin: '6px 0 8px' },
  bannerLink: {
    display: 'inline-flex', alignItems: 'center', minHeight: 44,
    fontSize: 12.5, fontWeight: 600, color: 'var(--accent)',
  },

  sectionHeader: {
    fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase',
    letterSpacing: '.5px', padding: '16px 0 6px',
  },
  card: {
    background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden',
  },
  rowBlock: { padding: '10px 14px 12px' },
  row: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
    minHeight: 56, padding: '10px 14px',
  },
  rowLabel: { fontSize: 14 },
  rowDesc: { fontSize: 11.5, color: 'var(--muted)', marginTop: 2 },
  inlineWarn: {
    fontSize: 11.5, lineHeight: 1.5, color: '#fca5a5',
    background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.3)',
    borderRadius: 8, padding: '7px 9px', marginTop: 6,
  },
  switchHit: {
    minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
    flexShrink: 0,
  },

  saveRow: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
    padding: '10px 2px 0',
  },
  saveBtn: {
    flexShrink: 0, minHeight: 44, padding: '0 20px', borderRadius: 9,
    background: 'var(--accent)', color: '#221a05', fontSize: 14, fontWeight: 700,
  },

  note: {
    background: 'var(--bg2)', border: '1px solid var(--border2)', borderLeft: '3px solid var(--accent)',
    borderRadius: 8, padding: '10px 12px', fontSize: 12, color: 'var(--muted)',
    lineHeight: 1.6, margin: '10px 0 0',
  },
  strong: { color: 'var(--text)' },
  code: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '.9em' },
  hint: { fontSize: 11, color: 'var(--muted)', marginTop: 6 },
  fieldLabel: { fontSize: 11.5, fontWeight: 600, color: 'var(--muted)', marginBottom: 5 },
  input: {
    minHeight: 44, borderRadius: 8, border: '1px solid var(--border2)',
    background: 'var(--bg3)', color: 'var(--text)', padding: '0 12px', fontSize: 16, width: '100%',
    outlineColor: 'var(--accent)',
  },
  errorText: { fontSize: 12, color: 'var(--danger)', lineHeight: 1.5 },

  seg: { display: 'flex', border: '1px solid var(--border2)', borderRadius: 8, overflow: 'hidden' },
  segItem: {
    flex: 1, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 13, color: 'var(--muted)', background: 'transparent',
  },
  segItemOn: { background: 'var(--bg4)', color: 'var(--text)', fontWeight: 700 },
  segItemLive: { background: '#3b1d1d', color: '#fca5a5', fontWeight: 700 },

  primaryBtn: {
    minHeight: 46, borderRadius: 9, background: 'var(--accent)', color: '#221a05',
    fontSize: 15, fontWeight: 700, width: '100%',
  },
  ghostBtn: {
    minHeight: 46, borderRadius: 9, background: 'transparent',
    border: '1px solid var(--border2)', color: 'var(--text)',
    fontSize: 14, fontWeight: 600, width: '100%', marginTop: 10,
  },
  dangerBtn: {
    minHeight: 46, borderRadius: 9, background: 'transparent',
    border: '1px solid var(--danger)', color: 'var(--danger)',
    fontSize: 14, fontWeight: 600, width: '100%', marginTop: 10,
  },
  pillOk: {
    fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 20, whiteSpace: 'nowrap',
    background: '#12331f', color: '#4ade80', border: '1px solid #1d5233', flexShrink: 0,
  },
  pillOff: {
    fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 20, whiteSpace: 'nowrap',
    background: 'var(--bg3)', color: 'var(--muted)', border: '1px solid var(--border2)', flexShrink: 0,
  },
  pillDanger: {
    fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 20, whiteSpace: 'nowrap',
    background: 'rgba(239,68,68,.15)', color: '#fca5a5', border: '1px solid rgba(239,68,68,.5)', flexShrink: 0,
  },
};
