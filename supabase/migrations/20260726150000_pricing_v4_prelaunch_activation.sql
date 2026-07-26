-- Pricing V4 prelaunch activation.
--
-- Higo todavía no se ha lanzado al público, por lo que no necesitamos un
-- rollout gradual para proteger tráfico real. Esta migración activa V4 para
-- todos los viajes nuevos, pero conserva los importes actuales: no inventa
-- precios comerciales ni añade un cargo por minuto mientras per_minute siga en
-- cero. Los valores pueden ajustarse desde /admin/pricing antes del lanzamiento.

begin;

do $$
begin
    if to_regclass('public.pricing_rollout_config') is null then
        raise exception 'pricing_rollout_config_missing';
    end if;
    if to_regclass('public.pricing_config') is null then
        raise exception 'pricing_config_missing';
    end if;
end;
$$;

insert into public.pricing_rollout_config(
    id,
    mode,
    pilot_percentage,
    maximum_multiplier,
    notes,
    updated_by,
    updated_at
)
values (
    1,
    'active',
    0,
    1.30,
    'Pricing V4 activado antes del lanzamiento público. Las tarifas permanecen equivalentes hasta que se configuren valores comerciales definitivos.',
    null,
    now()
)
on conflict (id) do update
set mode = 'active',
    pilot_percentage = 0,
    maximum_multiplier = least(
        1.30,
        greatest(1, coalesce(public.pricing_rollout_config.maximum_multiplier, 1.30))
    ),
    notes = excluded.notes,
    updated_by = null,
    updated_at = now();

-- Normaliza la configuración existente sin cambiar el precio actual. El modelo
-- queda plenamente operativo y el administrador puede introducir precio por
-- minuto, tarifa mínima u otros valores antes de abrir Higo al público.
update public.pricing_config
set minimum_fare = greatest(coalesce(minimum_fare, base, 0), coalesce(base, 0)),
    per_minute = greatest(coalesce(per_minute, 0), 0),
    included_km = greatest(coalesce(included_km, 1), 0),
    free_wait_minutes = greatest(coalesce(free_wait_minutes, 3), 0),
    maximum_multiplier = least(1.30, greatest(1, coalesce(maximum_multiplier, 1.30))),
    pricing_version = greatest(coalesce(pricing_version, 4), 4),
    effective_from = now();

commit;
