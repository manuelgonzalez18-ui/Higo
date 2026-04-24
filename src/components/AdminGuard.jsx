import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getUserProfile } from '../services/supabase';

// Verifica que el usuario esté autenticado y tenga role='admin'. Si no, redirige
// a /admin (login). Reemplaza el bloque checkAuth duplicado en cada AdminPage:
// aunque esas páginas siguen teniendo su propio check como defensa en profundidad,
// el guard impide ver el flash de contenido antes de que esa verificación corra.
const AdminGuard = ({ children }) => {
    const navigate = useNavigate();
    const [state, setState] = useState('checking');

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const profile = await getUserProfile();
            if (cancelled) return;
            if (!profile || profile.role !== 'admin') {
                navigate('/admin', { replace: true });
                return;
            }
            setState('ok');
        })();
        return () => { cancelled = true; };
    }, [navigate]);

    if (state !== 'ok') {
        return (
            <div className="min-h-screen bg-[#0F1419] flex items-center justify-center text-gray-400">
                <div className="flex items-center gap-3">
                    <div className="w-5 h-5 border-2 border-violet-500 border-t-transparent rounded-full animate-spin"></div>
                    <span className="text-sm">Verificando acceso...</span>
                </div>
            </div>
        );
    }
    return children;
};

export default AdminGuard;
