// MapboxSandbox.jsx — Anexo C / M1.
//
// Página dev-only para validar Mapbox aislado antes de cutover.
// Solo se monta si import.meta.env.DEV es true. NO va a producción.
//
// Acceso: /#/sandbox-mapbox (cuando dev server activo).

import React, { useState } from 'react';
import InteractiveMapMapbox from '../InteractiveMapMapbox';

const HIGUEROTE = { lat: 10.4806, lng: -66.1003 };
const PLAYA_CHIRIMENA = { lat: 10.6172, lng: -66.0533 };

const SAMPLE_FLEET = [
    { id: 'demo-1', lat: 10.4810, lng: -66.0980, heading: 45, vehicle_type: 'moto' },
    { id: 'demo-2', lat: 10.4795, lng: -66.1025, heading: 90, vehicle_type: 'standard' },
    { id: 'demo-3', lat: 10.4830, lng: -66.0970, heading: 180, vehicle_type: 'van' },
];

const MapboxSandbox = () => {
    const [showRoute, setShowRoute] = useState(false);
    const [showFleet, setShowFleet] = useState(true);
    const [routeData, setRouteData] = useState(null);

    return (
        <div className="min-h-screen bg-[#0a101f] text-white flex flex-col">
            <header className="p-4 border-b border-white/10 flex items-center gap-3 flex-wrap">
                <span className="material-symbols-outlined text-blue-400">science</span>
                <h1 className="text-lg font-bold">Mapbox Sandbox · M1 PoC</h1>
                <span className="text-xs text-gray-500 ml-2">solo dev — gateado por import.meta.env.DEV</span>
                <div className="ml-auto flex gap-2 flex-wrap">
                    <label className="text-xs flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={showRoute} onChange={(e) => setShowRoute(e.target.checked)} />
                        Ruta Higuerote → Chirimena
                    </label>
                    <label className="text-xs flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={showFleet} onChange={(e) => setShowFleet(e.target.checked)} />
                        Flota demo (3 markers)
                    </label>
                </div>
            </header>

            <div className="flex-1 relative">
                <InteractiveMapMapbox
                    center={HIGUEROTE}
                    origin={showRoute ? HIGUEROTE : null}
                    destination={showRoute ? PLAYA_CHIRIMENA : null}
                    markersProp={showFleet ? SAMPLE_FLEET : []}
                    routeColor="#3B82F6"
                    onRouteData={setRouteData}
                />
            </div>

            {routeData && (
                <footer className="p-3 border-t border-white/10 bg-[#1A1F2E] text-xs flex items-center gap-4 flex-wrap">
                    <span>📏 Distancia: <strong>{routeData.distance?.text}</strong></span>
                    <span>⏱ Duración: <strong>{routeData.duration?.text}</strong></span>
                    {routeData.degraded && (
                        <span className="text-amber-400 font-bold">⚠ DEGRADED (Haversine fallback)</span>
                    )}
                </footer>
            )}
        </div>
    );
};

export default MapboxSandbox;
