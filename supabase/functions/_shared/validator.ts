// Publish validator. Runs on every edit/reorder in the admin builder and blocks
// publishing with plain-language messages. The SQL publish function re-checks the
// structural rules server-side (public.sls_validate_draft).

import type { Cond, InputModes, Op, QuestionKind, ShowIfNode, Validation } from './types.ts';
import { OTHER_VALUE, PATH_KEY, PATH_VALUES } from './types.ts';
import { collectConds, evalTri, groupItems, isCond, isGroup, isOp, type Tri } from './showif.ts';
import { activeOptions, activeQuestions, type DraftQuestion, hasChoices, optionValuesOf } from './compile.ts';
import { enabledModes, isNumericFormat, isSingleSelect, LIMITS, withDefaults } from './input-modes.ts';

export interface Issue {
  level: 'error' | 'warning';
  code: string;
  message: string;
  question_key?: string;
}

export const MAX_SCREENS = 9;
export const KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;
export const OPTION_VALUE_RE = /^[a-z0-9][a-z0-9_]{0,39}$/;

const q$ = (q: { label_en: string; key: string }) => `“${q.label_en || q.key}”`;

const OP_LABEL: Record<Op, string> = {
  eq: 'is',
  neq: 'is not',
  in: 'is one of',
  not_in: 'is none of',
  gte: 'is at least',
  lte: 'is at most',
  between: 'is between',
  contains_any: 'includes any of',
  contains_all: 'includes all of',
  answered: 'is answered',
  not_answered: 'is not answered',
};
export function opLabel(op: Op): string {
  return OP_LABEL[op] ?? op;
}

/** Which operators make sense for a question (by kind and enabled input modes). */
export function opsForQuestion(q: { kind: QuestionKind; input_modes: InputModes | null }): Op[] {
  const base: Op[] = ['answered', 'not_answered'];
  switch (q.kind) {
    case 'contact':
      return [];
    case 'yes_no':
      return ['eq', 'neq', 'in', 'not_in', ...base];
    case 'date':
      return ['gte', 'lte', 'between', ...base];
    case 'standard': {
      const m = withDefaults(q.input_modes);
      const ops = new Set<Op>();
      if (m.choose.enabled) {
        for (const o of ['eq', 'neq', 'in', 'not_in'] as Op[]) ops.add(o);
        if (!isSingleSelect(m.choose)) for (const o of ['contains_any', 'contains_all'] as Op[]) ops.add(o);
      }
      if (isNumericFormat(m)) for (const o of ['gte', 'lte', 'between', 'eq', 'neq'] as Op[]) ops.add(o);
      else if (m.type.enabled || m.speak.enabled) for (const o of ['eq', 'neq'] as Op[]) ops.add(o);
      for (const o of base) ops.add(o);
      return [...ops];
    }
  }
}

const kindLabel = (q: { kind: QuestionKind; input_modes: InputModes | null }) =>
  q.kind === 'standard' ? (isNumericFormat(q.input_modes) ? 'number' : q.input_modes?.choose.enabled ? 'choice' : 'text') : q.kind.replace('_', '/');

type RefQuestion = Pick<DraftQuestion, 'key' | 'label_en' | 'kind' | 'input_modes' | 'options' | 'archived_at'>;

/**
 * Validate one condition (from show_if, a profile condition or a never-rule)
 * against the question it references. `where` is a phrase like `“Budget” (show-if)`.
 */
