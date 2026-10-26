"use client"

import { useEffect, useId, useRef, useState, type CSSProperties } from "react"
import {
  ArrowDown, AudioLines, CalendarClock, Check, ChevronRight, Coins, CreditCard, Dumbbell, Flag, Gift, History, Info,
  Loader2, MessageCircle, RefreshCw, ShieldCheck, Sparkles, Undo2, Video, Wand2, Waves, Zap, type LucideIcon,
} from "lucide-react"
import { Reveal, Tile, TileHeader, useTween } from "@/components/dashboard-ui"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Banner, EmptyState } from "@/components/training-ui"
import { StartNowConsent } from "@/components/legal/start-now-consent"
import { formatPrice } from "@/lib/plan-store"
import { buyTokens, shortDay, tokenCount, type TokenBalance, type TokenPack, type Tokens } from "@/lib/tokens"
import { cn } from "@/lib/utils"

/** What happened at checkout, shown at the top of the store when Stripe sends the athlete back. */
export type StoreNotice = { tone: "success" | "error" | "busy" | "note"; text: string } | null

type Spend = TokenBalance["recent"][number]

// Each AI feature: what it is, said as something the athlete does; what several are called; its icon and colour.
const FEATURES: Record<string, { does: string; many: string; icon: LucideIcon; color: string }> = {
  coach_chat: { does: "A message to your coach", many: "coach messages", icon: MessageCircle, color: "#57e5ea" },
  voice_reply: { does: "Each reply on a voice call", many: "call replies", icon: AudioLines, color: "#a78bfa" },
  swim_week: { does: "Generating a swim week", many: "swim weeks", icon: Waves, color: "#38bdf8" },
  swim_replan: { does: "Re-planning a swim week", many: "re-plans", icon: RefreshCw, color: "#2dd4bf" },
  gym_week: { does: "Planning a gym week", many: "gym weeks", icon: Dumbbell, color: "#fb923c" },
  week_coach: { does: "A message to the week re-planner", many: "re-planner messages", icon: Wand2, color: "#e879f9" },
  race_plan: { does: "Race plans for a meet", many: "race plans", icon: Flag, color: "#fb7185" },
  video_analysis: { does: "A video analysis", many: "video analyses", icon: Video, color: "#34d399" },
  daily_plan: { does: "Today's plan", many: "daily plans", icon: CalendarClock, color: "#fcd34d" },
}
const OTHER = { does: "An AI feature", many: "AI requests", icon: Sparkles, color: "#94a3b8" }
const featureOf = (action: string | null) => (action && FEATURES[action]) || OTHER
// What the wallet says the balance is enough for.
const EXAMPLES = ["coach_chat", "swim_week", "video_analysis"]
// History rows shown on the tile; "Show all" opens every one in a window of its own.
const FIRST_ROWS = 8
const DAY = 86_400_000

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)
const share = (part: number, whole: number) => (whole > 0 ? Math.min(1, Math.max(0, part / whole)) : 0)
const calm = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
const svgId = (id: string) => id.replace(/[^a-zA-Z0-9]/g, "")

/** False until just after the first paint, so whatever is drawn from it eases in. */
function useDrawn() {
  const [drawn, setDrawn] = useState(false)
  useEffect(() => {
    let frame = requestAnimationFrame(() => { frame = requestAnimationFrame(() => setDrawn(true)) })
    return () => cancelAnimationFrame(frame)
  }, [])
  return drawn
}

/**
 * The dashboard's token store (lib/tokens.ts): the athlete's wallet (a month's tokens, renewed every month and never
 * carried over, and any bought, which last two months), packs to top up with, what each AI feature costs, and where
 * their latest tokens went.
 */
export function TokenStore({ tokens, notice }: { tokens: Tokens | null; notice: StoreNotice }) {
  const topUp = useRef<HTMLDivElement>(null)
  return (
    <div className="space-y-6">
      {notice && <StoreBanner notice={notice} />}
      {tokens === null ? (
        <Loading />
      ) : !tokens.available ? (
        <EmptyState icon={Coins} title="The token store isn't open yet" body="Every AI feature is included in your subscription for now." />
      ) : (
        <>
          <Wallet tokens={tokens} onTopUp={() => topUp.current?.scrollIntoView({ behavior: calm() ? "auto" : "smooth", block: "start" })} />
          <div ref={topUp} className="scroll-mt-24"><TopUp tokens={tokens} /></div>
          <div className="grid gap-6 lg:grid-cols-2">
            <Reveal index={4} className="h-full"><Costs tokens={tokens} /></Reveal>
            <Reveal index={5} className="h-full"><Activity tokens={tokens} /></Reveal>
          </div>
        </>
      )}
    </div>
  )
}

function Loading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading your tokens">
      <div className="store-shimmer h-[340px] rounded-[30px]" />
      <div className="grid gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((key) => <div key={key} className="store-shimmer h-24 rounded-[24px] sm:h-64" />)}
      </div>
    </div>
  )
}

