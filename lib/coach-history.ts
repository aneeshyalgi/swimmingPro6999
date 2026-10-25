/**
 * Saved coach chats (backend/app/coach_history.py): the athlete's conversation with their coach, kept on our side as
 * well as on this device, so the coach remembers it everywhere and another device (or this one, after its storage is
 * cleared) gets it back. hooks/use-coach-history.ts keeps the two in step; this is what it works with.
 *
 * - Messages written from now on are saved after their exchange: "pending" until they are, then "saved". Messages from
 *   before saved chats existed stay on this device only: they're never sent.
 * - One conversation per coach. Starting over ("New chat", "Clear history") makes a new one, and the server is told
 *   about it before anything else is saved, so nothing from before comes back. A device whose conversation was started
 *   over elsewhere keeps only what was written on it since (`reconcile`).
 * - The coach is given the conversation's last CONTEXT_MESSAGES messages with every message (`contextOf`).
 */
import type { PlanKind } from "@/lib/coach-plan"

/** How much of the conversation goes to the coach with each message (backend schemas.HISTORY_MESSAGES). */
export const CONTEXT_MESSAGES = 50
/** What a backend from before took (it refuses more than 20): sent until the backend says it takes more (`loadSaved`),
 *  so the chat keeps working while the website is updated before the backend. */
export const EARLIER_CONTEXT = 12
// Newest first: how many messages get how many characters (backend coach_history.HISTORY_CHARS): the newest almost
// whole, older ones shortened, so a long conversation keeps replies quick.
const CONTEXT_CHARS: readonly (readonly [number, number])[] = [[6, 12_000], [20, 2_000], [CONTEXT_MESSAGES, 800]]
/** A message's text as it's saved (backend coach_history.MESSAGE_CHARS). */
const SAVED_CHARS = 40_000
/** Ids the server takes (backend coach_history.ID). */
const ID = /^[A-Za-z0-9_-]{1,100}$/
const SYNC_PREFIX = "swimgpt_coach_sync_"
const TIMEOUT_MS = 15_000

export type Role = "user" | "assistant"

/** A message of a coach chat, as far as saving it goes. */
export type ThreadMessage = {
  id: string
  role: Role
  content: string
  timestamp: Date
  failed?: boolean
  /** A coach reply said on a voice call. */
  voice?: boolean
  plan?: PlanKind
  /** Written since saved chats began: "pending" until it's saved, then "saved". Messages from before have none. */
  sync?: "pending" | "saved"
  /** The coach's welcome that every conversation opens with on the device: never saved. */
  greeting?: boolean
}

export type SavedMessage = { id: string; role: Role; content: string; at: string; voice: boolean; plan: PlanKind | null }
export type SavedThread = { conversation: string; started_at: string; reset_at: string | null; messages: SavedMessage[] }
/** `context`: how many messages of the conversation the backend takes with a message. */
export type SavedChats = { available: boolean; threads: Record<string, SavedThread>; context: number }

/** This device's side of saved chats, kept with its conversations. */
export type SyncState = {
  /** Which saved conversation each coach's thread here is part of. */
  conversations: Record<string, string>
  /** Conversations started over here that the server hasn't been told about yet. */
  resets: Record<string, string>
  /** A "Clear history" the server hasn't been told about yet: the athlete's other saved chats go too. */
  everything: boolean
}

/** `text` without halves of broken characters (an emoji cut in two), which a server can't read as text. */
function wellFormed(text: string) {
  if (!/[\uD800-\uDFFF]/.test(text)) return text
  let whole = ""
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    const next = text.charCodeAt(index + 1)
    if (code >= 0xd800 && code <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
      whole += text.slice(index, index + 2)
      index += 1
    } else if (code < 0xd800 || code > 0xdfff) whole += text[index]
  }
  return whole
}

/** `text` cut to `limit` characters, never through the middle of a character. */
function cut(text: string, limit: number, mark = "") {
  const whole = wellFormed(text)
  if (whole.length <= limit) return whole
  const code = whole.charCodeAt(limit - 1)
  return `${whole.slice(0, code >= 0xd800 && code <= 0xdbff ? limit - 1 : limit).trimEnd()}${mark}`
}

const time = (message: ThreadMessage) => {
  const at = message.timestamp instanceof Date ? message.timestamp.getTime() : NaN
  return Number.isFinite(at) ? at : 0
}

