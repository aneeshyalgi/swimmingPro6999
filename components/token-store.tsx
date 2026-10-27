"use client"

import { useEffect, useId, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode, type RefObject } from "react"
import {
  ArrowDown, AudioLines, CalendarClock, CalendarPlus, Check, ChevronRight, Coins, CreditCard, Dumbbell, Flag, Gift, History, Info,
  Loader2, MessageCircle, RefreshCw, ScanLine, ShieldCheck, Sparkles, Undo2, Video, Wand2, Waves, Zap, type LucideIcon,
} from "lucide-react"
import { Reveal, useTween } from "@/components/dashboard-ui"
import { Banner, EmptyState } from "@/components/training-ui"
import { StartNowConsent } from "@/components/legal/start-now-consent"
import { Tilt } from "@/components/plan-store/plan-cover"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { WaterBubbles } from "@/components/water-bubbles"
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
  coach_plan: { does: "Adding a session from your coach's plan", many: "plan sessions", icon: CalendarPlus, color: "#67e8f9" },
  swim_week: { does: "Generating a swim week", many: "swim weeks", icon: Waves, color: "#38bdf8" },
  swim_replan: { does: "Re-planning a swim week", many: "re-plans", icon: RefreshCw, color: "#2dd4bf" },
  gym_week: { does: "Planning a gym week", many: "gym weeks", icon: Dumbbell, color: "#fb923c" },
  week_coach: { does: "A message to the week re-planner", many: "re-planner messages", icon: Wand2, color: "#e879f9" },
  race_plan: { does: "Race plans for a meet", many: "race plans", icon: Flag, color: "#fb7185" },
  stroke_recognition: { does: "Recognising the stroke in a clip", many: "stroke recognitions", icon: ScanLine, color: "#5eead4" },
  video_analysis: { does: "A video analysis", many: "video analyses", icon: Video, color: "#34d399" },
  daily_plan: { does: "Today's plan", many: "daily plans", icon: CalendarClock, color: "#fcd34d" },
}
const OTHER = { does: "An AI feature", many: "AI requests", icon: Sparkles, color: "#94a3b8" }
const featureOf = (action: string | null) => (action && FEATURES[action]) || OTHER
// What the wallet says the balance is enough for.
const EXAMPLES = ["coach_chat", "swim_week", "video_analysis"]
// Features that only come together: a clip's stroke is recognised for its analysis (and only when both are covered), so
// how many the balance covers counts both.
const COMES_WITH: Record<string, string[]> = { video_analysis: ["stroke_recognition"], stroke_recognition: ["video_analysis"] }
/** Tokens one use of `action` takes in all, with what it comes with. */
const fullCost = (action: string, costs: TokenBalance["costs"]) =>
  [action, ...(COMES_WITH[action] ?? [])].reduce((sum, item) => sum + (costs.find((cost) => cost.action === item)?.tokens ?? 0), 0)
// History rows shown on the tile; "Show all" opens every one in a window of its own.
const FIRST_ROWS = 8
const DAY = 86_400_000
// The wallet's colour (as "r, g, b"): the accent while there's enough, amber once it runs low.
const CYAN = "87, 229, 234"
const AMBER = "252, 211, 77"

// Each pack's look, smallest first: its name, colour and piles of coins (x, coins, how far forward).
const LOOKS = [
  { name: "Starter", color: "#57e5ea", light: "#a5f3fc", rgb: CYAN, piles: [[80, 4, 0]] },
  { name: "Plus", color: "#a78bfa", light: "#ddd6fe", rgb: "167, 139, 250", piles: [[58, 4, 0], [102, 6, 4]] },
  { name: "Pro", color: "#fbbf24", light: "#fde68a", rgb: "251, 191, 36", piles: [[38, 5, 0], [122, 6, 0], [80, 9, 6]] },
]

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
 * carried over, and any bought, which last two months) on a stage of its own, packs to top up with, how tokens work,
 * what each AI feature costs, and where their latest tokens went.
 */
export function TokenStore({ tokens, notice }: { tokens: Tokens | null; notice: StoreNotice }) {
  const topUp = useRef<HTMLDivElement>(null)
  const costs = useRef<HTMLDivElement>(null)
  const go = (target: RefObject<HTMLDivElement | null>) => target.current?.scrollIntoView({ behavior: calm() ? "auto" : "smooth", block: "start" })
  return (
    <div className="space-y-8">
      {notice && <StoreBanner notice={notice} />}
      {tokens === null ? (
        <Loading />
      ) : !tokens.available ? (
        <EmptyState icon={Coins} title="The token store isn't open yet" body="Every AI feature is included in your subscription for now." />
      ) : (
        <>
          <Vault tokens={tokens} onTopUp={() => go(topUp)} onCosts={() => go(costs)} />
          <div ref={topUp} className="scroll-mt-24"><TopUp tokens={tokens} /></div>
          <Reveal index={3}><HowItWorks tokens={tokens} /></Reveal>
          {/* Each panel as tall as it needs: the history grows with the athlete's requests. */}
          <div ref={costs} className="grid scroll-mt-24 gap-6 lg:grid-cols-2 lg:items-start">
            <Reveal index={4}><Costs tokens={tokens} /></Reveal>
            <Reveal index={5}><Activity tokens={tokens} /></Reveal>
          </div>
        </>
      )}
    </div>
  )
}

