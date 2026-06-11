-- ====================================================================
-- 76 · Higo Shop: endurecimiento RLS de orders
-- ====================================================================
-- Las tres policies de orders creadas en la migración 69 eran FOR ALL
-- sin WITH CHECK. Consecuencias:
--   · Un cliente podía editar total/delivery_fee/items de su orden o
--     borrarla después de entregada.
--   · Cualquier driver podía modificar o BORRAR cualquier orden en
--     estado despachable, o reasignarse órdenes de otros drivers.
--   · No había restricción de transiciones de estado para nadie.
-- Mismo patrón que las migraciones 72 (profiles) y 73 (rides):
-- policies por comando + trigger que valida columnas inmutables y
-- transiciones de estado por rol. service_role (auth.uid() IS NULL)
-- y admins no se restringen.

BEGIN;

-- ────────────────────────────────────────────────────────────────────
-- 1. Policies por comando (reemplazan las FOR ALL)
-- ────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Allow customers to manage their own orders" ON public.orders;
DROP POLICY IF EXISTS "Allow merchants to read/update orders for their stores" ON public.orders;
DROP POLICY IF EXISTS "Allow drivers to view dispatchable or their assigned orders" ON public.orders;

-- Admin: acceso completo
DROP POLICY IF EXISTS "orders_admin_all" ON public.orders;
CREATE POLICY "orders_admin_all" ON public.orders
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- Cliente: ve sus órdenes
DROP POLICY IF EXISTS "orders_customer_select" ON public.orders;
CREATE POLICY "orders_customer_select" ON public.orders
  FOR SELECT TO authenticated
  USING (auth.uid() = customer_id);

-- Cliente: crea órdenes solo a su nombre, sin driver y en estado inicial
DROP POLICY IF EXISTS "orders_customer_insert" ON public.orders;
CREATE POLICY "orders_customer_insert" ON public.orders
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = customer_id
    AND driver_id IS NULL
    AND status IN ('PENDING_PRODUCT_PAYMENT', 'PENDING_PAYMENT')
  );

-- Cliente: actualiza sus órdenes (el trigger limita columnas/transiciones)
DROP POLICY IF EXISTS "orders_customer_update" ON public.orders;
CREATE POLICY "orders_customer_update" ON public.orders
  FOR UPDATE TO authenticated
  USING (auth.uid() = customer_id)
  WITH CHECK (auth.uid() = customer_id);

-- Comercio: ve y actualiza órdenes de sus tiendas
DROP POLICY IF EXISTS "orders_merchant_select" ON public.orders;
CREATE POLICY "orders_merchant_select" ON public.orders
  FOR SELECT TO authenticated
  USING (auth.uid() IN (SELECT owner_id FROM public.stores WHERE id = store_id));

DROP POLICY IF EXISTS "orders_merchant_update" ON public.orders;
CREATE POLICY "orders_merchant_update" ON public.orders
  FOR UPDATE TO authenticated
  USING (auth.uid() IN (SELECT owner_id FROM public.stores WHERE id = store_id))
  WITH CHECK (auth.uid() IN (SELECT owner_id FROM public.stores WHERE id = store_id));

-- Driver: ve despachables sin asignar o las suyas
DROP POLICY IF EXISTS "orders_driver_select" ON public.orders;
CREATE POLICY "orders_driver_select" ON public.orders
  FOR SELECT TO authenticated
  USING (
    (
      public.is_driver(auth.uid())
      AND driver_id IS NULL
      AND status IN ('READY_FOR_DRIVER_MATCH', 'DRIVER_CANDIDATE_BROADCASTED', 'READY_TO_DISPATCH')
    )
    OR auth.uid() = driver_id
  );

-- Driver: acepta despachables sin asignar o actualiza las suyas
DROP POLICY IF EXISTS "orders_driver_update" ON public.orders;
CREATE POLICY "orders_driver_update" ON public.orders
  FOR UPDATE TO authenticated
  USING (
    (
      public.is_driver(auth.uid())
      AND driver_id IS NULL
      AND status IN ('READY_FOR_DRIVER_MATCH', 'DRIVER_CANDIDATE_BROADCASTED', 'READY_TO_DISPATCH')
    )
    OR auth.uid() = driver_id
  )
  WITH CHECK (auth.uid() = driver_id);

-- Sin policy de DELETE: nadie borra órdenes desde el cliente
-- (solo service_role / consola).

