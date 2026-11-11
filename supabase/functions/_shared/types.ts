// Shared domain types. Imported by the web app (Vite) and by Edge Functions (Deno).
// Keep this file dependency-free.

export const QUESTION_TYPES = [
  'single',
  'multi',
  'dropdown',
  'yes_no',
  'short_text',
  'long_text',
  'number',
  'currency',
  'date',
  'voice',
  'contact',
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const CHOICE_TYPES: readonly QuestionType[] = ['single', 'multi', 'dropdown', 'yes_no'];
export const TEXT_TYPES: readonly QuestionType[] = ['short_text', 'long_text', 'voice'];
export const NUMERIC_TYPES: readonly QuestionType[] = ['number', 'currency'];

export const OPS = [
  'eq',
  'neq',
  'in',
  'not_in',
  'gte',
  'lte',
  'between',
  'contains_any',
  'contains_all',
  'answered',
  'not_answered',
] as const;
export type Op = (typeof OPS)[number];

/** A single condition: {"q": key, "op": op, "v": value} */
export interface Cond {
  q: string;
  op: Op;
  v?: unknown;
}
export interface AllGroup {
  all: ShowIfNode[];
}
export interface AnyGroup {
  any: ShowIfNode[];
}
export type ShowIf = AllGroup | AnyGroup;
export type ShowIfNode = ShowIf | Cond;

export interface Validation {
  min?: number | string | null;
  max?: number | string | null;
  maxLength?: number | null;
  minPicks?: number | null;
  maxPicks?: number | null;
}

/** The system question that splits the form into paths. Always first. */
export const PATH_KEY = 'path';
export const PATH_VALUES = ['rent', 'partner', 'either'] as const;
export type PathValue = (typeof PATH_VALUES)[number];
export type ResponsePath = PathValue | 'waitlist';

/** Option value used when a respondent picks "Other" and types text. */
export const OTHER_VALUE = '__other';

export interface CompiledOption {
  value: string;
  label_en: string;
  label_hi: string | null;
}

export interface CompiledQuestion {
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

/** The immutable compiled config stored in form_versions.config */
export interface FormConfig {
  schema: 1;
  questions: CompiledQuestion[];
}

export interface ContactValue {
  name: string;
  phone: string; // as typed by client; normalised to E.164 by the server
  whatsapp_ok: boolean;
  consent: boolean;
}

export type AnswerValue = string | number | string[] | ContactValue;

/** What the client sends per question. */
export interface RawAnswer {
  value: AnswerValue | null;
  other_text?: string | null;
  /** true when this text answer came from a voice recording (response_id + question key identify it) */
  voice?: boolean;
}
export type RawAnswers = Record<string, RawAnswer>;

/** What is stored in responses.answers per key. */
export interface StoredAnswer {
  value: AnswerValue;
  display: string;
  question_label: string;
  other_text?: string;
  voice_note_id?: string;
}
export type StoredAnswers = Record<string, StoredAnswer>;

/** Key → value map used by the engines. Missing key = not answered. */
export type Values = Record<string, unknown>;

// ---------- Profiles ----------
export type Importance = 'must' | 'important' | 'nice';

export interface ProfileConditionDef {
  question_key: string;
  operator: Op;
  value: unknown;
  importance: Importance;
}

export interface ProfileSetSettings {
  weights: { important: number; nice: number };
  thresholds: { ideal: number; maybe: number };
  priority: { match: number; intent: number };
  intent: IntentSettings;
}

export interface IntentSettings {
  timing_key: string;
  timing_points: Record<string, number>;
  voice_points: number;
  all_optional_points: number;
  whatsapp_points: number;
  duration_points: number;
  duration_min_seconds: number;
  duration_max_seconds: number;
  bot_below_seconds: number;
}

export const DEFAULT_PROFILE_SETTINGS: ProfileSetSettings = {
  weights: { important: 3, nice: 1 },
  thresholds: { ideal: 80, maybe: 50 },
  priority: { match: 0.7, intent: 0.3 },
  intent: {
    timing_key: 'start_when',
    timing_points: { immediately: 40, within_1_month: 30, '1_3_months': 15, later: 0 },
    voice_points: 25,
    all_optional_points: 15,
    whatsapp_points: 10,
    duration_points: 10,
    duration_min_seconds: 30,
    duration_max_seconds: 900,
    bot_below_seconds: 15,
  },
};

export type Tier = 'ideal' | 'maybe' | 'no';

export interface ConditionResult {
  question_key: string;
  operator: Op;
  value: unknown;
  importance: Importance;
  /** Human-readable reason, e.g. "Budget ≥ ₹40,000 (answered ₹50,000)" */
  text: string;
}

export interface ProfileMatch {
  profile_id: string;
  name: string;
  match: number;
  qualified: boolean;
  matched: ConditionResult[];
  missed: ConditionResult[];
  failed_must: ConditionResult[];
}

export const PIPELINE_STATUSES = [
  'new',
  'contacted',
  'visit_scheduled',
  'negotiating',
  'won',
  'lost',
] as const;
export type PipelineStatus = (typeof PIPELINE_STATUSES)[number];

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

export const VOICE_MIME_TYPES = [
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/mpeg',
  'audio/wav',
] as const;
export type VoiceMime = (typeof VOICE_MIME_TYPES)[number];

export const VOICE_LIMITS = {
  maxBytes: 10 * 1024 * 1024,
  maxTotalSecondsPerResponse: 300,
  maxRecordingsPerQuestion: 3,
  maxTranscriptChars: 2000,
} as const;

export const TEXT_DEFAULT_MAX = { short_text: 200, long_text: 2000, voice: 2000 } as const;
