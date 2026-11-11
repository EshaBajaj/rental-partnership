-- Form builder safety: publish validator, archive vs delete, key/type locks, dependencies, versions.
do $$
declare prop uuid := (select id from public.properties where slug = 'main-road-shop');
  qexp uuid := (select id from public.questions where key = 'experience');
  qbiz uuid := (select id from public.questions where key = 'business_type');
  qnew uuid; qyears uuid; o uuid; res jsonb; ids uuid[]; r text; d uuid;
begin
  -- nothing changed → publish refused
  perform t.throws(format('select public.publish_form(%L)', prop), 'Nothing changed', 'no-op publish refused');

  -- published question: no hard delete, key locked, incompatible type locked, compatible ok
  perform t.throws(format('delete from public.questions where id = %L', qexp), 'only be archived', 'published delete blocked');
  perform t.throws(format('update public.questions set key = %L where id = %L', 'exp2', qexp), 'locked', 'key locked');
  perform t.throws(format('update public.questions set kind = %L, input_modes = null where id = %L', 'yes_no', qbiz), 'needs a new question', 'incompatible kind');
  -- input-mode changes are compatible in-place edits on published questions
  update public.questions set input_modes = jsonb_set(input_modes, '{choose,style}', '"dropdown"') where id = qbiz;
  perform t.eq((select input_modes #>> '{choose,style}' from public.questions where id = qbiz), 'dropdown', 'radio → dropdown in place');
  update public.questions set input_modes = input_modes || '{"type":{"enabled":true,"multiline":false,"min_chars":null,"max_chars":50,"placeholder_en":null,"placeholder_hi":null,"format":"any"}}' where id = qbiz;
  perform t.eq((select input_modes #>> '{type,max_chars}' from public.questions where id = qbiz), '50', 'type mode + char limit in place');
  update public.questions set input_modes = jsonb_set(jsonb_set(input_modes, '{choose,style}', '"radio"'), '{type,enabled}', 'false') where id = qbiz;
  perform t.throws(format('update public.questions set input_modes = %L where id = %L', '{"primary":"nope"}', qbiz), 'questions_modes_shape', 'modes shape checked');
  perform t.throws(format('update public.question_options set value = %L where question_id = %L and value = %L', 'kirana', qbiz, 'grocery'), 'locked', 'option value locked');
  perform t.throws(format('delete from public.question_options where question_id = %L and value = %L', qbiz, 'grocery'), 'only be archived', 'published option delete blocked');
  perform t.throws(format('update public.question_options set archived_at = now() where value = %L', 'rent'), 'cannot be changed', 'path option locked');
  perform t.throws(format('update public.questions set archived_at = now() where key = %L', 'path'), 'cannot be archived', 'path locked');

  -- new (unpublished) question depending on experience; reorder above it → validator names both
  insert into public.questions (property_id, key, kind, input_modes, label_en, position, required, show_if)
  values (prop, 'years', 'standard', public.sls_default_modes() || '{"primary":"type","choose":{"enabled":false},"type":{"enabled":true,"format":"number","max_chars":3}}', 'How many years?', 8, false, '{"all":[{"q":"experience","op":"eq","v":"yes"}]}') returning id into qyears;
  select array_agg(id order by case when id = qyears then 2.5 else position end, created_at) into ids from public.questions where property_id = prop and archived_at is null;
  perform public.reorder_questions(prop, ids);
  perform t.ok(array_to_string(public.sls_validate_draft(prop), '|') like '%“How many years?” depends on “Have you run a shop before?”, but “Have you run a shop before?” comes after it. Move “Have you run a shop before?” above “How many years?”%', 'order message');
  perform t.throws(format('select public.publish_form(%L)', prop), 'comes after it', 'publish blocked');
  -- fix order, publish v2
  select array_agg(id order by case when id = qyears then (select position from public.questions where id = qexp) + 0.5 else position end, created_at) into ids from public.questions where property_id = prop and archived_at is null;
  perform public.reorder_questions(prop, ids);
  perform t.eq(array_to_string(public.sls_validate_draft(prop), '|'), '', 'valid again');
  res := public.publish_form(prop);
  perform t.eq((res ->> 'version')::int, 2, 'v2 published');
  perform t.ok((select first_published_at is not null from public.questions where id = qyears), 'years now published');
  perform t.eq((select count(*) from public.form_versions where is_current)::int, 1, 'one current version');

  -- form versions are immutable
  perform t.throws(format('update public.form_versions set config = %L where version = 1', '{}'), 'immutable', 'config immutable');
  perform t.throws('delete from public.form_versions where version = 1', 'cannot be deleted', 'versions not deletable');

  -- removing experience: dependencies must be handled
  perform t.throws(format('select public.remove_question_or_option(%L)', qexp), 'Still used in “when to show” of: How many years\?', 'show_if dependency blocks');
  d := public.create_profile_draft(prop);
  perform t.throws(format('select public.remove_question_or_option(%L, null, %L)', qexp, jsonb_build_object(qyears, null)),
                   'Still used in draft profiles', 'profile dependency blocks');
  r := public.remove_question_or_option(qexp, null, jsonb_build_object(qyears, null),
         (select array_agg(c.id) from public.profile_conditions c join public.profiles p on p.id = c.profile_id where p.profile_set_id = d and c.question_key = 'experience'));
  perform t.eq(r, 'archived', 'published → archived');
  perform t.eq((select show_if from public.questions where id = qyears), null::jsonb, 'show_if removed');
  perform t.ok((select archived_at is not null from public.questions where id = qexp), 'experience archived');

  -- option removal: unpublished option hard-deleted, published archived
  insert into public.question_options (question_id, value, label_en, position) values (qbiz, 'bakery', 'Bakery', 9) returning id into o;
  perform t.eq(public.remove_question_or_option(qbiz, o), 'deleted', 'unpublished option deleted');
  update public.questions set show_if = '{"all":[{"q":"business_type","op":"in","v":["salon","clothing"]}]}' where id = qyears;
  perform t.throws(format('select public.remove_question_or_option(%L, %L)', qbiz, (select id from public.question_options where question_id = qbiz and value = 'salon')),
                   'Still used', 'option dependency blocks');
  perform t.eq(public.remove_question_or_option(qbiz, (select id from public.question_options where question_id = qbiz and value = 'salon'),
               jsonb_build_object(qyears, '{"all":[{"q":"business_type","op":"in","v":["clothing"]}]}'::jsonb)), 'archived', 'published option archived');

  -- unpublished question: hard delete
  insert into public.questions (property_id, key, kind, input_modes, label_en, position) values (prop, 'tmp_q', 'standard', public.sls_default_modes(), 'Tmp', 50) returning id into qnew;
  perform t.eq(public.remove_question_or_option(qnew), 'deleted', 'unpublished question deleted');

  -- kind change on a published question: new key, old archived, refs migrated
  update public.questions set show_if = '{"all":[{"q":"start_when","op":"eq","v":"immediately"}]}' where id = qyears;
  qnew := public.replace_question_kind((select id from public.questions where key = 'start_when'), 'date', 'start_date');
  perform t.eq((select key || '/' || kind from public.questions where id = qnew), 'start_date/date', 'new key + kind');
  perform t.eq((select input_modes from public.questions where id = qnew), null::jsonb, 'date has no input modes');
  perform t.ok((select archived_at is not null from public.questions where key = 'start_when'), 'old archived');
  perform t.eq((select show_if #>> '{all,0,q}' from public.questions where id = qyears), 'start_date', 'show_if migrated');
  perform t.eq((select count(*) from public.profile_conditions c join public.profiles p on p.id = c.profile_id
                where p.profile_set_id = d and c.question_key = 'start_date')::int, 1, 'draft condition migrated');
  perform t.eq((select count(*) from public.profile_conditions c join public.profiles p on p.id = c.profile_id
                join public.profile_sets s on s.id = p.profile_set_id where s.is_current and c.question_key = 'start_when')::int, 1, 'published set untouched');
  perform t.throws(format('select public.replace_question_kind(%L, %L, %L)', (select id from public.questions where key = 'business_type'), 'yes_no', 'start_when'),
                   'already used', 'archived keys stay reserved');

  -- restore an older version (rollback)
  res := public.restore_form_version((select id from public.form_versions where version = 1));
  perform t.eq((res ->> 'restored_from')::int, 1, 'restored v1');
  perform t.eq((select config from public.form_versions where is_current), (select config from public.form_versions where version = 1), 'v1 config current');

  -- audit trail exists for config changes
  perform t.ok((select count(*) from public.audit_log where table_name = 'questions') > 0, 'audited');
end $$;

-- option removal shrinks draft profile conditions / never rules atomically
do $$
declare prop uuid := (select id from public.properties where slug = 'main-road-shop');
  qbiz uuid := (select id from public.questions where key = 'business_type');
  d uuid; c uuid; n uuid; oid uuid;
begin
  d := public.create_profile_draft(prop);
  insert into public.profile_conditions (profile_id, question_key, operator, value, importance)
  values ((select id from public.profiles where profile_set_id = d order by position limit 1), 'business_type', 'in', '["grocery","pharmacy"]', 'nice')
  returning id into c;
  update public.never_rules set operator = 'in', value = '["restaurant","pharmacy"]' where profile_set_id = d returning id into n;
  oid := (select id from public.question_options where question_id = qbiz and value = 'pharmacy');
  -- without the rewrites: refused, and nothing changed
  perform t.throws(format('select public.remove_question_or_option(%L, %L)', qbiz, oid), 'Still used in draft profiles', 'blocked');
  perform t.eq((select value from public.profile_conditions where id = c), '["grocery","pharmacy"]'::jsonb, 'untouched after failure');
  -- with the rewrites: one transaction
  perform t.eq(public.remove_question_or_option(qbiz, oid, '{}'::jsonb, '{}', '{}',
                 jsonb_build_object(c, '["grocery"]'::jsonb), jsonb_build_object(n, '["restaurant"]'::jsonb)), 'archived', 'archived');
  perform t.eq((select value from public.profile_conditions where id = c), '["grocery"]'::jsonb, 'condition shrunk');
  perform t.eq((select value from public.never_rules where id = n), '["restaurant"]'::jsonb, 'never rule shrunk');
end $$;
