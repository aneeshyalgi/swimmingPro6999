"use client"

import { useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react"
import { Check, Star, type LucideIcon } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

export const RATING_WORDS = ["Poor", "Fair", "Good", "Very good", "Excellent"]
export const LEVEL_TONES = ["#fb7185", "#fb923c", "#fbbf24", "#38bdf8", "#34d399"]
const SPARKS = [0, 45, 90, 135, 180, 225, 270, 315]

export type Option<T extends string> = { value: T; label: string; detail?: string; icon: LucideIcon }

/** A soft light that follows the mouse across a card. */
function spotlight(event: PointerEvent<HTMLElement>) {
  if (event.pointerType !== "mouse") return
  const box = event.currentTarget.getBoundingClientRect()
  event.currentTarget.style.setProperty("--mx", `${event.clientX - box.left}px`)
  event.currentTarget.style.setProperty("--my", `${event.clientY - box.top}px`)
}

/** A ripple spreading from where a card was pressed, like a drop in water. */
function useRipple() {
  const [ripple, setRipple] = useState<{ id: number; x: number; y: number } | null>(null)
  const press = (event: PointerEvent<HTMLElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    setRipple({ id: event.timeStamp, x: event.clientX - box.left, y: event.clientY - box.top })
  }
  const node = ripple && <span aria-hidden key={ripple.id} className="sv-ripple" style={{ left: ripple.x, top: ripple.y }} />
  return [node, press] as const
}

/** Arrow keys step a rating up and down, as in any radio group (which Tab enters and leaves as one stop). */
const ARROWS: Record<string, number> = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }
function arrowKeys(value: number | null, min: number, max: number, onChange: (value: number) => void) {
  return (event: KeyboardEvent<HTMLDivElement>) => {
    const step = ARROWS[event.key]
    if (!step) return
    event.preventDefault()
    const next = Math.min(max, Math.max(min, (value ?? min - step) + step))
    onChange(next)
    event.currentTarget.querySelector<HTMLButtonElement>(`[data-value="${next}"]`)?.focus()
  }
}

/** An answer card to choose (`radio`) or tick (`checkbox`). A `tile` stacks its icon above its name on phones. */
export function OptionCard({ role, checked, onSelect, option, index, layout = "row" }: {
  role: "radio" | "checkbox"; checked: boolean; onSelect: () => void; option: Option<string>; index: number; layout?: "row" | "tile"
}) {
  const [ripple, press] = useRipple()
  const tile = layout === "tile"
  return (
    <button type="button" role={role} aria-checked={checked} onClick={onSelect} onPointerDown={press} onPointerMove={spotlight}
      style={{ "--i": index } as CSSProperties}
      className={cn("sv-option sv-in group flex text-left", checked && "is-on",
        tile ? "min-w-0 flex-col items-start gap-3 p-3.5 pr-10 sm:flex-row sm:items-center sm:p-4 sm:pr-12" : "items-center gap-3.5 p-4 pr-14")}>
      <span aria-hidden className="sv-spot" />
      {ripple}
      <span key={String(checked)} className={cn("sv-option-icon grid shrink-0 place-items-center rounded-xl", tile ? "h-10 w-10" : "h-11 w-11")}>
        <option.icon className="h-5 w-5" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold leading-5 text-white sm:text-[15px]">{option.label}</span>
        {option.detail && <span className={cn("mt-0.5 block text-xs leading-5 text-slate-400", tile && "max-sm:hidden")}>{option.detail}</span>}
      </span>
      <span aria-hidden className={cn("sv-tick-badge absolute grid h-6 w-6 place-items-center", role === "checkbox" ? "rounded-lg" : "rounded-full",
        tile ? "right-3 top-3 sm:right-4 sm:top-1/2 sm:-translate-y-1/2" : "right-4 top-1/2 -translate-y-1/2")}>
        <Check className="h-3.5 w-3.5" strokeWidth={3} />
      </span>
    </button>
  )
}

/** One answer from a few, as cards. */
export function ChoiceGroup<T extends string>({ label, options, value, onChange, offset = 0 }: {
  label: string; options: Option<T>[]; value: T | null; onChange: (value: T) => void; offset?: number
}) {
  return (
    <div role="radiogroup" aria-label={label} className="grid gap-2.5 sm:grid-cols-2 sm:gap-3">
      {options.map((option, index) => (
        <OptionCard key={option.value} role="radio" option={option} index={index + offset} checked={value === option.value}
          onSelect={() => onChange(option.value)} />
      ))}
    </div>
  )
}

