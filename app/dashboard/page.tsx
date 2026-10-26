"use client"

import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from "react"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  AlertTriangle,
  Apple,
  Brain,
  ChevronLeft,
  ChevronRight,
  Coins,
  CreditCard,
  Dumbbell,
  Gauge,
  KeyRound,
  LayoutDashboard,
  Layers,
  LogOut,
  MessageSquare,
  PencilRuler,
  Phone,
  RefreshCw,
  Repeat,
  ScanLine,
  Timer,
  Waves,
} from "lucide-react"
import { supabase } from "@/lib/supabase"
import { cn } from "@/lib/utils"
import { DashboardOverview } from "@/components/dashboard-overview"
import { Reveal } from "@/components/dashboard-ui"
import { WaterBubbles } from "@/components/water-bubbles"
import { TrainingPanel } from "@/components/training-panel"
import { NutritionPanel } from "@/components/nutrition/nutrition-panel"
import { MentalPanel } from "@/components/mental/mental-panel"
import { HealthConsentGate } from "@/components/legal/health-consent-gate"
import { LegalLinks } from "@/components/legal/legal-links"
import { PaceCalculator } from "@/components/pace-calculator"
import { StrokeLab } from "@/components/video-lab/stroke-lab"
import { CoachAvatar } from "@/components/coach-avatar"
import { CoachChat, loadCoachInfo } from "@/components/coach-chat"
import { CoachSwitcher, type SwitchReturn } from "@/components/coach-switcher"
import { GettingStarted, GuideSpotlight, type GuideEvent, type GuideTarget } from "@/components/dashboard-guide"
import { GuidedSetup, type SetupStep } from "@/components/guided-setup"
import { SubscriptionDialog } from "@/components/subscription-dialog"
import { ChangePasswordDialog } from "@/components/change-password-dialog"
import { WorkoutBuilderSection } from "@/components/workout-builder-section"
import { SurveyLink, useSurvey } from "@/components/survey/survey-link"
import { Banner } from "@/components/training-ui"
import { TokenStore, type StoreNotice } from "@/components/token-store"
import { TokensNeededDialog } from "@/components/tokens-needed-dialog"
import { TermsEnding, TermsUpdate } from "@/components/legal/terms-update"
import { loadTermsState, type TermsState } from "@/lib/consents"
import { useTokens } from "@/hooks/use-tokens"
import { dashboardResponseSchema, type DashboardOverviewData, type DashboardPlan } from "@/lib/dashboard"
import type { TrainingTarget } from "@/lib/coach-plan"
import { OPEN_TOKEN_STORE } from "@/lib/token-events"
import { tokenCount, verifyTokens } from "@/lib/tokens"

const navGroups = [
  {
    label: "Train",
    items: [
      { value: "overview", label: "Dashboard", icon: LayoutDashboard },
      { value: "swim", label: "Training", icon: Waves },
      { value: "builder", label: "Workout Builder", icon: PencilRuler },
    ],
  },
  {
    label: "Body & Mind",
    items: [
      { value: "nutrition", label: "Nutrition", icon: Apple },
      { value: "mental", label: "Mental Performance", icon: Brain },
    ],
  },
  {
    label: "Analyze",
    items: [
      { value: "video", label: "Video Analysis", icon: ScanLine },
      { value: "paces", label: "Pace Calculator", icon: Gauge },
    ],
  },
]
// The token store (lib/tokens.ts), once the backend has tokens.
const tokenGroup = { label: "Account", items: [{ value: "tokens", label: "Token store", icon: Coins }] }

/** Directions the Workout Builder's launch sparks fly out in. */
const SPARKS = [0, 45, 90, 135, 180, 225, 270, 315]

const pageTitles: Record<string, [string, string]> = {
  overview: ["Dashboard", "Your training at a glance"],
  swim: ["Training", "Your plan, schedule and competitions"],
  builder: ["Workout Builder", "Build a strength or dryland session, exercise by exercise. It saves to your gym week as you go."],
  nutrition: ["Nutrition", "Your daily fuel plan, built around your training"],
  mental: ["Mental Performance", "Confidence, focus and calm when it counts"],
  paces: ["Pace Calculator", "Training paces for every zone, for you and your athletes"],
  video: ["Video Analysis", "AI stroke lab: pose tracking, telemetry and a coach brief from your clip"],
  tokens: ["Token store", "Tokens for your coach, your weeks and every AI feature"],
}

/** The athlete's token balance, which opens the token store; amber when it's nearly gone. */
function TokenCount({ balance, onOpen, className }: { balance: number; onOpen: () => void; className?: string }) {
  return (
    <button type="button" onClick={onOpen} title="Token store" aria-label={`${tokenCount(balance)} left. Open the token store`}
      className={cn("flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm font-semibold tabular-nums transition-colors",
        balance < 10
          ? "border-amber-300/40 bg-amber-300/10 text-amber-100 hover:bg-amber-300/15"
          : "border-white/10 bg-white/[0.03] text-white hover:border-accent/30 hover:bg-accent/10",
        className)}>
      <Coins className="h-4 w-4 text-amber-200" />
      {balance.toLocaleString()}
      <span className="hidden font-medium text-slate-400 @4xl:inline">tokens</span>
    </button>
  )
}

