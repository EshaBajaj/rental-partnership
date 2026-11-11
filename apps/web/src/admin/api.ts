// Thin data helpers around the admin Supabase client.
import { supabase } from '../lib/supabase.ts';

export { supabase };

interface PgErrorLike {
  message?: string;
  details?: string | null;
  hint?: string | null;
  code?: string;
}

/** Turn any error (PostgREST, storage, fetch) into a sentence for humans. */
export function errMsg(e: unknown): string {
  if (!e) return 'Something went wrong.';
  if (typeof e === 'string') return e;
  const p = e as PgErrorLike;
  if (p.code === '42501') return p.message && !/permission denied/i.test(p.message) ? p.message : 'You do not have permission to do this.';
  if (p.code === '23505') return 'That value is already used. Pick a different one.';
  if (p.code === 'PGRST301' || /JWT expired/i.test(p.message ?? '')) return 'Your session expired. Please sign in again.';
  if (/Failed to fetch|NetworkError|Load failed/i.test(p.message ?? '')) return 'Network problem — check your connection and try again.';
  if (p.hint && p.hint.includes('\n')) return p.hint;
  const m = (p.message ?? String(e)).replace(/^Cannot publish: /, '');
  return m.includes(' | ') ? m.split(' | ').join('\n') : m;
}

/** Call an RPC and throw a readable Error on failure. */
export async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(errMsg(error));
  return data as T;
}

export function must<T>(r: { data: T | null; error: unknown }): T {
  if (r.error) throw new Error(errMsg(r.error));
  return r.data as T;
}

export const qk = {
  me: ['me'] as const,
  properties: ['properties'] as const,
  leads: (pid: string, f: unknown) => ['leads', pid, f] as const,
  lead: (id: string) => ['lead', id] as const,
  leadEvents: (id: string) => ['lead-events', id] as const,
  voice: (id: string) => ['voice', id] as const,
  questions: (pid: string) => ['questions', pid] as const,
  formVersions: (pid: string) => ['form-versions', pid] as const,
  profileSets: (pid: string) => ['profile-sets', pid] as const,
  profiles: (setId: string) => ['profiles', setId] as const,
  never: (setId: string) => ['never', setId] as const,
  savedViews: (pid: string) => ['saved-views', pid] as const,
  admins: ['admins'] as const,
  audit: (page: number, table: string) => ['audit', page, table] as const,
  funnel: (pid: string, from: string, to: string) => ['funnel', pid, from, to] as const,
};
