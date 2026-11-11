// Tiny fetch client for the public Edge Functions (no supabase-js in the respondent bundle).
import { DEMO_MODE, FUNCTIONS_URL, SUPABASE_ANON_KEY } from '../lib/env.ts';
import type { FormConfig, RawAnswers, VoiceMime } from '@shared/types.ts';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
  get isNetwork() {
    return this.status === 0;
  }
}

async function call<T>(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), init.timeoutMs ?? 20_000);
  let res: Response;
  try {
    res = await fetch(`${FUNCTIONS_URL}/${path}`, {
      ...init,
      signal: ctl.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(SUPABASE_ANON_KEY ? { apikey: SUPABASE_ANON_KEY } : {}),
        ...(init.headers ?? {}),
      },
    });
  } catch (e) {
    throw new ApiError(0, 'network', `Could not reach ${FUNCTIONS_URL}/${path.split('?')[0]} (${(e as Error)?.message || 'network error'})`);
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 204) return undefined as T;
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON */
  }
  if (!res.ok) throw new ApiError(res.status, body?.code ?? 'http_error', body?.message ?? `HTTP ${res.status}`, body?.details);
  return body as T;
}

export interface PublicProperty {
  slug: string;
  name: string;
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

export interface FormResponse {
  status: 'open' | 'closed';
  property: PublicProperty;
  closed_message?: string;
  form: { id: string; version: number; config: FormConfig } | null;
}

export async function getForm(slug: string): Promise<FormResponse> {
  if (DEMO_MODE) {
    const { DEMO_CONFIG, DEMO_FORM_ID, DEMO_PROPERTY } = await import('./demo.ts');
    return { status: 'open', property: DEMO_PROPERTY(slug), form: { id: DEMO_FORM_ID, version: 1, config: DEMO_CONFIG } };
  }
  const r = await call<FormResponse>(`form?slug=${encodeURIComponent(slug)}`, { method: 'GET' });
  // older server versions may still send a schema-1 config: upgrade it here as well
  if (r.form) {
    const { normalizeConfig } = await import('@shared/input-modes.ts');
    r.form = { ...r.form, config: normalizeConfig(r.form.config) };
  }
  return r;
}

export interface SubmitPayload {
  id: string;
  property_slug: string;
  form_version_id: string | null;
  waitlist?: boolean;
  answers: RawAnswers;
  lang: 'en' | 'hi';
  source: string;
  duration_seconds: number;
  website: string;
}
export async function submit(p: SubmitPayload): Promise<{ id: string; status: 'created' | 'existing' }> {
  if (DEMO_MODE) {
    console.info('[demo mode] answers NOT sent anywhere:', p);
    return { id: p.id, status: 'created' };
  }
  return call<{ id: string; status: 'created' | 'existing' }>('submit', { method: 'POST', body: JSON.stringify(p), timeoutMs: 30_000 });
}

export interface UploadUrlPayload {
  property_slug: string;
  response_id: string;
  form_version_id: string;
  question_key: string;
  mime: VoiceMime;
  bytes: number;
  duration_seconds: number;
}
export const voiceUploadUrl = (p: UploadUrlPayload) =>
  DEMO_MODE
    ? Promise.reject(new ApiError(409, 'demo', 'Voice answers need the server (demo mode). Please type instead.'))
    : call<{ path: string; signed_url: string; token: string }>('voice-upload-url', { method: 'POST', body: JSON.stringify(p) });

export const transcribeNow = (response_id: string, question_key: string) =>
  call<{ text: string; language: string | null } | { pending: true }>('transcribe-now', {
    method: 'POST',
    body: JSON.stringify({ response_id, question_key }),
    timeoutMs: 20_000,
  });

export async function uploadAudio(signedUrl: string, blob: Blob, mime: string): Promise<void> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 60_000);
  try {
    const res = await fetch(signedUrl, { method: 'PUT', body: blob, headers: { 'Content-Type': mime, 'x-upsert': 'true' }, signal: ctl.signal });
    if (!res.ok) throw new ApiError(res.status, 'upload_failed', `Upload failed (${res.status})`);
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(0, 'network', 'Upload failed');
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------- funnel tracking (batched, best effort)
type TrackEvent = { event: string; question_key?: string; ms?: number };
let queue: TrackEvent[] = [];
let ctx: { slug: string; session: string } | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

export function track(slug: string, session: string, e: TrackEvent) {
  ctx = { slug, session };
  queue.push(e);
  if (queue.length >= 20) flushTrack();
  else if (!timer) timer = setTimeout(flushTrack, 4000);
}

export function flushTrack() {
  if (timer) clearTimeout(timer);
  timer = null;
  if (DEMO_MODE) {
    queue = [];
    return;
  }
  if (!ctx || queue.length === 0) return;
  const events = queue.splice(0, 50);
  fetch(`${FUNCTIONS_URL}/track`, {
    method: 'POST',
    keepalive: true,
    headers: { 'Content-Type': 'application/json', ...(SUPABASE_ANON_KEY ? { apikey: SUPABASE_ANON_KEY } : {}) },
    body: JSON.stringify({ property_slug: ctx.slug, session_id: ctx.session, events }),
  }).catch(() => {
    /* analytics are best effort */
  });
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushTrack);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flushTrack());
}
