from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    source = file_path.read_text(encoding='utf-8')
    count = source.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected one match, found {count}\n--- needle ---\n{old}')
    file_path.write_text(source.replace(old, new, 1), encoding='utf-8')


# ---------------------------------------------------------------------------
# Directed-offer contract: an active ride is not enough. In directed mode the
# card must be backed by a live offer identifier issued to the current driver.
# ---------------------------------------------------------------------------
replace_once(
    'src/utils/driverRideOffer.js',
    """export const isDriverRideRequestAvailable = (request = {}, nowMs = Date.now()) => {
    if (!request?.id) return false;

    const status = String(request.status || 'requested').trim().toLowerCase();
    if (status !== 'requested') return false;

    if (request.driver_id != null && String(request.driver_id).trim() !== '') return false;

    const expiry = asTimestamp(getRideOfferExpiry(request));
    if (expiry != null && expiry <= nowMs) return false;

    return true;
};
""",
    """export const isDriverRideRequestAvailable = (request = {}, nowMs = Date.now()) => {
    if (!request?.id) return false;

    const status = String(request.status || 'requested').trim().toLowerCase();
    if (status !== 'requested') return false;

    if (request.driver_id != null && String(request.driver_id).trim() !== '') return false;

    const expiry = asTimestamp(getRideOfferExpiry(request));
    if (expiry != null && expiry <= nowMs) return false;

    return true;
};

export const hasActiveDirectedRideOffer = (request = {}, nowMs = Date.now()) => {
    const offerId = request.offerId ?? request.offer_id ?? null;
    if (offerId == null || String(offerId).trim() === '') return false;
    return isDriverRideRequestAvailable(request, nowMs);
};
""",
)

replace_once(
    'src/services/rideApi.js',
    """export const listDirectedRideOffers = async (limit = 20) => {
    const rows = unwrap(await supabase.rpc('driver_list_ride_offers', { p_limit: limit })) || [];
    return rows.map((row) => ({
        offerId: row.offer_id,
        expiresAt: row.expires_at,
        distanceKm: row.distance_km,
        score: row.score,
        ...(row.ride || {}),
    }));
};
""",
    """export const listDirectedRideOffers = async (limit = 20) => {
    const boundedLimit = Math.max(1, Math.min(50, Number(limit) || 20));
    const rows = unwrap(await supabase.rpc('driver_list_ride_offers', { p_limit: boundedLimit })) || [];
    return rows.map((row) => ({
        offerId: row.offer_id,
        expiresAt: row.expires_at,
        distanceKm: row.distance_km,
        score: row.score,
        ...(row.ride || {}),
    }));
};

export const getDirectedRideOfferForRide = async (rideId) => {
    const normalizedRideId = String(rideId ?? '').trim();
    if (!normalizedRideId) return null;

    const offers = await listDirectedRideOffers(50);
    return offers.find((offer) => String(offer.id) === normalizedRideId) || null;
};
""",
)

