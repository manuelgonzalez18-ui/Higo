import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase, getUserProfile } from '../services/supabase';
import AdminNav from '../components/AdminNav';
import { triggerSupportPush } from '../services/supportPush';
import { compressImage } from '../utils/imageCompression';
import { useSupportTyping } from '../hooks/useSupportTyping';
import SupportAttachment from '../components/SupportAttachment';
import AudioRecorder from '../components/AudioRecorder';

const SIGNED_URL_TTL = 3600;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
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

// Bandeja de soporte: lista de hilos a la izquierda + conversación a la derecha.
// Cada hilo es un usuario (pasajero o conductor) que escribió al equipo Higo.

const FILTERS = [
    { id: 'open',   label: 'Abiertos',  icon: 'mark_chat_unread' },
    { id: 'closed', label: 'Cerrados',  icon: 'mark_chat_read' }
];

const escapeHtml = (s) => s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Resalta el query dentro del texto, devolviendo HTML seguro para
// inyectar con dangerouslySetInnerHTML. Tanto el texto como el query
// pasan por escapeHtml antes de armar el regex.
const highlightMatch = (text, query) => {
    const safeText = escapeHtml(text || '');
    const q = (query || '').trim();
    if (q.length < 2) return safeText;
    const safeQ = escapeRegex(escapeHtml(q));
    const re = new RegExp(safeQ, 'gi');
    return safeText.replace(re, (m) => `<mark class="bg-yellow-400/40 text-yellow-100 rounded px-0.5">${m}</mark>`);
};

