import React, { useState, useEffect, useRef } from 'react';
import { logger } from '../utils/logger';
import { reportError } from '../utils/reportError';

// LocationInput — Anexo C / M4.
//
// Migrado de AutocompleteService legacy a la nueva Google Places API
// (AutocompleteSuggestion + Place.fetchFields). Cobra POR SESIÓN
// completa (autocomplete queries + 1 details = 1 sesión cobrada), no
// por keystroke.
//
// Estrategia anti-billing:
//   1. Mientras el user escribe, primero matcheamos contra mock locations
//      LOCALES (Higuerote, 210+ puntos) — esto es free.
//   2. Si lo que escribe no matchea ≥1 mock con score alto, recién ahí
//      lanzamos query a Google. Usamos sessionToken único por flujo.
//   3. Al confirmar (handleSelect): resolvePrediction llama fetchFields
//      con el mismo sessionToken → Google cobra UNA sesión.
//   4. El sessionToken se descarta y se crea uno nuevo en el próximo
//      input (nuevo flujo = nueva sesión).
//
// Fallback ofline: si Google falla (sin red, sin key, 429), solo se
// muestran los mock matches. UX degrada gracefully.
//
// Compat: la firma de la prop onChange(value, place?) se mantiene
// idéntica al LocationInput viejo, así RequestRidePage no se toca.

import {
    loadPlacesLibrary,
    createSessionToken,
    fetchSuggestions,
    resolvePrediction,
} from '../services/placesNewService';

// Mocks de Higuerote — se importan lazy del geminiService para no
// inflar el bundle main. El array es estático, ~5KB.
const loadMockLocations = () =>
    import('../services/geminiService').then(m => m.MOCK_HIGUEROTE_LOCATIONS || []).catch(() => []);

const fuzzyScore = (query, place) => {
    const q = query.toLowerCase().trim();
    if (!q) return 0;
    const title = (place.title || '').toLowerCase();
    const address = (place.address || '').toLowerCase();
    if (title === q) return 100;
    if (title.startsWith(q)) return 90;
    if (title.includes(q)) return 70;
    if (address.includes(q)) return 40;
    return 0;
};

