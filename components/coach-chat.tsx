"use client"

import type React from "react"
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react"
import { createPortal } from "react-dom"
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  AudioLines,
  BookOpen,
  CalendarPlus,
  Check,
  Copy,
  Loader2,
  MessageSquarePlus,
  Mic,
  RotateCcw,
  Sparkles,
  Square,
  Target,
  Trash2,
  Volume2,
} from "lucide-react"
import { supabase } from "@/lib/supabase"
import { cn } from "@/lib/utils"
import { ChatMarkdown, type ChatSource } from "@/components/chat-markdown"
import { Reveal } from "@/components/dashboard-ui"
import { WaterBubbles } from "@/components/water-bubbles"
import { CoachAvatar as CoachPortrait } from "@/components/coach-avatar"
import { useCoachAudio } from "@/hooks/use-coach-audio"
import { useCoachHistory } from "@/hooks/use-coach-history"
import { EARLIER_CONTEXT, type SavedMessage } from "@/lib/coach-history"
import { CallScene, ScenePicker, SceneTitle } from "@/components/call-scenes"
import { CONTINUED, CoachConversation, coachTone } from "@/components/coach-conversation"
import { askCoachLive } from "@/lib/coach-audio"
import { DEFAULT_SCENE, SCENE_PICKED, drawnScene, saveScene, savedScene, sceneById, type SceneId } from "@/lib/call-scenes"
import { CoachPlanSheet, PlanCallout } from "@/components/coach-plan-sheet"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { randomId } from "@/lib/training"
import { readPlanFor, type AddedSession, type CoachPlan, type PlanKind, type TrainingTarget } from "@/lib/coach-plan"

type Message = {
  id: string
  role: "user" | "assistant"
  content: string
  timestamp: Date
  sources?: ChatSource[]
  failed?: boolean
  /** The kinds of session the coach's reply prescribes, which can be added to the athlete's weeks. */
  plan?: PlanKind
  /** Said on a voice call. */
  voice?: boolean
  /** The reply read into its sessions, kept so opening it again is instant. */
  planDraft?: CoachPlan
  /** How many of its sessions were added to the athlete's training. */
  planAdded?: { count: number; at: string; kinds?: ("swim" | "gym")[] }
  /** Saved chats (lib/coach-history.ts): written since they began, "pending" until saved. Older messages have none. */
  sync?: "pending" | "saved"
  /** The coach's welcome a conversation opens with (never saved). */
  greeting?: boolean
}

// Public coach profile from GET /api/coaches (backend/app/coach_catalog.py).
type CoachInfo = {
  name: string
  title: string
  inspired_by: string | null
  summary: string
  main_events: string[]
  sessions: { type: string; count: number; description: string }[]
  source_files: string[]
}

type Point = { x: number; y: number }

const MAX_MESSAGE_LENGTH = 4000
const STORAGE_PREFIX = "swimgpt_coach_chat_"
const CLOSE_MS = 320
const apiUrl = () => process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"
const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

// Coach profiles are the same for everyone, so they are fetched once per visit and the chat opens with them in place.
let coachInfoCache: Record<string, CoachInfo> | null = null
let coachInfoRequest: Promise<Record<string, CoachInfo>> | null = null

/** Public coach profiles by lower-cased name; the dashboard calls it on load so the first chat opens with them too. */
export function loadCoachInfo() {
  if (coachInfoCache) return Promise.resolve(coachInfoCache)
  coachInfoRequest ??= fetch(`${apiUrl()}/api/coaches`)
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      if (!data?.coaches) throw new Error("Coach profiles could not be loaded.")
      coachInfoCache = Object.fromEntries((data.coaches as CoachInfo[]).map((coach) => [coach.name.toLowerCase(), coach]))
      return coachInfoCache
    })
    .finally(() => { coachInfoRequest = null })
  return coachInfoRequest
}

const getCoachDisplayName = (name: string) =>
  name
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")

const formatTime = (date: Date) => date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })

const greetingFor = (coach: string): Message => ({
  id: newId(),
  role: "assistant",
  content: `Hello! I'm ${getCoachDisplayName(coach)}. I'm here to help you with your training, technique, and performance goals. What would you like to work on today?`,
  timestamp: new Date(),
  greeting: true,
})

/** A message of the saved conversation that this device doesn't have (written on another one, or before its storage
 *  was cleared). */
const restoreMessage = (message: SavedMessage): Message => ({
  id: message.id, role: message.role, content: message.content, timestamp: new Date(message.at), sync: "saved",
  ...(message.voice && { voice: true }), ...(message.plan && { plan: message.plan }),
})

const suggestionsFor = (info?: CoachInfo) => {
  const [first, second] = info?.sessions ?? []
  return [
    first ? `Walk me through your ${first.type} session.` : "Walk me through my key session this week.",
    second ? `Give me a ${second.type} set I can swim tomorrow.` : "Give me a set I can swim tomorrow.",
    "How should I taper for my next competition?",
    info ? `What's the core idea behind your coaching?` : "What should I focus on this month?",
  ]
}

// Sets, reps and distances: a reply that may hold a session the athlete can still try to add (when it isn't offered).
const TRAINING_WORDS = /\d+\s*[x×]\s*\d+|\b\d{2,4}\s*(?:m|meters|metres)?\s+(?:easy|loosen|choice|kick|pull|drill|swim|free)\b|\b(?:reps?|sets?)\b/i

const planLabel = (kind: PlanKind) => (kind === "swim" ? "Swim session ready" : kind === "gym" ? "Gym session ready" : "Training plan ready")
/** A plan's sessions as new ones (same training, new ids): added again, they're new sessions, not the earlier ones moved. */
const withNewIds = (plan: CoachPlan): CoachPlan => ({ ...plan, sessions: plan.sessions.map((session) => ({ ...session, id: randomId() })) })
/** The athlete's message `id`, answered: saved with the reply (useCoachHistory), now that the exchange is whole. */
const answered = (thread: Message[], id: string) => thread.map((message) => (message.id === id ? { ...message, sync: "pending" as const } : message))

const thinkingStages = (coach: string) => [
  `Recalling ${coach}'s coaching methods`,
  "Reading the most relevant sections",
  "Checking your athlete profile",
  "Writing your answer",
]

