import { describe, expect, it } from 'vitest';
import {
  appendAt, coerceValue, defaultValue, describeCondition, describeShowIf, getAt, newCondition, parseNumberInput, pruneShowIf, type RefQuestion, replaceAt, toggleGroupKind,
} from '../../src/admin/form/conditionValue.ts';
import { planRemoval, slugify, uniqueSlug } from '../../src/admin/form/removal.ts';
import { mergeSettings } from '../../src/admin/profiles/settings.ts';
import { diffRows } from '../../src/admin/audit/diff.ts';
import { eventText } from '../../src/admin/lead/events.ts';
import type { ShowIf } from '@shared/types.ts';

const biz: RefQuestion = { key: 'biz', type: 'single', label_en: 'Business', allow_other: true, options: [{ value: 'grocery', label_en: 'Grocery' }, { value: 'salon', label_en: 'Salon', archived: true }] };
const budget: RefQuestion = { key: 'budget', type: 'currency', label_en: 'Budget', allow_other: false, options: [] };

describe('condition values', () => {
  it('defaults per operator and type', () => {
    expect(defaultValue('eq', biz)).toBe('grocery');
    expect(defaultValue('in', biz)).toEqual([]);
    expect(defaultValue('gte', budget)).toBe(0);
    expect(defaultValue('between', budget)).toEqual([0, 0]);
    expect(defaultValue('answered', budget)).toBeUndefined();
    expect(newCondition(budget, 'budget')).toEqual({ q: 'budget', op: 'gte', v: 0 });
    expect(newCondition(biz, 'biz')).toEqual({ q: 'biz', op: 'eq', v: 'grocery' });
  });
  it('keeps the value when the operator changes', () => {
    expect(coerceValue('in', biz, 'grocery')).toEqual(['grocery']);
    expect(coerceValue('eq', biz, ['salon', 'grocery'])).toBe('salon');
    expect(coerceValue('between', budget, 40000)).toEqual([40000, 40000]);
    expect(coerceValue('gte', budget, '5000')).toBe(5000);
    expect(coerceValue('answered', budget, 5)).toBeUndefined();
    expect(coerceValue('eq', biz, '')).toBe('grocery');
  });
  it('parses number inputs', () => {
    expect(parseNumberInput('₹ 40,000')).toBe(40000);
    expect(parseNumberInput('-2.5')).toBe(-2.5);
    expect(parseNumberInput('')).toBeNull();
    expect(parseNumberInput('12abc')).toBeNull();
  });
  it('describes conditions', () => {
    expect(describeCondition({ q: 'budget', op: 'gte', v: 40000 }, budget)).toBe('“Budget” is at least ₹40,000');
    expect(describeCondition({ q: 'biz', op: 'in', v: ['grocery', '__other'] }, biz)).toBe('“Business” is one of Grocery, Other (typed)');
    const s: ShowIf = { all: [{ q: 'biz', op: 'eq', v: 'grocery' }, { any: [{ q: 'budget', op: 'answered' }, { q: 'budget', op: 'between', v: [1, 2] }] }] };
    expect(describeShowIf(s, new Map([['biz', biz], ['budget', budget]]))).toBe('“Business” is Grocery AND (“Budget” is answered OR “Budget” is between ₹1 and ₹2)');
    expect(describeShowIf(null, new Map())).toBe('Always shown');
  });
  it('edits trees immutably by path', () => {
    const root: ShowIf = { all: [{ q: 'a', op: 'answered' }, { any: [{ q: 'b', op: 'answered' }] }] };
    const r2 = replaceAt(root, [1, 0], { q: 'c', op: 'answered' });
    expect(getAt(r2, [1, 0])).toEqual({ q: 'c', op: 'answered' });
    expect(getAt(root, [1, 0])).toEqual({ q: 'b', op: 'answered' });
    expect(appendAt(root, [1], { q: 'd', op: 'answered' })).toEqual({ all: [{ q: 'a', op: 'answered' }, { any: [{ q: 'b', op: 'answered' }, { q: 'd', op: 'answered' }] }] });
    expect(replaceAt(root, [1, 0], null)).toEqual({ all: [{ q: 'a', op: 'answered' }, { any: [] }] });
    expect(pruneShowIf(replaceAt(root, [1, 0], null))).toEqual({ all: [{ q: 'a', op: 'answered' }] });
    expect(pruneShowIf({ all: [{ any: [] }] })).toBeNull();
    expect(toggleGroupKind({ all: [] })).toEqual({ any: [] });
  });
});

