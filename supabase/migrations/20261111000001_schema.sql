-- Shop Lead Screener — core schema.
-- Every business table carries property_id so a second property is config-only.

set check_function_bodies = off;

-- ---------------------------------------------------------------- properties
create table public.properties (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  name text not null check (length(btrim(name)) between 1 and 120),
  status text not null default 'open' check (status in ('open', 'closed')),
  closed_message text not null default 'This shop is no longer available. Leave your number and we will tell you about the next one.',
  default_lang text not null default 'en' check (default_lang in ('en', 'hi')),
  audio_retention_days int not null default 180 check (audio_retention_days between 7 and 3650),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- admins
create table public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  role text not null default 'staff' check (role in ('owner', 'staff')),
  created_at timestamptz not null default now()
);

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.admins where user_id = auth.uid())
$$;

create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.admins where user_id = auth.uid() and role = 'owner')
$$;

-- ---------------------------------------------------------------- questions (editable draft)
create table public.questions (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties (id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  type text not null check (type in ('single','multi','dropdown','yes_no','short_text','long_text','number','currency','date','voice','contact')),
  label_en text not null default '' check (length(label_en) <= 300),
  label_hi text check (length(label_hi) <= 300),
  help_en text check (length(help_en) <= 500),
  help_hi text check (length(help_hi) <= 500),
  placeholder text check (length(placeholder) <= 120),
  required boolean not null default true,
  position int not null default 0,
  show_if jsonb check (show_if is null or jsonb_typeof(show_if) = 'object'),
  validation jsonb not null default '{}'::jsonb check (jsonb_typeof(validation) = 'object'),
  allow_other boolean not null default false,
  allow_voice boolean not null default false,
  archived_at timestamptz,
  first_published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (property_id, key)
);
create index questions_property_idx on public.questions (property_id, position);

create table public.question_options (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions (id) on delete cascade,
  value text not null check (value ~ '^[a-z0-9][a-z0-9_]{0,39}$'),
  label_en text not null default '' check (length(label_en) <= 200),
  label_hi text check (length(label_hi) <= 200),
  position int not null default 0,
  archived_at timestamptz,
  first_published_at timestamptz,
  created_at timestamptz not null default now(),
  unique (question_id, value)
);
create index question_options_q_idx on public.question_options (question_id, position);

-- ---------------------------------------------------------------- form versions (immutable)
create table public.form_versions (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties (id) on delete cascade,
  version int not null check (version > 0),
  config jsonb not null,
  published_by uuid references auth.users (id) on delete set null,
  published_at timestamptz not null default now(),
  is_current boolean not null default false,
  unique (property_id, version)
);
create unique index form_versions_one_current on public.form_versions (property_id) where is_current;

-- ---------------------------------------------------------------- profiles (versioned)
create table public.profile_sets (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties (id) on delete cascade,
  version int not null check (version > 0),
  status text not null default 'draft' check (status in ('draft', 'published')),
  is_current boolean not null default false,
  settings jsonb not null default '{}'::jsonb,
  based_on_id uuid references public.profile_sets (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  published_by uuid references auth.users (id) on delete set null,
  published_at timestamptz,
  unique (property_id, version),
  check (not is_current or status = 'published')
);
create unique index profile_sets_one_current on public.profile_sets (property_id) where is_current;
create unique index profile_sets_one_draft on public.profile_sets (property_id) where status = 'draft';

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  profile_set_id uuid not null references public.profile_sets (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  description text check (length(description) <= 500),
  active boolean not null default true,
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index profiles_set_idx on public.profiles (profile_set_id, position);

create table public.profile_conditions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  question_key text not null,
  operator text not null check (operator in ('eq','neq','in','not_in','gte','lte','between','contains_any','contains_all','answered','not_answered')),
  value jsonb,
  importance text not null default 'important' check (importance in ('must', 'important', 'nice')),
  position int not null default 0
);
create index profile_conditions_profile_idx on public.profile_conditions (profile_id, position);

create table public.never_rules (
  id uuid primary key default gen_random_uuid(),
  profile_set_id uuid not null references public.profile_sets (id) on delete cascade,
  question_key text not null,
  operator text not null check (operator in ('eq','neq','in','not_in','gte','lte','between','contains_any','contains_all','answered','not_answered')),
  value jsonb,
  label text not null check (length(btrim(label)) between 1 and 120)
);
create index never_rules_set_idx on public.never_rules (profile_set_id);

-- ---------------------------------------------------------------- responses (leads)
create table public.responses (
  id uuid primary key, -- client-generated idempotency key
  property_id uuid not null references public.properties (id) on delete cascade,
  form_version_id uuid references public.form_versions (id),
  profile_set_id uuid references public.profile_sets (id),
  path text not null check (path in ('rent', 'partner', 'either', 'waitlist')),
  answers jsonb not null default '{}'::jsonb,
  name text not null,
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  whatsapp_ok boolean not null default true,
  lang text not null default 'en' check (lang in ('en', 'hi')),
  source text not null default 'qr',
  duration_seconds int not null default 0,
  best_profile_id uuid references public.profiles (id) on delete set null,
  best_match numeric(5, 1),
  profile_matches jsonb not null default '[]'::jsonb,
  match_detail jsonb not null default '{}'::jsonb,
  intent_score int not null default 0,
  priority numeric(6, 2) not null default 0,
  tier text not null default 'maybe' check (tier in ('ideal', 'maybe', 'no')),
  tier_rank smallint generated always as (case tier when 'ideal' then 0 when 'maybe' then 1 else 2 end) stored,
  never_hit jsonb not null default '[]'::jsonb,
  duplicate_of uuid references public.responses (id) on delete set null,
  suspected_bot boolean not null default false,
  pipeline_status text not null default 'new' check (pipeline_status in ('new','contacted','visit_scheduled','negotiating','won','lost')),
  lost_reason text check (length(lost_reason) <= 300),
  pinned boolean not null default false,
  notes text check (length(notes) <= 5000),
  ip_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index responses_board_idx on public.responses (property_id, pinned desc, tier_rank, priority desc, created_at desc);
create index responses_phone_idx on public.responses (property_id, phone_e164, created_at desc);
create index responses_ip_idx on public.responses (ip_hash, created_at desc);

-- ---------------------------------------------------------------- voice notes
create table public.voice_notes (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties (id) on delete cascade,
  response_id uuid not null, -- the response row exists only after submit
  question_key text not null,
  storage_path text not null,
  mime text not null,
  bytes int not null default 0,
  duration_seconds numeric(6, 1) not null default 0,
  upload_count int not null default 1,
  transcript_machine text,
  transcript_final text,
  edited_by_respondent boolean not null default false,
  language text,
  transcript_en text,
  status text not null default 'uploading' check (status in ('uploading','uploaded','transcribing','transcribed','submitted','failed')),
  transcribe_attempts int not null default 0,
  next_attempt_at timestamptz,
  last_error text,
  audio_deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (response_id, question_key)
);
create index voice_notes_work_idx on public.voice_notes (status, next_attempt_at);

-- ---------------------------------------------------------------- events & logs
create table public.lead_events (
  id bigint generated always as identity primary key,
  response_id uuid not null references public.responses (id) on delete cascade,
  property_id uuid not null references public.properties (id) on delete cascade,
  type text not null,
  data jsonb not null default '{}'::jsonb,
  actor uuid,
  created_at timestamptz not null default now()
);
create index lead_events_response_idx on public.lead_events (response_id, created_at);

create table public.funnel_events (
  id bigint generated always as identity primary key,
  property_id uuid not null references public.properties (id) on delete cascade,
  session_id uuid not null,
  event text not null,
  question_key text,
  ms int,
  ip_hash text,
  created_at timestamptz not null default now()
);
create index funnel_events_idx on public.funnel_events (property_id, created_at);

create table public.saved_views (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  property_id uuid not null references public.properties (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 60),
  filters jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  table_name text not null,
  row_id text,
  action text not null,
  old_data jsonb,
  new_data jsonb,
  actor uuid,
  created_at timestamptz not null default now()
);
create index audit_log_created_idx on public.audit_log (created_at desc);

create table public.heartbeat (
  id bigint generated always as identity primary key,
  source text not null,
  created_at timestamptz not null default now()
);

create table public.rate_limits (
  bucket text not null,
  key text not null,
  window_start timestamptz not null,
  count int not null default 0,
  primary key (bucket, key, window_start)
);

create table public.notifications (
  id bigint generated always as identity primary key,
  response_id uuid not null references public.responses (id) on delete cascade,
  kind text not null default 'ideal_lead',
  channel text not null default 'telegram',
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (response_id, kind, channel)
);
create index notifications_work_idx on public.notifications (status, next_attempt_at);

-- ---------------------------------------------------------------- updated_at
create or replace function public.sls_touch() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger touch_properties before update on public.properties for each row execute function public.sls_touch();
create trigger touch_questions before update on public.questions for each row execute function public.sls_touch();
create trigger touch_responses before update on public.responses for each row execute function public.sls_touch();
create trigger touch_voice_notes before update on public.voice_notes for each row execute function public.sls_touch();
