-- Admin access hardening: there is always at least one owner; owner lookups for the invite function.

create or replace function public.sls_guard_last_owner() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare owners int;
begin
  if (tg_op = 'DELETE' and old.role = 'owner') or (tg_op = 'UPDATE' and old.role = 'owner' and new.role <> 'owner') then
    select count(*) into owners from public.admins where role = 'owner' and user_id <> old.user_id;
    if owners = 0 then
      raise exception 'You cannot remove the last owner. Make someone else an owner first.' using errcode = 'P0001';
    end if;
  end if;
  return coalesce(new, old);
end $$;
create trigger guard_last_owner before update or delete on public.admins for each row execute function public.sls_guard_last_owner();

-- owners may now remove themselves too, as long as another owner remains (the trigger enforces it)
drop policy owner_delete on public.admins;
create policy owner_delete on public.admins for delete to authenticated using (public.is_owner());

-- used by the admin-invite Edge Function (service role only)
create or replace function public.sls_user_id_by_email(p_email text) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select id from auth.users where lower(email) = lower(btrim(p_email)) limit 1
$$;
revoke execute on function public.sls_user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.sls_user_id_by_email(text) to service_role;

create or replace function public.sls_is_owner_uid(p_uid uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.admins where user_id = p_uid and role = 'owner')
$$;
revoke execute on function public.sls_is_owner_uid(uuid) from public, anon, authenticated;
grant execute on function public.sls_is_owner_uid(uuid) to service_role;

-- used by admin-invite after the auth user exists (service role only; the function checks the caller is an owner)
create or replace function public.sls_upsert_admin(p_user_id uuid, p_email text, p_role text, p_actor uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_role not in ('owner', 'staff') then raise exception 'Role must be owner or staff.'; end if;
  perform set_config('request.jwt.claim.sub', p_actor::text, true); -- audit trail shows who invited
  insert into public.admins (user_id, email, role) values (p_user_id, lower(btrim(p_email)), p_role)
  on conflict (user_id) do update set role = excluded.role, email = excluded.email;
end $$;
revoke execute on function public.sls_upsert_admin(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.sls_upsert_admin(uuid, text, text, uuid) to service_role;
