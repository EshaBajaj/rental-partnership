// End-to-end for the admin board: real admin UI → (test) PostgREST/GoTrue stand-in → Postgres,
// running as role `authenticated` so RLS, column grants, triggers and RPCs are real.
// Runs after respondent.e2e.mjs (uses the leads it created). Invoked by scripts/e2e.sh.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const { chromium } = createRequire(import.meta.url)('playwright');
const APP = process.env.APP_URL ?? 'http://localhost:4173';
const DB = process.env.DATABASE_URL;
const SHOTS = process.env.SHOTS_DIR;
const psql = (q) => execFileSync('psql', ['-X', '-qtA', DB, '-c', q], { encoding: 'utf8' }).trim();
let step = 0;
const ok = (m) => console.log(`  ✓ ${++step}. ${m}`);
const assert = (c, m) => {
  if (!c) throw new Error(`ASSERTION FAILED: ${m}`);
};

psql(`insert into auth.users (id, email) values ('aaaaaaaa-0000-4000-8000-000000000001', 'owner@shop.test') on conflict do nothing`);
psql(`insert into public.admins (user_id, email, role) values ('aaaaaaaa-0000-4000-8000-000000000001', 'owner@shop.test', 'owner') on conflict do nothing`);
const OWNER = 'aaaaaaaa-0000-4000-8000-000000000001';

const browser = await chromium.launch();
async function run(viewport, label) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('response', (r) => {
    const u = r.url();
    if (r.status() >= 400 && !u.includes('/realtime/')) problems.push(`${r.status()} ${r.request().method()} ${u}`);
  });
  const shot = async (n) => SHOTS && page.screenshot({ path: `${SHOTS}/admin-${label}-${n}.png`, fullPage: false });
  return { ctx, page, problems, shot };
}

