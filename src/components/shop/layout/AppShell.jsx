import { Outlet } from 'react-router-dom';
import { BottomNav } from './BottomNav.jsx';
import { useAuthStore } from '../../../stores/shop/useAuthStore.js';
import './AppShell.css';

export function AppShell() {
  const { role, setRole } = useAuthStore();

  return (
    <div className="higo-app-shell">
      {/* Dev-only role switcher */}
      <div className="role-switcher">
        {['customer', 'merchant', 'driver'].map((r) => (
          <button
            key={r}
            className={role === r ? 'active' : ''}
            onClick={() => setRole(r)}
          >
            {r === 'customer' ? '👤' : r === 'merchant' ? '🏪' : '🛵'}{' '}
            {r === 'customer' ? 'Cliente' : r === 'merchant' ? 'Comercio' : 'Driver'}
          </button>
        ))}
      </div>

      <div className="higo-app-shell__content">
        <Outlet />
      </div>

      <BottomNav />
    </div>
  );
}
