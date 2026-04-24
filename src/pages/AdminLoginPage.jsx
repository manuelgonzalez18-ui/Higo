import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, getUserProfile } from '../services/supabase';

// Login dedicado para el portal administrativo. Reusa supabase.auth pero
// restringe el acceso a cuentas con role='admin' en la tabla profiles.
// Si un usuario con otro role intenta entrar, se cierra la sesión y se muestra
// un mensaje en vez de redirigirlo al portal de pasajero.
const AdminLoginPage = () => {
    const navigate = useNavigate();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [checking, setChecking] = useState(true);
    const [message, setMessage] = useState('');

    // Si ya hay una sesión admin abierta, saltar directo al dashboard.
    useEffect(() => {
        (async () => {
            const profile = await getUserProfile();
            if (profile?.role === 'admin') {
                navigate('/admin/dashboard', { replace: true });
                return;
            }
            setChecking(false);
        })();
    }, [navigate]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setMessage('');

        try {
            const { data: { user }, error } = await supabase.auth.signInWithPassword({ email, password });
            if (error) throw error;

            const { data: profile } = await supabase
                .from('profiles')
                .select('role')
                .eq('id', user.id)
                .single();

            if (profile?.role !== 'admin') {
                await supabase.auth.signOut();
                setMessage('Esta cuenta no tiene permisos de administrador.');
                setLoading(false);
                return;
            }

            // Enforce single session, igual que el AuthPage público.
            const newSessionId = self.crypto.randomUUID();
            await supabase
                .from('profiles')
                .update({ current_session_id: newSessionId })
                .eq('id', user.id);
            localStorage.setItem('session_id', newSessionId);

            navigate('/admin/dashboard', { replace: true });
        } catch (err) {
            setMessage(err.message || 'Error al iniciar sesión.');
            setLoading(false);
        }
    };

    if (checking) {
        return (
            <div className="min-h-screen bg-[#0F1419] flex items-center justify-center text-gray-400 text-sm">
                Cargando...
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#0F1419] flex items-center justify-center px-4 py-12">
            <div className="w-full max-w-md">
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-violet-600/20 border border-violet-600/30 mb-4">
                        <span className="material-symbols-outlined text-violet-400 text-3xl">admin_panel_settings</span>
                    </div>
                    <h1 className="text-3xl font-extrabold text-white">Panel Admin</h1>
                    <p className="text-gray-400 text-sm mt-2">Acceso restringido al personal autorizado</p>
                </div>

                <form onSubmit={handleSubmit} className="bg-[#1A1F2E] rounded-2xl border border-white/5 p-6 space-y-4">
                    <div>
                        <label htmlFor="admin-email" className="block text-sm font-medium text-gray-300 mb-1">
                            Correo electrónico
                        </label>
                        <input
                            id="admin-email"
                            type="email"
                            autoComplete="email"
                            required
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="w-full px-3 py-2.5 bg-[#0F1419] border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-violet-500"
                        />
                    </div>

                    <div>
                        <label htmlFor="admin-password" className="block text-sm font-medium text-gray-300 mb-1">
                            Contraseña
                        </label>
                        <input
                            id="admin-password"
                            type="password"
                            autoComplete="current-password"
                            required
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="w-full px-3 py-2.5 bg-[#0F1419] border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-violet-500"
                        />
                    </div>

                    {message && (
                        <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                            {message}
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full py-2.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white font-bold rounded-lg transition-colors"
                    >
                        {loading ? 'Verificando...' : 'Iniciar Sesión'}
                    </button>
                </form>

                <p className="text-center text-xs text-gray-500 mt-6">
                    ¿No eres admin?{' '}
                    <a href="#/auth" className="text-violet-400 hover:text-violet-300">Ir al portal público</a>
                </p>
            </div>
        </div>
    );
};

export default AdminLoginPage;