function StoreBanner({ notice }: { notice: NonNullable<StoreNotice> }) {
  if (notice.tone === "success") return <Celebration text={notice.text} />
  if (notice.tone !== "note") return <Banner tone={notice.tone}>{notice.text}</Banner>
  return (
    <div role="status" className="dash-reveal flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-slate-200">
      <Info className="h-4 w-4 shrink-0 text-slate-400" />
      <span className="leading-6">{notice.text}</span>
    </div>
  )
}

const CONFETTI = ["#57e5ea", "#fcd34d", "#a78bfa", "#34d399", "#f9a8d4", "#ffffff"]

/** Tokens just bought: a coin pops in, and confetti falls for a moment. */
function Celebration({ text }: { text: string }) {
  const [falling, setFalling] = useState(true)
  useEffect(() => {
    const timer = window.setTimeout(() => setFalling(false), 4500)
    return () => window.clearTimeout(timer)
  }, [])
  return (
    <div role="status" className="store-glint dash-reveal relative overflow-hidden rounded-2xl border border-emerald-300/25 bg-[linear-gradient(120deg,rgba(16,70,52,0.55),rgba(8,20,26,0.92)_70%)] px-4 py-3.5 shadow-[0_18px_40px_rgba(16,185,129,0.12)]"
      style={{ "--glint-delay": "0.5s" } as CSSProperties}>
      {falling && (
        <div aria-hidden className="pointer-events-none fixed inset-0 z-[60] overflow-hidden">
          {Array.from({ length: 40 }, (_, index) => (
            <span key={index} className="store-confetti" style={{
              "--x": `${(index * 61) % 100}%`, "--d": `${(index % 8) * 0.12}s`, "--t": `${2.6 + (index % 5) * 0.35}s`,
              "--drift": `${((index * 37) % 120) - 60}px`, "--spin": `${360 + (index % 4) * 180}deg`, background: CONFETTI[index % CONFETTI.length],
            } as CSSProperties} />
          ))}
        </div>
      )}
      <div className="relative flex items-center gap-3">
        <Coin size={38} className="token-pop shrink-0" />
        <p className="font-semibold leading-6 text-emerald-50">{text}</p>
      </div>
    </div>
  )
}

/** A SwimGPT token: a gold coin with the waves on it. */
function Coin({ size = 32, className, style }: { size?: number; className?: string; style?: CSSProperties }) {
  const id = `coin${svgId(useId())}`
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={className} style={style} aria-hidden>
      <defs>
        <linearGradient id={`${id}-rim`} x1="0.15" y1="0" x2="0.85" y2="1">
          <stop offset="0" stopColor="#fff1b8" />
          <stop offset="0.5" stopColor="#f5b83d" />
          <stop offset="1" stopColor="#8a5a12" />
        </linearGradient>
        <radialGradient id={`${id}-face`} cx="0.36" cy="0.3" r="0.85">
          <stop offset="0" stopColor="#fff6cf" />
          <stop offset="0.42" stopColor="#fcd34d" />
          <stop offset="1" stopColor="#c27c0e" />
        </radialGradient>
      </defs>
      <circle cx="32" cy="32" r="31" fill={`url(#${id}-rim)`} />
      <circle cx="32" cy="32" r="25.5" fill={`url(#${id}-face)`} stroke="#9a6412" strokeOpacity="0.45" />
      <circle cx="32" cy="32" r="21.5" fill="none" stroke="#9a6412" strokeOpacity="0.35" strokeWidth="1.2" strokeDasharray="1.5 2.6" />
      <g fill="none" stroke="#7a4a0c" strokeOpacity="0.8" strokeWidth="2.8" strokeLinecap="round">
        <path d="M19.5 28.5q3.125-3.4 6.25 0t6.25 0 6.25 0 6.25 0" />
        <path d="M19.5 36.5q3.125-3.4 6.25 0t6.25 0 6.25 0 6.25 0" />
      </g>
      <path d="M13.5 23a20 20 0 0 1 13-10.5" fill="none" stroke="#fff" strokeOpacity="0.6" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  )
}

// Coins drifting up behind the wallet: where each starts, its size, how long it takes, and how it sways and turns.
const FLOATERS = [
  { x: "5%", size: 18, t: "13s", d: "0s", dx: "22px", r: "160deg", o: 0.32 },
  { x: "21%", size: 11, t: "11s", d: "-4s", dx: "-14px", r: "-120deg", o: 0.22 },
  { x: "47%", size: 15, t: "15s", d: "-8s", dx: "18px", r: "200deg", o: 0.26 },
  { x: "64%", size: 21, t: "12s", d: "-2s", dx: "-22px", r: "140deg", o: 0.28 },
  { x: "82%", size: 13, t: "14s", d: "-10s", dx: "12px", r: "-180deg", o: 0.24 },
  { x: "93%", size: 10, t: "10s", d: "-6s", dx: "-10px", r: "120deg", o: 0.2 },
]

function FloatingCoins() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {FLOATERS.map((coin, index) => (
        <span key={index} className={cn("token-float", index % 2 === 1 && "hidden sm:block")}
          style={{ "--x": coin.x, "--t": coin.t, "--d": coin.d, "--dx": coin.dx, "--r": coin.r, "--o": coin.o } as CSSProperties}>
          <Coin size={coin.size} />
        </span>
      ))}
    </div>
  )
}

