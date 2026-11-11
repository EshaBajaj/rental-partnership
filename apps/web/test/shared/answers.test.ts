import { describe, expect, it } from 'vitest';
import { validateSubmission } from '@shared/answers.ts';
import { compileForm } from '@shared/compile.ts';
import { normalisePhone } from '@shared/phone.ts';
import { opt, q, seedForm } from '../fixtures.ts';
import type { RawAnswers } from '@shared/types.ts';

const cfg = compileForm(seedForm());
const contact = { value: { name: 'Ramesh Kumar', phone: '98765 43210', whatsapp_ok: true, consent: true } };
const rent: RawAnswers = {
  path: { value: 'rent' },
  business_type: { value: 'grocery' },
  start_when: { value: 'immediately' },
  rent_budget: { value: 45000 },
  lease_years: { value: '3_5' },
  experience: { value: 'yes' },
  contact,
};

describe('validateSubmission', () => {
  it('accepts a valid rent submission and normalises the phone', () => {
    const r = validateSubmission(cfg, rent, { rejectHidden: true });
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.path).toBe('rent');
    expect(r.contact).toEqual({ name: 'Ramesh Kumar', phone_e164: '+919876543210', whatsapp_ok: true });
    expect(r.answers.rent_budget.display).toBe('₹45,000');
    expect(r.answers.business_type).toMatchObject({ value: 'grocery', display: 'Grocery / Kirana' });
    expect(r.visible).toContain('about_you');
    expect(r.answers).not.toHaveProperty('about_you');
  });

  it('rejects hidden answers on the server, drops them on the client', () => {
    const raw = { ...rent, investment: { value: 100000 } };
    const server = validateSubmission(cfg, raw, { rejectHidden: true });
    expect(server.errors).toEqual([expect.objectContaining({ key: 'investment', code: 'hidden_answer' })]);
    const client = validateSubmission(cfg, raw, { rejectHidden: false });
    expect(client.ok).toBe(true);
    expect(client.answers).not.toHaveProperty('investment');
  });

  it('required, invalid option, other text', () => {
    const r = validateSubmission(cfg, { ...rent, start_when: { value: null }, business_type: { value: 'bakery' } }, { rejectHidden: true });
    expect(r.errors.map((e) => [e.key, e.code])).toEqual([
      ['business_type', 'invalid_option'],
      ['start_when', 'required'],
    ]);
    const o = validateSubmission(cfg, { ...rent, business_type: { value: '__other', other_text: '' } }, { rejectHidden: true });
    expect(o.errors[0].code).toBe('other_required');
    const ok = validateSubmission(cfg, { ...rent, business_type: { value: '__other', other_text: 'Bakery' } }, { rejectHidden: true });
    expect(ok.answers.business_type).toMatchObject({ value: '__other', other_text: 'Bakery', display: 'Other: Bakery' });
  });

  it('contact validation', () => {
    const bad = (c: object) => validateSubmission(cfg, { ...rent, contact: { value: { ...contact.value, ...c } } }, { rejectHidden: true }).errors[0]?.code;
    expect(bad({ phone: '12345' })).toBe('invalid_phone');
    expect(bad({ name: ' ' })).toBe('name_required');
    expect(bad({ consent: false })).toBe('consent_required');
  });

  it('voice answers may be pending (empty text) and count as answered', () => {
    const r = validateSubmission(cfg, { ...rent, about_you: { value: '', voice: true } }, { rejectHidden: true });
    expect(r.ok).toBe(true);
    expect(r.voiceKeys).toEqual(['about_you']);
    expect(r.answers.about_you.display).toMatch(/pending/);
    const long = validateSubmission(cfg, { ...rent, about_you: { value: 'x'.repeat(2001), voice: true } }, { rejectHidden: true });
    expect(long.errors[0].code).toBe('too_long');
  });

  it('multi pick limits', () => {
    const qs = seedForm();
    qs.splice(8, 0, q('features', 'multi', { options: [opt('a'), opt('b'), opt('c')], validation: { minPicks: 1, maxPicks: 2 }, allow_other: true }));
    const c = compileForm(qs.map((x, i) => ({ ...x, position: i })));
    const run = (value: string[], other_text?: string) => validateSubmission(c, { ...rent, features: { value, other_text } }, { rejectHidden: true });
    expect(run(['a', 'b', 'c']).errors[0].code).toBe('too_many_picks');
    expect(run(['c', 'a']).answers.features.value).toEqual(['a', 'c']);
    expect(run(['a', '__other'], 'zz').answers.features.display).toBe('a, Other: zz');
    expect(run(['a', 'nope']).errors[0].code).toBe('invalid_option');
  });

  it('unknown keys are rejected', () => {
    expect(validateSubmission(cfg, { ...rent, hack: { value: 'x' } }, { rejectHidden: true }).errors[0].code).toBe('unknown_question');
  });
});

describe('normalisePhone', () => {
  it('India default', () => {
    expect(normalisePhone('9876543210')).toBe('+919876543210');
    expect(normalisePhone('+91 98765-43210')).toBe('+919876543210');
    expect(normalisePhone('098765 43210')).toBe('+919876543210');
    expect(normalisePhone('0091 9876543210')).toBe('+919876543210');
    expect(normalisePhone('+1 415 555 2671')).toBe('+14155552671');
    expect(normalisePhone('12345')).toBeNull();
    expect(normalisePhone('abc')).toBeNull();
  });
});
