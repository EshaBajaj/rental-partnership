// Row types for the admin side (mirrors supabase/migrations).
import type {
  FormConfig,
  Importance,
  Op,
  PipelineStatus,
  QuestionType,
  ShowIf,
  StoredAnswers,
  Tier,
  Validation,
} from '@shared/types.ts';

export interface AdminRow {
  user_id: string;
  email: string;
  role: 'owner' | 'staff';
  created_at: string;
}

export interface PropertyRow {
  id: string;
  slug: string;
  name: string;
  status: 'open' | 'closed';
  closed_message: string;
  default_lang: 'en' | 'hi';
  audio_retention_days: number;
  created_at: string;
  updated_at: string;
}

export interface OptionRow {
  id: string;
  question_id: string;
  value: string;
  label_en: string;
  label_hi: string | null;
  position: number;
  archived_at: string | null;
  first_published_at: string | null;
  created_at: string;
}

export interface QuestionRow {
  id: string;
  property_id: string;
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
  validation: Validation;
  allow_other: boolean;
  allow_voice: boolean;
  archived_at: string | null;
  first_published_at: string | null;
  created_at: string;
  updated_at: string;
  question_options: OptionRow[];
}

export interface FormVersionRow {
  id: string;
  property_id: string;
  version: number;
  config: FormConfig;
  published_by: string | null;
  published_at: string;
  is_current: boolean;
}

export interface ProfileSetRow {
  id: string;
  property_id: string;
  version: number;
  status: 'draft' | 'published';
  is_current: boolean;
  settings: Record<string, unknown>;
  based_on_id: string | null;
  created_at: string;
  published_at: string | null;
  published_by: string | null;
}

export interface ProfileConditionRow {
  id: string;
  profile_id: string;
  question_key: string;
  operator: Op;
  value: unknown;
  importance: Importance;
  position: number;
}

export interface ProfileRow {
  id: string;
  profile_set_id: string;
  name: string;
  description: string | null;
  active: boolean;
  position: number;
  created_at: string;
  profile_conditions: ProfileConditionRow[];
}

export interface NeverRuleRow {
  id: string;
  profile_set_id: string;
  question_key: string;
  operator: Op;
  value: unknown;
  label: string;
}

export interface ReasonItem {
  question_key: string;
  operator: Op;
  value: unknown;
  importance: Importance;
  text: string;
}

export interface ProfileMatchJson {
  profile_id: string;
  name: string;
  match: number;
  qualified: boolean;
  position?: number;
  matched: ReasonItem[];
  missed: ReasonItem[];
  failed_must: ReasonItem[];
}

export interface MatchDetail {
  best_profile_name?: string | null;
  best_qualified?: boolean;
  intent_breakdown?: Record<string, number>;
  visible_keys?: string[];
  profile_set_version?: number | null;
  matched_at?: string;
}

export type ResponsePathValue = 'rent' | 'partner' | 'either' | 'waitlist';

export interface ResponseRow {
  id: string;
  property_id: string;
  form_version_id: string | null;
  profile_set_id: string | null;
  path: ResponsePathValue;
  answers: StoredAnswers;
  name: string;
  phone_e164: string;
  whatsapp_ok: boolean;
  lang: 'en' | 'hi';
  source: string;
  duration_seconds: number;
  best_profile_id: string | null;
  best_match: number | null;
  profile_matches: ProfileMatchJson[];
  match_detail: MatchDetail;
  intent_score: number;
  priority: number;
  tier: Tier;
  tier_rank: number;
  never_hit: { label: string; question_key: string; text: string }[];
  duplicate_of: string | null;
  suspected_bot: boolean;
  pipeline_status: PipelineStatus;
  lost_reason: string | null;
  pinned: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface VoiceNoteRow {
  id: string;
  response_id: string;
  question_key: string;
  storage_path: string;
  mime: string;
  bytes: number;
  duration_seconds: number;
  transcript_machine: string | null;
  transcript_final: string | null;
  edited_by_respondent: boolean;
  language: string | null;
  transcript_en: string | null;
  status: string;
  transcribe_attempts: number;
  last_error: string | null;
  audio_deleted_at: string | null;
  created_at: string;
}

export interface LeadEventRow {
  id: number;
  response_id: string;
  property_id: string;
  type: string;
  data: Record<string, unknown>;
  actor: string | null;
  created_at: string;
}

export interface SavedViewRow {
  id: string;
  user_id: string;
  property_id: string;
  name: string;
  filters: Record<string, unknown>;
  created_at: string;
}

export interface AuditRow {
  id: number;
  table_name: string;
  row_id: string | null;
  action: string;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  actor: string | null;
  created_at: string;
}

export interface FunnelEventRow {
  session_id: string;
  event: string;
  question_key: string | null;
  created_at: string;
}

export interface SimulateResult {
  total: number;
  changed: number;
  old: Record<Tier, number>;
  new: Record<Tier, number>;
  changes: {
    response_id: string;
    name: string;
    created_at: string;
    old_tier: Tier;
    new_tier: Tier;
    old_profile: string | null;
    new_profile: string | null;
    old_match: number | null;
    new_match: number | null;
  }[];
}

export interface LiveCount {
  total: number;
  qualified: number;
  ideal: number;
}
