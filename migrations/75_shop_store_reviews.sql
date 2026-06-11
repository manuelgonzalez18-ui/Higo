-- ====================================================================
-- 75 · Higo Shop: calificación de tiendas post-entrega
-- ====================================================================
-- Las tiendas tienen rating/review_count desde la migración 69, pero no
-- existía forma de calificar. Esta migración crea la tabla de reseñas
-- (una por orden) y una RPC SECURITY DEFINER que valida que el caller
-- sea el cliente de una orden DELIVERED y actualiza el promedio de la
-- tienda (los clientes no tienen permiso de UPDATE sobre stores).

BEGIN;

CREATE TABLE IF NOT EXISTS public.shop_store_reviews (
  id uuid default gen_random_uuid() primary key,
  order_id uuid references public.orders(id) on delete cascade not null unique,
  store_id uuid references public.stores(id) on delete cascade not null,
  customer_id uuid references public.profiles(id) on delete set null,
  rating integer not null check (rating between 1 and 5),
  comment text,
  created_at timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS shop_store_reviews_store_idx
  ON public.shop_store_reviews(store_id, created_at desc);

ALTER TABLE public.shop_store_reviews ENABLE ROW LEVEL SECURITY;

-- Lectura pública: las reseñas alimentan el rating visible de la tienda.
DROP POLICY IF EXISTS "Allow public read access to store reviews" ON public.shop_store_reviews;
CREATE POLICY "Allow public read access to store reviews"
  ON public.shop_store_reviews FOR SELECT
  USING (true);

-- El INSERT solo pasa por la RPC (security definer); no se crea policy
-- de INSERT para clientes directos.

CREATE OR REPLACE FUNCTION public.submit_store_review(
  p_order_id uuid,
  p_rating integer,
  p_comment text default null
)
RETURNS public.shop_store_reviews
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_review public.shop_store_reviews%ROWTYPE;
BEGIN
  IF p_rating IS NULL OR p_rating < 1 OR p_rating > 5 THEN
    RAISE EXCEPTION 'rating debe estar entre 1 y 5';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'orden no encontrada';
  END IF;
  IF v_order.customer_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'solo el cliente de la orden puede calificar';
  END IF;
  IF v_order.status <> 'DELIVERED' THEN
    RAISE EXCEPTION 'solo se pueden calificar órdenes entregadas';
  END IF;
  IF EXISTS (SELECT 1 FROM public.shop_store_reviews WHERE order_id = p_order_id) THEN
    RAISE EXCEPTION 'esta orden ya fue calificada';
  END IF;

  INSERT INTO public.shop_store_reviews (order_id, store_id, customer_id, rating, comment)
  VALUES (p_order_id, v_order.store_id, auth.uid(), p_rating, nullif(trim(coalesce(p_comment, '')), ''))
  RETURNING * INTO v_review;

  UPDATE public.stores s
  SET rating = sub.avg_rating,
      review_count = sub.review_count,
      updated_at = now()
  FROM (
    SELECT round(avg(rating)::numeric, 2) AS avg_rating, count(*) AS review_count
    FROM public.shop_store_reviews
    WHERE store_id = v_order.store_id
  ) sub
  WHERE s.id = v_order.store_id;

  RETURN v_review;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_store_review(uuid, integer, text) FROM public;
GRANT EXECUTE ON FUNCTION public.submit_store_review(uuid, integer, text) TO authenticated;

COMMIT;
