import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../services/supabase';

const MODE_META = {
    legacy: {
        title: 'Legado',
        detail: 'Solo cobra la fórmula anterior. El modelo V4 queda desactivado.',
        tone: 'text-gray-300 border-white/10 bg-white/5',
    },
    shadow: {
        title: 'Sombra',
        detail: 'Calcula V4 para análisis, pero cobra la fórmula anterior.',
        tone: 'text-blue-300 border-blue-500/30 bg-blue-500/10',
    },
    pilot: {
        title: 'Piloto',
        detail: 'Aplica V4 a un porcentaje estable de pasajeros.',
        tone: 'text-amber-300 border-amber-500/30 bg-amber-500/10',
    },
    active: {
        title: 'Activo',
        detail: 'Aplica V4 a todos los viajes nuevos.',
        tone: 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10',
    },
};

const money = (value) => `$${Number(value || 0).toFixed(2)}`;

export default function PricingRolloutPanel() {
    const [config, setConfig] = useState(null);
    const [draft, setDraft] = useState(null);
    const [auditRows, setAuditRows] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState(null);

    const load = async () => {
        setLoading(true);
        const [{ data: rollout, error: rolloutError }, { data: audit }] = await Promise.all([
            supabase.from('pricing_rollout_config').select('*').eq('id', 1).maybeSingle(),
            supabase
                .from('pricing_quote_audit')
                .select('rollout_mode,model_applied,legacy_subtotal,model_subtotal,charged_subtotal,created_at')
                .order('created_at', { ascending: false })
                .limit(100),
        ]);
        if (rolloutError) {
            setMessage({ type: 'error', text: `No se pudo cargar el rollout: ${rolloutError.message}` });
        } else if (rollout) {
            setConfig(rollout);
            setDraft({
                mode: rollout.mode,
                pilot_percentage: Number(rollout.pilot_percentage || 0),
                maximum_multiplier: Number(rollout.maximum_multiplier || 1.3),
                notes: rollout.notes || '',
            });
        }
        setAuditRows(audit || []);
        setLoading(false);
    };

    useEffect(() => { void load(); }, []);

    const metrics = useMemo(() => {
        if (!auditRows.length) return null;
        const deltas = auditRows.map((row) => Number(row.model_subtotal || 0) - Number(row.legacy_subtotal || 0));
        const averageDelta = deltas.reduce((sum, value) => sum + value, 0) / deltas.length;
        const raised = deltas.filter((value) => value > 0.009).length;
        const modelApplied = auditRows.filter((row) => row.model_applied).length;
        return {
            samples: auditRows.length,
            averageDelta,
            raisedPercentage: raised / auditRows.length * 100,
            modelApplied,
        };
    }, [auditRows]);

    const save = async () => {
        if (!draft || saving) return;
        if (draft.mode === 'pilot' && (draft.pilot_percentage <= 0 || draft.pilot_percentage > 100)) {
            setMessage({ type: 'error', text: 'El piloto debe usar un porcentaje entre 1 y 100.' });
            return;
        }
        if (draft.maximum_multiplier < 1 || draft.maximum_multiplier > 3) {
            setMessage({ type: 'error', text: 'El multiplicador máximo debe estar entre 1.00 y 3.00.' });
            return;
        }
        if (draft.mode === 'active' && !window.confirm('¿Activar Pricing V4 para todos los viajes nuevos? Revisa primero las métricas del modo sombra o piloto.')) return;

        setSaving(true);
        setMessage(null);
        const { data, error } = await supabase.rpc('admin_update_pricing_rollout', {
            p_mode: draft.mode,
            p_pilot_percentage: draft.mode === 'pilot' ? Number(draft.pilot_percentage) : 0,
            p_maximum_multiplier: Number(draft.maximum_multiplier),
            p_notes: draft.notes || null,
        });
        if (error) {
            setMessage({ type: 'error', text: `No se pudo guardar: ${error.message}` });
        } else {
            const next = Array.isArray(data) ? data[0] : data;
            setConfig(next || { ...config, ...draft });
            setMessage({ type: 'success', text: 'Configuración de rollout actualizada.' });
            await load();
        }
        setSaving(false);
    };

    if (loading || !draft) {
        return <div className="mt-10 rounded-3xl border border-white/5 bg-[#1A1F2E] p-8 text-center text-gray-400">Cargando control de rollout…</div>;
    }

    const modeMeta = MODE_META[config?.mode] || MODE_META.shadow;

    return (
        <section className="mt-10 bg-[#1A1F2E] rounded-3xl border border-white/5 overflow-hidden shadow-2xl">
            <div className="p-5 border-b border-white/5 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                    <h2 className="font-black text-xl flex items-center gap-2">
                        <span className="material-symbols-outlined text-violet-400">experiment</span>
                        Despliegue controlado de Pricing V4
                    </h2>
                    <p className="text-sm text-gray-400 mt-1">Evita cambiar todos los precios sin medir primero el impacto real.</p>
                </div>
                <div className={`px-4 py-2 rounded-xl border text-sm font-black ${modeMeta.tone}`}>
                    Estado actual: {modeMeta.title}
                </div>
            </div>

            <div className="p-5 grid xl:grid-cols-[1.1fr_.9fr] gap-6">
                <div>
                    <div className="grid sm:grid-cols-2 gap-3">
                        {Object.entries(MODE_META).map(([mode, meta]) => (
                            <button
                                key={mode}
                                type="button"
                                onClick={() => setDraft((current) => ({ ...current, mode }))}
                                className={`text-left p-4 rounded-2xl border transition ${draft.mode === mode ? meta.tone : 'border-white/10 bg-[#0F1014] text-gray-400'}`}
                            >
                                <strong className="block text-sm">{meta.title}</strong>
                                <span className="block text-xs mt-1 opacity-80">{meta.detail}</span>
                            </button>
                        ))}
                    </div>

                    <div className="grid sm:grid-cols-2 gap-4 mt-4">
                        <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                            Porcentaje del piloto
                            <input
                                type="number" min="0" max="100" step="1"
                                disabled={draft.mode !== 'pilot'}
                                value={draft.pilot_percentage}
                                onChange={(event) => setDraft((current) => ({ ...current, pilot_percentage: Number(event.target.value) }))}
                                className="mt-1 w-full p-3 rounded-xl bg-[#0F1014] border border-white/10 text-white normal-case disabled:opacity-40"
                            />
                        </label>
                        <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                            Multiplicador máximo
                            <input
                                type="number" min="1" max="3" step="0.05"
                                value={draft.maximum_multiplier}
                                onChange={(event) => setDraft((current) => ({ ...current, maximum_multiplier: Number(event.target.value) }))}
                                className="mt-1 w-full p-3 rounded-xl bg-[#0F1014] border border-white/10 text-white normal-case"
                            />
                        </label>
                    </div>

                    <label className="block mt-4 text-xs font-bold text-gray-400 uppercase tracking-wider">
                        Motivo o notas del cambio
                        <textarea
                            rows="3"
                            value={draft.notes}
                            onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))}
                            className="mt-1 w-full p-3 rounded-xl bg-[#0F1014] border border-white/10 text-white normal-case resize-y"
                            placeholder="Ej.: piloto nocturno en Higuerote durante 7 días"
                        />
                    </label>

                    {message && (
                        <div className={`mt-4 p-3 rounded-xl text-sm border ${message.type === 'success' ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30' : 'text-rose-300 bg-rose-500/10 border-rose-500/30'}`}>
                            {message.text}
                        </div>
                    )}

                    <button type="button" disabled={saving} onClick={() => void save()} className="mt-4 w-full py-3 rounded-xl bg-violet-600 hover:bg-violet-500 font-black disabled:opacity-50">
                        {saving ? 'Guardando…' : 'Guardar rollout'}
                    </button>
                </div>

                <aside className="rounded-2xl bg-[#0F1014] border border-white/10 p-5">
                    <h3 className="font-black">Métricas de las últimas cotizaciones</h3>
                    {!metrics ? (
                        <p className="mt-4 text-sm text-gray-500">Todavía no hay viajes creados con la auditoría V4.</p>
                    ) : (
                        <div className="mt-4 grid grid-cols-2 gap-3">
                            <div className="p-3 rounded-xl bg-white/5"><span className="block text-xs text-gray-500">Muestras</span><strong className="text-xl">{metrics.samples}</strong></div>
                            <div className="p-3 rounded-xl bg-white/5"><span className="block text-xs text-gray-500">V4 aplicado</span><strong className="text-xl">{metrics.modelApplied}</strong></div>
                            <div className="p-3 rounded-xl bg-white/5"><span className="block text-xs text-gray-500">Diferencia media</span><strong className={`text-xl ${metrics.averageDelta > 0 ? 'text-amber-300' : 'text-emerald-300'}`}>{money(metrics.averageDelta)}</strong></div>
                            <div className="p-3 rounded-xl bg-white/5"><span className="block text-xs text-gray-500">Cotizaciones que suben</span><strong className="text-xl">{metrics.raisedPercentage.toFixed(0)}%</strong></div>
                        </div>
                    )}
                    <div className="mt-4 p-3 rounded-xl bg-blue-500/10 border border-blue-500/20 text-xs text-blue-200">
                        El modo sombra registra el precio V4, pero mantiene el cobro anterior. Es el estado recomendado hasta contar con datos suficientes.
                    </div>
                </aside>
            </div>
        </section>
    );
}
