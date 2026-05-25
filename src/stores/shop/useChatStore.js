import { create } from 'zustand';
import { persist } from 'zustand/middleware';

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
            id: Math.random().toString(36).substring(7),
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

      clearChats: () => set({ chats: {} })
    }),
    {
      name: 'higo-shop-chats'
    }
  )
);
