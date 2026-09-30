import React, { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ restore: vi.fn(), read: vi.fn(), start: vi.fn(), payment: vi.fn(), error: vi.fn() }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }));
vi.mock('@capacitor/app', () => ({ App: {} }));
vi.mock('@capacitor-community/text-to-speech', () => ({ TextToSpeech: { speak: vi.fn() } }));
vi.mock('../services/supabase', () => ({ supabase: {
    from: () => {
        const query = { select: () => query, eq: () => query, in: () => query, order: () => query,
            limit: () => query, maybeSingle: mocks.restore, single: mocks.read };
        return query;
    },
    channel: () => { const channel = { on: () => channel, subscribe: () => channel }; return channel; },
    removeChannel: vi.fn(), rpc: vi.fn(),
} }));
vi.mock('../services/rideApi', () => ({ acceptRide: vi.fn(), completeRide: vi.fn(), confirmRidePayment: mocks.payment,
    markDropoffArrival: vi.fn(), markPickupArrival: vi.fn(), startRide: mocks.start }));
vi.mock('../services/notificationService', () => ({ stopLoopingRequestAlert: vi.fn() }));
vi.mock('../components/Toast', () => ({ toast: { error: mocks.error } }));
vi.mock('../utils/sendDeliveryMilestone', () => ({ sendDeliveryMilestone: vi.fn() }));
vi.mock('../utils/sendRideStatusPush', () => ({ queueRideStatusPush: vi.fn() }));
import { useDriverActiveTrip } from './useDriverActiveTrip';
import PaymentReceiptModal from '../components/driver/PaymentReceiptModal';

const profile = { id: 'driver', subscription_status: 'active' };
const ride = { id: 7, driver_id: 'driver', status: 'accepted', passenger_name: 'Sintético',
    service_type: 'delivery', payer: 'sender', price: 5, pickup_pod_url: '7/pickup/test.jpg', payment_confirmed_by_driver: false };
let element; let root; let latest;
function Harness() {
    const trip = useDriverActiveTrip(profile, vi.fn(), undefined);
    useEffect(() => { latest = trip; }, [trip]);
    return <PaymentReceiptModal show={trip.showPaymentQR} activeRide={trip.activeRide} profile={profile}
        navStep={trip.navStep} confirmDriverPayment={trip.confirmDriverPayment} handleQRClosed={trip.handleQRClosed} />;
}
beforeEach(() => {
    vi.clearAllMocks(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    mocks.restore.mockResolvedValue({ data: null, error: null });
    mocks.read.mockResolvedValue({ data: ride, error: null });
    element = document.createElement('div'); document.body.append(element); root = createRoot(element);
});
afterEach(async () => { await act(() => root.unmount()); element.remove(); vi.unstubAllGlobals(); });

it('recovers an active trip on reconnect when the initial offline read failed', async () => {
    mocks.restore.mockResolvedValueOnce({ data: null, error: { message: 'offline' } }).mockResolvedValueOnce({ data: ride, error: null });
    await act(async () => { root.render(<Harness />); });
    expect(latest.activeRide).toBeNull();
    await act(async () => { window.dispatchEvent(new Event('online')); });
    expect(latest.activeRide).toMatchObject({ id: 7, status: 'accepted' });
    expect(latest.navStep).toBe(1);
    expect(mocks.restore).toHaveBeenCalledTimes(2);
});

it('records sender payment at pickup before enabling the route start', async () => {
    await act(async () => { root.render(<Harness />); });
    await act(async () => { latest.setActiveRide(ride); latest.setNavStep(1); latest.setShowPaymentQR(true); });
    const button = text => [...element.querySelectorAll('button')].find(value => value.textContent.includes(text));
    expect(button('Continuar e Iniciar Ruta').disabled).toBe(true);
    await act(async () => { await latest.handleQRClosed(); });
    expect(mocks.start).not.toHaveBeenCalled();
    mocks.payment.mockResolvedValue({ ...ride, payment_confirmed_by_driver: true });
    mocks.start.mockResolvedValue({ ...ride, payment_confirmed_by_driver: true, status: 'in_progress' });
    await act(async () => { button('Marcar como Pago Recibido').click(); });
    expect(mocks.payment).toHaveBeenCalledExactlyOnceWith(7);
    expect(button('Continuar e Iniciar Ruta').disabled).toBe(false);
    await act(async () => { button('Continuar e Iniciar Ruta').click(); });
    expect(mocks.start).toHaveBeenCalledExactlyOnceWith(7);
    expect(latest.activeRide.status).toBe('in_progress');
    expect(latest.showPaymentQR).toBe(false);
});
