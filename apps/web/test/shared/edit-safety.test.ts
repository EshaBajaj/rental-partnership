import { describe, expect, it } from 'vitest';
import { canHardDelete, classifyTypeChange, findDependencies, removeFromShowIfRoot, renameKeyInShowIf } from '@shared/edit-safety.ts';
import type { ShowIf } from '@shared/types.ts';

describe('classifyTypeChange', () => {
  it('compatible pairs', () => {
    expect(classifyTypeChange('single', 'dropdown')).toBe('compatible');
    expect(classifyTypeChange('dropdown', 'single')).toBe('compatible');
    expect(classifyTypeChange('short_text', 'long_text')).toBe('compatible');
    expect(classifyTypeChange('multi', 'multi')).toBe('same');
    expect(classifyTypeChange('single', 'multi')).toBe('incompatible');
    expect(classifyTypeChange('number', 'currency')).toBe('incompatible');
  });
  it('hard delete only before first publish', () => {
    expect(canHardDelete({ first_published_at: null })).toBe(true);
    expect(canHardDelete({ first_published_at: '2026-01-01' })).toBe(false);
  });
});

describe('dependencies', () => {
  const showIf: ShowIf = { all: [{ q: 'biz', op: 'in', v: ['a', 'b'] }, { any: [{ q: 'biz', op: 'eq', v: 'a' }, { q: 'x', op: 'answered' }] }] };
  const questions = [{ id: 'q2', key: 'later', label_en: 'Later', show_if: showIf, archived_at: null }];
  const conditions = [{ id: 'c1', profile_name: 'Ideal', question_key: 'biz', operator: 'eq' as const, value: 'b', importance: 'must' as const }];
  const never = [{ id: 'n1', question_key: 'biz', operator: 'in' as const, value: ['c'], label: 'No c' }];

  it('finds every dependency for a question', () => {
    expect(findDependencies({ key: 'biz' }, questions, conditions, never).map((d) => d.id)).toEqual(['q2', 'c1', 'n1']);
  });
  it('finds dependencies for one option', () => {
    expect(findDependencies({ key: 'biz', optionValue: 'a' }, questions, conditions, never).map((d) => d.id)).toEqual(['q2']);
    expect(findDependencies({ key: 'biz', optionValue: 'c' }, questions, conditions, never).map((d) => d.id)).toEqual(['n1']);
  });
  it('removes an option from conditions, pruning empty ones', () => {
    expect(removeFromShowIfRoot(showIf, { key: 'biz', optionValue: 'a' })).toEqual({
      all: [{ q: 'biz', op: 'in', v: ['b'] }, { any: [{ q: 'x', op: 'answered' }] }],
    });
    expect(removeFromShowIfRoot(showIf, { key: 'biz' })).toEqual({ all: [{ any: [{ q: 'x', op: 'answered' }] }] });
    expect(removeFromShowIfRoot({ all: [{ q: 'biz', op: 'eq', v: 'a' }] }, { key: 'biz' })).toBeNull();
  });
  it('renames keys', () => {
    expect(renameKeyInShowIf(showIf, 'biz', 'biz2')).toEqual({
      all: [{ q: 'biz2', op: 'in', v: ['a', 'b'] }, { any: [{ q: 'biz2', op: 'eq', v: 'a' }, { q: 'x', op: 'answered' }] }],
    });
  });
});
