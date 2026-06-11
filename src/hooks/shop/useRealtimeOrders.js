import { useEffect } from 'react';
import { supabase } from '../../services/supabase.js';

// Suscripción sin filtro de cliente, para vistas que observan el flujo
// general de órdenes (ej. el tablero del driver). RLS limita lo visible.
export function useRealtimeAllOrders(onOrderUpsert) {
  useEffect(() => {
    if (!onOrderUpsert) return;

    const channel = supabase
      .channel('orders-all')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'orders',
      }, (payload) => {
        if (payload.new) onOrderUpsert(payload.new);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [onOrderUpsert]);
}

export function useRealtimeOrders({ customerId, onOrderUpsert }) {
  useEffect(() => {
    if (!customerId || !onOrderUpsert) return;

    const channel = supabase
      .channel(`orders-customer-${customerId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'orders',
        filter: `customer_id=eq.${customerId}`,
      }, (payload) => {
        if (payload.new) onOrderUpsert(payload.new);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [customerId, onOrderUpsert]);
}
