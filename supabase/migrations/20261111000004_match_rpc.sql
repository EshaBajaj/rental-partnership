-- Matching RPCs: match_response, apply_match, publish/simulate profile sets, live counter.

create or replace function public.sls_current_set_json(p_property_id uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select public.sls_profile_set_json(id) from public.profile_sets where property_id = p_property_id and is_current),
    jsonb_build_object('id', null, 'version', null, 'settings', public.sls_default_settings(), 'profiles', '[]'::jsonb, 'never', '[]'::jsonb))
$$;

create or replace function public.sls_match_with(p_response public.responses, p_set jsonb) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select public.sls_compute_match(
    (select config from public.form_versions where id = p_response.form_version_id),
    p_response.answers, p_response.duration_seconds, p_response.whatsapp_ok, p_response.path, p_set)
$$;

-- match_response(response_id, profile_set_id default current) → jsonb (no writes)
create or replace function public.match_response(p_response_id uuid, p_profile_set_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare r public.responses;
begin
  perform public.sls_require_admin();
  select * into r from public.responses where id = p_response_id;
  if not found then raise exception 'Lead not found.'; end if;
  return public.sls_match_with(r,
    case when p_profile_set_id is null then public.sls_current_set_json(r.property_id) else public.sls_profile_set_json(p_profile_set_id) end);
end $$;

-- internal: write a computed match onto a response, logging tier changes
create or replace function public.sls_store_match(p_response_id uuid, m jsonb, p_reason text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare old public.responses;
begin
  select * into old from public.responses where id = p_response_id for update;
  update public.responses set
    profile_set_id = (m ->> 'profile_set_id')::uuid,
    best_profile_id = (m ->> 'best_profile_id')::uuid,
    best_match = (m ->> 'best_match')::numeric,
    profile_matches = m -> 'profile_matches',
    never_hit = m -> 'never_hit',
    intent_score = (m ->> 'intent_score')::int,
    priority = (m ->> 'priority')::numeric,
    tier = m ->> 'tier',
    suspected_bot = (m ->> 'suspected_bot')::boolean,
    match_detail = jsonb_build_object(
      'best_profile_name', m -> 'best_profile_name', 'best_qualified', m -> 'best_qualified',
      'intent_breakdown', m -> 'intent_breakdown', 'visible_keys', m -> 'visible_keys',
      'profile_set_version', m -> 'profile_set_version', 'matched_at', now())
  where id = p_response_id;
  if old.tier is distinct from (m ->> 'tier') then
    insert into public.lead_events (response_id, property_id, type, data, actor)
    values (p_response_id, old.property_id, 'tier_changed',
            jsonb_build_object('from', old.tier, 'to', m ->> 'tier', 'reason', p_reason,
                               'best_profile', m ->> 'best_profile_name', 'best_match', m -> 'best_match'),
            auth.uid());
    return true;
  end if;
  return false;
end $$;

-- apply_match(response_id): match against the current profile set and store it
create or replace function public.apply_match(p_response_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.responses; m jsonb;
begin
  perform public.sls_require_admin();
  select * into r from public.responses where id = p_response_id;
  if not found then raise exception 'Lead not found.'; end if;
  m := public.sls_match_with(r, public.sls_current_set_json(r.property_id));
  perform public.sls_store_match(p_response_id, m, 'rematch');
  return m;
end $$;

-- publish_profile_set(id): make a draft (or an older published set = rollback) current
-- and re-match every response in ONE transaction.
create or replace function public.publish_profile_set(p_set_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.profile_sets; setj jsonb; r public.responses; changed int := 0; total int := 0; reason text; bad text;
begin
  perform public.sls_require_admin();
  select * into s from public.profile_sets where id = p_set_id;
  if not found then raise exception 'Profile set not found.'; end if;
  perform pg_advisory_xact_lock(hashtext('profiles:' || s.property_id));
  select * into s from public.profile_sets where id = p_set_id for update;

  -- sanity: every profile needs at least one condition; values must be present for comparing ops
  select string_agg(p.name, ', ') into bad from public.profiles p
   where p.profile_set_id = s.id and p.active and not exists (select 1 from public.profile_conditions c where c.profile_id = p.id);
  if bad is not null then raise exception 'These profiles have no conditions: %', bad using errcode = 'P0001'; end if;
  select string_agg(distinct p.name, ', ') into bad from public.profile_conditions c join public.profiles p on p.id = c.profile_id
   where p.profile_set_id = s.id and c.operator not in ('answered', 'not_answered')
     and (c.value is null or jsonb_typeof(c.value) = 'null' or c.value = '[]'::jsonb or c.value = '""'::jsonb);
  if bad is not null then raise exception 'Some conditions have no value to compare with (profiles: %).', bad using errcode = 'P0001'; end if;

  if s.status = 'draft' then
    update public.profile_sets set status = 'published', published_by = auth.uid(), published_at = now() where id = s.id;
    reason := format('Profiles v%s published', s.version);
  else
    reason := format('Rolled back to profiles v%s', s.version);
  end if;
  update public.profile_sets set is_current = false where property_id = s.property_id and is_current and id <> s.id;
  update public.profile_sets set is_current = true where id = s.id;

  setj := public.sls_profile_set_json(s.id);
  for r in select * from public.responses where property_id = s.property_id order by created_at loop
    total := total + 1;
    if public.sls_store_match(r.id, public.sls_match_with(r, setj), reason) then changed := changed + 1; end if;
  end loop;
  return jsonb_build_object('profile_set_id', s.id, 'version', s.version, 'responses', total, 'tier_changes', changed);
end $$;

-- simulate_profile_set(draft_id): old vs new per response + counts. No writes.
create or replace function public.simulate_profile_set(p_set_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare s public.profile_sets; setj jsonb; r public.responses; m jsonb;
  old_counts jsonb := '{"ideal":0,"maybe":0,"no":0}'; new_counts jsonb := '{"ideal":0,"maybe":0,"no":0}';
  changes jsonb := '[]'; n_changed int := 0; total int := 0;
begin
  perform public.sls_require_admin();
  select * into s from public.profile_sets where id = p_set_id;
  if not found then raise exception 'Profile set not found.'; end if;
  setj := public.sls_profile_set_json(s.id);
  for r in select * from public.responses where property_id = s.property_id order by created_at desc loop
    total := total + 1;
    m := public.sls_match_with(r, setj);
    old_counts := jsonb_set(old_counts, array[r.tier], to_jsonb((old_counts ->> r.tier)::int + 1));
    new_counts := jsonb_set(new_counts, array[m ->> 'tier'], to_jsonb((new_counts ->> (m ->> 'tier'))::int + 1));
    if r.tier <> (m ->> 'tier') or (r.match_detail ->> 'best_profile_name') is distinct from (m ->> 'best_profile_name') then
      n_changed := n_changed + 1;
      if jsonb_array_length(changes) < 500 then
        changes := changes || jsonb_build_object(
          'response_id', r.id, 'name', r.name, 'created_at', r.created_at,
          'old_tier', r.tier, 'new_tier', m ->> 'tier',
          'old_profile', r.match_detail ->> 'best_profile_name', 'new_profile', m ->> 'best_profile_name',
          'old_match', r.best_match, 'new_match', m -> 'best_match');
      end if;
    end if;
  end loop;
  return jsonb_build_object('total', total, 'changed', n_changed, 'old', old_counts, 'new', new_counts, 'changes', changes);
end $$;

-- live_profile_count(property, {conditions:[...]}): responses that would qualify (all applicable musts met)
-- plus how many would reach the "ideal" threshold.
create or replace function public.live_profile_count(p_property_id uuid, p_profile jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare r public.responses; setj jsonb; m jsonb; qualified int := 0; ideal int := 0; total int := 0; v_settings jsonb;
begin
  perform public.sls_require_admin();
  select s.settings into v_settings from public.profile_sets s where s.property_id = p_property_id and s.status = 'draft';
  v_settings := public.sls_merge(public.sls_default_settings(), coalesce(v_settings, (select s.settings from public.profile_sets s where s.property_id = p_property_id and s.is_current)));
  setj := jsonb_build_object('id', null, 'version', null, 'settings', v_settings,
    'profiles', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'name', 'preview', 'position', 0,
                                  'conditions', coalesce(p_profile -> 'conditions', '[]'::jsonb))),
    'never', '[]'::jsonb);
  for r in select * from public.responses where property_id = p_property_id and path <> 'waitlist' and duplicate_of is null loop
    total := total + 1;
    m := public.sls_match_with(r, setj);
    if (m -> 'profile_matches' -> 0 ->> 'qualified')::boolean then
      qualified := qualified + 1;
      if (m ->> 'best_match')::numeric >= (v_settings #>> '{thresholds,ideal}')::numeric then ideal := ideal + 1; end if;
    end if;
  end loop;
  return jsonb_build_object('total', total, 'qualified', qualified, 'ideal', ideal);
end $$;
