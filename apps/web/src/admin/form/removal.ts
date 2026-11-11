// Plan the safe removal of a question or option: list every dependency and compute the
// rewrites passed to rpc remove_question_or_option.
import type { Op, ShowIf } from '@shared/types.ts';
import { type Dependency, type DependencyTarget, findDependencies, removeFromCond, removeFromShowIfRoot, showIfUses } from '@shared/edit-safety.ts';

export interface PlanQuestion {
  id: string;
  key: string;
  label_en: string;
  show_if: ShowIf | null;
  archived_at: string | null;
}
export interface PlanCondition {
  id: string;
  profile_name: string;
  question_key: string;
  operator: Op;
  value: unknown;
  importance: 'must' | 'important' | 'nice';
}
export interface PlanNever {
  id: string;
  question_key: string;
  operator: Op;
  value: unknown;
  label: string;
}

export interface RemovalPlan {
  dependencies: Dependency[];
  /** question_id → new show_if (null = always shown) */
  showIfUpdates: Record<string, ShowIf | null>;
  /** draft conditions whose value list just shrinks (applied inside the RPC transaction) */
  conditionUpdates: { id: string; value: unknown }[];
  /** draft never rules whose value list just shrinks */
  neverUpdates: { id: string; value: unknown }[];
  removeConditionIds: string[];
  removeNeverIds: string[];
}

export function planRemoval(target: DependencyTarget, questions: PlanQuestion[], conditions: PlanCondition[], never: PlanNever[]): RemovalPlan {
  const dependencies = findDependencies(target, questions, conditions, never);
  const showIfUpdates: Record<string, ShowIf | null> = {};
  for (const q of questions) {
    if (q.archived_at || q.key === target.key) continue;
    if (showIfUses(q.show_if, target)) showIfUpdates[q.id] = removeFromShowIfRoot(q.show_if, target);
  }
  const conditionUpdates: { id: string; value: unknown }[] = [];
  const removeConditionIds: string[] = [];
  for (const c of conditions) {
    if (c.question_key !== target.key) continue;
    const r = removeFromCond({ q: c.question_key, v: c.value }, target);
    if (r === null) removeConditionIds.push(c.id);
    else if (r.v !== c.value) conditionUpdates.push({ id: c.id, value: r.v });
  }
  const removeNeverIds = never
    .filter((n) => n.question_key === target.key && removeFromCond({ q: n.question_key, v: n.value }, target) === null)
    .map((n) => n.id);
  const neverUpdates: { id: string; value: unknown }[] = [];
  for (const n of never) {
    if (n.question_key !== target.key || removeNeverIds.includes(n.id)) continue;
    const r = removeFromCond({ q: n.question_key, v: n.value }, target);
    if (r && r.v !== n.value) neverUpdates.push({ id: n.id, value: r.v });
  }
  return { dependencies, showIfUpdates, conditionUpdates, neverUpdates, removeConditionIds, removeNeverIds };
}

export function slugify(s: string): string {
  const base = s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return base;
}

/** A unique slug for a new key/option value. Keys must start with a letter. */
export function uniqueSlug(label: string, taken: Iterable<string>, opts: { mustStartWithLetter: boolean; fallback: string }): string {
  const used = new Set(taken);
  let base = slugify(label) || opts.fallback;
  if (opts.mustStartWithLetter && !/^[a-z]/.test(base)) base = `${opts.fallback}_${base}`.slice(0, 40);
  if (!used.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const s = `${base.slice(0, 36)}_${i}`;
    if (!used.has(s)) return s;
  }
  return `${opts.fallback}_${Date.now()}`;
}