type OnboardingData = {
  fullName: string
  age: string
  swimmerType: string
  mainEvents: string[]
  swimSessionsPerWeek: number
  gymSessionsPerWeek: number
  performanceGoals: string
  bodyGoals: string
  weight: string
}

export default function DashboardPage() {
  const router = useRouter()
  const [userData, setUserData] = useState<OnboardingData | null>(null)
  const [dashboardPlan, setDashboardPlan] = useState<DashboardPlan | null>(null)
  const [overview, setOverview] = useState<DashboardOverviewData | null>(null)
  const [coaches, setCoaches] = useState<string[]>([])
  const coach = coaches[0] ?? null
  // Coach chat, open full screen over the dashboard. `call` opens it straight into a voice call (ending that call closes
  // the chat again); `origin` is the button it opens out of.
  const [coachChat, setCoachChat] = useState<{ call: boolean; origin: { x: number; y: number } | null; draft?: string } | null>(null)
  // Set while the open chat has a history entry of its own (?coach=chat), so closing it is a step back.
  const chatEntry = useRef(false)
  // Sessions the coach chat adds show in an open Training section straight away (`trainingRefresh`), and
  // `trainingReveal` opens it on the week they went in.
  const [trainingRefresh, setTrainingRefresh] = useState(0)
  const [trainingReveal, setTrainingReveal] = useState<(TrainingTarget & { at: number }) | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [activeTab, setActiveTab] = useState("overview")
  const [dashboardError, setDashboardError] = useState<string | null>(null)
  const [guide, setGuide] = useState<GuideTarget | null>(null)
  const [peek, setPeek] = useState<GuideTarget | null>(null)
  const [userKey, setUserKey] = useState<string | null>(null)
  const [setupStep, setSetupStep] = useState<SetupStep | null>(null)
  const [guideEvent, setGuideEvent] = useState<{ type: GuideEvent; at: number } | null>(null)
  const [subscriptionOpen, setSubscriptionOpen] = useState(false)
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [coachSwitcherOpen, setCoachSwitcherOpen] = useState(false)
  const [switchReturn, setSwitchReturn] = useState<SwitchReturn | null>(null)
  // Counts Workout Builder clicks; each one replays its launch animation in the nav.
  const [builderBurst, setBuilderBurst] = useState(0)
  // Summary refreshes can overlap (ticks save in the background): only the latest one is shown, so a slow older one
  // can't bring back a summary from before a later change.
  const overviewRequest = useRef(0)
  const survey = useSurvey(userKey !== null)
  const { tokens, refresh: refreshTokens } = useTokens(userKey !== null)
  const [storeNotice, setStoreNotice] = useState<StoreNotice>(null)
  // An account made before tokens is asked to agree to the Terms with them (components/legal/terms-update.tsx); after a
  // "don't agree", the notice of when its subscription ends can open the question again.
  const [terms, setTerms] = useState<TermsState | null>(null)
  const [termsOpen, setTermsOpen] = useState(false)
  // Opens the token store from anywhere (a refused request, a chat message that wasn't answered), closing the chat (and
  // any call in it) on the way.
  const openStore = useRef(() => {})

  useEffect(() => {
    const controller = new AbortController()
    const loadDashboard = async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession()
        if (error) throw error
        if (controller.signal.aborted) return
        if (!session) {
          router.replace("/auth")
          return
        }
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"
        const response = await fetch(`${apiUrl}/api/dashboard`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
          signal: controller.signal,
        })
        if (response.status === 401) {
          router.replace("/auth")
          return
        }
        // 402: the monthly plan isn't paid for. The dashboard is only for paying athletes; the payment screen starts it.
        if (response.status === 402) {
          router.replace("/subscribe")
          return
        }
        // 404: no profile yet. 409: a profile without a generated plan (setup didn't finish). Both resume onboarding.
        if (response.status === 404 || response.status === 409) {
          router.replace("/onboarding")
          return
        }
        if (!response.ok) {
          const errorBody = await response.json()
          throw new Error(errorBody.detail || "Your dashboard could not be loaded.")
        }
        const result = dashboardResponseSchema.parse(await response.json())
        if (controller.signal.aborted) return
        const profile = result.profile
        setUserData({
          fullName: profile.full_name,
          age: String(profile.age ?? ""),
          swimmerType: profile.swimmer_type || "",
          mainEvents: profile.main_events,
          swimSessionsPerWeek: profile.swim_sessions_per_week,
          gymSessionsPerWeek: profile.gym_sessions_per_week,
          performanceGoals: profile.one_year_goal || "",
          bodyGoals: profile.three_year_goal || "",
          weight: String(profile.weight ?? ""),
        })
        setDashboardPlan(result.plan.plan)
        setOverview(result.overview)
        setCoaches(profile.recommended_coaches)
        setUserKey(profile.user_key)
        loadCoachInfo().catch(() => undefined)
        localStorage.setItem("swimgpt_user_key", profile.user_key)
        localStorage.setItem("swimgpt_coaches", JSON.stringify(profile.recommended_coaches))
      } catch (error) {
        if (controller.signal.aborted) return
        console.error("Dashboard loading failed:", error)
        setDashboardError(error instanceof Error ? error.message : "Your personalized plan could not be loaded.")
      }
    }
    void loadDashboard()
    return () => controller.abort()
  }, [router])

  // Stripe returns here after paying for a coach switch (or cancelling it): the switcher reopens to finish it. The
  // address is cleaned up straight away, so a reload doesn't reopen it.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const status = params.get("coach_switch")
    if (status !== "paid" && status !== "cancelled") return
    setSwitchReturn(status === "paid" ? { status } : { status, coach: params.get("coach") })
    setCoachSwitcherOpen(true)
    window.history.replaceState(window.history.state, "", window.location.pathname)
  }, [])

  // Stripe returns here after buying tokens (or cancelling): the token store opens with what happened, and a paid purchase
  // is confirmed (its tokens added) straight away. The address is cleaned up, so a reload doesn't do it again.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const status = params.get("tokens")
    if (status !== "paid" && status !== "cancelled") return
    const sessionId = params.get("session_id")
    window.history.replaceState(window.history.state, "", window.location.pathname)
    setActiveTab("tokens")
    if (status === "cancelled" || !sessionId) {
      setStoreNotice({ tone: "note", text: "Checkout was cancelled, so nothing was charged." })
      return
    }
    setStoreNotice({ tone: "busy", text: "Confirming your purchase…" })
    verifyTokens(sessionId)
      .then((result) => setStoreNotice(
        !result.paid ? { tone: "error", text: "That payment hasn't gone through, so no tokens were added." }
          : result.added ? { tone: "success", text: `${tokenCount(result.tokens)} added to your balance.` }
            : { tone: "success", text: "Payment received. Your tokens are added within a minute." }))
      .catch((failure: unknown) => setStoreNotice({ tone: "error", text: failure instanceof Error ? failure.message : "Your purchase couldn't be confirmed just now." }))
      .finally(() => void refreshTokens())
  }, [refreshTokens])

  useEffect(() => {
    const open = () => openStore.current()
    window.addEventListener(OPEN_TOKEN_STORE, open)
    return () => window.removeEventListener(OPEN_TOKEN_STORE, open)
  }, [])

  // Whether this account still has to answer the Terms with tokens. If that can't be checked, nothing is asked: the
  // next visit asks again.
  useEffect(() => {
    if (!userKey) return
    let live = true
    loadTermsState()
      .then((state) => { if (live) setTerms(state) })
      .catch(() => { /* asked again on the next visit */ })
    return () => { live = false }
  }, [userKey])

  // The chat has an address, as it did when it was a page: Back and Forward close and reopen it, and a reload (or an old
  // /coach-chat link) opens it once the dashboard has loaded. A call is never redialled by a reload.
  useEffect(() => {
    const view = () => new URLSearchParams(window.location.search).get("coach")
    const opening = view()
    if (opening === "chat" || opening === "call") {
      setCoachChat({ call: opening === "call", origin: null })
      if (opening === "call") window.history.replaceState(window.history.state, "", `${window.location.pathname}?coach=chat`)
    }
    const onPopState = () => {
      chatEntry.current = view() === "chat"
      setCoachChat(chatEntry.current ? { call: false, origin: null } : null)
    }
    window.addEventListener("popstate", onPopState)
    return () => window.removeEventListener("popstate", onPopState)
  }, [])

  const refreshOverview = async () => {
    const request = ++overviewRequest.current
    const { data: { session }, error } = await supabase.auth.getSession()
    if (error) throw error
    if (!session) throw new Error("Your plan is saved, but your session expired. Sign in again to refresh the dashboard.")
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"
    const response = await fetch(`${apiUrl}/api/dashboard`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
    if (!response.ok) throw new Error("Your changes are saved, but the dashboard summary could not refresh. Reload the dashboard.")
    const result = dashboardResponseSchema.parse(await response.json())
    if (request === overviewRequest.current) setOverview(result.overview)
  }

  // A new coach rebuilds the season plan, so the whole dashboard (plan, overview and coach) is reloaded.
  const refreshAfterCoachSwitch = async (newCoach: string) => {
    setCoaches([newCoach])
    localStorage.setItem("swimgpt_coaches", JSON.stringify([newCoach]))
    const request = ++overviewRequest.current
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"
    const response = await fetch(`${apiUrl}/api/dashboard`, { headers: { Authorization: `Bearer ${session.access_token}` } })
    if (!response.ok) throw new Error(`Dashboard refresh failed (${response.status}).`)
    const result = dashboardResponseSchema.parse(await response.json())
    setDashboardPlan(result.plan.plan)
    if (request === overviewRequest.current) setOverview(result.overview)
    setCoaches(result.profile.recommended_coaches.length ? result.profile.recommended_coaches : [newCoach])
  }

  /** `draft`: a message to start the chat with (asked in a week's re-planner, but meant for the coach chat). */
  const openCoachChat = (call: boolean, event?: MouseEvent<HTMLElement>, draft?: string) => {
    if (!coach) return
    const rect = event?.currentTarget.getBoundingClientRect()
    setCoachChat({ call, origin: rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null, draft })
    if (chatEntry.current) return
    chatEntry.current = true
    window.history.pushState(window.history.state, "", `${window.location.pathname}?coach=chat`)
  }

  const closeCoachChat = () => {
    setCoachChat(null)
    if (chatEntry.current) {
      chatEntry.current = false
      window.history.back()
    } else {
      window.history.replaceState(window.history.state, "", window.location.pathname)
    }
  }

  openStore.current = () => {
    closeCoachChat()
    setActiveTab("tokens")
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  /** The coach chat added sessions to the athlete's weeks: the Training section and the summary show them. */
  const trainingAdded = () => {
    setTrainingRefresh((value) => value + 1)
    void refreshOverview().catch(() => { /* the summary catches up with the next change */ })
  }

  /** From the coach chat to where its sessions went: Training, on that sub-tab and week. */
  const openTraining = (target: TrainingTarget) => {
    closeCoachChat()
    setActiveTab("swim")
    setTrainingReveal({ ...target, at: Date.now() })
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    localStorage.removeItem("swimgpt_user_key")
    localStorage.removeItem("swimgpt_onboarding")
    localStorage.removeItem("swimgpt_coaches")
    router.replace("/auth")
  }

  if (dashboardError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-md rounded-[24px] border border-rose-400/20 bg-[linear-gradient(160deg,rgba(40,20,28,0.6),rgba(10,15,21,0.95))] p-8 text-center shadow-[0_24px_70px_rgba(0,0,0,0.5)]">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-400/15">
            <AlertTriangle className="h-6 w-6 text-rose-300" />
          </span>
          <h1 className="mt-4 text-xl font-semibold text-white">Your dashboard didn&apos;t load</h1>
          <p role="alert" className="mt-2 text-sm leading-6 text-slate-300">{dashboardError}</p>
          <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
            <Button onClick={() => window.location.reload()} className="rounded-full bg-accent text-accent-foreground hover:bg-accent/90">
              <RefreshCw className="h-4 w-4" />
              Try again
            </Button>
            <Button asChild variant="outline" className="rounded-full border-white/15 bg-transparent">
              <Link href="/auth">Back to sign in</Link>
            </Button>
          </div>
        </div>
      </div>
    )
  }

  if (!userData || !dashboardPlan || !overview) {
    return (
      <div className="min-h-screen bg-background">
        <div className="mx-auto max-w-6xl px-4 py-10" aria-busy="true" aria-live="polite">
          <div className="mb-8 flex items-center gap-3">
            <span className="relative flex">
              <span className="absolute inset-0 animate-ping rounded-xl bg-accent/30" />
              <span className="relative flex rounded-xl bg-gradient-to-br from-accent via-accent-foreground to-primary p-2">
                <Waves className="h-5 w-5 text-primary-foreground" />
              </span>
            </span>
            <p className="text-sm text-slate-300">Building your personalized dashboard…</p>
          </div>
          <div className="grid gap-5 xl:grid-cols-3">
            <div className="h-64 animate-pulse rounded-[22px] bg-white/[0.04] xl:col-span-2" />
            <div className="h-64 animate-pulse rounded-[22px] bg-white/[0.04]" />
            <div className="h-40 animate-pulse rounded-[22px] bg-white/[0.04] xl:col-span-3" />
          </div>
        </div>
      </div>
    )
  }

  const firstName = userData.fullName.split(" ")[0]
  const hour = new Date().getHours()
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"
  const [pageTitle, pageSubtitle] = pageTitles[activeTab] ?? pageTitles.overview
  const groups = tokens?.available ? [...navGroups, tokenGroup] : navGroups
  const changeTab = (value: string) => {
    setActiveTab(value)
    if (value === "builder") setBuilderBurst((count) => count + 1)
  }
  /** Training, on the Gym week (where the builder's workouts live). */
  const openGymWeek = () => {
    setActiveTab("swim")
    setGuide(null)
    requestAnimationFrame(() => setGuide("gym-week"))
  }

  const asking = terms?.required === true || termsOpen
  // Not over the Terms question while it waits for an answer.
  const chatOpen = coachChat !== null && userKey !== null && coach !== null && !asking

  return (
    // The chat (or the Terms question) covers the dashboard while it's open, so keyboard focus and screen readers stay inside it.
    <div inert={chatOpen || asking} className="min-h-screen bg-[#070b10] text-foreground">
      <div aria-hidden="true" className="pointer-events-none fixed inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(87,229,234,0.10),transparent_50%),radial-gradient(ellipse_at_bottom_left,rgba(56,120,220,0.10),transparent_55%)]" />
      </div>

      <Tabs value={activeTab} onValueChange={changeTab} activationMode="manual" className="relative w-full gap-0">
        <div className="flex min-h-screen">
          {/* Sidebar */}
          <aside
            className={cn(
              "sticky top-0 hidden h-screen shrink-0 flex-col border-r border-white/[0.07] bg-[linear-gradient(180deg,rgba(13,20,27,0.92),rgba(7,11,16,0.96))] backdrop-blur-xl transition-[width] duration-300 lg:flex",
              sidebarCollapsed ? "w-[84px]" : "w-72",
            )}
          >
            <div className={cn("flex items-center gap-3 px-4 py-5", sidebarCollapsed ? "flex-col" : "justify-between")}>
              <Link href="/" className="flex items-center gap-2.5" title="SwimGPT home">
                <span className="relative">
                  <span className="absolute inset-0 animate-pulse rounded-full bg-accent/20 blur-xl" />
                  <span className="relative flex rounded-xl bg-gradient-to-br from-accent via-accent-foreground to-primary p-2">
                    <Waves className="h-5 w-5 text-primary-foreground" />
                  </span>
                </span>
                {!sidebarCollapsed && (
                  <span className="text-lg font-bold tracking-tight text-white">
                    Swim<span className="text-accent">GPT</span>
                  </span>
                )}
              </Link>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-lg border border-white/[0.08] bg-white/[0.02] text-slate-300 hover:bg-white/[0.06] hover:text-white"
                onClick={() => setSidebarCollapsed((prev) => !prev)}
                aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              >
                {sidebarCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
              </Button>
            </div>

            <nav className="flex-1 overflow-y-auto px-3 pb-3" aria-label="Dashboard sections">
              <TabsList className="flex h-auto w-full flex-col items-stretch gap-5 rounded-none bg-transparent p-0">
                {groups.map((group) => (
                  <div key={group.label} className="space-y-1">
                    {sidebarCollapsed ? (
                      <div className="mx-auto mb-2 h-px w-8 bg-white/10" />
                    ) : (
                      <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">{group.label}</p>
                    )}
                    {group.items.map((item) => (
                      <TabsTrigger
                        key={item.value}
                        value={item.value}
                        title={sidebarCollapsed ? item.label : undefined}
                        aria-label={item.label}
                        className={cn(
                          "group relative h-auto w-full flex-none justify-start gap-3 rounded-xl border border-transparent px-3 py-2.5 text-sm font-medium text-slate-300 transition-all duration-200",
                          "hover:bg-white/[0.04] hover:text-white",
                          "data-[state=active]:border-accent/25 data-[state=active]:bg-[linear-gradient(90deg,rgba(87,229,234,0.16),rgba(87,229,234,0.04))] data-[state=active]:text-white data-[state=active]:shadow-[0_0_20px_rgba(87,229,234,0.10)]",
                          "before:absolute before:left-0 before:top-1/2 before:h-0 before:w-[3px] before:-translate-y-1/2 before:rounded-full before:bg-accent before:transition-all before:duration-300 data-[state=active]:before:h-5",
                          sidebarCollapsed && "justify-center px-0",
                          item.value === "builder" && "hover:bg-violet-400/[0.07] active:scale-[0.97]",
                        )}
                      >
                        {item.value === "builder" ? (
                          <>
                            {builderBurst > 0 && <span key={builderBurst} aria-hidden className="wb-flash" />}
                            <span className="relative grid shrink-0 place-items-center">
                              <item.icon key={`icon-${builderBurst}`} className={cn("h-[18px] w-[18px] text-violet-300 transition-colors group-hover:text-violet-200", builderBurst > 0 && "wb-icon")} />
                              {builderBurst > 0 && (
                                <span key={`burst-${builderBurst}`} aria-hidden>
                                  <span className="wb-ring" />
                                  <span className="wb-sparks">{SPARKS.map((angle) => <i key={angle} style={{ "--a": `${angle}deg` } as CSSProperties} />)}</span>
                                </span>
                              )}
                            </span>
                          </>
                        ) : (
                          <item.icon className="h-[18px] w-[18px] shrink-0 transition-colors group-data-[state=active]:text-accent" />
                        )}
                        {!sidebarCollapsed && <span className="relative truncate">{item.label}</span>}
                      </TabsTrigger>
                    ))}
                  </div>
                ))}
              </TabsList>
            </nav>

            <div className="space-y-2 border-t border-white/[0.07] p-3">
              {coach && !sidebarCollapsed && (
                <div className="dc-card relative overflow-hidden rounded-2xl border border-accent/25 bg-[linear-gradient(140deg,rgba(87,229,234,0.14),rgba(255,255,255,0.02))]">
                  <button type="button" onClick={(event) => openCoachChat(false, event)} className="group flex w-full cursor-pointer items-center gap-2.5 px-3 pb-2.5 pt-3 text-left transition-colors hover:bg-white/[0.03]" title={`Chat with ${coach}`}>
                    <span className="relative shrink-0">
                      <CoachAvatar name={coach} shape="circle" className="h-9 w-9 border-2 border-[#0b1218]" />
                      <span aria-hidden className="cv-live absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[#0b1218] bg-emerald-400" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-accent">Your coach</span>
                      <span className="block truncate text-sm font-semibold text-white">{coach}</span>
                    </span>
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-accent transition-colors group-hover:border-accent/40 group-hover:bg-accent/10">
                      <MessageSquare className="h-4 w-4" />
                      <span className="sr-only">Open chat</span>
                    </span>
                  </button>
                  <div className="px-3 pb-3">
                    <button type="button" onClick={(event) => openCoachChat(true, event)} aria-label={`Talk to ${coach} in a live voice call`}
                      className="dc-call cv-launch group relative flex w-full cursor-pointer items-center gap-2.5 overflow-hidden rounded-xl py-2 pl-2 pr-3 text-left text-slate-950 transition-transform duration-300 hover:-translate-y-0.5 active:translate-y-0">
                      <span aria-hidden className="cv-launch-sheen" />
                      <span className="relative grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-950/15">
                        <span aria-hidden className="dc-ring absolute inset-0 rounded-full" />
                        <Phone className="h-4 w-4 transition-transform duration-300 group-hover:rotate-[-12deg] group-hover:scale-110" strokeWidth={2.4} />
                      </span>
                      <span className="relative min-w-0 flex-1 leading-tight">
                        <span className="block truncate text-sm font-bold">Talk to {coach.replace(/^Coach\s+/i, "")}</span>
                        <span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-950/70">Live voice call</span>
                      </span>
                      <span aria-hidden className="dc-eq relative flex h-4 items-end gap-[3px]"><i /><i /><i /><i /></span>
                    </button>
                  </div>
                </div>
              )}
              {coach && sidebarCollapsed && (
                <button type="button" onClick={(event) => openCoachChat(true, event)} title={`Talk to ${coach}`} aria-label={`Talk to ${coach} in a live voice call`}
                  className="dc-call cv-launch relative mx-auto grid h-11 w-11 cursor-pointer place-items-center overflow-hidden rounded-xl text-slate-950 transition-transform hover:scale-105">
                  <span aria-hidden className="cv-launch-sheen" />
                  <span aria-hidden className="dc-ring absolute inset-1.5 rounded-lg" />
                  <Phone className="relative h-5 w-5" strokeWidth={2.4} />
                </button>
              )}
              <div className={cn("flex items-center gap-3 rounded-2xl p-2", sidebarCollapsed && "justify-center")}>
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent via-accent-foreground to-primary text-sm font-bold text-primary-foreground">
                  {userData.fullName.charAt(0).toUpperCase()}
                </span>
                {!sidebarCollapsed && (
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-white">{userData.fullName}</p>
                    <p className="truncate text-[11px] text-slate-400">Performance athlete</p>
                  </div>
                )}
              </div>
              <Button
                variant="ghost"
                className={cn(
                  "w-full rounded-xl text-slate-400 hover:bg-white/[0.06] hover:text-white",
                  sidebarCollapsed ? "justify-center px-0" : "justify-start",
                )}
                onClick={() => setSubscriptionOpen(true)}
                title="Subscription"
              >
                <CreditCard className="h-4 w-4 shrink-0" />
                {!sidebarCollapsed && <span>Subscription</span>}
              </Button>
              <Button
                variant="ghost"
                className={cn(
                  "w-full rounded-xl text-slate-400 hover:bg-white/[0.06] hover:text-white",
                  sidebarCollapsed ? "justify-center px-0" : "justify-start",
                )}
                onClick={() => setPasswordOpen(true)}
                title="Change password"
              >
                <KeyRound className="h-4 w-4 shrink-0" />
                {!sidebarCollapsed && <span>Change password</span>}
              </Button>
              <Button
                variant="ghost"
                className={cn(
                  "w-full rounded-xl text-slate-400 hover:bg-rose-400/10 hover:text-rose-200",
                  sidebarCollapsed ? "justify-center px-0" : "justify-start",
                )}
                onClick={handleSignOut}
                title="Sign out"
              >
                <LogOut className="h-4 w-4 shrink-0" />
                {!sidebarCollapsed && <span>Sign out</span>}
              </Button>
            </div>
          </aside>

          <main data-coach-dock className="min-w-0 flex-1">
            {/* Header. Its labels follow its own width (@container), not the window's: the week re-planner docked beside it
                narrows it on a wide screen. */}
            <header className="@container sticky top-0 z-40 border-b border-white/[0.07] bg-[#070b10]/75 backdrop-blur-xl">
              <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3.5 sm:px-6 lg:px-8">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex rounded-xl bg-gradient-to-br from-accent via-accent-foreground to-primary p-1.5 lg:hidden">
                    <Waves className="h-4 w-4 text-primary-foreground" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-white">
                      {greeting}, {firstName}
                    </p>
                    <p className="truncate text-xs text-slate-400">{overview.date}</p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {/* Below lg the survey's link is on the Dashboard tab instead, where there's room for it. */}
                  <SurveyLink invite={survey} className="hidden lg:flex" />
                  {/* On a phone the header has no room for it: the sections below start with it instead. */}
                  {tokens?.available && <TokenCount balance={tokens.balance} onOpen={() => openStore.current()} className="hidden sm:flex" />}
                  {coach && (
                    <div className="flex h-9 items-center rounded-full border border-white/10 bg-white/[0.03] transition-colors hover:border-white/20">
                      <button type="button" onClick={(event) => openCoachChat(false, event)} aria-label={`Chat with ${coach}`}
                        className="flex h-full cursor-pointer items-center gap-2 rounded-l-full pl-1.5 pr-3 text-sm font-medium text-white transition-colors hover:bg-accent/10">
                        <CoachAvatar key={coach} name={coach} shape="circle" className="h-6 w-6 animate-in fade-in zoom-in-50 duration-500" />
                        <span className="hidden whitespace-nowrap @3xl:inline">Chat with {coach}</span>
                        <span className="hidden whitespace-nowrap @lg:inline @3xl:hidden">Chat</span>
                      </button>
                      <span aria-hidden className="h-5 w-px bg-white/10" />
                      <button type="button" onClick={() => setCoachSwitcherOpen(true)} aria-label="Switch coach" title="Switch coach"
                        className="group flex h-full items-center gap-1.5 rounded-r-full pl-2.5 pr-3 text-sm font-medium text-slate-300 transition-colors hover:bg-accent/10 hover:text-accent">
                        <Repeat className="h-4 w-4 transition-transform duration-500 ease-out group-hover:rotate-180" />
                        <span className="hidden whitespace-nowrap @4xl:inline">Switch</span>
                      </button>
                    </div>
                  )}
                  {/* The sidebar's call button is hidden on smaller screens, so the header carries it there. */}
                  {coach && (
                    <button type="button" onClick={(event) => openCoachChat(true, event)} aria-label={`Talk to ${coach} in a live voice call`} title={`Talk to ${coach}`}
                      className="dc-call cv-launch relative flex h-9 cursor-pointer items-center gap-1.5 overflow-hidden rounded-full px-3 text-sm font-semibold text-slate-950 lg:hidden">
                      <span aria-hidden className="cv-launch-sheen" />
                      <Phone className="relative h-4 w-4" strokeWidth={2.4} />
                      <span className="relative hidden sm:inline">Talk</span>
                    </button>
                  )}
                  <Button variant="ghost" size="icon" className="rounded-full text-slate-300 hover:bg-white/[0.06] lg:hidden" onClick={() => setSubscriptionOpen(true)} aria-label="Subscription">
                    <CreditCard className="h-5 w-5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="rounded-full text-slate-300 hover:bg-white/[0.06] lg:hidden" onClick={() => setPasswordOpen(true)} aria-label="Change password">
                    <KeyRound className="h-5 w-5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="rounded-full text-slate-300 hover:bg-white/[0.06] lg:hidden" onClick={handleSignOut} aria-label="Sign out">
                    <LogOut className="h-5 w-5" />
                  </Button>
                </div>
              </div>

              {/* Mobile section tabs */}
              <div className="border-t border-white/[0.05] lg:hidden">
                <TabsList className="flex h-auto w-full justify-start gap-2 overflow-x-auto rounded-none bg-transparent px-4 py-2.5 [scrollbar-width:none] sm:px-6">
                  {tokens?.available && <TokenCount balance={tokens.balance} onOpen={() => openStore.current()} className="h-auto flex-none px-3.5 py-1.5 sm:hidden" />}
                  {groups.flatMap((group) => group.items).map((item) => (
                    <TabsTrigger
                      key={item.value}
                      value={item.value}
                      className={cn("relative h-auto flex-none gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-1.5 text-sm text-slate-300 data-[state=active]:border-accent data-[state=active]:bg-accent data-[state=active]:text-accent-foreground",
                        item.value === "builder" && "border-violet-300/25 active:scale-[0.96]")}
                    >
                      {item.value === "builder" && builderBurst > 0 && <span key={builderBurst} aria-hidden className="wb-flash" />}
                      <item.icon key={item.value === "builder" ? `icon-${builderBurst}` : undefined} className={cn("relative h-4 w-4", item.value === "builder" && "text-violet-300", item.value === "builder" && builderBurst > 0 && "wb-icon")} />
                      <span className="relative">{item.label}</span>
                    </TabsTrigger>
                  ))}
                </TabsList>
              </div>
            </header>

            <div className="mx-auto max-w-7xl px-4 pb-20 pt-6 sm:px-6 lg:px-8 lg:pt-8">
              {terms?.declined && <TermsEnding endsAt={terms.ends_at} onAgree={() => setTermsOpen(true)} />}
              {activeTab === "overview" ? (
                <Reveal>
                  <section className="relative mb-6 overflow-hidden rounded-[28px] border border-white/[0.08] bg-[linear-gradient(125deg,rgba(87,229,234,0.16),rgba(12,20,28,0.94)_42%,rgba(56,120,220,0.12))] p-6 shadow-[0_24px_60px_rgba(0,0,0,0.35)] sm:p-8">
                    <div className="pointer-events-none absolute inset-0 opacity-50">
                      <WaterBubbles />
                    </div>
                    <div className="relative grid gap-8 lg:grid-cols-[1fr_auto] lg:items-end">
                      <div className="max-w-2xl">
                        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">Training hub</p>
                        <h1 className="mt-2 text-3xl font-bold tracking-tight text-white sm:text-4xl">{userData.fullName}</h1>
                        <p className="mt-3 text-base leading-7 text-slate-300">{dashboardPlan.focus}</p>
                        <div className="mt-5 flex flex-wrap gap-2">
                          {dashboardPlan.tags.map((tag: string) => (
                            <span key={tag} className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-1 text-xs font-medium text-slate-200 backdrop-blur-md">
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>
                      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-2">
                        {[
                          { label: "Phase", value: dashboardPlan.phase, icon: Layers },
                          { label: "Block length", value: dashboardPlan.phase_duration, icon: Timer },
                          { label: "Swim / week", value: String(userData.swimSessionsPerWeek), icon: Waves },
                          { label: "Gym / week", value: String(userData.gymSessionsPerWeek), icon: Dumbbell },
                        ].map((stat) => (
                          <div key={stat.label} className="min-w-0 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 backdrop-blur-md lg:w-44">
                            <dt className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-slate-400">
                              <stat.icon className="h-3.5 w-3.5 text-accent" />
                              {stat.label}
                            </dt>
                            <dd className="mt-1 truncate text-lg font-semibold text-white" title={stat.value}>
                              {stat.value}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  </section>
                </Reveal>
              ) : activeTab === "video" ? null : (
                <div key={activeTab} className="dash-reveal mb-6">
                  <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">{pageTitle}</h1>
                  <p className="mt-1 text-sm text-slate-400">{pageSubtitle}</p>
                </div>
              )}

              <TabsContent value="overview" className="mt-0">
                <GettingStarted
                  firstName={firstName}
                  swimSessions={userData.swimSessionsPerWeek}
                  gymSessions={userData.gymSessionsPerWeek}
                  onShowMe={(target) => {
                    // A finished step just shows where it lives; an open one starts the hands-on walkthrough there.
                    if (target === "swim-week" || target === "gym-week") { setActiveTab("swim"); setGuide(target); setPeek(target); return }
                    setSetupStep(target === "gym-generate" ? "gym" : target === "add-meet" ? "meet" : "swim")
                  }}
                />
                <SurveyLink invite={survey} variant="dashboard" className="lg:hidden" />
                <DashboardOverview data={overview} onViewToday={() => setActiveTab("swim")} onOpenChat={(event) => openCoachChat(false, event)}
                  onDaysSaved={({ swims, strength }) => {
                    // Saving the days sets the weekly numbers: the header, the setup guide and the summary show the new ones.
                    setUserData((current) => current && { ...current, swimSessionsPerWeek: swims, gymSessionsPerWeek: strength })
                    void refreshOverview().catch(() => { /* the summary catches up with the next change */ })
                  }} />
              </TabsContent>
              <TabsContent value="swim" className="mt-0 space-y-6">
                <TrainingPanel onChanged={refreshOverview} guide={guide} onGuideEvent={(type) => setGuideEvent({ type, at: Date.now() })}
                  refresh={trainingRefresh} reveal={trainingReveal} coach={coach} onOpenCoachChat={(draft) => openCoachChat(false, undefined, draft)} />
              </TabsContent>
              <TabsContent value="builder" className="mt-0">
                <WorkoutBuilderSection onChanged={refreshOverview} onOpenGymWeek={openGymWeek} />
              </TabsContent>
              <TabsContent value="nutrition" className="mt-0">
                <HealthConsentGate feature="nutrition">
                  <NutritionPanel firstName={firstName} trainingToday={overview.today.length > 0} />
                </HealthConsentGate>
              </TabsContent>
              <TabsContent value="mental" className="mt-0">
                <HealthConsentGate feature="mind">
                  <MentalPanel firstName={firstName} />
                </HealthConsentGate>
              </TabsContent>
              <TabsContent value="video" className="mt-0">
                <StrokeLab variant="dashboard" />
              </TabsContent>
              <TabsContent value="paces" className="mt-0 space-y-6">
                <PaceCalculator />
              </TabsContent>
              <TabsContent value="tokens" className="mt-0">
                <TokenStore tokens={tokens} notice={storeNotice} />
              </TabsContent>
            </div>
            <LegalLinks className="pb-8 pt-2" />
          </main>
        </div>
      </Tabs>
      {peek && <GuideSpotlight key={peek} target={peek} onClose={() => setPeek(null)} />}
      <TokensNeededDialog onGetTokens={() => openStore.current()} />
      {asking && (
        <TermsUpdate declined={terms?.declined === true} onAnswered={(state) => { setTerms(state); setTermsOpen(false) }}
          onClose={terms?.required ? undefined : () => setTermsOpen(false)} />
      )}
      <SubscriptionDialog open={subscriptionOpen} onOpenChange={setSubscriptionOpen} />
      <ChangePasswordDialog open={passwordOpen} onOpenChange={setPasswordOpen} />
      {coach && (
        <CoachSwitcher open={coachSwitcherOpen} current={coach} returned={switchReturn}
          onClose={() => { setCoachSwitcherOpen(false); setSwitchReturn(null) }} onSwitched={refreshAfterCoachSwitch}
          onChat={() => { setCoachSwitcherOpen(false); setSwitchReturn(null); openCoachChat(false) }} />
      )}
      {chatOpen && (
        <CoachChat userKey={userKey} coaches={coaches} call={coachChat.call} origin={coachChat.origin} draft={coachChat.draft} swimsPerWeek={userData.swimSessionsPerWeek} onClose={closeCoachChat}
          onTrainingAdded={trainingAdded} onOpenTraining={openTraining} />
      )}
      {userKey && (
        <GuidedSetup
          userKey={userKey}
          firstName={firstName}
          coach={coach ?? "Your coach"}
          swimSessions={userData.swimSessionsPerWeek}
          gymSessions={userData.gymSessionsPerWeek}
          step={setupStep}
          onStep={setSetupStep}
          event={guideEvent}
          onNavigate={(target) => {
            if (target === "overview") { setActiveTab("overview"); return }
            setActiveTab("swim")
            // Re-set the target even when it is unchanged, so the Training tab always opens the right sub-tab.
            setGuide(null)
            requestAnimationFrame(() => setGuide(target))
          }}
        />
      )}
    </div>
  )
}
