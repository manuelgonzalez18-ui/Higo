import React, { useEffect, useRef, useState, useMemo } from 'react';
import { searchPlaces } from '../services/geminiService';

const InteractiveMap = ({ selectedRide = 'standard', onRideSelect, showPin = false, markersProp }) => {
    const containerRef = useRef(null);
    const [view, setView] = useState({ x: -200, y: -100, scale: 1 });

    // Interaction State
    const [isPanning, setIsPanning] = useState(false);
    const [draggingMarkerId, setDraggingMarkerId] = useState(null);
    const [selectedDriverId, setSelectedDriverId] = useState(null);
    const [lastMouse, setLastMouse] = useState({ x: 0, y: 0 });
    const [startClickPos, setStartClickPos] = useState({ x: 0, y: 0 });

    // Data State
    const [drivers, setDrivers] = useState([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [showResults, setShowResults] = useState(false);
    const [isSearching, setIsSearching] = useState(false);

    const requestRef = useRef(0);

    // Initial Markers
    const [markers, setMarkers] = useState([
        { id: 'pickup', x: 400, y: 300, label: 'Pickup: Current Location', subLabel: '2 min away', type: 'pickup' },
        { id: 'dest', x: 1100, y: 500, label: 'Dest: Puerto Encantado', subLabel: 'Est. arrival 4:45 PM', type: 'destination' }
    ]);

    // Sync with external markersProp (Simulated Waypoints)
    useEffect(() => {
        if (markersProp && markersProp.length > 0) {
            // For simulation: Inject a stop marker if we have stops
            const hasStop = markersProp.some(m => m.coords);  // markersProp is actually 'stops' state from parent

            // Check if we already have a stop
            const existingStop = markers.find(m => m.type === 'stop');

            if (hasStop && !existingStop) {
                // Add simulated stop
                setMarkers(prev => {
                    // Logic to insert between pickup (0) and dest (last) is simplified here
                    // Just push a stop
                    return [
                        prev[0], // pickup
                        { id: 'stop-sim', x: 750, y: 400, label: 'Parada: ' + (markersProp[0].address || 'Stop'), type: 'stop' },
                        ...prev.slice(1) // rest (dest)
                    ];
                });
            } else if (!hasStop && existingStop) {
                // Remove stop if cleared
                setMarkers(prev => prev.filter(m => m.type !== 'stop'));
            }
        } else {
            // If passed empty array or null, ensure no stops
            setMarkers(prev => prev.filter(m => m.type !== 'stop'));
        }
    }, [markersProp]);

    // Road Network Constants
    const ROADS_Y = [300, 500];
    const ROADS_X = [400, 800, 1100];
    const LANE_OFFSET = 12; // Pixel offset for right-hand traffic

    // --- Effects ---

    // Reset selected driver when ride type changes
    useEffect(() => {
        setSelectedDriverId(null);
    }, [selectedRide]);

    // --- Calculations ---

    const { routePath, totalDistance, totalTime } = useMemo(() => {
        const routeMarkers = markers.filter(m =>
            ['pickup', 'stop', 'destination'].includes(m.type)
        );

        let path = '';
        let distancePixels = 0;

        if (routeMarkers.length > 1) {
            path = `M ${routeMarkers[0].x} ${routeMarkers[0].y}`;
            for (let i = 1; i < routeMarkers.length; i++) {
                const curr = routeMarkers[i];
                const prev = routeMarkers[i - 1];
                path += ` L ${curr.x} ${curr.y}`;
                const dx = curr.x - prev.x;
                const dy = curr.y - prev.y;
                distancePixels += Math.sqrt(dx * dx + dy * dy);
            }
        }

        const km = (distancePixels / 100).toFixed(1);
        const mins = Math.round(distancePixels / 100 * 1.5);

        return { routePath: path, totalDistance: km, totalTime: mins };
    }, [markers]);

    // --- Simulation ---

    useEffect(() => {
        const NAMES = ["Carlos", "Ana", "Luis", "Maria", "Jose", "Elena", "Pedro", "Sofia", "Miguel", "Isabella", "Ricardo", "Valentina", "Fernando", "Lucia", "Andres", "Camila"];
        const MODELS = ["Toyota Corolla", "Ford Fiesta", "Chevrolet Aveo", "Hyundai Getz", "Kia Rio", "Mitsubishi Lancer"];
        const MOTO_MODELS = ["Empire Keeway", "Bera SBR", "Suzuki GN125", "Yamaha DT"];
        const VAN_MODELS = ["Toyota Hiace", "Kia Pregio", "Ford Transit"];

        // Initialize drivers on the road network
        // Increased number of drivers to 18 to ensure map is populated when filtered
        const initialDrivers = Array.from({ length: 18 }).map((_, i) => {
            const isHorizontal = Math.random() > 0.5;
            let x, y, vx, vy, angle;

            if (isHorizontal) {
                // Pick a random Y road
                y = ROADS_Y[Math.floor(Math.random() * ROADS_Y.length)];
                x = Math.random() * 2400 - 200; // Random X
                vx = (Math.random() > 0.5 ? 1 : -1);
                vy = 0;
                angle = vx > 0 ? 0 : 180;
            } else {
                // Pick a random X road
                x = ROADS_X[Math.floor(Math.random() * ROADS_X.length)];
                y = Math.random() * 1900 - 200; // Random Y
                vx = 0;
                vy = (Math.random() > 0.5 ? 1 : -1);
                angle = vy > 0 ? 90 : 270;
            }

            // Distribute types: 0 (Standard), 1 (Moto), 2 (Van)
            const carType = i % 3;

            let model = MODELS[Math.floor(Math.random() * MODELS.length)];
            if (carType === 1) model = MOTO_MODELS[Math.floor(Math.random() * MOTO_MODELS.length)];
            if (carType === 2) model = VAN_MODELS[Math.floor(Math.random() * VAN_MODELS.length)];

            return {
                id: i,
                x, y, vx, vy, angle,
                speed: 1.5 + Math.random() * 1.5, // Varying speeds
                carType: carType,
                status: Math.random() > 0.3 ? 'Available' : 'On Trip',
                name: NAMES[Math.floor(Math.random() * NAMES.length)],
                rating: 4.5 + Math.random() * 0.5,
                carModel: model,
                plate: `${String.fromCharCode(65 + Math.random() * 26)}${String.fromCharCode(65 + Math.random() * 26)}${Math.floor(100 + Math.random() * 900)}AB`
            };
        });
        setDrivers(initialDrivers);
    }, []);

    const animate = () => {
        setDrivers(prevDrivers => prevDrivers.map(d => {
            let { x, y, vx, vy, speed, angle } = d;

            // Move
            x += vx * speed;
            y += vy * speed;

            // Wrap around world bounds
            if (x > 2300) x = -300;
            if (x < -300) x = 2300;
            if (y > 1800) y = -300;
            if (y < -300) y = 1800;

            // Intersection Logic
            const intersectionThreshold = speed * 1.5;

            if (vx !== 0) { // Moving Horizontally
                for (const ix of ROADS_X) {
                    if (Math.abs(x - ix) < intersectionThreshold) {
                        if (Math.random() < 0.03) {
                            x = ix; // Snap to road center
                            vx = 0;
                            vy = (Math.random() > 0.5 ? 1 : -1);
                            angle = vy > 0 ? 90 : 270;
                        }
                    }
                }
            } else if (vy !== 0) { // Moving Vertically
                for (const iy of ROADS_Y) {
                    if (Math.abs(y - iy) < intersectionThreshold) {
                        if (Math.random() < 0.03) {
                            y = iy;
                            vy = 0;
                            vx = (Math.random() > 0.5 ? 1 : -1);
                            angle = vx > 0 ? 0 : 180;
                        }
                    }
                }
            }

            return { ...d, x, y, vx, vy, angle };
        }));
        requestRef.current = requestAnimationFrame(animate);
    };

    useEffect(() => {
        requestRef.current = requestAnimationFrame(animate);
        return () => cancelAnimationFrame(requestRef.current);
    }, []);

    // --- Helper for Lane Offset ---
    const getRenderPosition = (d) => {
        let rx = d.x;
        let ry = d.y;

        if (d.vx > 0) ry += LANE_OFFSET;
        else if (d.vx < 0) ry -= LANE_OFFSET;
        else if (d.vy > 0) rx -= LANE_OFFSET;
        else if (d.vy < 0) rx += LANE_OFFSET;

        return { x: rx, y: ry };
    };

    // --- Handlers ---

    const handleSearch = async (e) => {
        const val = e.target.value;
        setSearchQuery(val);
        if (val.length > 2) {
            setIsSearching(true);
            const results = await searchPlaces(val);
            setSearchResults(results);
            setShowResults(true);
            setIsSearching(false);
        } else {
            setSearchResults([]);
            setShowResults(false);
        }
    };

    const handleSelectPlace = (place) => {
        const simX = 500 + Math.random() * 1000;
        const simY = 300 + Math.random() * 800;
        const newMarker = {
            id: `search-${Date.now()}`,
            x: simX,
            y: simY,
            label: place.title,
            subLabel: place.title, // using title as sub in lieu of address if not fetched
            type: 'search-result'
        };
        setMarkers(prev => [...prev, newMarker]);

        if (containerRef.current) {
            const containerW = containerRef.current.clientWidth;
            const containerH = containerRef.current.clientHeight;
            setView({
                scale: 1.2,
                x: (containerW / 2) - (simX * 1.2),
                y: (containerH / 2) - (simY * 1.2)
            });
        }
        setSearchQuery('');
        setShowResults(false);
    };

    const deleteMarker = (e, id) => {
        e.stopPropagation();
        setMarkers(prev => prev.filter(m => m.id !== id));
    };

    const handleMouseDown = (e) => {
        if (e.target.closest('.map-control-ignore')) return;
        setSelectedDriverId(null);
        setStartClickPos({ x: e.clientX, y: e.clientY });
        setLastMouse({ x: e.clientX, y: e.clientY });
        const markerEl = e.target.closest('[data-marker-id]');
        if (markerEl) {
            const id = markerEl.getAttribute('data-marker-id');
            if (id) {
                setDraggingMarkerId(id);
                return;
            }
        }
        setIsPanning(true);
    };

    const handleMouseMove = (e) => {
        const dx = e.clientX - lastMouse.x;
        const dy = e.clientY - lastMouse.y;
        setLastMouse({ x: e.clientX, y: e.clientY });
        if (draggingMarkerId) {
            setMarkers(prev => prev.map(m => {
                if (m.id === draggingMarkerId) {
                    return { ...m, x: m.x + (dx / view.scale), y: m.y + (dy / view.scale) };
                }
                return m;
            }));
        } else if (isPanning) {
            setView(prev => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
        }
    };

    const handleMouseUp = (e) => {
        const dist = Math.hypot(e.clientX - startClickPos.x, e.clientY - startClickPos.y);
        if (dist < 5 && isPanning && !draggingMarkerId) {
            if (!e.target.closest('.map-ui-element')) {
                handleAddStopAtClick(e.clientX, e.clientY);
            }
        }
        setIsPanning(false);
        setDraggingMarkerId(null);
    };

    const handleAddStopAtClick = (screenX, screenY) => {
        if (!containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        const worldX = (screenX - rect.left - view.x) / view.scale;
        const worldY = (screenY - rect.top - view.y) / view.scale;
        const newStop = {
            id: `stop-${Date.now()}`,
            x: worldX,
            y: worldY,
            label: 'New Stop',
            type: 'stop'
        };
        setMarkers(prev => {
            const destIndex = prev.findIndex(m => m.type === 'destination');
            const newArr = [...prev];
            if (destIndex !== -1) {
                newArr.splice(destIndex, 0, newStop);
            } else {
                newArr.push(newStop);
            }
            return newArr;
        });
    };

    const handleWheel = (e) => {
        const scaleChange = -e.deltaY * 0.001;
        const newScale = Math.min(Math.max(0.5, view.scale + scaleChange), 3);
        setView(prev => ({ ...prev, scale: newScale }));
    };

    const zoomIn = () => setView(prev => ({ ...prev, scale: Math.min(prev.scale + 0.2, 3) }));
    const zoomOut = () => setView(prev => ({ ...prev, scale: Math.max(prev.scale - 0.2, 0.5) }));
    const recenter = () => setView({ x: -200, y: -100, scale: 1 });

    // Map selection to carType
    const selectedCarType = selectedRide === 'moto' ? 1 : selectedRide === 'van' ? 2 : 0;

    return (
        <div
            ref={containerRef}
            className={`w-full h-full bg-[#f0f4f5] dark:bg-[#0f1c1c] overflow-hidden relative select-none ${isPanning ? 'cursor-grabbing' : draggingMarkerId ? 'cursor-grabbing' : 'cursor-default'}`}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onWheel={handleWheel}
        >
            {/* Search Bar */}
            <div className="absolute top-4 left-4 z-30 w-[calc(100%-2rem)] max-w-sm map-control-ignore map-ui-element">
                <div className="relative shadow-xl rounded-xl bg-white dark:bg-[#1a2c2c] border border-gray-100 dark:border-gray-700 transition-all focus-within:ring-2 focus-within:ring-violet-500/50">
                    <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                        {isSearching ? <div className="w-4 h-4 border-2 border-violet-600 border-t-transparent rounded-full animate-spin"></div> : <span className="material-symbols-outlined text-[20px]">search</span>}
                    </div>
                    <input
                        type="text"
                        placeholder="Search places..."
                        className="w-full pl-10 pr-10 py-3.5 rounded-xl bg-transparent border-none text-sm font-medium text-gray-800 dark:text-white placeholder:text-gray-400 focus:ring-0 outline-none"
                        value={searchQuery}
                        onChange={handleSearch}
                        onFocus={() => searchResults.length > 0 && setShowResults(true)}
                    />
                    {searchQuery && (
                        <button onClick={() => { setSearchQuery(''); setShowResults(false); }} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                            <span className="material-symbols-outlined text-[18px]">close</span>
                        </button>
                    )}
                </div>
                {showResults && searchResults.length > 0 && (
                    <div className="mt-2 bg-white dark:bg-[#1a2c2c] rounded-xl shadow-xl border border-gray-100 dark:border-gray-700 overflow-hidden animate-in fade-in max-h-60 overflow-y-auto custom-scrollbar">
                        {searchResults.map((place, idx) => (
                            <button key={idx} onClick={() => handleSelectPlace(place)} className="w-full text-left px-4 py-3 hover:bg-gray-50 dark:hover:bg-white/5 border-b border-gray-100 dark:border-gray-700 last:border-0 flex items-center gap-3 transition-colors group">
                                <div className="bg-gray-100 dark:bg-white/10 p-2 rounded-full text-gray-500 group-hover:text-violet-600 group-hover:bg-violet-100 transition-colors">
                                    <span className="material-symbols-outlined text-[18px] block">location_on</span>
                                </div>
                                <div>
                                    <p className="text-sm font-bold text-gray-800 dark:text-white">{place.title}</p>
                                    <p className="text-xs text-gray-500 truncate max-w-[200px]">{place.address}</p>
                                </div>
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* Travel Time Stats */}
            <div className="absolute top-4 right-4 z-30 map-ui-element pointer-events-none">
                <div className="bg-white dark:bg-[#1a2c2c] rounded-xl shadow-xl border border-gray-100 dark:border-gray-700 p-3 flex flex-col items-end animate-in fade-in">
                    <p className="text-xs text-gray-500 font-bold uppercase tracking-wider">Estimated Trip</p>
                    <div className="flex items-baseline gap-1">
                        <span className="text-2xl font-bold text-gray-800 dark:text-white">{totalTime}</span>
                        <span className="text-sm text-gray-800 dark:text-white font-medium">min</span>
                    </div>
                    <p className="text-xs text-gray-400">{totalDistance} km total</p>
                </div>
            </div>

            {/* World Container */}
            <div
                style={{
                    transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
                    transformOrigin: 'center',
                    transition: isPanning || draggingMarkerId ? 'none' : 'transform 0.4s cubic-bezier(0.2, 0.8, 0.2, 1)'
                }}
                className="w-[2000px] h-[1500px] relative will-change-transform"
            >
                {/* Background SVG Layer */}
                <svg className="absolute inset-0 w-full h-full pointer-events-none" xmlns="http://www.w3.org/2000/svg">
                    <defs>
                        <pattern id="grid" width="100" height="100" patternUnits="userSpaceOnUse">
                            <path d="M 100 0 L 0 0 0 100" fill="none" stroke="currentColor" className="text-gray-200 dark:text-[#1a2c2c]" strokeWidth="2" />
                        </pattern>
                    </defs>
                    <rect width="100%" height="100%" fill="url(#grid)" />

                    {/* Simulated Roads */}
                    {/* Horizontal */}
                    <path d="M -100 300 L 2500 300" stroke="currentColor" className="text-white dark:text-[#233535]" strokeWidth="26" />
                    <path d="M -100 300 L 2500 300" stroke="currentColor" className="text-gray-300 dark:text-[#2a3c3c]" strokeWidth="22" />

                    <path d="M -100 500 L 2500 500" stroke="currentColor" className="text-white dark:text-[#233535]" strokeWidth="26" />
                    <path d="M -100 500 L 2500 500" stroke="currentColor" className="text-gray-300 dark:text-[#2a3c3c]" strokeWidth="22" />

                    {/* Vertical */}
                    <path d="M 400 -100 L 400 1900" stroke="currentColor" className="text-white dark:text-[#233535]" strokeWidth="26" />
                    <path d="M 400 -100 L 400 1900" stroke="currentColor" className="text-gray-300 dark:text-[#2a3c3c]" strokeWidth="22" />

                    <path d="M 800 -100 L 800 1900" stroke="currentColor" className="text-white dark:text-[#233535]" strokeWidth="26" />
                    <path d="M 800 -100 L 800 1900" stroke="currentColor" className="text-gray-300 dark:text-[#2a3c3c]" strokeWidth="22" />

                    <path d="M 1100 -100 L 1100 1900" stroke="currentColor" className="text-white dark:text-[#233535]" strokeWidth="26" />
                    <path d="M 1100 -100 L 1100 1900" stroke="currentColor" className="text-gray-300 dark:text-[#2a3c3c]" strokeWidth="22" />

                    {/* Dashed Center Lines */}
                    <path d="M -100 300 L 2500 300" stroke="white" strokeWidth="2" strokeDasharray="10 10" className="opacity-50" />
                    <path d="M -100 500 L 2500 500" stroke="white" strokeWidth="2" strokeDasharray="10 10" className="opacity-50" />
                    <path d="M 400 -100 L 400 1900" stroke="white" strokeWidth="2" strokeDasharray="10 10" className="opacity-50" />
                    <path d="M 800 -100 L 800 1900" stroke="white" strokeWidth="2" strokeDasharray="10 10" className="opacity-50" />
                    <path d="M 1100 -100 L 1100 1900" stroke="white" strokeWidth="2" strokeDasharray="10 10" className="opacity-50" />

                    {/* Dynamic Route Line */}
                    <path
                        d={routePath}
                        fill="none"
                        stroke="#13ecec"
                        strokeWidth="8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeDasharray="16 8"
                        className="drop-shadow-lg transition-all duration-300 ease-out"
                    />

                    {/* Selected Driver Route Line */}
                    {selectedDriverId !== null && (() => {
                        const driver = drivers.find(d => d.id === selectedDriverId);
                        const pickup = markers.find(m => m.type === 'pickup');

                        if (driver && pickup) {
                            let dPath = '';
                            if (Math.abs(driver.vy) > Math.abs(driver.vx)) {
                                dPath = `M ${driver.x} ${driver.y} L ${driver.x} ${pickup.y} L ${pickup.x} ${pickup.y}`;
                            } else {
                                dPath = `M ${driver.x} ${driver.y} L ${pickup.x} ${driver.y} L ${pickup.x} ${pickup.y}`;
                            }

                            return (
                                <>
                                    <path
                                        d={dPath}
                                        fill="none"
                                        stroke="#10b981"
                                        strokeWidth="4"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeDasharray="8 8"
                                        className="drop-shadow-md opacity-80"
                                    />
                                    <circle cx={pickup.x} cy={pickup.y} r="6" fill="#10b981" className="opacity-50 animate-ping" />
                                </>
                            );
                        }
                        return null;
                    })()}
                </svg>

                {/* Simulated Drivers */}
                {drivers.map(driver => {
                    if (driver.carType !== selectedCarType) return null;

                    const pos = getRenderPosition(driver);
                    const isSelected = selectedDriverId === driver.id;
                    const isAvailable = driver.status === 'Available';

                    let icon = 'directions_car';
                    let colorClass = 'bg-white dark:bg-[#233535] border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300';
                    let statusColor = isAvailable ? 'bg-emerald-400' : 'bg-amber-400';

                    if (driver.carType === 1) { // Moto
                        icon = 'two_wheeler';
                        colorClass = 'bg-orange-50 dark:bg-orange-900/30 border-orange-200 dark:border-orange-800 text-orange-600 dark:text-orange-400';
                    } else if (driver.carType === 2) { // Van
                        icon = 'airport_shuttle';
                        colorClass = 'bg-purple-50 dark:bg-purple-900/30 border-purple-200 dark:border-purple-800 text-purple-600 dark:text-purple-400';
                    }

                    return (
                        <div
                            key={driver.id}
                            onClick={(e) => {
                                e.stopPropagation();
                                setSelectedDriverId(driver.id);
                            }}
                            className="absolute w-10 h-10 -ml-5 -mt-5 flex items-center justify-center z-20 cursor-pointer map-control-ignore map-ui-element group"
                            style={{
                                left: pos.x,
                                top: pos.y,
                                zIndex: isSelected ? 50 : 30,
                            }}
                        >
                            <div className="w-full h-full flex items-center justify-center" style={{ transform: `rotate(${driver.angle}deg) scale(1)`, transition: 'transform 0.3s ease-out' }}>
                                <div className={`w-8 h-8 rounded-full shadow-md border flex items-center justify-center transition-all duration-300 ${colorClass} ${isSelected ? 'scale-125 ring-2 ring-violet-500 ring-offset-2 dark:ring-offset-[#1a2c2c]' : 'hover:scale-110'
                                    }`}>
                                    <span className="material-symbols-outlined text-[18px]">{icon}</span>
                                </div>
                                <div className={`absolute top-0 right-0 w-3 h-3 ${statusColor} rounded-full border-2 border-white dark:border-[#1a2c2c] z-20 shadow-sm`} title={driver.status}></div>
                            </div>

                            {isSelected && (
                                <div
                                    className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-white/95 dark:bg-[#1a2c2c]/95 backdrop-blur-sm p-3 rounded-xl shadow-2xl border border-gray-100 dark:border-gray-700 min-w-[160px] animate-in fade-in cursor-default origin-bottom z-50"
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    <div className="absolute top-2 right-2 flex items-center gap-1">
                                        <div className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ${isAvailable ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'}`}>
                                            {driver.status}
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-3 mb-2 pt-5">
                                        <div className="w-10 h-10 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden flex-shrink-0 ring-2 ring-white dark:ring-gray-600 shadow-sm">
                                            <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${driver.name}`} alt="avatar" className="w-full h-full object-cover" />
                                        </div>
                                        <div>
                                            <p className="text-sm font-bold text-gray-800 dark:text-white leading-tight">{driver.name}</p>
                                            <div className="flex items-center gap-1">
                                                <span className="text-xs text-yellow-500 font-bold">{driver.rating.toFixed(1)}</span>
                                                <div className="flex text-yellow-500">
                                                    {[...Array(5)].map((_, i) => (
                                                        <span key={i} className="material-symbols-outlined text-[10px]">{i < Math.floor(driver.rating) ? 'star' : 'star_rate'}</span>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="space-y-1 bg-gray-50 dark:bg-black/20 p-2 rounded-lg text-xs">
                                        <div className="flex justify-between">
                                            <span className="text-gray-500">Vehicle</span>
                                            <span className="font-medium text-gray-800 dark:text-gray-300">{driver.carModel}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-gray-500">Plate</span>
                                            <span className="font-medium text-gray-800 dark:text-gray-300 uppercase">{driver.plate}</span>
                                        </div>
                                    </div>

                                    <div className="absolute top-full left-1/2 -translate-x-1/2 border-8 border-transparent border-t-white dark:border-t-[#1a2c2c]/95"></div>
                                </div>
                            )}
                        </div>
                    );
                })}

                {/* Interactive Markers */}
                {markers.map((marker, index) => (
                    <div
                        key={marker.id}
                        data-marker-id={marker.id}
                        className={`absolute group z-20 ${draggingMarkerId === marker.id ? 'z-50 scale-110' : ''}`}
                        style={{ left: marker.x, top: marker.y }}
                    >
                        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 flex flex-col items-center cursor-grab active:cursor-grabbing transition-transform">

                            <div className={`bg-white dark:bg-[#1a2c2c] px-3 py-1.5 rounded-lg shadow-xl mb-2 whitespace-nowrap border border-gray-100 dark:border-gray-700 transition-opacity flex items-center gap-2 ${draggingMarkerId === marker.id ? 'opacity-100' : 'opacity-90 group-hover:opacity-100'}`}>
                                <div>
                                    <p className="text-xs font-bold text-gray-800 dark:text-white pointer-events-none select-none">{marker.label}</p>
                                    {marker.subLabel && <p className="text-[10px] text-gray-500 pointer-events-none select-none">{marker.subLabel}</p>}
                                </div>
                                {marker.type === 'stop' && (
                                    <button
                                        onClick={(e) => deleteMarker(e, marker.id)}
                                        className="text-gray-400 hover:text-red-500 transition-colors p-1 rounded-full hover:bg-gray-100 dark:hover:bg-white/10"
                                    >
                                        <span className="material-symbols-outlined text-[14px] block">delete</span>
                                    </button>
                                )}
                            </div>

                            {marker.type === 'pickup' && (
                                <div className="relative">
                                    <div className="w-4 h-4 bg-violet-600 rounded-full ring-4 ring-white dark:ring-[#1a2c2c] shadow-lg animate-pulse"></div>
                                </div>
                            )}
                            {marker.type === 'stop' && (
                                <div className="text-gray-800 dark:text-white drop-shadow-md hover:text-violet-600 transition-colors">
                                    <span className="material-symbols-outlined text-[32px] fill-current">location_on</span>
                                    <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-[10px] font-bold text-white mt-[-6px]">{index}</span>
                                </div>
                            )}
                            {marker.type === 'destination' && (
                                <div className="text-red-500 drop-shadow-md relative">
                                    <span className="material-symbols-outlined text-[40px]">location_on</span>
                                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full mt-[-6px]"></div>
                                </div>
                            )}
                            {marker.type === 'search-result' && (
                                <div className="text-purple-500 drop-shadow-md relative animate-bounce">
                                    <span className="material-symbols-outlined text-[40px]">location_on</span>
                                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-2 bg-white rounded-full mt-[-6px]"></div>
                                </div>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            {/* Fixed Center Pin for Location Selection */}
            {showPin && (
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 -mt-8 z-50 pointer-events-none drop-shadow-2xl animate-bounce">
                    <span className="material-symbols-outlined text-5xl text-violet-600">location_on</span>
                    <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-3 w-3 h-1.5 bg-black/20 rounded-full blur-[1px]"></div>
                </div>
            )}

            {/* Vehicle Selection Control - Bottom Center */}
            {onRideSelect && (
                <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-30 map-control-ignore map-ui-element animate-in fade-in">
                    <div className="bg-white dark:bg-[#1a2c2c] p-1.5 rounded-2xl shadow-xl border border-gray-100 dark:border-gray-700 flex items-center gap-1">
                        <button
                            onClick={() => onRideSelect('moto')}
                            className={`flex items-center gap-2 px-4 py-2 rounded-xl transition-all ${selectedRide === 'moto'
                                ? 'bg-violet-600 text-white font-bold shadow-sm'
                                : 'text-gray-800 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5'
                                }`}
                        >
                            <span className="material-symbols-outlined text-[20px]">two_wheeler</span>
                            <span className="text-sm">Moto</span>
                        </button>
                        <button
                            onClick={() => onRideSelect('standard')}
                            className={`flex items-center gap-2 px-4 py-2 rounded-xl transition-all ${selectedRide === 'standard'
                                ? 'bg-violet-600 text-white font-bold shadow-sm'
                                : 'text-gray-800 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5'
                                }`}
                        >
                            <span className="material-symbols-outlined text-[20px]">directions_car</span>
                            <span className="text-sm">Standard</span>
                        </button>
                        <button
                            onClick={() => onRideSelect('van')}
                            className={`flex items-center gap-2 px-4 py-2 rounded-xl transition-all ${selectedRide === 'van'
                                ? 'bg-violet-600 text-white font-bold shadow-sm'
                                : 'text-gray-800 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5'
                                }`}
                        >
                            <span className="material-symbols-outlined text-[20px]">airport_shuttle</span>
                            <span className="text-sm">Camioneta</span>
                        </button>
                    </div>
                </div>
            )}

            {/* Floating Map Controls */}
            <div className="absolute right-6 bottom-8 flex flex-col gap-2 z-20 map-control-ignore map-ui-element">
                <button onClick={recenter} className="bg-white dark:bg-[#1a2c2c] text-gray-800 dark:text-white p-2.5 rounded-lg shadow-lg hover:bg-gray-50 dark:hover:bg-[#233535] transition-colors border border-gray-100 dark:border-gray-700">
                    <span className="material-symbols-outlined block">my_location</span>
                </button>
                <div className="bg-white dark:bg-[#1a2c2c] rounded-lg shadow-lg flex flex-col overflow-hidden border border-gray-100 dark:border-gray-700">
                    <button onClick={zoomIn} className="text-gray-800 dark:text-white p-2.5 hover:bg-gray-50 dark:hover:bg-[#233535] transition-colors border-b border-gray-100 dark:border-gray-700">
                        <span className="material-symbols-outlined block">add</span>
                    </button>
                    <button onClick={zoomOut} className="text-gray-800 dark:text-white p-2.5 hover:bg-gray-50 dark:hover:bg-[#233535] transition-colors">
                        <span className="material-symbols-outlined block">remove</span>
                    </button>
                </div>
            </div>

            <div className="absolute bottom-2 left-2 md:left-[430px] lg:left-[490px] text-[10px] text-gray-400 pointer-events-none">
                © HIGO Maps • OpenStreetMap Contributors
            </div>
        </div>
    );
};

export default InteractiveMap;
