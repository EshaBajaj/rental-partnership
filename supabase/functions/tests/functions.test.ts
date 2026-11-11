import { assert, assertEquals, assertMatch } from 'jsr:@std/assert@1';
import { CONFIG, DbError, fakeDeps, FORM, post, PROPERTY, UpstreamError } from './fakes.ts';
import { makeHandler as form } from '../form/handler.ts';
import { makeHandler as track } from '../track/handler.ts';
import { makeHandler as submit } from '../submit/handler.ts';
import { makeHandler as voiceUpload } from '../voice-upload-url/handler.ts';
import { makeHandler as transcribeNow } from '../transcribe-now/handler.ts';
import { makeHandler as notify } from '../notify/handler.ts';
import { makeHandler as worker } from '../transcribe-worker/handler.ts';
import { makeHandler as health } from '../health/handler.ts';
import { formatLeadMessage } from '../_shared/server/core.ts';

const RID = '22222222-2222-4222-8222-222222222222';
const contact = { value: { name: 'Ramesh', phone: '9876543210', whatsapp_ok: true, consent: true } };
const goodSubmit = {
  id: RID, property_slug: 'shop', form_version_id: FORM.id, duration_seconds: 90, lang: 'en',
  answers: { path: { value: 'rent' }, budget: { value: 45000 }, contact },
};

// ---------------------------------------------------------------- form
Deno.test('form: open → config with 60 s cache', async () => {
  const { deps } = fakeDeps();
  const res = await form(deps)(new Request('https://fn/form?slug=shop'));
  assertEquals(res.status, 200);
  assertEquals(res.headers.get('cache-control'), 'public, max-age=60, s-maxage=60');
  const b = await res.json();
  assertEquals(b.status, 'open');
  assertEquals(b.form.id, FORM.id);
  assertEquals(b.form.config.questions.length, CONFIG.questions.length);
});

Deno.test('form: closed → closed message, no config', async () => {
  const { deps } = fakeDeps({ property: { ...PROPERTY, status: 'closed' } });
  const b = await (await form(deps)(new Request('https://fn/form?slug=shop'))).json();
  assertEquals(b.status, 'closed');
  assertEquals(b.closed_message, 'Closed');
  assertEquals(b.form, null);
});

Deno.test('form: errors use {code,message}', async () => {
  const { deps } = fakeDeps();
  const r1 = await form(deps)(new Request('https://fn/form?slug=nope'));
  assertEquals(r1.status, 404);
  assertEquals((await r1.json()).code, 'not_found');
  const r2 = await form(deps)(new Request('https://fn/form?slug=BAD SLUG'));
  assertEquals((await r2.json()).code, 'bad_request');
  const r3 = await form(deps)(new Request('https://fn/form?slug=shop', { method: 'POST' }));
  assertEquals(r3.status, 405);
  const r4 = await form(deps)(new Request('https://fn/form?slug=shop', { method: 'OPTIONS' }));
  assertEquals(r4.status, 204);
  assertEquals(r4.headers.get('access-control-allow-origin'), '*');
});

// ---------------------------------------------------------------- track
Deno.test('track: inserts batched events with hashed ip', async () => {
  const { deps, calls } = fakeDeps();
  const res = await track(deps)(post('track', { property_slug: 'shop', session_id: RID, events: [{ event: 'view' }, { event: 'answer', question_key: 'path', ms: 1200 }] }));
  assertEquals(res.status, 204);
  assertEquals(calls.funnel.length, 2);
  assertMatch(String(calls.funnel[0].ip_hash), /^[0-9a-f]{64}$/);
  assert(!JSON.stringify(calls.funnel).includes('1.2.3.4'), 'raw ip never stored');
});

Deno.test('track: rate limited → 429', async () => {
  const { deps } = fakeDeps({ rateOk: false });
  const res = await track(deps)(post('track', { property_slug: 'shop', session_id: RID, events: [{ event: 'view' }] }));
  assertEquals(res.status, 429);
  assertEquals((await res.json()).code, 'rate_limited');
});

// ---------------------------------------------------------------- submit
Deno.test('submit: validates, normalises phone, inserts, schedules notify', async () => {
  let payload: any = null;
  const { deps, calls } = fakeDeps({ rpc: { submit_response: (a) => ((payload = a.p), { status: 'created', id: RID, notify: true }), notification_claim: () => [] } });
  const res = await submit(deps)(post('submit', goodSubmit));
  assertEquals(res.status, 201);
  assertEquals(await res.json(), { id: RID, status: 'created' });
  assertEquals(payload.phone_e164, '+919876543210');
  assertEquals(payload.path, 'rent');
  assertEquals(payload.answers.budget.display, '₹45,000');
  assertEquals(payload.property_id, 'p1');
  assertMatch(payload.ip_hash, /^[0-9a-f]{64}$/);
  assertEquals(calls.waited.length, 1);
  await Promise.all(calls.waited);
});

