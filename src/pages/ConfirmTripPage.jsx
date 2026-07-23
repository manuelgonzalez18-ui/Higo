import React, { useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import InteractiveMap from '../components/InteractiveMap';
import { supabase } from '../services/supabase';
import { createClientRequestId, createRideRequest, quoteRide } from '../services/rideApi';
import { FEATURES } from '../config/features';
import { toast } from '../components/Toast';
import { friendlyError } from '../utils/friendlyError';
import { logger } from '../utils/logger';

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

const timeoutAfter = (milliseconds) => new Promise((_, reject) => {
    setTimeout(() => reject(new Error('La conexión tardó demasiado. Revisá tu internet e intentá nuevamente.')), milliseconds);
});

const money = (value) => `$${Number(value || 0).toFixed(2)}`;

export default function ConfirmTripPage() {
    const navigate = useNavigate();
    const location = useLocation();
    const clientRequestIdRef = useRef(createClientRequestId());

    const {
        pickup,
        dropoff,
        price,
        selectedRide = 'standard',
        pickupCoords,
        dropoffCoords,
        serviceType = 'ride',
        deliveryData = null,
        stops = [],
        roadDistance = null,
    } = location.state || {};

    const [loading, setLoading] = useState(false);
    const [passengerPhone, setPassengerPhone] = useState('');
    const [promoCode, setPromoCode] = useState('');
    const [appliedPromo, setAppliedPromo] = useState(null);
    const [validatingPromo, setValidatingPromo] = useState(false);

    const isDelivery = serviceType === 'delivery';
    const vehicle = VEHICLE_INFO[selectedRide] || VEHICLE_INFO.standard;
    const vehicleDetails = useMemo(() => ({
        ...vehicle,
        seats: isDelivery
            ? selectedRide === 'moto' ? 'Máx. 4 kg' : selectedRide === 'van' ? 'Máx. 100 kg' : 'Máx. 40 kg'
            : vehicle.seats,
    }), [vehicle, isDelivery, selectedRide]);
    const finalPrice = appliedPromo?.finalPrice ?? Number(price || 0);

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

    const validatePromoLegacy = async (code) => {
        const { data: promo, error } = await supabase
            .from('promo_codes')
            .select('id, code, discount_type, discount_value, min_ride_amount, expires_at, max_uses, used_count')
            .eq('code', code)
            .eq('active', true)
            .maybeSingle();
        if (error || !promo) throw new Error('Código inválido o inactivo.');
        if (promo.expires_at && new Date(promo.expires_at) < new Date()) throw new Error('El código ha expirado.');
        if (promo.max_uses != null && promo.used_count >= promo.max_uses) throw new Error('El código alcanzó su límite de usos.');
        if (Number(price || 0) < Number(promo.min_ride_amount || 0)) throw new Error(`El viaje debe ser de al menos ${money(promo.min_ride_amount)}.`);
        const discount = promo.discount_type === 'percent'
            ? Number(price || 0) * Number(promo.discount_value || 0) / 100
            : Math.min(Number(promo.discount_value || 0), Number(price || 0));
        return {
            id: promo.id,
            code: promo.code,
            discount: Number(discount.toFixed(2)),
            finalPrice: Number(Math.max(Number(price || 0) - discount, 0).toFixed(2)),
        };
    };

    const validatePromo = async () => {
        const code = promoCode.trim().toUpperCase();
        if (!code || validatingPromo) return;
        setValidatingPromo(true);
        try {
            if (FEATURES.serverSideRidePricing) {
                const quote = await quoteRide({
                    pickupCoords,
                    dropoffCoords,
                    vehicleType: selectedRide,
                    serviceType,
                    routeDistanceKm: roadDistance ? Number(roadDistance) / 1000 : null,
                    stopsCount: Array.isArray(stops) ? stops.length : 0,
                    promoCode: code,
                    clientSubtotalFloor: Number(price || 0),
                });
                if (!quote?.promoValid) {
                    throw new Error(PROMO_ERRORS[quote?.promoError] || 'El código no se puede aplicar.');
                }
                setAppliedPromo({
                    id: quote.promoId,
                    code: quote.promoCode,
                    discount: Number(quote.discount || 0),
                    finalPrice: Number(quote.finalPrice || 0),
                    serverQuote: quote,
                });
            } else {
                setAppliedPromo(await validatePromoLegacy(code));
            }
            toast.success('Promoción aplicada.');
        } catch (error) {
            setAppliedPromo(null);
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

    const createLegacyRide = async (session) => {
        const payload = {
            user_id: session.user.id,
            pickup,
            dropoff,
            price: finalPrice,
            ride_type: selectedRide,
            status: 'requested',
            payment_method: 'direct',
            passenger_phone: passengerPhone || null,
            pickup_lat: pickupCoords.lat,
            pickup_lng: pickupCoords.lng,
            dropoff_lat: dropoffCoords.lat,
            dropoff_lng: dropoffCoords.lng,
            service_type: serviceType,
            delivery_info: deliveryData,
            payer: deliveryData?.payer || (isDelivery ? 'sender' : null),
            cod_amount: isDelivery && deliveryData?.cod_amount ? Number(deliveryData.cod_amount) : null,
            cod_currency: isDelivery && deliveryData?.cod_amount ? 'USD' : null,
        };
        const { data, error } = await supabase.from('rides').insert([payload]).select().single();
        if (error) throw error;

        if (isDelivery && deliveryData?.terms_version) {
            await supabase.from('terms_acceptances').insert({
                user_id: session.user.id,
                terms_kind: 'delivery',
                terms_version: deliveryData.terms_version,
                accepted_at: deliveryData.terms_accepted_at || new Date().toISOString(),
                ride_id: data.id,
            });
        }
        if (appliedPromo) {
            const { error: promoError } = await supabase.rpc('apply_promo_code', {
                p_code: appliedPromo.code,
                p_ride_id: data.id,
                p_user_id: session.user.id,
                p_ride_amount: Number(price || 0),
            });
            if (promoError) {
                await supabase.from('rides').update({ price: Number(price || 0) }).eq('id', data.id);
                throw new Error('La promoción cambió mientras confirmabas. Volvé a intentarlo.');
            }
        }
        return { rideId: data.id, price: data.price, status: data.status };
    };

    const handleConfirm = async () => {
        if (loading) return;
        setLoading(true);
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) {
                navigate('/auth');
                return;
            }

            toast.info('Enviando solicitud a Higo…');
            const creation = FEATURES.serverSideRidePricing
                ? await Promise.race([
                    createRideRequest({
                        clientRequestId: clientRequestIdRef.current,
                        pickup,
                        dropoff,
                        pickupCoords,
                        dropoffCoords,
                        vehicleType: selectedRide,
                        serviceType,
                        routeDistanceKm: roadDistance ? Number(roadDistance) / 1000 : null,
                        stops,
                        promoCode: appliedPromo?.code || null,
                        passengerPhone,
                        deliveryInfo: deliveryData,
                        payer: deliveryData?.payer || (isDelivery ? 'sender' : null),
                        codAmount: deliveryData?.cod_amount || null,
                        termsVersion: deliveryData?.terms_version || null,
                        clientSubtotalFloor: Number(price || 0),
                    }),
                    timeoutAfter(20000),
                ])
                : await Promise.race([createLegacyRide(session), timeoutAfter(20000)]);

            const rideId = creation?.rideId || creation?.id;
            if (!rideId) throw new Error('El servidor no devolvió el identificador del viaje.');
            await saveRecipientContact(session, rideId);
            toast.success(creation?.idempotentReplay ? 'Solicitud recuperada correctamente.' : 'Solicitud enviada. Buscando conductores…');
            navigate(`/ride/${rideId}`, { replace: true });
        } catch (error) {
            logger.error('[ConfirmTrip] create ride failed', error);
            toast.error(friendlyError(error, 'No se pudo solicitar el viaje. Probá de nuevo.', {
                source: 'ConfirmTripPage.handleConfirm',
                clientRequestId: clientRequestIdRef.current,
            }));
        } finally {
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
                    <p className="text-2xl font-black">{money(finalPrice)}</p>
                </section>

                <section className="bg-[#1A1F2E] rounded-3xl p-5 border border-white/5 space-y-3">
                    <label className="text-xs font-bold text-gray-400">Teléfono de contacto (opcional)</label>
                    <input value={passengerPhone} onChange={(event) => setPassengerPhone(event.target.value.replace(/[^0-9+]/g, '').slice(0, 16))} placeholder="04121234567" inputMode="tel" className="w-full bg-[#0F1014] border border-white/10 rounded-xl px-4 py-3 text-sm" />
                </section>

                <section className="bg-[#1A1F2E] rounded-3xl p-5 border border-white/5 space-y-3">
                    <div className="flex gap-2">
                        <input value={promoCode} onChange={(event) => { setPromoCode(event.target.value.toUpperCase()); setAppliedPromo(null); }} placeholder="Código promocional" className="flex-1 min-w-0 bg-[#0F1014] border border-white/10 rounded-xl px-4 py-3 text-sm font-mono uppercase" />
                        <button type="button" onClick={validatePromo} disabled={validatingPromo || !promoCode.trim()} className="px-4 rounded-xl bg-violet-600 font-bold text-sm disabled:opacity-50">{validatingPromo ? '…' : 'Aplicar'}</button>
                    </div>
                    {appliedPromo && <div className="flex justify-between text-sm text-emerald-300"><span>{appliedPromo.code}</span><span>-{money(appliedPromo.discount)}</span></div>}
                </section>

                {FEATURES.serverSideRidePricing && <p className="text-[10px] text-center text-gray-600">La tarifa y la promoción se verifican nuevamente en el servidor al confirmar.</p>}

                <button onClick={handleConfirm} disabled={loading} className="w-full py-4 rounded-2xl bg-blue-600 hover:bg-blue-500 font-black text-lg shadow-lg shadow-blue-600/20 disabled:opacity-50">
                    {loading ? 'Confirmando…' : `Confirmar por ${money(finalPrice)}`}
                </button>
            </main>
        </div>
    );
}
