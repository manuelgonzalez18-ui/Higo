-- ============================================================
-- 81 · Higo Shop — reubicar tiendas semilla a Higuerote + imágenes
-- ============================================================
--
-- Contexto (frontend Higo Shop, 2026-07-03):
-- Las tiendas semilla de la mig 69 quedaron con coordenadas de Caracas
-- (lng ~-66.88), pero la app opera con ubicación por defecto en Higuerote
-- (lng ~-66.10). Resultado: el feed "cerca de ti" mostraba distancias de
-- ~82 km. Además las tiendas semilla no tienen image_url, así que salían
-- con un emoji placeholder en vez de una foto.
--
-- Esta migración, para las 3 tiendas semilla (match por nombre):
--   1. Reubica lat/lng a la zona de Higuerote (Barlovento, Miranda).
--   2. Setea image_url con una foto representativa (Unsplash, CDN estable;
--      la CSP permite img-src https:). Los comercios reales pueden
--      sobreescribir su foto desde el panel; esto es solo para que el
--      catálogo semilla se vea terminado.
--   3. Actualiza la dirección a uno de Higuerote.
--
-- Solo toca filas cuyo nombre coincide exactamente con el seed; si un
-- comercio real creó una tienda con otro nombre, no se ve afectada.
-- Idempotente. Rollback al final.
-- ============================================================

BEGIN;

UPDATE public.stores SET
  latitude  = 10.4835,
  longitude = -66.1010,
  address   = 'Av. Principal de Higuerote, Sector Centro, Higuerote',
  image_url = 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=600&q=70'
WHERE name = 'Arepera La Reina';

UPDATE public.stores SET
  latitude  = 10.4788,
  longitude = -66.1025,
  address   = 'Av. Bicentenaria, C.C. Higuerote Plaza, Higuerote',
  image_url = 'https://images.unsplash.com/photo-1587854692152-cbe660dbde88?auto=format&fit=crop&w=600&q=70'
WHERE name = 'Farmacia San Ignacio';

UPDATE public.stores SET
  latitude  = 10.4851,
  longitude = -66.0968,
  address   = 'Calle Comercio, Sector La Guadalupe, Higuerote',
  image_url = 'https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=600&q=70'
WHERE name = 'Panadería La Guadalupe';

COMMIT;

-- ============================================================
-- Rollback (vuelve a las coords de Caracas de la mig 69; no borra imágenes):
-- ============================================================
-- BEGIN;
-- UPDATE public.stores SET latitude=10.4985, longitude=-66.8872,
--   address='Av. Francisco de Miranda, Altamira, Caracas'
--   WHERE name='Arepera La Reina';
-- UPDATE public.stores SET latitude=10.4902, longitude=-66.9015,
--   address='Centro Comercial San Ignacio, Chacao, Caracas'
--   WHERE name='Farmacia San Ignacio';
-- UPDATE public.stores SET latitude=10.4854, longitude=-66.8621,
--   address='Calle Madrid, Las Mercedes, Caracas'
--   WHERE name='Panadería La Guadalupe';
-- COMMIT;
