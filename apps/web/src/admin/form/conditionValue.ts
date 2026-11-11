// Condition editor helpers: default values, value coercion when the operator/question changes,
// human descriptions. Used by the show_if builder, profile conditions and never rules.
import type { Cond, Op, QuestionType, ShowIf, ShowIfNode } from '@shared/types.ts';
import { OTHER_VALUE } from '@shared/types.ts';
import { opLabel, opsForType } from '@shared/validator.ts';
import { YES_NO_OPTIONS } from '@shared/compile.ts';
import { groupItems, isCond } from '@shared/showif.ts';

export interface RefQuestion {
  key: string;
  type: QuestionType;
  label_en: string;
  allow_other: boolean;
  archived?: boolean;
  options: { value: string; label_en: string; archived?: boolean }[];
}

export const LIST_OPS: Op[] = ['in', 'not_in', 'contains_any', 'contains_all'];
export const NO_VALUE_OPS: Op[] = ['answered', 'not_answered'];

export function choiceOptions(ref: RefQuestion): { value: string; label_en: string; archived?: boolean }[] {
  const base = ref.type === 'yes_no' ? YES_NO_OPTIONS.map((o) => ({ value: o.value, label_en: o.label_en })) : ref.options;
  return ref.allow_other ? [...base, { value: OTHER_VALUE, label_en: 'Other (typed)' }] : base;
}

export function isChoice(t: QuestionType): boolean {
  return t === 'single' || t === 'multi' || t === 'dropdown' || t === 'yes_no';
}
export function isNumeric(t: QuestionType): boolean {
  return t === 'number' || t === 'currency';
}

export function defaultValue(op: Op, ref: RefQuestion | undefined): unknown {
  if (NO_VALUE_OPS.includes(op)) return undefined;
  if (LIST_OPS.includes(op)) return [];
  if (op === 'between') return ref && isNumeric(ref.type) ? [0, 0] : ['', ''];
  if (!ref) return '';
  if (isChoice(ref.type)) return choiceOptions(ref).filter((o) => !o.archived)[0]?.value ?? '';
  if (isNumeric(ref.type)) return 0;
  return '';
}

/** Keep as much of the old value as makes sense after the operator changes. */
export function coerceValue(op: Op, ref: RefQuestion | undefined, prev: unknown): unknown {
  if (NO_VALUE_OPS.includes(op)) return undefined;
  const numeric = !!ref && isNumeric(ref.type);
  const fix = (x: unknown) => (numeric ? toNumberOr(x, 0) : x === undefined || x === null ? '' : x);
  if (LIST_OPS.includes(op)) {
    if (Array.isArray(prev)) return prev.filter((x) => x !== '' && x !== null && x !== undefined);
    return prev === undefined || prev === '' || prev === null ? [] : [prev];
  }
  if (op === 'between') {
    if (Array.isArray(prev) && prev.length === 2) return prev.map(fix);
    const v = Array.isArray(prev) ? prev[0] : prev;
    return [fix(v), fix(v)];
  }
  const v = Array.isArray(prev) ? prev[0] : prev;
  if (v === undefined || v === '' || v === null) return defaultValue(op, ref);
  return fix(v);
}

export function toNumberOr(x: unknown, d: number): number {
  if (typeof x === 'number' && Number.isFinite(x)) return x;
  if (typeof x === 'string' && x.trim() !== '' && Number.isFinite(Number(x))) return Number(x);
  return d;
}

/** Parse the text of a number input; null when empty/invalid. */
export function parseNumberInput(s: string): number | null {
  const t = s.replace(/[,₹\s]/g, '');
  if (t === '' || !/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

export function newCondition(ref: RefQuestion | undefined, key: string): Cond {
  const op = ref ? opsForType(ref.type)[0] ?? 'answered' : 'answered';
  const c: Cond = { q: key, op };
  const v = defaultValue(op, ref);
  if (v !== undefined) c.v = v;
  return c;
}

const inr = new Intl.NumberFormat('en-IN');
function valueText(ref: RefQuestion | undefined, v: unknown): string {
  if (Array.isArray(v)) return v.map((x) => valueText(ref, x)).join(', ');
  if (ref && isChoice(ref.type)) return choiceOptions(ref).find((o) => o.value === String(v))?.label_en ?? String(v);
  if (ref?.type === 'currency' && typeof v === 'number') return `₹${inr.format(v)}`;
  return String(v ?? '');
}

export function describeCondition(c: { q: string; op: Op; v?: unknown }, ref: RefQuestion | undefined): string {
  const label = ref ? `“${ref.label_en}”` : `“${c.q}”`;
  if (NO_VALUE_OPS.includes(c.op)) return `${label} ${opLabel(c.op)}`;
  if (c.op === 'between' && Array.isArray(c.v)) return `${label} is between ${valueText(ref, c.v[0])} and ${valueText(ref, c.v[1])}`;
  return `${label} ${opLabel(c.op)} ${valueText(ref, c.v)}`;
}

export function describeShowIf(node: ShowIfNode | null, refs: Map<string, RefQuestion>): string {
  if (!node) return 'Always shown';
  if (isCond(node)) return describeCondition(node, refs.get(node.q));
  const items = groupItems(node).map((n) => {
    const s = describeShowIf(n, refs);
    return isCond(n) ? s : `(${s})`;
  });
  return items.join('all' in node ? ' AND ' : ' OR ');
}

// ---------- immutable tree editing by path ----------
export type TreePath = number[];

export function getAt(root: ShowIf, path: TreePath): ShowIfNode {
  let n: ShowIfNode = root;
  for (const i of path) n = groupItems(n as ShowIf)[i];
  return n;
}

function withItems(g: ShowIf, items: ShowIfNode[]): ShowIf {
  return 'all' in g ? { all: items } : { any: items };
}

export function replaceAt(root: ShowIf, path: TreePath, node: ShowIfNode | null): ShowIf {
  if (path.length === 0) {
    if (node === null) return withItems(root, []);
    return isCond(node) ? { all: [node] } : node;
  }
  const [i, ...rest] = path;
  const items = [...groupItems(root)];
  if (rest.length === 0) {
    if (node === null) items.splice(i, 1);
    else items[i] = node;
  } else {
    items[i] = replaceAt(items[i] as ShowIf, rest, node);
  }
  return withItems(root, items);
}

export function appendAt(root: ShowIf, path: TreePath, node: ShowIfNode): ShowIf {
  const g = getAt(root, path) as ShowIf;
  return replaceAt(root, path, withItems(g, [...groupItems(g), node]));
}

export function toggleGroupKind(g: ShowIf): ShowIf {
  return 'all' in g ? { any: g.all } : { all: g.any };
}

/** Drop empty groups; return null when nothing is left (= always shown). */
export function pruneShowIf(node: ShowIfNode | null): ShowIf | null {
  const walk = (n: ShowIfNode): ShowIfNode | null => {
    if (isCond(n)) return n;
    const items = groupItems(n).map(walk).filter((x): x is ShowIfNode => x !== null);
    if (!items.length) return null;
    return withItems(n, items);
  };
  const r = node ? walk(node) : null;
  if (!r) return null;
  return isCond(r) ? { all: [r] } : r;
}
