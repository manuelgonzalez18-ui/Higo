import React, { Suspense, lazy } from 'react';
import { HashRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import AdminGuard from './components/AdminGuard';
import ChatWidget from './components/ChatWidget';
import SupportChatWidget from './components/SupportChatWidget';
// import ErrorBoundary from './components/ErrorBoundary'; // disabled — debugging blank screen
// import OfflineBanner from './components/OfflineBanner'; // disabled — debugging blank screen
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
const AdminDeliveriesPage     = lazy(() => import('./pages/AdminDeliveriesPage'));
const DeliveryReceiptPage     = lazy(() => import('./pages/DeliveryReceiptPage'));
const AdminSupportPage        = lazy(() => import('./pages/AdminSupportPage'));
const AdminSupportStatsPage   = lazy(() => import('./pages/AdminSupportStatsPage'));
const AdminShopPage           = lazy(() => import('./pages/AdminShopPage'));
const DriverLandingPage       = lazy(() => import('./pages/DriverLandingPage'));
const HigoPayPage             = lazy(() => import('./pages/HigoPayPage'));
const RideHistoryPage         = lazy(() => import('./pages/RideHistoryPage'));
const OnboardingPage          = lazy(() => import('./pages/OnboardingPage'));
const AuthPage                = lazy(() => import('./pages/AuthPage'));
const ResetPasswordPage       = lazy(() => import('./pages/ResetPasswordPage'));
const TermsOfDeliveryPage     = lazy(() => import('./pages/TermsOfDeliveryPage'));
const PrivacyPage             = lazy(() => import('./pages/PrivacyPage'));
const PublicTrackingPage      = lazy(() => import('./pages/PublicTrackingPage'));

// Anexo C / M1 — sandbox de Mapbox solo en dev. En producción el chunk
// no se carga porque la ruta no se monta (gate import.meta.env.DEV abajo).
const MapboxSandbox           = lazy(() => import('./components/_dev/MapboxSandbox'));

// ─── Higo Shop: lazy module imports ──────────────────────────────────
const ShopMarketplaceHome   = lazy(() => import('./features/marketplace/pages/MarketplaceHome.jsx').then((m) => ({ default: m.MarketplaceHome })));
const ShopSearchMap         = lazy(() => import('./features/marketplace/pages/SearchMap.jsx').then((m) => ({ default: m.SearchMap })));
const ShopStoreView         = lazy(() => import('./features/marketplace/pages/StoreView.jsx').then((m) => ({ default: m.StoreView })));
const ShopCartPage          = lazy(() => import('./features/cart/pages/CartPage.jsx').then((m) => ({ default: m.CartPage })));
const ShopCheckoutPage      = lazy(() => import('./features/checkout/pages/CheckoutPage.jsx').then((m) => ({ default: m.CheckoutPage })));
const ShopOrdersPage        = lazy(() => import('./features/orders/pages/OrdersPage.jsx').then((m) => ({ default: m.OrdersPage })));
const ShopOrderDetailPage   = lazy(() => import('./features/orders/pages/OrderDetailPage.jsx').then((m) => ({ default: m.OrderDetailPage })));
const ShopProfilePage       = lazy(() => import('./features/profile/pages/ProfilePage.jsx').then((m) => ({ default: m.ProfilePage })));
const ShopMerchantDashboard = lazy(() => import('./features/merchant/pages/MerchantDashboard.jsx').then((m) => ({ default: m.MerchantDashboard })));
const ShopDriverDashboard   = lazy(() => import('./features/driver/pages/DriverDashboard.jsx').then((m) => ({ default: m.DriverDashboard })));
const ShopAppShell          = lazy(() => import('./components/shop/layout/AppShell.jsx').then((m) => ({ default: m.AppShell })));

import { useAuthStore } from './stores/shop/useAuthStore.js';
import { GoogleMapsProvider } from './components/shop/maps/MapView.jsx';

function ShopHomeSelector() {
  const role = useAuthStore((s) => s.role);
  if (role === 'merchant') return <ShopMerchantDashboard />;
  if (role === 'driver') return <ShopDriverDashboard />;
  return <ShopMarketplaceHome />;
}

import { useEffect, useState } from 'react';
import { initGlobalAudio } from './services/notificationService';
import { ensureFcmRegistration, subscribeForegroundMessages } from './services/pushNotifications';
import DriverRequestCard from './components/DriverRequestCard';
import { supabase } from './services/supabase';
import { useGeolocation } from './hooks/useGeolocation';
import LocationDisclosure from './components/LocationDisclosure';
import { ToastProvider, toast } from './components/Toast';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';

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
    let nativeListener;

    const checkSession = async () => {
      try {
        const path = window.location.hash.split('?')[0];
        if (path === '#/auth' || path === '#/admin') {
          return;
        }

        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data: profile, error } = await supabase
          .from('profiles')
          .select('current_session_id')
          .eq('id', user.id)
          .single();

        if (error) {
          console.error('[SessionWatch] Error fetching profile:', error);
          if (error.code === 'PGRST116') {
            const newSessionId = self.crypto.randomUUID();
            localStorage.setItem('session_id', newSessionId);
            await supabase
              .from('profiles')
              .upsert({ id: user.id, current_session_id: newSessionId });
          }
          return;
        }

        const localSessionId = localStorage.getItem('session_id');
        const dbSessionId = profile?.current_session_id;

        if (!localSessionId) {
          if (!dbSessionId) {
            const newSessionId = self.crypto.randomUUID();
            localStorage.setItem('session_id', newSessionId);
            await supabase
              .from('profiles')
              .update({ current_session_id: newSessionId })
              .eq('id', user.id);
          } else {
            toast.error("⚠️ Sesión no autorizada. Por favor, inicia sesión de nuevo.");
            await supabase.auth.signOut();
            localStorage.removeItem('session_id');
            window.location.href = '#/auth';
            window.location.reload();
          }
        } else {
          if (!dbSessionId) {
            await supabase
              .from('profiles')
              .update({ current_session_id: localSessionId })
              .eq('id', user.id);
          } else if (dbSessionId !== localSessionId) {
            toast.error("⚠️ Tu cuenta se ha abierto en otro dispositivo. Se cerrará la sesión en este equipo.");
            await supabase.auth.signOut();
            localStorage.removeItem('session_id');
            window.location.href = '#/auth';
            window.location.reload();
          }
        }
      } catch (err) {
        console.error('[SessionWatch] Error checking session:', err);
      }
    };

    const teardown = () => {
      if (channel) {
        supabase.removeChannel(channel);
        channel = null;
      }
    };

    const setupSessionWatcher = async () => {
      teardown();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // 1. Comprobación estática inicial al arrancar
      await checkSession();

      // 2. Suscripción a cambios Postgres en tiempo real
      channel = supabase
        .channel(`global_session:${user.id}`)
        .on('postgres_changes', {
          event: 'UPDATE',
          schema: 'public',
          table: 'profiles',
          filter: `id=eq.${user.id}`
        }, (payload) => {
          const path = window.location.hash.split('?')[0];
          if (path === '#/auth' || path === '#/admin') {
            return;
          }

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

    // Re-setup tras SIGNED_IN — el useEffect inicial corre cuando el user
    // aun no esta cargado (sesion null en el bootstrap), asi que sin esto
    // el watcher no se arma despues del login y la segunda sesion no
    // expulsa a la primera.
    const { data: authSub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        setupSessionWatcher();
      } else if (event === 'SIGNED_OUT') {
        teardown();
      }
    });

    // 3. Listener para visibilidad web (cambios de tab / desenfoque)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        checkSession();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // 4. Listener para cambios de ruta en HashRouter (navegación activa)
    window.addEventListener('hashchange', checkSession);

    // 5. Comprobación periódica proactiva cada 10 segundos
    const periodicTimer = setInterval(checkSession, 10000);

    // 6. Listener para reanudación nativa desde segundo plano (Capacitor)
    const setupNativeResume = async () => {
      if (Capacitor.isNativePlatform()) {
        try {
          nativeListener = await CapacitorApp.addListener('appStateChange', ({ isActive }) => {
            if (isActive) {
              checkSession();
            }
          });
        } catch (e) {
          console.warn('[SessionWatch] App plugin listener not available:', e);
        }
      }
    };
    setupNativeResume();

    return () => {
      authSub?.subscription?.unsubscribe?.();
      teardown();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('hashchange', checkSession);
      clearInterval(periodicTimer);
      if (nativeListener) {
        nativeListener.remove();
      }
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
        <Route path="/reset-password" element={<ResetPasswordPage />} />
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
        <Route path="/admin/dashboard" element={<AdminGuard><AdminDashboardPage /></AdminGuard>} />
        <Route path="/admin/drivers" element={<AdminGuard><AdminDriversPage /></AdminGuard>} />
        <Route path="/admin/users" element={<AdminGuard><AdminUsersPage /></AdminGuard>} />
        <Route path="/admin/pricing" element={<AdminGuard><AdminPricingPage /></AdminGuard>} />
        <Route path="/admin/promos" element={<AdminGuard><AdminPromoCodesPage /></AdminGuard>} />
        <Route path="/admin/disputes" element={<AdminGuard><AdminDisputesPage /></AdminGuard>} />
        <Route path="/admin/analytics" element={<AdminGuard><AdminAnalyticsPage /></AdminGuard>} />
        <Route path="/admin/zones" element={<AdminGuard><AdminZonesPage /></AdminGuard>} />
        <Route path="/admin/fraud" element={<AdminGuard><AdminFraudPage /></AdminGuard>} />
        <Route path="/admin/deliveries" element={<AdminGuard><AdminDeliveriesPage /></AdminGuard>} />
        <Route path="/admin/shop" element={<AdminGuard><AdminShopPage /></AdminGuard>} />
        <Route path="/admin/support" element={<AdminGuard><AdminSupportPage /></AdminGuard>} />
        <Route path="/admin/support/stats" element={<AdminGuard><AdminSupportStatsPage /></AdminGuard>} />
        <Route path="/join" element={<DriverLandingPage />} />

        {/* Módulo Higo Shop */}
        <Route path="/shop" element={<GoogleMapsProvider><ShopAppShell /></GoogleMapsProvider>}>
          <Route index element={<ShopHomeSelector />} />
          <Route path="search" element={<ShopSearchMap />} />
          <Route path="store/:storeId" element={<ShopStoreView />} />
          <Route path="cart" element={<ShopCartPage />} />
          <Route path="checkout/:storeId" element={<ShopCheckoutPage />} />
          <Route path="orders" element={<ShopOrdersPage />} />
          <Route path="orders/:orderId" element={<ShopOrderDetailPage />} />
          <Route path="profile" element={<ShopProfilePage />} />
        </Route>

        <Route path="/terms" element={<TermsOfDeliveryPage />} />
        <Route path="/terms/envios" element={<TermsOfDeliveryPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/track/:token" element={<PublicTrackingPage />} />
        <Route path="/delivery/:rideId/receipt" element={<DeliveryReceiptPage />} />
        {import.meta.env.DEV && (
          <Route path="/sandbox-mapbox" element={<MapboxSandbox />} />
        )}
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