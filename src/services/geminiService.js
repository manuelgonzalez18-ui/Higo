import { GoogleGenAI } from "@google/genai";

// Initialize Gemini Client
// Initialize Gemini Client
const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
if (!API_KEY) console.warn("Missing VITE_GEMINI_API_KEY in .env");
const ai = new GoogleGenAI({ apiKey: API_KEY });

// 1. Maps Grounding Service
export const searchPlaces = async (query, userLocation) => {
    try {
        // Note: This model name "gemini-2.5-flash" comes from the snippet. 
        // Ensure this model is available to your API Key.
        // Falling back to 2.0-flash as it is more stable.
        const response = await ai.models.generateContent({
            model: "gemini-2.0-flash",
            contents: `Find 3 places matching "${query}" in Higuerote, Venezuela. Return the result as a list of places.`,
            config: {
                tools: [{ googleMaps: {} }],
                toolConfig: userLocation ? {
                    retrievalConfig: {
                        latLng: {
                            latitude: userLocation.lat,
                            longitude: userLocation.lng
                        }
                    }
                } : undefined,
            },
        });

        const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
        const suggestions = [];

        if (chunks) {
            chunks.forEach((chunk) => {
                if (chunk.web?.uri && chunk.web?.title) {
                    // Mock coordinates near Higuerote for demo purposes since Grounding doesn't typically return lat/lng directly in this chunk format
                    // In a real app, you would use Geocoding API or Places API Details
                    const baseLat = 10.486;
                    const baseLng = -66.094;
                    const randomOffset = () => (Math.random() - 0.5) * 0.02; // Roughly 2km variance

                    suggestions.push({
                        title: chunk.web.title,
                        address: "Ver en Mapa",
                        uri: chunk.web.uri,
                        lat: baseLat + randomOffset(),
                        lng: baseLng + randomOffset()
                    });
                }
            });
        }

        // Mock results if AI fails to return valid chunks or no key
        if (suggestions.length === 0) {
            return [
                { title: "Panaderia Bisau", address: "Higuerote, Miranda", lat: 10.48424, lng: -66.09871 },
                { title: "Alamar", address: "Higuerote, Miranda", lat: 10.412485185404462, lng: -66.1378176707 },
                { title: "Asocanales", address: "Higuerote, Miranda", lat: 10.498549543479797, lng: -66.1134562060818 },
                { title: "Residencia Marina Caribe", address: "Higuerote, Miranda", lat: 10.467131341169896, lng: -66.11266963515165 },
                { title: "Barrio Ajuro", address: "Higuerote, Miranda", lat: 10.483529085105532, lng: -66.10358083847191 },
                { title: "Belen", address: "Higuerote, Miranda", lat: 10.382768313794767, lng: -66.11422048727452 },
                { title: "Birongo", address: "Higuerote, Miranda", lat: 10.482504309904929, lng: -66.23813050633483 },
                { title: "Bosque de Curiepe", address: "Higuerote, Miranda", lat: 10.46071080081163, lng: -66.17747378136937 },
                { title: "Brisas del Cocal", address: "Higuerote, Miranda", lat: 10.485371658181556, lng: -66.10726964277275 },
                { title: query + " (Demo)", address: "Higuerote, VE", lat: 10.4806, lng: -66.0987 },
                { title: "Playa Los Totumos", address: "Higuerote", lat: 10.5123, lng: -66.0712 },
                { title: "Puerto Encantado", address: "Higuerote", lat: 10.4732, lng: -66.1245 },
                { title: "Club Puerto Azul", address: "Naiguatá (Demo)", lat: 10.6012, lng: -66.7321 }
            ];
        }

        return suggestions;
    } catch (error) {
        console.error("Maps search error:", error);
        // Return mock data for demo purposes since we likely don't have a valid GenAI key configured yet
        return [
            { title: "Panaderia Bisau", address: "Higuerote, Miranda", lat: 10.48424, lng: -66.09871 },
            { title: "Alamar", address: "Higuerote, Miranda", lat: 10.412485185404462, lng: -66.1378176707 },
            { title: "Asocanales", address: "Higuerote, Miranda", lat: 10.498549543479797, lng: -66.1134562060818 },
            { title: "Residencia Marina Caribe", address: "Higuerote, Miranda", lat: 10.467131341169896, lng: -66.11266963515165 },
            { title: "Barrio Ajuro", address: "Higuerote, Miranda", lat: 10.483529085105532, lng: -66.10358083847191 },
            { title: "Belen", address: "Higuerote, Miranda", lat: 10.382768313794767, lng: -66.11422048727452 },
            { title: "Birongo", address: "Higuerote, Miranda", lat: 10.482504309904929, lng: -66.23813050633483 },
            { title: "Bosque de Curiepe", address: "Higuerote, Miranda", lat: 10.46071080081163, lng: -66.17747378136937 },
            { title: "Brisas del Cocal", address: "Higuerote, Miranda", lat: 10.485371658181556, lng: -66.10726964277275 },
            { title: "Playa Los Totumos", address: "Higuerote, Miranda", lat: 10.5123, lng: -66.0712 },
            { title: "Centro Comercial Flamingo", address: "Higuerote, Miranda", lat: 10.4850, lng: -66.0950 },
            { title: "Club Puerto Azul", address: "Naiguatá", lat: 10.6012, lng: -66.7321 }
        ];
    }
};

// 2. Chat Service
export const chatWithAI = async (message, history) => {
    try {
        const chat = ai.chats.create({
            model: 'gemini-2.0-flash', // Using 2.0 flash which is widely available
            history: history,
            config: {
                systemInstruction: "You are a helpful assistant for HIGO, a ride-sharing app in Higuerote, Venezuela. Keep answers concise and helpful.",
            },
        });

        const result = await chat.sendMessage({ message });
        return result.text;
    } catch (error) {
        console.error("Chat error:", error);
        return "I'm having trouble connecting right now. Please try again later. (Check API Key)";
    }
};

// 3. Text-to-Speech Service
export const generateSpeech = async (text) => {
    try {
        // This is a hypothetical model/endpoint from the snippet.
        const response = await ai.models.generateContent({
            model: "gemini-2.0-flash-exp",
            contents: [{ parts: [{ text }] }],
            config: {
                responseModalities: ["AUDIO"],
                speechConfig: {
                    voiceConfig: {
                        prebuiltVoiceConfig: { voiceName: 'Kore' },
                    },
                },
            },
        });

        const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (!base64Audio) return null;

        const binaryString = atob(base64Audio);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }

        const audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
        const audioBuffer = await audioContext.decodeAudioData(bytes.buffer);
        return audioBuffer;

    } catch (error) {
        console.error("TTS error:", error);
        return null;
    }
};

export const playAudioBuffer = (buffer) => {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContext.destination);
    source.start(0);
};
