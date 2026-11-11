// Dependency interfaces for the Edge Functions + the real (Supabase / Groq / Telegram) implementation.
// Handlers only talk to these interfaces, so tests inject fakes.
import type { FormConfig } from '../types.ts';

export interface Property {
  id: string;
  slug: string;
  name: string;
  status: 'open' | 'closed';
  closed_message: string;
  default_lang: 'en' | 'hi';
  brand_name: string;
  contact_phone: string | null;
  contact_whatsapp: string | null;
  address_line: string | null;
  logo_url: string | null;
  shop_photo_url: string | null;
  welcome_title_en: string | null;
  welcome_title_hi: string | null;
  welcome_body_en: string | null;
  welcome_body_hi: string | null;
  default_speech_lang: 'hi-IN' | 'en-IN';
  audio_retention_days: number;
}

/** The public face of a property (what respondents see). */
export function publicProperty(p: Property) {
  return {
    slug: p.slug, name: p.name, default_lang: p.default_lang, brand_name: p.brand_name, contact_phone: p.contact_phone,
    contact_whatsapp: p.contact_whatsapp, address_line: p.address_line, logo_url: p.logo_url, shop_photo_url: p.shop_photo_url,
    welcome_title_en: p.welcome_title_en, welcome_title_hi: p.welcome_title_hi, welcome_body_en: p.welcome_body_en,
    welcome_body_hi: p.welcome_body_hi, default_speech_lang: p.default_speech_lang, audio_retention_days: p.audio_retention_days,
  };
}

export interface FormVersion {
  id: string;
  version: number;
  config: FormConfig;
}

export interface VoiceNoteRow {
  id: string;
  property_id: string;
  response_id: string;
  question_key: string;
  storage_path: string;
  mime: string;
  status: string;
  transcript_machine: string | null;
  transcript_final: string | null;
  language: string | null;
  transcribe_attempts: number;
}

export interface NotificationRow {
  id: number;
  response_id: string;
  kind: string;
  attempts: number;
}

export interface LeadForNotify {
  id: string;
  property_name: string;
  name: string;
  phone_e164: string;
  whatsapp_ok: boolean;
  path: string;
  tier: string;
  best_match: number | null;
  intent_score: number;
  priority: number;
  best_profile_name: string | null;
  best_qualified: boolean;
  profile_matches: Array<{ name: string; match: number; qualified: boolean; matched: { text: string }[]; missed: { text: string }[]; failed_must: { text: string }[] }>;
  created_at: string;
}

export class DbError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

export interface Db {
  rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T>;
  propertyBySlug(slug: string): Promise<Property | null>;
  currentForm(propertyId: string): Promise<FormVersion | null>;
  formVersion(id: string, propertyId: string): Promise<FormVersion | null>;
  responseExists(id: string): Promise<{ id: string; property_id: string } | null>;
  insertFunnelEvents(rows: Array<Record<string, unknown>>): Promise<void>;
  leadForNotify(id: string): Promise<LeadForNotify | null>;
  heartbeat(source: string): Promise<void>;
  isAdminToken(jwt: string): Promise<boolean>;
  /** user id when the token belongs to an OWNER, else null */
  ownerFromToken(jwt: string): Promise<string | null>;
}

export interface AuthAdmin {
  /** Invite by email (sends Supabase's invite email). Returns the user id; existing users are returned, not re-invited. */
  inviteUser(email: string, redirectTo: string): Promise<{ id: string; invited: boolean }>;
}

export interface Storage {
  createSignedUploadUrl(path: string): Promise<{ signedUrl: string; token: string; path: string }>;
  download(path: string): Promise<Blob | null>;
  remove(paths: string[]): Promise<void>;
}

export interface TranscribeResult {
  text: string;
  language: string | null;
  duration: number | null;
}

export class UpstreamError extends Error {
  constructor(public status: number, message: string, public retryAfterSeconds: number | null = null) {
    super(message);
  }
  get retryable() {
    return this.status === 0 || this.status === 408 || this.status === 429 || this.status >= 500;
  }
}

export interface Speech {
  transcribe(audio: Blob, filename: string, signal: AbortSignal): Promise<TranscribeResult>;
  translateToEnglish(text: string, signal: AbortSignal): Promise<string>;
  listModels(signal: AbortSignal): Promise<string[]>;
}

export interface Messenger {
  send(html: string): Promise<void>;
}

export interface Env {
  ipSalt: string;
  cronSecret: string;
  serviceRoleKey: string;
  adminAppUrl: string;
  allowedOrigins: string[];
}

export interface Deps {
  db: Db;
  auth: AuthAdmin;
  storage: Storage;
  speech: Speech;
  messenger: Messenger;
  env: Env;
  now: () => number;
  /** keep work running after the response (EdgeRuntime.waitUntil in production) */
  waitUntil: (p: Promise<unknown>) => void;
}
