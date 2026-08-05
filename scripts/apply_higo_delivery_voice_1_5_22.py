from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    source = file_path.read_text(encoding='utf-8')
    matches = source.count(old)
    if matches != 1:
        raise SystemExit(f'{path}: expected one match, found {matches}\n--- needle ---\n{old}')
    file_path.write_text(source.replace(old, new, 1), encoding='utf-8')


voice_path = 'src/utils/passengerRideVoice.js'
replace_once(
    voice_path,
    "// Higo 1.5.18 passenger voice contract. Keep these prompts synchronized with\n",
    "// Passenger and Higo Envíos voice contract. Keep these prompts synchronized with\n",
)
replace_once(
    voice_path,
    """    completed: 'Has llegado a tu destino',
});
""",
    """    completed: 'Has llegado a tu destino',
    delivery_searching: 'Buscando Higo Driver',
    delivery_accepted: 'Higo Driver Encontrado',
    delivery_picked_up: 'Tu envío ha sido Recogido',
    delivery_completed: 'Tu Envío ha sido entregado',
});
""",
)
replace_once(
    voice_path,
    """export const resolvePassengerRideMilestone = (ride = {}) => {
    if (!ride?.id || isDeliveryRide(ride)) return null;

    const status = normalizeStatus(ride.status);

    if (['completed', 'finished'].includes(status)) return 'completed';
""",
    """export const resolvePassengerRideMilestone = (ride = {}) => {
    if (!ride?.id) return null;

    const status = normalizeStatus(ride.status);

    if (isDeliveryRide(ride)) {
        if (['completed', 'finished', 'delivered'].includes(status)) return 'delivery_completed';
        if (['in_progress', 'started', 'ongoing', 'picked_up', 'collected'].includes(status)) return 'delivery_picked_up';
        if (
            ride.driver_id
            || ['accepted', 'assigned', 'driver_assigned'].includes(status)
        ) return 'delivery_accepted';
        if (['requested', 'searching', 'pending'].includes(status)) return 'delivery_searching';
        return null;
    }

    if (['completed', 'finished'].includes(status)) return 'completed';
""",
)

confirm_path = 'src/pages/ConfirmTripPage.jsx'
replace_once(
    confirm_path,
    """            if (!isDelivery) {
                void announcePassengerRideMilestone({ rideId, milestone: 'searching' });
            }
""",
    """            void announcePassengerRideMilestone({
                rideId,
                milestone: isDelivery ? 'delivery_searching' : 'searching',
            });
""",
)

status_path = 'src/pages/RideStatusPage.jsx'
replace_once(
    status_path,
    """                const isDel = payload.new.service_type === 'delivery' || !!payload.new.delivery_info;
                if (!isDel) void announcePassengerRideState(payload.new);
""",
    """                const isDel = payload.new.service_type === 'delivery' || !!payload.new.delivery_info;
                void announcePassengerRideState(payload.new);
""",
)
replace_once(
    status_path,
    """            const isDel = data.service_type === 'delivery' || !!data.delivery_info;
            arrivedPickupRef.current = !!data.arrived_at_pickup_at;
            if (!isDel) void announcePassengerRideState(data);
""",
    """            const isDel = data.service_type === 'delivery' || !!data.delivery_info;
            arrivedPickupRef.current = !!data.arrived_at_pickup_at;
            void announcePassengerRideState(data);
""",
)

test_path = 'tests/passengerRideVoice.test.mjs'
replace_once(
    test_path,
    """        completed: 'Has llegado a tu destino',
    });
""",
    """        completed: 'Has llegado a tu destino',
        delivery_searching: 'Buscando Higo Driver',
        delivery_accepted: 'Higo Driver Encontrado',
        delivery_picked_up: 'Tu envío ha sido Recogido',
        delivery_completed: 'Tu Envío ha sido entregado',
    });
""",
)
replace_once(
    test_path,
    """test('does not announce passenger ride phrases for Higo Envíos', () => {
    assert.equal(resolvePassengerRideMilestone({ id: 2, status: 'requested', service_type: 'delivery' }), null);
    assert.equal(resolvePassengerRideMilestone({ id: 3, status: 'completed', delivery_info: { receiverName: 'Ana' } }), null);
});
""",
    """test('resolves the four Higo Envíos voice milestones', () => {
    assert.equal(
        resolvePassengerRideMilestone({ id: 2, status: 'requested', service_type: 'delivery' }),
        'delivery_searching',
    );
    assert.equal(
        resolvePassengerRideMilestone({ id: 2, status: 'accepted', driver_id: 'driver-2', service_type: 'delivery' }),
        'delivery_accepted',
    );
    assert.equal(
        resolvePassengerRideMilestone({ id: 2, status: 'in_progress', driver_id: 'driver-2', service_type: 'delivery' }),
        'delivery_picked_up',
    );
    assert.equal(
        resolvePassengerRideMilestone({ id: 3, status: 'completed', delivery_info: { receiverName: 'Ana' } }),
        'delivery_completed',
    );
});
""",
)
replace_once(
    test_path,
    """    assert.match(confirmPage, /milestone: 'searching'/);
    assert.match(statusPage, /announcePassengerRideState/);
""",
    """    assert.match(confirmPage, /milestone: isDelivery \? 'delivery_searching' : 'searching'/);
    assert.match(statusPage, /announcePassengerRideState/);
""",
)
replace_once(
    test_path,
    """    assert.match(gradle, /versionCode 53/);
    assert.match(gradle, /versionName \"1\\.5\\.21\"/);
""",
    """    assert.match(gradle, /versionCode 54/);
    assert.match(gradle, /versionName \"1\\.5\\.22\"/);
""",
)

# Keep other release-contract tests aligned with the new Android patch version.
for path in (
    'tests/driverGhostOfferRegression.test.mjs',
    'tests/nativeDriverChatGhostRegression.test.mjs',
    'tests/routeWaypoints.test.mjs',
):
    file_path = Path(path)
    source = file_path.read_text(encoding='utf-8')
    source = source.replace('/versionCode 53/', '/versionCode 54/')
    source = source.replace('/versionName "1\\.5\\.21"/', '/versionName "1\\.5\\.22"/')
    file_path.write_text(source, encoding='utf-8')

replace_once(
    'android/app/build.gradle',
    """        // Higo 1.5.21: native driver connectivity with RPC polling fallback.
        versionCode 53
        versionName "1.5.21"
""",
    """        // Higo 1.5.22: Higo Envíos voice milestones.
        versionCode 54
        versionName "1.5.22"
""",
)
