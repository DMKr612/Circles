import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

type Toast = { id: number; kind: 'success'|'error'|'info'; text: string; timeout?: number };
type Ctx = {
  push: (t: Omit<Toast,'id'>) => void;
  success: (text: string, timeout?: number) => void;
  error:   (text: string, timeout?: number) => void;
  info:    (text: string, timeout?: number) => void;
};
const ToastCtx = createContext<Ctx | null>(null);

export function useToast(): Ctx {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>');
  return ctx;
}

export function ToastProvider({ children }: { children?: React.ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast,'id'>) => {
    const id = Date.now() + Math.random();
    const toast: Toast = { id, timeout: 3000, ...t };
    setList(prev => [...prev, toast]);
    window.setTimeout(() => setList(prev => prev.filter(x => x.id !== id)), toast.timeout);
  }, []);
  const value = useMemo<Ctx>(() => ({
    push,
    success: (text, timeout) => push({ kind:'success', text, timeout }),
    error:   (text, timeout) => push({ kind:'error',   text, timeout }),
    info:    (text, timeout) => push({ kind:'info',    text, timeout }),
  }), [push]);

  const overlay = (
    <div className="pointer-events-none fixed inset-0 z-[9999] flex items-start justify-end p-4">
      <div className="mt-10 w-full max-w-sm space-y-2">
        {list.map(t => (
          <div
            key={t.id}
            className={[
              'pointer-events-auto rounded-md border px-3 py-2 text-sm shadow',
              t.kind === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' :
              t.kind === 'error'   ? 'border-red-200 bg-red-50 text-red-700' :
                                     'border-neutral-200 bg-white text-neutral-800'
            ].join(' ')}
          >
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <ToastCtx.Provider value={value}>
      {children}
      {createPortal(overlay, document.body)}
    </ToastCtx.Provider>
  );
}