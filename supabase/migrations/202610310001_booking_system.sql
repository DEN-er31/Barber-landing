-- BLACKWOOD booking system. All customer PII stays behind RLS and server functions.
create extension if not exists btree_gist with schema extensions;

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text not null default '',
  duration_minutes integer not null check (duration_minutes between 15 and 240),
  price_kgs integer not null check (price_kgs >= 0),
  active boolean not null default true,
  sort_order smallint not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.barbers (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  display_name text not null,
  bio text not null default '',
  active boolean not null default true,
  demo_profile boolean not null default true,
  created_at timestamptz not null default now()
);

-- ISO weekday: 1 = Monday, 7 = Sunday. Local wall-clock values use Asia/Bishkek.
create table if not exists public.weekly_schedule (
  id uuid primary key default gen_random_uuid(),
  barber_id uuid not null references public.barbers(id) on delete cascade,
  weekday smallint not null check (weekday between 1 and 7),
  opens_at time not null default time '10:00',
  closes_at time not null default time '22:00',
  is_open boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (barber_id, weekday),
  check (opens_at < closes_at)
);

create table if not exists public.schedule_overrides (
  id uuid primary key default gen_random_uuid(),
  barber_id uuid not null references public.barbers(id) on delete cascade,
  service_date date not null,
  is_closed boolean not null default false,
  opens_at time,
  closes_at time,
  note text not null default '',
  updated_at timestamptz not null default now(),
  unique (barber_id, service_date),
  check ((is_closed and opens_at is null and closes_at is null) or
         (not is_closed and opens_at is not null and closes_at is not null and opens_at < closes_at))
);

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null unique,
  booking_code text not null unique,
  barber_id uuid not null references public.barbers(id),
  service_id uuid not null references public.services(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  customer_first_name text not null check (char_length(customer_first_name) between 1 and 80),
  customer_last_name text not null check (char_length(customer_last_name) between 1 and 100),
  customer_phone text not null check (char_length(customer_phone) between 8 and 24),
  customer_email text not null check (char_length(customer_email) between 5 and 254),
  status text not null default 'confirmed' check (status in ('confirmed', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (starts_at < ends_at),
  constraint appointments_no_overlapping_active_bookings
    exclude using gist (
      barber_id with =,
      tstzrange(starts_at, ends_at, '[)') with &&
    ) where (status = 'confirmed')
);
create index if not exists appointments_starts_at_idx on public.appointments (starts_at) where status = 'confirmed';

create table if not exists public.public_api_rate_limits (
  key_hash text not null,
  bucket_start timestamptz not null,
  request_count integer not null default 0,
  primary key (key_hash, bucket_start)
);

insert into public.services (slug, name, description, duration_minutes, price_kgs, sort_order)
values
 ('mens-haircut', 'Мужская стрижка', 'Форма, текстура и укладка с учётом твоего ритма.', 45, 1200, 1),
 ('beard-trim', 'Стрижка бороды', 'Чёткий контур и аккуратная форма.', 30, 700, 2),
 ('haircut-and-beard', 'Стрижка + борода', 'Полный ритуал: свежая форма и ухоженная борода.', 70, 1700, 3)
on conflict (slug) do update set
 name = excluded.name, description = excluded.description,
 duration_minutes = excluded.duration_minutes, price_kgs = excluded.price_kgs,
 sort_order = excluded.sort_order;

insert into public.barbers (slug, display_name, bio, demo_profile)
values
 ('timur-ismailov', 'Тимур Исмаилов', 'Демонстрационный профиль мастера.', true),
 ('arsen-muratov', 'Арсен Муратов', 'Демонстрационный профиль мастера.', true),
 ('bek-sadykov', 'Бек Садыков', 'Демонстрационный профиль мастера.', true)
on conflict (slug) do update set display_name = excluded.display_name, bio = excluded.bio;

insert into public.weekly_schedule (barber_id, weekday, opens_at, closes_at, is_open)
select b.id, day_no, time '10:00', time '22:00', true
from public.barbers b cross join generate_series(1, 7) as day_no
where b.slug in ('timur-ismailov', 'arsen-muratov', 'bek-sadykov')
on conflict (barber_id, weekday) do nothing;

create or replace function public.is_booking_admin()
returns boolean
language sql stable
set search_path = ''
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'booking_admin', false)
$$;

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

create or replace function public.consume_public_rate_limit(
  p_key_hash text,
  p_window_seconds integer,
  p_limit integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bucket timestamptz;
  v_count integer;
begin
  if p_key_hash is null or p_key_hash !~ '^[a-f0-9]{64}$'
     or p_window_seconds not between 30 and 86400 or p_limit not between 1 and 1000 then
    return false;
  end if;
  v_bucket := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  delete from public_api_rate_limits where bucket_start < now() - interval '2 days';
  insert into public_api_rate_limits(key_hash, bucket_start, request_count)
    values (p_key_hash, v_bucket, 1)
  on conflict (key_hash, bucket_start) do update
    set request_count = public_api_rate_limits.request_count + 1
  returning request_count into v_count;
  return v_count <= p_limit;
end;
$$;

alter table public.services enable row level security;
alter table public.barbers enable row level security;
alter table public.weekly_schedule enable row level security;
alter table public.schedule_overrides enable row level security;
alter table public.appointments enable row level security;
alter table public.public_api_rate_limits enable row level security;

create policy "booking admins manage services" on public.services for all to authenticated
  using (public.is_booking_admin()) with check (public.is_booking_admin());
create policy "booking admins manage barbers" on public.barbers for all to authenticated
  using (public.is_booking_admin()) with check (public.is_booking_admin());
create policy "booking admins manage weekly schedule" on public.weekly_schedule for all to authenticated
  using (public.is_booking_admin()) with check (public.is_booking_admin());
create policy "booking admins manage schedule overrides" on public.schedule_overrides for all to authenticated
  using (public.is_booking_admin()) with check (public.is_booking_admin());
create policy "booking admins manage appointments" on public.appointments for all to authenticated
  using (public.is_booking_admin()) with check (public.is_booking_admin());

revoke all on public.services, public.barbers, public.weekly_schedule, public.schedule_overrides,
  public.appointments, public.public_api_rate_limits from anon, authenticated;
grant select, insert, update, delete on public.services, public.barbers, public.weekly_schedule,
  public.schedule_overrides, public.appointments to authenticated;
grant all on public.services, public.barbers, public.weekly_schedule, public.schedule_overrides,
  public.appointments, public.public_api_rate_limits to service_role;

revoke all on function public.get_available_slots(uuid, uuid, date) from public, anon, authenticated;
revoke all on function public.create_booking(uuid, uuid, uuid, timestamptz, text, text, text, text) from public, anon, authenticated;
revoke all on function public.consume_public_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.get_available_slots(uuid, uuid, date) to service_role;
grant execute on function public.create_booking(uuid, uuid, uuid, timestamptz, text, text, text, text) to service_role;
grant execute on function public.consume_public_rate_limit(text, integer, integer) to service_role;
grant execute on function public.is_booking_admin() to authenticated;
