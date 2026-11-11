// Input modes: how a 'standard' question can be answered (choose / type / speak).
// Dependency-free (the zod schema lives in schemas.ts) so the respondent bundle stays small.
// The legacy → modes mapping MUST match SQL public.sls_legacy_modes() (migration 10).

import type {
  ChooseMode,
  CompiledOption,
  CompiledQuestion,
  FormConfig,
  InputMode,
  InputModes,
  QuestionKind,
  QuestionType,
  ShowIf,
  SpeakMode,
  TypeMode,
  Validation,
} from './types.ts';

export const LIMITS = {
  maxChars: 2000,
  otherMaxChars: 500,
  speakMinSeconds: 10,
  speakMaxSeconds: 300,
  maxPicks: 50,
} as const;

export const DEFAULT_CHOOSE: ChooseMode = { enabled: true, style: 'radio', min_picks: null, max_picks: null, allow_other: false, other_max_chars: 200 };
export const DEFAULT_TYPE: TypeMode = { enabled: false, multiline: false, min_chars: null, max_chars: 300, placeholder_en: null, placeholder_hi: null, format: 'any' };
export const DEFAULT_SPEAK: SpeakMode = { enabled: false, max_seconds: 120, live_transcript: true, allow_edit: true, keep_audio: true };

export function defaultModes(): InputModes {
  return { primary: 'choose', choose: { ...DEFAULT_CHOOSE }, type: { ...DEFAULT_TYPE }, speak: { ...DEFAULT_SPEAK } };
}

/** Fill missing fields with defaults (tolerant reader for stored jsonb). */
export function withDefaults(m: Partial<InputModes> | null | undefined): InputModes {
  const d = defaultModes();
  if (!m) return d;
  return {
    primary: (m.primary as InputMode) ?? d.primary,
    choose: { ...d.choose, ...(m.choose ?? {}) },
    type: { ...d.type, ...(m.type ?? {}) },
    speak: { ...d.speak, ...(m.speak ?? {}) },
  };
}

export const enabledModes = (m: InputModes): InputMode[] => (['choose', 'type', 'speak'] as const).filter((k) => m[k].enabled);

/** radio / dropdown pick exactly one; checkbox / chips may pick several */
export const isSingleSelect = (c: ChooseMode) => c.style === 'radio' || c.style === 'dropdown';

export function effectiveMaxPicks(c: ChooseMode): number | null {
  return isSingleSelect(c) ? 1 : c.max_picks;
}

/** Max characters for the text field (typed or spoken). */
export function textMaxChars(m: InputModes): number {
  if (m.type.enabled && m.type.max_chars) return Math.min(m.type.max_chars, LIMITS.maxChars);
  return LIMITS.maxChars;
}

export const isNumericFormat = (m: InputModes | null) => !!m && m.type.enabled && (m.type.format === 'number' || m.type.format === 'currency');

/** Upload of a recording is accepted only when speaking is on and audio is kept. */
export const acceptsAudio = (q: Pick<CompiledQuestion, 'kind' | 'input_modes'>) =>
  q.kind === 'standard' && !!q.input_modes?.speak.enabled && q.input_modes.speak.keep_audio;

// ---------------------------------------------------------------- legacy (schema 1) mapping
export interface LegacyFields {
  type: QuestionType;
  allow_other?: boolean;
  allow_voice?: boolean;
  validation?: Validation | null;
  placeholder?: string | null;
}

