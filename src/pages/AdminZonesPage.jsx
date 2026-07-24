import React, { useEffect, useMemo, useState } from 'react';
import AdminNav from '../components/AdminNav';
import { supabase } from '../services/supabase';
import { toast } from '../components/Toast';

const EMPTY = { name: '', center_lat: '10.4862', center_lng: '-66.0944', radius_km: 30, active: true };

export default function AdminZonesPage() {
    const [zones, setZones] = useState([]);
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState(null);
    const [form, setForm] = useState(EMPTY);
    const [showModal, setShowModal] = useState(false);

    const load = async () => {
        setLoading(true);
        const { data, error } = await supabase.from('coverage_zones').select('*').order('created_at', { ascending: false });
        if (error) toast.error(error.message);
        setZones(data || []);
        setLoading(false);
    };
    useEffect(() => { load(); }, []);

    const mapUrl = useMemo(() => {
        const lat = Number(form.center_lat) || 10.4862;
        const lng = Number(form.center_lng) || -66.0944;
        return `https://www.google.com/maps?q=${lat},${lng}&z=11&output=embed`;
    }, [form.center_lat, form.center_lng]);

    const open = zone => {
        setEditing(zone || null);
        setForm(zone ? { name: zone.name, center_lat: String(zone.center_lat), center_lng: String(zone.center_lng), radius_km: zone.radius_km, active: zone.active } : EMPTY);
        setShowModal(true);
    };

    const save = async () => {
        const lat = Number(form.center_lat), lng = Number(form.center_lng), radius = Number(form.radius_km);
        if (!form.name.trim() || !Number.isFinite(lat) || !Number.isFinite(lng) || !(radius > 0)) return toast.error('Completá nombre, coordenadas y radio válidos.');
        const payload = { name: form.name.trim(), center_lat: lat, center_lng: lng, radius_km: radius, active: !!form.active };
        const { error } = editing
            ? await supabase.from('coverage_zones').update(payload).eq('id', editing.id)
            : await supabase.from('coverage_zones').insert(payload);
        if (error) return toast.error(error.message);
        toast.success(editing ? 'Zona actualizada.' : 'Zona creada.');
        setShowModal(false); load();
    };

    const toggle = async zone => {
        const { error } = await supabase.from('coverage_zones').update({ active: !zone.active }).eq('id', zone.id);
        if (error) toast.error(error.message); else load();
    };

    const archive = async zone => {
        const reason = prompt(`Desactivar la zona “${zone.name}”. Motivo:`, '');
        if (!reason?.trim()) return;
        const { error } = await supabase.rpc('admin_archive_zone', { p_id: zone.id, p_reason: reason.trim() });
        if (error) return toast.error(error.message);
        toast.success('Zona desactivada y auditada sin borrar su historial.');
        load();
    };

    return (
        <div className="min-h-screen bg-[#0F1014] text-white p-4 md:p-8">
            <AdminNav />
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-6"><div><h1 className="text-2xl font-black">Zonas de cobertura</h1><p className="text-sm text-gray-400 mt-1">Configuración visual del centro y radio de operación.</p></div><button onClick={() => open(null)} className="px-5 py-3 rounded-xl bg-teal-600 font-bold flex items-center gap-2"><span className="material-symbols-outlined">add_location</span>Nueva zona</button></div>
            {loading ? <div className="py-24 flex justify-center"><div className="w-8 h-8 border-4 border-teal-500 border-t-transparent rounded-full animate-spin" /></div> : <div className="grid lg:grid-cols-2 gap-4">{zones.map(zone => <article key={zone.id} className="bg-[#1A1F2E] border border-white/5 rounded-2xl overflow-hidden"><iframe title={`Mapa ${zone.name}`} src={`https://www.google.com/maps?q=${zone.center_lat},${zone.center_lng}&z=11&output=embed`} className="w-full h-48 border-0" loading="lazy" /><div className="p-5 flex gap-4 items-center"><div className="flex-1"><div className="flex items-center gap-2"><h2 className="font-black text-lg">{zone.name}</h2><span className={`text-[10px] px-2 py-1 rounded-full ${zone.active ? 'bg-emerald-500/15 text-emerald-300' : 'bg-gray-500/15 text-gray-400'}`}>{zone.active ? 'Activa' : 'Inactiva'}</span></div><p className="text-xs text-gray-400 font-mono mt-2">{Number(zone.center_lat).toFixed(4)}, {Number(zone.center_lng).toFixed(4)} · radio {zone.radius_km} km</p></div><div className="flex gap-2"><button onClick={() => toggle(zone)} className="px-3 py-2 rounded-lg bg-white/5 text-xs font-bold">{zone.active ? 'Pausar' : 'Activar'}</button><button onClick={() => open(zone)} className="w-9 h-9 rounded-lg bg-blue-500/10 text-blue-300"><span className="material-symbols-outlined text-lg">edit</span></button>{zone.active && <button onClick={() => archive(zone)} className="w-9 h-9 rounded-lg bg-red-500/10 text-red-300" title="Desactivar sin borrar"><span className="material-symbols-outlined text-lg">archive</span></button>}</div></div></article>)}{!zones.length && <div className="lg:col-span-2 py-20 text-center rounded-2xl bg-[#1A1F2E] border border-dashed border-white/10 text-gray-500">No hay zonas configuradas.</div>}</div>}

            {showModal && <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"><div className="w-full max-w-3xl bg-[#1A1F2E] border border-white/10 rounded-3xl my-8 overflow-hidden"><div className="flex justify-between items-center px-6 py-4 border-b border-white/5"><h2 className="font-black text-lg">{editing ? 'Editar zona' : 'Nueva zona'}</h2><button onClick={() => setShowModal(false)} className="w-9 h-9 rounded-full bg-white/5"><span className="material-symbols-outlined">close</span></button></div><div className="grid md:grid-cols-2"><div className="p-6 space-y-4"><Field label="Nombre"><input value={form.name} onChange={e => setForm({...form,name:e.target.value})} className="input" /></Field><div className="grid grid-cols-2 gap-3"><Field label="Latitud"><input type="number" step="0.0001" value={form.center_lat} onChange={e => setForm({...form,center_lat:e.target.value})} className="input" /></Field><Field label="Longitud"><input type="number" step="0.0001" value={form.center_lng} onChange={e => setForm({...form,center_lng:e.target.value})} className="input" /></Field></div><Field label="Radio en kilómetros"><input type="number" min="1" step="0.5" value={form.radius_km} onChange={e => setForm({...form,radius_km:e.target.value})} className="input" /></Field><label className="flex gap-3 items-center p-3 bg-[#0F1014] border border-white/10 rounded-xl"><input type="checkbox" checked={form.active} onChange={e => setForm({...form,active:e.target.checked})} /> Zona activa</label><button onClick={save} className="w-full py-3 rounded-xl bg-teal-600 font-bold">Guardar zona</button></div><div className="min-h-[380px] bg-white"><iframe title="Vista previa de la zona" src={mapUrl} className="w-full h-full min-h-[380px] border-0" /></div></div></div></div>}
            <style>{`.input{width:100%;margin-top:.25rem;padding:.75rem;background:#0F1014;border:1px solid rgba(255,255,255,.1);border-radius:.75rem;outline:none}.input:focus{border-color:#14b8a6}`}</style>
        </div>
    );
}
const Field = ({ label, children }) => <label className="text-xs uppercase font-bold text-gray-500">{label}{children}</label>;
