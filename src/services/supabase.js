import { createClient } from '@supabase/supabase-js'

// Valores del proyecto Supabase. Son seguros exponer en el cliente:
// - URL del proyecto: pública por definición
// - anon key: protegida por Row Level Security en la DB
// Si en .env o en CI está definida una variable, esa gana. Caso contrario,
// usamos estos valores fallback para evitar un "Missing env vars" fatal.
const FALLBACK_URL = 'https://yfgomicdcwifgeumqsvv.supabase.co';
const FALLBACK_KEY = 'sb_publishable_d0f_4LR1PqQBc87ThKaxqQ_wm9CGAI1';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || FALLBACK_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || FALLBACK_KEY;

export const supabase = createClient(supabaseUrl, supabaseKey)

export const getUserProfile = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single()

    if (error || !data) {
        // Fallback if no profile exists yet
        return { id: user.id, role: 'passenger' }
    }
    return data
}

