-- The change log named "System" for anything the server did with the service role on someone's
-- behalf (a staff freeze, an athlete's own freeze or cancel), because there is no signed-in user on
-- that connection. The server now says who asked, in a request header that is only believed when
-- the caller is the service role; a signed-in user's own identity always wins.
create or replace function private.audit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_row jsonb := to_jsonb(case when tg_op = 'DELETE' then old else new end);
  v_actor uuid := (select auth.uid());
  v_claimed text;
begin
  if v_actor is null and (select auth.role()) = 'service_role' then
    v_claimed := nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-fury-actor';
    if v_claimed ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_actor := v_claimed::uuid;
    end if;
  end if;

  insert into public.audit_log (gym_id, actor_id, action, entity, entity_id, details)
  values (
    nullif(v_row ->> 'gym_id', '')::uuid,
    v_actor,
    lower(tg_op),
    tg_table_name,
    coalesce(v_row ->> 'id', v_row ->> 'user_id', v_row ->> 'gym_id'),
    case when tg_op = 'UPDATE'
      then jsonb_build_object('before', to_jsonb(old), 'after', to_jsonb(new))
      else v_row end
  );
  return null;
end $$;
