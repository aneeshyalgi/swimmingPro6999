"use client"

import { useEffect, useState } from "react"
import { CheckCircle2, KeyRound, Loader2, Lock, MailCheck } from "lucide-react"
import { AuthField, FormError, MatchNote, PasswordStrength, RevealButton } from "@/components/auth/auth-field"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { accountMessage, PASSWORD_MIN_LENGTH, sendPasswordReset } from "@/lib/account"
import { supabase } from "@/lib/supabase"

/**
 * Changing the password while signed in: the current one first, so nobody at an unlocked screen can take the account over,
 * then the new one twice. Every other device is signed out afterwards. Forgotten the current one? A reset link by email.
 */
export function ChangePasswordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [email, setEmail] = useState("")
  const [current, setCurrent] = useState("")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [errorKey, setErrorKey] = useState(0)
  const [done, setDone] = useState<{ othersSignedOut: boolean } | null>(null)
  const [link, setLink] = useState<"idle" | "sending" | "sent">("idle")
  const [linkError, setLinkError] = useState("")

  useEffect(() => {
    if (!open) return
    setCurrent("")
    setPassword("")
    setConfirm("")
    setShowCurrent(false)
    setShowNew(false)
    setError("")
    setDone(null)
    setLink("idle")
    setLinkError("")
    void supabase.auth.getSession().then(({ data: { session } }) => setEmail(session?.user.email ?? ""))
  }, [open])

  const fail = (message: string) => {
    setError(message)
    setErrorKey((key) => key + 1)
  }

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (password.length < PASSWORD_MIN_LENGTH) return fail(`Your new password needs at least ${PASSWORD_MIN_LENGTH} characters.`)
    if (password !== confirm) return fail("The two new passwords don't match.")
    if (password === current) return fail("Your new password must be different from your current one.")
    setBusy(true)
    setError("")
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const address = session?.user.email
      if (!address) return fail("Your session has ended. Log in again to change your password.")
      // Checking the current password is a fresh sign-in, which is also the recent sign-in Supabase can require before a
      // password change. A wrong one leaves the athlete signed in as they were.
      const { error: wrong } = await supabase.auth.signInWithPassword({ email: address, password: current })
      if (wrong) return fail(wrong.code === "invalid_credentials" ? "Your current password isn't right." : accountMessage(wrong))
      const { error: failed } = await supabase.auth.updateUser({ password })
      if (failed) return fail(accountMessage(failed))
      const { error: othersError } = await supabase.auth.signOut({ scope: "others" })
      setDone({ othersSignedOut: !othersError })
    } catch (caught) {
      fail(accountMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  const emailLink = async () => {
    setLink("sending")
    setLinkError("")
    try {
      await sendPasswordReset(email)
      setLink("sent")
    } catch (caught) {
      setLink("idle")
      setLinkError(accountMessage(caught, "We couldn't send the email just now. Please try again in a few minutes."))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto border-white/10 bg-[#0d151c] sm:max-w-md">
        {done ? (
          <div className="chat-enter flex flex-col items-center pt-2 text-center">
            <span className="pw-badge pw-badge-ok"><CheckCircle2 aria-hidden className="check-pop h-7 w-7" /></span>
            <DialogHeader className="mt-5 items-center sm:text-center">
              <DialogTitle className="text-white">Password changed</DialogTitle>
              <DialogDescription className="text-slate-400">
                Use your new password next time you log in.{done.othersSignedOut && " We've signed you out on your other devices."}
              </DialogDescription>
            </DialogHeader>
            <Button onClick={() => onOpenChange(false)} className="mt-6 h-11 w-full rounded-full bg-accent font-semibold text-accent-foreground hover:bg-accent/90">
              Done
            </Button>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="text-white">Change password</DialogTitle>
              <DialogDescription className="text-slate-400">Enter your current password, then choose a new one.</DialogDescription>
            </DialogHeader>
            <form onSubmit={submit} className="space-y-4">
              {/* Lets password managers save the new password to the right account. */}
              <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
              <div>
                <AuthField id="cp-current" label="Current password" icon={Lock} type={showCurrent ? "text" : "password"} autoComplete="current-password"
                  value={current} onChange={setCurrent} required adornment={<RevealButton shown={showCurrent} onToggle={() => setShowCurrent((value) => !value)} />} />
                <div className="mt-2 flex flex-col items-end gap-1 text-right">
                  {link === "sent" ? (
                    <p role="status" className="chat-enter flex items-start gap-1.5 text-xs leading-5 text-emerald-300">
                      <MailCheck aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>We&apos;ve emailed a reset link to <span className="font-semibold [overflow-wrap:anywhere]">{email}</span>.</span>
                    </p>
                  ) : (
                    <button type="button" onClick={() => void emailLink()} disabled={link === "sending" || !email}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-cyan-300/90 underline-offset-4 transition-colors hover:text-cyan-200 hover:underline disabled:cursor-progress disabled:opacity-70">
                      {link === "sending" && <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />}
                      {link === "sending" ? "Sending…" : "Forgot it? Email me a reset link"}
                    </button>
                  )}
                  {linkError && <p role="alert" className="text-xs text-rose-300">{linkError}</p>}
                </div>
              </div>
              <div>
                <AuthField id="cp-new" label="New password" icon={KeyRound} type={showNew ? "text" : "password"} autoComplete="new-password"
                  value={password} onChange={setPassword} required minLength={PASSWORD_MIN_LENGTH}
                  adornment={<RevealButton shown={showNew} onToggle={() => setShowNew((value) => !value)} />} />
                <PasswordStrength password={password} />
              </div>
              <div>
                <AuthField id="cp-confirm" label="Confirm new password" icon={KeyRound} type={showNew ? "text" : "password"} autoComplete="new-password"
                  value={confirm} onChange={setConfirm} required invalid={Boolean(confirm) && confirm.length >= password.length && confirm !== password} />
                <MatchNote password={password} confirm={confirm} />
              </div>
              {error && <FormError key={errorKey}>{error}</FormError>}
              <Button type="submit" disabled={busy} className="h-11 w-full rounded-full bg-accent font-semibold text-accent-foreground hover:bg-accent/90">
                {busy ? <><Loader2 className="h-4 w-4 animate-spin" />Updating your password…</> : "Update password"}
              </Button>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
