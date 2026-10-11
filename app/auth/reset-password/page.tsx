"use client"

import { useEffect, useRef, useState, type CSSProperties } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { isAuthApiError } from "@supabase/supabase-js"
import { ArrowLeft, CheckCircle2, KeyRound, Link2Off, Loader2, Lock, ShieldCheck, Waves } from "lucide-react"
import { AuthField, AuthSubmit, FormError, MatchNote, PasswordStrength, RevealButton } from "@/components/auth/auth-field"
import { ResetRequest } from "@/components/auth/reset-request"
import { ChangePasswordDialog } from "@/components/change-password-dialog"
import { LegalLinks } from "@/components/legal/legal-links"
import { WaterBubbles } from "@/components/water-bubbles"
import { accountMessage, homePath, PASSWORD_MIN_LENGTH, safeNext } from "@/lib/account"
import { supabase } from "@/lib/supabase"

type View =
  | { kind: "checking" }
  /** Signed in by the reset link (or holding its token): choose the new password. */
  | { kind: "choose"; email: string }
  /** The link failed (expired, used, or replaced by a newer one), or the page was opened without one. */
  | { kind: "invalid"; expired: boolean }
  /** Signed in the usual way, not by a reset link: changing the password needs the current one. */
  | { kind: "signed-in"; email: string }
  | { kind: "done"; othersSignedOut: boolean }

/** How long after opening a reset link the athlete can still set a password without the old one (the link's own lifetime). */
const RESET_WINDOW_SECONDS = 60 * 60

