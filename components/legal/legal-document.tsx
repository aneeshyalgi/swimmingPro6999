"use client"

import { useEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react"
import Link from "next/link"
import {
  BadgeCheck, CalendarClock, ChevronDown, Clock, HeartPulse, Link2, Mail, MessageSquareLock, Printer, Scale, ShieldCheck,
  Smartphone, Sparkles, Trash2, Undo2,
} from "lucide-react"
import { LEGAL_UPDATED } from "@/lib/legal"
import { ContactUs } from "@/components/legal/operator"
import { cn } from "@/lib/utils"

export type LegalSection = { id: string; title: string; summary: string; body: ReactNode }

const ICONS = {
  shield: ShieldCheck, heart: HeartPulse, device: Smartphone, trash: Trash2, cancel: Undo2, scale: Scale, ai: Sparkles,
  chat: MessageSquareLock, renew: CalendarClock, check: BadgeCheck,
}
export type HighlightIcon = keyof typeof ICONS

const DOCUMENTS = [
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/terms", label: "Terms of Service" },
  { href: "/legal-notice", label: "Legal notice" },
]

/**
 * A legal document laid out to be read: a short summary at the top of every section, a contents list that follows the
 * reader, and sections that ease in once as they come into view. Nothing animates in a loop (easy on phones), and the
 * text is all there without JavaScript and when printed.
 */
export function LegalDocument({ current, eyebrow, title, lead, readMinutes, highlights = [], sections }: {
  current: string
  eyebrow: string
  title: string
  lead: string
  readMinutes: number
  highlights?: { icon: HighlightIcon; text: string }[]
  sections: LegalSection[]
}) {
  const [active, setActive] = useState(sections[0]?.id ?? "")
  const [ready, setReady] = useState(false)
  const [contentsOpen, setContentsOpen] = useState(false)
  const [marker, setMarker] = useState({ top: 0, height: 0 })
  const progressRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLOListElement>(null)
  const ids = sections.map((section) => section.id).join(" ")

  // Sections ease in once as they reach the screen (all visible without JavaScript: `ready` hides them first).
  useEffect(() => {
    setReady(true)
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        entry.target.classList.add("is-in")
        observer.unobserve(entry.target)
      }
    }, { rootMargin: "0px 0px -6% 0px" })
    document.querySelectorAll("[data-reveal]").forEach((item) => observer.observe(item))
    return () => observer.disconnect()
  }, [ids])

  // The section in the upper part of the screen is the one being read.
  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      const seen = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
      if (seen[0]) setActive(seen[0].target.id)
    }, { rootMargin: "-18% 0px -70% 0px" })
    ids.split(" ").forEach((id) => { const section = document.getElementById(id); if (section) observer.observe(section) })
    return () => observer.disconnect()
  }, [ids])

  // Reading progress along the top edge.
  useEffect(() => {
    let frame = 0
    const update = () => {
      frame = 0
      const scrollable = document.documentElement.scrollHeight - window.innerHeight
      progressRef.current?.style.setProperty("transform", `scaleX(${scrollable > 0 ? Math.min(1, window.scrollY / scrollable) : 0})`)
    }
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update) }
    update()
    window.addEventListener("scroll", onScroll, { passive: true })
    window.addEventListener("resize", onScroll)
    return () => { window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onScroll); cancelAnimationFrame(frame) }
  }, [])

  // The contents marker slides to the section being read.
  useEffect(() => {
    const item = listRef.current?.querySelector<HTMLElement>(`[data-id="${active}"]`)
    if (item) setMarker({ top: item.offsetTop, height: item.offsetHeight })
  }, [active])

  const jump = (id: string) => (event: MouseEvent) => {
    const target = document.getElementById(id)
    if (!target) return
    event.preventDefault()
    setContentsOpen(false)
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    target.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" })
    history.replaceState(null, "", `#${id}`)
  }

  const activeIndex = Math.max(0, sections.findIndex((section) => section.id === active))

  return (
    <div className={cn("relative", ready && "lg-ready")}>
      <div aria-hidden className="lg-no-print fixed inset-x-0 top-0 z-50 h-[3px]"><div ref={progressRef} className="lg-progress h-full" /></div>

      {/* Title */}
      <section className="mx-auto max-w-6xl px-4 pb-10 pt-12 sm:px-6 sm:pt-16">
        <p data-reveal className="inline-flex items-center gap-2 rounded-full border border-cyan-300/25 bg-cyan-300/[0.06] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-cyan-200">
          <ShieldCheck className="h-3.5 w-3.5" />{eyebrow}
        </p>
        <h1 data-reveal style={{ "--d": "60ms" } as CSSProperties} className="mt-5 text-balance text-4xl font-bold tracking-tight text-white sm:text-5xl">{title}</h1>
        <p data-reveal style={{ "--d": "120ms" } as CSSProperties} className="mt-4 max-w-2xl text-[15px] leading-7 text-slate-300">{lead}</p>
        <div data-reveal style={{ "--d": "180ms" } as CSSProperties} className="mt-6 flex flex-wrap items-center gap-2 text-xs text-slate-400">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5"><CalendarClock className="h-3.5 w-3.5 text-cyan-300" />Last updated {LEGAL_UPDATED}</span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5"><Clock className="h-3.5 w-3.5 text-cyan-300" />About {readMinutes} min to read</span>
          <button type="button" onClick={() => window.print()}
            className="lg-no-print inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 transition-colors hover:border-cyan-300/40 hover:text-white">
            <Printer className="h-3.5 w-3.5 text-cyan-300" />Print or save
          </button>
        </div>

        {highlights.length > 0 && (
          <ul className="mt-9 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {highlights.map((highlight, index) => {
              const Icon = ICONS[highlight.icon]
              return (
                <li key={highlight.text} data-reveal style={{ "--d": `${240 + index * 70}ms` } as CSSProperties}
                  className="lg-highlight flex items-start gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-cyan-300/10 text-cyan-200"><Icon className="h-[18px] w-[18px]" /></span>
                  <span className="text-sm leading-6 text-slate-200">{highlight.text}</span>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* Contents, on phones: a bar that opens the list */}
      <div className="lg-no-print sticky top-14 z-30 border-y border-white/[0.06] bg-[#060b10]/85 backdrop-blur-xl lg:hidden">
        <button type="button" onClick={() => setContentsOpen((open) => !open)} aria-expanded={contentsOpen}
          className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3 text-left text-sm sm:px-6">
          <span className="min-w-0 truncate"><span className="text-slate-500">Contents · </span><span className="font-semibold text-white">{String(activeIndex + 1).padStart(2, "0")} {sections[activeIndex]?.title}</span></span>
          <ChevronDown className={cn("h-4 w-4 shrink-0 text-slate-400 transition-transform duration-300", contentsOpen && "rotate-180")} />
        </button>
        <div className={cn("grid transition-[grid-template-rows] duration-300 ease-out", contentsOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
          <div className="overflow-hidden">
            <ol className="mx-auto max-h-[55vh] max-w-6xl overflow-y-auto px-4 pb-4 sm:px-6">
              {sections.map((section, index) => (
                <li key={section.id}>
                  <a href={`#${section.id}`} onClick={jump(section.id)}
                    className={cn("flex gap-3 rounded-xl px-3 py-2 text-sm transition-colors", section.id === active ? "bg-cyan-300/10 text-white" : "text-slate-400 hover:text-white")}>
                    <span className="w-6 shrink-0 font-mono text-xs leading-5 text-slate-500">{String(index + 1).padStart(2, "0")}</span>{section.title}
                  </a>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>

      <div className="mx-auto grid max-w-6xl gap-10 px-4 pb-20 pt-8 sm:px-6 lg:grid-cols-[250px_minmax(0,1fr)] lg:gap-14 lg:pt-4">
        {/* Contents, on wide screens: follows the reader */}
        <aside className="lg-no-print hidden lg:block">
          <nav aria-label="Contents" className="sticky top-24">
            <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">Contents</p>
            <div className="relative max-h-[calc(100vh-9rem)] overflow-y-auto pr-2">
              <span aria-hidden className="lg-marker absolute left-0 w-[2px] rounded-full bg-cyan-300"
                style={{ transform: `translateY(${marker.top}px)`, height: marker.height }} />
              <ol ref={listRef} className="border-l border-white/[0.08]">
                {sections.map((section, index) => (
                  <li key={section.id} data-id={section.id}>
                    <a href={`#${section.id}`} onClick={jump(section.id)} aria-current={section.id === active ? "true" : undefined}
                      className={cn("flex gap-2.5 py-1.5 pl-4 pr-2 text-[13px] leading-5 transition-colors duration-300", section.id === active ? "text-white" : "text-slate-500 hover:text-slate-200")}>
                      <span className="w-5 shrink-0 font-mono text-[11px] leading-5 opacity-70">{String(index + 1).padStart(2, "0")}</span>{section.title}
                    </a>
                  </li>
                ))}
              </ol>
            </div>
          </nav>
        </aside>

        <article className="min-w-0 space-y-14">
          {sections.map((section, index) => (
            <section key={section.id} id={section.id} className="scroll-mt-32 lg:scroll-mt-24" aria-labelledby={`${section.id}-title`}>
              <header data-reveal className="group flex items-baseline gap-3">
                <span className="font-mono text-xs text-cyan-300/80">{String(index + 1).padStart(2, "0")}</span>
                <h2 id={`${section.id}-title`} className="text-xl font-semibold tracking-tight text-white sm:text-2xl">{section.title}</h2>
                <a href={`#${section.id}`} onClick={jump(section.id)} aria-label={`Link to ${section.title}`}
                  className="lg-no-print opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"><Link2 className="h-4 w-4 text-slate-500" /></a>
              </header>
              <div data-reveal style={{ "--d": "80ms" } as CSSProperties} className="lg-summary mt-4 rounded-2xl p-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-200/90">In short</p>
                <p className="mt-1.5 text-[15px] leading-7 text-white/90">{section.summary}</p>
              </div>
              <div data-reveal style={{ "--d": "140ms" } as CSSProperties} className="lg-prose mt-5">{section.body}</div>
            </section>
          ))}

          <footer data-reveal className="rounded-3xl border border-white/[0.08] bg-white/[0.025] p-6">
            <p className="flex items-center gap-2 font-semibold text-white"><Mail className="h-4 w-4 text-cyan-300" />Questions about this?</p>
            <p className="mt-2 text-sm leading-6 text-slate-400">We&apos;re happy to help: <span className="lg-prose"><ContactUs /></span>. We usually reply within a few days.</p>
            <nav aria-label="Legal documents" className="lg-no-print mt-5 flex flex-wrap gap-2">
              {DOCUMENTS.filter((document) => document.href !== current).map((document) => (
                <Link key={document.href} href={document.href} data-no-transition
                  className="rounded-full border border-white/10 px-3.5 py-1.5 text-xs font-semibold text-slate-300 transition-colors hover:border-cyan-300/40 hover:text-white">
                  {document.label}
                </Link>
              ))}
            </nav>
          </footer>
        </article>
      </div>
    </div>
  )
}
