import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { supabase } from '../services/supabase';
import { getAdminContext } from '../services/adminApi';
import { useAdminKeyboardNav } from '../hooks/useAdminKeyboardNav';

const SHOP_ENABLED = import.meta.env.VITE_SHOP_ENABLED !== 'false';

const ITEMS = [
    { to: '/admin/dashboard', label: 'Resumen', icon: 'dashboard', group: 'Principal', permission: 'view_dashboard' },
    { to: '/admin/drivers', label: 'Drivers y membresías', icon: 'badge', group: 'Principal', permission: 'manage_memberships' },
    { to: '/admin/analytics', label: 'Analítica', icon: 'monitoring', group: 'Principal', permission: 'view_analytics' },
    { to: '/admin/deliveries', label: 'Envíos', icon: 'inventory_2', group: 'Operación', permission: 'manage_operations' },
    { to: '/admin/disputes', label: 'Disputas', icon: 'report', group: 'Operación', permission: 'manage_disputes' },
    { to: '/admin/support', label: 'Soporte', icon: 'support_agent', group: 'Operación', permission: 'manage_support', badge: 'support' },
    { to: '/admin/fraud', label: 'Alertas', icon: 'crisis_alert', group: 'Operación', permission: 'manage_operations' },
    { to: '/admin/users', label: 'Usuarios y staff', icon: 'group', group: 'Gestión', permission: 'view_users' },
    { to: '/admin/promos', label: 'Promociones', icon: 'local_offer', group: 'Gestión', permission: 'manage_promos' },
    { to: '/admin/pricing', label: 'Tarifas', icon: 'payments', group: 'Configuración', permission: 'manage_pricing' },
    { to: '/admin/zones', label: 'Zonas', icon: 'place', group: 'Configuración', permission: 'manage_zones' },
    { to: '/admin/shop', label: 'Higo Shop', icon: 'shopping_bag', group: 'Configuración', permission: 'manage_shop', shop: true },
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
        if (!context?.permissions?.manage_support) return;
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
    }, [context?.permissions?.manage_support]);

    const groups = useMemo(() => {
        const visible = ITEMS.filter(item => {
            if (item.shop && !SHOP_ENABLED) return false;
            if (!context) return item.to === '/admin/dashboard';
            return !!context.permissions?.[item.permission];
        });
        return visible.reduce((acc, item) => {
            (acc[item.group] ||= []).push(item);
            return acc;
        }, {});
    }, [context]);

    const nav = (
        <div className="space-y-4 lg:space-y-0 lg:flex lg:items-center lg:gap-4">
            {Object.entries(groups).map(([group, items]) => (
                <div key={group} className="lg:flex lg:items-center lg:gap-1">
                    <p className="px-2 mb-1 lg:mb-0 text-[9px] uppercase tracking-[0.16em] font-black text-gray-600 lg:hidden">{group}</p>
                    {items.map(item => {
                        const active = pathname === item.to;
                        const badge = item.badge === 'support' ? supportUnread : 0;
                        return (
                            <Link key={item.to} to={item.to} onClick={() => setOpen(false)}
                                className={`relative flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-bold whitespace-nowrap transition-colors ${active ? 'bg-violet-600 text-white' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}>
                                <span className="material-symbols-outlined text-[18px]">{item.icon}</span>
                                <span>{item.label}</span>
                                {badge > 0 && <span className="min-w-5 h-5 px-1.5 rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center">{badge > 99 ? '99+' : badge}</span>}
                            </Link>
                        );
                    })}
                </div>
            ))}
            {context?.staff_role && <span className="lg:ml-auto text-[10px] uppercase tracking-wider text-gray-600 px-2">{context.staff_role.replace('_', ' ')}</span>}
        </div>
    );

    return (
        <nav className="bg-[#1A1F2E] border border-white/5 rounded-2xl p-2 mb-6">
            <div className="lg:hidden flex items-center justify-between">
                <Link to="/admin/dashboard" className="flex items-center gap-2 px-2 font-black"><span className="material-symbols-outlined text-violet-400">admin_panel_settings</span> Higo Admin</Link>
                <button onClick={() => setOpen(v => !v)} className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center" aria-label="Abrir navegación"><span className="material-symbols-outlined">{open ? 'close' : 'menu'}</span></button>
            </div>
            <div className={`${open ? 'block mt-3 pt-3 border-t border-white/5' : 'hidden'} lg:block lg:overflow-x-auto`}>{nav}</div>
        </nav>
    );
}
