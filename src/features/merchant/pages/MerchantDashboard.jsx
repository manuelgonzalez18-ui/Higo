import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Store, ClipboardList, CheckCircle2, AlertCircle, Clock,
  MessageCircle, Send, Check, Search, Filter, ShieldCheck
} from 'lucide-react';
import { useOrderStore } from '../../../stores/shop/useOrderStore.js';
import { useAuthStore } from '../../../stores/shop/useAuthStore.js';
import { syncOrderStatus } from '../../../services/shopOrderRealtimeService.js';
import { fetchStoreOrdersRemote } from '../../../services/shopOrderService.js';
import { pushOrderEvent } from '../../../services/shopTrackingService.js';
import { formatOrderStatus } from '../../../services/shopOrderStatus.js';
import { useChatStore } from '../../../stores/shop/useChatStore.js';
import { formatCurrency } from '../../../services/shopDeliveryPricing.js';
import { Spinner } from '../../../components/shop/ui/Spinner.jsx';
import './MerchantDashboard.css';

const reportRealtimeError = (action, error) => {
  console.warn(`[MerchantDashboard] ${action}`, error?.message || error);
};

const STATUS_SECTIONS = [
  { id: 'pending', label: 'Por Validar', icon: '💳', statuses: ['PENDING_PRODUCT_PAYMENT', 'PRODUCT_PAYMENT_REPORTED', 'PENDING_PAYMENT'] },
  { id: 'kitchen', label: 'En Cocina', icon: '👨‍🍳', statuses: ['PRODUCT_PAYMENT_VERIFIED', 'PAYMENT_VERIFIED', 'PREPARING'] },
  { id: 'dispatch', label: 'Despacho', icon: '📦', statuses: ['READY_FOR_DRIVER_MATCH', 'READY_TO_DISPATCH', 'DRIVER_CANDIDATE_BROADCASTED'] },
  { id: 'delivered', label: 'Historial', icon: '🏁', statuses: ['DRIVER_ASSIGNED', 'DRIVER_EN_ROUTE_TO_STORE', 'PICKED_UP', 'DRIVER_EN_ROUTE_TO_CUSTOMER', 'DELIVERY_PAYMENT_PENDING', 'DELIVERY_PAYMENT_REPORTED', 'DELIVERY_PAYMENT_CONFIRMED', 'DELIVERED', 'CANCELLED'] }
];

