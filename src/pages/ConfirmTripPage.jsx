import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import InteractiveMap from '../components/InteractiveMap';
import { supabase } from '../services/supabase';
import { createClientRequestId, createRideRequest, recoverRideRequest, quoteRide } from '../services/rideApi';
import { toast } from '../components/Toast';
import { friendlyError } from '../utils/friendlyError';
import { logger } from '../utils/logger';
import { announcePassengerRideMilestone } from '../utils/passengerRideVoice';
import { withTimeout } from '../utils/withTimeout';

const EMPTY_STOPS = Object.freeze([]);

const VEHICLE_INFO = Object.freeze({
    moto: { title: 'Higo Moto', icon: 'two_wheeler', seats: '1 asiento' },
    standard: { title: 'Higo Carro', icon: 'local_taxi', seats: '4 asientos' },
    van: { title: 'Higo Camioneta', icon: 'airport_shuttle', seats: '6+ asientos' },
});

const PROMO_ERRORS = Object.freeze({
    inactive: 'El código está inactivo.',
    expired: 'El código ha expirado.',
    minimum_not_met: 'El viaje no alcanza el monto mínimo de la promoción.',
    usage_limit_reached: 'La promoción alcanzó su límite de usos.',
    user_limit_reached: 'Ya utilizaste este código el máximo permitido.',
    budget_exhausted: 'El presupuesto de esta promoción se agotó.',
});


const money = (value) => `$${Number(value || 0).toFixed(2)}`;

