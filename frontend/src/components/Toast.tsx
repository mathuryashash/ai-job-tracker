import { createContext, useCallback, useContext, useState } from 'react';

type ToastType = 'success' | 'error' | 'info';
interface Toast { id: number; text: string; type: ToastType }
type ShowToast = (text: string, type?: ToastType) => void;

const Ctx = createContext<ShowToast>(() => {});

export function useToast(): ShowToast {
  return useContext(Ctx);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  let next = 0;

  const show: ShowToast = useCallback((text, type = 'info') => {
    const id = ++next;
    setToasts(ts => [...ts, { id, text, type }]);
    setTimeout(() => setToasts(ts => ts.filter(t => t.id !== id)), 4000);
  }, []);

  return (
    <Ctx.Provider value={show}>
      {children}
      {toasts.length > 0 && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, display: 'flex',
          flexDirection: 'column', gap: 8, zIndex: 9999, maxWidth: 360,
        }}>
          {toasts.map(t => (
            <div key={t.id} style={{
              padding: '10px 16px', borderRadius: 10, fontSize: '0.875rem',
              lineHeight: '1.4', fontWeight: 500,
              background: t.type === 'error' ? 'var(--red-bg)' : t.type === 'success' ? 'var(--green-bg)' : 'var(--surface-2)',
              color: t.type === 'error' ? 'var(--red)' : t.type === 'success' ? 'var(--green)' : 'var(--text)',
              border: `1px solid ${t.type === 'error' ? 'rgba(239,68,68,.2)' : t.type === 'success' ? 'rgba(16,185,129,.2)' : 'var(--border)'}`,
              animation: 'toastIn 0.18s ease-out',
            }}>
              {t.text}
            </div>
          ))}
        </div>
      )}
    </Ctx.Provider>
  );
}
