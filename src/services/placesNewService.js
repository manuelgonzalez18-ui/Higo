// placesNewService.js — Anexo C / M4.
//
// Helper para cargar y consumir Google Places API (New) — la versión
// que reemplaza al legacy AutocompleteService. Cobra por sesión completa
// (autocomplete + details = 1 sesión) → mucho más barato que pagar por
// cada keystroke.
//
// API pública:
//   loadPlacesLibrary()  → Promise<typeof google.maps.places>
//                          Hace lazy-load del script JS de Google Maps
//                          si no está cargado, y devuelve la lib places.
//
//   createSessionToken() → google.maps.places.AutocompleteSessionToken
//                          Reusar para todas las queries de UNA búsqueda
//                          y descartar al confirmar (1 ride = 1 token).
//
//   placeFromPrediction(pred, sessionToken) → { lat, lng, title, address, place_id }
//                          Toma una predicción del AutocompleteService
//                          y resuelve location via Place.fetchFields.
//
// Notas:
//   - Si VITE_GOOGLE_MAPS_API_KEY no está, lanza error y el caller debe
//     caer al fallback de mock locations.
//   - Cargamos con `v=beta` porque PlaceAutocompleteElement aún
//     requiere ese channel (cambiará a stable durante 2026).

// FALLBACK hardcoded (igual que InteractiveMapGoogle): la clave tiene
// restriccion 'Sitios web' a higoapp.com/* y www.higoapp.com/*.
const FALLBACK_MAPS_KEY = 'AIzaSyBJ93K-DUeEQ-JVqPoIO1cw_ZUzOJORmJI';

const API_KEY = (typeof import.meta !== 'undefined'
    && import.meta.env?.VITE_GOOGLE_MAPS_API_KEY) || FALLBACK_MAPS_KEY;

let loadPromise = null;

const loadGoogleMapsScript = () => {
    if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
    if (window.google?.maps?.importLibrary) {
        return Promise.resolve(window.google.maps);
    }
    if (loadPromise) return loadPromise;

    loadPromise = new Promise((resolve, reject) => {
        if (!API_KEY) {
            reject(new Error('VITE_GOOGLE_MAPS_API_KEY not configured'));
            return;
        }
        // Bootstrap pattern oficial de Google Maps JS API.
        // Ref: https://developers.google.com/maps/documentation/javascript/load-maps-js-api#dynamic-library-import
        // eslint-disable-next-line no-multi-str
        (g => {
            // eslint-disable-next-line no-var
            var h, a, k, p = "The Google Maps JavaScript API",
                c = "google", l = "importLibrary",
                q = "__ib__",
                m = document, b = window;
            b = b[c] || (b[c] = {});
            const d = b.maps || (b.maps = {});
            const r = new Set();
            const e = new URLSearchParams();
            const u = () => h || (h = new Promise(async (f, n) => {
                await (a = m.createElement("script"));
                e.set("libraries", [...r] + "");
                for (k in g) e.set(k.replace(/[A-Z]/g, t => "_" + t[0].toLowerCase()), g[k]);
                e.set("callback", c + ".maps." + q);
                a.src = `https://maps.${c}apis.com/maps/api/js?` + e;
                d[q] = f;
                a.onerror = () => h = n(Error(p + " could not load."));
                a.nonce = m.querySelector("script[nonce]")?.nonce || "";
                m.head.append(a);
            }));
            d[l] ? console.warn(p + " only loads once. Ignoring:", g) : d[l] = (f, ...n) => r.add(f) && u().then(() => d[l](f, ...n));
        })({
            key: API_KEY,
            v: 'beta',
            language: 'es',
            region: 'VE',
        });

        // Esperar hasta que google.maps.importLibrary esté disponible.
        const startedAt = Date.now();
        const poll = () => {
            if (window.google?.maps?.importLibrary) {
                resolve(window.google.maps);
            } else if (Date.now() - startedAt > 15000) {
                reject(new Error('Google Maps load timeout'));
            } else {
                setTimeout(poll, 50);
            }
        };
        poll();
    });

    return loadPromise;
};

let placesLibPromise = null;

/**
 * Carga la librería 'places' (incluye AutocompleteService, Place,
 * PlaceAutocompleteElement). Cachea el promise.
 */
export const loadPlacesLibrary = () => {
    if (placesLibPromise) return placesLibPromise;
    placesLibPromise = loadGoogleMapsScript()
        .then((maps) => maps.importLibrary('places'));
    return placesLibPromise;
};

/**
 * Crea un session token nuevo. Reusar para una secuencia completa de
 * autocomplete queries + el fetchFields final. Descartar después.
 */
export const createSessionToken = async () => {
    const places = await loadPlacesLibrary();
    return new places.AutocompleteSessionToken();
};

/**
 * Obtener predicciones de autocomplete. Usa AutocompleteSuggestion (la
 * nueva API que reemplaza AutocompleteService).
 *
 * @param {string} input  texto del usuario
 * @param {google.maps.places.AutocompleteSessionToken} sessionToken
 * @returns {Promise<Array<{prediction, displayText}>>}
 */
export const fetchSuggestions = async (input, sessionToken) => {
    if (!input || input.length < 2) return [];
    const places = await loadPlacesLibrary();

    const request = {
        input,
        sessionToken,
        // Bias a Venezuela + Higuerote.
        includedRegionCodes: ['ve'],
        locationBias: {
            center: { lat: 10.4806, lng: -66.1003 },
            radius: 50000, // 50 km
        },
        language: 'es-VE',
    };
    const { suggestions } = await places.AutocompleteSuggestion
        .fetchAutocompleteSuggestions(request);

    return (suggestions || [])
        .filter(s => s.placePrediction)
        .map(s => ({
            prediction: s.placePrediction,
            displayText: s.placePrediction.text?.toString() || '',
            mainText: s.placePrediction.mainText?.toString() || '',
            secondaryText: s.placePrediction.secondaryText?.toString() || '',
            placeId: s.placePrediction.placeId,
        }));
};

/**
 * Convertir una prediction en un objeto con lat/lng. Cierra la sesión
 * (este es el "billable detail" en la nueva pricing).
 *
 * @returns {Promise<{title, address, lat, lng, place_id}>}
 */
export const resolvePrediction = async (prediction) => {
    const place = prediction.toPlace();
    await place.fetchFields({
        fields: ['location', 'displayName', 'formattedAddress', 'id'],
    });
    return {
        title: place.displayName || prediction.text?.toString() || '',
        address: place.formattedAddress || '',
        lat: place.location?.lat() ?? null,
        lng: place.location?.lng() ?? null,
        place_id: place.id,
    };
};
