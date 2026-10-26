"use client"

import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { Coins } from "lucide-react"
import { Button } from "@/components/ui/button"
import { TOKENS_NEEDED, type Shortfall } from "@/lib/token-events"

/**
 * Shown over everything (a chat, a call, a week being generated) when an AI request is refused for want of tokens
 * (lib/token-events.ts): what it needed and when the month's tokens renew, in the API's words, and the way to the token
 * store.
 */
export function TokensNeededDialog({ onGetTokens }: { onGetTokens: () => void }) {
  const [shortfall, setShortfall] = useState<Shortfall | null>(null)
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  useEffect(() => {
    const show = (event: Event) => setShortfall((event as CustomEvent<Shortfall>).detail)
    window.addEventListener(TOKENS_NEEDED, show)
    return () => window.removeEventListener(TOKENS_NEEDED, show)
  }, [])

  useEffect(() => {
    if (!shortfall) return
    // Esc closes this, not the chat or call underneath.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      event.stopPropagation()
      setShortfall(null)
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [shortfall])

  if (!mounted || !shortfall) return null
  return createPortal(
    <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/70 px-4 backdrop-blur-md" onClick={() => setShortfall(null)}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="tokens-needed-title" aria-describedby="tokens-needed-body"
        onClick={(event) => event.stopPropagation()}
        className="dash-reveal w-full max-w-md rounded-3xl border border-accent/20 bg-[linear-gradient(180deg,rgba(16,24,31,0.98),rgba(7,12,17,0.98))] p-6 shadow-[0_30px_90px_rgba(0,0,0,0.65)]">
        <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl border border-amber-200/25 bg-amber-200/10 text-amber-200">
          <Coins className="h-6 w-6" />
        </div>
        <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-accent">Tokens</p>
        <h2 id="tokens-needed-title" className="mt-2 text-2xl font-bold text-white">
          {shortfall.balance > 0 ? "Not enough tokens for this" : "You're out of tokens"}
        </h2>
        <p id="tokens-needed-body" className="mt-3 text-sm leading-6 text-slate-300">{shortfall.message}</p>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row">
          <Button variant="outline" onClick={() => setShortfall(null)} className="flex-1 rounded-full border-white/15 bg-transparent hover:bg-white/[0.06]">
            Not now
          </Button>
          <Button autoFocus onClick={() => { setShortfall(null); onGetTokens() }}
            className="flex-1 rounded-full bg-accent font-semibold text-accent-foreground hover:bg-accent/90">
            <Coins className="h-4 w-4" />Get tokens
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
