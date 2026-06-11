import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Star, Clock, MapPin, Plus, Minus, ShoppingBag } from 'lucide-react';
import { fetchStoreById, fetchProductsByStoreId } from '../../../services/shopStoreService.js';
import { useCartStore } from '../../../stores/shop/useCartStore.js';
import { useDeliveryFee } from '../../../hooks/shop/useDeliveryFee.js';
import { formatCurrency } from '../../../services/shopDeliveryPricing.js';
import { BottomSheet } from '../../../components/shop/ui/BottomSheet.jsx';
import { Spinner } from '../../../components/shop/ui/Spinner.jsx';
import './StoreView.css';

const categoryEmojis = {
  restaurant: '🍽️', pharmacy: '💊', bakery: '🥐', grocery: '🛒', cafe: '☕',
};

const productEmojis = {
  Arepas: '🫓', Bebidas: '🥤', Especiales: '✨', Pollos: '🍗', Platos: '🍛',
  Ensaladas: '🥗', Extras: '🍟', Medicamentos: '💊', Vitaminas: '💪',
  'Cuidado Personal': '🧴', Protección: '😷', Panes: '🍞', Dulces: '🍰',
  Salados: '🥟', Hamburguesas: '🍔', Rolls: '🍣', Sashimi: '🐟',
  Entradas: '🥟', Café: '☕', Repostería: '🧁', Desayunos: '🍳',
  Básicos: '🛒', Charcutería: '🧀', Licores: '🍷', Snacks: '🍫',
};