export function checkCondition(c: Cond, ref: RefQuestion | undefined, where: string): string[] {
  const errs: string[] = [];
  if (!ref) {
    errs.push(`${where} refers to a question that doesn't exist (“${c.q}”). Remove that condition.`);
    return errs;
  }
  if (ref.archived_at) {
    errs.push(`${where} refers to ${q$(ref)}, which is archived. Remove that condition.`);
    return errs;
  }
  if (!isOp(c.op)) {
    errs.push(`${where} has an unknown comparison “${String(c.op)}”.`);
    return errs;
  }
  if (ref.kind === 'contact') {
    errs.push(`${where} can't depend on the contact details question.`);
    return errs;
  }
  if (!opsForQuestion(ref).includes(c.op)) {
    errs.push(`${where}: “${opLabel(c.op)}” can't be used with ${q$(ref)} (a ${kindLabel(ref)} question).`);
    return errs;
  }
  const v = c.v;
  if (c.op === 'answered' || c.op === 'not_answered') return errs;
  if (c.op === 'between') {
    if (!Array.isArray(v) || v.length !== 2 || v.some((x) => x === '' || x === null || x === undefined)) {
      errs.push(`${where}: “is between” needs a lowest and a highest value.`);
    } else if (isNumericFormat(ref.input_modes) && v.some((x) => typeof x !== 'number')) {
      errs.push(`${where}: the range for ${q$(ref)} must be numbers.`);
    } else if (typeof v[0] === 'number' && typeof v[1] === 'number' && v[0] > v[1]) {
      errs.push(`${where}: the lowest value is bigger than the highest value.`);
    }
    return errs;
  }
  const isList = c.op === 'in' || c.op === 'not_in' || c.op === 'contains_any' || c.op === 'contains_all';
  if (isList) {
    if (!Array.isArray(v) || v.length === 0) {
      errs.push(`${where}: pick at least one value for “${opLabel(c.op)}”.`);
      return errs;
    }
  } else if (v === undefined || v === null || v === '' || Array.isArray(v) || typeof v === 'object') {
    errs.push(`${where}: enter a value to compare with.`);
    return errs;
  }
  if ((c.op === 'gte' || c.op === 'lte') && isNumericFormat(ref.input_modes) && typeof v !== 'number') {
    errs.push(`${where}: the value for ${q$(ref)} must be a number.`);
  }
  const comparesChoice = c.op === 'in' || c.op === 'not_in' || c.op === 'contains_any' || c.op === 'contains_all' ||
    ((c.op === 'eq' || c.op === 'neq') && !isNumericFormat(ref.input_modes) && hasChoices(ref));
  if (hasChoices(ref) && comparesChoice) {
    const allOpts = ref.kind === 'yes_no' ? optionValuesOf(ref) : ref.options.map((o) => o.value);
    const active = ref.kind === 'yes_no' ? allOpts : ref.options.filter((o) => !o.archived_at).map((o) => o.value);
    const allowOther = ref.kind === 'standard' && !!withDefaults(ref.input_modes).choose.allow_other;
    const allowed = new Set([...active, ...(allowOther ? [OTHER_VALUE] : [])]);
    for (const x of isList ? (v as unknown[]) : [v]) {
      const s = String(x);
      if (allowed.has(s)) continue;
      if (allOpts.includes(s)) {
        const label = ref.options.find((o) => o.value === s)?.label_en ?? s;
        errs.push(`${where} uses the answer “${label}” of ${q$(ref)}, which is archived. Remove it from the condition.`);
      } else {
        errs.push(`${where} uses “${s}”, which is not an answer option of ${q$(ref)}.`);
      }
    }
  }
  return errs;
}

function checkTree(node: ShowIfNode, depth: number): string | null {
  if (depth > 6) return 'is nested too deeply (max 6 levels).';
  if (isCond(node)) return null;
  if (isGroup(node)) {
    const items = groupItems(node);
    if (!Array.isArray(items) || items.length === 0) return 'has an empty “all/any” group. Add a condition or remove the group.';
    for (const n of items) {
      const e = checkTree(n, depth + 1);
      if (e) return e;
    }
    return null;
  }
  return 'is not a valid condition.';
}

