// Row ↔ engine shapes for the builder.
import type { DraftQuestion } from '@shared/compile.ts';
import type { QuestionRow } from '../types.ts';
import type { RefQuestion } from './conditionValue.ts';

export function toDraft(q: QuestionRow): DraftQuestion {
  return {
    id: q.id,
    key: q.key,
    kind: q.kind,
    input_modes: q.input_modes,
    label_en: q.label_en,
    label_hi: q.label_hi,
    help_en: q.help_en,
    help_hi: q.help_hi,
    required: q.required,
    position: q.position,
    show_if: q.show_if,
    validation: q.validation ?? {},
    archived_at: q.archived_at,
    first_published_at: q.first_published_at,
    options: q.question_options.map((o) => ({
      id: o.id,
      value: o.value,
      label_en: o.label_en,
      label_hi: o.label_hi,
      position: o.position,
      archived_at: o.archived_at,
      first_published_at: o.first_published_at,
    })),
  };
}

export function toRef(q: QuestionRow): RefQuestion {
  return {
    key: q.key,
    kind: q.kind,
    input_modes: q.input_modes,
    label_en: q.label_en || q.key,
    archived: !!q.archived_at,
    options: [...q.question_options].sort((a, b) => a.position - b.position).map((o) => ({ value: o.value, label_en: o.label_en, archived: !!o.archived_at })),
  };
}
