import React, { useState, useRef, useEffect } from 'react';
import { chatWithAI, generateSpeech, playAudioBuffer } from '../services/geminiService';

const ChatWidget = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState([
        { id: '1', role: 'model', text: 'Hi! I can help you find rides or answer questions about HIGO.' }
    ]);
    const [inputValue, setInputValue] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const messagesEndRef = useRef(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    useEffect(() => {
        const handleOpenChat = () => setIsOpen(true);
        window.addEventListener('open-chat', handleOpenChat);
        return () => window.removeEventListener('open-chat', handleOpenChat);
    }, []);

    const handleSend = async () => {
        if (!inputValue.trim()) return;

        const userMsg = { id: Date.now().toString(), role: 'user', text: inputValue };
        setMessages(prev => [...prev, userMsg]);
        setInputValue('');
        setIsLoading(true);

        const history = messages.map(m => ({
            role: m.role,
            parts: [{ text: m.text }]
        }));

        const responseText = await chatWithAI(userMsg.text, history);

        const modelMsg = { id: (Date.now() + 1).toString(), role: 'model', text: responseText || "Sorry, I couldn't understand that." };
        setMessages(prev => [...prev, modelMsg]);
        setIsLoading(false);
    };

    const handleSpeak = async (text) => {
        const buffer = await generateSpeech(text);
        if (buffer) {
            playAudioBuffer(buffer);
        }
    };

    return (
        <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end">
            {isOpen && (
                <div className="mb-4 w-80 md:w-96 bg-white dark:bg-[#1a2c2c] rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden flex flex-col max-h-[500px] animate-in fade-in slide-in-from-bottom-5">
                    <div className="p-4 bg-violet-100 dark:bg-violet-900/20 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
                        <div className="flex items-center gap-2">
                            <span className="material-symbols-outlined text-violet-600">smart_toy</span>
                            <h3 className="font-bold text-gray-800 dark:text-white">HIGO Assistant</h3>
                        </div>
                        <button onClick={() => setIsOpen(false)} className="text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200">
                            <span className="material-symbols-outlined">close</span>
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50 dark:bg-[#152323]">
                        {messages.map((msg) => (
                            <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                <div className={`max-w-[80%] p-3 rounded-2xl ${msg.role === 'user'
                                    ? 'bg-violet-600 text-white rounded-tr-none'
                                    : 'bg-white dark:bg-[#233535] text-gray-800 dark:text-gray-200 rounded-tl-none shadow-sm'
                                    }`}>
                                    <p className="text-sm">{msg.text}</p>
                                    {msg.role === 'model' && (
                                        <button
                                            onClick={() => handleSpeak(msg.text)}
                                            className="mt-2 text-xs flex items-center gap-1 text-gray-500 dark:text-gray-400 hover:text-violet-600 transition-colors"
                                        >
                                            <span className="material-symbols-outlined text-[16px]">volume_up</span>
                                            Read Aloud
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))}
                        {isLoading && (
                            <div className="flex justify-start">
                                <div className="bg-white dark:bg-[#233535] p-3 rounded-2xl rounded-tl-none shadow-sm flex items-center gap-1">
                                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce delay-75"></div>
                                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce delay-150"></div>
                                </div>
                            </div>
                        )}
                        <div ref={messagesEndRef} />
                    </div>

                    <div className="p-3 bg-white dark:bg-[#1a2c2c] border-t border-gray-200 dark:border-gray-700 flex gap-2">
                        <input
                            type="text"
                            className="flex-1 bg-gray-100 dark:bg-[#0f1c1c] border-none rounded-lg text-sm px-3 focus:ring-1 focus:ring-violet-500 text-gray-800 dark:text-white"
                            placeholder="Ask anything..."
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
            )}

            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-14 h-14 bg-violet-600 hover:bg-violet-700 rounded-full shadow-lg shadow-violet-600/30 flex items-center justify-center text-white transition-transform hover:scale-105"
            >
                <span className="material-symbols-outlined text-3xl">
                    {isOpen ? 'close' : 'chat_bubble'}
                </span>
            </button>
        </div>
    );
};

export default ChatWidget;
