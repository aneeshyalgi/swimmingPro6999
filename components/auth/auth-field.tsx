"use client"

import type { ReactNode } from "react"
import { AlertTriangle, ArrowRight, CheckCircle2, Eye, EyeOff, Loader2, Mail } from "lucide-react"
import { passwordScore } from "@/lib/account"
import { cn } from "@/lib/utils"

// The sign-in look (floating labels, the glowing submit button), shared by log in, sign up and password reset.

export function AuthField({ id, label, icon: Icon, type, value, onChange, autoComplete, required, minLength, adornment, onKey, autoFocus, invalid }: {
  id: string
  label: string
  icon: typeof Mail
  type: string
  value: string
  onChange: (value: string) => void
  autoComplete?: string
  required?: boolean
  minLength?: number
  adornment?: ReactNode
  onKey?: (event: React.KeyboardEvent<HTMLInputElement>) => void
  autoFocus?: boolean
  invalid?: boolean
}) {
  return (
    <div className="au-field group relative">
      <Icon aria-hidden className="pointer-events-none absolute left-4 top-1/2 z-10 h-[18px] w-[18px] -translate-y-1/2 text-slate-500 transition-colors duration-300 group-focus-within:text-cyan-300" />
      <input id={id} type={type} value={value} placeholder=" " autoComplete={autoComplete} required={required} minLength={minLength}
        autoFocus={autoFocus} aria-invalid={invalid || undefined}
        onChange={(event) => onChange(event.target.value)} onKeyUp={onKey} onKeyDown={onKey}
        className={cn("peer h-[58px] w-full rounded-2xl border border-white/10 bg-white/[0.03] pb-2 pl-12 pt-6 text-[15px] text-white outline-none transition-all duration-300",
          "hover:border-white/20 focus:border-cyan-300/60 focus:bg-cyan-300/[0.04] focus:shadow-[0_0_0_4px_rgba(87,229,234,0.12),0_10px_30px_-10px_rgba(87,229,234,0.35)]",
          invalid && "border-rose-400/50 hover:border-rose-400/60",
          adornment ? "pr-14" : "pr-4")} />
      <label htmlFor={id}
        className="pointer-events-none absolute left-12 top-1/2 -translate-y-[calc(50%+9px)] text-[11px] font-medium uppercase tracking-[0.14em] text-slate-400 transition-all duration-300 peer-placeholder-shown:-translate-y-1/2 peer-placeholder-shown:text-[15px] peer-placeholder-shown:normal-case peer-placeholder-shown:tracking-normal peer-placeholder-shown:text-slate-500 peer-focus:-translate-y-[calc(50%+9px)] peer-focus:text-[11px] peer-focus:uppercase peer-focus:tracking-[0.14em] peer-focus:text-cyan-300">
        {label}
      </label>
      {adornment && <span className="absolute right-2.5 top-1/2 -translate-y-1/2">{adornment}</span>}
      <span aria-hidden className="au-underline pointer-events-none absolute inset-x-6 bottom-0 h-px scale-x-0 bg-gradient-to-r from-transparent via-cyan-300 to-transparent transition-transform duration-500 peer-focus:scale-x-100" />
    </div>
  )
}

/** Shows or hides the password typed in a field. */
export function RevealButton({ shown, onToggle }: { shown: boolean; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle} aria-label={shown ? "Hide password" : "Show password"}
      className="grid h-9 w-9 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-white/[0.06] hover:text-white">
      {shown ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
    </button>
  )
}

/** Four bars that fill as a new password gets stronger; slides open once something is typed. */
export function PasswordStrength({ password, show = true }: { password: string; show?: boolean }) {
  const score = passwordScore(password)
  return (
    <div className={cn("grid transition-[grid-template-rows,opacity] duration-500", show && password ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}>
      <div className="overflow-hidden">
        <div className="flex items-center gap-1.5 pt-3" aria-live="polite">
          {[1, 2, 3, 4].map((bar) => (
            <span key={bar} className={cn("h-1 flex-1 rounded-full transition-all duration-500",
              bar <= score ? ["", "bg-rose-400", "bg-amber-300", "bg-cyan-300", "bg-emerald-400"][score] : "bg-white/10")} />
          ))}
          <span className="ml-2 w-14 text-right text-[11px] font-medium text-slate-400">{["", "Weak", "Okay", "Strong", "Excellent"][score]}</span>
        </div>
      </div>
    </div>
  )
}

/** Under a "confirm password" field: whether it matches the new password yet. */
export function MatchNote({ password, confirm }: { password: string; confirm: string }) {
  if (!confirm) return null
  const matches = confirm === password
  return (
    <p aria-live="polite" className={cn("mt-2 flex items-center gap-1.5 text-xs", matches ? "text-emerald-300" : "text-slate-400")}>
      {matches ? <><CheckCircle2 className="check-pop h-3.5 w-3.5" />Passwords match</> : "Doesn't match yet"}
    </p>
  )
}

export function FormError({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="au-shake flex items-start gap-2.5 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" />
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  )
}

export function AuthSubmit({ busy, busyLabel, disabled, onClick, type = "submit", children }: {
  busy: boolean
  busyLabel: string
  disabled?: boolean
  onClick?: () => void
  type?: "submit" | "button"
  children: ReactNode
}) {
  return (
    <button type={type} onClick={onClick} disabled={busy || disabled}
      className={cn("au-submit group relative mt-2 flex h-[54px] w-full items-center justify-center overflow-hidden rounded-2xl text-[15px] font-semibold text-slate-950 transition-transform duration-300 enabled:hover:-translate-y-0.5 disabled:cursor-progress",
        disabled && !busy && "opacity-60 disabled:cursor-not-allowed")}>
      <span aria-hidden className="au-submit-sheen" />
      {busy && <span aria-hidden className="au-submit-wave" />}
      <span className="relative flex items-center">
        {busy ? (
          <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{busyLabel}</>
        ) : (
          <>{children}<ArrowRight className="ml-2 h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" /></>
        )}
      </span>
    </button>
  )
}
