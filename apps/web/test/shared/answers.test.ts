import { describe, expect, it } from 'vitest';
import { engineValue, rawEngineValue, upgradeRawAnswer, validateOne, validateSubmission } from '@shared/answers.ts';
import { compileForm } from '@shared/compile.ts';
import { normalisePhone } from '@shared/phone.ts';
import { modes, opt, q, seedForm } from '../fixtures.ts';
import type { RawAnswers } from '@shared/types.ts';

const cfg = compileForm(seedForm());
const contact = { value: { name: 'Ramesh Kumar', phone: '98765 43210', whatsapp_ok: true, consent: true } };
const rent: RawAnswers = {
  path: { choose: ['rent'] },
  business_type: { choose: ['grocery'] },
  start_when: { choose: ['immediately'] },
  rent_budget: { text: '45,000' },
  lease_years: { choose: ['3_5'] },
  experience: { choose: ['yes'] },
  contact,
};
const one = (extra: Parameters<typeof q>[2]) => compileForm([q('x', 'standard', { options: [opt('a', 'A'), opt('b', 'B'), opt('c', 'C')], ...extra })]).questions[0];

describe('validateSubmission', () => {
  it('accepts a valid rent submission; radio answers are arrays; numbers parsed', () => {
    const r = validateSubmission(cfg, rent, { rejectHidden: true });
    expect(r.errors).toEqual([]);
    expect(r.path).toBe('rent');
    expect(r.contact).toEqual({ name: 'Ramesh Kumar', phone_e164: '+919876543210', whatsapp_ok: true });
    expect(r.answers.business_type).toEqual({ choose: ['grocery'], display: 'Grocery / Kirana', question_label: 'What business do you want to run here?' });
    expect(r.answers.rent_budget).toMatchObject({ text: '45,000', number: 45000, display: '₹45,000' });
    expect(r.answers.experience.choose).toEqual(['yes']);
  });

  it('rejects hidden answers on the server, drops them on the client', () => {
    const raw = { ...rent, investment: { text: '100000' } };
    expect(validateSubmission(cfg, raw, { rejectHidden: true }).errors).toEqual([expect.objectContaining({ key: 'investment', code: 'hidden_answer' })]);
    const client = validateSubmission(cfg, raw, { rejectHidden: false });
    expect(client.ok).toBe(true);
    expect(client.answers).not.toHaveProperty('investment');
  });

  it('required, invalid option, other text', () => {
    const r = validateSubmission(cfg, { ...rent, start_when: { choose: [] }, business_type: { choose: ['bakery'] } }, { rejectHidden: true });
    expect(r.errors.map((e) => [e.key, e.code])).toEqual([
      ['business_type', 'invalid_option'],
      ['start_when', 'required'],
    ]);
    expect(validateSubmission(cfg, { ...rent, business_type: { choose: ['__other'], other_text: '' } }, { rejectHidden: true }).errors[0].code).toBe('other_required');
    const ok = validateSubmission(cfg, { ...rent, business_type: { choose: ['__other'], other_text: 'Bakery' } }, { rejectHidden: true });
    expect(ok.answers.business_type).toMatchObject({ choose: ['__other'], other_text: 'Bakery', display: 'Other: Bakery' });
  });

  it('contact validation', () => {
    const bad = (c: object) => validateSubmission(cfg, { ...rent, contact: { value: { ...contact.value, ...c } } }, { rejectHidden: true }).errors[0]?.code;
    expect(bad({ phone: '12345' })).toBe('invalid_phone');
    expect(bad({ name: ' ' })).toBe('name_required');
    expect(bad({ consent: false })).toBe('consent_required');
  });

  it('spoken answers: pending (empty text) counts as answered; meta returned for the server', () => {
    const r = validateSubmission(cfg, { ...rent, about_you: { text: '', voice: true } }, { rejectHidden: true });
    expect(r.ok).toBe(true);
    expect(r.voice.about_you).toEqual({ final: '', live: null, audio_missing: false, has_audio: true });
    expect(r.answers.about_you.display).toMatch(/pending/);
    const live = validateSubmission(cfg, { ...rent, about_you: { text: 'kirana', speech: { live: 'kirana', audio_missing: true } } }, { rejectHidden: true });
    expect(live.voice.about_you).toEqual({ final: 'kirana', live: 'kirana', audio_missing: true, has_audio: false });
    expect(validateSubmission(cfg, { ...rent, about_you: { text: 'x'.repeat(1001), voice: true } }, { rejectHidden: true }).errors[0].code).toBe('too_long');
  });

  it('answers from an old app version (`value`) are upgraded, never rejected', () => {
    const legacy = { path: { value: 'rent' }, business_type: { value: 'grocery' }, start_when: { value: 'immediately' }, rent_budget: { value: 45000 },
      lease_years: { value: '3_5' }, experience: { value: 'yes' }, contact } as unknown as RawAnswers;
    const r = validateSubmission(cfg, legacy, { rejectHidden: true });
    expect(r.errors).toEqual([]);
    expect(r.answers.path.choose).toEqual(['rent']);
    expect(r.answers.rent_budget.number).toBe(45000);
    expect(upgradeRawAnswer(cfg.questions[8], { value: 'my plan' })).toEqual({ text: 'my plan' });
  });

  it('unknown keys are rejected', () => {
    expect(validateSubmission(cfg, { ...rent, hack: { text: 'x' } }, { rejectHidden: true }).errors[0].code).toBe('unknown_question');
  });
});

