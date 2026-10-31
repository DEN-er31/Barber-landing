-- Fix timestamp candidate generation for PostgreSQL and index the service FK.
create or replace function public.get_available_slots(
  p_barber_id uuid,
  p_service_id uuid,
  p_service_date date
)
returns table (starts_at timestamptz, local_time text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_duration integer;
  v_open time;
  v_close time;
  v_is_open boolean;
  v_now_local timestamp;
begin
  v_now_local := now() at time zone 'Asia/Bishkek';
  if p_service_date < v_now_local::date or p_service_date > v_now_local::date + 90 then
    return;
  end if;
  select duration_minutes into v_duration from services where id = p_service_id and active;
  if v_duration is null then return; end if;
  if not exists (select 1 from barbers where id = p_barber_id and active) then return; end if;

  select not o.is_closed, o.opens_at, o.closes_at
    into v_is_open, v_open, v_close
    from schedule_overrides o
    where o.barber_id = p_barber_id and o.service_date = p_service_date;
  if not found then
    select s.is_open, s.opens_at, s.closes_at into v_is_open, v_open, v_close
      from weekly_schedule s
      where s.barber_id = p_barber_id
        and s.weekday = extract(isodow from p_service_date)::smallint;
  end if;
  if not coalesce(v_is_open, false) or v_open is null or v_close is null then return; end if;

  return query
  with candidates as (
    select ticks as local_start
    from generate_series(
      p_service_date + v_open,
      p_service_date + v_close - make_interval(mins => v_duration),
      interval '30 minutes'
    ) as ticks
  )
  select (c.local_start at time zone 'Asia/Bishkek') as starts_at,
         to_char(c.local_start, 'HH24:MI') as local_time
  from candidates c
  where c.local_start > v_now_local
    and not exists (
      select 1 from appointments a
      where a.barber_id = p_barber_id
        and a.status = 'confirmed'
        and tstzrange(a.starts_at, a.ends_at, '[)') &&
            tstzrange(c.local_start at time zone 'Asia/Bishkek',
                      (c.local_start + make_interval(mins => v_duration)) at time zone 'Asia/Bishkek', '[)')
    )
  order by c.local_start;
end;
$$;

create index if not exists appointments_service_id_idx on public.appointments (service_id);
