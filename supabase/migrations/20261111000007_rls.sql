-- Row level security + grants.
-- anon: NO table access (public traffic only through Edge Functions with the service role).
-- authenticated: admins read everything; write config + lead-management columns; owner manages admins.

do $$
declare t text;
begin
  foreach t in array array['properties','admins','questions','question_options','form_versions','profile_sets','profiles',
    'profile_conditions','never_rules','responses','voice_notes','lead_events','funnel_events','saved_views','audit_log',
    'heartbeat','rate_limits','notifications'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated, public', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke execute on functions from anon, public;
revoke execute on all functions in schema public from anon, public;
grant usage on schema public to anon, authenticated, service_role;
grant usage, select on all sequences in schema public to service_role;

-- service_role bypasses RLS on Supabase; on vanilla Postgres it needs explicit policies too.
do $$
declare t text;
begin
  foreach t in array array['properties','admins','questions','question_options','form_versions','profile_sets','profiles',
    'profile_conditions','never_rules','responses','voice_notes','lead_events','funnel_events','saved_views','audit_log',
    'heartbeat','rate_limits','notifications'] loop
    execute format('create policy service_all on public.%I for all to service_role using (true) with check (true)', t);
  end loop;
end $$;

-- properties
grant select, update on public.properties to authenticated;
grant insert, delete on public.properties to authenticated;
create policy admin_read on public.properties for select to authenticated using (public.is_admin());
create policy admin_update on public.properties for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy owner_insert on public.properties for insert to authenticated with check (public.is_owner());
create policy owner_delete on public.properties for delete to authenticated using (public.is_owner());

-- admins (owner-only management; everyone can see their own row)
grant select, insert, update, delete on public.admins to authenticated;
create policy self_or_owner_read on public.admins for select to authenticated using (user_id = auth.uid() or public.is_owner());
create policy owner_write on public.admins for insert to authenticated with check (public.is_owner());
create policy owner_update on public.admins for update to authenticated using (public.is_owner()) with check (public.is_owner());
create policy owner_delete on public.admins for delete to authenticated using (public.is_owner() and user_id <> auth.uid());

-- config tables: admin read/write (published-row immutability is enforced by triggers)
do $$
declare t text;
begin
  foreach t in array array['questions','question_options','profiles','profile_conditions','never_rules'] loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('create policy admin_all on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
end $$;

-- profile sets: read all, update draft settings; creation/publish through RPCs
grant select, update on public.profile_sets to authenticated;
create policy admin_read on public.profile_sets for select to authenticated using (public.is_admin());
create policy admin_update_draft on public.profile_sets for update to authenticated using (public.is_admin() and status = 'draft') with check (public.is_admin());

-- form versions: read only (publish through RPC)
grant select on public.form_versions to authenticated;
create policy admin_read on public.form_versions for select to authenticated using (public.is_admin());

-- responses: read all; update ONLY lead-management columns
grant select on public.responses to authenticated;
grant update (pipeline_status, lost_reason, pinned, notes) on public.responses to authenticated;
create policy admin_read on public.responses for select to authenticated using (public.is_admin());
create policy admin_update on public.responses for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- voice notes, funnel, heartbeat, notifications, audit: read only
do $$
declare t text;
begin
  foreach t in array array['voice_notes','funnel_events','heartbeat','notifications','audit_log'] loop
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy admin_read on public.%I for select to authenticated using (public.is_admin())', t);
  end loop;
end $$;

-- lead events: read; admins may append manual events (call / whatsapp / note)
grant select, insert on public.lead_events to authenticated;
create policy admin_read on public.lead_events for select to authenticated using (public.is_admin());
create policy admin_append on public.lead_events for insert to authenticated
  with check (public.is_admin() and type in ('called', 'whatsapp_sent', 'note', 'visit') and actor = auth.uid());

-- saved views: own rows
grant select, insert, update, delete on public.saved_views to authenticated;
create policy own_views on public.saved_views for all to authenticated
  using (public.is_admin() and user_id = auth.uid()) with check (public.is_admin() and user_id = auth.uid());

-- ---------------------------------------------------------------- function grants
-- admin RPCs (each checks is_admin() itself)
grant execute on function
  public.is_admin(), public.is_owner(),
  public.publish_form(uuid), public.restore_form_version(uuid), public.sls_compile_form(uuid), public.sls_validate_draft(uuid),
  public.reorder_questions(uuid, uuid[]), public.reorder_options(uuid, uuid[]),
  public.create_profile_draft(uuid), public.discard_profile_draft(uuid),
  public.remove_question_or_option(uuid, uuid, jsonb, uuid[], uuid[]), public.replace_question_type(uuid, text, text),
  public.match_response(uuid, uuid), public.apply_match(uuid), public.publish_profile_set(uuid),
  public.simulate_profile_set(uuid), public.live_profile_count(uuid, jsonb)
to authenticated;

-- service RPCs
grant execute on function
  public.rate_limit_hit(text, text, int, int), public.submit_response(jsonb),
  public.voice_prepare_upload(uuid, uuid, text, text, int, numeric), public.voice_begin_transcribe(uuid, text),
  public.voice_claim_transcribe(int), public.voice_save_transcript(uuid, text, text, numeric),
  public.voice_mark_failed(uuid, text, int), public.voice_claim_translate(int), public.voice_save_translation(uuid, text),
  public.notification_claim(int, uuid), public.notification_done(bigint, boolean, text),
  public.audio_expired(int), public.audio_mark_deleted(uuid[]), public.housekeeping(), public.health_snapshot(),
  public.apply_match(uuid), public.publish_profile_set(uuid)
to service_role;

-- the pure engine helpers are harmless; let admins and the service use them (e.g. previews)
grant execute on function public.sls_eval_showif(jsonb, jsonb), public.sls_eval_op(text, jsonb, jsonb),
  public.sls_visible_keys(jsonb, jsonb), public.sls_compute_match(jsonb, jsonb, int, boolean, text, jsonb)
to authenticated, service_role;
grant execute on all functions in schema public to service_role;

-- ---------------------------------------------------------------- owner helper: add an admin by email
create or replace function public.add_admin(p_email text, p_role text default 'staff') returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid;
begin
  if not public.is_owner() then raise exception 'Only the owner can add admins.' using errcode = '42501'; end if;
  if p_role not in ('owner', 'staff') then raise exception 'Role must be owner or staff.'; end if;
  select id into uid from auth.users where lower(email) = lower(btrim(p_email));
  if uid is null then
    raise exception 'No account for %. Ask them to sign up / be invited in Supabase Auth first.', p_email using errcode = 'P0001';
  end if;
  insert into public.admins (user_id, email, role) values (uid, lower(btrim(p_email)), p_role)
  on conflict (user_id) do update set role = excluded.role;
  return uid;
end $$;
revoke execute on function public.add_admin(text, text) from public, anon;
grant execute on function public.add_admin(text, text) to authenticated;
