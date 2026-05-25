import { useEffect, useRef } from 'react';
import { useMapsLibrary } from '@vis.gl/react-google-maps';

// Wraps Google Places Autocomplete on a plain <input>. Calls onPlaceSelect
// with { address, lat, lng, placeId } when the user picks a suggestion.
// componentRestrictions defaults to Venezuela ('ve') since that's where the
// app currently operates.
export function AddressAutocomplete({
  value,
  onChange,
  onPlaceSelect,
  placeholder = 'Buscar dirección...',
  className,
  country = 've',
  autoFocus = false,
}) {
  const placesLib = useMapsLibrary('places');
  const inputRef = useRef(null);
  const autocompleteRef = useRef(null);

  useEffect(() => {
    if (!placesLib || !inputRef.current) return;

    const autocomplete = new placesLib.Autocomplete(inputRef.current, {
      types: ['geocode'],
      componentRestrictions: country ? { country } : undefined,
      fields: ['formatted_address', 'geometry', 'place_id', 'name'],
    });

    autocompleteRef.current = autocomplete;

    const listener = autocomplete.addListener('place_changed', () => {
      const place = autocomplete.getPlace();
      if (!place.geometry?.location) return;
      const result = {
        address: place.formatted_address || place.name || '',
        lat: place.geometry.location.lat(),
        lng: place.geometry.location.lng(),
        placeId: place.place_id,
      };
      onChange?.(result.address);
      onPlaceSelect?.(result);
    });

    return () => {
      listener.remove();
    };
  }, [placesLib, country]);

  return (
    <input
      ref={inputRef}
      type="text"
      className={className}
      placeholder={placeholder}
      value={value || ''}
      onChange={(e) => onChange?.(e.target.value)}
      autoFocus={autoFocus}
    />
  );
}
