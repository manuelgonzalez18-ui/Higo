-- Static guard for Higo Viajes detail compatibility.
-- The production support_threads table may not expose updated_at, so the RPC
-- must never reference that column directly.

do $$
declare
    v_definition text;
begin
    select pg_get_functiondef('public.admin_get_ride_detail(bigint)'::regprocedure)
      into v_definition;

    if v_definition ~ 'st\.updated_at' then
        raise exception 'admin_get_ride_detail references missing support_threads.updated_at';
    end if;

    if position('to_jsonb(st)->>''updated_at''' in v_definition) = 0 then
        raise exception 'admin_get_ride_detail lacks schema-compatible support timestamp ordering';
    end if;
end;
$$;
