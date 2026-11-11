// Local stand-in for the Supabase runtime: serves the REAL Edge Function handlers on
// http://localhost:$PORT/functions/v1/<name>, backed by a real Postgres (migrations applied),
// a local-disk "storage" and fake Groq/Telegram. Used by the end-to-end test (scripts/e2e.sh).
import postgres from 'npm:postgres@3.4.7';
import { type Db, DbError, type Deps, type Storage } from '../../supabase/functions/_shared/server/deps.ts';
import { makeHandler as form } from '../../supabase/functions/form/handler.ts';
import { makeHandler as track } from '../../supabase/functions/track/handler.ts';
import { makeHandler as submit } from '../../supabase/functions/submit/handler.ts';
import { makeHandler as voiceUpload } from '../../supabase/functions/voice-upload-url/handler.ts';
import { makeHandler as transcribeNow } from '../../supabase/functions/transcribe-now/handler.ts';
import { makeHandler as worker } from '../../supabase/functions/transcribe-worker/handler.ts';
import { makeHandler as notify } from '../../supabase/functions/notify/handler.ts';
import { makeHandler as health } from '../../supabase/functions/health/handler.ts';
import { makeHandler as adminInvite } from '../../supabase/functions/admin-invite/handler.ts';
import { handleSupabase } from './mini-supabase.ts';

const PORT = Number(Deno.env.get('PORT') ?? 54400);
const sql = postgres(Deno.env.get('DATABASE_URL')!, { max: 5, onnotice: () => {} });
const STORE = Deno.env.get('STORE_DIR') ?? (await Deno.makeTempDir());
const sent: string[] = [];
// test control: POST /__whisper {text, delayMs}
const whisperCfg = { text: 'Main kirana dukaan kholna chahta hoon', delayMs: 300 };

const sigCache = new Map<string, { names: string[]; types: string[]; setof: boolean }>();
async function sig(fn: string) {
  if (!sigCache.has(fn)) {
    const [r] = await sql`select p.proargnames as names, array(select format_type(t, null) from unnest(p.proargtypes) t) as types, p.proretset as setof
                          from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = ${fn}`;
    if (!r) throw new DbError('42883', `function ${fn} not found`);
    sigCache.set(fn, { names: r.names ?? [], types: r.types, setof: r.setof });
  }
  return sigCache.get(fn)!;
}

const db: Db = {
  async rpc<T>(fn: string, args: Record<string, unknown> = {}) {
    const s = await sig(fn);
    const parts: string[] = [];
    const vals: unknown[] = [];
    for (const [k, v] of Object.entries(args)) {
      const i = s.names.indexOf(k);
      const ty = s.types[i] ?? 'text';
      vals.push(v === null || v === undefined ? null : ty === 'jsonb' ? sql.json(v as never) : Array.isArray(v) ? v : String(v));
      parts.push(`${k} => $${vals.length}::${ty}`);
    }
    try {
      if (s.setof) return (await sql.unsafe(`select * from public.${fn}(${parts.join(', ')})`, vals as never[])) as unknown as T;
      const [r] = await sql.unsafe(`select public.${fn}(${parts.join(', ')}) as r`, vals as never[]);
      return r.r as T;
    } catch (e) {
      throw new DbError((e as { code?: string }).code ?? 'db', (e as Error).message);
    }
  },
  async propertyBySlug(slug) {
    const [r] = await sql`select * from public.properties where slug = ${slug}`;
    return (r as never) ?? null;
  },
  async currentForm(pid) {
    const [r] = await sql`select id, version, config from public.form_versions where property_id = ${pid} and is_current`;
    return (r as never) ?? null;
  },
  async formVersion(id, pid) {
    const [r] = await sql`select id, version, config from public.form_versions where id = ${id} and property_id = ${pid}`;
    return (r as never) ?? null;
  },
  async responseExists(id) {
    const [r] = await sql`select id, property_id from public.responses where id = ${id}`;
    return (r as never) ?? null;
  },
  async insertFunnelEvents(rows) {
    await sql`insert into public.funnel_events (property_id, session_id, event, question_key, ms, ip_hash)
              select property_id, session_id, event, question_key, ms, ip_hash
              from json_populate_recordset(null::public.funnel_events, ${sql.json(rows as never)}::json)`;
  },
  async leadForNotify(id) {
    const [r] = await sql`select r.*, p.name as property_name from public.responses r join public.properties p on p.id = r.property_id where r.id = ${id}`;
    if (!r) return null;
    return {
      id: r.id, property_name: r.property_name, name: r.name, phone_e164: r.phone_e164, whatsapp_ok: r.whatsapp_ok, path: r.path,
      tier: r.tier, best_match: r.best_match === null ? null : Number(r.best_match), intent_score: r.intent_score,
      priority: Number(r.priority), best_profile_name: r.match_detail?.best_profile_name ?? null,
      best_qualified: !!r.match_detail?.best_qualified, profile_matches: r.profile_matches, created_at: String(r.created_at),
    };
  },
  async heartbeat(source) {
    await sql`insert into public.heartbeat (source) values (${source})`;
  },
  async isAdminToken() {
    return false;
  },
  async ownerFromToken(jwt) {
    // test tokens are unsigned JWTs issued by mini-supabase.ts
    try {
      const sub = JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).sub;
      const [r] = await sql`select user_id from public.admins where user_id = ${sub} and role = 'owner'`;
      return r ? String(r.user_id) : null;
    } catch {
      return null;
    }
  },
};

