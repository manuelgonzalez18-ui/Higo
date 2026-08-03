import { useCallback, useEffect, useRef, useState } from 'react';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { supabase } from '../services/supabase';
import { listDirectedRideOffers } from '../services/rideApi';
import { FEATURES } from '../config/features';
import { calculateBearing, getDistanceFromLatLonInKm } from '../utils/geoUtils';

const BackgroundGeolocation = Capacitor.isNativePlatform()
    ? registerPlugin('BackgroundGeolocation')
    : null;

const NEARBY_RADIUS_KM = 30;
const DB_SYNC_MIN_MS = 10000;
const DB_SYNC_MIN_METERS = 20;
const NEARBY_POLL_MIN_MS = 30000;
const OFFER_REFRESH_DEBOUNCE_MS = 150;

export function useBackgroundLocation(profile, isOnline, activeRide, processRequests) {
    const [currentLoc, setCurrentLoc] = useState(null);
    const [heading, setHeading] = useState(0);

    const lastLocationRef = useRef(null);
    const headingRef = useRef(0);
    const lastSentTimeRef = useRef(0);
    const profileRef = useRef(profile);
    const activeRideRef = useRef(activeRide);
    const lastDbSyncRef = useRef({ t: 0, lat: null, lng: null });
    const lastNearbyPollRef = useRef(0);
    const seenDirectedOfferIdsRef = useRef(new Set());

    useEffect(() => {
        profileRef.current = profile;
    }, [profile]);

    useEffect(() => {
        headingRef.current = heading;
    }, [heading]);

    useEffect(() => {
        activeRideRef.current = activeRide;
    }, [activeRide]);

    const shouldSyncDb = (lat, lng) => {
        const now = Date.now();
        const last = lastDbSyncRef.current;
        if (!last.t) return true;
        const elapsed = now - last.t;
        if (elapsed < DB_SYNC_MIN_MS && last.lat != null) {
            const distanceMeters = getDistanceFromLatLonInKm(last.lat, last.lng, lat, lng) * 1000;
            if (distanceMeters < DB_SYNC_MIN_METERS) return false;
        }
        return true;
    };

    const markDbSynced = (lat, lng) => {
        lastDbSyncRef.current = { t: Date.now(), lat, lng };
    };

    const shouldPollNearby = () => {
        const now = Date.now();
        if (now - lastNearbyPollRef.current < NEARBY_POLL_MIN_MS) return false;
        lastNearbyPollRef.current = now;
        return true;
    };

    const applyDirectedOffers = useCallback((offers) => {
        const activeOffers = Array.isArray(offers) ? offers : [];
        const activeIds = new Set(
            activeOffers
                .map((offer) => offer.offerId)
                .filter((offerId) => offerId != null)
                .map(String),
        );
        const unseenOffers = activeOffers.filter((offer) => {
            if (offer.offerId == null) return false;
            return !seenDirectedOfferIdsRef.current.has(String(offer.offerId));
        });

        seenDirectedOfferIdsRef.current = activeIds;
        processRequests(activeOffers, true);
        if (unseenOffers.length > 0) processRequests(unseenOffers, false);
    }, [processRequests]);

    const pollRequests = async ({ latitude, longitude, currentProfile }) => {
        if (activeRideRef.current || !shouldPollNearby() || !processRequests) return;

        try {
            if (FEATURES.directedRideOffers) {
                const offers = await listDirectedRideOffers(20);
                // Directed offers are authoritative. Replace the local list so
                // expired/withdrawn offers disappear even if Realtime was lost,
                // while still alerting for offer IDs not seen before.
                applyDirectedOffers(offers || []);
                return;
            }

            let vehicleType = (currentProfile.vehicle_type || 'standard').toLowerCase();
            if (vehicleType === 'camioneta') vehicleType = 'van';

            const { data, error } = await supabase.rpc('get_nearby_rides', {
                driver_lat: latitude,
                driver_lng: longitude,
                radius_km: NEARBY_RADIUS_KM,
                driver_vehicle_type: vehicleType,
            });
            if (error) throw error;
            if (data?.length) processRequests(data, false);
        } catch (error) {
            console.warn('[driver-location] ride polling failed:', error?.message || error);
        }
    };

    // Realtime is the primary delivery path for progressive offers while the
    // 30-second poll remains a safety net. Every INSERT/UPDATE refreshes the
    // authoritative active-offer list, which also removes withdrawn offers as
    // soon as another driver accepts the ride.
    useEffect(() => {
        if (!FEATURES.directedRideOffers
            || !isOnline
            || !profile?.id
            || !processRequests) {
            return undefined;
        }

        let stopped = false;
        let refreshTimer = null;

        const refreshOffers = async () => {
            if (stopped || activeRideRef.current) return;
            try {
                const offers = await listDirectedRideOffers(20);
                if (!stopped) applyDirectedOffers(offers || []);
            } catch (error) {
                console.warn('[driver-offers] realtime refresh failed:', error?.message || error);
            }
        };

        const scheduleRefresh = () => {
            if (refreshTimer) clearTimeout(refreshTimer);
            refreshTimer = setTimeout(refreshOffers, OFFER_REFRESH_DEBOUNCE_MS);
        };

        const channel = supabase
            .channel(`driver-ride-offers:${profile.id}`)
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'ride_offers',
                filter: `driver_id=eq.${profile.id}`,
            }, scheduleRefresh)
            .subscribe((status) => {
                if (status === 'SUBSCRIBED') scheduleRefresh();
            });

        return () => {
            stopped = true;
            if (refreshTimer) clearTimeout(refreshTimer);
            supabase.removeChannel(channel);
        };
    }, [applyDirectedOffers, isOnline, profile?.id, processRequests]);

    useEffect(() => {
        let watcherId;
        let stopped = false;

        const stopWatcher = async (id) => {
            if (id == null) return;
            try {
                if (Capacitor.isNativePlatform()) {
                    await BackgroundGeolocation?.removeWatcher({ id });
                } else if (navigator.geolocation) {
                    navigator.geolocation.clearWatch(id);
                }
            } catch {
                // Cleanup is best-effort.
            }
        };

        const handleLocation = async ({ latitude, longitude, gpsBearing = 0, speed = 0 }) => {
            if (stopped) return;

            let newHeading = headingRef.current || 0;
            if (speed > 1.5 && gpsBearing) {
                newHeading = gpsBearing;
            } else if (lastLocationRef.current) {
                const distance = getDistanceFromLatLonInKm(
                    lastLocationRef.current.latitude,
                    lastLocationRef.current.longitude,
                    latitude,
                    longitude,
                );
                if (distance > 0.008) {
                    newHeading = calculateBearing(
                        lastLocationRef.current.latitude,
                        lastLocationRef.current.longitude,
                        latitude,
                        longitude,
                    );
                }
            }

            headingRef.current = newHeading;
            setHeading(newHeading);
            lastLocationRef.current = { latitude, longitude };
            setCurrentLoc({ lat: latitude, lng: longitude });

            const currentProfile = profileRef.current;
            if (!currentProfile?.id) return;

            if (shouldSyncDb(latitude, longitude)) {
                try {
                    if (Capacitor.isNativePlatform()) {
                        const { error } = await supabase.rpc('update_driver_gps', {
                            lat: latitude,
                            lng: longitude,
                            head: newHeading || 0,
                        });
                        if (error) throw error;
                    } else {
                        const { error } = await supabase
                            .from('profiles')
                            .update({
                                curr_lat: latitude,
                                curr_lng: longitude,
                                last_location_update: new Date().toISOString(),
                                status: isOnline ? 'online' : 'offline',
                            })
                            .eq('id', currentProfile.id);
                        if (error) throw error;
                    }
                    lastSentTimeRef.current = Date.now();
                    markDbSynced(latitude, longitude);
                } catch (error) {
                    console.error('[driver-location] sync failed:', error);
                    lastSentTimeRef.current = `ERR:${String(error?.message || error).slice(0, 20)}`;
                }
            }

            await pollRequests({ latitude, longitude, currentProfile });
        };

        const startTracking = async () => {
            if (!isOnline) return;

            if (!Capacitor.isNativePlatform()) {
                if (!navigator.geolocation) return;
                watcherId = navigator.geolocation.watchPosition(
                    (position) => {
                        handleLocation({
                            latitude: position.coords.latitude,
                            longitude: position.coords.longitude,
                            gpsBearing: position.coords.heading || 0,
                            speed: position.coords.speed || 0,
                        });
                    },
                    (error) => console.warn('[driver-location] web geolocation:', error),
                    { enableHighAccuracy: true, maximumAge: 0 },
                );
                return;
            }

            try {
                const permission = await BackgroundGeolocation.checkPermissions();
                if (permission.location === 'prompt' || permission.location === 'prompt-with-rationale') {
                    await BackgroundGeolocation.requestPermissions();
                }
            } catch (error) {
                console.warn('[driver-location] permission check failed:', error);
            }

            watcherId = await BackgroundGeolocation.addWatcher(
                {
                    backgroundMessage: 'Higo Driver está activo en segundo plano',
                    backgroundTitle: 'Buscando viajes...',
                    requestPermissions: true,
                    stale: false,
                    distanceFilter: 2,
                },
                async (location, error) => {
                    if (stopped) return;
                    if (error) {
                        if (error.code === 'NOT_AUTHORIZED'
                            && window.confirm('Higo necesita tu ubicación para enviarte viajes. ¿Abrir configuración?')) {
                            BackgroundGeolocation.openSettings();
                        }
                        return;
                    }
                    if (!location) return;
                    await handleLocation({
                        latitude: location.latitude,
                        longitude: location.longitude,
                        gpsBearing: location.bearing || 0,
                        speed: location.speed || 0,
                    });
                },
            );
        };

        startTracking();

        return () => {
            stopped = true;
            stopWatcher(watcherId);
        };
    }, [isOnline, processRequests]);

    return { currentLoc, heading, lastSentTimeRef, lastLocationRef };
}