/** The conversation as it goes to the coach with a message: its last `count` messages, older ones shortened. */
export function contextOf(messages: readonly ThreadMessage[], count = CONTEXT_MESSAGES): { role: Role; content: string }[] {
  const recent = messages.filter((message) => !message.failed).slice(-Math.max(1, Math.min(count, CONTEXT_MESSAGES)))
  return recent.map((message, index) => {
    const age = recent.length - 1 - index
    const limit = (CONTEXT_CHARS.find(([newest]) => age < newest) ?? CONTEXT_CHARS[CONTEXT_CHARS.length - 1])[1]
    return { role: message.role, content: cut(message.content, limit, " […]") }
  })
}

/** The coach's welcome: marked as one, or (from before welcomes were marked) the thread's first message saying hello. */
export const isGreeting = (message: ThreadMessage, index: number) =>
  message.greeting === true || (index === 0 && message.role === "assistant" && !message.sync && message.content.startsWith("Hello! I'm "))

/** A message the server should have and doesn't yet: a whole exchange, with an id it takes. */
export const unsaved = (message: ThreadMessage) =>
  message.sync === "pending" && !message.failed && ID.test(message.id) && message.content.trim() !== ""

export const toSaved = (message: ThreadMessage): SavedMessage => ({
  id: message.id, role: message.role, content: cut(message.content, SAVED_CHARS),
  at: new Date(time(message) || Date.now()).toISOString(), voice: !!message.voice, plan: message.plan ?? null,
})

/**
 * This device's conversation with a coach brought up to date with the saved one (`attached`: the saved conversation
 * it's part of, if any). The same conversation, or one another device started while this one had never saved: every
 * message stays and the other devices' are added. Started over elsewhere since: only what was written here after that
 * stays. Messages are in the order they were written, the welcome first; a message both have keeps this device's copy,
 * which holds what only this device knows (a reply's sessions, read or added). The thread itself when nothing changes.
 */
export function reconcile<M extends ThreadMessage>(local: M[], attached: string | undefined, saved: SavedThread,
  restore: (message: SavedMessage) => M, greeting: () => M): M[] {
  const resetAt = saved.reset_at ? Date.parse(saved.reset_at) : NaN
  const startedOver = attached !== saved.conversation && Number.isFinite(resetAt)
  const welcome = local.length && isGreeting(local[0], 0) ? local[0] : null
  const rest = welcome ? local.slice(1) : local
  const kept = startedOver ? rest.filter((message) => time(message) >= resetAt) : rest
  const savedIds = new Set(saved.messages.map((message) => message.id))
  const keptIds = new Set(kept.map((message) => message.id))
  const added = saved.messages.filter((message) => !keptIds.has(message.id))
  const marked = markSaved(kept, savedIds, true)
  if (!startedOver && !added.length) return marked === kept ? local : welcome ? [welcome, ...marked] : marked
  const merged = [...marked, ...added.map(restore)].sort((a, b) => time(a) - time(b))
  const head = welcome ?? (startedOver || !local.length ? greeting() : null)
  return head ? [head, ...merged] : merged
}

/** Messages the server has (`any`: whether or not this device was saving them), marked saved; the thread itself when
 *  none changes (they were already, or the thread changed meanwhile and they're gone). */
export function markSaved<M extends ThreadMessage>(thread: M[], ids: ReadonlySet<string>, any = false): M[] {
  const changes = (message: M) => ids.has(message.id) && (any ? message.sync !== "saved" : message.sync === "pending")
  return thread.some(changes) ? thread.map((message) => (changes(message) ? { ...message, sync: "saved" as const } : message)) : thread
}

/** Messages the server won't take (not this athlete's coach any more): kept on this device only, like older ones. */
export function keepHere<M extends ThreadMessage>(thread: M[], ids: ReadonlySet<string>): M[] {
  const changes = (message: M) => ids.has(message.id) && message.sync === "pending"
  return thread.some(changes) ? thread.map((message) => (changes(message) ? { ...message, sync: undefined } : message)) : thread
}

