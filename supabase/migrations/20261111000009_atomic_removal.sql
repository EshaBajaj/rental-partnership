-- remove_question_or_option: also rewrite draft profile conditions / never rules whose value list
-- only shrinks, inside the same transaction (previously the admin UI did that in a separate step).

drop function public.remove_question_or_option(uuid, uuid, jsonb, uuid[], uuid[]);

create or replace function public.remove_question_or_option(
  p_question_id uuid,
  p_option_id uuid default null,
  p_show_if_updates jsonb default '{}'::jsonb,       -- {question_id: new_show_if|null}
  p_remove_condition_ids uuid[] default '{}',
  p_remove_never_ids uuid[] default '{}',
  p_condition_updates jsonb default '{}'::jsonb,    -- {profile_condition_id: new_value} (value list shrinks)
  p_never_updates jsonb default '{}'::jsonb         -- {never_rule_id: new_value}
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
  for k, v in select * from jsonb_each(coalesce(p_condition_updates, '{}'::jsonb)) loop
    update public.profile_conditions c set value = v from public.profiles p
     where c.id = k::uuid and c.profile_id = p.id and p.profile_set_id = draft;
  end loop;
  for k, v in select * from jsonb_each(coalesce(p_never_updates, '{}'::jsonb)) loop
    update public.never_rules set value = v where id = k::uuid and profile_set_id = draft;
  end loop;

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

revoke execute on function public.remove_question_or_option(uuid, uuid, jsonb, uuid[], uuid[], jsonb, jsonb) from public, anon;
grant execute on function public.remove_question_or_option(uuid, uuid, jsonb, uuid[], uuid[], jsonb, jsonb) to authenticated, service_role;
