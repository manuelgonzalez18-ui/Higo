import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

// Toast system para Higo (Fase 12 C2). Reemplaza los 55 alert() del
// repo con notificaciones no-bloqueantes apilables.
//
// API:
//   const toast = useToast();
//   toast.success('Listo!');
//   toast.error('No se pudo subir', { duration: 8000 });
//   toast.info('Tu chofer está a 2 min.');
//   toast.warning('Tu membresía vence pronto.', { action: { label: 'Renovar', onClick } });
//
// Singleton fallback (no-React): import { toast } from './Toast'.
// Útil en utils / services. Es no-op si el ToastProvider no se montó
// todavía (early init, primer paint, etc).
//
// Acessibilidad: role="status" para screen readers. Esc cierra el
// último toast activo. aria-live=polite para no interrumpir.

const ToastContext = createContext(null);

const DEFAULT_DURATION = {
    success: 3500,
    info:    4000,
    warning: 6000,
    error:   6000,
};

const ICONS = {
    success: { icon: 'check_circle', cls: 'text-emerald-400 bg-emerald-500/15 border-emerald-500/30' },
    error:   { icon: 'error',        cls: 'text-rose-400    bg-rose-500/15    border-rose-500/30' },
    warning: { icon: 'warning',      cls: 'text-amber-400   bg-amber-500/15   border-amber-500/30' },
    info:    { icon: 'info',         cls: 'text-blue-400    bg-blue-500/15    border-blue-500/30' },
};

// Singleton para callers no-React. Se enchufa con el provider en
// useEffect. Si todavía no hay provider montado, no-op.
let _push = null;
export const toast = {
    success: (msg, opts) => _push?.('success', msg, opts),
    error:   (msg, opts) => _push?.('error',   msg, opts),
    warning: (msg, opts) => _push?.('warning', msg, opts),
    info:    (msg, opts) => _push?.('info',    msg, opts),
};

export const ToastProvider = ({ children }) => {
    const [toasts, setToasts] = useState([]);

    const dismiss = useCallback((id) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    }, []);

    const push = useCallback((kind, msg, opts = {}) => {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const duration = opts.duration ?? DEFAULT_DURATION[kind] ?? 4000;
        setToasts(prev => [...prev, { id, kind, msg, action: opts.action }]);
        if (duration > 0) {
            setTimeout(() => dismiss(id), duration);
        }
        return id;
    }, [dismiss]);

    const api = useMemo(() => ({
        success: (msg, opts) => push('success', msg, opts),
        error:   (msg, opts) => push('error',   msg, opts),
        warning: (msg, opts) => push('warning', msg, opts),
        info:    (msg, opts) => push('info',    msg, opts),
        dismiss,
    }), [push, dismiss]);

    // Wire singleton al provider para que el `toast` exportado funcione.
    useEffect(() => {
        _push = push;
        return () => { _push = null; };
    }, [push]);

    // ESC cierra el último toast.
    useEffect(() => {
        const onKey = (e) => {
            if (e.key === 'Escape' && toasts.length > 0) {
                dismiss(toasts[toasts.length - 1].id);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [toasts, dismiss]);

    return (
        <ToastContext.Provider value={api}>
            {children}
            <ToastContainer toasts={toasts} onDismiss={dismiss} />
        </ToastContext.Provider>
    );
};

export const useToast = () => {
    const ctx = useContext(ToastContext);
    // Fallback: si alguien llama useToast sin provider, usamos el
    // singleton. No es ideal porque pierde reactividad, pero evita
    // crashes durante refactor incremental.
    return ctx || toast;
};

const ToastContainer = ({ toasts, onDismiss }) => (
    <div
        className="pointer-events-none fixed z-[9999] top-3 right-3 left-3 sm:left-auto flex flex-col gap-2 max-w-sm sm:max-w-md"
        aria-live="polite"
    >
        {toasts.map(t => {
            const ic = ICONS[t.kind] || ICONS.info;
            return (
                <div
                    key={t.id}
                    role="status"
                    className={`pointer-events-auto flex items-start gap-3 rounded-2xl border ${ic.cls} backdrop-blur-md shadow-2xl shadow-black/30 p-3 pr-2 animate-in slide-in-from-top-2 fade-in duration-200`}
                >
                    <span className={`material-symbols-outlined text-[20px] shrink-0 ${ic.cls.split(' ')[0]}`}>
                        {ic.icon}
                    </span>
                    <div className="flex-1 min-w-0 text-sm text-white">
                        {t.msg}
                        {t.action && (
                            <div className="mt-2">
                                <button
                                    onClick={() => { t.action.onClick?.(); onDismiss(t.id); }}
                                    className="text-xs font-bold underline hover:no-underline"
                                >
                                    {t.action.label}
                                </button>
                            </div>
                        )}
                    </div>
                    <button
                        onClick={() => onDismiss(t.id)}
                        className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center hover:bg-white/10 text-gray-300"
                        aria-label="Cerrar"
                    >
                        <span className="material-symbols-outlined text-[14px]">close</span>
                    </button>
                </div>
            );
        })}
    </div>
);

export default ToastProvider;