# ---------------------------------------------------------------------------
# Driver dashboard: switch presence through a server-owned RPC, restore the
# authoritative state on startup, and require offerId in directed mode.
# ---------------------------------------------------------------------------
replace_once(
    'src/pages/DriverDashboard.jsx',
    "import { isDriverRideRequestAvailable } from '../utils/driverRideOffer';\n",
    "import { hasActiveDirectedRideOffer, isDriverRideRequestAvailable } from '../utils/driverRideOffer';\n",
)
replace_once(
    'src/pages/DriverDashboard.jsx',
    "const processRequests = useCallback((incomingRides, replace = false) => {",
    "const processRequests = useCallback((incomingRides, replace = false, requireDirectedOffer = false) => {",
)
replace_once(
    'src/pages/DriverDashboard.jsx',
    """        const checkRide = (ride) => {
            if (!isDriverRideRequestAvailable(ride)) return false;
""",
    """        const checkRide = (ride) => {
            const isAvailable = requireDirectedOffer
                ? hasActiveDirectedRideOffer(ride)
                : isDriverRideRequestAvailable(ride);
            if (!isAvailable) return false;
""",
)
replace_once(
    'src/pages/DriverDashboard.jsx',
    """        setProfile(userProfile);
        setLoading(false);
""",
    """        setProfile(userProfile);
        setIsOnline(userProfile.status === 'online');
        setLoading(false);
""",
)
replace_once(
    'src/pages/DriverDashboard.jsx',
    "if (!disposed) processRequests(offers, true);",
    "if (!disposed) processRequests(offers, true, true);",
)
replace_once(
    'src/pages/DriverDashboard.jsx',
    """    // Toggle Driver Status Online / Offline
    const toggleOnline = async () => {
        if (!isOnline) {
            if (profile.subscription_status === 'suspended') {
                if (window.confirm(\"⚠️ Tu membresía está vencida. Renuévala desde Higo Pay para volver a operar.\\n\\n¿Ir a renovar ahora?\")) {
                    navigate('/higo-pay');
                }
                return;
            }

            try {
                const { error } = await supabase.from('profiles')
                    .update({ status: 'online', last_location_update: new Date() })
                    .eq('id', profile.id);

                if (error) throw error;
                setIsOnline(true);
                speak(\"Conectado. Buscando solicitudes.\");
            } catch (e) {
                console.error(\"Error going online:\", e);
                toast.error(\"Error al conectar: \" + e.message);
            }
        } else {
            try {
                await supabase.from('profiles')
                    .update({ status: 'offline' })
                    .eq('id', profile.id);

                setIsOnline(false);
                speak(\"Desconectado.\");
            } catch (e) {
                console.error(\"Error going offline:\", e);
            }
        }
    };
""",
    """    // Toggle Driver Status Online / Offline. The RPC owns the state
    // transition so native and web clients use the same RLS-safe path.
    const toggleOnline = async () => {
        const nextOnline = !isOnline;
        if (nextOnline && profile.subscription_status === 'suspended') {
            if (window.confirm(\"⚠️ Tu membresía está vencida. Renuévala desde Higo Pay para volver a operar.\\n\\n¿Ir a renovar ahora?\")) {
                navigate('/higo-pay');
            }
            return;
        }

        try {
            const { data, error } = await supabase.rpc('driver_set_online_status', {
                p_online: nextOnline,
            });
            if (error) throw error;

            const serverOnline = data?.online === true;
            setIsOnline(serverOnline);
            setProfile((current) => current ? {
                ...current,
                status: serverOnline ? 'online' : 'offline',
            } : current);
            if (!serverOnline) setRequests([]);
            speak(serverOnline ? \"Conectado. Buscando solicitudes.\" : \"Desconectado.\");
        } catch (error) {
            console.error('[driver-presence] status update failed:', error);
            toast.error(nextOnline
                ? `No se pudo conectar: ${error.message}`
                : `No se pudo desconectar: ${error.message}`);
        }
    };
""",
)