/** Where the link in the "reset your password" email opens. */
export default function ResetPasswordPage() {
  const router = useRouter()
  const [view, setView] = useState<View>({ kind: "checking" })
  const [next, setNext] = useState<string | null>(null)
  const [requestEmail, setRequestEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [shown, setShown] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [errorKey, setErrorKey] = useState(0)
  const [changeOpen, setChangeOpen] = useState(false)
  const tokenHash = useRef<string | null>(null)

  useEffect(() => {
    let active = true
    const url = new URL(window.location.href)
    const params = new URLSearchParams(url.hash.slice(1))
    url.searchParams.forEach((value, key) => params.set(key, value))
    setNext(safeNext(params.get("next")))

    // A link that brings its token to this page (a Supabase email template using {{ .TokenHash }}) is only spent when the
    // new password is saved, so an email scanner that opens links can't use it up first.
    if (params.get("token_hash") && params.get("type") === "recovery") {
      tokenHash.current = params.get("token_hash")
      setView({ kind: "choose", email: "" })
      return
    }

    void (async () => {
      // The Supabase client reads the link (the session or the error after the #) as the page loads: wait for it.
      const { error: linkError } = await supabase.auth.initialize()
      const { data: { session } } = await supabase.auth.getSession()
      const { data: level } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
      if (!active) return
      // The tokens or the error after the # are read: keep them out of the address bar and the history.
      window.history.replaceState(window.history.state, "", url.pathname + url.search)
      setRequestEmail(session?.user.email ?? "")
      if (linkError || params.get("error") || params.get("error_code") || params.get("error_description")) {
        setView({ kind: "invalid", expired: true })
        return
      }
      if (!session) {
        setView({ kind: "invalid", expired: false })
        return
      }
      // A reset link signs in with a one-time code ("otp"); a normal log-in with the password.
      const now = Date.now() / 1000
      const byResetLink = (level?.currentAuthenticationMethods ?? []).some((entry) => typeof entry === "string"
        ? entry === "otp" || entry === "recovery"
        : (entry.method === "otp" || entry.method === "recovery") && now - entry.timestamp < RESET_WINDOW_SECONDS)
      setView(byResetLink ? { kind: "choose", email: session.user.email ?? "" } : { kind: "signed-in", email: session.user.email ?? "" })
    })()
    return () => { active = false }
  }, [])

  const fail = (message: string) => {
    setError(message)
    setErrorKey((key) => key + 1)
  }

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (password.length < PASSWORD_MIN_LENGTH) return fail(`Your new password needs at least ${PASSWORD_MIN_LENGTH} characters.`)
    if (password !== confirm) return fail("The two passwords don't match.")
    setBusy(true)
    setError("")
    try {
      if (tokenHash.current) {
        const { error: tokenError } = await supabase.auth.verifyOtp({ token_hash: tokenHash.current, type: "recovery" })
        if (tokenError) {
          if (isAuthApiError(tokenError)) setView({ kind: "invalid", expired: true })
          else fail(accountMessage(tokenError))
          return
        }
        tokenHash.current = null
        // Spent: keep it out of the address bar and the history.
        const url = new URL(window.location.href)
        url.searchParams.delete("token_hash")
        url.searchParams.delete("type")
        window.history.replaceState(window.history.state, "", url.pathname + url.search)
      }
      const { error: saveError } = await supabase.auth.updateUser({ password })
      if (saveError) {
        if (saveError.name === "AuthSessionMissingError") setView({ kind: "invalid", expired: true })
        else fail(accountMessage(saveError))
        return
      }
      // Whoever else might be signed in to the account is signed out (the reason for a reset is often a lost password).
      const { error: othersError } = await supabase.auth.signOut({ scope: "others" })
      setView({ kind: "done", othersSignedOut: !othersError })
    } catch (caught) {
      fail(accountMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  const goOn = async () => {
    setBusy(true)
    if (next) {
      router.replace(next)
      return
    }
    try {
      const { data: { session } } = await supabase.auth.getSession()
      router.replace(session ? await homePath(session.access_token) : "/auth")
    } catch {
      router.replace("/auth") // The log-in page sends signed-in athletes on to wherever they belong.
    }
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    for (const key of ["swimgpt_user_key", "swimgpt_onboarding", "swimgpt_coaches"]) localStorage.removeItem(key)
    setRequestEmail("")
    setView({ kind: "invalid", expired: false })
  }

  return (
    <div className="au-page relative min-h-screen overflow-hidden text-foreground">
      <div aria-hidden className="pointer-events-none fixed inset-0">
        <span className="au-blob au-blob-a" />
        <span className="au-blob au-blob-b" />
        <span className="au-blob au-blob-c" />
        <span className="au-rays absolute inset-0" />
        <span className="au-grid absolute inset-0" />
        <div className="absolute inset-0 opacity-50"><WaterBubbles /></div>
      </div>

      <main className="relative z-10 mx-auto flex min-h-screen w-full max-w-[460px] flex-col justify-center px-4 py-8">
        <div className="au-rise flex justify-center">
          <Link href="/" aria-label="SwimGPT home" className="mb-5 flex items-center justify-center">
            <div className="relative">
              <div className="absolute inset-0 rounded-full bg-accent/20 blur-3xl animate-pulse" />
              <div className="relative rounded-2xl bg-gradient-to-br from-accent via-accent-foreground to-primary p-5">
                <Waves className="h-10 w-10 text-primary-foreground" />
              </div>
            </div>
          </Link>
        </div>

        <div className="au-card au-rise relative rounded-[30px] p-[1px]" style={{ "--i": 1 } as CSSProperties}>
          <div className="relative overflow-hidden rounded-[29px] bg-[linear-gradient(180deg,rgba(15,22,30,0.97),rgba(8,12,17,0.98))] p-6 sm:p-8">
            <span aria-hidden className="au-card-glow" />
            <div className="relative">
              {view.kind === "checking" && (
                <div role="status" className="flex flex-col items-center py-12 text-center">
                  <Loader2 aria-hidden className="h-6 w-6 animate-spin text-cyan-300" />
                  <p className="mt-3 text-sm text-slate-400">Checking your reset link…</p>
                </div>
              )}

              {view.kind === "choose" && (
                <div key="choose" className="au-swap">
                  <span className="pw-badge"><KeyRound aria-hidden className="pw-fly h-7 w-7" /></span>
                  <h1 className="mt-5 text-2xl font-bold tracking-tight text-white">Choose a new password</h1>
                  <p className="mt-1 text-sm leading-6 text-slate-400">
                    {view.email && <>For <span className="font-semibold [overflow-wrap:anywhere] text-slate-200">{view.email}</span>. </>}
                    Pick one you don&apos;t use anywhere else.
                  </p>
                  <form onSubmit={save} className="mt-6 space-y-4">
                    {/* Lets password managers save the new password to the right account. */}
                    <input type="email" name="username" autoComplete="username" value={view.email} readOnly hidden />
                    <div>
                      <AuthField id="rp-new" label="New password" icon={Lock} type={shown ? "text" : "password"} autoComplete="new-password"
                        value={password} onChange={setPassword} required minLength={PASSWORD_MIN_LENGTH} autoFocus
                        adornment={<RevealButton shown={shown} onToggle={() => setShown((value) => !value)} />} />
                      <PasswordStrength password={password} />
                    </div>
                    <div>
                      <AuthField id="rp-confirm" label="Confirm new password" icon={Lock} type={shown ? "text" : "password"} autoComplete="new-password"
                        value={confirm} onChange={setConfirm} required invalid={Boolean(confirm) && confirm.length >= password.length && confirm !== password} />
                      <MatchNote password={password} confirm={confirm} />
                    </div>
                    {error && <FormError key={errorKey}>{error}</FormError>}
                    <AuthSubmit busy={busy} busyLabel="Saving your new password…">Save new password</AuthSubmit>
                  </form>
                </div>
              )}

              {view.kind === "invalid" && (
                <div key="invalid">
                  <ResetRequest email={requestEmail} onEmail={setRequestEmail} next={next} heading="h1"
                    badge={<span className="pw-badge pw-badge-warn"><Link2Off aria-hidden className="pw-fly h-7 w-7" /></span>}
                    title={view.expired ? "This link has expired" : "Open the link from your email"}
                    description={view.expired
                      ? "Reset links work once, for a limited time, and only the newest one you asked for. Enter your email and we'll send you a fresh one."
                      : "To choose a new password, open the reset link we emailed you. Need one? Enter your email and we'll send it."} />
                  <Link href="/auth" className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-slate-400 transition-colors hover:text-white">
                    <ArrowLeft aria-hidden className="h-4 w-4" />Back to log in
                  </Link>
                </div>
              )}

              {view.kind === "signed-in" && (
                <div key="signed-in" className="au-swap">
                  <span className="pw-badge"><ShieldCheck aria-hidden className="pw-fly h-7 w-7" /></span>
                  <h1 className="mt-5 text-2xl font-bold tracking-tight text-white">You&apos;re signed in</h1>
                  <p className="mt-1 text-sm leading-6 text-slate-400">
                    As <span className="font-semibold [overflow-wrap:anywhere] text-slate-200">{view.email}</span>. To change your password while signed in,
                    you&apos;ll confirm your current one first.
                  </p>
                  <div className="mt-6 space-y-3">
                    <AuthSubmit type="button" busy={false} busyLabel="" onClick={() => setChangeOpen(true)}>Change password</AuthSubmit>
                    <button type="button" onClick={() => void goOn()} disabled={busy}
                      className="flex h-12 w-full items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] text-sm font-semibold text-white transition-colors hover:border-white/20 hover:bg-white/[0.06] disabled:cursor-progress">
                      {busy ? <><Loader2 aria-hidden className="mr-2 h-4 w-4 animate-spin" />Opening SwimGPT…</> : "Go to SwimGPT"}
                    </button>
                  </div>
                  <p className="mt-5 text-center text-sm text-slate-400">
                    Not you?{" "}
                    <button type="button" onClick={() => void signOut()} className="font-semibold text-cyan-300 underline-offset-4 transition-colors hover:text-cyan-200 hover:underline">
                      Sign out
                    </button>
                  </p>
                  <ChangePasswordDialog open={changeOpen} onOpenChange={setChangeOpen} />
                </div>
              )}

              {view.kind === "done" && (
                <div key="done" className="au-swap text-center" role="status">
                  <span className="pw-badge pw-badge-ok mx-auto"><CheckCircle2 aria-hidden className="check-pop h-7 w-7" /></span>
                  <h1 className="mt-5 text-2xl font-bold tracking-tight text-white">Password updated</h1>
                  <p className="mt-2 text-sm leading-6 text-slate-400">
                    You&apos;re signed in with your new password.{view.othersSignedOut && " For your security, we've signed you out on your other devices."}
                  </p>
                  <div className="mt-6">
                    <AuthSubmit type="button" busy={busy} busyLabel="Opening SwimGPT…" onClick={() => void goOn()}>Continue to SwimGPT</AuthSubmit>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <p className="au-rise mt-6 flex items-center justify-center gap-2 text-xs text-slate-500" style={{ "--i": 2 } as CSSProperties}>
          <Lock className="h-3.5 w-3.5" />Secured by Supabase Auth
        </p>
        <LegalLinks className="au-rise mt-3" />
      </main>
    </div>
  )
}