export function MerchantDashboard() {
  const { orders, updateOrderStatus, assignDriver, upsertRemoteOrder } = useOrderStore();
  const merchantId = useAuthStore((s) => s.userId);
  const { chats, addMessage, initializeChat } = useChatStore();
  
  const [activeTab, setActiveTab] = useState('pending'); // pending | kitchen | dispatch | delivered
  const [selectedOrderId, setSelectedOrderId] = useState(null);
  const [chatInputText, setChatInputText] = useState('');

  useEffect(() => {
    const fallbackStoreId = orders[0]?.storeId;
    if (!fallbackStoreId) return;
    fetchStoreOrdersRemote(fallbackStoreId)
      .then((rows) => rows.forEach((o) => upsertRemoteOrder(o)))
      .catch((error) => reportRealtimeError("realtime action failed", error));
  }, [orders, upsertRemoteOrder]);

  // Auto-select first order if exists
  const activeOrdersForTab = useMemo(() => {
    const section = STATUS_SECTIONS.find(s => s.id === activeTab);
    return orders.filter(o => section.statuses.includes(o.status));
  }, [orders, activeTab]);

  const selectedOrder = useMemo(() => {
    return orders.find(o => o.id === selectedOrderId) || activeOrdersForTab[0] || null;
  }, [orders, selectedOrderId, activeOrdersForTab]);

  // Sync selectedOrderId when changing tabs
  useEffect(() => {
    if (activeOrdersForTab.length > 0) {
      setSelectedOrderId(activeOrdersForTab[0].id);
    } else {
      setSelectedOrderId(null);
    }
  }, [activeTab]);

  const orderChat = useMemo(() => {
    if (!selectedOrder) return { storeMessages: [] };
    initializeChat(selectedOrder.id);
    return chats[selectedOrder.id] || { storeMessages: [] };
  }, [selectedOrder, chats]);

  // Handles chat message submission
  const handleSendMerchantMessage = (e) => {
    e.preventDefault();
    if (!chatInputText.trim() || !selectedOrder) return;

    addMessage(selectedOrder.id, 'storeMessages', {
      sender: 'store',
      text: chatInputText
    });
    setChatInputText('');
  };

  // Simulates Driver assignment upon dispatch
  const handleDispatchOrder = (orderId) => {
    updateOrderStatus(orderId, 'READY_FOR_DRIVER_MATCH');
    syncOrderStatus(orderId, 'READY_FOR_DRIVER_MATCH').catch((error) => reportRealtimeError("realtime action failed", error));
    pushOrderEvent({ orderId, eventType: 'ORDER_READY_FOR_DRIVER_MATCH', actorType: 'merchant', actorId: merchantId || 'merchant-demo', payload: { city: 'Higuerote' } }).catch((error) => reportRealtimeError("realtime action failed", error));
    
    addMessage(orderId, 'storeMessages', {
      sender: 'store',
      text: '📦 Pedido empacado y listo. Buscando motorizado en la zona...'
    });

    // Simulate driver matching in 4 seconds
    setTimeout(() => {
      updateOrderStatus(orderId, 'DRIVER_CANDIDATE_BROADCASTED');
      syncOrderStatus(orderId, 'DRIVER_CANDIDATE_BROADCASTED').catch((error) => reportRealtimeError("realtime action failed", error));
      pushOrderEvent({ orderId, eventType: 'DRIVER_CANDIDATE_BROADCASTED', actorType: 'merchant', actorId: merchantId || 'merchant-demo', payload: { city: 'Higuerote' } }).catch((error) => reportRealtimeError("realtime action failed", error));

      assignDriver(orderId, merchantId);
      syncOrderStatus(orderId, 'DRIVER_ASSIGNED', merchantId).catch((error) => reportRealtimeError("realtime action failed", error));
      pushOrderEvent({ orderId, eventType: 'DRIVER_ASSIGNED', actorType: 'system', actorId: merchantId, payload: { city: 'Higuerote', source: 'merchant_auto_assign' } }).catch((error) => reportRealtimeError("realtime action failed", error));
      
      addMessage(orderId, 'driverMessages', {
        sender: 'driver',
        text: '🛵 Higo Driver asignado al despacho.',
        system: true
      });

      addMessage(orderId, 'driverMessages', {
        sender: 'driver',
        text: '¡Buenas noches! Soy tu Higo Driver. Ya voy saliendo a retirar el pedido.'
      });

      addMessage(orderId, 'storeMessages', {
        sender: 'store',
        text: '🛵 Un Higo Driver ha sido asignado y va en camino a retirar.'
      });
    }, 4000);
  };

  return (
    <div className="merchant-dashboard animate-fade-in">
      {/* 1. TOP HEADER BANNER */}
      <div className="merchant-hero-header">
        <div className="merchant-hero-header__logo">
          <Store size={22} />
        </div>
        <div>
          <h1>Panel de Control de Comercio</h1>
          <span className="merchant-hero-header__store">Comercio Activo: <strong>Arepera La Reina</strong></span>
        </div>
      </div>

      {/* 2. DYNAMIC WORKFLOW TABS */}
      <div className="merchant-workflow-tabs">
        {STATUS_SECTIONS.map(sec => {
          const count = orders.filter(o => sec.statuses.includes(o.status)).length;
          return (
            <button
              key={sec.id}
              className={`merchant-workflow-tab ${activeTab === sec.id ? 'active' : ''}`}
              onClick={() => setActiveTab(sec.id)}
            >
              <span className="tab-icon">{sec.icon}</span>
              <span className="tab-label">{sec.label}</span>
              {count > 0 && <span className="tab-badge">{count}</span>}
            </button>
          );
        })}
      </div>

      {/* 3. DUAL-PANEL LAYOUT */}
      <div className="merchant-layout-split">
        {/* Left List Pane */}
        <div className="merchant-orders-pane">
          {activeOrdersForTab.length === 0 ? (
            <div className="merchant-empty-pane">
              <ClipboardList size={36} strokeWidth={1.5} color="var(--higo-gray-300)" />
              <p>Sin órdenes en este estado</p>
            </div>
          ) : (
            <div className="merchant-orders-list">
              {activeOrdersForTab.map(o => (
                <div
                  key={o.id}
                  className={`merchant-order-item ${selectedOrder?.id === o.id ? 'selected' : ''}`}
                  onClick={() => setSelectedOrderId(o.id)}
                >
                  <div className="merchant-order-item__header">
                    <span className="order-id">Ref: {o.id.slice(0, 8)}...</span>
                    <span className="order-time">
                      {new Date(o.createdAt).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <div className="merchant-order-item__desc">
                    {o.items.map(item => `${item.name} x${item.quantity}`).join(', ')}
                  </div>
                  <div className="merchant-order-item__footer">
                    <span className="payment-method">
                      {o.payment_method === 'cash' ? '💵 Efectivo' : '📱 Pago Móvil'}
                    </span>
                    <span className="order-total">{formatCurrency(o.productTotal)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right Details Panel */}
        <div className="merchant-details-pane">
          {selectedOrder ? (
            <div className="merchant-details-content">
              {/* Order Info */}
              <div className="details-header">
                <div>
                  <h3>Orden {selectedOrder.id}</h3>
                  <span className="details-address">{selectedOrder.deliveryAddress}</span>
                </div>
                <div className="details-price">{formatCurrency(selectedOrder.productTotal)}</div>
              </div>

              {/* Status Action Block */}
              <div className="details-action-block">
                <div className="details-action-block__status">
                  <span>Estado:</span>
                  <strong>{formatOrderStatus(selectedOrder.status)}</strong>
                </div>

                <div className="details-action-block__buttons">
                  {(selectedOrder.status === 'PENDING_PAYMENT' || selectedOrder.status === 'PENDING_PRODUCT_PAYMENT' || selectedOrder.status === 'PRODUCT_PAYMENT_REPORTED') && (
                    <button
                      className="action-btn action-btn--success"
                      onClick={() => { updateOrderStatus(selectedOrder.id, 'PRODUCT_PAYMENT_VERIFIED'); syncOrderStatus(selectedOrder.id, 'PRODUCT_PAYMENT_VERIFIED').catch((error) => reportRealtimeError("realtime action failed", error)); pushOrderEvent({ orderId: selectedOrder.id, eventType: 'PRODUCT_PAYMENT_VERIFIED', actorType: 'merchant', actorId: merchantId || 'merchant-demo', payload: { city: 'Higuerote' } }).catch((error) => reportRealtimeError("realtime action failed", error)); }}
                    >
                      <CheckCircle2 size={16} />
                      Confirmar Pago Recibido
                    </button>
                  )}

                  {(selectedOrder.status === 'PAYMENT_VERIFIED' || selectedOrder.status === 'PRODUCT_PAYMENT_VERIFIED') && (
                    <button
                      className="action-btn action-btn--primary"
                      onClick={() => { updateOrderStatus(selectedOrder.id, 'PREPARING'); syncOrderStatus(selectedOrder.id, 'PREPARING').catch((error) => reportRealtimeError("realtime action failed", error)); pushOrderEvent({ orderId: selectedOrder.id, eventType: 'PREPARING', actorType: 'merchant', actorId: merchantId || 'merchant-demo', payload: { city: 'Higuerote' } }).catch((error) => reportRealtimeError("realtime action failed", error)); }}
                    >
                      👨‍🍳 Iniciar Preparación
                    </button>
                  )}

                  {selectedOrder.status === 'PREPARING' && (
                    <button
                      className="action-btn action-btn--success"
                      onClick={() => handleDispatchOrder(selectedOrder.id)}
                    >
                      📦 Despachar a Higo Driver
                    </button>
                  )}

                  {(selectedOrder.status === 'READY_TO_DISPATCH' || selectedOrder.status === 'READY_FOR_DRIVER_MATCH' || selectedOrder.status === 'DRIVER_CANDIDATE_BROADCASTED') && (
                    <div className="merchant-searching-driver">
                      <Spinner size="sm" />
                      <span>Buscando Higo Driver disponible...</span>
                    </div>
                  )}

                  {selectedOrder.status === 'DRIVER_ASSIGNED' && (
                    <div className="merchant-assigned-driver">
                      <span className="icon">🛵</span>
                      <span>Higo Driver <strong>Carlos Mendoza</strong> va al local a retirar</span>
                    </div>
                  )}

                  {(selectedOrder.status === 'PICKED_UP' || selectedOrder.status === 'DRIVER_EN_ROUTE_TO_CUSTOMER' || selectedOrder.status === 'DELIVERY_PAYMENT_PENDING' || selectedOrder.status === 'DELIVERY_PAYMENT_REPORTED' || selectedOrder.status === 'DELIVERY_PAYMENT_CONFIRMED') && (
                    <div className="merchant-assigned-driver">
                      <span className="icon">🚀</span>
                      <span>En tránsito — Driver lleva el pedido al cliente</span>
                    </div>
                  )}

                  {selectedOrder.status === 'DELIVERED' && (
                    <div className="merchant-success-status">
                      <ShieldCheck size={18} />
                      <span>Pedido Entregado con éxito</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Items List */}
              <div className="details-items-section">
                <h4>Productos Solicitados</h4>
                <div className="details-items-list">
                  {selectedOrder.items.map(item => (
                    <div key={item.id} className="details-item-row">
                      <span>{item.name} <strong style={{ color: 'var(--higo-blue)' }}>x{item.quantity}</strong></span>
                      <span>{formatCurrency(item.price * item.quantity)}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Live Chat with Customer */}
              <div className="details-chat-section">
                <h4>Chat con el Cliente</h4>
                <div className="details-chat-box">
                  {orderChat.storeMessages.map(msg => {
                    const isMe = msg.sender === 'store';
                    return (
                      <div key={msg.id} className={`merchant-chat-bubble-wrapper ${isMe ? 'me' : 'other'}`}>
                        <div className={`merchant-chat-bubble ${isMe ? 'me' : 'other'}`}>
                          {msg.image ? (
                            <div className="merchant-chat-attachment">
                              <img src={msg.image} alt="Capture de pago" />
                              <span>{msg.text}</span>
                            </div>
                          ) : (
                            <p>{msg.text}</p>
                          )}
                          <span className="timestamp">
                            {new Date(msg.timestamp).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <form className="details-chat-form" onSubmit={handleSendMerchantMessage}>
                  <input
                    type="text"
                    placeholder="Escribe al cliente..."
                    value={chatInputText}
                    onChange={(e) => setChatInputText(e.target.value)}
                  />
                  <button type="submit" disabled={!chatInputText.trim()}>
                    <Send size={15} />
                  </button>
                </form>
              </div>
            </div>
          ) : (
            <div className="merchant-empty-pane" style={{ height: '100%' }}>
              <Store size={48} strokeWidth={1} color="var(--higo-gray-200)" />
              <h3>Selecciona un pedido</h3>
              <p>Selecciona una orden del panel izquierdo para ver los detalles e interactuar.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
