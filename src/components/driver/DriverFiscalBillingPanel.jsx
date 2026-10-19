import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../services/supabase';

const STATUS_LABELS = {
    awaiting_billing_data: 'Faltan datos fiscales',
    pending: 'Pendiente de emisión fiscal',
    processing: 'Emisión en proceso',
    issued: 'Emitida',
    failed: 'Requiere revisión',
    manual_review: 'Revisión administrativa',
};

const FIELD_CLASS = 'w-full rounded-xl bg-[#0F1014] border border-white/10 px-4 py-3 text-sm text-white';
const emptyBilling = { legal_name: '', fiscal_id: '', fiscal_address: '', email: '' };

export default function DriverFiscalBillingPanel({ driverId, driverName = '', driverEmail = '' }) {
    const [billing, setBilling] = useState(emptyBilling);
    const [invoices, setInvoices] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [notice, setNotice] = useState('');

    const load = useCallback(async () => {
        if (!driverId) return;
        setLoading(true);
        const [billingResult, invoicesResult] = await Promise.all([
            supabase.from('driver_billing_profiles')
                .select('legal_name, fiscal_id, fiscal_address, email')
                .eq('driver_id', driverId).maybeSingle(),
            supabase.from('membership_fiscal_invoices')
                .select('id, status, invoice_number, control_number, storage_path, created_at, issued_at, emailed_at')
                .eq('driver_id', driverId).order('created_at', { ascending: false }).limit(30),
        ]);
        if (billingResult.error || invoicesResult.error) {
            setNotice('No se pudo consultar la facturación. Intentá de nuevo.');
        } else {
            setBilling(billingResult.data || {
                legal_name: driverName,
                fiscal_id: '',
                fiscal_address: '',
                email: driverEmail,
            });
            setInvoices(invoicesResult.data || []);
        }
        setLoading(false);
    }, [driverId, driverName, driverEmail]);

    useEffect(() => { load(); }, [load]);

    const saveBilling = async (event) => {
        event.preventDefault();
        if (!driverId || saving) return;
        setSaving(true);
        setNotice('');
        const payload = Object.fromEntries(Object.entries(billing).map(([key, value]) => [key, value.trim()]));
        if (!payload.email.includes('@') || payload.legal_name.length < 2 ||
            payload.fiscal_id.length < 5 || payload.fiscal_address.length < 8) {
            setNotice('Completá el nombre, identificación fiscal, dirección y correo válidos.');
            setSaving(false);
            return;
        }
        const { error } = await supabase.from('driver_billing_profiles').upsert({
            driver_id: driverId,
            ...payload,
            updated_at: new Date().toISOString(),
        }, { onConflict: 'driver_id' });
        setSaving(false);
        if (error) {
            setNotice('No pudimos guardar los datos fiscales. Verificá los campos.');
            return;
        }
        await load();
        setNotice('Datos fiscales guardados. Las facturas pendientes podrán procesarse cuando se habilite la emisión.');
    };

    const openInvoice = async (storagePath) => {
        if (!storagePath) return;
        const { data, error } = await supabase.storage
            .from('membership-invoices').createSignedUrl(storagePath, 60);
        if (error || !data?.signedUrl) {
            setNotice('No se pudo abrir la factura. Intentá de nuevo.');
            return;
        }
        window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
    };

    return (
        <section className="bg-[#1A1F2E] rounded-3xl p-5 space-y-5" aria-label="Facturación de membresías">
            <div>
                <h2 className="font-black">Datos fiscales y mis facturas</h2>
                <p className="text-xs text-gray-400 mt-1">
                    Indicá los datos del titular de la factura. Un comprobante bancario no sustituye la factura fiscal.
                </p>
            </div>
            {loading ? <p className="text-sm text-gray-400">Consultando datos fiscales…</p> : (
                <form onSubmit={saveBilling} className="space-y-3">
                    <label className="block text-xs text-gray-300">
                        Nombre o razón social
                        <input className={FIELD_CLASS + ' mt-1'} required minLength={2} maxLength={200}
                            value={billing.legal_name}
                            onChange={(event) => setBilling({ ...billing, legal_name: event.target.value })} />
                    </label>
                    <label className="block text-xs text-gray-300">
                        Cédula o RIF (con prefijo)
                        <input className={FIELD_CLASS + ' mt-1'} required minLength={5} maxLength={30}
                            placeholder="V-12345678 / J-123456789"
                            value={billing.fiscal_id}
                            onChange={(event) => setBilling({ ...billing, fiscal_id: event.target.value })} />
                    </label>
                    <label className="block text-xs text-gray-300">
                        Dirección fiscal
                        <textarea className={FIELD_CLASS + ' mt-1'} required minLength={8} maxLength={500}
                            rows={2} value={billing.fiscal_address}
                            onChange={(event) => setBilling({ ...billing, fiscal_address: event.target.value })} />
                    </label>
                    <label className="block text-xs text-gray-300">
                        Correo para recibir facturas
                        <input className={FIELD_CLASS + ' mt-1'} type="email" required maxLength={254}
                            value={billing.email}
                            onChange={(event) => setBilling({ ...billing, email: event.target.value })} />
                    </label>
                    <button type="submit" disabled={saving} className="w-full rounded-xl bg-cyan-600 py-3 text-sm font-bold disabled:opacity-50">
                        {saving ? 'Guardando…' : 'Guardar datos fiscales'}
                    </button>
                </form>
            )}
            {notice && <p className="text-sm text-cyan-200" role="status">{notice}</p>}
            <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                    <h3 className="font-bold text-sm">Facturas de membresía</h3>
                    <button type="button" className="text-xs text-cyan-300" onClick={load}>Actualizar</button>
                </div>
                {invoices.map((invoice) => (
                    <div key={invoice.id} className="bg-[#0F1014] border border-white/10 p-3 rounded-xl flex justify-between gap-3">
                        <div className="min-w-0">
                            <p className="font-bold text-xs">{invoice.invoice_number ? 'Factura ' + invoice.invoice_number : 'Pago de membresía'}</p>
                            <p className="text-xs text-gray-400">{STATUS_LABELS[invoice.status] || invoice.status}</p>
                            {invoice.control_number && <p className="text-xs text-gray-500">Control: {invoice.control_number}</p>}
                            <p className="text-[11px] text-gray-500">{new Date(invoice.created_at).toLocaleDateString('es-VE')}</p>
                        </div>
                        {invoice.status === 'issued' && invoice.storage_path && (
                            <button type="button" onClick={() => openInvoice(invoice.storage_path)}
                                className="self-center shrink-0 rounded-xl bg-cyan-500/15 px-3 py-2 text-xs font-bold text-cyan-200">
                                Abrir PDF
                            </button>
                        )}
                    </div>
                ))}
                {!invoices.length && <p className="text-xs text-gray-500">
                    Todavía no hay facturas registradas. Los pagos validados aparecerán aquí cuando se active la integración fiscal.
                </p>}
            </div>
        </section>
    );
}
