// Production wiring: Supabase service client, Groq, Telegram.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { type AuthAdmin, type Db, DbError, type Deps, type Env, type FormVersion, type LeadForNotify, type Property, type Storage } from './deps.ts';
import { createGroq, DEFAULT_TRANSLATE_MODELS } from './groq.ts';
import { createTelegram } from './telegram.ts';

const BUCKET = 'voice-notes';

function must<T>(r: { data: T; error: { message: string; code?: string } | null }): T {
  if (r.error) throw new DbError(r.error.code ?? 'db', r.error.message);
  return r.data;
}

export function createDb(sb: SupabaseClient): Db {
  return {
    async rpc<T>(fn: string, args: Record<string, unknown> = {}) {
      const r = await sb.rpc(fn, args);
      if (r.error) throw new DbError(r.error.code ?? 'db', r.error.message);
      return r.data as T;
    },
    async propertyBySlug(slug) {
      return must(await sb.from('properties').select('id, slug, name, status, closed_message, default_lang, brand_name, contact_phone, contact_whatsapp, address_line, logo_url, shop_photo_url, welcome_title_en, welcome_title_hi, welcome_body_en, welcome_body_hi, default_speech_lang, audio_retention_days').eq('slug', slug).maybeSingle()) as Property | null;
    },
    async currentForm(propertyId) {
      return must(await sb.from('form_versions').select('id, version, config').eq('property_id', propertyId).eq('is_current', true).maybeSingle()) as FormVersion | null;
    },
    async formVersion(id, propertyId) {
      return must(await sb.from('form_versions').select('id, version, config').eq('id', id).eq('property_id', propertyId).maybeSingle()) as FormVersion | null;
    },
    async responseExists(id) {
      return must(await sb.from('responses').select('id, property_id').eq('id', id).maybeSingle());
    },
    async insertFunnelEvents(rows) {
      must(await sb.from('funnel_events').insert(rows));
    },
    async leadForNotify(id) {
      const r = must(
        await sb
          .from('responses')
          .select('id, name, phone_e164, whatsapp_ok, path, tier, best_match, intent_score, priority, profile_matches, match_detail, created_at, properties(name)')
          .eq('id', id)
          .maybeSingle(),
      ) as Record<string, any> | null;
      if (!r) return null;
      return {
        id: r.id,
        property_name: r.properties?.name ?? '',
        name: r.name,
        phone_e164: r.phone_e164,
        whatsapp_ok: r.whatsapp_ok,
        path: r.path,
        tier: r.tier,
        best_match: r.best_match === null ? null : Number(r.best_match),
        intent_score: r.intent_score,
        priority: Number(r.priority),
        best_profile_name: r.match_detail?.best_profile_name ?? null,
        best_qualified: !!r.match_detail?.best_qualified,
        profile_matches: r.profile_matches ?? [],
        created_at: r.created_at,
      } satisfies LeadForNotify;
    },
    async heartbeat(source) {
      must(await sb.from('heartbeat').insert({ source }));
    },
    async ownerFromToken(jwt) {
      const u = await sb.auth.getUser(jwt);
      if (u.error || !u.data.user) return null;
      const r = await sb.rpc('sls_is_owner_uid', { p_uid: u.data.user.id });
      return r.data === true ? u.data.user.id : null;
    },
    async isAdminToken(jwt) {
      const u = await sb.auth.getUser(jwt);
      if (u.error || !u.data.user) return false;
      const a = await sb.from('admins').select('user_id').eq('user_id', u.data.user.id).maybeSingle();
      return !!a.data;
    },
  };
}

export function createStorage(sb: SupabaseClient): Storage {
  const bucket = () => sb.storage.from(BUCKET);
  return {
    async createSignedUploadUrl(path) {
      const r = await bucket().createSignedUploadUrl(path, { upsert: true });
      if (r.error) throw new DbError('storage', r.error.message);
      return r.data;
    },
    async download(path) {
      const r = await bucket().download(path);
      if (r.error) {
        if (/not.?found|404|Object not found/i.test(r.error.message)) return null;
        throw new DbError('storage', r.error.message);
      }
      return r.data;
    },
    async remove(paths) {
      if (!paths.length) return;
      const r = await bucket().remove(paths);
      if (r.error) throw new DbError('storage', r.error.message);
    },
  };
}

export function createAuthAdmin(sb: SupabaseClient): AuthAdmin {
  return {
    async inviteUser(email, redirectTo) {
      const existing = await sb.rpc('sls_user_id_by_email', { p_email: email });
      if (existing.error) throw new DbError('db', existing.error.message);
      if (existing.data) return { id: existing.data as string, invited: false };
      const r = await sb.auth.admin.inviteUserByEmail(email, { redirectTo });
      if (r.error || !r.data.user) throw new DbError('auth', r.error?.message ?? 'Invite failed');
      return { id: r.data.user.id, invited: true };
    },
  };
}

export function readEnv(): Env {
  const get = (k: string) => Deno.env.get(k) ?? '';
  return {
    ipSalt: get('IP_SALT'),
    cronSecret: get('CRON_SECRET'),
    serviceRoleKey: get('SUPABASE_SERVICE_ROLE_KEY'),
    adminAppUrl: get('ADMIN_APP_URL').replace(/\/$/, ''),
    allowedOrigins: get('ALLOWED_ORIGINS').split(',').map((s) => s.trim()).filter(Boolean),
  };
}

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

export function realDeps(): Deps {
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const models = (Deno.env.get('GROQ_TRANSLATE_MODELS') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return {
    db: createDb(sb),
    auth: createAuthAdmin(sb),
    storage: createStorage(sb),
    speech: createGroq(Deno.env.get('GROQ_API_KEY') ?? '', models.length ? models : DEFAULT_TRANSLATE_MODELS),
    messenger: createTelegram(Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '', Deno.env.get('TELEGRAM_CHAT_ID') ?? ''),
    env: readEnv(),
    now: () => Date.now(),
    waitUntil: (p) => {
      const guarded = p.catch((e) => console.error('background task failed', e));
      if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(guarded);
    },
  };
}
