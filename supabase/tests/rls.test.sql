-- RLS: anon has nothing; non-admins see nothing; staff manage leads but not config-of-admins; owner manages admins.
insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'owner@example.com'),
  ('22222222-2222-4222-8222-222222222222', 'staff@example.com'),
  ('33333333-3333-4333-8333-333333333333', 'stranger@example.com');
insert into public.admins (user_id, email, role) values
  ('11111111-1111-4111-8111-111111111111', 'owner@example.com', 'owner'),
  ('22222222-2222-4222-8222-222222222222', 'staff@example.com', 'staff');
select t.submit('c0000000-0000-4000-8000-000000000001', jsonb_build_object('path', t.a('"rent"'), 'business_type', t.a('"grocery"'),
  'start_when', t.a('"immediately"'), 'rent_budget', t.a('45000'), 'lease_years', t.a('"3_5"'), 'experience', t.a('"yes"')));
insert into storage.objects (bucket_id, name) values ('voice-notes', 'x/y/z.webm');

-- anon: no table access, no RPCs
select t.logout();
set local role anon;
select t.throws('select 1 from public.responses', 'permission denied', 'anon responses');
select t.throws('select 1 from public.properties', 'permission denied', 'anon properties');
select t.throws('select 1 from public.form_versions', 'permission denied', 'anon form_versions');
select t.throws('select 1 from public.voice_notes', 'permission denied', 'anon voice_notes');
select t.throws($$select public.submit_response('{}')$$, 'permission denied', 'anon submit');
select t.throws($$select public.rate_limit_hit('a','b',1,1)$$, 'permission denied', 'anon rate limit');
select t.throws($$select public.publish_form(gen_random_uuid())$$, 'permission denied', 'anon publish');
reset role;

-- authenticated but not an admin: sees nothing, can do nothing
select t.login('33333333-3333-4333-8333-333333333333');
set local role authenticated;
select t.eq((select count(*) from public.responses)::int, 0, 'stranger sees no leads');
select t.eq((select count(*) from public.questions)::int, 0, 'stranger sees no questions');
select t.eq((select count(*) from storage.objects where bucket_id = 'voice-notes')::int, 0, 'stranger sees no audio');
select t.throws($$select public.publish_form((select gen_random_uuid()))$$, 'Only admins', 'stranger publish');
select t.throws($$select public.apply_match('c0000000-0000-4000-8000-000000000001')$$, 'Only admins', 'stranger apply_match');
select t.throws($$select public.submit_response('{}')$$, 'permission denied', 'stranger submit');
select t.throws($$insert into public.admins (user_id, email, role) values ('33333333-3333-4333-8333-333333333333','s','owner')$$, 'row-level security', 'self-promotion blocked');
reset role;

-- staff admin
select t.login('22222222-2222-4222-8222-222222222222');
set local role authenticated;
select t.eq((select count(*) from public.responses)::int, 1, 'staff sees leads');
select t.eq((select count(*) from storage.objects where bucket_id = 'voice-notes')::int, 1, 'staff can read audio');
update public.responses set pipeline_status = 'contacted', notes = 'Called, visiting Sunday' where id = 'c0000000-0000-4000-8000-000000000001';
select t.eq((select count(*) from public.lead_events where type in ('status_changed', 'notes_updated'))::int, 2, 'lead events from status/notes');
select t.eq((select actor from public.lead_events where type = 'status_changed'), '22222222-2222-4222-8222-222222222222'::uuid, 'actor recorded');
select t.throws($$update public.responses set name = 'x'$$, 'permission denied', 'cannot edit answers/name');
select t.throws($$update public.responses set tier = 'ideal'$$, 'permission denied', 'cannot edit tier');
select t.throws($$delete from public.responses$$, 'permission denied', 'cannot delete leads');
select t.throws($$update public.lead_events set data = '{}'$$, 'permission denied', 'events not editable');
select t.throws($$delete from public.lead_events$$, 'permission denied', 'events not deletable');
select t.throws($$insert into public.lead_events (response_id, property_id, type, actor) values ('c0000000-0000-4000-8000-000000000001', (select id from public.properties), 'tier_changed', auth.uid())$$, 'row-level security', 'cannot forge system events');
insert into public.lead_events (response_id, property_id, type, actor, data) values ('c0000000-0000-4000-8000-000000000001', (select id from public.properties), 'called', auth.uid(), '{"note":"no answer"}');
select t.throws($$select 1 from public.rate_limits$$, 'permission denied', 'rate limits hidden');
select t.eq((select count(*) from public.admins)::int, 1, 'staff sees only own admin row');
select t.throws($$select public.add_admin('stranger@example.com')$$, 'Only the owner', 'staff cannot add admins');
select t.throws($$select public.publish_form((select id from public.properties))$$, 'Nothing changed', 'staff may publish');
insert into public.saved_views (property_id, name, filters) values ((select id from public.properties), 'Hot', '{"tier":"ideal"}');
select t.eq((select count(*) from public.saved_views)::int, 1, 'own saved view');
select t.throws($$insert into public.form_versions (property_id, version, config) values ((select id from public.properties), 99, '{}')$$, 'permission denied', 'no direct version insert');
reset role;

-- owner
select t.login('11111111-1111-4111-8111-111111111111');
set local role authenticated;
select t.eq((select count(*) from public.saved_views)::int, 0, 'saved views are private');
select t.eq((select count(*) from public.admins)::int, 2, 'owner sees all admins');
select public.add_admin('Stranger@Example.com', 'staff');
select t.eq((select count(*) from public.admins)::int, 3, 'owner added admin');
select t.throws($$delete from public.admins where user_id = '11111111-1111-4111-8111-111111111111'$$, 'last owner', 'last owner cannot remove self');
select t.throws($$update public.admins set role = 'staff' where user_id = '11111111-1111-4111-8111-111111111111'$$, 'last owner', 'last owner cannot be demoted');
update public.admins set role = 'owner' where user_id = '22222222-2222-4222-8222-222222222222';
update public.admins set role = 'staff' where user_id = '11111111-1111-4111-8111-111111111111';
reset role;
select t.eq((select string_agg(email, ',') from public.admins where role = 'owner'), 'staff@example.com', 'demoted once another owner exists');
select t.throws($$delete from public.admins where role = 'owner'$$, 'last owner', 'even the service role cannot remove the last owner');
select t.ok((select count(*) from public.audit_log where table_name = 'admins') >= 1, 'admins audited');
reset role;
