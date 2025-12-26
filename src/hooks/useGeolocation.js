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

        try {
            // Check permissions first
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
            console.warn("Capacitor Geolocation failed, trying browser fallback:", e);

            // Fallback to browser API
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
                return; // Browser async handling
            } else {
                setError(e.message || 'Geolocation not supported');
            }
        } finally {
            // Capacitor is async/await, so we can unset loading here if not falling back
            if (!navigator.geolocation || location) setLoading(false);
        }
    };

    useEffect(() => {
        getCurrentLocation();
    }, []);

    return { location, error, loading, getCurrentLocation };
};
