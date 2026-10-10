"use client"

import type React from "react"
import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  AudioLines,
  BookOpen,
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
import { CoachConversation } from "@/components/coach-conversation"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"

type Message = {
  id: string
  role: "user" | "assistant"
  content: string
  timestamp: Date
  sources?: ChatSource[]
  failed?: boolean
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

const MAX_MESSAGE_LENGTH = 4000
const STORAGE_PREFIX = "swimgpt_coach_chat_"
const apiUrl = () => process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"
const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

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

const thinkingStages = (coach: string) => [
  `Recalling ${coach}'s coaching methods`,
  "Reading the most relevant sections",
  "Checking your athlete profile",
  "Writing your answer",
]

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

export default function CoachChatPage() {
  const router = useRouter()
  const [coaches, setCoaches] = useState<string[]>([])
  const [coachInfo, setCoachInfo] = useState<Record<string, CoachInfo>>({})
  const [activeCoach, setActiveCoach] = useState<string | null>(null)
  const [threads, setThreads] = useState<Record<string, Message[]>>({})
  const [userKey, setUserKey] = useState("")
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [input, setInput] = useState("")
  const [pendingCoach, setPendingCoach] = useState<string | null>(null)
  const [stage, setStage] = useState(0)
  const [nearBottom, setNearBottom] = useState(true)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [clearArmed, setClearArmed] = useState(false)
  // Confirmation for deleting the whole conversation history.
  const [confirmClearAll, setConfirmClearAll] = useState(false)
  // Voice conversation overlay; `origin` is where it expands from.
  const [conversation, setConversation] = useState<{ origin: { x: number; y: number } | null } | null>(null)
  const threadsRef = useRef(threads)
  threadsRef.current = threads
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const { recordingState, speech, audioError, startRecording, stopRecording, listen, cancelAudio } = useCoachAudio(
    activeCoach,
    (text) => {
      setInput((previous) => previous.trim() ? `${previous.trimEnd()} ${text}` : text)
    },
  )
  const audioBusy = recordingState !== "idle"

  useEffect(() => {
    if (recordingState === "idle") inputRef.current?.focus()
  }, [recordingState])

  // Load the athlete's coach (same source as before) plus public coach profiles.
  useEffect(() => {
    const load = async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession()
        if (error) throw error
        if (!session) throw new Error("Sign in to load your coach.")
        const response = await fetch(`${apiUrl()}/api/dashboard`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        // Coach chat is part of the dashboard, which is only for athletes who have paid.
        if (response.status === 402) {
          router.replace("/subscribe")
          return
        }
        if (!response.ok) throw new Error(await response.text())
        const result = await response.json()
        const key: string = result.profile.user_key
        const savedCoaches: string[] = Array.isArray(result.profile?.recommended_coaches) ? result.profile.recommended_coaches : []
        setUserKey(key)

        if (savedCoaches.length === 0) {
          setLoadError("No coach is assigned to this athlete profile yet.")
          return
        }

        // Restore saved conversations for this athlete; start each coach with a greeting otherwise.
        let stored: Record<string, Message[]> = {}
        try {
          const raw = JSON.parse(localStorage.getItem(STORAGE_PREFIX + key) || "{}")
          for (const [coach, messages] of Object.entries(raw as Record<string, Message[]>)) {
            if (Array.isArray(messages)) {
              stored[coach] = messages.map((message) => ({ ...message, timestamp: new Date(message.timestamp) }))
            }
          }
        } catch {
          stored = {}
        }
        setThreads(Object.fromEntries(savedCoaches.map((coach) => [coach, stored[coach]?.length ? stored[coach] : [greetingFor(coach)]])))
        setCoaches(savedCoaches)
        setActiveCoach(savedCoaches[0])

        fetch(`${apiUrl()}/api/coaches`)
          .then((res) => (res.ok ? res.json() : null))
          .then((data) => {
            if (!data?.coaches) return
            setCoachInfo(Object.fromEntries((data.coaches as CoachInfo[]).map((coach) => [coach.name.toLowerCase(), coach])))
          })
          .catch(() => undefined)
      } catch (error) {
        console.error("Coach profile loading failed:", error)
        setLoadError("Your coach could not be loaded from your athlete profile.")
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

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

  const messages = useMemo(() => (activeCoach ? threads[activeCoach] ?? [] : []), [threads, activeCoach])
  const info = activeCoach ? coachInfo[activeCoach.toLowerCase()] : undefined
  const isThinking = pendingCoach !== null && pendingCoach === activeCoach
  const isFresh = messages.length <= 1 && !isThinking

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

  useEffect(() => {
    if (nearBottom) scrollToBottom()
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

  const send = async (override?: string, retryId?: string) => {
    const coach = activeCoach
    const text = (override ?? input).trim()
    if (!text || pendingCoach || !coach || audioBusy) return
    if (!userKey) {
      setLoadError("Your coaching profile is not loaded. Return to the dashboard and open Chat with Coach again.")
      return
    }

    const thread = threads[coach] ?? []
    const retryIndex = retryId ? thread.findIndex((message) => message.id === retryId) : -1
    const prior = retryIndex >= 0 ? thread.slice(0, retryIndex) : thread
    const history = prior.filter((message) => !message.failed).slice(-12).map(({ role, content }) => ({ role, content }))

    if (retryIndex >= 0) {
      setThreads((prev) => ({ ...prev, [coach]: prev[coach].map((message) => (message.id === retryId ? { ...message, failed: false } : message)) }))
    } else {
      const userMessage: Message = { id: newId(), role: "user", content: text, timestamp: new Date() }
      setThreads((prev) => ({ ...prev, [coach]: [...(prev[coach] ?? []), userMessage] }))
      setInput("")
      retryId = userMessage.id
    }
    setPendingCoach(coach)
    setNearBottom(true)

    try {
      const { data: { session }, error } = await supabase.auth.getSession()
      if (error) throw error
      if (!session) throw new Error("Sign in again to chat with your coach.")
      const response = await fetch(`${apiUrl()}/api/coach-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          user_key: userKey,
          selected_coaches: [coach],
          active_coach: coach,
          message: text,
          history,
        }),
      })
      if (!response.ok) throw new Error(await response.text())
      const result = await response.json()
      setThreads((prev) => ({
        ...prev,
        [coach]: [...(prev[coach] ?? []), { id: newId(), role: "assistant", content: result.content, timestamp: new Date(), sources: result.sources || [] }],
      }))
    } catch (error) {
      console.error("Coach chat failed:", error)
      const failedId = retryId
      setThreads((prev) => ({
        ...prev,
        [coach]: (prev[coach] ?? []).map((message) => (message.id === failedId ? { ...message, failed: true } : message)),
      }))
    } finally {
      setPendingCoach(null)
      inputRef.current?.focus()
    }
  }

  // One spoken turn: written to the thread like a typed message, answered in short spoken style.
  const converse = async (text: string, signal: AbortSignal): Promise<string> => {
    const coach = activeCoach
    if (!coach || !userKey) throw new Error("Your coaching profile is not loaded.")
    const history = (threadsRef.current[coach] ?? []).filter((message) => !message.failed).slice(-12).map(({ role, content }) => ({ role, content }))
    const userMessage: Message = { id: newId(), role: "user", content: text, timestamp: new Date() }
    setThreads((prev) => ({ ...prev, [coach]: [...(prev[coach] ?? []), userMessage] }))
    try {
      const { data: { session }, error } = await supabase.auth.getSession()
      if (error) throw error
      if (!session) throw new Error("Sign in again to talk with your coach.")
      const response = await fetch(`${apiUrl()}/api/coach-chat`, {
        method: "POST",
        signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ user_key: userKey, selected_coaches: [coach], active_coach: coach, message: text, history, mode: "conversation" }),
      })
      if (!response.ok) throw new Error("The coach couldn't answer just now. Please try again.")
      const result = await response.json()
      setThreads((prev) => ({
        ...prev,
        [coach]: [...(prev[coach] ?? []), { id: newId(), role: "assistant", content: result.content, timestamp: new Date(), sources: result.sources || [] }],
      }))
      return result.content as string
    } catch (problem) {
      if (!signal.aborted) {
        setThreads((prev) => ({ ...prev, [coach]: (prev[coach] ?? []).map((message) => (message.id === userMessage.id ? { ...message, failed: true } : message)) }))
      }
      throw problem
    }
  }

  const openConversation = (event?: React.MouseEvent<HTMLElement>) => {
    cancelAudio()
    const rect = event?.currentTarget.getBoundingClientRect()
    setConversation({ origin: rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null })
  }

  // Opened from the dashboard's "Talk to your coach" button (?call=1): the voice call starts as soon as the coach is
  // loaded, and ending it goes back to where the athlete came from. The flag is removed so a refresh doesn't redial.
  const backAfterCall = useRef(false)
  useEffect(() => {
    if (loading || !activeCoach || !userKey) return
    const params = new URLSearchParams(window.location.search)
    if (params.get("call") !== "1") return
    backAfterCall.current = params.get("from") === "dashboard" && window.history.length > 1
    window.history.replaceState(null, "", window.location.pathname)
    openConversation()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, activeCoach, userKey])

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
    setClearArmed(false)
  }

  /**
   * Deletes the athlete's entire conversation history on this device: every coach's thread, typed and voice-call
   * messages alike, and the saved copy in browser storage (the only place chat history is kept). Each coach starts
   * again from their greeting.
   */
  const clearAllHistory = () => {
    cancelAudio()
    setThreads(Object.fromEntries(coaches.map((coach) => [coach, [greetingFor(coach)]])))
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

  if (loading) {
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-[#070b10]" aria-busy="true">
        <div className="flex flex-col items-center gap-4">
          <span className="relative flex">
            <span className="absolute inset-0 animate-ping rounded-2xl bg-accent/30" />
            <span className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-accent via-accent-foreground to-primary">
              <MessageSquarePlus className="h-6 w-6 text-primary-foreground" />
            </span>
          </span>
          <p className="thinking-shimmer text-sm font-medium">Connecting you with your coach…</p>
        </div>
      </div>
    )
  }

  if (!activeCoach) {
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-[#070b10] px-4">
        <div className="w-full max-w-md rounded-[24px] border border-white/10 bg-[linear-gradient(160deg,rgba(22,32,42,0.85),rgba(10,15,21,0.95))] p-8 text-center shadow-[0_24px_70px_rgba(0,0,0,0.5)]">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-300/15">
            <AlertTriangle className="h-6 w-6 text-amber-200" />
          </span>
          <h1 className="mt-4 text-xl font-semibold text-white">Coach chat isn&apos;t available</h1>
          <p role="alert" className="mt-2 text-sm leading-6 text-slate-300">{loadError || "Your coach could not be loaded."}</p>
          <Link href="/dashboard" className="mt-6 inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-accent-foreground hover:bg-accent/90">
            <ArrowLeft className="h-4 w-4" />
            Back to dashboard
          </Link>
        </div>
      </div>
    )
  }

  const coachName = getCoachDisplayName(activeCoach)
  const activeIndex = coaches.indexOf(activeCoach)
  const remaining = MAX_MESSAGE_LENGTH - input.length

  return (
    <div className="relative flex h-[100dvh] flex-col overflow-hidden bg-[#070b10] text-foreground">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(87,229,234,0.10),transparent_55%),radial-gradient(ellipse_at_bottom_right,rgba(56,120,220,0.10),transparent_50%)]" />
        <div className="absolute inset-0 opacity-25">
          <WaterBubbles />
        </div>
      </div>

      {/* Header */}
      <header className="relative z-20 border-b border-white/[0.07] bg-[#070b10]/70 backdrop-blur-xl">
        <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 rounded-full px-2 py-1.5 text-sm text-slate-300 transition-colors hover:bg-white/[0.05] hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Dashboard</span>
          </Link>
          <div key={activeCoach} className="chat-enter flex min-w-0 items-center gap-3">
            <CoachAvatar name={activeCoach} size="md" live />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white">{coachName}</p>
              <p className="truncate text-xs text-slate-400">
                {isThinking ? <span className="text-accent">typing…</span> : info?.title ?? "Your coach"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={openConversation}
            disabled={isThinking || audioBusy}
            className="cv-launch group relative inline-flex items-center gap-2 overflow-hidden rounded-full px-3.5 py-1.5 text-sm font-semibold text-slate-950 transition-transform hover:scale-[1.03] active:scale-95 disabled:pointer-events-none disabled:opacity-40"
          >
            <span aria-hidden className="cv-launch-sheen" />
            <AudioLines className="relative h-4 w-4" />
            <span className="relative hidden sm:inline">Conversation</span>
          </button>
          <button
            type="button"
            onClick={startNewChat}
            disabled={messages.length <= 1 || isThinking}
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-all disabled:pointer-events-none disabled:opacity-40",
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
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-sm text-slate-200 transition-all hover:border-rose-400/40 hover:bg-rose-400/10 hover:text-rose-100 disabled:pointer-events-none disabled:opacity-40"
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
              {info.inspired_by && <p className="mt-2 text-xs text-slate-500">Inspired by {info.inspired_by}</p>}
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
                <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
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
                          className="group flex h-full w-full items-start gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4 text-left text-sm text-slate-200 transition-all duration-300 hover:-translate-y-0.5 hover:border-accent/40 hover:bg-accent/[0.07]"
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
                          <p className="mb-1.5 text-xs text-slate-500">
                            <span className="font-semibold text-slate-300">{coachName}</span> · {formatTime(message.timestamp)}
                          </p>
                          <div className="rounded-2xl rounded-tl-md border border-white/[0.08] bg-[linear-gradient(160deg,rgba(24,36,46,0.85),rgba(12,18,25,0.9))] px-4 py-3.5 shadow-[0_10px_30px_rgba(0,0,0,0.25)] backdrop-blur-md">
                            <ChatMarkdown content={message.content} />
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-1">
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
                          <div className="mt-1.5 flex items-center justify-end gap-2 text-xs text-slate-500">
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
      <AlertDialog open={confirmClearAll} onOpenChange={setConfirmClearAll}>
        <AlertDialogContent className="border-white/10 bg-[#0d151c]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">Clear your conversation history?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              Every message with {coachName}, including voice conversation transcripts, will be permanently deleted from
              this device. Your training plan and profile aren&apos;t affected. This can&apos;t be undone.
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
          onClose={() => {
            setConversation(null)
            if (backAfterCall.current) { backAfterCall.current = false; router.back(); return }
            setNearBottom(true)
            window.setTimeout(() => scrollToBottom("auto"), 50)
          }} />
      )}
    </div>
  )
}
