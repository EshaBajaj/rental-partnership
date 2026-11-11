// Board filters: pure helpers to normalise, serialise and apply filters to a query builder.
import type { PipelineStatus, Tier } from '@shared/types.ts';
import type { ResponsePathValue } from '../types.ts';

export interface BoardFilters {
  tiers: Tier[];
  statuses: PipelineStatus[];
  paths: ResponsePathValue[];
  profile: string; // best profile name ('' = any)
  q: string; // name / phone search
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
  includeDuplicates: boolean;
  includeBots: boolean;
}

export const DEFAULT_FILTERS: BoardFilters = {
  tiers: [],
  statuses: [],
  paths: [],
  profile: '',
  q: '',
  from: '',
  to: '',
  includeDuplicates: false,
  includeBots: false,
};

const TIERS: Tier[] = ['ideal', 'maybe', 'no'];
const STATUSES: PipelineStatus[] = ['new', 'contacted', 'visit_scheduled', 'negotiating', 'won', 'lost'];
const PATHS: ResponsePathValue[] = ['rent', 'partner', 'either', 'waitlist'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Coerce anything (saved view JSON, URL) into valid filters. */
export function normaliseFilters(raw: unknown): BoardFilters {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const arr = <T extends string>(v: unknown, allowed: T[]): T[] =>
    Array.isArray(v) ? [...new Set(v.filter((x): x is T => allowed.includes(x as T)))] : [];
  const str = (v: unknown, max = 100) => (typeof v === 'string' ? v.slice(0, max) : '');
  return {
    tiers: arr(r.tiers, TIERS),
    statuses: arr(r.statuses, STATUSES),
    paths: arr(r.paths, PATHS),
    profile: str(r.profile),
    q: str(r.q),
    from: DATE_RE.test(str(r.from)) ? str(r.from) : '',
    to: DATE_RE.test(str(r.to)) ? str(r.to) : '',
    includeDuplicates: r.includeDuplicates === true,
    includeBots: r.includeBots === true,
  };
}

export function countActive(f: BoardFilters): number {
  let n = 0;
  if (f.tiers.length) n++;
  if (f.statuses.length) n++;
  if (f.paths.length) n++;
  if (f.profile) n++;
  if (f.q.trim()) n++;
  if (f.from) n++;
  if (f.to) n++;
  if (f.includeDuplicates) n++;
  if (f.includeBots) n++;
  return n;
}

/** Minimal subset of the PostgREST builder we use (lets tests record calls). */
export interface FilterableQuery<Q> {
  eq(col: string, v: unknown): Q;
  in(col: string, v: unknown[]): Q;
  is(col: string, v: null | boolean): Q;
  gte(col: string, v: unknown): Q;
  lt(col: string, v: unknown): Q;
  or(expr: string): Q;
}

/** Escape a user string for use inside a PostgREST or() filter. */
export function escapeOrValue(s: string): string {
  return s.replace(/[,()*\\%]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function nextDay(d: string): string {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
}

export function applyFilters<Q extends FilterableQuery<Q>>(query: Q, f: BoardFilters): Q {
  let q = query;
  if (f.tiers.length) q = q.in('tier', f.tiers);
  if (f.statuses.length) q = q.in('pipeline_status', f.statuses);
  if (f.paths.length) q = q.in('path', f.paths);
  if (f.profile) q = q.eq('match_detail->>best_profile_name', f.profile);
  if (!f.includeDuplicates) q = q.is('duplicate_of', null);
  if (!f.includeBots) q = q.eq('suspected_bot', false);
  if (f.from) q = q.gte('created_at', `${f.from}T00:00:00`);
  if (f.to) q = q.lt('created_at', `${nextDay(f.to)}T00:00:00`);
  const s = escapeOrValue(f.q);
  if (s) {
    const digits = s.replace(/\D/g, '');
    const parts = [`name.ilike.*${s}*`];
    if (digits.length >= 3) parts.push(`phone_e164.ilike.*${digits}*`);
    q = q.or(parts.join(','));
  }
  return q;
}
