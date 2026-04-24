import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, getUserProfile } from '../services/supabase';
import AdminNav from '../components/AdminNav';

const emptyForm = {
    code: '',
    description: '',
    discount_type: 'percent',
    discount_value: 10,
    max_uses: '',
    max_uses_per_user: 1,
    min_ride_amount: 0,
    expires_at: '',
    active: true
};

const AdminPromoCodesPage = () => {
    const navigate = useNavigate();
    const [authorized, setAuthorized] = useState(false);
    const [loading, setLoading] = useState(true);
    const [promos, setPromos] = useState([]);
    const [form, setForm] = useState(emptyForm);
    const [editingId, setEditingId] = useState(null);
    const [showModal, setShowModal] = useState(false);
    const [message, setMessage] = useState(null);

    useEffect(() => {
        (async () => {
            const profile = await getUserProfile();
            if (!profile || profile.role !== 'admin') {
                navigate('/');
                return;
            }
            setAuthorized(true);
            await fetchPromos();
        })();
    }, [navigate]);

    const fetchPromos = async () => {
        setLoading(true);
        const { data, error } = await supabase
            .from('promo_codes')
            .select('*')
            .order('created_at', { ascending: false });
        if (error) {
            setMessage({ type: 'error', text: error.message });
        } else {
            setPromos(data || []);
        }
        setLoading(false);
    };

    const openCreate = () => {
        setForm(emptyForm);
        setEditingId(null);
        setShowModal(true);
    };

    const openEdit = (p) => {
        setForm({
            code: p.code,
            description: p.description || '',
            discount_type: p.discount_type,
            discount_value: p.discount_value,
            max_uses: p.max_uses ?? '',
            max_uses_per_user: p.max_uses_per_user ?? 1,
            min_ride_amount: p.min_ride_amount ?? 0,
            expires_at: p.expires_at ? p.expires_at.split('T')[0] : '',
            active: p.active
        });
        setEditingId(p.id);
        setShowModal(true);
    };

    const save = async () => {
        if (!form.code.trim()) {
            setMessage({ type: 'error', text: 'El código es obligatorio.' });
            return;
        }
        const payload = {
            code: form.code.trim().toUpperCase(),
            description: form.description.trim() || null,
            discount_type: form.discount_type,
            discount_value: parseFloat(form.discount_value) || 0,
            max_uses: form.max_uses === '' ? null : parseInt(form.max_uses, 10),
            max_uses_per_user: parseInt(form.max_uses_per_user, 10) || 1,
            min_ride_amount: parseFloat(form.min_ride_amount) || 0,
            expires_at: form.expires_at || null,
            active: !!form.active
        };

        const q = editingId
            ? supabase.from('promo_codes').update(payload).eq('id', editingId)
            : supabase.from('promo_codes').insert(payload);

        const { error } = await q;
        if (error) {
            setMessage({ type: 'error', text: error.message });
        } else {
            setMessage({ type: 'success', text: editingId ? 'Código actualizado.' : 'Código creado.' });
            setShowModal(false);
            await fetchPromos();
        }
    };

    const toggleActive = async (p) => {
        const { error } = await supabase.from('promo_codes').update({ active: !p.active }).eq('id', p.id);
        if (error) setMessage({ type: 'error', text: error.message });
        else fetchPromos();
    };

    const remove = async (p) => {
        if (!confirm(`¿Eliminar código "${p.code}"? Esto borrará el registro permanentemente.`)) return;
        const { error } = await supabase.from('promo_codes').delete().eq('id', p.id);
        if (error) setMessage({ type: 'error', text: error.message });
        else {
            setMessage({ type: 'success', text: 'Código eliminado.' });
            fetchPromos();
        }
    };

    if (!authorized) {
        return (
            <div className="min-h-screen bg-[#0F1014] flex items-center justify-center">
                <div className="w-8 h-8 border-4 border-violet-600 border-t-transparent rounded-full animate-spin"></div>
            </div>
        );
    }

    const fmtDiscount = (p) =>
        p.discount_type === 'percent' ? `${p.discount_value}% off` : `$${p.discount_value} off`;

    const fmtExpiry = (p) => p.expires_at ? new Date(p.expires_at).toLocaleDateString('es-VE') : 'Sin expiración';

    const isExpired = (p) => p.expires_at && new Date(p.expires_at) < new Date();

    return (
        <div className="min-h-screen bg-[#0F1014] p-4 md:p-8 font-sans text-white">
            <AdminNav />

            <div className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
                <div className="flex items-center gap-4">
                    <div className="bg-gradient-to-br from-violet-600 to-fuchsia-600 p-3 rounded-2xl shadow-lg shadow-violet-600/20">
                        <span className="material-symbols-outlined text-white text-2xl">local_offer</span>
                    </div>
                    <div>
                        <h1 className="text-2xl font-black tracking-tight text-white">Códigos Promocionales</h1>
                        <p className="text-gray-400 text-sm font-medium">Descuentos aplicables a viajes</p>
                    </div>
                </div>
                <button
                    onClick={openCreate}
                    className="bg-violet-600 hover:bg-violet-500 text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2 shadow-lg hover:shadow-violet-600/30 transition-all active:scale-95"
                >
                    <span className="material-symbols-outlined">add</span>
                    Nuevo Código
                </button>
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
                ) : promos.length === 0 ? (
                    <div className="text-center py-20 bg-[#1A1F2E] rounded-2xl border border-dashed border-white/10">
                        <span className="material-symbols-outlined text-gray-500 text-4xl">local_offer</span>
                        <p className="text-gray-400 font-medium mt-2">No hay códigos promocionales aún.</p>
                    </div>
                ) : promos.map(p => (
                    <div key={p.id} className="bg-[#1A1F2E] p-4 md:p-5 rounded-[20px] border border-white/5 flex flex-col md:flex-row gap-4 items-center relative overflow-hidden">
                        <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${!p.active ? 'bg-gray-600' : isExpired(p) ? 'bg-amber-500' : 'bg-emerald-500'}`}></div>

                        <div className="flex-1 pl-3 flex items-center gap-4">
                            <div className="bg-[#0F1014] border border-violet-500/30 px-4 py-2 rounded-xl">
                                <p className="font-mono font-black text-violet-400 text-lg tracking-wider">{p.code}</p>
                            </div>
                            <div>
                                <p className="font-bold text-white">{fmtDiscount(p)}</p>
                                <p className="text-xs text-gray-400">{p.description || '—'}</p>
                            </div>
                        </div>

                        <div className="grid grid-cols-3 gap-4 text-center md:text-left text-xs">
                            <div>
                                <p className="text-[10px] text-gray-500 uppercase font-bold mb-1">Usos</p>
                                <p className="font-mono text-gray-300">
                                    {p.used_count}{p.max_uses != null ? ` / ${p.max_uses}` : ''}
                                </p>
                            </div>
                            <div>
                                <p className="text-[10px] text-gray-500 uppercase font-bold mb-1">Por user</p>
                                <p className="font-mono text-gray-300">{p.max_uses_per_user || 1}</p>
                            </div>
                            <div>
                                <p className="text-[10px] text-gray-500 uppercase font-bold mb-1">Vence</p>
                                <p className="font-mono text-gray-300">{fmtExpiry(p)}</p>
                            </div>
                        </div>

                        <div className="flex gap-2">
                            <button
                                onClick={() => toggleActive(p)}
                                className={`px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-1 ${p.active
                                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20'
                                    : 'bg-gray-600/10 text-gray-400 border border-gray-600/20 hover:bg-gray-600/20'}`}
                                title={p.active ? 'Click para desactivar' : 'Click para activar'}
                            >
                                <span className="material-symbols-outlined text-[16px]">{p.active ? 'toggle_on' : 'toggle_off'}</span>
                                {p.active ? 'Activo' : 'Inactivo'}
                            </button>
                            <button
                                onClick={() => openEdit(p)}
                                className="w-9 h-9 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-gray-400 hover:text-white"
                                title="Editar"
                            >
                                <span className="material-symbols-outlined text-[18px]">edit</span>
                            </button>
                            <button
                                onClick={() => remove(p)}
                                className="w-9 h-9 rounded-lg bg-red-500/10 hover:bg-red-500/20 flex items-center justify-center text-red-400"
                                title="Eliminar"
                            >
                                <span className="material-symbols-outlined text-[18px]">delete</span>
                            </button>
                        </div>
                    </div>
                ))}
            </div>

            {showModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md overflow-y-auto">
                    <div className="bg-[#1A1F2E] w-full max-w-md rounded-[32px] shadow-2xl my-8 border border-white/10">
                        <div className="p-6 border-b border-white/5 flex justify-between items-center bg-[#151925] rounded-t-[32px]">
                            <h2 className="text-xl font-bold flex items-center gap-2 text-white">
                                <span className="material-symbols-outlined text-violet-500">{editingId ? 'edit' : 'add_circle'}</span>
                                {editingId ? 'Editar Código' : 'Nuevo Código'}
                            </h2>
                            <button onClick={() => setShowModal(false)} className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-gray-400 hover:text-white">
                                <span className="material-symbols-outlined text-sm">close</span>
                            </button>
                        </div>

                        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto custom-scrollbar">
                            <div>
                                <label className="block text-xs font-bold mb-1.5 text-gray-400 uppercase tracking-wider">Código</label>
                                <input
                                    className="w-full p-3.5 bg-[#0F1014] border border-white/10 rounded-xl text-white font-mono uppercase tracking-wider outline-none focus:border-violet-500"
                                    placeholder="HIGUEROTE10"
                                    value={form.code}
                                    onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                                    disabled={!!editingId}
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-bold mb-1.5 text-gray-400 uppercase tracking-wider">Descripción</label>
                                <input
                                    className="w-full p-3.5 bg-[#0F1014] border border-white/10 rounded-xl text-white outline-none focus:border-violet-500"
                                    placeholder="10% off viajes en Higuerote"
                                    value={form.description}
                                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold mb-1.5 text-gray-400 uppercase tracking-wider">Tipo</label>
                                    <select
                                        className="w-full p-3.5 bg-[#0F1014] border border-white/10 rounded-xl text-white outline-none focus:border-violet-500"
                                        value={form.discount_type}
                                        onChange={(e) => setForm({ ...form, discount_type: e.target.value })}
                                    >
                                        <option value="percent">Porcentaje (%)</option>
                                        <option value="fixed">Monto fijo ($)</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold mb-1.5 text-gray-400 uppercase tracking-wider">Valor</label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        className="w-full p-3.5 bg-[#0F1014] border border-white/10 rounded-xl text-white font-mono outline-none focus:border-violet-500"
                                        value={form.discount_value}
                                        onChange={(e) => setForm({ ...form, discount_value: e.target.value })}
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold mb-1.5 text-gray-400 uppercase tracking-wider">Usos máx totales</label>
                                    <input
                                        type="number"
                                        min="0"
                                        placeholder="∞ ilimitado"
                                        className="w-full p-3.5 bg-[#0F1014] border border-white/10 rounded-xl text-white font-mono outline-none focus:border-violet-500"
                                        value={form.max_uses}
                                        onChange={(e) => setForm({ ...form, max_uses: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold mb-1.5 text-gray-400 uppercase tracking-wider">Por usuario</label>
                                    <input
                                        type="number"
                                        min="1"
                                        className="w-full p-3.5 bg-[#0F1014] border border-white/10 rounded-xl text-white font-mono outline-none focus:border-violet-500"
                                        value={form.max_uses_per_user}
                                        onChange={(e) => setForm({ ...form, max_uses_per_user: e.target.value })}
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold mb-1.5 text-gray-400 uppercase tracking-wider">Monto mín viaje</label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        className="w-full p-3.5 bg-[#0F1014] border border-white/10 rounded-xl text-white font-mono outline-none focus:border-violet-500"
                                        value={form.min_ride_amount}
                                        onChange={(e) => setForm({ ...form, min_ride_amount: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold mb-1.5 text-gray-400 uppercase tracking-wider">Vence el</label>
                                    <input
                                        type="date"
                                        className="w-full p-3.5 bg-[#0F1014] border border-white/10 rounded-xl text-white font-mono outline-none focus:border-violet-500"
                                        value={form.expires_at}
                                        onChange={(e) => setForm({ ...form, expires_at: e.target.value })}
                                    />
                                </div>
                            </div>

                            <label className="flex items-center gap-3 p-3 bg-[#0F1014] rounded-xl border border-white/10 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={form.active}
                                    onChange={(e) => setForm({ ...form, active: e.target.checked })}
                                    className="w-5 h-5 accent-violet-500"
                                />
                                <span className="text-sm font-medium text-white">Activo (disponible para usar)</span>
                            </label>
                        </div>

                        <div className="p-6 border-t border-white/5 bg-[#151925] rounded-b-[32px]">
                            <button
                                onClick={save}
                                className="w-full bg-violet-600 hover:bg-violet-500 text-white font-bold py-4 rounded-xl shadow-lg shadow-violet-600/20 flex gap-2 justify-center items-center transition-all active:scale-[0.98]"
                            >
                                <span className="material-symbols-outlined">{editingId ? 'save' : 'check_circle'}</span>
                                {editingId ? 'Guardar Cambios' : 'Crear Código'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AdminPromoCodesPage;
