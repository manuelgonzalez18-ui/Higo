import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, getUserProfile, withNetworkRetry } from '../services/supabase';
import { getAdminContext } from '../services/adminApi';

export default function AdminLoginPage() {
    const navigate = useNavigate();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [code, setCode] = useState('');
    const [loading, setLoading] = useState(false);
    const [checking, setChecking] = useState(true);
    const [message, setMessage] = useState('');
    const [step, setStep] = useState('password');
    const [factorId, setFactorId] = useState(null);
    const [qrCode, setQrCode] = useState(null);

    const persistAdminSession = async (userId) => {
        const newSessionId = self.crypto.randomUUID();
        localStorage.setItem('session_id', newSessionId);
        localStorage.setItem('login_grace_until', String(Date.now() + 20000));
        try {
            await withNetworkRetry(() => supabase.from('profiles').update({ current_session_id: newSessionId }).eq('id', userId));
        } catch (err) {
            console.warn('[AdminLogin] session reconciliation deferred:', err);
        }
    };

    const prepareMfa = async () => {
        const context = await getAdminContext();
        if (!context?.authorized) throw new Error('Esta cuenta no tiene permisos administrativos.');
        if (!context.require_mfa || context.aal === 'aal2') return { ready: true, context };

        const { data: factorsData, error: factorsError } = await supabase.auth.mfa.listFactors();
        if (factorsError) throw factorsError;
        const verified = factorsData?.totp?.find(f => f.status === 'verified');
        if (verified) {
            setFactorId(verified.id);
            setQrCode(null);
            setStep('mfa');
            return { ready: false, context };
        }

        const { data: enrolled, error: enrollError } = await supabase.auth.mfa.enroll({
            factorType: 'totp',
            friendlyName: 'Higo Admin',
        });
        if (enrollError) throw enrollError;
        setFactorId(enrolled.id);
        setQrCode(enrolled.totp?.qr_code || null);
        setStep('enroll');
        return { ready: false, context };
    };

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const profile = await getUserProfile();
                if (!profile || profile.role !== 'admin') return;
                const result = await prepareMfa();
                if (!cancelled && result.ready) navigate('/admin/dashboard', { replace: true });
            } catch {
                // La pantalla de login sigue disponible.
            } finally {
                if (!cancelled) setChecking(false);
            }
        })();
        return () => { cancelled = true; };
    }, [navigate]); // eslint-disable-line react-hooks/exhaustive-deps

    const handlePassword = async (event) => {
        event.preventDefault();
        setLoading(true); setMessage('');
        try {
            const { data: { user }, error } = await supabase.auth.signInWithPassword({ email, password });
            if (error) throw error;
            const { data: profile, error: profileError } = await supabase.from('profiles').select('role').eq('id', user.id).single();
            if (profileError) throw profileError;
            if (profile?.role !== 'admin') {
                await supabase.auth.signOut();
                throw new Error('Esta cuenta no tiene permisos de administrador.');
            }
            await persistAdminSession(user.id);
            const result = await prepareMfa();
            if (result.ready) navigate('/admin/dashboard', { replace: true });
        } catch (err) {
            setMessage(err.message || 'No se pudo iniciar sesión.');
        } finally { setLoading(false); }
    };

    const verifyMfa = async (event) => {
        event.preventDefault();
        if (!factorId || code.trim().length < 6) return;
        setLoading(true); setMessage('');
        try {
            const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
            if (challengeError) throw challengeError;
            const { error: verifyError } = await supabase.auth.mfa.verify({ factorId, challengeId: challenge.id, code: code.trim() });
            if (verifyError) throw verifyError;
            const context = await getAdminContext();
            if (context.aal !== 'aal2') throw new Error('No se pudo elevar la sesión a MFA.');
            navigate('/admin/dashboard', { replace: true });
        } catch (err) {
            setMessage(err.message || 'Código incorrecto.');
        } finally { setLoading(false); }
    };

    if (checking) return <div className="min-h-screen bg-[#0F1419] flex items-center justify-center text-gray-400">Verificando sesión…</div>;

    return (
        <div className="min-h-screen bg-[#0F1419] flex items-center justify-center px-4 py-12 text-white">
            <div className="w-full max-w-md">
                <div className="text-center mb-8">
                    <div className="inline-flex w-16 h-16 rounded-2xl bg-violet-600/20 border border-violet-600/30 items-center justify-center mb-4"><span className="material-symbols-outlined text-violet-400 text-3xl">admin_panel_settings</span></div>
                    <h1 className="text-3xl font-black">Higo Admin</h1>
                    <p className="text-gray-400 text-sm mt-2">Acceso restringido y auditable</p>
                </div>

                {step === 'password' ? (
                    <form onSubmit={handlePassword} className="bg-[#1A1F2E] rounded-2xl border border-white/5 p-6 space-y-4">
                        <div><label className="block text-sm text-gray-300 mb-1">Correo</label><input type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} className="w-full px-3 py-3 bg-[#0F1419] border border-white/10 rounded-xl focus:border-violet-500 outline-none" /></div>
                        <div><label className="block text-sm text-gray-300 mb-1">Contraseña</label><input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} className="w-full px-3 py-3 bg-[#0F1419] border border-white/10 rounded-xl focus:border-violet-500 outline-none" /></div>
                        {message && <div className="text-sm text-red-300 bg-red-500/10 border border-red-500/20 rounded-xl p-3">{message}</div>}
                        <button disabled={loading} className="w-full py-3 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 font-bold rounded-xl">{loading ? 'Verificando…' : 'Iniciar sesión'}</button>
                    </form>
                ) : (
                    <form onSubmit={verifyMfa} className="bg-[#1A1F2E] rounded-2xl border border-white/5 p-6 space-y-4">
                        <div className="text-center">
                            <span className="material-symbols-outlined text-4xl text-amber-300">security</span>
                            <h2 className="text-xl font-black mt-2">{step === 'enroll' ? 'Configurar autenticador' : 'Código de verificación'}</h2>
                            <p className="text-sm text-gray-400 mt-2">{step === 'enroll' ? 'Escaneá el QR con Google Authenticator, Authy o una aplicación compatible y escribí el código.' : 'Ingresá el código de seis dígitos de tu autenticador.'}</p>
                        </div>
                        {qrCode && <div className="bg-white rounded-2xl p-4 flex justify-center"><img src={qrCode} alt="QR para configurar MFA" className="w-48 h-48" /></div>}
                        <input inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} placeholder="000000" className="w-full text-center tracking-[0.45em] text-2xl font-mono px-3 py-4 bg-[#0F1419] border border-white/10 rounded-xl focus:border-violet-500 outline-none" />
                        {message && <div className="text-sm text-red-300 bg-red-500/10 border border-red-500/20 rounded-xl p-3">{message}</div>}
                        <button disabled={loading || code.length < 6} className="w-full py-3 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 font-bold rounded-xl">{loading ? 'Verificando…' : 'Confirmar código'}</button>
                        <button type="button" onClick={() => supabase.auth.signOut().then(() => { setStep('password'); setCode(''); })} className="w-full text-xs text-gray-500">Usar otra cuenta</button>
                    </form>
                )}
                <p className="text-center text-xs text-gray-500 mt-6"><a href="#/auth" className="text-violet-400">Volver al portal público</a></p>
            </div>
        </div>
    );
}
