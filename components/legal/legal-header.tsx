"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Waves } from "lucide-react"
import { cn } from "@/lib/utils"

const DOCUMENTS = [
  { href: "/privacy", label: "Privacy", long: "Privacy Policy" },
  { href: "/terms", label: "Terms", long: "Terms of Service" },
  { href: "/legal-notice", label: "Legal notice", long: "Legal Notice" },
]

/** The legal pages' top bar: SwimGPT and plain links to the three documents. */
export function LegalHeader() {
  const pathname = usePathname()
  return (
    <header className="lg-no-print sticky top-0 z-40 border-b border-white/10 bg-[#05090d]">
      <div className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-3 px-4 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2" aria-label="SwimGPT home">
          <span className="flex rounded-lg bg-gradient-to-br from-accent via-accent-foreground to-primary p-1.5"><Waves className="h-4 w-4 text-primary-foreground" /></span>
          <span className="hidden text-base font-bold tracking-tight text-white sm:inline">Swim<span className="text-accent">GPT</span></span>
        </Link>
        <nav aria-label="Legal documents" className="flex gap-4 text-xs sm:gap-6 sm:text-sm">
          {DOCUMENTS.map((document) => {
            const current = Boolean(pathname?.startsWith(document.href))
            return (
              <Link key={document.href} href={document.href} data-no-transition aria-current={current ? "page" : undefined}
                className={cn("whitespace-nowrap", current ? "font-semibold text-white underline underline-offset-4" : "text-slate-400 hover:text-white")}>
                <span className="sm:hidden">{document.label}</span><span className="hidden sm:inline">{document.long}</span>
              </Link>
            )
          })}
        </nav>
      </div>
    </header>
  )
}
