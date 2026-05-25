import { NavLink } from 'react-router-dom';
import { Home, Search, ShoppingBag, User } from 'lucide-react';
import { useCartStore } from '../../../stores/shop/useCartStore.js';
import './BottomNav.css';

export function BottomNav() {
  const totalItems = useCartStore((s) => s.getTotalItemCount());

  const tabs = [
    { to: '/shop', icon: Home, label: 'Inicio' },
    { to: '/shop/search', icon: Search, label: 'Buscar' },
    { to: '/shop/cart', icon: ShoppingBag, label: 'Carritos', badge: totalItems },
    { to: '/shop/profile', icon: User, label: 'Perfil' },
  ];

  return (
    <nav className="higo-bottom-nav" id="bottom-nav">
      {tabs.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          className={({ isActive }) =>
            `higo-bottom-nav__item ${isActive ? 'active' : ''}`
          }
          id={`nav-${tab.label.toLowerCase()}`}
          end={tab.to === '/shop'}
        >
          <span className="higo-bottom-nav__icon">
            <tab.icon size={22} />
            {tab.badge > 0 && (
              <span className="higo-bottom-nav__badge">{tab.badge > 99 ? '99+' : tab.badge}</span>
            )}
          </span>
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}
