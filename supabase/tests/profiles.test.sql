-- Profile sets: draft cloning, simulate (no writes), publish re-match + events, rollback, immutability, live count.
do $$
declare prop uuid := (select id from public.properties where slug = 'main-road-shop');
  v1 uuid := (select id from public.profile_sets where is_current);
  d uuid; sim jsonb; res jsonb; pid uuid; live jsonb; before_events int;
begin
  perform t.submit('b0000000-0000-4000-8000-000000000001', jsonb_build_object(
    'path', t.a('"rent"'), 'business_type', t.a('"grocery"'), 'start_when', t.a('"immediately"'),
    'rent_budget', t.a('45000'), 'lease_years', t.a('"3_5"'), 'experience', t.a('"yes"')), '+919811111111');
  perform t.submit('b0000000-0000-4000-8000-000000000002', jsonb_build_object(
    'path', t.a('"rent"'), 'business_type', t.a('"grocery"'), 'start_when', t.a('"immediately"'),
    'rent_budget', t.a('35000'), 'lease_years', t.a('"3_5"'), 'experience', t.a('"yes"')), '+919811111112');
  perform t.eq((select tier from public.responses where id = 'b0000000-0000-4000-8000-000000000002'), 'maybe', '35k = 5/8 maybe');

  -- published set is immutable
  perform t.throws(format('update public.profile_sets set settings = %L where id = %L', '{"x":1}', v1), 'immutable', 'v1 immutable');
  perform t.throws(format('insert into public.profiles (profile_set_id, name) values (%L, %L)', v1, 'x'), 'immutable', 'cannot add profile to v1');
  perform t.throws(format('delete from public.profile_conditions where profile_id in (select id from public.profiles where profile_set_id = %L)', v1), 'immutable', 'cannot delete v1 conditions');

  -- draft clones v1
  d := public.create_profile_draft(prop);
  perform t.eq(public.create_profile_draft(prop), d, 'one draft per property');
  perform t.eq((select count(*) from public.profiles where profile_set_id = d)::int, 2, 'profiles cloned');
  perform t.eq((select count(*) from public.never_rules where profile_set_id = d)::int, 1, 'never rules cloned');
  perform t.eq((select version from public.profile_sets where id = d), 2, 'draft is v2');

  -- lower the rent threshold to 30k in the draft
  update public.profile_conditions c set value = '30000' from public.profiles p
   where c.profile_id = p.id and p.profile_set_id = d and c.question_key = 'rent_budget';

  -- live counter for the edited profile
  live := public.live_profile_count(prop, jsonb_build_object('conditions',
    (select jsonb_agg(jsonb_build_object('question_key', c.question_key, 'operator', c.operator, 'value', c.value, 'importance', c.importance))
       from public.profile_conditions c join public.profiles p on p.id = c.profile_id where p.profile_set_id = d and p.position = 0)));
  perform t.eq((live ->> 'qualified')::int, 2, 'live: 2 qualify');
  perform t.eq((live ->> 'ideal')::int, 2, 'live: 2 would be ideal');

  -- simulate: no writes
  before_events := (select count(*) from public.lead_events);
  sim := public.simulate_profile_set(d);
  perform t.eq((sim ->> 'changed')::int, 1, 'one lead changes');
  perform t.eq(sim #>> '{changes,0,new_tier}', 'ideal', 'maybe → ideal');
  perform t.eq((sim #>> '{new,ideal}')::int, 2, 'counts new ideal');
  perform t.eq((sim #>> '{old,ideal}')::int, 1, 'counts old ideal');
  perform t.eq((select tier from public.responses where id = 'b0000000-0000-4000-8000-000000000002'), 'maybe', 'simulate wrote nothing');
  perform t.eq((select count(*) from public.lead_events)::int, before_events, 'simulate logged nothing');

  -- publish: re-match + tier_changed event
  res := public.publish_profile_set(d);
  perform t.eq((res ->> 'tier_changes')::int, 1, 'publish: 1 change');
  perform t.eq((select tier from public.responses where id = 'b0000000-0000-4000-8000-000000000002'), 'ideal', 'now ideal');
  perform t.eq((select data ->> 'reason' from public.lead_events where response_id = 'b0000000-0000-4000-8000-000000000002' and type = 'tier_changed'),
               'Profiles v2 published', 'event reason');
  perform t.eq((select is_current from public.profile_sets where id = d), true, 'v2 current');
  perform t.eq((select is_current from public.profile_sets where id = v1), false, 'v1 not current');
  perform t.eq((select profile_set_id from public.responses where id = 'b0000000-0000-4000-8000-000000000002'), d, 'response records set');

  -- rollback = re-publish v1
  res := public.publish_profile_set(v1);
  perform t.eq((select tier from public.responses where id = 'b0000000-0000-4000-8000-000000000002'), 'maybe', 'rolled back');
  perform t.eq((select data ->> 'reason' from public.lead_events where response_id = 'b0000000-0000-4000-8000-000000000002' and type = 'tier_changed' order by id desc limit 1),
               'Rolled back to profiles v1', 'rollback reason');

  -- publish refuses profiles without conditions
  d := public.create_profile_draft(prop);
  insert into public.profiles (profile_set_id, name) values (d, 'Empty');
  perform t.throws(format('select public.publish_profile_set(%L)', d), 'no conditions', 'empty profile blocked');
  perform public.discard_profile_draft(d);
  perform t.eq((select count(*) from public.profile_sets where status = 'draft')::int, 0, 'draft discarded');
  perform t.throws(format('select public.discard_profile_draft(%L)', v1), 'Only drafts', 'cannot discard published');
  perform t.throws(format('delete from public.profile_sets where id = %L', v1), 'cannot be deleted', 'cannot delete published');
end $$;
