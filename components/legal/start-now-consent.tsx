"use client"

import { useEffect, useId, useRef, type CSSProperties } from "react"
import Link from "next/link"
import { Check } from "lucide-react"
import { cn } from "@/lib/utils"

/*
 * The box a buyer ticks before paying, asking for what they buy to start straight away and, for a buyer living in the EU
 * (the only ones with a right of withdrawal, see Terms, "Your right of withdrawal"), before their 14-day withdrawal
 * period ends. For a training plan or a coach switch it also says that their right of withdrawal then ends (§ 356(5)
 * and (4) BGB); for a subscription, what withdrawing then costs (§ 357a(2) BGB).
 *
 * Checkouts send `start_now: true` once it's ticked, and the backend keeps that with the payment in Stripe, with the
 * date of this wording (START_NOW_VERSION in backend/app/withdrawal.py: change it whenever a wording here changes).
 */
const WORDING = {
  plan: "I want my plan unlocked straight away. If I live in the EU, I agree that it's unlocked before my 14-day withdrawal period ends, and I know that I lose my right of withdrawal once it's unlocked.",
  subscription: "I want my plan to start straight away. If I live in the EU, I agree that it starts before my 14-day withdrawal period ends, and I know that if I withdraw, I pay for the time up to my withdrawal.",
  switch: "I want my coach switch to happen straight away. If I live in the EU, I agree that it happens before my 14-day withdrawal period ends, and I know that I lose my right of withdrawal once the switch is complete.",
}

export function StartNowConsent({ kind, checked, onChange, attempt = 0, disabled = false, className, style }: {
  kind: keyof typeof WORDING
  checked: boolean
  onChange: (checked: boolean) => void
  /** How often they've tried to pay without ticking it: each try points them to the box. */
  attempt?: number
  disabled?: boolean
  className?: string
  /** `--start-now-tone` colours the ticked box (cyan by default). */
  style?: CSSProperties
}) {
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const missing = attempt > 0 && !checked
  useEffect(() => { if (attempt > 0) input.current?.focus() }, [attempt])
  return (
    <div className={className} style={style}>
      <label className={cn("flex items-start gap-3 text-left", disabled ? "cursor-default" : "cursor-pointer")}>
        <input ref={input} type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)}
          aria-invalid={missing || undefined} aria-describedby={missing ? `${id}-missing` : undefined} className="peer sr-only" />
        {/* Keyed by the try, so each one shakes it again */}
        <span key={attempt} aria-hidden className={cn(
          "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-[6px] border transition-colors duration-200 peer-focus-visible:ring-2 peer-focus-visible:ring-white/50 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-[#0a1118]",
          checked ? "border-transparent bg-[var(--start-now-tone,#57e5ea)] text-slate-950"
            : missing ? "au-shake border-rose-300/80 bg-rose-400/10" : "border-white/25 bg-white/[0.04]")}>
          {checked && <Check className="h-3.5 w-3.5" strokeWidth={3.5} />}
        </span>
        <span className="text-xs leading-5 text-slate-300">
          {WORDING[kind]}{" "}
          <Link href="/terms#withdrawal" target="_blank" className="text-slate-400 underline decoration-white/25 underline-offset-2 transition-colors hover:text-white">
            Your right of withdrawal
          </Link>
        </span>
      </label>
      {missing && <p id={`${id}-missing`} role="alert" className="mt-2 pl-8 text-xs font-medium text-rose-200">Tick the box to continue.</p>}
    </div>
  )
}
