"use client"

import { Suspense, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { CheckCircle2, Loader2, Waves, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"

export default function PaymentSuccessPage() {
  return (
    <Suspense fallback={
      <main className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <div role="status" className="flex items-center gap-3">
          <Loader2 aria-hidden className="h-5 w-5 animate-spin text-cyan-300" />
          <span>Loading payment confirmation...</span>
        </div>
      </main>
    }>
      <PaymentSuccessContent />
    </Suspense>
  )
}

function PaymentSuccessContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [status, setStatus] = useState<"checking" | "success" | "error">("checking")
  const [message, setMessage] = useState("Confirming your payment with Stripe...")

  useEffect(() => {
    const sessionId = searchParams.get("session_id")
    if (!sessionId) {
      setStatus("error")
      setMessage("No Stripe checkout session was provided.")
      return
    }

    const verifyPayment = async () => {
      try {
        const response = await fetch(`${API_URL}/api/payments/verify/${encodeURIComponent(sessionId)}`)
        if (!response.ok) throw new Error(await response.text())

        const result = await response.json()
        if (!result.paid || !result.user_key) {
          throw new Error("This payment has not been confirmed yet.")
        }

        localStorage.setItem("swimgpt_user_key", result.user_key)
        if (result.plan_id) localStorage.setItem("swimgpt_payment_plan", result.plan_id)
        localStorage.removeItem("swimgpt_pending_payment")
        setStatus("success")
        setMessage("Your personalized coaching system is now active.")
        window.setTimeout(() => router.replace("/dashboard"), 1600)
      } catch (error: any) {
        setStatus("error")
        setMessage(error?.message || "We could not verify your payment.")
      }
    }

    verifyPayment()
  }, [router, searchParams])

  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,_rgba(87,229,234,0.14),_rgba(9,12,18,0.92)_25%,_rgba(4,7,11,1)_64%)] px-4 text-foreground">
      <div className="w-full max-w-lg rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(16,20,26,0.98),rgba(9,12,16,0.96))] p-8 text-center shadow-[0_30px_90px_rgba(8,12,18,0.65)]">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-accent via-accent-foreground to-primary text-primary-foreground shadow-[0_0_28px_rgba(87,229,234,0.28)]">
          <Waves className="h-8 w-8" />
        </div>
        {status === "checking" && <Loader2 className="mx-auto mb-4 h-8 w-8 animate-spin text-cyan-300" />}
        {status === "success" && <CheckCircle2 className="mx-auto mb-4 h-8 w-8 text-emerald-300" />}
        {status === "error" && <XCircle className="mx-auto mb-4 h-8 w-8 text-red-300" />}
        <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-cyan-300">{status === "success" ? "Payment confirmed" : "Secure checkout"}</p>
        <h1 className="mt-3 text-3xl font-bold text-white">{status === "success" ? "Welcome to your training hub." : status === "error" ? "Payment needs attention." : "Activating your program..."}</h1>
        <p className="mt-3 text-sm leading-6 text-slate-300">{message}</p>
        {status === "error" && (
          <div className="mt-6 flex gap-3">
            <Button variant="outline" onClick={() => router.replace("/onboarding")} className="flex-1 border-white/10 bg-white/[0.03]">Back to onboarding</Button>
            <Button onClick={() => router.replace("/auth")} className="flex-1 bg-accent text-accent-foreground">Sign in</Button>
          </div>
        )}
      </div>
    </main>
  )
}
