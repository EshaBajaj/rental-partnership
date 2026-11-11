// End-to-end for the admin board: real admin UI → (test) PostgREST/GoTrue stand-in → Postgres,
// running as role `authenticated` so RLS, column grants, triggers and RPCs are real.
// Runs after respondent.e2e.mjs (uses the leads it created). Invoked by scripts/e2e.sh.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const { chromium } = createRequire(import.meta.url)('playwright');
const APP = process.env.APP_URL ?? 'http://localhost:4173';
const FN = process.env.FN_URL ?? 'http://localhost:54400';
const DB = process.env.DATABASE_URL;
const SHOTS = process.env.SHOTS_DIR;
const psql = (q) => execFileSync('psql', ['-X', '-qtA', DB, '-c', q], { encoding: 'utf8' }).trim();
let step = 0;
const ok = (m) => console.log(`  ✓ ${++step}. ${m}`);
const assert = (c, m) => {
  if (!c) throw new Error(`ASSERTION FAILED: ${m}`);
};
async function until(fn, msg, ms = 10000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`TIMEOUT: ${msg}`);
}

psql(`insert into auth.users (id, email) values ('aaaaaaaa-0000-4000-8000-000000000001', 'owner@shop.test') on conflict do nothing`);
psql(`insert into public.admins (user_id, email, role) values ('aaaaaaaa-0000-4000-8000-000000000001', 'owner@shop.test', 'owner') on conflict do nothing`);
const OWNER = 'aaaaaaaa-0000-4000-8000-000000000001';

