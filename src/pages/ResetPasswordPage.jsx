// ResetPasswordPage.jsx — H3.3 del Anexo B (Hardening de Producción).
//
// Página a la que aterriza el user después de clickear el link del email
// de reset password. Supabase emite un evento PASSWORD_RECOVERY via
// onAuthStateChange que la página escucha; sin ese evento, el form no
// permite guardar (el link sería inválido o expirado).
//
// DECISIÓN ARQUITECTÓNICA H3.3: el guard de espera se subió de 3 a 7
// segundos para evitar falsos positivos en Capacitor sobre dispositivos
// Android/iOS de gama baja (el WebView tarda más en procesar el deep
// link + emitir el evento). 7s es suficientemente generoso sin frustrar
// al user que sí llegó por un link válido.
//
// Configuración previa requerida en Supabase dashboard (H3.1):
//   - Auth → Email templates → Reset Password → URL apunta a:
//     https://higoapp.com/#/reset-password
//   - Auth → URL configuration → agregar al redirect allowlist:
//     https://higoapp.com/#/reset-password
//     capacitor://localhost/#/reset-password
//
// Documentado en docs/OPERATIONS.md.

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabase';

// H3.3 — 7 segundos en lugar de 3 para dar margen a WebView de gama baja.
const PASSWORD_RECOVERY_GUARD_MS = 7000;

const ResetPasswordPage = () => {
    const navigate = useNavigate();
    const [status, setStatus] = useState('waiting'); // waiting | ready | invalid | saving | done
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [message, setMessage] = useState('');

    // Capturar el evento PASSWORD_RECOVERY. Supabase lo emite tras
    // procesar el access_token del hash de la URL del email.
    useEffect(() => {
        let resolvedReady = false;

        const { data: authSub } = supabase.auth.onAuthStateChange((event) => {
            if (event === 'PASSWORD_RECOVERY') {
                resolvedReady = true;
                setStatus('ready');
            }
        });

        // Si en GUARD_MS no llegó el evento, el link es inválido/expirado.
        // 7s cubre WebView lento de Capacitor en gama baja.
        const guardTimer = setTimeout(() => {
            if (!resolvedReady) {
                setStatus('invalid');
            }
        }, PASSWORD_RECOVERY_GUARD_MS);

        return () => {
            clearTimeout(guardTimer);
            authSub?.subscription?.unsubscribe?.();
        };
    }, []);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setMessage('');

        if (password.length < 8) {
            setMessage('La clave debe tener al menos 8 caracteres.');
            return;
        }
        if (password !== confirm) {
            setMessage('Las claves no coinciden. Revisalas.');
            return;
        }

        setStatus('saving');
        try {
            const { error } = await supabase.auth.updateUser({ password });
            if (error) throw error;
            setStatus('done');
            // Redirect a / después de 1.5s para que el user vea la confirmación.
            setTimeout(() => navigate('/', { replace: true }), 1500);
        } catch (err) {
            setStatus('ready'); // permitir reintento
            setMessage(`No se pudo actualizar la clave: ${err.message || 'error desconocido'}`);
        }
    };

    return (
        <div className="min-h-screen bg-[#0a101f] text-white flex items-center justify-center p-4">
            <div className="w-full max-w-md bg-[#1A1F2E] rounded-3xl border border-white/5 p-8 shadow-2xl">
                {/* Logo */}
                <div className="flex justify-center mb-6">
                    <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-600 to-blue-400 flex items-center justify-center shadow-lg shadow-blue-600/30">
                        <span className="material-symbols-outlined text-white text-3xl">lock_reset</span>
                    </div>
                </div>

                <h1 className="text-2xl font-extrabold text-center mb-2">
                    Restablecer clave
                </h1>

                {status === 'waiting' && (
                    <div className="text-center py-8">
                        <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                        <p className="text-gray-400 text-sm">Verificando enlace…</p>
                        <p className="text-gray-500 text-xs mt-2">
                            Si tarda mucho, puede ser tu conexión.
                        </p>
                    </div>
                )}

                {status === 'invalid' && (
                    <div className="text-center py-6">
                        <div className="w-14 h-14 rounded-full bg-red-500/15 border border-red-500/30 flex items-center justify-center mx-auto mb-4">
                            <span className="material-symbols-outlined text-red-400 text-2xl">link_off</span>
                        </div>
                        <p className="text-white font-bold mb-2">Enlace inválido o expirado</p>
                        <p className="text-gray-400 text-sm mb-6 leading-relaxed">
                            Este enlace ya no es válido. Pedí uno nuevo desde la pantalla de inicio de sesión.
                        </p>
                        <button
                            onClick={() => navigate('/auth')}
                            className="w-full py-3 rounded-full bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm"
                        >
                            Volver al login
                        </button>
                    </div>
                )}

                {(status === 'ready' || status === 'saving') && (
                    <>
                        <p className="text-gray-400 text-sm text-center mb-6">
                            Ingresá tu clave nueva (mínimo 8 caracteres).
                        </p>
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div>
                                <label htmlFor="newPwd" className="block text-xs font-bold text-gray-400 uppercase mb-2">
                                    Nueva clave
                                </label>
                                <input
                                    id="newPwd"
                                    type="password"
                                    autoComplete="new-password"
                                    required
                                    minLength={8}
                                    placeholder="Mínimo 8 caracteres"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    className="w-full bg-[#0a101f] border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-blue-500"
                                />
                            </div>
                            <div>
                                <label htmlFor="confirmPwd" className="block text-xs font-bold text-gray-400 uppercase mb-2">
                                    Confirmar clave
                                </label>
                                <input
                                    id="confirmPwd"
                                    type="password"
                                    autoComplete="new-password"
                                    required
                                    minLength={8}
                                    placeholder="Repetí tu clave"
                                    value={confirm}
                                    onChange={(e) => setConfirm(e.target.value)}
                                    className="w-full bg-[#0a101f] border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-blue-500"
                                />
                            </div>

                            {message && (
                                <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-sm p-3 rounded-xl">
                                    {message}
                                </div>
                            )}

                            <button
                                type="submit"
                                disabled={status === 'saving' || password.length < 8 || password !== confirm}
                                className="w-full py-3 rounded-full bg-blue-600 hover:bg-blue-700 text-white font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {status === 'saving' ? 'Guardando…' : 'Guardar nueva clave'}
                            </button>
                        </form>
                    </>
                )}

                {status === 'done' && (
                    <div className="text-center py-6">
                        <div className="w-14 h-14 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center mx-auto mb-4">
                            <span className="material-symbols-outlined text-emerald-400 text-2xl">check_circle</span>
                        </div>
                        <p className="text-white font-bold mb-2">¡Listo!</p>
                        <p className="text-gray-400 text-sm">
                            Tu clave fue actualizada. Te llevamos al inicio…
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ResetPasswordPage;
