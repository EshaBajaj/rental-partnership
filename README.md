# Shop Lead Screener

A shop is offered for **rent or partnership**. A QR code opens a mobile-first questionnaire
(one question per screen, English/Hindi, answer by voice or text). The **admin board** ranks every
lead against the owner's *Ideal Profiles* and explains every ranking.

| | |
|---|---|
| `apps/web` | Vite + React 18 + TS. Respondent form at `/f/:slug` (< 150 KB gz), admin at `/admin` (code-split) |
| `supabase/migrations` | Schema, RLS, show-if + matching engine (SQL), RPCs, guards, audit, cron |
| `supabase/functions` | Edge Functions: `form` `track` `voice-upload-url` `transcribe-now` `transcribe-worker` `submit` `notify` `health` `admin-invite` |
| `supabase/functions/_shared` | Shared TS used by **both** web and functions: show-if engine, publish validator, answer validation, phone normalisation, edit-safety rules, zod schemas |
| `supabase/tests` | SQL tests (matching, profiles, form safety, RLS, voice, TS↔SQL parity) |
| `scripts` | `test-db.sh`, `test-functions.sh`, `e2e.sh` (real UI → real handlers → Postgres), bundle budget |
| `docs` | [DEPLOY.md](docs/DEPLOY.md) · [ADMIN_GUIDE.md](docs/ADMIN_GUIDE.md) |

```bash
npm install
```

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres npm run check
```

See **docs/DEPLOY.md** to go live.
