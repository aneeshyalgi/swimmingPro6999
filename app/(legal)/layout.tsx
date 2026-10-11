import type { ReactNode } from "react"
import { LegalHeader } from "@/components/legal/legal-header"

/** The Privacy Policy, Terms of Service and Legal notice: a calm, still backdrop and a shared top bar. */
export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="lg-page relative min-h-screen text-foreground">
      <div aria-hidden className="lg-no-print pointer-events-none absolute inset-x-0 top-0 h-[520px] lg-grid" />
      <LegalHeader />
      <main className="relative">{children}</main>
    </div>
  )
}
