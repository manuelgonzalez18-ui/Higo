-- ============================================================
-- 34 · profiles RLS tightening + view safe + helper is_admin
-- ============================================================
-- Fase 7 paso B4 del roadmap (cierra Fase 7).
--
-- Hoy la policy "Public profiles are viewable by everyone" (mig 02)
-- expone TODAS las columnas de profiles a cualquier user autenticado:
-- phone, fcm_token, current_session_id, curr_lat, curr_lng, etc.
-- En la práctica un atacante con cuenta válida podía hacer scraping
-- de teléfonos de todos los users, ver dónde está cada chofer en
-- tiempo real, y conocer los FCM tokens (que permiten spear-phishing
-- por push si combinado con otro vector).
--
-- Fix: dropear la policy laxa y reemplazar por 3 policies explícitas
-- que cubren los usos reales del frontend (auditados antes de escribir
-- esta migración):
--   (1) Self read     — auth.uid() = id
--   (2) Admin read    — role admin del caller
--   (3) Ride party    — passenger ↔ driver de un ride activo/reciente
--
-- Para casos donde NO hay relación de ride pero igual se necesita
-- nombre/avatar (ej. referral program mostrando referidor), agregamos
-- una RPC SECURITY DEFINER `get_public_profile(uid)` que retorna
-- solo el subset seguro. No agregamos VIEW porque las views heredan
-- la RLS de la tabla subyacente (security_invoker default), y con la
-- RLS nueva el view bloquearía igual.
--
-- Riesgo conocido: si alguna query del frontend que no auditamos
-- intenta leer profiles de un user sin relación de ride ni admin,
-- devolverá empty set en vez de la fila. Síntoma típico: "Avatar
-- no carga / nombre no aparece". Reproducción: revert de este commit.

-- ─── Helper: is_admin(uid) ──────────────────────────────────────────
-- Reusable en otras policies. STABLE permite que Postgres lo memoice
-- dentro de una query. SECURITY DEFINER + search_path locked para
-- que ningún caller pueda hijackearlo.
CREATE OR REPLACE FUNCTION public.is_admin(p_uid UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = p_uid AND role = 'admin'
    );
$$;

REVOKE ALL ON FUNCTION public.is_admin(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin(UUID) TO authenticated;

-- ─── Policies SELECT en profiles ────────────────────────────────────
-- Drop la policy laxa heredada de mig 02.
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON public.profiles;

-- (1) Self read.
DROP POLICY IF EXISTS "profiles_self_read" ON public.profiles;
CREATE POLICY "profiles_self_read"
    ON public.profiles FOR SELECT TO authenticated
    USING (auth.uid() = id);

-- (2) Admin read.
DROP POLICY IF EXISTS "profiles_admin_read" ON public.profiles;
CREATE POLICY "profiles_admin_read"
    ON public.profiles FOR SELECT TO authenticated
    USING (public.is_admin(auth.uid()));

-- (3) Ride party read — pasajero ↔ conductor de un ride relacionado.
-- Cubrimos status 'accepted', 'in_progress' y 'completed' para que
-- el pasajero pueda ver su chofer mientras dura el viaje Y después
-- (para rating, recibo, contactarlo si olvidó algo). 'cancelled' lo
-- excluimos para no exponer datos por casos donde el ride no ocurrió.
DROP POLICY IF EXISTS "profiles_ride_party_read" ON public.profiles;
CREATE POLICY "profiles_ride_party_read"
    ON public.profiles FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.rides r
             WHERE r.status IN ('accepted', 'in_progress', 'completed')
               AND (
                   (r.user_id   = auth.uid() AND r.driver_id = profiles.id)
                OR (r.driver_id = auth.uid() AND r.user_id   = profiles.id)
               )
        )
    );

-- (4) Support party read — un user puede ver el profile del admin
-- que le respondió en su hilo de soporte, y viceversa (admin ya
-- cubierto por la policy (2), esta es por simetría futura).
-- No agregamos polic separada porque el chat de soporte hoy ya muestra
-- "EQUIPO HIGO" genérico al user; no necesita resolver al admin
-- específico. Si en el futuro queremos mostrarle al user "te respondió
-- Maria", agregamos la policy acá.

-- ─── RPC: lookup seguro para casos sin relación directa ─────────────
-- Devuelve únicamente columnas safe: id, full_name, avatar_url, role.
-- Útil para referral program (mostrar al referidor), historial ("este
-- viaje fue con Juan P."), etc. Si el id no existe o el caller no
-- está autenticado, devuelve fila NULL.
-- Nota: rating no está en profiles (vive en rides.rating por ride);
-- si en el futuro queremos rating agregado, se calcula con un
-- AVG aparte o se materializa en profiles vía trigger.
CREATE OR REPLACE FUNCTION public.get_public_profile(p_id UUID)
RETURNS TABLE (
    id          UUID,
    full_name   TEXT,
    avatar_url  TEXT,
    role        TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT p.id, p.full_name, p.avatar_url, p.role
      FROM public.profiles p
     WHERE p.id = p_id
       AND auth.uid() IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.get_public_profile(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_profile(UUID) TO authenticated;
