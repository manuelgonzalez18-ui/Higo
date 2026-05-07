import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, getUserProfile } from '../services/supabase';
import AdminNav from '../components/AdminNav';

const emptyForm = { name: '', center_lat: '', center_lng: '', radius_km: 30, active: true };

const AdminZonesPage = () => {
    const navigate = useNavigate();
    const [authorized, setAuthorized] = useState(false);
    const [loading, setLoading] = useState(true);
    const [zones, setZones] = useState([]);
    const [form, setForm] = useState(emptyForm);
    const [editingId, setEditingId] = useState(null);
    const [showModal, setShowModal] = useState(false);
    const [message, setMessage] = useState(null);

    useEffect(() => {
        (async () => {
            const profile = await getUserProfile();
            if (!profile || profile.role !== 'admin') { navigate('/'); return; }
            setAuthorized(true);
            await fetchZones();
        })();
    }, [navigate]);

    const fetchZones = async () => {
        setLoading(true);
        // Admin needs to see ALL zones (active and inactive), bypass RLS read-active-only
        const { data, error } = await supabase
            .from('coverage_zones')
            .select('*')
            .order('created_at', { ascending: false });
        if (error) setMessage({ type: 'error', text: error.message });
        else setZones(data || []);
        setLoading(false);
    };

    const openCreate = () => { setForm(emptyForm); setEditingId(null); setShowModal(true); };

    const openEdit = (z) => {
        setForm({ name: z.name, center_lat: z.center_lat, center_lng: z.center_lng, radius_km: z.radius_km, active: z.active });
        setEditingId(z.id);
        setShowModal(true);
    };

    const save = async () => {
        if (!form.name.trim() || !form.center_lat || !form.center_lng) {
            setMessage({ type: 'error', text: 'Nombre, latitud y longitud son obligatorios.' });
            return;
        }
        const payload = {
            name: form.name.trim(),
            center_lat: parseFloat(form.center_lat),
            center_lng: parseFloat(form.center_lng),
            radius_km: parseFloat(form.radius_km) || 30,
            active: !!form.active,
        };
        const q = editingId
            ? supabase.from('coverage_zones').update(payload).eq('id', editingId)
            : supabase.from('coverage_zones').insert(payload);
        const { error } = await q;
        if (error) setMessage({ type: 'error', text: error.message });
        else {
            setMessage({ type: 'success', text: editingId ? 'Zona actualizada.' : 'Zona creada.' });
            setShowModal(false);
            fetchZones();
        }
    };

    const toggleActive = async (z) => {
        const { error } = await supabase.from('coverage_zones').update({ active: !z.active }).eq('id', z.id);
        if (error) setMessage({ type: 'error', text: error.message });
        else fetchZones();
    };

    const remove = async (z) => {
        if (!confirm(`¿Eliminar la zona "${z.name}"?`)) return;
        const { error } = await supabase.from('coverage_zones').delete().eq('id', z.id);
        if (error) setMessage({ type: 'error', text: error.message });
        else { setMessage({ type: 'success', text: 'Zona eliminada.' }); fetchZones(); }
    };

    if (!authorized) return (
        <div className="min-h-screen bg-[#0F1014] flex items-center justify-center">
            <div className="w-8 h-8 border-4 border-violet-600 border-t-transparent rounded-full animate-spin"></div>
        </div>
    );

    return (
        <div className="min-h-screen bg-[#0F1014] p-4 md:p-8 font-sans text-white">
            <AdminNav />

            <div className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
                <div className="flex items-center gap-4">
                    <div className="bg-gradient-to-br from-teal-600 to-emerald-600 p-3 rounded-2xl shadow-lg shadow-teal-600/20">
                        <span className="material-symbols-outlined text-white text-2xl">place</span>
                    </div>
                    <div>
                        <h1 className="text-2xl font-black tracking-tight">Zonas de Cobertura</h1>
                        <p className="text-gray-400 text-sm">Áreas donde opera Higo</p>
                    </div>
                </div>
                <button
                    onClick={openCreate}
                    className="bg-teal-600 hover:bg-teal-500 text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2 shadow-lg transition-all active:scale-95"
                >
                    <span className="material-symbols-outlined">add</span>
                    Nueva Zona
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
                        <div className="w-8 h-8 border-4 border-teal-600 border-t-transparent rounded-full animate-spin"></div>
                    </div>
                ) : zones.length === 0 ? (
                    <div className="text-center py-20 bg-[#1A1F2E] rounded-2xl border border-dashed border-white/10">
                        <span className="material-symbols-outlined text-gray-500 text-4xl">place</span>
                        <p className="text-gray-400 font-medium mt-2">No hay zonas definidas. Crea la primera.</p>
                    </div>
                ) : zones.map(z => (
                    <div key={z.id} className="bg-[#1A1F2E] p-4 md:p-5 rounded-[20px] border border-white/5 flex flex-col md:flex-row gap-4 items-center relative overflow-hidden">
                        <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${z.active ? 'bg-teal-500' : 'bg-gray-600'}`}></div>

                        <div className="flex-1 pl-3">
                            <p className="font-bold text-white text-lg">{z.name}</p>
                            <p className="text-xs text-gray-400 font-mono mt-0.5">
                                {z.center_lat.toFixed(4)}, {z.center_lng.toFixed(4)} · radio {z.radius_km} km
                            </p>
                        </div>

                        <div className="flex gap-2">
                            <button
                                onClick={() => toggleActive(z)}
                                className={`px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-1 ${z.active
                                    ? 'bg-teal-500/10 text-teal-400 border border-teal-500/20 hover:bg-teal-500/20'
                                    : 'bg-gray-600/10 text-gray-400 border border-gray-600/20 hover:bg-gray-600/20'}`}
                            >
                                <span className="material-symbols-outlined text-[16px]">{z.active ? 'toggle_on' : 'toggle_off'}</span>
                                {z.active ? 'Activa' : 'Inactiva'}
                            </button>
                            <button
                                onClick={() => openEdit(z)}
                                className="w-9 h-9 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-gray-400 hover:text-white"
                            >
                                <span className="material-symbols-outlined text-[18px]">edit</span>
                            </button>
                            <button
                                onClick={() => remove(z)}
                                className="w-9 h-9 rounded-lg bg-red-500/10 hover:bg-red-500/20 flex items-center justify-center text-red-400"
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
                            <h2 className="text-xl font-bold flex items-center gap-2">
                                <span className="material-symbols-outlined text-teal-500">{editingId ? 'edit' : 'add_location'}</span>
                                {editingId ? 'Editar Zona' : 'Nueva Zona'}
                            </h2>
                            <button onClick={() => setShowModal(false)} className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-gray-400 hover:text-white">
                                <span className="material-symbols-outlined text-sm">close</span>
                            </button>
                        </div>

                        <div className="p-6 space-y-4">
                            <div>
                                <label className="block text-xs font-bold mb-1.5 text-gray-400 uppercase tracking-wider">Nombre de la zona</label>
                                <input
                                    className="w-full p-3.5 bg-[#0F1014] border border-white/10 rounded-xl text-white outline-none focus:border-teal-500"
                                    placeholder="Ej: Higuerote Centro"
                                    value={form.name}
                                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold mb-1.5 text-gray-400 uppercase tracking-wider">Latitud</label>
                                    <input
                                        type="number"
                                        step="0.0001"
                                        className="w-full p-3.5 bg-[#0F1014] border border-white/10 rounded-xl text-white font-mono outline-none focus:border-teal-500"
                                        placeholder="10.4653"
                                        value={form.center_lat}
                                        onChange={(e) => setForm({ ...form, center_lat: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold mb-1.5 text-gray-400 uppercase tracking-wider">Longitud</label>
                                    <input
                                        type="number"
                                        step="0.0001"
                                        className="w-full p-3.5 bg-[#0F1014] border border-white/10 rounded-xl text-white font-mono outline-none focus:border-teal-500"
                                        placeholder="-65.9711"
                                        value={form.center_lng}
                                        onChange={(e) => setForm({ ...form, center_lng: e.target.value })}
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-bold mb-1.5 text-gray-400 uppercase tracking-wider">Radio (km)</label>
                                <input
                                    type="number"
                                    min="1"
                                    step="0.5"
                                    className="w-full p-3.5 bg-[#0F1014] border border-white/10 rounded-xl text-white font-mono outline-none focus:border-teal-500"
                                    value={form.radius_km}
                                    onChange={(e) => setForm({ ...form, radius_km: e.target.value })}
                                />
                            </div>

                            <label className="flex items-center gap-3 p-3 bg-[#0F1014] rounded-xl border border-white/10 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={form.active}
                                    onChange={(e) => setForm({ ...form, active: e.target.checked })}
                                    className="w-5 h-5 accent-teal-500"
                                />
                                <span className="text-sm font-medium">Zona activa</span>
                            </label>
                        </div>

                        <div className="p-6 border-t border-white/5 bg-[#151925] rounded-b-[32px]">
                            <button
                                onClick={save}
                                className="w-full bg-teal-600 hover:bg-teal-500 text-white font-bold py-4 rounded-xl flex gap-2 justify-center items-center transition-all active:scale-[0.98]"
                            >
                                <span className="material-symbols-outlined">{editingId ? 'save' : 'check_circle'}</span>
                                {editingId ? 'Guardar Cambios' : 'Crear Zona'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AdminZonesPage;
