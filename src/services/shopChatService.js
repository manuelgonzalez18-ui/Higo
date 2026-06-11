import { supabase } from './supabase.js';

const THREADS = new Set(['store', 'driver']);
const SENDERS = new Set(['customer', 'store', 'driver']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertValidOrderId(orderId) {
  if (!orderId || typeof orderId !== 'string') {
    throw new Error('chatService: orderId inválido');
  }
}

export function mapChatRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    thread: row.thread,
    sender: row.sender,
    text: row.text,
    system: row.is_system || undefined,
    timestamp: row.created_at,
  };
}

export async function sendChatMessageRemote({ id, orderId, thread, sender, senderId = null, text, isSystem = false }) {
  assertValidOrderId(orderId);
  if (!THREADS.has(thread)) throw new Error(`chatService: thread inválido (${thread})`);
  if (!SENDERS.has(sender)) throw new Error(`chatService: sender inválido (${sender})`);
  if (!text || !text.trim()) throw new Error('chatService: text vacío');

  const { error } = await supabase.from('shop_chat_messages').insert({
    // El id se genera client-side para que el eco del canal realtime se
    // pueda deduplicar contra el mensaje ya agregado localmente.
    ...(UUID_RE.test(id || '') ? { id } : {}),
    order_id: orderId,
    thread,
    sender,
    sender_id: UUID_RE.test(senderId || '') ? senderId : null,
    text,
    is_system: isSystem,
  });
  if (error) throw error;
}

export async function fetchChatMessagesRemote(orderId) {
  assertValidOrderId(orderId);

  const { data, error } = await supabase
    .from('shop_chat_messages')
    .select('*')
    .eq('order_id', orderId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return (data || []).map(mapChatRow);
}

export function subscribeToChatMessages(orderId, onMessage) {
  assertValidOrderId(orderId);
  if (typeof onMessage !== 'function') {
    throw new Error('chatService: onMessage debe ser una función');
  }

  const channel = supabase
    .channel(`shop-chat-${orderId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'shop_chat_messages',
        filter: `order_id=eq.${orderId}`,
      },
      (payload) => onMessage(mapChatRow(payload.new)),
    )
    .subscribe();

  return () => supabase.removeChannel(channel);
}
