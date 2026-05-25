import { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Search, Navigation, ArrowLeft, Truck, Clock } from 'lucide-react';
import { InfoWindow } from '@vis.gl/react-google-maps';
import { fetchStores } from '../../../services/shopStoreService.js';
import { useLocationStore } from '../../../stores/shop/useLocationStore.js';
import { useOrderStore } from '../../../stores/shop/useOrderStore.js';
import { useLiveDriverTracking } from '../../../hooks/shop/useLiveDriverTracking.js';
import { calculateDistance, formatDistance, estimateDeliveryTime, formatDurationMin } from '../../../services/shopGeolocation.js';
import { calculateDeliveryFee, formatCurrency } from '../../../services/shopDeliveryPricing.js';
import { Spinner } from '../../../components/shop/ui/Spinner.jsx';
import { MapView } from '../../../components/shop/maps/MapView.jsx';
import { EmojiMarker } from '../../../components/shop/maps/EmojiMarker.jsx';
import { RoutePolyline } from '../../../components/shop/maps/RoutePolyline.jsx';
import { useDirections } from '../../../hooks/shop/useDirections.js';
import { formatOrderStatus } from '../../../services/shopOrderStatus.js';
import './SearchMap.css';

const HIGUEROTE_CENTER = { lat: 10.4817, lng: -66.0997 };

const ORDER_STATUS_COPY = {
  DRIVER_ASSIGNED: { label: 'El driver va a la tienda', tone: 'pickup' },
  PICKED_UP: { label: 'Tu pedido va en camino', tone: 'delivery' },
};

