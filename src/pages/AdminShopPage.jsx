import React, { useEffect, useMemo, useState } from 'react';
import AdminNav from '../components/AdminNav';
import { supabase } from '../services/supabase';
import { toast } from '../components/Toast';

const money = value => `$${Number(value || 0).toFixed(2)}`;
const fmtDate = value => value ? new Date(value).toLocaleString('es-VE') : '—';

export default function AdminShopPage() {
    const [tab, setTab] = useState('summary');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [stores, setStores] = useState([]);
    const [orders, setOrders] = useState([]);
    const [memberships, setMemberships] = useState([]);

    const load = async () => {
        setLoading(true); setError('');
        const [storesRes, ordersRes, membershipsRes] = await Promise.all([
            supabase.from('stores').select('id,name,category,address,phone,is_open,created_at').order('created_at', { ascending: false }),
            supabase.from('orders').select('id,store_id,status,total,created_at,stores(name)').order('created_at', { ascending: false }).limit(200),
            supabase.from('store_memberships').select('id,store_id,amount,status,paid_at,expires_at,payment_method,reference,stores(name)').order('expires_at', { ascending: false }),
        ]);
        const failures = [storesRes.error, ordersRes.error, membershipsRes.error].filter(Boolean);
        if (failures.length) setError(failures.map(e => e.message).join(' · '));
        setStores(storesRes.data || []);
        setOrders(ordersRes.data || []);
        setMemberships(membershipsRes.data || []);
        setLoading(false);
    };
    useEffect(() => { load(); }, []);

    const metrics = useMemo(() => {
        const today = new Date(); today.setHours(0,0,0,0);
        const activeMemberships = memberships.filter(m => m.status === 'active' && new Date(m.expires_at) >= new Date());
        const deliveredToday = orders.filter(o => o.status === 'DELIVERED' && new Date(o.created_at) >= today);
        return {
            stores: stores.length,
            openStores: stores.filter(s => s.is_open).length,
            deliveredToday: deliveredToday.length,
            orderVolumeToday: deliveredToday.reduce((sum,o) => sum + Number(o.total || 0), 0),
            activeMemberships: activeMemberships.length,
            membershipRevenue: memberships.reduce((sum,m) => sum + Number(m.amount || 0), 0),
        };
    }, [stores, orders, memberships]);

    const toggleStore = async store => {
        const { error: updateError } = await supabase.from('stores').update({ is_open: !store.is_open }).eq('id', store.id);
        if (updateError) toast.error(updateError.message); else { toast.success('Estado del comercio actualizado.'); load(); }
    };

    return (
        <div className="min-h-screen bg-[#0F1014] text-white p-4 md:p-8">
            <AdminNav />
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-6"><div><h1 className="text-2xl font-black">Higo Shop</h1><p className="text-sm text-gray-400 mt-1">Módulo secundario, separado de las membresías de Higo Drivers.</p></div><button onClick={load} className="px-4 py-3 rounded-xl bg-white/5 font-bold flex items-center gap-2"><span className="material-symbols-outlined">refresh</span>Actualizar</button></div>
            <div className="p-4 mb-6 rounded-xl bg-blue-500/10 border border-blue-500/20 text-sm text-blue-100/75">Esta pantalla no genera datos simulados. Si una tabla no existe o falla, se muestra el error y el valor queda vacío.</div>
            {error && <div className="p-4 mb-6 rounded-xl bg-red-500/10 border border-red-500/25 text-red-300">Datos incompletos: {error}</div>}

            <div className="flex gap-2 border-b border-white/5 mb-6 overflow-x-auto">{[['summary','Resumen'],['stores','Comercios'],['orders','Órdenes'],['memberships','Membresías de comercios']].map(([id,label]) => <button key={id} onClick={() => setTab(id)} className={`px-4 py-3 text-sm font-bold border-b-2 whitespace-nowrap ${tab === id ? 'border-orange-500 text-white' : 'border-transparent text-gray-500'}`}>{label}</button>)}</div>

            {loading ? <div className="py-24 flex justify-center"><div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" /></div> : <>
                {tab === 'summary' && <div className="grid grid-cols-2 lg:grid-cols-3 gap-4"><Card label="Comercios" value={metrics.stores} note={`${metrics.openStores} abiertos`} icon="storefront" /><Card label="Órdenes entregadas hoy" value={metrics.deliveredToday} note={`Volumen ${money(metrics.orderVolumeToday)}`} icon="shopping_bag" /><Card label="Membresías de comercios" value={metrics.activeMemberships} note={`Recaudación histórica ${money(metrics.membershipRevenue)}`} icon="verified" /></div>}
                {tab === 'stores' && <div className="space-y-3">{stores.map(store => <article key={store.id} className="bg-[#1A1F2E] border border-white/5 rounded-2xl p-4 flex flex-col md:flex-row md:items-center gap-4"><div className="flex-1"><p className="font-bold">{store.name}</p><p className="text-xs text-gray-400 mt-1">{store.category || 'Sin categoría'} · {store.address || 'Sin dirección'} · {store.phone || 'Sin teléfono'}</p></div><span className={`text-xs px-3 py-1 rounded-full ${store.is_open ? 'bg-emerald-500/15 text-emerald-300' : 'bg-gray-500/15 text-gray-400'}`}>{store.is_open ? 'Abierto' : 'Cerrado'}</span><button onClick={() => toggleStore(store)} className="px-3 py-2 rounded-lg bg-white/5 text-xs font-bold">{store.is_open ? 'Cerrar' : 'Abrir'}</button></article>)}{!stores.length && <Empty text="No hay comercios reales para mostrar." />}</div>}
                {tab === 'orders' && <div className="overflow-x-auto bg-[#1A1F2E] border border-white/5 rounded-2xl"><table className="w-full text-sm"><thead className="text-xs uppercase text-gray-500"><tr><th className="p-4 text-left">Orden</th><th className="p-4 text-left">Comercio</th><th className="p-4 text-left">Estado</th><th className="p-4 text-right">Total</th><th className="p-4 text-left">Fecha</th></tr></thead><tbody>{orders.map(order => <tr key={order.id} className="border-t border-white/5"><td className="p-4 font-mono">#{order.id}</td><td className="p-4">{order.stores?.name || order.store_id}</td><td className="p-4 text-xs">{order.status}</td><td className="p-4 text-right font-mono">{money(order.total)}</td><td className="p-4 text-gray-400">{fmtDate(order.created_at)}</td></tr>)}</tbody></table>{!orders.length && <Empty text="No hay órdenes reales para mostrar." />}</div>}
                {tab === 'memberships' && <div className="space-y-3">{memberships.map(item => <article key={item.id} className="bg-[#1A1F2E] border border-white/5 rounded-2xl p-4 grid md:grid-cols-4 gap-4"><div><p className="font-bold">{item.stores?.name || item.store_id}</p><p className="text-xs text-gray-500">{item.status}</p></div><div><p className="text-xs text-gray-500 uppercase">Monto</p><p className="font-mono">{money(item.amount)}</p></div><div><p className="text-xs text-gray-500 uppercase">Vigencia</p><p className="text-sm">{fmtDate(item.paid_at)} → {fmtDate(item.expires_at)}</p></div><div><p className="text-xs text-gray-500 uppercase">Referencia</p><p className="text-sm font-mono">{item.reference || '—'}</p></div></article>)}{!memberships.length && <Empty text="No hay membresías reales de comercios." />}</div>}
            </>}
        </div>
    );
}

const Card = ({ label, value, note, icon }) => <div className="bg-[#1A1F2E] border border-white/5 rounded-2xl p-5"><div className="flex gap-3 items-center mb-3"><div className="w-10 h-10 rounded-xl bg-orange-500/20 text-orange-300 flex items-center justify-center"><span className="material-symbols-outlined">{icon}</span></div><p className="text-sm text-gray-400">{label}</p></div><p className="text-3xl font-black">{value}</p><p className="text-xs text-gray-500 mt-2">{note}</p></div>;
const Empty = ({ text }) => <div className="py-16 text-center text-gray-500">{text}</div>;
