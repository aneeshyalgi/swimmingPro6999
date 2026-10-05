"use client"

import { useState, type DragEvent } from "react"
import { Film, Upload } from "lucide-react"
import { cn } from "@/lib/utils"
import { StrokeDemo } from "@/components/video-lab/stroke-demo"

/** Drag-and-drop clip input with an animated border and a live preview of what the lab will draw. */
export function UploadZone({ onFile }: { onFile: (file: File) => void }) {
  const [dragging, setDragging] = useState(false)
  const drop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault()
    setDragging(false)
    const file = event.dataTransfer.files?.[0]
    if (file) onFile(file)
  }
  return (
    <label
      onDragOver={(event) => { event.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={drop}
      className={cn("group relative block cursor-pointer rounded-[26px] p-[1.5px] transition-transform duration-500", dragging && "scale-[1.01]")}
    >
      {/* spinning conic border */}
      <span className={cn("lab-border absolute inset-0 rounded-[26px] opacity-60 transition-opacity duration-500 group-hover:opacity-100", dragging && "opacity-100")} />
      <span className="relative flex min-h-[420px] flex-col overflow-hidden rounded-[25px] bg-[radial-gradient(circle_at_top,rgba(87,229,234,0.12),rgba(9,15,21,0.97)_55%)] p-6 sm:p-8">
        <input type="file" accept="video/*" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) onFile(file) }} />
        <StrokeDemo className="mx-auto h-44 w-full max-w-xl sm:h-52" />
        <span className="mt-7 flex flex-col items-center text-center">
          <span className={cn("flex h-16 w-16 items-center justify-center rounded-2xl border border-cyan-300/30 bg-cyan-400/10 text-cyan-200 shadow-[0_0_40px_rgba(87,229,234,0.25)] transition-all duration-500 group-hover:-translate-y-1 group-hover:scale-105",
            dragging && "scale-110 bg-cyan-300 text-slate-950")}>
            {dragging ? <Film className="h-7 w-7" /> : <Upload className="h-7 w-7" />}
          </span>
          <span className="mt-5 text-xl font-semibold text-white">{dragging ? "Drop it in the pool" : "Drop a swim clip to open the Stroke Lab"}</span>
          <span className="mt-2 max-w-md text-sm leading-6 text-slate-400">Side-on works best. MP4, MOV or WebM, 10–60 seconds, one swimmer in frame. The clip never leaves your device for pose tracking.</span>
          <span className="mt-6 inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-accent-foreground shadow-[0_12px_30px_rgba(87,229,234,0.35)] transition-transform duration-300 group-hover:-translate-y-0.5">
            <Upload className="h-4 w-4" />Choose a video
          </span>
        </span>
      </span>
    </label>
  )
}
