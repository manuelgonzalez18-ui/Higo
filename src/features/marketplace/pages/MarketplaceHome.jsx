import { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Search,
  MapPin,
  Star,
  Clock,
  Navigation,
  SearchX,
  Bell,
  ChevronDown,
} from 'lucide-react';
import { fetchStores } from '../../../services/shopStoreService.js';
import { useLocationStore } from '../../../stores/shop/useLocationStore.js';
import { useOrderStore } from '../../../stores/shop/useOrderStore.js';
import { calculateDistance, formatDistance } from '../../../services/shopGeolocation.js';
import { AddressPickerSheet } from '../../../components/shop/address/AddressPickerSheet.jsx';
import { NotificationsPopover } from '../components/NotificationsPopover.jsx';
import './MarketplaceHome.css';

const ACTIVE_ORDER_STATUSES = [
  'PENDING_PAYMENT', 'PAYMENT_VERIFIED', 'PREPARING',
  'READY_TO_DISPATCH', 'DRIVER_ASSIGNED', 'PICKED_UP',
];

const CATEGORIES = [
  { id: 'all', label: 'Todos', emoji: '🏪' },
  { id: 'restaurant', label: 'Restaurante', emoji: '🍽️' },
  { id: 'pharmacy', label: 'Farmacia', emoji: '💊' },
  { id: 'bakery', label: 'Panadería', emoji: '🥐' },
  { id: 'grocery', label: 'Bodega', emoji: '🛒' },
  { id: 'cafe', label: 'Café', emoji: '☕' },
];

const staggerChildren = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.05 }
  }
};

const fadeInUp = {
  hidden: { opacity: 0, y: 15 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: 'easeOut' } }
};

export function MarketplaceHome() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');
  const [stores, setStores] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAddressPickerOpen, setIsAddressPickerOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const { userLocation, deliveryAddress, setUserLocation, setDeliveryAddress } = useLocationStore();
  const orders = useOrderStore((s) => s.orders);
  const activeOrders = useMemo(
    () => orders.filter((o) => ACTIVE_ORDER_STATUSES.includes(o.status)),
    [orders],
  );

  // Load stores from Supabase (falls back to mockStores automatically)
  useEffect(() => {
    let isMounted = true;
    fetchStores().then(data => {
      if (isMounted) {
        setStores(data);
        setIsLoading(false);
      }
    });
    return () => { isMounted = false; };
  }, []);

  const filteredStores = useMemo(() => {
    let list = [...stores];

    if (activeCategory !== 'all') {
      list = list.filter(s => s.category === activeCategory);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(s =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q)
      );
    }

    // Sort: open first, then by distance
    list.sort((a, b) => {
      if (a.isOpen !== b.isOpen) return a.isOpen ? -1 : 1;
      if (userLocation) {
        const distA = calculateDistance(userLocation.lat, userLocation.lng, a.latitude, a.longitude);
        const distB = calculateDistance(userLocation.lat, userLocation.lng, b.latitude, b.longitude);
        return distA - distB;
      }
      return 0;
    });

    return list;
  }, [stores, searchQuery, activeCategory, userLocation]);

  return (
    <div className="marketplace-home">
      {/* Uber Eats Header */}
      <div className="marketplace-header-uber">
        <div className="hero-top">
          <button type="button" className="hero-location hero-location--button" onClick={() => setIsAddressPickerOpen(true)}>
            <span className="hero-deliver-to">Entregar ahora</span>
            <div className="hero-address-row">
              <MapPin size={16} className="pin-icon" />
              <span className="hero-location-text truncate">
                {deliveryAddress || (userLocation ? 'Higuerote, Miranda' : 'Obteniendo ubicación...')}
              </span>
              <ChevronDown size={14} className="chevron-icon" />
            </div>
          </button>
          <div className="hero-actions">
            <button
              className="hero-notification-btn"
              onClick={() => setIsNotificationsOpen((v) => !v)}
              type="button"
              aria-label="Notificaciones"
            >
              <Bell size={20} />
              {activeOrders.length > 0 && (
                <span className="hero-notification-badge">{activeOrders.length}</span>
              )}
            </button>
            <NotificationsPopover
              isOpen={isNotificationsOpen}
              orders={activeOrders}
              onClose={() => setIsNotificationsOpen(false)}
            />
          </div>
        </div>

        {/* Search Input Bar */}
        <div className="marketplace-search-uber">
          <div className="search-input-wrapper-uber">
            <Search size={18} className="search-icon" />
            <input
              type="text"
              placeholder="¿Qué te provoca comer hoy?"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              id="marketplace-search"
            />
          </div>
        </div>
      </div>

      {/* Quick Pills */}
      <div className="quick-pills-bar">
        {['Todos', 'Viajes', 'Súper', 'Express'].map((pill, idx) => (
          <button 
            key={pill} 
            className={`quick-pill ${idx === 0 ? 'active' : ''}`}
            onClick={() => {
              if (pill === 'Viajes') {
                navigate('/');
              }
            }}
          >
            {pill === 'Todos' ? '🛒' : pill === 'Viajes' ? '🚗' : pill === 'Súper' ? '📦' : '⚡'} {pill}
          </button>
        ))}
      </div>

      {/* Category Grid (Uber Eats Style Grid) */}
      <div className="marketplace-category-section">
        <div className="marketplace-grid-categories">
          {CATEGORIES.map(cat => (
            <button
              key={cat.id}
              className={`grid-category-card ${activeCategory === cat.id ? 'active' : ''}`}
              onClick={() => setActiveCategory(cat.id)}
              id={`category-${cat.id}`}
            >
              <div className="grid-category-circle">
                <span className="grid-category-emoji">{cat.emoji}</span>
              </div>
              <span className="grid-category-label">{cat.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Promotions Section */}
      <div className="promotions-carousel-section">
        <h3 className="section-title">Promociones para ti</h3>
        <div className="promotions-scroll">
          {stores.slice(0, 4).map((store, idx) => {
            const promoBadges = ["Promoción 2x1", "Envío Gratis", "15% OFF", "Ahorra 10 Bs."];
            const promoBadge = promoBadges[idx % promoBadges.length];
            return (
              <Link to={`/shop/store/${store.id}`} key={store.id} className="promo-card">
                <div className={`promo-card-bg promo-card-bg--${store.category}`}>
                  <span className="promo-emoji">
                    {store.category === 'restaurant' ? '🍔' : store.category === 'pharmacy' ? '💊' : store.category === 'bakery' ? '🥐' : '🛒'}
                  </span>
                  <span className="promo-badge-tag">{promoBadge}</span>
                </div>
                <div className="promo-card-info">
                  <span className="promo-store-name truncate">{store.name}</span>
                  <span className="promo-store-meta">★ {store.rating.toFixed(1)} • {store.deliveryTime}</span>
                </div>
              </Link>
            );
          })}
        </div>
      </div>

      {/* Store List Header */}
      <div className="section-header-uber">
        <h2>
          {activeCategory === 'all'
            ? 'Todos los comercios'
            : `Comercios de ${CATEGORIES.find(c => c.id === activeCategory)?.label}`
          }
        </h2>
        <span className="stores-count-badge">
          {filteredStores.length} cerca de ti
        </span>
      </div>

      {/* Store Feed */}
      {isLoading ? (
        <div className="stores-feed" aria-label="Cargando comercios">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="store-card-skeleton" />
          ))}
        </div>
      ) : filteredStores.length > 0 ? (
        <motion.div
          className="stores-feed"
          variants={staggerChildren}
          initial="hidden"
          animate="visible"
          key={activeCategory}
        >
          {filteredStores.map((store) => (
            <StoreCard
              key={store.id}
              store={store}
              userLocation={userLocation}
            />
          ))}
        </motion.div>
      ) : (
        <div className="empty-state">
          <SearchX size={48} />
          <h3>No se encontraron resultados</h3>
          <p>Prueba buscando otra categoría o nombre de comercio</p>
        </div>
      )}

      <AddressPickerSheet
        isOpen={isAddressPickerOpen}
        currentAddress={deliveryAddress}
        showSavedLocations
        onClose={() => setIsAddressPickerOpen(false)}
        onSelect={(place) => {
          setUserLocation({ lat: place.lat, lng: place.lng });
          setDeliveryAddress(place.address);
          setIsAddressPickerOpen(false);
        }}
      />
    </div>
  );
}


