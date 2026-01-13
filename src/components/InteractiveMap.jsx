import React, { useEffect, useState, useCallback, useRef } from 'react';
import { APIProvider, Map, AdvancedMarker, Pin, useMap, useMapsLibrary } from '@vis.gl/react-google-maps';
import { supabase } from '../services/supabase';

// Import Realistic Icons
import MotoIcon from '../assets/moto_marker_red.png';
import StandardIcon from '../assets/car_top_view.png';
import VanIcon from '../assets/van_marker_red.png';
import PassengerPin from '../assets/passenger_pin_red.png';
import DestinationPin from '../assets/destination_pin_checkered.png'; // Red Pin with Checkered Flag Emblem

// Fallback Center
const HIGUEROTE_CENTER = { lat: 10.4850, lng: -66.0950 };

const isValidCoordinate = (coord) => {
    return coord &&
        typeof coord.lat === 'number' && !isNaN(coord.lat) &&
        typeof coord.lng === 'number' && !isNaN(coord.lng);
};


const Directions = ({ origin, destination, onRouteData, routeColor }) => {
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
                strokeColor: routeColor || '#22c55e', // Default or Custom
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
                const nextStep = leg.steps?.[0];
                let nextHeading = 0;
                if (nextStep) {
                    const s = nextStep.start_location;
                    const e = nextStep.end_location;
                    nextHeading = Math.atan2(e.lng() - s.lng(), e.lat() - s.lat()) * 180 / Math.PI;
                }

                onRouteData({
                    duration: leg.duration,
                    distance: leg.distance,
                    end_location: leg.end_location,
                    start_location: leg.start_location,
                    next_step: nextStep ? {
                        instruction: nextStep.instructions,
                        distance: nextStep.distance,
                        heading: nextHeading
                    } : null
                });
            }
        }).catch(e => console.error("Directions request failed", e));

    }, [directionsService, directionsRenderer, origin, destination]);

    return null;
};

// Custom Hook for Smooth Position Interpolation
const useSmoothPosition = (targetPos, speedFactor = 0.1) => {
    const [currentPos, setCurrentPos] = useState(targetPos || { lat: 0, lng: 0 });
    const requestRef = useRef();
    const targetRef = useRef(targetPos);

    // Sync target ref
    useEffect(() => {
        targetRef.current = targetPos;
    }, [targetPos]);

    const animate = useCallback(() => {
        if (!targetRef.current) return;

        setCurrentPos(prev => {
            if (!prev) return targetRef.current;

            const latDiff = targetRef.current.lat - prev.lat;
            const lngDiff = targetRef.current.lng - prev.lng;

            // If close enough, snap to target to save CPU
            if (Math.abs(latDiff) < 0.000005 && Math.abs(lngDiff) < 0.000005) {
                return targetRef.current;
            }

            // Lerp (Linear Interpolation) with Decay
            return {
                lat: prev.lat + latDiff * speedFactor,
                lng: prev.lng + lngDiff * speedFactor
            };
        });

        requestRef.current = requestAnimationFrame(animate);
    }, [speedFactor]);

    useEffect(() => {
        if (targetPos) {
            requestRef.current = requestAnimationFrame(animate);
        }
        return () => cancelAnimationFrame(requestRef.current);
    }, [animate, targetPos]);

    return currentPos;
};

// Custom Hook for Smooth Heading (Shortest Path)
const useSmoothHeading = (targetHeading) => {
    const [displayHeading, setDisplayHeading] = useState(targetHeading || 0);
    const prevHeadingRef = useRef(targetHeading || 0);

    useEffect(() => {
        if (targetHeading === undefined || targetHeading === null) return;

        let current = prevHeadingRef.current;
        let target = targetHeading;

        // Calculate shortest path
        let delta = target - current;
        // Normalize delta to [-180, 180]
        while (delta <= -180) delta += 360;
        while (delta > 180) delta -= 360;

        const newHeading = current + delta;

        setDisplayHeading(newHeading);
        prevHeadingRef.current = newHeading;
    }, [targetHeading]);

    return displayHeading;
};

// Wrapper Component for Animated Vehicle
const AnimatedVehicleMarker = ({ position, heading, icon, type, zIndex, children }) => {
    // Smooth the position input
    // Using 0.05 for slower, smoother drift (updates at 60fps)
    const smoothPos = useSmoothPosition(position, 0.05);

    // Also smooth the rotation?
    // CSS transition handles rotation well enough usually, but let's stick to CSS for rotation provided by parent

    if (!smoothPos) return null;

    return (
        <AdvancedMarker
            position={smoothPos}
            zIndex={zIndex || 50}
        >
            {children}
        </AdvancedMarker>
    );
};

