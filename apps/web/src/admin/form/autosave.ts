// Debounced autosave for builder fields: patches merge per row, flush after a pause,
// failures keep the patch so "retry" resends it. Nothing is dropped silently.
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../api.ts';
import { errMsg } from '../api.ts';
import type { SaveState } from '../ui.tsx';

export type Table = 'questions' | 'question_options' | 'profiles' | 'profile_conditions' | 'never_rules' | 'profile_sets' | 'properties';
interface Pending {
  table: Table;
  id: string;
  patch: Record<string, unknown>;
}

export function mergePatch(a: Record<string, unknown> | undefined, b: Record<string, unknown>) {
  return { ...(a ?? {}), ...b };
}

export function useAutosave(delay = 700) {
  const pending = useRef(new Map<string, Pending>());
  const inflight = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatus] = useState<Record<string, { state: SaveState; error: string | null }>>({});
  const [busy, setBusy] = useState(false);

  const set = (key: string, state: SaveState, error: string | null = null) => setStatus((s) => ({ ...s, [key]: { state, error } }));

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const items = [...pending.current.entries()];
    pending.current.clear();
    if (!items.length) return true;
    inflight.current++;
    setBusy(true);
    let ok = true;
    await Promise.all(
      items.map(async ([key, p]) => {
        set(key, 'saving');
        const { error } = await supabase.from(p.table).update(p.patch).eq('id', p.id);
        if (error) {
          ok = false;
          // keep the failed patch underneath anything typed since
          const newer = pending.current.get(key);
          pending.current.set(key, { ...p, patch: mergePatch(p.patch, newer?.patch ?? {}) });
          set(key, 'error', errMsg(error));
        } else if (!pending.current.has(key)) {
          set(key, 'saved');
        }
      }),
    );
    inflight.current--;
    setBusy(inflight.current > 0);
    return ok;
  }, []);

  const queue = useCallback(
    (table: Table, id: string, patch: Record<string, unknown>) => {
      const key = `${table}:${id}`;
      const prev = pending.current.get(key);
      pending.current.set(key, { table, id, patch: mergePatch(prev?.patch, patch) });
      set(key, 'saving');
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), delay);
    },
    [delay, flush],
  );

  const discard = useCallback((table: Table, id: string) => {
    const key = `${table}:${id}`;
    pending.current.delete(key);
    set(key, 'idle');
  }, []);

  const hasPending = () => pending.current.size > 0 || inflight.current > 0;

  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (pending.current.size > 0 || inflight.current > 0) e.preventDefault();
    };
    window.addEventListener('beforeunload', h);
    return () => {
      window.removeEventListener('beforeunload', h);
      void flush();
    };
  }, [flush]);

  const statusOf = (table: Table, id: string) => status[`${table}:${id}`] ?? { state: 'idle' as SaveState, error: null };
  const anyError = Object.values(status).some((s) => s.state === 'error');
  return { queue, flush, discard, statusOf, busy, anyError, hasPending };
}
