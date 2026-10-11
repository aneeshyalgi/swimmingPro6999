"use client"

import { Suspense, useEffect, useState, type CSSProperties, type ReactNode } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { AlertTriangle, ArrowLeft, CalendarCheck, CheckCircle2, Loader2, Lock, Mail, Sparkles, Trophy, User, Waves } from "lucide-react"
import { AuthField, AuthSubmit, FormError, PasswordStrength, RevealButton } from "@/components/auth/auth-field"
import { ResetRequest } from "@/components/auth/reset-request"
import { CoachAvatar } from "@/components/coach-avatar"
import { LegalLinks } from "@/components/legal/legal-links"
import { WaterBubbles } from "@/components/water-bubbles"
import { homePath, PASSWORD_MIN_LENGTH, safeNext } from "@/lib/account"
import { LEGAL_VERSION } from "@/lib/legal"
import { isSupabaseConfigured, supabase } from "@/lib/supabase"
import { cn } from "@/lib/utils"

type Mode = "signin" | "signup" | "forgot"

const modeOf = (value: string | null): Mode => (value === "signup" || value === "forgot" ? value : "signin")

const COPY: Record<Mode, { eyebrow: string; title: ReactNode; body: string; card: string; cardBody: string }> = {
  signin: {
    eyebrow: "Welcome back",
    title: <>Back in the <span className="au-gradient-text">water.</span></>,
    body: "Pick up exactly where you left off: this week's sessions, your coach and the countdown to your next meet.",
    card: "Log in to SwimGPT",
    cardBody: "Good to see you again.",
  },
  signup: {
    eyebrow: "High performance coaching",
    title: <>Your next breakthrough <span className="au-gradient-text">starts here.</span></>,
    body: "Tell us about your swimming, choose your coach, and get a season plan built around your events.",
    card: "Create your account",
    cardBody: "Set up takes about 3 minutes.",
  },
  forgot: {
    eyebrow: "Account recovery",
    title: <>Locked out? Back in the <span className="au-gradient-text">water</span> in a minute.</>,
    body: "We'll email you a secure link to choose a new password. Your plan, your sessions and your coach stay exactly as they are.",
    card: "Reset your password",
    cardBody: "Enter the email you use for SwimGPT and we'll send you a link to choose a new password.",
  },
}

const COACHES = ["Coach Brad", "Coach Pete", "Coach Timothy", "Coach Robert", "Coach Tony"]
// An 8 × 25 race-pace set: every rep under the 13.5 s target.
const REPS = [13.4, 13.3, 13.3, 13.2, 13.1, 13.1, 13.0, 12.9]
// Faster reps stand taller.
const barHeight = (seconds: number) => 30 + ((13.6 - seconds) / 0.7) * 60

export default function AuthPage() {
  return (
    <Suspense fallback={
      <main className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <div role="status" className="flex items-center gap-3">
          <Loader2 aria-hidden className="h-5 w-5 animate-spin text-cyan-300" />
          <span>Loading sign-in...</span>
        </div>
      </main>
    }>
      <AuthPageContent />
    </Suspense>
  )
}

function AuthPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [mode, setMode] = useState<Mode>(modeOf(searchParams.get("mode")))
  const [fullName, setFullName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [capsLock, setCapsLock] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [authError, setAuthError] = useState("")
  const [errorKey, setErrorKey] = useState(0)
  // The email and password didn't match: the error offers a password reset.
  const [wrongPassword, setWrongPassword] = useState(false)
  const [notice, setNotice] = useState("")
  const next = safeNext(searchParams.get("next"))
  // Buying a training plan needs only an account: no coaching setup or subscription.
  const forPlan = Boolean(next?.startsWith("/training-plans"))

  const redirectAfterAuth = async (_authUserId: string) => {
    if (next) {
      router.replace(next)
      return
    }
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) throw new Error("Your session could not be verified. Please sign in again.")
    router.replace(await homePath(session.access_token))
  }

  useEffect(() => {
    const checkSession = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (session) {
        try {
          await redirectAfterAuth(session.user.id)
        } catch (error: any) {
          setAuthError(error?.message || "We could not check your onboarding status.")
        }
      }
    }

    checkSession()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router])

  useEffect(() => {
    setMode(modeOf(searchParams.get("mode")))
    setAuthError("")
    setWrongPassword(false)
    setNotice("")
  }, [searchParams])

  const showError = (message: string, mismatch = false) => {
    setAuthError(message)
    setWrongPassword(mismatch)
    setErrorKey((key) => key + 1)
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setIsSubmitting(true)
    setAuthError("")
    setNotice("")

    if (!isSupabaseConfigured) {
      showError("Supabase is not configured. Add the frontend env values and refresh the page.")
      setIsSubmitting(false)
      return
    }

    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: fullName,
              // Which Terms and Privacy Policy they agreed to by creating the account (the note under the button).
              accepted_terms: LEGAL_VERSION,
              accepted_terms_at: new Date().toISOString(),
            },
            emailRedirectTo: `${window.location.origin}${next ?? "/onboarding"}`,
          },
        })

        if (error) {
          throw error
        }

        if (data.user && !data.session) {
          setNotice("Account created. Check your email to confirm your account before continuing.")
          setMode("signin")
          setPassword("")
          return
        }

        const signedUpUserId = data?.user?.id
        if (!signedUpUserId) {
          throw new Error("Account created but no user session was returned.")
        }

        await redirectAfterAuth(signedUpUserId)
        return
      }

      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (error) {
        throw error
      }

      if (!data.user) {
        throw new Error("Authentication succeeded but no user session was returned.")
      }

      await redirectAfterAuth(data.user.id)
    } catch (error: any) {
      if (mode === "signin" && (error?.code === "invalid_credentials" || error?.message === "Invalid login credentials")) {
        showError("That email and password don't match.", true)
      } else {
        showError(error?.message || "Authentication failed. Please try again.")
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  const switchMode = (target: Mode) => {
    if (target !== mode) router.push(`/auth?mode=${target}${next ? `&next=${encodeURIComponent(next)}` : ""}`)
  }
  const toRead = Boolean(next?.startsWith("/training-plans/read/"))
  const copy = mode === "forgot" ? COPY.forgot : toRead ? {
    ...COPY[mode],
    body: "Your training plans are saved to the account you bought them with. Log in with it and your plan opens straight away.",
    cardBody: mode === "signup" ? "Free. Every plan you buy is saved to it." : "Then straight back to your plan.",
  } : forPlan ? {
    ...COPY[mode],
    body: "A free account is all you need to buy a training plan: no subscription and no setup. Every plan you buy is saved to it.",
    cardBody: mode === "signup" ? "Free, and all you need to buy your plan." : "Then straight on to your plan's checkout.",
  } : COPY[mode]

  return (
    <div className="au-page relative min-h-screen overflow-hidden text-foreground">
      {/* Ambient water */}
      <div aria-hidden className="pointer-events-none fixed inset-0">
        <span className="au-blob au-blob-a" />
        <span className="au-blob au-blob-b" />
        <span className="au-blob au-blob-c" />
        <span className="au-rays absolute inset-0" />
        <span className="au-grid absolute inset-0" />
        <div className="absolute inset-0 opacity-50"><WaterBubbles /></div>
      </div>

      <div className="relative z-10 mx-auto grid min-h-screen max-w-6xl items-center gap-10 px-4 py-8 sm:px-6 lg:grid-cols-[1.08fr_1fr] lg:gap-14 lg:py-10">
        {/* Showcase */}
        <aside className="au-showcase relative hidden overflow-hidden rounded-[36px] border border-white/10 p-10 lg:block" aria-hidden>
          <span className="au-caustics absolute inset-0" />
          <span className="au-lane absolute inset-x-0 top-[62%]" />
          <span className="au-lane absolute inset-x-0 top-[78%] [animation-delay:-1.4s]" />

          <div className="relative">
            <p key={`e-${mode}`} className="au-swap inline-flex items-center gap-2 rounded-full border border-cyan-300/25 bg-cyan-300/[0.06] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-cyan-200">
              <Sparkles className="h-3.5 w-3.5" />{copy.eyebrow}
            </p>
            <h1 key={`t-${mode}`} className="au-swap mt-5 max-w-md text-balance text-[2.75rem] font-bold leading-[1.05] tracking-tight text-white [animation-delay:60ms]">
              {copy.title}
            </h1>
            <p key={`b-${mode}`} className="au-swap mt-4 max-w-md text-[15px] leading-7 text-slate-300 [animation-delay:120ms]">{copy.body}</p>
          </div>

          {/* Race-pace set card, with chips layered on its free corners */}
          <div className="relative mt-10">
            <div className="au-float au-glass relative max-w-[21rem] rounded-3xl p-5" style={{ "--d": "0s" } as CSSProperties}>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">Race-pace set</p>
              <p className="mt-0.5 font-semibold text-white">8 × 25 m butterfly</p>
              <div className="relative mt-6 flex h-28 items-end gap-2">
                <span className="au-target absolute inset-x-0 border-t border-dashed border-cyan-300/50" style={{ bottom: `${barHeight(13.5)}%` }} />
                {REPS.map((rep, index) => (
                  <span key={index} className="au-bar relative flex-1 rounded-t-md" style={{ height: `${barHeight(rep)}%`, "--i": index } as CSSProperties}>
                    <span className="absolute -top-4 left-1/2 -translate-x-1/2 font-mono text-[9px] text-slate-400">{rep.toFixed(1)}</span>
                  </span>
                ))}
              </div>
              <p className="mt-3 flex items-center gap-1.5 text-xs text-emerald-300"><CheckCircle2 className="h-3.5 w-3.5" />Every rep under the 13.5 s target</p>
            </div>

            <div className="au-float au-glass absolute -top-6 right-0 flex items-center gap-2.5 rounded-2xl px-4 py-3" style={{ "--d": "-2s" } as CSSProperties}>
              <span className="grid h-8 w-8 place-items-center rounded-xl bg-cyan-300/15 text-cyan-200"><CalendarCheck className="h-4 w-4" /></span>
              <span><span className="block text-xs font-semibold text-white">Swim week ready</span><span className="block text-[11px] text-slate-400">6 sessions · 21.4 km</span></span>
            </div>
            <div className="au-float au-glass absolute -bottom-14 right-4 flex items-center gap-2.5 rounded-2xl px-4 py-3" style={{ "--d": "-4s" } as CSSProperties}>
              <span className="grid h-8 w-8 place-items-center rounded-xl bg-amber-300/15 text-amber-200"><Trophy className="h-4 w-4" /></span>
              <span><span className="block text-xs font-semibold text-white">Taper starts Monday</span><span className="block text-[11px] text-slate-400">12 days to your A meet</span></span>
            </div>
          </div>

          {/* Coaches */}
          <div className="relative mt-20 flex items-center gap-4">
            <div className="flex -space-x-3">
              {COACHES.map((coach, index) => (
                <span key={coach} className="au-coach" style={{ "--i": index } as CSSProperties}>
                  <CoachAvatar name={coach} shape="circle" className="h-12 w-12 border-[3px] border-[#08131a]" />
                </span>
              ))}
            </div>
            <p className="text-sm leading-5 text-slate-300"><span className="font-semibold text-white">Five coaching systems</span><br />built from real elite programs</p>
          </div>
        </aside>

        {/* Form column */}
        <main className="mx-auto w-full max-w-[460px]">
          <div className="au-rise flex justify-center">
            {/* Logo: unchanged */}
            <Link href="/" className="mb-5 flex items-center justify-center">
              <div className="relative">
                <div className="absolute inset-0 rounded-full bg-accent/20 blur-3xl animate-pulse" />
                <div className="relative rounded-2xl bg-gradient-to-br from-accent via-accent-foreground to-primary p-6">
                  <Waves className="h-12 w-12 text-primary-foreground" />
                </div>
              </div>
            </Link>
          </div>

          {/* Mobile headline */}
          <div className="au-rise mb-6 text-center lg:hidden" style={{ "--i": 1 } as CSSProperties}>
            <h1 key={`m-${mode}`} className="au-swap text-balance text-3xl font-bold tracking-tight text-white">{copy.title}</h1>
          </div>

          <div className="au-card au-rise relative rounded-[30px] p-[1px]" style={{ "--i": 2 } as CSSProperties}>
            <div className="relative overflow-hidden rounded-[29px] bg-[linear-gradient(180deg,rgba(15,22,30,0.97),rgba(8,12,17,0.98))] p-6 sm:p-8">
              <span aria-hidden className="au-card-glow" />

              {mode === "forgot" ? (
                <>
                  <button type="button" onClick={() => switchMode("signin")}
                    className="relative inline-flex items-center gap-1.5 py-1 text-sm font-medium text-slate-400 transition-colors hover:text-white">
                    <ArrowLeft aria-hidden className="h-4 w-4" />Back to log in
                  </button>
                  <div className="relative mt-6">
                    <ResetRequest title={copy.card} description={copy.cardBody} email={email} onEmail={setEmail} next={next} autoFocus />
                  </div>
                </>
              ) : (
                <>
                  {/* Mode switch */}
                  <div role="tablist" aria-label="Account" className="relative grid grid-cols-2 rounded-2xl border border-white/[0.08] bg-black/30 p-1">
                    <span aria-hidden className={cn("au-pill absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-xl", mode === "signup" && "translate-x-full")} />
                    {(["signin", "signup"] as const).map((item) => (
                      <button key={item} type="button" role="tab" aria-selected={mode === item} onClick={() => switchMode(item)}
                        className={cn("relative z-10 rounded-xl py-2.5 text-sm font-semibold transition-colors duration-300", mode === item ? "text-slate-950" : "text-slate-400 hover:text-white")}>
                        {item === "signin" ? "Log in" : "Create account"}
                      </button>
                    ))}
                  </div>

                  <div key={`h-${mode}`} className="au-swap mt-7">
                    <h2 className="text-2xl font-bold tracking-tight text-white">{copy.card}</h2>
                    <p className="mt-1 text-sm text-slate-400">{copy.cardBody}</p>
                  </div>

                  <form onSubmit={handleSubmit} className="mt-6 space-y-4">
                    {/* Name slides in for sign-up */}
                    <div className={cn("grid transition-[grid-template-rows,opacity] duration-500 ease-out", mode === "signup" ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}
                      inert={mode !== "signup"}>
                      <div className="overflow-hidden">
                        <AuthField id="fullName" label="Full name" icon={User} type="text" autoComplete="name" value={fullName}
                          onChange={setFullName} required={mode === "signup"} />
                      </div>
                    </div>

                    <AuthField id="email" label="Email" icon={Mail} type="email" autoComplete="email" value={email} onChange={setEmail} required />

                    <div>
                      <AuthField id="password" label="Password" icon={Lock} type={showPassword ? "text" : "password"}
                        autoComplete={mode === "signup" ? "new-password" : "current-password"} value={password} onChange={setPassword} required
                        minLength={mode === "signup" ? PASSWORD_MIN_LENGTH : undefined}
                        onKey={(event) => setCapsLock(event.getModifierState?.("CapsLock") ?? false)}
                        adornment={<RevealButton shown={showPassword} onToggle={() => setShowPassword((value) => !value)} />} />
                      {(capsLock || mode === "signin") && (
                        <div className="mt-2 flex items-center justify-between gap-3">
                          {capsLock ? <p className="flex items-center gap-1.5 text-xs text-amber-300"><AlertTriangle className="h-3.5 w-3.5" />Caps Lock is on</p> : <span aria-hidden />}
                          {mode === "signin" && (
                            <button type="button" onClick={() => switchMode("forgot")}
                              className="shrink-0 text-xs font-semibold text-cyan-300/90 underline-offset-4 transition-colors hover:text-cyan-200 hover:underline">
                              Forgot password?
                            </button>
                          )}
                        </div>
                      )}
                      <PasswordStrength password={password} show={mode === "signup"} />
                    </div>

                    {authError && (
                      <FormError key={errorKey}>
                        {authError}
                        {wrongPassword && (
                          <>
                            {" "}
                            <button type="button" onClick={() => switchMode("forgot")}
                              className="font-semibold text-white underline decoration-white/40 underline-offset-2 transition-colors hover:decoration-white">
                              Reset your password
                            </button>
                          </>
                        )}
                      </FormError>
                    )}
                    {notice && (
                      <div role="status" className="au-swap flex items-start gap-2.5 rounded-2xl border border-cyan-400/30 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-100">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" />{notice}
                      </div>
                    )}

                    <AuthSubmit busy={isSubmitting} busyLabel={mode === "signup" ? "Creating your account…" : "Signing you in…"}>
                      {mode === "signup" ? (forPlan ? "Create account and continue" : "Create account") : forPlan ? "Log in and continue" : "Continue to dashboard"}
                    </AuthSubmit>
                    {mode === "signup" && (
                      <p className="text-center text-xs leading-5 text-slate-500">
                        By creating an account, you agree to our{" "}
                        <Link href="/terms" target="_blank" className="text-slate-300 underline decoration-white/20 underline-offset-2 transition-colors hover:text-white">Terms</Link>{" "}
                        and confirm you&apos;ve read our{" "}
                        <Link href="/privacy" target="_blank" className="text-slate-300 underline decoration-white/20 underline-offset-2 transition-colors hover:text-white">Privacy Policy</Link>.
                      </p>
                    )}
                  </form>

                  <p className="mt-6 text-center text-sm text-slate-400">
                    {mode === "signin" ? "New to SwimGPT? " : "Already have an account? "}
                    <button type="button" onClick={() => switchMode(mode === "signin" ? "signup" : "signin")}
                      className="font-semibold text-cyan-300 underline-offset-4 transition-colors hover:text-cyan-200 hover:underline">
                      {mode === "signin" ? "Create an account" : "Log in"}
                    </button>
                  </p>
                </>
              )}
            </div>
          </div>

          <p className="au-rise mt-6 flex items-center justify-center gap-2 text-xs text-slate-500" style={{ "--i": 3 } as CSSProperties}>
            <Lock className="h-3.5 w-3.5" />Secured by Supabase Auth
          </p>
          <LegalLinks className="au-rise mt-3" />

        </main>
      </div>
    </div>
  )
}
