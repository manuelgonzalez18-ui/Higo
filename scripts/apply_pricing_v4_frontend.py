from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    text = file_path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one match, found {count}\n--- needle ---\n{old}")
    file_path.write_text(text.replace(old, new, 1), encoding="utf-8")


# ---------------------------------------------------------------------------
# Admin: nuevos parámetros, simulador y rollout
# ---------------------------------------------------------------------------
replace_once(
    "src/pages/AdminPricingPage.jsx",
    "import AdminNav from '../components/AdminNav';\n",
    "import AdminNav from '../components/AdminNav';\n"
    "import PricingSimulator from '../components/admin/PricingSimulator';\n"
    "import PricingRolloutPanel from '../components/admin/PricingRolloutPanel';\n",
)

replace_once(
    "src/pages/AdminPricingPage.jsx",
    """const FIELDS = [
    { key: 'base',         label: 'Tarifa base',        hint: 'Incluye el primer km' },
    { key: 'per_km',       label: 'Por km adicional',   hint: 'Después del primer km' },
    { key: 'delivery_fee', label: 'Cargo de envío',     hint: 'Solo Higo Envíos' },
    { key: 'wait_per_min', label: 'Espera ($/min)',     hint: 'Primeros 3 min gratis' },
    { key: 'stop_fee',     label: 'Por parada extra',   hint: 'Paradas intermedias' }
];
""",
    """const FIELDS = [
    { key: 'minimum_fare',       label: 'Tarifa mínima',            hint: 'Piso del viaje', prefix: '$' },
    { key: 'base',               label: 'Tarifa base',              hint: 'Monto inicial', prefix: '$' },
    { key: 'included_km',        label: 'Kilómetros incluidos',     hint: 'Antes de cobrar por km', prefix: '' },
    { key: 'per_km',             label: 'Por km adicional',         hint: 'Después de los km incluidos', prefix: '$' },
    { key: 'per_minute',         label: 'Por minuto estimado',      hint: 'Tiempo previsto de ruta', prefix: '$' },
    { key: 'delivery_fee',       label: 'Cargo de envío',           hint: 'Solo Higo Envíos', prefix: '$' },
    { key: 'free_wait_minutes',  label: 'Minutos gratis de espera', hint: 'En el punto de recogida', prefix: '' },
    { key: 'wait_per_min',       label: 'Espera por minuto',        hint: 'Después del tiempo gratis', prefix: '$' },
    { key: 'stop_fee',           label: 'Por parada extra',         hint: 'Paradas intermedias', prefix: '$' },
    { key: 'maximum_multiplier', label: 'Multiplicador máximo',     hint: 'Tope recomendado 1.30', prefix: '×' }
];
""",
)

replace_once(
    "src/pages/AdminPricingPage.jsx",
    """        const patch = {
            base: parseFloat(row.base) || 0,
            per_km: parseFloat(row.per_km) || 0,
            delivery_fee: parseFloat(row.delivery_fee) || 0,
            wait_per_min: parseFloat(row.wait_per_min) || 0,
            stop_fee: parseFloat(row.stop_fee) || 0
        };
""",
    """        const patch = {
            minimum_fare: parseFloat(row.minimum_fare) || 0,
            base: parseFloat(row.base) || 0,
            included_km: parseFloat(row.included_km) || 0,
            per_km: parseFloat(row.per_km) || 0,
            per_minute: parseFloat(row.per_minute) || 0,
            delivery_fee: parseFloat(row.delivery_fee) || 0,
            free_wait_minutes: parseFloat(row.free_wait_minutes) || 0,
            wait_per_min: parseFloat(row.wait_per_min) || 0,
            stop_fee: parseFloat(row.stop_fee) || 0,
            maximum_multiplier: parseFloat(row.maximum_multiplier) || 1
        };
""",
)

replace_once(
    "src/pages/AdminPricingPage.jsx",
    '<span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-mono">$</span>',
    '<span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-mono">{f.prefix ?? \'$\'}</span>',
)

replace_once(
    "src/pages/AdminPricingPage.jsx",
    """            </div>

            {/* D.A2 — Reglas de surge pricing */}
""",
    """            </div>

            <PricingSimulator ratesByType={rows} />
            <PricingRolloutPanel />

            {/* D.A2 — Reglas de surge pricing */}
""",
)


# ---------------------------------------------------------------------------
# Solicitud: capturar duración y calcular el fallback V4
# ---------------------------------------------------------------------------
replace_once(
    "src/pages/RequestRidePage.jsx",
    "import { openLegalLink } from '../utils/openLegalLink';\n",
    "import { openLegalLink } from '../utils/openLegalLink';\nimport { computeFallbackQuote } from '../utils/ridePricing';\n",
)

