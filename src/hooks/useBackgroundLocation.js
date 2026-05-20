import { useState, useEffect, useRef } from 'react';
import { supabase } from '../services/supabase';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { calculateBearing, getDistanceFromLatLonInKm } from '../utils/geoUtils';

const BackgroundGeolocation = Capacitor.isNativePlatform() ? registerPlugin('BackgroundGeolocation') : null;

const NEARBY_RADIUS_KM = 30.0;      // search radius in km
const DB_SYNC_MIN_MS = 10000;       // 10s minimum between db syncs
const DB_SYNC_MIN_METERS = 20;      // or 20m of physical displacement
const NEARBY_POLL_MIN_MS = 30000;   // 30s minimum between nearby polls

export function useBackgroundLocation(profile, isOnline, activeRide, processRequests) {
    const [currentLoc, setCurrentLoc] = useState(null);
    const [heading, setHeading] = useState(0);

    const lastLocationRef = useRef(null);
    const headingRef = useRef(0);
    const lastSentTimeRef = useRef(0);
    const profileRef = useRef(profile);
    const activeRideRef = useRef(activeRide);

    // Keep references sync'd to avoid restarting the watcher
    useEffect(() => {
        profileRef.current = profile;
    }, [profile]);

    useEffect(() => {
        headingRef.current = heading;
    }, [heading]);

    useEffect(() => {
        activeRideRef.current = activeRide;
    }, [activeRide]);

    // Throttling db sync
    const lastDbSyncRef = useRef({ t: 0, lat: null, lng: null });
    const shouldSyncDb = (lat, lng) => {
        const now = Date.now();
        const last = lastDbSyncRef.current;
        if (!last.t) return true;
        const elapsed = now - last.t;
        if (elapsed < DB_SYNC_MIN_MS && last.lat != null) {
            const distM = getDistanceFromLatLonInKm(last.lat, last.lng, lat, lng) * 1000;
            if (distM < DB_SYNC_MIN_METERS) return false;
        }
        return true;
    };

    const markDbSynced = (lat, lng) => {
        lastDbSyncRef.current = { t: Date.now(), lat, lng };
    };

    // Throttling nearby polls
    const lastNearbyPollRef = useRef(0);
    const shouldPollNearby = () => {
        const now = Date.now();
        if (now - lastNearbyPollRef.current < NEARBY_POLL_MIN_MS) return false;
        lastNearbyPollRef.current = now;
        return true;
    };

    useEffect(() => {
        let watcherId;

        const stopWatcher = (id) => {
            if (Capacitor.isNativePlatform()) {
                BackgroundGeolocation?.removeWatcher({ id });
            } else if (navigator.geolocation) {
                navigator.geolocation.clearWatch(id);
            }
        };

        const startTracking = async () => {
            // WEB FALLBACK
            if (!Capacitor.isNativePlatform()) {
                if (navigator.geolocation) {
                    watcherId = navigator.geolocation.watchPosition(
                        async (pos) => {
                            const { latitude, longitude } = pos.coords;
                            lastLocationRef.current = { latitude, longitude };
                            setCurrentLoc({ lat: latitude, lng: longitude });

                            const currentProfile = profileRef.current;
                            if (!currentProfile?.id) return;

                            // Throttle DB sync
                            if (shouldSyncDb(latitude, longitude)) {
                                await supabase.from('profiles').update({
                                    curr_lat: latitude,
                                    curr_lng: longitude,
                                    last_location_update: new Date(),
                                    status: isOnline ? 'online' : 'offline'
                                }).eq('id', currentProfile.id);
                                markDbSynced(latitude, longitude);
                            }

                            // Nearby Polling
                            if (activeRideRef.current) return;
                            if (!shouldPollNearby()) return;

                            let vType = (currentProfile.vehicle_type || 'standard').toLowerCase();
                            if (vType === 'camioneta') vType = 'van';

                            const { data } = await supabase.rpc('get_nearby_rides', {
                                driver_lat: latitude,
                                driver_lng: longitude,
                                radius_km: NEARBY_RADIUS_KM,
                                driver_vehicle_type: vType
                            });

                            if (data && data.length > 0 && processRequests) {
                                processRequests(data, false);
                            }
                        },
                        (err) => console.error("Web Geo Error:", err),
                        { enableHighAccuracy: true, maximumAge: 0 }
                    );
                }
                return;
            }

            // NATIVE BG TRACKING
            try {
                const status = await BackgroundGeolocation.checkPermissions();
                if (status.location === 'prompt' || status.location === 'prompt-with-rationale') {
                    await BackgroundGeolocation.requestPermissions();
                }
            } catch (e) {
                console.warn("BG Geo permission check failed", e);
            }

            watcherId = await BackgroundGeolocation.addWatcher(
                {
                    backgroundMessage: "Higo Driver está activo en segundo plano",
                    backgroundTitle: "Buscando Viajes...",
                    requestPermissions: true,
                    stale: false,
                    distanceFilter: 2 // High precision
                },
                async (location, error) => {
                    if (error) {
                        if (error.code === "NOT_AUTHORIZED") {
                            if (window.confirm("Esta app necesita tu ubicación para enviar viajes. ¿Abrir configuración?")) {
                                BackgroundGeolocation.openSettings();
                            }
                        }
                        return;
                    }

                    if (!location) return;

                    const { latitude, longitude, bearing: gpsBearing, speed } = location;

                    let currentHeading = headingRef.current || 0;
                    let newHeading = currentHeading;

                    // Heading Logic
                    if (speed > 1.5 && gpsBearing) {
                        newHeading = gpsBearing;
                    } else if (lastLocationRef.current) {
                        const dist = getDistanceFromLatLonInKm(
                            lastLocationRef.current.latitude, lastLocationRef.current.longitude,
                            latitude, longitude
                        );

                        if (dist > 0.008) {
                            newHeading = calculateBearing(
                                lastLocationRef.current.latitude,
                                lastLocationRef.current.longitude,
                                latitude,
                                longitude
                            );
                        }
                    }

                    setHeading(newHeading);
                    lastLocationRef.current = { latitude, longitude };

                    const currentProfile = profileRef.current;
                    if (currentProfile?.id) {
                        setCurrentLoc({ lat: latitude, lng: longitude });

                        if (shouldSyncDb(latitude, longitude)) {
                            try {
                                const { error: rpcError } = await supabase.rpc('update_driver_gps', {
                                    lat: latitude,
                                    lng: longitude,
                                    head: newHeading || 0
                                });

                                if (rpcError) {
                                    console.error("❌ LOCATION SYNC ERROR:", rpcError);
                                    lastSentTimeRef.current = `ERR: ${rpcError.message?.substring(0, 20) || rpcError.code}`;
                                } else {
                                    lastSentTimeRef.current = Date.now();
                                    markDbSynced(latitude, longitude);
                                }
                            } catch (err) {
                                console.error("❌ LOCATION SYNC EXCEPTION:", err);
                                lastSentTimeRef.current = "EXC";
                            }
                        }

                        // Background Polling
                        if (activeRideRef.current) return;
                        if (!shouldPollNearby()) return;

                        let vType = (currentProfile.vehicle_type || 'standard').toLowerCase();
                        if (vType === 'camioneta') vType = 'van';

                        const { data } = await supabase.rpc('get_nearby_rides', {
                            driver_lat: latitude,
                            driver_lng: longitude,
                            radius_km: NEARBY_RADIUS_KM,
                            driver_vehicle_type: vType
                        });

                        if (data && data.length > 0 && processRequests) {
                            processRequests(data, false);
                        }
                    }
                }
            );
        };

        if (isOnline) {
            startTracking();
        } else {
            if (watcherId) stopWatcher(watcherId);
        }

        return () => {
            if (watcherId) stopWatcher(watcherId);
        };
    }, [isOnline, processRequests]);

    return { currentLoc, heading, lastSentTimeRef, lastLocationRef };
}
