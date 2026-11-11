-- Tiny assertion helpers for SQL tests (pgTAP is not required).
create schema if not exists t;
grant usage on schema t to anon, authenticated, service_role;



create or replace function t.ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL %', msg; end if;
end $$;

-- run sql, require an error whose message matches pattern (case-insensitive regex)
create or replace function t.throws(sql text, pattern text, msg text) returns void language plpgsql as $$
declare m text;
begin
  begin
    execute sql;
  exception when others then
    get stacked diagnostics m = message_text;
    if m !~* pattern then raise exception 'FAIL %: error "%" does not match /%/', msg, m, pattern; end if;
    return;
  end;
  raise exception 'FAIL %: expected an error matching /%/', msg, pattern;
end $$;

-- impersonate a JWT (call before "set local role ...")
create or replace function t.login(uid uuid, role text default 'authenticated') returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', role)::text, true),
         set_config('request.jwt.claim.sub', coalesce(uid::text, ''), true);
$$;
create or replace function t.logout() returns void language sql as $$
  select set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true);
$$;

-- a submission payload for submit_response()
create or replace function t.submit(p_id uuid, p_answers jsonb, p_phone text default '+919876543210',
                                    p_duration int default 120, p_whatsapp boolean default true) returns jsonb
language sql as $$
  select public.submit_response(jsonb_build_object(
    'id', p_id,
    'property_id', (select id from public.properties where slug = 'main-road-shop'),
    'form_version_id', (select id from public.form_versions where is_current and property_id = (select id from public.properties where slug = 'main-road-shop')),
    'path', p_answers #>> '{path,value}',
    'answers', p_answers || jsonb_build_object('contact', jsonb_build_object('value', jsonb_build_object('name','Test','phone',p_phone,'whatsapp_ok',p_whatsapp,'consent',true), 'display', 'Test', 'question_label', 'Contact')),
    'voice_finals', '{}'::jsonb,
    'name', 'Test', 'phone_e164', p_phone, 'whatsapp_ok', p_whatsapp, 'lang', 'en', 'source', 'test',
    'duration_seconds', p_duration, 'ip_hash', 'iphash'))
$$;

create or replace function t.a(v jsonb, display text default null) returns jsonb language sql as $$
  select jsonb_build_object('value', v, 'display', coalesce(display, v #>> '{}'), 'question_label', 'q')
$$;
grant execute on all functions in schema t to anon, authenticated, service_role;

do $$
declare ty text;
begin
  foreach ty in array array['numeric','text','boolean','uuid','jsonb','text[]','timestamptz'] loop
    execute format($f$create or replace function t.eq(actual %1$s, expected %1$s, msg text) returns void language plpgsql as $b$
      begin
        if actual is distinct from expected then raise exception 'FAIL %%: expected %%, got %%', msg, expected, actual; end if;
      end $b$;$f$, ty);
  end loop;
end $$;
grant execute on all functions in schema t to anon, authenticated, service_role;
