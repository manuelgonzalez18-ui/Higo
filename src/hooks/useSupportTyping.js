import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '../services/supabase';

// Typing indicator del chat de soporte. Usa Supabase Realtime broadcast
// (no persiste en DB). Misma topic en ambos lados:
//   support_typing:<threadId>
//
// Diseño:
//   · El que tipea hace channel.send('typing') con throttle de 1.5s.
//     Cuando deja de tipear (envió, borró todo, o pasan 3s sin escribir),
//     no manda nada — el receptor lo detecta por timeout.
//   · El receptor mantiene un state booleano que se prende al recibir y
//     se apaga automáticamente 3s después del último broadcast.
//   · Filtramos por `role` para no auto-mostrarnos "Escribiendo…" cuando
//     somos nosotros mismos en otra pestaña.
//
// Devuelve { otherIsTyping, broadcastTyping } — broadcastTyping se
// llama desde el onChange del input.

const THROTTLE_MS = 1500;
const AUTO_CLEAR_MS = 3000;

export const useSupportTyping = (threadId, myRole) => {
    const [otherIsTyping, setOtherIsTyping] = useState(false);
    const channelRef = useRef(null);
    const lastSentRef = useRef(0);
    const clearTimerRef = useRef(null);

    useEffect(() => {
        if (!threadId || !myRole) return;
        const channel = supabase
            .channel(`support_typing:${threadId}`, { config: { broadcast: { self: false } } })
            .on('broadcast', { event: 'typing' }, ({ payload }) => {
                if (!payload || payload.role === myRole) return;
                setOtherIsTyping(true);
                if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
                clearTimerRef.current = setTimeout(() => setOtherIsTyping(false), AUTO_CLEAR_MS);
            })
            .subscribe();
        channelRef.current = channel;

        return () => {
            if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
            supabase.removeChannel(channel);
            channelRef.current = null;
            setOtherIsTyping(false);
        };
    }, [threadId, myRole]);

    const broadcastTyping = useCallback(() => {
        const ch = channelRef.current;
        if (!ch) return;
        const now = Date.now();
        if (now - lastSentRef.current < THROTTLE_MS) return;
        lastSentRef.current = now;
        ch.send({ type: 'broadcast', event: 'typing', payload: { role: myRole, ts: now } });
    }, [myRole]);

    return { otherIsTyping, broadcastTyping };
};