function Loading() {
  return (
    <div className="space-y-8" aria-busy="true" aria-label="Loading your tokens">
      <div className="store-shimmer h-[440px] rounded-[32px]" />
      <div className="grid gap-5 sm:grid-cols-3">
        {[0, 1, 2].map((key) => <div key={key} className="store-shimmer h-28 rounded-[26px] sm:h-[360px]" />)}
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
export function Coin({ size = 32, className, style }: { size?: number; className?: string; style?: CSSProperties }) {
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

/** The wallet's coin, turning in 3D: a face on each side and an edge of stacked slices between them. */
function Coin3D() {
  return (
    <div className="ts-coin absolute inset-0">
      <div aria-hidden className="ts-coin-shadow" />
      <div className="ts-coin-body">
        {Array.from({ length: 9 }, (_, index) => (
          <span key={index} className="ts-coin-edge" style={{ transform: `translateZ(${((index - 4) * 1.6).toFixed(1)}px)` }} />
        ))}
        <div className="ts-coin-face" style={{ transform: "translateZ(7px)" }}><Coin className="h-full w-full" /><span className="ts-coin-shine" /></div>
        <div className="ts-coin-face" style={{ transform: "rotateY(180deg) translateZ(7px)" }}><Coin className="h-full w-full" /><span className="ts-coin-shine" /></div>
      </div>
    </div>
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

/** The athlete's wallet, on a stage: the coin and its rings on one side, the balance and what it's made of on the other. */
function Vault({ tokens, onTopUp, onCosts }: { tokens: TokenBalance; onTopUp: () => void; onCosts: () => void }) {
  const id = useId()
  const { monthly } = tokens
  const bought = sum(tokens.bought.map((lot) => lot.remaining))
  const week = tokens.costs.find((cost) => cost.action === "swim_week")?.tokens ?? 10
  const state = tokens.balance <= 0 ? "out" : tokens.balance < week ? "low" : "ok"
  const balance = useTween(tokens.balance, 1600)
  const fresh = monthly.renews_at ? `, or wait for ${tokenCount(monthly.tokens)} on ${shortDay(monthly.renews_at)}` : ""
  const step = (index: number) => ({ "--i": index }) as CSSProperties
  return (
    <section aria-labelledby={`${id}-title`} className="ts-vault dash-reveal relative overflow-hidden rounded-[32px] border border-white/[0.08] px-5 pb-8 pt-6 sm:p-8 lg:p-10"
      style={{ "--ts-tone": state === "ok" ? CYAN : AMBER } as CSSProperties}>
      <div aria-hidden className="ts-aurora pointer-events-none absolute inset-0 overflow-hidden"><i /><i /><i /></div>
      <WaterBubbles />
      <FloatingCoins />
      <div aria-hidden className="ts-edge pointer-events-none absolute inset-x-16 top-0 h-px" />
      <div className="relative grid items-center gap-6 lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)] lg:gap-14">
        <Tilt max={10}><Reactor tokens={tokens} /></Tilt>
        <div className="ts-stagger min-w-0 text-center lg:text-left">
          <p style={step(0)} className={cn("inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-[0.22em] backdrop-blur",
            state === "ok" ? "border-accent/25 bg-accent/10 text-accent" : "border-amber-300/30 bg-amber-300/10 text-amber-200")}>
            <Sparkles className="h-3.5 w-3.5" />{state === "ok" ? "Your wallet" : state === "low" ? "Running low" : "Out of tokens"}
          </p>
          <h2 id={`${id}-title`} style={step(1)} className="mt-4 flex items-baseline justify-center gap-3 lg:justify-start">
            <span className="ts-balance text-[64px] font-bold leading-[0.95] tracking-[-0.045em] tabular-nums sm:text-[92px]">{Math.round(balance).toLocaleString()}</span>
            <span className="text-xl font-semibold text-slate-300 sm:text-2xl">{tokens.balance === 1 ? "token" : "tokens"}</span>
          </h2>
          <p style={step(2)} className="mt-3 text-xl font-semibold tracking-tight text-white">
            {state === "ok" ? "You're all set" : state === "low" ? `Only ${tokenCount(tokens.balance)} left` : "Top up to keep going"}
          </p>
          <p style={step(3)} className="mx-auto mt-1.5 max-w-xl text-sm leading-6 text-slate-400 lg:mx-0">
            {state === "ok"
              ? `${monthly.remaining.toLocaleString()} from this month${bought ? ` and ${bought.toLocaleString()} you bought` : ""}, for your coach, your weeks and every AI feature.`
              : `Top up below${fresh}.`}
          </p>
          <div style={step(4)}><Stats tokens={tokens} /></div>
          <div style={step(5)}><EnoughFor tokens={tokens} /></div>
          <div style={step(6)} className="mt-7 flex flex-wrap items-center justify-center gap-3 lg:justify-start">
            <button type="button" onClick={onTopUp} className="ts-cta inline-flex h-12 items-center gap-2 rounded-full px-6 text-[15px] font-semibold">
              <ArrowDown className="h-4 w-4" />Top up
            </button>
            <button type="button" onClick={onCosts}
              className="inline-flex h-12 items-center gap-2 rounded-full border border-white/12 bg-white/[0.04] px-5 text-sm font-medium text-white backdrop-blur transition-colors hover:bg-white/[0.09]">
              <Zap className="h-4 w-4 text-amber-200" />What things cost
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}

// Lights riding the reactor's outer ring.
const SATELLITES = [0, 72, 144, 216, 288]

/** The coin at the heart of the wallet: a spinning ring of light, a dashed orbit, a dial, and the balance's two rings
 *  (this month's tokens left outside, bought ones inside), with notes floating beside it. */
function Reactor({ tokens }: { tokens: TokenBalance }) {
  const id = `reactor${svgId(useId())}`
  const drawn = useDrawn()
  const bought = sum(tokens.bought.map((lot) => lot.remaining))
  const rings = [
    { key: "month", r: 100, left: share(tokens.monthly.remaining, tokens.monthly.tokens), from: "#d5fbff", to: "#57e5ea", glow: "rgba(87,229,234,0.6)" },
    { key: "bought", r: 86, left: share(bought, sum(tokens.bought.map((lot) => lot.tokens))), from: "#fff1b8", to: "#f59e0b", glow: "rgba(245,158,11,0.55)" },
  ]
  const renews = tokens.monthly.renews_at
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[290px] sm:max-w-[380px]">
      <div aria-hidden className="ts-halo" />
      <div aria-hidden className="ts-arc" />
      <div aria-hidden className="ts-orbit" />
      <div aria-hidden className="ts-sats">{SATELLITES.map((angle) => <span key={angle} style={{ "--a": `${angle}deg` } as CSSProperties} />)}</div>
      <svg viewBox="0 0 220 220" className="absolute inset-[7%] h-[86%] w-[86%] -rotate-90" aria-hidden>
        <defs>
          {rings.map((ring) => (
            <linearGradient key={ring.key} id={`${id}-${ring.key}`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor={ring.from} />
              <stop offset="1" stopColor={ring.to} />
            </linearGradient>
          ))}
        </defs>
        {Array.from({ length: 60 }, (_, index) => (
          <line key={index} x1="110" y1="1" x2="110" y2={index % 5 ? 4.5 : 8} stroke="white" strokeOpacity={index % 5 ? 0.12 : 0.3} strokeWidth="1"
            transform={`rotate(${index * 6} 110 110)`} />
        ))}
        {rings.map((ring, index) => {
          const around = 2 * Math.PI * ring.r
          return (
            <g key={ring.key}>
              <circle cx="110" cy="110" r={ring.r} fill="none" stroke="white" strokeOpacity="0.06" strokeWidth="9" />
              {ring.left > 0 && (
                <circle cx="110" cy="110" r={ring.r} fill="none" stroke={`url(#${id}-${ring.key})`} strokeWidth="9" strokeLinecap="round"
                  strokeDasharray={around} strokeDashoffset={around * (1 - (drawn ? ring.left : 0))} className="token-ring"
                  style={{ "--ring-delay": `${300 + index * 260}ms`, filter: `drop-shadow(0 0 6px ${ring.glow})` } as CSSProperties} />
              )}
            </g>
          )
        })}
      </svg>
      <div className="absolute inset-[27%]"><Coin3D /></div>
      {renews && (
        <FloatChip className="-right-[13%] -top-[3%]" delay={700} icon={CalendarClock} color="#57e5ea"
          title={`Renews ${shortDay(renews)}`} body={`${tokenCount(tokens.monthly_tokens)} every month`} />
      )}
      <FloatChip className="-bottom-[2%] -left-[11%]" delay={950} icon={Undo2} color="#34d399" title="Failed requests are free" body="Their tokens come straight back" />
    </div>
  )
}

/** A note floating beside the coin (as the plan store's beside its books); a desktop flourish, said elsewhere too. */
function FloatChip({ className, delay, icon: Icon, color, title, body }: {
  className: string; delay: number; icon: LucideIcon; color: string; title: string; body: string
}) {
  return (
    <div aria-hidden className={cn("ts-chip absolute z-10 hidden items-center gap-2.5 rounded-2xl border border-white/10 bg-[#0b141c]/85 py-2 pl-2 pr-3.5 shadow-[0_16px_40px_rgba(0,0,0,0.45)] backdrop-blur-md sm:flex", className)}
      style={{ "--chip-delay": `${delay}ms` } as CSSProperties}>
      <span className="flex h-8 w-8 items-center justify-center rounded-xl" style={{ background: `${color}22`, color, boxShadow: `inset 0 0 0 1px ${color}40` }}>
        <Icon className="h-4 w-4" />
      </span>
      <span className="text-xs leading-4"><span className="block font-semibold text-white">{title}</span><span className="text-slate-400">{body}</span></span>
    </div>
  )
}

/** The balance in three boxes: this month's tokens, bought ones, and the days until the month renews. */
function Stats({ tokens }: { tokens: TokenBalance }) {
  const drawn = useDrawn()
  const { monthly } = tokens
  const bought = sum(tokens.bought.map((lot) => lot.remaining))
  const first = tokens.bought.map((lot) => lot.expires_at).filter((at): at is string => !!at).sort()[0] ?? null
  const gift = tokens.bought.some((lot) => lot.gift)
  const renews = monthly.renews_at ? new Date(monthly.renews_at) : null
  const starts = renews ? new Date(renews) : null
  starts?.setUTCMonth(starts.getUTCMonth() - 1)
  const now = Date.now()
  const days = renews ? Math.max(0, Math.ceil((renews.getTime() - now) / DAY)) : null
  // Each box's label, and a shorter one for a phone's narrow boxes.
  const stats = [
    { key: "month", label: "This month", short: "Month", value: monthly.remaining.toLocaleString(), unit: `/ ${monthly.tokens.toLocaleString()}`, note: "Resets monthly",
      fill: share(monthly.remaining, monthly.tokens), bar: "from-cyan-200 to-accent", dot: "bg-accent" },
    { key: "bought", label: gift ? "Bought & given" : "Bought", short: "Bought", value: bought.toLocaleString(), unit: "",
      note: first ? `Until ${shortDay(first)}` : `Lasts ${tokens.bought_months} months`,
      fill: share(bought, sum(tokens.bought.map((lot) => lot.tokens))), bar: "from-amber-100 to-amber-400", dot: "bg-amber-300" },
    { key: "renews", label: "Renews in", short: "Renews", value: days === null ? "–" : days === 0 ? "Today" : String(days), unit: days ? (days === 1 ? "day" : "days") : "",
      note: renews ? shortDay(monthly.renews_at) : "", fill: renews && starts ? share(now - starts.getTime(), renews.getTime() - starts.getTime()) : 0,
      bar: "from-slate-500 to-slate-300", dot: "bg-slate-300" },
  ]
  return (
    <dl className="mt-6 grid grid-cols-3 gap-2 text-left sm:gap-3">
      {stats.map((stat, index) => (
        <div key={stat.key} className="min-w-0 rounded-2xl border border-white/[0.07] bg-white/[0.03] px-3 py-3 backdrop-blur sm:px-4">
          <dt className="flex items-center gap-1.5 truncate text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            {stat.key === "bought" && gift ? <Gift className="h-3 w-3 shrink-0 text-violet-300" /> : <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", stat.dot)} />}
            <span className="sm:hidden">{stat.short}</span><span className="hidden sm:inline">{stat.label}</span>
          </dt>
          <dd className="mt-1.5 truncate font-mono text-lg font-bold tabular-nums text-white sm:text-2xl">
            {stat.value}{stat.unit && <span className="ml-1 text-xs font-medium text-slate-500 sm:text-sm">{stat.unit}</span>}
          </dd>
          <dd className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.07]">
            <div className={cn("ts-grow h-full rounded-full bg-gradient-to-r", stat.bar)}
              style={{ width: `${(drawn ? stat.fill : 0) * 100}%`, transitionDelay: `${400 + index * 160}ms` }} />
          </dd>
          <dd className="mt-1.5 hidden truncate text-[11px] text-slate-500 sm:block">{stat.note}</dd>
        </div>
      ))}
    </dl>
  )
}

/** What the balance is enough for, in a few features' worth. */
function EnoughFor({ tokens }: { tokens: TokenBalance }) {
  const examples = EXAMPLES.flatMap((action) => {
    const cost = tokens.costs.some((item) => item.action === action) ? fullCost(action, tokens.costs) : 0
    const times = cost > 0 ? Math.floor(tokens.balance / cost) : 0
    return times > 0 ? [{ action, times, ...featureOf(action) }] : []
  })
  if (!examples.length) return null
  return (
    <p className="mt-5 flex flex-wrap items-center justify-center gap-2 text-sm text-slate-400 lg:justify-start">
      <span className="mr-0.5">That&apos;s about</span>
      {examples.map(({ action, times, many, icon: Icon, color }, index) => (
        <span key={action} className="inline-flex items-center gap-2">
          {index > 0 && index === examples.length - 1 && <span>or</span>}
          <span className="inline-flex items-center gap-1.5 rounded-full border bg-white/[0.04] py-1 pl-1 pr-3 text-slate-200 backdrop-blur"
            style={{ borderColor: `${color}33` }}>
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
  const index = packs.findIndex((item) => item.id === chosen)
  const pack = packs[index]
  if (!packs.length) return null

  const per = (action: string) => tokens.costs.find((cost) => cost.action === action)?.tokens ?? 0
  const worth = (count: number) => {
    const parts = [["swim_week", "swim weeks"], ["coach_chat", "coach messages"]].flatMap(([action, many]) =>
      per(action) > 0 ? [`${Math.floor(count / per(action)).toLocaleString()} ${many}`] : [])
    return parts.length ? `About ${parts.join(" or ")}` : ""
  }

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
    <section aria-labelledby={`${id}-title`} className="ts-panel dash-reveal relative overflow-hidden rounded-[32px] border border-white/[0.08] p-5 sm:p-8"
      style={{ "--ts-tone": "251, 191, 36", "--reveal-delay": "120ms" } as CSSProperties}>
      <div aria-hidden className="ts-edge pointer-events-none absolute inset-x-16 top-0 h-px" />
      <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-amber-300/[0.08] blur-[100px]" />
      <div className="relative flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="inline-flex items-center gap-2 rounded-full border border-amber-300/25 bg-amber-300/[0.08] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.22em] text-amber-200">
            <Coins className="h-3.5 w-3.5" />Top up
          </p>
          <h2 id={`${id}-title`} className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Get more <span className="bg-gradient-to-r from-amber-100 via-amber-300 to-orange-300 bg-clip-text text-transparent">tokens</span>
          </h2>
          <p className="mt-2 text-sm text-slate-400">On top of your monthly tokens, and they last {tokens.bought_months} months.</p>
        </div>
        <p className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-slate-300">
          <ShieldCheck className="h-4 w-4 text-emerald-300" />Secure checkout with Stripe
        </p>
      </div>
      <fieldset className="relative mt-8 grid gap-4 sm:grid-cols-3 sm:gap-5">
        <legend className="sr-only">Token packs</legend>
        {packs.map((item, place) => (
          <PackCard key={item.id} name={id} pack={item} index={place} look={LOOKS[Math.min(place, LOOKS.length - 1)]} chosen={item.id === chosen}
            best={item === best} save={Math.round((1 - rate(item) / priciest) * 100)} worth={worth(item.tokens)} disabled={buying}
            onChoose={() => setChosen(item.id)} />
        ))}
      </fieldset>
      {pack && (
        <div className="ts-checkout relative mt-7 overflow-hidden rounded-[26px] border p-4 sm:p-6"
          style={{ "--ts-tone": LOOKS[Math.min(index, LOOKS.length - 1)].rgb } as CSSProperties}>
          <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <BalanceFlow now={tokens.balance} add={pack.tokens} />
            <div className="lg:text-right">
              <p key={`${pack.id}-price`} className="token-rise font-mono text-3xl font-bold tabular-nums tracking-tight text-white">{formatPrice(pack.amount, pack.currency)}</p>
              <p className="text-xs text-slate-400">One payment · lasts until {expiry(tokens.bought_months)}</p>
            </div>
          </div>
          <StartNowConsent kind="tokens" checked={startNow} onChange={setStartNow} attempt={attempt} disabled={buying} className="relative mt-5 border-t border-white/[0.07] pt-5" />
          <div className="relative mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
            <button type="button" onClick={() => void buy()} disabled={buying}
              className="ts-cta inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-full px-7 text-[15px] font-semibold">
              {buying
                ? <><Loader2 className="h-4 w-4 animate-spin" />Opening checkout…</>
                : <><CreditCard className="h-4 w-4" />Buy {tokenCount(pack.tokens)} · {formatPrice(pack.amount, pack.currency)}</>}
            </button>
            <p className="text-xs leading-5 text-slate-500">Bought tokens aren&apos;t refundable. The tokens that expire first are always spent first.</p>
          </div>
          {error && <div className="relative mt-3"><Banner tone="error">{error}</Banner></div>}
        </div>
      )}
    </section>
  )
}

/** When tokens bought today would expire: "26 Dec". */
function expiry(months: number) {
  const until = new Date()
  until.setMonth(until.getMonth() + months)
  return shortDay(until.toISOString())
}

/** The balance now, what the chosen pack adds and the balance after: the last counting to its new total. */
function BalanceFlow({ now, add }: { now: number; add: number }) {
  const after = useTween(now + add, 900)
  return (
    <div className="flex items-end gap-2.5 sm:gap-4">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Now</p>
        <p className="font-mono text-xl font-bold tabular-nums text-slate-300 sm:text-2xl">{now.toLocaleString()}</p>
      </div>
      <span aria-hidden className="ts-chevrons mb-3 flex"><i /><i /><i /></span>
      <span key={add} className="token-pop mb-1 inline-flex shrink-0 items-center gap-1.5 rounded-full border border-amber-300/30 bg-amber-300/10 py-1 pl-1 pr-3 text-sm font-bold tabular-nums text-amber-100">
        <Coin size={22} />+{add.toLocaleString()}
      </span>
      <span aria-hidden className="ts-chevrons mb-3 flex"><i /><i /><i /></span>
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-accent">
          <span className="sm:hidden">After</span><span className="hidden sm:inline">Your balance after</span>
        </p>
        <p className="ts-balance font-mono text-2xl font-bold tabular-nums sm:text-3xl">{Math.round(after).toLocaleString()}</p>
      </div>
    </div>
  )
}

// Coins rising off the chosen pack's stage: where each starts and when.
const FLYERS = [{ x: "22%", d: "0s" }, { x: "70%", d: "0.9s" }, { x: "46%", d: "1.8s" }]

/** What a pack's token costs, to a tenth of a cent when that matters: 7.5¢ shows as $0.075, never rounded to $0.07. */
const tokenPrice = (pack: TokenPack) => new Intl.NumberFormat("en-US", {
  style: "currency", currency: pack.currency.toUpperCase(), minimumFractionDigits: 2, maximumFractionDigits: 3,
}).format(pack.amount / pack.tokens / 100)

/** One pack, as a radio: its coins on a lit stage, how many tokens, what they're worth, the price and what it saves.
 *  A row on a phone, a card above; the chosen one lifts, with light running round it. */
function PackCard({ name, pack, index, look, chosen, best, save, worth, disabled, onChoose }: {
  name: string; pack: TokenPack; index: number; look: (typeof LOOKS)[number]; chosen: boolean; best: boolean; save: number
  worth: string; disabled: boolean; onChoose: () => void
}) {
  return (
    <div className="token-rise h-full" style={{ "--rise-delay": `${200 + index * 110}ms` } as CSSProperties}>
      <Tilt max={9} className="h-full">
        <div data-chosen={chosen || undefined} className="ts-pack group relative h-full" style={{ "--accent-rgb": look.rgb } as CSSProperties}>
          <div aria-hidden className="ts-pack-glow" />
          <div className={cn("relative h-full rounded-[26px] p-px has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-white/60",
            chosen ? "store-border" : "bg-white/[0.09] transition-colors duration-300 group-hover:bg-white/[0.18]")}>
            {best && (
              <span className="absolute -top-3 right-5 z-20 inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-[0.14em] text-slate-950"
                style={{ background: look.color, boxShadow: `0 6px 18px ${look.color}66` }}>
                <Sparkles className="h-3 w-3" />Best value
              </span>
            )}
            <label className={cn("relative flex h-full items-center gap-4 overflow-hidden rounded-[25px] p-3 transition-colors duration-500 sm:flex-col sm:items-stretch sm:gap-0",
              disabled ? "cursor-default" : "cursor-pointer",
              chosen ? "bg-[linear-gradient(170deg,#11222c,#0a1219_72%)]" : "bg-[linear-gradient(170deg,#121c26,#090e14_72%)]")}>
              <input type="radio" name={name} value={pack.id} checked={chosen} onChange={onChoose} disabled={disabled} className="sr-only" />
              {best && <span className="sr-only">Best value.</span>}
              <div aria-hidden className="store-sheen pointer-events-none absolute inset-0 z-10" />
              {/* stage */}
              <div className="relative flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-[18px] sm:h-48 sm:w-full"
                style={{ background: `radial-gradient(circle at 50% 78%, rgba(${look.rgb},${chosen ? 0.36 : 0.18}), transparent 62%), linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0))` }}>
                {/* a spotlight from above, and the lit disc the coins stand on */}
                <div aria-hidden className="ts-spotlight pointer-events-none absolute inset-0 hidden sm:block" style={{ "--accent-rgb": look.rgb } as CSSProperties} />
                <div aria-hidden className="ts-pedestal pointer-events-none absolute inset-x-[16%] bottom-[9%] h-4 rounded-[50%] sm:inset-x-[20%] sm:bottom-[16%] sm:h-6" />
                <div aria-hidden className="pointer-events-none absolute inset-x-[26%] bottom-[12%] h-3 rounded-[50%] bg-black/60 blur-md transition-transform duration-700 group-hover:scale-x-110 sm:bottom-[19%]" />
                {chosen && FLYERS.map((flyer, place) => (
                  <span key={place} aria-hidden className="ts-fly hidden sm:block" style={{ "--x": flyer.x, "--d": flyer.d } as CSSProperties}><Coin size={16} /></span>
                ))}
                <CoinPile piles={look.piles} lively={chosen}
                  className="h-[72px] w-[92px] transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:-translate-y-1.5 sm:h-[140px] sm:w-[186px]" />
                <span aria-hidden className={cn("absolute left-3 top-3 hidden h-6 w-6 items-center justify-center rounded-full border transition-all duration-300 sm:flex",
                  chosen ? "border-transparent text-slate-950" : "border-white/25 bg-black/25")}
                  style={chosen ? { background: look.color, boxShadow: `0 0 18px ${look.color}aa` } : undefined}>
                  {chosen && <Check className="h-3.5 w-3.5" strokeWidth={3.5} />}
                </span>
              </div>
              {/* details */}
              <div className="relative min-w-0 flex-1 sm:px-2 sm:pb-2 sm:pt-5">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: look.light }}>
                  {look.name}{save > 0 && <span className="text-slate-500"> · Save {save}%</span>}
                </p>
                <p className="mt-1 flex items-baseline gap-1.5">
                  <span className="text-3xl font-bold tabular-nums tracking-tight text-white sm:text-5xl">{pack.tokens.toLocaleString()}</span>
                  <span className="text-sm font-medium text-slate-400">tokens</span>
                </p>
                {worth && <p className="mt-1.5 text-xs leading-5 text-slate-400">{worth}</p>}
                <div className="mt-3 flex items-end justify-between gap-2 sm:mt-5 sm:border-t sm:border-white/[0.07] sm:pt-4">
                  <div>
                    <p className="font-mono text-lg font-bold tabular-nums text-white sm:text-2xl">{formatPrice(pack.amount, pack.currency)}</p>
                    <p className="text-[11px] text-slate-500">{tokenPrice(pack)} a token</p>
                  </div>
                  <span className={cn("inline-flex h-8 shrink-0 items-center gap-1 rounded-full px-3 text-xs font-semibold transition-all duration-300",
                    chosen ? "text-slate-950" : "border border-white/12 text-slate-300 group-hover:border-white/25 group-hover:text-white")}
                    style={chosen ? { background: look.color, boxShadow: `0 8px 24px -8px ${look.color}` } : undefined}>
                    {chosen ? <><Check className="h-3.5 w-3.5" strokeWidth={3} />Selected</> : "Choose"}
                  </span>
                </div>
              </div>
            </label>
          </div>
        </div>
      </Tilt>
    </div>
  )
}

// Where a stack's coins sit off-centre, from the bottom up, and the sparkles round the piles.
const JITTER = [0, 2.5, -2, 1.5, -2.5, 1]
const SPARKLES = [[18, 52, 0], [144, 40, 0.9], [138, 86, 1.7]]

/** A pack's coins: stacks of them, dropped on one by one, back to front; they bob while it's the chosen pack. */
function CoinPile({ piles, lively, className }: { piles: number[][]; lively: boolean; className?: string }) {
  const id = `pile${svgId(useId())}`
  const coins = piles.flatMap(([x, count, forward], pile) => Array.from({ length: count }, (_, level) => ({ x, level, forward, pile })))
  return (
    <svg viewBox="0 0 160 120" className={cn("relative overflow-visible", className)} aria-hidden>
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
      <g className={cn(lively && "token-bob")}>
        {coins.map(({ x, level, forward, pile }, order) => {
          const cx = x + JITTER[(level + pile) % JITTER.length]
          const y = 96 + forward - level * 8.5
          return (
            <g key={`${pile}-${level}`} className="token-drop" style={{ "--drop-delay": `${220 + order * 60}ms` } as CSSProperties}>
              <path d={`M${cx - 26} ${y}v6.5a26 8 0 0 0 52 0v-6.5`} fill={`url(#${id}-side)`} />
              <ellipse cx={cx} cy={y} rx="26" ry="8" fill={`url(#${id}-top)`} stroke="#9a6412" strokeOpacity="0.5" strokeWidth="0.8" />
              <ellipse cx={cx} cy={y} rx="19" ry="5.2" fill="none" stroke="#9a6412" strokeOpacity="0.35" strokeWidth="0.8" strokeDasharray="1.5 2.5" />
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

/** Tokens in three steps, joined by a line light travels along (as the plan store's checkout steps). */
function HowItWorks({ tokens }: { tokens: TokenBalance }) {
  const id = useId()
  const steps = [
    { icon: CalendarClock, title: `${tokenCount(tokens.monthly_tokens)} every month`, body: "Fresh with your subscription each month. What's left doesn't carry over." },
    { icon: Sparkles, title: "Spend them on any AI feature", body: "Your coach, your swim and gym weeks, race plans and video analysis." },
    { icon: Coins, title: "Top up whenever you like", body: `Bought tokens last ${tokens.bought_months} months, and failed requests are always free.` },
  ]
  return (
    <section aria-labelledby={`${id}-title`} className="relative px-2 py-4">
      <div className="text-center">
        <h2 id={`${id}-title`} className="text-2xl font-bold tracking-tight text-white sm:text-3xl">How tokens work</h2>
        <p className="mt-2 text-sm text-slate-400">What you get, what they&apos;re for, and how to get more.</p>
      </div>
      <div className="relative mt-9">
        <div aria-hidden className="ts-beam absolute left-[16.7%] right-[16.7%] top-8 hidden h-px sm:block">
          {[0, 1, 2].map((index) => <i key={index} style={{ "--i": index } as CSSProperties} />)}
        </div>
        <ol className="relative grid gap-8 sm:grid-cols-3 sm:gap-6">
          {steps.map(({ icon: Icon, title, body }, index) => (
            <li key={title} className="token-rise text-center" style={{ "--rise-delay": `${150 + index * 140}ms` } as CSSProperties}>
              <span className="ts-step relative mx-auto flex h-16 w-16 items-center justify-center rounded-2xl text-accent">
                <Icon className="h-6 w-6" />
                <span className="absolute -right-2.5 -top-2.5 flex h-6 w-6 items-center justify-center rounded-full bg-accent text-xs font-bold text-accent-foreground shadow-[0_0_16px_rgba(87,229,234,0.6)]">{index + 1}</span>
              </span>
              <h3 className="mt-4 font-semibold text-white">{title}</h3>
              <p className="mx-auto mt-1.5 max-w-xs text-sm leading-6 text-slate-400">{body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}

/** A panel with the coach switcher's light: a glow of its colour from the top left and a lit top edge. */
function Panel({ icon: Icon, tone, title, subtitle, children }: { icon: LucideIcon; tone: string; title: string; subtitle: string; children: ReactNode }) {
  const id = useId()
  return (
    <section aria-labelledby={`${id}-title`} className="ts-panel relative flex h-full flex-col overflow-hidden rounded-[28px] border border-white/[0.08] p-5 sm:p-7"
      style={{ "--ts-tone": tone } as CSSProperties}>
      <div aria-hidden className="ts-edge pointer-events-none absolute inset-x-12 top-0 h-px" />
      <div className="relative mb-6 flex items-center gap-3.5">
        <span className="ts-panel-icon flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl"><Icon className="h-5 w-5" /></span>
        <div className="min-w-0">
          <h2 id={`${id}-title`} className="text-lg font-bold tracking-tight text-white sm:text-xl">{title}</h2>
          <p className="text-sm text-slate-400">{subtitle}</p>
        </div>
      </div>
      <div className="relative flex flex-1 flex-col">{children}</div>
    </section>
  )
}

/** What each AI feature costs, with how many of each the balance covers. */
function Costs({ tokens }: { tokens: TokenBalance }) {
  return (
    <Panel icon={Zap} tone={AMBER} title="What things cost" subtitle="Tokens are taken as the AI starts working">
      <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-2 2xl:grid-cols-3">
        {tokens.costs.map((cost, index) => (
          <CostTile key={cost.action} action={cost.action} cost={cost.tokens} full={fullCost(cost.action, tokens.costs)} balance={tokens.balance} index={index} />
        ))}
      </ul>
      <div className="pt-4">
        <div className="flex items-start gap-3 rounded-2xl border border-emerald-300/15 bg-emerald-400/[0.06] p-3.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-400/15"><Undo2 className="h-4 w-4 text-emerald-300" /></span>
          <p className="text-xs leading-5 text-slate-300">
            <span className="font-semibold text-emerald-200">Failed requests are free.</span> If something fails, or you leave before a week is saved, its tokens come straight back.
          </p>
        </div>
      </div>
    </Panel>
  )
}

/** One feature's price (`full`: what a use takes in all, with what it comes with); under a mouse, a light of its colour
 *  follows the pointer. */
function CostTile({ action, cost, full, balance, index }: { action: string; cost: number; full: number; balance: number; index: number }) {
  const { does, icon: Icon, color } = featureOf(action)
  const times = full > 0 ? Math.floor(balance / full) : 0
  const follow = (event: PointerEvent<HTMLLIElement>) => {
    if (event.pointerType !== "mouse") return
    const box = event.currentTarget.getBoundingClientRect()
    event.currentTarget.style.setProperty("--sx", `${event.clientX - box.left}px`)
    event.currentTarget.style.setProperty("--sy", `${event.clientY - box.top}px`)
  }
  return (
    <li onPointerMove={follow} className="ts-cost token-rise relative flex flex-col gap-3 overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.025] p-3.5"
      style={{ "--c": color, "--rise-delay": `${300 + index * 50}ms` } as CSSProperties}>
      <span aria-hidden className="ts-spot pointer-events-none absolute inset-0" />
      <div className="relative flex items-start justify-between gap-2">
        <span className="ts-orb flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"><Icon className="h-[18px] w-[18px]" /></span>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-300/25 bg-amber-300/[0.08] py-0.5 pl-1 pr-2.5 text-sm font-bold tabular-nums text-amber-100"
          aria-label={tokenCount(cost)}>
          <Coin size={16} />{cost}
        </span>
      </div>
      <div className="relative">
        <p className="text-sm font-medium leading-5 text-white">{does}</p>
        <p className="mt-1 text-[11px] text-slate-500">{times ? `${times.toLocaleString()}× with your balance` : "Top up to use it"}</p>
      </div>
    </li>
  )
}

/** The latest AI requests: how their tokens split between features, then each one, by day; all of them in a window. */
function Activity({ tokens }: { tokens: TokenBalance }) {
  const [everything, setEverything] = useState(false)
  const items = tokens.recent
  return (
    <Panel icon={History} tone={CYAN} title="Where your tokens went" subtitle="Your latest AI requests">
      {items.length ? (
        <>
          <Spending items={items} />
          <SpendDays items={items.slice(0, FIRST_ROWS)} className="mt-6" />
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
                    <Spending items={items} />
                    <SpendDays items={items} pinned className="mt-6" />
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          )}
        </>
      ) : (
        <div className="flex flex-col items-center py-8 text-center">
          <Coin size={52} className="token-pop" />
          <p className="mt-4 font-semibold text-white">Nothing spent yet</p>
          <p className="mt-1 max-w-xs text-sm leading-6 text-slate-400">Each time the AI works for you, it shows up here.</p>
        </div>
      )}
    </Panel>
  )
}

/** The latest requests' tokens split by feature: a ring drawn round, and each feature's share; given back counted apart. */
function Spending({ items }: { items: Spend[] }) {
  const totals = new Map<string, number>()
  for (const item of items) {
    if (!item.returned) totals.set(item.action ?? "", (totals.get(item.action ?? "") ?? 0) + item.tokens)
  }
  const parts = [...totals].sort((a, b) => b[1] - a[1])
  const used = sum(parts.map(([, tokens]) => tokens))
  const back = sum(items.filter((item) => item.returned).map((item) => item.tokens))
  if (!used && !back) return null
  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row">
      <Donut parts={parts} used={used} />
      <div className="w-full min-w-0 flex-1">
        <ul className="space-y-2.5">
          {parts.slice(0, 5).map(([action, tokens], index) => {
            const { many, color } = featureOf(action)
            return (
              <li key={action} className="token-rise" style={{ "--rise-delay": `${250 + index * 90}ms` } as CSSProperties}>
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="flex min-w-0 items-center gap-2 text-slate-300">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
                    <span className="truncate first-letter:uppercase">{many}</span>
                  </span>
                  <span className="shrink-0 tabular-nums text-slate-500"><span className="font-semibold text-white">{tokens.toLocaleString()}</span> · {Math.round((tokens / used) * 100)}%</span>
                </div>
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/[0.05]">
                  <div className="store-fill h-full rounded-full" style={{ width: `${(tokens / used) * 100}%`, background: color, "--fill-delay": `${350 + index * 110}ms` } as CSSProperties} />
                </div>
              </li>
            )
          })}
        </ul>
        {back > 0 && (
          <p className="mt-3 inline-flex items-center gap-1 rounded-full bg-emerald-400/[0.1] px-2.5 py-1 text-xs font-medium text-emerald-300">
            <Undo2 className="h-3.5 w-3.5" />{back.toLocaleString()} given back
          </p>
        )}
      </div>
    </div>
  )
}

/** A ring of the features' shares, each segment drawn round in turn, with the tokens used in the middle. */
function Donut({ parts, used }: { parts: [string, number][]; used: number }) {
  const drawn = useDrawn()
  const total = useTween(used, 1200)
  const radius = 50
  const around = 2 * Math.PI * radius
  const gap = parts.length > 1 ? 3 : 0
  let start = 0
  return (
    <div className="relative h-36 w-36 shrink-0">
      <div aria-hidden className="absolute inset-5 rounded-full bg-accent/10 blur-2xl" />
      <svg viewBox="0 0 120 120" className="relative h-full w-full -rotate-90" aria-hidden>
        <circle cx="60" cy="60" r={radius} fill="none" stroke="white" strokeOpacity="0.06" strokeWidth="11" />
        {parts.map(([action, tokens], index) => {
          const length = (tokens / used) * around
          const offset = start
          start += length
          const { color } = featureOf(action)
          return (
            <circle key={action} cx="60" cy="60" r={radius} fill="none" stroke={color} strokeWidth="11"
              strokeDasharray={`${drawn ? Math.max(0.5, length - gap) : 0} ${around}`} strokeDashoffset={-offset} className="ts-seg"
              style={{ "--seg-delay": `${200 + index * 130}ms`, filter: `drop-shadow(0 0 4px ${color}88)` } as CSSProperties} />
          )
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <p className="text-3xl font-bold tabular-nums tracking-tight text-white">{Math.round(total).toLocaleString()}</p>
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">used</p>
      </div>
    </div>
  )
}

/** Requests by day, newest first, on a timeline. `pinned`: in the full list's window, each day's heading stays in view
 *  as it scrolls. */
function SpendDays({ items, pinned = false, className }: { items: Spend[]; pinned?: boolean; className?: string }) {
  return (
    <ol className={cn("space-y-4", className)}>
      {byDay(items).map(([day, group]) => (
        <li key={day}>
          <p className={cn("mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500",
            pinned && "sticky top-0 z-10 -mx-5 bg-[#0d151c]/95 px-5 py-1.5 backdrop-blur")}>{day}</p>
          <ul className="ts-timeline">
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
    <li className="relative flex items-center gap-3 rounded-xl py-2 pr-1 transition-colors hover:bg-white/[0.025]">
      <span className={cn("relative z-[1] flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-4 ring-[#0b1219]", item.returned && "opacity-50")}
        style={{ background: `color-mix(in srgb, ${color} 14%, #0b1219)`, color, boxShadow: `inset 0 0 0 1px ${color}33` }}>
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
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white/[0.05] py-0.5 pl-1 pr-2.5 text-sm font-semibold tabular-nums text-white">
          <Coin size={14} />−{item.tokens.toLocaleString()}
        </span>
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
