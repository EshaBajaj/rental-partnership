-- Edit safety + immutability enforced in the database, audit triggers, lead events.

-- ---------------------------------------------------------------- questions
create or replace function public.sls_guard_questions() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.first_published_at is not null then
      raise exception '“%” has been published, so it can only be archived (old answers keep it).', old.label_en using errcode = 'P0001';
    end if;
    if old.key = 'path' then raise exception 'The “Rent / Partner / Either” question cannot be deleted.' using errcode = 'P0001'; end if;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    if new.property_id <> old.property_id then raise exception 'A question cannot move to another property.'; end if;
    if new.key <> old.key and old.first_published_at is not null then
      raise exception 'The key “%” is locked because it has been published.', old.key using errcode = 'P0001';
    end if;
    if new.key <> old.key and old.key = 'path' then raise exception 'The key “path” cannot change.' using errcode = 'P0001'; end if;
    if new.type <> old.type and old.first_published_at is not null
       and not ((old.type, new.type) in (('single','dropdown'), ('dropdown','single'), ('short_text','long_text'), ('long_text','short_text'))) then
      raise exception 'Changing “%” from % to % needs a new question; use “Change type” in the builder.', old.label_en, old.type, new.type using errcode = 'P0001';
    end if;
    if old.key = 'path' and new.archived_at is not null then raise exception 'The “Rent / Partner / Either” question cannot be archived.' using errcode = 'P0001'; end if;
    if new.first_published_at is distinct from old.first_published_at and old.first_published_at is not null then
      new.first_published_at := old.first_published_at;
    end if;
  end if;
  return new;
end $$;
create trigger guard_questions before update or delete on public.questions for each row execute function public.sls_guard_questions();

create or replace function public.sls_guard_options() returns trigger
language plpgsql as $$
declare qkey text;
begin
  if tg_op = 'DELETE' then
    if old.first_published_at is not null then
      -- allow cascades from a (never-published) question delete only
      if exists (select 1 from public.questions where id = old.question_id) then
        raise exception 'The option “%” has been published, so it can only be archived.', old.label_en using errcode = 'P0001';
      end if;
    end if;
    return old;
  end if;
  select key into qkey from public.questions where id = coalesce(new.question_id, old.question_id);
  if tg_op = 'UPDATE' then
    if new.question_id <> old.question_id then raise exception 'An option cannot move to another question.'; end if;
    if new.value <> old.value and old.first_published_at is not null then
      raise exception 'The value “%” is locked because it has been published.', old.value using errcode = 'P0001';
    end if;
    if qkey = 'path' and (new.value <> old.value or new.archived_at is not null) then
      raise exception 'The rent / partner / either answers cannot be changed (only their wording).' using errcode = 'P0001';
    end if;
    if old.first_published_at is not null then new.first_published_at := old.first_published_at; end if;
  end if;
  if tg_op = 'INSERT' and qkey = 'path' and exists (select 1 from public.question_options where question_id = new.question_id and archived_at is null)
     and new.value not in ('rent', 'partner', 'either') then
    raise exception 'The first question only allows rent, partner and either.' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger guard_options before insert or update or delete on public.question_options for each row execute function public.sls_guard_options();

-- ---------------------------------------------------------------- form versions: immutable
create or replace function public.sls_guard_form_versions() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from public.properties where id = old.property_id) then
      raise exception 'Published form versions cannot be deleted.' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if (new.id, new.property_id, new.version, new.config, new.published_by, new.published_at)
     is distinct from (old.id, old.property_id, old.version, old.config, old.published_by, old.published_at) then
    raise exception 'Published form versions are immutable.' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger guard_form_versions before update or delete on public.form_versions for each row execute function public.sls_guard_form_versions();

-- ---------------------------------------------------------------- profile sets: immutable once published
create or replace function public.sls_guard_profile_sets() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'published' and exists (select 1 from public.properties where id = old.property_id) then
      raise exception 'Published profile versions cannot be deleted.' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if old.status = 'published' then
    if new.status <> 'published' or new.settings is distinct from old.settings or new.version <> old.version
       or new.published_at is distinct from old.published_at or new.property_id <> old.property_id then
      raise exception 'Published profile versions are immutable. Create a draft to make changes.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
create trigger guard_profile_sets before update or delete on public.profile_sets for each row execute function public.sls_guard_profile_sets();

