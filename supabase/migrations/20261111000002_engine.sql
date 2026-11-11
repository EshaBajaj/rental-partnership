-- show_if + profile matching engine (pure SQL functions).
-- show_if semantics MUST match supabase/functions/_shared/showif.ts.

create or replace function public.sls_is_answered(a jsonb) returns boolean
language sql immutable as $$
  select case
    when a is null or jsonb_typeof(a) = 'null' then false
    when jsonb_typeof(a) = 'string' then btrim(a #>> '{}') <> ''
    when jsonb_typeof(a) = 'array' then jsonb_array_length(a) > 0
    else true
  end
$$;

create or replace function public.sls_num(a jsonb) returns numeric
language sql immutable as $$
  select case
    when a is null then null
    when jsonb_typeof(a) = 'number' then (a #>> '{}')::numeric
    when jsonb_typeof(a) = 'string' and btrim(a #>> '{}') ~ '^-?[0-9]+(\.[0-9]+)?$' then btrim(a #>> '{}')::numeric
    else null
  end
$$;

create or replace function public.sls_scalar_eq(x jsonb, v jsonb) returns boolean
language sql immutable as $$
  select case
    when x is null or v is null then false
    when jsonb_typeof(x) in ('null', 'object', 'array') or jsonb_typeof(v) in ('null', 'object', 'array') then false
    when jsonb_typeof(x) = 'number' and jsonb_typeof(v) = 'number' then (x #>> '{}')::numeric = (v #>> '{}')::numeric
    else (x #>> '{}') = (v #>> '{}')
  end
$$;

-- -1 / 0 / 1, or null when not comparable
create or replace function public.sls_cmp(a jsonb, b jsonb) returns int
language plpgsql immutable as $$
declare na numeric; nb numeric; sa text; sb text;
begin
  if a is null or b is null then return null; end if;
  if jsonb_typeof(a) in ('null', 'object', 'array') or jsonb_typeof(b) in ('null', 'object', 'array') then return null; end if;
  na := public.sls_num(a); nb := public.sls_num(b);
  if na is not null and nb is not null then
    return case when na = nb then 0 when na < nb then -1 else 1 end;
  end if;
  sa := a #>> '{}'; sb := b #>> '{}';
  return case when sa = sb then 0 when sa collate "C" < sb collate "C" then -1 else 1 end;
end $$;

create or replace function public.sls_as_array(x jsonb) returns jsonb
language sql immutable as $$
  select case when x is null then '[]'::jsonb when jsonb_typeof(x) = 'array' then x else jsonb_build_array(x) end
$$;

create or replace function public.sls_any_eq(xs jsonb, vs jsonb) returns boolean
language sql immutable as $$
  select coalesce(bool_or(public.sls_scalar_eq(x, y)), false)
  from jsonb_array_elements(public.sls_as_array(xs)) x, jsonb_array_elements(public.sls_as_array(vs)) y
$$;

create or replace function public.sls_eval_op(op text, a jsonb, v jsonb) returns boolean
language plpgsql immutable as $$
declare c int; lo int; hi int;
begin
  if op = 'answered' then return public.sls_is_answered(a); end if;
  if op = 'not_answered' then return not public.sls_is_answered(a); end if;
  if not public.sls_is_answered(a) then return false; end if;
  case op
    when 'eq' then
      if jsonb_typeof(a) = 'array' then return public.sls_any_eq(a, jsonb_build_array(v)); end if;
      return public.sls_scalar_eq(a, v);
    when 'neq' then return not public.sls_eval_op('eq', a, v);
    when 'in' then return public.sls_any_eq(a, v);
    when 'not_in' then return not public.sls_any_eq(a, v);
    when 'gte' then c := public.sls_cmp(a, v); return c is not null and c >= 0;
    when 'lte' then c := public.sls_cmp(a, v); return c is not null and c <= 0;
    when 'between' then
      if v is null or jsonb_typeof(v) <> 'array' or jsonb_array_length(v) <> 2 then return false; end if;
      lo := public.sls_cmp(a, v -> 0); hi := public.sls_cmp(a, v -> 1);
      return lo is not null and hi is not null and lo >= 0 and hi <= 0;
    when 'contains_any' then return public.sls_any_eq(a, v);
    when 'contains_all' then
      if jsonb_array_length(public.sls_as_array(v)) = 0 then return false; end if;
      return not exists (
        select 1 from jsonb_array_elements(public.sls_as_array(v)) y
        where not exists (select 1 from jsonb_array_elements(public.sls_as_array(a)) x where public.sls_scalar_eq(x, y))
      );
    else return false;
  end case;
end $$;

create or replace function public.sls_eval_showif(node jsonb, vals jsonb) returns boolean
language plpgsql immutable as $$
declare item jsonb; r boolean;
begin
  if node is null or jsonb_typeof(node) = 'null' then return true; end if;
  if node ? 'q' and node ? 'op' then
    return public.sls_eval_op(node ->> 'op', vals -> (node ->> 'q'), node -> 'v');
  end if;
  if node ? 'all' then
    for item in select * from jsonb_array_elements(node -> 'all') loop
      if not public.sls_eval_showif(item, vals) then return false; end if;
    end loop;
    return true;
  end if;
  if node ? 'any' then
    if jsonb_array_length(node -> 'any') = 0 then return true; end if;
    for item in select * from jsonb_array_elements(node -> 'any') loop
      if public.sls_eval_showif(item, vals) then return true; end if;
    end loop;
    return false;
  end if;
  return false;
end $$;

-- answers {key:{value,...}} -> {key:value} as seen by the engines
create or replace function public.sls_values(answers jsonb) returns jsonb
language sql immutable as $$
  select coalesce(jsonb_object_agg(k,
    case when (a -> 'value') = '""'::jsonb and coalesce(a ->> 'voice_note_id', '') <> '' then '"(voice note)"'::jsonb
         else a -> 'value' end), '{}'::jsonb)
  from jsonb_each(coalesce(answers, '{}'::jsonb)) as e(k, a)
$$;

-- keys of visible questions, in form order (hidden answers discarded progressively)
create or replace function public.sls_visible_keys(config jsonb, vals jsonb) returns text[]
language plpgsql immutable as $$
declare q jsonb; eff jsonb := '{}'::jsonb; vis text[] := '{}';
begin
  if config is null then return vis; end if;
  for q in select * from jsonb_array_elements(config -> 'questions') loop
    if public.sls_eval_showif(q -> 'show_if', eff) then
      vis := vis || (q ->> 'key');
      if vals ? (q ->> 'key') then eff := eff || jsonb_build_object(q ->> 'key', vals -> (q ->> 'key')); end if;
    end if;
  end loop;
  return vis;
end $$;

-- ---------------------------------------------------------------- explanations
create or replace function public.sls_inr(n numeric) returns text
language plpgsql immutable as $$
declare s text; intpart text; frac text := ''; last3 text; rest text; neg boolean := n < 0;
begin
  if n is null then return null; end if;
  s := trim(to_char(abs(n), 'FM999999999999990.99'));
  s := rtrim(rtrim(s, '0'), '.');
  if position('.' in s) > 0 then frac := substr(s, position('.' in s)); intpart := split_part(s, '.', 1);
  else intpart := s; end if;
  if length(intpart) > 3 then
    last3 := right(intpart, 3); rest := left(intpart, length(intpart) - 3);
    rest := regexp_replace(rest, '(\d)(?=(\d\d)+$)', '\1,', 'g');
    intpart := rest || ',' || last3;
  end if;
  return (case when neg then '-' else '' end) || '₹' || intpart || frac;
end $$;

-- label for a value of a question (option labels, ₹ formatting, lists)
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
    if q ->> 'type' = 'currency' and public.sls_num(v) is not null then return public.sls_inr(public.sls_num(v)); end if;
  end if;
  return v #>> '{}';
end $$;

create or replace function public.sls_op_text(op text) returns text
language sql immutable as $$
  select case op
    when 'eq' then 'is' when 'neq' then 'is not' when 'in' then 'is one of' when 'not_in' then 'is none of'
    when 'gte' then '≥' when 'lte' then '≤' when 'between' then 'is between'
    when 'contains_any' then 'includes any of' when 'contains_all' then 'includes all of'
    when 'answered' then 'answered' when 'not_answered' then 'not answered' else op end
$$;

-- "Monthly rent ≥ ₹40,000 — answered ₹45,000"
create or replace function public.sls_cond_text(q jsonb, qkey text, op text, v jsonb, answer jsonb) returns text
language plpgsql immutable as $$
declare label text := coalesce(q ->> 'label_en', qkey); rhs text; ans text;
begin
  if op in ('answered', 'not_answered') then rhs := '';
  elsif op = 'between' and jsonb_typeof(v) = 'array' then
    rhs := ' ' || public.sls_value_text(q, v -> 0) || ' and ' || public.sls_value_text(q, v -> 1);
  else rhs := ' ' || public.sls_value_text(q, v); end if;
  if answer is null or not public.sls_is_answered(answer -> 'value') then ans := 'not answered';
  else ans := 'answered ' || coalesce(answer ->> 'display', public.sls_value_text(q, answer -> 'value')); end if;
  if op in ('answered', 'not_answered') then
    return label || ' — ' || ans;
  end if;
  return label || ' ' || public.sls_op_text(op) || rhs || ' — ' || ans;
end $$;

-- ---------------------------------------------------------------- settings
create or replace function public.sls_default_settings() returns jsonb
language sql immutable as $$
  select '{
    "weights": {"important": 3, "nice": 1},
    "thresholds": {"ideal": 80, "maybe": 50},
    "priority": {"match": 0.7, "intent": 0.3},
    "intent": {
      "timing_key": "start_when",
      "timing_points": {"immediately": 40, "within_1_month": 30, "1_3_months": 15, "later": 0},
      "voice_points": 25, "all_optional_points": 15, "whatsapp_points": 10,
      "duration_points": 10, "duration_min_seconds": 30, "duration_max_seconds": 900,
      "bot_below_seconds": 15
    }
  }'::jsonb
$$;

-- deep merge b over a (objects only)
create or replace function public.sls_merge(a jsonb, b jsonb) returns jsonb
language sql immutable as $$
  select case
    when a is null then b
    when b is null or jsonb_typeof(b) <> 'object' then a
    else (
      select coalesce(jsonb_object_agg(k,
        case when jsonb_typeof(a -> k) = 'object' and jsonb_typeof(b -> k) = 'object' and k <> 'timing_points'
             then public.sls_merge(a -> k, b -> k)
             else coalesce(b -> k, a -> k) end), '{}'::jsonb)
      from (select jsonb_object_keys(a) k union select jsonb_object_keys(b)) keys
    ) end
$$;

-- ---------------------------------------------------------------- profile set snapshot
create or replace function public.sls_profile_set_json(p_set_id uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', s.id,
    'version', s.version,
    'settings', public.sls_merge(public.sls_default_settings(), s.settings),
    'profiles', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.name, 'position', p.position,
        'conditions', coalesce((
          select jsonb_agg(jsonb_build_object('question_key', c.question_key, 'operator', c.operator, 'value', c.value, 'importance', c.importance) order by c.position, c.id)
          from public.profile_conditions c where c.profile_id = p.id), '[]'::jsonb)
      ) order by p.position, p.created_at)
      from public.profiles p where p.profile_set_id = s.id and p.active), '[]'::jsonb),
    'never', coalesce((
      select jsonb_agg(jsonb_build_object('question_key', n.question_key, 'operator', n.operator, 'value', n.value, 'label', n.label) order by n.label)
      from public.never_rules n where n.profile_set_id = s.id), '[]'::jsonb)
  )
  from public.profile_sets s where s.id = p_set_id
