import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    navigate: vi.fn(), quote: vi.fn(), recover: vi.fn(), create: vi.fn(),
    location: { key: 'synthetic-confirmation', state: {
        pickup: 'Origen', dropoff: 'Destino', pickupCoords: { lat: 10, lng: -66 }, dropoffCoords: { lat: 11, lng: -67 },
    } },
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate, useLocation: () => mocks.location }));
vi.mock('../components/InteractiveMap', () => ({ default: () => null }));
vi.mock('../services/supabase', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: 'synthetic-user' } } } }) } } }));
vi.mock('../services/rideApi', () => ({ createClientRequestId: () => 'synthetic-request', quoteRide: mocks.quote, recoverRideRequest: mocks.recover, createRideRequest: mocks.create }));
vi.mock('../components/Toast', () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() } }));
vi.mock('../utils/friendlyError', () => ({ friendlyError: () => 'No disponible' }));
vi.mock('../utils/passengerRideVoice', () => ({ announcePassengerRideMilestone: vi.fn() }));
import ConfirmTripPage from './ConfirmTripPage';

let element; let root;
beforeEach(() => {
    vi.clearAllMocks(); sessionStorage.clear();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    element = document.createElement('div'); document.body.append(element); root = createRoot(element);
});
afterEach(async () => { await act(() => root.unmount()); element.remove(); vi.unstubAllGlobals(); });
const mount = () => act(async () => { root.render(<ConfirmTripPage />); });
const confirm = () => act(async () => {
    [...element.querySelectorAll('button')].find(button => /Confirmar por|Reintentar cotización/.test(button.textContent)).click();
});

it('recovers a committed request even when Google is unavailable after a timeout', async () => {
    mocks.quote.mockRejectedValue(new Error('provider_unavailable'));
    mocks.recover.mockResolvedValue({ rideId: 41, idempotentReplay: true });
    await mount(); await confirm();
    expect(mocks.recover).toHaveBeenCalledExactlyOnceWith('synthetic-request', 'synthetic-user');
    expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith('/ride/41', { replace: true });
    expect(mocks.quote).toHaveBeenCalledTimes(1);
    expect(mocks.create).not.toHaveBeenCalled();
});

it('requires reviewing a refreshed price before creating an expired quote', async () => {
    mocks.recover.mockResolvedValue(null);
    mocks.quote.mockResolvedValueOnce({ quoteId: 'old', expiresAt: '2000-01-01T00:00:00Z', finalPrice: 3 })
        .mockResolvedValueOnce({ quoteId: 'new', expiresAt: '2099-01-01T00:00:00Z', finalPrice: 5 });
    mocks.create.mockResolvedValue({ rideId: 42 });
    await mount(); await confirm();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(element.textContent).toContain('Confirma');
    expect(element.textContent).toContain('$5.00');
    await confirm();
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create.mock.calls[0][0]).toMatchObject({ quoteId: 'new', clientRequestId: 'synthetic-request' });
    expect(mocks.navigate).toHaveBeenCalledWith('/ride/42', { replace: true });
});
