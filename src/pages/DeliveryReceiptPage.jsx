import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabase';

// E4.2 — recibo descargable del envío.
//
// Render como HTML imprimible. window.print() del navegador genera el
// PDF (Save as PDF en Chrome/Safari/Edge), idéntico para el usuario
// final que descargar un PDF generado en server, sin necesidad de
// dompdf/TCPDF en Hostinger (que requeriría composer + dependencias).
//
// La fila en delivery_receipts (mig 56) se crea automáticamente por
// trigger al pasar status a 'completed'. Acá solo la leemos.

const fmtDate = (d) => d ? new Date(d).toLocaleString('es-VE', { dateStyle: 'long', timeStyle: 'short' }) : '—';
const fmtMoney = (n, ccy = 'USD') => `${ccy} ${Number(n || 0).toFixed(2)}`;

const DeliveryReceiptPage = () => {
    const { rideId } = useParams();
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [ride, setRide] = useState(null);
    const [receipt, setReceipt] = useState(null);
    const [sender, setSender] = useState(null);
    const [driver, setDriver] = useState(null);
    const [pickupUrl, setPickupUrl] = useState(null);
    const [deliveryUrl, setDeliveryUrl] = useState(null);

    useEffect(() => {
        let cancelled = false;

        (async () => {
            try {
                const { data: rRow, error: rErr } = await supabase
                    .from('rides')
                    .select('*')
                    .eq('id', rideId)
                    .single();
                if (rErr) throw rErr;
                if (cancelled) return;
                if (rRow.service_type !== 'delivery') {
                    setError('Este recibo solo está disponible para envíos.');
                    setLoading(false);
                    return;
                }
                if (rRow.status !== 'completed') {
                    setError('El recibo se genera al completarse el envío.');
                    setLoading(false);
                    return;
                }
                setRide(rRow);

                const [{ data: receiptRow }, { data: senderRow }, { data: driverRow }] = await Promise.all([
                    supabase.from('delivery_receipts').select('*').eq('ride_id', rideId).maybeSingle(),
                    supabase.from('profiles').select('full_name,phone').eq('id', rRow.user_id).maybeSingle(),
                    rRow.driver_id
                        ? supabase.from('profiles').select('full_name,phone,license_plate,vehicle_model,vehicle_color').eq('id', rRow.driver_id).maybeSingle()
                        : Promise.resolve({ data: null }),
                ]);
                if (cancelled) return;
                setReceipt(receiptRow);
                setSender(senderRow);
                setDriver(driverRow);

                // Signed URLs de las POD photos (1h)
                const sign = async (path) => {
                    if (!path) return null;
                    const { data } = await supabase.storage.from('delivery-pods').createSignedUrl(path, 3600);
                    return data?.signedUrl || null;
                };
                const [pu, du] = await Promise.all([sign(rRow.pickup_pod_url), sign(rRow.delivery_pod_url)]);
                if (cancelled) return;
                setPickupUrl(pu);
                setDeliveryUrl(du);
                setLoading(false);
            } catch (err) {
                console.error(err);
                if (!cancelled) {
                    setError(err.message || 'Error cargando el recibo.');
                    setLoading(false);
                }
            }
        })();

        return () => { cancelled = true; };
    }, [rideId]);

    const handlePrint = () => window.print();

    if (loading) {
        return (
            <div className="min-h-screen bg-white flex items-center justify-center">
                <div className="w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }
    if (error) {
        return (
            <div className="min-h-screen bg-gray-100 flex items-center justify-center p-6">
                <div className="bg-red-50 border border-red-200 rounded-2xl p-6 max-w-md text-center">
                    <span className="material-symbols-outlined text-red-600 text-4xl">error</span>
                    <p className="text-red-700 mt-2">{error}</p>
                    <button onClick={() => navigate(-1)} className="mt-4 px-4 py-2 bg-gray-700 text-white rounded-lg text-sm font-bold">
                        Volver
                    </button>
                </div>
            </div>
        );
    }

    const dInfo = ride.delivery_info || {};
    const total = Number(ride.price || 0);
    const cod   = Number(ride.cod_amount || 0);

    return (
        <div className="min-h-screen bg-gray-100 print:bg-white">
            {/* Toolbar (oculta al imprimir) */}
            <div className="print:hidden bg-white border-b border-gray-200 sticky top-0 z-10">
                <div className="max-w-3xl mx-auto px-4 py-3 flex justify-between items-center">
                    <button
                        onClick={() => navigate(-1)}
                        className="flex items-center gap-2 text-gray-700 hover:text-black text-sm font-bold"
                    >
                        <span className="material-symbols-outlined">arrow_back</span>
                        Volver
                    </button>
                    <button
                        onClick={handlePrint}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2 rounded-full text-sm font-bold flex items-center gap-2"
                    >
                        <span className="material-symbols-outlined">picture_as_pdf</span>
                        Descargar PDF
                    </button>
                </div>
            </div>

            {/* Hoja del recibo */}
            <div className="max-w-3xl mx-auto p-4 sm:p-8 print:p-0">
                <div className="bg-white shadow-lg print:shadow-none rounded-2xl print:rounded-none p-6 sm:p-10">
                    {/* Header */}
                    <div className="flex justify-between items-start border-b-2 border-gray-900 pb-5 mb-6">
                        <div>
                            <h1 className="text-2xl font-extrabold text-gray-900">Higo Envíos</h1>
                            <p className="text-xs text-gray-500 mt-1">Plataforma de intermediación tecnológica</p>
                        </div>
                        <div className="text-right">
                            <p className="text-xs text-gray-500 uppercase font-bold">Comprobante</p>
                            <p className="text-2xl font-mono font-extrabold text-gray-900">
                                #{receipt?.receipt_number ?? ride.id}
                            </p>
                            <p className="text-[11px] text-gray-500 mt-0.5">
                                Generado: {fmtDate(receipt?.generated_at || ride.delivered_at)}
                            </p>
                        </div>
                    </div>

                    {/* Partes */}
                    <div className="grid grid-cols-2 gap-6 mb-6">
                        <div>
                            <p className="text-[10px] uppercase font-bold text-gray-500 mb-1">Remitente</p>
                            <p className="text-sm font-bold text-gray-900">{dInfo.senderName || sender?.full_name || '—'}</p>
                            <p className="text-xs text-gray-600">{dInfo.senderPhone || sender?.phone || '—'}</p>
                        </div>
                        <div>
                            <p className="text-[10px] uppercase font-bold text-gray-500 mb-1">Destinatario</p>
                            <p className="text-sm font-bold text-gray-900">{dInfo.receiverName || '—'}</p>
                            <p className="text-xs text-gray-600">{dInfo.receiverPhone || '—'}</p>
                        </div>
                    </div>

                    {/* Ruta */}
                    <div className="bg-gray-50 rounded-xl p-4 mb-6">
                        <div className="flex items-start gap-3 mb-3">
                            <div className="w-3 h-3 rounded-full border-2 border-emerald-600 mt-1 shrink-0" />
                            <div className="flex-1">
                                <p className="text-[10px] uppercase font-bold text-gray-500">Origen</p>
                                <p className="text-sm text-gray-900">{ride.pickup}</p>
                            </div>
                        </div>
                        <div className="flex items-start gap-3">
                            <div className="w-3 h-3 rounded-full bg-red-600 mt-1 shrink-0" />
                            <div className="flex-1">
                                <p className="text-[10px] uppercase font-bold text-gray-500">Destino</p>
                                <p className="text-sm text-gray-900">{ride.dropoff}</p>
                            </div>
                        </div>
                    </div>

                    {/* Hitos */}
                    <div className="grid grid-cols-3 gap-3 mb-6">
                        <div className="border border-gray-200 rounded-lg p-3">
                            <p className="text-[9px] uppercase font-bold text-gray-500">Recogido</p>
                            <p className="text-xs text-gray-900 font-bold mt-1">{fmtDate(ride.picked_up_at)}</p>
                        </div>
                        <div className="border border-gray-200 rounded-lg p-3">
                            <p className="text-[9px] uppercase font-bold text-gray-500">En destino</p>
                            <p className="text-xs text-gray-900 font-bold mt-1">{fmtDate(ride.arrived_at_dropoff_at)}</p>
                        </div>
                        <div className="border border-emerald-200 bg-emerald-50 rounded-lg p-3">
                            <p className="text-[9px] uppercase font-bold text-emerald-700">Entregado</p>
                            <p className="text-xs text-gray-900 font-bold mt-1">{fmtDate(ride.delivered_at)}</p>
                        </div>
                    </div>

                    {/* Paquete */}
                    <div className="mb-6">
                        <p className="text-[10px] uppercase font-bold text-gray-500 mb-2">Paquete</p>
                        <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-900">
                            <p className="font-bold mb-1">{dInfo.package_description || '—'}</p>
                            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600 mt-2">
                                {dInfo.package_weight_kg && <span>Peso: <strong>{dInfo.package_weight_kg}</strong></span>}
                                {dInfo.package_value_usd != null && <span>Valor declarado: <strong>{fmtMoney(dInfo.package_value_usd)}</strong></span>}
                                {dInfo.category && dInfo.category !== 'normal' && <span>Categoría: <strong className="uppercase">{dInfo.category}</strong></span>}
                                {dInfo.is_fragile && <span className="text-red-600 font-bold">FRÁGIL</span>}
                            </div>
                        </div>
                    </div>

                    {/* Chofer */}
                    <div className="border-t border-gray-200 pt-5 mb-6">
                        <p className="text-[10px] uppercase font-bold text-gray-500 mb-2">Chofer asignado</p>
                        <div className="flex justify-between items-baseline">
                            <div>
                                <p className="text-sm font-bold text-gray-900">{driver?.full_name || '—'}</p>
                                <p className="text-xs text-gray-600">
                                    {driver?.vehicle_model || ''} {driver?.vehicle_color || ''}
                                </p>
                            </div>
                            <p className="text-sm font-mono font-bold text-gray-900">{driver?.license_plate || '—'}</p>
                        </div>
                    </div>

                    {/* Totales */}
                    <div className="border-t-2 border-gray-900 pt-5 mb-6">
                        <div className="flex justify-between items-center mb-2">
                            <p className="text-sm text-gray-600">Precio del envío</p>
                            <p className="text-sm font-bold text-gray-900">{fmtMoney(total, receipt?.currency || 'USD')}</p>
                        </div>
                        {cod > 0 && (
                            <div className="flex justify-between items-center mb-2">
                                <p className="text-sm text-gray-600">
                                    Cobro contra entrega (efectivo)
                                    {ride.cod_collected ? <span className="text-emerald-600 text-xs ml-2">✓ cobrado</span> : <span className="text-amber-600 text-xs ml-2">⌛ pendiente</span>}
                                </p>
                                <p className="text-sm font-bold text-gray-900">{fmtMoney(cod, ride.cod_currency || 'USD')}</p>
                            </div>
                        )}
                        <div className="flex justify-between items-center pt-3 border-t border-gray-200 mt-3">
                            <p className="text-base font-bold text-gray-900">Total</p>
                            <p className="text-2xl font-extrabold text-emerald-600">{fmtMoney(total + cod, 'USD')}</p>
                        </div>
                    </div>

                    {/* Fotos POD */}
                    {(pickupUrl || deliveryUrl) && (
                        <div className="mb-6">
                            <p className="text-[10px] uppercase font-bold text-gray-500 mb-3">Prueba de entrega</p>
                            <div className="grid grid-cols-2 gap-3">
                                {pickupUrl && (
                                    <div>
                                        <img src={pickupUrl} alt="POD pickup" className="w-full h-48 object-cover rounded-lg border border-gray-200" crossOrigin="anonymous" />
                                        <p className="text-[10px] text-center text-gray-500 mt-1 font-bold uppercase">Pickup</p>
                                    </div>
                                )}
                                {deliveryUrl && (
                                    <div>
                                        <img src={deliveryUrl} alt="POD delivery" className="w-full h-48 object-cover rounded-lg border border-gray-200" crossOrigin="anonymous" />
                                        <p className="text-[10px] text-center text-gray-500 mt-1 font-bold uppercase">Entrega</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Footer legal */}
                    <div className="text-[10px] text-gray-500 leading-relaxed border-t border-gray-200 pt-4">
                        <p className="mb-2">
                            <strong>Higo es plataforma de intermediación tecnológica</strong>, no transportista
                            ni aseguradora. El chofer es contratista independiente y es responsable de la
                            mercadería desde el pickup hasta la entrega. El presente comprobante acredita la
                            operación realizada y los hitos registrados en la app.
                        </p>
                        <p>
                            Términos completos en higoapp.com/terms/envios · Soporte: soporte@higoapp.com · Legal: legal@higoapp.com
                        </p>
                    </div>
                </div>
            </div>

            <style>{`
                @media print {
                    @page { size: A4; margin: 12mm; }
                    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                }
            `}</style>
        </div>
    );
};

export default DeliveryReceiptPage;