/** Answers to pick as chips. With `most`, the others dim once that many are picked, and pips count the picks. */
export function Picks<T extends string>({ label, options, value, onToggle, most, offset = 0 }: {
  label: string; options: Option<T>[]; value: T[]; onToggle: (value: T) => void; most?: number; offset?: number
}) {
  const full = most !== undefined && value.length >= most
  return (
    <div>
      <div role="group" aria-label={label} className="flex flex-wrap gap-2.5">
        {options.map((option, index) => {
          const active = value.includes(option.value)
          const blocked = full && !active
          return (
            <button key={option.value} type="button" aria-pressed={active} aria-disabled={blocked || undefined} onClick={() => onToggle(option.value)}
              onPointerMove={spotlight} style={{ "--i": index + offset } as CSSProperties}
              className={cn("sv-chip sv-in inline-flex items-center gap-2.5 rounded-full py-2 pl-2 pr-3 text-left text-sm font-medium sm:py-2.5 sm:pl-2.5 sm:pr-3.5",
                active && "is-on", blocked && "is-blocked")}>
              <span aria-hidden className="sv-spot" />
              <span key={String(active)} className="sv-chip-icon grid h-7 w-7 shrink-0 place-items-center rounded-full"><option.icon className="h-3.5 w-3.5" /></span>
              {option.label}
              <span aria-hidden className="sv-tick-badge grid h-4 w-4 shrink-0 place-items-center rounded-full"><Check strokeWidth={3} className="h-2.5 w-2.5" /></span>
            </button>
          )
        })}
      </div>
      {most !== undefined && (
        <p aria-live="polite" className={cn("mt-4 flex items-center gap-2.5 text-xs font-medium transition-colors duration-300", full ? "text-white" : "text-slate-500")}>
          <span aria-hidden className="flex gap-1.5">
            {Array.from({ length: most }, (_, index) => <span key={index} className={cn("sv-pip", index < value.length && "is-on")} />)}
          </span>
          {value.length} of {most} picked{full && ". Untick one to choose another."}
        </p>
      )}
    </div>
  )
}