const invited: string[] = [];

async function deleteFile(p: string) {
  try {
    await Deno.remove(`${STORE}/${p}`);
  } catch {
    // already gone
  }
}

const storage: Storage = {
  async createSignedUploadUrl(path) {
    return { signedUrl: `http://localhost:${PORT}/storage/upload/${path}?token=local`, token: 'local', path };
  },
  async download(path) {
    try {
      return new Blob([await Deno.readFile(`${STORE}/${path}`)]);
    } catch {
      return null;
    }
  },
  async remove(paths) {
    for (const p of paths) await deleteFile(p);
  },
};

const deps: Deps = {
  db,
  auth: {
    async inviteUser(email) {
      const [u] = await sql`insert into auth.users (email) values (${email}) on conflict (email) do update set email = excluded.email returning id, (xmax = 0) as inserted`;
      invited.push(email);
      return { id: String(u.id), invited: !!u.inserted };
    },
  },
  storage,
  speech: {
    transcribe: async () => {
      await new Promise((r) => setTimeout(r, whisperCfg.delayMs));
      return { text: whisperCfg.text, language: 'hindi', duration: 3 };
    },
    translateToEnglish: async (t) => `EN: ${t}`,
    listModels: async () => ['whisper-large-v3', 'llama-3.1-8b-instant'],
  },
  messenger: { send: async (h) => void sent.push(h) },
  env: { ipSalt: 'e2e-salt', cronSecret: 'e2e-cron-secret-123456', serviceRoleKey: '', adminAppUrl: 'http://localhost:4173', allowedOrigins: [] },
  now: () => Date.now(),
  waitUntil: (p) => void p.catch((e) => console.error('bg', e)),
};

const handlers: Record<string, (r: Request) => Promise<Response>> = {
  form: form(deps),
  track: track(deps),
  submit: submit(deps),
  'voice-upload-url': voiceUpload(deps),
  'transcribe-now': transcribeNow(deps),
  'transcribe-worker': worker(deps),
  notify: notify(deps),
  health: health(deps),
  'admin-invite': adminInvite(deps),
};

Deno.serve({ port: PORT, onListen: () => console.log(`local functions on :${PORT}`) }, async (req) => {
  const url = new URL(req.url);
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS', 'Access-Control-Allow-Headers': '*' };
  if (url.pathname.startsWith('/storage/upload/')) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    const path = decodeURIComponent(url.pathname.slice('/storage/upload/'.length));
    const full = `${STORE}/${path}`;
    await Deno.mkdir(full.slice(0, full.lastIndexOf('/')), { recursive: true });
    await Deno.writeFile(full, new Uint8Array(await req.arrayBuffer()));
    return new Response('{"Key":"ok"}', { headers: { ...cors, 'content-type': 'application/json' } });
  }
  if (url.pathname === '/__sent') return Response.json(sent, { headers: cors });
  if (url.pathname === '/__whisper' && req.method === 'POST') {
    Object.assign(whisperCfg, await req.json());
    return Response.json(whisperCfg, { headers: cors });
  }
  if (url.pathname === '/__invited') return Response.json(invited, { headers: cors });
  const sb = await handleSupabase(req, sql, STORE, `http://localhost:${PORT}`);
  if (sb) return sb;
  const name = url.pathname.replace(/^\/functions\/v1\//, '');
  const h = handlers[name];
  if (!h) return new Response('not found', { status: 404 });
  return h(req);
});
