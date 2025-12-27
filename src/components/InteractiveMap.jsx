import React, { useEffect, useState, useCallback, useRef } from 'react';
import { APIProvider, Map, AdvancedMarker, Pin, useMap, useMapsLibrary } from '@vis.gl/react-google-maps';
import { supabase } from '../services/supabase';

// Import Realistic Icons
import MotoIcon from '../assets/moto_marker_realistic.png';
import StandardIcon from '../assets/car_marker_red.png';
import VanIcon from '../assets/van_marker_red.png';
import PassengerPin from '../assets/passenger_pin_red.png';
import DestinationPin from '../assets/destination_pin_checkered.png'; // Red Pin with Checkered Flag Emblem

// Fallback Center
const HIGUEROTE_CENTER = { lat: 10.4850, lng: -66.0950 };

const Directions = ({ origin, destination, onRouteData }) => {
    const map = useMap();
    const routesLibrary = useMapsLibrary('routes');
    const [directionsService, setDirectionsService] = useState(null);
    const [directionsRenderer, setDirectionsRenderer] = useState(null);
    const [routes, setRoutes] = useState([]);

    useEffect(() => {
        if (!routesLibrary || !map) return;
        setDirectionsService(new routesLibrary.DirectionsService());
        setDirectionsRenderer(new routesLibrary.DirectionsRenderer({
            map,
            suppressMarkers: true, // We will use custom markers
            polylineOptions: {
                strokeColor: '#22c55e', // Green route line
                strokeOpacity: 1.0,
                strokeWeight: 6,
            }
        }));
    }, [routesLibrary, map]);

    useEffect(() => {
        if (!directionsService || !directionsRenderer || !origin || !destination) return;

        // Prevent routing if origin is same as destination (within small threshold)
        const isSameLoc = Math.abs(origin.lat - destination.lat) < 0.0001 && Math.abs(origin.lng - destination.lng) < 0.0001;
        if (isSameLoc) return;

        directionsService.route({
            origin: origin,
            destination: destination,
            travelMode: 'DRIVING',
            provideRouteAlternatives: false
        }).then(response => {
            directionsRenderer.setDirections(response);
            setRoutes(response.routes);

            // Extract ETA data from the first leg
            const leg = response.routes[0]?.legs[0];
            if (leg && onRouteData) {
                onRouteData({
                    duration: leg.duration, // { text: "6 min", value: 360 }
                    distance: leg.distance,
                    end_location: leg.end_location,
                    start_location: leg.start_location,
                    next_step: leg.steps?.[0] ? {
                        instruction: leg.steps[0].instructions,
                        distance: leg.steps[0].distance
                    } : null
                });
            }
        }).catch(e => console.error("Directions request failed", e));

    }, [directionsService, directionsRenderer, origin, destination]);

    return null;
};

