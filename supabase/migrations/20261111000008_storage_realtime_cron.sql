-- Private voice-notes bucket, realtime publication, scheduled jobs.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('voice-notes', 'voice-notes', false, 10485760,
        array['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Admins can read (create 1h signed URLs for) voice notes. Uploads use signed upload URLs
-- minted by the service role; nobody else can list or read.
create policy "admins read voice notes" on storage.objects for select to authenticated
  using (bucket_id = 'voice-notes' and public.is_admin());

-- Realtime: board updates live
do $$ begin
  if exists (select from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.responses, public.voice_notes;
  end if;
end $$;

-- ---------------------------------------------------------------- scheduled jobs
-- Calls an Edge Function using two Vault secrets the operator creates once (see docs/DEPLOY.md):
--   project_url  = https://<ref>.supabase.co
--   cron_secret  = the same value as the CRON_SECRET function secret
create or replace function public.sls_call_function(p_name text, p_body jsonb default '{}'::jsonb) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare url text; secret text; rid bigint;
begin
  select decrypted_secret into url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'cron_secret';
  if url is null or secret is null then
    raise warning 'sls_call_function: vault secrets project_url / cron_secret are missing';
    return null;
  end if;
  execute 'select net.http_post(url := $1, headers := $2, body := $3, timeout_milliseconds := 55000)'
    into rid
    using rtrim(url, '/') || '/functions/v1/' || p_name,
          jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || secret),
          p_body;
  return rid;
end $$;
revoke execute on function public.sls_call_function(text, jsonb) from public, anon, authenticated;

do $$
begin
  if exists (select from pg_available_extensions where name = 'pg_cron')
     and exists (select from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_cron;
    create extension if not exists pg_net;
    perform cron.schedule('sls-heartbeat', '*/5 * * * *', $job$ insert into public.heartbeat (source) values ('pg_cron') $job$);
    perform cron.schedule('sls-transcribe-worker', '* * * * *', $job$ select public.sls_call_function('transcribe-worker') $job$);
    perform cron.schedule('sls-housekeeping', '17 3 * * *', $job$ select public.housekeeping() $job$);
  else
    raise notice 'pg_cron / pg_net not available: scheduled jobs not created (fine for local tests).';
  end if;
end $$;
