'use client';

import { createContext, useCallback, useContext, useRef, useState } from 'react';

export type ToastVariant = 'success' | 'error' | 'warning' | 'info';

interface ToastItem {
  id: number;
  msg: string;
  variant: ToastVariant;
}

interface ToastCtx {
  show: (msg: string, variant?: ToastVariant) => void;
}

const Ctx = createContext<ToastCtx>({ show: () => {} });

export function useToast() {
  return useContext(Ctx);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const counter = useRef(0);

  const show = useCallback((msg: string, variant: ToastVariant = 'info') => {
    const id = ++counter.current;
    setToasts(prev => [...prev.slice(-2), { id, msg, variant }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000);
  }, []);

  const dismiss = (id: number) => setToasts(prev => prev.filter(t => t.id !== id));

  return (
    <Ctx.Provider value={{ show }}>
      {children}
      <div style={{
        position: 'fixed',
        top: 'calc(var(--safe-top, 0px) + 16px)',
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        zIndex: 9999,
        pointerEvents: 'none',
      }}>
        {toasts.map(t => (
          <div
            key={t.id}
            onClick={() => dismiss(t.id)}
            style={{
              background: variantBg(t.variant),
              border: `1px solid ${variantBorder(t.variant)}`,
              color: '#fff',
              padding: '10px 20px',
              borderRadius: 10,
              fontSize: 13,
              fontWeight: 600,
              whiteSpace: 'nowrap',
              boxShadow: '0 4px 20px rgba(0,0,0,.4)',
              pointerEvents: 'auto',
              cursor: 'pointer',
              maxWidth: 'calc(100vw - 32px)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {t.msg}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

function variantBg(v: ToastVariant): string {
  switch (v) {
    case 'success': return '#14532d';
    case 'error':   return '#7f1d1d';
    case 'warning': return '#78350f';
    default:        return '#1e293b';
  }
}

function variantBorder(v: ToastVariant): string {
  switch (v) {
    case 'success': return 'rgba(34,197,94,.5)';
    case 'error':   return 'rgba(239,68,68,.5)';
    case 'warning': return 'rgba(245,158,11,.5)';
    default:        return 'var(--border)';
  }
}
