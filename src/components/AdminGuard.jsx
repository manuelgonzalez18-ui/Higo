import React from 'react';
import { useRequireRole } from '../hooks/useRequireRole';

// Verifica que el usuario esté autenticado y tenga role='admin'. Si
// no, redirige a /admin (login). Defensa en profundidad: aunque las
// admin pages siguen teniendo su propio check inline, el guard impide
// ver el flash de contenido antes de que esa verificación corra.
//
// Delega a useRequireRole (Fase 12 C3) que es el hook centralizado
// del patrón "fetch profile + check role + redirect". Refactor
// gradual: las admin pages migran a useRequireAdmin() también cuando
// se las toque por otro motivo.
const AdminGuard = ({ children }) => {
    const { loading, authorized } = useRequireRole('admin', { fallbackPath: '/admin' });

    if (loading || !authorized) {
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