/** The athlete's tokens: rings round their balance, this month's and bought ones, and what the balance is enough for. */
function Wallet({ tokens, onTopUp }: { tokens: TokenBalance; onTopUp: () => void }) {
  const id = useId()
  const { monthly } = tokens
  const bought = sum(tokens.bought.map((lot) => lot.remaining))
  const week = tokens.costs.find((cost) => cost.action === "swim_week")?.tokens ?? 10
  const state = tokens.balance <= 0 ? "out" : tokens.balance < week ? "low" : "ok"
  const fresh = monthly.renews_at ? `, or wait for ${tokenCount(monthly.tokens)} on ${shortDay(monthly.renews_at)}` : ""
  return (
    <section aria-labelledby={`${id}-title`} className="dash-reveal relative overflow-hidden rounded-[30px] border border-white/[0.08] bg-[linear-gradient(135deg,#0b1720,#070c12_55%,#0d1220)] p-5 shadow-[0_24px_60px_rgba(0,0,0,0.35)] sm:p-8">
      <div aria-hidden className="pointer-events-none absolute -left-28 top-1/2 h-96 w-96 -translate-y-1/2 rounded-full bg-accent/[0.14] blur-[110px]" />
      <div aria-hidden className="pointer-events-none absolute -right-24 -top-28 h-80 w-80 rounded-full bg-amber-300/[0.09] blur-[100px]" />
      <FloatingCoins />
      <div className="relative grid items-center gap-8 md:grid-cols-[minmax(0,250px)_minmax(0,1fr)] lg:gap-12">
        <Gauge tokens={tokens} />
        <div className="min-w-0">
          <p className={cn("inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-[0.2em]",
            state === "ok" ? "border-accent/25 bg-accent/10 text-accent" : "border-amber-300/30 bg-amber-300/10 text-amber-200")}>
            <Sparkles className="h-3.5 w-3.5" />{state === "ok" ? "Your wallet" : state === "low" ? "Running low" : "Out of tokens"}
          </p>
          <h2 id={`${id}-title`} className="mt-3 text-2xl font-bold tracking-tight text-white sm:text-3xl">
            {state === "ok" ? "You're all set" : state === "low" ? `Only ${tokenCount(tokens.balance)} left` : "Top up to keep going"}
          </h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-slate-400">
            {state === "ok"
              ? `${monthly.remaining.toLocaleString()} from this month${bought ? ` and ${bought.toLocaleString()} you bought` : ""}, for your coach, your weeks and every AI feature.`
              : `Top up below${fresh}.`}
          </p>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <ThisMonth monthly={monthly} />
            <Bought lots={tokens.bought} months={tokens.bought_months} />
          </div>
          <EnoughFor tokens={tokens} />
          <button type="button" onClick={onTopUp}
            className="store-cta mt-6 inline-flex h-11 items-center gap-2 rounded-full bg-accent px-5 text-sm font-semibold text-accent-foreground shadow-[0_14px_34px_rgba(87,229,234,0.3)] transition-all hover:-translate-y-0.5 hover:shadow-[0_18px_40px_rgba(87,229,234,0.45)]">
            <ArrowDown className="h-4 w-4" />Top up
          </button>
        </div>
      </div>
    </section>
  )
}

