import React, { useEffect, useState } from 'react';
import AdminNav from '../components/AdminNav';
import { supabase } from '../services/supabase';
import { archivePromo, saveFundedPromo } from '../services/adminApi';
import { toast } from '../components/Toast';

const EMPTY = {
    code: '', description: '', discount_type: 'percent', discount_value: 10,
    max_uses: '', max_uses_per_user: 1, min_ride_amount: 0, expires_at: '', active: true,
    funding_source: 'higo', sponsor_name: '', budget_amount: '',
};

const money = v => `$${Number(v || 0).toFixed(2)}`;

export default function AdminPromoCodesPage() {
    const [promos, setPromos] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [editing, setEditing] = useState(null);
    const [form, setForm] = useState(EMPTY);

    const load = async () => {
        setLoading(true);
        const { data, error } = await supabase.from('promo_codes').select('*').is('archived_at', null).order('created_at', { ascending: false });
        if (error) toast.error(error.message);
        setPromos(data || []);
        setLoading(false);
    };
    useEffect(() => { load(); }, []);

    const open = promo => {
        setEditing(promo || null);
        setForm(promo ? {
            code: promo.code, description: promo.description || '', discount_type: promo.discount_type,
            discount_value: promo.discount_value, max_uses: promo.max_uses ?? '', max_uses_per_user: promo.max_uses_per_user ?? 1,
            min_ride_amount: promo.min_ride_amount ?? 0, expires_at: promo.expires_at?.slice(0,10) || '', active: promo.active,
            funding_source: promo.funding_source || 'higo', sponsor_name: promo.sponsor_name || '', budget_amount: promo.budget_amount ?? '',
        } : EMPTY);
        setShowModal(true);
    };

    const save = async () => {
        if (!form.code.trim()) return toast.error('El código es obligatorio.');
        if (!(Number(form.budget_amount) > 0)) return toast.error('Cada promoción debe tener un presupuesto mayor que cero.');
        if (form.funding_source === 'sponsor' && !form.sponsor_name.trim()) return toast.error('Indicá el patrocinador.');
        try {
            await saveFundedPromo(editing?.id, {
                ...form,
                code: form.code.trim().toUpperCase(),
                description: form.description.trim(),
                discount_value: Number(form.discount_value),
                max_uses: form.max_uses === '' ? '' : Number(form.max_uses),
                max_uses_per_user: Number(form.max_uses_per_user || 1),
                min_ride_amount: Number(form.min_ride_amount || 0),
                budget_amount: Number(form.budget_amount),
            });
            toast.success(editing ? 'Promoción actualizada.' : 'Promoción creada con presupuesto y responsable.');
            setShowModal(false); load();
        } catch (err) { toast.error(err.message); }
    };

    const archive = async promo => {
        const reason = prompt(`Archivar ${promo.code}. Motivo obligatorio:`, '');
        if (!reason?.trim()) return;
        try { await archivePromo(promo.id, reason); toast.success('Promoción archivada; el historial se conserva.'); load(); }
        catch (err) { toast.error(err.message); }
    };

    const toggle = async promo => {
        try {
            await saveFundedPromo(promo.id, {
                ...promo,
                active: !promo.active,
                expires_at: promo.expires_at?.slice(0,10) || '',
                max_uses: promo.max_uses ?? '',
                sponsor_name: promo.sponsor_name || '',
                budget_amount: promo.budget_amount,
            });
            load();
        } catch (err) { toast.error(err.message); }
    };

    return (
        <div className="min-h-screen bg-[#0F1014] text-white p-4 md:p-8">
            <AdminNav />
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-6">
                <div><h1 className="text-2xl font-black">Promociones financiadas</h1><p className="text-sm text-gray-400 mt-1">Todo descuento debe indicar quién lo financia y cuál es su presupuesto.</p></div>
                <button onClick={() => open(null)} className="px-5 py-3 rounded-xl bg-violet-600 font-bold flex items-center gap-2"><span className="material-symbols-outlined">add</span>Nueva promoción</button>
            </div>
            <div className="p-4 mb-6 rounded-xl bg-amber-500/10 border border-amber-500/25 text-sm text-amber-100/80">Higo no obtiene comisión de los viajes. Una promoción reduce lo que paga el pasajero y debe ser asumida por Higo, un patrocinador o una campaña acordada con drivers.</div>

            {loading ? <div className="py-24 flex justify-center"><div className="w-8 h-8 border-4 border-violet-500 border-t-transparent rounded-full animate-spin" /></div> : <div className="space-y-3">{promos.map(promo => {
                const remaining = Math.max(0, Number(promo.budget_amount || 0) - Number(promo.spent_amount || 0));
                return <article key={promo.id} className="bg-[#1A1F2E] border border-white/5 rounded-2xl p-4 md:p-5 grid lg:grid-cols-[1.2fr_1fr_1fr_auto] gap-4 items-center">
                    <div><div className="flex gap-2 items-center"><span className="font-mono font-black text-violet-300 bg-violet-500/10 border border-violet-500/20 px-3 py-1.5 rounded-lg">{promo.code}</span><span className={`text-[10px] px-2 py-1 rounded-full ${promo.active ? 'bg-emerald-500/15 text-emerald-300' : 'bg-gray-500/15 text-gray-400'}`}>{promo.active ? 'Activa' : 'Inactiva'}</span></div><p className="text-sm text-gray-400 mt-2">{promo.description || 'Sin descripción'}</p></div>
                    <div><p className="text-xs text-gray-500 uppercase font-bold">Descuento</p><p className="font-black text-lg">{promo.discount_type === 'percent' ? `${promo.discount_value}%` : money(promo.discount_value)}</p><p className="text-[10px] text-gray-600">Usos: {promo.used_count || 0}{promo.max_uses ? ` / ${promo.max_uses}` : ''}</p></div>
                    <div><p className="text-xs text-gray-500 uppercase font-bold">Financiamiento</p><p className="font-bold capitalize">{promo.funding_source?.replace('_',' ')}</p>{promo.sponsor_name && <p className="text-xs text-gray-400">{promo.sponsor_name}</p>}<p className="text-xs text-gray-500 mt-1">Presupuesto {money(promo.budget_amount)} · disponible {money(remaining)}</p></div>
                    <div className="flex gap-2"><button onClick={() => toggle(promo)} className="px-3 py-2 rounded-lg bg-white/5 text-xs font-bold">{promo.active ? 'Pausar' : 'Activar'}</button><button onClick={() => open(promo)} className="w-9 h-9 rounded-lg bg-blue-500/10 text-blue-300"><span className="material-symbols-outlined text-lg">edit</span></button><button onClick={() => archive(promo)} className="w-9 h-9 rounded-lg bg-red-500/10 text-red-300"><span className="material-symbols-outlined text-lg">archive</span></button></div>
                </article>;
            })}{!promos.length && <div className="py-20 text-center rounded-2xl bg-[#1A1F2E] border border-dashed border-white/10 text-gray-500">No hay promociones activas o archivadas pendientes.</div>}</div>}

            {showModal && <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"><div className="w-full max-w-2xl bg-[#1A1F2E] border border-white/10 rounded-3xl my-8"><div className="flex justify-between items-center px-6 py-4 border-b border-white/5"><h2 className="font-black text-lg">{editing ? 'Editar promoción' : 'Nueva promoción'}</h2><button onClick={() => setShowModal(false)} className="w-9 h-9 rounded-full bg-white/5"><span className="material-symbols-outlined">close</span></button></div><div className="p-6 grid md:grid-cols-2 gap-4">
                <Field label="Código"><input disabled={!!editing} value={form.code} onChange={e => setForm({...form, code:e.target.value.toUpperCase()})} className="input" placeholder="HIGUEROTE10" /></Field>
                <Field label="Descripción"><input value={form.description} onChange={e => setForm({...form, description:e.target.value})} className="input" /></Field>
                <Field label="Tipo de descuento"><select value={form.discount_type} onChange={e => setForm({...form, discount_type:e.target.value})} className="input"><option value="percent">Porcentaje</option><option value="fixed">Monto fijo</option></select></Field>
                <Field label="Valor"><input type="number" min="0" step="0.01" value={form.discount_value} onChange={e => setForm({...form, discount_value:e.target.value})} className="input" /></Field>
                <Field label="Fuente de financiamiento"><select value={form.funding_source} onChange={e => setForm({...form, funding_source:e.target.value})} className="input"><option value="higo">Higo</option><option value="sponsor">Patrocinador</option><option value="driver_campaign">Campaña con drivers</option></select></Field>
                <Field label="Presupuesto máximo"><input type="number" min="0.01" step="0.01" value={form.budget_amount} onChange={e => setForm({...form, budget_amount:e.target.value})} className="input" /></Field>
                {form.funding_source === 'sponsor' && <Field label="Patrocinador"><input value={form.sponsor_name} onChange={e => setForm({...form, sponsor_name:e.target.value})} className="input" /></Field>}
                <Field label="Máximo de usos"><input type="number" min="1" value={form.max_uses} onChange={e => setForm({...form, max_uses:e.target.value})} className="input" placeholder="Sin límite" /></Field>
                <Field label="Usos por usuario"><input type="number" min="1" value={form.max_uses_per_user} onChange={e => setForm({...form, max_uses_per_user:e.target.value})} className="input" /></Field>
                <Field label="Monto mínimo del viaje"><input type="number" min="0" step="0.01" value={form.min_ride_amount} onChange={e => setForm({...form, min_ride_amount:e.target.value})} className="input" /></Field>
                <Field label="Vencimiento"><input type="date" value={form.expires_at} onChange={e => setForm({...form, expires_at:e.target.value})} className="input" /></Field>
                <label className="flex items-center gap-3 p-3 bg-[#0F1014] border border-white/10 rounded-xl"><input type="checkbox" checked={form.active} onChange={e => setForm({...form, active:e.target.checked})} /> Activar al guardar</label>
                <div className="md:col-span-2"><button onClick={save} className="w-full py-3 rounded-xl bg-violet-600 font-bold">Guardar promoción financiada</button></div>
            </div></div></div>}
            <style>{`.input{width:100%;margin-top:.25rem;padding:.75rem;background:#0F1014;border:1px solid rgba(255,255,255,.1);border-radius:.75rem;outline:none}.input:focus{border-color:#8b5cf6}`}</style>
        </div>
    );
}

const Field = ({ label, children }) => <label className="text-xs uppercase font-bold text-gray-500">{label}{children}</label>;
