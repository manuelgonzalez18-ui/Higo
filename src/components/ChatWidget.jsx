import React, { useState, useRef, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { LocalNotifications } from '@capacitor/local-notifications';

const ChatWidget = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [messages, setMessages] = useState([]);
    const [inputValue, setInputValue] = useState('');
    const [rideId, setRideId] = useState(null);
    const [userId, setUserId] = useState(null);
    const [chatTitle, setChatTitle] = useState("Chat");
    const [unreadCount, setUnreadCount] = useState(0);
    const messagesEndRef = useRef(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages, isOpen]);

    // Clear unread on open
    useEffect(() => {
        if (isOpen) {
            setUnreadCount(0);
        }
    }, [isOpen]);

    useEffect(() => {
        // 1. Get Initial Session
        const fetchUser = async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (user) setUserId(user.id);
        };
        fetchUser();

        // 2. Listen for Auth Changes (Login/Logout)
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            if (session?.user) {
                setUserId(session.user.id);
            } else {
                setUserId(null);
            }
        });

        const handleOpenChat = (event) => {
            setIsOpen(true);
            if (event.detail && event.detail.rideId) {
                setRideId(event.detail.rideId);
            }
            if (event.detail && event.detail.title) {
                setChatTitle(event.detail.title);
            } else {
                setChatTitle("Chat"); // Default
            }
            // Re-fetch user on open just in case
            fetchUser();
        };

        window.addEventListener('open-chat', handleOpenChat);
        return () => {
            window.removeEventListener('open-chat', handleOpenChat);
            subscription.unsubscribe();
        };
    }, []);

    useEffect(() => {
        if (!rideId) return;

        const fetchMessages = async () => {
            const { data, error } = await supabase
                .from('ride_messages')
                .select('*')
                .eq('ride_id', rideId)
                .order('created_at', { ascending: true });

            if (data) setMessages(data);
        };

        fetchMessages();

        const channel = supabase
            .channel(`chat:${rideId}`)
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ride_messages', filter: `ride_id=eq.${rideId}` }, async (payload) => {
                setMessages(prev => [...prev, payload.new]);

                // Notify if message is NOT from me
                if (payload.new.sender_id !== userId) {
                    if (!isOpen) {
                        setUnreadCount(prev => prev + 1);
                    }

                    // Vibrate for internal message
                    if (navigator.vibrate) {
                        navigator.vibrate([200, 100, 200]);
                    }

                    try {
                        await LocalNotifications.schedule({
                            notifications: [{
                                title: "Nuevo Mensaje",
                                body: payload.new.content,
                                id: new Date().getTime(),
                                schedule: { at: new Date(Date.now()) },
                                channelId: 'higo_rides', // Use same High Imp channel
                                actionTypeId: "",
                                extra: null
                            }]
                        });
                        // Use default system sound by NOT specifying 'sound' or 'vibrate' manually here if channel handles it
                        // Or specify basic vibration if needed, but let channel rule.
                    } catch (e) {
                        console.error("Chat Notification Error:", e);
                    }
                }
            })
            .subscribe();

        return () => supabase.removeChannel(channel);
    }, [rideId, userId, isOpen]);

    // Request Permissions on mount
    useEffect(() => {
        const setupNotifications = async () => {
            await LocalNotifications.requestPermissions();
            // Ensure channel exists (idempotent)
            await LocalNotifications.createChannel({
                id: 'higo_rides',
                name: 'Higo Chat',
                description: 'Chat and Ride Notifications',
                importance: 5,
                visibility: 1,
                vibration: true,
                sound: 'alert_sound'
            });
        };
        setupNotifications();
    }, []);

    const handleSend = async () => {
        if (!inputValue.trim() || !rideId || !userId) {
            console.error("Missing data for chat:", { inputValue, rideId, userId });
            alert("Error: Faltan datos para enviar el mensaje (ID de viaje o usuario).");
            return;
        }

        const content = inputValue.trim();
        setInputValue(''); // Optimistic clear

        const { error } = await supabase
            .from('ride_messages')
            .insert({
                ride_id: rideId,
                sender_id: userId,
                content: content
            });

        if (error) {
            console.error('Error sending message:', error);
            alert(`Error al enviar: ${error.message}`);
            setInputValue(content); // Restore if failed
        }
    };

    if (!rideId) return null; // Don't render anything if no ride context (except initial listener)

    return (
        <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end pointer-events-none">
            {/* Window */}
            {isOpen && (
                <div className="mb-4 w-80 md:w-96 bg-white dark:bg-[#1a2c2c] rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden flex flex-col max-h-[500px] animate-in fade-in slide-in-from-bottom-5 pointer-events-auto">
                    <div className="p-4 bg-blue-600/10 dark:bg-blue-900/20 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
                        <div className="flex items-center gap-2">
                            <span className="material-symbols-outlined text-blue-600">chat</span>
                            <h3 className="font-bold text-gray-800 dark:text-white">{chatTitle}</h3>
                        </div>
                        <button onClick={() => setIsOpen(false)} className="text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200">
                            <span className="material-symbols-outlined">close</span>
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50 dark:bg-[#152323] min-h-[300px]">
                        {messages.length === 0 && !isLoading && (
                            <div className="text-center text-gray-400 mt-10">
                                <p>Envía un mensaje para comenzar...</p>
                            </div>
                        )}

                        {messages.map((msg) => {
                            const isMe = msg.sender_id === userId;
                            return (
                                <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                                    <div className={`max-w-[80%] p-3 rounded-2xl ${isMe
                                        ? 'bg-blue-600 text-white rounded-tr-none'
                                        : 'bg-white dark:bg-[#233535] text-gray-800 dark:text-gray-200 rounded-tl-none shadow-sm'
                                        }`}>
                                        <p className="text-sm">{msg.content}</p>
                                    </div>
                                </div>
                            );
                        })}
                        <div ref={messagesEndRef} />
                    </div>

                    <div className="p-3 bg-white dark:bg-[#1a2c2c] border-t border-gray-200 dark:border-gray-700 flex gap-2">
                        <input
                            type="text"
                            className="flex-1 bg-gray-100 dark:bg-[#0f1c1c] border-none rounded-lg text-sm px-3 focus:ring-1 focus:ring-blue-600 text-gray-800 dark:text-white"
                            placeholder="Escribe un mensaje..."
                            value={inputValue}
                            onChange={(e) => setInputValue(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                        />
                        <button
                            onClick={handleSend}
                            disabled={isLoading || !inputValue.trim()}
                            className="p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                        >
                            <span className="material-symbols-outlined text-[20px]">send</span>
                        </button>
                    </div>
                </div>
            )}

            {/* Floating Button - REMOVED as per user request */}
        </div>
    );
};

export default ChatWidget;
