"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { ArrowLeft, Lock, RotateCcw, SearchX } from "lucide-react"
import { PlanReader, ReaderLoading } from "@/components/plan-reader/plan-reader"
import type { Book } from "@/lib/plan-book"
import { PlanStoreError, SignInRequired, fetchCatalog, fetchPlanBook } from "@/lib/plan-store"
import { supabase } from "@/lib/supabase"

type State =
  | { status: "loading" }
  | { status: "ready"; book: Book; title: string; userId: string }
  | { status: "locked" | "missing" | "error"; message: string; title?: string }

/** A plan the account bought, read as a book: every page as printed, never a PDF. */
export default function ReadPlanPage() {
  const { planId } = useParams<{ planId: string }>()
  const router = useRouter()
  const [state, setState] = useState<State>({ status: "loading" })

  const load = useCallback(async () => {
    setState({ status: "loading" })
    const here = `/training-plans/read/${encodeURIComponent(planId)}`
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      router.replace(`/auth?next=${encodeURIComponent(here)}`)
      return
    }
    const catalog = fetchCatalog().catch(() => null)
    try {
      const book = await fetchPlanBook(planId)
      const plan = (await catalog)?.plans.find((item) => item.id === planId)
      setState({ status: "ready", book, title: plan?.title ?? "Your training plan", userId: session.user.id })
    } catch (error) {
      if (error instanceof SignInRequired) {
        router.replace(`/auth?next=${encodeURIComponent(here)}`)
        return
      }
      const title = (await catalog)?.plans.find((item) => item.id === planId)?.title
      const message = error instanceof Error ? error.message : "Your plan couldn't be opened."
      if (error instanceof PlanStoreError && error.status === 403) setState({ status: "locked", message, title })
      else if (error instanceof PlanStoreError && error.status === 404) setState({ status: "missing", message, title })
      else setState({ status: "error", message: message || "Your plan couldn't be opened.", title })
    }
  }, [planId, router])

  useEffect(() => { void load() }, [load])

  if (state.status === "loading") return <ReaderLoading />
  if (state.status === "ready") return <PlanReader book={state.book} title={state.title} userId={state.userId} />

  const Icon = state.status === "locked" ? Lock : state.status === "missing" ? SearchX : RotateCcw
  return (
    <div className="reader-root fixed inset-0 flex items-center justify-center px-5 text-white">
      <div aria-hidden className="reader-backdrop pointer-events-none absolute inset-0" />
      <div className="dash-reveal relative w-full max-w-md rounded-3xl border border-white/10 bg-[#0a1118]/90 p-7 text-center shadow-[0_30px_80px_rgba(0,0,0,0.55)] backdrop-blur">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-white/[0.06] text-cyan-200"><Icon className="h-5 w-5" /></span>
        <h1 className="mt-4 text-xl font-bold">
          {state.status === "locked" ? `${state.title ?? "This plan"} isn't on this account` : state.status === "missing" ? "This plan can't be opened" : "Your plan didn't open"}
        </h1>
        <p className="mt-2 text-sm leading-6 text-slate-400">
          {state.status === "locked"
            ? "Plans are saved to the account that bought them. Buy it in Training Plans, or log in with the account you used."
            : state.message}
        </p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          {state.status === "error" && (
            <button type="button" onClick={() => void load()} className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-accent px-5 text-sm font-semibold text-accent-foreground">
              <RotateCcw className="h-4 w-4" />Try again
            </button>
          )}
          <Link href={state.status === "locked" ? `/training-plans?view=${encodeURIComponent(planId)}` : "/training-plans"}
            className={state.status === "error" ? "inline-flex h-11 items-center justify-center gap-2 rounded-full border border-white/15 px-5 text-sm font-semibold text-white hover:bg-white/[0.06]" : "inline-flex h-11 items-center justify-center gap-2 rounded-full bg-accent px-5 text-sm font-semibold text-accent-foreground"}>
            <ArrowLeft className="h-4 w-4" />{state.status === "locked" ? "See it in Training Plans" : "Back to Training Plans"}
          </Link>
          {state.status === "locked" && (
            <button type="button" onClick={async () => { await supabase.auth.signOut(); router.replace(`/auth?next=${encodeURIComponent(`/training-plans/read/${encodeURIComponent(planId)}`)}`) }}
              className="inline-flex h-11 items-center justify-center rounded-full border border-white/15 px-5 text-sm font-semibold text-white hover:bg-white/[0.06]">
              Switch account
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
