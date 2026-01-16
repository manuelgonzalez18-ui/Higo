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

// Helper component to handle smooth rotation and asset offset (-90deg for car_top_view)
const VehicleIconWithHeading = ({ heading, type, isLarge }) => {
    const smoothHeading = useSmoothHeading(heading);

    // Most car assets face EAST (90deg) by default. GPS is NORTH (0deg).
    // We subtract 90 to align the asset with the map.
    const rotationOffset = -90;

    return (
        <div
            style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: `translate(-50%, -50%) rotate(${smoothHeading + rotationOffset}deg)`,
                transition: 'transform 0.3s ease-out',
                pointerEvents: 'none'
            }}
        >
            <img
                src={getIconForType(type)}
                className={`${isLarge ? 'w-16 h-16' : 'w-10 h-10'} object-contain drop-shadow-2xl`}
                alt="vehicle"
            />
        </div>
    );
};

const getIconForType = (type) => {
    switch (type) {
        case 'moto': return MotoIcon;
        case 'van': return VanIcon;
        default: return StandardIcon;
    }
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
            preserveViewport: true, // IMPORTANT: Don't jump zoom on every GPS update
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
            const overviewPath = response.routes[0]?.overview_path || [];

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
                    overviewPath: overviewPath.map(p => ({ lat: p.lat(), lng: p.lng() })),
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

// Helper to snap a coordinate to a polyline path
const snapToPolyline = (point, path, thresholdMeters = 45) => {
    if (!path || path.length < 2) return point;

    let minDistance = Infinity;
    let snappedPoint = point;

    for (let i = 0; i < path.length - 1; i++) {
        const p1 = path[i];
        const p2 = path[i + 1];

        // Closest point on segment
        const closest = getClosestPointOnSegment(point, p1, p2);
        const dist = getDistanceInMeters(point, closest);

        if (dist < minDistance) {
            minDistance = dist;
            snappedPoint = closest;
        }
    }

    // Only snap if within threshold (e.g. 30 meters)
    return minDistance < thresholdMeters ? snappedPoint : point;
};

const getClosestPointOnSegment = (p, p1, p2) => {
    const x = p.lat, y = p.lng;
    const x1 = p1.lat, y1 = p1.lng;
    const x2 = p2.lat, y2 = p2.lng;

    const dx = x2 - x1;
    const dy = y2 - y1;

    if (dx === 0 && dy === 0) return p1;

    let t = ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy);
    t = Math.max(0, Math.min(1, t));

    return { lat: x1 + t * dx, lng: y1 + t * dy };
};

const getDistanceInMeters = (p1, p2) => {
    const R = 6371000; // Earth radius in meters
    const dLat = (p2.lat - p1.lat) * Math.PI / 180;
    const dLng = (p2.lng - p1.lng) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(p1.lat * Math.PI / 180) * Math.cos(p2.lat * Math.PI / 180) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
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
    // Balanced factor (0.12) to stay faithful to GPS without excessive lag
    const smoothPos = useSmoothPosition(position, 0.12);

    // Also smooth the rotation?
    // CSS transition handles rotation well enough usually, but let's stick to CSS for rotation provided by parent

    if (!smoothPos) return null;

    return (
        <AdvancedMarker
            position={smoothPos}
            zIndex={zIndex || 50}
        >
            <div style={{ position: 'relative', width: 0, height: 0 }}>
                {children}
            </div>
        </AdvancedMarker>
    );
};

// VehicleIcon Component REMOVED to simplify hook logic.
// Using inline CSS transitions instead.

