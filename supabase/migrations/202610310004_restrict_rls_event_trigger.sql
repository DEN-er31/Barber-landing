-- This Supabase-provided event trigger is already installed to enable RLS on
-- new public tables. It is not an RPC; remove default API-role EXECUTE grants.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end;
$$;
