import { useNavigate } from 'react-router-dom';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { ClipboardList, Package, Clock, CheckCircle2, XCircle, ArrowLeft } from 'lucide-react';
import { useOrderStore } from '../../../stores/shop/useOrderStore.js';
import { useAuthStore } from '../../../stores/shop/useAuthStore.js';
import { fetchOrdersByCustomerRemote, mapOrderRow } from '../../../services/shopOrderService.js';
import { useRealtimeOrders } from '../../../hooks/shop/useRealtimeOrders.js';
import { formatCurrency } from '../../../services/shopDeliveryPricing.js';
import { formatOrderStatus } from '../../../services/shopOrderStatus.js';
import './OrdersPage.css';

const STATUS_MAP = {

  PENDING_PRODUCT_PAYMENT: { label: 'Pago de productos pendiente', color: 'var(--higo-warning)', icon: '💳', bg: 'var(--higo-warning-light)' },
  PRODUCT_PAYMENT_REPORTED: { label: 'Pago reportado', color: 'var(--higo-info)', icon: '🧾', bg: 'var(--higo-info-light)' },
  PRODUCT_PAYMENT_VERIFIED: { label: 'Pago verificado', color: 'var(--higo-info)', icon: '✅', bg: 'var(--higo-info-light)' },
  READY_FOR_DRIVER_MATCH: { label: 'Buscando driver', color: 'var(--higo-blue)', icon: '📡', bg: 'var(--higo-blue-50)' },
  DRIVER_CANDIDATE_BROADCASTED: { label: 'Oferta a drivers', color: 'var(--higo-blue)', icon: '📣', bg: 'var(--higo-blue-50)' },
  DRIVER_EN_ROUTE_TO_STORE: { label: 'Driver al comercio', color: 'var(--higo-info)', icon: '🛵', bg: 'var(--higo-info-light)' },
  DRIVER_EN_ROUTE_TO_CUSTOMER: { label: 'En camino al cliente', color: 'var(--higo-blue)', icon: '🚀', bg: 'var(--higo-blue-50)' },
  DELIVERY_PAYMENT_PENDING: { label: 'Pago de envío pendiente', color: 'var(--higo-warning)', icon: '💵', bg: 'var(--higo-warning-light)' },
  DELIVERY_PAYMENT_REPORTED: { label: 'Pago de envío reportado', color: 'var(--higo-info)', icon: '🧾', bg: 'var(--higo-info-light)' },
  DELIVERY_PAYMENT_CONFIRMED: { label: 'Pago de envío confirmado', color: 'var(--higo-success)', icon: '✅', bg: 'var(--higo-success-light)' },
  PENDING_PAYMENT: { label: 'Pendiente por Pago', color: 'var(--higo-warning)', icon: '⏳', bg: 'var(--higo-warning-light)' },
  PAYMENT_VERIFIED: { label: 'Pago Verificado', color: 'var(--higo-info)', icon: '✅', bg: 'var(--higo-info-light)' },
  PREPARING: { label: 'En Preparación', color: 'var(--higo-blue)', icon: '👨‍🍳', bg: 'var(--higo-blue-50)' },
  READY_TO_DISPATCH: { label: 'Listo para Despachar', color: 'var(--higo-blue)', icon: '📦', bg: 'var(--higo-blue-50)' },
  DRIVER_ASSIGNED: { label: 'Driver Asignado', color: 'var(--higo-info)', icon: '🛵', bg: 'var(--higo-info-light)' },
  PICKED_UP: { label: 'En Camino', color: 'var(--higo-blue)', icon: '🚀', bg: 'var(--higo-blue-50)' },
  DELIVERED: { label: 'Entregado', color: 'var(--higo-success)', icon: '✅', bg: 'var(--higo-success-light)' },
  CANCELLED: { label: 'Cancelado', color: 'var(--higo-error)', icon: '❌', bg: 'var(--higo-error-light)' },
};

