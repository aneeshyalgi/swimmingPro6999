"use client"

import type { ComponentProps, ReactNode } from "react"
import type { LucideIcon } from "lucide-react"
import { Check, Minus, Plus } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Slider } from "@/components/ui/slider"
import { cn } from "@/lib/utils"
import { parseTimeText, type TimeParts } from "@/lib/swim-time"

export const inputClass =
  "h-11 rounded-xl border-white/10 bg-white/[0.03] px-4 text-base text-white placeholder:text-slate-500 focus-visible:border-accent/60 focus-visible:ring-accent/20 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"

export function Field({
  label,
  htmlFor,
  required,
  optional,
  hint,
  error,
  className,
  children,
}: {
  label: string
  htmlFor?: string
  required?: boolean
  optional?: boolean
  hint?: string
  error?: string
  className?: string
  children: ReactNode
}) {
  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={htmlFor} className="text-sm font-medium text-slate-200">
          {label}
          {required && <span className="ml-0.5 text-accent">*</span>}
        </label>
        {optional && <span className="text-xs text-slate-500">Optional</span>}
      </div>
      {children}
      {error ? (
        <p role="alert" className="text-xs font-medium text-rose-300">
          {error}
        </p>
      ) : (
        hint && <p className="text-xs text-slate-500">{hint}</p>
      )}
    </div>
  )
}

export function UnitInput({ unit, className, ...props }: ComponentProps<typeof Input> & { unit?: string }) {
  return (
    <div className="relative">
      <Input {...props} className={cn(inputClass, unit && "pr-14", className)} />
      {unit && (
        <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-sm text-slate-500">{unit}</span>
      )}
    </div>
  )
}

type ChoiceOption = { value: string; label: string; detail?: string; icon?: LucideIcon }

export function ChoiceCards({
  id,
  options,
  value,
  onChange,
  invalid,
  columns = "sm:grid-cols-2",
  label,
}: {
  id: string
  options: ChoiceOption[]
  value: string
  onChange: (value: string) => void
  invalid?: boolean
  columns?: string
  label: string
}) {
  return (
    <div id={id} tabIndex={-1} role="radiogroup" aria-label={label} className={cn("grid gap-3 outline-none", columns)}>
      {options.map((option) => {
        const selected = value === option.value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              "group relative flex items-center gap-3 rounded-2xl border p-4 text-left transition-all duration-200",
              selected
                ? "border-accent/70 bg-accent/[0.09] shadow-[0_0_0_1px_rgba(87,229,234,0.25),0_10px_30px_rgba(87,229,234,0.08)]"
                : invalid
                  ? "border-rose-400/40 bg-white/[0.02] hover:border-rose-300/60"
                  : "border-white/10 bg-white/[0.02] hover:border-white/25 hover:bg-white/[0.04]",
            )}
          >
            {option.icon && (
              <span
                className={cn(
                  "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors",
                  selected ? "bg-accent text-accent-foreground" : "bg-white/[0.05] text-slate-300 group-hover:text-white",
                )}
              >
                <option.icon className="h-5 w-5" />
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-white">{option.label}</span>
              {option.detail && <span className="mt-0.5 block text-xs text-slate-400">{option.detail}</span>}
            </span>
            <span
              className={cn(
                "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-all",
                selected ? "border-accent bg-accent text-accent-foreground" : "border-white/20 text-transparent",
              )}
            >
              <Check className="h-3 w-3" strokeWidth={3} />
            </span>
          </button>
        )
      })}
    </div>
  )
}

