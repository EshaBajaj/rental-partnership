-- Question input modes: questions.kind ('standard'|'date'|'yes_no'|'contact') + input_modes jsonb
-- replace the single legacy `type`. Existing questions are migrated with the same mapping as
-- supabase/functions/_shared/input-modes.ts → legacyToModes(). Published form_versions are never
-- rewritten; readers upgrade schema-1 configs on the fly (normalizeConfig in TS; SQL readers
-- understand both shapes).

-- ---------------------------------------------------------------- defaults + legacy mapping
create or replace function public.sls_default_modes() returns jsonb
language sql immutable as $$
  select '{
    "primary": "choose",
    "choose": {"enabled": true, "style": "radio", "min_picks": null, "max_picks": null, "allow_other": false, "other_max_chars": 200},
    "type":   {"enabled": false, "multiline": false, "min_chars": null, "max_chars": 300, "placeholder_en": null, "placeholder_hi": null, "format": "any"},
    "speak":  {"enabled": false, "max_seconds": 120, "live_transcript": true, "allow_edit": true, "keep_audio": true}
  }'::jsonb
$$;

create or replace function public.sls_legacy_modes(p_type text, p_allow_other boolean, p_allow_voice boolean, p_validation jsonb, p_placeholder text)
returns jsonb
language plpgsql immutable as $$
declare m jsonb := public.sls_default_modes(); v jsonb := coalesce(p_validation, '{}'::jsonb);
begin
  if p_type in ('yes_no', 'date', 'contact') then return null; end if;
  m := jsonb_set(m, '{choose,enabled}', 'false');
  if p_type in ('single', 'multi', 'dropdown') then
    m := m || jsonb_build_object('primary', 'choose', 'choose', (m -> 'choose') || jsonb_build_object(
      'enabled', true,
      'style', case p_type when 'single' then 'radio' when 'multi' then 'checkbox' else 'dropdown' end,
      'min_picks', case when p_type = 'multi' then coalesce(v -> 'minPicks', 'null'::jsonb) else 'null'::jsonb end,
      'max_picks', case when p_type = 'multi' then coalesce(v -> 'maxPicks', 'null'::jsonb) else 'null'::jsonb end,
      'allow_other', coalesce(p_allow_other, false)));
  elsif p_type in ('short_text', 'long_text') then
    m := m || jsonb_build_object('primary', 'type',
      'type', (m -> 'type') || jsonb_build_object('enabled', true, 'multiline', p_type = 'long_text',
              'max_chars', coalesce(v -> 'maxLength', to_jsonb(case when p_type = 'long_text' then 2000 else 200 end)),
              'placeholder_en', to_jsonb(p_placeholder)),
      'speak', (m -> 'speak') || jsonb_build_object('enabled', coalesce(p_allow_voice, false)));
  elsif p_type in ('number', 'currency') then
    m := m || jsonb_build_object('primary', 'type',
      'type', (m -> 'type') || jsonb_build_object('enabled', true, 'format', p_type, 'max_chars', 15, 'placeholder_en', to_jsonb(p_placeholder)));
  elsif p_type = 'voice' then
    m := m || jsonb_build_object('primary', 'speak',
      'speak', (m -> 'speak') || jsonb_build_object('enabled', true),
      'type', (m -> 'type') || jsonb_build_object('enabled', true, 'multiline', true,
              'max_chars', coalesce(v -> 'maxLength', to_jsonb(2000)), 'placeholder_en', to_jsonb(p_placeholder)));
  end if;
  return m;
end $$;

-- ---------------------------------------------------------------- migrate questions
alter table public.questions add column kind text, add column input_modes jsonb;

alter table public.questions disable trigger guard_questions;
update public.questions set
  kind = case when type in ('yes_no', 'date', 'contact') then type else 'standard' end,
  input_modes = public.sls_legacy_modes(type, allow_other, allow_voice, validation, placeholder),
  validation = case when type in ('number', 'currency', 'date')
                    then coalesce((select jsonb_object_agg(k, v) from jsonb_each(validation) e(k, v) where k in ('min', 'max')), '{}'::jsonb)
                    else '{}'::jsonb end;
alter table public.questions enable trigger guard_questions;

