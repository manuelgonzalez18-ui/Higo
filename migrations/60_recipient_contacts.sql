-- ============================================================
-- 60 · recipient_contacts — address book de destinatarios
-- ============================================================
-- Anexo Higo Envíos v2, Fase E6.3.

BEGIN;

CREATE TABLE IF NOT EXISTS public.recipient_contacts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  phone         TEXT NOT NULL,
  address_label TEXT,
  address       TEXT,
  lat           NUMERIC,
  lng           NUMERIC,
  instructions  TEXT,
  last_used_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS recipient_contacts_user_idx
  ON public.recipient_contacts (user_id, last_used_at DESC NULLS LAST);

ALTER TABLE public.recipient_contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS recipient_contacts_owner_all ON public.recipient_contacts;
CREATE POLICY recipient_contacts_owner_all
ON public.recipient_contacts
FOR ALL
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

COMMIT;
