import { useState, useEffect } from 'react';
import { Geolocation } from '@capacitor/geolocation'; // Ensure this is installed
import { Capacitor } from '@capacitor/core';

export const useGeolocation = () => {
    const [location, setLocation] = useState(null); // { lat, lng }
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(true);
    const [showDisclosure, setShowDisclosure] = useState(false);

    const checkPermissionsAndDisclosure = async () => {
        if (!Capacitor.isNativePlatform()) {
            getCurrentLocation();
            return;
        }

        try {
            const permissionStatus = await Geolocation.checkPermissions();

            if (permissionStatus.location !== 'granted') {
                // Check local storage if we already showed it this session
                const hasSeenDisclosure = localStorage.getItem('higo_location_disclosure_accepted');
                if (!hasSeenDisclosure) {
                    setShowDisclosure(true);
                    setLoading(false);
                    return;
                }
                // If already seen but not granted, we can try to request again (Android will handle the system dialog)
                requestPermissions();
            } else {
                getCurrentLocation();
            }
        } catch (e) {
            console.error("Permission check failed:", e);
            getCurrentLocation();
        }
    };

    const handleAcceptDisclosure = async () => {
        localStorage.setItem('higo_location_disclosure_accepted', 'true');
        setShowDisclosure(false);
        requestPermissions();
    };

    const requestPermissions = async () => {
        try {
            const status = await Geolocation.requestPermissions();
            if (status.location === 'granted') {
                getCurrentLocation();
            } else {
                setError('Location permission denied');
                setLoading(false);
            }
        } catch (e) {
            setError(e.message || 'Error requesting permissions');
            setLoading(false);
        }
    };

    const getCurrentLocation = async () => {
        setLoading(true);
        setError(null);

        // WEB FALLBACK
        if (!Capacitor.isNativePlatform()) {
            // ... (keep web logic)
            if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition(
                    (pos) => {
                        setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
                        setLoading(false);
                    },
                    (err) => {
                        setError(err.message || 'Error getting location');
                        setLoading(false);
                    },
                    { enableHighAccuracy: true, timeout: 10000 }
                );
                return;
            }
        }

        // NATIVE
        try {
            const position = await Geolocation.getCurrentPosition({
                enableHighAccuracy: true,
                timeout: 10000,
            });

            setLocation({
                lat: position.coords.latitude,
                lng: position.coords.longitude
            });
        } catch (e) {
            console.warn("Capacitor Geolocation failed:", e);
            setError(e.message || 'Error getting location');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        checkPermissionsAndDisclosure();
    }, []);

    return { location, error, loading, getCurrentLocation, showDisclosure, handleAcceptDisclosure };
};
