"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { TOKENS_CHANGED, TOKENS_NEEDED } from "@/lib/token-events"
import { fetchTokens, type Tokens } from "@/lib/tokens"

/**
 * The athlete's tokens for the dashboard (lib/tokens.ts), loaded once `enabled` and kept current: refreshed shortly after
 * anything that costs tokens runs (or is refused for want of them) and when the page is looked at again. Null until the
 * first answer; a failed refresh keeps what's shown.
 */
export function useTokens(enabled: boolean) {
  const [tokens, setTokens] = useState<Tokens | null>(null)
  const latest = useRef(0)

  const refresh = useCallback(async () => {
    const request = ++latest.current
    try {
      const result = await fetchTokens()
      if (request === latest.current) setTokens(result)
    } catch {
      // Kept as it was; the next refresh tries again.
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    void refresh()
    let timer: number | undefined
    // A few things can cost tokens in a row (a voice call's turns): one refresh once they've settled.
    const soon = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => void refresh(), 700)
    }
    const looked = () => { if (document.visibilityState === "visible") soon() }
    window.addEventListener(TOKENS_CHANGED, soon)
    window.addEventListener(TOKENS_NEEDED, soon)
    document.addEventListener("visibilitychange", looked)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener(TOKENS_CHANGED, soon)
      window.removeEventListener(TOKENS_NEEDED, soon)
      document.removeEventListener("visibilitychange", looked)
    }
  }, [enabled, refresh])

  return { tokens, refresh }
}
