from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    text = file_path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one match, found {count}\n--- needle ---\n{old}")
    file_path.write_text(text.replace(old, new, 1), encoding="utf-8")


def replace_between(path: str, start_marker: str, end_marker: str, replacement: str) -> None:
    file_path = Path(path)
    text = file_path.read_text(encoding="utf-8")
    start = text.find(start_marker)
    if start < 0:
        raise SystemExit(f"{path}: start marker not found: {start_marker!r}")
    end = text.find(end_marker, start)
    if end < 0:
        raise SystemExit(f"{path}: end marker not found: {end_marker!r}")
    if text.find(start_marker, start + 1) >= 0:
        raise SystemExit(f"{path}: start marker is not unique")
    file_path.write_text(text[:start] + replacement + text[end:], encoding="utf-8")


# Motorcycle image is a side-profile asset. It must stay upright; only top-down
# car/van assets should rotate with the GPS bearing.
replace_once(
    "src/components/InteractiveMapGoogle.jsx",
    "import { MotoIcon, StandardIcon, VanIcon, PassengerPin, DestinationPin } from '../assets/markers';\n",
    "import { MotoIcon, StandardIcon, VanIcon, PassengerPin, DestinationPin } from '../assets/markers';\n"
    "import { resolveVehicleMarkerRotation } from '../utils/vehicleMarkerRotation';\n",
)

replace_once(
    "src/components/InteractiveMapGoogle.jsx",
    """// Helper component to handle smooth rotation and asset offset (-90deg for car_top_view)
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
""",
    """// Directional top-down assets follow the GPS bearing. The motorcycle
// illustration is a side profile and remains upright to avoid looking fallen.
const VehicleIconWithHeading = ({ heading, type, isLarge }) => {
    const smoothHeading = useSmoothHeading(heading);
    const rotation = resolveVehicleMarkerRotation({ heading: smoothHeading, type });

    return (
        <div
            style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
                transition: 'transform 0.3s ease-out',
                pointerEvents: 'none'
            }}
        >
""",
)


# Close two first-message races:
# 1. INSERT can happen between the history query and Realtime SUBSCRIBED.
# 2. Android channel/permission setup may still be running when the first INSERT
#    arrives. The notification now waits for setup and a catch-up query recovers
#    messages from the startup grace window.
replace_once(
    "src/components/ChatWidget.jsx",
    "import { vibrateIntense, playAlertSound } from '../services/notificationService';\n",
    "import { vibrateIntense, playAlertSound } from '../services/notificationService';\n"
    "import { getRideMessageKey, isRideMessageAtOrAfter } from '../utils/rideMessageSync';\n",
)

replace_once(
    "src/components/ChatWidget.jsx",
    """    const messagesEndRef = useRef(null);
    const isOpenRef = useRef(false);
    const userIdRef = useRef(null);
""",
    """    const messagesEndRef = useRef(null);
    const isOpenRef = useRef(false);
    const userIdRef = useRef(null);
    const notifiedMessageKeysRef = useRef(new Set());
    const notificationSetupPromiseRef = useRef(Promise.resolve());
""",
)

replace_once(
    "src/components/ChatWidget.jsx",
    """        void setupNotifications();
        return () => {
""",
    """        notificationSetupPromiseRef.current = setupNotifications();
        void notificationSetupPromiseRef.current;
        return () => {
""",
)

