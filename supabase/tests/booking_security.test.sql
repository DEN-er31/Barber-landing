begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

select is((select count(*)::integer from public.services where slug in ('mens-haircut','beard-trim','haircut-and-beard')), 3,
  'the requested service catalog exists');
select is((select count(*)::integer from public.barbers where demo_profile), 3,
  'three demo barber profiles are clearly marked');
select ok((select relrowsecurity from pg_class where oid = 'public.appointments'::regclass),
  'appointment table has row-level security enabled');
select ok(not has_table_privilege('anon', 'public.appointments', 'select'),
  'anonymous clients cannot read customer records');
select ok(not has_function_privilege('anon', 'public.create_booking(uuid,uuid,uuid,timestamptz,text,text,text,text)', 'execute'),
  'anonymous clients cannot call the database insert function directly');

insert into public.appointments (
  submission_id, booking_code, barber_id, service_id, starts_at, ends_at,
  customer_first_name, customer_last_name, customer_phone, customer_email
)
select '10000000-0000-4000-8000-000000000001'::uuid, 'BW-TEST-OVERLAP-1', b.id, s.id,
       '2099-01-05 10:00:00+06'::timestamptz, '2099-01-05 10:45:00+06'::timestamptz,
       'Test', 'Fixture', '+996555000001', 'fixture1@example.test'
from public.barbers b cross join public.services s
where b.slug = 'timur-ismailov' and s.slug = 'mens-haircut';

select throws_ok(
  $$insert into public.appointments (
      submission_id, booking_code, barber_id, service_id, starts_at, ends_at,
      customer_first_name, customer_last_name, customer_phone, customer_email
    )
    select '10000000-0000-4000-8000-000000000002'::uuid, 'BW-TEST-OVERLAP-2', b.id, s.id,
           '2099-01-05 10:30:00+06'::timestamptz, '2099-01-05 11:15:00+06'::timestamptz,
           'Test', 'Fixture', '+996555000002', 'fixture2@example.test'
    from public.barbers b cross join public.services s
    where b.slug = 'timur-ismailov' and s.slug = 'mens-haircut'$$,
  '23P01', 'the database rejects overlapping bookings for one barber');

select ok(not exists (
  select 1 from public.get_available_slots(
    (select id from public.barbers where slug = 'timur-ismailov'),
    (select id from public.services where slug = 'mens-haircut'),
    date '2099-01-05'
  ) where local_time = '10:00'
), 'occupied time is omitted from availability');

select * from finish();
rollback;
