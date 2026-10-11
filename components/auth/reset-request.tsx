"use client"

import { useEffect, useState, type ReactNode } from "react"
import { Mail, MailCheck, RotateCw } from "lucide-react"
import { AuthField, AuthSubmit, FormError } from "@/components/auth/auth-field"
import { accountMessage, RESEND_AFTER_SECONDS, secondsToWait, sendPasswordReset } from "@/lib/account"
import { cn } from "@/lib/utils"

/**
 * "Forgot password": asks for the account's email and sends it a reset link, then says to check the inbox, with a resend
 * once Supabase allows the next email. It reads the same whether or not the email has an account.
 */
export function ResetRequest({ email, onEmail, next, title, description, badge, heading: Heading = "h2", autoFocus = false }: {
  email: string
  onEmail: (email: string) => void
  /** Where the athlete goes once the new password is saved, instead of their dashboard. */
  next?: string | null
  title: ReactNode
  description: ReactNode
  /** Shown above the title until the email is sent. */
  badge?: ReactNode
  heading?: "h1" | "h2"
  autoFocus?: boolean
}) {
  const [sentTo, setSentTo] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [errorKey, setErrorKey] = useState(0)
  const [wait, setWait] = useState(0)

  useEffect(() => {
    if (wait <= 0) return
    const timer = window.setTimeout(() => setWait((seconds) => seconds - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [wait])

  const send = async (address: string) => {
    setBusy(true)
    setError("")
    try {
      await sendPasswordReset(address, next)
      setSentTo(address.trim())
      setWait(RESEND_AFTER_SECONDS)
    } catch (caught) {
      setWait(secondsToWait(caught) ?? 0)
      setError(accountMessage(caught, "We couldn't send the email just now. Please try again in a few minutes."))
      setErrorKey((key) => key + 1)
    } finally {
      setBusy(false)
    }
  }

  if (sentTo) {
    return (
      <div className="au-swap text-center" role="status">
        <span className="pw-badge mx-auto"><MailCheck aria-hidden className="pw-fly h-7 w-7" /></span>
        <Heading className="mt-5 text-2xl font-bold tracking-tight text-white">Check your inbox</Heading>
        <p className="mt-2 text-sm leading-6 text-slate-400">
          If there&apos;s a SwimGPT account for <span className="font-semibold [overflow-wrap:anywhere] text-slate-200">{sentTo}</span>,
          we&apos;ve emailed it a link to choose a new password.
        </p>
        <ul className="mt-5 space-y-2 rounded-2xl border border-white/[0.08] bg-white/[0.02] px-4 py-3.5 text-left text-[13px] leading-5 text-slate-400">
          <li className="flex gap-2.5"><span aria-hidden className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-cyan-300" />It can take a minute to arrive. Check your spam or junk folder too.</li>
          <li className="flex gap-2.5"><span aria-hidden className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-cyan-300" />The link works once. If you ask for another email, only the newest link works.</li>
        </ul>
        {error && <div className="mt-4 text-left"><FormError key={errorKey}>{error}</FormError></div>}
        <div className="mt-6 flex flex-col items-center gap-3">
          <button type="button" onClick={() => void send(sentTo)} disabled={busy || wait > 0}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-white/12 bg-white/[0.04] px-5 text-sm font-semibold text-white transition-colors enabled:hover:border-cyan-300/40 enabled:hover:bg-cyan-300/[0.08] disabled:cursor-not-allowed disabled:text-slate-400">
            <RotateCw aria-hidden className={cn("h-4 w-4", busy && "animate-spin")} />
            <span>{busy ? "Sending…" : wait > 0 ? <>Resend in <span className="tabular-nums">{wait}s</span></> : "Resend the email"}</span>
          </button>
          <button type="button" onClick={() => { setSentTo(""); setError(""); setWait(0) }}
            className="text-sm text-slate-400 underline-offset-4 transition-colors hover:text-white hover:underline">
            Use a different email
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="au-swap">
      {badge && <div className="mb-5">{badge}</div>}
      <Heading className="text-2xl font-bold tracking-tight text-white">{title}</Heading>
      <p className="mt-1 text-sm leading-6 text-slate-400">{description}</p>
      <form onSubmit={(event) => { event.preventDefault(); void send(email) }} className="mt-6 space-y-4">
        <AuthField id="reset-email" label="Email" icon={Mail} type="email" autoComplete="email" value={email} onChange={onEmail} required autoFocus={autoFocus} />
        {error && <FormError key={errorKey}>{error}</FormError>}
        <AuthSubmit busy={busy} busyLabel="Sending your link…" disabled={wait > 0}>
          {wait > 0 ? <>Try again in <span className="ml-1 tabular-nums">{wait}s</span></> : "Send reset link"}
        </AuthSubmit>
      </form>
    </div>
  )
}
