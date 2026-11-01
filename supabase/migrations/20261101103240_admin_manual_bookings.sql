-- Manual admin bookings share the existing appointments table and availability engine.
-- Customer email is optional only because the trusted admin flow can create phone-only bookings.
alter table public.appointments
  alter column customer_email drop not null,
  add column if not exists source text not null default 'website',
  add column if not exists admin_note text not null default '';

alter table public.appointments
  add constraint appointments_source_check check (source in ('website', 'admin')),
  add constraint appointments_admin_note_length_check check (char_length(admin_note) <= 500);

create or replace function public.admin_create_booking(
  p_submission_id uuid,
  p_service_id uuid,
  p_barber_id uuid,
  p_starts_at timestamptz,
  p_first_name text,
  p_last_name text,
  p_phone text,
  p_email text default null,
  p_admin_note text default ''
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_existing public.appointments%rowtype;
  v_service_duration integer;
  v_local_start timestamp;
  v_service_date date;
  v_open time;
  v_close time;
  v_is_open boolean;
  v_now_local timestamp;
  v_result public.appointments%rowtype;
  v_first_name text := btrim(coalesce(p_first_name, ''));
  v_last_name text := btrim(coalesce(p_last_name, ''));
  v_phone text := btrim(coalesce(p_phone, ''));
  v_email text := nullif(btrim(coalesce(p_email, '')), '');
  v_note text := btrim(coalesce(p_admin_note, ''));
begin
  if auth.uid() is null or not public.is_booking_admin() then
    raise exception using errcode = '42501', message = 'booking_admin_required';
  end if;
  if p_submission_id is null or p_service_id is null or p_barber_id is null or p_starts_at is null then
    raise exception using errcode = '22023', message = 'required_fields_missing';
  end if;
  if char_length(v_first_name) not between 1 and 80
     or char_length(v_last_name) not between 1 and 100
     or char_length(v_phone) not between 8 and 24
     or v_phone !~ '^[+0-9() .-]+$'
     or (v_email is not null and (char_length(v_email) not between 5 and 254 or v_email !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}$'))
     or char_length(v_note) > 500 then
    raise exception using errcode = '22023', message = 'invalid_customer_details';
  end if;

  -- Serialize retries carrying the same submission id.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_submission_id::text), 7319);
  select * into v_existing from public.appointments where submission_id = p_submission_id;
  if found then
    return pg_catalog.jsonb_build_object('id', v_existing.id, 'booking_code', v_existing.booking_code,
      'starts_at', v_existing.starts_at, 'ends_at', v_existing.ends_at, 'source', v_existing.source);
  end if;

  select duration_minutes into v_service_duration
    from public.services where id = p_service_id and active;
  if v_service_duration is null then
    raise exception using errcode = '22023', message = 'service_unavailable';
  end if;
  if not exists (select 1 from public.barbers where id = p_barber_id and active) then
    raise exception using errcode = '22023', message = 'barber_unavailable';
  end if;

  v_local_start := p_starts_at at time zone 'Asia/Bishkek';
  v_service_date := v_local_start::date;
  v_now_local := pg_catalog.now() at time zone 'Asia/Bishkek';
  if v_service_date < v_now_local::date or v_service_date > v_now_local::date + 90
     or v_local_start <= v_now_local
     or extract(second from v_local_start) <> 0
     or extract(minute from v_local_start)::integer % 30 <> 0 then
    raise exception using errcode = '22023', message = 'invalid_booking_time';
  end if;

  select not o.is_closed, o.opens_at, o.closes_at into v_is_open, v_open, v_close
    from public.schedule_overrides o where o.barber_id = p_barber_id and o.service_date = v_service_date;
  if not found then
    select s.is_open, s.opens_at, s.closes_at into v_is_open, v_open, v_close
      from public.weekly_schedule s where s.barber_id = p_barber_id
        and s.weekday = extract(isodow from v_service_date)::smallint;
  end if;
  if not coalesce(v_is_open, false) or v_open is null or v_close is null
     or v_local_start < v_service_date + v_open
     or v_local_start + pg_catalog.make_interval(mins => v_service_duration) > v_service_date + v_close then
    raise exception using errcode = '22023', message = 'outside_working_hours';
  end if;

  if exists (
    select 1 from public.appointments a
    where a.barber_id = p_barber_id and a.status = 'confirmed'
      and pg_catalog.tstzrange(a.starts_at, a.ends_at, '[)') &&
          pg_catalog.tstzrange(p_starts_at, p_starts_at + pg_catalog.make_interval(mins => v_service_duration), '[)')
  ) then
    raise exception using errcode = '23P01', message = 'slot_unavailable';
  end if;

  insert into public.appointments (
    submission_id, booking_code, barber_id, service_id, starts_at, ends_at,
    customer_first_name, customer_last_name, customer_phone, customer_email,
    status, source, admin_note
  ) values (
    p_submission_id, 'BW-' || upper(pg_catalog.substr(pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', ''), 1, 8)),
    p_barber_id, p_service_id, p_starts_at,
    p_starts_at + pg_catalog.make_interval(mins => v_service_duration),
    v_first_name, v_last_name, v_phone, v_email, 'confirmed', 'admin', v_note
  ) returning * into v_result;

  return pg_catalog.jsonb_build_object('id', v_result.id, 'booking_code', v_result.booking_code,
    'starts_at', v_result.starts_at, 'ends_at', v_result.ends_at, 'source', v_result.source);
end;
$function$;

revoke all on function public.admin_create_booking(uuid, uuid, uuid, timestamptz, text, text, text, text, text) from public, anon;
grant execute on function public.admin_create_booking(uuid, uuid, uuid, timestamptz, text, text, text, text, text) to authenticated;
