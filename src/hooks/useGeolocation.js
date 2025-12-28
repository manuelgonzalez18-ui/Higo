import { useState, useEffect } from 'react';
import { Geolocation } from '@capacitor/geolocation'; // Ensure this is installed
import { Capacitor } from '@capacitor/core';

export const useGeolocation = () => {
    const [location, setLocation] = useState(null); // { lat, lng }
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(true);

    const getCurrentLocation = async () => {
        setLoading(true);
        setError(null);

        // WEB FALLBACK (Prioritize for Browser Testing)
        if (!Capacitor.isNativePlatform()) {
            if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition(
                    (pos) => {
                        setLocation({
                            lat: pos.coords.latitude,
                            lng: pos.coords.longitude
                        });
                        setLoading(false);
                    },
                    (err) => {
                        console.error("Browser Geolocation failed:", err);
                        setError(err.message || 'Error getting location');
                        setLoading(false);
                    },
                    { enableHighAccuracy: true, timeout: 10000 }
                );
                return;
            } else {
                setError('Geolocation not supported in this browser');
                setLoading(false);
                return;
            }
        }

        // NATIVE (Android/iOS)
        try {
            const permissionStatus = await Geolocation.checkPermissions();

            if (permissionStatus.location !== 'granted') {
                const requestStatus = await Geolocation.requestPermissions();
                if (requestStatus.location !== 'granted') {
                    throw new Error('Location permission denied');
                }
            }

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
        getCurrentLocation();
    }, []);

    return { location, error, loading, getCurrentLocation };
};
