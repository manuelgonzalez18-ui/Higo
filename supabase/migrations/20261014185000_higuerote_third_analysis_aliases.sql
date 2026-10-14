-- Third Higuerote tariff validation helper (2026-10-14).
-- Kept before corridor-table creation in replay order, so this migration only
-- hardens place-label normalization. Alias updates run after corridor setup.

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
