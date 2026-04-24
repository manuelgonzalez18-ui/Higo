import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, getUserProfile } from '../services/supabase';
import AdminNav from '../components/AdminNav';

const VEHICLE_META = {
    moto:     { label: 'Moto',      icon: 'two_wheeler',       color: 'from-sky-500 to-indigo-500' },
    standard: { label: 'Carro',     icon: 'directions_car',    color: 'from-violet-500 to-fuchsia-500' },
    van:      { label: 'Camioneta', icon: 'local_shipping',    color: 'from-amber-500 to-orange-500' }
};

const FIELDS = [
    { key: 'base',         label: 'Tarifa base',        hint: 'Incluye el primer km' },
    { key: 'per_km',       label: 'Por km adicional',   hint: 'Después del primer km' },
    { key: 'delivery_fee', label: 'Cargo de envío',     hint: 'Solo Higo Envíos' },
    { key: 'wait_per_min', label: 'Espera ($/min)',     hint: 'Primeros 3 min gratis' },
    { key: 'stop_fee',     label: 'Por parada extra',   hint: 'Paradas intermedias' }
];

const AdminPricingPage = () => {
    const navigate = useNavigate();
    const [authorized, setAuthorized] = useState(false);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(null);
    const [rows, setRows] = useState({});
    const [message, setMessage] = useState(null);

    useEffect(() => {
        (async () => {
            const profile = await getUserProfile();
            if (!profile || profile.role !== 'admin') {
                navigate('/');
                return;
            }
            setAuthorized(true);
            await fetchPricing();
        })();
    }, [navigate]);

    const fetchPricing = async () => {
        setLoading(true);
        const { data, error } = await supabase.from('pricing_config').select('*');
        if (error) {
            setMessage({ type: 'error', text: 'No se pudo cargar las tarifas: ' + error.message });
        } else {
            const byType = {};
            for (const r of data) byType[r.vehicle_type] = r;
            setRows(byType);
        }
        setLoading(false);
    };

    const updateField = (type, key, value) => {
        setRows(prev => ({
            ...prev,
            [type]: { ...prev[type], [key]: value }
        }));
    };

    const save = async (type) => {
        setSaving(type);
        setMessage(null);
        const row = rows[type];
        const patch = {
            base: parseFloat(row.base) || 0,
            per_km: parseFloat(row.per_km) || 0,
            delivery_fee: parseFloat(row.delivery_fee) || 0,
            wait_per_min: parseFloat(row.wait_per_min) || 0,
            stop_fee: parseFloat(row.stop_fee) || 0
        };
        const { error } = await supabase
            .from('pricing_config')
            .update(patch)
            .eq('vehicle_type', type);

        if (error) {
            setMessage({ type: 'error', text: 'Error al guardar: ' + error.message });
        } else {
            setMessage({ type: 'success', text: `${VEHICLE_META[type].label} actualizado.` });
            await fetchPricing();
        }
        setSaving(null);
    };

    if (!authorized || loading) {
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
                    <span className="material-symbols-outlined text-white text-2xl">payments</span>
                </div>
                <div>
                    <h1 className="text-2xl font-black tracking-tight text-white">Tarifas</h1>
                    <p className="text-gray-400 text-sm font-medium">
                        Editá los precios de cada vehículo. Los cambios se aplican en el próximo viaje cotizado.
                    </p>
                </div>
            </div>

            {message && (
                <div className={`mb-6 p-4 rounded-xl flex items-center gap-3 ${message.type === 'success' ? 'bg-green-500/10 border border-green-500/20 text-green-400' : 'bg-red-500/10 border border-red-500/20 text-red-400'}`}>
                    <span className="material-symbols-outlined">{message.type === 'success' ? 'check_circle' : 'error'}</span>
                    <span className="font-medium">{message.text}</span>
                </div>
            )}

            <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
                {['moto', 'standard', 'van'].map(type => {
                    const meta = VEHICLE_META[type];
                    const row = rows[type];
                    if (!row) return null;

                    return (
                        <div key={type} className="bg-[#1A1F2E] rounded-[24px] border border-white/5 overflow-hidden shadow-2xl">
                            <div className={`p-5 bg-gradient-to-br ${meta.color} flex items-center gap-3`}>
                                <div className="w-12 h-12 bg-black/20 rounded-2xl flex items-center justify-center">
                                    <span className="material-symbols-outlined text-white text-3xl">{meta.icon}</span>
                                </div>
                                <div>
                                    <h2 className="font-bold text-white text-xl">{meta.label}</h2>
                                    <p className="text-white/70 text-xs font-mono">{type}</p>
                                </div>
                            </div>

                            <div className="p-5 space-y-4">
                                {FIELDS.map(f => (
                                    <div key={f.key}>
                                        <label className="flex justify-between items-end mb-1">
                                            <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">{f.label}</span>
                                            <span className="text-[10px] text-gray-600">{f.hint}</span>
                                        </label>
                                        <div className="relative">
                                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-mono">$</span>
                                            <input
                                                type="number"
                                                step="0.01"
                                                min="0"
                                                value={row[f.key] ?? ''}
                                                onChange={(e) => updateField(type, f.key, e.target.value)}
                                                className="w-full pl-8 pr-3 py-3 bg-[#0F1014] border border-white/10 rounded-xl text-white font-mono outline-none focus:border-violet-500 transition-colors"
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <div className="p-4 border-t border-white/5 bg-[#151925]">
                                <button
                                    onClick={() => save(type)}
                                    disabled={saving === type}
                                    className="w-full bg-violet-600 hover:bg-violet-500 text-white font-bold py-3 rounded-xl shadow-lg shadow-violet-600/20 flex gap-2 justify-center items-center transition-all active:scale-[0.98] disabled:opacity-50"
                                >
                                    {saving === type ? (
                                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                    ) : (
                                        <>
                                            <span className="material-symbols-outlined text-[18px]">save</span>
                                            Guardar {meta.label}
                                        </>
                                    )}
                                </button>
                                {row.updated_at && (
                                    <p className="text-[10px] text-gray-500 text-center mt-2 font-mono">
                                        Últ. cambio: {new Date(row.updated_at).toLocaleString('es-VE')}
                                    </p>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default AdminPricingPage;