$$;

-- ---------------------------------------------------------------- the matcher
-- Pure function: everything it needs is passed in.
create or replace function public.sls_compute_match(
  p_config jsonb, p_answers jsonb, p_duration int, p_whatsapp_ok boolean, p_path text, p_set jsonb
) returns jsonb
language plpgsql immutable as $$
declare
  settings jsonb := public.sls_merge(public.sls_default_settings(), p_set -> 'settings');
  vals jsonb := public.sls_values(p_answers);
  visible text[] := public.sls_visible_keys(p_config, vals);
  qmap jsonb;
  prof jsonb; cond jsonb; rule jsonb; q jsonb;
  w_imp numeric := coalesce((settings #>> '{weights,important}')::numeric, 3);
  w_nice numeric := coalesce((settings #>> '{weights,nice}')::numeric, 1);
  t_ideal numeric := coalesce((settings #>> '{thresholds,ideal}')::numeric, 80);
  t_maybe numeric := coalesce((settings #>> '{thresholds,maybe}')::numeric, 50);
  p_match numeric := coalesce((settings #>> '{priority,match}')::numeric, 0.7);
  p_intent numeric := coalesce((settings #>> '{priority,intent}')::numeric, 0.3);
  it jsonb := settings -> 'intent';
  matches jsonb := '[]'::jsonb;
  matched jsonb; missed jsonb; failed jsonb;
  total numeric; got numeric; w numeric; met boolean; m numeric; item jsonb;
  best jsonb; never_hit jsonb := '[]'::jsonb;
  intent int := 0; breakdown jsonb := '{}'::jsonb; pts int;
  timing text; all_opt boolean := true; has_voice boolean;
  tier text; best_match numeric; prio numeric; bot boolean;
begin
  select coalesce(jsonb_object_agg(x ->> 'key', x), '{}'::jsonb) into qmap
  from jsonb_array_elements(coalesce(p_config -> 'questions', '[]'::jsonb)) x;

  -- profiles
  for prof in select * from jsonb_array_elements(coalesce(p_set -> 'profiles', '[]'::jsonb)) loop
    matched := '[]'; missed := '[]'; failed := '[]'; total := 0; got := 0;
    for cond in select * from jsonb_array_elements(coalesce(prof -> 'conditions', '[]'::jsonb)) loop
      continue when not ((cond ->> 'question_key') = any (visible)); -- inapplicable: ignored
      q := qmap -> (cond ->> 'question_key');
      met := public.sls_eval_op(cond ->> 'operator', vals -> (cond ->> 'question_key'), cond -> 'value');
      item := jsonb_build_object(
        'question_key', cond ->> 'question_key', 'operator', cond ->> 'operator', 'value', cond -> 'value',
        'importance', cond ->> 'importance',
        'text', public.sls_cond_text(q, cond ->> 'question_key', cond ->> 'operator', cond -> 'value', p_answers -> (cond ->> 'question_key')));
      if cond ->> 'importance' = 'must' then
        if met then matched := matched || item; else failed := failed || item; end if;
      else
        w := case when cond ->> 'importance' = 'important' then w_imp else w_nice end;
        total := total + w;
        if met then got := got + w; matched := matched || item; else missed := missed || item; end if;
      end if;
    end loop;
    m := case when total = 0 then 100 else round(100 * got / total, 1) end;
    matches := matches || jsonb_build_object(
      'profile_id', prof ->> 'id', 'name', prof ->> 'name', 'position', coalesce((prof ->> 'position')::int, 0),
      'match', m, 'qualified', jsonb_array_length(failed) = 0,
      'matched', matched, 'missed', missed, 'failed_must', failed);
  end loop;

  select coalesce(jsonb_agg(x order by (x ->> 'qualified')::boolean desc, (x ->> 'match')::numeric desc, (x ->> 'position')::int), '[]'::jsonb)
  into matches from jsonb_array_elements(matches) x;
  best := matches -> 0;

  -- never rules
  for rule in select * from jsonb_array_elements(coalesce(p_set -> 'never', '[]'::jsonb)) loop
    continue when not ((rule ->> 'question_key') = any (visible));
    if public.sls_eval_op(rule ->> 'operator', vals -> (rule ->> 'question_key'), rule -> 'value') then
      never_hit := never_hit || jsonb_build_object('label', rule ->> 'label', 'question_key', rule ->> 'question_key',
        'text', public.sls_cond_text(qmap -> (rule ->> 'question_key'), rule ->> 'question_key', rule ->> 'operator', rule -> 'value', p_answers -> (rule ->> 'question_key')));
    end if;
  end loop;

  -- intent
  timing := vals ->> (it ->> 'timing_key');
  pts := coalesce((it -> 'timing_points' ->> timing)::int, 0);
  intent := intent + pts; breakdown := breakdown || jsonb_build_object('timing', pts);

  select exists (select 1 from jsonb_each(coalesce(p_answers, '{}')) e(k, a) where coalesce(a ->> 'voice_note_id', '') <> '') into has_voice;
  pts := case when has_voice then coalesce((it ->> 'voice_points')::int, 0) else 0 end;
  intent := intent + pts; breakdown := breakdown || jsonb_build_object('voice', pts);

  select coalesce(bool_and(public.sls_is_answered(vals -> (x ->> 'key'))), true) into all_opt
  from jsonb_array_elements(coalesce(p_config -> 'questions', '[]'::jsonb)) x
  where (x ->> 'key') = any (visible) and not coalesce((x ->> 'required')::boolean, false);
  pts := case when all_opt and p_path <> 'waitlist' then coalesce((it ->> 'all_optional_points')::int, 0) else 0 end;
  intent := intent + pts; breakdown := breakdown || jsonb_build_object('all_optional', pts);

  pts := case when p_whatsapp_ok then coalesce((it ->> 'whatsapp_points')::int, 0) else 0 end;
  intent := intent + pts; breakdown := breakdown || jsonb_build_object('whatsapp', pts);

  pts := case when p_duration between coalesce((it ->> 'duration_min_seconds')::int, 30) and coalesce((it ->> 'duration_max_seconds')::int, 900)
              then coalesce((it ->> 'duration_points')::int, 0) else 0 end;
  intent := intent + pts; breakdown := breakdown || jsonb_build_object('duration', pts);
  intent := least(greatest(intent, 0), 100);
  bot := p_duration < coalesce((it ->> 'bot_below_seconds')::int, 15);

  -- tier
  best_match := (best ->> 'match')::numeric;
  if p_path = 'waitlist' then
    best := null; best_match := null; matches := '[]'; tier := 'maybe';
  elsif jsonb_array_length(never_hit) > 0 then tier := 'no';
  elsif best is null then tier := 'maybe'; -- no active profiles: nothing to rank against
  elsif (best ->> 'qualified')::boolean and best_match >= t_ideal then tier := 'ideal';
  elsif best_match >= t_maybe then tier := 'maybe';
  else tier := 'no';
  end if;
  prio := round(p_match * coalesce(best_match, 0) + p_intent * intent, 2);

  return jsonb_build_object(
    'profile_set_id', p_set ->> 'id',
    'profile_set_version', (p_set ->> 'version')::int,
    'best_profile_id', best ->> 'profile_id',
    'best_profile_name', best ->> 'name',
    'best_qualified', coalesce((best ->> 'qualified')::boolean, false),
    'best_match', best_match,
    'profile_matches', matches,
    'never_hit', never_hit,
    'intent_score', intent,
    'intent_breakdown', breakdown,
    'priority', prio,
    'tier', tier,
    'suspected_bot', bot,
    'visible_keys', to_jsonb(visible));
end $$;