export function OrdersPage() {
  const navigate = useNavigate();
  const { orders, upsertRemoteOrder } = useOrderStore();
  const customerId = useAuthStore((s) => s.userId);
  const [remoteOrders, setRemoteOrders] = useState([]);


  const handleRealtimeOrder = useCallback((row) => {
    upsertRemoteOrder(mapOrderRow(row));
  }, [upsertRemoteOrder]);

  useRealtimeOrders({ customerId, onOrderUpsert: handleRealtimeOrder });

  useEffect(() => {
    let mounted = true;
    if (!customerId) return;
    fetchOrdersByCustomerRemote(customerId)
      .then((rows) => {
        if (mounted) {
          setRemoteOrders(rows);
          rows.forEach((r) => upsertRemoteOrder(r));
        }
      })
      .catch((error) => { console.warn('[OrdersPage] fetchOrdersByCustomerRemote', error?.message || error); });
    return () => { mounted = false; };
  }, [customerId, upsertRemoteOrder]);

  const mergedOrders = useMemo(() => {
    const remoteIds = new Set(remoteOrders.map((o) => o.id));
    const enrichedRemote = remoteOrders.map((o) => {
      const localMatch = orders.find((lo) => lo.id === o.id);
      return localMatch ? { ...localMatch, status: o.status, updatedAt: o.updatedAt } : o;
    });
    const localOnly = orders.filter((o) => !remoteIds.has(o.id));
    return [...enrichedRemote, ...localOnly];
  }, [orders, remoteOrders]);

  return (
    <div className="orders-page">
      <div className="orders-header">
        <button className="orders-header__back" onClick={() => navigate('/shop')}>
          <ArrowLeft size={20} />
        </button>
        <h1>Mis Pedidos</h1>
      </div>

      {mergedOrders.length === 0 ? (
        <div className="orders-empty">
          <ClipboardList size={56} strokeWidth={1.2} />
          <h2>Sin pedidos aún</h2>
          <p>Tus pedidos aparecerán aquí</p>
        </div>
      ) : (
        <div className="orders-list">
          {mergedOrders.map((order, index) => {
            const statusInfo = STATUS_MAP[order.status] || { label: formatOrderStatus(order.status), color: 'var(--higo-gray-700)', icon: '•', bg: 'var(--higo-gray-100)' };
            return (
              <motion.div
                key={order.id}
                className="order-card"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                onClick={() => navigate(`/shop/orders/${order.id}`)}
                style={{ cursor: 'pointer' }}
                whileHover={{ scale: 1.01, translateY: -2, boxShadow: 'var(--shadow-md)' }}
                whileTap={{ scale: 0.99 }}
              >
                <div className="order-card__top">
                  <div>
                    <div className="order-card__store">{order.storeName || 'Comercio'}</div>
                    <div className="order-card__id">{order.id}</div>
                  </div>
                  <div
                    className="order-card__status"
                    style={{ background: statusInfo.bg, color: statusInfo.color }}
                  >
                    <span>{statusInfo.icon}</span>
                    {statusInfo.label}
                  </div>
                </div>

                <div className="order-card__items">
                  {(order.items || []).slice(0, 3).map(item => (
                    <span key={item.id} className="order-card__item-tag">
                      {item.name} x{item.quantity}
                    </span>
                  ))}
                  {(order.items || []).length > 3 && (
                    <span className="order-card__item-tag">+{(order.items || []).length - 3} más</span>
                  )}
                </div>

                <div className="order-card__bottom">
                  <div className="order-card__totals">
                    <span>Productos: {formatCurrency(order.productTotal ?? (order.grandTotal - (order.deliveryFee || 0)))}</span>
                    <span>Envío: {formatCurrency(order.deliveryFee)}</span>
                  </div>
                  <div className="order-card__grand-total">
                    {formatCurrency(order.grandTotal || 0)}
                  </div>
                </div>

                <div className="order-card__date">
                  {new Date(order.createdAt).toLocaleDateString('es-VE', {
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
