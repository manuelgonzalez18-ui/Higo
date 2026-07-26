-- Cast hashtext to bigint before abs(); abs(int4 min) can overflow for one
-- specific hash value. This keeps pilot assignment deterministic and total.

begin;

create or replace function public.higo_pricing_bucket(p_user_id uuid)
returns integer
language sql
immutable
as $$
    select case
        when p_user_id is null then 100
        else mod(abs(hashtext(p_user_id::text)::bigint), 100)::integer
    end;
$$;

commit;
