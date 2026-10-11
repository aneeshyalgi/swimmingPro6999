import { isAuthError } from "@supabase/supabase-js"
import { RESET_PASSWORD_PATH, supabase } from "@/lib/supabase"

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"

/** Supabase's minimum, the same as at sign-up. */
export const PASSWORD_MIN_LENGTH = 6
/** Supabase sends at most one email a minute to the same address. */
export const RESEND_AFTER_SECONDS = 60

/** Where to go after signing in when another page sent the visitor here (like buying a training plan): a path on this
 * site only, never another site. */
export function safeNext(value: string | null) {
  return value && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\") ? value : null
}

/** Where a signed-in athlete belongs: setup first, then the payment screen; the dashboard is only for athletes who have paid. */
export async function homePath(accessToken: string) {
  const response = await fetch(`${API_URL}/api/onboarding/status`, { headers: { Authorization: `Bearer ${accessToken}` } })
  if (!response.ok) throw new Error("We could not check your onboarding status. Please try again.")
  const result: { completed: boolean; paid: boolean; user_key: string | null } = await response.json()
  // What this browser remembers about an athlete belongs to the last one signed in on it: forget it when that was someone
  // else (a reset link can sign in another account without signing the first one out).
  const remembered = localStorage.getItem("swimgpt_user_key")
  if (remembered && remembered !== result.user_key) {
    for (const key of ["swimgpt_user_key", "swimgpt_onboarding", "swimgpt_coaches"]) localStorage.removeItem(key)
  }
  if (result.completed && result.user_key) localStorage.setItem("swimgpt_user_key", result.user_key)
  return !result.completed ? "/onboarding" : result.paid ? "/dashboard" : "/subscribe"
}

export function passwordScore(password: string) {
  if (!password) return 0
  let score = password.length >= 8 ? 1 : 0
  if (password.length >= 12) score += 1
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1
  if (/\d/.test(password) && /[^A-Za-z0-9]/.test(password)) score += 1
  return Math.max(1, score)
}

/** Emails a link for choosing a new password, which opens the reset page on this site (then `next`, if given). Supabase
 * answers the same whether or not the address has an account, so this never tells anyone who has one. */
export async function sendPasswordReset(email: string, next?: string | null) {
  const redirectTo = `${window.location.origin}${RESET_PASSWORD_PATH}${next ? `?next=${encodeURIComponent(next)}` : ""}`
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo })
  if (error) throw error
}

/** The wait Supabase asks for before the next email ("you can only request this after 42 seconds"), when it gives one. */
export function secondsToWait(error: unknown) {
  const match = error instanceof Error ? /after (\d+) seconds?/i.exec(error.message) : null
  return match ? Number(match[1]) : null
}

/** Supabase's sign-in and password errors, in plain words. */
export function accountMessage(error: unknown, fallback = "Something went wrong. Please try again.") {
  if (!isAuthError(error)) return error instanceof Error && error.message ? error.message : fallback
  switch (error.code) {
    case "over_email_send_rate_limit": {
      const seconds = secondsToWait(error)
      return seconds
        ? `For your security, you can ask for another email in ${seconds} seconds.`
        : "We've sent a lot of emails in the last hour. Please try again a little later."
    }
    case "over_request_rate_limit":
      return "Too many tries in a row. Wait a minute, then try again."
    case "email_address_invalid":
      return "That email address doesn't look right. Check it and try again."
    case "same_password":
      return "That's already your password. Choose a new one."
    case "weak_password":
      return error.message || `Use at least ${PASSWORD_MIN_LENGTH} characters.`
  }
  if (error.name === "AuthRetryableFetchError") {
    return error.status === 0 ? "We couldn't reach SwimGPT. Check your connection and try again." : fallback
  }
  return error.message || fallback
}
