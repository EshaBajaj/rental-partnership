import { describe, expect, it } from 'vitest';
import { computeFunnel, formatDuration, median } from '../../src/admin/funnel/funnel.ts';

const ev = (session_id: string, event: string, question_key: string | null = null) => ({ session_id, event, question_key, created_at: '' });

describe('funnel', () => {
  it('counts unique sessions per step with drop-off', () => {
    const steps = computeFunnel(
      [ev('a', 'view'), ev('a', 'view'), ev('b', 'view'), ev('c', 'view'), ev('d', 'view'), ev('a', 'start'), ev('b', 'start'), ev('a', 'answer', 'path'), ev('b', 'answer', 'path'), ev('a', 'answer', 'budget'), ev('a', 'submit_ok')],
      [{ key: 'path', label: 'Path' }, { key: 'budget', label: 'Budget' }],
    );
    expect(steps.map((s) => [s.id, s.sessions, s.ofStart, s.dropOff])).toEqual([
      ['view', 4, 100, 0],
      ['start', 2, 50, 50],
      ['q:path', 2, 50, 0],
      ['q:budget', 1, 25, 50],
      ['submit', 1, 25, 0],
    ]);
  });
  it('handles no data', () => {
    expect(computeFunnel([], []).every((s) => s.sessions === 0 && s.ofStart === 0)).toBe(true);
  });
  it('median + duration format', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
    expect(formatDuration(95)).toBe('1m 35s');
    expect(formatDuration(42)).toBe('42s');
    expect(formatDuration(null)).toBe('—');
  });
});
