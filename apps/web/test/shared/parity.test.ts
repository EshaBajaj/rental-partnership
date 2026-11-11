import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { evalShowIf } from '@shared/showif.ts';
import { compileForm } from '@shared/compile.ts';
import { seedForm } from '../fixtures.ts';

// Same fixture as supabase/tests/engine_parity.test.sql
const cases = JSON.parse(readFileSync(fileURLToPath(new URL('../../../../supabase/tests/fixtures/showif_cases.json', import.meta.url)), 'utf8'));

describe('show_if parity fixture (TS side)', () => {
  for (const c of cases) it(c.name, () => expect(evalShowIf(c.expr, c.vals)).toBe(c.expected));
});

describe('seed fixture matches seed.sql', () => {
  it('has the same keys and order', () => {
    const sql = readFileSync(fileURLToPath(new URL('../../../../supabase/seed.sql', import.meta.url)), 'utf8');
    const keys = [...sql.matchAll(/values \(prop, '([a-z_]+)', '([a-z_]+)'/g)].map((m) => [m[1], m[2]]);
    expect(keys).toEqual(compileForm(seedForm()).questions.map((q) => [q.key, q.kind]));
  });
});
