import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { InputModesSchema } from '@shared/schemas.ts';
import { defaultModes, describeModes, legacyToModes, normalizeConfig } from '@shared/input-modes.ts';
import type { InputModes } from '@shared/types.ts';

// Same fixture as the SQL test (sls_legacy_modes) in supabase/tests/engine_parity.test.sql
const legacy = JSON.parse(readFileSync(fileURLToPath(new URL('../../../../supabase/tests/fixtures/legacy_modes.json', import.meta.url)), 'utf8'));

describe('InputModesSchema', () => {
  it('accepts the defaults', () => {
    expect(InputModesSchema.safeParse(defaultModes()).success).toBe(true);
  });
  it('requires at least one mode and an enabled primary', () => {
    const none: InputModes = { ...defaultModes(), choose: { ...defaultModes().choose, enabled: false } };
    expect(InputModesSchema.safeParse(none).success).toBe(false);
    const badPrimary = { ...defaultModes(), primary: 'speak' as const };
    expect(InputModesSchema.safeParse(badPrimary).error?.issues[0].message).toMatch(/main way/);
  });
  it('bounds: chars ≤ 2000, seconds 10–300, min ≤ max', () => {
    const d = defaultModes();
    expect(InputModesSchema.safeParse({ ...d, type: { ...d.type, max_chars: 2001 } }).success).toBe(false);
    expect(InputModesSchema.safeParse({ ...d, speak: { ...d.speak, max_seconds: 5 } }).success).toBe(false);
    expect(InputModesSchema.safeParse({ ...d, speak: { ...d.speak, max_seconds: 301 } }).success).toBe(false);
    expect(InputModesSchema.safeParse({ ...d, type: { ...d.type, min_chars: 10, max_chars: 5 } }).success).toBe(false);
    expect(InputModesSchema.safeParse({ ...d, choose: { ...d.choose, style: 'slider' } }).success).toBe(false);
  });
  it('defaults match the spec', () => {
    const d = defaultModes();
    expect(d.choose).toMatchObject({ enabled: true, style: 'radio' });
    expect(d.type.max_chars).toBe(300);
    expect(d.speak).toMatchObject({ max_seconds: 120, live_transcript: true, allow_edit: true, keep_audio: true });
  });
});

describe('legacy type → input modes (migration mapping)', () => {
  for (const c of legacy) {
    it(c.type + (c.allow_voice ? ' + voice' : '') + (c.allow_other ? ' + other' : ''), () => {
      expect(legacyToModes(c).input_modes).toEqual(c.expected);
    });
  }
  it('key mappings', () => {
    expect(legacyToModes({ type: 'multi' }).input_modes!.choose.style).toBe('checkbox');
    expect(legacyToModes({ type: 'dropdown' }).input_modes!.choose.style).toBe('dropdown');
    expect(legacyToModes({ type: 'long_text' }).input_modes!.type.multiline).toBe(true);
    expect(legacyToModes({ type: 'currency' }).input_modes!.type.format).toBe('currency');
    expect(legacyToModes({ type: 'voice' }).input_modes!.primary).toBe('speak');
    expect(legacyToModes({ type: 'short_text', allow_voice: true }).input_modes!.speak.enabled).toBe(true);
    expect(legacyToModes({ type: 'yes_no' })).toEqual({ kind: 'yes_no', input_modes: null });
  });
  it('normalizeConfig upgrades a schema-1 config and keeps schema 2 as is', () => {
    const v1 = { schema: 1, questions: [{ key: 'b', type: 'currency', label_en: 'B', label_hi: null, help_en: null, help_hi: null, placeholder: null, required: true, show_if: null, validation: { min: 0 }, allow_other: false, allow_voice: false, options: [] }] };
    const n = normalizeConfig(v1);
    expect(n.schema).toBe(2);
    expect(n.questions[0]).toMatchObject({ key: 'b', kind: 'standard', validation: { min: 0 } });
    expect(describeModes(n.questions[0].input_modes, 'standard')).toBe('Type (currency)');
    expect(normalizeConfig(n)).toEqual(n);
  });
});
