import { supabase } from './supabase';

// Fire-and-forget al endpoint PHP que despierta al destinatario con FCM.
// Se llama después de un INSERT exitoso en support_messages. Cualquier
// error queda en consola; el mensaje ya está guardado y llega por
// realtime de todas formas, el push es solo el "wake up" cuando la app
// está cerrada o en background.

export async function triggerSupportPush(threadId) {
    if (!threadId) return;
    try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) return;
        await fetch('/api/send-support-push.php', {
            method:  'POST',
            headers: {
                'Authorization': 'Bearer ' + token,
                'Content-Type':  'application/json',
            },
            body: JSON.stringify({ thread_id: threadId }),
        });
    } catch (err) {
        console.warn('[support-push] no se pudo disparar el push:', err?.message || err);
    }
}
