// HTTP helpers shared by all Edge Functions: CORS, JSON, typed errors.
import type { ApiError } from '../types.ts';
import type { output, ZodError, ZodTypeAny } from 'zod';

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown, public headers: Record<string, string> = {}) {
    super(message);
  }
}

export function corsHeaders(req: Request, allowed: string[]): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  const allow = allowed.length === 0 || allowed.includes('*') ? '*' : allowed.includes(origin) ? origin : allowed[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

export function errorBody(code: string, message: string, details?: unknown): ApiError {
  return details === undefined ? { code, message } : { code, message, details };
}

export async function readJson<S extends ZodTypeAny>(req: Request, schema: S): Promise<output<S>> {
  let raw: unknown;
  try {
    const text = await req.text();
    if (text.length > 256 * 1024) throw new HttpError(413, 'too_large', 'Request body is too large.');
    raw = text ? JSON.parse(text) : {};
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, 'bad_json', 'Request body must be JSON.');
  }
  const r = schema.safeParse(raw);
  if (!r.success) throw new HttpError(400, 'bad_request', 'Some fields are missing or invalid.', flatten(r.error));
  return r.data;
}

function flatten(e: ZodError) {
  return e.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
}

export type Handler = (req: Request) => Promise<Response>;

/** Wrap a handler with CORS, method checks and uniform {code,message} errors. */
export function serve(methods: string[], allowedOrigins: string[], fn: Handler): Handler {
  return async (req) => {
    const cors = corsHeaders(req, allowedOrigins);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    try {
      if (!methods.includes(req.method)) throw new HttpError(405, 'method_not_allowed', `Use ${methods.join(' or ')}.`);
      const res = await fn(req);
      for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
      return res;
    } catch (e) {
      if (e instanceof HttpError) return json(errorBody(e.code, e.message, e.details), e.status, { ...cors, ...e.headers });
      console.error('unhandled', e);
      return json(errorBody('internal', 'Something went wrong. Please try again.'), 500, cors);
    }
  };
}

export function clientIp(req: Request): string {
  return (
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-real-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  );
}

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time string comparison for secrets. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export function bearer(req: Request): string | null {
  const h = req.headers.get('authorization') ?? '';
  return h.toLowerCase().startsWith('bearer ') ? h.slice(7).trim() : null;
}
