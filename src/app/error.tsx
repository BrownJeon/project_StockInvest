'use client';

/**
 * App Router 라우트 에러 경계 — T-021 (c).
 *
 * 이전에는 `src/app/` 전체에 error.tsx 가 하나도 없어서, 렌더 중 예외가 나면
 * Next.js 기본 화면("Application error: a client-side exception has occurred")이
 * 라우트를 통째로 대체했다. 실계좌 운용 중인 앱에서 **사용자가 아무 조치도 할 수 없는**
 * 백지 화면이 뜨는 상태였다.
 *
 * 🔴 정보 노출 정책: `error.message`·스택 트레이스는 **절대 화면에 렌더하지 않는다.**
 *    내부 경로·환경설정·API 응답 원문이 그대로 새어나갈 수 있다.
 *    사용자에게는 문의용 식별자인 `digest`(Next.js 가 서버 로그와 대조하기 위해 발급하는
 *    해시)만 보여준다. 상세는 개발자 콘솔에만 남긴다.
 *
 * 범위: 로깅은 `console.error` 뿐이다. 외부 전송·텔레그램/메일 알림 배선은 하지 않는다.
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function AppError({ error, reset }: Props) {
  const router = useRouter();

  useEffect(() => {
    // 개발자 콘솔 전용 — 화면에는 노출하지 않는다.
    console.error('[app/error]', error);
  }, [error]);

  return (
    <div
      style={{
        minHeight: '60vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 14,
        padding: '32px 20px',
        background: 'var(--bg)',
        color: 'var(--text)',
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: 34, lineHeight: 1 }} aria-hidden>⚠️</div>

      <h1 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>
        이 화면에 문제가 발생했습니다
      </h1>

      <p style={{ fontSize: 14, color: 'var(--muted)', lineHeight: 1.6, margin: 0, maxWidth: 340 }}>
        일시적인 오류일 수 있습니다.<br />
        다시 시도하거나 이전 화면으로 돌아가세요.
      </p>

      {error.digest && (
        <div
          style={{
            fontSize: 12,
            color: 'var(--muted)',
            background: 'var(--bg2)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '6px 12px',
            wordBreak: 'break-all',
            maxWidth: '100%',
          }}
        >
          오류 코드 <span className="num" style={{ color: 'var(--text)', fontWeight: 700 }}>{error.digest}</span>
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, width: '100%', maxWidth: 340, marginTop: 4 }}>
        <button
          onClick={() => reset()}
          style={{
            flex: 1,
            height: 48,
            borderRadius: 10,
            fontSize: 15,
            fontWeight: 700,
            background: 'var(--danger)',
            color: '#fff',
            border: 'none',
          }}
        >
          다시 시도
        </button>
        <button
          onClick={() => router.back()}
          style={{
            flex: 1,
            height: 48,
            borderRadius: 10,
            fontSize: 15,
            fontWeight: 700,
            background: 'var(--bg3)',
            color: 'var(--muted)',
            border: '1px solid var(--border2)',
          }}
        >
          뒤로가기
        </button>
      </div>
    </div>
  );
}
