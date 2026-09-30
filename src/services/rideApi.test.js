import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), getSession: vi.fn(), event: vi.fn() }));
vi.mock('./supabase', () => ({ supabase: { rpc: mocks.rpc, auth: { getSession: mocks.getSession } } }));
vi.mock('./analytics', () => ({ trackEventLater: mocks.event }));
vi.mock('../utils/apiUrl', () => ({ apiUrl: (path) => `http://127.0.0.1:8080${path}` }));
import { quoteRide, createRideRequest, acceptRide, completeRide } from './rideApi';

describe('authoritative ride client', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getSession.mockResolvedValue({ data: { session: { access_token: 'synthetic-token' } } });
        vi.stubGlobal('fetch', vi.fn());
    });
    afterEach(() => vi.unstubAllGlobals());

    it('sends route points and stops with authentication, discarding client prices and metrics', async () => {
        fetch.mockResolvedValue({ ok: true, json: async () => ({ quoteId: 'quote', finalPrice: 8 }) });
        const result = await quoteRide({ pickupCoords: { lat: 10, lng: -66 }, dropoffCoords: { lat: 11, lng: -67 },
            vehicleType: 'standard', stops: [{ coords: { lat: 10.5, lng: -66.5 }, address: 'Stop' }],
            routeDistanceKm: 0.01, routeDurationMin: 0, price: 0.01, clientSubtotalFloor: 0.01 });
        const [url, options] = fetch.mock.calls[0];
        expect(url).toBe('http://127.0.0.1:8080/api/ride-quote.php');
        expect(options.headers.Authorization).toBe('Bearer synthetic-token');
        expect(JSON.parse(options.body)).toEqual({ pickupCoords: { lat: 10, lng: -66 }, dropoffCoords: { lat: 11, lng: -67 },
            vehicleType: 'standard', serviceType: 'ride', stops: [{ id: 'stop-1', lat: 10.5, lng: -66.5, address: 'Stop' }], promoCode: null });
        expect(result.finalPrice).toBe(8);
        expect(mocks.rpc).not.toHaveBeenCalled();
    });

    it('rejects a missing session before contacting the quote endpoint', async () => {
        mocks.getSession.mockResolvedValue({ data: { session: null } });
        await expect(quoteRide({})).rejects.toThrow('authentication_required');
        expect(fetch).not.toHaveBeenCalled();
    });

    it('does not replace a provider failure with a client estimate', async () => {
        fetch.mockResolvedValue({ ok: false, json: async () => ({ error: 'route_unavailable' }) });
        await expect(quoteRide({ price: 2 })).rejects.toThrow('route_unavailable');
        expect(mocks.rpc).not.toHaveBeenCalled();
    });

    it('creates through the quote RPC and preserves the idempotency key across retries', async () => {
        mocks.rpc.mockResolvedValue({ data: { rideId: 21, idempotentReplay: true }, error: null });
        const input = { quoteId: 'quote', clientRequestId: 'request', pickup: 'Origin', dropoff: 'Destination', price: 0.01, driverId: 'attacker' };
        await createRideRequest(input);
        await createRideRequest(input);
        expect(mocks.rpc.mock.calls[0]).toEqual(mocks.rpc.mock.calls[1]);
        expect(mocks.rpc.mock.calls[0]).toEqual(['create_ride_from_quote', {
            p_quote_id: 'quote', p_client_request_id: 'request', p_pickup: 'Origin', p_dropoff: 'Destination',
            p_passenger_phone: null, p_delivery_info: null, p_payer: null, p_cod_amount: null, p_terms_version: null,
        }]);
    });

    it.each([['driver_accept_ride_v2', acceptRide], ['driver_complete_ride_v2', completeRide]])(
        'propagates denied %s operations without a direct table fallback', async (name, action) => {
            mocks.rpc.mockResolvedValue({ data: null, error: new Error('permission_denied') });
            await expect(action(21)).rejects.toThrow('permission_denied');
            expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith(name, { p_ride_id: 21 });
            expect(mocks.event).not.toHaveBeenCalled();
        },
    );
});
