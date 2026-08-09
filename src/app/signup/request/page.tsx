'use client';

/**
 * /signup/request — 가입 요청 (T-010, 2026-08-09) — 목업 b1ab92b1 §1·§2.
 *
 * 초대코드가 없는 외부인이 관리자에게 요청을 보내는 화면. 모바일 우선(412px 완결), 다크 테마.
 *
 * ## 🔒 이 화면은 초대코드를 **절대** 보여주지 않는다
 * 코드는 관리자 메일로만 가고, 관리자가 검토 후 직접(카톡 등) 전달한다.
 * 화면에 코드가 나오면 초대 게이트가 통째로 무의미해진다.
 *
 * ## T-007 교훈 — 성공 화면은 "전송되었습니다"
 * 서버가 실제 발송에 성공했을 때만 `delivery:'sent'` 를 주고, 그때만 이 문구를 띄운다.
 *   - sent     : 메일 전송 성공
 *   - fallback : 메일은 실패했지만 관리자에게 메신저로 알림이 갔다 (거짓 성공도, 거짓 실패도 아님)
 *   - failed   : 둘 다 실패 — 빨간 화면 + 다시 시도
 */
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AuthShell, authStyles } from '@/components/auth/AuthShell';

type Delivery = 'sent' | 'fallback' | 'failed';

const MESSAGE_MAX = 1_000;

