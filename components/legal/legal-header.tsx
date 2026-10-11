"use client"

import { useLayoutEffect, useRef, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Waves } from "lucide-react"
import { cn } from "@/lib/utils"

const DOCUMENTS = [
  { href: "/privacy", label: "Privacy", long: "Privacy Policy" },
  { href: "/terms", label: "Terms", long: "Terms of Service" },
  { href: "/legal-notice", label: "Legal notice", long: "Legal notice" },
]

/** The legal pages' top bar: switching document slides the highlight across (instantly, without the page dive). */
export function LegalHeader() {
  const pathname = usePathname()
  const navRef = useRef<HTMLElement>(null)
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null)
  const current = DOCUMENTS.findIndex((document) => pathname?.startsWith(document.href))

  useLayoutEffect(() => {
    const measure = () => {
      const link = navRef.current?.querySelectorAll<HTMLElement>("a")[current]
      setPill(link ? { left: link.offsetLeft, width: link.offsetWidth } : null)
    }
    measure()
    window.addEventListener("resize", measure)
    return () => window.removeEventListener("resize", measure)
  }, [current])

  return (
    <header className="lg-no-print sticky top-0 z-40 border-b border-white/[0.06] bg-[#060b10]/80 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2" aria-label="SwimGPT home">
          <span className="flex rounded-lg bg-gradient-to-br from-accent via-accent-foreground to-primary p-1.5"><Waves className="h-4 w-4 text-primary-foreground" /></span>
          <span className="hidden text-base font-bold tracking-tight text-white sm:inline">Swim<span className="text-accent">GPT</span></span>
        </Link>
        <nav ref={navRef} aria-label="Legal documents" className="relative flex rounded-full border border-white/10 bg-white/[0.03] p-1">
          {pill && <span aria-hidden className="lg-tab-pill absolute bottom-1 top-1 left-0 rounded-full" style={{ transform: `translateX(${pill.left}px)`, width: pill.width }} />}
          {DOCUMENTS.map((document, index) => (
            <Link key={document.href} href={document.href} data-no-transition aria-current={index === current ? "page" : undefined}
              className={cn("relative z-10 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold transition-colors duration-300 sm:px-4",
                index === current ? "text-slate-950" : "text-slate-400 hover:text-white")}>
              <span className="sm:hidden">{document.label}</span><span className="hidden sm:inline">{document.long}</span>
            </Link>
          ))}
        </nav>
      </div>
    </header>
  )
}
