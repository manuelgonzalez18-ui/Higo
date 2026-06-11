import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowLeft, MapPin, Store, Truck, Phone, Building2,
  CreditCard, Banknote, Smartphone, Copy, Check,
  Navigation, Clock, ShoppingBag, Send, Edit3, LocateFixed
} from 'lucide-react';
import { useMapsLibrary } from '@vis.gl/react-google-maps';
import { getCurrentPosition } from '../../../services/shopGeolocation.js';
import { fetchStoreById, fetchProductsByStoreId } from '../../../services/shopStoreService.js';
import { useCartStore } from '../../../stores/shop/useCartStore.js';
import { useLocationStore } from '../../../stores/shop/useLocationStore.js';
import { useOrderStore } from '../../../stores/shop/useOrderStore.js';
import { useAuthStore } from '../../../stores/shop/useAuthStore.js';
import { createOrderRemote } from '../../../services/shopOrderService.js';
import { pushOrderEvent } from '../../../services/shopTrackingService.js';
import { useDeliveryFee } from '../../../hooks/shop/useDeliveryFee.js';
import { useDirections } from '../../../hooks/shop/useDirections.js';
import { formatCurrency, calculateChange } from '../../../services/shopDeliveryPricing.js';
import { Spinner } from '../../../components/shop/ui/Spinner.jsx';
import { MapView } from '../../../components/shop/maps/MapView.jsx';
import { EmojiMarker } from '../../../components/shop/maps/EmojiMarker.jsx';
import { RoutePolyline } from '../../../components/shop/maps/RoutePolyline.jsx';
import { AddressAutocomplete } from '../../../components/shop/maps/AddressAutocomplete.jsx';
import './CheckoutPage.css';

function CheckoutMap({ origin, destination, path }) {
  const center = useMemo(() => ({
    lat: (origin.lat + destination.lat) / 2,
    lng: (origin.lng + destination.lng) / 2,
  }), [origin.lat, origin.lng, destination.lat, destination.lng]);

  return (
    <MapView center={center} zoom={14}>
      <EmojiMarker position={origin} preset="user" />
      <EmojiMarker position={destination} preset="store" />
      {path && <RoutePolyline path={path} color="#3B82F6" weight={4} opacity={0.9} fitBounds />}
    </MapView>
  );
}

