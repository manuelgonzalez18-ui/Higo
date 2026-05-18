
import React, { useState } from 'react';
import { supabase } from '../services/supabase';
import { useNavigate } from 'react-router-dom';

// pending_referral_code: lo guardamos al signup cuando el user todavía
// no está autenticado (espera verificación por email). Antes vivía en
// localStorage para siempre — si el user nunca completaba o se anotaba
// en otro device, el código quedaba huérfano y se aplicaba a la primera
// sesión válida que viniera, semanas o meses después. Ahora va con TTL
// de 24h + validación de formato (UPPERCASE, alfanumérico, max 32 chars).
const PENDING_REF_TTL_MS = 24 * 60 * 60 * 1000;

const writePendingReferral = (code) => {
    if (!/^[A-Z0-9_-]{1,32}$/.test(code)) return; // formato inválido → no guarda.
    try {
        localStorage.setItem('pending_referral_code', JSON.stringify({
            code,
            exp: Date.now() + PENDING_REF_TTL_MS,
        }));
    } catch { /* QuotaExceeded / SecurityError: ignorar */ }
};

const readPendingReferral = () => {
    try {
        const raw = localStorage.getItem('pending_referral_code');
        if (!raw) return null;
        // Compat con format viejo (string plano sin wrapper).
        if (raw[0] !== '{') {
            localStorage.removeItem('pending_referral_code');
            return /^[A-Z0-9_-]{1,32}$/.test(raw) ? raw : null;
        }
        const parsed = JSON.parse(raw);
        if (!parsed?.code || !parsed?.exp || Date.now() > parsed.exp) {
            localStorage.removeItem('pending_referral_code');
            return null;
        }
        return /^[A-Z0-9_-]{1,32}$/.test(parsed.code) ? parsed.code : null;
    } catch {
        localStorage.removeItem('pending_referral_code');
        return null;
    }
};

const AuthPage = () => {
    const [loading, setLoading] = useState(false);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [referralCode, setReferralCode] = useState('');
    const [isLogin, setIsLogin] = useState(true);
    const [message, setMessage] = useState('');
    const navigate = useNavigate();

    const handleAuth = async (e) => {
        e.preventDefault();
        setLoading(true);
        setMessage('');

        try {
            if (isLogin) {
                // Login
                const { data: { user }, error } = await supabase.auth.signInWithPassword({
                    email,
                    password,
                });
                if (error) throw error;


                // Check Role & Enforce Single Session
                const { data: profile } = await supabase
                    .from('profiles')
                    .select('role')
                    .eq('id', user.id)
                    .single();

                // Enforce Single Session for all roles
                const newSessionId = self.crypto.randomUUID();
                await supabase
                    .from('profiles')
                    .update({ current_session_id: newSessionId })
                    .eq('id', user.id);

                localStorage.setItem('session_id', newSessionId);

                // Si quedó un referral pendiente del signup, registrarlo ahora.
                // El código viene wrapeado con TTL — si pasó más de 24h se
                // descarta limpio (caso: usuario abandona, vuelve semanas
                // después por otro motivo, no debería arrastrar un referral
                // viejo de cuando se anotó).
                const pendingRef = readPendingReferral();
                if (pendingRef) {
                    await supabase.rpc('register_referral', {
                        p_code: pendingRef,
                        p_referred_id: user.id
                    });
                    localStorage.removeItem('pending_referral_code');
                }

                if (profile?.role === 'driver') {
                    navigate('/driver');
                } else {
                    navigate('/'); // Default to passenger
                }
            } else {
                // Register
                const { data: { user }, error } = await supabase.auth.signUp({
                    email,
                    password,
                });
                if (error) throw error;
                // Si el usuario quedó autenticado y entró un código de referido,
                // lo registramos. Si requiere verificación por email, user puede
                // ser null; en ese caso lo guardamos con TTL de 24h para
                // procesarlo en el primer login válido.
                if (referralCode.trim()) {
                    if (user?.id) {
                        await supabase.rpc('register_referral', {
                            p_code: referralCode.trim().toUpperCase(),
                            p_referred_id: user.id
                        });
                    } else {
                        writePendingReferral(referralCode.trim().toUpperCase());
                    }
                }
                setMessage('¡Registro exitoso! Por favor verifica tu correo electrónico.');
            }
        } catch (error) {
            setMessage(error.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-[#152323] flex flex-col justify-center py-12 sm:px-6 lg:px-8">
            <div className="sm:mx-auto sm:w-full sm:max-w-md">
                <div className="flex justify-center text-blue-600">
                    <span className="material-symbols-outlined text-5xl">local_taxi</span>
                </div>
                <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900 dark:text-white">
                    {isLogin ? 'Inicia sesión en tu cuenta' : 'Crea una nueva cuenta'}
                </h2>
            </div>

            <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
                <div className="bg-white dark:bg-[#1a2c2c] py-8 px-4 shadow sm:rounded-lg sm:px-10 border border-gray-200 dark:border-gray-700">
                    <form className="space-y-6" onSubmit={handleAuth}>
                        <div>
                            <label htmlFor="email" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                                Correo electrónico
                            </label>
                            <div className="mt-1">
                                <input
                                    id="email"
                                    name="email"
                                    type="email"
                                    autoComplete="email"
                                    required
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    className="appearance-none block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm bg-white dark:bg-[#233535] text-gray-900 dark:text-white"
                                />
                            </div>
                        </div>

                        <div>
                            <label htmlFor="password" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                                Contraseña
                            </label>
                            <div className="mt-1">
                                <input
                                    id="password"
                                    name="password"
                                    type="password"
                                    autoComplete="current-password"
                                    required
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    className="appearance-none block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm bg-white dark:bg-[#233535] text-gray-900 dark:text-white"
                                />
                            </div>
                        </div>

                        {!isLogin && (
                            <div>
                                <label htmlFor="referral" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                                    Código de referido <span className="text-gray-400 font-normal">(opcional)</span>
                                </label>
                                <div className="mt-1">
                                    <input
                                        id="referral"
                                        type="text"
                                        value={referralCode}
                                        onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
                                        placeholder="Ej: ABC123"
                                        className="appearance-none block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm bg-white dark:bg-[#233535] text-gray-900 dark:text-white uppercase"
                                    />
                                </div>
                                <p className="text-xs text-gray-500 mt-1">Si alguien te invitó, ambos reciben $1 al primer viaje.</p>
                            </div>
                        )}

                        {message && (
                            <div className={`text-sm ${message.includes('success') ? 'text-green-600' : 'text-red-600'}`}>
                                {message}
                            </div>
                        )}

                        <div>
                            <button
                                type="submit"
                                disabled={loading}
                                className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
                            >
                                {loading ? 'Procesando...' : (isLogin ? 'Iniciar Sesión' : 'Registrarse')}
                            </button>
                        </div>
                    </form>

                    <div className="mt-6">
                        <div className="relative">
                            <div className="absolute inset-0 flex items-center">
                                <div className="w-full border-t border-gray-300 dark:border-gray-600" />
                            </div>
                            <div className="relative flex justify-center text-sm">
                                <span className="px-2 bg-white dark:bg-[#1a2c2c] text-gray-500">
                                    O
                                </span>
                            </div>
                        </div>

                        <div className="mt-6">
                            <button
                                onClick={() => setIsLogin(!isLogin)}
                                className="w-full flex justify-center py-2 px-4 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-[#233535] hover:bg-gray-50 dark:hover:bg-[#152323]"
                            >
                                {isLogin ? 'Crear nueva cuenta' : 'Iniciar sesión en cuenta existente'}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AuthPage;
