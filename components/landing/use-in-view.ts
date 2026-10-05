"use client"

import { useEffect, useRef, useState } from "react"

/** True once the element has scrolled into view (stays true), for one-shot entrance animations. */
export function useInView<T extends Element>(threshold = 0.25) {
  const ref = useRef<T | null>(null)
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const element = ref.current
    if (!element || inView) return
    if (!("IntersectionObserver" in window)) { setInView(true); return }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setInView(true); observer.disconnect() }
    }, { threshold })
    observer.observe(element)
    return () => observer.disconnect()
  }, [inView, threshold])
  return { ref, inView }
}

/** Cycles 0..count-1 every `ms` (paused for reduced motion). */
export function useCycle(count: number, ms: number) {
  const [index, setIndex] = useState(0)
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    const timer = window.setInterval(() => setIndex((value) => (value + 1) % count), ms)
    return () => window.clearInterval(timer)
  }, [count, ms])
  return index
}
