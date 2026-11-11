// Edit-safety rules for the admin builder.
import type { Cond, ProfileConditionDef, QuestionType, ShowIf, ShowIfNode } from './types.ts';
import { groupItems, isCond } from './showif.ts';

export type TypeChange = 'same' | 'compatible' | 'incompatible';

const COMPATIBLE: Array<[QuestionType, QuestionType]> = [
  ['single', 'dropdown'],
  ['short_text', 'long_text'],
];

export function classifyTypeChange(from: QuestionType, to: QuestionType): TypeChange {
  if (from === to) return 'same';
  if (COMPATIBLE.some(([a, b]) => (a === from && b === to) || (a === to && b === from))) return 'compatible';
  return 'incompatible';
}

/** Published = has been part of at least one published form version. */
export function canHardDelete(item: { first_published_at: string | null }): boolean {
  return !item.first_published_at;
}

// ---------- dependency discovery ----------
export interface DependencyTarget {
  key: string;
  /** when set, only conditions using this option value count */
  optionValue?: string;
}

export interface Dependency {
  kind: 'show_if' | 'profile_condition' | 'never_rule';
  /** id of the question / profile condition / never rule */
  id: string;
  /** Human text: “Show “Budget” if …” / “Profile ‘Family retailer’ (must)” */
  label: string;
}

function condUses(c: { q: string; v?: unknown }, t: DependencyTarget): boolean {
  if (c.q !== t.key) return false;
  if (t.optionValue === undefined) return true;
  const vs = Array.isArray(c.v) ? c.v : [c.v];
  return vs.some((x) => String(x) === t.optionValue);
}

export function showIfUses(node: ShowIfNode | null | undefined, t: DependencyTarget): boolean {
  if (!node) return false;
  if (isCond(node)) return condUses(node, t);
  return groupItems(node).some((n) => showIfUses(n, t));
}

export interface DepQuestion {
  id: string;
  key: string;
  label_en: string;
  show_if: ShowIf | null;
  archived_at: string | null;
}
export interface DepProfileCondition extends ProfileConditionDef {
  id: string;
  profile_name: string;
}
export interface DepNeverRule {
  id: string;
  question_key: string;
  operator: ProfileConditionDef['operator'];
  value: unknown;
  label: string;
}

export function findDependencies(
  target: DependencyTarget,
  questions: DepQuestion[],
  conditions: DepProfileCondition[],
  neverRules: DepNeverRule[],
): Dependency[] {
  const out: Dependency[] = [];
  for (const q of questions) {
    if (q.archived_at || q.key === target.key) continue;
    if (showIfUses(q.show_if, target)) out.push({ kind: 'show_if', id: q.id, label: `When to show “${q.label_en}”` });
  }
  for (const c of conditions) {
    if (condUses({ q: c.question_key, v: c.value }, target)) {
      out.push({ kind: 'profile_condition', id: c.id, label: `Profile “${c.profile_name}” (${c.importance})` });
    }
  }
  for (const r of neverRules) {
    if (condUses({ q: r.question_key, v: r.value }, target)) out.push({ kind: 'never_rule', id: r.id, label: `Never rule “${r.label}”` });
  }
  return out;
}

// ---------- rewriting ----------
/**
 * Remove references to a key (or to one option value of it) from a show_if tree.
 * When only an option is removed from a list condition, the list shrinks; a
 * condition that ends up with nothing to compare is removed; empty groups are removed.
 * Returns null when nothing is left.
 */
export function removeFromShowIf(node: ShowIfNode | null, t: DependencyTarget): ShowIfNode | null {
  if (!node) return null;
  if (isCond(node)) return removeFromCond(node, t);
  const items = groupItems(node)
    .map((n) => removeFromShowIf(n, t))
    .filter((n): n is ShowIfNode => n !== null);
  if (items.length === 0) return null;
  return 'all' in node ? { all: items } : { any: items };
}

export function removeFromCond<C extends { q: string; v?: unknown }>(c: C, t: DependencyTarget): C | null {
  if (c.q !== t.key) return c;
  if (t.optionValue === undefined) return null;
  if (Array.isArray(c.v)) {
    const rest = c.v.filter((x) => String(x) !== t.optionValue);
    if (rest.length === c.v.length) return c;
    return rest.length ? { ...c, v: rest } : null;
  }
  return String(c.v) === t.optionValue ? null : c;
}

/** Top-level helper: always returns a group or null (never a bare condition). */
export function removeFromShowIfRoot(node: ShowIf | null, t: DependencyTarget): ShowIf | null {
  const r = removeFromShowIf(node, t);
  if (!r) return null;
  return isCond(r) ? { all: [r] } : r;
}

export function renameKeyInShowIf(node: ShowIfNode | null, from: string, to: string): ShowIfNode | null {
  if (!node) return null;
  if (isCond(node)) return node.q === from ? ({ ...node, q: to } as Cond) : node;
  const items = groupItems(node).map((n) => renameKeyInShowIf(n, from, to)!);
  return 'all' in node ? { all: items } : { any: items };
}
