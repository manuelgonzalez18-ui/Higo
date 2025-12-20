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

const App = () => {
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