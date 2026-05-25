import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, ChevronRight } from 'lucide-react';
import { formatCurrency } from '../../../services/shopDeliveryPricing.js';
import './NotificationsPopover.css';

const STATUS_LABELS = {
  PENDING_PAYMENT: { label: 'Esperando tu pago', icon: '💳' },
  PAYMENT_VERIFIED: { label: 'Pago verificado', icon: '✅' },
  PREPARING: { label: 'En cocina', icon: '👨‍🍳' },
  READY_TO_DISPATCH: { label: 'Listo para despachar', icon: '📦' },
  DRIVER_ASSIGNED: { label: 'Driver en camino a la tienda', icon: '🛵' },
  PICKED_UP: { label: 'En camino a tu dirección', icon: '🚀' },
};

export function NotificationsPopover({ isOpen, orders, onClose }) {
  const navigate = useNavigate();

  const handleOrderClick = (orderId) => {
    onClose();
    navigate(`/shop/orders/${orderId}`);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <div className="notifications-backdrop" onClick={onClose} />
          <motion.div
            className="notifications-popover"
            initial={{ opacity: 0, y: -10, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.97 }}
            transition={{ duration: 0.18 }}
          >
            <div className="notifications-header">
              <Bell size={16} />
              <h3>Pedidos activos</h3>
              <span className="notifications-count">{orders.length}</span>
            </div>

            {orders.length === 0 ? (
              <div className="notifications-empty">
                <span style={{ fontSize: 24 }}>🍽️</span>
                <p>No tienes pedidos activos.</p>
                <p className="notifications-empty__hint">Cuando hagas un pedido aparecerá aquí su estado en tiempo real.</p>
              </div>
            ) : (
              <ul className="notifications-list">
                {orders.map((order) => {
                  const status = STATUS_LABELS[order.status] || { label: 'Procesando', icon: '⏳' };
                  return (
                    <li key={order.id}>
                      <button
                        type="button"
                        className="notifications-item"
                        onClick={() => handleOrderClick(order.id)}
                      >
                        <span className="notifications-item__icon">{status.icon}</span>
                        <div className="notifications-item__body">
                          <div className="notifications-item__title">
                            {order.storeName}
                            <span className="notifications-item__total">
                              {formatCurrency(order.grandTotal)}
                            </span>
                          </div>
                          <div className="notifications-item__status">{status.label}</div>
                        </div>
                        <ChevronRight size={16} className="notifications-item__chevron" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
