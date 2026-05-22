// InteractiveMapMapbox.jsx — Anexo C / M2.
//
// Implementación con mapbox-gl vanilla del contrato exacto que tiene
// InteractiveMapGoogle. Las 5 páginas consumidoras (RequestRidePage,
// ConfirmTripPage, RideStatusPage, DriverDashboard, AdminDashboardPage)
// NO se tocan al migrar.
//
// Props (firma idéntica al Google):
//   - className
//   - center, origin, destination, assignedDriver (lat/lng)
//   - markersProp / markers (array de drivers online, alt names por compat)
//   - heading (rotación pin chofer propio)
//   - routeColor (color de la ruta dibujada)
//   - onRouteData (callback con { distance, duration, polyline, degraded? })
//   - isDriver (si true: muestra pin del chofer propio en center)
//   - vehicleType ('moto'|'standard'|'van') — tipo del vehículo del chofer
//   - activeRideId, navStep — informativo, no afecta render
//   - showPin (default true) — muestra/oculta el pin del propio user
//
// Lógica reusada (NO migrada):
//   - geoUtils.calculateBearing → rotación del pin chofer
//   - geoUtils.getDistanceFromLatLonInKm → fallback Haversine en
//     directionsService
//   - Suscripciones Supabase realtime (driver_loc:*, public:drivers_map_v2)
//   - PNGs de pin en /public/markers/
//
// Estilo: mapbox://styles/mapbox/dark-v11 + force español en labels.

import React, { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { supabase } from '../services/supabase';
import { calculateBearing } from '../utils/geoUtils';
import { getRoute } from '../services/directionsService';
import { reportError } from '../utils/reportError';

const MAPBOX_TOKEN = (typeof import.meta !== 'undefined'
    && import.meta.env?.VITE_MAPBOX_TOKEN) || '';

if (MAPBOX_TOKEN) {
    mapboxgl.accessToken = MAPBOX_TOKEN;
}

const DEFAULT_CENTER = { lat: 10.4806, lng: -66.1003 }; // Higuerote
const DEFAULT_ZOOM = 13;
const STALE_DRIVER_MS = 90_000;
const CLEANUP_INTERVAL_MS = 30_000;

const ROUTE_SOURCE_ID = 'higo-route';
const ROUTE_LAYER_ID = 'higo-route-line';

// Localizar labels del mapa a español (sin custom style en Studio).
// Aplica a TODOS los layers cuyo id matchee *-label* — cubre country,
// state, place, road, poi, etc.
const localizeLabelsToSpanish = (map) => {
    try {
        const layers = map.getStyle()?.layers || [];
        layers.forEach((layer) => {
            if (layer.type !== 'symbol') return;
            if (!/-label/i.test(layer.id)) return;
            try {
                map.setLayoutProperty(layer.id, 'text-field', [
                    'coalesce',
                    ['get', 'name_es'],
                    ['get', 'name_en'],
                    ['get', 'name'],
                ]);
            } catch {
                // algunos layers son immutable, ignorar
            }
        });
    } catch (err) {
        reportError(err, { source: 'InteractiveMapMapbox.localizeLabelsToSpanish' });
    }
};

// DOM element para un marker. PNG existente + ring pulsante por kind.
const createMarkerElement = (kind, opts = {}) => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:relative;width:40px;height:50px;pointer-events:none;';
    wrap.dataset.kind = kind;

    if (kind === 'pickup' || kind === 'dropoff') {
        const img = document.createElement('img');
        img.src = kind === 'pickup' ? '/markers/pin_pickup.png' : '/markers/pin_dropoff.png';
        img.alt = '';
        img.style.cssText = 'width:40px;height:50px;display:block;';
        wrap.appendChild(img);

        if (kind === 'pickup') {
            const ring = document.createElement('div');
            ring.style.cssText = `
                position:absolute;left:50%;bottom:0;transform:translateX(-50%);
                width:48px;height:48px;border-radius:9999px;
                background:rgba(59,130,246,0.2);
                border:2px solid rgba(59,130,246,0.6);
                animation:higoPulse 2s ease-out infinite;
                z-index:-1;
            `;
            wrap.appendChild(ring);
        }
    } else if (kind === 'driver' || kind === 'fleet') {
        // Pin de chofer: círculo con icono de vehículo.
        const isLarge = opts.isLarge;
        const size = isLarge ? 38 : 28;
        const dot = document.createElement('div');
        dot.style.cssText = `
            width:${size}px;height:${size}px;border-radius:9999px;
            background:#3B82F6;border:3px solid #fff;
            box-shadow:0 4px 12px rgba(0,0,0,0.4);
            display:flex;align-items:center;justify-content:center;
            color:#fff;font-size:${Math.round(size * 0.55)}px;
            transform-origin:center;
            transition:transform 0.3s ease-out;
        `;
        // Icono según vehicleType. Material Symbols (cargado en index.css).
        const icon = document.createElement('span');
        icon.className = 'material-symbols-outlined';
        icon.style.cssText = `font-size:${Math.round(size * 0.6)}px;color:#fff;`;
        const vt = opts.vehicleType || 'standard';
        icon.textContent = vt === 'moto' ? 'two_wheeler'
            : vt === 'van' ? 'airport_shuttle'
            : 'local_taxi';
        dot.appendChild(icon);
        wrap.appendChild(dot);
        wrap.dataset.iconWrap = '1';
    }

    return wrap;
};