Deno.test('submit: rejects hidden answers and bad values with 422 + details', async () => {
  const { deps } = fakeDeps();
  const res = await submit(deps)(post('submit', { ...goodSubmit, answers: { ...goodSubmit.answers, path: { value: 'partner' } } }));
  assertEquals(res.status, 422);
  const b = await res.json();
  assertEquals(b.code, 'validation');
  assertEquals(b.details[0].code, 'hidden_answer');
  const res2 = await submit(deps)(post('submit', { ...goodSubmit, answers: { ...goodSubmit.answers, contact: { value: { ...contact.value, phone: '123' } } } }));
  assertEquals((await res2.json()).details[0].code, 'invalid_phone');
});

Deno.test('submit: retry with same id is idempotent and skips rate limit', async () => {
  const { deps, calls } = fakeDeps({ existing: true, rateOk: false });
  const res = await submit(deps)(post('submit', goodSubmit));
  assertEquals(res.status, 200);
  assertEquals((await res.json()).status, 'existing');
  assertEquals(calls.rpc.length, 0);
});

Deno.test('submit: honeypot pretends success and stores nothing', async () => {
  const { deps, calls } = fakeDeps();
  const res = await submit(deps)(post('submit', { ...goodSubmit, website: 'http://spam' }));
  assertEquals(res.status, 200);
  assertEquals(calls.rpc.length, 0);
});

Deno.test('submit: 5/hour per ip', async () => {
  const { deps } = fakeDeps({ rateOk: false });
  const res = await submit(deps)(post('submit', goodSubmit));
  assertEquals(res.status, 429);
});

Deno.test('submit: voice answer passes final transcript (≤2000) to the DB', async () => {
  let payload: any = null;
  const { deps } = fakeDeps({ rpc: { submit_response: (a) => ((payload = a.p), { status: 'created', id: RID, notify: false }) } });
  const res = await submit(deps)(post('submit', { ...goodSubmit, answers: { ...goodSubmit.answers, about: { value: 'edited text', voice: true } } }));
  assertEquals(res.status, 201);
  assertEquals(payload.voice_finals, { about: 'edited text' });
  const tooLong = await submit(deps)(post('submit', { ...goodSubmit, answers: { ...goodSubmit.answers, about: { value: 'x'.repeat(2001), voice: true } } }));
  assertEquals(tooLong.status, 422);
});

Deno.test('submit: closed property → only waitlist', async () => {
  let payload: any = null;
  const { deps } = fakeDeps({ property: { ...PROPERTY, status: 'closed' }, rpc: { submit_response: (a) => ((payload = a.p), { status: 'created', id: RID }) } });
  assertEquals((await submit(deps)(post('submit', goodSubmit))).status, 409);
  const res = await submit(deps)(post('submit', { id: RID, property_slug: 'shop', form_version_id: null, waitlist: true, duration_seconds: 20, answers: { contact } }));
  assertEquals(res.status, 201);
  assertEquals(payload.path, 'waitlist');
  assertEquals(payload.phone_e164, '+919876543210');
});

Deno.test('submit: unknown form version → 409 form_changed', async () => {
  const { deps } = fakeDeps();
  const res = await submit(deps)(post('submit', { ...goodSubmit, form_version_id: '33333333-3333-4333-8333-333333333333' }));
  assertEquals(res.status, 409);
  assertEquals((await res.json()).code, 'form_changed');
});

// ---------------------------------------------------------------- voice upload
const vu = { property_slug: 'shop', response_id: RID, form_version_id: FORM.id, question_key: 'about', mime: 'audio/webm', bytes: 1000, duration_seconds: 12.3 };
Deno.test('voice-upload-url: returns signed url and removes the previous recording', async () => {
  const { deps, calls } = fakeDeps({ rpc: { voice_prepare_upload: () => ({ path: 'p1/r/about-2.webm', previous_path: 'p1/r/about-1.webm' }) } });
  const res = await voiceUpload(deps)(post('voice-upload-url', vu));
  assertEquals(res.status, 200);
  const b = await res.json();
  assertMatch(b.signed_url, /about-2\.webm\?token=/);
  await Promise.all(calls.waited);
  assertEquals(calls.removed, ['p1/r/about-1.webm']);
});