-- ────────────────────────────────────────────────────────────────────
-- 2. Trigger: columnas inmutables y transiciones de estado por rol
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_order_update_rules()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_merchant boolean;
BEGIN
  -- service_role (backend) y admins: sin restricciones
  IF v_uid IS NULL OR public.is_admin(v_uid) THEN
    RETURN NEW;
  END IF;

  -- Columnas financieras y de identidad: inmutables para todos los roles
  IF NEW.customer_id IS DISTINCT FROM OLD.customer_id
     OR NEW.store_id IS DISTINCT FROM OLD.store_id
     OR NEW.total IS DISTINCT FROM OLD.total
     OR NEW.delivery_fee IS DISTINCT FROM OLD.delivery_fee
     OR NEW.items IS DISTINCT FROM OLD.items THEN
    RAISE EXCEPTION 'orders: no se pueden modificar montos, items ni participantes';
  END IF;

  -- ── Cliente ──
  IF v_uid = OLD.customer_id THEN
    IF NEW.driver_id IS DISTINCT FROM OLD.driver_id THEN
      RAISE EXCEPTION 'orders: el cliente no puede cambiar el driver';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
      (NEW.status = 'PRODUCT_PAYMENT_REPORTED'
        AND OLD.status IN ('PENDING_PRODUCT_PAYMENT', 'PENDING_PAYMENT'))
      OR (NEW.status = 'DELIVERY_PAYMENT_REPORTED'
        AND OLD.status IN ('PICKED_UP', 'DRIVER_EN_ROUTE_TO_CUSTOMER', 'DELIVERY_PAYMENT_PENDING'))
      OR (NEW.status = 'CANCELLED'
        AND OLD.status IN ('PENDING_PRODUCT_PAYMENT', 'PENDING_PAYMENT', 'PRODUCT_PAYMENT_REPORTED'))
    ) THEN
      RAISE EXCEPTION 'orders: transición de estado no permitida para el cliente (% -> %)', OLD.status, NEW.status;
    END IF;
    RETURN NEW;
  END IF;

  -- ── Comercio dueño de la tienda ──
  SELECT EXISTS (
    SELECT 1 FROM public.stores s WHERE s.id = OLD.store_id AND s.owner_id = v_uid
  ) INTO v_is_merchant;

  IF v_is_merchant THEN
    IF NEW.driver_id IS DISTINCT FROM OLD.driver_id THEN
      RAISE EXCEPTION 'orders: el comercio no puede asignar drivers';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status NOT IN (
      'PRODUCT_PAYMENT_VERIFIED', 'PAYMENT_VERIFIED', 'PREPARING',
      'READY_FOR_DRIVER_MATCH', 'READY_TO_DISPATCH',
      'DRIVER_CANDIDATE_BROADCASTED', 'CANCELLED'
    ) THEN
      RAISE EXCEPTION 'orders: transición de estado no permitida para el comercio (% -> %)', OLD.status, NEW.status;
    END IF;
    RETURN NEW;
  END IF;

  -- ── Driver asignado: avanza su entrega, no se desasigna ──
  IF v_uid = OLD.driver_id THEN
    IF NEW.driver_id IS DISTINCT FROM OLD.driver_id THEN
      RAISE EXCEPTION 'orders: el driver no puede transferir la orden';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status NOT IN (
      'DRIVER_EN_ROUTE_TO_STORE', 'PICKED_UP', 'DRIVER_EN_ROUTE_TO_CUSTOMER',
      'DELIVERY_PAYMENT_PENDING', 'DELIVERY_PAYMENT_CONFIRMED', 'DELIVERED'
    ) THEN
      RAISE EXCEPTION 'orders: transición de estado no permitida para el driver (% -> %)', OLD.status, NEW.status;
    END IF;
    RETURN NEW;
  END IF;

  -- ── Driver aceptando una orden despachable sin asignar ──
  IF OLD.driver_id IS NULL
     AND OLD.status IN ('READY_FOR_DRIVER_MATCH', 'DRIVER_CANDIDATE_BROADCASTED', 'READY_TO_DISPATCH')
     AND public.is_driver(v_uid)
     AND NEW.driver_id = v_uid
     AND NEW.status IN ('DRIVER_ASSIGNED', 'DRIVER_EN_ROUTE_TO_STORE') THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'orders: actualización no autorizada';
END;
$$;

DROP TRIGGER IF EXISTS orders_enforce_update_rules ON public.orders;
CREATE TRIGGER orders_enforce_update_rules
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_order_update_rules();

COMMIT;
