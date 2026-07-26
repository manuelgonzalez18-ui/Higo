import React, { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { supabase } from '../services/supabase';
import { vibrateIntense, playAlertSound } from '../services/notificationService';
import { toast } from './Toast';

// Android no permite cambiar el sonido de un canal ya creado. La versión v1
// pudo quedar registrada sin sonido en teléfonos que instalaron builds
// anteriores, por eso usamos un ID nuevo para forzar un canal audible.
const CHAT_CHANNEL_ID = 'higo_messages_v2';
const MAX_MESSAGE_LENGTH = 1000;
const ACTIVE_RIDE_STATUSES = ['requested', 'accepted', 'in_progress', 'arrived_at_dropoff'];

const mergeMessages = (...groups) => {
    const byId = new Map();
    groups.flat().filter(Boolean).forEach((message) => {
        const key = message.id != null
            ? String(message.id)
            : `${message.sender_id}:${message.created_at}:${message.content}`;
        byId.set(key, message);
    });
    return [...byId.values()].sort(
        (a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime(),
    );
};

const getRideIdFromHash = () => {
    if (typeof window === 'undefined') return null;
    const match = window.location.hash.match(/^#\/ride\/([^/?#]+)/);
    return match?.[1] ? decodeURIComponent(match[1]) : null;
};

const getMessagePreview = (content) => {
    const normalized = String(content || 'Tienes un nuevo mensaje').replace(/\s+/g, ' ').trim();
    return normalized.length > 90 ? `${normalized.slice(0, 87)}…` : normalized;
};

const ChatWidget = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [isSending, setIsSending] = useState(false);
    const [messages, setMessages] = useState([]);
    const [inputValue, setInputValue] = useState('');
    const [rideId, setRideId] = useState(null);
    const [userId, setUserId] = useState(null);
    const [chatTitle, setChatTitle] = useState('Chat del viaje');
    const [unreadCount, setUnreadCount] = useState(0);

    const messagesEndRef = useRef(null);
    const isOpenRef = useRef(false);
    const userIdRef = useRef(null);

    useEffect(() => {
        isOpenRef.current = isOpen;
        if (isOpen) setUnreadCount(0);
    }, [isOpen]);

    useEffect(() => {
        userIdRef.current = userId;
    }, [userId]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, isOpen]);

    useEffect(() => {
        let disposed = false;

        const resolveActiveRide = async (currentUserId) => {
            if (!currentUserId || disposed) return;

            const routeRideId = getRideIdFromHash();
            if (routeRideId) {
                setRideId((currentRideId) => currentRideId || routeRideId);
                return;
            }

            const { data, error } = await supabase
                .from('rides')
                .select('id')
                .or(`user_id.eq.${currentUserId},driver_id.eq.${currentUserId}`)
                .in('status', ACTIVE_RIDE_STATUSES)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (disposed) return;
            if (error) {
                console.warn('[ride-chat] active ride lookup failed:', error);
                return;
            }
            if (data?.id) setRideId((currentRideId) => currentRideId || data.id);
        };

        const fetchUser = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            if (session?.user) {
                setUserId(session.user.id);
                void resolveActiveRide(session.user.id);
                return session.user.id;
            }

            const { data: { user } } = await supabase.auth.getUser();
            const nextUserId = user?.id || null;
            setUserId(nextUserId);
            if (nextUserId) void resolveActiveRide(nextUserId);
            return nextUserId;
        };

        void fetchUser();

        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            const nextUserId = session?.user?.id || null;
            setUserId(nextUserId);
            if (nextUserId) {
                void resolveActiveRide(nextUserId);
            } else {
                setIsOpen(false);
                setRideId(null);
                setMessages([]);
                setUnreadCount(0);
            }
        });

        const handleOpenChat = (event) => {
            const nextRideId = event.detail?.rideId || null;
            if (!nextRideId) {
                toast.error('No se pudo abrir el chat: falta el viaje activo.');
                return;
            }

            setRideId((currentRideId) => {
                if (String(currentRideId || '') !== String(nextRideId)) {
                    setMessages([]);
                    setUnreadCount(0);
                }
                return nextRideId;
            });
            setChatTitle(event.detail?.title || 'Chat del viaje');
            setIsOpen(true);
            void fetchUser();
        };

        const syncCurrentRoute = () => {
            const currentUserId = userIdRef.current;
            if (currentUserId) void resolveActiveRide(currentUserId);
        };

        const handleVisibility = () => {
            if (document.visibilityState === 'visible') syncCurrentRoute();
        };

        window.addEventListener('open-chat', handleOpenChat);
        window.addEventListener('hashchange', syncCurrentRoute);
        window.addEventListener('focus', syncCurrentRoute);
        document.addEventListener('visibilitychange', handleVisibility);

        return () => {
            disposed = true;
            window.removeEventListener('open-chat', handleOpenChat);
            window.removeEventListener('hashchange', syncCurrentRoute);
            window.removeEventListener('focus', syncCurrentRoute);
            document.removeEventListener('visibilitychange', handleVisibility);
            subscription.unsubscribe();
        };
    }, []);

    useEffect(() => {
        if (!Capacitor.isNativePlatform()) return undefined;

        let actionListener = null;
        let disposed = false;

        const setupNotifications = async () => {
            try {
                const permission = await LocalNotifications.checkPermissions();
                if (permission.display === 'prompt') {
                    await LocalNotifications.requestPermissions();
                }

                if (Capacitor.getPlatform() === 'android') {
                    await LocalNotifications.createChannel({
                        id: CHAT_CHANNEL_ID,
                        name: 'Mensajes del viaje',
                        description: 'Mensajes entre pasajero y conductor',
                        importance: 5,
                        visibility: 1,
                        vibration: true,
                        sound: 'alert_sound.wav',
                    });
                }

                actionListener = await LocalNotifications.addListener(
                    'localNotificationActionPerformed',
                    (action) => {
                        const notificationRideId = action.notification?.extra?.rideId;
                        if (!notificationRideId) return;
                        setRideId(notificationRideId);
                        setIsOpen(true);
                    },
                );

                if (disposed) actionListener?.remove?.();
            } catch (error) {
                console.warn('[ride-chat] notification setup failed:', error);
            }
        };

        void setupNotifications();
        return () => {
            disposed = true;
            actionListener?.remove?.();
        };
    }, []);

    useEffect(() => {
        if (!rideId) return undefined;

        let cancelled = false;

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
                setMessages((current) => mergeMessages(current, data || []));
            }
            setIsLoading(false);
        };

        void fetchMessages();

        const channel = supabase
            .channel(`ride-chat:${rideId}`)
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'ride_messages',
                filter: `ride_id=eq.${rideId}`,
            }, (payload) => {
                const incoming = payload.new;
                setMessages((current) => mergeMessages(current, [incoming]));

                if (incoming.sender_id === userIdRef.current) return;

                const preview = getMessagePreview(incoming.content);
                const chatIsOpen = isOpenRef.current;

                // Mientras el chat está abierto emitimos el sonido directamente.
                // Cuando está cerrado, Android usa el canal local v2 para mostrar
                // el banner y reproducir alert_sound.wav sin duplicar el tono.
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
                void LocalNotifications.schedule({
                    notifications: [{
                        title: 'Nuevo mensaje del viaje',
                        body: preview,
                        id: notificationId,
                        schedule: { at: new Date(Date.now() + 150) },
                        sound: 'alert_sound.wav',
                        channelId: CHAT_CHANNEL_ID,
                        extra: { rideId },
                    }],
                }).catch((error) => {
                    console.warn('[ride-chat] local notification failed:', error);
                    // Si el permiso o canal nativo falla, todavía intentamos el
                    // sonido interno para que el mensaje no llegue en silencio.
                    void playAlertSound();
                    vibrateIntense();
                });
            })
            .subscribe((status) => {
                if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                    console.warn(`[ride-chat] realtime status for ${rideId}:`, status);
                }
            });

        return () => {
            cancelled = true;
            supabase.removeChannel(channel);
        };
    }, [rideId]);

    const handleSend = async () => {
        if (isSending) return;

        const content = inputValue.trim().slice(0, MAX_MESSAGE_LENGTH);
        let currentUserId = userIdRef.current;

        if (!currentUserId) {
            const { data: { session } } = await supabase.auth.getSession();
            currentUserId = session?.user?.id || null;
            if (currentUserId) setUserId(currentUserId);
        }

        if (!content || !rideId || !currentUserId) {
            const missing = [];
            if (!rideId) missing.push('viaje activo');
            if (!currentUserId) missing.push('sesión');
            toast.error(`No se pudo enviar: falta ${missing.join(' y ') || 'el mensaje'}.`);
            return;
        }

        setInputValue('');
        setIsSending(true);

        const { data, error } = await supabase
            .from('ride_messages')
            .insert({
                ride_id: rideId,
                sender_id: currentUserId,
                content,
            })
            .select('*')
            .single();

        setIsSending(false);

        if (error) {
            console.error('[ride-chat] send failed:', error);
            toast.error('No se pudo enviar el mensaje. Revisa tu conexión e inténtalo nuevamente.');
            setInputValue(content);
            return;
        }

        // El INSERT devuelto mantiene el chat útil incluso si Realtime tarda o
        // se reconecta. mergeMessages evita duplicarlo cuando llegue el evento.
        setMessages((current) => mergeMessages(current, [data]));
    };

    if (!rideId) return null;

    return (
        <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end pointer-events-none">
            {isOpen && (
                <div className="mb-4 w-[calc(100vw-2rem)] max-w-96 bg-white dark:bg-[#1a2c2c] rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden flex flex-col max-h-[min(500px,75vh)] animate-in fade-in slide-in-from-bottom-5 pointer-events-auto">
                    <div className="p-4 bg-blue-600/10 dark:bg-blue-900/20 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
                        <div className="flex items-center gap-2 min-w-0">
                            <span className="material-symbols-outlined text-blue-600">chat</span>
                            <div className="min-w-0">
                                <h3 className="font-bold text-gray-800 dark:text-white truncate">{chatTitle}</h3>
                                <p className="text-[11px] text-gray-500 dark:text-gray-400">Mensajería privada de este viaje</p>
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={() => setIsOpen(false)}
                            className="text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
                            aria-label="Cerrar chat"
                        >
                            <span className="material-symbols-outlined">close</span>
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50 dark:bg-[#152323] min-h-[260px]">
                        {isLoading && messages.length === 0 && (
                            <div className="h-full flex items-center justify-center text-gray-400 gap-2">
                                <span className="material-symbols-outlined animate-spin">progress_activity</span>
                                <span className="text-sm">Cargando mensajes…</span>
                            </div>
                        )}

                        {!isLoading && messages.length === 0 && (
                            <div className="text-center text-gray-400 mt-10">
                                <p>Envía un mensaje para comenzar.</p>
                            </div>
                        )}

                        {messages.map((message) => {
                            const isMe = message.sender_id === userId;
                            return (
                                <div key={message.id || `${message.sender_id}-${message.created_at}`} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                                    <div className={`max-w-[82%] p-3 rounded-2xl ${isMe
                                        ? 'bg-blue-600 text-white rounded-tr-none'
                                        : 'bg-white dark:bg-[#233535] text-gray-800 dark:text-gray-200 rounded-tl-none shadow-sm'
                                    }`}>
                                        <p className="text-sm whitespace-pre-wrap break-words">{message.content}</p>
                                        {message.created_at && (
                                            <p className={`mt-1 text-[9px] text-right ${isMe ? 'text-blue-100/80' : 'text-gray-400'}`}>
                                                {new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                            </p>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                        <div ref={messagesEndRef} />
                    </div>

                    <div className="p-3 bg-white dark:bg-[#1a2c2c] border-t border-gray-200 dark:border-gray-700 flex gap-2">
                        <input
                            type="text"
                            maxLength={MAX_MESSAGE_LENGTH}
                            className="flex-1 min-w-0 bg-gray-100 dark:bg-[#0f1c1c] border-none outline-none rounded-lg text-sm px-3 focus:ring-1 focus:ring-blue-600 text-gray-800 dark:text-white"
                            placeholder="Escribe un mensaje…"
                            value={inputValue}
                            onChange={(event) => setInputValue(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter' && !event.repeat) {
                                    event.preventDefault();
                                    void handleSend();
                                }
                            }}
                        />
                        <button
                            type="button"
                            onClick={() => void handleSend()}
                            disabled={isSending || !inputValue.trim() || !userId}
                            title={!userId ? 'Cargando sesión…' : 'Enviar mensaje'}
                            className="p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                        >
                            <span className={`material-symbols-outlined text-[20px] ${isSending ? 'animate-spin' : ''}`}>
                                {isSending ? 'progress_activity' : 'send'}
                            </span>
                        </button>
                    </div>
                </div>
            )}

            {!isOpen && unreadCount > 0 && (
                <button
                    type="button"
                    onClick={() => setIsOpen(true)}
                    className="pointer-events-auto w-14 h-14 rounded-full bg-blue-600 text-white shadow-2xl flex items-center justify-center relative"
                    aria-label={`Abrir ${unreadCount} mensajes sin leer`}
                >
                    <span className="material-symbols-outlined">chat_bubble</span>
                    <span className="absolute -top-1 -right-1 min-w-6 h-6 px-1 rounded-full bg-red-500 border-2 border-white text-[10px] font-black flex items-center justify-center">
                        {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                </button>
            )}
        </div>
    );
};

export default ChatWidget;
