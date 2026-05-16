import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '../services/supabase';
import { LocalNotifications } from '@capacitor/local-notifications';
import { vibrateIntense, playAlertSound } from '../services/notificationService';
import { triggerSupportPush } from '../services/supportPush';
import { compressImage } from '../utils/imageCompression';

// Chat 1-a-1 entre el usuario logueado (pasajero o conductor) y el equipo
// Higo (admins). Un hilo único por usuario (tabla support_threads).
// Se renderiza globalmente desde App.jsx; se autooculta en /admin/* y /auth.

const HIDDEN_PATH_PREFIXES = ['/admin', '/auth'];
const SIGNED_URL_TTL = 3600;          // 1h — chat queda abierto largo a veces
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;   // 10 MB pre-compresión

const SupportChatWidget = () => {
    const { pathname } = useLocation();
    const hidden = HIDDEN_PATH_PREFIXES.some(p => pathname.startsWith(p));

    const [userId, setUserId] = useState(null);
    const [thread, setThread] = useState(null);   // { id, status, unread_for_user, ... }
    const [messages, setMessages] = useState([]);
    const [isOpen, setIsOpen] = useState(false);
    const [inputValue, setInputValue] = useState('');
    const [uploading, setUploading] = useState(false);
    const [attachUrls, setAttachUrls] = useState({}); // msgId → signed URL
    const [lightbox, setLightbox] = useState(null);   // URL ampliada
    const messagesEndRef = useRef(null);
    const fileInputRef = useRef(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };
    useEffect(() => { scrollToBottom(); }, [messages, isOpen]);

    // ─── Auth: cargar userId (getSession primero, lección de ChatWidget) ──
    useEffect(() => {
        const fetchUser = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            if (session?.user) { setUserId(session.user.id); return; }
            const { data: { user } } = await supabase.auth.getUser();
            if (user) setUserId(user.id);
        };
        fetchUser();

        const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
            setUserId(session?.user?.id || null);
        });
        return () => subscription.unsubscribe();
    }, []);

    // ─── Cargar (o crear) el hilo del usuario ──────────────────────────────
    useEffect(() => {
        if (!userId || hidden) {
            setThread(null);
            setMessages([]);
            return;
        }

        let cancelled = false;
        let threadChannel;
        let messagesChannel;

        const loadOrCreateThread = async () => {
            const { data: existing } = await supabase
                .from('support_threads')
                .select('*')
                .eq('user_id', userId)
                .maybeSingle();

            let t = existing;
            if (!t) {
                const { data: created, error } = await supabase
                    .from('support_threads')
                    .insert({ user_id: userId })
                    .select()
                    .single();
                if (error) {
                    // UNIQUE(user_id) puede chocar si otra pestaña insertó primero.
                    const { data: refetched } = await supabase
                        .from('support_threads')
                        .select('*')
                        .eq('user_id', userId)
                        .maybeSingle();
                    if (!refetched) {
                        console.error('Error creando hilo de soporte:', error);
                        return;
                    }
                    t = refetched;
                } else {
                    t = created;
                }
            }
            if (cancelled) return;
            setThread(t);

            const { data: msgs } = await supabase
                .from('support_messages')
                .select('*')
                .eq('thread_id', t.id)
                .order('created_at', { ascending: true });
            if (!cancelled && msgs) setMessages(msgs);

            // Realtime: nuevos mensajes
            messagesChannel = supabase
                .channel(`support_messages:${t.id}`)
                .on('postgres_changes', {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'support_messages',
                    filter: `thread_id=eq.${t.id}`
                }, (payload) => {
                    setMessages(prev => [...prev, payload.new]);
                    if (payload.new.sender_id === userId) return;
                    vibrateIntense();
                    playAlertSound();
                    LocalNotifications.schedule({
                        notifications: [{
                            title: 'Soporte Higo',
                            body: payload.new.content
                                || (payload.new.attachment_path ? '📎 Te enviaron una imagen' : 'Tienes una respuesta del equipo'),
                            id: new Date().getTime(),
                            schedule: { at: new Date() },
                            channelId: 'higo_messages_v1'
                        }]
                    }).catch(() => {});
                })
                .subscribe();

            // Realtime: cambios en el hilo (unread, status)
            threadChannel = supabase
                .channel(`support_thread:${t.id}`)
                .on('postgres_changes', {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'support_threads',
                    filter: `id=eq.${t.id}`
                }, (payload) => {
                    setThread(payload.new);
                })
                .subscribe();
        };

        loadOrCreateThread();
        return () => {
            cancelled = true;
            if (messagesChannel) supabase.removeChannel(messagesChannel);
            if (threadChannel) supabase.removeChannel(threadChannel);
        };
    }, [userId, hidden]);

    // ─── Al abrir el widget, apagar el flag unread_for_user ────────────────
    useEffect(() => {
        if (!isOpen || !thread?.unread_for_user) return;
        supabase
            .from('support_threads')
            .update({ unread_for_user: false })
            .eq('id', thread.id)
            .then(() => {});
    }, [isOpen, thread?.id, thread?.unread_for_user]);

    // ─── Resolver signed URLs para los adjuntos visibles ───────────────────
    // El bucket es privado: cada path necesita una signed URL. Cacheamos
    // por id de mensaje para no regenerar en cada render.
    useEffect(() => {
        const pending = messages.filter(m => m.attachment_path && !attachUrls[m.id]);
        if (pending.length === 0) return;
        let cancelled = false;
        (async () => {
            const updates = {};
            for (const m of pending) {
                const { data, error } = await supabase
                    .storage
                    .from('support-attachments')
                    .createSignedUrl(m.attachment_path, SIGNED_URL_TTL);
                if (!error && data?.signedUrl) updates[m.id] = data.signedUrl;
            }
            if (!cancelled && Object.keys(updates).length) {
                setAttachUrls(prev => ({ ...prev, ...updates }));
            }
        })();
        return () => { cancelled = true; };
    }, [messages, attachUrls]);

    const sendMessage = useCallback(async ({ content, attachment }) => {
        if (!thread?.id || !userId) return;
        const payload = {
            thread_id: thread.id,
            sender_id: userId,
            sender_role: 'user',
            content: content || null,
        };
        if (attachment) {
            payload.attachment_path = attachment.path;
            payload.attachment_mime = attachment.mime;
            payload.attachment_size = attachment.size;
        }
        const { error } = await supabase.from('support_messages').insert(payload);
        if (error) {
            console.error('Error enviando mensaje de soporte:', error);
            alert(`No se pudo enviar: ${error.message}`);
            return false;
        }
        triggerSupportPush(thread.id);
        return true;
    }, [thread?.id, userId]);

    const handleSend = async () => {
        const content = inputValue.trim();
        if (!content) return;
        setInputValue('');
        const ok = await sendMessage({ content });
        if (!ok) setInputValue(content); // restaurar si falló
    };

    const handleFilePick = async (e) => {
        const raw = e.target.files?.[0];
        e.target.value = ''; // permitir reseleccionar el mismo archivo
        if (!raw || !thread?.id || !userId) return;
        if (!raw.type.startsWith('image/')) {
            alert('Por ahora solo se admiten imágenes.');
            return;
        }
        if (raw.size > MAX_UPLOAD_BYTES) {
            alert('La imagen pesa más de 10 MB. Probá con una más liviana.');
            return;
        }

        setUploading(true);
        try {
            const file = await compressImage(raw, 1600, 0.85);
            const path = `${thread.id}/${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
            const { error: upErr } = await supabase
                .storage
                .from('support-attachments')
                .upload(path, file, {
                    contentType: file.type || 'image/jpeg',
                    upsert: false,
                });
            if (upErr) throw upErr;

            await sendMessage({
                content: inputValue.trim() || null,
                attachment: { path, mime: file.type || 'image/jpeg', size: file.size },
            });
            setInputValue('');
        } catch (err) {
            console.error('Error subiendo adjunto:', err);
            alert(`No se pudo subir la imagen: ${err.message || err}`);
        } finally {
            setUploading(false);
        }
    };

    if (hidden || !userId) return null;

    const showUnreadBadge = !isOpen && thread?.unread_for_user;

    return (
        <div className="fixed bottom-24 right-6 z-40 flex flex-col items-end pointer-events-none">
            {isOpen && (
                <div className="mb-3 w-80 md:w-96 bg-white dark:bg-[#1a2c2c] rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden flex flex-col max-h-[500px] animate-in fade-in slide-in-from-bottom-5 pointer-events-auto">
                    <div className="p-4 bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white flex justify-between items-center">
                        <div className="flex items-center gap-2">
                            <span className="material-symbols-outlined">support_agent</span>
                            <div>
                                <h3 className="font-bold leading-tight">Soporte Higo</h3>
                                <p className="text-[11px] opacity-90 leading-tight">Te respondemos lo antes posible</p>
                            </div>
                        </div>
                        <button onClick={() => setIsOpen(false)} className="text-white/80 hover:text-white">
                            <span className="material-symbols-outlined">close</span>
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50 dark:bg-[#152323] min-h-[280px]">
                        {messages.length === 0 ? (
                            <div className="text-center text-gray-400 text-sm mt-10 px-4">
                                <span className="material-symbols-outlined text-3xl text-violet-400">waving_hand</span>
                                <p className="mt-2">Hola! Contanos en qué te podemos ayudar y un miembro del equipo Higo te responde por acá mismo.</p>
                            </div>
                        ) : messages.map(msg => {
                            const isMe = msg.sender_id === userId;
                            const url = msg.attachment_path ? attachUrls[msg.id] : null;
                            return (
                                <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                                    <div className={`max-w-[80%] p-2.5 rounded-2xl ${isMe
                                        ? 'bg-violet-600 text-white rounded-tr-none'
                                        : 'bg-white dark:bg-[#233535] text-gray-800 dark:text-gray-200 rounded-tl-none shadow-sm'
                                        }`}>
                                        {!isMe && (
                                            <p className="text-[10px] font-bold uppercase tracking-wide text-violet-500 mb-0.5">Equipo Higo</p>
                                        )}
                                        {msg.attachment_path && (
                                            <button
                                                type="button"
                                                onClick={() => url && setLightbox(url)}
                                                className="block mb-1 rounded-lg overflow-hidden bg-black/5 max-w-full"
                                            >
                                                {url ? (
                                                    <img src={url} alt="Adjunto" className="max-w-[220px] max-h-[220px] object-cover" />
                                                ) : (
                                                    <div className="w-[180px] h-[120px] flex items-center justify-center text-xs opacity-70">
                                                        <span className="material-symbols-outlined animate-pulse">image</span>
                                                    </div>
                                                )}
                                            </button>
                                        )}
                                        {msg.content && (
                                            <p className="text-sm whitespace-pre-wrap break-words">{msg.content}</p>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                        <div ref={messagesEndRef} />
                    </div>

                    <div className="p-3 bg-white dark:bg-[#1a2c2c] border-t border-gray-200 dark:border-gray-700 flex gap-2 items-center">
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={handleFilePick}
                        />
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            disabled={uploading || !thread?.id}
                            title="Adjuntar imagen"
                            className="p-2 text-violet-600 hover:bg-violet-50 dark:hover:bg-violet-900/20 rounded-lg disabled:opacity-40 transition-colors"
                        >
                            <span className="material-symbols-outlined text-[22px]">
                                {uploading ? 'progress_activity' : 'attach_file'}
                            </span>
                        </button>
                        <input
                            type="text"
                            className="flex-1 bg-gray-100 dark:bg-[#0f1c1c] border-none outline-none rounded-lg text-sm px-3 py-2 focus:ring-1 focus:ring-violet-600 text-gray-800 dark:text-white"
                            placeholder={uploading ? 'Subiendo imagen…' : 'Escribe un mensaje…'}
                            value={inputValue}
                            onChange={(e) => setInputValue(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                            disabled={uploading}
                        />
                        <button
                            onClick={handleSend}
                            disabled={!inputValue.trim() || !thread?.id || uploading}
                            className="p-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:opacity-40 transition-colors"
                        >
                            <span className="material-symbols-outlined text-[20px]">send</span>
                        </button>
                    </div>
                </div>
            )}

            <button
                onClick={() => setIsOpen(o => !o)}
                aria-label="Abrir chat de soporte"
                className="pointer-events-auto relative w-14 h-14 rounded-full bg-gradient-to-br from-violet-600 to-fuchsia-600 text-white shadow-2xl shadow-violet-900/40 flex items-center justify-center hover:scale-105 active:scale-95 transition-transform"
            >
                <span className="material-symbols-outlined text-[26px]">
                    {isOpen ? 'close' : 'support_agent'}
                </span>
                {showUnreadBadge && (
                    <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 border-2 border-white rounded-full"></span>
                )}
            </button>

            {lightbox && (
                <div
                    className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4 pointer-events-auto cursor-zoom-out"
                    onClick={() => setLightbox(null)}
                >
                    <img src={lightbox} alt="Adjunto ampliado" className="max-w-full max-h-full rounded-lg shadow-2xl" />
                </div>
            )}
        </div>
    );
};

export default SupportChatWidget;
