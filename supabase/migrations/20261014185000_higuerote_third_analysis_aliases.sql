-- Third Higuerote tariff validation (2026-10-14).
-- 28/29 tested routes were already <= local fare. These adjustments improve
-- matching for the three labels that still fell back to distance pricing.

update public.higuerote_corridor_fares
set aliases = array[
    'el 100',
    'sector el 100',
    'el cien',
    'sector el cien',
    'el 100 tacarigua',
    '100 tacarigua'
],
    updated_at = now(),
    note = 'Referencia local; aliases ampliados tras tercer análisis'
where name = 'El 100';

update public.higuerote_corridor_fares
set aliases = array[
    'hospital central',
    'hospital universitario general de higuerote',
    'hospital general universitario de higuerote',
    'hospital general de higuerote',
    'hospital universitario de higuerote',
    'hospital de higuerote',
    'gran cacique higoroto',
    'hospital gran cacique higoroto',
    'hugh'
],
    updated_at = now(),
    note = 'Referencia local; aliases ampliados tras tercer análisis'
where name = 'Hospital Central';

update public.higuerote_corridor_fares
set aliases = array[
    'hotel aguamarina',
    'aguamarina',
    'hotel agua marina',
    'agua marina',
    'aguamarina higuerote',
    'hotel aguamarina higuerote'
],
    updated_at = now(),
    note = 'Referencia local; aliases ampliados tras tercer análisis'
where name = 'Hotel Aguamarina';

create or replace function public.higo_normalize_place_label(p_value text)
returns text
language sql
immutable
as $$
    select trim(
        regexp_replace(
            lower(
                regexp_replace(
                    translate(coalesce(p_value,''), 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN'),
                    '[^a-zA-Z0-9 ]+', ' ', 'g'
                )
            ),
            '\s+', ' ', 'g'
        )
    );
$$;

notify pgrst, 'reload schema';
