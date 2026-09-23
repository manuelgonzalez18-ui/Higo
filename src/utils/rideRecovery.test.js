import { describe, expect, it, vi } from 'vitest';
import { createRideRecovery } from './rideRecovery';

const deferred = () => {
    let resolve; let reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
};

describe('driver ride recovery', () => {
    it('coalesces simultaneous resume events and restores the complete server row', async () => {
        const response = deferred();
        const fetchRide = vi.fn(() => response.promise); const onRide = vi.fn();
        const recovery = createRideRecovery({ fetchRide, onRide });
        const first = recovery.sync(); const second = recovery.sync();
        expect(first).toBe(second);
        const row = { id: 12, status: 'arrived_at_dropoff', delivery_pod_url: '12/delivery/a.jpg', cod_collected: true };
        response.resolve(row); await first;
        expect(fetchRide).toHaveBeenCalledTimes(1);
        expect(onRide).toHaveBeenCalledExactlyOnceWith(row);
    });
    it('announces cancellation once and rejects a stale read that would resurrect the ride', async () => {
        const response = deferred(); const onRide = vi.fn(); const onCancelled = vi.fn();
        const recovery = createRideRecovery({ fetchRide: () => response.promise, onRide, onCancelled });
        const pending = recovery.sync();
        recovery.receive({ id: 12, status: 'cancelled' });
        recovery.receive({ id: 12, status: 'cancelled' });
        response.resolve({ id: 12, status: 'accepted' }); await pending;
        expect(onCancelled).toHaveBeenCalledTimes(1);
        expect(onRide).not.toHaveBeenCalled();
    });
    it('preserves newer realtime state and ignores results after disposal', async () => {
        const response = deferred(); const onRide = vi.fn();
        const recovery = createRideRecovery({ fetchRide: () => response.promise, onRide });
        const pending = recovery.sync();
        recovery.receive({ id: 12, status: 'in_progress' });
        response.resolve({ id: 12, status: 'accepted' }); await pending;
        expect(onRide).toHaveBeenCalledTimes(1);
        recovery.dispose(); recovery.receive({ id: 12, status: 'completed' }); await recovery.sync();
        expect(onRide).toHaveBeenCalledTimes(1);
    });
    it('preserves the visible ride during an outage and retries on the next signal', async () => {
        const onRide = vi.fn(); const onError = vi.fn();
        const fetchRide = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ id: 12, status: 'completed' });
        const recovery = createRideRecovery({ fetchRide, onRide, onError });
        await recovery.sync(); expect(onRide).not.toHaveBeenCalled();
        await recovery.sync(); expect(onRide).toHaveBeenCalledExactlyOnceWith({ id: 12, status: 'completed' });
        expect(onError).toHaveBeenCalledTimes(1);
    });
});
