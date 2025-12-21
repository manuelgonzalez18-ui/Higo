import React, { useState, useRef, useEffect } from 'react';
import { supabase } from '../services/supabase';

const ChatWidget = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [messages, setMessages] = useState([]);
    const [inputValue, setInputValue] = useState('');
    const [rideId, setRideId] = useState(null);
    const [userId, setUserId] = useState(null);
    const messagesEndRef = useRef(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages, isOpen]);

    useEffect(() => {
        const fetchUser = async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (user) setUserId(user.id);
        };
        fetchUser();

        const handleOpenChat = (event) => {
            setIsOpen(true);
            // Ideally we get rideId from event, but for now we might need to grab it from URL or context if not passed
            // In RideStatusPage, we should pass it. Let's assume the event detail has it, or we rely on URL parsing if simpler for now.
            // Actually, let's update RideStatusPage to dispatch the ID. 
            // If the event doesn't have it, we can't load specific chat. 
            // For this specific 'single active ride' context, let's try to find active ride if not provided.

            // For now, let's assume we are viewing the ride page or the layout knows the current ride. 
            // But ChatWidget is global.
            // Let's modify RideStatusPage to dispatch: window.dispatchEvent(new CustomEvent('open-chat', { detail: { rideId: ride.id } }));
            if (event.detail && event.detail.rideId) {
                setRideId(event.detail.rideId);
            }
        };

        window.addEventListener('open-chat', handleOpenChat);
        return () => window.removeEventListener('open-chat', handleOpenChat);
    }, []);

    useEffect(() => {
        if (!rideId) return;

        // Fetch initial messages
        const fetchMessages = async () => {
            setIsLoading(true);
            const { data, error } = await supabase
                .from('messages')
                .select('*')
                .eq('ride_id', rideId)
                .order('created_at', { ascending: true });

            if (!error && data) {
                setMessages(data);
            }
            setIsLoading(false);
        };

        fetchMessages();

        // Subscribe to new messages
        const channel = supabase
            .channel(`chat:${rideId}`)
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'messages',
                filter: `ride_id=eq.${rideId}`
            }, (payload) => {
                setMessages(prev => [...prev, payload.new]);
            })
            .subscribe();

        return () => supabase.removeChannel(channel);
    }, [rideId]);

    const handleSend = async () => {
        if (!inputValue.trim() || !rideId || !userId) return;

        // Optimistic UI update? strict consistency is better for chat usually, but let's wait for confirm or subscription
        // We'll just insert and let subscription update UI (or manual update if local echo needed)

        const text = inputValue.trim();
        setInputValue('');

        const { error } = await supabase
            .from('messages')
            .insert({
                ride_id: rideId,
                sender_id: userId,
                content: text
            });

        if (error) {
            console.error("Error sending message:", error);
            // Optionally restore input or show error
        }
    };

    if (!isOpen) {
        // If hidden, we don't render the bubble unless we want it always visible. 
        // The user said "remove AI", implies keep chat functionality.
        // If we want it global, we need a trigger.
        // But in RideStatusPage, there is a chat button that effectively "Opens" this widget.
        // So the bubble trigger might be redundant if the page controls it, but let's keep it for closing/reopening.
        return null; // Or keep the floating button? 
        // RideStatusPage has a "Chat" button in the driver card.
        // Let's keep the floating button only if isOpen is false? Or maybe we rely on the page button to open it initially.
        // Let's render nothing if not open, and rely on the event to open it.
        // WAIT: If I return null, the user can't open it unless they click the button in RideStatusPage again. 
        // That's fine.
    }

    return (
        <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end">
            <div className="mb-4 w-80 md:w-96 bg-white dark:bg-[#1a2c2c] rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden flex flex-col max-h-[500px] animate-in fade-in slide-in-from-bottom-5">
                <div className="p-4 bg-violet-100 dark:bg-violet-900/20 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
                    <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-violet-600">chat</span>
                        <h3 className="font-bold text-gray-800 dark:text-white">Chat con Conductor</h3>
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
                                    ? 'bg-violet-600 text-white rounded-tr-none'
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
                        className="flex-1 bg-gray-100 dark:bg-[#0f1c1c] border-none rounded-lg text-sm px-3 focus:ring-1 focus:ring-violet-500 text-gray-800 dark:text-white"
                        placeholder="Escribe un mensaje..."
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                    />
                    <button
                        onClick={handleSend}
                        disabled={isLoading || !inputValue.trim()}
                        className="p-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:opacity-50 transition-colors"
                    >
                        <span className="material-symbols-outlined text-[20px]">send</span>
                    </button>
                </div>
            </div>

            {/* 
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-14 h-14 bg-violet-600 hover:bg-violet-700 rounded-full shadow-lg shadow-violet-600/30 flex items-center justify-center text-white transition-transform hover:scale-105"
            >
                <span className="material-symbols-outlined text-3xl">
                    {isOpen ? 'close' : 'chat_bubble'}
                </span>
            </button> 
            */}
        </div>
    );
};

export default ChatWidget;
