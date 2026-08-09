'use client';

/**
 * "초대코드가 없으신가요? → 가입 요청" 진입 링크 (T-010, 2026-08-09) — 목업 b1ab92b1 §1.
 *
 * **SMTP 설정이 없으면 링크 자체가 렌더되지 않는다.** `OAuthButtons` 와 같은 원칙이다 —
 * 판정을 화면이 자체적으로 하면 서버의 "설정됨" 기준과 갈라져 **눌러도 안 되는 링크**가 생긴다.
 * 그래서 서버(`GET /api/auth/signup-request`)에 물어보고, 로딩 중에도 아무것도 그리지 않는다.
 *
 * 자격증명이 채워지기 전까지 이 기능은 배포돼 있어도 사용자 눈에 존재하지 않는다.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { authStyles } from '@/components/auth/AuthShell';

export function SignupRequestLink() {
  const [enabled, setEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/auth/signup-request')
      .then((r) => r.json())
      .then((d: { enabled?: unknown }) => { if (alive) setEnabled(d.enabled === true); })
      .catch(() => { if (alive) setEnabled(false); });
    return () => { alive = false; };
  }, []);

  if (enabled !== true) return null;

  return (
    <div style={authStyles.alt}>
      <span>초대코드가 없으신가요?</span>
      <Link href="/signup/request" style={authStyles.altLink}>가입 요청</Link>
    </div>
  );
}