/** The balance, ringed by this month's tokens left (outside) and bought ones left (inside). */
function Gauge({ tokens }: { tokens: TokenBalance }) {
  const id = `gauge${svgId(useId())}`
  const drawn = useDrawn()
  const balance = useTween(tokens.balance, 1400)
  const bought = sum(tokens.bought.map((lot) => lot.remaining))
  const rings = [
    { key: "month", r: 98, left: share(tokens.monthly.remaining, tokens.monthly.tokens), from: "#d5fbff", to: "#57e5ea", glow: "rgba(87,229,234,0.55)" },
    { key: "bought", r: 78, left: share(bought, sum(tokens.bought.map((lot) => lot.tokens))), from: "#fff1b8", to: "#f59e0b", glow: "rgba(245,158,11,0.5)" },
  ]
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[250px]">
      <div aria-hidden className="pointer-events-none absolute inset-8 rounded-full bg-accent/20 blur-3xl" />
      <div aria-hidden className="store-orbit pointer-events-none absolute -inset-2 rounded-full border border-dashed border-cyan-200/15">
        <span className="absolute left-1/2 top-0 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-200 shadow-[0_0_14px_rgba(165,243,252,0.9)]" />
      </div>
      <svg viewBox="0 0 220 220" className="relative h-full w-full -rotate-90" aria-hidden>
        <defs>
          {rings.map((ring) => (
            <linearGradient key={ring.key} id={`${id}-${ring.key}`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor={ring.from} />
              <stop offset="1" stopColor={ring.to} />
            </linearGradient>
          ))}
        </defs>
        {rings.map((ring, index) => {
          const around = 2 * Math.PI * ring.r
          return (
            <g key={ring.key}>
              <circle cx="110" cy="110" r={ring.r} fill="none" stroke="white" strokeOpacity="0.06" strokeWidth="13" />
              {ring.left > 0 && (
                <circle cx="110" cy="110" r={ring.r} fill="none" stroke={`url(#${id}-${ring.key})`} strokeWidth="13" strokeLinecap="round"
                  strokeDasharray={around} strokeDashoffset={around * (1 - (drawn ? ring.left : 0))} className="token-ring"
                  style={{ "--ring-delay": `${200 + index * 220}ms`, filter: `drop-shadow(0 0 6px ${ring.glow})` } as CSSProperties} />
              )}
            </g>
          )
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <Coin size={30} className="token-spin" />
        <p className="mt-1.5 text-[44px] font-bold leading-none tracking-tight text-white tabular-nums">{Math.round(balance).toLocaleString()}</p>
        <p className="mt-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400">tokens to spend</p>
      </div>
    </div>
  )
}

/** This month's tokens, and the month itself: today on its way to the renewal. */
function ThisMonth({ monthly }: { monthly: TokenBalance["monthly"] }) {
  const drawn = useDrawn()
  const renews = monthly.renews_at ? new Date(monthly.renews_at) : null
  const starts = renews ? new Date(renews) : null
  starts?.setUTCMonth(starts.getUTCMonth() - 1)
  const now = Date.now()
  const gone = renews && starts ? share(now - starts.getTime(), renews.getTime() - starts.getTime()) : 0
  const days = renews ? Math.max(0, Math.ceil((renews.getTime() - now) / DAY)) : 0
  const at = `${(drawn ? gone : 0) * 100}%`
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-4 backdrop-blur">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm font-medium text-white">
          <span className="h-2.5 w-2.5 rounded-full bg-accent shadow-[0_0_10px_rgba(87,229,234,0.8)]" />This month
        </p>
        <p className="text-sm tabular-nums text-slate-400">
          <span className="font-semibold text-white">{monthly.remaining.toLocaleString()}</span> / {monthly.tokens.toLocaleString()}
        </p>
      </div>
      {renews && starts && (
        <>
          <div aria-hidden className="relative mt-5 h-1.5 rounded-full bg-white/[0.07]">
            <div className="token-slide absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-cyan-300/25 to-accent/80" style={{ width: at }} />
            <span className="token-slide absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2" style={{ left: at }}>
              <span className="status-ping absolute inset-0 rounded-full bg-accent/50" />
              <span className="absolute inset-0 rounded-full border-2 border-[#0b1720] bg-white shadow-[0_0_12px_rgba(87,229,234,0.9)]" />
            </span>
          </div>
          <div className="mt-2 flex justify-between text-[11px] tabular-nums text-slate-500">
            <span>{shortDay(starts.toISOString())}</span>
            <span>{shortDay(monthly.renews_at)}</span>
          </div>
          <p className="mt-2.5 flex items-center gap-1.5 text-xs leading-5 text-slate-400">
            <CalendarClock className="h-3.5 w-3.5 shrink-0 text-accent" />
            {days <= 0 ? "Renews today" : `Renews in ${days} day${days === 1 ? "" : "s"}`} · what&apos;s left doesn&apos;t carry over
          </p>
        </>
      )}
    </div>
  )
}

/** Bought (or given) tokens still to spend, each lot with what's left of it and until when. */
function Bought({ lots, months }: { lots: TokenBalance["bought"]; months: number }) {
  const left = sum(lots.map((lot) => lot.remaining))
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-4 backdrop-blur">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm font-medium text-white">
          <span className="h-2.5 w-2.5 rounded-full bg-amber-300 shadow-[0_0_10px_rgba(252,211,77,0.8)]" />Bought
        </p>
        <p className="text-sm tabular-nums text-slate-400">
          {left ? <><span className="font-semibold text-white">{left.toLocaleString()}</span> left</> : "None yet"}
        </p>
      </div>
      {lots.length ? (
        <ul className="mt-4 space-y-3">
          {lots.slice(0, 3).map((lot, index) => (
            <li key={index}>
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="flex min-w-0 items-center gap-1.5 text-slate-300">
                  {lot.gift ? <Gift className="h-3.5 w-3.5 shrink-0 text-violet-300" /> : <Coin size={14} className="shrink-0" />}
                  <span className="truncate">{lot.remaining.toLocaleString()} of {lot.tokens.toLocaleString()}{lot.gift ? " from SwimGPT" : ""}</span>
                </span>
                <span className="shrink-0 text-slate-500">until {shortDay(lot.expires_at)}</span>
              </div>
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/[0.06]">
                <div className={cn("store-fill h-full rounded-full", lot.gift ? "bg-violet-300/80" : "bg-gradient-to-r from-amber-200 to-amber-400")}
                  style={{ width: `${share(lot.remaining, lot.tokens) * 100}%`, "--fill-delay": `${350 + index * 120}ms` } as CSSProperties} />
              </div>
            </li>
          ))}
          {lots.length > 3 && <li className="text-xs text-slate-500">and {lots.length - 3} more</li>}
        </ul>
      ) : (
        <p className="mt-4 text-xs leading-5 text-slate-400">Top up whenever you need more. Bought tokens last {months} months.</p>
      )}
    </div>
  )
}

/** What the balance is enough for, in a few features' worth. */
function EnoughFor({ tokens }: { tokens: TokenBalance }) {
  const examples = EXAMPLES.flatMap((action) => {
    const cost = tokens.costs.find((item) => item.action === action)
    const times = cost && cost.tokens > 0 ? Math.floor(tokens.balance / cost.tokens) : 0
    return times > 0 ? [{ action, times, ...featureOf(action) }] : []
  })
  if (!examples.length) return null
  return (
    <p className="mt-5 flex flex-wrap items-center gap-2 text-sm text-slate-400">
      <span className="mr-0.5">That&apos;s about</span>
      {examples.map(({ action, times, many, icon: Icon, color }, index) => (
        <span key={action} className="inline-flex items-center gap-2">
          {index > 0 && index === examples.length - 1 && <span>or</span>}
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] py-1 pl-1 pr-3 text-slate-200">
            <span className="flex h-6 w-6 items-center justify-center rounded-full" style={{ background: `${color}26`, color }}><Icon className="h-3.5 w-3.5" /></span>
            <span><span className="font-semibold tabular-nums text-white">{times.toLocaleString()}</span> {many}</span>
          </span>
        </span>
      ))}
    </p>
  )
}