Deno.test('voice-upload-url: limits and validation', async () => {
  const limited = fakeDeps({ rpc: { voice_prepare_upload: () => { throw new DbError('P0001', 'too_many_recordings'); } } });
  const r1 = await voiceUpload(limited.deps)(post('voice-upload-url', vu));
  assertEquals(r1.status, 409);
  assertEquals((await r1.json()).code, 'too_many_recordings');
  const { deps } = fakeDeps();
  assertEquals((await voiceUpload(deps)(post('voice-upload-url', { ...vu, mime: 'video/mp4' }))).status, 400);
  assertEquals((await voiceUpload(deps)(post('voice-upload-url', { ...vu, bytes: 11 * 1024 * 1024 }))).status, 400);
  const r2 = await voiceUpload(deps)(post('voice-upload-url', { ...vu, question_key: 'budget' }));
  assertEquals((await r2.json()).code, 'voice_not_allowed');
});

// ---------------------------------------------------------------- transcribe-now
Deno.test('transcribe-now: success saves transcript', async () => {
  const saved: any[] = [];
  const { deps } = fakeDeps({
    rpc: { voice_begin_transcribe: () => ({ done: false, id: 'n1', storage_path: 'p/r/about-1.webm' }), voice_save_transcript: (a) => void saved.push(a) },
  });
  const b = await (await transcribeNow(deps)(post('transcribe-now', { response_id: RID, question_key: 'about' }))).json();
  assertEquals(b, { text: 'namaste', language: 'hindi' });
  assertEquals(saved[0].p_text, 'namaste');
});

Deno.test('transcribe-now: 429 from Groq → pending + rescheduled', async () => {
  const failed: any[] = [];
  const { deps } = fakeDeps({
    rpc: { voice_begin_transcribe: () => ({ done: false, id: 'n1', storage_path: 'p/r/a.webm' }), voice_mark_failed: (a) => void failed.push(a) },
    transcribe: () => Promise.reject(new UpstreamError(429, 'rate limit', 20)),
  });
  const b = await (await transcribeNow(deps)(post('transcribe-now', { response_id: RID, question_key: 'about' }))).json();
  assertEquals(b, { pending: true });
  assertEquals(failed[0].p_retry_seconds, 20);
});

Deno.test('transcribe-now: respects the 15 s budget (timeout → pending)', async () => {
  let t = 0;
  const failed: any[] = [];
  const { deps } = fakeDeps({
    now: () => t,
    rpc: { voice_begin_transcribe: () => ((t = 13_500), { done: false, id: 'n1', storage_path: 'p/r/a.webm' }), voice_mark_failed: (a) => void failed.push(a) },
    transcribe: (signal) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(new UpstreamError(408, 'timed out')))),
  });
  const started = Date.now();
  const b = await (await transcribeNow(deps)(post('transcribe-now', { response_id: RID, question_key: 'about' }))).json();
  assertEquals(b, { pending: true });
  assert(Date.now() - started < 3000, 'aborted using the remaining budget');
  assertEquals(failed.length, 1);
});

Deno.test('transcribe-now: cached transcript returned without calling Groq', async () => {
  const { deps } = fakeDeps({ rpc: { voice_begin_transcribe: () => ({ done: true, text: 'cached', language: 'english' }) }, transcribe: () => Promise.reject(new Error('should not call')) });
  assertEquals(await (await transcribeNow(deps)(post('transcribe-now', { response_id: RID, question_key: 'about' }))).json(), { text: 'cached', language: 'english' });
});

Deno.test('transcribe-now: missing audio → pending, never throws', async () => {
  const failed: any[] = [];
  const { deps } = fakeDeps({ audio: null, rpc: { voice_begin_transcribe: () => ({ done: false, id: 'n1', storage_path: 'x' }), voice_mark_failed: (a) => void failed.push(a) } });
  assertEquals(await (await transcribeNow(deps)(post('transcribe-now', { response_id: RID, question_key: 'about' }))).json(), { pending: true });
  assertMatch(failed[0].p_error, /not found/);
});

// ---------------------------------------------------------------- worker
const AUTH = { authorization: 'Bearer cron-secret-0123456789' };
Deno.test('worker: requires the cron secret', async () => {
  const { deps } = fakeDeps();
  assertEquals((await worker(deps)(post('transcribe-worker', {}))).status, 401);
  assertEquals((await worker(deps)(post('transcribe-worker', {}, { authorization: 'Bearer nope' }))).status, 401);
});