# ---------------------------------------------------------------------------
# Chat lifecycle: subscribe as soon as auth/route resolves, not only after the
# floating chat is opened. Support both native and web event names.
# ---------------------------------------------------------------------------
replace_once(
    'src/components/ChatWidget.jsx',
    "const ACTIVE_RIDE_STATUSES = ['requested', 'accepted', 'in_progress', 'arrived_at_dropoff'];",
    "const ACTIVE_RIDE_STATUSES = ['requested', 'pending', 'accepted', 'arrived', 'driver_arrived', 'in_progress', 'arrived_at_dropoff'];",
)
replace_once(
    'src/components/ChatWidget.jsx',
    "const [rideId, setRideId] = useState(null);",
    "const [rideId, setRideId] = useState(() => getRideIdFromHash());",
)
replace_once(
    'src/components/ChatWidget.jsx',
    """            if (routeRideId) {
                setRideId((currentRideId) => currentRideId || routeRideId);
                return;
            }
""",
    """            if (routeRideId) {
                setRideId(routeRideId);
                return;
            }
""",
)
replace_once(
    'src/components/ChatWidget.jsx',
    "if (data?.id) setRideId((currentRideId) => currentRideId || data.id);",
    "setRideId(data?.id || null);",
)
replace_once(
    'src/components/ChatWidget.jsx',
    "const nextRideId = event.detail?.rideId || null;",
    "const nextRideId = event.detail?.rideId || getRideIdFromHash();",
)
replace_once(
    'src/components/ChatWidget.jsx',
    """        const syncCurrentRoute = () => {
            const currentUserId = userIdRef.current;
            if (currentUserId) void resolveActiveRide(currentUserId);
        };
""",
    """        const syncCurrentRoute = () => {
            const routeRideId = getRideIdFromHash();
            if (routeRideId) {
                setRideId(routeRideId);
                return;
            }
            const currentUserId = userIdRef.current;
            if (currentUserId) void resolveActiveRide(currentUserId);
        };
""",
)
replace_once(
    'src/components/ChatWidget.jsx',
    """        window.addEventListener('open-chat', handleOpenChat);
        window.addEventListener('hashchange', syncCurrentRoute);
""",
    """        window.addEventListener('open-chat', handleOpenChat);
        window.addEventListener('higo-open-chat', handleOpenChat);
        window.addEventListener('hashchange', syncCurrentRoute);
""",
)
replace_once(
    'src/components/ChatWidget.jsx',
    """            window.removeEventListener('open-chat', handleOpenChat);
            window.removeEventListener('hashchange', syncCurrentRoute);
""",
    """            window.removeEventListener('open-chat', handleOpenChat);
            window.removeEventListener('higo-open-chat', handleOpenChat);
            window.removeEventListener('hashchange', syncCurrentRoute);
""",
)

# ---------------------------------------------------------------------------
# Global foreground push: never trust a raw ride_request payload. Hydrate the
# caller's live directed offer first; DriverDashboard owns display on its route.
# ---------------------------------------------------------------------------
replace_once(
    'src/App.jsx',
    "import { ensureFcmRegistration, subscribeForegroundMessages } from './services/pushNotifications';\n",
    "import { ensureFcmRegistration, subscribeForegroundMessages } from './services/pushNotifications';\nimport { getDirectedRideOfferForRide } from './services/rideApi';\n",
)
replace_once(
    'src/App.jsx',
    """    const unsub = subscribeForegroundMessages((payload) => {
      const { title } = payload.notification || {};
      const data = payload.data || {};

      if (data.type === 'ride_request' || title?.includes('Nuevo Viaje') || title?.includes('Request')) {
        setIncomingRequest({
          price: data.price || '1.5',
          distance: data.distance || '1.9 km',
          duration: data.duration || '15 min',
          pickupLocation: data.pickupLocation || 'Ubicación Actual',
          pickupAddress: data.pickupAddress || 'Downtown District',
          dropoffLocation: data.dropoffLocation || 'Centro Comercial Flamingo',
          dropoffAddress: data.dropoffAddress || 'Entrada Principal',
          ...data
        });
        if (navigator.vibrate) navigator.vibrate([500, 200, 500, 200, 500]);
      } else if (title && navigator.vibrate) {
        navigator.vibrate([200, 100, 200]);
      }
    });
""",
    """    const unsub = subscribeForegroundMessages((payload) => {
      const { title } = payload.notification || {};
      const data = payload.data || {};
      const isRideRequest = data.type === 'ride_request'
        || title?.includes('Nuevo Viaje')
        || title?.includes('Request');

      if (isRideRequest) {
        const rideId = data.rideId || data.ride_id || data.id || null;
        if (!rideId || window.location.hash.startsWith('#/driver')) return;

        void (async () => {
          try {
            const offer = await getDirectedRideOfferForRide(rideId);
            if (!offer) {
              console.warn('[ride-push] ignored stale or non-directed offer:', rideId);
              return;
            }

            setIncomingRequest({
              price: offer.price ?? offer.estimated_price ?? data.price ?? '1.5',
              distance: offer.distanceKm ?? data.distance ?? '',
              duration: data.duration || '',
              pickupLocation: offer.pickup ?? offer.pickup_address ?? data.pickupLocation ?? 'Ubicación del pasajero',
              pickupAddress: offer.pickup_address ?? data.pickupAddress ?? '',
              dropoffLocation: offer.dropoff ?? offer.dropoff_address ?? data.dropoffLocation ?? 'Destino',
              dropoffAddress: offer.dropoff_address ?? data.dropoffAddress ?? '',
              ...data,
              ...offer,
            });
            if (navigator.vibrate) navigator.vibrate([500, 200, 500, 200, 500]);
          } catch (error) {
            console.warn('[ride-push] directed-offer validation failed:', error);
          }
        })();
      } else if (title && navigator.vibrate) {
        navigator.vibrate([200, 100, 200]);
      }
    });
""",
)

