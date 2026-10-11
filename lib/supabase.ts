import { createClient } from "@supabase/supabase-js"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? ""

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})

/** Where the link in a password reset email opens. Supabase only sends people back to addresses on its Redirect URLs list. */
export const RESET_PASSWORD_PATH = "/auth/reset-password"

// A reset link signs the athlete in for one thing: choosing a new password. When it opens on another page (Supabase falls
// back to its Site URL for an address that isn't on the list), take them on to the reset page rather than into the app.
if (typeof window !== "undefined") {
  supabase.auth.onAuthStateChange((event) => {
    if (event === "PASSWORD_RECOVERY" && window.location.pathname !== RESET_PASSWORD_PATH) window.location.replace(RESET_PASSWORD_PATH)
  })
}
