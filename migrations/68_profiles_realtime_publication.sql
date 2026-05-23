-- 68 — Habilitar Realtime para public.profiles.
--
-- Necesario para que el "single-session enforcement" funcione: App.jsx
-- escucha postgres_changes sobre profiles filtrado por id=eq.<uid>. Si
-- un segundo dispositivo loguea con el mismo usuario, sobreescribe
-- current_session_id y los listeners en otros devices reciben el UPDATE
-- → comparan vs localStorage.session_id → si difiere, signOut.
--
-- Sin agregar la tabla a la publication, el canal de Realtime nunca
-- emite eventos y el kick silenciosamente no ocurre, dejando dos
-- sesiones activas en paralelo. AuthPage ya genera el session_id y lo
-- escribe; solo faltaba que el cambio se propagara.
--
-- REPLICA IDENTITY FULL: para que el payload del UPDATE traiga la fila
-- completa (sin esto Postgres solo manda la PK y el watcher no puede
-- leer current_session_id de payload.new).
--
-- Idempotente: revisa pg_publication_tables antes del ALTER.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'profiles'
    ) THEN
        EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles';
    END IF;
END $$;

ALTER TABLE public.profiles REPLICA IDENTITY FULL;
