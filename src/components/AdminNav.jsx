import React from 'react';
import { Link, useLocation } from 'react-router-dom';

const TABS = [
    { to: '/admin/drivers',  label: 'Conductores', icon: 'directions_car' },
    { to: '/admin/users',    label: 'Usuarios',    icon: 'group' },
    { to: '/admin/pricing',  label: 'Tarifas',     icon: 'payments' },
    { to: '/admin/promos',   label: 'Promos',      icon: 'local_offer' },
    { to: '/admin/disputes', label: 'Disputas',    icon: 'report' }
];

const AdminNav = () => {
    const { pathname } = useLocation();

    return (
        <nav className="bg-[#1A1F2E] rounded-[24px] border border-white/5 p-2 mb-6 flex gap-1 overflow-x-auto">
            {TABS.map(t => {
                const active = pathname === t.to;
                return (
                    <Link
                        key={t.to}
                        to={t.to}
                        className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm whitespace-nowrap transition-all ${active
                            ? 'bg-violet-600 text-white shadow-lg shadow-violet-600/20'
                            : 'text-gray-400 hover:text-white hover:bg-white/5'
                            }`}
                    >
                        <span className="material-symbols-outlined text-[18px]">{t.icon}</span>
                        {t.label}
                    </Link>
                );
            })}
        </nav>
    );
};

export default AdminNav;
