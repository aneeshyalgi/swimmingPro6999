import type { ReactNode } from "react"
import { LegalHeader } from "@/components/legal/legal-header"

/** The Privacy Policy, Terms of Service and Legal notice: plain documents under a shared top bar. */
export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="lg-page relative min-h-screen text-foreground">
      <LegalHeader />
      <main className="relative">{children}</main>
    </div>
  )
}