/** Packs to buy: the athlete picks one, ticks the box and pays on Stripe. */
function TopUp({ tokens }: { tokens: TokenBalance }) {
  const id = useId()
  const { packs } = tokens
  const rate = (pack: TokenPack) => pack.amount / pack.tokens
  const priciest = Math.max(...packs.map(rate))
  const best = packs.length > 1 ? packs.reduce((cheapest, pack) => (rate(pack) < rate(cheapest) ? pack : cheapest)) : null
  // The middle pack to begin with: neither the smallest nor the biggest is pushed.
  const [chosen, setChosen] = useState(packs[Math.floor((packs.length - 1) / 2)]?.id ?? "")
  const [startNow, setStartNow] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [buying, setBuying] = useState(false)
  const [error, setError] = useState("")
  const pack = packs.find((item) => item.id === chosen)
  if (!packs.length) return null

  const buy = async () => {
    if (!pack) return
    if (!startNow) {
      setAttempt((count) => count + 1)
      return
    }
    setBuying(true)
    setError("")
    try {
      await buyTokens(pack.id, startNow)
      // The browser is on its way to Stripe: the button keeps saying so.
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Checkout couldn't be opened. Nothing was charged; please try again.")
      setBuying(false)
    }
  }

  return (
    <section aria-labelledby={`${id}-title`} className="dash-reveal relative overflow-hidden rounded-[30px] border border-white/[0.08] bg-[linear-gradient(160deg,rgba(18,28,38,0.92),rgba(8,13,19,0.96))] p-5 shadow-[0_24px_60px_rgba(0,0,0,0.3)] sm:p-8"
      style={{ "--reveal-delay": "120ms" } as CSSProperties}>
      <div aria-hidden className="pointer-events-none absolute -right-24 bottom-0 h-72 w-72 rounded-full bg-amber-300/[0.07] blur-[100px]" />
      <div className="relative">
        <p className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em] text-amber-200"><Coins className="h-3.5 w-3.5" />Top up</p>
        <h2 id={`${id}-title`} className="mt-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">Get more tokens</h2>
        <p className="mt-1.5 text-sm text-slate-400">On top of your monthly tokens, and they last {tokens.bought_months} months.</p>
        <fieldset className="mt-7 grid gap-4 sm:grid-cols-3">
          <legend className="sr-only">Token packs</legend>
          {packs.map((item, index) => (
            <PackCard key={item.id} name={id} pack={item} index={index} chosen={item.id === chosen} best={item === best}
              save={Math.round((1 - rate(item) / priciest) * 100)} disabled={buying} onChoose={() => setChosen(item.id)} />
          ))}
        </fieldset>
        {pack && (
          <div className="mt-6 rounded-[24px] border border-white/[0.08] bg-black/25 p-4 sm:p-5">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <Coin size={44} className="token-spin shrink-0" style={{ "--spin-delay": "0.4s" } as CSSProperties} />
                <div key={pack.id} className="token-rise min-w-0">
                  <p className="text-lg font-semibold text-white">+{tokenCount(pack.tokens)}</p>
                  <p className="text-xs leading-5 text-slate-400">
                    Last until {expiry(tokens.bought_months)} · your balance after: <span className="font-semibold tabular-nums text-slate-200">{(tokens.balance + pack.tokens).toLocaleString()}</span>
                  </p>
                </div>
              </div>
              <p key={`${pack.id}-price`} className="token-rise text-2xl font-bold tabular-nums text-white">{formatPrice(pack.amount, pack.currency)}</p>
            </div>
            <StartNowConsent kind="tokens" checked={startNow} onChange={setStartNow} attempt={attempt} disabled={buying} className="mt-4 border-t border-white/[0.06] pt-4" />
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
              <button type="button" onClick={() => void buy()} disabled={buying}
                className="store-cta inline-flex h-12 items-center justify-center gap-2 rounded-full bg-accent px-6 text-[15px] font-semibold text-accent-foreground shadow-[0_14px_34px_rgba(87,229,234,0.32)] transition-all hover:-translate-y-0.5 hover:shadow-[0_18px_40px_rgba(87,229,234,0.45)] disabled:translate-y-0 disabled:opacity-80">
                {buying
                  ? <><Loader2 className="h-4 w-4 animate-spin" />Opening checkout…</>
                  : <><CreditCard className="h-4 w-4" />Buy {tokenCount(pack.tokens)} · {formatPrice(pack.amount, pack.currency)}</>}
              </button>
              <p className="inline-flex items-center gap-1.5 text-xs text-slate-400"><ShieldCheck className="h-4 w-4 text-emerald-300" />Secure checkout with Stripe</p>
            </div>
            <p className="mt-3 text-xs leading-5 text-slate-500">Bought tokens aren&apos;t refundable. The tokens that expire first are always spent first.</p>
            {error && <div className="mt-3"><Banner tone="error">{error}</Banner></div>}
          </div>
        )}
      </div>
    </section>
  )
}

