// In-memory fakes for handler tests.
import { DbError, type Deps, type FormVersion, type LeadForNotify, type Property, type TranscribeResult, UpstreamError } from '../_shared/server/deps.ts';
import { compileForm, type DraftQuestion } from '../_shared/compile.ts';
import type { InputModes, QuestionKind, ShowIf } from '../_shared/types.ts';
import { defaultModes } from '../_shared/input-modes.ts';

let n = 0;
const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
function modes(patch: (m: InputModes) => void): InputModes {
  const m = defaultModes();
  patch(m);
  return m;
}
function q(key: string, kind: QuestionKind, input_modes: InputModes | null, extra: Partial<DraftQuestion> = {}, opts: string[] = []): DraftQuestion {
  return {
    id: id(), key, kind, input_modes, label_en: key, label_hi: null, help_en: null, help_hi: null, required: true,
    position: 0, show_if: null, validation: null, archived_at: null, first_published_at: null,
    ...extra,
    options: opts.map((v, i) => ({ id: id(), value: v, label_en: v, label_hi: null, position: i, archived_at: null, first_published_at: null })),
  };
}
const rentOnly: ShowIf = { all: [{ q: 'path', op: 'eq', v: 'rent' }] };
export const CONFIG = compileForm(
  [
    q('path', 'standard', defaultModes(), {}, ['rent', 'partner', 'either']),
    q('budget', 'standard', modes((m) => { m.primary = 'type'; m.choose.enabled = false; m.type = { ...m.type, enabled: true, format: 'currency', max_chars: 15 }; }), { show_if: rentOnly }),
    q('about', 'standard', modes((m) => { m.primary = 'speak'; m.choose.enabled = false; m.speak.enabled = true; m.speak.max_seconds = 60; m.type = { ...m.type, enabled: true, multiline: true, max_chars: 50 }; }), { required: false }),
    q('nick', 'standard', modes((m) => { m.primary = 'type'; m.choose.enabled = false; m.type.enabled = true; m.speak = { ...m.speak, enabled: true, keep_audio: false }; }), { required: false }),
    q('contact', 'contact', null),
  ].map((x, i) => ({ ...x, position: i })),
);

export const PROPERTY: Property = {
  id: 'p1', slug: 'shop', name: 'Shop', status: 'open', closed_message: 'Closed', default_lang: 'en', brand_name: 'Bajaj Computers',
  contact_phone: '+919876500000', contact_whatsapp: '+919876500000', address_line: 'Main Road', logo_url: null, shop_photo_url: null,
  welcome_title_en: 'A shop is available', welcome_title_hi: null, welcome_body_en: null, welcome_body_hi: null,
  default_speech_lang: 'hi-IN', audio_retention_days: 180,
};
export const FORM: FormVersion = { id: '11111111-1111-4111-8111-111111111111', version: 3, config: CONFIG };

export interface Calls {
  rpc: Array<{ fn: string; args: Record<string, unknown> }>;
  funnel: Array<Record<string, unknown>>;
  sent: string[];
  removed: string[];
  waited: Promise<unknown>[];
  heartbeats: string[];
}

export function fakeDeps(over: {
  property?: Property | null;
  rpc?: Record<string, (args: Record<string, unknown>) => unknown>;
  rateOk?: boolean;
  existing?: boolean;
  audio?: Blob | null;
  transcribe?: (signal: AbortSignal) => Promise<TranscribeResult>;
  translate?: (text: string) => Promise<string>;
  send?: (html: string) => Promise<void>;
  admin?: boolean;
  owner?: string | null;
  invite?: (email: string) => Promise<{ id: string; invited: boolean }>;
  now?: () => number;
} = {}) {
  const calls: Calls = { rpc: [], funnel: [], sent: [], removed: [], waited: [], heartbeats: [] };
  const lead: LeadForNotify = {
    id: 'r1', property_name: 'Shop', name: 'Ramesh <b>', phone_e164: '+919876543210', whatsapp_ok: true, path: 'rent', tier: 'ideal',
    best_match: 100, intent_score: 60, priority: 88, best_profile_name: 'Retailer', best_qualified: true, created_at: '',
    profile_matches: [{ name: 'Retailer', match: 100, qualified: true, matched: [{ text: 'Budget ≥ ₹40,000 — answered ₹45,000' }], missed: [], failed_must: [] }],
  };
  const deps: Deps = {
    db: {
      async rpc<T>(fn: string, args: Record<string, unknown> = {}) {
        calls.rpc.push({ fn, args });
        if (fn === 'rate_limit_hit') return (over.rateOk ?? true) as T;
        const h = over.rpc?.[fn];
        if (!h) throw new Error(`unexpected rpc ${fn}`);
        return (await h(args)) as T;
      },
      propertyBySlug: async (slug) => (over.property === undefined ? (slug === 'shop' ? PROPERTY : null) : over.property),
      currentForm: async () => FORM,
      formVersion: async (fid) => (fid === FORM.id ? FORM : null),
      responseExists: async (rid) => (over.existing ? { id: rid, property_id: 'p1' } : null),
      insertFunnelEvents: async (rows) => void calls.funnel.push(...rows),
      leadForNotify: async () => lead,
      heartbeat: async (s) => void calls.heartbeats.push(s),
      isAdminToken: async () => over.admin ?? false,
      ownerFromToken: async () => over.owner ?? null,
    },
    auth: { inviteUser: async (email) => (over.invite ? over.invite(email) : { id: 'u-new', invited: true }) },
    storage: {
      createSignedUploadUrl: async (path) => ({ signedUrl: `https://x/upload/${path}?token=t`, token: 't', path }),
      download: async () => (over.audio === undefined ? new Blob(['abc'], { type: 'audio/webm' }) : over.audio),
      remove: async (paths) => void calls.removed.push(...paths),
    },
    speech: {
      transcribe: async (_a, _f, signal) => (over.transcribe ? over.transcribe(signal) : { text: 'namaste', language: 'hindi', duration: 3 }),
      translateToEnglish: async (t) => (over.translate ? over.translate(t) : `EN:${t}`),
      listModels: async () => ['whisper-large-v3', 'llama-3.1-8b-instant'],
    },
    messenger: { send: async (h) => (over.send ? over.send(h) : void calls.sent.push(h)) },
    env: { ipSalt: 'salt', cronSecret: 'cron-secret-0123456789', serviceRoleKey: 'service-key', adminAppUrl: 'https://app.example', allowedOrigins: [] },
    now: over.now ?? (() => Date.now()),
    waitUntil: (p) => void calls.waited.push(p),
  };
  return { deps, calls };
}

export function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`https://fn.example/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4', ...headers },
    body: JSON.stringify(body),
  });
}

export { DbError, UpstreamError };
