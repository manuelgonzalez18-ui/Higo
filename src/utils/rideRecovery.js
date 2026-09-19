// One read per ride at a time. A newer realtime update supersedes an older read.
export function createRideRecovery({ fetchRide, onRide, onCancelled, onError = () => {} }) {
    let disposed = false;
    let revision = 0;
    let inFlight = null;
    let cancelled = false;
    const receive = (ride) => {
        if (disposed || cancelled || !ride) return;
        revision += 1;
        if (ride.status === 'cancelled') {
            cancelled = true;
            onCancelled(ride);
        } else onRide(ride);
    };
    const sync = () => {
        if (disposed || cancelled) return Promise.resolve();
        if (inFlight) return inFlight;
        const startedAtRevision = revision;
        inFlight = Promise.resolve().then(fetchRide).then(ride => {
            if (revision === startedAtRevision) receive(ride);
        }).catch(error => { if (!disposed) onError(error); }).finally(() => { inFlight = null; });
        return inFlight;
    };
    return { receive, sync, dispose: () => { disposed = true; } };
}
