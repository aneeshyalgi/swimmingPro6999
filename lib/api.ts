import { z } from "zod"
import { supabase } from "@/lib/supabase"

type RequestOptions = { method?: string; body?: unknown; signal?: AbortSignal }

/** A signed-in request to the SwimGPT API (`path` after /api), parsed with `schema`. Failures throw the API's message. */
export async function apiRequest<T>(path: string, schema: z.ZodType<T>, options: RequestOptions = {}): Promise<T> {
  const { data: { session }, error } = await supabase.auth.getSession()
  if (error) throw error
  if (!session) throw new Error("Your session has ended. Sign in again.")
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"
  const response = await fetch(`${apiUrl}/api${path}`, {
    method: options.method || (options.body === undefined ? "GET" : "POST"),
    headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  })
  if (!response.ok) {
    let detail = `The request failed (${response.status}). Please try again.`
    try {
      const parsed = (await response.json()) as { detail?: string | { msg: string }[] }
      if (typeof parsed.detail === "string") detail = parsed.detail
      else if (Array.isArray(parsed.detail)) detail = parsed.detail.map((item) => item.msg).join("; ")
    } catch {
      // Not JSON: keep the status message.
    }
    throw new Error(detail)
  }
  return schema.parse(await response.json())
}

/** Today's date where the athlete is (daily logs are kept per local day). */
export function localDay(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
}