/** When tokens bought today would expire: "26 Dec". */
function expiry(months: number) {
  const until = new Date()
  until.setMonth(until.getMonth() + months)
  return shortDay(until.toISOString())
}

/** One pack, as a radio: its coins, how many tokens, the price and what it saves. A row on a phone, a card above. */
function PackCard({ name, pack, index, chosen, best, save, disabled, onChoose }: {
  name: string; pack: TokenPack; index: number; chosen: boolean; best: boolean; save: number; disabled: boolean; onChoose: () => void
}) {
  return (
    <div className="token-rise" style={{ "--rise-delay": `${200 + index * 90}ms` } as CSSProperties}>
      <div className={cn("relative h-full rounded-[24px] p-px transition-transform duration-300 hover:-translate-y-1",
        best ? "store-border" : chosen ? "bg-accent/70" : "bg-white/[0.09]")}>
        {best && (
          <span className="absolute -top-2.5 right-5 z-10 rounded-full bg-accent px-2.5 py-0.5 text-[10px] font-black uppercase tracking-[0.14em] text-accent-foreground shadow-[0_6px_18px_rgba(87,229,234,0.4)]">
            Best value
          </span>
        )}
        <label className={cn("relative flex h-full items-center gap-4 overflow-hidden rounded-[23px] p-4 transition-colors duration-300 sm:flex-col sm:items-stretch sm:gap-0 sm:p-5",
          disabled ? "cursor-default" : "cursor-pointer",
          chosen
            ? "bg-[linear-gradient(160deg,#0f2a33,#0a141c_70%)] shadow-[inset_0_0_0_1px_rgba(87,229,234,0.25),0_18px_44px_rgba(87,229,234,0.12)]"
            : "bg-[linear-gradient(160deg,#111b25,#0a1017_70%)] hover:bg-[linear-gradient(160deg,#152330,#0b131b_70%)]")}>
          <input type="radio" name={name} value={pack.id} checked={chosen} onChange={onChoose} disabled={disabled} className="peer sr-only" />
          {best && <span className="sr-only">Best value.</span>}
          <span aria-hidden className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors duration-300 sm:absolute sm:left-4 sm:top-4",
            "peer-focus-visible:ring-2 peer-focus-visible:ring-white/60 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-[#0a141c]",
            chosen ? "border-transparent bg-accent text-accent-foreground" : "border-white/25")}>
            {chosen && <Check className="h-3 w-3" strokeWidth={3.5} />}
          </span>
          <CoinStack count={2 + index * 2} lively={chosen} className="h-14 w-16 shrink-0 sm:mx-auto sm:mt-5 sm:h-[92px] sm:w-[110px]" />
          <div className="min-w-0 flex-1 sm:mt-4 sm:text-center">
            <p className="text-2xl font-bold tabular-nums tracking-tight text-white sm:text-4xl">{pack.tokens.toLocaleString()}</p>
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400">tokens</p>
          </div>
          <div className="shrink-0 text-right sm:mt-5 sm:flex sm:items-center sm:justify-between sm:gap-2 sm:border-t sm:border-white/[0.07] sm:pt-4 sm:text-left">
            <div>
              <p className="text-base font-semibold text-white sm:text-lg">{formatPrice(pack.amount, pack.currency)}</p>
              <p className="text-[11px] text-slate-500">{formatPrice(Math.round((pack.amount / pack.tokens) * 100), pack.currency)} per 100</p>
            </div>
            {save > 0 && <span className="mt-1 inline-block rounded-full bg-emerald-400/15 px-2 py-0.5 text-[11px] font-bold text-emerald-300 sm:mt-0">Save {save}%</span>}
          </div>
        </label>
      </div>
    </div>
  )
}

// Where a stack's coins sit off-centre, from the bottom up, and the sparkles round it.
const JITTER = [0, 2.5, -2, 1.5, -2.5, 1]
const SPARKLES = [[14, 44, 0], [104, 34, 0.9], [100, 74, 1.7]]

