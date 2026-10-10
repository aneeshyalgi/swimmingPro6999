import { supabase } from "@/lib/supabase"

/**
 * Who may analyse a clip in the Stroke Lab: subscribers as often as they like, everyone else once. The backend decides
 * (backend/app/video_access.py); this tells it who is asking and reads its answer.
 */
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"
/** A random id for this browser, so the backend recognises a returning visitor. */
const VISITOR_ID = "swimgpt_visitor_id"
/** Set once this browser has had its free analysis (the only record of it before the backend kept count). */
const FREE_ANALYSIS_USED = "swimgpt_video_analysis_used"

/** GET /api/video-analysis/access: subscribed and free may analyse; the other two say what's needed first. */
export type Access = "subscribed" | "free" | "signup_required" | "subscription_required"
export type Paywall = Extract<Access, "signup_required" | "subscription_required">

export const isPaywall = (access: Access | null): access is Paywall => access === "signup_required" || access === "subscription_required"

function newId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID()
  // Pages served over plain http (a phone on the local network) have no randomUUID: a version 4 UUID by hand.
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function visitorId() {
  try {
    let id = localStorage.getItem(VISITOR_ID)
    if (!id) {
      id = newId()
      localStorage.setItem(VISITOR_ID, id)
    }
    return id
  } catch {
    return null // storage blocked: the backend still knows the network
  }
}

/** Sent with every Stroke Lab request: the signed-in account, if any, and this browser. */
export async function accessHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {}
  const { data: { session } } = await supabase.auth.getSession()
  if (session) headers.Authorization = `Bearer ${session.access_token}`
  const id = visitorId()
  if (id) headers["X-Visitor-Id"] = id
  try {
    if (localStorage.getItem(FREE_ANALYSIS_USED) === "true") headers["X-Free-Analysis-Used"] = "1"
  } catch { /* storage blocked */ }
  return headers
}

/** Whether this visitor may analyse, or null if that couldn't be checked (the backend still decides when analysing). */
export async function checkAccess(): Promise<Access | null> {
  try {
    const response = await fetch(`${API_URL}/api/video-analysis/access`, { headers: await accessHeaders() })
    if (!response.ok) return null
    return ((await response.json()) as { access: Access }).access
  } catch {
    return null
  }
}

/** The paywall a 402 response names, or null for any other response. */
export async function paywallOf(response: Response): Promise<Paywall | null> {
  if (response.status !== 402) return null
  try {
    const body = (await response.json()) as { detail?: { code?: string } }
    return body.detail?.code === "subscription_required" ? "subscription_required" : "signup_required"
  } catch {
    return "signup_required"
  }
}

export function rememberFreeAnalysisUsed() {
  try {
    localStorage.setItem(FREE_ANALYSIS_USED, "true")
  } catch { /* storage blocked: the backend keeps count anyway */ }
}
