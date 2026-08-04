import React, { useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter, Route, Routes, useLocation } from 'react-router-dom';
import AdminGuard from './components/AdminGuard';
import ErrorBoundary from './components/ErrorBoundary';
import AdminRidesPage from './pages/AdminRidesPage';
import { ToastProvider } from './components/Toast';
import './index.css';
import 'material-symbols/outlined.css';

function ReloadMainApplication() {
    const location = useLocation();
    useEffect(() => {
        window.location.reload();
    }, [location.pathname]);
    return (
        <div className="min-h-screen bg-[#0F1014] text-gray-400 flex items-center justify-center">
            Cargando panel administrativo…
        </div>
    );
}

ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <ErrorBoundary source="admin-rides-root">
            <ToastProvider>
                <HashRouter>
                    <Routes>
                        <Route
                            path="/admin/rides"
                            element={<AdminGuard><AdminRidesPage /></AdminGuard>}
                        />
                        <Route path="*" element={<ReloadMainApplication />} />
                    </Routes>
                </HashRouter>
            </ToastProvider>
        </ErrorBoundary>
    </React.StrictMode>,
);
