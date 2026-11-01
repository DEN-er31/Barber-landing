begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

select ok(not has_function_privilege('anon', 'public.admin_create_booking(uuid,uuid,uuid,timestamptz,text,text,text,text,text)', 'execute'),
  'anonymous clients cannot create admin bookings');
select ok(has_function_privilege('authenticated', 'public.admin_create_booking(uuid,uuid,uuid,timestamptz,text,text,text,text,text)', 'execute'),
  'authenticated callers can reach the RPC and are checked inside the function');
select ok(not (select prosecdef from pg_proc where oid = 'public.admin_create_booking(uuid,uuid,uuid,timestamptz,text,text,text,text,text)'::regprocedure),
  'admin booking RPC runs as invoker and does not bypass RLS');
select ok(not has_table_privilege('anon', 'public.appointments', 'select'),
  'customer data remains unavailable to anonymous clients');

create temporary table manual_booking_fixture on commit drop as
select b.id as barber_id, s.id as service_id, sl.starts_at, sl.local_time,
       (now() at time zone 'Asia/Bishkek')::date + d.days_ahead as service_date
from public.barbers b
join public.services s on s.slug = 'mens-haircut' and s.active
cross join generate_series(1, 30) as d(days_ahead)
cross join lateral public.get_available_slots(
  b.id, s.id, (now() at time zone 'Asia/Bishkek')::date + d.days_ahead
) sl
where b.slug = 'timur-ismailov' and b.active
order by d.days_ahead, sl.starts_at
limit 1;

select ok(exists(select 1 from manual_booking_fixture), 'test fixture finds a real future slot in the configured schedule');

select set_config('request.jwt.claims', jsonb_build_object(
  'sub', '00000000-0000-4000-8000-000000000099',
  'role', 'authenticated',
  'app_metadata', jsonb_build_object('role', 'booking_admin')
)::text, true);
set local role authenticated;

select is((select public.admin_create_booking(
  '10000000-0000-4000-8000-000000000099'::uuid, f.service_id, f.barber_id, f.starts_at,
  'QA', 'Manual Booking', '+996555000099', null, 'pgTAP rollback fixture'
)->>'source' from manual_booking_fixture), 'admin', 'manual booking is tagged with its admin source');
select ok((select customer_email is null and admin_note = 'pgTAP rollback fixture'
  from public.appointments where submission_id = '10000000-0000-4000-8000-000000000099'::uuid),
  'manual booking supports optional email and stores its note');

set local role service_role;
select ok(not exists (
  select 1 from public.get_available_slots(
    (select barber_id from manual_booking_fixture),
    (select service_id from manual_booking_fixture),
    (select service_date from manual_booking_fixture)
  ) where starts_at = (select starts_at from manual_booking_fixture)
), 'the same public availability RPC hides the interval after a manual booking');

update public.appointments
set status = 'cancelled', updated_at = now()
where submission_id = '10000000-0000-4000-8000-000000000099'::uuid;
select ok(exists (
  select 1 from public.get_available_slots(
    (select barber_id from manual_booking_fixture),
    (select service_id from manual_booking_fixture),
    (select service_date from manual_booking_fixture)
  ) where starts_at = (select starts_at from manual_booking_fixture)
), 'cancelling the manual booking makes its interval available again');

rollback;
