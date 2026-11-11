// Small UI kit for the admin: toasts, dialogs, badges, save indicator, error boundary.
import { Component, createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { Tier } from '@shared/types.ts';

// ---------------------------------------------------------------- toasts
interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'success' | 'error';
}
const ToastCtx = createContext<(text: string, kind?: Toast['kind']) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x.slice(-3), { id, text, kind }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), kind === 'error' ? 8000 : 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4" aria-live="polite">
        {items.map((t) => (
          <div
            key={t.id}
            role={t.kind === 'error' ? 'alert' : 'status'}
            className={`pointer-events-auto max-w-md whitespace-pre-line rounded-xl px-4 py-3 text-sm shadow-lg ${
              t.kind === 'error' ? 'bg-red-700 text-white' : t.kind === 'success' ? 'bg-brand-700 text-white' : 'bg-stone-900 text-white'
            }`}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ---------------------------------------------------------------- modal / confirm
export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`max-h-[90dvh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl outline-none sm:rounded-2xl ${wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'}`}
      >
        <div className="mb-3 flex items-start justify-between gap-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button className="btn-ghost -m-2 px-2 py-1" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

interface ConfirmOpts {
  title: string;
  body: ReactNode;
  confirm?: string;
  danger?: boolean;
}
const ConfirmCtx = createContext<(o: ConfirmOpts) => Promise<boolean>>(async () => false);
export const useConfirm = () => useContext(ConfirmCtx);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOpts & { resolve: (b: boolean) => void }) | null>(null);
  const ask = useCallback((o: ConfirmOpts) => new Promise<boolean>((resolve) => setState({ ...o, resolve })), []);
  const close = (b: boolean) => {
    state?.resolve(b);
    setState(null);
  };
  return (
    <ConfirmCtx.Provider value={ask}>
      {children}
      {state && (
        <Modal title={state.title} onClose={() => close(false)}>
          <div className="space-y-3 text-sm text-stone-700">{state.body}</div>
          <div className="mt-5 flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => close(false)}>
              Cancel
            </button>
            <button className={state.danger ? 'btn-danger' : 'btn-primary'} onClick={() => close(true)}>
              {state.confirm ?? 'OK'}
            </button>
          </div>
        </Modal>
      )}
    </ConfirmCtx.Provider>
  );
}

// ---------------------------------------------------------------- bits
export const TIER_STYLE: Record<Tier, string> = {
  ideal: 'bg-emerald-100 text-emerald-800 ring-emerald-300',
  maybe: 'bg-amber-100 text-amber-800 ring-amber-300',
  no: 'bg-stone-200 text-stone-700 ring-stone-300',
};
export const TIER_LABEL: Record<Tier, string> = { ideal: 'Ideal', maybe: 'Maybe', no: 'Not a fit' };

export function TierBadge({ tier }: { tier: Tier }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${TIER_STYLE[tier]}`}>{TIER_LABEL[tier]}</span>;
}

export function Badge({ children, tone = 'stone', title }: { children: ReactNode; tone?: 'stone' | 'red' | 'amber' | 'blue' | 'green' | 'violet'; title?: string }) {
  const tones = {
    stone: 'bg-stone-100 text-stone-700',
    red: 'bg-red-100 text-red-800',
    amber: 'bg-amber-100 text-amber-800',
    blue: 'bg-sky-100 text-sky-800',
    green: 'bg-emerald-100 text-emerald-800',
    violet: 'bg-violet-100 text-violet-800',
  };
  return (
    <span title={title} className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-stone-500" role="status">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-stone-300 border-t-brand-600" />
      {label}
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">
      <p className="whitespace-pre-line">{msg}</p>
      {onRetry && (
        <button className="btn-secondary mt-3" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl border border-dashed border-stone-300 p-8 text-center text-stone-500">{children}</div>;
}

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';
export function SaveIndicator({ state, onRetry, error }: { state: SaveState; onRetry?: () => void; error?: string | null }) {
  if (state === 'saving') return <span className="text-xs text-stone-500">Saving…</span>;
  if (state === 'saved') return <span className="text-xs text-emerald-700">Saved ✓</span>;
  if (state === 'error')
    return (
      <span className="text-xs text-red-700" title={error ?? undefined}>
        Not saved{error ? `: ${error}` : ''} —{' '}
        <button className="underline" onClick={onRetry}>
          retry
        </button>
      </span>
    );
  return null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error(error);
  }
  render() {
    if (this.state.error)
      return (
        <div className="p-6">
          <ErrorBox error={this.state.error} />
          <button className="btn-secondary mt-3" onClick={() => this.setState({ error: null })}>
            Reload this screen
          </button>
        </div>
      );
    return this.props.children;
  }
}

/** Debounce a value. */
export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function download(filename: string, content: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