export function SearchMap() {
  const navigate = useNavigate();
  const [stores, setStores] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const { userLocation, requestLocation, isLocating } = useLocationStore();
  const [selectedStore, setSelectedStore] = useState(null);
  const [isSheetExpanded, setIsSheetExpanded] = useState(false);

  const orders = useOrderStore((s) => s.orders);
  const activeOrder = useMemo(
    () => orders.find((o) => ['DRIVER_ASSIGNED', 'PICKED_UP'].includes(o.status)),
    [orders],
  );

  const trackingStoreLatLng = activeOrder?.storeLocation || null;
  const trackingUserLatLng = activeOrder?.userLocation || userLocation || null;
  const currentLeg = activeOrder?.status === 'DRIVER_ASSIGNED' ? 'to_store' : activeOrder?.status === 'PICKED_UP' ? 'to_client' : 'none';
  const legOrigin = driverPos || trackingStoreLatLng;
  const legDest = currentLeg === 'to_store' ? trackingStoreLatLng : trackingUserLatLng;
  const { path: trackingPath, duration: trackingDurationSec } = useDirections(legOrigin, legDest);
  const { driverPos, driverBearing, signalAgeSec } = useLiveDriverTracking(activeOrder?.id, trackingStoreLatLng);

  useEffect(() => {
    fetchStores().then((data) => {
      setStores(data);
      setIsLoading(false);
    });
  }, []);

  const filteredStores = useMemo(() => {
    let list = [...stores];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.category.toLowerCase().includes(q)
      );
    }

    if (userLocation) {
      list.sort((a, b) => {
        const distA = calculateDistance(userLocation.lat, userLocation.lng, a.latitude, a.longitude);
        const distB = calculateDistance(userLocation.lat, userLocation.lng, b.latitude, b.longitude);
        return distA - distB;
      });
    }
    return list;
  }, [stores, searchQuery, userLocation]);

  const mapCenter = useMemo(() => {
    if (activeOrder && trackingUserLatLng && trackingStoreLatLng) {
      return {
        lat: (trackingUserLatLng.lat + trackingStoreLatLng.lat) / 2,
        lng: (trackingUserLatLng.lng + trackingStoreLatLng.lng) / 2,
      };
    }
    if (userLocation) return { lat: userLocation.lat, lng: userLocation.lng };
    return HIGUEROTE_CENTER;
  }, [activeOrder, trackingUserLatLng, trackingStoreLatLng, userLocation]);

  const centerOnUser = () => {
    requestLocation();
  };

  const activeOrderStatusUi = activeOrder ? ORDER_STATUS_COPY[activeOrder.status] || { label: formatOrderStatus(activeOrder.status), tone: 'neutral' } : null;

  const categoryLabels = {
    restaurant: 'Restaurante',
    pharmacy: 'Farmacia',
    bakery: 'Panadería',
    grocery: 'Bodega',
    cafe: 'Café',
  };

  return (
    <div className="search-map-page">
      <div className="search-map-header">
        <Link to="/shop" className="back-btn-round">
          <ArrowLeft size={20} />
        </Link>
        <div className="search-map-input-wrapper">
          <Search size={18} className="search-icon" />
          <input
            type="text"
            placeholder={activeOrder ? 'Rastreo en vivo del pedido activo' : 'Busca tiendas y productos...'}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            disabled={Boolean(activeOrder)}
          />
        </div>
      </div>

      <div className="search-map-container">
        <MapView center={mapCenter} zoom={14}>
          {activeOrder ? (
            <>
              {trackingUserLatLng && <EmojiMarker position={trackingUserLatLng} preset="user" zIndex={50} />}
              {trackingStoreLatLng && <EmojiMarker position={trackingStoreLatLng} preset="store" zIndex={40} />}
              {driverPos && <EmojiMarker position={driverPos} preset="driver" zIndex={60} bearing={driverBearing} bounce />}
              {trackingPath && <RoutePolyline path={trackingPath} color="#3B82F6" weight={4} opacity={0.9} />}
            </>
          ) : (
            <>
              {userLocation && (
                <EmojiMarker
                  position={{ lat: userLocation.lat, lng: userLocation.lng }}
                  preset="user"
                  zIndex={50}
                />
              )}

              {filteredStores.map((store) => (
                <EmojiMarker
                  key={store.id}
                  position={{ lat: store.latitude, lng: store.longitude }}
                  preset={store.category}
                  onClick={() => setSelectedStore(store)}
                />
              ))}

              {selectedStore && (() => {
                const distKm = userLocation
                  ? calculateDistance(userLocation.lat, userLocation.lng, selectedStore.latitude, selectedStore.longitude)
                  : null;
                const previewFee = distKm != null ? calculateDeliveryFee(distKm) : null;
                const previewEta = distKm != null ? estimateDeliveryTime(distKm) : null;
                return (
                  <InfoWindow
                    position={{ lat: selectedStore.latitude, lng: selectedStore.longitude }}
                    onCloseClick={() => setSelectedStore(null)}
                    pixelOffset={[0, -40]}
                  >
                    <div className="map-popup-content">
                      <div className="map-popup-name">{selectedStore.name}</div>
                      <div className="map-popup-meta">★ {selectedStore.rating.toFixed(1)} • {selectedStore.deliveryTime}</div>
                      {distKm != null && (
                        <div className="map-popup-delivery">
                          <span className="map-popup-chip">
                            <Navigation size={11} /> {formatDistance(distKm)}
                          </span>
                          <span className="map-popup-chip map-popup-chip--fee">
                            🛵 {formatCurrency(previewFee)}
                          </span>
                          <span className="map-popup-chip">⏱ {previewEta}</span>
                        </div>
                      )}
                      <Link to={`/shop/store/${selectedStore.id}`} className="map-popup-link">
                        Pedir ahora →
                      </Link>
                    </div>
                  </InfoWindow>
                );
              })()}
            </>
          )}
        </MapView>

        <button
          className={`locate-me-btn ${isLocating ? 'locating' : ''}`}
          onClick={centerOnUser}
          title="Centrar en mi ubicación"
        >
          <Navigation size={20} style={{ transform: 'rotate(45deg)' }} />
        </button>
      </div>

      <motion.div
        className={`search-bottom-sheet ${isSheetExpanded ? 'expanded' : ''}`}
        initial={{ y: '70%' }}
        animate={{ y: isSheetExpanded ? '8%' : '42%' }}
        transition={{ type: 'spring', damping: 25, stiffness: 220 }}
      >
        <div
          className="bottom-sheet-handle-wrapper"
          onClick={() => setIsSheetExpanded(!isSheetExpanded)}
        >
          <div className="bottom-sheet-handle"></div>
        </div>

        <div className="bottom-sheet-content">
          {activeOrder ? (
            <>
              <div className="sheet-header">
                <h3><Truck size={18} style={{ marginRight: 6 }} />Seguimiento en vivo</h3>
                <span className="sheet-stores-count">{formatOrderStatus(activeOrder.status)} · {activeOrder.id.slice(0, 8)}...</span>
              </div>
              <div className="sheet-store-card highlighted" style={{ cursor: 'default' }}>
                <div className="sheet-store-details">
                  <div className="sheet-store-name">{activeOrder.storeName || 'Comercio'}</div>
                  <div className="sheet-store-rating-row">
                    <span className={`sheet-order-status sheet-order-status--${activeOrderStatusUi?.tone || 'neutral'}`}>{activeOrderStatusUi?.label}</span>
                    {trackingDurationSec != null && (
                      <>
                        <span className="sheet-store-bullet">•</span>
                        <span className="sheet-store-time">ETA {formatDurationMin(trackingDurationSec)}</span>
                      </>
                    )}
                  </div>
                  <div className="sheet-store-subdetails">
                    <span className="sheet-store-distance">
                      <Clock size={12} /> {signalAgeSec == null ? 'Esperando señal del driver...' : signalAgeSec <= 10 ? 'Ubicación en vivo' : `Última señal hace ${signalAgeSec}s`}
                      {activeOrder?.driverName ? ` · ${activeOrder.driverName}` : ''}
                    </span>
                  </div>
                </div>
                <button className="sheet-store-cta" onClick={() => navigate(`/shop/orders/${activeOrder.id}`)}>Ver pedido</button>
              </div>
            </>
          ) : (
            <>
              <div className="sheet-header">
                <h3>Entregas cerca de ti</h3>
                <span className="sheet-stores-count">{filteredStores.length} tiendas</span>
              </div>

              {isLoading ? (
                <div className="sheet-spinner-state">
                  <Spinner size="md" />
                  <p>Buscando tiendas...</p>
                </div>
              ) : filteredStores.length > 0 ? (
                <div className="sheet-stores-list">
                  {filteredStores.map((store) => {
                    const distance = userLocation
                      ? calculateDistance(userLocation.lat, userLocation.lng, store.latitude, store.longitude)
                      : null;
                    const isSelected = selectedStore?.id === store.id;

                    return (
                      <div
                        key={store.id}
                        className={`sheet-store-card ${isSelected ? 'highlighted' : ''}`}
                        onClick={() => setSelectedStore(store)}
                      >
                        <div className={`sheet-store-avatar sheet-store-avatar--${store.category}`}>
                          {store.category === 'restaurant' ? '🍽️' : store.category === 'pharmacy' ? '💊' : store.category === 'bakery' ? '🥐' : store.category === 'grocery' ? '🛒' : '☕'}
                        </div>

                        <div className="sheet-store-details">
                          <div className="sheet-store-name">{store.name}</div>
                          <div className="sheet-store-rating-row">
                            <span className="sheet-store-rating">★ {store.rating.toFixed(1)}</span>
                            <span className="sheet-store-bullet">•</span>
                            <span className="sheet-store-category">{categoryLabels[store.category] || 'Comercio'}</span>
                            <span className="sheet-store-bullet">•</span>
                            <span className="sheet-store-time">{store.deliveryTime}</span>
                          </div>
                          <div className="sheet-store-subdetails">
                            {distance !== null && (
                              <span className="sheet-store-distance">
                                <Navigation size={12} /> {formatDistance(distance)} de ti
                              </span>
                            )}
                            <span className="sheet-store-address truncate">{store.address}</span>
                          </div>
                        </div>

                        <Link to={`/shop/store/${store.id}`} className="sheet-store-cta" id={`store-search-${store.id}`}>
                          Ver
                        </Link>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="sheet-empty-state">
                  <p>No hay tiendas que coincidan con tu búsqueda.</p>
                </div>
              )}
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}
