// Funnel math over funnel_events (distinct sessions per step).
import type { FunnelEventRow } from '../types.ts';

export interface FunnelStep {
  id: string;
  label: string;
  sessions: number;
  /** % of the first step */
  ofStart: number;
  /** % lost compared with the previous step */
  dropOff: number;
}

export function computeFunnel(events: FunnelEventRow[], questions: { key: string; label: string }[]): FunnelStep[] {
  const sets = new Map<string, Set<string>>();
  const add = (id: string, s: string) => {
    if (!sets.has(id)) sets.set(id, new Set());
    sets.get(id)!.add(s);
  };
  for (const e of events) {
    if (e.event === 'view') add('view', e.session_id);
    else if (e.event === 'start') add('start', e.session_id);
    else if (e.event === 'answer' && e.question_key) add(`q:${e.question_key}`, e.session_id);
    else if (e.event === 'submit_ok') add('submit', e.session_id);
  }
  const defs = [
    { id: 'view', label: 'Opened the form' },
    { id: 'start', label: 'Started' },
    ...questions.map((q) => ({ id: `q:${q.key}`, label: q.label })),
    { id: 'submit', label: 'Submitted' },
  ];
  const first = sets.get('view')?.size ?? 0;
  let prev: number | null = null;
  return defs.map((d) => {
    const n = sets.get(d.id)?.size ?? 0;
    const step: FunnelStep = {
      ...d,
      sessions: n,
      ofStart: first ? Math.round((n / first) * 1000) / 10 : 0,
      dropOff: prev ? Math.max(0, Math.round(((prev - n) / prev) * 1000) / 10) : 0,
    };
    prev = n;
    return step;
  });
}

export function median(nums: number[]): number | null {
  const a = nums.filter((n) => Number.isFinite(n)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

export function formatDuration(sec: number | null): string {
  if (sec === null) return '—';
  const s = Math.round(sec);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}
