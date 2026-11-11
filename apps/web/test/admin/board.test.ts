import { describe, expect, it } from 'vitest';
import { applyFilters, countActive, DEFAULT_FILTERS, escapeOrValue, type FilterableQuery, nextDay, normaliseFilters } from '../../src/admin/board/filters.ts';
import { csvCell, leadsToCsv, toCsv } from '../../src/admin/board/csv.ts';
import type { ResponseRow } from '../../src/admin/types.ts';

class Rec implements FilterableQuery<Rec> {
  calls: unknown[][] = [];
  eq(c: string, v: unknown) { this.calls.push(['eq', c, v]); return this; }
  in(c: string, v: unknown[]) { this.calls.push(['in', c, v]); return this; }
  is(c: string, v: null | boolean) { this.calls.push(['is', c, v]); return this; }
  gte(c: string, v: unknown) { this.calls.push(['gte', c, v]); return this; }
  lt(c: string, v: unknown) { this.calls.push(['lt', c, v]); return this; }
  or(e: string) { this.calls.push(['or', e]); return this; }
}

describe('board filters', () => {
  it('defaults hide duplicates and bots', () => {
    expect(applyFilters(new Rec(), DEFAULT_FILTERS).calls).toEqual([['is', 'duplicate_of', null], ['eq', 'suspected_bot', false]]);
  });
  it('applies every filter', () => {
    const f = { ...DEFAULT_FILTERS, tiers: ['ideal' as const], statuses: ['new' as const], paths: ['rent' as const], profile: 'Retailer', q: 'Ram 98765', from: '2026-01-01', to: '2026-01-31', includeDuplicates: true, includeBots: true };
    expect(applyFilters(new Rec(), f).calls).toEqual([
      ['in', 'tier', ['ideal']],
      ['in', 'pipeline_status', ['new']],
      ['in', 'path', ['rent']],
      ['eq', 'match_detail->>best_profile_name', 'Retailer'],
      ['gte', 'created_at', '2026-01-01T00:00:00'],
      ['lt', 'created_at', '2026-02-01T00:00:00'],
      ['or', 'name.ilike.*Ram 98765*,phone_e164.ilike.*98765*'],
    ]);
    expect(countActive(f)).toBe(9);
  });
  it('escapes PostgREST syntax in search', () => {
    expect(escapeOrValue('a,b(c)*d%')).toBe('a b c d');
    expect(nextDay('2026-12-31')).toBe('2027-01-01');
  });
  it('normalises untrusted saved-view JSON', () => {
    expect(normaliseFilters({ tiers: ['ideal', 'bogus', 'ideal'], from: 'yesterday', q: 5, includeBots: 'yes' })).toEqual({ ...DEFAULT_FILTERS, tiers: ['ideal'] });
    expect(normaliseFilters(null)).toEqual(DEFAULT_FILTERS);
  });
});

describe('csv', () => {
  it('quotes and neutralises formulas', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+919876543210')).toBe("'+919876543210");
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell(null)).toBe('');
    expect(toCsv(['a'], [[1]])).toBe('﻿a\r\n1\r\n');
  });
  it('exports leads with answers', () => {
    const lead = {
      created_at: '2026-01-01', name: 'Ram', phone_e164: '+919876543210', whatsapp_ok: true, path: 'rent', tier: 'ideal',
      match_detail: { best_profile_name: 'Retailer', best_qualified: true }, best_match: 100, intent_score: 60, priority: 88,
      pipeline_status: 'new', lost_reason: null, pinned: false, duplicate_of: null, suspected_bot: false, never_hit: [], notes: 'line1\nline2',
      answers: { budget: { value: 45000, display: '₹45,000', question_label: 'Budget' } },
    } as unknown as ResponseRow;
    const csv = leadsToCsv([lead], [{ key: 'budget', label: 'Budget' }, { key: 'x', label: 'X' }]);
    const lines = csv.slice(1).split('\r\n');
    expect(lines[0]).toContain('Created,Name,Phone');
    expect(lines[0].endsWith('Budget,X')).toBe(true);
    expect(csv).toContain(`Ram,'+919876543210,yes,rent,ideal,Retailer,100,yes,60,88,new,,no,,no,,"line1\nline2",₹45,000,`.replace('₹45,000', '"₹45,000"'));
  });
});
