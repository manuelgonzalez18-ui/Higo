-- ============================================================
-- 78 · Cortar exposición de PII de drivers/stores del Shop
-- ============================================================
--
-- Problema (auditoría profunda 2026-07-02, A1 + A3):
-- migrations/69 creó public.drivers y public.stores con
-- `FOR SELECT USING (true)`. Ambas tablas tienen `pago_movil jsonb`
-- (phone, bank, CEDULA, holder) y `drivers` además tiene latitude/
-- longitude. Con USING(true) cualquier usuario ANÓNIMO (sin cuenta)
-- podía `SELECT * FROM drivers` / `FROM stores` y scrapear las cédulas,
-- teléfonos y la ubicación en vivo de todos los repartidores y comercios.
-- La mig 76 endureció `orders` pero no tocó estas.
--
-- Fix:
-- El vector crítico es `anon` (internet abierto). Se restringe la lectura
-- a `authenticated`. Verificado en el frontend:
--   - la tabla `drivers` del Shop NO se lee desde el cliente (el display
--     de repartidor va por `profiles`), así que restringirla es inocuo;
--   - `stores.pago_movil` solo se consume en el checkout, por un cliente
--     autenticado (CheckoutPage.jsx) → sigue funcionando.
--
-- Nota: RLS filtra FILAS, no columnas; ocultar `pago_movil` solo al
-- cliente del pedido activo (scoping por-fila con `orders`) queda como
-- hardening posterior. Este cambio cierra el peor caso (scraping masivo
-- anónimo) con bajo riesgo y es reversible.
--
-- Idempotente. Rollback al final.
-- ============================================================

BEGIN;

-- ── drivers: quitar lectura anónima ─────────────────────────────────
DROP POLICY IF EXISTS "Allow public read access to drivers" ON public.drivers;
DROP POLICY IF EXISTS "drivers_read_authenticated" ON public.drivers;
CREATE POLICY "drivers_read_authenticated"
  ON public.drivers FOR SELECT
  TO authenticated
  USING (true);

-- ── stores: catálogo + pago_movil solo para autenticados ────────────
DROP POLICY IF EXISTS "Allow public read access to stores" ON public.stores;
DROP POLICY IF EXISTS "stores_read_authenticated" ON public.stores;
CREATE POLICY "stores_read_authenticated"
  ON public.stores FOR SELECT
  TO authenticated
  USING (true);

COMMIT;

-- ============================================================
-- Rollback (revierte a lectura pública — NO recomendado):
-- ============================================================
-- BEGIN;
-- DROP POLICY IF EXISTS "drivers_read_authenticated" ON public.drivers;
-- CREATE POLICY "Allow public read access to drivers"
--   ON public.drivers FOR SELECT USING (true);
-- DROP POLICY IF EXISTS "stores_read_authenticated" ON public.stores;
-- CREATE POLICY "Allow public read access to stores"
--   ON public.stores FOR SELECT USING (true);
-- COMMIT;
