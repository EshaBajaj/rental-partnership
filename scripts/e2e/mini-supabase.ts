// Test-only stand-in for the parts of Supabase the admin app uses: GoTrue password login,
// PostgREST (the subset of query syntax supabase-js emits for this app) and Storage signed URLs.
// Every REST request runs inside a transaction as role `authenticated` with the caller's JWT
// claims, so the real RLS policies, column grants, triggers and RPCs are exercised.
// NOT for production: tokens are unsigned.
import type postgres from 'npm:postgres@3.4.7';

type Sql = ReturnType<typeof postgres>;
const IDENT = /^[a-z_][a-z0-9_]*$/;
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

function b64url(s: string) {
  return btoa(s).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function makeJwt(claims: Record<string, unknown>) {
  return `${b64url(JSON.stringify({ alg: 'none', typ: 'JWT' }))}.${b64url(JSON.stringify(claims))}.local`;
}
function readJwt(req: Request): Record<string, unknown> | null {
  const h = req.headers.get('authorization') ?? '';
  const tok = h.replace(/^Bearer\s+/i, '');
  const parts = tok.split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return null;
  }
}
function ident(s: string): string {
  if (!IDENT.test(s)) throw new RestError(400, 'PGRST100', `bad identifier ${s}`);
  return s;
}
class RestError extends Error {
  constructor(public status: number, public code: string, message: string, public details: string | null = null, public hint: string | null = null) {
    super(message);
  }
}

// ---------------------------------------------------------------- auth
async function session(sql: Sql, email: string) {
  const [u] = await sql`select id, email, created_at from auth.users where lower(email) = lower(${email})`;
  if (!u) return null;
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const user = { id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, app_metadata: { provider: 'email' }, user_metadata: {}, created_at: u.created_at };
  return {
    access_token: makeJwt({ sub: u.id, email: u.email, role: 'authenticated', aud: 'authenticated', exp }),
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: exp,
    refresh_token: `refresh-${u.email}`,
    user,
  };
}

async function handleAuth(req: Request, sql: Sql, path: string): Promise<Response> {
  if (path === 'token') {
    const url = new URL(req.url);
    const body = await req.json().catch(() => ({}));
    const email = url.searchParams.get('grant_type') === 'refresh_token' ? String(body.refresh_token ?? '').replace(/^refresh-/, '') : String(body.email ?? '');
    if (url.searchParams.get('grant_type') === 'password' && body.password !== 'e2e-password') {
      return json({ error: 'invalid_grant', error_description: 'Invalid login credentials', code: 'invalid_credentials', msg: 'Invalid login credentials' }, 400);
    }
    const s = await session(sql, email);
    return s ? json(s) : json({ error: 'invalid_grant', error_description: 'Invalid login credentials', code: 'invalid_credentials', msg: 'Invalid login credentials' }, 400);
  }
  if (path === 'user') {
    const c = readJwt(req);
    const s = c ? await session(sql, String(c.email)) : null;
    return s ? json(s.user) : json({ code: 401, msg: 'invalid JWT' }, 401);
  }
  if (path === 'logout') return new Response(null, { status: 204 });
  if (path === 'recover') return json({});
  return json({ msg: `auth ${path} not supported in tests` }, 404);
}