const MapContent = ({
    selectedRide, onRideSelect, showPin, markersProp, center, origin, heading,
    destination, assignedDriver, destinationIconType, onRouteData, className,
    routeColor, isDriver, vehicleType, enableSimulation, activeRideId, navStep
}) => {
    const map = useMap();
    const [isFollowing, setIsFollowing] = useState(true);
    const [mapHeading, setMapHeading] = useState(0);
    const [mapTilt, setMapTilt] = useState(0);
    const lastInteractionTime = useRef(0);
    const lastForceFollowTime = useRef(0);
    const prevOriginRef = useRef(null);
    const prevNavStepRef = useRef(navStep);
    const prevRideIdRef = useRef(activeRideId);

    // Reset following when ride or destination changes (Force centered view)
    useEffect(() => {
        const isNavigationActive = !!(activeRideId || navStep > 0);
        const navStateChanged = activeRideId !== prevRideIdRef.current || navStep !== prevNavStepRef.current;

        if (destination || (isNavigationActive && navStateChanged)) {
            console.log("🎯 [MapContent] Navigation trigger detected, forcing follow");
            setIsFollowing(true);
            setMapTilt(45);
            lastForceFollowTime.current = Date.now();
        }
        prevNavStepRef.current = navStep;
        prevRideIdRef.current = activeRideId;
    }, [destination?.lat, destination?.lng, activeRideId, navStep]);

    // Also reset when entering "Online" mode (origin first arrival)
    useEffect(() => {
        if (origin && !prevOriginRef.current && isValidCoordinate(origin)) {
            console.log("🚗 [MapContent] Driver went online, enabling auto-follow");
            setIsFollowing(true);
            lastForceFollowTime.current = Date.now();
        }
        prevOriginRef.current = origin;
    }, [origin?.lat, origin?.lng]);

    // SYNC MAP POSITION & ORIENTATION: Follow vehicle in 3D
    useEffect(() => {
        if (!map || !isFollowing) return;

        let target = null;
        let vHeading = 0;

        if (isDriver && origin && isValidCoordinate(origin)) {
            target = origin;
            vHeading = heading;
        } else if (assignedDriver && isValidCoordinate(assignedDriver)) {
            target = { lat: assignedDriver.lat, lng: assignedDriver.lng };
            vHeading = assignedDriver.heading;
        }

        if (target) {
            map.panTo(target);
            if (vHeading !== undefined) {
                setMapHeading(vHeading);
            }
        }
    }, [map, isFollowing, isDriver, origin, heading, assignedDriver]);

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
        if (map && center && !showPin) {
            map.panTo(center);
        }
    }, [map, center, showPin]);

    // Initialize Real Drivers (Real-time from Supabase)
    useEffect(() => {
        if (assignedDriver) {
            setDrivers([]);
            return;
        }

        const fetchOnlineDrivers = async () => {
            const ninetySecondsAgo = new Date(Date.now() - 90000).toISOString();
            const { data } = await supabase
                .from('profiles')
                .select('id, vehicle_type, vehicle_brand, vehicle_model, vehicle_color, curr_lat, curr_lng, heading, status, updated_at')
                .eq('role', 'driver')
                .eq('status', 'online')
                .gt('updated_at', ninetySecondsAgo);

            if (data) {
                const mapped = data
                    .filter(d => d.curr_lat && d.curr_lng)
                    .map(d => ({
                        id: d.id,
                        lat: d.curr_lat,
                        lng: d.curr_lng,
                        type: (d.vehicle_type || 'standard').toLowerCase(),
                        heading: d.heading || 0,
                        name: d.vehicle_model || 'Higo Driver',
                        lastUpdate: d.updated_at
                    }));
                setDrivers(mapped);
            }
        };

        fetchOnlineDrivers();

        const channel = supabase
            .channel('public:drivers_map_v2')
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles', filter: "role=eq.driver" }, (payload) => {
                const newDriver = payload.new;
                setDrivers(prev => {
                    if (newDriver.status !== 'online') {
                        return prev.filter(d => d.id !== newDriver.id);
                    }
                    if (newDriver.curr_lat && newDriver.curr_lng) {
                        const driverData = {
                            id: newDriver.id,
                            lat: newDriver.curr_lat,
                            lng: newDriver.curr_lng,
                            type: (newDriver.vehicle_type || 'standard').toLowerCase(),
                            heading: newDriver.heading || 0,
                            name: newDriver.vehicle_model || 'Higo Driver',
                            lastUpdate: newDriver.updated_at
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

        const cleanupInterval = setInterval(() => {
            const now = Date.now();
            setDrivers(prev => prev.filter(d => {
                const age = now - new Date(d.lastUpdate || 0).getTime();
                return age < 90000;
            }));
        }, 30000);

        return () => {
            supabase.removeChannel(channel);
            clearInterval(cleanupInterval);
        };
    }, [assignedDriver]);

    return (
        <Map
            defaultCenter={HIGUEROTE_CENTER}
            defaultZoom={15}
            heading={mapHeading}
            tilt={mapTilt}
            onHeadingChange={(e) => setMapHeading(e.detail.heading)}
            onTiltChange={(e) => setMapTilt(e.detail.tilt)}
            mapId="DEMO_MAP_ID"
            options={{
                disableDefaultUI: true,
                zoomControl: true,
                rotateControl: true,
                tiltControl: true,
                streetViewControl: false,
                mapTypeControl: false,
                fullscreenControl: false,
                gestureHandling: 'greedy',
                styles: [
                    { elementType: "geometry", stylers: [{ color: "#242f3e" }] },
                    { elementType: "labels.text.stroke", stylers: [{ color: "#242f3e" }] },
                    { elementType: "labels.text.fill", stylers: [{ color: "#746855" }] },
                    { featureType: "road", elementType: "geometry", stylers: [{ color: "#38414e" }] },
                    { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#212a37" }] },
                    { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#9ca5b3" }] },
                    { featureType: "water", elementType: "geometry", stylers: [{ color: "#17263c" }] },
                ]
            }}
            onDragstart={() => {
                const now = Date.now();
                const timeSinceForce = now - lastForceFollowTime.current;
                if (timeSinceForce < 2000) return;
                console.log("🖐️ [MapContent] User interaction detected, pausing follow");
                setIsFollowing(false);
                lastInteractionTime.current = now;
            }}
            className="w-full h-full"
        >
            {/* Drivers */}
            {!assignedDriver && !isDriver && drivers.map(driver => (
                <AnimatedVehicleMarker
                    key={driver.id}
                    position={{ lat: driver.lat, lng: driver.lng }}
                    zIndex={50}
                >
                    <VehicleIconWithHeading
                        heading={driver.heading}
                        type={driver.type}
                    />
                </AnimatedVehicleMarker>
            ))}

            {/* Assigned Driver */}
            {assignedDriver && !isDriver && isValidCoordinate({ lat: assignedDriver.lat, lng: assignedDriver.lng }) && (
                <AnimatedVehicleMarker
                    position={snapToPolyline({ lat: assignedDriver.lat, lng: assignedDriver.lng }, routeInfo?.overviewPath)}
                    zIndex={100}
                >
                    <div className="relative">
                        <div className="absolute -top-12 left-1/2 -translate-x-1/2 bg-black/80 text-white text-[10px] font-bold px-3 py-1.5 rounded-lg whitespace-nowrap mb-1 flex flex-col items-center">
                            <span>{assignedDriver.plate || "HIGO"}</span>
                            {routeInfo && <span className="text-green-400 text-[9px]">{routeInfo.duration.text}</span>}
                        </div>
                        <VehicleIconWithHeading
                            heading={assignedDriver.heading}
                            type={assignedDriver.type || 'standard'}
                            isLarge
                        />
                    </div>
                </AnimatedVehicleMarker>
            )}

            {/* Origin Marker */}
            {origin && !showPin && !assignedDriver && !isDriver && isValidCoordinate(origin) && (
                <AdvancedMarker position={origin}>
                    <div className="relative -mt-10 flex items-center justify-center">
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <div className="w-32 h-32 border border-blue-500/30 rounded-full animate-ping [animation-duration:2s]"></div>
                        </div>
                        <img src={PassengerPin} className="w-12 h-12 object-contain drop-shadow-lg z-10" alt="Pickup" />
                    </div>
                </AdvancedMarker>
            )}

            {/* Driver Self Marker */}
            {isDriver && origin && isValidCoordinate(origin) && (
                <AnimatedVehicleMarker
                    position={snapToPolyline(origin, routeInfo?.overviewPath)}
                    zIndex={100}
                >
                    <VehicleIconWithHeading
                        heading={heading || routeInfo?.next_step?.heading || 0}
                        type={vehicleType}
                        isLarge
                    />
                </AnimatedVehicleMarker>
            )}

            {/* Destination Marker */}
            {destination && !showPin && isValidCoordinate(destination) && (
                <AdvancedMarker position={destination}>
                    <div className="relative -mt-10">
                        <img
                            src={destinationIconType === 'passenger' ? PassengerPin : DestinationPin}
                            className="w-12 h-12 object-contain drop-shadow-2xl"
                            alt="Destination"
                        />
                        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-4 h-1.5 bg-black/30 rounded-full blur-sm animate-pulse"></div>
                    </div>
                </AdvancedMarker>
            )}

            {/* ETA Bubble */}
            {routeInfo && destination && isValidCoordinate(destination) && (
                <AdvancedMarker position={destination} zIndex={50}>
                    <div className="mb-14 bg-[#1A1E29] text-white px-3 py-1.5 rounded-xl shadow-xl flex items-center gap-2 border border-white/10">
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

            {/* Directions */}
            {origin && destination && isValidCoordinate(origin) && isValidCoordinate(destination) && (
                <Directions
                    origin={origin}
                    destination={destination}
                    onRouteData={setRouteInfo}
                    routeColor={routeColor}
                />
            )}

            {/* Controls */}
            <div className="absolute bottom-80 right-4 z-[1000] flex flex-col gap-3">
                {isFollowing && (isDriver || assignedDriver) && (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            setMapTilt(prev => prev === 0 ? 45 : 0);
                        }}
                        className="bg-[#1A1E29] text-white p-3 rounded-full shadow-2xl border-2 border-white/10 flex items-center justify-center font-bold text-xs active:scale-95 transition-all hover:bg-[#242f3e]"
                        style={{ width: '48px', height: '48px' }}
                    >
                        {mapTilt === 0 ? '3D' : '2D'}
                    </button>
                )}

                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        setIsFollowing(true);
                        setMapHeading(0);
                        setMapTilt(0);
                        lastForceFollowTime.current = Date.now();
                    }}
                    className={`${isFollowing ? 'bg-green-600' : 'bg-blue-600'} text-white p-3 rounded-full shadow-2xl active:scale-95 transition-all flex items-center justify-center border-2 border-white/20`}
                    style={{ width: '48px', height: '48px' }}
                >
                    <span className="text-xl">🎯</span>
                </button>
            </div>
        </Map>
    );
};

const InteractiveMap = (props) => {
    const [apiKey] = useState(import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '');
    if (!apiKey) return <div className="text-white p-4">Loading Map... (Key Missing)</div>;

    return (
        <APIProvider apiKey={apiKey} libraries={['places', 'geometry']}>
            <div className={props.className || "w-full h-full relative"}>
                <MapContent {...props} />

                {/* Pin for Selection (Center) stays at top level wrapper for simple positioning */}
                {props.showPin && (
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
