import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { supabase } from '../services/supabase';
import { useAdminKeyboardNav } from '../hooks/useAdminKeyboardNav';

const TABS = [
    { to: '/admin/dashboard', label: 'Dashboard',   icon: 'dashboard',      shortcut: 'g d' },
    { to: '/admin/drivers',   label: 'Conductores', icon: 'directions_car', shortcut: 'g v' },
    { to: '/admin/users',     label: 'Usuarios',    icon: 'group',          shortcut: 'g u' },
    { to: '/admin/pricing',   label: 'Tarifas',     icon: 'payments',       shortcut: 'g p' },
    { to: '/admin/promos',    label: 'Promos',      icon: 'local_offer',    shortcut: 'g r' },
    { to: '/admin/disputes',  label: 'Disputas',    icon: 'report',         shortcut: 'g t' },
    { to: '/admin/support',   label: 'Soporte',     icon: 'support_agent',  shortcut: 'g s', badge: 'support' },
    { to: '/admin/fraud',     label: 'Fraud',       icon: 'crisis_alert',   shortcut: 'g f' },
    { to: '/admin/analytics', label: 'Analytics',   icon: 'bar_chart',      shortcut: 'g a' },
    { to: '/admin/zones',     label: 'Zonas',       icon: 'place',          shortcut: 'g z' },
];

const AdminNav = () => {
    const { pathname } = useLocation();
    const [supportUnread, setSupportUnread] = useState(0);
    // Keyboard shortcuts globales del panel admin (D.X4).
    useAdminKeyboardNav();

    // Contador global de hilos de soporte sin leer (para badge en la tab).
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

        const channel = supabase
            .channel('admin_nav_support_unread')
            .on('postgres_changes',
                { event: '*', schema: 'public', table: 'support_threads' },
                () => refresh())
            .subscribe();

        return () => { active = false; supabase.removeChannel(channel); };
    }, []);

    return (
        <nav className="bg-[#1A1F2E] rounded-[24px] border border-white/5 p-2 mb-6 flex gap-1 overflow-x-auto">
            {TABS.map(t => {
                const active = pathname === t.to;
                const showBadge = t.badge === 'support' && supportUnread > 0;
                return (
                    <Link
                        key={t.to}
                        to={t.to}
                        title={t.shortcut ? `Atajo: ${t.shortcut}` : undefined}
                        className={`relative flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm whitespace-nowrap transition-all ${active
                            ? 'bg-violet-600 text-white shadow-lg shadow-violet-600/20'
                            : 'text-gray-400 hover:text-white hover:bg-white/5'
                            }`}
                    >
                        <span className="material-symbols-outlined text-[18px]">{t.icon}</span>
                        {t.label}
                        {showBadge && (
                            <span className="ml-1 min-w-[20px] h-5 px-1.5 rounded-full bg-red-500 text-white text-[11px] font-black flex items-center justify-center">
                                {supportUnread > 99 ? '99+' : supportUnread}
                            </span>
                        )}
                    </Link>
                );
            })}
        </nav>
    );
};

export default AdminNav;
