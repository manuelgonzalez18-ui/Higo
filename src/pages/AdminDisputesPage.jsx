import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, getUserProfile } from '../services/supabase';
import AdminNav from '../components/AdminNav';
import AdminDeliveryClaimsPanel from '../components/AdminDeliveryClaimsPanel';

// Un viaje está "en disputa" si:
//   - Alguna de las partes marcó pago (payment_reference, user o driver confirmó)
//   - Pero payment_confirmed_at sigue null (no cerró bilateralmente)
// Esto cubre los casos: pasajero dice que pagó pero driver no lo confirma,
// driver marca recibido pero el user no había pagado, etc.

const FILTERS = [
    { id: 'pending',  label: 'Pendientes',    icon: 'hourglass_empty' },
    { id: 'resolved', label: 'Resueltos',     icon: 'check_circle' },
    { id: 'all',      label: 'Todos',         icon: 'list' }
];

const AdminDisputesPage = () => {
    const navigate = useNavigate();
    const [authorized, setAuthorized] = useState(false);
    const [loading, setLoading] = useState(true);
    const [rides, setRides] = useState([]);
    const [filter, setFilter] = useState('pending');
    const [message, setMessage] = useState(null);
    const [profiles, setProfiles] = useState({});
    const [tab, setTab] = useState('payments'); // 'payments' | 'deliveries'

    useEffect(() => {
        (async () => {
            const profile = await getUserProfile();
            if (!profile || profile.role !== 'admin') {
                navigate('/');
                return;
            }
            setAuthorized(true);
            if (tab === 'payments') await fetchDisputes();
            else setLoading(false);
        })();
    }, [navigate, filter, tab]);

    const fetchDisputes = async () => {
        setLoading(true);
        let q = supabase
            .from('rides')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(100);

        if (filter === 'pending') {
            q = q.is('payment_confirmed_at', null)
                 .or('payment_reference.not.is.null,payment_confirmed_by_user.eq.true,payment_confirmed_by_driver.eq.true');
        } else if (filter === 'resolved') {
            q = q.not('payment_confirmed_at', 'is', null);
        }

        const { data, error } = await q;
        if (error) {
            setMessage({ type: 'error', text: error.message });
            setLoading(false);
            return;
        }

        setRides(data || []);

        const ids = new Set();
        (data || []).forEach(r => {
            if (r.user_id) ids.add(r.user_id);
            if (r.driver_id) ids.add(r.driver_id);
        });
        if (ids.size > 0) {
            const { data: pp } = await supabase
                .from('profiles')
                .select('id, full_name, phone')
                .in('id', Array.from(ids));
            const map = {};
            (pp || []).forEach(p => { map[p.id] = p; });
            setProfiles(map);
        }
        setLoading(false);
    };

    const forceConfirm = async (ride) => {
        if (!confirm(`¿Forzar confirmación bilateral del viaje #${ride.id} por $${ride.price}? Marca como pagado por ambas partes.`)) return;
        const { error } = await supabase.from('rides').update({
            payment_confirmed_by_user: true,
            payment_confirmed_by_driver: true,
            payment_confirmed_at: new Date().toISOString()
        }).eq('id', ride.id);

        if (error) setMessage({ type: 'error', text: error.message });
        else {
            setMessage({ type: 'success', text: `Viaje #${ride.id} marcado como pagado.` });
            fetchDisputes();
        }
    };

    // D.A4: reembolsar al pasajero acreditando saldo HigoPay.
    // No descontamos del chofer (Higo no toma comisión, el cobro fue
    // entre las partes); este crédito sale del lado de Higo y queda
    // como crédito futuro del pasajero. RPC admin_refund_ride valida
    // admin + ride + monto y crea el movement atómicamente.
    const refundPassenger = async (ride) => {
        const raw = prompt(
            `Reembolsar al pasajero del viaje #${ride.id}.\n\nEl monto entra como saldo HigoPay del pasajero (no se descuenta del chofer — Higo asume el crédito).\n\nMonto en USD (sugerido: ${Number(ride.price || 0).toFixed(2)}):`,
            Number(ride.price || 0).toFixed(2)
        );
        if (!raw) return;
        const amount = Number(raw);
        if (!Number.isFinite(amount) || amount <= 0) {
            setMessage({ type: 'error', text: 'Monto inválido.' });
            return;
        }
        const note = prompt('Nota interna (motivo, opcional):', '');
        const { data, error } = await supabase.rpc('admin_refund_ride', {
            p_ride_id: ride.id,
            p_amount: amount,
            p_note: note || null,
        });
        if (error) {
            setMessage({ type: 'error', text: error.message });
            return;
        }
        setMessage({
            type: 'success',
            text: `Reembolso #${data} creado: $${amount.toFixed(2)} acreditados al pasajero.`,
        });
        fetchDisputes();
    };

    const resetPayment = async (ride) => {
        if (!confirm(`¿Resetear confirmaciones de pago del viaje #${ride.id}? Esto limpia referencias y confirmaciones para que las partes vuelvan a marcar.`)) return;
        const { error } = await supabase.from('rides').update({
            payment_reference: null,
            payment_confirmed_by_user: false,
            payment_confirmed_by_driver: false,
            payment_confirmed_at: null
        }).eq('id', ride.id);

        if (error) setMessage({ type: 'error', text: error.message });
        else {
            setMessage({ type: 'success', text: `Viaje #${ride.id} reseteado.` });
            fetchDisputes();
        }
    };

    const fmtName = (id) => profiles[id]?.full_name || (id ? id.slice(0, 8) + '…' : '—');
    const fmtDate = (d) => d ? new Date(d).toLocaleString('es-VE') : '—';

    if (!authorized) {
        return (
            <div className="min-h-screen bg-[#0F1014] flex items-center justify-center">
                <div className="w-8 h-8 border-4 border-violet-600 border-t-transparent rounded-full animate-spin"></div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#0F1014] p-4 md:p-8 font-sans text-white">
            <AdminNav />

            <div className="flex items-center gap-4 mb-8">
                <div className="bg-gradient-to-br from-red-600 to-amber-500 p-3 rounded-2xl shadow-lg shadow-red-600/20">
                    <span className="material-symbols-outlined text-white text-2xl">report</span>
                </div>
                <div>
                    <h1 className="text-2xl font-black tracking-tight text-white">Disputas y Reclamos</h1>
                    <p className="text-gray-400 text-sm font-medium">
                        {tab === 'payments'
                            ? 'Viajes con confirmación bilateral pendiente o contradictoria'
                            : 'Reclamos de envíos (daño, pérdida, no entrega)'}
                    </p>
                </div>
            </div>

            {/* Tab switcher Pagos / Envíos */}
            <div className="flex gap-2 mb-6 border-b border-white/5">
                <button
                    onClick={() => setTab('payments')}
                    className={`px-5 py-3 font-bold text-sm border-b-2 transition-all ${tab === 'payments'
                        ? 'border-red-500 text-white'
                        : 'border-transparent text-gray-500 hover:text-white'}`}
                >
                    <span className="material-symbols-outlined text-base mr-2 align-middle">payments</span>
                    Pagos
                </button>
                <button
                    onClick={() => setTab('deliveries')}
                    className={`px-5 py-3 font-bold text-sm border-b-2 transition-all ${tab === 'deliveries'
                        ? 'border-orange-500 text-white'
                        : 'border-transparent text-gray-500 hover:text-white'}`}
                >
                    <span className="material-symbols-outlined text-base mr-2 align-middle">inventory_2</span>
                    Envíos
                </button>
            </div>

            {tab === 'deliveries' ? (
                <AdminDeliveryClaimsPanel />
            ) : (
            <>
            <div className="bg-[#1A1F2E] p-3 rounded-[20px] border border-white/5 mb-6 flex gap-2 overflow-x-auto">
                {FILTERS.map(f => (
                    <button
                        key={f.id}
                        onClick={() => setFilter(f.id)}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-sm whitespace-nowrap transition-all ${filter === f.id
                            ? 'bg-[#2C3345] text-white shadow-lg'
                            : 'text-gray-500 hover:text-white hover:bg-white/5'}`}
                    >
                        <span className="material-symbols-outlined text-[16px]">{f.icon}</span>
                        {f.label}
                    </button>
                ))}
            </div>

            {message && (
                <div className={`mb-6 p-4 rounded-xl flex items-center gap-3 ${message.type === 'success' ? 'bg-green-500/10 border border-green-500/20 text-green-400' : 'bg-red-500/10 border border-red-500/20 text-red-400'}`}>
                    <span className="material-symbols-outlined">{message.type === 'success' ? 'check_circle' : 'error'}</span>
                    <span className="font-medium">{message.text}</span>
                </div>
            )}

            <div className="space-y-3">
                {loading ? (
                    <div className="flex justify-center py-20">
                        <div className="w-8 h-8 border-4 border-violet-600 border-t-transparent rounded-full animate-spin"></div>
                    </div>
                ) : rides.length === 0 ? (
                    <div className="text-center py-20 bg-[#1A1F2E] rounded-2xl border border-dashed border-white/10">
                        <span className="material-symbols-outlined text-gray-500 text-4xl">check_circle</span>
                        <p className="text-gray-400 font-medium mt-2">No hay disputas en este filtro.</p>
                    </div>
                ) : rides.map(r => {
                    const userOk = r.payment_confirmed_by_user;
                    const driverOk = r.payment_confirmed_by_driver;
                    const closed = !!r.payment_confirmed_at;

                    return (
                        <div key={r.id} className="bg-[#1A1F2E] p-5 rounded-[20px] border border-white/5 relative overflow-hidden">
                            <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${closed ? 'bg-emerald-500' : userOk && driverOk ? 'bg-amber-500' : 'bg-red-500'}`}></div>

                            <div className="pl-3 grid md:grid-cols-5 gap-4 items-center">
                                <div>
                                    <p className="text-[10px] text-gray-500 uppercase font-bold mb-1">Viaje</p>
                                    <p className="font-mono font-bold text-violet-400">#{r.id}</p>
                                    <p className="text-[10px] text-gray-500 font-mono mt-1">{fmtDate(r.created_at)}</p>
                                </div>

                                <div>
                                    <p className="text-[10px] text-gray-500 uppercase font-bold mb-1">Pasajero / Driver</p>
                                    <p className="text-sm text-white font-medium truncate">{fmtName(r.user_id)}</p>
                                    <p className="text-xs text-gray-400 truncate">→ {fmtName(r.driver_id)}</p>
                                </div>

                                <div>
                                    <p className="text-[10px] text-gray-500 uppercase font-bold mb-1">Monto</p>
                                    <p className="font-mono font-bold text-white text-lg">${r.price}</p>
                                    <p className="text-[10px] text-gray-500">{r.payment_method || '—'}</p>
                                </div>

                                <div>
                                    <p className="text-[10px] text-gray-500 uppercase font-bold mb-1">Referencia</p>
                                    <p className="font-mono text-xs text-gray-300 break-all">{r.payment_reference || '—'}</p>
                                    <div className="flex gap-1 mt-1">
                                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${userOk ? 'bg-emerald-500/20 text-emerald-400' : 'bg-gray-600/20 text-gray-500'}`} title="Pasajero">
                                            U {userOk ? '✓' : '✗'}
                                        </span>
                                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${driverOk ? 'bg-emerald-500/20 text-emerald-400' : 'bg-gray-600/20 text-gray-500'}`} title="Conductor">
                                            D {driverOk ? '✓' : '✗'}
                                        </span>
                                    </div>
                                </div>

                                <div className="flex gap-2 justify-end flex-wrap">
                                    {!closed && (
                                        <button
                                            onClick={() => forceConfirm(r)}
                                            className="px-3 py-2 rounded-lg text-xs font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 flex items-center gap-1"
                                            title="Forzar confirmación bilateral"
                                        >
                                            <span className="material-symbols-outlined text-[16px]">check_circle</span>
                                            Confirmar
                                        </button>
                                    )}
                                    <button
                                        onClick={() => refundPassenger(r)}
                                        className="px-3 py-2 rounded-lg text-xs font-bold bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/20 flex items-center gap-1"
                                        title="Reembolsar al pasajero como crédito HigoPay (Higo asume)"
                                    >
                                        <span className="material-symbols-outlined text-[16px]">currency_exchange</span>
                                        Reembolsar
                                    </button>
                                    <button
                                        onClick={() => resetPayment(r)}
                                        className="px-3 py-2 rounded-lg text-xs font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/20 flex items-center gap-1"
                                        title="Resetear confirmaciones"
                                    >
                                        <span className="material-symbols-outlined text-[16px]">restart_alt</span>
                                        Reset
                                    </button>
                                </div>
                            </div>

                            <div className="pl-3 mt-3 pt-3 border-t border-white/5 flex gap-4 text-xs text-gray-400">
                                <span className="flex items-center gap-1">
                                    <span className="material-symbols-outlined text-[14px] text-violet-400">my_location</span>
                                    {r.pickup}
                                </span>
                                <span className="flex items-center gap-1">
                                    <span className="material-symbols-outlined text-[14px] text-red-400">place</span>
                                    {r.dropoff}
                                </span>
                                <span className="ml-auto uppercase text-[10px] bg-white/5 px-2 py-0.5 rounded-full">{r.status}</span>
                            </div>
                        </div>
                    );
                })}
            </div>
            </>
            )}
        </div>
    );
};

export default AdminDisputesPage;