migration = r'''-- Native driver presence, chat readiness and directed-offer hardening.
-- Keeps web/native behavior on the same RPC path and prevents stale/mismatched
-- motorcycle offers from reaching the driver UI.

begin;

create or replace function public.driver_set_online_status(p_online boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_uid uuid := auth.uid();
    v_profile public.profiles%rowtype;
    v_withdrawn integer := 0;
begin
    if v_uid is null then
        raise exception 'authentication required' using errcode = '42501';
    end if;

    select * into v_profile
    from public.profiles
    where id = v_uid
    for update;

    if not found or coalesce(v_profile.role::text, '') <> 'driver' then
        raise exception 'driver account required' using errcode = '42501';
    end if;

    if coalesce(p_online, false) then
        perform public.higo_assert_driver_operational();
        update public.profiles
        set status = 'online'
        where id = v_uid;
    else
        update public.profiles
        set status = 'offline'
        where id = v_uid;

        update public.ride_offers
        set status = 'withdrawn',
            responded_at = coalesce(responded_at, now())
        where driver_id = v_uid
          and status = 'offered';
        get diagnostics v_withdrawn = row_count;
    end if;

    return jsonb_build_object(
        'driverId', v_uid,
        'online', coalesce(p_online, false),
        'status', case when coalesce(p_online, false) then 'online' else 'offline' end,
        'withdrawnOffers', v_withdrawn
    );
end;
$$;

create or replace function public.update_driver_gps(
    lat double precision,
    lng double precision,
    head double precision default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    if auth.uid() is null then
        raise exception 'authentication required' using errcode = '42501';
    end if;
    if lat is null or lng is null or lat < -90 or lat > 90 or lng < -180 or lng > 180 then
        raise exception 'invalid driver coordinates' using errcode = '22023';
    end if;

    perform public.higo_assert_driver_operational();

    update public.profiles
    set curr_lat = lat,
        curr_lng = lng,
        heading = coalesce(head, heading),
        last_location_update = now(),
        status = 'online'
    where id = auth.uid()
      and role::text = 'driver';

    if not found then
        raise exception 'driver profile not found' using errcode = '42501';
    end if;
end;
$$;

create or replace function public.driver_list_ride_offers(
    p_limit integer default 20
)
returns table(
    offer_id bigint,
    expires_at timestamptz,
    distance_km numeric,
    score numeric,
    ride jsonb
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    perform public.higo_assert_driver_operational();

    -- Expire or withdraw anything that can no longer be presented. This also
    -- removes stale offers generated before a driver changed vehicle/status.
    update public.ride_offers o
    set status = case when o.expires_at <= now() then 'expired' else 'withdrawn' end,
        responded_at = coalesce(o.responded_at, now())
    from public.rides r
    join public.profiles p on p.id = auth.uid()
    where o.driver_id = auth.uid()
      and r.id = o.ride_id
      and o.status = 'offered'
      and (
          o.expires_at <= now()
          or r.status <> 'requested'
          or r.driver_id is not null
          or p.status <> 'online'
          or public.higo_canonical_vehicle_type(p.vehicle_type)
             is distinct from public.higo_canonical_vehicle_type(r.ride_type)
      );

    return query
    select
        o.id,
        o.expires_at,
        o.distance_km,
        o.score,
        to_jsonb(r)
    from public.ride_offers o
    join public.rides r on r.id = o.ride_id
    join public.profiles p on p.id = o.driver_id
    where o.driver_id = auth.uid()
      and o.status = 'offered'
      and o.expires_at > now()
      and r.status = 'requested'
      and r.driver_id is null
      and p.status = 'online'
      and public.higo_canonical_vehicle_type(p.vehicle_type)
          = public.higo_canonical_vehicle_type(r.ride_type)
    order by o.score desc, o.offered_at desc
    limit greatest(1, least(coalesce(p_limit, 20), 50));
end;
$$;

revoke all on function public.driver_set_online_status(boolean) from public, anon;
grant execute on function public.driver_set_online_status(boolean) to authenticated;
revoke all on function public.update_driver_gps(double precision,double precision,double precision) from public, anon;
grant execute on function public.update_driver_gps(double precision,double precision,double precision) to authenticated;
revoke all on function public.driver_list_ride_offers(integer) from public, anon;
grant execute on function public.driver_list_ride_offers(integer) to authenticated;

commit;
'''
Path('supabase/migrations/20260805123500_driver_presence_and_offer_hardening.sql').write_text(migration, encoding='utf-8')

