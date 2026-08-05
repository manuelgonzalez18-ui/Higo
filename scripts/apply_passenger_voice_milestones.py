from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    text = file_path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(
            f"{path}: expected exactly one match, found {count}\n"
            f"--- needle ---\n{old}"
        )
    file_path.write_text(text.replace(old, new, 1), encoding="utf-8")


# Passenger confirmation: announce immediately after the server has created the
# ride, while the screen changes to the existing "Buscando un Higo Driver" UI.
replace_once(
    "src/pages/ConfirmTripPage.jsx",
    "import { logger } from '../utils/logger';\n",
    "import { logger } from '../utils/logger';\n"
    "import { announcePassengerRideMilestone } from '../utils/passengerRideVoice';\n",
)

replace_once(
    "src/pages/ConfirmTripPage.jsx",
    """            await saveRecipientContact(session, rideId);
            toast.success(creation?.idempotentReplay ? 'Solicitud recuperada correctamente.' : 'Solicitud enviada. Buscando conductores…');
            navigate(`/ride/${rideId}`, { replace: true });
""",
    """            await saveRecipientContact(session, rideId);
            if (!isDelivery) {
                void announcePassengerRideMilestone({ rideId, milestone: 'searching' });
            }
            toast.success(creation?.idempotentReplay ? 'Solicitud recuperada correctamente.' : 'Solicitud enviada. Buscando conductores…');
            navigate(`/ride/${rideId}`, { replace: true });
""",
)


# Passenger tracking: every authoritative realtime row and every initial/recovery
# fetch is evaluated by one centralized milestone resolver. Persistent dedupe in
# passengerRideVoice prevents repeated speech after rerenders or reconnects.
replace_once(
    "src/pages/RideStatusPage.jsx",
    "import { useFabLift } from '../hooks/useFabLift';\n",
    "import { useFabLift } from '../hooks/useFabLift';\n"
    "import { announcePassengerRideState } from '../utils/passengerRideVoice';\n",
)

replace_once(
    "src/pages/RideStatusPage.jsx",
    """                const isDel = payload.new.service_type === 'delivery' || !!payload.new.delivery_info;

                // Llegada al origen: el conductor marca arrived_at_pickup_at pero
""",
    """                const isDel = payload.new.service_type === 'delivery' || !!payload.new.delivery_info;
                if (!isDel) void announcePassengerRideState(payload.new);

                // Llegada al origen: el conductor marca arrived_at_pickup_at pero
""",
)

replace_once(
    "src/pages/RideStatusPage.jsx",
    """            const isDel = data.service_type === 'delivery' || !!data.delivery_info;
            arrivedPickupRef.current = !!data.arrived_at_pickup_at;
""",
    """            const isDel = data.service_type === 'delivery' || !!data.delivery_info;
            arrivedPickupRef.current = !!data.arrived_at_pickup_at;
            if (!isDel) void announcePassengerRideState(data);
""",
)


# Native release that includes the passenger TTS behavior.
replace_once(
    "android/app/build.gradle",
    "        versionCode 49\n        versionName \"1.5.17\"\n",
    "        versionCode 50\n        versionName \"1.5.18\"\n",
)

# The previous release regression intentionally pinned 1.5.17. Advance the
# expectation together with the Android release so the full suite remains useful.
replace_once(
    "tests/driverGhostOfferRegression.test.mjs",
    """    assert.match(gradle, /versionCode 49/);
    assert.match(gradle, /versionName \"1\\.5\\.17\"/);
""",
    """    assert.match(gradle, /versionCode 50/);
    assert.match(gradle, /versionName \"1\\.5\\.18\"/);
""",
)


Path("tests/passengerRideVoice.test.mjs").write_text(r'''import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
    PASSENGER_RIDE_VOICE_PHRASES,
    passengerRideVoiceStorageKey,
    resolvePassengerRideMilestone,
} from '../src/utils/passengerRideVoice.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('uses the exact passenger voice phrases requested by product', () => {
    assert.deepEqual(PASSENGER_RIDE_VOICE_PHRASES, {
        searching: 'Buscando Higo Driver',
        accepted: 'Higo Driver encontrado',
        arrived: 'Tu Higo Driver llegó',
        started: 'Tu viaje ha comenzado',
        completed: 'Has llegado a tu destino',
    });
});

test('resolves the latest passenger milestone from the authoritative ride row', () => {
    assert.equal(resolvePassengerRideMilestone({ id: 1, status: 'requested' }), 'searching');
    assert.equal(resolvePassengerRideMilestone({ id: 1, status: 'requested', driver_id: 'driver-1' }), 'accepted');
    assert.equal(resolvePassengerRideMilestone({ id: 1, status: 'accepted', arrived_at_pickup_at: '2026-08-05T04:00:00Z' }), 'arrived');
    assert.equal(resolvePassengerRideMilestone({ id: 1, status: 'in_progress', driver_id: 'driver-1' }), 'started');
    assert.equal(resolvePassengerRideMilestone({ id: 1, status: 'completed', driver_id: 'driver-1' }), 'completed');
});

test('does not announce passenger ride phrases for Higo Envíos', () => {
    assert.equal(resolvePassengerRideMilestone({ id: 2, status: 'requested', service_type: 'delivery' }), null);
    assert.equal(resolvePassengerRideMilestone({ id: 3, status: 'completed', delivery_info: { receiverName: 'Ana' } }), null);
});

test('dedupe key is isolated by ride and milestone', () => {
    assert.notEqual(
        passengerRideVoiceStorageKey(10, 'accepted'),
        passengerRideVoiceStorageKey(10, 'arrived'),
    );
    assert.notEqual(
        passengerRideVoiceStorageKey(10, 'accepted'),
        passengerRideVoiceStorageKey(11, 'accepted'),
    );
});

test('passenger screens integrate the centralized voice contract', async () => {
    const [confirmPage, statusPage, gradle] = await Promise.all([
        read('src/pages/ConfirmTripPage.jsx'),
        read('src/pages/RideStatusPage.jsx'),
        read('android/app/build.gradle'),
    ]);

    assert.match(confirmPage, /announcePassengerRideMilestone/);
    assert.match(confirmPage, /milestone: 'searching'/);
    assert.match(statusPage, /announcePassengerRideState/);
    assert.match(statusPage, /announcePassengerRideState\(payload\.new\)/);
    assert.match(statusPage, /announcePassengerRideState\(data\)/);
    assert.match(gradle, /versionCode 50/);
    assert.match(gradle, /versionName "1\.5\.18"/);
});
''', encoding="utf-8")