new_subscription_effect = r'''    useEffect(() => {
        if (!rideId) return undefined;

        let cancelled = false;
        const syncStartedAt = new Date().toISOString();
        const catchUpSince = new Date(Date.now() - 30000).toISOString();
        notifiedMessageKeysRef.current = new Set();

        const notifyIncomingMessage = (incoming) => {
            if (!incoming || cancelled) return;

            setMessages((current) => mergeMessages(current, [incoming]));

            const messageKey = getRideMessageKey(incoming);
            if (notifiedMessageKeysRef.current.has(messageKey)) return;
            notifiedMessageKeysRef.current.add(messageKey);

            if (incoming.sender_id === userIdRef.current) return;

            const preview = getMessagePreview(incoming.content);
            const chatIsOpen = isOpenRef.current;

            // Mientras el chat está abierto emitimos el sonido directamente.
            // Cuando está cerrado, Android espera a que el canal esté listo y
            // luego muestra el banner con alert_sound.wav.
            if (!Capacitor.isNativePlatform() || chatIsOpen) {
                void playAlertSound();
                vibrateIntense();
            }

            if (chatIsOpen) return;

            setUnreadCount((current) => current + 1);
            toast.info(`Nuevo mensaje del viaje: ${preview}`, {
                duration: 6000,
                action: {
                    label: 'Abrir chat',
                    onClick: () => setIsOpen(true),
                },
            });

            if (!Capacitor.isNativePlatform()) return;

            const notificationId = Math.floor(Date.now() % 2147483647);
            const scheduleNativeNotification = async () => {
                try {
                    await notificationSetupPromiseRef.current;
                    await LocalNotifications.schedule({
                        notifications: [{
                            title: 'Nuevo mensaje del viaje',
                            body: preview,
                            id: notificationId,
                            schedule: { at: new Date(Date.now() + 150) },
                            sound: 'alert_sound.wav',
                            channelId: CHAT_CHANNEL_ID,
                            extra: { rideId },
                        }],
                    });
                } catch (error) {
                    console.warn('[ride-chat] local notification failed:', error);
                    // Si el permiso o canal nativo falla, todavía intentamos el
                    // sonido interno para que el mensaje no llegue en silencio.
                    void playAlertSound();
                    vibrateIntense();
                }
            };
            void scheduleNativeNotification();
        };

        const fetchMessages = async () => {
            setIsLoading(true);
            const { data, error } = await supabase
                .from('ride_messages')
                .select('*')
                .eq('ride_id', rideId)
                .order('created_at', { ascending: true });

            if (cancelled) return;
            if (error) {
                console.error('[ride-chat] fetch failed:', error);
                toast.error('No se pudieron cargar los mensajes del viaje.');
            } else {
                const history = data || [];
                // Old history must never generate a fresh notification. Messages
                // inside the startup grace window are intentionally left unseen
                // so the catch-up pass can recover the first driver message.
                history.forEach((message) => {
                    if (!isRideMessageAtOrAfter(message, catchUpSince)) {
                        notifiedMessageKeysRef.current.add(getRideMessageKey(message));
                    }
                });
                setMessages((current) => mergeMessages(current, history));
            }
            setIsLoading(false);
        };

        const fetchCatchUpMessages = async () => {
            const { data, error } = await supabase
                .from('ride_messages')
                .select('*')
                .eq('ride_id', rideId)
                .gte('created_at', catchUpSince)
                .order('created_at', { ascending: true });

            if (cancelled) return;
            if (error) {
                console.warn('[ride-chat] catch-up failed:', error);
                return;
            }
            (data || []).forEach(notifyIncomingMessage);
        };

        void fetchMessages();

        const channel = supabase
            .channel(`ride-chat:${rideId}`)
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'ride_messages',
                filter: `ride_id=eq.${rideId}`,
            }, (payload) => notifyIncomingMessage(payload.new))
            .subscribe((status) => {
                if (status === 'SUBSCRIBED') {
                    // The query closes the gap between the initial SELECT and the
                    // moment Realtime starts delivering INSERT events.
                    void fetchCatchUpMessages();
                }
                if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                    console.warn(`[ride-chat] realtime status for ${rideId}:`, status);
                }
            });

        const resyncVisibleChat = () => {
            if (document.visibilityState === 'visible') void fetchCatchUpMessages();
        };

        window.addEventListener('focus', fetchCatchUpMessages);
        document.addEventListener('visibilitychange', resyncVisibleChat);

        return () => {
            cancelled = true;
            window.removeEventListener('focus', fetchCatchUpMessages);
            document.removeEventListener('visibilitychange', resyncVisibleChat);
            supabase.removeChannel(channel);
        };
    }, [rideId]);

'''

replace_between(
    "src/components/ChatWidget.jsx",
    "    useEffect(() => {\n        if (!rideId) return undefined;\n\n        let cancelled = false;\n\n        const fetchMessages",
    "    const handleSend = async () => {",
    new_subscription_effect,
)


# A native bundle is required for the fix on installed Android devices.
replace_once(
    "android/app/build.gradle",
    "        versionCode 47\n        versionName \"1.5.15\"\n",
    "        versionCode 48\n        versionName \"1.5.16\"\n",
)
