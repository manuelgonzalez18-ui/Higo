import { useEffect, useRef } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { supabase } from '../services/supabase';

const ACTIVE_RIDE_STATUSES = ['requested', 'accepted', 'in_progress', 'arrived_at_dropoff'];
const SKIP_HASH_PREFIXES = [
    '#/auth',
    '#/admin',
    '#/driver',
    '#/onboarding',
    '#/reset-password',
    '#/ride/',
    '#/confirm',
    '#/track/',
    '#/delivery/',
];

const shouldSkipRecovery = () => {
    if (typeof window === 'undefined') return true;
    const currentHash = window.location.hash.split('?')[0] || '#/';
    return SKIP_HASH_PREFIXES.some((prefix) => currentHash.startsWith(prefix));
};

/**
 * Restores a passenger's current ride after the web app or native app is
 * closed/reopened. The ride itself is the source of truth, so recovery works
 * even when the browser discarded component state or the hash returned to #/.
 */
export default function PassengerActiveRideRecovery() {
    const checkingRef = useRef(false);
    const lastRedirectedRideRef = useRef(null);

    useEffect(() => {
        let disposed = false;
        let nativeListener = null;

        const recoverActiveRide = async () => {
            if (disposed || checkingRef.current || shouldSkipRecovery()) return;
            checkingRef.current = true;

            try {
                const { data: { session } } = await supabase.auth.getSession();
                const user = session?.user;
                if (!user || disposed) return;

                const { data: profile } = await supabase
                    .from('profiles')
                    .select('role')
                    .eq('id', user.id)
                    .maybeSingle();

                if (disposed || (profile?.role && profile.role !== 'passenger')) return;

                const { data: ride, error } = await supabase
                    .from('rides')
                    .select('id,status,created_at')
                    .eq('user_id', user.id)
                    .in('status', ACTIVE_RIDE_STATUSES)
                    .order('created_at', { ascending: false })
                    .limit(1)
                    .maybeSingle();

                if (disposed || error || !ride?.id) return;
                if (String(lastRedirectedRideRef.current || '') === String(ride.id)) return;

                lastRedirectedRideRef.current = ride.id;
                const destination = `#/ride/${encodeURIComponent(ride.id)}`;
                if (window.location.hash !== destination) {
                    window.location.hash = destination;
                }
            } catch (error) {
                console.warn('[PassengerActiveRideRecovery] recovery failed:', error);
            } finally {
                checkingRef.current = false;
            }
        };

        const onVisibilityChange = () => {
            if (document.visibilityState === 'visible') void recoverActiveRide();
        };
        const onFocus = () => void recoverActiveRide();
        const onHashChange = () => {
            if (!shouldSkipRecovery()) void recoverActiveRide();
        };

        document.addEventListener('visibilitychange', onVisibilityChange);
        window.addEventListener('focus', onFocus);
        window.addEventListener('hashchange', onHashChange);

        void CapacitorApp.addListener('appStateChange', ({ isActive }) => {
            if (isActive) void recoverActiveRide();
        }).then((listener) => {
            nativeListener = listener;
        }).catch(() => {
            // Browser runtime: visibility/focus handlers cover the same case.
        });

        const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
            if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') {
                void recoverActiveRide();
            }
            if (event === 'SIGNED_OUT') lastRedirectedRideRef.current = null;
        });

        void recoverActiveRide();

        return () => {
            disposed = true;
            document.removeEventListener('visibilitychange', onVisibilityChange);
            window.removeEventListener('focus', onFocus);
            window.removeEventListener('hashchange', onHashChange);
            subscription.unsubscribe();
            nativeListener?.remove?.();
        };
    }, []);

    return null;
}
