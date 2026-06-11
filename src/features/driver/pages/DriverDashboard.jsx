import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Truck, Navigation, MapPin, Store, MessageCircle, Send, Check, Phone,
  TrendingUp, AlertTriangle, ShieldCheck, CreditCard, Banknote, Smartphone
} from 'lucide-react';
import { useOrderStore } from '../../../stores/shop/useOrderStore.js';
import { useAuthStore } from '../../../stores/shop/useAuthStore.js';
import { pushDriverLocation, pushOrderEvent } from '../../../services/shopTrackingService.js';
import { formatOrderStatus } from '../../../services/shopOrderStatus.js';
import { fetchDispatchableOrdersRemote } from '../../../services/shopOrderService.js';
import { useRealtimeOrders } from '../../../hooks/shop/useRealtimeOrders.js';
import { syncOrderStatus } from '../../../services/shopOrderRealtimeService.js';
import { useChatStore } from '../../../stores/shop/useChatStore.js';
import { useChatSync } from '../../../hooks/shop/useChatSync.js';
import { formatCurrency } from '../../../services/shopDeliveryPricing.js';
import { MapView, AutoFitBounds } from '../../../components/shop/maps/MapView.jsx';
import { EmojiMarker } from '../../../components/shop/maps/EmojiMarker.jsx';
import { RoutePolyline } from '../../../components/shop/maps/RoutePolyline.jsx';
import { useDirections } from '../../../hooks/shop/useDirections.js';
import { formatDurationMin } from '../../../services/shopGeolocation.js';
import './DriverDashboard.css';

const reportRealtimeError = (action, error) => {
  console.warn(`[DriverDashboard] ${action}`, error?.message || error);
};

function DriverDeliveryMap({ storeLatLng, userLatLng, status }) {
  const { path, duration } = useDirections(storeLatLng, userLatLng);
  const mapCenter = useMemo(() => ({
    lat: (storeLatLng.lat + userLatLng.lat) / 2,
    lng: (storeLatLng.lng + userLatLng.lng) / 2,
  }), [storeLatLng.lat, storeLatLng.lng, userLatLng.lat, userLatLng.lng]);

  // Highlight different leg colors depending on driver progress.
  const isEnRoute = ['PICKED_UP', 'DRIVER_EN_ROUTE_TO_CUSTOMER', 'DELIVERY_PAYMENT_PENDING', 'DELIVERY_PAYMENT_REPORTED', 'DELIVERY_PAYMENT_CONFIRMED'].includes(status);
  const routeColor = isEnRoute ? '#10B981' : '#3B82F6';

  return (
    <div className="driver-mini-map">
      <MapView center={mapCenter} zoom={13}>
        <AutoFitBounds
          points={[storeLatLng, userLatLng]}
          padding={50}
          fitKey={`${storeLatLng.lat},${userLatLng.lat}`}
        />
        <EmojiMarker position={storeLatLng} preset="store" zIndex={20} />
        <EmojiMarker position={userLatLng} preset="user" zIndex={20} />
        {path && <RoutePolyline path={path} color={routeColor} weight={4} opacity={0.9} />}
      </MapView>
      {duration != null && (
        <div className="driver-mini-map__eta">
          🛵 {formatDurationMin(duration)} en moto
        </div>
      )}
    </div>
  );
}