function checkModes(q: DraftQuestion, issues: Issue[]) {
  const v: Validation = q.validation ?? {};
  const err = (m: string) => issues.push({ level: 'error', code: 'modes', message: `${q$(q)}: ${m}`, question_key: q.key });
  const int = (x: unknown) => typeof x === 'number' && Number.isInteger(x);
  if (q.kind === 'date' && v.min && v.max && String(v.min) > String(v.max)) err('the earliest date is after the latest date.');
  if (q.kind !== 'standard') return;
  if (!q.input_modes) return err('choose at least one way to answer (Choose, Type or Speak).');
  const m = withDefaults(q.input_modes);
  const on = enabledModes(m);
  if (on.length === 0) return err('turn on at least one way to answer (Choose, Type or Speak).');
  if (!m[m.primary].enabled) err(`the main way to answer (“${m.primary}”) is switched off. Turn it on or pick another main way.`);
  if (m.choose.enabled) {
    const opts = activeOptions(q).length + (m.choose.allow_other ? 1 : 0);
    const mn = m.choose.min_picks;
    const mx = m.choose.max_picks;
    if (mn !== null && (!int(mn) || mn < 0)) err('“pick at least” must be a whole number.');
    if (mx !== null && (!int(mx) || mx < 1)) err('“pick at most” must be 1 or more.');
    if (!isSingleSelect(m.choose)) {
      if (mn !== null && mx !== null && mn > mx) err('“pick at least” is bigger than “pick at most”.');
      if (mn !== null && mn > opts) err(`“pick at least” is ${mn} but there are only ${opts} options.`);
    }
    if (m.choose.allow_other && (!int(m.choose.other_max_chars) || m.choose.other_max_chars < 1 || m.choose.other_max_chars > LIMITS.otherMaxChars)) {
      err(`the “Other” answer length must be between 1 and ${LIMITS.otherMaxChars} characters.`);
    }
  }
  if (m.type.enabled) {
    const { min_chars: mn, max_chars: mx } = m.type;
    if (mx !== null && (!int(mx) || mx < 1 || mx > LIMITS.maxChars)) err(`maximum characters must be between 1 and ${LIMITS.maxChars}.`);
    if (mn !== null && (!int(mn) || mn < 0)) err('minimum characters must be a whole number.');
    if (mn !== null && mx !== null && mn > mx) err('minimum characters is bigger than the maximum.');
    if (m.type.format === 'number' || m.type.format === 'currency') {
      const num = (x: unknown) => (typeof x === 'number' ? x : null);
      if (v.min != null && num(v.min) === null) err('the smallest allowed number must be a number.');
      if (v.max != null && num(v.max) === null) err('the largest allowed number must be a number.');
      if (num(v.min) !== null && num(v.max) !== null && (v.min as number) > (v.max as number)) err('the smallest number is bigger than the largest.');
    }
  }
  if (m.speak.enabled && (!int(m.speak.max_seconds) || m.speak.max_seconds < LIMITS.speakMinSeconds || m.speak.max_seconds > LIMITS.speakMaxSeconds)) {
    err(`recording length must be between ${LIMITS.speakMinSeconds} and ${LIMITS.speakMaxSeconds} seconds.`);
  }
}

/**
 * For each path, find which questions are definitely hidden / possibly shown,
 * using three-valued logic (answers other than the path are unknown).
 */
export function pathVisibility(questions: DraftQuestion[]): Record<string, Map<string, Tri>> {
  const active = activeQuestions(questions);
  const out: Record<string, Map<string, Tri>> = {};
  for (const p of PATH_VALUES) {
    const vis = new Map<string, Tri>();
    for (const q of active) {
      const r = evalTri(q.show_if, (k) => {
        if (k === PATH_KEY) return { known: true, value: p };
        if (vis.get(k) === false) return { known: true, value: undefined };
        return { known: false };
      });
      vis.set(q.key, r);
    }
    out[p] = vis;
  }
  return out;
}

export function screensPerPath(questions: DraftQuestion[]): Record<string, number> {
  const pv = pathVisibility(questions);
  const out: Record<string, number> = {};
  for (const [p, m] of Object.entries(pv)) out[p] = [...m.values()].filter((t) => t !== false).length;
  return out;
}

