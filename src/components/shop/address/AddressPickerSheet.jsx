import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, LocateFixed, Home, Briefcase, Heart, MapPin } from 'lucide-react';
import { useMapsLibrary } from '@vis.gl/react-google-maps';
import { AddressAutocomplete } from '../maps/AddressAutocomplete.jsx';
import { getCurrentPosition } from '../../../services/shopGeolocation.js';
import { useLocationStore } from '../../../stores/shop/useLocationStore.js';
import './AddressPickerSheet.css';

const SAVED_ICONS = { home: Home, work: Briefcase, fav: Heart, pin: MapPin };

// Reusable bottom-sheet for picking a delivery address. Wraps the Places
// autocomplete + a one-tap "use my current location" reverse-geocode flow.
// onSelect receives { address, lat, lng } when the user commits a choice.
export function AddressPickerSheet({
  isOpen,
  title = 'Cambiar dirección',
  currentAddress,
  onClose,
  onSelect,
  showSavedLocations = false,
}) {
  const [draft, setDraft] = useState(currentAddress || '');
  const [isLocating, setIsLocating] = useState(false);
  const geocodingLib = useMapsLibrary('geocoding');
  const savedLocations = useLocationStore((s) => s.savedLocations);

  useEffect(() => {
    if (isOpen) setDraft(currentAddress || '');
  }, [isOpen, currentAddress]);

  const handleUseMyLocation = async () => {
    setIsLocating(true);
    try {
      const pos = await getCurrentPosition();
      if (!geocodingLib) {
        onSelect({ address: 'Mi ubicación actual', lat: pos.lat, lng: pos.lng });
        setIsLocating(false);
        return;
      }
      const geocoder = new geocodingLib.Geocoder();
      geocoder.geocode({ location: pos }, (results, status) => {
        const address = status === 'OK' && results[0]
          ? results[0].formatted_address
          : 'Mi ubicación actual';
        onSelect({ address, lat: pos.lat, lng: pos.lng });
        setIsLocating(false);
      });
    } catch {
      setIsLocating(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            className="address-picker-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            className="address-picker-sheet"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 260 }}
          >
            <div className="address-picker-header">
              <h3>{title}</h3>
              <button className="address-picker-close" onClick={onClose} type="button">
                <X size={18} />
              </button>
            </div>
            <div className="address-picker-body">
              <AddressAutocomplete
                value={draft}
                onChange={setDraft}
                onPlaceSelect={onSelect}
                placeholder="Buscar dirección con Google Maps..."
                className="address-picker-input"
                autoFocus
              />
              <button
                className="address-picker-locate"
                onClick={handleUseMyLocation}
                disabled={isLocating}
                type="button"
              >
                <LocateFixed size={16} className={isLocating ? 'spinning-icon' : ''} />
                {isLocating ? 'Obteniendo ubicación...' : 'Usar mi ubicación actual'}
              </button>

              {showSavedLocations && savedLocations.length > 0 && (
                <div className="address-picker-saved">
                  <div className="address-picker-saved__label">Tus lugares</div>
                  <div className="address-picker-saved__list">
                    {savedLocations.map((loc) => {
                      const Icon = SAVED_ICONS[loc.iconKey] || MapPin;
                      return (
                        <button
                          key={loc.id}
                          className="address-picker-saved__item"
                          onClick={() => onSelect({ address: loc.address, lat: loc.lat, lng: loc.lng })}
                          type="button"
                        >
                          <Icon size={16} />
                          <span className="address-picker-saved__alias">{loc.alias}</span>
                          <span className="address-picker-saved__addr truncate">{loc.address}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