export function DriverDashboard() {
  const { orders, updateOrderStatus, assignDriver, upsertRemoteOrder } = useOrderStore();
  const driverId = useAuthStore((s) => s.userId);
  const { chats, sendMessage, initializeChat } = useChatStore();

  const [selectedOrderId, setSelectedOrderId] = useState(null);
  const [chatInputText, setChatInputText] = useState('');

  const handleRealtimeOrder = useCallback((row) => {
    if (!row) return;
    if (!['READY_TO_DISPATCH', 'READY_FOR_DRIVER_MATCH', 'DRIVER_CANDIDATE_BROADCASTED', 'DRIVER_ASSIGNED', 'DRIVER_EN_ROUTE_TO_STORE', 'PICKED_UP', 'DRIVER_EN_ROUTE_TO_CUSTOMER', 'DELIVERY_PAYMENT_PENDING', 'DELIVERY_PAYMENT_REPORTED', 'DELIVERY_PAYMENT_CONFIRMED', 'DELIVERED'].includes(row.status)) return;
    upsertRemoteOrder({
      id: row.id,
      status: row.status,
      updatedAt: row.updated_at,
      driverId: row.driver_id,
      storeId: row.store_id,
      deliveryAddress: row.delivery_address,
      grandTotal: Number(row.total || 0),
      deliveryFee: Number(row.delivery_fee || 0),
    });
  }, [upsertRemoteOrder]);

  useRealtimeOrders({ customerId: null, onOrderUpsert: null });

  useEffect(() => {
    fetchDispatchableOrdersRemote()
      .then((rows) => rows.forEach((o) => upsertRemoteOrder(o)))
      .catch((error) => reportRealtimeError("realtime action failed", error));
  }, [upsertRemoteOrder]);

  // 1. Filter available dispatchable orders in the zone (READY_TO_DISPATCH)
  const dispatchableOrders = useMemo(() => {
    return orders.filter(o => ['READY_TO_DISPATCH', 'READY_FOR_DRIVER_MATCH', 'DRIVER_CANDIDATE_BROADCASTED'].includes(o.status));
  }, [orders]);

  // 2. Filter orders assigned to this authenticated driver that are active
  const myActiveOrders = useMemo(() => {
    return orders.filter(o => 
      o.driverId === driverId && 
      ['DRIVER_ASSIGNED', 'DRIVER_EN_ROUTE_TO_STORE', 'PICKED_UP', 'DRIVER_EN_ROUTE_TO_CUSTOMER', 'DELIVERY_PAYMENT_PENDING', 'DELIVERY_PAYMENT_REPORTED', 'DELIVERY_PAYMENT_CONFIRMED'].includes(o.status)
    );
  }, [orders]);

  // 3. Filter orders assigned to this driver that are completed
  const myCompletedOrders = useMemo(() => {
    return orders.filter(o => 
      o.driverId === driverId && 
      o.status === 'DELIVERED'
    );
  }, [orders]);

  // Combined selected order view
  const selectedOrder = useMemo(() => {
    if (selectedOrderId) {
      return orders.find(o => o.id === selectedOrderId) || null;
    }
    return myActiveOrders[0] || dispatchableOrders[0] || null;
  }, [orders, selectedOrderId, myActiveOrders, dispatchableOrders]);

  // Keep selectedOrderId updated
  useEffect(() => {
    if (selectedOrder) {
      setSelectedOrderId(selectedOrder.id);
    }
  }, [selectedOrder]);

  useChatSync(selectedOrder?.id);

  const orderChat = useMemo(() => {
    if (!selectedOrder) return { driverMessages: [] };
    initializeChat(selectedOrder.id);
    return chats[selectedOrder.id] || { driverMessages: [] };
  }, [selectedOrder, chats]);

  // Handles sending driver message
  const handleSendDriverMessage = (e) => {
    e.preventDefault();
    if (!chatInputText.trim() || !selectedOrder) return;

    sendMessage(selectedOrder.id, 'driverMessages', {
      sender: 'driver',
      senderId: driverId,
      text: chatInputText
    });
    setChatInputText('');
  };

  const handleAcceptDelivery = (orderId) => {
    assignDriver(orderId, driverId);
    syncOrderStatus(orderId, 'DRIVER_EN_ROUTE_TO_STORE', driverId).catch((error) => reportRealtimeError("realtime action failed", error));
    pushOrderEvent({ orderId, eventType: 'DRIVER_EN_ROUTE_TO_STORE', actorType: 'driver', actorId: driverId, payload: { city: 'Higuerote' } }).catch((error) => reportRealtimeError("realtime action failed", error));
    
    // Add greeting message
    sendMessage(orderId, 'driverMessages', {
      sender: 'driver',
      senderId: driverId,
      text: '🛵 Tu Higo Driver ha aceptado la entrega y va en camino al local.',
      system: true
    });

    sendMessage(orderId, 'driverMessages', {
      sender: 'driver',
      senderId: driverId,
      text: '¡Hola! Soy tu Higo Driver. Ya voy en camino a retirar tu pedido en el comercio. ⚡'
    });

    sendMessage(orderId, 'storeMessages', {
      sender: 'driver',
      senderId: driverId,
      text: '🛵 El repartidor ha aceptado el despacho y va en camino al local.'
    });
  };

  const handlePickupPackage = (orderId) => {
    pushOrderEvent({ orderId, eventType: 'ORDER_PICKED_UP', actorType: 'driver', actorId: driverId, payload: { city: 'Higuerote' } }).catch((error) => reportRealtimeError("realtime action failed", error));
    updateOrderStatus(orderId, 'DRIVER_EN_ROUTE_TO_CUSTOMER');
    syncOrderStatus(orderId, 'DRIVER_EN_ROUTE_TO_CUSTOMER').catch((error) => reportRealtimeError("realtime action failed", error));
    pushOrderEvent({ orderId, eventType: 'DRIVER_EN_ROUTE_TO_CUSTOMER', actorType: 'driver', actorId: driverId, payload: { city: 'Higuerote' } }).catch((error) => reportRealtimeError("realtime action failed", error));
    
    sendMessage(orderId, 'driverMessages', {
      sender: 'driver',
      senderId: driverId,
      text: '🚀 ¡Pedido retirado con éxito! Voy en camino a tu ubicación. Ya puedes rastrearme en el mapa.'
    });
  };



  const handleConfirmDeliveryPayment = (orderId) => {
    pushOrderEvent({ orderId, eventType: 'DELIVERY_PAYMENT_CONFIRMED', actorType: 'driver', actorId: driverId, payload: { city: 'Higuerote' } }).catch((error) => reportRealtimeError("realtime action failed", error));
    updateOrderStatus(orderId, 'DELIVERY_PAYMENT_CONFIRMED');
    syncOrderStatus(orderId, 'DELIVERY_PAYMENT_CONFIRMED').catch((error) => reportRealtimeError("realtime action failed", error));

    sendMessage(orderId, 'driverMessages', {
      sender: 'driver',
      senderId: driverId,
      text: '💵 Pago de envío confirmado. Procedo a cerrar la entrega. ¡Gracias!'
    });
  };

  const handleDeliverPackage = (orderId) => {
    pushOrderEvent({ orderId, eventType: 'ORDER_DELIVERED', actorType: 'driver', actorId: driverId, payload: { city: 'Higuerote' } }).catch((error) => reportRealtimeError("realtime action failed", error));
    updateOrderStatus(orderId, 'DELIVERED');
    syncOrderStatus(orderId, 'DELIVERED').catch((error) => reportRealtimeError("realtime action failed", error));
    
    sendMessage(orderId, 'driverMessages', {
      sender: 'driver',
      senderId: driverId,
      text: '👋 ¡He llegado a tu ubicación! Estoy afuera para entregarte el pedido. ¡Muchas gracias!'
    });
  };


  useEffect(() => {
    if (!selectedOrder || !['DRIVER_ASSIGNED', 'DRIVER_EN_ROUTE_TO_STORE', 'PICKED_UP', 'DRIVER_EN_ROUTE_TO_CUSTOMER', 'DELIVERY_PAYMENT_PENDING', 'DELIVERY_PAYMENT_REPORTED', 'DELIVERY_PAYMENT_CONFIRMED'].includes(selectedOrder.status)) return;
    const timer = setInterval(() => {
      if (!navigator.geolocation) return;
      navigator.geolocation.getCurrentPosition((position) => {
        pushDriverLocation({
          orderId: selectedOrder.id,
          driverId,
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          speedKmh: position.coords.speed ? position.coords.speed * 3.6 : null,
          accuracyM: position.coords.accuracy ?? null,
        }).catch((error) => reportRealtimeError("realtime action failed", error));
      });
    }, 5000);
    return () => clearInterval(timer);
  }, [selectedOrder?.id, selectedOrder?.status, driverId]);

  // Calculations for Driver Statistics
  const stats = useMemo(() => {
    const totalEarnings = myCompletedOrders.reduce((sum, o) => sum + o.deliveryFee, 0);
    return {
      trips: myCompletedOrders.length,
      earnings: totalEarnings,
    };
  }, [myCompletedOrders]);

  return (
    <div className="driver-dashboard animate-fade-in">
      {/* 1. STATUS SUMMARY BANNER */}
      <div className="driver-hero-header">
        <div className="driver-hero-header__logo">
          <Truck size={22} />
        </div>
        <div className="driver-profile-info">
          <h1>Panel de Higo Driver</h1>
          <span>Conductor: <strong>Carlos Mendoza (Moto)</strong></span>
        </div>
        <div className="driver-stats">
          <div className="stat-card">
            <span className="label">Viajes</span>
            <span className="val">{stats.trips}</span>
          </div>
          <div className="stat-card stat-card--earnings">
            <span className="label">Ganancias</span>
            <span className="val">{formatCurrency(stats.earnings)}</span>
          </div>
        </div>
      </div>

      {/* 2. MAIN ACTIVE DELIVERY AREA */}
      {selectedOrder ? (
        <div className="driver-split-layout">
          {/* Left Details Panel */}
          <div className="driver-delivery-details">
            <div className="delivery-card">
              <div className="delivery-card__title">
                <span>Orden Ref: {selectedOrder.id.slice(0, 8)}...</span>
                <span className={`status-pill status-pill--${selectedOrder.status.toLowerCase()}`}>
                  {formatOrderStatus(selectedOrder.status)}
                </span>
              </div>

              {selectedOrder.storeLocation && selectedOrder.userLocation && (
                <DriverDeliveryMap
                  storeLatLng={selectedOrder.storeLocation}
                  userLatLng={selectedOrder.userLocation}
                  status={selectedOrder.status}
                />
              )}

              {/* ROUTE INFO */}
              <div className="delivery-route-block">
                <div className="route-node">
                  <div className="node-icon node-icon--store">🏪</div>
                  <div className="node-details">
                    <span className="label">Comercio (Retiro)</span>
                    <strong className="name">{selectedOrder.storeName}</strong>
                    <span className="address">Higuerote, Miranda</span>
                  </div>
                </div>
                <div className="route-line" />
                <div className="route-node">
                  <div className="node-icon node-icon--user">📍</div>
                  <div className="node-details">
                    <span className="label">Cliente (Entrega)</span>
                    <strong className="name">{selectedOrder.deliveryAddress}</strong>
                  </div>
                </div>
              </div>

              {/* SMART PAYMENT INFO */}
              <div className="driver-payment-card">
                <h4>Método de Pago del Envío</h4>
                <div className="payment-row">
                  {selectedOrder.payment_method === 'cash' ? (
                    <>
                      <div className="payment-method-badge">
                        <Banknote size={16} />
                        Efectivo al Conductor
                      </div>
                      <div className="payout-amount">
                        Tarifa: {formatCurrency(selectedOrder.deliveryFee)}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="payment-method-badge payment-method-badge--pago-movil">
                        <Smartphone size={16} />
                        Pago Móvil al Conductor
                      </div>
                      <div className="payout-amount">
                        Tarifa: {formatCurrency(selectedOrder.deliveryFee)}
                      </div>
                    </>
                  )}
                </div>
                {selectedOrder.payment_method === 'cash' && selectedOrder.paidWithAmount > 0 && (
                  <div className="payment-change-alert">
                    ⚠️ Cliente paga con <strong>{formatCurrency(selectedOrder.paidWithAmount)}</strong>. Llevar vuelto de: <strong>{formatCurrency(selectedOrder.changeAmount)}</strong>
                  </div>
                )}
              </div>

              {/* ACTION BUTTONS */}
              <div className="driver-action-buttons">
                {['READY_TO_DISPATCH', 'READY_FOR_DRIVER_MATCH', 'DRIVER_CANDIDATE_BROADCASTED'].includes(selectedOrder.status) && (
                  <button
                    className="driver-btn driver-btn--primary"
                    onClick={() => handleAcceptDelivery(selectedOrder.id)}
                  >
                    🛵 Aceptar este Despacho
                  </button>
                )}

                {['DRIVER_ASSIGNED', 'DRIVER_EN_ROUTE_TO_STORE'].includes(selectedOrder.status) && (
                  <button
                    className="driver-btn driver-btn--success"
                    onClick={() => handlePickupPackage(selectedOrder.id)}
                  >
                    📦 Confirmar Retiro en Comercio
                  </button>
                )}

                {(selectedOrder.status === 'DELIVERY_PAYMENT_REPORTED') && (
                  <button
                    className="driver-btn driver-btn--success"
                    onClick={() => handleConfirmDeliveryPayment(selectedOrder.id)}
                  >
                    💵 Confirmar pago de envío recibido
                  </button>
                )}

                {['PICKED_UP', 'DRIVER_EN_ROUTE_TO_CUSTOMER', 'DELIVERY_PAYMENT_PENDING'].includes(selectedOrder.status) && (
                  <div className="driver-status-delivered" style={{ borderStyle: 'dashed' }}>
                    <span>⏳ Pendiente confirmar pago de envío para cerrar entrega</span>
                  </div>
                )}

                {['DELIVERY_PAYMENT_CONFIRMED'].includes(selectedOrder.status) && (
                  <button
                    className="driver-btn driver-btn--complete"
                    onClick={() => handleDeliverPackage(selectedOrder.id)}
                  >
                    🏁 Completar Entrega del Pedido
                  </button>
                )}

                {selectedOrder.status === 'DELIVERED' && (
                  <div className="driver-status-delivered">
                    <ShieldCheck size={20} />
                    ¡Entrega Completada con éxito!
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right Chat Panel */}
          <div className="driver-chat-panel">
            <div className="driver-chat-header">
              <MessageCircle size={16} />
              <h4>Chat con el Cliente</h4>
            </div>
            <div className="driver-chat-messages">
              {orderChat.driverMessages.map(msg => {
                if (msg.system) {
                  return (
                    <div key={msg.id} className="driver-system-message">
                      <span>{msg.text}</span>
                    </div>
                  );
                }
                const isMe = msg.sender === 'driver';
                return (
                  <div key={msg.id} className={`driver-chat-bubble-wrapper ${isMe ? 'me' : 'other'}`}>
                    <div className={`driver-chat-bubble ${isMe ? 'me' : 'other'}`}>
                      <p>{msg.text}</p>
                      <span className="timestamp">
                        {new Date(msg.timestamp).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
            <form className="driver-chat-form" onSubmit={handleSendDriverMessage}>
              <input
                type="text"
                placeholder="Escribe al cliente..."
                value={chatInputText}
                onChange={(e) => setChatInputText(e.target.value)}
                disabled={['READY_TO_DISPATCH', 'READY_FOR_DRIVER_MATCH', 'DRIVER_CANDIDATE_BROADCASTED', 'DELIVERED'].includes(selectedOrder.status)}
              />
              <button
                type="submit"
                disabled={!chatInputText.trim() || ['READY_TO_DISPATCH', 'READY_FOR_DRIVER_MATCH', 'DRIVER_CANDIDATE_BROADCASTED', 'DELIVERED'].includes(selectedOrder.status)}
              >
                <Send size={15} />
              </button>
            </form>
          </div>
        </div>
      ) : (
        <div className="driver-empty-dashboard">
          <TrendingUp size={48} strokeWidth={1} color="var(--higo-gray-300)" />
          <h3>Sin entregas activas</h3>
          <p>Conéctate y espera a que los comercios preparen órdenes en la zona. ¡Tus solicitudes de envío aparecerán aquí!</p>
        </div>
      )}

      {/* 3. BOTTOM PENDING REQUESTS PANEL */}
      {dispatchableOrders.length > 0 && (
        <div className="driver-pending-pane">
          <div className="pending-header">
            <AlertTriangle size={16} color="var(--higo-warning)" />
            <h4>Despachos Pendientes en Higuerote ({dispatchableOrders.length})</h4>
          </div>
          <div className="pending-list">
            {dispatchableOrders.map(o => (
              <div key={o.id} className="pending-card">
                <div className="pending-card__info">
                  <div className="store-name">🏪 {o.storeName}</div>
                  <div className="delivery-address">📍 Hacia: {o.deliveryAddress}</div>
                </div>
                <div className="pending-card__actions">
                  <span className="fee">{formatCurrency(o.deliveryFee)}</span>
                  <button
                    className="accept-mini-btn"
                    onClick={() => handleAcceptDelivery(o.id)}
                  >
                    Aceptar
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