Deno.test('worker: transcribes, translates, notifies, purges audio', async () => {
  const done: string[] = [];
  const { deps, calls } = fakeDeps({
    rpc: {
      voice_claim_transcribe: () => [{ id: 'n1', storage_path: 'p/r/a-1.webm' }, { id: 'n2', storage_path: 'p/r/b-1.webm' }],
      voice_save_transcript: (a) => void done.push(`t:${a.p_note_id}`),
      voice_claim_translate: () => [{ id: 'n3', transcript_final: 'namaste', transcript_machine: 'x' }],
      voice_save_translation: (a) => void done.push(`tr:${a.p_text}`),
      notification_claim: () => [{ id: 7, response_id: 'r1', kind: 'ideal_lead', attempts: 1 }],
      notification_done: (a) => void done.push(`n:${a.p_ok}`),
      audio_expired: () => [{ id: 'n9', storage_path: 'old.webm' }],
      audio_mark_deleted: (a) => void done.push(`del:${(a.p_ids as string[]).join()}`),
    },
  });
  const res = await worker(deps)(post('transcribe-worker', {}, AUTH));
  const b = await res.json();
  assertEquals(b.transcribed, 2);
  assertEquals(b.translated, 1);
  assertEquals(b.notified, 1);
  assertEquals(b.audio_deleted, 1);
  assertEquals(done, ['t:n1', 't:n2', 'tr:EN:namaste', 'n:true', 'del:n9']);
  assertEquals(calls.removed, ['old.webm']);
  assertEquals(calls.heartbeats, ['transcribe-worker']);
  assertMatch(calls.sent[0], /Ideal lead/);
});

Deno.test('worker: one failing step does not stop the others', async () => {
  const { deps } = fakeDeps({
    rpc: {
      voice_claim_transcribe: () => { throw new DbError('x', 'db down'); },
      voice_claim_translate: () => [],
      notification_claim: () => [{ id: 1, response_id: 'r1', kind: 'ideal_lead', attempts: 1 }],
      notification_done: () => null,
      audio_expired: () => [],
    },
    send: () => Promise.reject(new UpstreamError(502, 'telegram down')),
  });
  const b = await (await worker(deps)(post('transcribe-worker', {}, AUTH))).json();
  assertEquals(b.notify_failed, 1);
  assertMatch(b.errors[0], /db down/);
});

// ---------------------------------------------------------------- notify
Deno.test('notify: internal only for pending; admin JWT for test message', async () => {
  const { deps, calls } = fakeDeps({ rpc: { notification_claim: () => [] } });
  assertEquals((await notify(deps)(post('notify', {}))).status, 401);
  assertEquals((await notify(deps)(post('notify', {}, AUTH))).status, 200);
  assertEquals((await notify(deps)(post('notify', { kind: 'test' }, { authorization: 'Bearer user-jwt' }))).status, 401);
  const admin = fakeDeps({ admin: true });
  assertEquals((await notify(admin.deps)(post('notify', { kind: 'test' }, { authorization: 'Bearer user-jwt' }))).status, 200);
  assertMatch(admin.calls.sent[0], /test message/);
  assertEquals(calls.sent.length, 0);
});

Deno.test('notify message escapes HTML and explains the match', () => {
  const { deps } = fakeDeps();
  return deps.db.leadForNotify('r1').then((l) => {
    const m = formatLeadMessage(l!, 'https://app.example');
    assertMatch(m, /Ramesh &lt;b&gt;/);
    assertMatch(m, /Best match: <b>Retailer<\/b> — 100%/);
    assertMatch(m, /✓ Budget ≥ ₹40,000 — answered ₹45,000/);
    assertMatch(m, /https:\/\/app\.example\/admin\/leads\/r1/);
    assertMatch(m, /wa\.me\/919876543210/);
  });
});

// ---------------------------------------------------------------- health
Deno.test('health: public summary vs detailed with secret; 503 when cron is stale', async () => {
  const snap = (hb: string | null) => ({
    now: '', last_heartbeat: hb, last_worker_run: hb, voice_pending: 0, voice_stuck: 0, voice_failed: 0, notify_pending: 0, notify_failed: 0, responses_24h: 3,
  });
  const fresh = fakeDeps({ rpc: { health_snapshot: () => snap(new Date().toISOString()) } });
  const r1 = await health(fresh.deps)(new Request('https://fn/health'));
  assertEquals(r1.status, 200);
  assertEquals(await r1.json(), { ok: true });
  const stale = fakeDeps({ rpc: { health_snapshot: () => snap(null) } });
  const r2 = await health(stale.deps)(new Request('https://fn/health', { headers: AUTH }));
  assertEquals(r2.status, 503);
  const b = await r2.json();
  assertEquals(b.checks.pg_cron.ok, false);
  const deep = await health(fresh.deps)(new Request('https://fn/health?deep=1', { headers: AUTH }));
  assertEquals((await deep.json()).checks.groq.ok, true);
});
