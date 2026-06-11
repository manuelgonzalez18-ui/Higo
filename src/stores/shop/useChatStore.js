import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { sendChatMessageRemote } from '../../services/shopChatService.js';

function generateMessageId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const THREAD_TO_TARGET = { store: 'storeMessages', driver: 'driverMessages' };
const TARGET_TO_THREAD = { storeMessages: 'store', driverMessages: 'driver' };

export const useChatStore = create(
  persist(
    (set, get) => ({
      // State: { [orderId]: { storeMessages: [], driverMessages: [] } }
      chats: {},

      initializeChat: (orderId) => {
        set((state) => {
          if (state.chats[orderId]) return state;
          return {
            chats: {
              ...state.chats,
              [orderId]: {
                storeMessages: [
                  {
                    id: 'init-store',
                    sender: 'store',
                    text: '¡Hola! Gracias por tu pedido. Por favor realiza el Pago Móvil con los datos suministrados y comparte el captures/referencia por este chat para proceder a su verificación.',
                    timestamp: new Date().toISOString()
                  }
                ],
                driverMessages: [
                  {
                    id: 'init-driver',
                    sender: 'driver',
                    text: 'El driver será asignado una vez que el comercio valide tu pago y prepare tu orden. ¡Te mantendremos al tanto!',
                    timestamp: new Date().toISOString(),
                    system: true
                  }
                ]
              }
            }
          };
        });
      },

      addMessage: (orderId, target, message) => {
        // target: 'storeMessages' | 'driverMessages'
        set((state) => {
          const orderChat = state.chats[orderId] || { storeMessages: [], driverMessages: [] };
          const targetMessages = [...orderChat[target], {
            id: generateMessageId(),
            timestamp: new Date().toISOString(),
            ...message
          }];

          return {
            chats: {
              ...state.chats,
              [orderId]: {
                ...orderChat,
                [target]: targetMessages
              }
            }
          };
        });
      },

      // Inserta un mensaje llegado del backend (fetch inicial o realtime),
      // ignorándolo si ya existe localmente (eco de un envío propio).
      upsertRemoteMessage: (orderId, message) => {
        const target = THREAD_TO_TARGET[message?.thread];
        if (!target || !message?.id) return;
        set((state) => {
          const orderChat = state.chats[orderId] || { storeMessages: [], driverMessages: [] };
          if (orderChat[target].some((m) => m.id === message.id)) return state;
          const targetMessages = [...orderChat[target], {
            id: message.id,
            sender: message.sender,
            text: message.text,
            system: message.system,
            timestamp: message.timestamp,
          }].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

          return {
            chats: {
              ...state.chats,
              [orderId]: {
                ...orderChat,
                [target]: targetMessages
              }
            }
          };
        });
      },

      // Agrega el mensaje localmente y lo persiste en BD (best-effort,
      // ambos lados comparten el id para que el eco realtime se deduplique).
      sendMessage: (orderId, target, message) => {
        const id = generateMessageId();
        get().addMessage(orderId, target, { ...message, id });
        const thread = TARGET_TO_THREAD[target];
        if (!thread) return;
        sendChatMessageRemote({
          id,
          orderId,
          thread,
          sender: message.sender,
          senderId: message.senderId || null,
          text: message.text,
          isSystem: !!message.system,
        }).catch((err) => console.warn('[ChatStore] sendChatMessageRemote failed:', err?.message || err));
      },

      clearChats: () => set({ chats: {} })
    }),
    {
      name: 'higo-shop-chats'
    }
  )
);
