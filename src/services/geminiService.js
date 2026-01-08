import { GoogleGenAI } from "@google/genai";

// Initialize Gemini Client
const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
if (!API_KEY) console.warn("Missing VITE_GEMINI_API_KEY in .env");
const ai = new GoogleGenAI({ apiKey: API_KEY });

// Mock Data for Fallback
const MOCK_LOCATIONS = [
    { title: "Panaderia Bisau", address: "Higuerote, Miranda", lat: 10.48424, lng: -66.09871 },
    { title: "Alamar", address: "Higuerote, Miranda", lat: 10.412485185404462, lng: -66.1378176707 },
    { title: "Asocanales", address: "Higuerote, Miranda", lat: 10.498549543479797, lng: -66.1134562060818 },
    { title: "Residencia Marina Caribe", address: "Higuerote, Miranda", lat: 10.467131341169896, lng: -66.11266963515165 },
    { title: "Barrio Ajuro", address: "Higuerote, Miranda", lat: 10.483529085105532, lng: -66.10358083847191 },
    { title: "Belen", address: "Higuerote, Miranda", lat: 10.382768313794767, lng: -66.11422048727452 },
    { title: "Birongo", address: "Higuerote, Miranda", lat: 10.482504309904929, lng: -66.23813050633483 },
    { title: "Bosque de Curiepe", address: "Higuerote, Miranda", lat: 10.46071080081163, lng: -66.17747378136937 },
    { title: "Brisas del Cocal", address: "Higuerote, Miranda", lat: 10.485371658181556, lng: -66.10726964277275 },
    { title: "Buche Urbanizacion", address: "Higuerote, Miranda", lat: 10.547088443855559, lng: -66.09523336382708 },
    { title: "Cabo Codera", address: "Higuerote, Miranda", lat: 10.475673126024594, lng: -66.09953026275525 },
    { title: "C.C Cabo Mall", address: "Higuerote, Miranda", lat: 10.470893934731668, lng: -66.10183696237596 },
    { title: "Calle Larga", address: "Higuerote, Miranda", lat: 10.477202873689913, lng: -66.10422949262944 },
    { title: "Camaronera", address: "Higuerote, Miranda", lat: 10.54827675686517, lng: -66.1378337782917 },
    { title: "Caño Madrid", address: "Higuerote, Miranda", lat: 10.43731332967169, lng: -66.05738433869561 },
    { title: "Capaya", address: "Higuerote, Miranda", lat: 10.428762559434038, lng: -66.27345603583123 },
    { title: "Carenero", address: "Higuerote, Miranda", lat: 10.530882839293874, lng: -66.11379162734633 },
    { title: "Casitas Azules", address: "Higuerote, Miranda", lat: 10.475657842358942, lng: -66.1105550329455 },
    { title: "C.I.C.P.C Higuerote", address: "Higuerote, Miranda", lat: 10.465925499578404, lng: -66.10503556941445 },
    { title: "Aguasal", address: "Higuerote, Miranda", lat: 10.468432536882966, lng: -66.09005766779443 },
    { title: "Chirimena", address: "Higuerote, Miranda", lat: 10.605334622192906, lng: -66.17343061545287 },
    { title: "C.I.C.P.C Higuerote", address: "Higuerote, Miranda", lat: 10.465925499578404, lng: -66.10503556941445 },
    { title: "Ciudad Balneario", address: "Higuerote, Miranda", lat: 10.492664186819404, lng: -66.1080637833722 },
    { title: "Ciudad Brion Marin", address: "Higuerote, Miranda", lat: 10.417833320209372, lng: -66.098501708181 },
    { title: "Ciudad Brion Segunda Etapa", address: "Higuerote, Miranda", lat: 10.42556782090137, lng: -66.09201076245094 },
    { title: "Colinas de Tacarigua", address: "Higuerote, Miranda", lat: 10.404504851406475, lng: -66.1434394321293 },
    { title: "Corrales", address: "Higuerote, Miranda", lat: 10.607333000853268, lng: -66.1636834682879 },
    { title: "El Cien (100)", address: "Higuerote, Miranda", lat: 10.39483868070011, lng: -66.13243164608072 },
    { title: "La Ceiba", address: "Higuerote, Miranda", lat: 10.475657842358942, lng: -66.1105550329455 },
    { title: "Residencias Hipo Campo", address: "Higuerote, Miranda", lat: 10.477586530990964, lng: -66.10336571853655 },
    { title: "Residencias Quita Sol", address: "Higuerote, Miranda", lat: 10.476895508840414, lng: -66.10439568671667 },
    { title: "Tacarigua", address: "Higuerote, Miranda", lat: 10.465925499578404, lng: -66.10503556941445 },
    { title: "Universidad Argelia Alaya Higuerote", address: "Higuerote, Miranda", lat: 10.477354432124184, lng: -66.10308676881971 },
    { title: "Urb Costa Grande", address: "Higuerote, Miranda", lat: 10.454771436076511, lng: -66.1104038351519 },
    { title: "Urb Emilio Gonzalez Marin", address: "Higuerote, Miranda", lat: 10.475657842358942, lng: -66.1105550329455 },
    { title: "Urb la Arboleda (El 50)", address: "Higuerote, Miranda", lat: 10.405655063578763, lng: -66.1461645559027 },
    { title: "Urb Campomar", address: "Higuerote, Miranda", lat: 10.423195351936672, lng: -66.12350615494626 },
    { title: "Dos Caminos Parte Baja", address: "Higuerote, Miranda", lat: 10.435378234258888, lng: -66.11125078621103 },
    { title: "Dos Caminos Subida del Camello", address: "Higuerote, Miranda", lat: 10.432819514299345, lng: -66.11090209914373 },
    { title: "Dos Caminos Transito", address: "Higuerote, Miranda", lat: 10.432819514299345, lng: -66.11090209914373 },
    { title: "Muelle de Cuchivano", address: "Higuerote, Miranda", lat: 10.490002391534263, lng: -66.0956105063566 },
    { title: "Curiepe", address: "Higuerote, Miranda", lat: 10.474252096311538, lng: -66.16559159635693 },
    { title: "El INCRET", address: "Higuerote, Miranda", lat: 10.466602271653805, lng: -66.08824690317904 },
    { title: "Conjunto Residencial El Paraiso Sol", address: "Higuerote, Miranda", lat: 10.422219185606785, lng: -66.10169549853701 },
    { title: "El Dividivi", address: "Higuerote, Miranda", lat: 10.468574387663173, lng: -66.11539200816321 },
    { title: "Estanciamar", address: "Higuerote, Miranda", lat: 10.41712381311262, lng: -66.0967668578242 },
    { title: "Gamelotal", address: "Higuerote, Miranda", lat: 10.403481082608838, lng: -66.20307385430911 },
    { title: "Guayacan", address: "Higuerote, Miranda", lat: 10.535070475486249, lng: -66.1220527703596 },
    { title: "Hospital Universitario General de Higuerote", address: "Higuerote, Miranda", lat: 10.474885053128025, lng: -66.10787550619183 },
    { title: "Hotel Agua Marina", address: "Higuerote, Miranda", lat: 10.468432536882966, lng: -66.09005766779443 },
    { title: "Hotel Puente Machado", address: "Higuerote, Miranda", lat: 10.401550909168895, lng: -66.16754903270287 },
    { title: "INASS -INAGER", address: "Higuerote, Miranda", lat: 10.46568159205526, lng: -66.11407243242002 },
    { title: "Isla de la Fantasia", address: "Higuerote, Miranda", lat: 10.481643860534366, lng: -66.11130975678007 },
    { title: "Las Delicias", address: "Higuerote, Miranda", lat: 10.48218190020157, lng: -66.10479735316714 },
    { title: "Las Maravillas", address: "Higuerote, Miranda", lat: 10.363500505947375, lng: -66.16892897102714 },
    { title: "Las Gonzalez", address: "Higuerote, Miranda", lat: 10.403700908099774, lng: -66.18373459769425 },
    { title: "Las Martinez", address: "Higuerote, Miranda", lat: 10.404064967458327, lng: -66.19121796076742 },
    { title: "Las Morochas", address: "Higuerote, Miranda", lat: 10.413521459649557, lng: -66.2457596135795 },
    { title: "Las Toros", address: "Higuerote, Miranda", lat: 10.36275543438238, lng: -66.22527766296433 },
    { title: "Las Velitas (3 de Junio)", address: "Higuerote, Miranda", lat: 10.475826642453695, lng: -66.10848704992625 },
    { title: "Lagoven - Oso Cotiza", address: "Higuerote, Miranda", lat: 10.535070475486249, lng: -66.1220527703596 },
    { title: "La Maturetera", address: "Higuerote, Miranda", lat: 10.409734197276734, lng: -66.23444415180826 },
    { title: "La Costanera", address: "Higuerote, Miranda", lat: 10.468432536882966, lng: -66.09005766779443 },
    { title: "Playa Los Totumos", address: "Higuerote, Miranda", lat: 10.547300673976322, lng: -66.0799098 },
    { title: "Mamporal - Plaza - Maurica", address: "Higuerote, Miranda", lat: 10.367100121777433, lng: -66.13455286537514 },
    { title: "Playa Puerto Frances", address: "Higuerote, Miranda", lat: 10.574257839917157, lng: -66.06795518433181 },
    { title: "Maturin Centro", address: "Higuerote, Miranda", lat: 10.403236523746722, lng: -66.16231240598361 },
    { title: "Mesa Grande Parte Baja", address: "Higuerote, Miranda", lat: 10.463265552512356, lng: -66.11863218742052 },
    { title: "Mesa Grande Parte Alta", address: "Higuerote, Miranda", lat: 10.45604897311753, lng: -66.1241253512522 },
    { title: "Moron", address: "Higuerote, Miranda", lat: 10.464640844200634, lng: -66.1759020082631 },
    { title: "Nuevo Carenero", address: "Higuerote, Miranda", lat: 10.534599457633282, lng: -66.12990488912718 },
    { title: "Planta PDVSA", address: "Higuerote, Miranda", lat: 10.555861950091172, lng: -66.07230327861782 },
    { title: "Prado Largo - Entrada", address: "Higuerote, Miranda", lat: 10.401437398939402, lng: -66.18970519472253 },
    { title: "Urbanizacion Nautica Puerto Encantado", address: "Higuerote, Miranda", lat: 10.488119741712058, lng: -66.11200177745367 },
    { title: "Conjunto Residencial Parque Adonay", address: "Higuerote, Miranda", lat: 10.402853392519908, lng: -66.15247847642007 },
    { title: "Pueblo Seco", address: "Higuerote, Miranda", lat: 10.577480953179709, lng: -66.21296878854798 },
    { title: "Rancho Grande", address: "Higuerote, Miranda", lat: 10.468432536882966, lng: -66.09005766779443 },
    { title: "Radio Costera", address: "Higuerote, Miranda", lat: 10.490497591733575, lng: -66.10994618099599 },
    { title: "Salgado", address: "Higuerote, Miranda", lat: 10.474411290050185, lng: -66.21098265418635 },
    { title: "San Luis", address: "Higuerote, Miranda", lat: 10.479833118700869, lng: -66.10247219886672 },
    { title: "San Vicente", address: "Higuerote, Miranda", lat: 10.3733267355515, lng: -66.15960469619428 },
    { title: "San Juan la Troja", address: "Higuerote, Miranda", lat: 10.31617086484119, lng: -66.07095104121329 },
    { title: "San Francisquito", address: "Higuerote, Miranda", lat: 10.560028799276422, lng: -66.05638657172642 },
    { title: "Sotillo", address: "Higuerote, Miranda", lat: 10.534599457633282, lng: -66.12990488912718 },
    { title: "Playa Valle Seco", address: "Higuerote, Miranda", lat: 10.51475914621681, lng: -66.11535773511726 },
    { title: "Tacarigua - Estadio", address: "Higuerote, Miranda", lat: 10.394126369102322, lng: -66.14693703269718 },
    { title: "Tacarigüita", address: "Higuerote, Miranda", lat: 10.441764089160975, lng: -66.21214136498637 },
    { title: "Terra El Mango - El Jobo", address: "Higuerote, Miranda", lat: 10.446797036502634, lng: -66.11770061298945 },
    { title: "Yaguapa", address: "Higuerote, Miranda", lat: 10.388269504276094, lng: -66.29057146950038 },
    { title: "El Zancudo", address: "Higuerote, Miranda", lat: 10.468432536882966, lng: -66.09005766779443 },
    { title: "Zona del Este", address: "Higuerote, Miranda", lat: 10.476571932177347, lng: -66.09563391238734 },
    { title: "Aricagua", address: "Higuerote, Miranda", lat: 10.580681683061407, lng: -66.23353610167855 },
    { title: "Caucagua Centro", address: "Higuerote, Miranda", lat: 10.28824727184857, lng: -66.37523958609698 },
    { title: "Caucagua - Los Cocos", address: "Higuerote, Miranda", lat: 10.279548732262098, lng: -66.3523013346876 },
    { title: "Caucagua - Marizapa", address: "Higuerote, Miranda", lat: 10.279866987267152, lng: -66.3623143844232 },
    { title: "Chirere", address: "Higuerote, Miranda", lat: 10.617765815448083, lng: -66.19015934489563 },
    { title: "Chuspa", address: "Higuerote, Miranda", lat: 10.61642674922747, lng: -66.31297765334563 },
    { title: "Paparo", address: "Higuerote, Miranda", lat: 10.379405636698834, lng: -65.98862222551986 },
    { title: "Guayabal", address: "Higuerote, Miranda", lat: 10.586519219087986, lng: -66.30819794578676 },
    { title: "Rio Chico Centro", address: "Higuerote, Miranda", lat: 10.31823557751452, lng: -65.97892152006963 },
    { title: "San Jose Centro", address: "Higuerote, Miranda", lat: 10.302825615602371, lng: -65.99468008929469 },
    { title: "Tacarigua de la Laguna", address: "Higuerote, Miranda", lat: 10.305185073476565, lng: -65.8769417859132 },
    { title: "El Clavo", address: "Higuerote, Miranda", lat: 10.22492025611194, lng: -66.17422574680374 },
    { title: "Centro Comercial Flamingo", address: "Higuerote, Miranda", lat: 10.467939872322962, lng: -66.10413829765304 },
    { title: "Club Puerto Azul", address: "Naiguatá (Demo)", lat: 10.6012, lng: -66.7321 },
    { title: "Puerto Encantado", address: "Higuerote", lat: 10.4732, lng: -66.1245 }
];

// 1. Maps Grounding Service
export const searchPlaces = async (query, userLocation) => {
    // Helper to filter mock suggestions
    const getFilteredSuggestions = () => {
        if (!query) return [];
        const lowerQ = query.toLowerCase();
        return MOCK_LOCATIONS.filter(place =>
            place.title.toLowerCase().includes(lowerQ) ||
            place.address.toLowerCase().includes(lowerQ)
        );
    };

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

        // Return filtered mock results if AI fails to return valid chunks
        if (suggestions.length === 0) {
            return getFilteredSuggestions();
        }

        return suggestions;
    } catch (error) {
        console.error("Maps search error:", error);
        // Return filtered mock data for demo purposes since we likely don't have a valid GenAI key configured yet
        return getFilteredSuggestions();
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