test_source = r'''import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
    hasActiveDirectedRideOffer,
    isDriverRideRequestAvailable,
} from '../src/utils/driverRideOffer.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('directed mode rejects a ride that has no live offer id', () => {
    const now = Date.parse('2026-08-05T16:00:00Z');
    const ride = {
        id: 900,
        status: 'requested',
        driver_id: null,
        expiresAt: '2026-08-05T16:03:00Z',
    };
    assert.equal(isDriverRideRequestAvailable(ride, now), true);
    assert.equal(hasActiveDirectedRideOffer(ride, now), false);
    assert.equal(hasActiveDirectedRideOffer({ ...ride, offerId: 77 }, now), true);
});

test('native driver presence uses a server-owned RPC and restores status', async () => {
    const [dashboard, locationHook, migration] = await Promise.all([
        read('src/pages/DriverDashboard.jsx'),
        read('src/hooks/useBackgroundLocation.js'),
        read('supabase/migrations/20260805123500_driver_presence_and_offer_hardening.sql'),
    ]);

    assert.match(dashboard, /rpc\('driver_set_online_status'/);
    assert.match(dashboard, /setIsOnline\(userProfile\.status === 'online'\)/);
    assert.match(locationHook, /rpc\('update_driver_gps'/);
    assert.match(migration, /create or replace function public\.driver_set_online_status/);
    assert.match(migration, /status = 'online'/);
    assert.match(migration, /status = 'withdrawn'/);
});

test('chat subscribes before opening and supports the native chat event', async () => {
    const chat = await read('src/components/ChatWidget.jsx');
    assert.match(chat, /useState\(\(\) => getRideIdFromHash\(\)\)/);
    assert.match(chat, /'arrived'/);
    assert.match(chat, /addEventListener\('open-chat'/);
    assert.match(chat, /addEventListener\('higo-open-chat'/);
    assert.match(chat, /if \(!rideId\) return undefined/);
});

test('motorcycle cards require a current directed offer and server vehicle match', async () => {
    const [dashboard, app, api, migration] = await Promise.all([
        read('src/pages/DriverDashboard.jsx'),
        read('src/App.jsx'),
        read('src/services/rideApi.js'),
        read('supabase/migrations/20260805123500_driver_presence_and_offer_hardening.sql'),
    ]);

    assert.match(dashboard, /hasActiveDirectedRideOffer/);
    assert.match(dashboard, /processRequests\(offers, true, true\)/);
    assert.match(api, /getDirectedRideOfferForRide/);
    assert.match(app, /await getDirectedRideOfferForRide\(rideId\)/);
    assert.match(app, /ignored stale or non-directed offer/);
    assert.match(migration, /higo_canonical_vehicle_type\(p\.vehicle_type\)/);
    assert.match(migration, /higo_canonical_vehicle_type\(r\.ride_type\)/);
});
'''
Path('tests/nativeDriverChatGhostRegression.test.mjs').write_text(test_source, encoding='utf-8')
