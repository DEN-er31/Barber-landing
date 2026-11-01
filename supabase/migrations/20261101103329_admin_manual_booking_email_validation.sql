-- Keep the email-domain separator independent of SQL string-literal backslash rules.
do $migration$
declare
  v_definition text;
  v_source text;
  v_fixed_source text;
  v_count integer;
begin
  select p.prosrc into v_source
  from pg_catalog.pg_proc p
  where p.oid = 'public.admin_create_booking(uuid,uuid,uuid,timestamptz,text,text,text,text,text)'::regprocedure;
  v_fixed_source := v_source;
  for v_count in 1..8 loop
    v_fixed_source := replace(v_fixed_source, repeat(chr(92), v_count) || '.[A-Z]{2,}', '[.][A-Z]{2,}');
  end loop;
  if v_fixed_source = v_source then return; end if;
  v_definition := replace(
    pg_catalog.pg_get_functiondef('public.admin_create_booking(uuid,uuid,uuid,timestamptz,text,text,text,text,text)'::regprocedure),
    v_source,
    v_fixed_source
  );
  execute v_definition;
end
$migration$;
