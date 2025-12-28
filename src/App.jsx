import React from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import RequestRidePage from './pages/RequestRidePage';
import ScheduleRidePage from './pages/ScheduleRidePage';
import ConfirmTripPage from './pages/ConfirmTripPage';
import DriverDashboard from './pages/DriverDashboard';
import RideStatusPage from './pages/RideStatusPage';
import AdminDriversPage from './pages/AdminDriversPage';
import DriverLandingPage from './pages/DriverLandingPage';
import ChatWidget from './components/ChatWidget';
import './index.css';         // Ensure Tailwind/global CSS is imported

import AuthPage from './pages/AuthPage';

import { messaging } from './services/firebase';
import { getToken, onMessage } from 'firebase/messaging';
import { useEffect, useState } from 'react';
import { initGlobalAudio } from './services/notificationService';
import DriverRequestCard from './components/DriverRequestCard';

const App = () => {
  const [incomingRequest, setIncomingRequest] = useState(null);

  useEffect(() => {
    initGlobalAudio(); // Unlock audio context on first interaction

    const setupMessaging = async () => {
      if (!messaging) return;

      try {
        // Request permission
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
          console.log('Notification permission granted.');

          // Get Token
          const token = await getToken(messaging, {
            vapidKey: 'BMQJ_...YOUR_VAPID_KEY_IF_NEEDED_OR_USE_DEFAULT_FROM_CONFIG...'
          });
          console.log('FCM Token:', token);
          alert('FCM Token Copiar: ' + token); // Temporary for debugging
        } else {
          console.log('Unable to get permission to notify.');
        }
      } catch (error) {
        console.log('Error setting up messaging:', error);
      }
    };

    setupMessaging();

    // Foreground message handler
    if (messaging) {
      onMessage(messaging, (payload) => {
        console.log('Message received. ', payload);

        // Check if the message is a ride request
        // This logic assumes the payload contains specific data fields
        // Adapt as needed based on your backend payload structure
        const { title, body } = payload.notification || {};
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

          // Vibrate pattern for urgency
          if (navigator.vibrate) {
            navigator.vibrate([500, 200, 500, 200, 500]);
          }
        } else {
          // Standard notification for other messages
          if (title && navigator.vibrate) {
            navigator.vibrate([200, 100, 200]);
          }
        }
      });
    }
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
        <Route path="/" element={<RequestRidePage />} />
        <Route path="/auth" element={<AuthPage />} />
        <Route path="/schedule" element={<ScheduleRidePage />} />
        <Route path="/confirm" element={<ConfirmTripPage />} />
        <Route path="/driver" element={<DriverDashboard />} />
        <Route path="/ride/:id" element={<RideStatusPage />} />
        <Route path="/admin/drivers" element={<AdminDriversPage />} />
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

      {/* Temporary Debug Button - Remove before production */}
      <button
        onClick={() => {
          // Test Native Overlay
          try { OverlayPlugin.show(); } catch (e) { console.error(e); }

          setIncomingRequest({
            price: '1.5',
            distance: '1.9 km',
            duration: '15 min',
            pickupLocation: 'Ubicación Actual',
            pickupAddress: 'Downtown District',
            dropoffLocation: 'Centro Comercial Flamingo',
            dropoffAddress: 'Entrada Principal',
          });
        }}
        className="fixed bottom-4 left-4 z-[60] bg-red-600 text-white px-3 py-2 text-xs font-bold rounded shadow-lg opacity-80 hover:opacity-100"
      >
        TEST REQUEST
      </button>
    </HashRouter>
  );
};

export default App;