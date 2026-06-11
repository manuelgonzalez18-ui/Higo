import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useCartStore = create(
  persist(
    (set, get) => ({
      carts: {},

      addItem: (storeId, product, quantity = 1) => {
        set((state) => {
          const cart = state.carts[storeId] || { items: [] };
          const existingIndex = cart.items.findIndex(item => item.id === product.id);

          let newItems;
          if (existingIndex >= 0) {
            newItems = cart.items.map((item, i) =>
              i === existingIndex
                ? { ...item, quantity: item.quantity + quantity }
                : item
            );
          } else {
            newItems = [...cart.items, { ...product, quantity }];
          }

          return {
            carts: {
              ...state.carts,
              [storeId]: { items: newItems },
            },
          };
        });
      },

      removeItem: (storeId, productId) => {
        set((state) => {
          const cart = state.carts[storeId];
          if (!cart) return state;

          const newItems = cart.items.filter(item => item.id !== productId);
          if (newItems.length === 0) {
            const { [storeId]: _, ...rest } = state.carts;
            return { carts: rest };
          }

          return {
            carts: {
              ...state.carts,
              [storeId]: { items: newItems },
            },
          };
        });
      },

      updateQuantity: (storeId, productId, quantity) => {
        if (quantity <= 0) {
          get().removeItem(storeId, productId);
          return;
        }

        set((state) => {
          const cart = state.carts[storeId];
          if (!cart) return state;

          return {
            carts: {
              ...state.carts,
              [storeId]: {
                items: cart.items.map(item =>
                  item.id === productId ? { ...item, quantity } : item
                ),
              },
            },
          };
        });
      },

      // Reconcilia el carrito contra el catálogo vigente: elimina productos
      // que ya no existen o están agotados y actualiza precios cambiados.
      // Devuelve { removed: [names], repriced: [names] } para informar al user.
      reconcileCart: (storeId, products) => {
        const result = { removed: [], repriced: [] };
        const cart = get().carts[storeId];
        if (!cart || !Array.isArray(products) || products.length === 0) return result;

        const byId = new Map(products.map((p) => [p.id, p]));
        const newItems = [];
        cart.items.forEach((item) => {
          const live = byId.get(item.id);
          if (!live || live.available === false) {
            result.removed.push(item.name);
            return;
          }
          const livePrice = Number(live.price);
          if (Number.isFinite(livePrice) && livePrice !== Number(item.price)) {
            result.repriced.push(item.name);
            newItems.push({ ...item, price: livePrice });
          } else {
            newItems.push(item);
          }
        });

        if (result.removed.length || result.repriced.length) {
          set((state) => {
            if (newItems.length === 0) {
              const { [storeId]: _, ...rest } = state.carts;
              return { carts: rest };
            }
            return {
              carts: {
                ...state.carts,
                [storeId]: { items: newItems },
              },
            };
          });
        }
        return result;
      },

      clearCart: (storeId) => {
        set((state) => {
          const { [storeId]: _, ...rest } = state.carts;
          return { carts: rest };
        });
      },

      getCartItems: (storeId) => {
        return get().carts[storeId]?.items || [];
      },

      getCartTotal: (storeId) => {
        const items = get().carts[storeId]?.items || [];
        return items.reduce((sum, item) => sum + item.price * item.quantity, 0);
      },

      getCartItemCount: (storeId) => {
        const items = get().carts[storeId]?.items || [];
        return items.reduce((sum, item) => sum + item.quantity, 0);
      },

      getTotalItemCount: () => {
        const carts = get().carts;
        return Object.values(carts).reduce((sum, cart) => {
          return sum + cart.items.reduce((s, item) => s + item.quantity, 0);
        }, 0);
      },
    }),
    {
      name: 'higo-shop-cart',
    }
  )
);
