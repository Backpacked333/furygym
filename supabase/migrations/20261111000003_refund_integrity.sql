create or replace function private.preserve_refund()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.refunded_cents := greatest(old.refunded_cents, new.refunded_cents);
  if new.refunded_cents > 0 then
    new.status := case when new.refunded_cents >= new.amount_cents then 'refunded'::public.payment_status else 'partially_refunded'::public.payment_status end;
  end if;
  return new;
end $$;
create trigger preserve_payment_refund before update on public.payments
  for each row execute function private.preserve_refund();

create or replace function public.apply_payment_refund(p_payment uuid, p_refunded int, p_charge text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_payment public.payments;
  v_refunded int;
begin
  if p_refunded is null or p_refunded < 0 then raise exception 'invalid_refund'; end if;
  select * into v_payment from public.payments where id = p_payment for update;
  if not found then raise exception 'payment_not_found'; end if;
  v_refunded := greatest(v_payment.refunded_cents, p_refunded);
  update public.payments set refunded_cents = v_refunded,
    stripe_charge_id = coalesce(stripe_charge_id, p_charge)
    where id = p_payment;
  if v_refunded <= 0 or v_refunded < v_payment.amount_cents then return; end if;

  -- Only the checkout that granted this enrollment may revoke it. A duplicate charge is
  -- still linked for reporting/refund, but did not buy the athlete's existing access.
  if v_payment.enrollment_id is not null then
    update public.enrollments set status = 'refunded'
      where id = v_payment.enrollment_id
        and stripe_checkout_session_id = v_payment.stripe_checkout_session_id
        and status <> 'refunded';
  end if;
  if v_payment.membership_id is not null and v_payment.kind <> 'membership' then
    update public.memberships set status = 'cancelled', ends_at = now()
      where id = v_payment.membership_id and status in ('active', 'past_due', 'frozen');
  end if;
end $$;

revoke execute on function private.preserve_refund(), public.apply_payment_refund(uuid, int, text) from public, anon, authenticated;
grant execute on function private.preserve_refund(), public.apply_payment_refund(uuid, int, text) to service_role;