export function CheckoutPage() {
  const { storeId } = useParams();
  const navigate = useNavigate();

  const [store, setStore] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isEditingAddress, setIsEditingAddress] = useState(false);

  const { carts, clearCart, reconcileCart } = useCartStore();
  const { userLocation, deliveryAddress, setUserLocation, setDeliveryAddress } = useLocationStore();
  const { createOrder } = useOrderStore();
  const customerId = useAuthStore((s) => s.userId);

  const directionsOrigin = userLocation ? { lat: userLocation.lat, lng: userLocation.lng } : null;
  const directionsDest = store ? { lat: store.latitude, lng: store.longitude } : null;
  const { path: routePath, distance: liveDistM, duration: liveDurS } = useDirections(
    directionsOrigin,
    directionsDest,
  );
  const { distance, distanceText, fee, feeText, estimatedTime } = useDeliveryFee(
    store?.latitude,
    store?.longitude,
    { liveDistanceMeters: liveDistM, liveDurationSeconds: liveDurS },
  );

  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);
    fetchStoreById(storeId).then(data => {
      if (isMounted) {
        setStore(data);
        setIsLoading(false);
      }
    });
    return () => { isMounted = false; };
  }, [storeId]);

  const [deliveryPayMethod, setDeliveryPayMethod] = useState('cash');
  const [paidWithAmount, setPaidWithAmount] = useState('');
  const [copied, setCopied] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  const items = carts[storeId]?.items || [];
  const productTotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const grandTotal = productTotal + fee;

  const change = useMemo(() => {
    if (!paidWithAmount) return 0;
    return calculateChange(fee, parseFloat(paidWithAmount));
  }, [fee, paidWithAmount]);

  const handleCopyPagoMovil = () => {
    if (!store) return;
    const text = `Pago Móvil\nTeléfono: ${store.pagoMovil.phone}\nBanco: ${store.pagoMovil.bank}\nCédula: ${store.pagoMovil.cedula}\nTitular: ${store.pagoMovil.holder}\nMonto: ${formatCurrency(productTotal)}`;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handlePlaceSelect = (place) => {
    setDeliveryAddress(place.address);
    setUserLocation({ lat: place.lat, lng: place.lng });
    setIsEditingAddress(false);
  };

  const geocodingLib = useMapsLibrary('geocoding');
  const [isLocatingMe, setIsLocatingMe] = useState(false);

  const handleUseMyLocation = async () => {
    setIsLocatingMe(true);
    try {
      const pos = await getCurrentPosition();
      setUserLocation(pos);
      if (geocodingLib) {
        const geocoder = new geocodingLib.Geocoder();
        geocoder.geocode({ location: pos }, (results, status) => {
          if (status === 'OK' && results[0]) {
            setDeliveryAddress(results[0].formatted_address);
          }
          setIsLocatingMe(false);
          setIsEditingAddress(false);
        });
      } else {
        setIsLocatingMe(false);
        setIsEditingAddress(false);
      }
    } catch (err) {
      setIsLocatingMe(false);
    }
  };

  const handleConfirmOrder = async () => {
    if (!store) return;
    setSubmitError(null);

    if (store.isOpen === false) {
      setSubmitError('La tienda está cerrada en este momento. Intenta cuando vuelva a abrir.');
      return;
    }
    if (!userLocation) {
      setSubmitError('Selecciona tu dirección de entrega antes de confirmar el pedido.');
      return;
    }
    if (deliveryPayMethod === 'cash' && paidWithAmount && parseFloat(paidWithAmount) < fee) {
      setSubmitError(`El monto en efectivo es menor a la tarifa de envío (${feeText}).`);
      return;
    }
    setIsSubmitting(true);

    // Revalidar disponibilidad y precios contra el catálogo vigente antes
    // de cobrar: si algo cambió, se ajusta el carrito y el usuario revisa.
    try {
      const liveProducts = await fetchProductsByStoreId(storeId);
      const { removed, repriced } = reconcileCart(storeId, liveProducts);
      if (removed.length || repriced.length) {
        setIsSubmitting(false);
        const parts = [];
        if (removed.length) parts.push(`ya no disponibles: ${removed.join(', ')}`);
        if (repriced.length) parts.push(`cambiaron de precio: ${repriced.join(', ')}`);
        setSubmitError(`Tu carrito fue actualizado (${parts.join(' · ')}). Revisa el total y confirma de nuevo.`);
        return;
      }
    } catch (err) {
      console.warn('[Checkout] revalidación de productos falló:', err?.message || err);
    }

    const baseOrderData = {
      storeId: store.id,
      storeName: store.name,
      items: items.map(i => ({ id: i.id, name: i.name, price: i.price, quantity: i.quantity })),
      productTotal,
      deliveryFee: fee,
      grandTotal,
      deliveryPayMethod,
      paidWithAmount: deliveryPayMethod === 'cash' ? parseFloat(paidWithAmount) || 0 : 0,
      changeAmount: deliveryPayMethod === 'cash' ? change : 0,
      deliveryAddress,
      userLocation,
      storeLocation: { lat: store.latitude, lng: store.longitude },
      storePagoMovil: store.pagoMovil,
      productPaymentStatus: 'PENDING_PRODUCT_PAYMENT',
      deliveryPaymentStatus: 'DELIVERY_PAYMENT_PENDING',
    };

    let remote = null;
    try {
      remote = await createOrderRemote({
        customer_id: customerId,
        store_id: store.id,
        total: grandTotal,
        delivery_fee: fee,
        items: items.map(i => ({ id: i.id, name: i.name, quantity: i.quantity, price: i.price })),
        payment_method: deliveryPayMethod === 'cash' ? 'cash' : 'pago_movil',
        payment_status: 'PENDING',
        delivery_address: deliveryAddress,
        delivery_latitude: userLocation.lat,
        delivery_longitude: userLocation.lng,
      });
    } catch (err) {
      console.warn('[Checkout] createOrderRemote failed:', err?.message || err);
    }

    if (remote) {
      createOrder({
        ...baseOrderData,
        id: remote.id,
        status: remote.status || 'PENDING_PRODUCT_PAYMENT',
        createdAt: remote.createdAt,
        updatedAt: remote.updatedAt,
        driverId: remote.driverId,
      });
      // Best-effort event: a failure here must not duplicate the order.
      pushOrderEvent({
        orderId: remote.id,
        eventType: 'ORDER_CREATED',
        actorType: 'customer',
        actorId: customerId,
        payload: { city: 'Higuerote' },
      }).catch((err) => console.warn('[Checkout] pushOrderEvent failed:', err?.message || err));
    } else if (customerId) {
      // Logged-in user: the merchant only sees remote orders, so failing
      // silently would strand the customer. Let them retry.
      setIsSubmitting(false);
      setSubmitError('No pudimos registrar tu pedido. Revisa tu conexión e intenta de nuevo.');
      return;
    } else {
      // Guest/demo flow without backend: keep the local-only order.
      createOrder(baseOrderData);
    }

    clearCart(storeId);

    setTimeout(() => {
      setIsSubmitting(false);
      navigate(`/shop/orders`, { replace: true });
    }, 800);
  };

  if (isLoading) {
    return (
      <div className="checkout-page" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '80dvh', gap: '16px' }}>
        <Spinner size="lg" />
        <p style={{ color: 'var(--higo-gray-400)' }}>Cargando detalles de pago...</p>
      </div>
    );
  }

  if (!store || items.length === 0) {
    return (
      <div className="checkout-page">
        <div className="checkout-header">
          <button className="checkout-header__back" onClick={() => navigate(-1)}>
            <ArrowLeft size={20} />
          </button>
          <h1>Checkout</h1>
        </div>
        <div className="cart-empty" style={{ padding: '4rem 1rem' }}>
          <ShoppingBag size={48} strokeWidth={1.5} style={{ color: 'var(--higo-gray-300)', marginBottom: '1rem' }} />
          <h2 style={{ fontSize: 'var(--font-lg)', color: 'var(--higo-gray-600)' }}>No hay productos</h2>
          <p style={{ fontSize: 'var(--font-sm)', color: 'var(--higo-gray-400)' }}>Agrega productos antes de continuar</p>
        </div>
      </div>
    );
  }

  return (
    <div className="checkout-page">
        <div className="checkout-header">
          <button className="checkout-header__back" onClick={() => navigate(-1)}>
            <ArrowLeft size={20} />
          </button>
          <h1>Pago dividido del pedido</h1>
        </div>

        {/* Delivery Address */}
        <motion.div
          className="checkout-section"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
        >
          <div className="checkout-section__header">
            <MapPin size={18} color="var(--higo-blue)" />
            Dirección de entrega
          </div>
          <div className="checkout-section__body">
            {isEditingAddress ? (
              <div className="address-edit-wrapper">
                <AddressAutocomplete
                  value={deliveryAddress}
                  onChange={setDeliveryAddress}
                  onPlaceSelect={handlePlaceSelect}
                  placeholder="Buscar dirección con Google Maps..."
                  className="address-autocomplete-input"
                  autoFocus
                />
                <button
                  className="address-use-location"
                  onClick={handleUseMyLocation}
                  disabled={isLocatingMe}
                  type="button"
                >
                  <LocateFixed size={14} className={isLocatingMe ? 'spinning-icon' : ''} />
                  {isLocatingMe ? 'Obteniendo...' : 'Usar mi ubicación'}
                </button>
                <button
                  className="address-edit-cancel"
                  onClick={() => setIsEditingAddress(false)}
                  type="button"
                >
                  Cancelar
                </button>
              </div>
            ) : (
              <div className="checkout-address" onClick={() => setIsEditingAddress(true)}>
                <Navigation size={16} />
                <span className="checkout-address__text">{deliveryAddress}</span>
                <Edit3 size={14} style={{ marginLeft: 'auto', opacity: 0.6 }} />
              </div>
            )}
            {userLocation && (
              <div className="checkout-map">
                <CheckoutMap
                  origin={{ lat: userLocation.lat, lng: userLocation.lng }}
                  destination={{ lat: store.latitude, lng: store.longitude }}
                  path={routePath}
                />
              </div>
            )}
            <div className="distance-info" style={{ marginTop: 'var(--space-2)' }}>
              <Navigation size={15} />
              <span>{distanceText} de distancia</span>
              <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
                <Clock size={14} /> {estimatedTime}
              </span>
            </div>
          </div>
        </motion.div>

        {/* Order Items Summary */}
        <motion.div
          className="checkout-section"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <div className="checkout-section__header">
            <ShoppingBag size={18} color="var(--higo-blue)" />
            Resumen del pedido — {store.name}
          </div>
          <div className="checkout-section__body">
            <div className="checkout-items">
              {items.map(item => (
                <div key={item.id} className="checkout-item">
                  <span>
                    {item.name}
                    <span className="checkout-item__qty">x{item.quantity}</span>
                  </span>
                  <span style={{ fontWeight: 600 }}>{formatCurrency(item.price * item.quantity)}</span>
                </div>
              ))}
            </div>
          </div>
        </motion.div>

        {/* PAYMENT BLOCK 1: Store Payment */}
        <motion.div
          className="checkout-section"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
        >
          <div className="checkout-section__body" style={{ padding: 'var(--space-4)' }}>
            <div className="payment-block payment-block--store">
              <div className="payment-block__label">
                <Store size={15} />
                Pago al comercio (productos)
              </div>
              <div className="payment-block__amount">
                {formatCurrency(productTotal)}
              </div>
              <div className="payment-block__divider" />
              <p style={{ fontSize: 'var(--font-xs)', color: 'var(--higo-gray-500)', marginBottom: 'var(--space-3)' }}>
                Pagar vía Pago Móvil directamente al comercio:
              </p>
              <div className="pago-movil-info">
                <div className="pago-movil-row">
                  <Phone size={14} />
                  <span>Teléfono:</span>
                  <span style={{ fontWeight: 600 }}>{store.pagoMovil.phone}</span>
                </div>
                <div className="pago-movil-row">
                  <Building2 size={14} />
                  <span>Banco:</span>
                  <span style={{ fontWeight: 600 }}>{store.pagoMovil.bank}</span>
                </div>
                <div className="pago-movil-row">
                  <CreditCard size={14} />
                  <span>Cédula:</span>
                  <span style={{ fontWeight: 600 }}>{store.pagoMovil.cedula}</span>
                </div>
                <div className="pago-movil-row">
                  <span style={{ width: 14 }}>👤</span>
                  <span>Titular:</span>
                  <span style={{ fontWeight: 600 }}>{store.pagoMovil.holder}</span>
                </div>
              </div>
              <button
                className={`copy-btn ${copied ? 'copy-btn--copied' : ''}`}
                onClick={handleCopyPagoMovil}
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? 'Datos copiados' : 'Copiar datos de pago'}
              </button>
            </div>
          </div>
        </motion.div>

        {/* PAYMENT BLOCK 2: Driver Payment */}
        <motion.div
          className="checkout-section"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <div className="checkout-section__body" style={{ padding: 'var(--space-4)' }}>
            <div className="payment-block payment-block--driver">
              <div className="payment-block__label">
                <Truck size={15} />
                Tarifa de envío (al Driver)
              </div>
              <div className="payment-block__amount">
                {feeText}
              </div>
              <div className="distance-info">
                <Navigation size={14} />
                <span>Distancia: {distanceText}</span>
              </div>
              <div className="payment-block__divider" />

              <p style={{ fontSize: 'var(--font-xs)', color: 'var(--higo-gray-500)', marginBottom: 'var(--space-2)' }}>
                Método de pago al Driver:
              </p>
              <div className="payment-method-group">
                <button
                  className={`payment-method-option ${deliveryPayMethod === 'cash' ? 'payment-method-option--active' : ''}`}
                  onClick={() => setDeliveryPayMethod('cash')}
                >
                  <Banknote size={18} />
                  Efectivo
                </button>
                <button
                  className={`payment-method-option ${deliveryPayMethod === 'pago_movil' ? 'payment-method-option--active' : ''}`}
                  onClick={() => setDeliveryPayMethod('pago_movil')}
                >
                  <Smartphone size={18} />
                  Pago Móvil
                </button>
              </div>

              {deliveryPayMethod === 'cash' && (
                <motion.div
                  className="change-calculator"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  transition={{ duration: 0.25 }}
                >
                  <label htmlFor="paid-with">
                    💵 ¿Con cuánto vas a pagar?
                  </label>
                  <input
                    id="paid-with"
                    type="number"
                    min="0"
                    step="0.5"
                    placeholder={`Mínimo ${feeText}`}
                    value={paidWithAmount}
                    onChange={(e) => setPaidWithAmount(e.target.value)}
                  />
                  {paidWithAmount && parseFloat(paidWithAmount) >= fee && (
                    <div className="change-result">
                      🪙 Requiere vuelto de: {formatCurrency(change)}
                    </div>
                  )}
                  {paidWithAmount && parseFloat(paidWithAmount) < fee && (
                    <div className="change-result" style={{ color: 'var(--higo-error)' }}>
                      ⚠️ Monto insuficiente
                    </div>
                  )}
                </motion.div>
              )}
            </div>
          </div>
        </motion.div>

        {/* Confirm Bar */}
        <div className="checkout-confirm-bar">
          {submitError && (
            <div className="checkout-submit-error" role="alert">
              ⚠️ {submitError}
            </div>
          )}
          <div className="checkout-confirm-total">
            <span>Total general</span>
            <span>{formatCurrency(grandTotal)}</span>
          </div>
          <motion.button
            className="checkout-confirm-btn"
            onClick={handleConfirmOrder}
            disabled={isSubmitting}
            whileTap={{ scale: 0.97 }}
          >
            {isSubmitting ? (
              <span>Procesando...</span>
            ) : (
              <>
                <Send size={18} />
                <span>Confirmar Pedido</span>
              </>
            )}
          </motion.button>
        </div>
    </div>
  );
}
