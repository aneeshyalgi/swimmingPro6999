"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Dumbbell,
  Gauge,
  LayoutDashboard,
  Layers,
  LogOut,
  MessageSquare,
  RefreshCw,
  ScanLine,
  Timer,
  Users,
  Waves,
} from "lucide-react"
import { supabase } from "@/lib/supabase"
import { cn } from "@/lib/utils"
import { DashboardOverview } from "@/components/dashboard-overview"
import { Reveal } from "@/components/dashboard-ui"
import { WaterBubbles } from "@/components/water-bubbles"
import { TrainingPanel } from "@/components/training-panel"
import { PaceCalculator } from "@/components/pace-calculator"
import { StrokeLab } from "@/components/video-lab/stroke-lab"
import { CoachAvatar } from "@/components/coach-avatar"
import { GettingStarted, GuideSpotlight, type GuideEvent, type GuideTarget } from "@/components/dashboard-guide"
import { GuidedSetup, type SetupStep } from "@/components/guided-setup"
import { Banner } from "@/components/training-ui"
import { dashboardResponseSchema, type DashboardOverviewData, type DashboardPlan } from "@/lib/dashboard"

const navGroups = [
  {
    label: "Train",
    items: [
      { value: "overview", label: "Dashboard", icon: LayoutDashboard },
      { value: "swim", label: "Training", icon: Waves },
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

const pageTitles: Record<string, [string, string]> = {
  overview: ["Dashboard", "Your training at a glance"],
  swim: ["Training", "Your plan, schedule and competitions"],
  paces: ["Pace Calculator", "Training paces for every zone, for you and your athletes"],
  video: ["Video Analysis", "AI stroke lab: pose tracking, telemetry and a coach brief from your clip"],
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [activeTab, setActiveTab] = useState("overview")
  const [dashboardError, setDashboardError] = useState<string | null>(null)
  const [guide, setGuide] = useState<GuideTarget | null>(null)
  const [peek, setPeek] = useState<GuideTarget | null>(null)
  const [userKey, setUserKey] = useState<string | null>(null)
  const [setupStep, setSetupStep] = useState<SetupStep | null>(null)
  const [guideEvent, setGuideEvent] = useState<{ type: GuideEvent; at: number } | null>(null)

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

  const refreshOverview = async () => {
    const { data: { session }, error } = await supabase.auth.getSession()
    if (error) throw error
    if (!session) throw new Error("Your plan is saved, but your session expired. Sign in again to refresh the dashboard.")
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"
    const response = await fetch(`${apiUrl}/api/dashboard`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
    if (!response.ok) throw new Error("Your changes are saved, but the dashboard summary could not refresh. Reload the dashboard.")
    const result = dashboardResponseSchema.parse(await response.json())
    setOverview(result.overview)
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

  return (
    <div className="min-h-screen bg-[#070b10] text-foreground">
      <div aria-hidden="true" className="pointer-events-none fixed inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(87,229,234,0.10),transparent_50%),radial-gradient(ellipse_at_bottom_left,rgba(56,120,220,0.10),transparent_55%)]" />
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="relative w-full gap-0">
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
                {navGroups.map((group) => (
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
                        )}
                      >
                        <item.icon className="h-[18px] w-[18px] shrink-0 transition-colors group-data-[state=active]:text-accent" />
                        {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
                      </TabsTrigger>
                    ))}
                  </div>
                ))}
              </TabsList>
            </nav>

            <div className="space-y-2 border-t border-white/[0.07] p-3">
              {coaches.length > 0 && !sidebarCollapsed && (
                <Link
                  href="/coach-chat"
                  className="block rounded-2xl border border-accent/20 bg-[linear-gradient(140deg,rgba(87,229,234,0.12),rgba(255,255,255,0.02))] p-3 transition-colors hover:border-accent/40"
                >
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-accent">Your coaches</p>
                  <div className="mt-2 flex items-center gap-2">
                    <div className="flex -space-x-2">
                      {coaches.map((coach) => (
                        <CoachAvatar key={coach} name={coach} shape="circle" className="h-7 w-7 border-2 border-[#0b1218]" />
                      ))}
                    </div>
                    <p className="min-w-0 flex-1 truncate text-xs text-slate-300">{coaches.join(" · ")}</p>
                    <MessageSquare className="h-4 w-4 shrink-0 text-accent" />
                  </div>
                </Link>
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

          <main className="min-w-0 flex-1">
            {/* Header */}
            <header className="sticky top-0 z-40 border-b border-white/[0.07] bg-[#070b10]/75 backdrop-blur-xl">
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
                <div className="flex items-center gap-2">
                  {coaches.length > 0 && (
                    <Button asChild variant="outline" size="sm" className="rounded-full border-white/10 bg-white/[0.03] hover:border-accent/40 hover:bg-accent/10">
                      <Link href="/coach-chat" aria-label="Chat with Coach">
                        <Users className="h-4 w-4" />
                        <span className="hidden md:inline">Chat with Coach</span>
                      </Link>
                    </Button>
                  )}
                  <Button variant="ghost" size="icon" className="rounded-full text-slate-300 hover:bg-white/[0.06] lg:hidden" onClick={handleSignOut} aria-label="Sign out">
                    <LogOut className="h-5 w-5" />
                  </Button>
                </div>
              </div>

              {/* Mobile section tabs */}
              <div className="border-t border-white/[0.05] lg:hidden">
                <TabsList className="flex h-auto w-full justify-start gap-2 overflow-x-auto rounded-none bg-transparent px-4 py-2.5 [scrollbar-width:none] sm:px-6">
                  {navGroups.flatMap((group) => group.items).map((item) => (
                    <TabsTrigger
                      key={item.value}
                      value={item.value}
                      className="h-auto flex-none gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-1.5 text-sm text-slate-300 data-[state=active]:border-accent data-[state=active]:bg-accent data-[state=active]:text-accent-foreground"
                    >
                      <item.icon className="h-4 w-4" />
                      {item.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </div>
            </header>

            <div className="mx-auto max-w-7xl px-4 pb-20 pt-6 sm:px-6 lg:px-8 lg:pt-8">
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
                <DashboardOverview data={overview} onViewToday={() => setActiveTab("swim")} />
              </TabsContent>
              <TabsContent value="swim" className="mt-0 space-y-6">
                <TrainingPanel onChanged={refreshOverview} guide={guide} onGuideEvent={(type) => setGuideEvent({ type, at: Date.now() })} />
              </TabsContent>
              <TabsContent value="video" className="mt-0">
                <StrokeLab variant="dashboard" />
              </TabsContent>
              <TabsContent value="paces" className="mt-0 space-y-6">
                <PaceCalculator />
              </TabsContent>
            </div>
          </main>
        </div>
      </Tabs>
      {peek && <GuideSpotlight key={peek} target={peek} onClose={() => setPeek(null)} />}
      {userKey && (
        <GuidedSetup
          userKey={userKey}
          firstName={firstName}
          coach={coaches[0] ?? "Your coach"}
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