export default function ConfirmTripPage() {
    const navigate = useNavigate();
    const location = useLocation();
    const [clientRequestId] = useState(() => {
        const key = `higo:ride-request:${location.key}`;
        try {
            const existing = sessionStorage.getItem(key);
            if (existing) return existing;
            const created = createClientRequestId();
            sessionStorage.setItem(key, created);
            return created;
        } catch { return createClientRequestId(); }
    });

    const {
        pickup,
        dropoff,
        selectedRide = 'standard',
        pickupCoords,
        dropoffCoords,
        serviceType = 'ride',
        deliveryData = null,
        stops = EMPTY_STOPS,
    } = location.state || {};

    const [loading, setLoading] = useState(false);
    const confirmingRef = useRef(false);
    const [passengerPhone, setPassengerPhone] = useState('');
    const [promoCode, setPromoCode] = useState('');
    const [validatingPromo, setValidatingPromo] = useState(false);
    const [serverQuote, setServerQuote] = useState(null);
    const [quoteError, setQuoteError] = useState('');
    const [quoteLoading, setQuoteLoading] = useState(false);

    const isDelivery = serviceType === 'delivery';
    const vehicle = VEHICLE_INFO[selectedRide] || VEHICLE_INFO.standard;
    const vehicleDetails = useMemo(() => ({
        ...vehicle,
        seats: isDelivery
            ? selectedRide === 'moto' ? 'Máx. 4 kg' : selectedRide === 'van' ? 'Máx. 100 kg' : 'Máx. 40 kg'
            : vehicle.seats,
    }), [vehicle, isDelivery, selectedRide]);
    const finalPrice = serverQuote?.finalPrice;

    useEffect(() => {
        if (!pickupCoords || !dropoffCoords) return;
        let cancelled = false;
        setQuoteLoading(true);
        setServerQuote(null);
        void quoteRide({
            pickupCoords,
            dropoffCoords,
            vehicleType: selectedRide,
            serviceType,
            stops,
        }).then((quote) => {
            if (!cancelled) { setServerQuote(quote); setQuoteError(''); }
        }).catch(() => {
            if (!cancelled) setQuoteError('No pudimos calcular la ruta. Comprueba tu conexión e inténtalo de nuevo.');
        }).finally(() => { if (!cancelled) setQuoteLoading(false); });
        return () => { cancelled = true; };
    }, [dropoffCoords?.lat, dropoffCoords?.lng, pickupCoords?.lat, pickupCoords?.lng, selectedRide, serviceType, stops]);

    if (!pickup || !dropoff || !pickupCoords || !dropoffCoords) {
        return (
            <div className="min-h-screen bg-[#10141F] text-white flex items-center justify-center p-6 text-center">
                <div>
                    <p className="font-bold">Faltan datos de la ruta.</p>
                    <button onClick={() => navigate('/')} className="mt-4 px-5 py-3 rounded-xl bg-blue-600">Volver al inicio</button>
                </div>
            </div>
        );
    }

    const validatePromo = async () => {
        const code = promoCode.trim().toUpperCase();
        if (!code || validatingPromo) return;
        setValidatingPromo(true);
        try {
            {
                const quote = await quoteRide({
                    pickupCoords,
                    dropoffCoords,
                    vehicleType: selectedRide,
                    serviceType,
                    stops,
                    promoCode: code,
                });
                if (!quote?.promoValid) {
                    throw new Error(PROMO_ERRORS[quote?.promoError] || 'El código no se puede aplicar.');
                }
                setServerQuote(quote);
                setQuoteError('');
            }
            toast.success('Promoción aplicada.');
        } catch (error) {
            toast.error(error?.message || 'No se pudo validar el código.');
        } finally {
            setValidatingPromo(false);
        }
    };

    const saveRecipientContact = async (session, rideId) => {
        if (!isDelivery || !deliveryData?.save_contact || !deliveryData?.receiverName || !deliveryData?.receiverPhone) return;
        try {
            const { data: existing } = await supabase
                .from('recipient_contacts')
                .select('id')
                .eq('user_id', session.user.id)
                .eq('phone', deliveryData.receiverPhone)
                .maybeSingle();
            const contact = {
                name: deliveryData.receiverName,
                address_label: deliveryData.contact_label || null,
                address: dropoff,
                lat: dropoffCoords.lat,
                lng: dropoffCoords.lng,
                instructions: deliveryData.destInstructions || null,
                last_used_at: new Date().toISOString(),
            };
            if (existing?.id) {
                await supabase.from('recipient_contacts').update(contact).eq('id', existing.id);
            } else {
                await supabase.from('recipient_contacts').insert({
                    user_id: session.user.id,
                    phone: deliveryData.receiverPhone,
                    ...contact,
                });
            }
            logger.debug('[ConfirmTrip] recipient saved for ride', rideId);
        } catch (error) {
            logger.warn('[ConfirmTrip] recipient save failed', error);
        }
    };

    const handleConfirm = async () => {
        if (confirmingRef.current) return;
        confirmingRef.current = true;
        setLoading(true);
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) {
                navigate('/auth');
                return;
            }

            // A previous request may have committed even if its response was lost.
            // Recover it before consulting Google or checking quote expiration.
            const recovered = await withTimeout(recoverRideRequest(clientRequestId, session.user.id));
            if (recovered) {
                toast.success('Solicitud recuperada correctamente.');
                navigate(`/ride/${recovered.rideId}`, { replace: true });
                return;
            }

            toast.info('Enviando solicitud a Higo…');
            const confirmedQuote = serverQuote;
            if (!confirmedQuote || new Date(confirmedQuote.expiresAt).getTime() <= Date.now()) {
                const refreshed = await quoteRide({ pickupCoords, dropoffCoords, vehicleType: selectedRide, serviceType, stops, promoCode: serverQuote?.promoCode || null });
                setServerQuote(refreshed);
                setQuoteError('La cotización se actualizó. Revisa el importe y confirma nuevamente.');
                return;
            }
            const creation = await withTimeout(
                    createRideRequest({
                        clientRequestId: clientRequestId,
                        quoteId: confirmedQuote.quoteId,
                        pickup,
                        dropoff,
                        passengerPhone,
                        deliveryInfo: deliveryData,
                        payer: deliveryData?.payer || (isDelivery ? 'sender' : null),
                        codAmount: deliveryData?.cod_amount || null,
                        termsVersion: deliveryData?.terms_version || null,
                    }),
                );

            const rideId = creation?.rideId || creation?.id;
            if (!rideId) throw new Error('El servidor no devolvió el identificador del viaje.');
            await saveRecipientContact(session, rideId);
            void announcePassengerRideMilestone({
                rideId,
                milestone: isDelivery ? 'delivery_searching' : 'searching',
            });
            toast.success(creation?.idempotentReplay ? 'Solicitud recuperada correctamente.' : 'Solicitud enviada. Buscando conductores…');
            navigate(`/ride/${rideId}`, { replace: true });
        } catch (error) {
            if (/quote_expired|quote_changed|quote_(?:already_)?consumed/.test(error?.message || '')) setServerQuote(null);
            logger.error('[ConfirmTrip] create ride failed', error);
            toast.error(friendlyError(error, 'No se pudo solicitar el viaje. Probá de nuevo.', {
                source: 'ConfirmTripPage.handleConfirm',
                clientRequestId: clientRequestId,
            }));
        } finally {
            confirmingRef.current = false;
            setLoading(false);
        }
    };

    return (
        <div className="bg-[#10141F] min-h-screen text-white flex flex-col">
            <div className="relative w-full h-[42vh] bg-[#2C2F3E] rounded-b-[40px] overflow-hidden shadow-2xl">
                <InteractiveMap className="w-full h-full" center={pickupCoords} origin={pickupCoords} destination={dropoffCoords} markersProp={stops} />
                <div className="absolute top-0 left-0 right-0 p-6 flex justify-between items-center bg-gradient-to-b from-black/80 to-transparent">
                    <button onClick={() => navigate(-1)} className="w-10 h-10 bg-white/10 backdrop-blur-md rounded-full flex items-center justify-center" aria-label="Volver">
                        <span className="material-symbols-outlined">arrow_back</span>
                    </button>
                    <h1 className="text-lg font-bold">{isDelivery ? 'Confirmar envío' : 'Confirmar viaje'}</h1>
                    <div className="w-10" />
                </div>
            </div>

            <main className="flex-1 -mt-5 pt-10 px-5 pb-8 w-full max-w-md mx-auto space-y-5">
                {quoteError && <p role="alert" className="text-amber-300 text-sm">{quoteError}</p>}
                <section className="bg-[#1A1F2E] rounded-3xl p-5 border border-white/5">
                    <div className="flex gap-4">
                        <div className="flex flex-col items-center pt-1"><span className="w-3 h-3 rounded-full bg-blue-500" /><span className="h-12 border-l border-dashed border-gray-600" /><span className="w-3 h-3 rounded-full bg-violet-500" /></div>
                        <div className="flex-1 min-w-0 space-y-5">
                            <div><p className="text-[10px] uppercase text-gray-500">Origen</p><p className="text-sm font-bold truncate">{pickup}</p></div>
                            <div><p className="text-[10px] uppercase text-gray-500">Destino</p><p className="text-sm font-bold truncate">{dropoff}</p></div>
                        </div>
                    </div>
                </section>

                <section className="bg-[#1A1F2E] rounded-3xl p-5 border border-white/5 flex items-center gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-blue-500/15 text-blue-300 flex items-center justify-center"><span className="material-symbols-outlined text-2xl">{vehicleDetails.icon}</span></div>
                    <div className="flex-1"><p className="font-black">{vehicleDetails.title}</p><p className="text-xs text-gray-500">{vehicleDetails.seats}{Array.isArray(stops) && stops.length ? ` · ${stops.length} parada(s)` : ''}</p></div>
                    <p className="text-2xl font-black">{serverQuote ? money(finalPrice) : '—'}</p>
                </section>

                {serverQuote && (
                    <section className="bg-[#1A1F2E] rounded-3xl p-5 border border-white/5 space-y-2 text-sm">
                        <div className="flex justify-between"><span className="text-gray-400">Tarifa base</span><strong>{money(serverQuote.base)}</strong></div>
                        <div className="flex justify-between"><span className="text-gray-400">Distancia · {Number(serverQuote.distanceKm || 0).toFixed(1)} km</span><strong>{money(serverQuote.distanceAmount)}</strong></div>
                        <div className="flex justify-between"><span className="text-gray-400">Tiempo estimado · {Math.round(Number(serverQuote.durationMin || 0))} min</span><strong>{money(serverQuote.timeAmount)}</strong></div>
                        {Number(serverQuote.stopsAmount || 0) > 0 && <div className="flex justify-between"><span className="text-gray-400">Paradas</span><strong>{money(serverQuote.stopsAmount)}</strong></div>}
                        {Number(serverQuote.extrasAmount || 0) > 0 && <div className="flex justify-between"><span className="text-gray-400">Extras del servicio</span><strong>{money(serverQuote.extrasAmount)}</strong></div>}
                        {Number(serverQuote.surgeMultiplier || 1) > 1 && <div className="flex justify-between text-amber-300"><span>Factor zona/horario</span><strong>×{Number(serverQuote.surgeMultiplier).toFixed(2)}</strong></div>}
                        <div className="pt-2 mt-2 border-t border-white/10 flex justify-between"><span className="text-gray-400">Tarifa mínima</span><strong>{money(serverQuote.minimumFare)}</strong></div>

                    </section>
                )}

                <section className="bg-[#1A1F2E] rounded-3xl p-5 border border-white/5 space-y-3">
                    <label className="text-xs font-bold text-gray-400">Teléfono de contacto (opcional)</label>
                    <input value={passengerPhone} onChange={(event) => setPassengerPhone(event.target.value.replace(/[^0-9+]/g, '').slice(0, 16))} placeholder="04121234567" inputMode="tel" className="w-full bg-[#0F1014] border border-white/10 rounded-xl px-4 py-3 text-sm" />
                </section>

                <section className="bg-[#1A1F2E] rounded-3xl p-5 border border-white/5 space-y-3">
                    <div className="flex gap-2">
                        <input value={promoCode} onChange={(event) => setPromoCode(event.target.value.toUpperCase())} placeholder="Código promocional" className="flex-1 min-w-0 bg-[#0F1014] border border-white/10 rounded-xl px-4 py-3 text-sm font-mono uppercase" />
                        <button type="button" onClick={validatePromo} disabled={validatingPromo || !promoCode.trim()} className="px-4 rounded-xl bg-violet-600 font-bold text-sm disabled:opacity-50">{validatingPromo ? '…' : 'Aplicar'}</button>
                    </div>
                    {serverQuote?.promoValid && <div className="flex justify-between text-sm text-emerald-300"><span>{serverQuote.promoCode}</span><span>-{money(serverQuote.discount)}</span></div>}
                </section>

                <p className="text-[10px] text-center text-gray-600">La tarifa y la promoción se verifican nuevamente en el servidor al confirmar.</p>

                <button onClick={handleConfirm} disabled={loading || quoteLoading || validatingPromo} className="w-full py-4 rounded-2xl bg-blue-600 hover:bg-blue-500 font-black text-lg shadow-lg shadow-blue-600/20 disabled:opacity-50">
                    {loading ? 'Confirmando…' : quoteLoading ? 'Calculando ruta…' : serverQuote ? `Confirmar por ${money(finalPrice)}` : 'Reintentar cotización'}
                </button>
            </main>
        </div>
    );
}
