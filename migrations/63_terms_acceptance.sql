-- ============================================================
-- 63 · terms_acceptance — audit de aceptación de T&C de envíos
-- ============================================================
-- Anexo Higo Envíos v2, Fase E7.3.
--
-- Cada vez que un remitente confirma un envío, queda un row con la
-- versión de T&C que aceptó. Sirve como prueba en caso de claim.
-- La versión vigente se mantiene como constante en el frontend; el
-- texto canónico se sirve desde /terms/envios.

BEGIN;

CREATE TABLE IF NOT EXISTS public.terms_acceptances (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  terms_kind      TEXT NOT NULL DEFAULT 'delivery',
  terms_version   TEXT NOT NULL,
  accepted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip              TEXT,
  ride_id         BIGINT REFERENCES public.rides(id) ON DELETE SET NULL,
  CONSTRAINT terms_acceptances_kind_check
    CHECK (terms_kind IN ('delivery','ride','general'))
);

CREATE INDEX IF NOT EXISTS terms_acceptances_user_idx
  ON public.terms_acceptances (user_id, accepted_at DESC);
CREATE INDEX IF NOT EXISTS terms_acceptances_ride_idx
  ON public.terms_acceptances (ride_id);

ALTER TABLE public.terms_acceptances ENABLE ROW LEVEL SECURITY;

-- INSERT: solo el propio user
DROP POLICY IF EXISTS terms_acceptances_insert ON public.terms_acceptances;
CREATE POLICY terms_acceptances_insert
ON public.terms_acceptances FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

-- SELECT: el propio user o admin
DROP POLICY IF EXISTS terms_acceptances_select ON public.terms_acceptances;
CREATE POLICY terms_acceptances_select
ON public.terms_acceptances FOR SELECT
TO authenticated
USING (user_id = auth.uid() OR public.is_admin(auth.uid()));

COMMIT;