export function validateDraft(questions: DraftQuestion[]): Issue[] {
  const issues: Issue[] = [];
  const err = (code: string, message: string, question_key?: string) => issues.push({ level: 'error', code, message, question_key });
  const active = activeQuestions(questions);
  const byKey = new Map(questions.map((q) => [q.key, q]));
  const index = new Map(active.map((q, i) => [q.key, i]));

  // keys
  const seen = new Set<string>();
  for (const q of questions) {
    if (!KEY_RE.test(q.key)) err('key_format', `${q$(q)} has an invalid key “${q.key}”. Use lowercase letters, numbers and _ (start with a letter).`, q.key);
    if (seen.has(q.key)) err('key_duplicate', `Two questions use the key “${q.key}”. Keys must be unique.`, q.key);
    seen.add(q.key);
  }

  if (active.length === 0) {
    err('empty', 'The form has no questions.');
    return issues;
  }

  // path question
  const path = byKey.get(PATH_KEY);
  if (!path || path.archived_at) {
    err('path_missing', 'The first question must be the “Rent / Partner / Either” question (key “path”). Restore it.');
  } else {
    if (active[0].key !== PATH_KEY) err('path_not_first', `The “Rent / Partner / Either” question must be first. Move ${q$(path)} to the top.`, PATH_KEY);
    const pm = path.kind === 'standard' ? withDefaults(path.input_modes) : null;
    if (!pm || !pm.choose.enabled || !isSingleSelect(pm.choose) || pm.primary !== 'choose' || pm.type.enabled || pm.speak.enabled || pm.choose.allow_other) {
      err('path_type', `${q$(path)} must be answered by choosing exactly one option (radio or dropdown), with typing, speaking and “Other” switched off.`, PATH_KEY);
    }
    if (path.show_if) err('path_showif', `${q$(path)} is always shown; remove its condition.`, PATH_KEY);
    const vals = activeOptions(path).map((o) => o.value);
    for (const v of PATH_VALUES) if (!vals.includes(v)) err('path_options', `${q$(path)} must keep the answer “${v}”.`, PATH_KEY);
    for (const v of vals) if (!(PATH_VALUES as readonly string[]).includes(v)) err('path_options', `${q$(path)} can only have the answers rent, partner and either (found “${v}”).`, PATH_KEY);
    if (!path.required) err('path_required', `${q$(path)} must be required.`, PATH_KEY);
  }

  // contact question
  const contacts = active.filter((q) => q.kind === 'contact');
  if (contacts.length === 0) err('contact_missing', 'Add a “Contact details” question — without it you cannot reach anyone.');
  if (contacts.length > 1) err('contact_multiple', `There are ${contacts.length} contact questions (${contacts.map(q$).join(', ')}). Keep exactly one.`);
  for (const c of contacts) {
    if (c.show_if) err('contact_conditional', `${q$(c)} must be shown to everyone. Remove its condition.`, c.key);
  }

  for (const q of active) {
    if (!q.label_en.trim()) err('label_missing', `A question (key “${q.key}”) has no English text.`, q.key);
    if (q.kind === 'standard' && withDefaults(q.input_modes).choose.enabled) {
      const n = activeOptions(q).length;
      if (n < 2) err('options_min', `${q$(q)} needs at least 2 answer options (it has ${n}).`, q.key);
      const vals = new Set<string>();
      for (const o of activeOptions(q)) {
        if (!OPTION_VALUE_RE.test(o.value)) err('option_value', `${q$(q)}: the option “${o.label_en}” has an invalid value “${o.value}”.`, q.key);
        if (vals.has(o.value)) err('option_duplicate', `${q$(q)} has two options with the value “${o.value}”.`, q.key);
        if (!o.label_en.trim()) err('option_label', `${q$(q)} has an option without English text.`, q.key);
        vals.add(o.value);
      }
    }
    checkModes(q, issues);

    if (q.show_if) {
      const where = `${q$(q)} (show-if)`;
      const treeErr = checkTree(q.show_if, 0);
      if (treeErr) {
        err('showif_shape', `${where} ${treeErr}`, q.key);
        continue;
      }
      for (const c of collectConds(q.show_if)) {
        if (c.q === q.key) {
          err('showif_self', `${q$(q)} can't depend on its own answer. Pick an earlier question.`, q.key);
          continue;
        }
        const ref = byKey.get(c.q);
        if (ref && !ref.archived_at) {
          const ri = index.get(ref.key)!;
          const qi = index.get(q.key)!;
          if (ri > qi) {
            err(
              'showif_order',
              `${q$(q)} depends on ${q$(ref)}, but ${q$(ref)} comes after it. Move ${q$(ref)} above ${q$(q)}, or move ${q$(q)} below ${q$(ref)}.`,
              q.key,
            );
            continue;
          }
        }
        for (const m of checkCondition(c, ref, where)) err('showif_ref', m, q.key);
      }
    }
  }

  // path length
  if (path && !path.archived_at) {
    const screens = screensPerPath(questions);
    for (const [p, n] of Object.entries(screens)) {
      if (n > MAX_SCREENS) {
        issues.push({
          level: 'warning',
          code: 'path_long',
          message: `The “${p}” path can show up to ${n} screens. Aim for ${MAX_SCREENS} or fewer so people finish in about 2 minutes.`,
        });
      }
    }
  }
  return issues;
}

export const hasErrors = (issues: Issue[]) => issues.some((i) => i.level === 'error');