replace_once(
    "src/pages/RequestRidePage.jsx",
    "    const [roadDistance, setRoadDistance] = useState(0); // Store actual road distance in meters\n",
    "    const [roadDistance, setRoadDistance] = useState(0); // Store actual road distance in meters\n"
    "    const [routeDurationMin, setRouteDurationMin] = useState(0);\n",
)

replace_once(
    "src/pages/RequestRidePage.jsx",
    """    const FALLBACK_RATES = {
        moto:     { base: 1.00, perKm: 0.25, deliveryFee: 0.50, waitPerMin: 0.05, stopFee: 0.50 },
        standard: { base: 1.50, perKm: 0.40, deliveryFee: 1.50, waitPerMin: 0.08, stopFee: 1.00 },
        van:      { base: 1.70, perKm: 0.60, deliveryFee: 2.00, waitPerMin: 0.10, stopFee: 1.00 }
    };
""",
    """    const FALLBACK_RATES = {
        moto:     { base: 1.00, minimumFare: 1.00, perKm: 0.25, perMinute: 0, includedKm: 1, deliveryFee: 0.50, waitPerMin: 0.05, freeWaitMinutes: 3, stopFee: 0.50, maximumMultiplier: 1.30 },
        standard: { base: 1.50, minimumFare: 1.50, perKm: 0.40, perMinute: 0, includedKm: 1, deliveryFee: 1.50, waitPerMin: 0.08, freeWaitMinutes: 3, stopFee: 1.00, maximumMultiplier: 1.30 },
        van:      { base: 1.70, minimumFare: 1.70, perKm: 0.60, perMinute: 0, includedKm: 1, deliveryFee: 2.00, waitPerMin: 0.10, freeWaitMinutes: 3, stopFee: 1.00, maximumMultiplier: 1.30 }
    };
""",
)

replace_once(
    "src/pages/RequestRidePage.jsx",
    """                rates[r.vehicle_type] = {
                    base: Number(r.base),
                    perKm: Number(r.per_km),
                    deliveryFee: Number(r.delivery_fee),
                    waitPerMin: Number(r.wait_per_min),
                    stopFee: Number(r.stop_fee)
                };
""",
    """                rates[r.vehicle_type] = {
                    base: Number(r.base),
                    minimumFare: Number(r.minimum_fare ?? r.base),
                    perKm: Number(r.per_km),
                    perMinute: Number(r.per_minute || 0),
                    includedKm: Number(r.included_km ?? 1),
                    deliveryFee: Number(r.delivery_fee),
                    waitPerMin: Number(r.wait_per_min),
                    freeWaitMinutes: Number(r.free_wait_minutes ?? 3),
                    stopFee: Number(r.stop_fee),
                    maximumMultiplier: Number(r.maximum_multiplier ?? 1.30)
                };
""",
)

replace_once(
    "src/pages/RequestRidePage.jsx",
    """        // Pricing Logic based on selectedRide (type)
        const type = selectedRide; // Use selectedRide from state
        const rates = VEHICLE_RATES[type];
        const basePrice = rates.base;
        const perKm = rates.perKm;
        const serviceFee = serviceType === 'delivery' ? rates.deliveryFee : 0;

        // Add additional stops cost (leído desde pricing_config, fallback 1.0)
        const validStopsCount = stops.filter(s => s.coords).length;
        const stopFee = rates.stopFee ?? (type === 'moto' ? 0.50 : 1.00);
        const stopsCost = validStopsCount * stopFee;

        let calculated = basePrice + (Math.max(0, distKm - INCLUDED_KM) * perKm) + stopsCost + serviceFee;

        // Minimum is the base price
        if (calculated < basePrice) calculated = basePrice;

        // Aplicar surge multiplier (D.A2). Defensive: 1.0 si fetch falló.
        calculated = calculated * (surgeMultiplier || 1.0);

        setPrice(parseFloat(calculated.toFixed(2)));
""",
    """        const validStopsCount = stops.filter(s => s.coords).length;
        const quote = computeFallbackQuote({
            origin: pickupCoords,
            destination: dropoffCoords,
            routeDistanceKm: distKm,
            routeDurationMin,
            vehicleType: selectedRide,
            serviceType: serviceType || 'ride',
            stopsCount: validStopsCount,
            surgeMultiplier: surgeMultiplier || 1,
            rates: VEHICLE_RATES,
        });
        setPrice(quote.subtotal);
""",
)

