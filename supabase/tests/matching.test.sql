-- Profile matching, intent, tiers, duplicates, idempotency, notifications.
do $$
declare r jsonb; row public.responses; pm jsonb;
begin
  -- A: ideal renter
  r := t.submit('a0000000-0000-4000-8000-000000000001', jsonb_build_object(
    'path', t.a('"rent"'), 'business_type', t.a('"grocery"'), 'start_when', t.a('"immediately"'),
    'rent_budget', t.a('45000', '₹45,000'), 'lease_years', t.a('"3_5"'), 'experience', t.a('"yes"')));
  perform t.eq(r ->> 'status', 'created', 'A created');
  perform t.eq(r ->> 'tier', 'ideal', 'A ideal');
  perform t.eq((r ->> 'notify')::boolean, true, 'A notify');
  select * into row from public.responses where id = 'a0000000-0000-4000-8000-000000000001';
  perform t.eq(row.best_match, 100.0, 'A match');
  perform t.eq(row.intent_score, 60, 'A intent = 40 timing + 10 whatsapp + 10 duration');
  perform t.eq(row.priority, 88.00, 'A priority = .7*100 + .3*60');
  perform t.eq(row.match_detail ->> 'best_profile_name', 'Established retailer (rent)', 'A best profile');
  perform t.eq(row.match_detail -> 'best_qualified', 'true'::jsonb, 'A qualified');
  perform t.eq(row.suspected_bot, false, 'A not bot');
  perform t.eq((select count(*) from public.notifications where response_id = row.id)::int, 1, 'A notification queued');
  perform t.eq((select count(*) from public.lead_events where response_id = row.id and type = 'created')::int, 1, 'A created event');
  -- explanation text
  pm := row.profile_matches -> 0;
  perform t.ok((pm -> 'matched') @> '[{"question_key":"rent_budget"}]', 'rent_budget matched');
  perform t.eq((select x ->> 'text' from jsonb_array_elements(pm -> 'matched') x where x ->> 'question_key' = 'rent_budget'),
               'How much monthly rent can you pay? ≥ ₹40,000 — answered ₹45,000', 'reason text');
  -- partner profile: unqualified (must path fails), partner-only questions inapplicable
  pm := row.profile_matches -> 1;
  perform t.eq(pm ->> 'qualified', 'false', 'partner unqualified');
  perform t.eq(jsonb_array_length(pm -> 'failed_must'), 1, 'one failed must');
  perform t.eq(jsonb_array_length(pm -> 'missed'), 0, 'investment/role inapplicable, not missed');

  -- idempotent retry
  r := t.submit('a0000000-0000-4000-8000-000000000001', '{"path":{"value":"rent"}}');
  perform t.eq(r ->> 'status', 'existing', 'retry returns existing');
  perform t.eq((select count(*) from public.responses)::int, 1, 'no duplicate row');

  -- B: maybe (50%)
  r := t.submit('a0000000-0000-4000-8000-000000000002', jsonb_build_object(
    'path', t.a('"rent"'), 'business_type', t.a('"pharmacy"'), 'start_when', t.a('"later"'),
    'rent_budget', t.a('45000'), 'lease_years', t.a('"1_2"'), 'experience', t.a('"yes"')), '+919800000002');
  perform t.eq(r ->> 'tier', 'maybe', 'B maybe');
  perform t.eq((select best_match from public.responses where id = 'a0000000-0000-4000-8000-000000000002'), 50.0, 'B 4/8');
  perform t.eq((r ->> 'notify')::boolean, false, 'B no notify');

  -- C: never rule
  r := t.submit('a0000000-0000-4000-8000-000000000003', jsonb_build_object(
    'path', t.a('"rent"'), 'business_type', t.a('"restaurant"'), 'start_when', t.a('"immediately"'),
    'rent_budget', t.a('90000'), 'lease_years', t.a('"5_plus"'), 'experience', t.a('"yes"')), '+919800000003');
  perform t.eq(r ->> 'tier', 'no', 'C never rule → no');
  perform t.eq((select never_hit -> 0 ->> 'label' from public.responses where id = 'a0000000-0000-4000-8000-000000000003'),
               'No cooking allowed in this building', 'C never label');

  -- E: either path → lease_years inapplicable (6/7), partner role inapplicable
  r := t.submit('a0000000-0000-4000-8000-000000000004', jsonb_build_object(
    'path', t.a('"either"'), 'business_type', t.a('"clothing"'), 'start_when', t.a('"immediately"'),
    'rent_budget', t.a('50000'), 'investment', t.a('2000000'), 'experience', t.a('"no"')), '+919800000004');
  select * into row from public.responses where id = 'a0000000-0000-4000-8000-000000000004';
  perform t.eq(row.best_match, 85.7, 'E 6/7');
  perform t.eq(row.tier, 'ideal', 'E ideal');
  perform t.eq((row.profile_matches -> 1 ->> 'match')::numeric, 75.0, 'E partner 3/4');

  -- F: bot (10 s) → no notification even when ideal
  r := t.submit('a0000000-0000-4000-8000-000000000005', jsonb_build_object(
    'path', t.a('"rent"'), 'business_type', t.a('"grocery"'), 'start_when', t.a('"immediately"'),
    'rent_budget', t.a('45000'), 'lease_years', t.a('"3_5"'), 'experience', t.a('"yes"')), '+919800000005', 10);
  perform t.eq((select suspected_bot from public.responses where id = 'a0000000-0000-4000-8000-000000000005'), true, 'F bot');
  perform t.eq((r ->> 'notify')::boolean, false, 'F bot not notified');
  perform t.eq((select intent_score from public.responses where id = 'a0000000-0000-4000-8000-000000000005'), 50, 'F no duration points');

  -- G: duplicate phone within 30 days
  r := t.submit('a0000000-0000-4000-8000-000000000006', jsonb_build_object(
    'path', t.a('"rent"'), 'business_type', t.a('"grocery"'), 'start_when', t.a('"immediately"'),
    'rent_budget', t.a('45000'), 'lease_years', t.a('"3_5"'), 'experience', t.a('"yes"')));
  perform t.eq((r ->> 'duplicate_of')::uuid, 'a0000000-0000-4000-8000-000000000001'::uuid, 'G duplicate_of first');
  perform t.eq((r ->> 'notify')::boolean, false, 'G duplicate not notified');
  perform t.eq((select count(*) from public.lead_events where response_id = 'a0000000-0000-4000-8000-000000000006' and type = 'duplicate')::int, 1, 'G dup event');

  -- waitlist
  r := public.submit_response(jsonb_build_object('id', 'a0000000-0000-4000-8000-000000000007',
    'property_id', (select id from public.properties), 'form_version_id', null, 'path', 'waitlist', 'answers', '{}'::jsonb,
    'name', 'W', 'phone_e164', '+919800000007', 'whatsapp_ok', false, 'duration_seconds', 20));
  perform t.eq(r ->> 'tier', 'maybe', 'waitlist maybe');
  perform t.eq((select best_match from public.responses where id = 'a0000000-0000-4000-8000-000000000007'), null::numeric, 'waitlist no match');

  -- board order: pinned desc, tier, priority desc, created_at desc
  update public.responses set pinned = true where id = 'a0000000-0000-4000-8000-000000000003';
  perform t.eq((select array_agg(id order by pinned desc, tier_rank, priority desc, created_at desc) from public.responses)[1],
               'a0000000-0000-4000-8000-000000000003'::uuid, 'pinned first');
