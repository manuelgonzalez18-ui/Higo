import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase, getUserProfile } from '../services/supabase';
import AdminNav from '../components/AdminNav';
import { triggerSupportPush } from '../services/supportPush';
import { compressImage } from '../utils/imageCompression';
import { useSupportTyping } from '../hooks/useSupportTyping';

const SIGNED_URL_TTL = 3600;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

// Bandeja de soporte: lista de hilos a la izquierda + conversación a la derecha.
// Cada hilo es un usuario (pasajero o conductor) que escribió al equipo Higo.

const FILTERS = [
    { id: 'open',   label: 'Abiertos',  icon: 'mark_chat_unread' },
    { id: 'closed', label: 'Cerrados',  icon: 'mark_chat_read' }
];

const AdminSupportPage = () => {
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();

    const [me, setMe] = useState(null);
    const [authorized, setAuthorized] = useState(false);
    const [loading, setLoading] = useState(true);

    const [filter, setFilter] = useState('open');
    const [threads, setThreads] = useState([]);
    const [profiles, setProfiles] = useState({}); // id → profile
    const [selectedId, setSelectedId] = useState(null);
    const [messages, setMessages] = useState([]);
    const [inputValue, setInputValue] = useState('');
    const [sending, setSending] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [attachUrls, setAttachUrls] = useState({}); // msgId → signed URL
    const [lightbox, setLightbox] = useState(null);
    const messagesEndRef = useRef(null);
    const fileInputRef = useRef(null);

    const { otherIsTyping, broadcastTyping } = useSupportTyping(selectedId, 'admin');

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };
    useEffect(() => { scrollToBottom(); }, [messages]);

    // ─── Auth gate ─────────────────────────────────────────────────────
    useEffect(() => {
        (async () => {
            const profile = await getUserProfile();
            if (!profile || profile.role !== 'admin') {
                navigate('/');
                return;
            }
            setMe(profile);
            setAuthorized(true);
        })();
    }, [navigate]);

    // ─── Cargar hilos según filtro + suscripción realtime ──────────────
    useEffect(() => {
        if (!authorized) return;

        const fetchThreads = async () => {
            setLoading(true);
            const { data, error } = await supabase
                .from('support_threads')
                .select('*')
                .eq('status', filter)
                .order('last_message_at', { ascending: false });

            if (error) {
                console.error('Error cargando hilos:', error);
                setLoading(false);
                return;
            }
            setThreads(data || []);

            // Cargar perfiles para mostrar nombre/role/avatar.
            const ids = (data || []).map(t => t.user_id);
            if (ids.length) {
                const { data: pp } = await supabase
                    .from('profiles')
                    .select('id, full_name, phone, role, avatar_url')
                    .in('id', ids);
                const map = {};
                (pp || []).forEach(p => { map[p.id] = p; });
                setProfiles(map);
            }
            setLoading(false);
        };

        fetchThreads();

        const channel = supabase
            .channel('admin_support_threads')
            .on('postgres_changes',
                { event: '*', schema: 'public', table: 'support_threads' },
                () => fetchThreads())
            .subscribe();

        return () => { supabase.removeChannel(channel); };
    }, [authorized, filter]);

    // ─── Abrir hilo desde query param (?thread=N) ──────────────────────
    useEffect(() => {
        if (!authorized) return;
        const q = searchParams.get('thread');
        if (q) {
            const id = parseInt(q, 10);
            if (!Number.isNaN(id)) setSelectedId(id);
        }
    }, [authorized, searchParams]);

    // ─── Cargar mensajes del hilo seleccionado + suscripción ───────────
    useEffect(() => {
        if (!selectedId) return;

        const fetchMessages = async () => {
            const { data } = await supabase
                .from('support_messages')
                .select('*')
                .eq('thread_id', selectedId)
                .order('created_at', { ascending: true });
            setMessages(data || []);
        };
        fetchMessages();

        // Marcar el hilo como leído por el admin: la RPC setea read_at en los
        // mensajes del user y apaga unread_for_admin de un solo viaje.
        supabase.rpc('mark_support_thread_read', { p_thread_id: selectedId }).then(() => {});

        const channel = supabase
            .channel(`admin_support_messages:${selectedId}`)
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'support_messages',
                filter: `thread_id=eq.${selectedId}`
            }, (payload) => {
                setMessages(prev => [...prev, payload.new]);
                // Si el mensaje viene del user mientras lo tengo abierto, lo
                // marco como leído de una (mismo RPC).
                if (payload.new.sender_role === 'user') {
                    supabase.rpc('mark_support_thread_read', { p_thread_id: selectedId }).then(() => {});
                }
            })
            .on('postgres_changes', {
                event: 'UPDATE',
                schema: 'public',
                table: 'support_messages',
                filter: `thread_id=eq.${selectedId}`
            }, (payload) => {
                setMessages(prev => prev.map(m => m.id === payload.new.id ? { ...m, ...payload.new } : m));
            })
            .subscribe();
        return () => { supabase.removeChannel(channel); };
    }, [selectedId]);

    // ─── Resolver signed URLs para los adjuntos del hilo abierto ───────
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

    const insertAdminMessage = async ({ content, attachment }) => {
        if (!selectedId || !me?.id) return false;
        const payload = {
            thread_id:   selectedId,
            sender_id:   me.id,
            sender_role: 'admin',
            content:     content || null,
        };
        if (attachment) {
            payload.attachment_path = attachment.path;
            payload.attachment_mime = attachment.mime;
            payload.attachment_size = attachment.size;
        }
        const { error } = await supabase.from('support_messages').insert(payload);
        if (error) {
            alert(`Error al enviar: ${error.message}`);
            return false;
        }
        triggerSupportPush(selectedId);
        return true;
    };

    const sendReply = async () => {
        const content = inputValue.trim();
        if (!content) return;
        setSending(true);
        const ok = await insertAdminMessage({ content });
        setSending(false);
        if (ok) setInputValue('');
    };

    const handleFilePick = async (e) => {
        const raw = e.target.files?.[0];
        e.target.value = '';
        if (!raw || !selectedId || !me?.id) return;
        if (!raw.type.startsWith('image/')) {
            alert('Solo se admiten imágenes por ahora.');
            return;
        }
        if (raw.size > MAX_UPLOAD_BYTES) {
            alert('La imagen pesa más de 10 MB.');
            return;
        }
        setUploading(true);
        try {
            const file = await compressImage(raw, 1600, 0.85);
            const path = `${selectedId}/${me.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
            const { error: upErr } = await supabase
                .storage
                .from('support-attachments')
                .upload(path, file, { contentType: file.type || 'image/jpeg', upsert: false });
            if (upErr) throw upErr;
            await insertAdminMessage({
                content: inputValue.trim() || null,
                attachment: { path, mime: file.type || 'image/jpeg', size: file.size },
            });
            setInputValue('');
        } catch (err) {
            console.error('Error subiendo adjunto:', err);
            alert(`No se pudo subir: ${err.message || err}`);
        } finally {
            setUploading(false);
        }
    };

    const toggleStatus = async () => {
        if (!selectedId) return;
        const current = threads.find(t => t.id === selectedId);
        const newStatus = current?.status === 'open' ? 'closed' : 'open';
        const confirmMsg = newStatus === 'closed'
            ? '¿Cerrar esta conversación? El usuario puede volver a escribir y se reabre.'
            : '¿Reabrir esta conversación?';
        if (!confirm(confirmMsg)) return;
        const { error } = await supabase
            .from('support_threads')
            .update({ status: newStatus })
            .eq('id', selectedId);
        if (error) alert(error.message);
        else if (newStatus === 'closed') {
            // Si la cerré, la sacamos del listado actual (que filtra por 'open').
            setSearchParams({});
            setSelectedId(null);
        }
    };

    const fmtTime = (d) => {
        if (!d) return '';
        const date = new Date(d);
        const today = new Date();
        const sameDay = date.toDateString() === today.toDateString();
        return sameDay
            ? date.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' })
            : date.toLocaleDateString('es-VE', { day: '2-digit', month: 'short' });
    };

    const roleBadge = (role) => {
        if (role === 'driver') return { label: 'Conductor', cls: 'bg-sky-500/10 text-sky-400 border-sky-500/30' };
        if (role === 'admin')  return { label: 'Admin',     cls: 'bg-violet-500/10 text-violet-400 border-violet-500/30' };
        return                       { label: 'Pasajero',  cls: 'bg-gray-500/10 text-gray-400 border-gray-500/30' };
    };

    if (!authorized) {
        return (
            <div className="min-h-screen bg-[#0F1014] flex items-center justify-center">
                <div className="w-8 h-8 border-4 border-violet-600 border-t-transparent rounded-full animate-spin"></div>
            </div>
        );
    }

    const selectedThread = threads.find(t => t.id === selectedId);
    const selectedProfile = selectedThread ? profiles[selectedThread.user_id] : null;

    return (
        <div className="min-h-screen bg-[#0F1014] p-4 md:p-8 font-sans text-white">
            <AdminNav />

            <div className="flex items-center gap-4 mb-6">
                <div className="bg-gradient-to-br from-violet-600 to-fuchsia-600 p-3 rounded-2xl shadow-lg shadow-violet-600/20">
                    <span className="material-symbols-outlined text-white text-2xl">support_agent</span>
                </div>
                <div>
                    <h1 className="text-2xl font-black tracking-tight text-white">Soporte</h1>
                    <p className="text-gray-400 text-sm font-medium">Conversaciones con pasajeros y conductores</p>
                </div>
            </div>

            <div className="bg-[#1A1F2E] p-3 rounded-[20px] border border-white/5 mb-6 flex gap-2 overflow-x-auto">
                {FILTERS.map(f => (
                    <button
                        key={f.id}
                        onClick={() => { setFilter(f.id); setSelectedId(null); setSearchParams({}); }}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-sm whitespace-nowrap transition-all ${filter === f.id
                            ? 'bg-[#2C3345] text-white shadow-lg'
                            : 'text-gray-500 hover:text-white hover:bg-white/5'}`}
                    >
                        <span className="material-symbols-outlined text-[16px]">{f.icon}</span>
                        {f.label}
                    </button>
                ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-[360px_1fr] gap-4 h-[calc(100vh-260px)] min-h-[500px]">
                {/* ─── Lista de hilos ─── */}
                <div className="bg-[#1A1F2E] rounded-[20px] border border-white/5 overflow-y-auto">
                    {loading ? (
                        <div className="flex justify-center py-20">
                            <div className="w-8 h-8 border-4 border-violet-600 border-t-transparent rounded-full animate-spin"></div>
                        </div>
                    ) : threads.length === 0 ? (
                        <div className="text-center py-20 px-6">
                            <span className="material-symbols-outlined text-gray-500 text-4xl">inbox</span>
                            <p className="text-gray-400 font-medium mt-2 text-sm">
                                {filter === 'open' ? 'No hay conversaciones abiertas.' : 'No hay conversaciones cerradas.'}
                            </p>
                        </div>
                    ) : threads.map(t => {
                        const p = profiles[t.user_id];
                        const rb = roleBadge(p?.role);
                        const active = t.id === selectedId;
                        return (
                            <button
                                key={t.id}
                                onClick={() => { setSelectedId(t.id); setSearchParams({ thread: String(t.id) }); }}
                                className={`w-full text-left px-4 py-3 border-b border-white/5 flex gap-3 transition-colors ${active ? 'bg-violet-600/10' : 'hover:bg-white/5'}`}
                            >
                                <div className="w-10 h-10 rounded-full bg-[#0F1014] border border-white/10 flex items-center justify-center shrink-0 overflow-hidden">
                                    {p?.avatar_url ? (
                                        <img src={p.avatar_url} alt="" className="w-full h-full object-cover" />
                                    ) : (
                                        <span className="material-symbols-outlined text-gray-400">person</span>
                                    )}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <p className="font-bold text-white truncate text-sm">
                                            {p?.full_name || <span className="text-gray-500 italic">sin nombre</span>}
                                        </p>
                                        <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold border ${rb.cls}`}>{rb.label}</span>
                                    </div>
                                    <p className="text-xs text-gray-400 truncate mt-0.5">
                                        {t.last_message_preview || <span className="italic">sin mensajes</span>}
                                    </p>
                                </div>
                                <div className="flex flex-col items-end gap-1 shrink-0">
                                    <span className="text-[10px] text-gray-500">{fmtTime(t.last_message_at)}</span>
                                    {t.unread_for_admin && (
                                        <span className="w-2.5 h-2.5 bg-red-500 rounded-full"></span>
                                    )}
                                </div>
                            </button>
                        );
                    })}
                </div>

                {/* ─── Conversación ─── */}
                <div className="bg-[#1A1F2E] rounded-[20px] border border-white/5 flex flex-col overflow-hidden">
                    {!selectedThread ? (
                        <div className="flex-1 flex items-center justify-center text-gray-500">
                            <div className="text-center">
                                <span className="material-symbols-outlined text-5xl">chat</span>
                                <p className="mt-2 text-sm">Elegí una conversación de la lista.</p>
                            </div>
                        </div>
                    ) : (
                        <>
                            <div className="p-4 border-b border-white/5 flex justify-between items-center">
                                <div className="flex items-center gap-3 min-w-0">
                                    <div className="w-10 h-10 rounded-full bg-[#0F1014] border border-white/10 flex items-center justify-center shrink-0 overflow-hidden">
                                        {selectedProfile?.avatar_url ? (
                                            <img src={selectedProfile.avatar_url} alt="" className="w-full h-full object-cover" />
                                        ) : (
                                            <span className="material-symbols-outlined text-gray-400">person</span>
                                        )}
                                    </div>
                                    <div className="min-w-0">
                                        <p className="font-bold text-white truncate">
                                            {selectedProfile?.full_name || 'Sin nombre'}
                                        </p>
                                        {otherIsTyping ? (
                                            <p className="text-xs text-violet-300 truncate flex items-center gap-1">
                                                <span className="inline-flex gap-0.5">
                                                    <span className="w-1 h-1 rounded-full bg-violet-300 animate-bounce" style={{ animationDelay: '0ms' }}></span>
                                                    <span className="w-1 h-1 rounded-full bg-violet-300 animate-bounce" style={{ animationDelay: '150ms' }}></span>
                                                    <span className="w-1 h-1 rounded-full bg-violet-300 animate-bounce" style={{ animationDelay: '300ms' }}></span>
                                                </span>
                                                Escribiendo…
                                            </p>
                                        ) : (
                                            <p className="text-xs text-gray-400 truncate">
                                                {selectedProfile?.phone || '—'} · {roleBadge(selectedProfile?.role).label}
                                            </p>
                                        )}
                                    </div>
                                </div>
                                <button
                                    onClick={toggleStatus}
                                    className="px-3 py-2 rounded-lg text-xs font-bold bg-white/5 text-gray-300 hover:bg-white/10 flex items-center gap-1"
                                    title={selectedThread.status === 'open' ? 'Cerrar conversación' : 'Reabrir'}
                                >
                                    <span className="material-symbols-outlined text-[16px]">
                                        {selectedThread.status === 'open' ? 'task_alt' : 'replay'}
                                    </span>
                                    {selectedThread.status === 'open' ? 'Cerrar' : 'Reabrir'}
                                </button>
                            </div>

                            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#0F1014]">
                                {messages.length === 0 ? (
                                    <p className="text-center text-gray-500 text-sm mt-10">Sin mensajes aún.</p>
                                ) : messages.map(m => {
                                    const isAdmin = m.sender_role === 'admin';
                                    const url = m.attachment_path ? attachUrls[m.id] : null;
                                    return (
                                        <div key={m.id} className={`flex ${isAdmin ? 'justify-end' : 'justify-start'}`}>
                                            <div className={`max-w-[75%] p-2.5 rounded-2xl ${isAdmin
                                                ? 'bg-violet-600 text-white rounded-tr-none'
                                                : 'bg-[#1A1F2E] text-gray-100 rounded-tl-none border border-white/5'
                                                }`}>
                                                {m.attachment_path && (
                                                    <button
                                                        type="button"
                                                        onClick={() => url && setLightbox(url)}
                                                        className="block mb-1 rounded-lg overflow-hidden bg-black/20 max-w-full"
                                                    >
                                                        {url ? (
                                                            <img src={url} alt="Adjunto" className="max-w-[260px] max-h-[260px] object-cover" />
                                                        ) : (
                                                            <div className="w-[180px] h-[120px] flex items-center justify-center text-xs opacity-70">
                                                                <span className="material-symbols-outlined animate-pulse">image</span>
                                                            </div>
                                                        )}
                                                    </button>
                                                )}
                                                {m.content && (
                                                    <p className="text-sm whitespace-pre-wrap break-words">{m.content}</p>
                                                )}
                                                <div className={`flex items-center gap-1 mt-1 ${isAdmin ? 'justify-end' : 'justify-start'}`}>
                                                    <p className={`text-[10px] ${isAdmin ? 'text-white/70' : 'text-gray-500'}`}>
                                                        {fmtTime(m.created_at)}
                                                    </p>
                                                    {isAdmin && (
                                                        <span
                                                            className={`material-symbols-outlined text-[14px] leading-none ${m.read_at ? 'text-sky-300' : 'text-white/60'}`}
                                                            title={m.read_at ? 'Visto' : 'Enviado'}
                                                        >
                                                            {m.read_at ? 'done_all' : 'done'}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                                <div ref={messagesEndRef} />
                            </div>

                            <div className="p-3 border-t border-white/5 flex gap-2 items-center bg-[#1A1F2E]">
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept="image/*"
                                    className="hidden"
                                    onChange={handleFilePick}
                                />
                                <button
                                    onClick={() => fileInputRef.current?.click()}
                                    disabled={uploading || sending}
                                    title="Adjuntar imagen"
                                    className="p-2 text-violet-400 hover:text-violet-300 hover:bg-violet-500/10 rounded-lg disabled:opacity-40 transition-colors"
                                >
                                    <span className="material-symbols-outlined text-[22px]">
                                        {uploading ? 'progress_activity' : 'attach_file'}
                                    </span>
                                </button>
                                <input
                                    type="text"
                                    value={inputValue}
                                    onChange={(e) => { setInputValue(e.target.value); if (e.target.value) broadcastTyping(); }}
                                    onKeyDown={(e) => e.key === 'Enter' && sendReply()}
                                    placeholder={uploading ? 'Subiendo imagen…' : 'Escribir respuesta…'}
                                    disabled={uploading}
                                    className="flex-1 bg-[#0F1014] border border-white/10 rounded-lg outline-none px-3 py-2 text-sm focus:border-violet-500/50 text-white placeholder:text-gray-600"
                                />
                                <button
                                    onClick={sendReply}
                                    disabled={sending || uploading || !inputValue.trim()}
                                    className="px-4 py-2 bg-violet-600 text-white rounded-lg font-bold text-sm hover:bg-violet-700 disabled:opacity-40 flex items-center gap-1"
                                >
                                    <span className="material-symbols-outlined text-[18px]">send</span>
                                    Enviar
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </div>

            {lightbox && (
                <div
                    className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4 cursor-zoom-out"
                    onClick={() => setLightbox(null)}
                >
                    <img src={lightbox} alt="Adjunto ampliado" className="max-w-full max-h-full rounded-lg shadow-2xl" />
                </div>
            )}
        </div>
    );
};

export default AdminSupportPage;
