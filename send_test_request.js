import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const admin = require('firebase-admin');

// -------------------------------------------------------------
// CONFIGURACIÓN
// -------------------------------------------------------------
// 1. Asegúrate de tener el archivo 'service-account.json' en esta misma carpeta (higo-app).
// 2. Pega aquí el TOKEN del dispositivo
const DEVICE_TOKEN = 'PEGAR_TOKEN_DEL_DISPOSITIVO_AQUI';
// -------------------------------------------------------------

const SERVICE_ACCOUNT_FILE = './service-account.json';

try {
    const serviceAccount = require(SERVICE_ACCOUNT_FILE);

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
} catch (e) {
    console.error("ERROR: No se encontró el archivo 'service-account.json'.");
    console.error("1. Ve a Firebase Console > Configuración del proyecto > Cuentas de servicio.");
    console.error("2. Genera una nueva clave privada.");
    console.error("3. Guarda el archivo como 'service-account.json' en la carpeta 'higo-app'.");
    process.exit(1);
}

const message = {
    token: DEVICE_TOKEN,
    data: {
        type: 'ride_request',
        title: 'Nuevo Viaje (Test V1)',
        body: 'Pasajero esperando en Centro...',
        price: '2.5',
        distance: '3.5 km',
        duration: '12 min',
        pickupLocation: 'Plaza Altamira',
        pickupAddress: 'Av. Francisco de Miranda',
        dropoffLocation: 'CCCT',
        dropoffAddress: 'Chuao',
        delivery_info: {
            description: "Paquete de documentos",
            destInstructions: "Entregar en recepción a la Sra. Martinez.",
            originInstructions: "Pasar buscando por la oficina 3B.",
            senderName: "Juan Pérez (Remitente)",
            senderPhone: "+58 412 123 4567",
            receiverName: "Ana García (Destinatario)",
            receiverPhone: "+58 414 987 6543",
            payer: "sender" // Change to 'receiver' to test other flow
        }
    },
    android: {
        priority: 'high',
        ttl: 0 // Entrega inmediata
    }
};

console.log("Enviando mensaje a:", DEVICE_TOKEN.substring(0, 20) + "...");

admin.messaging().send(message)
    .then((response) => {
        console.log('¡Éxito! Mensaje enviado:', response);
    })
    .catch((error) => {
        console.log('Error enviando mensaje:', error);
    });