end $$;

-- near miss: nobody qualifies → best near-miss shown, tier capped at maybe
do $$
declare m jsonb;
begin
  m := public.sls_compute_match((select config from public.form_versions where is_current),
    jsonb_build_object('path', t.a('"rent"'), 'start_when', t.a('"immediately"'), 'rent_budget', t.a('45000')),
    120, true, 'rent',
    '{"id":null,"version":null,"settings":{},"never":[],"profiles":[{"id":"00000000-0000-4000-8000-0000000000aa","name":"Big spender","position":0,
      "conditions":[{"question_key":"rent_budget","operator":"gte","value":100000,"importance":"must"},
                    {"question_key":"start_when","operator":"eq","value":"immediately","importance":"important"}]}]}'::jsonb);
  perform t.eq(m ->> 'best_profile_name', 'Big spender', 'near miss shown');
  perform t.eq(m ->> 'best_qualified', 'false', 'near miss unqualified');
  perform t.eq((m ->> 'best_match')::numeric, 100.0, 'near miss match 100');
  perform t.eq(m ->> 'tier', 'maybe', 'near miss capped at maybe');

  -- no applicable weighted conditions → 100
  m := public.sls_compute_match((select config from public.form_versions where is_current),
    jsonb_build_object('path', t.a('"partner"')), 120, true, 'partner',
    '{"id":null,"settings":{},"never":[],"profiles":[{"id":"00000000-0000-4000-8000-0000000000ab","name":"Renter","position":0,
      "conditions":[{"question_key":"rent_budget","operator":"gte","value":1,"importance":"important"}]}]}'::jsonb);
  perform t.eq((m ->> 'best_match')::numeric, 100, 'inapplicable only → 100');

  -- custom thresholds / weights / priority from settings
  m := public.sls_compute_match((select config from public.form_versions where is_current),
    jsonb_build_object('path', t.a('"rent"'), 'start_when', t.a('"later"'), 'rent_budget', t.a('45000')), 120, false, 'rent',
    '{"id":null,"settings":{"weights":{"important":1,"nice":1},"thresholds":{"ideal":40,"maybe":10},"priority":{"match":1,"intent":0}},"never":[],
      "profiles":[{"id":"00000000-0000-4000-8000-0000000000ac","name":"R","position":0,
      "conditions":[{"question_key":"rent_budget","operator":"gte","value":40000,"importance":"important"},
                    {"question_key":"start_when","operator":"eq","value":"immediately","importance":"nice"}]}]}'::jsonb);
  perform t.eq((m ->> 'best_match')::numeric, 50.0, 'custom weights');
  perform t.eq(m ->> 'tier', 'ideal', 'custom thresholds');
  perform t.eq((m ->> 'priority')::numeric, 50.00, 'custom priority');
end $$;
