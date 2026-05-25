import { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft, Store, Truck, Navigation, Clock,
  Send, ShieldAlert, Image, Check
} from 'lucide-react';
import { useOrderStore } from '../../../stores/shop/useOrderStore.js';
import { subscribeToOrder, syncOrderStatus } from '../../../services/shopOrderRealtimeService.js';
import { useChatStore } from '../../../stores/shop/useChatStore.js';
import { fetchStoreById } from '../../../services/shopStoreService.js';
import { fetchOrderByIdRemote } from '../../../services/shopOrderService.js';
import { formatCurrency } from '../../../services/shopDeliveryPricing.js';
import { formatDurationMin } from '../../../services/shopGeolocation.js';
import { useDirections } from '../../../hooks/shop/useDirections.js';
import { Spinner } from '../../../components/shop/ui/Spinner.jsx';
import { useLiveDriverTracking } from '../../../hooks/shop/useLiveDriverTracking.js';
import { useOrderEvents } from '../../../hooks/shop/useOrderEvents.js';
import { pushOrderEvent } from '../../../services/shopTrackingService.js';
import { MapView, AutoFitBounds } from '../../../components/shop/maps/MapView.jsx';
import { EmojiMarker } from '../../../components/shop/maps/EmojiMarker.jsx';
import { RoutePolyline } from '../../../components/shop/maps/RoutePolyline.jsx';
import { formatOrderEventType, formatOrderStatus } from '../../../services/shopOrderStatus.js';
import './OrderDetailPage.css';

const STATUS_STEPS = [
  { id: 'PENDING_PRODUCT_PAYMENT', label: 'Pago producto', icon: '💳' },
  { id: 'PRODUCT_PAYMENT_VERIFIED', label: 'Pago validado', icon: '✅' },
  { id: 'PREPARING', label: 'Cocina', icon: '👨‍🍳' },
  { id: 'READY_FOR_DRIVER_MATCH', label: 'Buscando driver', icon: '📡' },
  { id: 'DRIVER_ASSIGNED', label: 'Asignado', icon: '🛵' },
  { id: 'PICKED_UP', label: 'En ruta', icon: '🚀' },
  { id: 'DELIVERY_PAYMENT_CONFIRMED', label: 'Envío pagado', icon: '💵' },
  { id: 'DELIVERED', label: 'Entregado', icon: '🏁' }
];

function TrackingMap({
  storeLatLng,
  userLatLng,
  driverPos,
  driverBearing,
  currentLeg,
  legPath,
  fullDeliveryPath,
}) {
  const mapCenter = useMemo(() => ({
    lat: (userLatLng.lat + storeLatLng.lat) / 2,
    lng: (userLatLng.lng + storeLatLng.lng) / 2,
  }), [userLatLng.lat, userLatLng.lng, storeLatLng.lat, storeLatLng.lng]);

  return (
    <MapView center={mapCenter} zoom={14}>
      <AutoFitBounds
        points={[storeLatLng, userLatLng, driverPos]}
        padding={100}
        fitKey={currentLeg}
      />

      <EmojiMarker position={userLatLng} preset="user" zIndex={20} />
      <EmojiMarker position={storeLatLng} preset="store" zIndex={20} />

      {fullDeliveryPath && (
        <RoutePolyline
          path={fullDeliveryPath}
          color={currentLeg === 'to_store' ? '#94A3B8' : '#3B82F6'}
          weight={4}
          opacity={currentLeg === 'to_store' ? 0.4 : 0.85}
        />
      )}

      {currentLeg === 'to_store' && legPath && (
        <RoutePolyline path={legPath} color="#10B981" weight={4} opacity={0.95} dashed />
      )}

      {driverPos && (
        <EmojiMarker
          position={driverPos}
          preset="driver"
          bounce
          zIndex={100}
          bearing={driverBearing}
        />
      )}
    </MapView>
  );
}

