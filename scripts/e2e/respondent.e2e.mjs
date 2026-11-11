// End-to-end: real respondent UI (built) → real Edge Function handlers → real Postgres.
// Run via scripts/e2e.sh. Uses Chromium's fake microphone for the voice flow.
import { createRequire } from 'node:module';
// CommonJS resolution so a globally installed Playwright (NODE_PATH) also works.
const { chromium } = createRequire(import.meta.url)('playwright');
import { execFileSync } from 'node:child_process';

const APP = process.env.APP_URL ?? 'http://localhost:4173';
const FN = process.env.FN_URL ?? 'http://localhost:54400';
const DB = process.env.DATABASE_URL;
const SHOTS = process.env.SHOTS_DIR;
const psql = (q) => execFileSync('psql', ['-X', '-qtA', DB, '-c', q], { encoding: 'utf8' }).trim();
let step = 0;
const ok = (msg) => console.log(`  ✓ ${++step}. ${msg}`);
function assert(c, msg) {
  if (!c) throw new Error(`ASSERTION FAILED: ${msg}`);
}

const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, permissions: ['microphone'] };

async function shot(page, name) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

try {
  // ---------------------------------------------------------------- 1. rent path with voice → ideal
  {
    const ctx = await browser.newContext(phone);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const t0 = Date.now();
    await page.goto(`${APP}/f/main-road-shop?src=e2e`);
    await page.getByText('Are you looking to rent this shop').waitFor();
    await shot(page, '01-first-question');
    ok('form loads on a phone viewport');

    await page.getByRole('radio', { name: 'Rent the shop' }).click();
    await page.getByText('What business do you want to run here?').waitFor();
    ok('single choice auto-advances');

    await page.getByRole('radio', { name: 'Grocery / Kirana' }).click();
    await page.getByRole('radio', { name: 'Immediately' }).click();
    await page.getByText('How much monthly rent can you pay?').waitFor();
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByText('Please answer this question.').waitFor();
    ok('required validation blocks an empty answer');

    await page.getByLabel('How much monthly rent can you pay?').fill('45000');
    await page.getByText('₹45,000 (45 thousand)').waitFor();
    await shot(page, '02-currency');
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('radio', { name: '3–5 years' }).click();
    await page.getByRole('radio', { name: 'Yes' }).click();
    await page.getByText('Tell us about your plan').waitFor();
    ok('rent path skips partner questions');

    // voice: record → upload → transcript → edit
    await page.getByRole('button', { name: 'Tap to speak' }).click();
    await page.getByText(/Recording… tap to stop/).waitFor();
    await page.waitForTimeout(2200);
    await page.getByRole('button', { name: /Recording… tap to stop/ }).click();
    const box = page.locator('textarea');
    await page.waitForFunction(() => document.querySelector('textarea')?.value.includes('kirana'), null, { timeout: 15000 });
    await page.getByText('Check what we heard. You can edit it.').waitFor();
    await shot(page, '03-voice-transcript');
    ok('voice: recorded, uploaded, transcribed, transcript shown');
    await box.fill('Main kirana dukaan kholna chahta hoon — 10 saal ka anubhav');
    ok('voice: respondent edits the transcript');
    await page.getByRole('button', { name: 'Next' }).click();

    await page.getByText('How can we reach you?').waitFor();
    await page.getByLabel('Your name').fill('Ramesh Kumar');
    await page.getByLabel('Mobile number').fill('98765 43210');
    await page.getByRole('button', { name: 'Send' }).click();
    await page.getByText('Please tick the box so we can contact you.').waitFor();
    ok('consent is required');
    await page.getByText('I agree to be contacted about this shop').click();
    await shot(page, '04-contact');
    // a human takes > 30 s (faster than 15 s is flagged as a bot and not notified)
    await page.waitForTimeout(Math.max(0, 32_000 - (Date.now() - t0)));
    await page.getByRole('button', { name: 'Send' }).click();
    await page.getByText('Thank you, Ramesh!').waitFor();
    await shot(page, '05-thanks');
    ok('submitted → thank-you screen');
    assert(errors.length === 0, `page errors: ${errors.join('; ')}`);

    const row = psql(`select path||'|'||tier||'|'||phone_e164||'|'||source||'|'||(match_detail->>'best_profile_name')||'|'||best_match||'|'||(match_detail->'intent_breakdown'->>'timing')||'|'||(match_detail->'intent_breakdown'->>'voice')||'|'||(match_detail->'intent_breakdown'->>'all_optional')||'|'||(match_detail->'intent_breakdown'->>'whatsapp')||'|'||intent_score||'|'||suspected_bot from public.responses where name = 'Ramesh Kumar'`);
    assert(row === 'rent|ideal|+919876543210|e2e|Established retailer (rent)|100.0|40|25|15|10|100|false', `db row: ${row}`);
    ok(`DB: ${row}`);
    const vn = psql(`select status||'|'||edited_by_respondent||'|'||transcript_machine||'|'||(transcript_final like '%10 saal%') from public.voice_notes v join public.responses r on r.id = v.response_id where r.name = 'Ramesh Kumar'`);
    assert(vn === 'submitted|true|Main kirana dukaan kholna chahta hoon|true', `voice note: ${vn}`);
    ok(`DB voice note: ${vn}`);
    await new Promise((r) => setTimeout(r, 500));
    const sent = await (await fetch(`${FN}/__sent`)).json();
    assert(sent.length === 1 && sent[0].includes('Ideal lead') && sent[0].includes('Ramesh Kumar'), `telegram: ${JSON.stringify(sent)}`);
    ok('ideal lead → Telegram notification sent');
    const funnel = psql(`select string_agg(distinct event, ',' order by event) from public.funnel_events`);
    assert(funnel.includes('submit_ok') && funnel.includes('view') && funnel.includes('answer'), `funnel: ${funnel}`);
    ok(`funnel events recorded (${funnel})`);

    await page.reload();
    await page.getByText('Thank you, Ramesh!').waitFor();
    ok('reload after submit keeps the thank-you screen (no double submit)');
    await ctx.close();
  }

  // ---------------------------------------------------------------- 2. partner path, Hindi, offline submit → outbox → send
  {
    const ctx = await browser.newContext(phone);
    const page = await ctx.newPage();
    await page.goto(`${APP}/f/main-road-shop`);
    await page.getByRole('button', { name: 'हिंदी' }).click();
    await page.getByText('क्या आप यह दुकान किराये पर लेना चाहते हैं').waitFor();
    await shot(page, '06-hindi');
    ok('Hindi toggle');
    await page.getByRole('radio', { name: 'साझेदारी करना' }).click();
    await page.getByRole('radio', { name: 'कपड़े' }).click();
    await page.getByRole('radio', { name: '1 महीने के अंदर' }).click();
    await page.getByText('आप साझेदारी में कितना निवेश कर सकते हैं?').waitFor();
    ok('partner path: investment question shown (rent budget skipped)');
    await page.locator('input[inputmode="decimal"]').fill('1500000');
    await page.getByText('15 लाख').waitFor();
    await page.getByRole('button', { name: 'आगे' }).click();
    await page.getByRole('radio', { name: /सक्रिय/ }).click();
    await page.getByRole('radio', { name: 'नहीं' }).click();
    await page.getByText('अपनी योजना के बारे में बताइए').waitFor();
    // reload mid-way: answers and position are kept
    await page.reload();
    await page.getByText('फिर से स्वागत है').waitFor();
    await page.getByText('अपनी योजना के बारे में बताइए').waitFor();
    ok('reload mid-form resumes with answers kept');
    await page.getByRole('button', { name: 'छोड़ें' }).click(); // optional voice question
    await page.getByLabel('आपका नाम').fill('Sunita Devi');
    await page.getByLabel('मोबाइल नंबर').fill('9123456780');
    await page.getByText('मैं इस दुकान के बारे में संपर्क').click();

    await page.route('**/functions/v1/submit', (r) => r.abort('internetdisconnected'));
    await page.getByRole('button', { name: 'भेजें' }).click();
    await page.getByText('इंटरनेट नहीं है').waitFor();
    await shot(page, '07-offline');
    ok('network failure → answers kept on the phone (outbox)');
    assert(psql(`select count(*) from public.responses where name = 'Sunita Devi'`) === '0', 'not stored yet');
    await page.unroute('**/functions/v1/submit');
    await page.getByRole('button', { name: 'अभी भेजें' }).click();
    await page.getByText('धन्यवाद, Sunita!').waitFor();
    ok('outbox sent when back online');
    const r2 = psql(`select path||'|'||tier||'|'||lang||'|'||(match_detail->>'best_profile_name') from public.responses where name = 'Sunita Devi'`);
    assert(r2 === 'partner|ideal|hi|Active partner', `db row 2: ${r2}`);
    ok(`DB: ${r2}`);
    await ctx.close();
  }

  // ---------------------------------------------------------------- 3. closed property → waitlist
  {
    psql(`update public.properties set status = 'closed', closed_message = 'This shop has been rented. Thank you!'`);
    const ctx = await browser.newContext(phone);
    const page = await ctx.newPage();
    await page.goto(`${APP}/f/main-road-shop`);
    await page.getByText('This shop has been rented. Thank you!').waitFor();
    await page.getByRole('button', { name: 'Tell me about the next shop' }).click();
    await page.getByLabel('Your name').fill('Amit');
    await page.getByLabel('Mobile number').fill('9988776655');
    await page.getByText('I agree to be contacted about this shop').click();
    await page.getByRole('button', { name: 'Send' }).click();
    await page.getByText('You are on the list. We will contact you.').waitFor();
    await shot(page, '08-waitlist');
    ok('closed property shows closed message; waitlist works');
    assert(psql(`select path from public.responses where name = 'Amit'`) === 'waitlist', 'waitlist row');
    psql(`update public.properties set status = 'open'`);
    await ctx.close();
  }

  // ---------------------------------------------------------------- 4. worker translates the Hindi transcript
  {
    const res = await fetch(`${FN}/functions/v1/transcribe-worker`, { method: 'POST', headers: { authorization: 'Bearer e2e-cron-secret-123456' } });
    const b = await res.json();
    assert(res.status === 200 && b.translated === 1, `worker: ${JSON.stringify(b)}`);
    const en = psql(`select transcript_en from public.voice_notes where transcript_en is not null`);
    assert(en.startsWith('EN: Main kirana'), `translation: ${en}`);
    ok('worker translated the Hindi transcript to English');
  }
  console.log(`\nE2E PASSED (${step} checks)`);
} finally {
  await browser.close();
}
