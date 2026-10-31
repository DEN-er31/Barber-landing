-- Serialize same-ID concurrent booking retries before checking for an existing record.
create or replace function public.create_booking(
  p_submission_id uuid,
  p_service_id uuid,
  p_barber_id uuid,
  p_starts_at timestamptz,
  p_first_name text,
  p_last_name text,
  p_phone text,
  p_email text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_service services%rowtype;
  v_barber barbers%rowtype;
  v_existing appointments%rowtype;
  v_result appointments%rowtype;
  v_local_start timestamp;
begin
  if p_submission_id is null then raise exception 'invalid_submission' using errcode = '22023'; end if;
  -- Serialize retries with the same submission ID so concurrent duplicate
  -- submissions return the existing booking instead of a unique-key error.
  perform pg_advisory_xact_lock(hashtextextended(p_submission_id::text, 0));
  if p_first_name is null or char_length(btrim(p_first_name)) not between 1 and 80
     or p_last_name is null or char_length(btrim(p_last_name)) not between 1 and 100
     or p_phone is null or p_phone !~ '^\+?[0-9 ()-]{8,24}$'
     or p_email is null or char_length(p_email) not between 5 and 254
     or p_email !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$' then
    raise exception 'invalid_customer_data' using errcode = '22023';
  end if;

  select * into v_existing from appointments where submission_id = p_submission_id;
  if found then
    if v_existing.service_id <> p_service_id or v_existing.barber_id <> p_barber_id
       or v_existing.starts_at <> p_starts_at
       or v_existing.customer_first_name <> btrim(p_first_name)
       or v_existing.customer_last_name <> btrim(p_last_name)
       or v_existing.customer_phone <> btrim(p_phone)
       or lower(v_existing.customer_email) <> lower(btrim(p_email)) then
      raise exception 'submission_id_conflict' using errcode = '22023';
    end if;
    select * into v_service from services where id = v_existing.service_id;
    select * into v_barber from barbers where id = v_existing.barber_id;
    return jsonb_build_object('id', v_existing.id, 'booking_code', v_existing.booking_code,
      'status', v_existing.status, 'starts_at', v_existing.starts_at, 'ends_at', v_existing.ends_at,
      'service_name', v_service.name, 'price_kgs', v_service.price_kgs,
      'duration_minutes', v_service.duration_minutes, 'barber_name', v_barber.display_name,
      'customer_first_name', v_existing.customer_first_name);
  end if;

  select * into v_service from services where id = p_service_id and active;
  if not found then raise exception 'service_unavailable' using errcode = '22023'; end if;
  select * into v_barber from barbers where id = p_barber_id and active;
  if not found then raise exception 'barber_unavailable' using errcode = '22023'; end if;

  v_local_start := p_starts_at at time zone 'Asia/Bishkek';
  if not exists (
    select 1 from get_available_slots(p_barber_id, p_service_id, v_local_start::date) s
    where s.starts_at = p_starts_at
  ) then
    raise exception 'slot_unavailable' using errcode = '23P01';
  end if;

  insert into appointments (
    submission_id, booking_code, service_id, barber_id, starts_at, ends_at,
    customer_first_name, customer_last_name, customer_phone, customer_email
  ) values (
    p_submission_id, 'BW-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
    p_service_id, p_barber_id, p_starts_at,
    p_starts_at + make_interval(mins => v_service.duration_minutes),
    btrim(p_first_name), btrim(p_last_name), btrim(p_phone), lower(btrim(p_email))
  ) returning * into v_result;

  return jsonb_build_object('id', v_result.id, 'booking_code', v_result.booking_code,
    'status', v_result.status, 'starts_at', v_result.starts_at, 'ends_at', v_result.ends_at,
    'service_name', v_service.name, 'price_kgs', v_service.price_kgs,
    'duration_minutes', v_service.duration_minutes, 'barber_name', v_barber.display_name,
    'customer_first_name', v_result.customer_first_name);
end;
$$;

