-- Publishing a waiver retires the old version and adds the new one in a single transaction, so a
-- failed publish can never leave the gym with no waiver in force.

create unique index waivers_one_active on public.waivers (gym_id) where active;
create unique index waivers_gym_version on public.waivers (gym_id, version);

create or replace function public.publish_waiver(p_gym uuid, p_title text, p_body text)
returns public.waivers
language plpgsql security definer set search_path = '' as $$
declare
  v_waiver public.waivers;
begin
  if not public.is_admin(p_gym) then raise exception 'forbidden' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_title, ''))) = 0 or length(btrim(coalesce(p_body, ''))) < 20 then
    raise exception 'waiver_text_required';
  end if;

  -- Two admins publishing at once take turns, so versions stay in sequence.
  perform 1 from public.gyms g where g.id = p_gym for update;

  update public.waivers w set active = false where w.gym_id = p_gym and w.active;
  insert into public.waivers (gym_id, title, body, version)
  values (
    p_gym, btrim(p_title), btrim(p_body),
    (select coalesce(max(w.version), 0) + 1 from public.waivers w where w.gym_id = p_gym)
  )
  returning * into v_waiver;
  return v_waiver;
end $$;

revoke all on function public.publish_waiver(uuid, text, text) from public, anon;
grant execute on function public.publish_waiver(uuid, text, text) to authenticated;
