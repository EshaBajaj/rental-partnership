# Deploying Shop Lead Screener

Everything runs on free tiers: **Supabase** (database, auth, storage, Edge Functions, cron),
**Groq** (speech-to-text + translation), **Telegram** (alerts), **Cloudflare Pages** (web app),
**GitHub Actions** (CI, deploy, health checks, backups). Plan on about 45 minutes the first time.

> Keep the GitHub repository **private**: the nightly backups (leads, phone numbers, transcripts)
> are stored as workflow artifacts.

---

## 1. Create the accounts and keys

| What | Where | You need |
|---|---|---|
| Supabase project | supabase.com → New project (region: Mumbai `ap-south-1`) | Project ref, anon/publishable key, DB password, connection string |
| Supabase access token | supabase.com → Account → Access tokens | `SUPABASE_ACCESS_TOKEN` |
| Groq API key | console.groq.com → API keys | `GROQ_API_KEY` |
| Telegram bot | Telegram → `@BotFather` → `/newbot` | bot token |
| Telegram chat id | Add the bot to your group (or message it), then open `https://api.telegram.org/bot<TOKEN>/getUpdates` and copy `chat.id` (groups are negative numbers) | `TELEGRAM_CHAT_ID` |
| Cloudflare Pages | dash.cloudflare.com → Workers & Pages → Create → Pages → *Direct upload*, name e.g. `shop-leads` | project name, account id, API token with **Cloudflare Pages: Edit** |

Generate two random secrets (keep them; never reuse):

```bash
openssl rand -hex 32
```

```bash
openssl rand -hex 32
```

The first is `CRON_SECRET` (authorises pg_cron/GitHub → worker & health), the second is `IP_SALT`
(IPs are only ever stored as `sha256(ip + IP_SALT)`). Also pick a long `BACKUP_PASSPHRASE`.

## 2. Configure GitHub

Repository → Settings → Secrets and variables → Actions. Create an **environment** called
`production` (Settings → Environments) and add these there or at repository level.

**Secrets**

| Name | Value |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | personal access token |
| `SUPABASE_PROJECT_REF` | e.g. `abcdefghijklmnopqrst` |
| `SUPABASE_DB_PASSWORD` | database password |
| `SUPABASE_DB_URL` | Supabase → Connect → *Session pooler* URI (with password) |
| `SUPABASE_ANON_KEY` | anon / publishable key (safe in the browser) |
| `GROQ_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | from step 1 |
| `CRON_SECRET`, `IP_SALT`, `BACKUP_PASSPHRASE` | from step 1 |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | from step 1 |

**Variables**

| Name | Example |
|---|---|
| `APP_URL` | `https://shop-leads.pages.dev` (or your custom domain, no trailing slash) |
| `CLOUDFLARE_PAGES_PROJECT` | `shop-leads` |
| `DEFAULT_SLUG` | `main-road-shop` |
| `GROQ_TRANSLATE_MODELS` *(optional)* | `llama-3.1-8b-instant,llama-3.3-70b-versatile` — tried in order |

## 3. Configure Supabase (dashboard, once)

1. **Database → Extensions**: enable `pg_cron` and `pg_net` *before* the first deploy (the migration
   schedules the jobs only when both exist). If you enable them later, re-run the last migration's
   `do $$ … $$` block from `supabase/migrations/20261111000008_storage_realtime_cron.sql` in the SQL editor.
2. **Authentication → Sign In / Providers → Email**: keep email enabled; **turn off "Allow new users to sign up"**.
3. **Authentication → URL Configuration**: Site URL = your `APP_URL`; add `APP_URL/admin` to redirect URLs.

## 4. Deploy

Push to `main` (CI must pass) or run **Actions → Deploy → Run workflow**. The workflow:

1. `supabase db push --include-seed` — applies migrations; the seed creates the first property
   (`main-road-shop`) with a starter questionnaire and two Ideal Profiles (it does nothing if the property exists);
