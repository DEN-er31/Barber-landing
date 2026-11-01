-- Permanently remove one appointment through an admin-only RPC.
-- The function runs as invoker, so the appointments table grant and admin RLS
-- policy remain in force in addition to the explicit app_metadata role check.
create or replace function public.admin_delete_booking(p_booking_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_deleted_id uuid;
begin
  if auth.uid() is null or not public.is_booking_admin() then
    raise exception using errcode = '42501', message = 'booking_admin_required';
  end if;

  if p_booking_id is null then
    raise exception using errcode = '22023', message = 'booking_id_required';
  end if;

  delete from public.appointments
  where id = p_booking_id
  returning id into v_deleted_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'booking_not_found';
  end if;

  return pg_catalog.jsonb_build_object('id', v_deleted_id, 'deleted', true);
end;
$function$;

revoke all on function public.admin_delete_booking(uuid) from public, anon;
grant execute on function public.admin_delete_booking(uuid) to authenticated;