create or replace function public.sls_set_status(p_set_id uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select status from public.profile_sets where id = p_set_id
$$;

create or replace function public.sls_guard_profile_children() returns trigger
language plpgsql as $$
declare set_id uuid; st text;
begin
  if tg_table_name = 'profiles' then set_id := coalesce(new.profile_set_id, old.profile_set_id);
  elsif tg_table_name = 'never_rules' then set_id := coalesce(new.profile_set_id, old.profile_set_id);
  else select profile_set_id into set_id from public.profiles where id = coalesce(new.profile_id, old.profile_id);
  end if;
  st := public.sls_set_status(set_id);
  if st = 'published' then
    raise exception 'Published profile versions are immutable. Create a draft to make changes.' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and tg_table_name = 'profiles' then
    if (to_jsonb(new) ->> 'profile_set_id') <> (to_jsonb(old) ->> 'profile_set_id') then
      raise exception 'A profile cannot move to another version.';
    end if;
  end if;
  return coalesce(new, old);
end $$;
create trigger guard_profiles before insert or update or delete on public.profiles for each row execute function public.sls_guard_profile_children();
create trigger guard_profile_conditions before insert or update or delete on public.profile_conditions for each row execute function public.sls_guard_profile_children();
create trigger guard_never_rules before insert or update or delete on public.never_rules for each row execute function public.sls_guard_profile_children();

-- ---------------------------------------------------------------- lead events: append-only
create or replace function public.sls_guard_append_only() returns trigger
language plpgsql as $$
begin
  raise exception '% is append-only.', tg_table_name using errcode = 'P0001';
end $$;
create trigger guard_lead_events before update on public.lead_events for each row execute function public.sls_guard_append_only();
create trigger guard_audit_log before update on public.audit_log for each row execute function public.sls_guard_append_only();

-- ---------------------------------------------------------------- audit
create or replace function public.sls_audit() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare rid text;
begin
  rid := coalesce(to_jsonb(new) ->> 'id', to_jsonb(old) ->> 'id', to_jsonb(new) ->> 'user_id', to_jsonb(old) ->> 'user_id');
  insert into public.audit_log (table_name, row_id, action, old_data, new_data, actor)
  values (tg_table_name, rid, lower(tg_op),
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end,
          auth.uid());
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['questions','question_options','form_versions','profile_sets','profiles','profile_conditions','never_rules','properties','admins'] loop
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$s for each row execute function public.sls_audit()', t);
  end loop;
end $$;

-- responses: audit + lead events for lead-management columns only
create or replace function public.sls_lead_mgmt() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare o jsonb; n jsonb;
begin
  o := jsonb_build_object('pipeline_status', old.pipeline_status, 'lost_reason', old.lost_reason, 'pinned', old.pinned, 'notes', old.notes);
  n := jsonb_build_object('pipeline_status', new.pipeline_status, 'lost_reason', new.lost_reason, 'pinned', new.pinned, 'notes', new.notes);
  if o = n then return new; end if;
  insert into public.audit_log (table_name, row_id, action, old_data, new_data, actor)
  values ('responses', new.id::text, 'update', o, n, auth.uid());
  if new.pipeline_status is distinct from old.pipeline_status then
    insert into public.lead_events (response_id, property_id, type, data, actor)
    values (new.id, new.property_id, 'status_changed',
            jsonb_build_object('from', old.pipeline_status, 'to', new.pipeline_status, 'lost_reason', new.lost_reason), auth.uid());
  end if;
  if new.pinned is distinct from old.pinned then
    insert into public.lead_events (response_id, property_id, type, data, actor)
    values (new.id, new.property_id, case when new.pinned then 'pinned' else 'unpinned' end, '{}'::jsonb, auth.uid());
  end if;
  if new.notes is distinct from old.notes then
    insert into public.lead_events (response_id, property_id, type, data, actor)
    values (new.id, new.property_id, 'notes_updated', jsonb_build_object('notes', left(new.notes, 500)), auth.uid());
  end if;
  return new;
end $$;
create trigger lead_mgmt_responses after update on public.responses for each row execute function public.sls_lead_mgmt();

create or replace function public.sls_lost_reason() returns trigger
language plpgsql as $$
begin
  if new.pipeline_status <> 'lost' then new.lost_reason := null; end if;
  return new;
end $$;
create trigger lost_reason_responses before update on public.responses for each row execute function public.sls_lost_reason();
