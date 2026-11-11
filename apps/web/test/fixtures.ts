import type { DraftOption, DraftQuestion } from '@shared/compile.ts';
import type { InputModes, QuestionKind, ShowIf, Validation } from '@shared/types.ts';
import { defaultModes } from '@shared/input-modes.ts';

let n = 0;
const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

export function opt(value: string, label_en = value, extra: Partial<DraftOption> = {}): DraftOption {
  return { id: id(), value, label_en, label_hi: null, position: 0, archived_at: null, first_published_at: null, ...extra };
}

export function modes(patch: (m: InputModes) => void = () => undefined): InputModes {
  const m = defaultModes();
  patch(m);
  return m;
}
export const CURRENCY = () => modes((m) => { m.primary = 'type'; m.choose.enabled = false; m.type = { ...m.type, enabled: true, format: 'currency', max_chars: 15, placeholder_en: '50000' }; });
export const SPEAK = () => modes((m) => { m.primary = 'speak'; m.choose.enabled = false; m.speak.enabled = true; m.type = { ...m.type, enabled: true, multiline: true, max_chars: 1000 }; });
export const TEXT = (max = 300) => modes((m) => { m.primary = 'type'; m.choose.enabled = false; m.type = { ...m.type, enabled: true, max_chars: max }; });

export function q(
  key: string,
  kind: QuestionKind,
  extra: Partial<Omit<DraftQuestion, 'options'>> & { options?: DraftOption[]; show_if?: ShowIf | null; validation?: Validation } = {},
): DraftQuestion {
  const options = (extra.options ?? []).map((o, i) => ({ ...o, position: i }));
  return {
    id: id(),
    key,
    kind,
    input_modes: kind === 'standard' ? (extra.input_modes ?? defaultModes()) : null,
    label_en: extra.label_en ?? key.replace(/_/g, ' '),
    label_hi: null,
    help_en: null,
    help_hi: null,
    required: true,
    position: 0,
    show_if: null,
    validation: null,
    archived_at: null,
    first_published_at: null,
    ...extra,
    options,
  };
}

/** The same form as supabase/seed.sql */
export function seedForm(): DraftQuestion[] {
  const qs = [
    q('path', 'standard', {
      label_en: 'Are you looking to rent this shop or partner with us?',
      options: [opt('rent', 'Rent the shop'), opt('partner', 'Partner with us'), opt('either', 'Open to either')],
    }),
    q('business_type', 'standard', {
      label_en: 'What business do you want to run here?',
      input_modes: modes((m) => { m.choose.allow_other = true; }),
      options: [
        opt('grocery', 'Grocery / Kirana'),
        opt('pharmacy', 'Pharmacy'),
        opt('clothing', 'Clothing'),
        opt('electronics', 'Mobile & electronics'),
        opt('salon', 'Salon / beauty'),
        opt('restaurant', 'Restaurant / food'),
      ],
    }),
    q('start_when', 'standard', {
      label_en: 'When do you want to start?',
      options: [
        opt('immediately', 'Immediately'),
        opt('within_1_month', 'Within 1 month'),
        opt('1_3_months', 'In 1–3 months'),
        opt('later', 'Later / not sure'),
      ],
    }),
    q('rent_budget', 'standard', {
      label_en: 'How much monthly rent can you pay?',
      input_modes: CURRENCY(),
      validation: { min: 0, max: 10000000 },
      show_if: { any: [{ q: 'path', op: 'in', v: ['rent', 'either'] }] },
    }),
    q('lease_years', 'standard', {
      label_en: 'For how many years do you want the lease?',
      show_if: { all: [{ q: 'path', op: 'eq', v: 'rent' }] },
      options: [opt('1_2', '1–2 years'), opt('3_5', '3–5 years'), opt('5_plus', 'More than 5 years')],
    }),
    q('investment', 'standard', {
      label_en: 'How much can you invest in the partnership?',
      input_modes: CURRENCY(),
      validation: { min: 0 },
      show_if: { any: [{ q: 'path', op: 'in', v: ['partner', 'either'] }] },
    }),
    q('partner_role', 'standard', {
      label_en: 'What role would you like in the partnership?',
      show_if: { all: [{ q: 'path', op: 'eq', v: 'partner' }] },
      options: [opt('active', 'Active — I will run the shop'), opt('sleeping', 'Investor only')],
    }),
    q('experience', 'yes_no', { label_en: 'Have you run a shop before?' }),
    q('about_you', 'standard', { label_en: 'Tell us about your plan', required: false, input_modes: SPEAK() }),
    q('contact', 'contact', { label_en: 'How can we reach you?' }),
  ];
  return qs.map((x, i) => ({ ...x, position: i }));
}
