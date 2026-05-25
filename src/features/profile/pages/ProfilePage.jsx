import { useState } from 'react';
import { useAuthStore } from '../../../stores/shop/useAuthStore.js';
import { useLocationStore } from '../../../stores/shop/useLocationStore.js';
import {
  MapPin, Phone, Shield, Home, Briefcase, Heart,
  ArrowRight, Plus, Trash2,
} from 'lucide-react';
import { AddressPickerSheet } from '../../../components/shop/address/AddressPickerSheet.jsx';
import './ProfilePage.css';

const ALIAS_PRESETS = [
  { key: 'home', label: 'Casa', icon: Home },
  { key: 'work', label: 'Trabajo', icon: Briefcase },
  { key: 'fav', label: 'Favorito', icon: Heart },
  { key: 'pin', label: 'Otro', icon: MapPin },
];

function aliasIcon(key) {
  return (ALIAS_PRESETS.find((p) => p.key === key) || ALIAS_PRESETS[3]).icon;
}

export function ProfilePage() {
  const { role, userName, userPhone, setRole } = useAuthStore();
  const {
    deliveryAddress,
    savedLocations,
    addSavedLocation,
    removeSavedLocation,
    useSavedLocation,
  } = useLocationStore();

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pendingPlace, setPendingPlace] = useState(null);
  const [aliasDraft, setAliasDraft] = useState('home');

  const handleRoleCycle = () => {
    if (role === 'customer') setRole('merchant');
    else if (role === 'merchant') setRole('driver');
    else setRole('customer');
  };

  const handleLogout = () => {
    alert('Sesión cerrada correctamente.');
  };

  const handlePlacePicked = (place) => {
    setPendingPlace(place);
    setPickerOpen(false);
  };

  const handleSavePending = () => {
    if (!pendingPlace) return;
    const preset = ALIAS_PRESETS.find((p) => p.key === aliasDraft) || ALIAS_PRESETS[0];
    addSavedLocation({
      alias: preset.label,
      address: pendingPlace.address,
      lat: pendingPlace.lat,
      lng: pendingPlace.lng,
      iconKey: aliasDraft,
    });
    setPendingPlace(null);
    setAliasDraft('home');
  };

  return (
    <div className="profile-page animate-fade-in">
      {/* Profile Header Block */}
      <div className="profile-header-uber">
        <div className="profile-avatar-circle">
          {userName ? userName.charAt(0) : 'U'}
        </div>
        <div className="profile-info-col">
          <h2>{userName || 'Usuario Higo'}</h2>
          <span className="profile-edit-link" onClick={() => alert('Edición de cuenta en desarrollo')}>
            EDITA LA CUENTA
          </span>
        </div>
      </div>

      {/* Saved Locations */}
      <div className="profile-saved-locations">
        <div className="profile-saved-locations__header">
          <h3 className="profile-section-title">Lugares guardados</h3>
          <button
            className="profile-add-location-btn"
            onClick={() => setPickerOpen(true)}
            type="button"
          >
            <Plus size={14} /> Añadir
          </button>
        </div>

        {savedLocations.length === 0 ? (
          <div className="saved-locations-empty">
            <MapPin size={28} strokeWidth={1.4} />
            <p>Aún no tienes lugares guardados.</p>
            <p className="saved-locations-empty__hint">Guarda tu Casa o Trabajo para pedir más rápido.</p>
          </div>
        ) : (
          <div className="saved-locations-list">
            {savedLocations.map((loc) => {
              const Icon = aliasIcon(loc.iconKey);
              return (
                <div key={loc.id} className="saved-location-item">
                  <div className="location-icon-bg" onClick={() => useSavedLocation(loc.id)}>
                    <Icon size={18} />
                  </div>
                  <div className="location-details" onClick={() => useSavedLocation(loc.id)}>
                    <span className="location-alias">{loc.alias}</span>
                    <span className="location-address truncate">{loc.address}</span>
                  </div>
                  <button
                    className="saved-location-remove"
                    onClick={() => removeSavedLocation(loc.id)}
                    aria-label="Eliminar lugar"
                    type="button"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Meta Info Panel */}
      <div className="profile-meta-info">
        <h3 className="profile-section-title" style={{ fontSize: '0.85rem', marginBottom: '8px' }}>
          Configuración de la app
        </h3>
        <div className="profile-meta-row">
          <span className="label">
            <Phone size={14} style={{ marginRight: 6, verticalAlign: -2 }} /> Teléfono
          </span>
          <span className="value">{userPhone}</span>
        </div>
        <div className="profile-meta-row">
          <span className="label">
            <MapPin size={14} style={{ marginRight: 6, verticalAlign: -2 }} /> Dirección
          </span>
          <span className="value truncate" style={{ maxWidth: '160px' }}>{deliveryAddress}</span>
        </div>
        <div className="profile-meta-row">
          <span className="label">
            <Shield size={14} style={{ marginRight: 6, verticalAlign: -2 }} /> Rol activo
          </span>
          <span className="value" style={{ textTransform: 'capitalize' }}>
            {role === 'customer' ? 'Cliente' : role === 'merchant' ? 'Comercio' : 'Repartidor'}
          </span>
        </div>
      </div>

      {/* Footer Critical Actions */}
      <div className="profile-footer-actions">
        <button className="btn-profile-switch-account" onClick={handleRoleCycle}>
          Cambiar de cuenta (Simular {role === 'customer' ? 'Comercio' : role === 'merchant' ? 'Repartidor' : 'Cliente'})
        </button>
        <button className="btn-profile-logout" onClick={handleLogout}>
          Cerrar sesión
        </button>
      </div>

      <AddressPickerSheet
        isOpen={pickerOpen}
        title="Añadir lugar guardado"
        currentAddress=""
        onClose={() => setPickerOpen(false)}
        onSelect={handlePlacePicked}
      />

      {pendingPlace && (
        <div className="saved-alias-modal-backdrop" onClick={() => setPendingPlace(null)}>
          <div className="saved-alias-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Etiqueta este lugar</h3>
            <p className="saved-alias-modal__address truncate">{pendingPlace.address}</p>
            <div className="saved-alias-options">
              {ALIAS_PRESETS.map((p) => (
                <button
                  key={p.key}
                  className={`saved-alias-option ${aliasDraft === p.key ? 'is-active' : ''}`}
                  onClick={() => setAliasDraft(p.key)}
                  type="button"
                >
                  <p.icon size={16} />
                  {p.label}
                </button>
              ))}
            </div>
            <div className="saved-alias-modal__actions">
              <button className="saved-alias-cancel" onClick={() => setPendingPlace(null)} type="button">
                Cancelar
              </button>
              <button className="saved-alias-save" onClick={handleSavePending} type="button">
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
