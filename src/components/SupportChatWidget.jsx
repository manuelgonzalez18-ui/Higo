import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '../services/supabase';
import { LocalNotifications } from '@capacitor/local-notifications';
import { vibrateIntense, playAlertSound } from '../services/notificationService';
import { triggerSupportPush } from '../services/supportPush';
import { compressImage } from '../utils/imageCompression';
import { useSupportTyping } from '../hooks/useSupportTyping';
import SupportAttachment from './SupportAttachment';
import AudioRecorder from './AudioRecorder';

// Tipos permitidos como adjunto. RLS del bucket no filtra por mime; lo
// aplicamos en el cliente.
const ACCEPT_MIME = 'image/*,application/pdf,audio/*';

const extFromMime = (mime, fallback = 'bin') => {
    if (!mime) return fallback;
    if (mime === 'application/pdf')     return 'pdf';
    if (mime.startsWith('image/')) {
        const sub = mime.split('/')[1];
        return ['jpeg', 'jpg'].includes(sub) ? 'jpg' : sub;
    }
    if (mime.startsWith('audio/')) {
        const sub = mime.split('/')[1].split(';')[0];
        if (sub === 'mpeg')   return 'mp3';
        if (sub === 'mp4')    return 'm4a';
        if (sub === 'x-wav')  return 'wav';
        return sub;
    }
    return fallback;
};

// Chat 1-a-1 entre el usuario logueado (pasajero o conductor) y el equipo
// Higo (admins). Un hilo único por usuario (tabla support_threads).
// Se renderiza globalmente desde App.jsx; se autooculta en /admin/* y /auth.

const HIDDEN_PATH_PREFIXES = ['/admin', '/auth'];

// El widget abre UN hilo distinto según desde dónde se invoque:
//   /driver*  → contexto "driver" (el user está usando la app como conductor)
//   resto     → contexto "passenger" (default — /, /ride/:id, /schedule, ...)
// Esto evita el bug en el que un mismo auth.uid() mezclaba todas sus
// conversaciones en un solo thread sin importar el lado de la app.
const contextFromPath = (pathname) => (
    pathname.startsWith('/driver') ? 'driver' : 'passenger'
);
const SIGNED_URL_TTL = 3600;          // 1h — chat queda abierto largo a veces
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;   // 10 MB pre-compresión