alter table public.questions
  alter column kind set not null,
  alter column kind set default 'standard',
  add constraint questions_kind_check check (kind in ('standard', 'date', 'yes_no', 'contact')),
  add constraint questions_modes_shape check (
    (kind = 'standard') = (input_modes is not null)
    and (input_modes is null or (jsonb_typeof(input_modes) = 'object'
         and input_modes ->> 'primary' in ('choose', 'type', 'speak')
         and jsonb_typeof(input_modes -> 'choose') = 'object'
         and jsonb_typeof(input_modes -> 'type') = 'object'
         and jsonb_typeof(input_modes -> 'speak') = 'object')));

-- ---------------------------------------------------------------- voice notes: live transcript, audio missing
alter table public.voice_notes
  alter column storage_path drop not null,
  add column transcript_live text,
  add column audio_missing boolean not null default false;

-- ---------------------------------------------------------------- compile (mirror of _shared/compile.ts)
create or replace function public.sls_numeric_modes(m jsonb) returns boolean
language sql immutable as $$
  select coalesce((m #>> '{type,enabled}')::boolean, false) and coalesce(m #>> '{type,format}', 'any') in ('number', 'currency')
$$;

create or replace function public.sls_compile_form(p_property_id uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('schema', 2, 'questions', coalesce(jsonb_agg(c.q order by c.position, c.created_at), '[]'::jsonb))
  from (
    select q.position, q.created_at, jsonb_build_object(
      'key', q.key,
      'kind', q.kind,
      'label_en', q.label_en,
      'label_hi', nullif(q.label_hi, ''),
      'help_en', nullif(q.help_en, ''),
      'help_hi', nullif(q.help_hi, ''),
      'required', case when q.kind = 'contact' then true else q.required end,
      'show_if', q.show_if,
      'validation', case when q.kind = 'date' or (q.kind = 'standard' and public.sls_numeric_modes(m.modes))
        then coalesce((select jsonb_object_agg(k, v) from jsonb_each(q.validation) e(k, v)
                       where k in ('min', 'max') and jsonb_typeof(v) <> 'null' and v <> '""'::jsonb), '{}'::jsonb)
        else '{}'::jsonb end,
      'input_modes', m.modes,
      'options', case
        when q.kind = 'yes_no' then '[{"value":"yes","label_en":"Yes","label_hi":"हाँ"},{"value":"no","label_en":"No","label_hi":"नहीं"}]'::jsonb
        when q.kind = 'standard' and coalesce((m.modes #>> '{choose,enabled}')::boolean, false) then coalesce((
          select jsonb_agg(jsonb_build_object('value', o.value, 'label_en', o.label_en, 'label_hi', nullif(o.label_hi, '')) order by o.position, o.created_at)
          from public.question_options o where o.question_id = q.id and o.archived_at is null), '[]'::jsonb)
        else '[]'::jsonb end) as q
    from public.questions q
    cross join lateral (select case when q.kind = 'standard'
      then jsonb_build_object(
        'primary', coalesce(q.input_modes -> 'primary', '"choose"'),
        'choose', (public.sls_default_modes() -> 'choose') || coalesce(q.input_modes -> 'choose', '{}'),
        'type', (public.sls_default_modes() -> 'type') || coalesce(q.input_modes -> 'type', '{}'),
        'speak', (public.sls_default_modes() -> 'speak') || coalesce(q.input_modes -> 'speak', '{}'))
      end as modes) m
    where q.property_id = p_property_id and q.archived_at is null
  ) c
$$;

-- ---------------------------------------------------------------- server-side structural validation
create or replace function public.sls_validate_draft(p_property_id uuid) returns text[]
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  errs text[] := '{}';
  q record; c jsonb; ref record; first_key text; n int; vals text[]; v text; m jsonb; rm jsonb;
begin
  select key into first_key from public.questions where property_id = p_property_id and archived_at is null order by position, created_at limit 1;
  if first_key is null then return array['The form has no questions.']; end if;
  if first_key <> 'path' then errs := errs || 'The “Rent / Partner / Either” question (key “path”) must be first.'; end if;

  select * into ref from public.questions where property_id = p_property_id and key = 'path' and archived_at is null;
  if not found then errs := errs || 'The “Rent / Partner / Either” question is missing.';
  else
    m := ref.input_modes;
    if ref.kind <> 'standard' or not coalesce((m #>> '{choose,enabled}')::boolean, false)
       or coalesce(m #>> '{choose,style}', '') not in ('radio', 'dropdown') or m ->> 'primary' <> 'choose'
       or coalesce((m #>> '{type,enabled}')::boolean, false) or coalesce((m #>> '{speak,enabled}')::boolean, false)
       or coalesce((m #>> '{choose,allow_other}')::boolean, false) then
      errs := errs || 'The “Rent / Partner / Either” question must be answered by choosing exactly one option (no typing, speaking or “Other”).';
    end if;
    if ref.show_if is not null then errs := errs || 'The “Rent / Partner / Either” question must not have a condition.'; end if;
    if not ref.required then errs := errs || 'The “Rent / Partner / Either” question must be required.'; end if;
    select array_agg(value order by value) into vals from public.question_options where question_id = ref.id and archived_at is null;
    if vals is distinct from array['either','partner','rent'] then
      errs := errs || 'The “Rent / Partner / Either” question must have exactly the answers rent, partner and either.';
    end if;
  end if;

  select count(*) into n from public.questions where property_id = p_property_id and archived_at is null and kind = 'contact';
  if n <> 1 then errs := errs || format('The form must have exactly one contact question (it has %s).', n); end if;
  if exists (select 1 from public.questions where property_id = p_property_id and archived_at is null and kind = 'contact' and show_if is not null) then
    errs := errs || 'The contact question must be shown to everyone (remove its condition).';
  end if;

  for q in select * from public.questions where property_id = p_property_id and archived_at is null order by position, created_at loop
    if q.kind = 'standard' then
      m := q.input_modes;
      if not (coalesce((m #>> '{choose,enabled}')::boolean, false) or coalesce((m #>> '{type,enabled}')::boolean, false) or coalesce((m #>> '{speak,enabled}')::boolean, false)) then
        errs := errs || format('“%s” needs at least one way to answer (Choose, Type or Speak).', q.label_en);
      elsif not coalesce((m #>> array[m ->> 'primary', 'enabled'])::boolean, false) then
        errs := errs || format('“%s”: the main way to answer is switched off.', q.label_en);
      end if;
      if coalesce((m #>> '{choose,enabled}')::boolean, false) then
        select count(*) into n from public.question_options where question_id = q.id and archived_at is null;
        if n < 2 then errs := errs || format('“%s” needs at least 2 answer options.', q.label_en); end if;
      end if;
      if coalesce((m #>> '{type,enabled}')::boolean, false) and coalesce((m #>> '{type,max_chars}')::int, 1) not between 1 and 2000 then
        errs := errs || format('“%s”: maximum characters must be between 1 and 2000.', q.label_en);
      end if;
      if coalesce((m #>> '{speak,enabled}')::boolean, false) and coalesce((m #>> '{speak,max_seconds}')::int, 120) not between 10 and 300 then
        errs := errs || format('“%s”: recording length must be between 10 and 300 seconds.', q.label_en);
      end if;
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
      if ref.kind = 'contact' then errs := errs || format('“%s” can''t depend on the contact question.', q.label_en); continue; end if;
      rm := ref.input_modes;
      if (ref.kind = 'yes_no' or (ref.kind = 'standard' and coalesce((rm #>> '{choose,enabled}')::boolean, false) and not public.sls_numeric_modes(rm)))
         and c ->> 'op' in ('eq', 'neq', 'in', 'not_in', 'contains_any', 'contains_all') then
        for v in select x #>> '{}' from jsonb_array_elements(public.sls_as_array(c -> 'v')) x loop
          if ref.kind = 'yes_no' and v in ('yes', 'no') then continue; end if;
          if v = '__other' and coalesce((rm #>> '{choose,allow_other}')::boolean, false) then continue; end if;
          if not exists (select 1 from public.question_options o where o.question_id = ref.id and o.value = v and o.archived_at is null) then
            errs := errs || format('“%s” uses the answer “%s” of “%s”, which doesn''t exist or is archived.', q.label_en, v, ref.label_en);
          end if;
        end loop;
      end if;
    end loop;
  end loop;
  return errs;
end $$;

-- ---------------------------------------------------------------- guard: kind changes need a new question
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
    -- input modes (choose/type/speak toggles, styles, limits) are compatible in-place edits;
    -- changing what the question IS needs a new question so old answers keep their meaning
    if new.kind <> old.kind and old.first_published_at is not null then
      raise exception 'Changing “%” from % to % needs a new question; use “Change kind” in the builder.', old.label_en, old.kind, new.kind using errcode = 'P0001';
    end if;
    if old.key = 'path' and new.archived_at is not null then raise exception 'The “Rent / Partner / Either” question cannot be archived.' using errcode = 'P0001'; end if;
    if old.first_published_at is not null then new.first_published_at := old.first_published_at; end if;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------- kind change on a published question
drop function public.replace_question_type(uuid, text, text);

create or replace function public.replace_question_kind(p_question_id uuid, p_new_kind text, p_new_key text)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare q public.questions; nid uuid; draft uuid; x record; modes jsonb;
begin
  perform public.sls_require_admin();
  select * into q from public.questions where id = p_question_id for update;
  if not found then raise exception 'Question not found.'; end if;
  if q.key = 'path' or q.kind = 'contact' or p_new_kind = 'contact' then raise exception 'This question''s kind cannot be changed.'; end if;
  if p_new_kind not in ('standard', 'date', 'yes_no') then raise exception 'Unknown kind %.', p_new_kind; end if;
  if q.first_published_at is null then raise exception 'This question was never published; change its kind directly.'; end if;
  if exists (select 1 from public.questions where property_id = q.property_id and key = p_new_key) then
    raise exception 'The key “%” is already used (keys of archived questions stay reserved).', p_new_key;
  end if;
  modes := case when p_new_kind = 'standard' then coalesce(q.input_modes, public.sls_default_modes()) else null end;
  insert into public.questions (property_id, key, kind, input_modes, label_en, label_hi, help_en, help_hi, required, position, show_if, validation)
  values (q.property_id, p_new_key, p_new_kind, modes, q.label_en, q.label_hi, q.help_en, q.help_hi, q.required, q.position, q.show_if, '{}'::jsonb)
  returning id into nid;
  if p_new_kind = 'standard' and q.kind = 'standard' then
    insert into public.question_options (question_id, value, label_en, label_hi, position)
    select nid, value, label_en, label_hi, position from public.question_options where question_id = q.id and archived_at is null;
  end if;
  update public.questions set archived_at = now() where id = q.id;

  for x in select id, show_if from public.questions
            where property_id = q.property_id and archived_at is null and show_if::text like '%"' || q.key || '"%' loop
    update public.questions set show_if = public.sls_rename_key(x.show_if, q.key, p_new_key) where id = x.id;
  end loop;

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
revoke execute on function public.replace_question_kind(uuid, text, text) from public, anon;
grant execute on function public.replace_question_kind(uuid, text, text) to authenticated, service_role;

-- legacy columns are now fully represented by kind + input_modes
alter table public.questions drop column type, drop column allow_other, drop column allow_voice, drop column placeholder;

-- ---------------------------------------------------------------- engine: answer values (new + legacy shapes)
-- Mirror of engineValue() in _shared/answers.ts:
--   choose[] (non-empty) → number → text (non-blank) → legacy value → '(voice note)'
create or replace function public.sls_values(answers jsonb) returns jsonb
language sql immutable as $$
  select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from (
    select k, case
      when jsonb_typeof(a -> 'choose') = 'array' and jsonb_array_length(a -> 'choose') > 0 then a -> 'choose'
      when jsonb_typeof(a -> 'number') = 'number' then a -> 'number'
      when jsonb_typeof(a -> 'text') = 'string' and btrim(a ->> 'text') <> '' then a -> 'text'
      when a ? 'value' and public.sls_is_answered(a -> 'value') then a -> 'value'
      when coalesce(a ->> 'voice_note_id', '') <> '' then '"(voice note)"'::jsonb
      else null end as v
    from jsonb_each(coalesce(answers, '{}'::jsonb)) as e(k, a)
  ) x where v is not null
$$;

create or replace function public.sls_value_text(q jsonb, v jsonb) returns text
language plpgsql immutable as $$
declare out text;
begin
  if v is null or jsonb_typeof(v) = 'null' then return ''; end if;
  if jsonb_typeof(v) = 'array' then
    select string_agg(public.sls_value_text(q, x), ', ' order by ord) into out
    from jsonb_array_elements(v) with ordinality as t(x, ord);
    return coalesce(out, '');
  end if;
  if q is not null and jsonb_typeof(v) in ('string', 'number') then
    select o ->> 'label_en' into out from jsonb_array_elements(coalesce(q -> 'options', '[]')) o where o ->> 'value' = v #>> '{}';
    if out is not null then return out; end if;
    if v #>> '{}' = '__other' then return 'Other'; end if;
    if (q ->> 'type' = 'currency' or q #>> '{input_modes,type,format}' = 'currency') and public.sls_num(v) is not null then
      return public.sls_inr(public.sls_num(v));
    end if;
  end if;
  return v #>> '{}';
end $$;

-- ---------------------------------------------------------------- submit: voice meta (live transcript / audio missing)
-- p.voice = {key: {final, live, audio_missing, has_audio}}; legacy p.voice_finals = {key: text} still accepted.
create or replace function public.submit_response(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  rid uuid := (p ->> 'id')::uuid;
  prop uuid := (p ->> 'property_id')::uuid;
  existing public.responses;
  cfg jsonb; setj jsonb; m jsonb;
  answers jsonb := coalesce(p -> 'answers', '{}'::jsonb);
  meta jsonb := case when jsonb_typeof(p -> 'voice') = 'object' then p -> 'voice' else '{}'::jsonb end;
  k text; vm jsonb; final text; live text; note public.voice_notes; nid uuid; dup uuid; notify boolean := false;
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

  -- legacy clients: voice_finals {key: text}
  for k, final in select key, value from jsonb_each_text(case when jsonb_typeof(p -> 'voice_finals') = 'object' then p -> 'voice_finals' else '{}'::jsonb end) loop
    meta := meta || jsonb_build_object(k, jsonb_build_object('final', final, 'has_audio', true));
  end loop;

  for k, vm in select key, value from jsonb_each(meta) loop
    final := left(coalesce(vm ->> 'final', ''), 2000);
    live := left(nullif(vm ->> 'live', ''), 2000);
    select * into note from public.voice_notes where response_id = rid and question_key = k for update;
    if found then
      update public.voice_notes set
        transcript_final = nullif(final, ''),
        transcript_live = coalesce(live, transcript_live),
        audio_missing = coalesce((vm ->> 'audio_missing')::boolean, false),
        edited_by_respondent = final <> '' and final is distinct from coalesce(live, '') and final is distinct from coalesce(transcript_machine, ''),
        status = 'submitted', next_attempt_at = coalesce(next_attempt_at, now())
      where id = note.id;
      nid := note.id;
    elsif live is not null or coalesce((vm ->> 'audio_missing')::boolean, false) then
      -- spoken without a stored recording (silent / failed mic / keep_audio off): keep the text
      insert into public.voice_notes (property_id, response_id, question_key, storage_path, mime, status,
                                      transcript_live, transcript_final, audio_missing, edited_by_respondent)
      values (prop, rid, k, null, 'none', 'submitted', live, nullif(final, ''),
              coalesce((vm ->> 'audio_missing')::boolean, false), final <> '' and final is distinct from coalesce(live, ''))
      returning id into nid;
    else
      -- no audio arrived and no live text: keep typed text, drop empty answers
      if final = '' then answers := answers - k; end if;
      continue;
    end if;
    if answers ? k then answers := jsonb_set(answers, array[k, 'voice_note_id'], to_jsonb(nid::text)); end if;
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

-- the worker fills a pending answer: new answers use `text`, legacy ones `value`
create or replace function public.voice_save_transcript(p_note_id uuid, p_text text, p_language text, p_duration numeric default null)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare note public.voice_notes; r public.responses; a jsonb; field text;
begin
  update public.voice_notes set
    transcript_machine = left(coalesce(p_text, ''), 5000),
    language = p_language,
    duration_seconds = coalesce(p_duration, duration_seconds),
    status = case when status = 'submitted' then 'submitted' else 'transcribed' end,
    last_error = null, next_attempt_at = null
  where id = p_note_id returning * into note;
  if not found then return; end if;

  select * into r from public.responses where id = note.response_id for update;
  if found then
    a := r.answers -> note.question_key;
    field := case when a ? 'value' and not a ? 'text' then 'value' else 'text' end;
    if a is not null and coalesce(a ->> field, '') = '' and coalesce(p_text, '') <> '' then
      update public.responses set answers = jsonb_set(answers, array[note.question_key],
        a || jsonb_build_object(field, left(p_text, 2000), 'display',
          case when coalesce(a ->> 'display', '') like '(voice note%' or coalesce(a ->> 'display', '') = '' then left(p_text, 2000)
               else (a ->> 'display') || ' — ' || left(p_text, 2000) end))
      where id = r.id;
      update public.voice_notes set transcript_final = left(p_text, 2000), edited_by_respondent = false where id = note.id;
      perform public.sls_store_match(r.id, public.sls_match_with((select x from public.responses x where x.id = r.id),
                                     public.sls_current_set_json(r.property_id)), 'voice transcribed');
    end if;
    insert into public.lead_events (response_id, property_id, type, data)
    values (r.id, r.property_id, 'voice_transcribed', jsonb_build_object('question_key', note.question_key, 'language', p_language));
  end if;
end $$;

-- recordings that were never stored (storage_path null) are never sent to the worker
create or replace function public.voice_claim_transcribe(p_limit int default 5) returns setof public.voice_notes
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return query
  update public.voice_notes v set transcribe_attempts = v.transcribe_attempts + 1,
         status = case when v.status = 'submitted' then 'submitted' else 'transcribing' end,
         next_attempt_at = now() + interval '5 minutes'
  where v.id in (
    select id from public.voice_notes
    where transcript_machine is null and audio_deleted_at is null and storage_path is not null and transcribe_attempts < 6
      and status in ('uploaded', 'submitted', 'transcribing', 'uploading')
      and (status <> 'uploading' or created_at < now() - interval '10 minutes')
      and (next_attempt_at is null or next_attempt_at <= now())
      and (status = 'submitted' or exists (select 1 from public.responses r where r.id = voice_notes.response_id)
           or created_at < now() - interval '10 minutes')
    order by (status = 'submitted') desc, created_at
    limit p_limit for update skip locked)
  returning v.*;
end $$;

create or replace function public.audio_expired(p_limit int default 50) returns table (id uuid, storage_path text)
language sql security definer set search_path = public, pg_temp as $$
  select v.id, v.storage_path from public.voice_notes v join public.properties p on p.id = v.property_id
  where v.audio_deleted_at is null and v.storage_path is not null and v.created_at < now() - make_interval(days => p.audio_retention_days)
  union all
  select v.id, v.storage_path from public.voice_notes v
  where v.audio_deleted_at is null and v.storage_path is not null and v.created_at < now() - interval '7 days'
    and not exists (select 1 from public.responses r where r.id = v.response_id)
  limit p_limit
$$;

create or replace function public.health_snapshot() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'now', now(),
    'last_heartbeat', (select max(created_at) from public.heartbeat where source = 'pg_cron'),
    'last_worker_run', (select max(created_at) from public.heartbeat where source = 'transcribe-worker'),
    'voice_pending', (select count(*) from public.voice_notes where transcript_machine is null and storage_path is not null and status in ('uploaded','submitted','transcribing') and audio_deleted_at is null),
    'voice_stuck', (select count(*) from public.voice_notes where transcript_machine is null and storage_path is not null and status = 'submitted' and created_at < now() - interval '1 hour'),
    'voice_failed', (select count(*) from public.voice_notes where status = 'failed'),
    'notify_pending', (select count(*) from public.notifications where status = 'pending'),
    'notify_failed', (select count(*) from public.notifications where status = 'failed'),
    'responses_24h', (select count(*) from public.responses where created_at > now() - interval '24 hours'))
$$;

grant execute on function public.sls_default_modes(), public.sls_legacy_modes(text, boolean, boolean, jsonb, text), public.sls_numeric_modes(jsonb)
  to authenticated, service_role;

-- reasons: "answered …" must see new-shape answers (choose / number / text) as well as legacy ones
create or replace function public.sls_cond_text(q jsonb, qkey text, op text, v jsonb, answer jsonb) returns text
language plpgsql immutable as $$
declare label text := coalesce(q ->> 'label_en', qkey); rhs text; ans text; ev jsonb;
begin
  if op in ('answered', 'not_answered') then rhs := '';
  elsif op = 'between' and jsonb_typeof(v) = 'array' then
    rhs := ' ' || public.sls_value_text(q, v -> 0) || ' and ' || public.sls_value_text(q, v -> 1);
  else rhs := ' ' || public.sls_value_text(q, v); end if;
  ev := public.sls_values(jsonb_build_object('x', answer)) -> 'x';
  if answer is null or ev is null then ans := 'not answered';
  else ans := 'answered ' || coalesce(nullif(answer ->> 'display', ''), public.sls_value_text(q, ev)); end if;
  if op in ('answered', 'not_answered') then
    return label || ' — ' || ans;
  end if;
  return label || ' ' || public.sls_op_text(op) || rhs || ' — ' || ans;
end $$;
