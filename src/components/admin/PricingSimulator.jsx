import React, { useMemo, useState } from 'react';
import { computeFallbackQuote } from '../../utils/ridePricing';

const money = (value) => `$${Number(value || 0).toFixed(2)}`;

const vehicleLabel = (value) => ({
    moto: 'Moto',
    standard: 'Carro',
    van: 'Camioneta',
}[value] || value);

export default function PricingSimulator({ ratesByType = {} }) {
    const [vehicleType, setVehicleType] = useState('standard');
    const [distanceKm, setDistanceKm] = useState(5);
    const [durationMin, setDurationMin] = useState(15);
    const [stopsCount, setStopsCount] = useState(0);
    const [serviceType, setServiceType] = useState('ride');
    const [multiplier, setMultiplier] = useState(1);

    const quote = useMemo(() => {
        const distance = Math.max(0, Number(distanceKm) || 0);
        // 1 grado de longitud cerca del ecuador equivale aproximadamente a
        // 111.32 km. Estas coordenadas solo alimentan la protección Haversine
        // del mismo cálculo usado como fallback por la app.
        const origin = { lat: 0, lng: 0 };
        const destination = { lat: 0, lng: distance / 111.32 };
        return computeFallbackQuote({
            origin,
            destination,
            routeDistanceKm: distance,
            routeDurationMin: Math.max(0, Number(durationMin) || 0),
            vehicleType,
            serviceType,
            stopsCount,
            surgeMultiplier: multiplier,
            rates: ratesByType,
        });
    }, [distanceKm, durationMin, multiplier, ratesByType, serviceType, stopsCount, vehicleType]);

    const fields = [
        ['Tarifa base', quote.baseAmount],
        ['Distancia', quote.distanceAmount],
        ['Tiempo estimado', quote.timeAmount],
        ['Paradas', quote.stopsAmount],
        ['Extras', quote.extrasAmount],
    ];

    return (
        <section className="mt-10 bg-[#1A1F2E] rounded-3xl border border-white/5 overflow-hidden shadow-2xl">
            <div className="p-5 border-b border-white/5 bg-gradient-to-r from-blue-600/20 to-violet-600/20">
                <h2 className="font-black text-xl flex items-center gap-2">
                    <span className="material-symbols-outlined text-blue-400">calculate</span>
                    Simulador de tarifa V4
                </h2>
                <p className="text-sm text-gray-400 mt-1">
                    Permite analizar distancia, tiempo, piso y multiplicador sin modificar viajes reales.
                </p>
            </div>

            <div className="grid lg:grid-cols-[1.1fr_.9fr] gap-6 p-5">
                <div className="grid sm:grid-cols-2 gap-4">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                        Vehículo
                        <select value={vehicleType} onChange={(event) => setVehicleType(event.target.value)} className="mt-1 w-full p-3 rounded-xl bg-[#0F1014] border border-white/10 text-white normal-case">
                            {['moto', 'standard', 'van'].map((type) => <option key={type} value={type}>{vehicleLabel(type)}</option>)}
                        </select>
                    </label>
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                        Servicio
                        <select value={serviceType} onChange={(event) => setServiceType(event.target.value)} className="mt-1 w-full p-3 rounded-xl bg-[#0F1014] border border-white/10 text-white normal-case">
                            <option value="ride">Viaje</option>
                            <option value="delivery">Higo Envíos</option>
                        </select>
                    </label>
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                        Distancia de ruta (km)
                        <input type="number" min="0" step="0.1" value={distanceKm} onChange={(event) => setDistanceKm(event.target.value)} className="mt-1 w-full p-3 rounded-xl bg-[#0F1014] border border-white/10 text-white normal-case" />
                    </label>
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                        Duración estimada (min)
                        <input type="number" min="0" step="1" value={durationMin} onChange={(event) => setDurationMin(event.target.value)} className="mt-1 w-full p-3 rounded-xl bg-[#0F1014] border border-white/10 text-white normal-case" />
                    </label>
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                        Paradas
                        <input type="number" min="0" max="5" step="1" value={stopsCount} onChange={(event) => setStopsCount(event.target.value)} className="mt-1 w-full p-3 rounded-xl bg-[#0F1014] border border-white/10 text-white normal-case" />
                    </label>
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                        Multiplicador
                        <input type="number" min="1" max="3" step="0.05" value={multiplier} onChange={(event) => setMultiplier(event.target.value)} className="mt-1 w-full p-3 rounded-xl bg-[#0F1014] border border-white/10 text-white normal-case" />
                    </label>
                </div>

                <div className="rounded-2xl bg-[#0F1014] border border-white/10 p-5">
                    <div className="space-y-2">
                        {fields.map(([label, value]) => (
                            <div key={label} className="flex justify-between text-sm">
                                <span className="text-gray-400">{label}</span>
                                <strong className="font-mono">{money(value)}</strong>
                            </div>
                        ))}
                        <div className="flex justify-between text-sm pt-2 border-t border-white/10">
                            <span className="text-gray-400">Multiplicador aplicado</span>
                            <strong className="font-mono text-amber-400">×{quote.surgeMultiplier.toFixed(2)}</strong>
                        </div>
                        <div className="flex justify-between text-sm">
                            <span className="text-gray-400">Tarifa mínima</span>
                            <strong className="font-mono">{money(quote.minimumFare)}</strong>
                        </div>
                    </div>
                    <div className="mt-5 rounded-2xl bg-blue-600/15 border border-blue-500/30 p-4 flex justify-between items-end">
                        <div>
                            <p className="text-xs uppercase tracking-widest text-blue-300 font-black">Precio simulado</p>
                            <p className="text-xs text-gray-400 mt-1">Antes de promociones y espera</p>
                        </div>
                        <strong className="text-3xl font-black font-mono">{money(quote.subtotal)}</strong>
                    </div>
                </div>
            </div>
        </section>
    );
}