const AdminSupportPage = () => {
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();

    const [me, setMe] = useState(null);
    const [authorized, setAuthorized] = useState(false);
    const [loading, setLoading] = useState(true);

    const [filter, setFilter] = useState('open');
    const [threads, setThreads] = useState([]);
    const [profiles, setProfiles] = useState({}); // id → profile
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [searching, setSearching] = useState(false);
    const [selectedId, setSelectedId] = useState(null);
    const [messages, setMessages] = useState([]);
    const [inputValue, setInputValue] = useState('');
    const [sending, setSending] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [attachUrls, setAttachUrls] = useState({}); // msgId → signed URL
    const [lightbox, setLightbox] = useState(null);
    const [menuFor, setMenuFor] = useState(null);
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
        if (msg.attachment_path) {
            supabase.storage.from('support-attachments').remove([msg.attachment_path]).catch(() => {});
        }
    };

    useEffect(() => {
        if (menuFor === null) return;
        const close = () => setMenuFor(null);
        window.addEventListener('click', close);
        return () => window.removeEventListener('click', close);
    }, [menuFor]);

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

    // ─── Búsqueda global por contenido (debounced) ─────────────────────
    useEffect(() => {
        if (!authorized) return;
        const q = searchQuery.trim();
        if (q.length < 2) {
            setSearchResults([]);
            setSearching(false);
            return;
        }
        setSearching(true);
        const t = setTimeout(async () => {
            const { data, error } = await supabase.rpc('search_support_messages', {
                p_query: q, p_limit: 50,
            });
            if (error) console.error('Búsqueda falló:', error);
            setSearchResults(data || []);
            setSearching(false);
        }, 300);
        return () => clearTimeout(t);
    }, [searchQuery, authorized]);

    const openHit = (hit) => {
        setSearchQuery('');
        setSearchResults([]);
        setSelectedId(hit.thread_id);
        setSearchParams({ thread: String(hit.thread_id), msg: String(hit.message_id) });
    };

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
            // Si llegamos vía ?msg=N, scrolleamos al mensaje y lo flasheamos.
            const targetMsgId = searchParams.get('msg');
            if (targetMsgId) {
                setTimeout(() => {
                    const el = document.getElementById(`support-msg-${targetMsgId}`);
                    if (el) {
                        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        el.classList.add('ring-2', 'ring-yellow-400', 'rounded-2xl');
                        setTimeout(() => el.classList.remove('ring-2', 'ring-yellow-400', 'rounded-2xl'), 2200);
                    }
                }, 120);
            }
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

    // Reusado por file picker y por el grabador de audio in-app.
    const uploadAndSend = async (file) => {
        if (!selectedId || !me?.id) return;
        if (file.size > MAX_UPLOAD_BYTES) {
            alert('El archivo pesa más de 10 MB.');
            return;
        }
        setUploading(true);
        try {
            const mime = file.type || 'application/octet-stream';
            const ext  = extFromMime(mime);
            const path = `${selectedId}/${me.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
            const { error: upErr } = await supabase
                .storage
                .from('support-attachments')
                .upload(path, file, { contentType: mime, upsert: false });
            if (upErr) throw upErr;
            await insertAdminMessage({
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
        e.target.value = '';
        if (!raw) return;

        const isImage = raw.type.startsWith('image/');
        const isAudio = raw.type.startsWith('audio/');
        const isPdf   = raw.type === 'application/pdf';
        if (!isImage && !isAudio && !isPdf) {
            alert('Solo se admiten imágenes, PDF o audio.');
            return;
        }
        const file = isImage ? await compressImage(raw, 1600, 0.85) : raw;
        await uploadAndSend(file);
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

    // Badge según el contexto en el que el user abrió el chat (no según
    // su profile.role): un mismo user puede tener 2 hilos abiertos.
    const ctxBadge = (ctx) => {
        if (ctx === 'driver')    return { label: 'Conductor', cls: 'bg-sky-500/10 text-sky-400 border-sky-500/30' };
        if (ctx === 'passenger') return { label: 'Pasajero',  cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' };
        return                          { label: ctx || '—',  cls: 'bg-gray-500/10 text-gray-400 border-gray-500/30' };
    };

    // Avatar con overlay del contexto. Para evitar la confusión cuando
    // un user con profile.role='driver' usa la app como pasajero (su
    // avatar es la foto del conductor), si el contexto NO matchea el
    // role primario, mostramos icono genérico en vez de la foto.
    // El chip de la esquina inferior derecha SIEMPRE refleja el
    // contexto del hilo: car (sky) para driver, person (emerald) para
    // passenger — así el admin lo capta de un vistazo.
    const ThreadAvatar = ({ profile, ctx, size = 'md' }) => {
        const sizeCls = size === 'sm' ? 'w-9 h-9' : 'w-10 h-10';
        const badgeCls = size === 'sm' ? 'w-4 h-4 text-[10px]' : 'w-[18px] h-[18px] text-[11px]';
        const showPhoto = profile?.avatar_url && profile?.role === ctx;
        const isDriverCtx = ctx === 'driver';
        return (
            <div className={`relative ${sizeCls} shrink-0`}>
                <div className={`${sizeCls} rounded-full bg-[#0F1014] border border-white/10 flex items-center justify-center overflow-hidden`}>
                    {showPhoto ? (
                        <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                        <span className="material-symbols-outlined text-gray-400 text-[18px]">person</span>
                    )}
                </div>
                <span className={`absolute -bottom-0.5 -right-0.5 ${badgeCls} rounded-full border-2 border-[#1A1F2E] flex items-center justify-center ${isDriverCtx ? 'bg-sky-500 text-white' : 'bg-emerald-500 text-white'}`} title={ctxBadge(ctx).label}>
                    <span className="material-symbols-outlined" style={{ fontSize: size === 'sm' ? 10 : 12 }}>
                        {isDriverCtx ? 'directions_car' : 'person'}
                    </span>
                </span>
            </div>
        );
    };

    if (!authorized) {
        return (
            <div className="min-h-screen bg-[#0F1014] flex items-center justify-center">
                <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
            </div>
        );
    }

    const selectedThread = threads.find(t => t.id === selectedId);
    const selectedProfile = selectedThread ? profiles[selectedThread.user_id] : null;

    return (
        <div className="min-h-screen bg-[#0F1014] p-4 md:p-8 font-sans text-white">
            <AdminNav />

            <div className="flex items-center gap-4 mb-6">
                <div className="bg-blue-600 p-3 rounded-2xl shadow-lg shadow-blue-600/20">
                    <span className="material-symbols-outlined text-white text-2xl">support_agent</span>
                </div>
                <div className="flex-1 min-w-0">
                    <h1 className="text-2xl font-black tracking-tight text-white">Soporte</h1>
                    <p className="text-gray-400 text-sm font-medium">Conversaciones con pasajeros y conductores</p>
                </div>
                <button
                    onClick={() => navigate('/admin/support/stats')}
                    className="ml-auto px-4 py-2 rounded-lg text-sm font-bold bg-white/5 text-gray-300 hover:bg-white/10 flex items-center gap-1.5 self-start"
                    title="Ver métricas"
                >
                    <span className="material-symbols-outlined text-[18px]">monitoring</span>
                    Métricas
                </button>
            </div>

            <div className="bg-[#1A1F2E] p-3 rounded-[20px] border border-white/5 mb-3 flex items-center gap-2">
                <span className="material-symbols-outlined text-gray-500">search</span>
                <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Buscar texto en todas las conversaciones…"
                    className="flex-1 bg-transparent outline-none text-sm text-white placeholder:text-gray-600"
                />
                {searchQuery && (
                    <button
                        onClick={() => { setSearchQuery(''); setSearchResults([]); }}
                        className="text-gray-500 hover:text-white"
                        title="Limpiar"
                    >
                        <span className="material-symbols-outlined text-[18px]">close</span>
                    </button>
                )}
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
                {/* ─── Lista de hilos / resultados de búsqueda ─── */}
                <div className="bg-[#1A1F2E] rounded-[20px] border border-white/5 overflow-y-auto">
                    {searchQuery.trim().length >= 2 ? (
                        searching ? (
                            <div className="flex justify-center py-20">
                                <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                            </div>
                        ) : searchResults.length === 0 ? (
                            <div className="text-center py-20 px-6">
                                <span className="material-symbols-outlined text-gray-500 text-4xl">search_off</span>
                                <p className="text-gray-400 font-medium mt-2 text-sm">Sin coincidencias.</p>
                            </div>
                        ) : (
                            <>
                                <p className="px-4 py-2 text-[11px] uppercase tracking-wider font-bold text-gray-500 border-b border-white/5">
                                    {searchResults.length} {searchResults.length === 1 ? 'coincidencia' : 'coincidencias'}
                                </p>
                                {searchResults.map(hit => {
                                    const rb = ctxBadge(hit.thread_role_context || hit.user_role);
                                    return (
                                        <button
                                            key={hit.message_id}
                                            onClick={() => openHit(hit)}
                                            className="w-full text-left px-4 py-3 border-b border-white/5 flex gap-3 hover:bg-white/5 transition-colors"
                                        >
                                            <ThreadAvatar
                                                profile={{ avatar_url: hit.user_avatar, role: hit.user_role }}
                                                ctx={hit.thread_role_context}
                                                size="sm"
                                            />
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <p className="font-bold text-white truncate text-xs">
                                                        {hit.user_full_name || <span className="text-gray-500 italic">sin nombre</span>}
                                                    </p>
                                                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold border ${rb.cls}`}>{rb.label}</span>
                                                    <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold border bg-white/5 text-gray-400 border-white/10">
                                                        {hit.sender_role === 'admin' ? 'Equipo' : 'Usuario'}
                                                    </span>
                                                </div>
                                                <p className="text-xs text-gray-300 truncate mt-0.5"
                                                   dangerouslySetInnerHTML={{ __html: highlightMatch(hit.content || '', searchQuery) }}
                                                />
                                            </div>
                                            <span className="text-[10px] text-gray-500 shrink-0 self-start">{fmtTime(hit.created_at)}</span>
                                        </button>
                                    );
                                })}
                            </>
                        )
                    ) : loading ? (
                        <div className="flex justify-center py-20">
                            <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
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
                        const rb = ctxBadge(t.role_context);
                        const active = t.id === selectedId;
                        return (
                            <button
                                key={t.id}
                                onClick={() => { setSelectedId(t.id); setSearchParams({ thread: String(t.id) }); }}
                                className={`w-full text-left px-4 py-3 border-b border-white/5 flex gap-3 transition-colors ${active ? 'bg-blue-600/10' : 'hover:bg-white/5'}`}
                            >
                                <ThreadAvatar profile={p} ctx={t.role_context} />
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
                                    <ThreadAvatar profile={selectedProfile} ctx={selectedThread?.role_context} />
                                    <div className="min-w-0">
                                        <p className="font-bold text-white truncate">
                                            {selectedProfile?.full_name || 'Sin nombre'}
                                        </p>
                                        {otherIsTyping ? (
                                            <p className="text-xs text-blue-300 truncate flex items-center gap-1">
                                                <span className="inline-flex gap-0.5">
                                                    <span className="w-1 h-1 rounded-full bg-blue-300 animate-bounce" style={{ animationDelay: '0ms' }}></span>
                                                    <span className="w-1 h-1 rounded-full bg-blue-300 animate-bounce" style={{ animationDelay: '150ms' }}></span>
                                                    <span className="w-1 h-1 rounded-full bg-blue-300 animate-bounce" style={{ animationDelay: '300ms' }}></span>
                                                </span>
                                                Escribiendo…
                                            </p>
                                        ) : (
                                            <p className="text-xs text-gray-400 truncate">
                                                {selectedProfile?.phone || '—'} · {ctxBadge(selectedThread?.role_context).label}
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
                                    const isDeleted = !!m.deleted_at;
                                    const isMine = isAdmin && m.sender_id === me?.id;

                                    if (isDeleted) {
                                        return (
                                            <div key={m.id} className={`flex ${isAdmin ? 'justify-end' : 'justify-start'}`}>
                                                <div className={`max-w-[75%] px-3 py-2 rounded-2xl text-xs italic flex items-center gap-1.5 ${
                                                    isAdmin
                                                        ? 'bg-blue-600/30 text-white/70 rounded-tr-none'
                                                        : 'bg-[#1A1F2E] text-gray-500 rounded-tl-none border border-white/5'
                                                }`}>
                                                    <span className="material-symbols-outlined text-[14px]">block</span>
                                                    Mensaje eliminado
                                                </div>
                                            </div>
                                        );
                                    }

                                    return (
                                        <div key={m.id} id={`support-msg-${m.id}`} className={`flex ${isAdmin ? 'justify-end' : 'justify-start'}`}>
                                            <div className={`relative max-w-[75%] p-2.5 rounded-2xl group ${isAdmin
                                                ? 'bg-blue-600 text-white rounded-tr-none'
                                                : 'bg-[#1A1F2E] text-gray-100 rounded-tl-none border border-white/5'
                                                }`}>
                                                {m.attachment_path && (
                                                    <SupportAttachment
                                                        url={url}
                                                        mime={m.attachment_mime}
                                                        size={m.attachment_size}
                                                        variant="admin"
                                                        onZoom={setLightbox}
                                                    />
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

                                                {isMine && (
                                                    <>
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); setMenuFor(menuFor === m.id ? null : m.id); }}
                                                            className="absolute -top-1.5 -left-1.5 w-5 h-5 rounded-full bg-white/95 text-gray-700 shadow flex items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                                                            title="Más"
                                                        >
                                                            <span className="material-symbols-outlined text-[14px] leading-none">more_horiz</span>
                                                        </button>
                                                        {menuFor === m.id && (
                                                            <div
                                                                onClick={(e) => e.stopPropagation()}
                                                                className="absolute -top-2 right-full mr-2 z-10 bg-[#1A1F2E] rounded-lg shadow-xl border border-white/10 py-1 min-w-[140px]"
                                                            >
                                                                <button
                                                                    onClick={() => deleteMessage(m)}
                                                                    className="w-full text-left px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/10 flex items-center gap-1.5"
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

                            <div className="p-3 border-t border-white/5 flex gap-2 items-center bg-[#1A1F2E]">
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
                                            disabled={uploading || sending}
                                            title="Adjuntar imagen, PDF o audio"
                                            className="p-2 text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 rounded-lg disabled:opacity-40 transition-colors"
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
                                            placeholder={uploading ? 'Subiendo adjunto…' : 'Escribir respuesta…'}
                                            disabled={uploading}
                                            className="flex-1 bg-[#0F1014] border border-white/10 rounded-lg outline-none px-3 py-2 text-sm focus:border-blue-500/50 text-white placeholder:text-gray-600"
                                        />
                                    </>
                                )}
                                <AudioRecorder
                                    disabled={uploading || sending || !selectedId}
                                    variant="admin"
                                    onRecording={setIsRecording}
                                    onComplete={(file) => uploadAndSend(file)}
                                />
                                {!isRecording && (
                                    <button
                                        onClick={sendReply}
                                        disabled={sending || uploading || !inputValue.trim()}
                                        className="px-4 py-2 bg-blue-600 text-white rounded-lg font-bold text-sm hover:bg-blue-700 disabled:opacity-40 flex items-center gap-1"
                                    >
                                        <span className="material-symbols-outlined text-[18px]">send</span>
                                        Enviar
                                    </button>
                                )}
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