const InteractiveMap = ({ selectedRide = 'standard', onRideSelect, showPin = false, markersProp, center, origin, destination, assignedDriver, destinationIconType = 'flag', onRouteData, className }) => {
    const [apiKey] = useState(import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '');
    const map = useMap();

    // Route Data for ETA Bubble
    const [routeInfo, setRouteInfo] = useState(null);

    // Bubble up route info
    useEffect(() => {
        if (routeInfo && onRouteData) {
            onRouteData(routeInfo);
        }
    }, [routeInfo, onRouteData]);

    // Drivers State (Simulated)
    const [drivers, setDrivers] = useState([]);

    // Imperative Center Control to allow gestures
    useEffect(() => {
        if (map && center && !showPin) { // Don't auto-center if selecting pin location to allow dragging
            map.panTo(center);
        }
    }, [map, center, showPin]);

    // Mock Drivers State for Simulation (Requested to be restored)
    const [mockDrivers, setMockDrivers] = useState([]);

    // Initialize Simulated Drivers on mount
    useEffect(() => {
        if (assignedDriver) {
            setMockDrivers([]);
            return;
        }

        // Generate 3-5 random drivers around the center
        const newDrivers = Array.from({ length: 4 }).map((_, i) => ({
            id: `sim-${i}`,
            lat: (center?.lat || HIGUEROTE_CENTER.lat) + (Math.random() - 0.5) * 0.015,
            lng: (center?.lng || HIGUEROTE_CENTER.lng) + (Math.random() - 0.5) * 0.015,
            type: Math.random() > 0.6 ? 'moto' : 'standard',
            heading: Math.floor(Math.random() * 360),
            name: 'Higo Driver'
        }));
        setMockDrivers(newDrivers);
    }, [center, assignedDriver]);

    // Animation Loop for Simulated Drivers
    useEffect(() => {
        if (assignedDriver) return;

        const interval = setInterval(() => {
            setMockDrivers(prev => prev.map(d => {
                const moveLat = (Math.random() - 0.5) * 0.0001;
                const moveLng = (Math.random() - 0.5) * 0.0001;
                const newLat = d.lat + moveLat;
                const newLng = d.lng + moveLng;

                // Calculate heading
                const angle = Math.atan2(moveLng, moveLat) * 180 / Math.PI;

                return {
                    ...d,
                    lat: newLat,
                    lng: newLng,
                    heading: angle
                };
            }));
        }, 3000);

        return () => clearInterval(interval);
    }, [assignedDriver]);

    // Initialize Real Drivers (Real-time from Supabase)
    useEffect(() => {
        if (assignedDriver) {
            setDrivers([]);
            return;
        }

        const fetchOnlineDrivers = async () => {
            const { data, error } = await supabase
                .from('profiles')
                .select('id, vehicle_type, vehicle_brand, vehicle_model, vehicle_color, curr_lat, curr_lng, heading, status')
                .eq('role', 'driver')
                .eq('status', 'online');

            if (data) {
                const mapped = data
                    .filter(d => d.curr_lat && d.curr_lng) // Only valid coords
                    .map(d => ({
                        id: d.id,
                        lat: d.curr_lat,
                        lng: d.curr_lng,
                        type: (d.vehicle_type || 'standard').toLowerCase(), // Normalize
                        heading: d.heading || 0,
                        name: d.vehicle_model || 'Higo Driver'
                    }));
                setDrivers(mapped);
            }
        };

        fetchOnlineDrivers();

        // Realtime Subscription for drivers moving or going online/offline
        const channel = supabase
            .channel('public:drivers_map_v2')
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles', filter: "role=eq.driver" }, (payload) => {
                const newDriver = payload.new;

                setDrivers(prev => {
                    // 1. If Offline -> Remove
                    if (newDriver.status !== 'online') {
                        return prev.filter(d => d.id !== newDriver.id);
                    }

                    // 2. If Online & Valid Coords -> Update or Add
                    if (newDriver.curr_lat && newDriver.curr_lng) {
                        const driverData = {
                            id: newDriver.id,
                            lat: newDriver.curr_lat,
                            lng: newDriver.curr_lng,
                            type: (newDriver.vehicle_type || 'standard').toLowerCase(),
                            heading: newDriver.heading || 0,
                            name: newDriver.vehicle_model || 'Higo Driver'
                        };

                        const exists = prev.find(d => d.id === newDriver.id);
                        if (exists) {
                            return prev.map(d => d.id === newDriver.id ? driverData : d);
                        } else {
                            return [...prev, driverData];
                        }
                    }

                    return prev;
                });
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [assignedDriver]);

    const getIconForType = (type) => {
        // Use updated top-down assets
        switch (type) {
            case 'moto': return MotoIcon; // Now moto_top_view.png
            case 'van': return VanIcon;   // Now van_top_view.png
            default: return StandardIcon; // car_top_view.png
        }
    };

    if (!apiKey) return <div className="text-white p-4">Loading Map... (Key Missing)</div>;

    return (
        <APIProvider apiKey={apiKey}>
            <div className={className || "w-full h-full relative"}>
                <Map
                    defaultCenter={HIGUEROTE_CENTER}
                    // Removed controlled 'center' prop to allow gestures
                    defaultZoom={15}
                    mapId="DEMO_MAP_ID"
                    options={{
                        disableDefaultUI: true,
                        zoomControl: false,
                        streetViewControl: false,
                        mapTypeControl: false,
                        fullscreenControl: false,
                        gestureHandling: 'greedy', // Enable one-finger panning
                        styles: [ // Dark Theme Styling
                            { elementType: "geometry", stylers: [{ color: "#242f3e" }] },
                            { elementType: "labels.text.stroke", stylers: [{ color: "#242f3e" }] },
                            { elementType: "labels.text.fill", stylers: [{ color: "#746855" }] },
                            {
                                featureType: "road",
                                elementType: "geometry",
                                stylers: [{ color: "#38414e" }],
                            },
                            {
                                featureType: "road",
                                elementType: "geometry.stroke",
                                stylers: [{ color: "#212a37" }],
                            },
                            {
                                featureType: "road",
                                elementType: "labels.text.fill",
                                stylers: [{ color: "#9ca5b3" }],
                            },
                            {
                                featureType: "water",
                                elementType: "geometry",
                                stylers: [{ color: "#17263c" }],
                            },
                        ]
                    }}
                    className="w-full h-full"
                >
                    {/* Render Real + Simulated Drivers */}
                    {!assignedDriver && [...drivers, ...mockDrivers].map(driver => (
                        <AdvancedMarker
                            key={driver.id}
                            position={{ lat: driver.lat, lng: driver.lng }}
                            title={`Higo Driver`}
                        >
                            <div
                                style={{
                                    transform: `rotate(${driver.heading}deg)`,
                                    transition: 'transform 1s linear'
                                }}
                            >
                                <img
                                    src={getIconForType(driver.type)}
                                    className="w-10 h-10 object-contain drop-shadow-xl"
                                    alt="vehicle"
                                />
                            </div>
                        </AdvancedMarker>
                    ))}

                    {/* Render ASSIGNED DRIVER */}
                    {assignedDriver && (
                        <AdvancedMarker
                            position={{ lat: assignedDriver.lat, lng: assignedDriver.lng }}
                            title={assignedDriver.name || "Tu Conductor"}
                            zIndex={100}
                        >
                            <div className="relative">
                                {/* Name Tag */}
                                <div className="absolute -top-12 left-1/2 -translate-x-1/2 bg-black/80 text-white text-[10px] font-bold px-3 py-1.5 rounded-lg whitespace-nowrap mb-1 flex flex-col items-center">
                                    <span>{assignedDriver.plate || "HIGO"}</span>
                                    {routeInfo && <span className="text-green-400 text-[9px]">{routeInfo.duration.text}</span>}
                                </div>
                                <div
                                    style={{
                                        transform: `rotate(${assignedDriver.heading || 0}deg)`,
                                        transition: 'all 1s ease-in-out'
                                    }}
                                >
                                    <img
                                        src={getIconForType(assignedDriver.type || 'standard')}
                                        className="w-16 h-16 object-contain drop-shadow-2xl"
                                        alt="My Driver"
                                    />
                                </div>
                            </div>
                        </AdvancedMarker>
                    )}

                    {/* Custom Origin/Dest Markers for Route */}
                    {origin && !showPin && !assignedDriver && (
                        <AdvancedMarker position={origin}>
                            {/* Updated to use Passenger Pin Icon */}
                            <div className="relative -mt-10 flex items-center justify-center">
                                {/* Searching Radar Effect on Map */}
                                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                    <div className="w-32 h-32 border border-blue-500/30 rounded-full animate-ping [animation-duration:2s]"></div>
                                    <div className="absolute w-20 h-20 border border-blue-500/40 rounded-full animate-ping [animation-duration:1.5s]"></div>
                                </div>
                                <img src={PassengerPin} className="w-12 h-12 object-contain drop-shadow-lg z-10" alt="Pickup" />
                            </div>
                        </AdvancedMarker>
                    )}

                    {destination && !showPin && (
                        <AdvancedMarker position={destination}>
                            {/* Destination Pin: Dynamic based on Prop */}
                            <div className="relative -mt-10">
                                <img
                                    src={destinationIconType === 'passenger' ? PassengerPin : DestinationPin}
                                    className="w-12 h-12 object-contain drop-shadow-2xl"
                                    alt="Destination"
                                />
                                {/* Simple Pulse Effect at base */}
                                <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-4 h-1.5 bg-black/30 rounded-full blur-sm animate-pulse"></div>
                            </div>
                        </AdvancedMarker>
                    )}

                    {/* ETA Bubble Overlay (Attach to Destination) */}
                    {routeInfo && destination && (
                        <AdvancedMarker position={destination} zIndex={50}>
                            <div className="mb-14 bg-[#1A1E29] text-white px-3 py-1.5 rounded-xl shadow-xl flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2 border border-white/10">
                                <div className="bg-blue-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-md">
                                    {routeInfo.duration.text}
                                </div>
                                <div className="flex flex-col leading-none">
                                    <span className="font-bold text-xs">Llegada</span>
                                    <span className="text-[10px] text-gray-400">aprox.</span>
                                </div>
                            </div>
                        </AdvancedMarker>
                    )}


                    {/* Directions Renderer */}
                    {origin && destination && (
                        <Directions
                            origin={origin}
                            destination={destination}
                            onRouteData={setRouteInfo}
                        />
                    )}
                </Map>

                {/* Pin for Selection (Center) */}
                {showPin && (
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 -mt-8 z-50 pointer-events-none drop-shadow-2xl animate-bounce">
                        <span className="material-symbols-outlined text-5xl text-violet-600">location_on</span>
                        <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-3 w-3 h-1.5 bg-black/20 rounded-full blur-[1px]"></div>
                    </div>
                )}
            </div>
        </APIProvider>
    );
};

export default InteractiveMap;