2. stores `project_url` and `cron_secret` in **Supabase Vault** (pg_cron uses them to call the worker every minute);
3. sets the function secrets and deploys all 8 Edge Functions (`--no-verify-jwt`; each function does its own checks);
4. builds the web app (fails if the respondent bundle exceeds 150 KB gzipped) and uploads it to Cloudflare Pages;
5. smoke-tests `form` and `health?deep=1`.

## 5. Create the owner account

1. Supabase → Authentication → Users → **Add user → Create new user**: your email, a strong password,
   tick **Auto Confirm User**.
2. SQL editor:

   ```sql
   insert into public.admins (user_id, email, role)
   select id, email, 'owner' from auth.users where email = 'you@example.com';
   ```

3. Open `APP_URL/admin`, sign in. Add staff later: create their user the same way, then **Settings → Admins → Add** with their email.

## 6. Go live checklist

- [ ] **Settings → Send Telegram test** arrives in the chat.
- [ ] `curl -H "Authorization: Bearer $CRON_SECRET" https://<ref>.supabase.co/functions/v1/health?deep=1`
      returns `"ok": true`. The `groq` check confirms `whisper-large-v3` and the first translation model
      are available on your Groq account. If the translation model is retired, set `GROQ_TRANSLATE_MODELS`.
- [ ] Within 10 minutes `pg_cron` and `worker` checks are green (heartbeat every 5 min, worker every minute).
- [ ] Edit the questionnaire and the Ideal Profiles for your shop, **Publish** both.
- [ ] Fill the form yourself from a phone (try a voice answer). The lead appears live on the board.
- [ ] **Settings → QR code** → download / print the poster.

## Operations

| Job | Where | Schedule |
|---|---|---|
| Transcription retries, Hindi→English translation, notification retries, audio retention | `transcribe-worker` via pg_cron | every minute |
| Heartbeat | pg_cron → `heartbeat` table | every 5 min |
| Rate-limit / heartbeat cleanup | pg_cron → `housekeeping()` | daily |
| Deep health check + keep-alive (free projects pause after a week idle) | GitHub Actions `health.yml` | every 6 h — a failure emails you |
| Encrypted database backup | GitHub Actions `backup.yml` | nightly, kept 30 days |

**Nothing is silently lost.** Recordings are stored before transcription. A transcription that fails or
times out is retried by the worker with backoff (6 attempts), after which the lead shows a
`voice_failed` event, and the audio stays playable. Telegram failures are retried 8 times, then show as
`notify_failed` on the lead and make `health` red. Respondents who lose connection keep their answers
on the phone and are re-sent automatically (the client-generated id makes retries idempotent).

### Rollback

- **Questionnaire:** Admin → Form → Versions → *Restore this version* (creates a new version with the old config).
- **Ideal Profiles:** Admin → Profiles → Versions → *Roll back* (re-matches every lead in one transaction).
- **Web app:** Cloudflare Pages → Deployments → *Rollback* on a previous deployment.
- **Functions:** re-run *Deploy* on an older commit (Actions → Deploy → Run workflow → pick the branch/tag).
- **Database:** migrations are forward-only. Restore from a backup (below) only for data loss.

### Restore a backup

```bash
gpg --decrypt backup-<stamp>.tgz.gpg > backup.tgz && tar xzf backup.tgz
```

```bash
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f dump/data.sql
```

(Restore into a fresh project after `supabase db push`, or truncate the affected tables first.)

### Local development

```bash
npm install
```

```bash
cp apps/web/.env.example apps/web/.env.local   # point at your Supabase project
```

```bash
npm run dev
```

Tests (need Postgres ≥ 15 and Deno 2; `DATABASE_URL` points at a server where you may create databases):

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres npm run check
```

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres bash scripts/e2e.sh
```

### Adding a second property

Insert a row in `properties` (unique `slug`), then build its questionnaire and profiles in the admin
(property switcher), publish both, and print its QR code. Everything is scoped by `property_id`.

### Costs and limits (free tiers)

Supabase free: 500 MB database, 1 GB storage (≈ 2,000 minutes of compressed voice), 500k function
invocations/month. Groq free tier rate limits apply. 429s are retried automatically. Audio older than
`audio_retention_days` (default 180) is deleted, and transcripts are kept.