replace_once(
    "src/pages/RequestRidePage.jsx",
    """        if (validStopsCount > 0) {
            const baseDistNoStops = roadDistance > 0 ? (roadDistance / 1000) : getDistanceFromLatLonInKm(pickupCoords.lat, pickupCoords.lng, dropoffCoords.lat, dropoffCoords.lng);
            let oldCalculated = basePrice + (Math.max(0, baseDistNoStops - INCLUDED_KM) * perKm) + serviceFee;
            if (oldCalculated < basePrice) oldCalculated = basePrice;
            setOldPrice(parseFloat(oldCalculated.toFixed(2)));
        } else {
""",
    """        if (validStopsCount > 0) {
            const baseDistNoStops = roadDistance > 0 ? (roadDistance / 1000) : getDistanceFromLatLonInKm(pickupCoords.lat, pickupCoords.lng, dropoffCoords.lat, dropoffCoords.lng);
            const quoteWithoutStops = computeFallbackQuote({
                origin: pickupCoords,
                destination: dropoffCoords,
                routeDistanceKm: baseDistNoStops,
                routeDurationMin,
                vehicleType: selectedRide,
                serviceType: serviceType || 'ride',
                stopsCount: 0,
                surgeMultiplier: surgeMultiplier || 1,
                rates: VEHICLE_RATES,
            });
            setOldPrice(quoteWithoutStops.subtotal);
        } else {
""",
)

replace_once(
    "src/pages/RequestRidePage.jsx",
    "    }, [pickupCoords, dropoffCoords, selectedRide, stops, serviceType, roadDistance, VEHICLE_RATES, surgeMultiplier]);\n",
    "    }, [pickupCoords, dropoffCoords, selectedRide, stops, serviceType, roadDistance, routeDurationMin, VEHICLE_RATES, surgeMultiplier]);\n",
)

replace_once(
    "src/pages/RequestRidePage.jsx",
    """                    onRouteData={(data) => {
                        if (data?.distance?.value) setRoadDistance(data.distance.value);
                    }}
""",
    """                    onRouteData={(data) => {
                        if (data?.distance?.value) setRoadDistance(data.distance.value);
                        if (data?.duration?.value) setRouteDurationMin(data.duration.value / 60);
                    }}
""",
)

replace_once(
    "src/pages/RequestRidePage.jsx",
    """                                                    setPickupCoords({ lat: place.lat, lng: place.lng });
                                                    setRoadDistance(0);
""",
    """                                                    setPickupCoords({ lat: place.lat, lng: place.lng });
                                                    setRoadDistance(0);
                                                    setRouteDurationMin(0);
""",
)

replace_once(
    "src/pages/RequestRidePage.jsx",
    """                                                    setDropoffCoords({ lat: place.lat, lng: place.lng });
                                                    setRoadDistance(0); // Reset road distance to force recalculation for new destination
""",
    """                                                    setDropoffCoords({ lat: place.lat, lng: place.lng });
                                                    setRoadDistance(0); // Reset road distance to force recalculation for new destination
                                                    setRouteDurationMin(0);
""",
)

replace_once(
    "src/pages/RequestRidePage.jsx",
    """                    pickup, dropoff, price, selectedRide, pickupCoords, dropoffCoords,
                    serviceType: 'ride'
""",
    """                    pickup, dropoff, price, selectedRide, pickupCoords, dropoffCoords,
                    serviceType: 'ride', stops, roadDistance, routeDurationMin
""",
)

replace_once(
    "src/pages/RequestRidePage.jsx",
    """                serviceType: 'delivery',
                deliveryData: data,
                stops // Pass stops to confirm page
""",
    """                serviceType: 'delivery',
                deliveryData: data,
                stops, // Pass stops to confirm page
                roadDistance,
                routeDurationMin
""",
)


# ---------------------------------------------------------------------------
# Confirmación: cotización del servidor y desglose visible
# ---------------------------------------------------------------------------
replace_once(
    "src/pages/ConfirmTripPage.jsx",
    "import React, { useMemo, useRef, useState } from 'react';\n",
    "import React, { useEffect, useMemo, useRef, useState } from 'react';\n",
)

replace_once(
    "src/pages/ConfirmTripPage.jsx",
    """        roadDistance = null,
    } = location.state || {};
""",
    """        roadDistance = null,
        routeDurationMin = null,
    } = location.state || {};
""",
)

replace_once(
    "src/pages/ConfirmTripPage.jsx",
    """    const [validatingPromo, setValidatingPromo] = useState(false);

    const isDelivery = serviceType === 'delivery';
""",
    """    const [validatingPromo, setValidatingPromo] = useState(false);
    const [serverQuote, setServerQuote] = useState(null);

    const isDelivery = serviceType === 'delivery';
""",
)

