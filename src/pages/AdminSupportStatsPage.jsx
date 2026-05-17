import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, getUserProfile } from '../services/supabase';
import AdminNav from '../components/AdminNav';

// Métricas del canal de soporte. Vista de solo lectura — todo lo
// que muestra viene del RPC support_stats(p_days) en una sola call.

const RANGES = [
    { id: 7,   label: '7 días' },
    { id: 30,  label: '30 días' },
    { id: 90,  label: '90 días' },
    { id: 365, label: '1 año' },
];

const fmtMins = (n) => {
    if (n == null) return '—';
    if (n < 60)   return `${n} min`;
    const h = Math.floor(n / 60);
    const m = Math.round(n - h * 60);
    return m ? `${h}h ${m}m` : `${h}h`;
};
const fmtHours = (n) => {
    if (n == null) return '—';
    if (n < 24) return `${n}h`;
    const d = Math.floor(n / 24);
    const h = Math.round(n - d * 24);
    return h ? `${d}d ${h}h` : `${d}d`;
};

// Escapa un valor para CSV: si contiene coma, comilla o newline lo
// envuelve en comillas y duplica las comillas internas (RFC 4180).
const csvEscape = (v) => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csvRow = (cells) => cells.map(csvEscape).join(',');

const downloadCsv = (stats, days) => {
    if (!stats) return;
    const today = new Date().toISOString().slice(0, 10);
    const lines = [];
    lines.push(`# Higo Soporte · Métricas`);
    lines.push(`# Rango: últimos ${days} días`);
    lines.push(`# Generado: ${today}`);
    lines.push('');

    lines.push('## KPIs');
    lines.push(csvRow(['Métrica', 'Valor']));
    lines.push(csvRow(['Primera respuesta · promedio (min)',  stats.first_response_avg_minutes]));
    lines.push(csvRow(['Primera respuesta · mediana (min)',   stats.first_response_median_minutes]));
    lines.push(csvRow(['Resolución · promedio (h)',           stats.resolution_avg_hours]));
    lines.push(csvRow(['Hilos cerrados (rango)',              stats.closed_count]));
    lines.push(csvRow(['Hilos abiertos (ahora)',              stats.open_count]));
    lines.push(csvRow(['Abiertos sin responder',              stats.open_unanswered]));
    lines.push('');

    lines.push('## Volumen diario');
    lines.push(csvRow(['Día', 'Total', 'Usuario', 'Equipo', 'Hilos nuevos']));
    (stats.volume_by_day || []).forEach(d => {
        lines.push(csvRow([d.day, d.msgs_total, d.msgs_user, d.msgs_admin, d.threads_opened]));
    });
    lines.push('');

    lines.push('## Top admins');
    lines.push(csvRow(['#', 'Nombre', 'Mensajes', 'Hilos']));
    (stats.top_admins || []).forEach((a, i) => {
        lines.push(csvRow([i + 1, a.full_name || '', a.msgs_sent, a.threads_replied]));
    });

    // BOM para que Excel detecte UTF-8 y los emojis del preview se vean bien.
    const blob = new Blob(['﻿', lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `higo-soporte-${days}d-${today}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
};

// Calcula delta% entre actual y previo. Devuelve null si previo es
// 0 o nulo (no podemos dividir, no mostramos pill).
const computeDelta = (cur, prev) => {
    if (cur == null || prev == null || prev === 0) return null;
    return Math.round(((cur - prev) / prev) * 100);
};

// Pill de variación. lowerIsBetter=true para tiempos (1ª respuesta,
// resolución): bajar es bueno (verde). Para counts (mensajes, hilos
// abiertos) la dirección depende del contexto — por defecto subir es
// neutro/informativo, no malo, así que usamos un tono neutro.
const DeltaPill = ({ delta, lowerIsBetter = false }) => {
    if (delta == null) return null;
    const isUp = delta > 0;
    const isFlat = delta === 0;
    let cls = 'bg-white/5 text-gray-400';
    if (!isFlat) {
        const good = lowerIsBetter ? !isUp : isUp;
        cls = good ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400';
    }
    const icon = isFlat ? 'remove' : (isUp ? 'arrow_upward' : 'arrow_downward');
    return (
        <span className={`inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${cls}`}>
            <span className="material-symbols-outlined text-[12px] leading-none">{icon}</span>
            {Math.abs(delta)}%
        </span>
    );
};

const Kpi = ({ icon, label, value, tone = 'violet', hint, delta, lowerIsBetter }) => {
    const tones = {
        violet: 'from-violet-600 to-fuchsia-600',
        sky:    'from-sky-500 to-cyan-500',
        rose:   'from-rose-500 to-pink-500',
        amber:  'from-amber-500 to-orange-500',
    };
    return (
        <div className="bg-[#1A1F2E] rounded-2xl border border-white/5 p-5">
            <div className="flex items-center gap-3 mb-3">
                <div className={`bg-gradient-to-br ${tones[tone]} p-2 rounded-xl`}>
                    <span className="material-symbols-outlined text-white text-[20px]">{icon}</span>
                </div>
                <p className="text-xs font-bold uppercase tracking-wider text-gray-400">{label}</p>
            </div>
            <div className="flex items-baseline gap-2">
                <p className="text-3xl font-black text-white">{value}</p>
                <DeltaPill delta={delta} lowerIsBetter={lowerIsBetter} />
            </div>
            {hint && <p className="text-[11px] text-gray-500 mt-1">{hint}</p>}
        </div>
    );
};

const AdminSupportStatsPage = () => {
    const navigate = useNavigate();
    const [authorized, setAuthorized] = useState(false);
    const [days, setDays] = useState(30);
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        (async () => {
            const profile = await getUserProfile();
            if (!profile || profile.role !== 'admin') {
                navigate('/');
                return;
            }
            setAuthorized(true);
        })();
    }, [navigate]);

    useEffect(() => {
        if (!authorized) return;
        let cancelled = false;
        setLoading(true);
        (async () => {
            const { data, error } = await supabase.rpc('support_stats', { p_days: days });
            if (cancelled) return;
            if (error) {
                console.error('support_stats falló:', error);
                setStats(null);
            } else {
                setStats(data);
            }
            setLoading(false);
        })();
        return () => { cancelled = true; };
    }, [authorized, days]);

    const maxMsgs = useMemo(() => {
        const v = stats?.volume_by_day || [];
        return Math.max(1, ...v.map(d => d.msgs_total));
    }, [stats]);

    if (!authorized) {
        return (
            <div className="min-h-screen bg-[#0F1014] flex items-center justify-center">
                <div className="w-8 h-8 border-4 border-violet-600 border-t-transparent rounded-full animate-spin"></div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#0F1014] p-4 md:p-8 font-sans text-white">
            <AdminNav />

            <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
                <div className="flex items-center gap-4">
                    <div className="bg-gradient-to-br from-violet-600 to-fuchsia-600 p-3 rounded-2xl shadow-lg shadow-violet-600/20">
                        <span className="material-symbols-outlined text-white text-2xl">monitoring</span>
                    </div>
                    <div>
                        <h1 className="text-2xl font-black tracking-tight text-white">Métricas de soporte</h1>
                        <p className="text-gray-400 text-sm font-medium">Tiempos de respuesta, volumen y top admins</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => downloadCsv(stats, days)}
                        disabled={!stats}
                        className="px-4 py-2 rounded-lg text-sm font-bold bg-violet-600 text-white hover:bg-violet-500 flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
                        title="Descargar todas las métricas en CSV"
                    >
                        <span className="material-symbols-outlined text-[18px]">download</span>
                        CSV
                    </button>
                    <button
                        onClick={() => navigate('/admin/support')}
                        className="px-4 py-2 rounded-lg text-sm font-bold bg-white/5 text-gray-300 hover:bg-white/10 flex items-center gap-1"
                    >
                        <span className="material-symbols-outlined text-[18px]">arrow_back</span>
                        Volver
                    </button>
                </div>
            </div>

            <div className="bg-[#1A1F2E] p-3 rounded-[20px] border border-white/5 mb-6 flex gap-2 overflow-x-auto">
                {RANGES.map(r => (
                    <button
                        key={r.id}
                        onClick={() => setDays(r.id)}
                        className={`px-4 py-2 rounded-lg font-bold text-sm whitespace-nowrap transition-all ${days === r.id
                            ? 'bg-[#2C3345] text-white shadow-lg'
                            : 'text-gray-500 hover:text-white hover:bg-white/5'}`}
                    >
                        {r.label}
                    </button>
                ))}
            </div>

            {loading ? (
                <div className="flex justify-center py-20">
                    <div className="w-8 h-8 border-4 border-violet-600 border-t-transparent rounded-full animate-spin"></div>
                </div>
            ) : !stats ? (
                <div className="text-center py-20 text-gray-500">No se pudieron cargar las métricas.</div>
            ) : (
                <>
                    <p className="text-[11px] text-gray-500 mb-2 ml-1">
                        Variaciones comparan contra los {days} días previos.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                        <Kpi
                            icon="schedule"
                            label="1ª respuesta · promedio"
                            value={fmtMins(stats.first_response_avg_minutes)}
                            tone="violet"
                            hint={stats.first_response_median_minutes != null ? `Mediana ${fmtMins(stats.first_response_median_minutes)}` : null}
                            delta={computeDelta(stats.first_response_avg_minutes, stats.previous?.first_response_avg_minutes)}
                            lowerIsBetter
                        />
                        <Kpi
                            icon="check_circle"
                            label="Resolución · promedio"
                            value={fmtHours(stats.resolution_avg_hours)}
                            tone="sky"
                            hint={`${stats.closed_count || 0} hilos cerrados`}
                            delta={computeDelta(stats.resolution_avg_hours, stats.previous?.resolution_avg_hours)}
                            lowerIsBetter
                        />
                        <Kpi
                            icon="mark_chat_unread"
                            label="Abiertos"
                            value={stats.open_count || 0}
                            tone="amber"
                            hint={`${stats.open_unanswered || 0} sin responder`}
                        />
                        <Kpi
                            icon="forum"
                            label="Mensajes (período)"
                            value={(stats.volume_by_day || []).reduce((a, d) => a + (d.msgs_total || 0), 0)}
                            tone="rose"
                            hint={`${(stats.volume_by_day || []).reduce((a, d) => a + (d.threads_opened || 0), 0)} hilos nuevos`}
                            delta={computeDelta(
                                (stats.volume_by_day || []).reduce((a, d) => a + (d.msgs_total || 0), 0),
                                stats.previous?.msgs_total
                            )}
                        />
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                        {/* Volumen diario */}
                        <div className="lg:col-span-2 bg-[#1A1F2E] rounded-[20px] border border-white/5 p-5">
                            <div className="flex items-center gap-2 mb-4">
                                <span className="material-symbols-outlined text-violet-400">bar_chart</span>
                                <h2 className="font-bold text-white">Volumen diario</h2>
                                <div className="ml-auto flex items-center gap-3 text-[11px]">
                                    <span className="flex items-center gap-1 text-gray-400">
                                        <span className="w-2 h-2 rounded-sm bg-violet-500"></span> Usuario
                                    </span>
                                    <span className="flex items-center gap-1 text-gray-400">
                                        <span className="w-2 h-2 rounded-sm bg-sky-500"></span> Equipo
                                    </span>
                                </div>
                            </div>
                            {(stats.volume_by_day || []).length === 0 ? (
                                <p className="text-gray-500 text-sm text-center py-10">Sin actividad en este rango.</p>
                            ) : (
                                <div className="space-y-1.5 max-h-[420px] overflow-y-auto pr-2">
                                    {stats.volume_by_day.map(d => {
                                        const wu = (d.msgs_user / maxMsgs) * 100;
                                        const wa = (d.msgs_admin / maxMsgs) * 100;
                                        return (
                                            <div key={d.day} className="flex items-center gap-3 text-xs">
                                                <span className="text-gray-400 w-20 shrink-0 font-mono">{d.day.slice(5)}</span>
                                                <div className="flex-1 h-5 bg-white/5 rounded-md overflow-hidden flex">
                                                    <div className="bg-violet-500 h-full" style={{ width: `${wu}%` }} title={`${d.msgs_user} del usuario`} />
                                                    <div className="bg-sky-500 h-full" style={{ width: `${wa}%` }} title={`${d.msgs_admin} del equipo`} />
                                                </div>
                                                <span className="text-gray-300 w-12 text-right tabular-nums">{d.msgs_total}</span>
                                                {d.threads_opened > 0 && (
                                                    <span className="text-[10px] text-amber-400 w-10 text-right tabular-nums" title="Hilos nuevos">+{d.threads_opened}</span>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        {/* Top admins */}
                        <div className="bg-[#1A1F2E] rounded-[20px] border border-white/5 p-5">
                            <div className="flex items-center gap-2 mb-4">
                                <span className="material-symbols-outlined text-violet-400">workspace_premium</span>
                                <h2 className="font-bold text-white">Top admins</h2>
                            </div>
                            {(stats.top_admins || []).length === 0 ? (
                                <p className="text-gray-500 text-sm text-center py-10">Sin actividad de admins.</p>
                            ) : (
                                <ol className="space-y-3">
                                    {stats.top_admins.map((a, i) => (
                                        <li key={a.admin_id} className="flex items-center gap-3">
                                            <span className="w-6 h-6 rounded-full bg-white/10 text-gray-300 text-xs font-bold flex items-center justify-center shrink-0">
                                                {i + 1}
                                            </span>
                                            <div className="min-w-0 flex-1">
                                                <p className="text-sm font-bold text-white truncate">
                                                    {a.full_name || <span className="italic text-gray-500">sin nombre</span>}
                                                </p>
                                                <p className="text-[11px] text-gray-400">
                                                    {a.msgs_sent} mensajes · {a.threads_replied} hilos
                                                </p>
                                            </div>
                                        </li>
                                    ))}
                                </ol>
                            )}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};

export default AdminSupportStatsPage;