export function Segmented({
  id,
  options,
  value,
  onChange,
  invalid,
  label,
}: {
  id: string
  options: { value: string; label: string }[]
  value: string
  onChange: (value: string) => void
  invalid?: boolean
  label: string
}) {
  return (
    <div
      id={id}
      tabIndex={-1}
      role="radiogroup"
      aria-label={label}
      className={cn(
        "grid gap-1 rounded-xl border bg-white/[0.03] p-1 outline-none",
        invalid ? "border-rose-400/40" : "border-white/10",
      )}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((option) => {
        const selected = value === option.value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              "h-9 whitespace-nowrap rounded-lg px-1 text-sm font-medium transition-all sm:px-2",
              selected ? "bg-accent text-accent-foreground shadow-[0_4px_14px_rgba(87,229,234,0.25)]" : "text-slate-300 hover:bg-white/[0.05] hover:text-white",
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

export function Chip({
  selected,
  disabled,
  onClick,
  children,
}: {
  selected: boolean
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm font-medium transition-all",
        selected
          ? "border-accent/70 bg-accent text-accent-foreground shadow-[0_4px_16px_rgba(87,229,234,0.22)]"
          : "border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/25 hover:text-white",
        disabled && "cursor-not-allowed opacity-35 hover:border-white/10 hover:text-slate-300",
      )}
    >
      {selected && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
      {children}
    </button>
  )
}

export function CountControl({
  id,
  label,
  value,
  min,
  max,
  unit,
  onChange,
}: {
  id: string
  label: string
  value: number
  min: number
  max: number
  unit: string
  onChange: (value: number) => void
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p id={`${id}-label`} className="text-sm font-medium text-slate-200">
            {label}
          </p>
          <p className="mt-1 text-3xl font-bold tabular-nums text-white">
            {value}
            <span className="ml-1.5 text-sm font-normal text-slate-400">
              {unit}
              {value === 1 ? "" : "s"} / week
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label={`Decrease ${label.toLowerCase()}`}
            onClick={() => onChange(Math.max(min, value - 1))}
            disabled={value <= min}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-white transition-colors hover:bg-white/[0.09] disabled:opacity-30"
          >
            <Minus className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label={`Increase ${label.toLowerCase()}`}
            onClick={() => onChange(Math.min(max, value + 1))}
            disabled={value >= max}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-white transition-colors hover:bg-white/[0.09] disabled:opacity-30"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>
      <Slider
        aria-labelledby={`${id}-label`}
        value={[value]}
        onValueChange={([next]) => onChange(next)}
        min={min}
        max={max}
        step={1}
        className="mt-5 [&_[data-slot=slider-range]]:bg-accent [&_[data-slot=slider-thumb]]:size-5 [&_[data-slot=slider-thumb]]:border-accent [&_[data-slot=slider-thumb]]:shadow-[0_0_12px_rgba(87,229,234,0.5)] [&_[data-slot=slider-track]]:h-2 [&_[data-slot=slider-track]]:bg-white/10"
      />
      <div className="mt-2 flex justify-between text-xs text-slate-500">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  )
}

const timeSegments = [
  { key: "minutes", caption: "min", suffix: "", placeholder: "0" },
  { key: "seconds", caption: "sec", suffix: "-sec", placeholder: "00" },
  { key: "hundredths", caption: "1/100", suffix: "-hundredths", placeholder: "00" },
] as const

export function TimeInput({
  id,
  label,
  value,
  onChange,
  invalid,
}: {
  id: string
  label: string
  value: TimeParts
  onChange: (value: TimeParts) => void
  invalid?: boolean
}) {
  const focusSegment = (index: number) => {
    const target = document.getElementById(`${id}${timeSegments[index]?.suffix ?? ""}`) as HTMLInputElement | null
    if (target && index >= 0 && index < timeSegments.length) {
      target.focus()
      target.select()
    }
  }

  const setSegment = (key: keyof TimeParts, text: string) => onChange({ ...value, [key]: text })

  return (
    <div
      className={cn(
        "flex items-stretch rounded-xl border bg-white/[0.03] px-1 transition-[border-color,box-shadow]",
        "focus-within:border-accent/60 focus-within:ring-[3px] focus-within:ring-accent/20",
        invalid ? "border-rose-400/70" : "border-white/10",
      )}
    >
      {timeSegments.map((segment, index) => (
        <div key={segment.key} className="flex flex-1 items-stretch">
          {index > 0 && (
            <span aria-hidden="true" className="flex items-center pb-3 font-mono text-lg text-slate-500">
              {index === 1 ? ":" : "."}
            </span>
          )}
          <label className="flex min-w-0 flex-1 cursor-text flex-col items-center pb-1.5 pt-2">
            <input
              id={`${id}${segment.suffix}`}
              inputMode="numeric"
              autoComplete="off"
              maxLength={2}
              aria-label={`${label} ${segment.key}`}
              aria-invalid={invalid || undefined}
              value={value[segment.key]}
              placeholder={segment.placeholder}
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => {
                const digits = event.target.value.replace(/\D/g, "").slice(0, 2)
                setSegment(segment.key, digits)
                if (digits.length === 2 && index < timeSegments.length - 1) focusSegment(index + 1)
              }}
              onKeyDown={(event) => {
                if ((event.key === ":" || event.key === ".") && index < timeSegments.length - 1) {
                  event.preventDefault()
                  focusSegment(index + 1)
                } else if (event.key === "Backspace" && !event.currentTarget.value && index > 0) {
                  event.preventDefault()
                  focusSegment(index - 1)
                }
              }}
              onPaste={(event) => {
                const parsed = parseTimeText(event.clipboardData.getData("text"))
                if (parsed) {
                  event.preventDefault()
                  onChange(parsed)
                }
              }}
              onBlur={(event) => {
                // Read the DOM value: auto-advance blurs this box before the new value has re-rendered.
                const text = event.currentTarget.value
                if (segment.key === "seconds" && text.length === 1) setSegment("seconds", text.padStart(2, "0"))
                if (segment.key === "hundredths" && text.length === 1) setSegment("hundredths", `${text}0`)
              }}
              className="w-full bg-transparent text-center font-mono text-lg tabular-nums text-white outline-none placeholder:text-slate-600"
            />
            <span className="text-[9px] font-medium uppercase tracking-[0.14em] text-slate-500">{segment.caption}</span>
          </label>
        </div>
      ))}
    </div>
  )
}