// NEW: Component to handle heading smoothing internally (Fix for Hook Error #310)
const VehicleIcon = ({ heading, type, className }) => {
    const smoothHeading = useSmoothHeading(heading || 0);

    const getIconForType = (type) => {
        // Use updated top-down assets
        switch (type) {
            case 'moto': return MotoIcon; // Now moto_top_view.png
            case 'van': return VanIcon;   // Now van_top_view.png
            default: return StandardIcon; // car_top_view.png
        }
    };

    return (
        <div
            style={{
                transform: `rotate(${smoothHeading}deg)`,
                transition: 'transform 0.5s linear' // Keep rotation native CSS
            }}
        >
            <img
                src={getIconForType(type)}
                className={className || "w-10 h-10 object-contain drop-shadow-xl"}
                alt="vehicle"
            />
        </div>
    );
};

const InteractiveMap = ({ selectedRide = 'standard', onRideSelect, showPin = false, markersProp, center, origin, heading = 0, destination, assignedDriver, destinationIconType = 'flag', onRouteData, className, routeColor = "#8A2BE2", isDriver = false, vehicleType = 'standard', enableSimulation = true }) => {
    const [apiKey] = useState(import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '');
    const map = useMap();

    // ... (rest of component state) ...
    // ... [omitted logic remains same until return] ...

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

    // Mock Drivers State for Simulation (REMOVED)
    // const [mockDrivers, setMockDrivers] = useState([]);

    // Simulation Effects REMOVED to prevent "Ghost Cars"
    /*
    // Initialize Simulated Drivers on mount
    useEffect(() => {
        // ... removed
    }, [center, assignedDriver, enableSimulation]);

    // Animation Loop for Simulated Drivers
    useEffect(() => {
        // ... removed
    }, [assignedDriver]);
    */

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
        <APIProvider apiKey={apiKey} libraries={['places', 'geometry']}>
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
                    {/* Render Real + Simulated Drivers (Only if NOT in Driver Navigation Mode) */}
                    {!assignedDriver && !isDriver && drivers.map(driver => {
                        if (!isValidCoordinate({ lat: driver.lat, lng: driver.lng })) return null;
                        return (
                            <AnimatedVehicleMarker
                                key={driver.id}
                                position={{ lat: driver.lat, lng: driver.lng }}
                                zIndex={50}
                            >
                                <VehicleIcon
                                    heading={driver.heading}
                                    type={driver.type}
                                    className="w-10 h-10 object-contain drop-shadow-xl"
                                />
                            </AnimatedVehicleMarker>
                        );
                    })}

                    {/* Render ASSIGNED DRIVER with Smooth Animation - HIDE IF DRIVER (Use Self-Icon) */}
                    {assignedDriver && !isDriver && isValidCoordinate({ lat: assignedDriver.lat, lng: assignedDriver.lng }) && (
                        <AnimatedVehicleMarker
                            position={{ lat: assignedDriver.lat, lng: assignedDriver.lng }}
                            zIndex={100}
                        >
                            <div className="relative">
                                {/* Name Tag */}
                                <div className="absolute -top-12 left-1/2 -translate-x-1/2 bg-black/80 text-white text-[10px] font-bold px-3 py-1.5 rounded-lg whitespace-nowrap mb-1 flex flex-col items-center">
                                    <span>{assignedDriver.plate || "HIGO"}</span>
                                    {routeInfo && <span className="text-green-400 text-[9px]">{routeInfo.duration.text}</span>}
                                </div>
                                <VehicleIcon
                                    heading={assignedDriver.heading}
                                    type={assignedDriver.type || 'standard'}
                                    className="w-16 h-16 object-contain drop-shadow-2xl"
                                />
                            </div>
                        </AnimatedVehicleMarker>
                    )}

                    {/* Custom Origin/Dest Markers for Route (No animation needed, static) */}
                    {origin && !showPin && !assignedDriver && !isDriver && isValidCoordinate(origin) && (
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

                    {/* DRIVER SELF ICON (Refined for Dashboard) with Smooth Animation */}
                    {isDriver && origin && (isValidCoordinate(routeInfo?.start_location) || isValidCoordinate(origin)) && (
                        <AnimatedVehicleMarker
                            position={isValidCoordinate(routeInfo?.start_location) ? routeInfo.start_location : origin}
                            zIndex={100}
                        >
                            <div
                                style={{
                                    // "SENSE TO THE ROUTE": Prioritize REAL GPS Heading (now smoothed)
                                    // Fallback to route alignment only if GPS heading is missing (0)
                                    transform: `rotate(${useSmoothHeading(heading || routeInfo?.next_step?.heading || 0)}deg)`,
                                    transition: 'transform 0.5s linear'
                                }}
                            >
                                <img
                                    src={getIconForType(vehicleType)}
                                    className="w-16 h-16 object-contain drop-shadow-2xl"
                                    alt="My Vehicle"
                                />
                            </div>
                        </AnimatedVehicleMarker>
                    )}

                    {destination && !showPin && isValidCoordinate(destination) && (
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
                    {routeInfo && destination && isValidCoordinate(destination) && (
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
                    {origin && destination && isValidCoordinate(origin) && isValidCoordinate(destination) && (
                        <Directions
                            origin={origin}
                            destination={destination}
                            onRouteData={setRouteInfo}
                            routeColor={routeColor}
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
