import { assertEquals, assertMatch, assertRejects } from 'jsr:@std/assert@1';
import { createGroq, WHISPER_PROMPT } from '../_shared/server/groq.ts';
import { UpstreamError } from '../_shared/server/deps.ts';
import { createTelegram } from '../_shared/server/telegram.ts';

const sig = () => new AbortController().signal;

Deno.test('groq: whisper request shape (verbose_json + domain prompt)', async () => {
  let seen: FormData | null = null;
  let url = '';
  const g = createGroq('k', undefined, (async (u: string, init: RequestInit) => {
    url = u;
    seen = init.body as FormData;
    return new Response(JSON.stringify({ text: ' hello ', language: 'english', duration: 4.2 }));
  }) as typeof fetch);
  const r = await g.transcribe(new Blob(['x']), 'a.webm', sig());
  assertEquals(r, { text: 'hello', language: 'english', duration: 4.2 });
  assertMatch(url, /audio\/transcriptions$/);
  assertEquals(seen!.get('model'), 'whisper-large-v3');
  assertEquals(seen!.get('response_format'), 'verbose_json');
  assertEquals(seen!.get('prompt'), WHISPER_PROMPT);
});

Deno.test('groq: 429 carries retry-after; network errors are retryable', async () => {
  const g = createGroq('k', undefined, (async () => new Response('{}', { status: 429, headers: { 'retry-after': '7' } })) as unknown as typeof fetch);
  const e = await assertRejects(() => g.transcribe(new Blob(['x']), 'a.webm', sig()), UpstreamError);
  assertEquals(e.retryAfterSeconds, 7);
  assertEquals(e.retryable, true);
  const g2 = createGroq('k', undefined, (async () => { throw new TypeError('connection reset'); }) as unknown as typeof fetch);
  const e2 = await assertRejects(() => g2.transcribe(new Blob(['x']), 'a.webm', sig()), UpstreamError);
  assertEquals(e2.retryable, true);
});

Deno.test('groq: translation falls back to the next model when one is unavailable', async () => {
  const tried: string[] = [];
  const g = createGroq('k', ['gone-model', 'llama-3.3-70b-versatile'], (async (_u: string, init: RequestInit) => {
    const model = JSON.parse(String(init.body)).model;
    tried.push(model);
    if (model === 'gone-model') return new Response(JSON.stringify({ error: { code: 'model_decommissioned', message: 'The model has been decommissioned' } }), { status: 400 });
    return new Response(JSON.stringify({ choices: [{ message: { content: ' I want a shop ' } }] }));
  }) as typeof fetch);
  assertEquals(await g.translateToEnglish('mujhe dukaan chahiye', sig()), 'I want a shop');
  assertEquals(tried, ['gone-model', 'llama-3.3-70b-versatile']);
});

Deno.test('groq: missing key is a clear error', async () => {
  const e = await assertRejects(() => createGroq('').transcribe(new Blob(['x']), 'a.webm', sig()), UpstreamError);
  assertMatch(e.message, /GROQ_API_KEY/);
});

Deno.test('telegram: sends HTML message; surfaces API errors', async () => {
  let body: any = null;
  const ok = createTelegram('t', '42', (async (_u: string, init: RequestInit) => ((body = JSON.parse(String(init.body))), new Response('{"ok":true}'))) as typeof fetch);
  await ok.send('<b>hi</b>');
  assertEquals(body, { chat_id: '42', text: '<b>hi</b>', parse_mode: 'HTML', disable_web_page_preview: true });
  const bad = createTelegram('t', '42', (async () => new Response('{"ok":false,"description":"chat not found"}', { status: 400 })) as unknown as typeof fetch);
  const e = await assertRejects(() => bad.send('x'), UpstreamError);
  assertMatch(e.message, /chat not found/);
});
