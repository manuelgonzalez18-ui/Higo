-- ============================================================
-- 66 · client_errors — error reporting del cliente (H2.1)
-- ============================================================
-- Fase H2 del Anexo B (Hardening de Producción).
--
-- Hoy si la app crashea en el browser del user, no nos enteramos
-- hasta que mandan screenshot por WhatsApp. Esta tabla captura los
-- errores via util src/utils/reportError.js + ErrorBoundary global.
--
-- Decisiones de seguridad:
--   - INSERT abierto a anon + authenticated: queremos capturar
--     errores INCLUSO de users no logueados (ej. crash en /auth).
--   - SELECT restringido a admin via is_admin() helper (mig 34).
--   - CHECK length para evitar attack de DoS por log spam de gran
--     tamaño (un atacante podria mandar inserts con stack de 100MB).
--   - Cron diario (pg_cron) borra registros > 30 dias.
--
-- Decision arquitectonica H2.1 reiterada:
--   * INSERT debe aceptar anon (sino, errores pre-login se pierden).
--   * Purga diaria + length limits = defensa anti-DoS.

BEGIN;

CREATE TABLE IF NOT EXISTS public.client_errors (
    id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID         REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    route        TEXT,
    message      TEXT         NOT NULL,
    stack        TEXT,
    user_agent   TEXT,
    app_version  TEXT,
    context      JSONB        DEFAULT '{}'::jsonb,

    -- Anti-DoS: limites estrictos de tamaño. Un atacante podria querer
    -- llenar el storage con mensajes y stacks gigantes. 2000 chars de
    -- mensaje y 8000 de stack cubren el 99.9% de errores reales JS.
    CONSTRAINT client_errors_message_len CHECK (length(message) BETWEEN 1 AND 2000),
    CONSTRAINT client_errors_stack_len   CHECK (stack IS NULL OR length(stack) <= 8000),
    CONSTRAINT client_errors_route_len   CHECK (route IS NULL OR length(route) <= 500),
    CONSTRAINT client_errors_ua_len      CHECK (user_agent IS NULL OR length(user_agent) <= 500),
    CONSTRAINT client_errors_ver_len     CHECK (app_version IS NULL OR length(app_version) <= 50)
);

CREATE INDEX IF NOT EXISTS client_errors_created_at_desc_idx
    ON public.client_errors (created_at DESC);
CREATE INDEX IF NOT EXISTS client_errors_user_id_idx
    ON public.client_errors (user_id)
    WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS client_errors_route_idx
    ON public.client_errors (route, created_at DESC)
    WHERE route IS NOT NULL;

-- ─── RLS ────────────────────────────────────────────────────────────
ALTER TABLE public.client_errors ENABLE ROW LEVEL SECURITY;

-- INSERT: cualquiera puede reportar errores propios. anon incluido
-- para capturar crashes pre-login (ej. AuthPage roto). El cliente
-- pone user_id IF tiene sesion; si no, queda NULL.
DROP POLICY IF EXISTS "client_errors_insert" ON public.client_errors;
CREATE POLICY "client_errors_insert"
    ON public.client_errors FOR INSERT
    TO anon, authenticated
    WITH CHECK (true);

-- SELECT: solo admin. is_admin() helper viene de mig 34.
DROP POLICY IF EXISTS "client_errors_select" ON public.client_errors;
CREATE POLICY "client_errors_select"
    ON public.client_errors FOR SELECT
    TO authenticated
    USING (public.is_admin(auth.uid()));

-- DELETE: solo admin. El cron de purga corre como postgres role
-- (bypassea RLS por definicion) asi que no necesita policy aparte.
DROP POLICY IF EXISTS "client_errors_delete" ON public.client_errors;
CREATE POLICY "client_errors_delete"
    ON public.client_errors FOR DELETE
    TO authenticated
    USING (public.is_admin(auth.uid()));

-- UPDATE no permitido (errores son audit log inmutable).

-- ─── Cron de purga diario ──────────────────────────────────────────
-- pg_cron mantiene la tabla acotada. Sin esto crece sin tope.
-- 30 dias es ventana suficiente para diagnostico; despues archivar
-- via export manual si se necesita historico.
--
-- IMPORTANTE: pg_cron debe estar habilitado en Supabase dashboard
-- (Database -> Extensions -> pg_cron). Si la migracion falla en el
-- CREATE EXTENSION, habilitalo primero desde el panel y re-corre.
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Borrar el job viejo si existe (re-corrida idempotente de la mig).
DO $$
BEGIN
    PERFORM cron.unschedule('client_errors_purge_30d');
EXCEPTION WHEN OTHERS THEN
    -- El job no existia, ignorar.
    NULL;
END $$;

-- Programar la purga diaria a las 04:00 UTC (00:00 VE), hora valle.
SELECT cron.schedule(
    'client_errors_purge_30d',
    '0 4 * * *',
    $$DELETE FROM public.client_errors WHERE created_at < NOW() - INTERVAL '30 days'$$
);

COMMIT;