/** Map a legacy question type to kind + input modes (mirror of SQL sls_legacy_modes). */
export function legacyToModes(l: LegacyFields): { kind: QuestionKind; input_modes: InputModes | null } {
  const v = l.validation ?? {};
  if (l.type === 'yes_no' || l.type === 'date' || l.type === 'contact') return { kind: l.type, input_modes: null };
  const m = defaultModes();
  m.choose.enabled = false;
  const speak = !!l.allow_voice;
  switch (l.type) {
    case 'single':
    case 'multi':
    case 'dropdown':
      m.primary = 'choose';
      m.choose = {
        ...m.choose,
        enabled: true,
        style: l.type === 'single' ? 'radio' : l.type === 'multi' ? 'checkbox' : 'dropdown',
        min_picks: l.type === 'multi' ? (v.minPicks ?? null) : null,
        max_picks: l.type === 'multi' ? (v.maxPicks ?? null) : null,
        allow_other: !!l.allow_other,
      };
      break;
    case 'short_text':
    case 'long_text':
      m.primary = 'type';
      m.type = { ...m.type, enabled: true, multiline: l.type === 'long_text', max_chars: v.maxLength ?? (l.type === 'long_text' ? 2000 : 200), placeholder_en: l.placeholder ?? null };
      m.speak.enabled = speak;
      break;
    case 'number':
    case 'currency':
      m.primary = 'type';
      m.type = { ...m.type, enabled: true, format: l.type, max_chars: 15, placeholder_en: l.placeholder ?? null };
      break;
    case 'voice':
      m.primary = 'speak';
      m.speak.enabled = true;
      m.type = { ...m.type, enabled: true, multiline: true, max_chars: v.maxLength ?? 2000, placeholder_en: l.placeholder ?? null };
      break;
  }
  return { kind: 'standard', input_modes: m };
}

interface LegacyCompiledQuestion {
  key: string;
  type: QuestionType;
  label_en: string;
  label_hi: string | null;
  help_en: string | null;
  help_hi: string | null;
  placeholder: string | null;
  required: boolean;
  show_if: ShowIf | null;
  validation: Validation;
  allow_other: boolean;
  allow_voice: boolean;
  options: CompiledOption[];
}

/** Upgrade any stored config (schema 1 or 2) to schema 2. Pure; never mutates the input. */
export function normalizeConfig(cfg: unknown): FormConfig {
  const c = cfg as { schema?: number; questions?: unknown[] };
  if (c?.schema === 2) {
    const qs = (c.questions ?? []) as CompiledQuestion[];
    return { schema: 2, questions: qs.map((q) => ({ ...q, input_modes: q.kind === 'standard' ? withDefaults(q.input_modes) : null })) };
  }
  return {
    schema: 2,
    questions: ((c?.questions ?? []) as LegacyCompiledQuestion[]).map((q) => {
      const { kind, input_modes } = legacyToModes(q);
      const keepRange = q.type === 'number' || q.type === 'currency' || q.type === 'date';
      return {
        key: q.key,
        kind,
        label_en: q.label_en,
        label_hi: q.label_hi ?? null,
        help_en: q.help_en ?? null,
        help_hi: q.help_hi ?? null,
        required: q.required,
        show_if: q.show_if ?? null,
        validation: keepRange ? { ...(q.validation.min != null ? { min: q.validation.min } : {}), ...(q.validation.max != null ? { max: q.validation.max } : {}) } : {},
        input_modes,
        options: q.options ?? [],
      };
    }),
  };
}

/** Short human description, e.g. "Choose (radio) · Type · Speak". */
export function describeModes(m: InputModes | null, kind: QuestionKind): string {
  if (kind !== 'standard' || !m) return kind === 'yes_no' ? 'Yes / No' : kind === 'date' ? 'Date' : 'Contact details';
  const parts: string[] = [];
  for (const k of [m.primary, ...(['choose', 'type', 'speak'] as const).filter((x) => x !== m.primary)]) {
    if (!m[k].enabled) continue;
    if (k === 'choose') parts.push(`Choose (${m.choose.style})`);
    if (k === 'type') parts.push(m.type.format === 'any' ? (m.type.multiline ? 'Type (long)' : 'Type') : `Type (${m.type.format})`);
    if (k === 'speak') parts.push('Speak');
  }
  return parts.join(' · ');
}