/** Saved conversations for this athlete on this device; each coach without one starts with a greeting. */
const restoreThreads = (userKey: string, coaches: string[]): Record<string, Message[]> => {
  let stored: Record<string, Message[]> = {}
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_PREFIX + userKey) || "{}")
    for (const [coach, messages] of Object.entries(raw as Record<string, Message[]>)) {
      if (Array.isArray(messages)) {
        stored[coach] = messages.map((message) => ({ ...message, timestamp: new Date(message.timestamp) }))
      }
    }
  } catch {
    stored = {}
  }
  return Object.fromEntries(coaches.map((coach) => [coach, stored[coach]?.length ? stored[coach] : [greetingFor(coach)]]))
}

function CoachAvatar({ name, size = "md", live }: { name: string; size?: "sm" | "md" | "lg" | "xl"; live?: boolean }) {
  const sizes = { sm: "h-8 w-8", md: "h-10 w-10", lg: "h-12 w-12", xl: "h-20 w-20" }
  return (
    <span className="relative inline-flex shrink-0">
      {size === "xl" && <span className="absolute inset-0 animate-pulse rounded-3xl bg-accent/30 blur-2xl" />}
      <CoachPortrait name={name} className={cn("relative", sizes[size])} />
      {live && (
        <span className="absolute -bottom-0.5 -right-0.5 flex h-3 w-3">
          <span className="status-ping absolute inset-0 rounded-full bg-emerald-400" />
          <span className="relative h-3 w-3 rounded-full border-2 border-[#070b10] bg-emerald-400" />
        </span>
      )}
    </span>
  )
}

/**
 * Coach chat, full screen over the dashboard: the athlete's coaches with their conversations on this device, typed or
 * dictated messages, replies read aloud, and voice calls. It opens out of `origin` (the button pressed; the middle of
 * the screen without one) and closes back into it. With `call` it goes straight into a voice call, and ending that call
 * closes the chat too, back to the dashboard.
 *
 * A reply that prescribes sessions, typed or said on a call, can be added to the athlete's swim and gym weeks
 * (CoachPlanSheet): `onTrainingAdded` says what was added, and `onOpenTraining` takes the athlete to where it went.
 */
