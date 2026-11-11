// show_if engine. MUST stay semantically identical to the SQL implementation
// (public.sls_eval_cond / public.sls_eval_showif in the migrations). The parity
// test in supabase/tests runs the same fixture through both.
//
// Semantics
//  - A value is "answered" unless it is undefined, null, "" or [].
//  - Every operator except `not_answered` is false when the value is not answered.
//  - Array answers (multi-select): eq → includes v; neq → does not include v;
//    in → any element in v; not_in → no element in v.
//  - gte/lte/between compare numerically when both sides are numeric,
//    otherwise as strings (ISO dates compare correctly as strings).
//  - contains_any / contains_all treat scalars as one-element arrays.

import type { CompiledQuestion, Cond, FormConfig, Op, ShowIf, ShowIfNode, Values } from './types.ts';
import { OPS } from './types.ts';

export function isAnswered(a: unknown): boolean {
  if (a === undefined || a === null) return false;
  if (typeof a === 'string') return a.trim() !== '';
  if (Array.isArray(a)) return a.length > 0;
  return true;
}

export function isCond(n: unknown): n is Cond {
  return !!n && typeof n === 'object' && 'q' in (n as object) && 'op' in (n as object);
}
export function isGroup(n: unknown): n is ShowIf {
  return !!n && typeof n === 'object' && ('all' in (n as object) || 'any' in (n as object));
}
export function groupItems(g: ShowIf): ShowIfNode[] {
  return 'all' in g ? g.all : g.any;
}
export function isOp(op: unknown): op is Op {
  return typeof op === 'string' && (OPS as readonly string[]).includes(op);
}

const NUMERIC_RE = /^-?\d+(\.\d+)?$/;
function toNum(x: unknown): number | null {
  if (typeof x === 'number' && Number.isFinite(x)) return x;
  if (typeof x === 'string' && NUMERIC_RE.test(x.trim())) return Number(x.trim());
  return null;
}
function scalarEq(x: unknown, v: unknown): boolean {
  if (typeof x === 'number' && typeof v === 'number') return x === v;
  if (x === null || v === null || x === undefined || v === undefined) return false;
  if (typeof x === 'object' || typeof v === 'object') return false;
  return String(x) === String(v);
}
function cmp(a: unknown, b: unknown): number | null {
  if (Array.isArray(a) || Array.isArray(b)) return null;
  if (a === null || b === null || a === undefined || b === undefined) return null;
  if (typeof a === 'object' || typeof b === 'object') return null;
  const na = toNum(a);
  const nb = toNum(b);
  if (na !== null && nb !== null) return na === nb ? 0 : na < nb ? -1 : 1;
  const sa = String(a);
  const sb = String(b);
  return sa === sb ? 0 : sa < sb ? -1 : 1;
}
function asArray(x: unknown): unknown[] {
  return Array.isArray(x) ? x : [x];
}

/** Evaluate one operator against an answer value. */
export function evalOp(op: Op, a: unknown, v: unknown): boolean {
  if (op === 'answered') return isAnswered(a);
  if (op === 'not_answered') return !isAnswered(a);
  if (!isAnswered(a)) return false;
  switch (op) {
    case 'eq':
      return Array.isArray(a) ? a.some((x) => scalarEq(x, v)) : scalarEq(a, v);
    case 'neq':
      return !evalOp('eq', a, v);
    case 'in': {
      const vs = asArray(v);
      return asArray(a).some((x) => vs.some((y) => scalarEq(x, y)));
    }
    case 'not_in':
      return !evalOp('in', a, v);
    case 'gte': {
      const c = cmp(a, v);
      return c !== null && c >= 0;
    }
    case 'lte': {
      const c = cmp(a, v);
      return c !== null && c <= 0;
    }
    case 'between': {
      if (!Array.isArray(v) || v.length !== 2) return false;
      const lo = cmp(a, v[0]);
      const hi = cmp(a, v[1]);
      return lo !== null && hi !== null && lo >= 0 && hi <= 0;
    }
    case 'contains_any': {
      const vs = asArray(v);
      return asArray(a).some((x) => vs.some((y) => scalarEq(x, y)));
    }
    case 'contains_all': {
      const as = asArray(a);
      const vs = asArray(v);
      return vs.length > 0 && vs.every((y) => as.some((x) => scalarEq(x, y)));
    }
    default:
      return false;
  }
}

export function evalCond(c: Cond, values: Values): boolean {
  return evalOp(c.op, values[c.q], c.v);
}

/** Evaluate a show_if tree. null/undefined = always shown. Empty groups are true. */
export function evalShowIf(node: ShowIfNode | null | undefined, values: Values): boolean {
  if (!node) return true;
  if (isCond(node)) return evalCond(node, values);
  if ('all' in node) return node.all.every((n) => evalShowIf(n, values));
  if ('any' in node) return node.any.length === 0 || node.any.some((n) => evalShowIf(n, values));
  return false;
}

export interface Visibility {
  /** Keys of visible questions in form order. */
  visible: string[];
  /** Values restricted to visible questions (hidden answers discarded). */
  effective: Values;
}

/**
 * Walk the form in order. A question is visible when its show_if passes against
 * the answers of *visible earlier* questions; answers to hidden questions are dropped.
 */
export function computeVisibility(config: FormConfig, values: Values): Visibility {
  const effective: Values = {};
  const visible: string[] = [];
  for (const q of config.questions) {
    if (evalShowIf(q.show_if, effective)) {
      visible.push(q.key);
      if (q.key in values) effective[q.key] = values[q.key];
    }
  }
  return { visible, effective };
}

export function isVisible(q: CompiledQuestion, effectiveSoFar: Values): boolean {
  return evalShowIf(q.show_if, effectiveSoFar);
}

// ---------- Three-valued evaluation (used by the publish validator) ----------
export type Tri = true | false | null; // null = unknown
export type Knowledge = (key: string) => { known: true; value: unknown } | { known: false };

export function evalTri(node: ShowIfNode | null | undefined, know: Knowledge): Tri {
  if (!node) return true;
  if (isCond(node)) {
    const k = know(node.q);
    if (!k.known) return null;
    return evalCond(node, { [node.q]: k.value });
  }
  const items = groupItems(node);
  if ('all' in node) {
    let unknown = false;
    for (const n of items) {
      const r = evalTri(n, know);
      if (r === false) return false;
      if (r === null) unknown = true;
    }
    return unknown ? null : true;
  }
  if (items.length === 0) return true;
  let unknown = false;
  for (const n of items) {
    const r = evalTri(n, know);
    if (r === true) return true;
    if (r === null) unknown = true;
  }
  return unknown ? null : false;
}

/** Collect every condition in a tree. */
export function collectConds(node: ShowIfNode | null | undefined, out: Cond[] = []): Cond[] {
  if (!node) return out;
  if (isCond(node)) out.push(node);
  else for (const n of groupItems(node)) collectConds(n, out);
  return out;
}
