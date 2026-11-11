// End-to-end: real respondent UI (built) → real Edge Function handlers → real Postgres.
// Run via scripts/e2e.sh. Phone viewport 360×800. Browsers from E2E_BROWSERS (default chromium;
// CI runs "chromium,webkit"). SpeechRecognition is mocked (window.__srEmit / __srError) so the
// live-transcript UI is tested deterministically; audio comes from Chromium's fake microphone.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const pw = createRequire(import.meta.url)('playwright');
const APP = process.env.APP_URL ?? 'http://localhost:4173';
const FN = process.env.FN_URL ?? 'http://localhost:54400';
const DB = process.env.DATABASE_URL;
const SHOTS = process.env.SHOTS_DIR;
const BROWSERS = (process.env.E2E_BROWSERS ?? 'chromium').split(',').map((s) => s.trim()).filter(Boolean);
const psql = (q) => execFileSync('psql', ['-X', '-qtA', DB, '-c', q], { encoding: 'utf8' }).trim();
let step = 0;
const ok = (msg) => console.log(`  ✓ ${++step}. ${msg}`);
function assert(c, msg) {
  if (!c) throw new Error(`ASSERTION FAILED: ${msg}`);
}
const whisper = (cfg) => fetch(`${FN}/__whisper`, { method: 'POST', body: JSON.stringify(cfg) });

const MOCK_SR = () => {
  class MockSR {
    constructor() {
      this.lang = '';
      this.continuous = false;
      this.interimResults = false;
      this.onresult = null;
      this.onerror = null;
      this.onend = null;
      window.__sr = this;
    }
    start() {
      window.__srStarted = (window.__srStarted ?? 0) + 1;
    }
    stop() {
      setTimeout(() => this.onend && this.onend(), 10);
    }
    abort() {
      this.stop();
    }
  }
  window.SpeechRecognition = MockSR;
  window.webkitSpeechRecognition = MockSR;
  window.__srEmit = (text, isFinal) => {
    const res = [{ transcript: text }];
    res.isFinal = isFinal;
    window.__sr.onresult({ resultIndex: 0, results: [res] });
  };
  window.__srError = (error) => window.__sr.onerror && window.__sr.onerror({ error });
};
const NO_SR = () => {
  delete window.SpeechRecognition;
  delete window.webkitSpeechRecognition;
  Object.defineProperty(window, 'webkitSpeechRecognition', { value: undefined, configurable: true });
};

const shot = async (page, name, browser) => SHOTS && page.screenshot({ path: `${SHOTS}/${browser}-${name}.png` });

async function welcome(page) {
  await page.getByText('A shop is available on Main Road').waitFor();
  await page.getByText('About 2 minutes · No sign-up needed').waitFor();
  await page.getByText('Your answers go only to Bajaj Computers.').waitFor();
  await page.getByRole('button', { name: 'Start' }).click();
}

async function rentToAboutYou(page) {
  await page.getByRole('radio', { name: 'Rent the shop' }).click();
  await page.getByRole('radio', { name: 'Grocery / Kirana' }).click();
  await page.getByRole('radio', { name: 'Immediately' }).click();
  await page.getByLabel('How much monthly rent can you pay?').fill('45000');
  await page.getByText('₹45,000 (45 thousand)').waitFor();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('radio', { name: '3–5 years' }).click();
  await page.getByRole('radio', { name: 'Yes' }).click();
  await page.getByText('Tell us about your plan').waitFor();
}

async function contactAndSend(page, name, phone, t0) {
  await page.getByText('So we can call you back about the shop. No marketing, ever.').waitFor();
  await page.getByLabel('Your name').fill(name);
  await page.getByLabel('Mobile number').fill(phone);
  await page.getByText('I agree to be contacted about this shop').click();
  if (t0) await page.waitForTimeout(Math.max(0, 32_000 - (Date.now() - t0))); // a human takes > 30 s
  await page.getByRole('button', { name: 'Send' }).click();
}