export default function SignupRequestPage() {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => { emailRef.current?.focus(); }, []);

  // 서버가 SMTP 설정 여부를 판정한다 — 화면이 자체 판단하면 기준이 갈라진다.
  useEffect(() => {
    let alive = true;
    fetch('/api/auth/signup-request')
      .then((r) => r.json())
      .then((d: { enabled?: unknown }) => { if (alive) setEnabled(d.enabled === true); })
      .catch(() => { if (alive) setEnabled(false); });
    return () => { alive = false; };
  }, []);

  const canSubmit = email.trim().length > 0 && name.trim().length > 0 && !busy;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/signup-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name, message }),
      });
      const data = await res.json().catch(() => ({})) as {
        ok?: boolean; delivery?: Delivery; detail?: string;
      };

      if (res.ok && data.ok) {
        setDelivery(data.delivery === 'fallback' ? 'fallback' : 'sent');
        setBusy(false);
        return;
      }
      // 전달 자체가 실패한 경우만 전용 화면으로 넘어간다. 나머지(400/429/503)는 폼 위 에러.
      if (data.delivery === 'failed') {
        setDelivery('failed');
        setBusy(false);
        return;
      }
      setError(data.detail ?? `요청을 보내지 못했습니다 (HTTP ${res.status})`);
      setBusy(false);
    } catch {
      setError('네트워크 오류 — 다시 시도하세요');
      setBusy(false);
    }
  }

  // ── 발송 결과 화면 ────────────────────────────────────────────────────────
  if (delivery === 'sent' || delivery === 'fallback') {
    return (
      <AuthShell title="가입 요청" subtitle="관리자에게 전달했습니다" logo="✉️">
        <div style={authStyles.bigResult}>
          <div style={authStyles.bigResultIcon} aria-hidden>📨</div>
          <h2 style={authStyles.bigResultTitle}>요청을 전달했습니다</h2>
          {delivery === 'sent' ? (
            <p style={authStyles.bigResultBody}>
              관리자에게 메일이 <b style={{ color: 'var(--text)' }}>전송되었습니다.</b><br />
              승인되면 관리자가 직접 연락드립니다.
            </p>
          ) : (
            /* 메일은 실패했지만 관리자는 요청을 받았다.
               "메일이 전송되었습니다"라고 하면 거짓말이 되므로 실제로 일어난 일을 말한다. */
            <p style={authStyles.bigResultBody}>
              메일 발송에는 실패했지만, 관리자에게 <b style={{ color: 'var(--text)' }}>메신저로 알렸습니다.</b><br />
              승인되면 관리자가 직접 연락드립니다.
            </p>
          )}
        </div>
        <Link href="/login" style={{ ...authStyles.submitGhost, marginTop: 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          로그인으로 돌아가기
        </Link>
      </AuthShell>
    );
  }

  if (delivery === 'failed') {
    return (
      <AuthShell title="가입 요청" subtitle="전달하지 못했습니다" logo="✉️">
        <div role="alert" style={authStyles.noteDanger}>
          <b style={{ color: '#fca5a5' }}>요청을 전달하지 못했습니다.</b><br />
          메일 서버에 연결하지 못했습니다. 잠시 후 다시 시도하시거나,
          관리자에게 다른 방법으로 연락해 주세요.
        </div>
        <button type="button" onClick={() => setDelivery(null)} style={authStyles.submitGhost}>
          다시 시도
        </button>
        <div style={authStyles.alt}>
          <Link href="/login" style={authStyles.altLink}>로그인으로 돌아가기</Link>
        </div>
      </AuthShell>
    );
  }

  // ── 기능 미설정 ──────────────────────────────────────────────────────────
  if (enabled === false) {
    return (
      <AuthShell title="가입 요청" subtitle="지금은 사용할 수 없습니다" logo="✉️">
        <div role="alert" style={authStyles.note}>
          가입 요청 기능이 아직 설정되지 않았습니다.
          초대코드는 관리자에게 <b style={{ color: 'var(--text)' }}>직접</b> 문의해 주세요.
        </div>
        <div style={authStyles.alt}>
          <Link href="/login" style={authStyles.altLink}>로그인으로 돌아가기</Link>
        </div>
      </AuthShell>
    );
  }

  // ── 폼 ──────────────────────────────────────────────────────────────────
  return (
    <AuthShell title="가입 요청" subtitle="초대코드가 없으신가요? 관리자에게 요청하세요" logo="✉️">
      <form onSubmit={onSubmit}>
        <div style={authStyles.field}>
          <label htmlFor="email" style={authStyles.label}>
            이메일 <span style={{ color: 'var(--accent)' }} aria-hidden>*</span>
          </label>
          <input
            id="email"
            ref={emailRef}
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            style={authStyles.input}
          />
          <div style={authStyles.hint}>관리자가 회신할 주소입니다</div>
        </div>

        <div style={authStyles.field}>
          <label htmlFor="name" style={authStyles.label}>
            이름 / 호칭 <span style={{ color: 'var(--accent)' }} aria-hidden>*</span>
          </label>
          <input
            id="name"
            type="text"
            autoComplete="name"
            maxLength={60}
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="홍길동"
            style={authStyles.input}
          />
          <div style={authStyles.hint}>관리자가 누구인지 알아볼 수 있게</div>
        </div>

        <div style={authStyles.field}>
          <label htmlFor="message" style={authStyles.label}>하실 말씀 (선택)</label>
          <textarea
            id="message"
            rows={3}
            maxLength={MESSAGE_MAX}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="예) 형이 얘기한 그 주식앱 써보고 싶어요"
            style={authStyles.textarea}
          />
        </div>

        <div id="request-error" role="alert" style={authStyles.error}>{error ?? ' '}</div>

        <button type="submit" disabled={!canSubmit} style={{ ...authStyles.submit, opacity: canSubmit ? 1 : 0.5 }}>
          {busy ? '보내는 중…' : '요청 보내기'}
        </button>
      </form>

      <div style={authStyles.note}>
        보내주신 내용은 <b style={{ color: 'var(--text)' }}>관리자에게만</b> 전달됩니다.
        승인되면 관리자가 <b style={{ color: 'var(--text)' }}>직접 연락</b>드립니다 —
        이 화면에서 초대코드가 바로 나오지는 않습니다.
      </div>

      <div style={authStyles.alt}>
        <span>초대코드가 이미 있나요?</span>
        <Link href="/signup" style={authStyles.altLink}>회원가입</Link>
      </div>
    </AuthShell>
  );
}