/** A pack's stack of coins, dropped on one by one; it bobs while it's the chosen pack. */
function CoinStack({ count, lively, className }: { count: number; lively: boolean; className?: string }) {
  const id = `stack${svgId(useId())}`
  return (
    <svg viewBox="0 0 120 100" className={cn("overflow-visible", className)} aria-hidden>
      <defs>
        <linearGradient id={`${id}-side`} x1="0" x2="1">
          <stop offset="0" stopColor="#8a5a12" />
          <stop offset="0.35" stopColor="#e9a93a" />
          <stop offset="0.7" stopColor="#b7791f" />
          <stop offset="1" stopColor="#6b4410" />
        </linearGradient>
        <radialGradient id={`${id}-top`} cx="0.4" cy="0.35" r="0.8">
          <stop offset="0" stopColor="#fff4c4" />
          <stop offset="0.55" stopColor="#fbbf24" />
          <stop offset="1" stopColor="#c27c0e" />
        </radialGradient>
      </defs>
      <ellipse cx="60" cy="91" rx="42" ry="7" fill="black" opacity="0.35" />
      <g className={cn(lively && "token-bob")}>
        {Array.from({ length: count }, (_, index) => {
          const x = 60 + JITTER[index % JITTER.length]
          const y = 80 - index * 9
          return (
            <g key={index} className="token-drop" style={{ "--drop-delay": `${250 + index * 90}ms` } as CSSProperties}>
              <path d={`M${x - 34} ${y}v7a34 10 0 0 0 68 0v-7`} fill={`url(#${id}-side)`} />
              <ellipse cx={x} cy={y} rx="34" ry="10" fill={`url(#${id}-top)`} stroke="#9a6412" strokeOpacity="0.5" strokeWidth="0.8" />
              <ellipse cx={x} cy={y} rx="25" ry="6.5" fill="none" stroke="#9a6412" strokeOpacity="0.35" strokeWidth="0.8" strokeDasharray="1.5 2.5" />
            </g>
          )
        })}
      </g>
      {SPARKLES.map(([x, y, delay], index) => (
        <path key={index} className="token-twinkle" style={{ "--twinkle-delay": `${delay}s` } as CSSProperties} fill="#fff7d6"
          d={`M${x} ${y - 6}L${x + 1.5} ${y - 1.5}L${x + 6} ${y}L${x + 1.5} ${y + 1.5}L${x} ${y + 6}L${x - 1.5} ${y + 1.5}L${x - 6} ${y}L${x - 1.5} ${y - 1.5}Z`} />
      ))}
    </svg>
  )
}

/** What each AI feature costs, with how many of each the balance covers. */
function Costs({ tokens }: { tokens: TokenBalance }) {
  return (
    <Tile>
      <TileHeader icon={Zap} title="What things cost" subtitle="Tokens are taken as the AI starts working" />
      {/* Two across while the tile has the width to itself; one beside the history. */}
      <ul className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-1">
        {tokens.costs.map((cost, index) => {
          const { does, icon: Icon, color } = featureOf(cost.action)
          const times = cost.tokens > 0 ? Math.floor(tokens.balance / cost.tokens) : 0
          return (
            <li key={cost.action} className="token-rise flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.025] p-3 transition-colors duration-300 hover:border-white/15 hover:bg-white/[0.05]"
              style={{ "--rise-delay": `${350 + index * 45}ms` } as CSSProperties}>
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: `${color}1c`, color, boxShadow: `inset 0 0 0 1px ${color}33` }}>
                <Icon className="h-[18px] w-[18px]" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium leading-5 text-white">{does}</p>
                <p className="mt-0.5 text-[11px] text-slate-500">{times ? `${times.toLocaleString()}× with your balance` : "Top up to use it"}</p>
              </div>
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-300/20 bg-amber-300/[0.08] py-0.5 pl-1 pr-2 text-xs font-bold tabular-nums text-amber-100"
                aria-label={tokenCount(cost.tokens)}>
                <Coin size={14} />{cost.tokens}
              </span>
            </li>
          )
        })}
      </ul>
      <div className="mt-4 flex items-start gap-3 rounded-2xl border border-emerald-300/15 bg-emerald-400/[0.06] p-3.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-400/15"><Undo2 className="h-4 w-4 text-emerald-300" /></span>
        <p className="text-xs leading-5 text-slate-300">
          <span className="font-semibold text-emerald-200">Failed requests are free.</span> If something fails, or you leave before a week is saved, its tokens come straight back.
        </p>
      </div>
    </Tile>
  )
}

/** The latest AI requests: how their tokens split between features, then each one, by day; all of them in a window. */
function Activity({ tokens }: { tokens: TokenBalance }) {
  const [everything, setEverything] = useState(false)
  const items = tokens.recent
  return (
    <Tile>
      <TileHeader icon={History} title="Where your tokens went" subtitle="Your latest AI requests" />
      {items.length ? (
        <>
          <Breakdown items={items} />
          <SpendDays items={items.slice(0, FIRST_ROWS)} className="mt-5" />
          {items.length > FIRST_ROWS && (
            <Dialog open={everything} onOpenChange={setEverything}>
              <DialogTrigger asChild>
                <button type="button"
                  className="group mt-3 inline-flex items-center gap-1.5 rounded-full px-1 py-1 text-sm font-medium text-accent transition-colors hover:text-white">
                  Show all {items.length}
                  <ChevronRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5" />
                </button>
              </DialogTrigger>
              <DialogContent className="flex max-h-[85dvh] flex-col gap-0 overflow-hidden border-white/10 bg-[#0d151c] p-0 sm:max-w-lg">
                <DialogHeader className="border-b border-white/[0.06] px-5 pb-4 pr-12 pt-5 text-left">
                  <DialogTitle className="flex items-center gap-2 text-white"><History className="h-4 w-4 text-accent" />Where your tokens went</DialogTitle>
                  <DialogDescription className="text-slate-400">Your latest {items.length} AI requests</DialogDescription>
                </DialogHeader>
                {/* The list's top padding is inside it, so a day's pinned heading sits flush with the top as it scrolls. */}
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5">
                  <div className="pt-4">
                    <Breakdown items={items} />
                    <SpendDays items={items} pinned className="mt-5" />
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          )}
        </>
      ) : (
        <div className="flex flex-col items-center py-8 text-center">
          <Coin size={52} className="token-spin" />
          <p className="mt-4 font-semibold text-white">Nothing spent yet</p>
          <p className="mt-1 max-w-xs text-sm leading-6 text-slate-400">Each time the AI works for you, it shows up here.</p>
        </div>
      )}
    </Tile>
  )
}

