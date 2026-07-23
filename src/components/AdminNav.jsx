import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { supabase } from '../services/supabase';
import { getAdminContext } from '../services/adminApi';
import { useAdminKeyboardNav } from '../hooks/useAdminKeyboardNav';

const SHOP_ENABLED = import.meta.env.VITE_SHOP_ENABLED !== 'false';

const GROUPS = [
    {
        label: 'Principal',
        items: [
            { to: '/admin/dashboard', label: 'Resumen', icon: 'dashboard' },
            { to: '/admin/drivers', label: 'Drivers y membresías', icon: 'badge' },
            { to: '/admin/analytics', label: 'Analítica', icon: 'monitoring' },
        ],
    },
    {
        label: 'Operación',
        items: [
            { to: '/admin/deliveries', label: 'Envíos', icon: 'inventory_2' },
            { to: '/admin/disputes', label: 'Disputas', icon: 'report' },
            { to: '/admin/support', label: 'Soporte', icon: 'support_agent', badge: 'support' },
            { to: '/admin/fraud', label: 'Alertas', icon: 'crisis_alert' },
        ],
    },
    {
        label: 'Crecimiento',
        items: [
            { to: '/admin/users', label: 'Usuarios y staff', icon: 'group' },
            { to: '/admin/promos', label: 'Promociones', icon: 'local_offer', permission: 'super_admin' },
        ],
    },
    {
        label: 'Configuración',
        items: [
            { to: '/admin/pricing', label: 'Tarifas', icon: 'payments' },
            { to: '/admin/zones', label: 'Zonas', icon: 'place' },
            { to: '/admin/shop', label: 'Higo Shop', icon: 'shopping_bag', shop: true },
        ],
    },
];

export default function AdminNav() {
    const { pathname } = useLocation();
    const [supportUnread, setSupportUnread] = useState(0);
    const [context, setContext] = useState(null);
    const [open, setOpen] = useState(false);
    useAdminKeyboardNav();

    useEffect(() => {
        getAdminContext().then(setContext).catch(() => setContext(null));
    }, []);

    useEffect(() => {
        let active = true;
        const refresh = async () => {
            const { count } = await supabase
                .from('support_threads')
                .select('id', { count: 'exact', head: true })
                .eq('status', 'open')
                .eq('unread_for_admin', true);
            if (active) setSupportUnread(count || 0);
        };
        refresh();
        const ch = supabase.channel('admin-nav-support')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'support_threads' }, refresh)
            .subscribe();
        return () => { active = false; supabase.removeChannel(ch); };
    }, []);

    const groups = useMemo(() => GROUPS.map(group => ({
        ...group,
        items: group.items.filter(item => {
            if (item.shop && !SHOP_ENABLED) return false;
            if (item.permission === 'super_admin' && context?.staff_role !== 'super_admin') return false;
            return true;
        }),
    })).filter(group => group.items.length), [context]);

    const content = (
        <div className="space-y-5">
            {groups.map(group => (
                <div key={group.label}>
                    <p className="px-3 mb-1 text-[10px] uppercase tracking-[0.18em] font-black text-gray-600">{group.label}</p>
                    <div className="space-y-1">
                        {group.items.map(item => {
                            const active = pathname === item.to;
                            const badge = item.badge === 'support' ? supportUnread : 0;
                            return (
                                <Link key={item.to} to={item.to} onClick={() => setOpen(false)}
                                    className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold transition-colors ${active ? 'bg-violet-600 text-white' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}>
                                    <span className="material-symbols-outlined text-[19px]">{item.icon}</span>
                                    <span className="flex-1">{item.label}</span>
                                    {badge > 0 && <span className="min-w-5 h-5 px-1.5 rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center">{badge > 99 ? '99+' : badge}</span>}
                                </Link>
                            );
                        })}
                    </div>
                </div>
            ))}
            {context?.staff_role && (
                <div className="px-3 pt-3 border-t border-white/5">
                    <p className="text-[10px] text-gray-600 uppercase">Perfil administrativo</p>
                    <p className="text-xs text-gray-400 mt-1">{context.staff_role.replace('_', ' ')}</p>
                </div>
            )}
        </div>
    );

    return (
        <>
            <div className="lg:hidden mb-5 flex items-center justify-between bg-[#1A1F2E] border border-white/5 rounded-2xl p-2">
                <span className="px-3 font-bold text-sm text-white">Administración</span>
                <button onClick={() => setOpen(v => !v)} className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center" aria-label="Abrir navegación">
                    <span className="material-symbols-outlined">{open ? 'close' : 'menu'}</span>
                </button>
            </div>
            {open && <div className="lg:hidden mb-6 bg-[#1A1F2E] border border-white/5 rounded-2xl p-3">{content}</div>}
            <aside className="hidden lg:block fixed left-4 top-4 bottom-4 w-64 bg-[#151925] border border-white/5 rounded-3xl p-4 overflow-y-auto z-30">
                <Link to="/admin/dashboard" className="flex items-center gap-3 px-2 mb-6">
                    <div className="w-10 h-10 rounded-xl bg-violet-600 flex items-center justify-center"><span className="material-symbols-outlined">admin_panel_settings</span></div>
                    <div><p className="font-black">Higo Admin</p><p className="text-[10px] text-gray-500">Membresías y operación</p></div>
                </Link>
                {content}
            </aside>
            <div className="hidden lg:block w-64 shrink-0" aria-hidden="true" />
        </>
    );
}
