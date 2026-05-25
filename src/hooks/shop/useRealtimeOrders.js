import { useEffect } from 'react';
import { supabase } from '../../services/supabase.js';

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
