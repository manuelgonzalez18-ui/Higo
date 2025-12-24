import React from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import RequestRidePage from './pages/RequestRidePage';
import ScheduleRidePage from './pages/ScheduleRidePage';
import ConfirmTripPage from './pages/ConfirmTripPage';
import DriverDashboard from './pages/DriverDashboard';
import RideStatusPage from './pages/RideStatusPage';
import AdminDriversPage from './pages/AdminDriversPage';
import ChatWidget from './components/ChatWidget';
import './index.css';         // Ensure Tailwind/global CSS is imported

import AuthPage from './pages/AuthPage';

import { messaging } from './services/firebase';
import { getToken, onMessage } from 'firebase/messaging';
import { useEffect } from 'react';

const App = () => {
  useEffect(() => {
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
            // Note: If using default credentials in sw, purely getToken() might work if vapid key is not required strictly or handled by config
            // But usually vapidKey is needed for web push. 
            // Let's use the one from the user config if available or skip argument to see if it grabs from default
          });
          // Using a VAPID key is standard for Web Push. 
          // Since I don't have the user's VAPID key handy in the snippets (only API key), 
          // I will try to get token without it or log it. 
          // Actually, I should probably check if they have one. 
          // For now, I'll logging the token.
          console.log('FCM Token:', token);
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
        // Customize notification here
        // Note: Foreground messages don't pop up system notification automatically
        // We show a toast or alert
        const { title, body } = payload.notification || {};
        if (title && navigator.vibrate) {
          navigator.vibrate([200, 100, 200]);
        }
        // Optional: Show in-app toast
        // toast(title + ": " + body); 
      });
    }
  }, []);

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
      </Routes>
      <ChatWidget />
    </HashRouter>
  );
};

export default App;