export function CoachChat({ userKey, coaches, call = false, origin, draft, swimsPerWeek, onClose, onTrainingAdded, onOpenTraining }: {
  userKey: string
  coaches: string[]
  call?: boolean
  origin: Point | null
  /** A message to start with in the message field (asked elsewhere, to send here). */
  draft?: string
  /** The athlete's swims a week (from onboarding). */
  swimsPerWeek: number
  onClose: () => void
  onTrainingAdded: (added: AddedSession[]) => void
  onOpenTraining: (target: TrainingTarget) => void
}) {
  const [coachInfo, setCoachInfo] = useState<Record<string, CoachInfo>>(() => coachInfoCache ?? {})
  const [activeCoach, setActiveCoach] = useState(coaches[0])
  const [threads, setThreads] = useState(() => restoreThreads(userKey, coaches))
  const [input, setInput] = useState(draft ?? "")
  const [pendingCoach, setPendingCoach] = useState<string | null>(null)
  const [stage, setStage] = useState(0)
  const [nearBottom, setNearBottom] = useState(true)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [clearArmed, setClearArmed] = useState(false)
  // Confirmation for deleting the whole conversation history.
  const [confirmClearAll, setConfirmClearAll] = useState(false)
  // Voice conversation overlay; `origin` is where it expands from.
  const [conversation, setConversation] = useState<{ origin: Point | null } | null>(call ? { origin } : null)
  const [closing, setClosing] = useState(false)
  // A call started from the dashboard covers the chat, which stays hidden beneath it unless the call opens a plan here.
  const [hidden, setHidden] = useState(call)
  // The latest session the coach gave on the current call, offered there; taking it ends the call and opens it here.
  const [callPlan, setCallPlan] = useState<{ id: string; kind: PlanKind } | null>(null)
  const planAfterCall = useRef<string | null>(null)
  // The reply whose sessions are being added (`fresh`: added before, so they're added again as new sessions).
  const [planFor, setPlanFor] = useState<{ coach: string; messageId: string; fresh: boolean } | null>(null)
  // Focus goes back to the button that opened the chat when it closes.
  const [opener] = useState(() => document.activeElement as HTMLElement | null)
  // The scene behind the chat (components/call-scenes), the same pick as on a call. `settled` is the scene once it has
  // finished sweeping in; `titled` counts picks, each shown by name for a moment.
  const [scene, setScene] = useState<SceneId>(() => savedScene())
  const [settled, setSettled] = useState<SceneId>(scene)
  const [sceneFrom, setSceneFrom] = useState<Point | null>(null)
  const [scenesOpen, setScenesOpen] = useState(false)
  const [scenesAvailable, setScenesAvailable] = useState(true)
  const [titled, setTitled] = useState(0)
  const sceneButtonRef = useRef<HTMLButtonElement>(null)
  // How strongly the coach is coming through, for the scene (see the effect below), and whether it's them.
  const sceneLevel = useRef(0)
  const scenePhase = useRef("idle")
  const sceneCue = useRef({ thinking: false, voice: false, dictating: false, swell: 0, swellAt: 0, coachSwell: false })
  const threadsRef = useRef(threads)
  threadsRef.current = threads
  // The conversations saved for the athlete: back as the chat opens, each exchange saved as it happens.
  const savedChats = useCoachHistory({ userKey, coaches, threads, threadsRef, setThreads, restore: restoreMessage, greeting: greetingFor })
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const dictated = useRef(false)
  const { recordingState, speech, audioError, startRecording, stopRecording, listen, cancelAudio } = useCoachAudio(
    activeCoach,
    (text) => {
      setInput((previous) => previous.trim() ? `${previous.trimEnd()} ${text}` : text)
    },
  )
  const audioBusy = recordingState !== "idle"

  useEffect(() => {
    if (recordingState !== "idle") {
      dictated.current = true
      return
    }
    // When the chat opens on a touch screen the composer waits for a tap: focusing it would bring the keyboard up over
    // the coach's welcome.
    if (dictated.current || !window.matchMedia("(pointer: coarse)").matches) inputRef.current?.focus()
  }, [recordingState])

  useEffect(() => {
    let live = true
    loadCoachInfo().then((info) => { if (live) setCoachInfo(info) }).catch(() => undefined)
    return () => { live = false }
  }, [])

  // The dashboard underneath stays where it was while the chat is open.
  useEffect(() => {
    const root = document.documentElement
    const overflow = root.style.overflow
    root.style.overflow = "hidden"
    return () => {
      root.style.overflow = overflow
      opener?.focus({ preventScroll: true })
    }
  }, [opener])

  // Persist conversations on this device.
  useEffect(() => {
    if (!userKey || !coaches.length) return
    try {
      const trimmed = Object.fromEntries(Object.entries(threads).map(([coach, messages]) => [coach, messages.slice(-60)]))
      localStorage.setItem(STORAGE_PREFIX + userKey, JSON.stringify(trimmed))
    } catch {
      // Storage full or unavailable: conversations still work for this visit.
    }
  }, [threads, userKey, coaches.length])

  const messages = useMemo(() => threads[activeCoach] ?? [], [threads, activeCoach])
  const info = coachInfo[activeCoach.toLowerCase()]
  const isThinking = pendingCoach !== null && pendingCoach === activeCoach
  const isFresh = messages.length <= 1 && !isThinking

  // The scene moves with the coach: it breathes while they think, swells when a reply lands (a little for your own
  // message), and follows the rhythm of their voice while a reply is read aloud.
  Object.assign(sceneCue.current, { thinking: isThinking, voice: speech?.status === "playing", dictating: recordingState === "recording" })
  const lastMessage = messages[messages.length - 1]
  const lastSeen = useRef<{ coach: string; id?: string } | null>(null)
  useEffect(() => {
    const seen = lastSeen.current
    lastSeen.current = { coach: activeCoach, id: lastMessage?.id }
    if (!seen || seen.coach !== activeCoach || !lastMessage || seen.id === lastMessage.id) return
    const coach = lastMessage.role === "assistant"
    Object.assign(sceneCue.current, { swell: coach ? 0.85 : 0.45, swellAt: performance.now(), coachSwell: coach })
  }, [activeCoach, lastMessage])
  useEffect(() => {
    let frame = 0
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick)
      const cue = sceneCue.current
      const swell = cue.swell * Math.exp(-(now - cue.swellAt) / 900)
      const base = cue.voice ? 0.32 + 0.3 * Math.abs(Math.sin(now / 140)) * Math.abs(Math.sin(now / 410))
        : cue.thinking ? 0.16 + 0.1 * Math.sin(now / 420)
          : cue.dictating ? 0.2 + 0.15 * Math.abs(Math.sin(now / 160)) : 0
      sceneLevel.current = Math.max(base, swell)
      scenePhase.current = cue.voice || cue.thinking || (cue.coachSwell && swell > 0.05) ? "speaking" : "listening"
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [])
  // A scene picked on a call over the chat is the chat's scene too.
  useEffect(() => {
    const onPicked = (event: Event) => setScene((event as CustomEvent<SceneId>).detail)
    window.addEventListener(SCENE_PICKED, onPicked)
    return () => window.removeEventListener(SCENE_PICKED, onPicked)
  }, [])

  // Cycle the "thinking" stages while waiting for the coach.
  useEffect(() => {
    if (!pendingCoach) return
    setStage(0)
    const timer = window.setInterval(() => setStage((value) => Math.min(value + 1, 3)), 1800)
    return () => window.clearInterval(timer)
  }, [pendingCoach])

  const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior })
  }

  // A saved conversation coming back arrives all at once: the chat goes straight to its end instead of scrolling through.
  const shownCount = useRef(messages.length)
  useEffect(() => {
    const arrived = messages.length - shownCount.current > 2
    shownCount.current = messages.length
    if (nearBottom || arrived) scrollToBottom(arrived ? "auto" : "smooth")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, isThinking])

  useEffect(() => {
    scrollToBottom("auto")
    setNearBottom(true)
  }, [activeCoach])

  // Grow the composer with its content.
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [input])

  useEffect(() => {
    if (!clearArmed) return
    const timer = window.setTimeout(() => setClearArmed(false), 3000)
    return () => window.clearTimeout(timer)
  }, [clearArmed])

  /** Close back into the dashboard, the way it opened, then do `after`. */
  const leave = (after: () => void) => {
    if (closing) return
    cancelAudio()
    setClosing(true)
    window.setTimeout(after, CLOSE_MS)
  }
  const close = () => leave(onClose)

  // Esc closes the chat, except while a voice call, the clear-history question or a plan is open: those use Esc themselves.
  // With the scene picker open, Esc closes the picker.
  useEffect(() => {
    if (conversation || confirmClearAll || planFor) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return
      if (scenesOpen) setScenesOpen(false)
      else close()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  const send = async (override?: string, retryId?: string) => {
    const coach = activeCoach
    const text = (override ?? input).trim()
    if (!text || pendingCoach || !coach || audioBusy) return

    const thread = threads[coach] ?? []
    const retryIndex = retryId ? thread.findIndex((message) => message.id === retryId) : -1
    let sentId: string
    if (retryIndex >= 0 && retryId) {
      sentId = retryId
      setThreads((prev) => ({ ...prev, [coach]: prev[coach].map((message) => (message.id === sentId ? { ...message, failed: false } : message)) }))
    } else {
      const userMessage: Message = { id: newId(), role: "user", content: text, timestamp: new Date() }
      setThreads((prev) => ({ ...prev, [coach]: [...(prev[coach] ?? []), userMessage] }))
      setInput("")
      sentId = userMessage.id
    }
    setPendingCoach(coach)
    setNearBottom(true)

    try {
      // The conversation so far goes with the message, once the saved one is back (it usually is, long before).
      await savedChats.ready()
      const latest = threadsRef.current[coach] ?? []
      const at = latest.findIndex((message) => message.id === sentId)
      const history = savedChats.context(at >= 0 ? latest.slice(0, at) : latest)
      const { data: { session }, error } = await supabase.auth.getSession()
      if (error) throw error
      if (!session) throw new Error("Sign in again to chat with your coach.")
      const ask = (sent: typeof history) => fetch(`${apiUrl()}/api/coach-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          user_key: userKey,
          selected_coaches: [coach],
          active_coach: coach,
          message: text,
          history: sent,
        }),
      })
      let response = await ask(history)
      // Refused by a backend from before it took the longer conversation (while it's being updated): as it was given.
      if (response.status === 422 && history.length > EARLIER_CONTEXT) response = await ask(history.slice(-EARLIER_CONTEXT))
      if (!response.ok) throw new Error(await response.text())
      const result = await response.json()
      const reply: Message = { id: newId(), role: "assistant", content: result.content, timestamp: new Date(), sources: result.sources || [], plan: result.plan ?? undefined, sync: "pending" }
      setThreads((prev) => ({ ...prev, [coach]: [...answered(prev[coach] ?? [], sentId), reply] }))
      if (reply.plan) prefetchPlan(coach, reply, text)
    } catch (error) {
      console.error("Coach chat failed:", error)
      setThreads((prev) => ({
        ...prev,
        [coach]: (prev[coach] ?? []).map((message) => (message.id === sentId ? { ...message, failed: true } : message)),
      }))
    } finally {
      setPendingCoach(null)
      inputRef.current?.focus()
    }
  }

  // One spoken turn: written to the thread like a typed message, answered in short spoken style, the reply streamed
  // (`onText`) so the call can start speaking it while it's being written.
  const converse = async (text: string, signal: AbortSignal, onText: (text: string) => void): Promise<string> => {
    const coach = activeCoach
    if (!coach || !userKey) throw new Error("Your coaching profile is not loaded.")
    // Once the saved conversation is back: a call opened from the dashboard starts as the chat opens.
    await savedChats.ready()
    const thread = threadsRef.current[coach] ?? []
    // Asking again after the coach couldn't answer: the same message, not a second copy of it.
    const last = thread[thread.length - 1]
    const again = last?.role === "user" && last.failed && last.content === text ? last : null
    const history = savedChats.context(thread)
    const userMessage: Message = again ? { ...again, failed: false } : { id: newId(), role: "user", content: text, timestamp: new Date() }
    setThreads((prev) => ({
      ...prev,
      [coach]: again ? (prev[coach] ?? []).map((message) => (message.id === again.id ? userMessage : message)) : [...(prev[coach] ?? []), userMessage],
    }))
    try {
      const result = await askCoachLive({ user_key: userKey, selected_coaches: [coach], active_coach: coach, message: text, history, mode: "conversation" }, signal, onText)
      const reply: Message = { id: newId(), role: "assistant", content: result.content, timestamp: new Date(), sources: result.sources || [], plan: result.plan ?? undefined, voice: true, sync: "pending" }
      setThreads((prev) => ({ ...prev, [coach]: [...answered(prev[coach] ?? [], userMessage.id), reply] }))
      if (reply.plan) {
        setCallPlan({ id: reply.id, kind: reply.plan })
        prefetchPlan(coach, reply, text)
      }
      return result.content
    } catch (problem) {
      if (signal.aborted && signal.reason === CONTINUED) {
        // The athlete went on talking: that wasn't the end of what they were saying, which comes as one message next.
        setThreads((prev) => ({ ...prev, [coach]: (prev[coach] ?? []).filter((message) => message.id !== userMessage.id) }))
      } else if (!signal.aborted) {
        setThreads((prev) => ({ ...prev, [coach]: (prev[coach] ?? []).map((message) => (message.id === userMessage.id ? { ...message, failed: true } : message)) }))
      }
      throw problem
    }
  }

  const openConversation = (event?: React.MouseEvent<HTMLElement>) => {
    cancelAudio()
    setCallPlan(null)
    const rect = event?.currentTarget.getBoundingClientRect()
    setConversation({ origin: rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null })
  }

  /** Open a reply's sessions to add them to the athlete's training. */
  const openPlan = (message: Message) => {
    cancelAudio()
    setPlanFor({ coach: activeCoach, messageId: message.id, fresh: !!message.planAdded })
  }
  const updateMessage = (coach: string, id: string, change: Partial<Message>) =>
    setThreads((prev) => ({ ...prev, [coach]: (prev[coach] ?? []).map((message) => (message.id === id ? { ...message, ...change } : message)) }))
  /** A reply that prescribes sessions is read into them as soon as it arrives, so adding it opens straight away; the
   *  sessions are kept on the reply. A failed read is simply tried again when the athlete opens it. */
  function prefetchPlan(coach: string, reply: Message, request: string) {
    readPlanFor(reply.id, { reply: reply.content, request, spoken: !!reply.voice })
      .then((plan) => updateMessage(coach, reply.id, { planDraft: plan }))
      .catch(() => { /* read again when it's opened */ })
  }
  const planThread = planFor ? threads[planFor.coach] ?? [] : []
  const planIndex = planFor ? planThread.findIndex((message) => message.id === planFor.messageId) : -1
  const planMessage = planIndex >= 0 ? planThread[planIndex] : null
  // The athlete's message the reply answered, for reading it in context.
  const planRequest = planMessage ? [...planThread.slice(0, planIndex)].reverse().find((message) => message.role === "user")?.content ?? "" : ""
  // Sessions added before are added again as new ones: same sessions, new ids.
  const planCached = planMessage?.planDraft ? (planFor?.fresh ? withNewIds(planMessage.planDraft) : planMessage.planDraft) : null

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      send()
    }
  }

  const copyMessage = async (message: Message) => {
    try {
      await navigator.clipboard.writeText(message.content)
      setCopiedId(message.id)
      window.setTimeout(() => setCopiedId((id) => (id === message.id ? null : id)), 1600)
    } catch {
      // Clipboard unavailable (permissions or insecure context).
    }
  }


  const startNewChat = () => {
    if (!activeCoach) return
    if (!clearArmed) {
      setClearArmed(true)
      return
    }
    cancelAudio()
    setThreads((prev) => ({ ...prev, [activeCoach]: [greetingFor(activeCoach)] }))
    // The saved conversation starts over too, so the athlete's other devices do.
    savedChats.startOver(activeCoach)
    setClearArmed(false)
  }

  /**
   * Deletes the athlete's entire conversation history: every coach's thread, typed and voice-call messages alike, on
   * this device (and its copy in browser storage) and in their saved chats, so their other devices start over too.
   * Each coach starts again from their greeting.
   */
  const clearAllHistory = () => {
    cancelAudio()
    setThreads(Object.fromEntries(coaches.map((coach) => [coach, [greetingFor(coach)]])))
    savedChats.clearAll(coaches)
    try {
      localStorage.removeItem(STORAGE_PREFIX + userKey)
    } catch {
      // Storage unavailable: the threads above are still cleared for this visit.
    }
    setClearArmed(false)
    setConfirmClearAll(false)
    setNearBottom(true)
  }
  const hasHistory = coaches.some((coach) => (threads[coach]?.length ?? 0) > 1)

  const coachName = getCoachDisplayName(activeCoach)
  const activeIndex = coaches.indexOf(activeCoach)
  const remaining = MAX_MESSAGE_LENGTH - input.length
  // A drawn scene is in (or on its way in): the chat's glass darkens a little so the text stays easy to read.
  const sceneOn = scenesAvailable && (drawnScene(scene) || drawnScene(settled))

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={`Chat with ${coachName}`}
      className={cn("cc-root fixed inset-0 z-50 flex flex-col overflow-hidden bg-[#070b10] text-foreground", closing && "cc-closing", hidden && "invisible", sceneOn && "vs-scened")}
      style={{ "--cv-x": `${origin?.x ?? window.innerWidth / 2}px`, "--cv-y": `${origin?.y ?? window.innerHeight / 2}px` } as CSSProperties}>
      <div aria-hidden="true" className={cn("pointer-events-none absolute inset-0", drawnScene(settled) && settled === scene && "vs-covered")}>
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(87,229,234,0.10),transparent_55%),radial-gradient(ellipse_at_bottom_right,rgba(56,120,220,0.10),transparent_50%)]" />
        <div className="absolute inset-0 opacity-25">
          <WaterBubbles />
        </div>
      </div>
      {scenesAvailable && (
        <CallScene scene={scene} origin={sceneFrom} tone={coachTone(activeCoach)} level={sceneLevel} phase={scenePhase} warm={scenesOpen}
          variant="chat" fps={30} paused={!!conversation || hidden} onSettled={setSettled}
          onUnavailable={() => { setScenesAvailable(false); setScene(DEFAULT_SCENE); setSettled(DEFAULT_SCENE) }}
          onFailed={(_, previous) => { setScene(previous); setSettled(previous) }} />
      )}

      {/* Header */}
      <header className="relative z-20 border-b border-white/[0.07] bg-[#070b10]/70 backdrop-blur-xl">
        <div className="flex items-center justify-between gap-2 px-4 py-3 sm:gap-3 sm:px-6">
          <button
            type="button"
            onClick={close}
            aria-label="Back to dashboard"
            className="inline-flex cursor-pointer items-center gap-2 rounded-full px-2 py-1.5 text-sm text-slate-300 transition-colors hover:bg-white/[0.05] hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Dashboard</span>
          </button>
          <div key={activeCoach} className="chat-enter flex min-w-0 items-center gap-2.5 sm:gap-3">
            <CoachAvatar name={activeCoach} size="md" live />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white">{coachName}</p>
              <p className="truncate text-xs text-slate-400">
                {isThinking ? <span className="text-accent">typing…</span> : info?.title ?? "Your coach"}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <button
            type="button"
            onClick={openConversation}
            disabled={isThinking || audioBusy}
            className="cv-launch group relative inline-flex items-center gap-2 overflow-hidden rounded-full px-3 py-1.5 text-sm font-semibold text-slate-950 transition-transform hover:scale-[1.03] active:scale-95 disabled:pointer-events-none disabled:opacity-40 sm:px-3.5"
          >
            <span aria-hidden className="cv-launch-sheen" />
            <AudioLines className="relative h-4 w-4" />
            <span className="relative hidden sm:inline">Conversation</span>
          </button>
          {scenesAvailable && (
            <button ref={sceneButtonRef} type="button" onClick={() => setScenesOpen((value) => !value)} aria-haspopup="dialog" aria-expanded={scenesOpen}
              aria-label={`Scene: ${sceneById(scene).name}. Change the scene`}
              className={cn("vs-trigger inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] p-0.5 text-sm text-slate-200 transition-all hover:border-accent/40 hover:bg-accent/10 sm:p-1 lg:pr-3",
                scenesOpen && "border-accent/40 bg-accent/10")}>
              <span aria-hidden className="vs-trigger-dot h-5 w-5 shrink-0 rounded-full sm:h-6 sm:w-6" style={{ background: sceneById(scene).swatch }} />
              <span className="hidden lg:inline">Scene</span>
            </button>
          )}
          <button
            type="button"
            onClick={startNewChat}
            disabled={messages.length <= 1 || isThinking}
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-2.5 py-1.5 text-sm transition-all disabled:pointer-events-none disabled:opacity-40 sm:px-3",
              clearArmed
                ? "border-rose-400/40 bg-rose-400/10 text-rose-200"
                : "border-white/10 bg-white/[0.03] text-slate-200 hover:border-accent/40 hover:bg-accent/10",
            )}
          >
            <MessageSquarePlus className="h-4 w-4" />
            <span className="hidden sm:inline">{clearArmed ? "Tap again to clear" : "New chat"}</span>
          </button>
          <button
            type="button"
            onClick={() => setConfirmClearAll(true)}
            disabled={!hasHistory || isThinking}
            aria-label="Clear conversation history"
            title="Clear conversation history"
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-sm text-slate-200 transition-all hover:border-rose-400/40 hover:bg-rose-400/10 hover:text-rose-100 disabled:pointer-events-none disabled:opacity-40 sm:px-3"
          >
            <Trash2 className="h-4 w-4" />
            <span className="hidden lg:inline">Clear history</span>
          </button>
          </div>
        </div>

        {/* Mobile coach switcher */}
        {coaches.length > 1 && (
          <div className="px-4 pb-3 lg:hidden">
            <div role="tablist" aria-label="Choose coach" className="relative grid rounded-full border border-white/10 bg-white/[0.03] p-1" style={{ gridTemplateColumns: `repeat(${coaches.length}, minmax(0, 1fr))` }}>
              <span
                aria-hidden="true"
                className="absolute inset-y-1 left-1 rounded-full bg-accent shadow-[0_6px_20px_rgba(87,229,234,0.35)] transition-transform duration-300 ease-out"
                style={{ width: `calc((100% - 0.5rem) / ${coaches.length})`, transform: `translateX(${activeIndex * 100}%)` }}
              />
              {coaches.map((coach) => (
                <button
                  key={coach}
                  type="button"
                  role="tab"
                  aria-selected={coach === activeCoach}
                  onClick={() => setActiveCoach(coach)}
                  className={cn(
                    "relative z-10 truncate rounded-full px-3 py-1.5 text-sm font-medium transition-colors duration-300",
                    coach === activeCoach ? "text-accent-foreground" : "text-slate-300",
                  )}
                >
                  {getCoachDisplayName(coach)}
                </button>
              ))}
            </div>
          </div>
        )}
      </header>

      <div className="relative z-10 flex min-h-0 flex-1">
        {/* Coach roster */}
        <aside className="hidden w-80 shrink-0 flex-col gap-4 overflow-y-auto border-r border-white/[0.07] bg-[#070b10]/40 p-4 backdrop-blur-xl lg:flex">
          <p className="px-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">Your coach</p>
          <div role="tablist" aria-label="Choose coach" className="space-y-2">
            {coaches.map((coach) => {
              const thread = threads[coach] ?? []
              const last = thread[thread.length - 1]
              const active = coach === activeCoach
              const coachMeta = coachInfo[coach.toLowerCase()]
              return (
                <button
                  key={coach}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveCoach(coach)}
                  className={cn(
                    "group relative flex w-full items-start gap-3 overflow-hidden rounded-2xl border p-3 text-left transition-all duration-300",
                    active
                      ? "border-accent/40 bg-[linear-gradient(120deg,rgba(87,229,234,0.14),rgba(255,255,255,0.02))] shadow-[0_0_24px_rgba(87,229,234,0.10)]"
                      : "border-white/[0.07] bg-white/[0.02] hover:border-white/15 hover:bg-white/[0.04]",
                  )}
                >
                  <CoachAvatar name={coach} size="md" live={active} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold text-white">{getCoachDisplayName(coach)}</span>
                      {pendingCoach === coach && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-accent" />}
                    </span>
                    {coachMeta && <span className="block truncate text-xs text-accent/90">{coachMeta.title}</span>}
                    {last && (
                      <span className="mt-1 line-clamp-2 text-xs leading-5 text-slate-400">
                        {last.role === "user" ? "You: " : ""}
                        {last.content.replace(/\[\d+(?:\s*,\s*\d+)*\]/g, "").replace(/[*#`]/g, "").replace(/\s+/g, " ")}
                      </span>
                    )}
                  </span>
                </button>
              )
            })}
          </div>

          {info && (
            <div key={info.name} className="chat-enter rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4">
              <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                <BookOpen className="h-3.5 w-3.5 text-accent" />
                About {coachName}
              </p>
              <p className="mt-3 text-sm leading-6 text-slate-300">{info.summary}</p>
              <p className="mt-4 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                <Target className="h-3.5 w-3.5" />
                Main events
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {info.main_events.map((event) => (
                  <span key={event} className="rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-slate-300">{event}</span>
                ))}
              </div>
            </div>
          )}
        </aside>

        {/* Conversation */}
        <main className="relative flex min-w-0 flex-1 flex-col">
          {titled > 0 && !closing && <SceneTitle key={titled} scene={scene} boxed className="top-4 sm:top-5" />}
          <div
            ref={scrollRef}
            onScroll={(event) => {
              const el = event.currentTarget
              setNearBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 120)
            }}
            className="flex-1 overflow-y-auto overscroll-contain"
            aria-live="polite"
          >
            <div key={activeCoach} className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
              {isFresh ? (
                <div className="vs-legible flex min-h-[60vh] flex-col items-center justify-center text-center">
                  <Reveal index={0}>
                    <CoachAvatar name={activeCoach} size="xl" />
                  </Reveal>
                  <Reveal index={1}>
                    <h1 className="mt-6 text-3xl font-bold tracking-tight text-white sm:text-4xl">
                      Chat with <span className="bg-gradient-to-r from-cyan-200 via-accent to-sky-400 bg-clip-text text-transparent">{coachName}</span>
                    </h1>
                  </Reveal>
                  <Reveal index={2}>
                    <p className="mx-auto mt-3 max-w-lg text-base leading-7 text-slate-300">{messages[0]?.content}</p>
                    {messages[0] && (
                      <button type="button" disabled={audioBusy} onClick={() => listen(messages[0].id, messages[0].content)}
                        className="mt-2 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-slate-400 hover:bg-white/[0.05] hover:text-slate-200 disabled:opacity-40">
                        {speech?.messageId === messages[0].id
                          ? speech.status === "loading" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />
                          : <Volume2 className="h-3.5 w-3.5" />}
                        {speech?.messageId === messages[0].id ? speech.status === "loading" ? "Cancel audio" : "Stop audio" : "Listen"}
                      </button>
                    )}
                  </Reveal>
                  <Reveal index={3}>
                    <button type="button" onClick={openConversation} disabled={audioBusy}
                      className="cv-start group relative mt-7 inline-flex items-center gap-3 rounded-full py-2 pl-2 pr-5 text-sm font-semibold text-white disabled:opacity-40">
                      <span aria-hidden className="cv-start-ring" />
                      <span className="relative grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-cyan-200 to-accent text-slate-950"><AudioLines className="h-4 w-4" /></span>
                      <span className="relative">Talk it through with {coachName}</span>
                    </button>
                  </Reveal>
                  <div className="mt-8 grid w-full max-w-2xl gap-3 sm:grid-cols-2">
                    {suggestionsFor(info).map((suggestion, idx) => (
                      <Reveal key={suggestion} index={3 + idx}>
                        <button
                          type="button"
                          onClick={() => send(suggestion)}
                          className="vs-glass group flex h-full w-full items-start gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4 text-left text-sm text-slate-200 transition-all duration-300 hover:-translate-y-0.5 hover:border-accent/40 hover:bg-accent/[0.07]"
                        >
                          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-accent transition-transform duration-300 group-hover:scale-110" />
                          {suggestion}
                        </button>
                      </Reveal>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  {messages.map((message) =>
                    message.role === "assistant" ? (
                      <div key={message.id} className="chat-enter flex gap-3">
                        <CoachAvatar name={activeCoach} size="sm" />
                        <div className="min-w-0 max-w-[88%] flex-1">
                          <p className="vs-meta mb-1.5 text-xs text-slate-500">
                            <span className="font-semibold text-slate-300">{coachName}</span> · {formatTime(message.timestamp)}
                          </p>
                          <div className="rounded-2xl rounded-tl-md border border-white/[0.08] bg-[linear-gradient(160deg,rgba(24,36,46,0.85),rgba(12,18,25,0.9))] px-4 py-3.5 shadow-[0_10px_30px_rgba(0,0,0,0.25)] backdrop-blur-md">
                            <ChatMarkdown content={message.content} />
                          </div>
                          {message.plan && <PlanCallout kind={message.plan} added={message.planAdded} onOpen={() => openPlan(message)} />}
                          <div className="vs-meta mt-2 flex flex-wrap items-center gap-1">
                            <button
                              type="button"
                              disabled={audioBusy}
                              onClick={() => listen(message.id, message.content)}
                              aria-label={speech?.messageId === message.id ? "Stop coach audio" : `Listen to ${coachName}'s reply`}
                              className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-slate-500 transition-colors hover:bg-white/[0.05] hover:text-slate-200 disabled:opacity-40"
                            >
                              {speech?.messageId === message.id
                                ? speech.status === "loading" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />
                                : <Volume2 className="h-3.5 w-3.5" />}
                              {speech?.messageId === message.id ? speech.status === "loading" ? "Cancel audio" : "Stop audio" : "Listen"}
                            </button>
                            <button
                              type="button"
                              onClick={() => copyMessage(message)}
                              className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-slate-500 transition-colors hover:bg-white/[0.05] hover:text-slate-200"
                            >
                              {copiedId === message.id ? <Check className="h-3.5 w-3.5 text-emerald-300" /> : <Copy className="h-3.5 w-3.5" />}
                              {copiedId === message.id ? "Copied" : "Copy"}
                            </button>
                            {!message.plan && message.id !== messages[0]?.id && TRAINING_WORDS.test(message.content) && (
                              <button
                                type="button"
                                onClick={() => openPlan(message)}
                                className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-slate-500 transition-colors hover:bg-white/[0.05] hover:text-slate-200"
                              >
                                <CalendarPlus className="h-3.5 w-3.5" />
                                {message.planAdded ? "Add to training again" : "Add to training"}
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div key={message.id} className="chat-enter-user flex justify-end">
                        <div className="max-w-[85%]">
                          <div
                            className={cn(
                              "whitespace-pre-wrap break-words rounded-2xl rounded-br-md px-4 py-3 text-[15px] leading-7 shadow-[0_10px_30px_rgba(87,229,234,0.15)]",
                              message.failed
                                ? "border border-rose-400/30 bg-rose-400/10 text-rose-50"
                                : "bg-gradient-to-br from-cyan-300 to-accent text-slate-950",
                            )}
                          >
                            {message.content}
                          </div>
                          <div className="vs-meta mt-1.5 flex items-center justify-end gap-2 text-xs text-slate-500">
                            {message.failed ? (
                              <>
                                <span role="alert" className="text-rose-300">Not answered. The coach couldn&apos;t reply, please try again.</span>
                                <button
                                  type="button"
                                  onClick={() => send(message.content, message.id)}
                                  disabled={pendingCoach !== null}
                                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1 font-medium text-accent hover:bg-accent/10 disabled:opacity-40"
                                >
                                  <RotateCcw className="h-3.5 w-3.5" />
                                  Retry
                                </button>
                              </>
                            ) : (
                              formatTime(message.timestamp)
                            )}
                          </div>
                        </div>
                      </div>
                    ),
                  )}

                  {isThinking && (
                    <div className="chat-enter flex gap-3" role="status">
                      <CoachAvatar name={activeCoach} size="sm" />
                      <div className="rounded-2xl rounded-tl-md border border-white/[0.08] bg-[linear-gradient(160deg,rgba(24,36,46,0.85),rgba(12,18,25,0.9))] px-4 py-3">
                        <div className="flex items-center gap-3">
                          <span className="flex gap-1">
                            {[0, 150, 300].map((delay) => (
                              <span key={delay} className="typing-dot h-2 w-2 rounded-full bg-accent" style={{ animationDelay: `${delay}ms` }} />
                            ))}
                          </span>
                          <span key={stage} className="thinking-shimmer chat-enter text-sm font-medium">
                            {thinkingStages(coachName)[stage]}…
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {!nearBottom && !isFresh && (
            <button
              type="button"
              onClick={() => scrollToBottom()}
              className="chat-enter absolute bottom-32 left-1/2 z-20 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-white/10 bg-[#0d151c]/90 px-3.5 py-2 text-xs font-medium text-slate-200 shadow-[0_10px_30px_rgba(0,0,0,0.4)] backdrop-blur-md hover:border-accent/40"
            >
              <ArrowDown className="h-3.5 w-3.5 text-accent" />
              Jump to latest
            </button>
          )}

          {/* Composer */}
          <div className="border-t border-white/[0.07] bg-[#070b10]/70 backdrop-blur-xl" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
            <form
              className="mx-auto w-full max-w-3xl px-4 py-3 sm:px-6"
              onSubmit={(event) => {
                event.preventDefault()
                send()
              }}
            >
              <div className="flex items-end gap-2 rounded-2xl border border-white/10 bg-white/[0.04] p-2 pl-4 shadow-[0_10px_30px_rgba(0,0,0,0.25)] transition-all focus-within:border-accent/50 focus-within:ring-[3px] focus-within:ring-accent/15">
                <label htmlFor="coach-message" className="sr-only">Message {coachName}</label>
                <textarea
                  id="coach-message"
                  ref={inputRef}
                  rows={1}
                  value={input}
                  disabled={audioBusy}
                  maxLength={MAX_MESSAGE_LENGTH}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={`Ask ${coachName} anything…`}
                  className="max-h-[200px] min-h-[24px] flex-1 resize-none bg-transparent py-2 text-[15px] leading-6 text-white outline-none placeholder:text-slate-500"
                />
                <button
                  type="button"
                  onClick={() => recordingState === "recording" ? stopRecording() : startRecording(MAX_MESSAGE_LENGTH - input.length - (input.trim() ? 1 : 0))}
                  disabled={pendingCoach !== null || recordingState === "starting" || recordingState === "transcribing"}
                  aria-label={recordingState === "recording" ? "Stop dictation" : "Dictate message"}
                  aria-pressed={recordingState === "recording"}
                  title={recordingState === "recording" ? "Stop recording and transcribe" : "Dictate message"}
                  className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 text-slate-300 transition-colors hover:bg-white/[0.08] disabled:opacity-40",
                    recordingState === "recording" && "border-rose-400/40 bg-rose-400/15 text-rose-300")}
                >
                  {recordingState === "starting" || recordingState === "transcribing" ? <Loader2 className="h-5 w-5 animate-spin" />
                    : recordingState === "recording" ? <Square className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                </button>
                {!input.trim() && !pendingCoach ? (
                  <button
                    type="button"
                    onClick={openConversation}
                    disabled={audioBusy}
                    aria-label={`Start a voice conversation with ${coachName}`}
                    title="Voice conversation"
                    className="cv-launch relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl text-slate-950 transition-all duration-200 hover:scale-105 active:scale-95 disabled:opacity-35"
                  >
                    <span aria-hidden className="cv-launch-sheen" />
                    <AudioLines className="relative h-5 w-5" />
                  </button>
                ) : (
                <button
                  type="submit"
                  disabled={!input.trim() || pendingCoach !== null || audioBusy}
                  aria-label="Send message"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-300 to-accent text-slate-950 shadow-[0_6px_20px_rgba(87,229,234,0.35)] transition-all duration-200 hover:scale-105 active:scale-95 disabled:scale-100 disabled:opacity-35 disabled:shadow-none"
                >
                  {pendingCoach ? <Loader2 className="h-5 w-5 animate-spin" /> : <ArrowUp className="h-5 w-5" strokeWidth={2.5} />}
                </button>
                )}
              </div>
              {audioBusy && <p role="status" className="mt-2 px-1 text-xs text-accent">
                {recordingState === "recording" ? "Recording… tap stop when finished (up to 60 seconds)."
                  : recordingState === "starting" ? "Waiting for microphone permission…" : "Transcribing your message…"}
              </p>}
              {audioError && <p role="alert" className="mt-2 px-1 text-xs text-rose-300">{audioError}</p>}
              <p className="mt-2 px-1 text-[11px] text-slate-500">AI-generated coach voices · Dictation is sent to OpenAI for transcription. Review it before sending.</p>
              <div className="mt-2 flex items-center justify-between gap-3 px-1 text-[11px] text-slate-500">
                <span className="hidden sm:inline">
                  <kbd className="rounded border border-white/10 bg-white/[0.04] px-1">Enter</kbd> to send ·{" "}
                  <kbd className="rounded border border-white/10 bg-white/[0.04] px-1">Shift</kbd> + <kbd className="rounded border border-white/10 bg-white/[0.04] px-1">Enter</kbd> for a new line
                </span>
                <span className={cn("ml-auto", remaining < 300 && "text-amber-300")}>
                  {remaining < 300 ? `${remaining} characters left` : `Personalised to your profile by ${coachName}`}
                </span>
              </div>
            </form>
          </div>
        </main>
      </div>
      {scenesAvailable && !closing && (
        <ScenePicker open={scenesOpen} place="chat" current={scene} tone={coachTone(activeCoach)} coachFirstName={coachName.replace(/^Coach\s+/i, "")}
          returnFocus={sceneButtonRef} onClose={() => setScenesOpen(false)}
          onPick={(next, from) => { setScene(next); setSceneFrom(from); saveScene(next); setTitled((count) => count + 1) }} />
      )}
      <AlertDialog open={confirmClearAll} onOpenChange={setConfirmClearAll}>
        <AlertDialogContent className="border-white/10 bg-[#0d151c]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">Clear your conversation history?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              Every message with {coachName}, including voice conversation transcripts, will be permanently deleted from
              this device and from your saved chats, so your other devices start fresh too. Your training plan and
              profile aren&apos;t affected. This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-full">Cancel</AlertDialogCancel>
            <AlertDialogAction className="rounded-full bg-rose-500 text-white hover:bg-rose-400" onClick={clearAllHistory}>
              <Trash2 className="h-4 w-4" />Clear history
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {conversation && (
        <CoachConversation key={activeCoach} coach={activeCoach} coachName={coachName} origin={conversation.origin} ask={converse}
          planOffer={callPlan && { id: callPlan.id, label: planLabel(callPlan.kind) }}
          onAddPlan={() => {
            planAfterCall.current = callPlan?.id ?? null
            // The call closes into the chat, which the plan opens over.
            setHidden(false)
          }}
          onClose={() => {
            const planned = planAfterCall.current
            planAfterCall.current = null
            setConversation(null)
            setCallPlan(null)
            // Adding the coach's session from the call: the chat shows (even after a call from the dashboard) with it open.
            const message = planned ? (threadsRef.current[activeCoach] ?? []).find((item) => item.id === planned) : undefined
            if (message) {
              setHidden(false)
              openPlan(message)
            } else if (hidden) {
              // A call from the dashboard's "Talk to your coach" goes straight back to the dashboard when it ends.
              onClose()
              return
            }
            setNearBottom(true)
            window.setTimeout(() => scrollToBottom("auto"), 50)
          }} />
      )}
      {planFor && planMessage && (
        <CoachPlanSheet key={`${planFor.messageId}:${planFor.fresh}`} coach={planFor.coach} coachName={getCoachDisplayName(planFor.coach)}
          read={() => readPlanFor(planFor.messageId, { reply: planMessage.content, request: planRequest, spoken: !!planMessage.voice })
            .then((plan) => (planFor.fresh ? withNewIds(plan) : plan))}
          cached={planCached} swimsPerWeek={swimsPerWeek}
          onRead={(plan) => updateMessage(planFor.coach, planFor.messageId, { planDraft: plan })}
          onAdded={(added) => {
            updateMessage(planFor.coach, planFor.messageId, {
              planAdded: { count: added.length, at: new Date().toISOString(), kinds: [...new Set(added.map((item) => item.kind))] },
            })
            onTrainingAdded(added)
          }}
          onOpenTraining={(target) => { setPlanFor(null); leave(() => onOpenTraining(target)) }}
          onClose={() => setPlanFor(null)} />
      )}
    </div>,
    document.body,
  )
}
