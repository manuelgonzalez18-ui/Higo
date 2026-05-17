import React, { Suspense, lazy } from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
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
const AdminSupportPage        = lazy(() => import('./pages/AdminSupportPage'));
const AdminSupportStatsPage   = lazy(() => import('./pages/AdminSupportStatsPage'));
const DriverLandingPage       = lazy(() => import('./pages/DriverLandingPage'));
const HigoPayPage             = lazy(() => import('./pages/HigoPayPage'));
const AuthPage                = lazy(() => import('./pages/AuthPage'));

import { useEffect, useState } from 'react';
import { initGlobalAudio } from './services/notificationService';
import { ensureFcmRegistration, subscribeForegroundMessages } from './services/pushNotifications';
import DriverRequestCard from './components/DriverRequestCard';
import { supabase } from './services/supabase';
import { useGeolocation } from './hooks/useGeolocation';
import LocationDisclosure from './components/LocationDisclosure';

const App = () => {
  const { showDisclosure, handleAcceptDisclosure } = useGeolocation();
  const [incomingRequest, setIncomingRequest] = useState(null);

  // --- GLOBAL SESSION LOCKING ---
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
            alert("⚠️ Tu cuenta se ha abierto en otro dispositivo. Se cerrará la sesión en este equipo.");
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
    <HashRouter>
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
        <Route path="/higo-pay" element={<HigoPayPage />} />
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
  );
};

export default App;