export function StoreView() {
  const { storeId } = useParams();
  const navigate = useNavigate();
  const [store, setStore] = useState(null);
  const [products, setProducts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  
  const { addItem, getCartItems, getCartTotal, getCartItemCount, updateQuantity } = useCartStore();
  const { distanceText, estimatedTime } = useDeliveryFee(store?.latitude, store?.longitude);

  const [activeCategory, setActiveCategory] = useState('all');
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [addedProductId, setAddedProductId] = useState(null);

  // Fetch store and products dynamically from Supabase
  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);

    Promise.all([
      fetchStoreById(storeId),
      fetchProductsByStoreId(storeId)
    ]).then(([storeData, productsData]) => {
      if (isMounted) {
        setStore(storeData);
        setProducts(productsData);
        setIsLoading(false);
      }
    });

    return () => { isMounted = false; };
  }, [storeId]);

  const categories = useMemo(() => {
    const cats = [...new Set(products.map(p => p.category))];
    return ['all', ...cats];
  }, [products]);

  const filteredProducts = useMemo(() => {
    if (activeCategory === 'all') return products;
    return products.filter(p => p.category === activeCategory);
  }, [products, activeCategory]);

  const groupedProducts = useMemo(() => {
    const groups = {};
    filteredProducts.forEach(p => {
      if (!groups[p.category]) groups[p.category] = [];
      groups[p.category].push(p);
    });
    return groups;
  }, [filteredProducts]);

  const cartItems = getCartItems(storeId);
  const cartTotal = getCartTotal(storeId);
  const cartCount = getCartItemCount(storeId);

  const getItemQuantityInCart = (productId) => {
    const item = cartItems.find(i => i.id === productId);
    return item ? item.quantity : 0;
  };

  const isStoreOpen = store?.isOpen !== false;

  const handleAddToCart = (product) => {
    if (!isStoreOpen) return;
    addItem(storeId, product, 1);
    setAddedProductId(product.id);
    setTimeout(() => setAddedProductId(null), 600);
  };

  if (isLoading) {
    return (
      <div className="store-view" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '80dvh', gap: '16px' }}>
        <Spinner size="lg" />
        <p style={{ color: 'var(--higo-gray-400)' }}>Cargando menú...</p>
      </div>
    );
  }

  if (!store) {
    return (
      <div className="store-view" style={{ padding: '2rem', textAlign: 'center' }}>
        <p>Comercio no encontrado</p>
        <button onClick={() => navigate('/shop')}>Volver al inicio</button>
      </div>
    );
  }

  return (
    <div className="store-view">
      {/* Hero */}
      <div className="store-hero">
        <div className={`store-hero__bg store-hero__bg--${store.category}`}>
          {categoryEmojis[store.category] || '🏪'}
        </div>
        <div className="store-hero__overlay" />
        <button className="store-hero__back" onClick={() => navigate(-1)}>
          <ArrowLeft size={20} />
        </button>
      </div>

      {/* Info Card */}
      <motion.div
        className="store-info-card"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <h1 className="store-info-card__name">{store.name}</h1>
        <p className="store-info-card__description">{store.description}</p>
        <div className="store-info-card__meta">
          <span className="store-meta-item store-meta-item--rating">
            <Star size={15} fill="currentColor" />
            {store.rating.toFixed(1)} ({store.reviewCount})
          </span>
          <span className="store-meta-item store-meta-item--time">
            <Clock size={15} />
            {estimatedTime}
          </span>
          <span className="store-meta-item">
            <MapPin size={15} />
            {distanceText}
          </span>
          <span className={`store-meta-item store-meta-item--${store.isOpen ? 'open' : 'closed'}`}>
            {store.isOpen ? '● Abierto' : '● Cerrado'}
          </span>
        </div>
        {!isStoreOpen && (
          <div className="store-closed-banner" role="status">
            🌙 Esta tienda está cerrada en este momento. Puedes ver el menú, pero no hacer pedidos hasta que abra.
          </div>
        )}
      </motion.div>

      {/* Category Tabs */}
      <div className="store-categories">
        <div className="store-categories__scroll">
          {categories.map(cat => (
            <button
              key={cat}
              className={`category-tab ${activeCategory === cat ? 'category-tab--active' : ''}`}
              onClick={() => setActiveCategory(cat)}
            >
              {cat === 'all' ? 'Todo' : cat}
            </button>
          ))}
        </div>
      </div>

      {/* Products */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2 }}
      >
        {Object.entries(groupedProducts).map(([category, items]) => (
          <div key={category} className="menu-section">
            <h3 className="menu-section__title">
              {productEmojis[category] || '📦'} {category}
            </h3>
            <div className="menu-section__items">
              {items.map(product => {
                const qtyInCart = getItemQuantityInCart(product.id);
                return (
                  <motion.div
                    key={product.id}
                    className={`product-item ${!product.available ? 'product-item--unavailable' : ''}`}
                    layout
                    whileTap={{ scale: 0.98 }}
                  >
                    <div
                      className="product-item__image"
                      onClick={() => product.available && isStoreOpen && setSelectedProduct(product)}
                      style={{ cursor: product.available && isStoreOpen ? 'pointer' : 'default' }}
                    >
                      <div className="product-item__image-placeholder">
                        {productEmojis[category] || '📦'}
                      </div>
                    </div>
                    <div className="product-item__content">
                      <div>
                        <div className="product-item__name">{product.name}</div>
                        <div className="product-item__description">{product.description}</div>
                      </div>
                      <div className="product-item__footer">
                        <span className="product-item__price">{formatCurrency(product.price)}</span>
                        {!product.available ? (
                          <span className="product-item__unavailable-tag">Agotado</span>
                        ) : !isStoreOpen ? (
                          <span className="product-item__unavailable-tag">Cerrado</span>
                        ) : qtyInCart > 0 ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <button
                              className="product-item__add-btn"
                              style={{ width: 28, height: 28, background: 'var(--higo-gray-200)', color: 'var(--higo-gray-700)', boxShadow: 'none' }}
                              onClick={() => updateQuantity(storeId, product.id, qtyInCart - 1)}
                            >
                              <Minus size={14} />
                            </button>
                            <span style={{ fontWeight: 600, minWidth: 20, textAlign: 'center' }}>{qtyInCart}</span>
                            <button
                              className="product-item__add-btn"
                              onClick={() => handleAddToCart(product)}
                            >
                              <Plus size={14} />
                            </button>
                          </div>
                        ) : (
                          <motion.button
                            className="product-item__add-btn"
                            onClick={() => handleAddToCart(product)}
                            animate={addedProductId === product.id ? { scale: [1, 1.3, 1] } : {}}
                            transition={{ duration: 0.3 }}
                          >
                            <Plus size={16} />
                          </motion.button>
                        )}
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </div>
        ))}
      </motion.div>

      {/* Floating Cart */}
      <AnimatePresence>
        {cartCount > 0 && (
          <motion.div
            className="floating-cart"
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            transition={{ type: 'spring', damping: 20, stiffness: 300 }}
          >
            <Link to="/shop/cart" className="floating-cart__btn" id="go-to-cart">
              <span className="floating-cart__count">
                <ShoppingBag size={20} />
                <span className="floating-cart__count-badge">{cartCount}</span>
                Ver carrito
              </span>
              <span className="floating-cart__total">{formatCurrency(cartTotal)}</span>
            </Link>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Product Detail Bottom Sheet */}
      <BottomSheet
        isOpen={!!selectedProduct}
        onClose={() => setSelectedProduct(null)}
        title={selectedProduct?.name}
      >
        {selectedProduct && (
          <ProductDetailSheet
            product={selectedProduct}
            storeId={storeId}
            onClose={() => setSelectedProduct(null)}
          />
        )}
      </BottomSheet>
    </div>
  );
}

function ProductDetailSheet({ product, storeId, onClose }) {
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState('');
  const { addItem } = useCartStore();

  const handleAdd = () => {
    addItem(storeId, { ...product, notes }, quantity);
    onClose();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div style={{
        height: 160,
        borderRadius: 'var(--radius-md)',
        background: 'linear-gradient(135deg, var(--higo-gray-100), var(--higo-gray-200))',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '3rem',
      }}>
        {productEmojis[product.category] || '📦'}
      </div>

      <p style={{ fontSize: 'var(--font-sm)', color: 'var(--higo-gray-600)', lineHeight: 'var(--leading-relaxed)' }}>
        {product.description}
      </p>

      <div style={{ fontSize: 'var(--font-xl)', fontWeight: 700, color: 'var(--higo-blue)' }}>
        {formatCurrency(product.price)}
      </div>

      {/* Quantity */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontWeight: 600 }}>Cantidad</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            onClick={() => setQuantity(q => Math.max(1, q - 1))}
            style={{
              width: 36, height: 36, borderRadius: '50%',
              background: 'var(--higo-gray-100)', display: 'flex',
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Minus size={16} />
          </button>
          <span style={{ fontWeight: 700, fontSize: 'var(--font-lg)', minWidth: 28, textAlign: 'center' }}>
            {quantity}
          </span>
          <button
            onClick={() => setQuantity(q => q + 1)}
            style={{
              width: 36, height: 36, borderRadius: '50%',
              background: 'var(--higo-blue)', color: 'white',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Plus size={16} />
          </button>
        </div>
      </div>

      {/* Notes */}
      <div>
        <label style={{ display: 'block', fontSize: 'var(--font-sm)', fontWeight: 500, marginBottom: 6, color: 'var(--higo-gray-700)' }}>
          Notas especiales (opcional)
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Ej: Sin cebolla, extra salsa..."
          rows={2}
          style={{
            width: '100%', padding: '10px 14px',
            borderRadius: 'var(--radius-sm)',
            border: '1.5px solid var(--higo-gray-200)',
            fontSize: 'var(--font-sm)',
            resize: 'none',
            transition: 'border-color 0.2s',
          }}
          onFocus={(e) => e.target.style.borderColor = 'var(--higo-blue)'}
          onBlur={(e) => e.target.style.borderColor = 'var(--higo-gray-200)'}
        />
      </div>

      {/* Add Button */}
      <motion.button
        onClick={handleAdd}
        whileTap={{ scale: 0.97 }}
        style={{
          width: '100%', padding: '14px',
          background: 'var(--higo-blue)', color: 'white',
          borderRadius: 'var(--radius-md)',
          fontWeight: 600, fontSize: 'var(--font-base)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          boxShadow: 'var(--shadow-blue)',
        }}
      >
        <span>Agregar al carrito</span>
        <span>{formatCurrency(product.price * quantity)}</span>
      </motion.button>
    </div>
  );
}
