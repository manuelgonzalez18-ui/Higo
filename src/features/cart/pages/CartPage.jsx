import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Plus, Minus, Trash2, ShoppingBag, Store, AlertTriangle } from 'lucide-react';
import { useCartStore } from '../../../stores/shop/useCartStore.js';
import { useLocationStore } from '../../../stores/shop/useLocationStore.js';
import { fetchStores } from '../../../services/shopStoreService.js';
import { formatCurrency } from '../../../services/shopDeliveryPricing.js';
import { calculateDistance } from '../../../services/shopGeolocation.js';
import { Spinner } from '../../../components/shop/ui/Spinner.jsx';
import './CartPage.css';

export function CartPage() {
  const navigate = useNavigate();
  const { carts, updateQuantity, removeItem } = useCartStore();
  const { userLocation } = useLocationStore();
  const [storesList, setStoresList] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  // Fetch stores to get metadata (names, locations)
  useEffect(() => {
    let isMounted = true;
    fetchStores().then(data => {
      if (isMounted) {
        setStoresList(data);
        setIsLoading(false);
      }
    });
    return () => { isMounted = false; };
  }, []);

  const storeIds = Object.keys(carts).filter(id => carts[id]?.items?.length > 0);

  if (isLoading) {
    return (
      <div className="cart-page-loading">
        <Spinner size="lg" />
        <p>Cargando tus carritos activos...</p>
      </div>
    );
  }

  if (storeIds.length === 0) {
    return (
      <div className="cart-page">
        <div className="cart-header">
          <button className="cart-header__back" onClick={() => navigate(-1)}>
            <ArrowLeft size={20} />
          </button>
          <h1>Carritos</h1>
        </div>
        <div className="cart-empty">
          <ShoppingBag size={64} strokeWidth={1.2} />
          <h2>Tu cesta está vacía</h2>
          <p>Encuentra tus platos y productos favoritos en las tiendas de Higo Shop.</p>
          <Link to="/shop" className="cart-empty__btn">
            <Store size={18} />
            Explorar tiendas
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="cart-page">
      <div className="cart-header">
        <button className="cart-header__back" onClick={() => navigate(-1)}>
          <ArrowLeft size={20} />
        </button>
        <h1>Carritos</h1>
      </div>

      <div className="carts-container">
        {storeIds.map(storeId => {
          const store = storesList.find(s => s.id === storeId);
          const cartItems = carts[storeId]?.items || [];
          const cartTotal = cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
          
          // Calculate distance and determine warning
          const distance = userLocation && store
            ? calculateDistance(userLocation.lat, userLocation.lng, store.latitude, store.longitude)
            : 0;
          const isFar = distance > 8; // 8km limit for delivery warning

          return (
            <div key={storeId} className="cart-merchant-card animate-fade-in-up">
              {/* Merchant Title & Emoji */}
              <div className="cart-merchant-header">
                <div className={`cart-merchant-emoji-bg cart-merchant-emoji-bg--${store?.category || 'restaurant'}`}>
                  {store?.category === 'restaurant' ? '🫓' : store?.category === 'pharmacy' ? '💊' : store?.category === 'bakery' ? '🥐' : store?.category === 'grocery' ? '🛒' : '☕'}
                </div>
                <div className="cart-merchant-title-col">
                  <h3>{store?.name || 'Cargando comercio...'}</h3>
                  <span className="cart-merchant-address truncate">{store?.address}</span>
                </div>
              </div>

              {/* Closed store warning banner */}
              {store && store.isOpen === false && (
                <div className="cart-distance-warning">
                  <AlertTriangle size={15} />
                  <span>🌙 Esta tienda está cerrada ahora; podrás pagar cuando vuelva a abrir</span>
                </div>
              )}

              {/* Distance Warning banner */}
              {isFar && (
                <div className="cart-distance-warning">
                  <AlertTriangle size={15} />
                  <span>⚠️ Parece que estás lejos de esta tienda</span>
                </div>
              )}

              {/* Cart Items List */}
              <div className="cart-merchant-items">
                <AnimatePresence>
                  {cartItems.map(item => (
                    <motion.div
                      key={item.id}
                      className="cart-merchant-item"
                      layout
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, x: -30, height: 0, padding: 0 }}
                      transition={{ duration: 0.2 }}
                    >
                      <div className="cart-item-desc">
                        <span className="cart-item-name">{item.name}</span>
                        <span className="cart-item-price-each">{formatCurrency(item.price)} c/u</span>
                      </div>

                      <div className="cart-item-actions-row">
                        <div className="cart-item-controls">
                          <button
                            className="cart-item-qty-btn"
                            onClick={() => updateQuantity(storeId, item.id, item.quantity - 1)}
                            disabled={item.quantity <= 1}
                          >
                            <Minus size={12} />
                          </button>
                          <span className="cart-item-qty">{item.quantity}</span>
                          <button
                            className="cart-item-qty-btn"
                            onClick={() => updateQuantity(storeId, item.id, item.quantity + 1)}
                          >
                            <Plus size={12} />
                          </button>
                        </div>

                        <span className="cart-item-total-price">
                          {formatCurrency(item.price * item.quantity)}
                        </span>

                        <button
                          className="cart-item-trash-btn"
                          onClick={() => removeItem(storeId, item.id)}
                          title="Eliminar artículo"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>

              {/* Cart Summary & Subtotal */}
              <div className="cart-merchant-summary">
                <div className="summary-row">
                  <span>Subtotal ({cartItems.length} prod.)</span>
                  <span className="summary-val">{formatCurrency(cartTotal)}</span>
                </div>
              </div>

              {/* Merchant Checkout and Navigate Actions */}
              <div className="cart-merchant-actions">
                <Link
                  to={`/shop/checkout/${storeId}`}
                  className="btn-merchant-checkout"
                  id={`checkout-store-${storeId}`}
                >
                  Ir a pagar ({formatCurrency(cartTotal)})
                </Link>
                <Link
                  to={`/shop/store/${storeId}`}
                  className="btn-merchant-continue"
                >
                  Ve la tienda
                </Link>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
