"use client"

import { useEffect, useState } from "react"
import { AlertTriangle, CalendarCheck, CalendarX, CheckCircle2, Loader2, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { supabase } from "@/lib/supabase"
import { cn } from "@/lib/utils"

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"

// GET /api/subscription/billing, POST /api/subscription/cancel and /resume (backend/app/payments.py subscription_summary).
type Billing = {
  manageable: boolean
  status?: string
  cancel_at_period_end?: boolean
  period_end?: string | null
  plan_name?: string
  amount?: number
  currency?: string
  interval?: string
}

async function billingRequest(method: "GET" | "POST", path: string): Promise<Billing> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error("Your session has expired. Sign in again to manage your subscription.")
  const response = await fetch(`${API_URL}${path}`, { method, headers: { Authorization: `Bearer ${session.access_token}` } })
  if (!response.ok) {
    let detail = "Your subscription couldn't be loaded. Please try again."
    try {
      const body = await response.json()
      if (typeof body.detail === "string") detail = body.detail
    } catch { /* keep the generic message */ }
    throw new Error(detail)
  }
  return response.json()
}

const longDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }) : "the end of your billing month"

/**
 * The athlete's monthly subscription. Cancelling stops renewal only: no refund, and the dashboard stays open until the
 * month they paid for ends. Until then they can change their mind and keep the subscription.
 */
export function SubscriptionDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [billing, setBilling] = useState<Billing | null>(null)
  const [error, setError] = useState("")
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState<"cancel" | "resume" | null>(null)
  const [justChanged, setJustChanged] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!open) return
    let current = true
    setBilling(null)
    setError("")
    setConfirming(false)
    setJustChanged(false)
    billingRequest("GET", "/api/subscription/billing")
      .then((result) => { if (current) setBilling(result) })
      .catch((failure: Error) => { if (current) setError(failure.message) })
    return () => { current = false }
  }, [open, attempt])

  const change = async (action: "cancel" | "resume") => {
    setBusy(action)
    setError("")
    try {
      setBilling(await billingRequest("POST", `/api/subscription/${action}`))
      setConfirming(false)
      setJustChanged(true)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "That didn't go through. Please try again.")
    } finally {
      setBusy(null)
    }
  }

  const price = billing?.amount != null && billing.currency
    ? new Intl.NumberFormat("en-US", { style: "currency", currency: billing.currency.toUpperCase() }).format(billing.amount / 100)
    : null
  const endDate = longDate(billing?.period_end)
  const ending = Boolean(billing?.cancel_at_period_end)

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next) }}>
      <DialogContent className="border-white/10 bg-[#0d151c] sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white">Subscription</DialogTitle>
          <DialogDescription className="text-slate-400">Your SwimGPT coaching plan and billing.</DialogDescription>
        </DialogHeader>

        {error && (
          <div role="alert" className="flex items-start gap-2.5 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" />
            <span className="flex-1">{error}</span>
            {!billing && (
              <button type="button" onClick={() => setAttempt((count) => count + 1)} className="shrink-0 font-semibold text-rose-200 underline-offset-4 hover:underline">
                Retry
              </button>
            )}
          </div>
        )}

        {!billing && !error && (
          <div className="space-y-3" aria-busy="true" aria-label="Loading your subscription">
            <div className="h-24 animate-pulse rounded-2xl bg-white/[0.05]" />
            <div className="h-10 animate-pulse rounded-full bg-white/[0.04]" />
          </div>
        )}

        {billing && !billing.manageable && (
          <p className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm leading-6 text-slate-300">
            There&apos;s no active subscription on this account to change here.
          </p>
        )}

        {billing?.manageable && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-white/10 bg-[linear-gradient(150deg,rgba(87,229,234,0.10),rgba(255,255,255,0.02))] p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-white">{billing.plan_name}</p>
                  {price && <p className="mt-0.5 text-sm text-slate-300">{price} / {billing.interval ?? "month"}</p>}
                </div>
                <span className={cn("shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold",
                  ending ? "border-amber-300/30 bg-amber-300/10 text-amber-200" : "border-emerald-300/30 bg-emerald-300/10 text-emerald-200")}>
                  {ending ? "Ending" : billing.status === "past_due" ? "Payment retrying" : "Active"}
                </span>
              </div>
              <p className="mt-3 flex items-center gap-2 border-t border-white/[0.07] pt-3 text-sm text-slate-300">
                {ending ? <CalendarX className="h-4 w-4 shrink-0 text-amber-300" /> : <CalendarCheck className="h-4 w-4 shrink-0 text-cyan-300" />}
                {ending ? <>Access ends on <span className="font-semibold text-white">{endDate}</span></> : <>Renews on <span className="font-semibold text-white">{endDate}</span></>}
              </p>
            </div>

            {ending ? (
              <>
                <div className={cn("flex items-start gap-2.5 rounded-2xl border border-amber-300/25 bg-amber-300/[0.07] px-4 py-3 text-sm leading-6 text-amber-50", justChanged && "chat-enter")}>
                  {justChanged ? <CheckCircle2 className="check-pop mt-1 h-4 w-4 shrink-0 text-amber-300" /> : <CalendarX className="mt-1 h-4 w-4 shrink-0 text-amber-300" />}
                  <span>
                    Your subscription is cancelled.{" "}
                    You won&apos;t be charged again, and you keep full access until {endDate}.
                  </span>
                </div>
                <Button onClick={() => change("resume")} disabled={busy !== null}
                  className="h-11 w-full rounded-full bg-accent font-semibold text-accent-foreground hover:bg-accent/90">
                  {busy === "resume" ? <><Loader2 className="h-4 w-4 animate-spin" />Keeping your subscription…</> : <><RefreshCw className="h-4 w-4" />Keep my subscription</>}
                </Button>
              </>
            ) : confirming ? (
              <div className="chat-enter space-y-4 rounded-2xl border border-rose-400/25 bg-rose-500/[0.06] p-4">
                <div>
                  <p className="font-semibold text-white">Cancel your subscription?</p>
                  <ul className="mt-2 space-y-1.5 text-sm leading-6 text-slate-300">
                    <li>You won&apos;t be charged again.</li>
                    <li>You keep full access until <span className="font-semibold text-white">{endDate}</span>, the end of the month you&apos;ve paid for.</li>
                    <li>Payments already made aren&apos;t refunded.</li>
                  </ul>
                </div>
                <div className="flex flex-col-reverse gap-2 sm:flex-row">
                  <Button variant="outline" onClick={() => setConfirming(false)} disabled={busy !== null}
                    className="flex-1 rounded-full border-white/15 bg-transparent hover:bg-white/[0.06]">
                    Go back
                  </Button>
                  <Button onClick={() => change("cancel")} disabled={busy !== null}
                    className="flex-1 rounded-full bg-rose-500 font-semibold text-white hover:bg-rose-500/90">
                    {busy === "cancel" ? <><Loader2 className="h-4 w-4 animate-spin" />Cancelling…</> : "Yes, cancel"}
                  </Button>
                </div>
              </div>
            ) : (
              <>
                {justChanged && (
                  <p className="chat-enter flex items-center gap-2 text-sm text-emerald-200">
                    <CheckCircle2 className="check-pop h-4 w-4 text-emerald-300" />Your subscription will renew as normal.
                  </p>
                )}
                <Button variant="outline" onClick={() => setConfirming(true)}
                  className="h-11 w-full rounded-full border-rose-400/30 bg-transparent text-rose-200 hover:border-rose-400/50 hover:bg-rose-500/10 hover:text-rose-100">
                  Cancel subscription
                </Button>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
