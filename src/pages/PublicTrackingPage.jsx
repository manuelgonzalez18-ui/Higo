import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../services/supabase';

const STATUS_LABELS = {
    requested: 'Buscando chofer',
    accepted: 'Chofer asignado',
    in_progress: 'En camino al destino',
    arrived_at_dropoff: 'Llegó al destino',
    completed: 'Entregado',
    cancelled: 'Cancelado',
};

const STATUS_PROGRESS = {
    requested: 10,
    accepted: 30,
    in_progress: 55,
    arrived_at_dropoff: 80,
    completed: 100,
    cancelled: 0,
};

const formatTs = (ts) => ts ? new Date(ts).toLocaleString('es-VE', { dateStyle: 'short', timeStyle: 'short' }) : null;

const PublicTrackingPage = () => {
    const { token } = useParams();
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);
    const [podSignedUrl, setPodSignedUrl] = useState(null);

    useEffect(() => {
        let cancelled = false;

        const fetchTracking = async () => {
            const { data: rows, error } = await supabase.rpc('get_public_tracking', { p_token: token });
            if (cancelled) return;
            if (error || !rows || rows.length === 0) {
                setError('Link de tracking inválido o expirado.');
                return;
            }
            setData(rows[0]);
            setError(null);

            // If delivered, get signed URL for POD photo
            if (rows[0].delivery_pod_url) {
                const { data: signed } = await supabase.storage
                    .from('delivery-pods')
                    .createSignedUrl(rows[0].delivery_pod_url, 3600);
                if (!cancelled && signed?.signedUrl) setPodSignedUrl(signed.signedUrl);
            }
        };

        fetchTracking();
        const interval = setInterval(fetchTracking, 15000);
        return () => { cancelled = true; clearInterval(interval); };
    }, [token]);

    if (error) {
        return (
            <div className="min-h-screen bg-[#0a101f] text-white flex items-center justify-center p-6">
                <div className="bg-red-500/10 border border-red-500/30 p-6 rounded-2xl max-w-md text-center">
                    <span className="material-symbols-outlined text-red-400 text-4xl">link_off</span>
                    <h1 className="text-xl font-bold mt-2">Link no válido</h1>
                    <p className="text-gray-300 mt-2">{error}</p>
                </div>
            </div>
        );
    }

    if (!data) {
        return (
            <div className="min-h-screen bg-[#0a101f] text-white flex items-center justify-center">
                <p className="text-gray-400">Cargando...</p>
            </div>
        );
    }

    const progress = STATUS_PROGRESS[data.status] ?? 0;

    return (
        <div className="min-h-screen bg-[#0a101f] text-white">
            <div className="max-w-md mx-auto px-6 py-10">
                <div className="flex items-center gap-2 mb-1">
                    <span className="material-symbols-outlined text-emerald-400 text-2xl">inventory_2</span>
                    <h1 className="text-2xl font-extrabold">Higo Envíos</h1>
                </div>
                <p className="text-gray-400 text-sm mb-8">Seguimiento en vivo</p>

                <div className="bg-[#1A1F2E] rounded-2xl p-5 border border-white/5 mb-6">
                    <p className="text-emerald-400 text-xs font-bold uppercase mb-1">Estado</p>
                    <h2 className="text-xl font-bold">{STATUS_LABELS[data.status] || data.status}</h2>

                    <div className="w-full h-2 bg-gray-700 rounded-full mt-4 overflow-hidden">
                        <div
                            className={`h-full transition-all duration-700 ${data.status === 'cancelled' ? 'bg-red-500' : 'bg-emerald-500'}`}
                            style={{ width: `${progress}%` }}
                        />
                    </div>
                </div>

                <div className="bg-[#1A1F2E] rounded-2xl p-5 border border-white/5 mb-6">
                    <p className="text-gray-400 text-xs font-bold uppercase mb-2">Origen</p>
                    <p className="text-white font-semibold">{data.pickup}</p>

                    <p className="text-gray-400 text-xs font-bold uppercase mt-4 mb-2">Destino</p>
                    <p className="text-white font-semibold">{data.dropoff}</p>
                </div>

                {data.driver_display_name && (
                    <div className="bg-[#1A1F2E] rounded-2xl p-5 border border-white/5 mb-6">
                        <p className="text-gray-400 text-xs font-bold uppercase mb-2">Chofer</p>
                        <p className="text-white font-semibold">{data.driver_display_name}</p>
                    </div>
                )}

                <div className="bg-[#1A1F2E] rounded-2xl p-5 border border-white/5 mb-6">
                    <p className="text-gray-400 text-xs font-bold uppercase mb-3">Hitos</p>
                    <ul className="space-y-2 text-sm">
                        {data.picked_up_at && (
                            <li className="flex justify-between">
                                <span className="text-gray-300">Paquete recogido</span>
                                <span className="text-gray-500">{formatTs(data.picked_up_at)}</span>
                            </li>
                        )}
                        {data.arrived_at_dropoff_at && (
                            <li className="flex justify-between">
                                <span className="text-gray-300">Llegada al destino</span>
                                <span className="text-gray-500">{formatTs(data.arrived_at_dropoff_at)}</span>
                            </li>
                        )}
                        {data.delivered_at && (
                            <li className="flex justify-between">
                                <span className="text-emerald-400 font-semibold">Entregado</span>
                                <span className="text-gray-500">{formatTs(data.delivered_at)}</span>
                            </li>
                        )}
                    </ul>
                </div>

                {podSignedUrl && (
                    <div className="bg-[#1A1F2E] rounded-2xl p-5 border border-white/5">
                        <p className="text-emerald-400 text-xs font-bold uppercase mb-3">Prueba de entrega</p>
                        <img src={podSignedUrl} alt="POD" className="rounded-xl w-full" />
                    </div>
                )}

                <p className="text-xs text-gray-500 mt-8 text-center">
                    Higo es plataforma de intermediación. El chofer es contratista independiente responsable de la mercadería.
                </p>
            </div>
        </div>
    );
};

export default PublicTrackingPage;
