-- ====================================================================
-- 74 · Higo Shop: chat persistente por orden
-- ====================================================================
-- El chat cliente ↔ tienda/driver vivía solo en localStorage (zustand
-- persist), por lo que se perdía al refrescar o cambiar de dispositivo.
-- Esta migración crea la tabla shop_chat_messages con RLS limitada a
-- los participantes de la orden (mismo patrón que order_events) y la
-- agrega a la publicación realtime.

BEGIN;

CREATE TABLE IF NOT EXISTS public.shop_chat_messages (
  id uuid default gen_random_uuid() primary key,
  order_id uuid references public.orders(id) on delete cascade not null,
  -- thread: a qué pestaña del chat pertenece el mensaje
  thread text not null check (thread in ('store', 'driver')),
  sender text not null check (sender in ('customer', 'store', 'driver')),
  sender_id uuid,
  text text not null check (length(trim(text)) > 0),
  is_system boolean not null default false,
  created_at timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS shop_chat_messages_order_time_idx
  ON public.shop_chat_messages(order_id, created_at);

ALTER TABLE public.shop_chat_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow participants to read chat messages" ON public.shop_chat_messages;
CREATE POLICY "Allow participants to read chat messages"
  ON public.shop_chat_messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      JOIN public.stores s ON s.id = o.store_id
      WHERE o.id = order_id
      AND (
        o.customer_id = auth.uid()
        OR o.driver_id = auth.uid()
        OR s.owner_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "Allow participants to insert chat messages" ON public.shop_chat_messages;
CREATE POLICY "Allow participants to insert chat messages"
  ON public.shop_chat_messages FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.orders o
      JOIN public.stores s ON s.id = o.store_id
      WHERE o.id = order_id
      AND (
        o.customer_id = auth.uid()
        OR o.driver_id = auth.uid()
        OR s.owner_id = auth.uid()
      )
    )
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
    AND schemaname = 'public'
    AND tablename = 'shop_chat_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.shop_chat_messages;
  END IF;
END $$;

COMMIT;
