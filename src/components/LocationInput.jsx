import React, { useState, useEffect, useRef } from 'react';
import { searchPlaces } from '../services/geminiService';

const LocationInput = ({
    placeholder,
    defaultValue = '',
    icon,
    iconColor = 'text-violet-600',
    showConnector = false,
    isLast = false,
    onRemove,
    onChange,
    onMapClick
}) => {
    const [value, setValue] = useState(defaultValue);
    const [suggestions, setSuggestions] = useState([]);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [isTyping, setIsTyping] = useState(false);
    const wrapperRef = useRef(null);
    const inputRef = useRef(null);

    // Sync state with defaultValue if it changes from outside
    useEffect(() => {
        setValue(defaultValue);
    }, [defaultValue]);

    // Debounce search
    useEffect(() => {
        const timer = setTimeout(async () => {
            if (isTyping && value.length > 2) { // Reduced from 3 to 2
                const results = await searchPlaces(value);
                setSuggestions(results);
                setShowSuggestions(true);
            }
        }, 500); // Reduced from 1000 to 500ms debounce

        return () => clearTimeout(timer);
    }, [value, isTyping]);

    const handleChange = (e) => {
        const newVal = e.target.value;
        setValue(newVal);
        setIsTyping(true);
        if (onChange) onChange(newVal);
    };

    const handleSelect = (place) => {
        setValue(place.title);
        setShowSuggestions(false);
        setIsTyping(false);
        // Pass full place object including coords (if available from Gemini/Google)
        if (onChange) onChange(place.title, place);
    };

    // Close on click outside
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
                setShowSuggestions(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    return (
        <div className="group relative flex items-center" ref={wrapperRef}>
            <div className="absolute left-3 top-1/2 -translate-y-1/2 flex flex-col items-center justify-center gap-1 z-10">
                <span className={`material-symbols-outlined text-[20px] ${iconColor === 'text-violet-600' ? 'text-blue-600' : iconColor === 'text-secondary' ? 'text-gray-400' : 'text-red-500'}`}>{icon}</span>
                {showConnector && (
                    <>
                        {!isLast && <div className="w-0.5 h-8 bg-blue-600/20 absolute -bottom-9"></div>}
                        <div className="w-0.5 h-6 bg-blue-600/20 absolute -top-8"></div>
                    </>
                )}
                {/* For the first item usually */}
                {icon === 'my_location' && <div className="w-0.5 h-6 bg-blue-600/20 absolute -bottom-8"></div>}
            </div>

            <input
                ref={inputRef}
                className="w-full pl-14 pr-10 py-3 bg-gray-50 dark:bg-[#152323] border-0 rounded-lg text-gray-800 dark:text-white placeholder:text-gray-400 focus:ring-2 focus:ring-blue-600 font-medium shadow-sm transition-all focus:outline-none"
                placeholder={placeholder}
                type="text"
                value={value}
                onChange={handleChange}
                onFocus={(e) => {
                    e.target.select(); // Better UX for "Ubicación Actual"
                    if (suggestions.length > 0) setShowSuggestions(true);
                }}
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

            {showSuggestions && suggestions.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-[#233535] rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 z-50 overflow-hidden animate-in fade-in">
                    {suggestions.map((place, idx) => (
                        <button
                            key={idx}
                            onClick={() => handleSelect(place)}
                            className="w-full text-left px-4 py-3 hover:bg-gray-50 dark:hover:bg-black/20 border-b border-gray-200 dark:border-gray-700 last:border-0 flex items-center gap-3 transition-colors"
                        >
                            <span className="material-symbols-outlined text-gray-400">location_on</span>
                            <div>
                                <p className="text-sm font-bold text-gray-800 dark:text-white">{place.title}</p>
                                <p className="text-xs text-gray-500">{place.address}</p>
                            </div>
                        </button>
                    ))}
                    <div className="bg-blue-50 px-4 py-1 text-[10px] text-gray-500 flex items-center justify-between">
                        <span>Sugerencias de Google Maps</span>
                        <span className="material-symbols-outlined text-[12px]">google</span>
                    </div>
                </div>
            )}
        </div>
    );
};

export default LocationInput;