// Aplicar rotación al icono interior (no al wrapper completo — el wrapper
// está anclado a lng/lat y mapbox rota su transform internamente).
const setMarkerHeading = (markerEl, heading) => {
    if (!markerEl || markerEl.dataset.iconWrap !== '1') return;
    const dot = markerEl.firstChild;
    if (!dot) return;
    // El icono base apunta arriba (norte = 0°). bearing GPS también 0=norte.
    dot.style.transform = `rotate(${heading || 0}deg)`;
};

const InteractiveMapMapbox = ({
    className = 'w-full h-full',
    center,
    origin,
    destination,
    assignedDriver,
    markersProp,
    markers,
    heading,
    routeColor = '#3B82F6',
    onRouteData,
    isDriver = false,
    vehicleType,
    showPin = true,
    // Props informativas que NO afectan render — las aceptamos para
    // compatibilidad de firma con InteractiveMapGoogle.
    // eslint-disable-next-line no-unused-vars
    activeRideId,
    // eslint-disable-next-line no-unused-vars
    navStep,
}) => {
    const containerRef = useRef(null);
    const mapRef = useRef(null);
    const originMarkerRef = useRef(null);
    const destinationMarkerRef = useRef(null);
    const driverMarkerRef = useRef(null);
    const fleetMarkersRef = useRef({}); // driverId → marker
    const routeReqIdRef = useRef(0);
    const onRouteDataRef = useRef(onRouteData);

    // Mantener el callback fresco sin re-crear el effect del mapa.
    useEffect(() => { onRouteDataRef.current = onRouteData; }, [onRouteData]);

    // ─── 1. Init mapa una sola vez ──────────────────────────────────
    useEffect(() => {
        if (!containerRef.current) return;
        const startCenter = center || origin || DEFAULT_CENTER;
        const map = new mapboxgl.Map({
            container: containerRef.current,
            style: 'mapbox://styles/mapbox/dark-v11',
            center: [startCenter.lng, startCenter.lat],
            zoom: DEFAULT_ZOOM,
            attributionControl: false,
            cooperativeGestures: false,
            pitchWithRotate: false,
        });
        mapRef.current = map;

        map.addControl(new mapboxgl.NavigationControl({ showCompass: true, showZoom: true }), 'top-right');
        map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right');

        map.on('style.load', () => {
            localizeLabelsToSpanish(map);
            // Pre-crear la source de la ruta (vacía); el line layer dibuja después.
            if (!map.getSource(ROUTE_SOURCE_ID)) {
                map.addSource(ROUTE_SOURCE_ID, {
                    type: 'geojson',
                    data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] }, properties: {} },
                });
                map.addLayer({
                    id: ROUTE_LAYER_ID,
                    type: 'line',
                    source: ROUTE_SOURCE_ID,
                    layout: { 'line-join': 'round', 'line-cap': 'round' },
                    paint: {
                        'line-color': routeColor,
                        'line-width': 5,
                        'line-opacity': 0.95,
                    },
                });
            }
        });

        map.on('error', (e) => {
            // Mapbox emite errores de tiles que no son fatales — solo
            // reportamos los inesperados (sin 401/403 de token wrong).
            if (e?.error?.status === 401 || e?.error?.status === 403) {
                reportError(new Error('Mapbox auth error — check token restrictions'), {
                    source: 'InteractiveMapMapbox',
                    status: e.error.status,
                });
            }
        });

        return () => {
            try { map.remove(); } catch { /* ignore */ }
            mapRef.current = null;
            originMarkerRef.current = null;
            destinationMarkerRef.current = null;
            driverMarkerRef.current = null;
            fleetMarkersRef.current = {};
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ─── 2. Sync origin marker ─────────────────────────────────────
    useEffect(() => {
        const map = mapRef.current;
        if (!map || !showPin) {
            if (originMarkerRef.current) {
                originMarkerRef.current.remove();
                originMarkerRef.current = null;
            }
            return;
        }
        if (!origin?.lat) return;
        if (!originMarkerRef.current) {
            originMarkerRef.current = new mapboxgl.Marker({
                element: createMarkerElement(isDriver ? 'driver' : 'pickup', { vehicleType, isLarge: true }),
                anchor: isDriver ? 'center' : 'bottom',
            })
                .setLngLat([origin.lng, origin.lat])
                .addTo(map);
        } else {
            originMarkerRef.current.setLngLat([origin.lng, origin.lat]);
        }
        if (isDriver && heading != null) {
            setMarkerHeading(originMarkerRef.current.getElement(), heading);
        }
    }, [origin?.lat, origin?.lng, showPin, isDriver, vehicleType, heading]);

    // ─── 3. Sync destination marker ────────────────────────────────
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;
        if (!destination?.lat) {
            if (destinationMarkerRef.current) {
                destinationMarkerRef.current.remove();
                destinationMarkerRef.current = null;
            }
            return;
        }
        if (!destinationMarkerRef.current) {
            destinationMarkerRef.current = new mapboxgl.Marker({
                element: createMarkerElement('dropoff'),
                anchor: 'bottom',
            })
                .setLngLat([destination.lng, destination.lat])
                .addTo(map);
        } else {
            destinationMarkerRef.current.setLngLat([destination.lng, destination.lat]);
        }
    }, [destination?.lat, destination?.lng]);

    // ─── 4. Sync assignedDriver marker (el chofer asignado al ride) ─
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;
        if (!assignedDriver?.lat) {
            if (driverMarkerRef.current) {
                driverMarkerRef.current.remove();
                driverMarkerRef.current = null;
            }
            return;
        }
        if (!driverMarkerRef.current) {
            driverMarkerRef.current = new mapboxgl.Marker({
                element: createMarkerElement('driver', {
                    vehicleType: assignedDriver.type || assignedDriver.vehicle_type,
                    isLarge: true,
                }),
                anchor: 'center',
            })
                .setLngLat([assignedDriver.lng, assignedDriver.lat])
                .addTo(map);
        } else {
            driverMarkerRef.current.setLngLat([assignedDriver.lng, assignedDriver.lat]);
        }
        if (assignedDriver.heading != null) {
            setMarkerHeading(driverMarkerRef.current.getElement(), assignedDriver.heading);
        }
    }, [assignedDriver?.lat, assignedDriver?.lng, assignedDriver?.heading, assignedDriver?.type, assignedDriver?.vehicle_type]);

    // ─── 5. Auto-center cuando cambia el center prop ───────────────
    useEffect(() => {
        const map = mapRef.current;
        if (!map || !center?.lat) return;
        map.easeTo({ center: [center.lng, center.lat], duration: 600 });
    }, [center?.lat, center?.lng]);

    // ─── 6. Auto-fit a origin + destination cuando hay ruta ─────────
    useEffect(() => {
        const map = mapRef.current;
        if (!map || !origin?.lat || !destination?.lat) return;
        // Esperar a que el style esté cargado antes de fit.
        const fit = () => {
            const bounds = new mapboxgl.LngLatBounds()
                .extend([origin.lng, origin.lat])
                .extend([destination.lng, destination.lat]);
            map.fitBounds(bounds, { padding: 80, duration: 700, maxZoom: 15 });
        };
        if (map.isStyleLoaded()) fit();
        else map.once('style.load', fit);
    }, [origin?.lat, origin?.lng, destination?.lat, destination?.lng]);

    // ─── 7. Calcular y dibujar la ruta ─────────────────────────────
    useEffect(() => {
        const map = mapRef.current;
        if (!map || !origin?.lat || !destination?.lat) {
            // Limpiar ruta cuando no hay endpoints.
            if (map?.getSource(ROUTE_SOURCE_ID)) {
                map.getSource(ROUTE_SOURCE_ID).setData({
                    type: 'Feature', geometry: { type: 'LineString', coordinates: [] }, properties: {},
                });
            }
            return;
        }

        const reqId = ++routeReqIdRef.current;

        const runRoute = async () => {
            const data = await getRoute(origin, destination);
            if (reqId !== routeReqIdRef.current) return; // race: descartar
            if (!map.getSource(ROUTE_SOURCE_ID)) return; // unmounted

            map.getSource(ROUTE_SOURCE_ID).setData({
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: data.polyline || [] },
                properties: {},
            });
            try {
                map.setPaintProperty(ROUTE_LAYER_ID, 'line-color', routeColor);
            } catch { /* layer puede no existir si style aún no cargó */ }

            // Propagar al padre en el shape Google.
            onRouteDataRef.current?.({
                distance: data.distance,
                duration: data.duration,
                polyline: data.polyline,
                degraded: data.degraded,
            });
        };

        if (map.isStyleLoaded()) runRoute();
        else map.once('style.load', runRoute);
    }, [origin?.lat, origin?.lng, destination?.lat, destination?.lng, routeColor]);

    // ─── 8. Sync flota de drivers (markersProp / markers) ──────────
    const driverList = markersProp || markers || [];
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;
        const fleet = fleetMarkersRef.current;
        const seen = new Set();

        driverList.forEach((d) => {
            if (!d || d.lat == null || d.lng == null) return;
            const id = d.id || d.driver_id;
            if (!id) return;
            seen.add(id);
            if (!fleet[id]) {
                fleet[id] = new mapboxgl.Marker({
                    element: createMarkerElement('fleet', {
                        vehicleType: d.type || d.vehicle_type,
                    }),
                    anchor: 'center',
                })
                    .setLngLat([d.lng, d.lat])
                    .addTo(map);
            } else {
                fleet[id].setLngLat([d.lng, d.lat]);
            }
            if (d.heading != null) {
                setMarkerHeading(fleet[id].getElement(), d.heading);
            }
        });

        // Remover los que ya no están en la lista actual.
        Object.keys(fleet).forEach((id) => {
            if (!seen.has(id)) {
                fleet[id].remove();
                delete fleet[id];
            }
        });
    }, [driverList]);

    // ─── 9. Realtime de la flota (cuando no se pasa markersProp explícito) ─
    // Esto replica el patrón del InteractiveMapGoogle:
    //   - Suscribe a UPDATE en profiles where role='driver'
    //   - Cleanup interval cada 30s borra drivers con last_location_update >90s
    // Solo se activa si NO se pasaron markers explícitos desde el padre
    // (admin dashboard) — en ese caso el padre maneja su propia subscripción.
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;
        if (markersProp || markers) return; // padre gestiona la lista

        const internal = {}; // id → { lat, lng, heading, vehicle_type, updated_at }
        const internalMarkers = {}; // id → mapboxgl.Marker

        const applyDriver = (id, row) => {
            if (!row || row.curr_lat == null || row.curr_lng == null) return;
            internal[id] = {
                lat: Number(row.curr_lat),
                lng: Number(row.curr_lng),
                heading: row.heading != null ? Number(row.heading) : 0,
                vehicle_type: row.vehicle_type,
                updated_at: row.last_location_update || row.updated_at || new Date().toISOString(),
            };
            if (!internalMarkers[id]) {
                internalMarkers[id] = new mapboxgl.Marker({
                    element: createMarkerElement('fleet', { vehicleType: internal[id].vehicle_type }),
                    anchor: 'center',
                })
                    .setLngLat([internal[id].lng, internal[id].lat])
                    .addTo(map);
            } else {
                internalMarkers[id].setLngLat([internal[id].lng, internal[id].lat]);
            }
            setMarkerHeading(internalMarkers[id].getElement(), internal[id].heading);
        };

        // Carga inicial: drivers online recientes.
        (async () => {
            const { data } = await supabase
                .from('profiles')
                .select('id, curr_lat, curr_lng, heading, vehicle_type, last_location_update, status')
                .eq('role', 'driver')
                .eq('status', 'online')
                .gte('last_location_update', new Date(Date.now() - STALE_DRIVER_MS).toISOString());
            (data || []).forEach((row) => applyDriver(row.id, row));
        })();

        const channel = supabase
            .channel(`mapbox_drivers_fleet_${Math.random().toString(36).slice(2, 8)}`)
            .on('postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'profiles', filter: 'role=eq.driver' },
                (payload) => {
                    const row = payload.new;
                    if (row.status !== 'online') {
                        // Driver pasó offline, remover del mapa.
                        if (internalMarkers[row.id]) {
                            internalMarkers[row.id].remove();
                            delete internalMarkers[row.id];
                            delete internal[row.id];
                        }
                        return;
                    }
                    applyDriver(row.id, row);
                })
            .subscribe();

        const cleanup = setInterval(() => {
            const cutoff = Date.now() - STALE_DRIVER_MS;
            Object.keys(internal).forEach((id) => {
                if (new Date(internal[id].updated_at).getTime() < cutoff) {
                    if (internalMarkers[id]) {
                        internalMarkers[id].remove();
                        delete internalMarkers[id];
                    }
                    delete internal[id];
                }
            });
        }, CLEANUP_INTERVAL_MS);

        return () => {
            clearInterval(cleanup);
            supabase.removeChannel(channel);
            Object.values(internalMarkers).forEach((m) => m.remove());
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [markersProp, markers]);

    return (
        <div
            ref={containerRef}
            className={className}
            style={{ position: 'relative', width: '100%', height: '100%' }}
        />
    );
};

// Inyectar el keyframes del pulse del pin pickup una sola vez por sesión.
if (typeof document !== 'undefined' && !document.getElementById('higo-mapbox-styles')) {
    const style = document.createElement('style');
    style.id = 'higo-mapbox-styles';
    style.textContent = `
        @keyframes higoPulse {
            0%   { transform: translateX(-50%) scale(0.7); opacity: 0.9; }
            70%  { transform: translateX(-50%) scale(1.5); opacity: 0.0; }
            100% { transform: translateX(-50%) scale(0.7); opacity: 0.0; }
        }
        .mapboxgl-ctrl-attrib { font-size: 10px; }
    `;
    document.head.appendChild(style);
}

export default InteractiveMapMapbox;