replace_once(
    "src/pages/ConfirmTripPage.jsx",
    "    const finalPrice = appliedPromo?.finalPrice ?? Number(price || 0);\n",
    """    const finalPrice = appliedPromo?.finalPrice ?? serverQuote?.finalPrice ?? Number(price || 0);

    useEffect(() => {
        if (!FEATURES.serverSideRidePricing || !pickupCoords || !dropoffCoords) return;
        let cancelled = false;
        void quoteRide({
            pickupCoords,
            dropoffCoords,
            vehicleType: selectedRide,
            serviceType,
            routeDistanceKm: roadDistance ? Number(roadDistance) / 1000 : null,
            routeDurationMin: routeDurationMin == null ? null : Number(routeDurationMin),
            stopsCount: Array.isArray(stops) ? stops.length : 0,
            clientSubtotalFloor: Number(price || 0),
        }).then((quote) => {
            if (!cancelled) setServerQuote(quote);
        }).catch(() => {
            // La confirmación vuelve a cotizar de forma autoritativa.
        });
        return () => { cancelled = true; };
    }, [dropoffCoords?.lat, dropoffCoords?.lng, pickupCoords?.lat, pickupCoords?.lng, price, roadDistance, routeDurationMin, selectedRide, serviceType, stops]);
""",
)

replace_once(
    "src/pages/ConfirmTripPage.jsx",
    """                    routeDistanceKm: roadDistance ? Number(roadDistance) / 1000 : null,
                    stopsCount: Array.isArray(stops) ? stops.length : 0,
""",
    """                    routeDistanceKm: roadDistance ? Number(roadDistance) / 1000 : null,
                    routeDurationMin: routeDurationMin == null ? null : Number(routeDurationMin),
                    stopsCount: Array.isArray(stops) ? stops.length : 0,
""",
)

replace_once(
    "src/pages/ConfirmTripPage.jsx",
    """                setAppliedPromo({
                    id: quote.promoId,
""",
    """                setServerQuote(quote);
                setAppliedPromo({
                    id: quote.promoId,
""",
)

replace_once(
    "src/pages/ConfirmTripPage.jsx",
    """                        routeDistanceKm: roadDistance ? Number(roadDistance) / 1000 : null,
                        stops,
""",
    """                        routeDistanceKm: roadDistance ? Number(roadDistance) / 1000 : null,
                        routeDurationMin: routeDurationMin == null ? null : Number(routeDurationMin),
                        stops,
""",
)

replace_once(
    "src/pages/ConfirmTripPage.jsx",
    """                </section>

                <section className="bg-[#1A1F2E] rounded-3xl p-5 border border-white/5 space-y-3">
                    <label className="text-xs font-bold text-gray-400">Teléfono de contacto (opcional)</label>
""",
    """                </section>

                {serverQuote && (
                    <section className="bg-[#1A1F2E] rounded-3xl p-5 border border-white/5 space-y-2 text-sm">
                        <div className="flex justify-between"><span className="text-gray-400">Tarifa base</span><strong>{money(serverQuote.base)}</strong></div>
                        <div className="flex justify-between"><span className="text-gray-400">Distancia · {Number(serverQuote.distanceKm || 0).toFixed(1)} km</span><strong>{money(serverQuote.distanceAmount)}</strong></div>
                        <div className="flex justify-between"><span className="text-gray-400">Tiempo estimado · {Math.round(Number(serverQuote.durationMin || 0))} min</span><strong>{money(serverQuote.timeAmount)}</strong></div>
                        {Number(serverQuote.stopsAmount || 0) > 0 && <div className="flex justify-between"><span className="text-gray-400">Paradas</span><strong>{money(serverQuote.stopsAmount)}</strong></div>}
                        {Number(serverQuote.extrasAmount || 0) > 0 && <div className="flex justify-between"><span className="text-gray-400">Extras del servicio</span><strong>{money(serverQuote.extrasAmount)}</strong></div>}
                        {Number(serverQuote.surgeMultiplier || 1) > 1 && <div className="flex justify-between text-amber-300"><span>Factor zona/horario</span><strong>×{Number(serverQuote.surgeMultiplier).toFixed(2)}</strong></div>}
                        <div className="pt-2 mt-2 border-t border-white/10 flex justify-between"><span className="text-gray-400">Tarifa mínima</span><strong>{money(serverQuote.minimumFare)}</strong></div>
                        {serverQuote.rolloutMode === 'shadow' && <p className="pt-2 text-[10px] text-blue-300">Modelo V4 en evaluación interna. El precio cobrado mantiene la fórmula vigente.</p>}
                    </section>
                )}

                <section className="bg-[#1A1F2E] rounded-3xl p-5 border border-white/5 space-y-3">
                    <label className="text-xs font-bold text-gray-400">Teléfono de contacto (opcional)</label>
""",
)

print("Pricing V4 frontend integration applied successfully.")