function StoreCard({ store, userLocation }) {
  const distance = userLocation
    ? calculateDistance(userLocation.lat, userLocation.lng, store.latitude, store.longitude)
    : null;

  const categoryEmojis = {
    restaurant: '🍽️',
    pharmacy: '💊',
    bakery: '🥐',
    grocery: '🛒',
    cafe: '☕',
  };

  const categoryLabel = {
    restaurant: 'Restaurante',
    pharmacy: 'Farmacia',
    bakery: 'Panadería',
    grocery: 'Bodega',
    cafe: 'Cafetería',
  };

  return (
    <motion.div variants={fadeInUp}>
      <Link to={`/shop/store/${store.id}`} className="store-feed-card" id={`store-${store.id}`}>
        <div className="store-feed-image-wrapper">
          <div className={`store-feed-image-placeholder store-feed-image-placeholder--${store.category}`}>
            {categoryEmojis[store.category] || '🏪'}
          </div>
          {!store.isOpen && (
            <div className="store-feed-closed-overlay">Cerrado ahora</div>
          )}
          {store.rating >= 4.7 && (
            <div className="store-feed-popular-badge">⭐ Destacado</div>
          )}
        </div>

        <div className="store-feed-info">
          <div className="store-feed-title-row">
            <span className="store-feed-name">{store.name}</span>
            <div className="store-feed-rating">
              <span>{store.rating.toFixed(1)}</span>
              <Star size={13} fill="currentColor" className="star-icon" />
            </div>
          </div>

          <div className="store-feed-meta-row">
            <span className="store-feed-category">{categoryLabel[store.category] || 'Comercio'}</span>
            <span className="store-feed-bullet">•</span>
            <span className="store-feed-time">{store.deliveryTime}</span>
            {distance !== null && (
              <>
                <span className="store-feed-bullet">•</span>
                <span className="store-feed-distance">{formatDistance(distance)}</span>
              </>
            )}
          </div>
        </div>
      </Link>
    </motion.div>
  );
}
