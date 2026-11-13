-- Cancelling a class, putting it back on, and cancelling it again listed the athletes from the
-- first cancellation as people to tell, and anyone who rebooked twice.
CREATE OR REPLACE FUNCTION private.class_session_changed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_booking public.bookings;
begin
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    for v_booking in select * from public.bookings
      where session_id = new.id and status in ('booked', 'waitlisted') order by id for update
    loop
      if v_booking.credit_used and v_booking.membership_id is not null then
        update public.memberships set credits_remaining = credits_remaining + 1
          where id = v_booking.membership_id and credits_remaining is not null;
      end if;
      update public.bookings
        set status = 'cancelled', cancelled_at = now(), credit_used = false, late_cancel = false, class_cancelled = true
        where id = v_booking.id;
    end loop;
  elsif new.status = 'scheduled' then
    -- A class put back on the schedule starts clean: bookings released by the earlier cancellation
    -- are history, not people to tell if it is cancelled again.
    if old.status = 'cancelled' then
      update public.bookings set class_cancelled = false where session_id = new.id and class_cancelled;
    end if;
    if new.capacity < (select count(*) from public.bookings where session_id = new.id and status in ('booked', 'attended')) then
      raise exception 'capacity_below_bookings';
    end if;
    if new.capacity > old.capacity or old.status <> 'scheduled' then perform private.promote_waitlist(new.id); end if;
  end if;
  return null;
end $function$;
