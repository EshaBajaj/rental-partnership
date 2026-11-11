-- show_if parity: the same fixture is evaluated by the TS engine (apps/web/test/shared/parity.test.ts)
\set cases `cat supabase/tests/fixtures/showif_cases.json`
create temp table cases as select :'cases'::jsonb as j;
do $$
declare c jsonb; got boolean;
begin
  for c in select * from jsonb_array_elements((select j from cases)) loop
    got := public.sls_eval_showif(c -> 'expr', c -> 'vals');
    perform t.eq(got, (c ->> 'expected')::boolean, c ->> 'name');
  end loop;
end $$;

-- compile parity: SQL compile of the seed equals the published v1 config and has the expected shape
do $$
declare cfg jsonb := public.sls_compile_form((select id from public.properties where slug = 'main-road-shop'));
begin
  perform t.eq(jsonb_array_length(cfg -> 'questions'), 10, 'seed has 10 questions');
  perform t.eq(cfg #>> '{questions,0,key}', 'path', 'path first');
  perform t.eq(cfg #> '{questions,7,options}', '[{"value":"yes","label_en":"Yes","label_hi":"हाँ"},{"value":"no","label_en":"No","label_hi":"नहीं"}]'::jsonb, 'yes/no injected');
  perform t.eq(cfg #> '{questions,9,required}', 'true'::jsonb, 'contact required');
  perform t.eq(cfg #>> '{schema}', '2', 'schema 2');
  perform t.eq(cfg #>> '{questions,8,input_modes,primary}', 'speak', 'about_you speaks first');
  perform t.eq(cfg #> '{questions,8,input_modes,speak,live_transcript}', 'true'::jsonb, 'live transcript on');
  perform t.eq(cfg #> '{questions,7,input_modes}', 'null'::jsonb, 'yes/no has no modes');
  perform t.eq(cfg #> '{questions,3,validation}', '{"min":0,"max":10000000}'::jsonb, 'currency keeps min/max');
  perform t.eq(cfg #> '{questions,1,validation}', '{}'::jsonb, 'choice drops validation');
  perform t.eq(cfg, (select config from public.form_versions where is_current), 'published config = compile');
end $$;

-- visible keys per path
do $$
declare cfg jsonb := (select config from public.form_versions where is_current);
begin
  perform t.eq(public.sls_visible_keys(cfg, '{"path":"rent"}'),
    array['path','business_type','start_when','rent_budget','lease_years','experience','about_you','contact'], 'rent path');
  perform t.eq(public.sls_visible_keys(cfg, '{"path":"either","investment":5}'),
    array['path','business_type','start_when','rent_budget','investment','experience','about_you','contact'], 'either path');
  perform t.eq(public.sls_inr(1234567.5), '₹12,34,567.5', 'inr format');
  perform t.eq(public.sls_inr(40000), '₹40,000', 'inr format 2');
  perform t.eq(public.sls_inr(999), '₹999', 'inr small');
end $$;

-- legacy type → input modes mapping parity (same fixture as apps/web/test/shared/input-modes.test.ts)
\set legacy `cat supabase/tests/fixtures/legacy_modes.json`
create temp table legacy as select :'legacy'::jsonb as j;
do $$
declare c jsonb; got jsonb;
begin
  for c in select * from jsonb_array_elements((select j from legacy)) loop
    got := public.sls_legacy_modes(c ->> 'type', (c ->> 'allow_other')::boolean, (c ->> 'allow_voice')::boolean, c -> 'validation', c ->> 'placeholder');
    perform t.eq(coalesce(got, 'null'::jsonb), c -> 'expected', 'legacy mapping ' || (c ->> 'type'));
  end loop;
end $$;

-- answer values: new shape (arrays / number / text) and legacy shape read the same way
do $$
begin
  perform t.eq(public.sls_values('{"a":{"choose":["x","y"],"display":"","question_label":""}}'), '{"a":["x","y"]}'::jsonb, 'choose array');
  perform t.eq(public.sls_values('{"a":{"text":"45000","number":45000,"display":"","question_label":""}}'), '{"a":45000}'::jsonb, 'number');
  perform t.eq(public.sls_values('{"a":{"text":"hello","display":"","question_label":""}}'), '{"a":"hello"}'::jsonb, 'text');
  perform t.eq(public.sls_values('{"a":{"text":"","voice_note_id":"n1","display":"","question_label":""}}'), '{"a":"(voice note)"}'::jsonb, 'pending voice');
  perform t.eq(public.sls_values('{"a":{"value":"rent","display":"","question_label":""}}'), '{"a":"rent"}'::jsonb, 'legacy value');
  perform t.eq(public.sls_values('{"a":{"choose":[],"display":"","question_label":""}}'), '{}'::jsonb, 'empty pick = unanswered');
  perform t.ok(public.sls_eval_op('eq', '["rent"]', '"rent"'), 'radio array eq');
  perform t.ok(public.sls_eval_op('in', '["rent"]', '["rent","either"]'), 'radio array in');
end $$;
