import { LocalNotifications } from '@capacitor/local-notifications';
import { toast } from '../components/Toast';

const LEGACY_ARRIVAL_NOTIFICATION = '🚗 ¡Tu Higo Driver ha llegado!';
const LEGACY_ARRIVAL_TOAST = '🔔 ¡Tu Higo Driver ha llegado!';
const TRIP_STARTED_MESSAGE = '🚗 ¡Tu viaje ha comenzado!';

// Compatibilidad temporal para clientes que todavía emiten el texto de llegada
// al recibir la transición `in_progress`. La llegada real ahora se anuncia al
// persistirse `arrived_at_pickup_at`; por lo tanto `in_progress` debe indicar
// únicamente que el viaje comenzó.
const originalSuccess = toast.success;
toast.success = (message, options) => originalSuccess(
    message === LEGACY_ARRIVAL_TOAST ? TRIP_STARTED_MESSAGE : message,
    options,
);

try {
    const originalSchedule = LocalNotifications.schedule.bind(LocalNotifications);
    LocalNotifications.schedule = (options = {}) => originalSchedule({
        ...options,
        notifications: Array.isArray(options.notifications)
            ? options.notifications.map((notification) => (
                notification?.body === LEGACY_ARRIVAL_NOTIFICATION
                    ? { ...notification, body: TRIP_STARTED_MESSAGE }
                    : notification
            ))
            : options.notifications,
    });
} catch (error) {
    // En navegadores sin implementación nativa el toast corregido sigue siendo
    // suficiente; nunca se debe interrumpir el seguimiento del viaje.
    console.warn('[PassengerStatusMessageCompat] LocalNotifications no se pudo envolver:', error);
}
