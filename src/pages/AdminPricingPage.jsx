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
    // D.A2 — surge pricing rules
    const [rules, setRules] = useState([]);
    const [newRule, setNewRule] = useState({
        name: '', vehicle_type: '', multiplier: '1.5',
        hour_start: '', hour_end: '',
    });

    useEffect(() => {
        (async () => {
            const profile = await getUserProfile();
            if (!profile || profile.role !== 'admin') {
                navigate('/');
                return;
            }
            setAuthorized(true);
            await Promise.all([fetchPricing(), fetchRules()]);
        })();
    }, [navigate]);

    // D.A2: load rules.
    const fetchRules = async () => {
        const { data } = await supabase
            .from('pricing_rules')
            .select('*')
            .order('created_at', { ascending: false });
        setRules(data || []);
    };

    const createRule = async () => {
        const mult = parseFloat(newRule.multiplier);
        if (!newRule.name.trim() || !Number.isFinite(mult) || mult < 0.5 || mult > 5.0) {
            setMessage({ type: 'error', text: 'Nombre obligatorio + multiplier entre 0.5 y 5.0.' });
            return;
        }
        const hs = newRule.hour_start === '' ? null : parseInt(newRule.hour_start);
        const he = newRule.hour_end   === '' ? null : parseInt(newRule.hour_end);
        const { error } = await supabase.from('pricing_rules').insert({
            name: newRule.name.trim(),
            vehicle_type: newRule.vehicle_type || null,
            multiplier: mult,
            hour_start: hs, hour_end: he,
        });
        if (error) {
            setMessage({ type: 'error', text: error.message });
            return;
        }
        setNewRule({ name: '', vehicle_type: '', multiplier: '1.5', hour_start: '', hour_end: '' });
        setMessage({ type: 'success', text: 'Regla creada.' });
        fetchRules();
    };

    const toggleRule = async (rule) => {
        await supabase
            .from('pricing_rules')
            .update({ active: !rule.active })
            .eq('id', rule.id);
        fetchRules();
    };

    const deleteRule = async (rule) => {
        if (!confirm(`¿Eliminar regla "${rule.name}"?`)) return;
        await supabase.from('pricing_rules').delete().eq('id', rule.id);
        fetchRules();
    };

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

            {/* D.A2 — Reglas de surge pricing */}
            <div className="max-w-6xl lg:max-w-7xl mx-auto mt-10">
                <h2 className="text-lg font-bold mb-1 flex items-center gap-2">
                    <span className="material-symbols-outlined text-amber-400">trending_up</span>
                    Reglas de surge
                </h2>
                <p className="text-xs text-gray-500 mb-4">
                    Multiplicadores aplicados sobre la tarifa base según horario y día. Se evalúan en cada cálculo de precio. Si varias matchean al mismo tiempo, gana el multiplier más alto.
                </p>

                {/* Lista de reglas */}
                <div className="bg-[#1A1F2E] rounded-2xl border border-white/5 overflow-hidden mb-4">
                    {rules.length === 0 ? (
                        <p className="text-center text-gray-500 text-sm py-8">
                            Sin reglas configuradas. Las tarifas se cobran a 1.0x siempre.
                        </p>
                    ) : (
                        <ul className="divide-y divide-white/5">
                            {rules.map(r => (
                                <li key={r.id} className="p-4 flex items-center gap-3 flex-wrap">
                                    <div className={`w-2 h-2 rounded-full ${r.active ? 'bg-emerald-500' : 'bg-gray-600'}`} />
                                    <div className="flex-1 min-w-0">
                                        <p className="font-bold text-sm">{r.name}</p>
                                        <p className="text-xs text-gray-400">
                                            <span className="font-mono text-amber-400">x{r.multiplier}</span>
                                            {r.vehicle_type ? ` · ${r.vehicle_type}` : ' · todos'}
                                            {(r.hour_start !== null || r.hour_end !== null) && (
                                                <> · {String(r.hour_start ?? '?').padStart(2, '0')}:00–{String(r.hour_end ?? '?').padStart(2, '0')}:00</>
                                            )}
                                        </p>
                                    </div>
                                    <button
                                        onClick={() => toggleRule(r)}
                                        className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
                                            r.active
                                                ? 'bg-emerald-500/15 text-emerald-400'
                                                : 'bg-white/5 text-gray-400'
                                        }`}
                                    >
                                        {r.active ? 'Activa' : 'Inactiva'}
                                    </button>
                                    <button
                                        onClick={() => deleteRule(r)}
                                        className="px-3 py-1.5 rounded-lg text-xs font-bold bg-rose-500/10 text-rose-400 hover:bg-rose-500/20"
                                    >
                                        Eliminar
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>

                {/* Form crear */}
                <div className="bg-[#1A1F2E] rounded-2xl border border-white/5 p-4">
                    <p className="text-sm font-bold mb-3">Crear regla nueva</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2 mb-3">
                        <input
                            type="text" placeholder="Nombre (ej: Viernes noche)"
                            value={newRule.name}
                            onChange={e => setNewRule({ ...newRule, name: e.target.value })}
                            className="bg-[#0F1014] border border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus:border-amber-500"
                        />
                        <select
                            value={newRule.vehicle_type}
                            onChange={e => setNewRule({ ...newRule, vehicle_type: e.target.value })}
                            className="bg-[#0F1014] border border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus:border-amber-500"
                        >
                            <option value="">Todos los vehículos</option>
                            <option value="moto">Solo Moto</option>
                            <option value="standard">Solo Carro</option>
                            <option value="van">Solo Camioneta</option>
                        </select>
                        <input
                            type="number" step="0.1" min="0.5" max="5.0"
                            placeholder="Multiplier"
                            value={newRule.multiplier}
                            onChange={e => setNewRule({ ...newRule, multiplier: e.target.value })}
                            className="bg-[#0F1014] border border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus:border-amber-500"
                        />
                        <input
                            type="number" min="0" max="23"
                            placeholder="Hora inicio (0-23)"
                            value={newRule.hour_start}
                            onChange={e => setNewRule({ ...newRule, hour_start: e.target.value })}
                            className="bg-[#0F1014] border border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus:border-amber-500"
                        />
                        <input
                            type="number" min="0" max="23"
                            placeholder="Hora fin (0-23)"
                            value={newRule.hour_end}
                            onChange={e => setNewRule({ ...newRule, hour_end: e.target.value })}
                            className="bg-[#0F1014] border border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus:border-amber-500"
                        />
                    </div>
                    <button
                        onClick={createRule}
                        className="w-full sm:w-auto bg-amber-500 hover:bg-amber-600 text-black font-bold px-5 py-2 rounded-lg text-sm flex items-center gap-2 justify-center"
                    >
                        <span className="material-symbols-outlined text-[18px]">add</span>
                        Crear regla
                    </button>
                    <p className="text-[10px] text-gray-500 mt-3">
                        Si dejás horas vacías, aplica todo el día. Hora fin menor que inicio = rango cruza medianoche (ej. 22→4 = 10pm a 4am).
                    </p>
                </div>
            </div>
        </div>
    );
};

export default AdminPricingPage;