const SupportChatWidget = () => {
    const { pathname } = useLocation();
    const hidden = HIDDEN_PATH_PREFIXES.some(p => pathname.startsWith(p));
    const roleContext = contextFromPath(pathname);

    const [userId, setUserId] = useState(null);
    const [thread, setThread] = useState(null);   // { id, status, unread_for_user, ... }
    const [messages, setMessages] = useState([]);
    const [isOpen, setIsOpen] = useState(false);
    const [inputValue, setInputValue] = useState('');
    const [uploading, setUploading] = useState(false);
    const [attachUrls, setAttachUrls] = useState({}); // msgId → signed URL
    const [lightbox, setLightbox] = useState(null);   // URL ampliada
    const [menuFor, setMenuFor] = useState(null);     // msgId con menú abierto
    const [isRecording, setIsRecording] = useState(false);
    const messagesEndRef = useRef(null);
    const fileInputRef = useRef(null);

    const deleteMessage = async (msg) => {
        setMenuFor(null);
        if (!msg?.id) return;
        if (!confirm('¿Eliminar este mensaje? No se puede deshacer.')) return;
        const { error } = await supabase.rpc('delete_support_message', { p_id: msg.id });
        if (error) {
            alert(`No se pudo eliminar: ${error.message}`);
            return;
        }
        // Best-effort: borrar el blob del bucket.
        if (msg.attachment_path) {
            supabase.storage.from('support-attachments').remove([msg.attachment_path]).catch(() => {});
        }
    };

    // Cerrar el menú al clickear fuera.
    useEffect(() => {
        if (menuFor === null) return;
        const close = () => setMenuFor(null);
        window.addEventListener('click', close);
        return () => window.removeEventListener('click', close);
    }, [menuFor]);

    const { otherIsTyping, broadcastTyping } = useSupportTyping(thread?.id, 'user');

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
                .eq('role_context', roleContext)
                .maybeSingle();

            let t = existing;
            if (!t) {
                const { data: created, error } = await supabase
                    .from('support_threads')
                    .insert({ user_id: userId, role_context: roleContext })
                    .select()
                    .single();
                if (error) {
                    // UNIQUE(user_id, role_context) puede chocar si otra pestaña insertó primero.
                    const { data: refetched } = await supabase
                        .from('support_threads')
                        .select('*')
                        .eq('user_id', userId)
                        .eq('role_context', roleContext)
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

            // Realtime: nuevos mensajes + updates (read_at)
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
                                || (payload.new.attachment_path
                                    ? (payload.new.attachment_mime?.startsWith('image/') ? '🖼️ Imagen del equipo'
                                       : payload.new.attachment_mime?.startsWith('audio/') ? '🎤 Audio del equipo'
                                       : payload.new.attachment_mime === 'application/pdf' ? '📄 PDF del equipo'
                                       : '📎 Adjunto del equipo')
                                    : 'Tienes una respuesta del equipo'),
                            id: new Date().getTime(),
                            schedule: { at: new Date() },
                            channelId: 'higo_messages_v1'
                        }]
                    }).catch(() => {});
                })
                .on('postgres_changes', {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'support_messages',
                    filter: `thread_id=eq.${t.id}`
                }, (payload) => {
                    setMessages(prev => prev.map(m => m.id === payload.new.id ? { ...m, ...payload.new } : m));
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
    }, [userId, hidden, roleContext]);

    // ─── Al abrir el widget (o cuando llega msj del admin con widget abierto),
    //     marcar todo como leído. El RPC apaga unread_for_user y setea read_at
    //     en los mensajes del admin → el admin verá los dobles checks azules.
    const lastAdminMsgId = (() => {
        for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].sender_role === 'admin') return messages[i].id;
        }
        return null;
    })();
    useEffect(() => {
        if (!isOpen || !thread?.id) return;
        supabase.rpc('mark_support_thread_read', { p_thread_id: thread.id }).then(() => {});
    }, [isOpen, thread?.id, lastAdminMsgId]);

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

    // Sube un File al bucket y dispara sendMessage. Reusado por el
    // file picker (imágenes/PDF/audio existente) y por el grabador
    // de audio in-app.
    const uploadAndSend = async (file) => {
        if (!thread?.id || !userId) return;
        if (file.size > MAX_UPLOAD_BYTES) {
            alert('El archivo pesa más de 10 MB. Probá con uno más liviano.');
            return;
        }
        setUploading(true);
        try {
            const mime = file.type || 'application/octet-stream';
            const ext  = extFromMime(mime);
            const path = `${thread.id}/${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
            const { error: upErr } = await supabase
                .storage
                .from('support-attachments')
                .upload(path, file, { contentType: mime, upsert: false });
            if (upErr) throw upErr;
            await sendMessage({
                content: inputValue.trim() || null,
                attachment: { path, mime, size: file.size },
            });
            setInputValue('');
        } catch (err) {
            console.error('Error subiendo adjunto:', err);
            alert(`No se pudo subir: ${err.message || err}`);
        } finally {
            setUploading(false);
        }
    };

    const handleFilePick = async (e) => {
        const raw = e.target.files?.[0];
        e.target.value = ''; // permitir reseleccionar el mismo archivo
        if (!raw) return;

        const isImage = raw.type.startsWith('image/');
        const isAudio = raw.type.startsWith('audio/');
        const isPdf   = raw.type === 'application/pdf';
        if (!isImage && !isAudio && !isPdf) {
            alert('Solo se admiten imágenes, PDF o audio.');
            return;
        }
        // Imágenes: comprimir antes. PDF/audio: tal cual.
        const file = isImage ? await compressImage(raw, 1600, 0.85) : raw;
        await uploadAndSend(file);
    };

    if (hidden || !userId) return null;

    const showUnreadBadge = !isOpen && thread?.unread_for_user;

    return (
        <div className="fixed bottom-24 right-6 z-40 flex flex-col items-end pointer-events-none">
            {isOpen && (
                <div className="mb-3 w-80 md:w-96 bg-white dark:bg-[#1a2c2c] rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden flex flex-col max-h-[500px] animate-in fade-in slide-in-from-bottom-5 pointer-events-auto">
                    <div className="p-4 bg-blue-600 text-white flex justify-between items-center">
                        <div className="flex items-center gap-2">
                            <span className="material-symbols-outlined">support_agent</span>
                            <div>
                                <h3 className="font-bold leading-tight">Soporte Higo</h3>
                                {otherIsTyping ? (
                                    <p className="text-[11px] opacity-90 leading-tight flex items-center gap-1">
                                        <span className="inline-flex gap-0.5">
                                            <span className="w-1 h-1 rounded-full bg-white animate-bounce" style={{ animationDelay: '0ms' }}></span>
                                            <span className="w-1 h-1 rounded-full bg-white animate-bounce" style={{ animationDelay: '150ms' }}></span>
                                            <span className="w-1 h-1 rounded-full bg-white animate-bounce" style={{ animationDelay: '300ms' }}></span>
                                        </span>
                                        Escribiendo…
                                    </p>
                                ) : (
                                    <p className="text-[11px] opacity-90 leading-tight">Te respondemos lo antes posible</p>
                                )}
                            </div>
                        </div>
                        <button onClick={() => setIsOpen(false)} className="text-white/80 hover:text-white">
                            <span className="material-symbols-outlined">close</span>
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50 dark:bg-[#152323] min-h-[280px]">
                        {messages.length === 0 ? (
                            <div className="text-center text-gray-400 text-sm mt-10 px-4">
                                <span className="material-symbols-outlined text-3xl text-blue-400">waving_hand</span>
                                <p className="mt-2">Hola! Contanos en qué te podemos ayudar y un miembro del equipo Higo te responde por acá mismo.</p>
                            </div>
                        ) : messages.map(msg => {
                            const isMe = msg.sender_id === userId;
                            const url = msg.attachment_path ? attachUrls[msg.id] : null;
                            const isDeleted = !!msg.deleted_at;

                            if (isDeleted) {
                                return (
                                    <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                                        <div className={`max-w-[80%] px-3 py-2 rounded-2xl text-xs italic flex items-center gap-1.5 ${
                                            isMe
                                                ? 'bg-blue-600/30 text-white/70 rounded-tr-none'
                                                : 'bg-gray-100 dark:bg-[#1d2c2c] text-gray-500 dark:text-gray-400 rounded-tl-none'
                                        }`}>
                                            <span className="material-symbols-outlined text-[14px]">block</span>
                                            Mensaje eliminado
                                        </div>
                                    </div>
                                );
                            }

                            return (
                                <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                                    <div className={`relative max-w-[80%] p-2.5 rounded-2xl group ${isMe
                                        ? 'bg-blue-600 text-white rounded-tr-none'
                                        : 'bg-white dark:bg-[#233535] text-gray-800 dark:text-gray-200 rounded-tl-none shadow-sm'
                                        }`}>
                                        {!isMe && (
                                            <p className="text-[10px] font-bold uppercase tracking-wide text-blue-500 mb-0.5">Equipo Higo</p>
                                        )}
                                        {msg.attachment_path && (
                                            <SupportAttachment
                                                url={url}
                                                mime={msg.attachment_mime}
                                                size={msg.attachment_size}
                                                variant={isMe ? 'admin' : 'user'}
                                                onZoom={setLightbox}
                                            />
                                        )}
                                        {msg.content && (
                                            <p className="text-sm whitespace-pre-wrap break-words">{msg.content}</p>
                                        )}
                                        {isMe && (
                                            <div className="flex justify-end mt-0.5 -mb-0.5">
                                                <span
                                                    className={`material-symbols-outlined text-[14px] leading-none ${msg.read_at ? 'text-sky-300' : 'text-white/60'}`}
                                                    title={msg.read_at ? 'Visto' : 'Enviado'}
                                                >
                                                    {msg.read_at ? 'done_all' : 'done'}
                                                </span>
                                            </div>
                                        )}

                                        {isMe && (
                                            <>
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); setMenuFor(menuFor === msg.id ? null : msg.id); }}
                                                    className="absolute -top-1.5 -left-1.5 w-5 h-5 rounded-full bg-white/95 text-gray-700 shadow flex items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                                                    title="Más"
                                                >
                                                    <span className="material-symbols-outlined text-[14px] leading-none">more_horiz</span>
                                                </button>
                                                {menuFor === msg.id && (
                                                    <div
                                                        onClick={(e) => e.stopPropagation()}
                                                        className="absolute -top-2 right-full mr-2 z-10 bg-white dark:bg-[#1a2c2c] rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 py-1 min-w-[140px]"
                                                    >
                                                        <button
                                                            onClick={() => deleteMessage(msg)}
                                                            className="w-full text-left px-3 py-1.5 text-xs font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-1.5"
                                                        >
                                                            <span className="material-symbols-outlined text-[14px]">delete</span>
                                                            Eliminar
                                                        </button>
                                                    </div>
                                                )}
                                            </>
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
                            accept={ACCEPT_MIME}
                            className="hidden"
                            onChange={handleFilePick}
                        />
                        {!isRecording && (
                            <>
                                <button
                                    onClick={() => fileInputRef.current?.click()}
                                    disabled={uploading || !thread?.id}
                                    title="Adjuntar imagen, PDF o audio"
                                    className="p-2 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg disabled:opacity-40 transition-colors"
                                >
                                    <span className="material-symbols-outlined text-[22px]">
                                        {uploading ? 'progress_activity' : 'attach_file'}
                                    </span>
                                </button>
                                <input
                                    type="text"
                                    className="flex-1 bg-gray-100 dark:bg-[#0f1c1c] border-none outline-none rounded-lg text-sm px-3 py-2 focus:ring-1 focus:ring-blue-600 text-gray-800 dark:text-white"
                                    placeholder={uploading ? 'Subiendo adjunto…' : 'Escribe un mensaje…'}
                                    value={inputValue}
                                    onChange={(e) => { setInputValue(e.target.value); if (e.target.value) broadcastTyping(); }}
                                    onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                                    disabled={uploading}
                                />
                            </>
                        )}
                        <AudioRecorder
                            disabled={uploading || !thread?.id}
                            variant="user"
                            onRecording={setIsRecording}
                            onComplete={(file) => uploadAndSend(file)}
                        />
                        {!isRecording && (
                            <button
                                onClick={handleSend}
                                disabled={!inputValue.trim() || !thread?.id || uploading}
                                className="p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors"
                            >
                                <span className="material-symbols-outlined text-[20px]">send</span>
                            </button>
                        )}
                    </div>
                </div>
            )}

            <button
                onClick={() => setIsOpen(o => !o)}
                aria-label="Abrir chat de soporte"
                className="pointer-events-auto relative w-14 h-14 rounded-full bg-blue-600 text-white shadow-2xl shadow-blue-900/40 flex items-center justify-center hover:scale-105 active:scale-95 transition-transform"
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