export function newConversation(): string {
  const random = globalThis.crypto?.randomUUID?.()
  return random ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

export function readSyncState(userKey: string): SyncState {
  const fresh: SyncState = { conversations: {}, resets: {}, everything: false }
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(SYNC_PREFIX + userKey) || "null")
    if (!record(stored)) return fresh
    const names = (value: unknown) => Object.fromEntries(Object.entries(record(value) ? value : {}).filter(([, id]) => typeof id === "string" && ID.test(id))) as Record<string, string>
    return { conversations: names(stored.conversations), resets: names(stored.resets), everything: stored.everything === true }
  } catch {
    return fresh
  }
}

export function writeSyncState(userKey: string, state: SyncState) {
  try {
    localStorage.setItem(SYNC_PREFIX + userKey, JSON.stringify(state))
  } catch {
    // Storage full or unavailable: saving carries on for this visit.
  }
}

// ---------------------------------------------------------------- the server (backend/app/coach_history.py)
export type Api = { base: string; authorization: string }

async function call(api: Api, path: string, init: RequestInit = {}): Promise<Response | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    return await fetch(`${api.base}/api/coach-chat/history${path}`, {
      ...init, signal: controller.signal,
      headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), Authorization: api.authorization },
    })
  } catch {
    return null // offline, or no answer in time: tried again later
  } finally {
    clearTimeout(timer)
  }
}

const savedMessage = (value: unknown): value is SavedMessage =>
  record(value) && typeof value.id === "string" && (value.role === "user" || value.role === "assistant")
  && typeof value.content === "string" && typeof value.at === "string" && Number.isFinite(Date.parse(value.at))

function savedThread(value: unknown): SavedThread | null {
  if (!record(value) || typeof value.conversation !== "string" || !Array.isArray(value.messages)) return null
  const resetAt = typeof value.reset_at === "string" && Number.isFinite(Date.parse(value.reset_at)) ? value.reset_at : null
  return {
    conversation: value.conversation, started_at: typeof value.started_at === "string" ? value.started_at : "", reset_at: resetAt,
    messages: value.messages.filter(savedMessage).map((message) => ({
      id: message.id, role: message.role, content: message.content, at: message.at, voice: message.voice === true,
      plan: message.plan === "swim" || message.plan === "gym" || message.plan === "both" ? message.plan : null,
    })),
  }
}

/** The athlete's saved chats; `available` false while the server has none to keep; null when they couldn't be read. */
export async function loadSaved(api: Api): Promise<SavedChats | null> {
  const response = await call(api, "")
  if (!response?.ok) return null
  try {
    const body: unknown = await response.json()
    if (!record(body) || typeof body.available !== "boolean") return null
    const threads: Record<string, SavedThread> = {}
    for (const [coach, value] of Object.entries(record(body.threads) ? body.threads : {})) {
      const thread = savedThread(value)
      if (thread) threads[coach] = thread
    }
    const context = typeof body.context === "number" && Number.isInteger(body.context) ? Math.max(1, Math.min(body.context, CONTEXT_MESSAGES)) : EARLIER_CONTEXT
    return { available: body.available, threads, context }
  } catch {
    return null
  }
}

export type SaveResult = { saved: string[] } | { stale: SavedThread | null } | "unavailable" | "refused" | null

/** Saves new messages of the conversation with `coach`: `stale` (with the conversation as it is now) when it was started
 *  over elsewhere, "refused" when the server won't take them, null when they couldn't be saved just now. */
export async function saveMessages(api: Api, coach: string, conversation: string, messages: SavedMessage[]): Promise<SaveResult> {
  const response = await call(api, "", { method: "POST", body: JSON.stringify({ coach, conversation, messages }) })
  if (!response) return null
  if (response.status === 503) return "unavailable"
  if (response.status === 403 || response.status === 422) return "refused"
  if (!response.ok) return null
  try {
    const body: unknown = await response.json()
    if (!record(body)) return null
    if (body.stale === true) return { stale: savedThread(body.thread) }
    return Array.isArray(body.saved) ? { saved: body.saved.filter((id): id is string => typeof id === "string") } : null
  } catch {
    return null
  }
}

/** Tells the server about conversations started over here: "done", "unavailable" (nothing saved to start over), or
 *  null when it couldn't be told just now. */
export async function tellStartedOver(api: Api, conversations: Record<string, string>, everything: boolean): Promise<"done" | "unavailable" | null> {
  const response = await call(api, "/reset", { method: "POST", keepalive: true, body: JSON.stringify({ conversations, everything }) })
  if (!response) return null
  if (response.status === 503) return "unavailable"
  return response.ok || response.status === 422 ? "done" : null
}
