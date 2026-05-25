import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { supabase } from '../../services/supabase.js';

export const useAuthStore = create(
  persist(
    (set, get) => ({
      role: 'customer',
      userId: '',
      userName: 'Usuario Higo',
      userPhone: '',

      setRole: (role) => set({ role }),
      setUserInfo: ({ userId, userName, userPhone }) => set({ 
        userId: userId || '', 
        userName: userName || 'Usuario Higo', 
        userPhone: userPhone || '' 
      }),
      
      syncWithSupabase: async () => {
        try {
          const { data: { user } } = await supabase.auth.getUser();
          if (user) {
            const { data: profile } = await supabase
              .from('profiles')
              .select('role, full_name')
              .eq('id', user.id)
              .maybeSingle();

            // Map passenger role to customer role for consistency in shop
            const mappedRole = profile?.role === 'passenger' ? 'customer' : (profile?.role || 'customer');

            set({
              userId: user.id,
              userName: profile?.full_name || user.email || 'Usuario Higo',
              role: mappedRole,
            });
          }
        } catch (e) {
          console.warn('[ShopAuthStore] Error syncing with Supabase:', e);
        }
      }
    }),
    {
      name: 'higo-shop-auth',
    }
  )
);

// Auto-trigger auth synchronization on listener
supabase.auth.onAuthStateChange(async (event) => {
  if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
    await useAuthStore.getState().syncWithSupabase();
  } else if (event === 'SIGNED_OUT') {
    useAuthStore.getState().setUserInfo({ userId: '', userName: 'Invitado', userPhone: '' });
    useAuthStore.getState().setRole('customer');
  }
});

// Run initial sync immediately if user already exists in Supabase cache
useAuthStore.getState().syncWithSupabase();
