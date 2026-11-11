// Compile the editable draft (questions + question_options rows) into the
// immutable FormConfig stored in form_versions. Mirrors SQL public.sls_compile_form().

import type { CompiledQuestion, FormConfig, QuestionType, ShowIf, Validation } from './types.ts';

export interface DraftOption {
  id: string;
  value: string;
  label_en: string;
  label_hi: string | null;
  position: number;
  archived_at: string | null;
  first_published_at: string | null;
}

export interface DraftQuestion {
  id: string;
  key: string;
  type: QuestionType;
  label_en: string;
  label_hi: string | null;
  help_en: string | null;
  help_hi: string | null;
  placeholder: string | null;
  required: boolean;
  position: number;
  show_if: ShowIf | null;
  validation: Validation | null;
  allow_other: boolean;
  allow_voice: boolean;
  archived_at: string | null;
  first_published_at: string | null;
  options: DraftOption[];
}

export const YES_NO_OPTIONS = [
  { value: 'yes', label_en: 'Yes', label_hi: 'हाँ' },
  { value: 'no', label_en: 'No', label_hi: 'नहीं' },
];

const byPos = <T extends { position: number }>(a: T, b: T) => a.position - b.position;

export function activeQuestions(qs: DraftQuestion[]): DraftQuestion[] {
  return qs.filter((q) => !q.archived_at).sort(byPos);
}

export function activeOptions(q: DraftQuestion): DraftOption[] {
  return q.options.filter((o) => !o.archived_at).sort(byPos);
}

export function optionValuesOf(q: { type: QuestionType; options: { value: string }[] }): string[] {
  if (q.type === 'yes_no') return YES_NO_OPTIONS.map((o) => o.value);
  return q.options.map((o) => o.value);
}

function cleanValidation(v: Validation | null | undefined): Validation {
  const out: Validation = {};
  if (!v) return out;
  for (const k of ['min', 'max', 'maxLength', 'minPicks', 'maxPicks'] as const) {
    const x = v[k];
    if (x !== undefined && x !== null && x !== '') (out as Record<string, unknown>)[k] = x;
  }
  return out;
}

export function compileQuestion(q: DraftQuestion): CompiledQuestion {
  const isChoice = q.type === 'single' || q.type === 'multi' || q.type === 'dropdown';
  return {
    key: q.key,
    type: q.type,
    label_en: q.label_en,
    label_hi: q.label_hi || null,
    help_en: q.help_en || null,
    help_hi: q.help_hi || null,
    placeholder: q.placeholder || null,
    required: q.type === 'contact' ? true : q.required,
    show_if: q.show_if ?? null,
    validation: cleanValidation(q.validation),
    allow_other: isChoice ? q.allow_other : false,
    allow_voice:
      q.type === 'voice' ? true : q.type === 'short_text' || q.type === 'long_text' ? q.allow_voice : false,
    options:
      q.type === 'yes_no'
        ? YES_NO_OPTIONS.map((o) => ({ ...o }))
        : isChoice
          ? activeOptions(q).map((o) => ({ value: o.value, label_en: o.label_en, label_hi: o.label_hi || null }))
          : [],
  };
}

export function compileForm(questions: DraftQuestion[]): FormConfig {
  return { schema: 1, questions: activeQuestions(questions).map(compileQuestion) };
}
