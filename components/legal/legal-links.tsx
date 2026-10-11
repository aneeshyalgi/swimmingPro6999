import Link from "next/link"
import { cn } from "@/lib/utils"

/** The three legal documents as small, quiet links (footers, the sign-in page, the dashboard sidebar). */
export function LegalLinks({ className }: { className?: string }) {
  return (
    <nav aria-label="Legal" className={cn("flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-slate-500", className)}>
      <Link href="/privacy" className="transition-colors hover:text-slate-200">Privacy</Link>
      <span aria-hidden className="text-slate-700">·</span>
      <Link href="/terms" className="transition-colors hover:text-slate-200">Terms</Link>
      <span aria-hidden className="text-slate-700">·</span>
      <Link href="/legal-notice" className="transition-colors hover:text-slate-200">Legal notice</Link>
    </nav>
  )
}