export function OrderDetailPage() {
  const { orderId } = useParams();
  const navigate = useNavigate();

  const { getOrderById, updateOrderStatus, upsertRemoteOrder } = useOrderStore();
  const customerId = useAuthStore((s) => s.userId);
  const { chats, initializeChat, addMessage } = useChatStore();

  const localOrder = getOrderById(orderId);
  const [remoteOrder, setRemoteOrder] = useState(null);
  const [isLoadingOrder, setIsLoadingOrder] = useState(true);
  const [store, setStore] = useState(null);
  const [isLoadingStore, setIsLoadingStore] = useState(true);
  const [activeTab, setActiveTab] = useState('store');
  const [inputText, setInputText] = useState('');

  const chatEndRef = useRef(null);

  const reportRealtimeError = (context, error) => {
    console.warn(`[OrderDetailPage] ${context}`, error?.message || error);
  };

  useEffect(() => {
    let mounted = true;
    if (!orderId) return;
    fetchOrderByIdRemote(orderId)
      .then((row) => {
        if (!mounted) return;
        setRemoteOrder(row);
        upsertRemoteOrder(row);
      })
      .catch((error) => reportRealtimeError('remote action failed', error))
      .finally(() => {
        if (mounted) setIsLoadingOrder(false);
      });
    return () => { mounted = false; };
  }, [orderId]);

  const order = useMemo(() => {
    if (!localOrder && !remoteOrder) return null;
    if (!remoteOrder) return localOrder;
    if (!localOrder) return remoteOrder;
    return { ...localOrder, ...remoteOrder, items: localOrder.items || [] };
  }, [localOrder, remoteOrder]);

  // Geometry derived from order (safe even before order exists — guarded).
  const storeLatLng = useMemo(() => order ? ({
    lat: order.storeLocation.lat, lng: order.storeLocation.lng,
  }) : null, [order?.storeLocation.lat, order?.storeLocation.lng]);
  const userLatLng = useMemo(() => order ? ({
    lat: order.userLocation.lat, lng: order.userLocation.lng,
  }) : null, [order?.userLocation.lat, order?.userLocation.lng]);
  const driverStartLatLng = useMemo(() => storeLatLng ? ({
    lat: storeLatLng.lat + 0.006, lng: storeLatLng.lng - 0.008,
  }) : null, [storeLatLng?.lat, storeLatLng?.lng]);

  const currentLeg = useMemo(() => {
    if (!order) return 'none';
    if (order.status === 'DRIVER_ASSIGNED') return 'to_store';
    if (['PICKED_UP', 'DRIVER_EN_ROUTE_TO_CUSTOMER', 'DELIVERY_PAYMENT_PENDING', 'DELIVERY_PAYMENT_REPORTED', 'DELIVERY_PAYMENT_CONFIRMED'].includes(order.status)) return 'to_client';
    if (order.status === 'DELIVERED') return 'delivered';
    return 'none';
  }, [order?.status]);

  const legOrigin = currentLeg === 'to_store' ? driverStartLatLng : storeLatLng;
  const legDest = currentLeg === 'to_store' ? storeLatLng : userLatLng;

  const { path: legPath, duration: legDurationSec } = useDirections(legOrigin, legDest);
  const { path: fullDeliveryPath } = useDirections(storeLatLng, userLatLng);

  const { driverPos: liveDriverPos, driverBearing: liveDriverBearing, signalAgeSec } = useLiveDriverTracking(orderId, driverStartLatLng);

  const resolvedDriverPos = liveDriverPos || (currentLeg === 'delivered' ? userLatLng : driverStartLatLng);
  const resolvedDriverBearing = liveDriverBearing ?? null;

  const remainingEtaText = useMemo(() => {
    if (legDurationSec == null) return null;
    if (currentLeg === 'to_store' || currentLeg === 'to_client') {
      return formatDurationMin(legDurationSec);
    }
    return null;
  }, [legDurationSec, currentLeg]);

  useEffect(() => {
    if (!order) return;

    initializeChat(orderId);

    fetchStoreById(order.storeId)
      .then(data => {
        setStore(data);
      })
      .catch((error) => reportRealtimeError('store fetch failed', error))
      .finally(() => {
        setIsLoadingStore(false);
      });
  }, [orderId, order?.storeId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chats, activeTab]);

  useEffect(() => {
    if (!orderId) return;
    const unsubscribe = subscribeToOrder(orderId, (row) => {
      if (!row) return;
      const mapped = {
        id: row.id,
        status: row.status,
        updatedAt: row.updated_at,
        driverId: row.driver_id,
      };
      upsertRemoteOrder(mapped);
      if (row?.status) updateOrderStatus(orderId, row.status);
    });
    return unsubscribe;
  }, [orderId, updateOrderStatus, upsertRemoteOrder]);


  if (isLoadingOrder) {
    return (
      <div className="order-detail-page" style={{ padding: '2rem', textAlign: 'center' }}>
        <Spinner size="lg" />
        <p style={{ marginTop: '1rem', color: 'var(--higo-gray-500)' }}>Cargando pedido...</p>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="order-detail-page" style={{ padding: '2rem', textAlign: 'center' }}>
        <ShieldAlert size={48} color="var(--higo-error)" style={{ marginBottom: '1rem' }} />
        <h3>Pedido no encontrado</h3>
        <p style={{ color: 'var(--higo-gray-500)', marginBottom: '1.5rem' }}>El identificador de la orden no corresponde a tus registros.</p>
        <button className="higo-btn" onClick={() => navigate('/shop/orders')}>Volver a pedidos</button>
      </div>
    );
  }

  const orderEvents = useOrderEvents(orderId);
  const orderChat = chats[orderId] || { storeMessages: [], driverMessages: [] };
  const currentMessages = activeTab === 'store' ? orderChat.storeMessages : orderChat.driverMessages;

  const handleSendMessage = (e) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    const text = inputText;
    setInputText('');
    const targetTab = activeTab === 'store' ? 'storeMessages' : 'driverMessages';
    addMessage(orderId, targetTab, { sender: 'customer', text });
  };

  const normalizeStatusForSteps = (status) => ({
    PENDING_PAYMENT: 'PENDING_PRODUCT_PAYMENT',
    PAYMENT_VERIFIED: 'PRODUCT_PAYMENT_VERIFIED',
    READY_TO_DISPATCH: 'READY_FOR_DRIVER_MATCH',
    DRIVER_CANDIDATE_BROADCASTED: 'READY_FOR_DRIVER_MATCH',
    DRIVER_EN_ROUTE_TO_STORE: 'DRIVER_ASSIGNED',
    DRIVER_EN_ROUTE_TO_CUSTOMER: 'PICKED_UP',
    DELIVERY_PAYMENT_PENDING: 'PICKED_UP',
    DELIVERY_PAYMENT_REPORTED: 'PICKED_UP',
  }[status] || status);

  const getStepIndex = (status) => STATUS_STEPS.findIndex(s => s.id === normalizeStatusForSteps(status));
  const currentStepIndex = getStepIndex(order.status);


  const reportProductPayment = () => {
    if (!orderId) return;
    updateOrderStatus(orderId, 'PRODUCT_PAYMENT_REPORTED');
    syncOrderStatus(orderId, 'PRODUCT_PAYMENT_REPORTED').catch((error) => reportRealtimeError('remote action failed', error));
    pushOrderEvent({
      orderId,
      eventType: 'PRODUCT_PAYMENT_REPORTED',
      actorType: 'customer',
      actorId: customerId || 'customer-demo',
      payload: { source: 'order_detail' },
    }).catch((error) => reportRealtimeError('remote action failed', error));
  };

  const reportDeliveryPayment = () => {
    if (!orderId) return;
    updateOrderStatus(orderId, 'DELIVERY_PAYMENT_REPORTED');
    syncOrderStatus(orderId, 'DELIVERY_PAYMENT_REPORTED').catch((error) => reportRealtimeError('remote action failed', error));
    pushOrderEvent({
      orderId,
      eventType: 'DELIVERY_PAYMENT_REPORTED',
      actorType: 'customer',
      actorId: customerId || 'customer-demo',
      payload: { source: 'order_detail' },
    }).catch((error) => reportRealtimeError('remote action failed', error));
  };

  return (
      <div className="order-detail-page">
        <div className="order-detail-header">
          <button className="back-btn" onClick={() => navigate('/shop/orders')}>
            <ArrowLeft size={20} />
          </button>
          <div>
            <h2>Seguimiento de Orden</h2>
            <span className="order-id-label">Ref: {order.id.slice(0, 8)}... · {formatOrderStatus(order.status)}</span>
          </div>
        </div>

        {/* MAP TRACKING VIEW */}
        <div className="tracking-map-container">
          <TrackingMap
            storeLatLng={storeLatLng}
            userLatLng={userLatLng}
            driverPos={resolvedDriverPos}
            driverBearing={resolvedDriverBearing}
            currentLeg={currentLeg}
            legPath={legPath}
            fullDeliveryPath={fullDeliveryPath}
          />

          {currentLeg !== 'none' && (
            <div className="floating-driver-eta">
              <Clock size={14} className="spinning-icon" />
              <span>
                {currentLeg === 'to_store' && `Repartidor en camino a la tienda${remainingEtaText ? ` · ${remainingEtaText}` : '...'}`}
                {currentLeg === 'to_client' && `¡Pedido en camino${remainingEtaText ? ` · llega en ${remainingEtaText}` : ' a tu dirección!'}`}
                {currentLeg === 'delivered' && '¡Entregado! Disfruta tu compra'}
              </span>
            </div>
          )}
        </div>

        
          {signalAgeSec != null && (
            <div className="floating-driver-eta" style={{ top: '0.75rem', bottom: 'auto' }}>
              <Navigation size={14} />
              <span>{signalAgeSec <= 10 ? 'Ubicación en vivo' : `Última señal hace ${signalAgeSec}s`}</span>
            </div>
          )}

        {/* FLOATING BOTTOM PANEL */}
        <div className="order-detail-bottom-panel">
          <div className="timeline-container">
            <div className="timeline-steps">
              {STATUS_STEPS.map((step, idx) => {
                const isCompleted = idx < currentStepIndex;
                const isActive = idx === currentStepIndex;
                const isPending = idx > currentStepIndex;
                return (
                  <div
                    key={step.id}
                    className={`timeline-step ${isCompleted ? 'completed' : ''} ${isActive ? 'active' : ''} ${isPending ? 'pending' : ''}`}
                  >
                    <div className="timeline-icon">
                      {isActive ? <span className="breathing-glow" /> : null}
                      {step.icon}
                    </div>
                    <div className="timeline-label">{step.label}</div>
                    {idx < STATUS_STEPS.length - 1 && (
                      <div className={`timeline-line ${idx < currentStepIndex ? 'completed' : ''}`} />
                    )}
                  </div>
                );
              })}
            </div>
          </div>


          <div style={{ marginBottom: '0.6rem' }}>
            <strong style={{ fontSize: '0.9rem' }}>Eventos en vivo</strong>
            <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.35rem', flexWrap: 'wrap' }}>
              {orderEvents.slice(0, 3).map((evt) => (
                <span key={evt.id} className="status-pill" style={{ fontSize: '0.72rem' }}>{formatOrderEventType(evt.event_type)}</span>
              ))}
            </div>
          </div>


          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
            {(order.status === 'PENDING_PRODUCT_PAYMENT' || order.status === 'PENDING_PAYMENT') && (
              <button className="higo-btn higo-btn-outline" onClick={reportProductPayment}>
                Ya pagué al comercio
              </button>
            )}
            {(order.status === 'PICKED_UP' || order.status === 'DRIVER_EN_ROUTE_TO_CUSTOMER' || order.status === 'DELIVERY_PAYMENT_PENDING') && (
              <button className="higo-btn higo-btn-outline" onClick={reportDeliveryPayment}>
                Ya pagué el envío al driver
              </button>
            )}
          </div>

          <div className="order-summary-header">
            <Store size={16} />
            <h3>{order.storeName}</h3>
            <span className="order-grand-total">{formatCurrency(order.grandTotal)}</span>
          </div>

          <div className="order-chat-container">
            <div className="chat-tabs">
              <button
                className={`chat-tab-btn ${activeTab === 'store' ? 'active' : ''}`}
                onClick={() => setActiveTab('store')}
              >
                <Store size={16} />
                Tienda
                {orderChat.storeMessages.length > 1 && <span className="tab-indicator" />}
              </button>
              <button
                className={`chat-tab-btn ${activeTab === 'driver' ? 'active' : ''}`}
                onClick={() => setActiveTab('driver')}
                disabled={getStepIndex(order.status) < 4}
              >
                <Truck size={16} />
                Higo Driver
                {orderChat.driverMessages.length > 1 && <span className="tab-indicator" />}
              </button>
            </div>

            <div className="chat-messages-thread">
              <AnimatePresence initial={false}>
                {currentMessages.map((msg) => {
                  if (msg.system) {
                    return (
                      <div key={msg.id} className="system-chat-message">
                        <span>{msg.text}</span>
                      </div>
                    );
                  }
                  const isMe = msg.sender === 'customer';
                  return (
                    <motion.div
                      key={msg.id}
                      className={`chat-bubble-wrapper ${isMe ? 'chat-bubble-wrapper--me' : 'chat-bubble-wrapper--other'}`}
                      initial={{ opacity: 0, y: 10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      transition={{ duration: 0.2 }}
                    >
                      <div className={`chat-bubble ${isMe ? 'chat-bubble--me' : 'chat-bubble--other'}`}>
                        {msg.image ? (
                          <div className="chat-image-attachment">
                            <img src={msg.image} alt="Adjunto de Pago" />
                            <div className="chat-image-attachment__label">
                              <Image size={14} /> {msg.text}
                            </div>
                          </div>
                        ) : (
                          <p>{msg.text}</p>
                        )}
                        <span className="chat-timestamp">
                          {new Date(msg.timestamp).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
              <div ref={chatEndRef} />
            </div>


            <form className="chat-input-bar" onSubmit={handleSendMessage}>
              <input
                type="text"
                placeholder={
                  activeTab === 'driver' && getStepIndex(order.status) < 4
                    ? 'Esperando asignación de Driver...'
                    : `Mensaje a ${activeTab === 'store' ? 'la tienda' : 'repartidor'}...`
                }
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                disabled={activeTab === 'driver' && getStepIndex(order.status) < 4}
              />
              <button
                type="submit"
                className="chat-send-btn"
                disabled={!inputText.trim() || (activeTab === 'driver' && getStepIndex(order.status) < 4)}
              >
                <Send size={18} />
              </button>
            </form>
          </div>
        </div>
      </div>
  );
}
