// Compile the editable draft (questions + question_options rows) into the immutable FormConfig
// (schema 2) stored in form_versions. Mirrors SQL public.sls_compile_form() (migration 10).

import type { CompiledQuestion, FormConfig, InputModes, QuestionKind, ShowIf, Validation } from './types.ts';
import { withDefaults } from './input-modes.ts';

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
  kind: QuestionKind;
  input_modes: InputModes | null;
  label_en: string;
  label_hi: string | null;
  help_en: string | null;
  help_hi: string | null;
  required: boolean;
  position: number;
  show_if: ShowIf | null;
  validation: Validation | null;
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

/** Does this question offer picking from options? */
export function hasChoices(q: { kind: QuestionKind; input_modes: InputModes | null }): boolean {
  return q.kind === 'yes_no' || (q.kind === 'standard' && !!q.input_modes?.choose.enabled);
}

export function optionValuesOf(q: { kind: QuestionKind; options: { value: string }[] }): string[] {
  if (q.kind === 'yes_no') return YES_NO_OPTIONS.map((o) => o.value);
  return q.options.map((o) => o.value);
}

function cleanValidation(v: Validation | null | undefined, keep: boolean): Validation {
  const out: Validation = {};
  if (!v || !keep) return out;
  for (const k of ['min', 'max'] as const) {
    const x = v[k];
    if (x !== undefined && x !== null && x !== '') out[k] = x;
  }
  return out;
}

export function compileQuestion(q: DraftQuestion): CompiledQuestion {
  const modes = q.kind === 'standard' ? withDefaults(q.input_modes) : null;
  const numeric = !!modes && modes.type.enabled && (modes.type.format === 'number' || modes.type.format === 'currency');
  return {
    key: q.key,
    kind: q.kind,
    label_en: q.label_en,
    label_hi: q.label_hi || null,
    help_en: q.help_en || null,
    help_hi: q.help_hi || null,
    required: q.kind === 'contact' ? true : q.required,
    show_if: q.show_if ?? null,
    validation: cleanValidation(q.validation, q.kind === 'date' || numeric),
    input_modes: modes,
    options:
      q.kind === 'yes_no'
        ? YES_NO_OPTIONS.map((o) => ({ ...o }))
        : modes?.choose.enabled
          ? activeOptions(q).map((o) => ({ value: o.value, label_en: o.label_en, label_hi: o.label_hi || null }))
          : [],
  };
}

export function compileForm(questions: DraftQuestion[]): FormConfig {
  return { schema: 2, questions: activeQuestions(questions).map(compileQuestion) };
}
