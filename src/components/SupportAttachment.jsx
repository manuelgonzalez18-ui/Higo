import React from 'react';

// Renderiza el adjunto de un mensaje de soporte según su MIME type.
// Compartido entre SupportChatWidget (cliente) y AdminSupportPage (panel)
// para mantener consistencia visual y de comportamiento.
//
// Props:
//   url         signed URL ya resuelta (puede ser null mientras carga)
//   mime        attachment_mime del mensaje
//   size        attachment_size en bytes (puede ser null)
//   variant     'user' | 'admin' — controla colores del card
//   onZoom(url) callback para imágenes (lightbox)

const fmtBytes = (n) => {
    if (!n || n < 1024) return n ? `${n} B` : '';
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
};

const SupportAttachment = ({ url, mime, size, variant = 'user', onZoom }) => {
    const isImage = mime?.startsWith('image/');
    const isAudio = mime?.startsWith('audio/');
    const isPdf   = mime === 'application/pdf';

    // ── Imagen: thumbnail con click-to-zoom ──────────────────────────
    if (isImage) {
        return (
            <button
                type="button"
                onClick={() => url && onZoom?.(url)}
                className="block mb-1 rounded-lg overflow-hidden bg-black/10 max-w-full"
            >
                {url ? (
                    <img src={url} alt="Adjunto" className="max-w-[240px] max-h-[240px] object-cover" />
                ) : (
                    <div className="w-[180px] h-[120px] flex items-center justify-center text-xs opacity-70">
                        <span className="material-symbols-outlined animate-pulse">image</span>
                    </div>
                )}
            </button>
        );
    }

    // ── Audio: <audio controls> nativo ───────────────────────────────
    if (isAudio) {
        return (
            <div className="mb-1 max-w-[260px]">
                {url ? (
                    <audio controls src={url} className="w-full h-10 rounded-md" preload="metadata" />
                ) : (
                    <div className="h-10 rounded-md bg-black/10 flex items-center justify-center text-xs opacity-70">
                        <span className="material-symbols-outlined animate-pulse">audiotrack</span>
                    </div>
                )}
                {size ? <p className="text-[10px] opacity-60 mt-0.5">{fmtBytes(size)}</p> : null}
            </div>
        );
    }

    // ── PDF / archivo genérico: tarjeta con icono + botón "Abrir" ────
    const icon = isPdf ? 'picture_as_pdf' : 'description';
    const label = isPdf ? 'Documento PDF' : (mime || 'Archivo');
    const cardBg = variant === 'admin'
        ? 'bg-black/30 border-white/10'
        : 'bg-white/10 border-white/20 dark:bg-black/20';

    return (
        <a
            href={url || '#'}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => { if (!url) e.preventDefault(); }}
            className={`flex items-center gap-2 mb-1 px-2.5 py-2 rounded-lg border ${cardBg} max-w-[260px] hover:bg-opacity-70 transition-colors`}
        >
            <span className={`material-symbols-outlined text-[28px] ${isPdf ? 'text-red-400' : 'text-blue-300'} shrink-0`}>
                {icon}
            </span>
            <div className="min-w-0 flex-1">
                <p className="text-xs font-bold truncate">{label}</p>
                <p className="text-[10px] opacity-70">{url ? (size ? `${fmtBytes(size)} · Abrir` : 'Abrir') : 'Cargando…'}</p>
            </div>
        </a>
    );
};

export default SupportAttachment;
