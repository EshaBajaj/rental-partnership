import { describe, expect, it } from 'vitest';
import { computeVisibility, evalOp, evalShowIf, evalTri } from '@shared/showif.ts';
import { compileForm } from '@shared/compile.ts';
import { seedForm } from '../fixtures.ts';

describe('evalOp', () => {
  it('scalar comparisons', () => {
    expect(evalOp('eq', 'rent', 'rent')).toBe(true);
    expect(evalOp('eq', 5, 5)).toBe(true);
    expect(evalOp('eq', 5, '5')).toBe(true);
    expect(evalOp('neq', 'rent', 'partner')).toBe(true);
    expect(evalOp('in', 'rent', ['rent', 'either'])).toBe(true);
    expect(evalOp('not_in', 'partner', ['rent', 'either'])).toBe(true);
    expect(evalOp('gte', 50000, 40000)).toBe(true);
    expect(evalOp('gte', 30000, 40000)).toBe(false);
    expect(evalOp('lte', 30000, 40000)).toBe(true);
    expect(evalOp('between', 5, [1, 5])).toBe(true);
    expect(evalOp('between', 6, [1, 5])).toBe(false);
    expect(evalOp('gte', '2026-12-01', '2026-11-30')).toBe(true);
  });
  it('arrays (multi-select)', () => {
    expect(evalOp('eq', ['a', 'b'], 'a')).toBe(true);
    expect(evalOp('neq', ['a', 'b'], 'a')).toBe(false);
    expect(evalOp('contains_any', ['a', 'b'], ['c', 'b'])).toBe(true);
    expect(evalOp('contains_all', ['a', 'b'], ['a', 'b'])).toBe(true);
    expect(evalOp('contains_all', ['a'], ['a', 'b'])).toBe(false);
    expect(evalOp('in', ['a', 'z'], ['z'])).toBe(true);
    expect(evalOp('not_in', ['a'], ['z'])).toBe(true);
    expect(evalOp('gte', ['5'], 1)).toBe(false);
  });
  it('unanswered values fail everything except not_answered', () => {
    for (const v of [undefined, null, '', '  ', []]) {
      expect(evalOp('answered', v, null)).toBe(false);
      expect(evalOp('not_answered', v, null)).toBe(true);
      expect(evalOp('neq', v, 'x')).toBe(false);
      expect(evalOp('not_in', v, ['x'])).toBe(false);
    }
  });
});

describe('evalShowIf', () => {
  it('nested groups', () => {
    const expr = { all: [{ q: 'a', op: 'eq' as const, v: 1 }, { any: [{ q: 'b', op: 'eq' as const, v: 'x' }, { q: 'c', op: 'answered' as const }] }] };
    expect(evalShowIf(expr, { a: 1, b: 'x' })).toBe(true);
    expect(evalShowIf(expr, { a: 1, c: 'y' })).toBe(true);
    expect(evalShowIf(expr, { a: 1 })).toBe(false);
    expect(evalShowIf(expr, { a: 2, b: 'x' })).toBe(false);
    expect(evalShowIf(null, {})).toBe(true);
    expect(evalShowIf({ any: [] }, {})).toBe(true);
  });
});

describe('computeVisibility', () => {
  const cfg = compileForm(seedForm());
  it('rent path skips partner questions and discards their answers', () => {
    const v = computeVisibility(cfg, { path: 'rent', investment: 500000, rent_budget: 40000 });
    expect(v.visible).toEqual(['path', 'business_type', 'start_when', 'rent_budget', 'lease_years', 'experience', 'about_you', 'contact']);
    expect(v.effective).not.toHaveProperty('investment');
    expect(v.effective.rent_budget).toBe(40000);
  });
  it('either path asks shared questions once', () => {
    const v = computeVisibility(cfg, { path: 'either' });
    expect(v.visible).toEqual(['path', 'business_type', 'start_when', 'rent_budget', 'investment', 'experience', 'about_you', 'contact']);
  });
  it('chained hiding: answer to a hidden question cannot reveal later ones', () => {
    const c = {
      schema: 2 as const,
      questions: [
        { ...cfg.questions[0] },
        { ...cfg.questions[1], key: 'x', show_if: { all: [{ q: 'path', op: 'eq' as const, v: 'partner' }] } },
        { ...cfg.questions[2], key: 'y', show_if: { all: [{ q: 'x', op: 'answered' as const }] } },
      ],
    };
    expect(computeVisibility(c, { path: 'rent', x: 'grocery' }).visible).toEqual(['path']);
  });
});

describe('evalTri', () => {
  it('returns null when unknown', () => {
    const k = (key: string) => (key === 'path' ? { known: true as const, value: 'rent' } : { known: false as const });
    expect(evalTri({ all: [{ q: 'path', op: 'eq', v: 'rent' }] }, k)).toBe(true);
    expect(evalTri({ all: [{ q: 'path', op: 'eq', v: 'partner' }, { q: 'x', op: 'answered' }] }, k)).toBe(false);
    expect(evalTri({ all: [{ q: 'path', op: 'eq', v: 'rent' }, { q: 'x', op: 'answered' }] }, k)).toBe(null);
    expect(evalTri({ any: [{ q: 'path', op: 'eq', v: 'rent' }, { q: 'x', op: 'answered' }] }, k)).toBe(true);
  });
});
