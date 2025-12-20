
import { createClient } from '@supabase/supabase-js'

// TODO: Replace these with your actual Supabase URL and Anon Key from the Project Settings -> API
// You can find these in your Supabase Dashboard under Project Settings > API
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase Environment Variables. Check .env file.')
}

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

