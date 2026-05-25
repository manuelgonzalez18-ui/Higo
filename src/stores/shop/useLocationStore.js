import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const HIGUEROTE_DEFAULT_LOCATION = { lat: 10.4817, lng: -66.0997 };

const newId = () => `loc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const useLocationStore = create(
  persist(
    (set) => ({
      userLocation: HIGUEROTE_DEFAULT_LOCATION,
      deliveryAddress: 'Higuerote, Miranda, Venezuela',
      isLocating: false,
      error: null,
      savedLocations: [],

      setUserLocation: (location) => set({ userLocation: location, error: null }),

      setDeliveryAddress: (address) => set({ deliveryAddress: address }),

      addSavedLocation: ({ alias, address, lat, lng, iconKey = 'pin' }) =>
        set((state) => ({
          savedLocations: [
            ...state.savedLocations,
            { id: newId(), alias, address, lat, lng, iconKey },
          ],
        })),

      removeSavedLocation: (id) =>
        set((state) => ({
          savedLocations: state.savedLocations.filter((l) => l.id !== id),
        })),

      useSavedLocation: (id) =>
        set((state) => {
          const target = state.savedLocations.find((l) => l.id === id);
          if (!target) return {};
          return {
            userLocation: { lat: target.lat, lng: target.lng },
            deliveryAddress: target.address,
          };
        }),

      requestLocation: () => {
        set({ isLocating: true, error: null });

        if (!navigator.geolocation) {
          set({ isLocating: false, error: 'Geolocalización no soportada', userLocation: HIGUEROTE_DEFAULT_LOCATION });
          return;
        }

        navigator.geolocation.getCurrentPosition(
          (position) => {
            set({
              userLocation: {
                lat: position.coords.latitude,
                lng: position.coords.longitude,
              },
              isLocating: false,
            });
          },
          () => {
            set({
              isLocating: false,
              error: 'No se pudo obtener la ubicación',
              userLocation: HIGUEROTE_DEFAULT_LOCATION,
            });
          },
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 300000 }
        );
      },
    }),
    {
      name: 'higo-shop-location',
      partialize: (state) => ({
        userLocation: state.userLocation,
        deliveryAddress: state.deliveryAddress,
        savedLocations: state.savedLocations,
      }),
    }
  )
);
