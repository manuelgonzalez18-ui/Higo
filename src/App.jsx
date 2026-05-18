import React, { Suspense, lazy } from 'react';
import { HashRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import AdminGuard from './components/AdminGuard';
import ChatWidget from './components/ChatWidget';
import SupportChatWidget from './components/SupportChatWidget';
import './index.css';         // Ensure Tailwind/global CSS is imported

// ─── Páginas: lazy split ─────────────────────────────────────────────
// Cada page se carga on-demand cuando el usuario llega a su ruta. El
// chunk se hashea (ver vite.config.js: chunkFileNames con [hash]) así
// no hay riesgo de stale chunk vs index.js nuevo durante el deploy.
// Para el shell del que ya están en el bundle main (ChatWidget,
// SupportChatWidget, AdminGuard) seguimos con import estático porque
// se renderizan globalmente, no por ruta.
const RequestRidePage         = lazy(() => import('./pages/RequestRidePage'));
const ScheduleRidePage        = lazy(() => import('./pages/ScheduleRidePage'));
const ConfirmTripPage         = lazy(() => import('./pages/ConfirmTripPage'));
const DriverDashboard         = lazy(() => import('./pages/DriverDashboard'));
const DriverStatsPage         = lazy(() => import('./pages/DriverStatsPage'));
const DriverOnboardingPage    = lazy(() => import('./pages/DriverOnboardingPage'));
const RideStatusPage          = lazy(() => import('./pages/RideStatusPage'));
const AdminDriversPage        = lazy(() => import('./pages/AdminDriversPage'));
const AdminUsersPage          = lazy(() => import('./pages/AdminUsersPage'));
const AdminPricingPage        = lazy(() => import('./pages/AdminPricingPage'));
const AdminPromoCodesPage     = lazy(() => import('./pages/AdminPromoCodesPage'));
const AdminDisputesPage       = lazy(() => import('./pages/AdminDisputesPage'));
const AdminLoginPage          = lazy(() => import('./pages/AdminLoginPage'));
const AdminDashboardPage      = lazy(() => import('./pages/AdminDashboardPage'));
const AdminAnalyticsPage      = lazy(() => import('./pages/AdminAnalyticsPage'));
const AdminZonesPage          = lazy(() => import('./pages/AdminZonesPage'));
const AdminFraudPage          = lazy(() => import('./pages/AdminFraudPage'));
const AdminSupportPage        = lazy(() => import('./pages/AdminSupportPage'));
const AdminSupportStatsPage   = lazy(() => import('./pages/AdminSupportStatsPage'));
const DriverLandingPage       = lazy(() => import('./pages/DriverLandingPage'));
const HigoPayPage             = lazy(() => import('./pages/HigoPayPage'));
const RideHistoryPage         = lazy(() => import('./pages/RideHistoryPage'));
const OnboardingPage          = lazy(() => import('./pages/OnboardingPage'));
const AuthPage                = lazy(() => import('./pages/AuthPage'));

import { useEffect, useState } from 'react';
import { initGlobalAudio } from './services/notificationService';
import { ensureFcmRegistration, subscribeForegroundMessages } from './services/pushNotifications';
import DriverRequestCard from './components/DriverRequestCard';
import { supabase } from './services/supabase';
import { useGeolocation } from './hooks/useGeolocation';
import LocationDisclosure from './components/LocationDisclosure';
import { ToastProvider } from './components/Toast';

// Rutas donde NO chequeamos onboarding (sino entraríamos en loop o
// gateamos a usuarios que no son pasajeros).
const ONBOARDING_SKIP_PREFIXES = [
    '/onboarding', '/auth',
    '/admin', '/driver',
];

// Gate del onboarding del pasajero (Fase 9 D.P1). Vive DENTRO del
// HashRouter para poder usar useNavigate y reaccionar a cambios de
// ubicación. Si:
//   1. Hay user logueado y
//   2. profile.role === 'passenger' y
//   3. user_preferences.onboarded_at IS NULL y
//   4. la ruta actual NO está en ONBOARDING_SKIP_PREFIXES
// → navigate('/onboarding', { replace: true }).
//
// Se ejecuta al mount + en cada cambio de location (cuando navegan)
// + en cada auth state change (login fresh). El check es barato
// (1-2 queries cacheables) y se evita re-disparar si ya estamos en
// onboarding.
const OnboardingGate = () => {
    const navigate = useNavigate();
    const location = useLocation();
    React.useEffect(() => {
        let cancelled = false;
        const skip = ONBOARDING_SKIP_PREFIXES.some(p => location.pathname.startsWith(p));
        if (skip) return;
        (async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (cancelled || !user) return;
            const { data: profile } = await supabase
                .from('profiles')
                .select('role')
                .eq('id', user.id)
                .maybeSingle();
            if (cancelled || (profile?.role && profile.role !== 'passenger')) return;
            const { data: prefs } = await supabase
                .from('user_preferences')
                .select('onboarded_at')
                .eq('user_id', user.id)
                .maybeSingle();
            if (cancelled) return;
            // Si la tabla no existe todavía (mig 38 no aplicada en prod)
            // el maybeSingle devuelve error en data y prefs === null —
            // no nag para no romper la app.
            if (prefs === null) return;
            if (!prefs.onboarded_at) {
                navigate('/onboarding', { replace: true });
            }
        })();
        return () => { cancelled = true; };
    }, [location.pathname, navigate]);
    return null;
};