const browser = await chromium.launch();
async function open(viewport, label) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('response', (r) => {
    const u = r.url();
    if (r.status() >= 400 && !u.includes('/realtime/')) problems.push(`${r.status()} ${r.request().method()} ${u}`);
  });
  const shot = async (n) => SHOTS && page.screenshot({ path: `${SHOTS}/admin-${label}-${n}.png` });
  return { ctx, page, problems, shot };
}
async function signIn(page, email) {
  await page.goto(`${APP}/admin/login`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('e2e-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
}

try {
  const { ctx, page, problems, shot } = await open({ width: 1280, height: 900 }, 'desktop');

  // ---------------------------------------------------------------- sign in
  await page.goto(`${APP}/admin`);
  await page.getByLabel('Email').fill('owner@shop.test');
  await page.getByLabel('Password').fill('wrong');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('alert').waitFor();
  problems.length = 0; // the 400 for the wrong password is expected
  ok('wrong password is rejected');
  await page.getByLabel('Password').fill('e2e-password');
  await page.getByRole('button', { name: 'Sign in' }).click();

  // ---------------------------------------------------------------- board + lead with voice compare
  await page.getByText('Ramesh Kumar').first().waitFor({ timeout: 15000 });
  await page.getByText('Established retailer (rent)').first().waitFor();
  await shot('01-board');
  ok('board lists ranked leads');
  await page.getByText('Ramesh Kumar').first().click();
  await page.getByText('Why this ranking').waitFor();
  await page.getByRole('button', { name: 'Compare live / Whisper / sent' }).click();
  await page.getByText('main kirana dukan', { exact: false }).first().waitFor();
  await page.getByText('10 saal ka anubhav', { exact: false }).first().waitFor();
  await shot('02-lead-voice-compare');
  ok('lead detail: sent text first, compare live / Whisper / sent');

  const statusSelect = page.locator('select').filter({ has: page.locator('option[value="contacted"]') }).first();
  await statusSelect.selectOption('contacted');
  await until(() => psql(`select pipeline_status from public.responses where name = 'Ramesh Kumar'`) === 'contacted', 'status saved');
  assert(psql(`select actor from public.lead_events where type = 'status_changed' order by id desc limit 1`) === OWNER, 'status event actor');
  ok('status change saved through RLS with an audited lead event');

  // the audio-missing lead shows no player
  await page.goto(`${APP}/admin`);
  await page.getByText('Meena Audio').first().click();
  await page.getByText('No recording — live transcript only.').waitFor();
  ok('lead without audio: "No recording — live transcript only"');

  // ---------------------------------------------------------------- builder: enable all three modes + 50-char limit, publish
  await page.getByRole('link', { name: 'Form' }).first().click();
  await page.getByText('What business do you want to run here?').first().click();
  await page.getByRole('switch', { name: 'Type on/off' }).check();
  await page.getByRole('switch', { name: 'Speak on/off' }).check();
  await page.getByLabel('Maximum characters').fill('50');
  await page.getByLabel('Maximum characters').blur();
  await page.getByTestId('question-preview').getByRole('button', { name: 'Type instead' }).waitFor();
  await shot('03-builder-modes');
  ok('builder: Choose + Type + Speak switched on, live phone preview shows "Type instead"');
  await until(() => psql(`select concat(input_modes #>> '{type,enabled}', input_modes #>> '{speak,enabled}', input_modes #>> '{type,max_chars}') from public.questions where key = 'business_type'`) === 'truetrue50', 'modes autosaved', 15000);
  ok('modes autosaved to the draft (type on, speak on, max 50)');
  await page.getByRole('button', { name: 'Close editor' }).click();

  // radio → checkbox on a PUBLISHED question (start_when)
  await page.getByText('When do you want to start?').first().click();
  await page.getByRole('radio', { name: 'Checkboxes (pick several)' }).check();
  await until(() => psql(`select input_modes->'choose'->>'style' from public.questions where key = 'start_when'`) === 'checkbox', 'style saved', 15000);
  await page.getByRole('button', { name: 'Close editor' }).click();
  ok('radio → checkbox on a published question saved in place');

  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Publish' }).click();
  await until(() => psql(`select count(*) from public.form_versions`) === '2', 'v2 published', 15000);
  ok('published form version 2');

  // old leads still match after radio → checkbox
  await page.goto(`${APP}/admin`);
  await page.getByText('Ramesh Kumar').first().click();
  await page.getByRole('button', { name: 'Re-match now' }).click();
  await page.getByText('Re-matched with the current profiles').waitFor();
  assert(psql(`select tier from public.responses where name = 'Ramesh Kumar'`) === 'ideal', 'old lead still ideal');
  ok('old lead still matches its profile after radio → checkbox');

  // respondent sees primary + quiet links, and the limit applies
  {
    const r = await open({ width: 360, height: 800 }, 'respondent');
    await r.page.goto(`${APP}/f/main-road-shop`);
    await r.page.getByRole('button', { name: 'Start' }).click();
    await r.page.getByRole('radio', { name: 'Rent the shop' }).click();
    await r.page.getByText('What business do you want to run here?').waitFor();
    await r.page.getByRole('button', { name: 'Type instead' }).waitFor();
    await r.page.getByRole('button', { name: 'Speak instead' }).waitFor();
    await r.shot('04-modes');
    ok('respondent: radios first, then quiet "Type instead" / "Speak instead"');
    await r.page.getByRole('button', { name: 'Type instead' }).click();
    const input = r.page.getByLabel('What business do you want to run here?').last();
    assert((await input.getAttribute('maxlength')) === '50', 'maxlength 50');
    await input.pressSequentially('x'.repeat(60));
    assert((await input.inputValue()).length === 50, `typed text capped at 50, got ${(await input.inputValue()).length}`);
    await r.page.getByText('50 / 50').waitFor();
    ok('respondent: 50-character limit enforced (counter 50 / 50)');
    await r.page.getByRole('button', { name: 'Next' }).click();
    await r.page.getByText('When do you want to start?').waitFor();
    await r.page.getByRole('checkbox', { name: 'Immediately' }).waitFor();
    ok('respondent: start_when now offers checkboxes');
    await r.ctx.close();
  }

  // ---------------------------------------------------------------- admins: last owner, invite
  await page.getByRole('link', { name: 'Admins' }).first().click();
  await page.getByText('owner@shop.test').first().waitFor();
  assert(await page.getByRole('button', { name: 'Remove' }).first().isDisabled(), 'last owner remove disabled');
  assert(await page.getByLabel('Role of owner@shop.test').isDisabled(), 'last owner demote disabled');
  ok('the only owner cannot be removed or demoted (controls disabled)');
  await page.getByLabel('Email').last().fill('staff@shop.test');
  await page.getByRole('button', { name: 'Send invite' }).click();
  await page.getByText('staff@shop.test').first().waitFor();
  assert(psql(`select role from public.admins where email = 'staff@shop.test'`) === 'staff', 'staff admin row');
  ok('owner invited staff@shop.test through the admin-invite function');
  await shot('05-admins');

  // ---------------------------------------------------------------- settings: brand & trust
  await page.getByRole('link', { name: 'Settings' }).first().click();
  await page.getByText('Brand & trust').first().waitFor();
  await shot('06-brand');
  ok('settings: Brand & trust section');

  assert(problems.length === 0, `problems:\n${problems.join('\n')}`);
  ok('no page errors and no failed API calls');
  await ctx.close();

  // ---------------------------------------------------------------- staff can't see Admins; non-admin screen
  {
    const s = await open({ width: 390, height: 844 }, 'staff');
    await signIn(s.page, 'staff@shop.test');
    await s.page.getByText('Ramesh Kumar').first().waitFor({ timeout: 15000 });
    assert((await s.page.getByRole('link', { name: 'Admins' }).count()) === 0, 'staff: no Admins nav');
    const overflow = await s.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert(overflow <= 1, `board overflows on a phone by ${overflow}px`);
    ok('staff on a phone: board works, no Admins screen, no horizontal scroll');
    await s.ctx.close();
  }
  psql(`insert into auth.users (id, email) values ('aaaaaaaa-0000-4000-8000-000000000002', 'stranger@shop.test') on conflict do nothing`);
  {
    const s = await open({ width: 800, height: 700 }, 'stranger');
    await signIn(s.page, 'stranger@shop.test');
    await s.page.getByText("You're signed in but not an admin — ask an owner to add you").waitFor({ timeout: 15000 });
    ok('signed-in non-admin sees "You\'re signed in but not an admin — ask an owner to add you"');
    await s.ctx.close();
  }
  void FN;
  console.log(`\nADMIN E2E PASSED (${step} checks)`);
} finally {
  await browser.close();
}