/** The latest requests' tokens, split by feature in one bar; the ones given back counted apart. */
function Breakdown({ items }: { items: Spend[] }) {
  const totals = new Map<string, number>()
  for (const item of items) {
    if (!item.returned) totals.set(item.action ?? "", (totals.get(item.action ?? "") ?? 0) + item.tokens)
  }
  const parts = [...totals].sort((a, b) => b[1] - a[1])
  const used = sum(parts.map(([, tokens]) => tokens))
  const back = sum(items.filter((item) => item.returned).map((item) => item.tokens))
  if (!used && !back) return null
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <p className="text-slate-400"><span className="font-semibold tabular-nums text-white">{used.toLocaleString()}</span> used</p>
        {back > 0 && <p className="inline-flex items-center gap-1 text-xs font-medium text-emerald-300"><Undo2 className="h-3.5 w-3.5" />{back.toLocaleString()} given back</p>}
      </div>
      {used > 0 && (
        <>
          <div className="mt-2 flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-white/[0.04]">
            {parts.map(([action, tokens], index) => (
              <span key={action} className="store-fill h-full" title={`${featureOf(action).many}: ${tokenCount(tokens)}`}
                style={{ width: `${(tokens / used) * 100}%`, background: featureOf(action).color, "--fill-delay": `${300 + index * 120}ms` } as CSSProperties} />
            ))}
          </div>
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-slate-400">
            {parts.slice(0, 5).map(([action, tokens]) => (
              <li key={action} className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: featureOf(action).color }} />
                <span className="first-letter:uppercase">{featureOf(action).many}</span>
                <span className="tabular-nums text-slate-300">{tokens.toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

/** Requests by day, newest first. `pinned`: in the full list's window, each day's heading stays in view as it scrolls. */
function SpendDays({ items, pinned = false, className }: { items: Spend[]; pinned?: boolean; className?: string }) {
  return (
    <ol className={cn("space-y-4", className)}>
      {byDay(items).map(([day, group]) => (
        <li key={day}>
          <p className={cn("mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500",
            pinned && "sticky top-0 z-10 -mx-5 bg-[#0d151c]/95 px-5 py-1.5 backdrop-blur")}>{day}</p>
          <ul className="divide-y divide-white/[0.05]">
            {group.map((item, index) => <SpendRow key={`${item.at}-${index}`} item={item} />)}
          </ul>
        </li>
      ))}
    </ol>
  )
}

function SpendRow({ item }: { item: Spend }) {
  const { icon: Icon, color } = featureOf(item.action)
  return (
    <li className="flex items-center gap-3 py-2.5">
      <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", item.returned && "opacity-50")} style={{ background: `${color}1c`, color }}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn("truncate text-sm", item.returned ? "text-slate-400" : "text-slate-100")}>{item.label}</p>
        <p className="text-[11px] tabular-nums text-slate-500">{clock(item.at)}</p>
      </div>
      {item.returned ? (
        <span className="inline-flex shrink-0 items-center gap-2 text-xs">
          <span className="tabular-nums text-slate-500 line-through">−{item.tokens.toLocaleString()}</span>
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/[0.12] px-2 py-0.5 font-semibold text-emerald-300"><Undo2 className="h-3 w-3" />Given back</span>
        </span>
      ) : (
        <span className="shrink-0 rounded-full bg-white/[0.05] px-2.5 py-0.5 text-sm font-semibold tabular-nums text-white">−{item.tokens.toLocaleString()}</span>
      )}
    </li>
  )
}

const clock = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : "")

/** "Today", "Yesterday" or "Fri 24 Oct", in the athlete's own time zone. */
function dayOf(iso: string | null) {
  if (!iso) return "Earlier"
  const midnight = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const day = new Date(iso)
  const ago = Math.round((midnight(new Date()) - midnight(day)) / DAY)
  if (ago === 0) return "Today"
  if (ago === 1) return "Yesterday"
  return day.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })
}

/** The requests grouped by day, newest first, as they come. */
function byDay(items: Spend[]) {
  const days = new Map<string, Spend[]>()
  for (const item of items) {
    const day = dayOf(item.at)
    days.set(day, [...(days.get(day) ?? []), item])
  }
  return [...days]
}
