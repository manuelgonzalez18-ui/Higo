import { useEffect } from 'react';
import { useChatStore } from '../../stores/shop/useChatStore.js';
import { fetchChatMessagesRemote, subscribeToChatMessages } from '../../services/shopChatService.js';

// Hidrata el chat de una orden desde la BD y lo mantiene sincronizado en
// vivo. Los mensajes propios ya están en el store local con el mismo id,
// así que upsertRemoteMessage deduplica el eco del canal realtime.
export function useChatSync(orderId) {
  const upsertRemoteMessage = useChatStore((s) => s.upsertRemoteMessage);

  useEffect(() => {
    if (!orderId) return;

    let cancelled = false;
    fetchChatMessagesRemote(orderId)
      .then((messages) => {
        if (cancelled) return;
        messages.forEach((m) => upsertRemoteMessage(orderId, m));
      })
      .catch((err) => console.warn('[useChatSync] fetch failed:', err?.message || err));

    const unsubscribe = subscribeToChatMessages(orderId, (message) => {
      upsertRemoteMessage(orderId, message);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [orderId, upsertRemoteMessage]);
}