// ---------------------------------------------------------------- PostgREST subset
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  let q = false;
  for (const ch of s) {
    if (ch === '"') q = !q;
    if (!q && ch === '(') depth++;
    if (!q && ch === ')') depth--;
    if (!q && ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

function colExpr(c: string, alias = 't'): string {
  // json path: a->>b / a->b
  const m = c.match(/^([a-z_][a-z0-9_]*)(->>?)([a-z_][a-z0-9_]*)$/);
  if (m) return `${alias}.${ident(m[1])}${m[2]}'${m[3]}'`;
  return `${alias}.${ident(c)}`;
}

function parseList(v: string): string[] {
  return splitTop(v.replace(/^\(/, '').replace(/\)$/, '')).map((x) => x.replace(/^"|"$/g, ''));
}

function condition(col: string, opval: string, params: unknown[]): string {
  let neg = false;
  let rest = opval;
  if (rest.startsWith('not.')) {
    neg = true;
    rest = rest.slice(4);
  }
  const dot = rest.indexOf('.');
  const op = rest.slice(0, dot);
  const val = rest.slice(dot + 1);
  const c = colExpr(col);
  const p = (x: unknown) => {
    params.push(x);
    return `$${params.length}`;
  };
  let sqlc: string;
  switch (op) {
    case 'eq': sqlc = `${c} = ${p(val)}`; break;
    case 'neq': sqlc = `${c} <> ${p(val)}`; break;
    case 'gt': sqlc = `${c} > ${p(val)}`; break;
    case 'gte': sqlc = `${c} >= ${p(val)}`; break;
    case 'lt': sqlc = `${c} < ${p(val)}`; break;
    case 'lte': sqlc = `${c} <= ${p(val)}`; break;
    case 'like': sqlc = `${c}::text like ${p(val.replace(/\*/g, '%'))}`; break;
    case 'ilike': sqlc = `${c}::text ilike ${p(val.replace(/\*/g, '%'))}`; break;
    case 'is': sqlc = `${c} is ${val === 'null' ? 'null' : val === 'true' ? 'true' : val === 'false' ? 'false' : 'unknown'}`; break;
    case 'in': sqlc = `${c}::text = any(${p(parseList(val))}::text[])`; break;
    default: throw new RestError(400, 'PGRST100', `operator ${op} not supported in tests`);
  }
  return neg ? `not (${sqlc})` : sqlc;
}

const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns']);

function whereClause(url: URL, params: unknown[]): string {
  const parts: string[] = [];
  for (const [k, v] of url.searchParams) {
    if (RESERVED.has(k)) continue;
    if (k === 'or' || k === 'and') {
      const items = splitTop(v.replace(/^\(/, '').replace(/\)$/, '')).map((it) => {
        const d = it.indexOf('.');
        return condition(it.slice(0, d), it.slice(d + 1), params);
      });
      parts.push(`(${items.join(k === 'or' ? ' or ' : ' and ')})`);
    } else parts.push(condition(k, v, params));
  }
  return parts.length ? `where ${parts.join(' and ')}` : '';
}

async function fkBetween(sql: Sql, a: string, b: string): Promise<{ child: string; col: string; parentCol: string } | null> {
  const rows = await sql`
    select cl.relname as child, att.attname as col, patt.attname as parent_col, pcl.relname as parent
    from pg_constraint con
    join pg_class cl on cl.oid = con.conrelid join pg_class pcl on pcl.oid = con.confrelid
    join pg_attribute att on att.attrelid = con.conrelid and att.attnum = con.conkey[1]
    join pg_attribute patt on patt.attrelid = con.confrelid and patt.attnum = con.confkey[1]
    where con.contype = 'f' and ((cl.relname = ${a} and pcl.relname = ${b}) or (cl.relname = ${b} and pcl.relname = ${a}))
      and cl.relnamespace = 'public'::regnamespace and pcl.relnamespace = 'public'::regnamespace
    limit 1`;
  return rows[0] ? { child: rows[0].child, col: rows[0].col, parentCol: rows[0].parent_col } : null;
}

async function selectList(sql: Sql, table: string, select: string): Promise<string> {
  const items = splitTop(select || '*');
  const out: string[] = [];
  for (const it of items) {
    const m = it.match(/^([a-z_][a-z0-9_]*)\((.*)\)$/);
    if (!m) {
      out.push(it === '*' ? 't.*' : colExpr(it));
      continue;
    }
    const rel = ident(m[1]);
    const inner = m[2] === '*' || m[2] === '' ? 'e.*' : splitTop(m[2]).map((c) => colExpr(c, 'e')).join(', ');
    const fk = await fkBetween(sql, table, rel);
    if (!fk) throw new RestError(400, 'PGRST200', `no relationship between ${table} and ${rel}`);
    if (fk.child === rel) {
      out.push(`coalesce((select json_agg(x) from (select ${inner} from public.${rel} e where e.${fk.col} = t.${fk.parentCol}) x), '[]'::json) as ${rel}`);
    } else {
      out.push(`(select to_json(x) from (select ${inner} from public.${rel} e where e.${fk.parentCol} = t.${fk.col}) x) as ${rel}`);
    }
  }
  return out.join(', ');
}

function orderClause(url: URL): string {
  const o = url.searchParams.get('order');
  if (!o) return '';
  return `order by ${splitTop(o)
    .map((part) => {
      const [col, ...mods] = part.split('.');
      return `${colExpr(col)} ${mods.includes('desc') ? 'desc' : 'asc'}${mods.includes('nullsfirst') ? ' nulls first' : mods.includes('nullslast') ? ' nulls last' : ''}`;
    })
    .join(', ')}`;
}

async function asUser<T>(sql: Sql, claims: Record<string, unknown> | null, fn: (tx: Sql) => Promise<T>): Promise<T> {
  return (await sql.begin(async (tx) => {
    const role = claims?.role === 'authenticated' ? 'authenticated' : 'anon';
    await tx.unsafe(`set local role ${role}`);
    await tx`select set_config('request.jwt.claims', ${claims ? JSON.stringify(claims) : ''}, true), set_config('request.jwt.claim.sub', ${String(claims?.sub ?? '')}, true)`;
    return await fn(tx as unknown as Sql);
  })) as T;
}

function pgError(e: unknown): RestError {
  if (e instanceof RestError) return e;
  const err = e as { code?: string; message?: string; detail?: string; hint?: string };
  const status = err.code === '42501' ? 403 : err.code === '23505' ? 409 : err.code === 'P0001' ? 400 : 400;
  return new RestError(status, err.code ?? 'XX000', err.message ?? String(e), err.detail ?? null, err.hint ?? null);
}

async function handleRest(req: Request, sql: Sql, path: string): Promise<Response> {
  const url = new URL(req.url);
  const claims = readJwt(req);
  const prefer = req.headers.get('prefer') ?? '';
  const wantsObject = (req.headers.get('accept') ?? '').includes('vnd.pgrst.object');
  try {
    // RPC
    if (path.startsWith('rpc/')) {
      const fn = ident(path.slice(4));
      const args = req.method === 'GET' ? Object.fromEntries(url.searchParams) : await req.json().catch(() => ({}));
      const [meta] = await sql`select p.proretset as setof, p.proargnames as names, array(select format_type(t, null) from unnest(p.proargtypes) t) as types
                               from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = ${fn} order by p.pronargs desc limit 1`;
      if (!meta) throw new RestError(404, 'PGRST202', `function ${fn} not found`);
      const params: unknown[] = [];
      const named = Object.entries(args).map(([k, v]) => {
        const i = (meta.names ?? []).indexOf(k);
        const ty = meta.types[i] ?? 'text';
        params.push(v === null || v === undefined ? null : ty === 'jsonb' || ty === 'json' ? v : Array.isArray(v) ? v : String(v));
        return `${ident(k)} => $${params.length}::${ty}`;
      });
      const q = meta.setof
        ? `select coalesce(json_agg(r), '[]'::json) as out from public.${fn}(${named.join(', ')}) r`
        : `select to_json(public.${fn}(${named.join(', ')})) as out`;
      const rows = await asUser(sql, claims, (tx) => tx.unsafe(q, params as never[]));
      return json(rows[0].out);
    }

    const table = ident(path);
    const params: unknown[] = [];
    const where = whereClause(url, params);
    const sel = await selectList(sql, table, url.searchParams.get('select') ?? '*');
    const returning = prefer.includes('return=representation');
    let rows: unknown[];
    let total: number | null = null;

    if (req.method === 'GET' || req.method === 'HEAD') {
      const limit = url.searchParams.get('limit');
      const offset = url.searchParams.get('offset');
      const q = `select coalesce(json_agg(r), '[]'::json) as out from (select ${sel} from public.${table} t ${where} ${orderClause(url)}
                 ${limit ? `limit ${Number(limit)}` : ''} ${offset ? `offset ${Number(offset)}` : ''}) r`;
      rows = (await asUser(sql, claims, (tx) => tx.unsafe(q, params as never[])))[0].out;
      if (prefer.includes('count=exact')) {
        total = Number((await asUser(sql, claims, (tx) => tx.unsafe(`select count(*) as n from public.${table} t ${where}`, params as never[])))[0].n);
      }
    } else if (req.method === 'POST') {
      const body = await req.json();
      const list = Array.isArray(body) ? body : [body];
      const cols = [...new Set(list.flatMap((o: Record<string, unknown>) => Object.keys(o)))].map(ident);
      params.push(list);
      const q = `with ins as (insert into public.${table} (${cols.join(', ')})
                   select ${cols.join(', ')} from json_populate_recordset(null::public.${table}, $${params.length}::json) returning *)
                 select coalesce(json_agg(r), '[]'::json) as out from (select ${sel} from ins t) r`;
      rows = (await asUser(sql, claims, (tx) => tx.unsafe(q, params as never[])))[0].out;
    } else if (req.method === 'PATCH') {
      const body = await req.json();
      const cols = Object.keys(body).map(ident);
      params.push(body);
      const pi = params.length;
      const q = `with upd as (update public.${table} t set ${cols.map((c) => `${c} = (json_populate_record(null::public.${table}, $${pi}::json)).${c}`).join(', ')} ${where} returning t.*)
                 select coalesce(json_agg(r), '[]'::json) as out from (select ${sel} from upd t) r`;
      rows = (await asUser(sql, claims, (tx) => tx.unsafe(q, params as never[])))[0].out;
    } else if (req.method === 'DELETE') {
      const q = `with del as (delete from public.${table} t ${where} returning t.*)
                 select coalesce(json_agg(r), '[]'::json) as out from (select ${sel} from del t) r`;
      rows = (await asUser(sql, claims, (tx) => tx.unsafe(q, params as never[])))[0].out;
    } else {
      throw new RestError(405, 'PGRST000', 'method not allowed');
    }

    const headers: Record<string, string> = {};
    if (total !== null) headers['content-range'] = `0-${Math.max(rows.length - 1, 0)}/${total}`;
    if (req.method !== 'GET' && !returning && !wantsObject) return new Response(null, { status: req.method === 'POST' ? 201 : 204, headers });
    if (wantsObject) {
      if (rows.length !== 1) {
        return json({ code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `The result contains ${rows.length} rows`, hint: null }, 406);
      }
      return json(rows[0], req.method === 'POST' ? 201 : 200, headers);
    }
    return json(rows, req.method === 'POST' ? 201 : 200, headers);
  } catch (e) {
    const err = pgError(e);
    return json({ code: err.code, message: err.message, details: err.details, hint: err.hint }, err.status);
  }
}

// ---------------------------------------------------------------- storage (signed URLs for admins)
async function handleStorage(req: Request, sql: Sql, path: string, store: string, base: string): Promise<Response> {
  const m = path.match(/^object\/sign\/([a-z0-9-]+)\/(.+)$/);
  if (!m) return json({ message: 'not supported' }, 404);
  const [, bucket, objPath] = m;
  if (req.method === 'POST') {
    // only admins may sign (mirrors the storage.objects select policy)
    const claims = readJwt(req);
    const ok = await asUser(sql, claims, (tx) => tx`select public.is_admin() as ok`);
    if (!ok[0].ok) return json({ statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' }, 403);
    return json({ signedURL: `/object/sign/${bucket}/${objPath}?token=local` });
  }
  try {
    const data = await Deno.readFile(`${store}/${decodeURIComponent(objPath)}`);
    return new Response(data, { headers: { 'content-type': 'audio/webm' } });
  } catch {
    return json({ message: 'Object not found' }, 404);
  }
  void base;
}

export async function handleSupabase(req: Request, sql: Sql, store: string, base: string): Promise<Response | null> {
  const url = new URL(req.url);
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, PUT, OPTIONS, HEAD',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Expose-Headers': 'content-range',
  };
  let res: Response | null = null;
  const route = url.pathname.match(/^\/(auth|rest|storage)\/v1\/(.*)$/);
  if (!route) return null;
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (route[1] === 'auth') res = await handleAuth(req, sql, route[2]);
  if (route[1] === 'rest') res = await handleRest(req, sql, route[2]);
  if (route[1] === 'storage') res = await handleStorage(req, sql, route[2], store, base);
  for (const [k, v] of Object.entries(cors)) res!.headers.set(k, v);
  return res;
}