describe('validateOne with input modes', () => {
  it('required = at least one enabled mode answered', () => {
    const x = one({ input_modes: modes((m) => { m.type = { ...m.type, enabled: true, max_chars: 50 }; m.speak.enabled = true; }) });
    expect(validateOne(x, {})).toEqual({ ok: false, code: 'required' });
    expect(validateOne(x, { choose: ['a'] }).ok).toBe(true);
    expect(validateOne(x, { text: 'typed instead' }).ok).toBe(true);
    expect(validateOne(x, { text: '', voice: true }).ok).toBe(true);
    const both = validateOne(x, { choose: ['b'], text: 'and a note' });
    expect(both.ok && !both.empty && both.stored).toEqual({ choose: ['b'], text: 'and a note' });
    expect(both.ok && !both.empty && both.display).toBe('B — and a note');
  });

  it('disabled modes cannot be used', () => {
    const chooseOnly = one({});
    expect(validateOne(chooseOnly, { text: 'sneaky' })).toEqual({ ok: false, code: 'mode_disabled' });
    const typeOnly = one({ input_modes: modes((m) => { m.primary = 'type'; m.choose.enabled = false; m.type.enabled = true; }) });
    expect(validateOne(typeOnly, { choose: ['a'] })).toEqual({ ok: false, code: 'mode_disabled' });
    const r = validateOne(typeOnly, { text: 'x', voice: true }); // speak off → the recording flag is ignored, typed text counts
    expect(r.ok && !r.empty && r.voice).toBe(false);
  });

  it('char limits (min / max) are enforced', () => {
    const x = one({ input_modes: modes((m) => { m.primary = 'type'; m.choose.enabled = false; m.type = { ...m.type, enabled: true, min_chars: 3, max_chars: 50 }; }) });
    expect(validateOne(x, { text: 'x'.repeat(51) })).toEqual({ ok: false, code: 'too_long' });
    expect(validateOne(x, { text: 'ab' })).toEqual({ ok: false, code: 'too_short' });
    expect(validateOne(x, { text: 'x'.repeat(50) }).ok).toBe(true);
  });

  it('pick rules by style: radio/dropdown one; checkbox/chips min/max; other max chars', () => {
    const radio = one({});
    expect(validateOne(radio, { choose: ['a', 'b'] })).toEqual({ ok: false, code: 'too_many_picks' });
    const box = one({ input_modes: modes((m) => { m.choose = { ...m.choose, style: 'chips', min_picks: 2, max_picks: 2, allow_other: true, other_max_chars: 5 }; }) });
    expect(validateOne(box, { choose: ['a'] })).toEqual({ ok: false, code: 'too_few_picks' });
    expect(validateOne(box, { choose: ['a', 'b', 'c'] })).toEqual({ ok: false, code: 'too_many_picks' });
    expect(validateOne(box, { choose: ['a', '__other'], other_text: 'toolong' })).toEqual({ ok: false, code: 'too_long' });
    const ok = validateOne(box, { choose: ['c', 'a'] });
    expect(ok.ok && !ok.empty && ok.stored.choose).toEqual(['a', 'c']);
  });

  it('formats: number / email', () => {
    const num = one({ validation: { min: 1, max: 10 }, input_modes: modes((m) => { m.primary = 'type'; m.choose.enabled = false; m.type = { ...m.type, enabled: true, format: 'number' }; }) });
    expect(validateOne(num, { text: 'abc' })).toEqual({ ok: false, code: 'not_a_number' });
    expect(validateOne(num, { text: '11' })).toEqual({ ok: false, code: 'too_large' });
    const r = validateOne(num, { text: '7' });
    expect(r.ok && !r.empty && r.stored.number).toBe(7);
    const email = one({ input_modes: modes((m) => { m.primary = 'type'; m.choose.enabled = false; m.type = { ...m.type, enabled: true, format: 'email' }; }) });
    expect(validateOne(email, { text: 'not-an-email' })).toEqual({ ok: false, code: 'invalid_email' });
    expect(validateOne(email, { text: 'a@shop.in' }).ok).toBe(true);
  });
});

describe('engine values', () => {
  it('arrays, numbers, text, legacy and pending voice', () => {
    expect(engineValue({ choose: ['a'], display: '', question_label: '' })).toEqual(['a']);
    expect(engineValue({ text: '45,000', number: 45000, display: '', question_label: '' })).toBe(45000);
    expect(engineValue({ value: 'rent', display: '', question_label: '' })).toBe('rent');
    expect(engineValue({ text: '', voice_note_id: 'n', display: '', question_label: '' })).toBe('(voice note)');
    expect(rawEngineValue({ choose: ['rent'] })).toEqual(['rent']);
    expect(rawEngineValue({ text: '45,000' })).toBe(45000);
    expect(rawEngineValue({ speech: { live: 'hi' } })).toBe('(voice note)');
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
