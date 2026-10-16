-- Keep Tacarigua pricing attached to the renamed search location.
update public.higuerote_corridor_fares
set aliases = (
    select array(
        select distinct x
        from unnest(
            coalesce(aliases, '{}'::text[]) || array['tacarigua centro']
        ) as t(x)
    )
),
updated_at = now()
where name = 'Tacarigua';

notify pgrst, 'reload schema';