try {
  // ---------------------------------------------------------------- desktop walkthrough
  const { ctx, page, problems, shot } = await run({ width: 1280, height: 900 }, 'desktop');

  await page.goto(`${APP}/admin`);
  await page.getByLabel('Email').fill('owner@shop.test');
  await page.getByLabel('Password').fill('wrong');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('alert').waitFor();
  problems.length = 0; // the 400 for the wrong password is expected
  ok('wrong password is rejected');
  await page.getByLabel('Password').fill('e2e-password');
  await page.getByRole('button', { name: 'Sign in' }).click();

  // board
  await page.getByText('Ramesh Kumar').first().waitFor({ timeout: 15000 });
  await page.getByText('Established retailer (rent)').first().waitFor();
  await shot('01-board');
  ok('board lists ranked leads with best profile');
  // the scripted partner lead finished in < 15 s → suspected bot → hidden by default
  assert(psql(`select suspected_bot from public.responses where name = 'Sunita Devi'`) === 't', 'Sunita flagged as bot');
  assert((await page.getByText('Sunita Devi').count()) === 0, 'suspected bots hidden by default');
  ok('suspected bots are hidden by default');

  // lead detail
  await page.getByText('Ramesh Kumar').first().click();
  await page.getByText('Why this ranking').waitFor();
  await page.getByText('How much monthly rent can you pay? ≥ ₹40,000 — answered ₹45,000').first().waitFor();
  await page.getByText(/edited by respondent/i).first().waitFor();
  await page.getByText('Timeline').waitFor();
  await shot('02-lead');
  ok('lead detail explains the ranking, shows the edited voice transcript and timeline');

  const statusSelect = page.locator('select').filter({ has: page.locator('option[value="contacted"]') }).first();
  await statusSelect.selectOption('contacted');
  await page.waitForFunction(
    () => true,
    null,
    { timeout: 500 },
  );
  for (let i = 0; i < 40 && psql(`select pipeline_status from public.responses where name = 'Ramesh Kumar'`) !== 'contacted'; i++) await page.waitForTimeout(250);
  assert(psql(`select pipeline_status from public.responses where name = 'Ramesh Kumar'`) === 'contacted', 'status saved');
  assert(psql(`select actor from public.lead_events where type = 'status_changed' order by id desc limit 1`) === OWNER, 'status event actor');
  ok('status change saved through RLS with an audited lead event');

  await page.locator('textarea').last().fill('Visiting on Sunday 11am');
  await page.getByRole('button', { name: 'Save notes' }).click();
  for (let i = 0; i < 40 && psql(`select coalesce(notes,'') from public.responses where name = 'Ramesh Kumar'`) !== 'Visiting on Sunday 11am'; i++) await page.waitForTimeout(250);
  assert(psql(`select notes from public.responses where name = 'Ramesh Kumar'`) === 'Visiting on Sunday 11am', 'notes saved');
  ok('notes saved');

  await page.getByRole('button', { name: 'Log call' }).click();
  for (let i = 0; i < 40 && psql(`select count(*) from public.lead_events where type = 'called'`) === '0'; i++) await page.waitForTimeout(250);
  assert(psql(`select count(*) from public.lead_events where type = 'called'`) === '1', 'call logged');
  ok('quick-log "Log call" appended to the timeline');

  await page.getByRole('button', { name: 'Re-match now' }).click();
  await page.getByText('Re-matched with the current profiles').waitFor();
  ok('re-match now');

  // form builder
  await page.getByRole('link', { name: 'Form' }).first().click();
  await page.getByText('When do you want to start?').first().waitFor({ timeout: 15000 });
  await shot('03-form');
  ok('form builder lists the questions');
  assert(!(await page.getByText(/must be first|depends on/).count()), 'seed form shows no validation errors');

  // profiles: draft → live counter → simulate → discard
  await page.getByRole('link', { name: /Profiles/ }).first().click();
  await page.getByRole('button', { name: 'Edit (create draft)' }).click();
  await page.getByText(/current leads qualify/).first().waitFor({ timeout: 15000 });
  await shot('04-profiles-draft');
  ok('profile draft with live counters');
  await page.getByRole('button', { name: 'Simulate' }).click();
  await page.getByText('Simulation (nothing changed yet)').waitFor();
  ok('simulate shows the effect without changing anything');
  await page.getByRole('button', { name: 'Discard draft' }).click();
  await page.getByRole('button', { name: 'Discard', exact: true }).click();
  await page.getByRole('button', { name: 'Edit (create draft)' }).waitFor();
  assert(psql(`select count(*) from public.profile_sets where status = 'draft'`) === '0', 'draft discarded');
  ok('discard draft');

  // settings, funnel, audit
  await page.getByRole('link', { name: 'Settings' }).first().click();
  await page.getByText('QR code').first().waitFor();
  await page.locator('img[alt*="QR"], canvas').first().waitFor();
  await shot('05-settings');
  ok('settings with QR code');
  await page.getByRole('link', { name: 'Funnel' }).first().click();
  await page.waitForTimeout(800);
  await shot('06-funnel');
  ok('funnel renders');
  await page.getByRole('link', { name: 'Audit' }).first().click();
  await page.getByText('Audit log').first().waitFor();
  await page.getByText(/responses/).filter({ visible: true }).first().waitFor();
  await shot('07-audit');
  ok('audit log lists changes');

  assert(problems.length === 0, `problems:\n${problems.join('\n')}`);
  ok('no page errors and no failed API calls');
  await ctx.close();

  // ---------------------------------------------------------------- phone
  const m = await run({ width: 390, height: 844 }, 'phone');
  await m.page.goto(`${APP}/admin/login`);
  await m.page.getByLabel('Email').fill('owner@shop.test');
  await m.page.getByLabel('Password').fill('e2e-password');
  await m.page.getByRole('button', { name: 'Sign in' }).click();
  await m.page.getByText('Ramesh Kumar').first().waitFor({ timeout: 15000 });
  await m.shot('01-board');
  const overflow = await m.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert(overflow <= 1, `board overflows horizontally on a phone by ${overflow}px`);
  ok('board usable on a phone (no horizontal scroll)');
  assert(m.problems.length === 0, `phone problems:\n${m.problems.join('\n')}`);
  await m.ctx.close();

  // ---------------------------------------------------------------- non-admin
  psql(`insert into auth.users (id, email) values ('aaaaaaaa-0000-4000-8000-000000000002', 'stranger@shop.test') on conflict do nothing`);
  const s = await run({ width: 800, height: 700 }, 'stranger');
  await s.page.goto(`${APP}/admin/login`);
  await s.page.getByLabel('Email').fill('stranger@shop.test');
  await s.page.getByLabel('Password').fill('e2e-password');
  await s.page.getByRole('button', { name: 'Sign in' }).click();
  await s.page.getByText('Your account is not an admin').waitFor({ timeout: 15000 });
  ok('signed-in non-admin sees "not an admin" and no data');
  await s.ctx.close();

  console.log(`\nADMIN E2E PASSED (${step} checks)`);
} finally {
  await browser.close();
}
