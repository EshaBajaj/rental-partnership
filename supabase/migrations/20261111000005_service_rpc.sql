-- Service-role RPCs used by the Edge Functions (never exposed to anon/authenticated).

alter table public.voice_notes add column translate_attempts int not null default 0;

-- ---------------------------------------------------------------- rate limiting (fixed window)
create or replace function public.rate_limit_hit(p_bucket text, p_key text, p_max int, p_window_seconds int) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare ws timestamptz; c int;
begin
  ws := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into public.rate_limits (bucket, key, window_start, count) values (p_bucket, p_key, ws, 1)
  on conflict (bucket, key, window_start) do update set count = public.rate_limits.count + 1
  returning count into c;
  return c <= p_max;
end $$;

-- ---------------------------------------------------------------- submit
-- p: {id, property_id, form_version_id, path, answers, voice_finals:{key:text}, name, phone_e164,
--     whatsapp_ok, lang, source, duration_seconds, ip_hash}
create or replace function public.submit_response(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  rid uuid := (p ->> 'id')::uuid;
  prop uuid := (p ->> 'property_id')::uuid;
  existing public.responses;
  cfg jsonb; setj jsonb; m jsonb;
  answers jsonb := coalesce(p -> 'answers', '{}'::jsonb);
  k text; final text; note public.voice_notes; dup uuid; notify boolean := false;
begin
  select * into existing from public.responses where id = rid;
  if found then
    if existing.property_id <> prop then raise exception 'id_conflict' using errcode = 'P0001'; end if;
    return jsonb_build_object('status', 'existing', 'id', existing.id, 'tier', existing.tier);
  end if;

  if (p ->> 'form_version_id') is not null then
    select config into cfg from public.form_versions where id = (p ->> 'form_version_id')::uuid and property_id = prop;
    if cfg is null then raise exception 'unknown_form_version' using errcode = 'P0001'; end if;
  end if;

  -- attach voice notes (accept the respondent's final transcript)
  for k, final in select key, value from jsonb_each_text(coalesce(p -> 'voice_finals', '{}'::jsonb)) loop
    select * into note from public.voice_notes where response_id = rid and question_key = k for update;
    if not found then
      -- no audio arrived: keep typed text, drop empty answers
      if coalesce(final, '') = '' then answers := answers - k; end if;
      continue;
    end if;
    final := left(coalesce(final, ''), 2000);
    update public.voice_notes set
      transcript_final = nullif(final, ''),
      edited_by_respondent = case when transcript_machine is null then final <> '' else final is distinct from transcript_machine end,
      status = 'submitted', next_attempt_at = coalesce(next_attempt_at, now())
    where id = note.id;
    answers := jsonb_set(answers, array[k, 'voice_note_id'], to_jsonb(note.id::text));
  end loop;

  setj := public.sls_current_set_json(prop);
  m := public.sls_compute_match(cfg, answers, coalesce((p ->> 'duration_seconds')::int, 0),
                                coalesce((p ->> 'whatsapp_ok')::boolean, true), p ->> 'path', setj);

  select id into dup from public.responses
   where property_id = prop and phone_e164 = p ->> 'phone_e164' and created_at > now() - interval '30 days'
   order by created_at asc limit 1;

  insert into public.responses (
    id, property_id, form_version_id, profile_set_id, path, answers, name, phone_e164, whatsapp_ok, lang, source,
    duration_seconds, best_profile_id, best_match, profile_matches, match_detail, intent_score, priority, tier,
    never_hit, duplicate_of, suspected_bot, ip_hash)
  values (
    rid, prop, (p ->> 'form_version_id')::uuid, (m ->> 'profile_set_id')::uuid, p ->> 'path', answers,
    p ->> 'name', p ->> 'phone_e164', coalesce((p ->> 'whatsapp_ok')::boolean, true), coalesce(p ->> 'lang', 'en'),
    coalesce(p ->> 'source', 'qr'), coalesce((p ->> 'duration_seconds')::int, 0),
    (m ->> 'best_profile_id')::uuid, (m ->> 'best_match')::numeric, m -> 'profile_matches',
    jsonb_build_object('best_profile_name', m -> 'best_profile_name', 'best_qualified', m -> 'best_qualified',
                       'intent_breakdown', m -> 'intent_breakdown', 'visible_keys', m -> 'visible_keys',
                       'profile_set_version', m -> 'profile_set_version', 'matched_at', now()),
    (m ->> 'intent_score')::int, (m ->> 'priority')::numeric, m ->> 'tier', m -> 'never_hit', dup,
    (m ->> 'suspected_bot')::boolean, p ->> 'ip_hash')
  on conflict (id) do nothing;
  if not found then
    select * into existing from public.responses where id = rid;
    return jsonb_build_object('status', 'existing', 'id', existing.id, 'tier', existing.tier);
  end if;

  insert into public.lead_events (response_id, property_id, type, data)
  values (rid, prop, 'created', jsonb_build_object('path', p ->> 'path', 'source', p ->> 'source', 'tier', m ->> 'tier',
          'best_profile', m ->> 'best_profile_name', 'best_match', m -> 'best_match'));
  if dup is not null then
    insert into public.lead_events (response_id, property_id, type, data)
    values (rid, prop, 'duplicate', jsonb_build_object('duplicate_of', dup));
  end if;

  if m ->> 'tier' = 'ideal' and dup is null and not (m ->> 'suspected_bot')::boolean then
    insert into public.notifications (response_id, kind) values (rid, 'ideal_lead') on conflict do nothing;
    notify := true;
  end if;
  return jsonb_build_object('status', 'created', 'id', rid, 'tier', m ->> 'tier', 'notify', notify, 'duplicate_of', dup);
end $$;

-- ---------------------------------------------------------------- voice upload
create or replace function public.voice_prepare_upload(
  p_property_id uuid, p_response_id uuid, p_question_key text, p_mime text, p_bytes int, p_duration numeric
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare note public.voice_notes; total numeric; ext text; path text; cnt int; prev text;
begin
  if exists (select 1 from public.responses where id = p_response_id) then
    raise exception 'already_submitted' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtext('voice:' || p_response_id));
  select * into note from public.voice_notes where response_id = p_response_id and question_key = p_question_key for update;
  if found and note.property_id <> p_property_id then raise exception 'id_conflict' using errcode = 'P0001'; end if;
  if found and note.upload_count >= 3 then raise exception 'too_many_recordings' using errcode = 'P0001'; end if;
  select coalesce(sum(duration_seconds), 0) into total from public.voice_notes
   where response_id = p_response_id and question_key <> p_question_key;
  if total + p_duration > 300 then raise exception 'audio_limit' using errcode = 'P0001'; end if;
  ext := case p_mime when 'audio/webm' then 'webm' when 'audio/ogg' then 'ogg' when 'audio/mp4' then 'm4a'
                     when 'audio/mpeg' then 'mp3' when 'audio/wav' then 'wav' else null end;
  if ext is null then raise exception 'bad_mime' using errcode = 'P0001'; end if;
  cnt := coalesce(note.upload_count, 0) + 1;
  path := format('%s/%s/%s-%s.%s', p_property_id, p_response_id, p_question_key, cnt, ext);
  prev := note.storage_path;
  insert into public.voice_notes (property_id, response_id, question_key, storage_path, mime, bytes, duration_seconds, upload_count, status)
  values (p_property_id, p_response_id, p_question_key, path, p_mime, p_bytes, p_duration, cnt, 'uploading')
  on conflict (response_id, question_key) do update set
    storage_path = excluded.storage_path, mime = excluded.mime, bytes = excluded.bytes,
    duration_seconds = excluded.duration_seconds, upload_count = excluded.upload_count, status = 'uploading',
    transcript_machine = null, transcript_final = null, transcript_en = null, language = null,
    edited_by_respondent = false, transcribe_attempts = 0, translate_attempts = 0, next_attempt_at = null, last_error = null;
  return jsonb_build_object('path', path, 'previous_path', prev, 'upload_count', cnt);
end $$;

-- Start a synchronous transcription (transcribe-now). Returns the note or the existing transcript.
create or replace function public.voice_begin_transcribe(p_response_id uuid, p_question_key text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare note public.voice_notes;
begin
  select * into note from public.voice_notes where response_id = p_response_id and question_key = p_question_key for update;
  if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
  if note.transcript_machine is not null then
    return jsonb_build_object('done', true, 'text', note.transcript_machine, 'language', note.language);
  end if;
  if note.transcribe_attempts >= 6 then raise exception 'too_many_attempts' using errcode = 'P0001'; end if;
  update public.voice_notes set
    status = case when status = 'submitted' then status else 'transcribing' end,
    transcribe_attempts = transcribe_attempts + 1,
    next_attempt_at = now() + interval '2 minutes' -- lease, so the worker does not race us
  where id = note.id;
  return jsonb_build_object('done', false, 'id', note.id, 'storage_path', note.storage_path, 'mime', note.mime, 'status', note.status);
end $$;

-- Worker: claim notes that still need a machine transcript.
create or replace function public.voice_claim_transcribe(p_limit int default 5) returns setof public.voice_notes
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return query
  update public.voice_notes v set transcribe_attempts = v.transcribe_attempts + 1,
         status = case when v.status = 'submitted' then 'submitted' else 'transcribing' end,
         next_attempt_at = now() + interval '5 minutes'
  where v.id in (
    select id from public.voice_notes
    where transcript_machine is null and audio_deleted_at is null and transcribe_attempts < 6
      and status in ('uploaded', 'submitted', 'transcribing', 'uploading')
      and (status <> 'uploading' or created_at < now() - interval '10 minutes')
      and (next_attempt_at is null or next_attempt_at <= now())
      and (status = 'submitted' or exists (select 1 from public.responses r where r.id = voice_notes.response_id)
           or created_at < now() - interval '10 minutes')
    order by (status = 'submitted') desc, created_at
    limit p_limit for update skip locked)
  returning v.*;
end $$;

create or replace function public.voice_save_transcript(p_note_id uuid, p_text text, p_language text, p_duration numeric default null)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare note public.voice_notes; r public.responses; a jsonb;
begin
  update public.voice_notes set
    transcript_machine = left(coalesce(p_text, ''), 5000),
    language = p_language,
    duration_seconds = coalesce(p_duration, duration_seconds),
    status = case when status = 'submitted' then 'submitted' else 'transcribed' end,
    last_error = null, next_attempt_at = null
  where id = p_note_id returning * into note;
  if not found then return; end if;

  -- respondent submitted before the transcript was ready: fill the answer so nothing is lost
  select * into r from public.responses where id = note.response_id for update;
  if found then
    a := r.answers -> note.question_key;
    if a is not null and coalesce(a ->> 'value', '') = '' and coalesce(p_text, '') <> '' then
      update public.responses set answers = jsonb_set(answers, array[note.question_key],
        a || jsonb_build_object('value', left(p_text, 2000), 'display', left(p_text, 2000)))
      where id = r.id;
      update public.voice_notes set transcript_final = left(p_text, 2000), edited_by_respondent = false where id = note.id;
      perform public.sls_store_match(r.id, public.sls_match_with((select x from public.responses x where x.id = r.id),
                                     public.sls_current_set_json(r.property_id)), 'voice transcribed');
    end if;
    insert into public.lead_events (response_id, property_id, type, data)
    values (r.id, r.property_id, 'voice_transcribed', jsonb_build_object('question_key', note.question_key, 'language', p_language));
  end if;
end $$;

create or replace function public.voice_mark_failed(p_note_id uuid, p_error text, p_retry_seconds int default 60) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare note public.voice_notes;
begin
  select * into note from public.voice_notes where id = p_note_id for update;
  if not found then return; end if;
  if note.transcribe_attempts >= 6 then
    update public.voice_notes set status = 'failed', last_error = left(p_error, 1000), next_attempt_at = null where id = note.id;
    insert into public.lead_events (response_id, property_id, type, data)
    select r.id, r.property_id, 'voice_failed', jsonb_build_object('question_key', note.question_key, 'error', left(p_error, 300))
    from public.responses r where r.id = note.response_id;
  else
    update public.voice_notes set
      status = case when status = 'submitted' then 'submitted' else 'uploaded' end,
      last_error = left(p_error, 1000),
      next_attempt_at = now() + make_interval(secs => p_retry_seconds * power(2, greatest(note.transcribe_attempts - 1, 0)))
    where id = note.id;
  end if;
end $$;

create or replace function public.voice_claim_translate(p_limit int default 5) returns setof public.voice_notes
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return query
  update public.voice_notes v set translate_attempts = v.translate_attempts + 1
  where v.id in (
    select id from public.voice_notes
    where status = 'submitted' and transcript_en is null and translate_attempts < 5
      and coalesce(transcript_final, transcript_machine, '') <> ''
      and language is not null and lower(language) not in ('en', 'english')
    order by created_at limit p_limit for update skip locked)
  returning v.*;
end $$;

create or replace function public.voice_save_translation(p_note_id uuid, p_text text) returns void
language sql security definer set search_path = public, pg_temp as $$
  update public.voice_notes set transcript_en = left(p_text, 5000) where id = p_note_id
$$;

-- ---------------------------------------------------------------- notifications
create or replace function public.notification_claim(p_limit int default 10, p_response_id uuid default null)
returns setof public.notifications
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return query
  update public.notifications n set attempts = n.attempts + 1, next_attempt_at = now() + interval '5 minutes'
  where n.id in (
    select id from public.notifications
    where status = 'pending' and next_attempt_at <= now() and (p_response_id is null or response_id = p_response_id)
    order by created_at limit p_limit for update skip locked)
  returning n.*;
end $$;

create or replace function public.notification_done(p_id bigint, p_ok boolean, p_error text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare n public.notifications;
begin
  select * into n from public.notifications where id = p_id for update;
  if not found then return; end if;
  if p_ok then
    update public.notifications set status = 'sent', sent_at = now(), last_error = null where id = p_id;
    insert into public.lead_events (response_id, property_id, type, data)
    select r.id, r.property_id, 'notified', jsonb_build_object('channel', n.channel, 'kind', n.kind) from public.responses r where r.id = n.response_id;
  elsif n.attempts >= 8 then
    update public.notifications set status = 'failed', last_error = left(p_error, 1000) where id = p_id;
    insert into public.lead_events (response_id, property_id, type, data)
    select r.id, r.property_id, 'notify_failed', jsonb_build_object('channel', n.channel, 'error', left(p_error, 300)) from public.responses r where r.id = n.response_id;
  else
    update public.notifications set last_error = left(p_error, 1000),
      next_attempt_at = now() + make_interval(mins => power(2, n.attempts)::int) where id = p_id;
  end if;
end $$;

-- ---------------------------------------------------------------- retention
create or replace function public.audio_expired(p_limit int default 50) returns table (id uuid, storage_path text)
language sql security definer set search_path = public, pg_temp as $$
  select v.id, v.storage_path from public.voice_notes v join public.properties p on p.id = v.property_id
  where v.audio_deleted_at is null and v.created_at < now() - make_interval(days => p.audio_retention_days)
  union all
  -- recordings from forms that were never submitted
  select v.id, v.storage_path from public.voice_notes v
  where v.audio_deleted_at is null and v.created_at < now() - interval '7 days'
    and not exists (select 1 from public.responses r where r.id = v.response_id)
  limit p_limit
$$;

create or replace function public.audio_mark_deleted(p_ids uuid[]) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.voice_notes set audio_deleted_at = now() where id = any (p_ids);
  -- orphans (never submitted) carry no lead data: remove the rows entirely
  delete from public.voice_notes v where v.id = any (p_ids)
    and not exists (select 1 from public.responses r where r.id = v.response_id);
end $$;

create or replace function public.housekeeping() returns void
language sql security definer set search_path = public, pg_temp as $$
  delete from public.rate_limits where window_start < now() - interval '2 days';
  delete from public.heartbeat where created_at < now() - interval '30 days';
$$;

-- health snapshot for the health function
create or replace function public.health_snapshot() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'now', now(),
    'last_heartbeat', (select max(created_at) from public.heartbeat where source = 'pg_cron'),
    'last_worker_run', (select max(created_at) from public.heartbeat where source = 'transcribe-worker'),
    'voice_pending', (select count(*) from public.voice_notes where transcript_machine is null and status in ('uploaded','submitted','transcribing') and audio_deleted_at is null),
    'voice_stuck', (select count(*) from public.voice_notes where transcript_machine is null and status = 'submitted' and created_at < now() - interval '1 hour'),
    'voice_failed', (select count(*) from public.voice_notes where status = 'failed'),
    'notify_pending', (select count(*) from public.notifications where status = 'pending'),
    'notify_failed', (select count(*) from public.notifications where status = 'failed'),
    'responses_24h', (select count(*) from public.responses where created_at > now() - interval '24 hours'))
$$;
