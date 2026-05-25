import { useEffect, useState } from 'react';
import { supabase } from '../../services/supabase.js';

export function useOrderEvents(orderId) {
  const [events, setEvents] = useState([]);

  useEffect(() => {
    if (!orderId) return;
    let mounted = true;

    supabase
      .from('order_events')
      .select('*')
      .eq('order_id', orderId)
      .order('created_at', { ascending: false })
      .limit(30)
      .then(({ data }) => {
        if (mounted && data) setEvents(data);
      });

    const channel = supabase
      .channel(`order-events-${orderId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'order_events',
        filter: `order_id=eq.${orderId}`,
      }, (payload) => {
        setEvents((prev) => [payload.new, ...prev].slice(0, 30));
      })
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, [orderId]);

  return events;
}
