import React from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import RequestRidePage from './pages/RequestRidePage';
import ScheduleRidePage from './pages/ScheduleRidePage';
import ConfirmTripPage from './pages/ConfirmTripPage';
import DriverDashboard from './pages/DriverDashboard';
import DriverStatsPage from './pages/DriverStatsPage';
import RideStatusPage from './pages/RideStatusPage';
import AdminDriversPage from './pages/AdminDriversPage';
import AdminUsersPage from './pages/AdminUsersPage';
import AdminPricingPage from './pages/AdminPricingPage';
import AdminPromoCodesPage from './pages/AdminPromoCodesPage';
import AdminDisputesPage from './pages/AdminDisputesPage';
import AdminLoginPage from './pages/AdminLoginPage';
import AdminDashboardPage from './pages/AdminDashboardPage';
import AdminGuard from './components/AdminGuard';
import DriverLandingPage from './pages/DriverLandingPage';
import HigoPayPage from './pages/HigoPayPage';
import ChatWidget from './components/ChatWidget';
import './index.css';         // Ensure Tailwind/global CSS is imported

import AuthPage from './pages/AuthPage';

import { useEffect, useState } from 'react';
import { initGlobalAudio } from './services/notificationService';
import { ensureFcmRegistration, subscribeForegroundMessages } from './services/pushNotifications';
import DriverRequestCard from './components/DriverRequestCard';
import { supabase } from './services/supabase';

const App = () => {
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
    console.log('Request accepted:', incomingRequest);
    setIncomingRequest(null);
    // Navigate to driver map or specific logic here
  };

  const handleDeclineRequest = () => {
    console.log('Request declined');
    setIncomingRequest(null);
  };

  return (
    <HashRouter>
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
        <Route path="/join" element={<DriverLandingPage />} />
      </Routes>
      <ChatWidget />

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