const LocationInput = ({
    placeholder,
    defaultValue = '',
    icon,
    iconColor = 'text-violet-600',
    showConnector = false,
    isLast = false,
    onRemove,
    onChange,
    onMapClick,
}) => {
    const [value, setValue] = useState(defaultValue);
    const [suggestions, setSuggestions] = useState([]); // [{ kind:'mock'|'google', title, address, prediction?, lat?, lng? }]
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [loading, setLoading] = useState(false);
    const wrapperRef = useRef(null);
    const inputRef = useRef(null);
    const mocksRef = useRef(null); // cache de mock locations
    const sessionTokenRef = useRef(null);
    const queryReqIdRef = useRef(0);

    // Sync external defaultValue → state.
    useEffect(() => { setValue(defaultValue); }, [defaultValue]);

    // Pre-cargar mocks una vez por mount.
    useEffect(() => {
        loadMockLocations().then((arr) => { mocksRef.current = arr; });
    }, []);

    // Crear session token al primer keystroke de una nueva búsqueda.
    // Se descarta cuando el user confirma (handleSelect) o queda
    // colgado hasta el próximo flujo — Google lo asume como abandono
    // gratis.
    const ensureSessionToken = async () => {
        if (sessionTokenRef.current) return sessionTokenRef.current;
        try {
            sessionTokenRef.current = await createSessionToken();
        } catch (err) {
            // Si Google no carga, sessionToken queda null y solo se
            // mostrarán mocks.
            logger.warn('[LocationInput] no session token (will use mocks only):', err?.message);
            sessionTokenRef.current = null;
        }
        return sessionTokenRef.current;
    };

    // Búsqueda debounced.
    useEffect(() => {
        if (!showSuggestions) return;
        if (!value || value.length < 2) {
            setSuggestions([]);
            return;
        }
        const reqId = ++queryReqIdRef.current;
        const timer = setTimeout(async () => {
            // 1) Match contra mocks (local, free).
            const mocks = mocksRef.current || [];
            const mockHits = mocks
                .map(m => ({ ...m, _score: fuzzyScore(value, m) }))
                .filter(m => m._score >= 40)
                .sort((a, b) => b._score - a._score)
                .slice(0, 4)
                .map(m => ({ kind: 'mock', title: m.title, address: m.address, lat: m.lat, lng: m.lng }));

            // 2) Si hay matches mock con score perfecto, no quemamos Google.
            //    Sino, query Places New.
            let googleHits = [];
            const topMockScore = mockHits[0]?._score || 0;
            if (topMockScore < 90) {
                setLoading(true);
                try {
                    const token = await ensureSessionToken();
                    if (token) {
                        const preds = await fetchSuggestions(value, token);
                        if (reqId === queryReqIdRef.current) {
                            googleHits = preds.slice(0, 5).map(p => ({
                                kind: 'google',
                                title: p.mainText || p.displayText,
                                address: p.secondaryText || p.displayText,
                                prediction: p.prediction,
                                placeId: p.placeId,
                            }));
                        }
                    }
                } catch (err) {
                    reportError(err, { source: 'LocationInput.fetchSuggestions', value });
                } finally {
                    if (reqId === queryReqIdRef.current) setLoading(false);
                }
            }

            if (reqId !== queryReqIdRef.current) return; // race: descartar

            // Merge: primero mocks (locales, ranking más confiable),
            // después Google. Sin duplicar por title.
            const seenTitles = new Set();
            const merged = [];
            mockHits.forEach((m) => {
                if (seenTitles.has(m.title.toLowerCase())) return;
                seenTitles.add(m.title.toLowerCase());
                merged.push(m);
            });
            googleHits.forEach((g) => {
                if (seenTitles.has(g.title.toLowerCase())) return;
                seenTitles.add(g.title.toLowerCase());
                merged.push(g);
            });

            setSuggestions(merged);
        }, 350);
        return () => clearTimeout(timer);
    }, [value, showSuggestions]);

    const handleChange = (e) => {
        const newVal = e.target.value;
        setValue(newVal);
        setShowSuggestions(true);
        if (onChange) onChange(newVal);
    };

    const handleSelect = async (item) => {
        setShowSuggestions(false);

        let finalPlace = item;
        if (item.kind === 'google' && item.prediction) {
            // Cobra el "details" cargado al sessionToken vigente.
            try {
                const resolved = await resolvePrediction(item.prediction);
                finalPlace = { ...item, ...resolved };
            } catch (err) {
                reportError(err, { source: 'LocationInput.resolvePrediction' });
            }
        }
        setValue(finalPlace.title || item.title || '');
        // Descartar sessionToken — flujo cerrado.
        sessionTokenRef.current = null;

        if (onChange) {
            onChange(finalPlace.title, {
                title: finalPlace.title,
                address: finalPlace.address,
                lat: finalPlace.lat,
                lng: finalPlace.lng,
                place_id: finalPlace.place_id || finalPlace.placeId,
            });
        }
    };

    // Cerrar al click fuera.
    useEffect(() => {
        const onClickOutside = (event) => {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
                setShowSuggestions(false);
            }
        };
        document.addEventListener('mousedown', onClickOutside);
        return () => document.removeEventListener('mousedown', onClickOutside);
    }, []);

    // Pre-cargar la lib Places al primer focus (anticipamos el primer
    // keystroke; al pasar 5s sin tipear no se cobra nada).
    const handleFocus = (e) => {
        e.target.select();
        loadPlacesLibrary().catch(() => { /* fallback puro de mocks */ });
        if (suggestions.length > 0) setShowSuggestions(true);
    };

    return (
        <div className="group relative flex flex-col w-full" ref={wrapperRef}>
            <div className="relative flex items-center w-full">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 flex flex-col items-center justify-center gap-1 z-10">
                    <span className={`material-symbols-outlined text-[20px] ${iconColor === 'text-violet-600' ? 'text-blue-600' : iconColor === 'text-secondary' ? 'text-gray-400' : 'text-red-500'}`}>{icon}</span>
                    {showConnector && (
                        <>
                            {!isLast && <div className="w-0.5 h-8 bg-blue-600/20 absolute -bottom-9"></div>}
                            <div className="w-0.5 h-6 bg-blue-600/20 absolute -top-8"></div>
                        </>
                    )}
                    {icon === 'my_location' && <div className="w-0.5 h-6 bg-blue-600/20 absolute -bottom-8"></div>}
                </div>

                <input
                    ref={inputRef}
                    className="w-full pl-14 pr-10 py-3 bg-gray-50 dark:bg-[#152323] border-0 rounded-lg text-gray-800 dark:text-white placeholder:text-gray-400 focus:ring-2 focus:ring-blue-600 font-medium shadow-sm transition-all focus:outline-none"
                    placeholder={placeholder}
                    type="text"
                    value={value}
                    onChange={handleChange}
                    onFocus={handleFocus}
                    autoComplete="off"
                    spellCheck={false}
                />

                {onRemove && (
                    <button
                        onClick={onRemove}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-red-500 transition-colors p-1"
                    >
                        <span className="material-symbols-outlined text-[18px]">close</span>
                    </button>
                )}

                {onMapClick && !onRemove && (
                    <button
                        onClick={onMapClick}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-blue-600 transition-colors p-1"
                        title="Fijar en mapa"
                    >
                        <span className="material-symbols-outlined text-[20px]">map</span>
                    </button>
                )}
            </div>

            {showSuggestions && (suggestions.length > 0 || loading) && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-[#233535] rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 z-[90] overflow-hidden animate-in fade-in">
                    {loading && suggestions.length === 0 && (
                        <div className="px-4 py-3 text-xs text-gray-500 flex items-center gap-2">
                            <span className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                            Buscando…
                        </div>
                    )}
                    {suggestions.map((place, idx) => (
                        <button
                            key={`${place.kind}-${idx}`}
                            onClick={() => handleSelect(place)}
                            className="w-full text-left px-4 py-3 hover:bg-gray-50 dark:hover:bg-black/20 border-b border-gray-200 dark:border-gray-700 last:border-0 flex items-center gap-3 transition-colors"
                        >
                            <span className="material-symbols-outlined text-gray-400">location_on</span>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <p className="text-sm font-bold text-gray-800 dark:text-white truncate">{place.title}</p>
                                    {place.kind === 'mock' && (
                                        <span className="bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300 text-[8px] font-bold px-1.5 py-0.5 rounded-full">
                                            HIGUEROTE
                                        </span>
                                    )}
                                </div>
                                <p className="text-xs text-gray-500 truncate">{place.address}</p>
                            </div>
                        </button>
                    ))}
                    <div className="bg-blue-50 dark:bg-blue-950/40 px-4 py-1.5 text-[10px] text-gray-500 dark:text-blue-300 flex items-center justify-between">
                        <span>Sugerencias de ubicación</span>
                        <span className="material-symbols-outlined text-[12px]">search</span>
                    </div>
                </div>
            )}
        </div>
    );
};

export default LocationInput;