const App = () => {
  const { showDisclosure, handleAcceptDisclosure } = useGeolocation();
  const [incomingRequest, setIncomingRequest] = useState(null);

  // --- GLOBAL SESSION LOCKING ---
  // Nota sobre threat model de localStorage.session_id:
  // Está en localStorage plaintext, no en sessionStorage. La razón es
  // intencional: sessionStorage se borra al cerrar la tab y forzaría
  // logout cada vez que el user reabre la app, además rompería
  // multi-tab (Tab 2 al cargar leería null y el realtime lo
  // expulsaría asumiendo que es "otro dispositivo").
  // El riesgo real de XSS está limitado: Supabase guarda su auth-token
  // en el MISMO localStorage; quien pueda leer session_id ya tiene el
  // token de auth (que es lo que da acceso real a la cuenta). Robar
  // session_id solo permite romper la detección de multi-device, no
  // escalar permisos. Migrar a Capacitor Preferences (encrypted en
  // Android EncryptedSharedPreferences / iOS Keychain) daría defensa
  // adicional en mobile, pero requiere recompilar el APK y queda para
  // una fase con bandwidth para coordinar el bump de versión nativa.
  useEffect(() => {
    let channel;

    const setupSessionWatcher = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Monitor local session changes
      channel = supabase
        .channel(`global_session:${user.id}`)
        .on('postgres_changes', {
          event: 'UPDATE',
          schema: 'public',
          table: 'profiles',
          filter: `id=eq.${user.id}`
        }, (payload) => {
          const dbSessionId = payload.new.current_session_id;
          const localSessionId = localStorage.getItem('session_id');

          if (dbSessionId && localSessionId && dbSessionId !== localSessionId) {
            toast.error("⚠️ Tu cuenta se ha abierto en otro dispositivo. Se cerrará la sesión en este equipo.");
            supabase.auth.signOut().then(() => {
              localStorage.removeItem('session_id');
              window.location.href = '#/auth';
              window.location.reload();
            });
          }
        })
        .subscribe();
    };

    setupSessionWatcher();

    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    initGlobalAudio(); // Unlock audio context on first interaction

    // Registrá el FCM token al cargar la app y cada vez que cambia el auth
    // (login → tenemos UID para guardar el token; logout → limpiar caché).
    ensureFcmRegistration();
    const { data: authSub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        ensureFcmRegistration();
      }
    });

    const unsub = subscribeForegroundMessages((payload) => {
      const { title } = payload.notification || {};
      const data = payload.data || {};

      if (data.type === 'ride_request' || title?.includes('Nuevo Viaje') || title?.includes('Request')) {
        setIncomingRequest({
          price: data.price || '1.5',
          distance: data.distance || '1.9 km',
          duration: data.duration || '15 min',
          pickupLocation: data.pickupLocation || 'Ubicación Actual',
          pickupAddress: data.pickupAddress || 'Downtown District',
          dropoffLocation: data.dropoffLocation || 'Centro Comercial Flamingo',
          dropoffAddress: data.dropoffAddress || 'Entrada Principal',
          ...data
        });
        if (navigator.vibrate) navigator.vibrate([500, 200, 500, 200, 500]);
      } else if (title && navigator.vibrate) {
        navigator.vibrate([200, 100, 200]);
      }
    });

    return () => {
      authSub?.subscription?.unsubscribe?.();
      if (typeof unsub === 'function') unsub();
    };
  }, []);

  const handleAcceptRequest = () => {
    setIncomingRequest(null);
  };

  const handleDeclineRequest = () => {
    setIncomingRequest(null);
  };

  return (
    <ToastProvider>
    <HashRouter>
      <OnboardingGate />
      {/* Suspense fallback mientras se carga el chunk de la ruta. */}
      <Suspense fallback={
        <div className="min-h-screen flex items-center justify-center bg-[#0F1014]">
          <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
        </div>
      }>
      <Routes>
        <Route
          path="/"
          element={
            window.location.hostname.includes('higodriver.com')
              ? <DriverLandingPage />
              : <RequestRidePage />
          }
        />
        <Route path="/auth" element={<AuthPage />} />
        <Route path="/schedule" element={<ScheduleRidePage />} />
        <Route path="/confirm" element={<ConfirmTripPage />} />
        <Route path="/driver" element={<DriverDashboard />} />
        <Route path="/driver/stats" element={<DriverStatsPage />} />
        <Route path="/driver/onboarding" element={<DriverOnboardingPage />} />
        <Route path="/higo-pay" element={<HigoPayPage />} />
        <Route path="/history" element={<RideHistoryPage />} />
        <Route path="/onboarding" element={<OnboardingPage />} />
        <Route path="/ride/:id" element={<RideStatusPage />} />
        <Route path="/admin" element={<AdminLoginPage />} />
        <Route path="/admin/dashboard" element={<AdminDashboardPage />} />
        <Route path="/admin/drivers" element={<AdminGuard><AdminDriversPage /></AdminGuard>} />
        <Route path="/admin/users" element={<AdminGuard><AdminUsersPage /></AdminGuard>} />
        <Route path="/admin/pricing" element={<AdminGuard><AdminPricingPage /></AdminGuard>} />
        <Route path="/admin/promos" element={<AdminGuard><AdminPromoCodesPage /></AdminGuard>} />
        <Route path="/admin/disputes" element={<AdminGuard><AdminDisputesPage /></AdminGuard>} />
        <Route path="/admin/analytics" element={<AdminGuard><AdminAnalyticsPage /></AdminGuard>} />
        <Route path="/admin/zones" element={<AdminGuard><AdminZonesPage /></AdminGuard>} />
        <Route path="/admin/fraud" element={<AdminFraudPage />} />
        <Route path="/admin/support" element={<AdminGuard><AdminSupportPage /></AdminGuard>} />
        <Route path="/admin/support/stats" element={<AdminGuard><AdminSupportStatsPage /></AdminGuard>} />
        <Route path="/join" element={<DriverLandingPage />} />
      </Routes>
      </Suspense>
      <ChatWidget />
      <SupportChatWidget />

      {showDisclosure && <LocationDisclosure onAccept={handleAcceptDisclosure} />}

      {/* Driver Request Overlay */}
      <DriverRequestCard
        isVisible={!!incomingRequest}
        request={incomingRequest}
        onAccept={handleAcceptRequest}
        onDecline={handleDeclineRequest}
      />


    </HashRouter>
    </ToastProvider>
  );
};

export default App;