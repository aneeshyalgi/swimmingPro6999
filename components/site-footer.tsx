import Link from "next/link"
import { Waves } from "lucide-react"

export function SiteFooter() {
  return (
    <footer className="border-t border-white/8 py-10">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 px-4 text-sm text-muted-foreground sm:px-6 md:flex-row lg:px-8">
        <div className="flex items-center gap-2">
          <Waves className="h-4 w-4 text-accent" />
          <span>© {new Date().getFullYear()} SwimGPT. The future of swim coaching.</span>
        </div>
        <nav className="flex gap-6" aria-label="Footer">
          <Link href="/training-plans" className="transition-colors hover:text-white">Training Plans</Link>
          <Link href="/video-analysis" className="transition-colors hover:text-white">Video Analysis</Link>
          <Link href="/auth" className="transition-colors hover:text-white">Log in</Link>
        </nav>
      </div>
    </footer>
  )
}