async function run(browserName) {
  const isChromium = browserName === 'chromium';
  const browser = await pw[browserName].launch(isChromium ? { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } : {});
  const phone = { viewport: { width: 360, height: 800 }, deviceScaleFactor: 1, isMobile: isChromium, hasTouch: true, ...(isChromium ? { permissions: ['microphone'] } : {}) };
  const newPage = async (init) => {
    const ctx = await browser.newContext(phone);
    if (init) await ctx.addInitScript(init);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    return { ctx, page, errors };
  };
  const tag = `[${browserName}]`;
  psql(`update public.properties set contact_phone = '+919876500000', contact_whatsapp = '+919876500000', status = 'open'`);

  try {
    // ------------------------------------------------ 1. welcome, rent path, LIVE transcript + clearer-version offer
    if (isChromium) {
      await whisper({ text: 'Main kirana dukaan kholna chahta hoon, mere paas 10 saal ka anubhav hai', delayMs: 600 });
      const { ctx, page, errors } = await newPage(MOCK_SR);
      const t0 = Date.now();
      await page.goto(`${APP}/f/main-road-shop?src=e2e`);
      await shot(page, '01-welcome', browserName);
      await welcome(page);
      ok(`${tag} welcome screen with trust line → Start`);
      await page.getByText('Shared only with Bajaj Computers').waitFor();
      ok(`${tag} footer "Shared only with Bajaj Computers" on every step`);
      await rentToAboutYou(page);
      await page.getByRole('button', { name: 'Type instead' }).waitFor();
      ok(`${tag} speak is primary; "Type instead" offered quietly`);

      await page.getByRole('button', { name: 'Tap to speak' }).click();
      await page.getByText('Listening… start speaking').waitFor();
      await page.evaluate(() => window.__srEmit('kirana dukan', false));
      const interim = page.getByTestId('live-interim');
      await interim.filter({ hasText: 'kirana dukan' }).waitFor();
      const [interimColor, inkColor] = await page.evaluate(() => [
        getComputedStyle(document.querySelector('[data-testid=live-interim]')).color,
        getComputedStyle(document.querySelector('[data-testid=live-final]')).color,
      ]);
      await page.evaluate(() => window.__srEmit('main kirana dukan', true));
      await page.getByTestId('live-final').filter({ hasText: 'main kirana dukan' }).waitFor();
      assert(interimColor !== inkColor, `interim (${interimColor}) must look different from final (${inkColor})`);
      await shot(page, '02-live-transcript', browserName);
      ok(`${tag} live transcript: interim words muted, final words in ink`);
      await page.waitForTimeout(1200); // some audio
      await page.getByRole('button', { name: 'Stop recording' }).click();
      const box = page.getByTestId('speak-text');
      await box.waitFor();
      assert((await box.inputValue()) === 'main kirana dukan', `editable text = live text, got ${await box.inputValue()}`);
      await page.getByText("This is exactly what we'll receive. Fix anything.").waitFor();
      ok(`${tag} after stop the live text is editable ("exactly what we'll receive")`);
      await page.getByTestId('clearer-offer').waitFor({ timeout: 15000 });
      await shot(page, '03-clearer-offer', browserName);
      ok(`${tag} Whisper differs > 15% and unedited → "We have a clearer version" offered (not applied)`);
      assert((await box.inputValue()) === 'main kirana dukan', 'never replaced automatically');
      await page.getByRole('button', { name: 'Use it' }).click();
      assert((await box.inputValue()).includes('10 saal'), 'Use it → Whisper text');
      ok(`${tag} "Use it" puts the clearer version in the box`);
      await page.getByRole('button', { name: 'Next' }).click();
      await contactAndSend(page, 'Ramesh Kumar', '98765 43210', t0);
      await page.getByText('Someone from Bajaj Computers will call you from +91 98765 00000.').waitFor();
      await page.getByRole('link', { name: 'Message us on WhatsApp' }).waitFor();
      await shot(page, '04-done', browserName);
      ok(`${tag} done screen names Bajaj Computers + calling number + WhatsApp button`);
      assert(errors.length === 0, `page errors: ${errors.join('; ')}`);

      const row = psql(`select path||'|'||tier||'|'||(answers->'path'->'choose')::text||'|'||(answers->'rent_budget'->>'number')||'|'||(match_detail->>'best_profile_name')||'|'||suspected_bot from public.responses where name = 'Ramesh Kumar'`);
      assert(row === 'rent|ideal|["rent"]|45000|Established retailer (rent)|false', `db row: ${row}`);
      ok(`${tag} DB: radio answers stored as arrays, ideal match — ${row}`);
      const vn = psql(`select transcript_live||'|'||transcript_final||'|'||edited_by_respondent||'|'||audio_missing||'|'||(storage_path is not null) from public.voice_notes v join public.responses r on r.id = v.response_id where r.name = 'Ramesh Kumar'`);
      assert(vn === 'main kirana dukan|Main kirana dukaan kholna chahta hoon, mere paas 10 saal ka anubhav hai|false|false|true', `voice: ${vn}`);
      ok(`${tag} DB voice note: live + final (Whisper accepted = not edited) + audio kept`);
      await new Promise((r) => setTimeout(r, 500));
      const sent = await (await fetch(`${FN}/__sent`)).json();
      assert(sent.some((m) => m.includes('Ramesh Kumar')), 'telegram alert');
      ok(`${tag} ideal lead → Telegram alert`);

      // privacy page from the footer link
      await page.goto(`${APP}/f/main-road-shop`);
      await page.getByRole('link', { name: 'How we use your details' }).click();
      await page.getByText('Voice recordings are deleted automatically after 180 days.', { exact: false }).waitFor();
      await page.getByText("in Chrome this is Google's service", { exact: false }).waitFor();
      await page.getByText('Groq', { exact: false }).first().waitFor();
      await page.getByText('Send a WhatsApp message to +919876500000', { exact: false }).waitFor();
      await shot(page, '05-privacy', browserName);
      ok(`${tag} privacy page: browser speech service, Groq, 180-day retention, WhatsApp delete`);
      await ctx.close();
    }

    // ------------------------------------------------ 2. edited before Whisper returns → no offer
    if (isChromium) {
      await whisper({ text: 'completely different words from the server side', delayMs: 2500 });
      const { ctx, page } = await newPage(MOCK_SR);
      await page.goto(`${APP}/f/main-road-shop`);
      await welcome(page);
      await rentToAboutYou(page);
      await page.getByRole('button', { name: 'Tap to speak' }).click();
      await page.getByText('Listening… start speaking').waitFor();
      await page.evaluate(() => window.__srEmit('mera plan grocery ka hai', true));
      await page.waitForTimeout(1000);
      await page.getByRole('button', { name: 'Stop recording' }).click();
      await page.getByTestId('speak-text').fill('Mera plan grocery ka hai, 2 log kaam karenge');
      await page.waitForTimeout(3500);
      assert((await page.getByTestId('clearer-offer').count()) === 0, 'no offer after the respondent edited');
      ok(`${tag} respondent edited → no "clearer version" offer`);
      await ctx.close();
    }

    // ------------------------------------------------ 3. audio-capture error → live text kept, audio_missing
    if (isChromium) {
      await whisper({ text: 'x', delayMs: 300 });
      const { ctx, page } = await newPage(MOCK_SR);
      const t0 = Date.now();
      await page.goto(`${APP}/f/main-road-shop`);
      await welcome(page);
      await rentToAboutYou(page);
      await page.getByRole('button', { name: 'Tap to speak' }).click();
      await page.getByText('Listening… start speaking').waitFor();
      await page.evaluate(() => {
        window.__srEmit('dukaan chahiye jaldi', true);
        window.__srError('audio-capture');
      });
      await page.waitForTimeout(800);
      await page.getByRole('button', { name: 'Stop recording' }).click();
      await page.getByText("We couldn't keep the recording, but your words above are saved.").waitFor();
      assert((await page.getByTestId('speak-text').inputValue()) === 'dukaan chahiye jaldi', 'live text kept');
      ok(`${tag} microphone capture failed → live text kept as the answer`);
      await page.getByRole('button', { name: 'Next' }).click();
      await contactAndSend(page, 'Meena Audio', '91234 00001', t0);
      await page.getByText('Thank you, Meena!').waitFor();
      const vn = psql(`select audio_missing||'|'||(storage_path is null)||'|'||transcript_live from public.voice_notes v join public.responses r on r.id = v.response_id where r.name = 'Meena Audio'`);
      assert(vn === 'true|true|dukaan chahiye jaldi', `audio missing: ${vn}`);
      ok(`${tag} DB: audio_missing = true, no recording stored, live text saved`);
      await ctx.close();
    }

    // ------------------------------------------------ 4. no live speech support → record, then "Writing it down…" (Whisper)
    if (isChromium) {
      await whisper({ text: 'Main dawai ki dukaan chalata hoon', delayMs: 800 });
      const { ctx, page } = await newPage(NO_SR);
      await page.goto(`${APP}/f/main-road-shop`);
      await welcome(page);
      await rentToAboutYou(page);
      await page.getByRole('button', { name: 'Tap to speak' }).click();
      await page.getByText('Recording… your words will be written down when you stop').waitFor();
      await page.waitForTimeout(1500);
      await page.getByRole('button', { name: 'Stop recording' }).click();
      await page.getByText('Writing down what you said…').waitFor();
      await page.waitForFunction(() => document.querySelector('[data-testid=speak-text]')?.value.includes('dawai'), null, { timeout: 15000 });
      ok(`${tag} unsupported browser → record → "Writing it down…" → Whisper text editable`);
      await ctx.close();
    }

    // ------------------------------------------------ 5. Hindi, partner path, reload resume, offline outbox (all browsers)
    {
      const { ctx, page } = await newPage();
      await page.goto(`${APP}/f/main-road-shop`);
      await page.getByRole('button', { name: 'हिंदी' }).click();
      await page.getByText('मेन रोड पर एक दुकान उपलब्ध है').waitFor();
      await page.getByRole('button', { name: 'शुरू करें' }).click();
      await page.getByRole('radio', { name: 'साझेदारी करना' }).click();
      await page.getByRole('radio', { name: 'कपड़े' }).click();
      await page.getByRole('radio', { name: '1 महीने के अंदर' }).click();
      await page.getByText('आप साझेदारी में कितना निवेश कर सकते हैं?').waitFor();
      await page.locator('input[inputmode="decimal"]').fill('1500000');
      await page.getByText('15 लाख').waitFor();
      await page.getByRole('button', { name: 'आगे' }).click();
      await page.getByRole('radio', { name: /सक्रिय/ }).click();
      await page.getByRole('radio', { name: 'नहीं' }).click();
      await page.getByText('अपनी योजना के बारे में बताइए').waitFor();
      ok(`${tag} Hindi + partner path`);
      await page.reload();
      await page.getByText('फिर से स्वागत है').waitFor();
      await page.getByText('अपनी योजना के बारे में बताइए').waitFor();
      ok(`${tag} reload mid-form resumes where you were`);
      await page.getByRole('button', { name: 'छोड़ें' }).click();
      await page.getByLabel('आपका नाम').fill('Sunita Devi');
      await page.getByLabel('मोबाइल नंबर').fill('9123456780');
      await page.getByText('मैं इस दुकान के बारे में संपर्क').click();
      await page.route('**/functions/v1/submit', (r) => r.abort('internetdisconnected'));
      await page.getByRole('button', { name: 'भेजें' }).click();
      await page.getByText('इंटरनेट नहीं है').waitFor();
      ok(`${tag} offline → answers kept on the phone`);
      await page.unroute('**/functions/v1/submit');
      await page.getByRole('button', { name: 'अभी भेजें' }).click();
      await page.getByText('धन्यवाद, Sunita!').waitFor();
      const r2 = psql(`select path||'|'||lang||'|'||(answers->'partner_role'->'choose')::text from public.responses where name = 'Sunita Devi' order by created_at desc limit 1`);
      assert(r2 === 'partner|hi|["active"]', `db row 2: ${r2}`);
      ok(`${tag} outbox sent when back online — ${r2}`);
      psql(`delete from public.responses where name = 'Sunita Devi'`);
      await ctx.close();
    }

    // ------------------------------------------------ 6. closed property → waitlist (all browsers)
    {
      psql(`update public.properties set status = 'closed', closed_message = 'This shop has been rented. Thank you!'`);
      const { ctx, page } = await newPage();
      await page.goto(`${APP}/f/main-road-shop`);
      await page.getByText('This shop has been rented. Thank you!').waitFor();
      await page.getByRole('button', { name: 'Tell me about the next shop' }).click();
      await page.getByLabel('Your name').fill('Amit');
      await page.getByLabel('Mobile number').fill('9988776655');
      await page.getByText('I agree to be contacted about this shop').click();
      await page.getByRole('button', { name: 'Send' }).click();
      await page.getByText('You are on the list. We will contact you.').waitFor();
      ok(`${tag} closed property → waitlist`);
      psql(`update public.properties set status = 'open'`);
      psql(`delete from public.responses where name = 'Amit'`);
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
}

for (const b of BROWSERS) {
  console.log(`\n${b}:`);
  await run(b);
}

// worker translates the Hindi transcript of the first respondent
{
  const res = await fetch(`${FN}/functions/v1/transcribe-worker`, { method: 'POST', headers: { authorization: 'Bearer e2e-cron-secret-123456' } });
  const b = await res.json();
  assert(res.status === 200 && b.translated >= 1, `worker: ${JSON.stringify(b)}`);
  ok('worker translated Hindi transcripts to English');
}
console.log(`\nE2E PASSED (${step} checks)`);