/** One to five stars: they fill like liquid one after another, a mouse previews them, and the chosen one throws sparks. */
export function StarRating({ value, onChange, label, size }: { value: number | null; onChange: (value: number) => void; label: string; size: "lg" | "sm" }) {
  const [preview, setPreview] = useState<number | null>(null)
  const large = size === "lg"
  return (
    <div role="radiogroup" aria-label={label} onKeyDown={arrowKeys(value, 1, 5, onChange)} onPointerLeave={() => setPreview(null)}
      className={cn("flex shrink-0 items-center", large ? "gap-1 sm:gap-3" : "gap-0.5 sm:gap-1")}>
      {[1, 2, 3, 4, 5].map((level) => {
        const chosen = preview === null && value !== null && level <= value
        const previewed = preview !== null && level <= preview
        return (
          <button key={level} type="button" role="radio" aria-checked={value === level} data-value={level} tabIndex={(value ?? 1) === level ? 0 : -1}
            aria-label={`${level} out of 5, ${RATING_WORDS[level - 1].toLowerCase()}`}
            // Choosing ends the preview, so the chosen stars fill and spark straight away under the mouse.
            onClick={() => { setPreview(null); onChange(level) }} onPointerEnter={(event) => { if (event.pointerType === "mouse") setPreview(level) }}
            className={cn("sv-star relative grid place-items-center rounded-2xl", large ? "h-[3.75rem] w-[3.75rem] sm:h-20 sm:w-20" : "h-8 w-8 sm:h-9 sm:w-9")}>
            <Star strokeWidth={1.4} className={cn("absolute inset-0 m-auto h-[72%] w-[72%] transition-colors duration-200", previewed ? "text-amber-200" : "text-slate-600")} />
            {previewed && <Star strokeWidth={1.4} className="absolute inset-0 m-auto h-[72%] w-[72%] fill-amber-200/70 text-amber-200" />}
            {chosen && (
              <span key={`on-${value}`} aria-hidden className="sv-star-glow absolute inset-0 m-auto h-[72%] w-[72%]">
                <Star strokeWidth={1.4} style={{ "--i": level - 1 } as CSSProperties} className="sv-star-on h-full w-full fill-amber-300 text-amber-300" />
              </span>
            )}
            {large && preview === null && value === level && (
              <span key={`sparks-${value}`} aria-hidden className="sv-sparks" style={{ "--i": level - 1 } as CSSProperties}>
                {SPARKS.map((angle) => <i key={angle} style={{ "--a": `${angle}deg` } as CSSProperties} />)}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

const BANDS = ["#fb7185", "#fb7185", "#fb7185", "#fb7185", "#fb7185", "#fb7185", "#fb7185", "#fbbf24", "#fbbf24", "#34d399", "#34d399"]

/** 0 to 10, how likely they are to recommend SwimGPT (the Net Promoter Score question), on a band from rose to emerald. */
export function ScoreScale({ value, onChange }: { value: number | null; onChange: (value: number) => void }) {
  const reply = value === null ? null : value >= 9 ? "That means a lot. Thank you!"
    : value >= 7 ? "Thanks! What would make it a 10? Tell us below." : "Thanks for being honest. What would change your mind? Tell us below."
  return (
    <div>
      <div role="radiogroup" aria-label="How likely you are to recommend SwimGPT, from 0 (not likely) to 10 (very likely)"
        onKeyDown={arrowKeys(value, 0, 10, onChange)} className="grid grid-cols-11 gap-1 sm:gap-1.5">
        {BANDS.map((band, score) => {
          const on = value === score
          return (
            <button key={score} type="button" role="radio" aria-checked={on} data-value={score} tabIndex={(value ?? 0) === score ? 0 : -1}
              onClick={() => onChange(score)} style={{ "--band": band, "--i": score } as CSSProperties}
              className={cn("sv-score sv-in h-12 rounded-xl text-sm font-bold tabular-nums sm:h-14 sm:text-base", on && "is-on")}>
              {score}
              {on && <span key={`ring-${score}`} aria-hidden className="sv-score-ring" />}
            </button>
          )
        })}
      </div>
      <div aria-hidden className="sv-band mt-3 h-1 rounded-full opacity-40" />
      <div aria-hidden className="mt-2 flex justify-between text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500"><span>Not likely</span><span>Very likely</span></div>
      {reply && <p key={reply} className="sv-rise mt-5 text-sm text-slate-200 sm:text-base">{reply}</p>}
    </div>
  )
}

/** Optional free text, with a count once it nears its limit. */
export function Note({ label, value, onChange, max, placeholder, index }: {
  label: string; value: string; onChange: (value: string) => void; max: number; placeholder: string; index: number
}) {
  return (
    <label className="sv-rise block" style={{ "--i": index } as CSSProperties}>
      <span className="flex items-center gap-2 text-sm font-semibold text-slate-200">
        {label}
        <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">Optional</span>
      </span>
      <Textarea value={value} maxLength={max} rows={3} placeholder={placeholder} onChange={(event) => onChange(event.target.value)}
        className="sv-field mt-2.5 min-h-[104px] resize-y px-4 py-3 placeholder:text-slate-500 focus-visible:ring-0 focus-visible:ring-offset-0" />
      {value.length > max * 0.8 && <span className="mt-1.5 block text-right text-[11px] tabular-nums text-slate-500">{value.length} / {max}</span>}
    </label>
  )
}

/** A yes-or-no question answered with a switch, which its title and detail toggle too. With `index` it rises into place. */
export function SwitchRow({ title, detail, checked, onChange, index }: {
  title: string; detail: string; checked: boolean; onChange: (checked: boolean) => void; index?: number
}) {
  return (
    <label className={cn("sv-toggle-row flex cursor-pointer items-start gap-3.5 rounded-2xl p-4", index !== undefined && "sv-rise")}
      style={index === undefined ? undefined : ({ "--i": index } as CSSProperties)}>
      <Switch checked={checked} onCheckedChange={onChange}
        className="mt-0.5 data-[state=checked]:bg-[var(--sv-tone)] data-[state=unchecked]:bg-white/15" />
      <span>
        <span className="block text-sm font-semibold text-white">{title}</span>
        <span className="mt-0.5 block text-xs leading-5 text-slate-400">{detail}</span>
      </span>
    </label>
  )
}
