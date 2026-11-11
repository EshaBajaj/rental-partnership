-- Form builder RPCs: compile, validate, publish, reorder, safe removal, type replacement.

create or replace function public.sls_require_admin() returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  -- service_role (Edge Functions / SQL editor) bypasses; signed-in admins pass.
  -- service_role JWT (Edge Functions), or a direct DB session without any JWT (SQL editor, migrations, cron)
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role' then return; end if;
  if nullif(current_setting('request.jwt.claims', true), '') is null and nullif(current_setting('request.jwt.claim.sub', true), '') is null
     and session_user in ('postgres', 'supabase_admin') then return; end if;
  if not public.is_admin() then
    raise exception 'Only admins can do this.' using errcode = '42501';
  end if;
end $$;

-- ---------------------------------------------------------------- compile (mirror of _shared/compile.ts)
create or replace function public.sls_compile_form(p_property_id uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('schema', 1, 'questions', coalesce(jsonb_agg(
    jsonb_build_object(
      'key', q.key,
      'type', q.type,
      'label_en', q.label_en,
      'label_hi', nullif(q.label_hi, ''),
      'help_en', nullif(q.help_en, ''),
      'help_hi', nullif(q.help_hi, ''),
      'placeholder', nullif(q.placeholder, ''),
      'required', case when q.type = 'contact' then true else q.required end,
      'show_if', q.show_if,
      'validation', coalesce((select jsonb_object_agg(k, v) from jsonb_each(q.validation) e(k, v)
                              where k in ('min','max','maxLength','minPicks','maxPicks') and jsonb_typeof(v) <> 'null' and v <> '""'::jsonb), '{}'::jsonb),
      'allow_other', case when q.type in ('single','multi','dropdown') then q.allow_other else false end,
      'allow_voice', case when q.type = 'voice' then true when q.type in ('short_text','long_text') then q.allow_voice else false end,
      'options', case
        when q.type = 'yes_no' then '[{"value":"yes","label_en":"Yes","label_hi":"हाँ"},{"value":"no","label_en":"No","label_hi":"नहीं"}]'::jsonb
        when q.type in ('single','multi','dropdown') then coalesce((
          select jsonb_agg(jsonb_build_object('value', o.value, 'label_en', o.label_en, 'label_hi', nullif(o.label_hi, '')) order by o.position, o.created_at)
          from public.question_options o where o.question_id = q.id and o.archived_at is null), '[]'::jsonb)
        else '[]'::jsonb end
    ) order by q.position, q.created_at), '[]'::jsonb))
  from public.questions q
  where q.property_id = p_property_id and q.archived_at is null
$$;

-- collect every {q,op,v} condition of a show_if tree
create or replace function public.sls_conds(node jsonb) returns setof jsonb
language plpgsql immutable as $$
declare item jsonb;
begin
  if node is null or jsonb_typeof(node) <> 'object' then return; end if;
  if node ? 'q' then return next node; return; end if;
  for item in select * from jsonb_array_elements(coalesce(node -> 'all', node -> 'any', '[]'::jsonb)) loop
    return query select * from public.sls_conds(item);
  end loop;
end $$;

-- ---------------------------------------------------------------- server-side structural validation
create or replace function public.sls_validate_draft(p_property_id uuid) returns text[]
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  errs text[] := '{}';
  q record; c jsonb; ref record; first_key text; n int; vals text[]; v text;
begin
  select key into first_key from public.questions where property_id = p_property_id and archived_at is null order by position, created_at limit 1;
  if first_key is null then return array['The form has no questions.']; end if;
  if first_key <> 'path' then errs := errs || 'The “Rent / Partner / Either” question (key “path”) must be first.'; end if;

  select * into ref from public.questions where property_id = p_property_id and key = 'path' and archived_at is null;
  if not found then errs := errs || 'The “Rent / Partner / Either” question is missing.';
  else
    if ref.type <> 'single' then errs := errs || 'The “Rent / Partner / Either” question must be single choice.'; end if;
    if ref.show_if is not null then errs := errs || 'The “Rent / Partner / Either” question must not have a condition.'; end if;
    if not ref.required then errs := errs || 'The “Rent / Partner / Either” question must be required.'; end if;
    select array_agg(value order by value) into vals from public.question_options where question_id = ref.id and archived_at is null;
    if vals is distinct from array['either','partner','rent'] then
      errs := errs || 'The “Rent / Partner / Either” question must have exactly the answers rent, partner and either.';
    end if;
  end if;

  select count(*) into n from public.questions where property_id = p_property_id and archived_at is null and type = 'contact';
  if n <> 1 then errs := errs || format('The form must have exactly one contact question (it has %s).', n); end if;
  if exists (select 1 from public.questions where property_id = p_property_id and archived_at is null and type = 'contact' and show_if is not null) then
    errs := errs || 'The contact question must be shown to everyone (remove its condition).';
  end if;

  for q in select * from public.questions where property_id = p_property_id and archived_at is null order by position, created_at loop
    if q.type in ('single','multi','dropdown') then
      select count(*) into n from public.question_options where question_id = q.id and archived_at is null;
      if n < 2 then errs := errs || format('“%s” needs at least 2 answer options.', q.label_en); end if;
    end if;
    for c in select * from public.sls_conds(q.show_if) loop
      if c ->> 'q' = q.key then
        errs := errs || format('“%s” can''t depend on its own answer.', q.label_en); continue;
      end if;
      select * into ref from public.questions where property_id = p_property_id and key = c ->> 'q';
      if not found then errs := errs || format('“%s” depends on a question that doesn''t exist (“%s”).', q.label_en, c ->> 'q'); continue; end if;
      if ref.archived_at is not null then errs := errs || format('“%s” depends on “%s”, which is archived.', q.label_en, ref.label_en); continue; end if;
      if (ref.position, ref.created_at) > (q.position, q.created_at) then
        errs := errs || format('“%s” depends on “%s”, but “%s” comes after it. Move “%s” above “%s”.', q.label_en, ref.label_en, ref.label_en, ref.label_en, q.label_en);
        continue;
      end if;
      if ref.type = 'contact' then errs := errs || format('“%s” can''t depend on the contact question.', q.label_en); continue; end if;
      if ref.type in ('single','multi','dropdown','yes_no') and c ->> 'op' not in ('answered','not_answered','gte','lte','between') then
        for v in select x #>> '{}' from jsonb_array_elements(public.sls_as_array(c -> 'v')) x loop
          if ref.type = 'yes_no' and v in ('yes','no') then continue; end if;
          if v = '__other' and ref.allow_other then continue; end if;
          if not exists (select 1 from public.question_options o where o.question_id = ref.id and o.value = v and o.archived_at is null) then
            errs := errs || format('“%s” uses the answer “%s” of “%s”, which doesn''t exist or is archived.', q.label_en, v, ref.label_en);
          end if;
        end loop;
      end if;
    end loop;
  end loop;
  return errs;
end $$;

-- ---------------------------------------------------------------- publish form
create or replace function public.publish_form(p_property_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare errs text[]; cfg jsonb; ver int; vid uuid; prev jsonb;
begin
  perform public.sls_require_admin();
  perform pg_advisory_xact_lock(hashtext('publish_form:' || p_property_id));
  errs := public.sls_validate_draft(p_property_id);
  if array_length(errs, 1) > 0 then
    raise exception 'Cannot publish: %', array_to_string(errs, ' | ') using errcode = 'P0001', hint = array_to_string(errs, E'\n');
  end if;
  cfg := public.sls_compile_form(p_property_id);
  select config into prev from public.form_versions where property_id = p_property_id and is_current;
  if prev is not null and prev = cfg then
    raise exception 'Nothing changed since the last published version.' using errcode = 'P0001';
  end if;
  select coalesce(max(version), 0) + 1 into ver from public.form_versions where property_id = p_property_id;
  update public.form_versions set is_current = false where property_id = p_property_id and is_current;
  insert into public.form_versions (property_id, version, config, published_by, is_current)
  values (p_property_id, ver, cfg, auth.uid(), true) returning id into vid;
  update public.questions set first_published_at = now()
   where property_id = p_property_id and archived_at is null and first_published_at is null;
  update public.question_options o set first_published_at = now()
    from public.questions q
   where o.question_id = q.id and q.property_id = p_property_id and o.archived_at is null and o.first_published_at is null and q.archived_at is null;
  return jsonb_build_object('id', vid, 'version', ver);
end $$;

-- Re-publish an older form version as current (rollback). Draft is untouched.
create or replace function public.restore_form_version(p_version_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare fv public.form_versions; ver int; vid uuid;
begin
  perform public.sls_require_admin();
  select * into fv from public.form_versions where id = p_version_id;
  if not found then raise exception 'Version not found.'; end if;
  perform pg_advisory_xact_lock(hashtext('publish_form:' || fv.property_id));
  select coalesce(max(version), 0) + 1 into ver from public.form_versions where property_id = fv.property_id;
  update public.form_versions set is_current = false where property_id = fv.property_id and is_current;
  insert into public.form_versions (property_id, version, config, published_by, is_current)
  values (fv.property_id, ver, fv.config, auth.uid(), true) returning id into vid;
  return jsonb_build_object('id', vid, 'version', ver, 'restored_from', fv.version);
end $$;

-- ---------------------------------------------------------------- reorder (atomic)
create or replace function public.reorder_questions(p_property_id uuid, p_ids uuid[]) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare i int;
begin
  perform public.sls_require_admin();
  if (select count(*) from public.questions where property_id = p_property_id and id = any (p_ids)) <> coalesce(array_length(p_ids, 1), 0) then
    raise exception 'Some questions do not belong to this property.';
  end if;
  for i in 1 .. coalesce(array_length(p_ids, 1), 0) loop
    update public.questions set position = i - 1 where id = p_ids[i] and position is distinct from i - 1;
  end loop;
end $$;

create or replace function public.reorder_options(p_question_id uuid, p_ids uuid[]) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare i int;
begin
  perform public.sls_require_admin();
  for i in 1 .. coalesce(array_length(p_ids, 1), 0) loop
    update public.question_options set position = i - 1 where id = p_ids[i] and question_id = p_question_id;
  end loop;
end $$;

-- ---------------------------------------------------------------- profile drafts
create or replace function public.create_profile_draft(p_property_id uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare d uuid; cur public.profile_sets; ver int; p record; np uuid;
begin
  perform public.sls_require_admin();
  perform pg_advisory_xact_lock(hashtext('profiles:' || p_property_id));
  select id into d from public.profile_sets where property_id = p_property_id and status = 'draft';
  if d is not null then return d; end if;
  select * into cur from public.profile_sets where property_id = p_property_id and is_current;
  select coalesce(max(version), 0) + 1 into ver from public.profile_sets where property_id = p_property_id;
  insert into public.profile_sets (property_id, version, status, settings, based_on_id, created_by)
  values (p_property_id, ver, 'draft', coalesce(cur.settings, public.sls_default_settings()), cur.id, auth.uid())
  returning id into d;
  if cur.id is not null then
    for p in select * from public.profiles where profile_set_id = cur.id order by position loop
      insert into public.profiles (profile_set_id, name, description, active, position)
      values (d, p.name, p.description, p.active, p.position) returning id into np;
      insert into public.profile_conditions (profile_id, question_key, operator, value, importance, position)
      select np, question_key, operator, value, importance, position from public.profile_conditions where profile_id = p.id;
    end loop;
    insert into public.never_rules (profile_set_id, question_key, operator, value, label)
    select d, question_key, operator, value, label from public.never_rules where profile_set_id = cur.id;
  end if;
  return d;
end $$;

create or replace function public.discard_profile_draft(p_set_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.sls_require_admin();
  delete from public.profile_sets where id = p_set_id and status = 'draft';
  if not found then raise exception 'Only drafts can be discarded.'; end if;
end $$;

-- ---------------------------------------------------------------- safe removal of a question or option
-- The admin UI computes the rewrites with the shared edit-safety helpers and shows
-- every dependency; this applies everything atomically and then verifies nothing
-- still references the removed item. Never-published → deleted; published → archived.
create or replace function public.remove_question_or_option(
  p_question_id uuid,
  p_option_id uuid default null,
  p_show_if_updates jsonb default '{}'::jsonb,       -- {question_id: new_show_if|null}
  p_remove_condition_ids uuid[] default '{}',
  p_remove_never_ids uuid[] default '{}'
) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  q public.questions; o public.question_options; k text; v jsonb; draft uuid; result text; bad text;
begin
  perform public.sls_require_admin();
  select * into q from public.questions where id = p_question_id for update;
  if not found then raise exception 'Question not found.'; end if;
  if q.key = 'path' and p_option_id is null then raise exception 'The “Rent / Partner / Either” question cannot be removed.'; end if;
  if p_option_id is not null then
    select * into o from public.question_options where id = p_option_id and question_id = q.id for update;
    if not found then raise exception 'Option not found.'; end if;
    if q.key = 'path' then raise exception 'The rent / partner / either answers cannot be removed.'; end if;
  end if;

  for k, v in select * from jsonb_each(coalesce(p_show_if_updates, '{}'::jsonb)) loop
    update public.questions set show_if = case when jsonb_typeof(v) = 'null' then null else v end
     where id = k::uuid and property_id = q.property_id;
  end loop;

  select id into draft from public.profile_sets where property_id = q.property_id and status = 'draft';
  delete from public.profile_conditions c using public.profiles p
   where c.profile_id = p.id and p.profile_set_id = draft and c.id = any (p_remove_condition_ids);
  delete from public.never_rules where profile_set_id = draft and id = any (p_remove_never_ids);

  -- verify: nothing active still references the removed item
  select string_agg(distinct x.label_en, ', ') into bad from public.questions x, lateral public.sls_conds(x.show_if) c
   where x.property_id = q.property_id and x.archived_at is null and x.id <> q.id and c ->> 'q' = q.key
     and (p_option_id is null or exists (select 1 from jsonb_array_elements(public.sls_as_array(c -> 'v')) e where e #>> '{}' = o.value));
  if bad is not null then raise exception 'Still used in “when to show” of: %', bad; end if;
  if draft is not null then
    select string_agg(distinct p.name, ', ') into bad from public.profile_conditions c join public.profiles p on p.id = c.profile_id
     where p.profile_set_id = draft and c.question_key = q.key
       and (p_option_id is null or exists (select 1 from jsonb_array_elements(public.sls_as_array(c.value)) e where e #>> '{}' = o.value));
    if bad is not null then raise exception 'Still used in draft profiles: %', bad; end if;
    select string_agg(n.label, ', ') into bad from public.never_rules n
     where n.profile_set_id = draft and n.question_key = q.key
       and (p_option_id is null or exists (select 1 from jsonb_array_elements(public.sls_as_array(n.value)) e where e #>> '{}' = o.value));
    if bad is not null then raise exception 'Still used in never rules: %', bad; end if;
  end if;

  if p_option_id is not null then
    if o.first_published_at is null then delete from public.question_options where id = o.id; result := 'deleted';
    else update public.question_options set archived_at = now() where id = o.id; result := 'archived'; end if;
  else
    if q.first_published_at is null then delete from public.questions where id = q.id; result := 'deleted';
    else update public.questions set archived_at = now() where id = q.id; result := 'archived'; end if;
  end if;
  return result;
end $$;

-- ---------------------------------------------------------------- incompatible type change on a published question
create or replace function public.replace_question_type(p_question_id uuid, p_new_type text, p_new_key text)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare q public.questions; nid uuid; draft uuid; x record;
begin
  perform public.sls_require_admin();
  select * into q from public.questions where id = p_question_id for update;
  if not found then raise exception 'Question not found.'; end if;
  if q.key = 'path' or q.type = 'contact' or p_new_type = 'contact' then raise exception 'This question''s type cannot be changed.'; end if;
  if q.first_published_at is null then raise exception 'This question was never published; change its type directly.'; end if;
  if exists (select 1 from public.questions where property_id = q.property_id and key = p_new_key) then
    raise exception 'The key “%” is already used (keys of archived questions stay reserved).', p_new_key;
  end if;

  insert into public.questions (property_id, key, type, label_en, label_hi, help_en, help_hi, placeholder, required, position,
                                show_if, validation, allow_other, allow_voice)
  values (q.property_id, p_new_key, p_new_type, q.label_en, q.label_hi, q.help_en, q.help_hi, q.placeholder, q.required, q.position,
          q.show_if, '{}'::jsonb, q.allow_other and p_new_type in ('single','multi','dropdown'),
          q.allow_voice and p_new_type in ('short_text','long_text'))
  returning id into nid;
  if p_new_type in ('single','multi','dropdown') and q.type in ('single','multi','dropdown') then
    insert into public.question_options (question_id, value, label_en, label_hi, position)
    select nid, value, label_en, label_hi, position from public.question_options where question_id = q.id and archived_at is null;
  end if;
  update public.questions set archived_at = now() where id = q.id;

  -- migrate show_if references in active questions
  for x in select id, show_if from public.questions
            where property_id = q.property_id and archived_at is null and show_if::text like '%"' || q.key || '"%' loop
    update public.questions set show_if = public.sls_rename_key(x.show_if, q.key, p_new_key) where id = x.id;
  end loop;

  -- migrate draft profile conditions / never rules (create the draft if the live set uses the key)
  if exists (select 1 from public.profile_conditions c join public.profiles p on p.id = c.profile_id
              join public.profile_sets s on s.id = p.profile_set_id
              where s.property_id = q.property_id and (s.is_current or s.status = 'draft') and c.question_key = q.key)
     or exists (select 1 from public.never_rules n join public.profile_sets s on s.id = n.profile_set_id
              where s.property_id = q.property_id and (s.is_current or s.status = 'draft') and n.question_key = q.key) then
    draft := public.create_profile_draft(q.property_id);
    update public.profile_conditions c set question_key = p_new_key from public.profiles p
     where c.profile_id = p.id and p.profile_set_id = draft and c.question_key = q.key;
    update public.never_rules set question_key = p_new_key where profile_set_id = draft and question_key = q.key;
  end if;
  return nid;
end $$;

create or replace function public.sls_rename_key(node jsonb, p_from text, p_to text) returns jsonb
language plpgsql immutable as $$
declare out jsonb := '[]'::jsonb; item jsonb; k text;
begin
  if node is null or jsonb_typeof(node) <> 'object' then return node; end if;
  if node ? 'q' then
    return case when node ->> 'q' = p_from then jsonb_set(node, '{q}', to_jsonb(p_to)) else node end;
  end if;
  k := case when node ? 'all' then 'all' else 'any' end;
  for item in select * from jsonb_array_elements(node -> k) loop
    out := out || jsonb_build_array(public.sls_rename_key(item, p_from, p_to));
  end loop;
  return jsonb_build_object(k, out);
end $$;
