import type { ReactNode } from "react"
import { LEGAL_UPDATED } from "@/lib/legal"

export type LegalSection = { id: string; title: string; body: ReactNode }

/**
 * A legal document as a plain document: its title, when it was last updated, a list of contents and the numbered
 * sections. No summaries, decoration or motion; the text is all there without JavaScript and when printed.
 */
export function LegalDocument({ title, sections }: { title: string; sections: LegalSection[] }) {
  return (
    <article className="mx-auto max-w-3xl px-4 pb-24 pt-12 sm:px-6 sm:pt-16">
      <h1 className="text-3xl font-semibold tracking-tight text-white">{title}</h1>
      <p className="mt-2 text-sm text-slate-400">Last updated: {LEGAL_UPDATED}</p>

      <nav aria-label="Contents" className="lg-no-print mt-10 border-y border-white/10 py-6">
        <p className="text-sm font-semibold text-white">Contents</p>
        <ol className="mt-3 space-y-1.5 text-sm">
          {sections.map((section, index) => (
            <li key={section.id}>
              <a href={`#${section.id}`} className="text-slate-300 underline decoration-white/20 underline-offset-2 hover:text-white">
                {index + 1}. {section.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <div className="mt-12 space-y-10">
        {sections.map((section, index) => (
          <section key={section.id} id={section.id} aria-labelledby={`${section.id}-title`} className="scroll-mt-20">
            <h2 id={`${section.id}-title`} className="text-lg font-semibold text-white">{index + 1}. {section.title}</h2>
            <div className="lg-prose mt-3">{section.body}</div>
          </section>
        ))}
      </div>
    </article>
  )
}
