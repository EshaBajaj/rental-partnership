import { describe, expect, it } from 'vitest';
import { hasErrors, screensPerPath, validateDraft } from '@shared/validator.ts';
import { compileForm } from '@shared/compile.ts';
import { modes, opt, q, seedForm, TEXT } from '../fixtures.ts';

const msgs = (qs: ReturnType<typeof seedForm>) => validateDraft(qs).map((i) => i.message);
const move = <T extends { position: number }>(arr: T[], from: number, to: number): T[] => {
  const a = [...arr];
  const [x] = a.splice(from, 1);
  a.splice(to, 0, x);
  return a.map((y, i) => ({ ...y, position: i }));
};

describe('validateDraft', () => {
  it('seed form is valid with no warnings', () => {
    expect(validateDraft(seedForm())).toEqual([]);
    expect(screensPerPath(seedForm())).toEqual({ rent: 8, partner: 8, either: 8 });
  });

  it('dependency after its dependent → names both questions and says what to move', () => {
    const qs = seedForm();
    // add a question that depends on experience, then move it above experience
    qs.splice(7, 0, q('years', 'standard', { input_modes: modes((m) => { m.primary = 'type'; m.choose.enabled = false; m.type = { ...m.type, enabled: true, format: 'number' }; }), label_en: 'How many years?', show_if: { all: [{ q: 'experience', op: 'eq', v: 'yes' }] } }));
    const ordered = move(qs.map((x, i) => ({ ...x, position: i })), 7, 3);
    const m = msgs(ordered);
    expect(m.some((s) => s.includes('“How many years?” depends on “Have you run a shop before?”') && s.includes('Move “Have you run a shop before?” above'))).toBe(true);
  });

  it('self reference', () => {
    const qs = seedForm();
    qs[2].show_if = { all: [{ q: 'start_when', op: 'answered' }] };
    expect(msgs(qs).some((s) => s.includes("can't depend on its own answer"))).toBe(true);
  });

  it('missing / archived references', () => {
    const qs = seedForm();
    qs[2].show_if = { all: [{ q: 'nope', op: 'answered' }] };
    expect(msgs(qs).some((s) => s.includes("doesn't exist"))).toBe(true);

    const qs2 = seedForm();
    qs2[1].options[0].archived_at = '2026-01-01';
    qs2[2].show_if = { all: [{ q: 'business_type', op: 'eq', v: 'grocery' }] };
    expect(msgs(qs2).some((s) => s.includes('which is archived'))).toBe(true);

    const qs3 = seedForm();
    qs3[2].show_if = { all: [{ q: 'business_type', op: 'eq', v: 'bakery' }] };
    expect(msgs(qs3).some((s) => s.includes('not an answer option'))).toBe(true);
  });

  it('contact rules', () => {
    const none = seedForm().filter((x) => x.kind !== 'contact');
    expect(msgs(none).some((s) => s.includes('Contact details'))).toBe(true);
    const two = [...seedForm(), q('contact2', 'contact', { position: 99 })];
    expect(msgs(two).some((s) => s.includes('Keep exactly one'))).toBe(true);
    const cond = seedForm();
    cond[9].show_if = { all: [{ q: 'path', op: 'eq', v: 'rent' }] };
    expect(msgs(cond).some((s) => s.includes('must be shown to everyone'))).toBe(true);
  });

  it('choice questions need two options', () => {
    const qs = seedForm();
    qs[6].options = [opt('active')];
    expect(msgs(qs).some((s) => s.includes('at least 2 answer options'))).toBe(true);
  });

  it('path question must be first and intact', () => {
    expect(msgs(move(seedForm(), 0, 2)).some((s) => s.includes('must be first'))).toBe(true);
    const qs = seedForm();
    qs[0].options = qs[0].options.slice(0, 2);
    expect(msgs(qs).some((s) => s.includes('must keep the answer “either”'))).toBe(true);
  });

  it('warns when a path is longer than 9 screens', () => {
    const qs = seedForm();
    for (let i = 0; i < 3; i++) qs.splice(8, 0, q(`extra_${i}`, 'standard', { required: false, input_modes: TEXT() }));
    const issues = validateDraft(qs.map((x, i) => ({ ...x, position: i })));
    expect(hasErrors(issues)).toBe(false);
    expect(issues.filter((i) => i.code === 'path_long')).toHaveLength(3);
  });

  it('pick limits sanity', () => {
    const qs = seedForm();
    qs.splice(8, 0, q('features', 'standard', { options: [opt('a'), opt('b')], input_modes: modes((m) => { m.choose.style = 'checkbox'; m.choose.min_picks = 3; }) }));
    expect(msgs(qs.map((x, i) => ({ ...x, position: i }))).some((s) => s.includes('only 2 options'))).toBe(true);
  });

  it('input modes sanity: at least one mode, primary on, char limits, recording length', () => {
    const build = (patch: (m: ReturnType<typeof modes>) => void) => {
      const qs = seedForm();
      qs.splice(8, 0, q('extra', 'standard', { options: [opt('a'), opt('b')], input_modes: modes(patch) }));
      return msgs(qs.map((x, i) => ({ ...x, position: i })));
    };
    expect(build((m) => { m.choose.enabled = false; }).some((s) => s.includes('at least one way to answer'))).toBe(true);
    expect(build((m) => { m.type.enabled = true; m.primary = 'speak'; }).some((s) => s.includes('main way to answer'))).toBe(true);
    expect(build((m) => { m.type = { ...m.type, enabled: true, min_chars: 60, max_chars: 50 }; }).some((s) => s.includes('minimum characters is bigger'))).toBe(true);
    expect(build((m) => { m.type = { ...m.type, enabled: true, max_chars: 5000 }; }).some((s) => s.includes('between 1 and 2000'))).toBe(true);
    expect(build((m) => { m.speak = { ...m.speak, enabled: true, max_seconds: 5 }; }).some((s) => s.includes('between 10 and 300'))).toBe(true);
    expect(build((m) => { m.type = { ...m.type, enabled: true, max_chars: 50 }; m.speak.enabled = true; })).toEqual([]);
  });

  it('path question must stay choose-only single select', () => {
    const qs = seedForm();
    qs[0].input_modes = modes((m) => { m.choose.style = 'checkbox'; });
    expect(msgs(qs).some((s) => s.includes('choosing exactly one option'))).toBe(true);
  });

  it('wrong operator for type', () => {
    const qs = seedForm();
    qs[2].show_if = { all: [{ q: 'business_type', op: 'gte', v: 5 }] };
    // (gte needs a number / date question)
    expect(msgs(qs).some((s) => s.includes("can't be used with"))).toBe(true);
  });
});

describe('compileForm', () => {
  it('drops archived questions/options and injects yes/no options', () => {
    const qs = seedForm();
    qs[1].options[5].archived_at = '2026-01-01';
    qs[8].archived_at = '2026-01-01';
    const cfg = compileForm(qs);
    expect(cfg.questions.map((x) => x.key)).not.toContain('about_you');
    expect(cfg.questions[1].options.map((o) => o.value)).not.toContain('restaurant');
    expect(cfg.questions.find((x) => x.key === 'experience')!.options.map((o) => o.value)).toEqual(['yes', 'no']);
    expect(cfg.schema).toBe(2);
    expect(cfg.questions.find((x) => x.key === 'rent_budget')!.validation).toEqual({ min: 0, max: 10000000 });
    expect(cfg.questions.find((x) => x.key === 'experience')!.input_modes).toBeNull();
    expect(cfg.questions.find((x) => x.key === 'contact')!.required).toBe(true);
  });
});
