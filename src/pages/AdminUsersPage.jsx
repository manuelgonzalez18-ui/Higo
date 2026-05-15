import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, getUserProfile } from '../services/supabase';
import AdminNav from '../components/AdminNav';

const ROLES = [
    { id: 'user',   label: 'Pasajero', icon: 'person',              color: 'text-gray-300'     },
    { id: 'driver', label: 'Driver',   icon: 'directions_car',      color: 'text-sky-400'      },
    { id: 'admin',  label: 'Admin',    icon: 'admin_panel_settings', color: 'text-violet-400'  }
];

const FILTERS = [
    { id: 'all',    label: 'Todos'     },
    { id: 'user',   label: 'Pasajeros' },
    { id: 'driver', label: 'Drivers'   },
    { id: 'admin',  label: 'Admins'    }
];

const AdminUsersPage = () => {
    const navigate = useNavigate();
    const [authorized, setAuthorized] = useState(false);
    const [me, setMe] = useState(null);
    const [loading, setLoading] = useState(true);
    const [users, setUsers] = useState([]);
    const [filter, setFilter] = useState('all');
    const [searchTerm, setSearchTerm] = useState('');
    const [message, setMessage] = useState(null);

    useEffect(() => {
        (async () => {
            const profile = await getUserProfile();
            if (!profile || profile.role !== 'admin') {
                navigate('/');
                return;
            }
            setMe(profile);
            setAuthorized(true);
            await fetchUsers();
        })();
    }, [navigate]);

    const fetchUsers = async () => {
        setLoading(true);
        const { data, error } = await supabase
            .from('profiles')
            .select('id, full_name, phone, role, subscription_status, referral_code, referral_credit_balance, created_at')
            .order('created_at', { ascending: false });
        if (error) setMessage({ type: 'error', text: error.message });
        else setUsers(data || []);
        setLoading(false);
    };

    const openSupportChat = async (user) => {
        // Buscar el hilo existente; si no, crearlo (admin tiene RLS para insert).
        const { data: existing } = await supabase
            .from('support_threads')
            .select('id')
            .eq('user_id', user.id)
            .maybeSingle();

        let threadId = existing?.id;
        if (!threadId) {
            const { data: created, error } = await supabase
                .from('support_threads')
                .insert({ user_id: user.id })
                .select('id')
                .single();
            if (error) { setMessage({ type: 'error', text: error.message }); return; }
            threadId = created.id;
        }
        navigate(`/admin/support?thread=${threadId}`);
    };

    const changeRole = async (user, newRole) => {
        if (user.id === me?.id && newRole !== 'admin') {
            setMessage({ type: 'error', text: 'No podés quitarte a vos mismo el rol de admin desde acá.' });
            return;
        }
        if (!confirm(`¿Cambiar rol de "${user.full_name || user.id.slice(0, 8)}" a ${newRole.toUpperCase()}?`)) return;
        const { error } = await supabase.from('profiles').update({ role: newRole }).eq('id', user.id);
        if (error) setMessage({ type: 'error', text: error.message });
        else {
            setMessage({ type: 'success', text: `Rol actualizado a ${newRole}.` });
            fetchUsers();
        }
    };

    const filtered = users.filter(u => {
        const matchesFilter = filter === 'all' || u.role === filter;
        const s = searchTerm.toLowerCase();
        const matchesSearch = !s ||
            (u.full_name?.toLowerCase().includes(s)) ||
            (u.phone?.toLowerCase().includes(s)) ||
            (u.referral_code?.toLowerCase().includes(s));
        return matchesFilter && matchesSearch;
    });

    const roleMeta = (r) => ROLES.find(x => x.id === r) || ROLES[0];

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
                <div className="bg-gradient-to-br from-violet-600 to-fuchsia-600 p-3 rounded-2xl shadow-lg shadow-violet-600/20">
                    <span className="material-symbols-outlined text-white text-2xl">group</span>
                </div>
                <div>
                    <h1 className="text-2xl font-black tracking-tight text-white">Usuarios</h1>
                    <p className="text-gray-400 text-sm font-medium">Gestioná roles (pasajero, driver, admin)</p>
                </div>
            </div>

            <div className="bg-[#1A1F2E] p-6 rounded-[24px] border border-white/5 mb-6">
                <div className="flex flex-col md:flex-row gap-4 justify-between items-center">
                    <div className="relative w-full md:w-96">
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 material-symbols-outlined">search</span>
                        <input
                            type="text"
                            placeholder="Buscar por nombre, teléfono o código..."
                            className="w-full pl-12 pr-4 py-3 bg-[#0F1014] border border-white/10 rounded-xl outline-none focus:border-violet-500/50 text-white placeholder:text-gray-600"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                    <div className="flex gap-2 bg-[#0F1014] p-1.5 rounded-xl border border-white/5">
                        {FILTERS.map(f => (
                            <button
                                key={f.id}
                                onClick={() => setFilter(f.id)}
                                className={`px-4 py-2 rounded-lg font-bold text-sm transition-all ${filter === f.id
                                    ? 'bg-[#2C3345] text-white shadow-lg'
                                    : 'text-gray-500 hover:text-white hover:bg-white/5'}`}
                            >
                                {f.label}
                            </button>
                        ))}
                    </div>
                </div>
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
                ) : filtered.length === 0 ? (
                    <div className="text-center py-20 bg-[#1A1F2E] rounded-2xl border border-dashed border-white/10">
                        <span className="material-symbols-outlined text-gray-500 text-4xl">group_off</span>
                        <p className="text-gray-400 font-medium mt-2">No hay usuarios en este filtro.</p>
                    </div>
                ) : filtered.map(u => {
                    const rm = roleMeta(u.role);
                    const isSelf = u.id === me?.id;
                    return (
                        <div key={u.id} className="bg-[#1A1F2E] p-4 md:p-5 rounded-[20px] border border-white/5 flex flex-col md:flex-row items-center gap-4">
                            <div className="flex items-center gap-3 flex-1 min-w-0">
                                <div className={`w-11 h-11 rounded-full bg-[#0F1014] border border-white/10 flex items-center justify-center ${rm.color}`}>
                                    <span className="material-symbols-outlined">{rm.icon}</span>
                                </div>
                                <div className="min-w-0">
                                    <p className="font-bold text-white truncate flex items-center gap-2">
                                        {u.full_name || <span className="text-gray-500 italic">sin nombre</span>}
                                        {isSelf && <span className="text-[10px] bg-violet-600/20 text-violet-400 px-2 py-0.5 rounded-full font-bold">VOS</span>}
                                    </p>
                                    <p className="text-xs text-gray-400 truncate">{u.phone || '—'} · <span className="font-mono">{u.referral_code || '—'}</span></p>
                                </div>
                            </div>

                            <div className="text-center md:text-left">
                                <p className="text-[10px] text-gray-500 uppercase font-bold mb-0.5">Rol actual</p>
                                <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border ${u.role === 'admin' ? 'bg-violet-500/10 text-violet-400 border-violet-500/30'
                                    : u.role === 'driver' ? 'bg-sky-500/10 text-sky-400 border-sky-500/30'
                                    : 'bg-gray-500/10 text-gray-400 border-gray-500/30'}`}>
                                    {rm.label}
                                </span>
                            </div>

                            <div className="text-center md:text-left">
                                <p className="text-[10px] text-gray-500 uppercase font-bold mb-0.5">Créditos</p>
                                <p className="font-mono text-sm text-gray-300">${(u.referral_credit_balance ?? 0).toFixed(2)}</p>
                            </div>

                            <div className="flex gap-2 flex-wrap items-center">
                                <button
                                    onClick={() => openSupportChat(u)}
                                    className="px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-1 bg-[#0F1014] text-gray-300 hover:bg-fuchsia-600 hover:text-white border border-white/10 transition-all"
                                    title="Abrir chat de soporte con este usuario"
                                >
                                    <span className="material-symbols-outlined text-[14px]">chat</span>
                                    Chat
                                </button>
                                {ROLES.map(r => (
                                    <button
                                        key={r.id}
                                        onClick={() => changeRole(u, r.id)}
                                        disabled={u.role === r.id}
                                        className={`px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-1 transition-all ${u.role === r.id
                                            ? 'bg-white/5 text-gray-600 cursor-not-allowed'
                                            : 'bg-[#0F1014] text-gray-300 hover:bg-violet-600 hover:text-white border border-white/10'}`}
                                        title={u.role === r.id ? 'Ya es ' + r.label : 'Cambiar a ' + r.label}
                                    >
                                        <span className="material-symbols-outlined text-[14px]">{r.icon}</span>
                                        {r.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default AdminUsersPage;
