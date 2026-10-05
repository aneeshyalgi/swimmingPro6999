"use client"

import { SiteNavbar } from "@/components/site-navbar"
import { StrokeLab } from "@/components/video-lab/stroke-lab"

export default function VideoAnalysisPage() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#03080c] text-foreground">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(87,229,234,0.16),transparent_55%),radial-gradient(ellipse_at_bottom_right,rgba(167,139,250,0.10),transparent_50%)]" />
        <div className="lab-grid-bg absolute inset-0 opacity-40" />
      </div>
      <SiteNavbar />
      <StrokeLab />
    </main>
  )
}