describe('removal plan', () => {
  const qs = [
    { id: 'q1', key: 'biz', label_en: 'Business', show_if: null, archived_at: null },
    { id: 'q2', key: 'later', label_en: 'Later', show_if: { all: [{ q: 'biz', op: 'in' as const, v: ['grocery', 'salon'] }] }, archived_at: null },
    { id: 'q3', key: 'other', label_en: 'Other', show_if: { all: [{ q: 'biz', op: 'eq' as const, v: 'salon' }] }, archived_at: null },
  ];
  const conds = [
    { id: 'c1', profile_name: 'P', question_key: 'biz', operator: 'in' as const, value: ['grocery', 'salon'], importance: 'important' as const },
    { id: 'c2', profile_name: 'P', question_key: 'biz', operator: 'eq' as const, value: 'salon', importance: 'must' as const },
  ];
  const never = [
    { id: 'n1', question_key: 'biz', operator: 'eq' as const, value: 'salon', label: 'No salons' },
    { id: 'n2', question_key: 'biz', operator: 'in' as const, value: ['salon', 'grocery'], label: 'x' },
  ];
  it('option removal shrinks lists and drops conditions that only used it', () => {
    const p = planRemoval({ key: 'biz', optionValue: 'salon' }, qs, conds, never);
    expect(p.dependencies.map((d) => d.id)).toEqual(['q2', 'q3', 'c1', 'c2', 'n1', 'n2']);
    expect(p.showIfUpdates).toEqual({ q2: { all: [{ q: 'biz', op: 'in', v: ['grocery'] }] }, q3: null });
    expect(p.conditionUpdates).toEqual([{ id: 'c1', value: ['grocery'] }]);
    expect(p.removeConditionIds).toEqual(['c2']);
    expect(p.removeNeverIds).toEqual(['n1']);
    expect(p.neverUpdates).toEqual([{ id: 'n2', value: ['grocery'] }]);
  });
  it('question removal drops everything that references it', () => {
    const p = planRemoval({ key: 'biz' }, qs, conds, never);
    expect(p.showIfUpdates).toEqual({ q2: null, q3: null });
    expect(p.removeConditionIds).toEqual(['c1', 'c2']);
    expect(p.removeNeverIds).toEqual(['n1', 'n2']);
    expect(p.conditionUpdates).toEqual([]);
  });
  it('nothing to do when unused', () => {
    const p = planRemoval({ key: 'zzz' }, qs, conds, never);
    expect(p.dependencies).toEqual([]);
    expect(p.showIfUpdates).toEqual({});
  });
  it('slugs', () => {
    expect(slugify('Mobile & Electronics!')).toBe('mobile_electronics');
    expect(slugify('Café')).toBe('cafe');
    expect(uniqueSlug('Option', ['option'], { mustStartWithLetter: false, fallback: 'option' })).toBe('option_2');
    expect(uniqueSlug('1–2 years', [], { mustStartWithLetter: false, fallback: 'option' })).toBe('1_2_years');
    expect(uniqueSlug('1 year', [], { mustStartWithLetter: true, fallback: 'q' })).toBe('q_1_year');
    expect(uniqueSlug('दुकान', [], { mustStartWithLetter: true, fallback: 'q' })).toBe('q');
  });
});

describe('misc', () => {
  it('merges settings like SQL (timing points replaced)', () => {
    const s = mergeSettings({ thresholds: { ideal: 90 }, intent: { timing_points: { now: 50 } } });
    expect(s.thresholds).toEqual({ ideal: 90, maybe: 50 });
    expect(s.intent.timing_points).toEqual({ now: 50 });
    expect(s.intent.voice_points).toBe(25);
    expect(mergeSettings(null).weights).toEqual({ important: 3, nice: 1 });
  });
  it('diffs audit rows', () => {
    expect(diffRows({ a: 1, b: 2, updated_at: 'x' }, { a: 1, b: 3, updated_at: 'y' })).toEqual([{ field: 'b', before: '2', after: '3' }]);
    expect(diffRows(null, { a: null })).toEqual([{ field: 'a', before: '', after: '∅' }]);
  });
  it('describes lead events', () => {
    expect(eventText({ type: 'tier_changed', data: { from: 'maybe', to: 'ideal', reason: 'Profiles v2 published' } })).toBe('Tier Maybe → Ideal (Profiles v2 published)');
    expect(eventText({ type: 'status_changed', data: { from: 'new', to: 'lost', lost_reason: 'budget' } })).toBe('Status New → Lost — budget');
    expect(eventText({ type: 'mystery_event', data: {} })).toBe('mystery event');
  });
});
