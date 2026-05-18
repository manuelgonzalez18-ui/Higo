-- ============================================================
-- 47 · Admin write en driver_documents + storage driver-docs
-- ============================================================
-- Hoy el admin solo puede UPDATE driver_documents (policy de mig 41
-- 'driver_documents_admin_update' para aprobar/rechazar). Si quiere
-- INSERT en nombre de un chofer (caso del modal "Nuevo Conductor"
-- donde el admin sube los 4 docs en el alta) la policy
-- 'driver_documents_owner_write' lo bloquea porque exige
-- WITH CHECK (user_id = auth.uid() ...).
--
-- Mismo problema en storage: 'driver_docs_owner_write' exige que el
-- primer folder del path sea auth.uid(); cuando el admin sube un
-- archivo al folder del chofer, el path no matchea su uid y el
-- INSERT al bucket falla.
--
-- Esta migración suma dos policies "admin write" paralelas a las
-- de owner. No reemplaza nada — los choferes siguen pudiendo subir
-- sus propios docs como antes.

-- ─── driver_documents: admin puede INSERT en nombre de cualquier user
DROP POLICY IF EXISTS "driver_documents_admin_insert" ON public.driver_documents;
CREATE POLICY "driver_documents_admin_insert"
    ON public.driver_documents FOR INSERT TO authenticated
    WITH CHECK (public.is_admin(auth.uid()));

-- ─── Storage driver-docs: admin write/update/delete sin folder check
DROP POLICY IF EXISTS "driver_docs_admin_write" ON storage.objects;
CREATE POLICY "driver_docs_admin_write"
    ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (
        bucket_id = 'driver-docs'
        AND public.is_admin(auth.uid())
    );

DROP POLICY IF EXISTS "driver_docs_admin_update" ON storage.objects;
CREATE POLICY "driver_docs_admin_update"
    ON storage.objects FOR UPDATE TO authenticated
    USING (
        bucket_id = 'driver-docs'
        AND public.is_admin(auth.uid())
    )
    WITH CHECK (
        bucket_id = 'driver-docs'
        AND public.is_admin(auth.uid())
    );
