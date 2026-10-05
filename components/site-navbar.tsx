"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import type { User } from "@supabase/supabase-js"
import { CalendarDays, Home, LayoutDashboard, LogOut, Menu, Video, Waves } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { usePageTransition } from "@/components/page-transition"
import { supabase } from "@/lib/supabase"
import { cn } from "@/lib/utils"

type NavKey = "home" | "plans" | "video"
type Edges = { left: number; right: number }

const keyForPath = (path: string | null): NavKey | null =>
  path === "/" ? "home" : path?.startsWith("/training-plans") ? "plans" : path === "/video-analysis" ? "video" : null
const LIQUID_EASE = "cubic-bezier(0.76, 0, 0.24, 1)"

const getInitials = (user: User) => {
  const name: string = user.user_metadata?.full_name || user.email || "?"
  return name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("")
}

export function SiteNavbar() {
  const pathname = usePathname()
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      setAuthReady(true)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12)
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  const activeKey = keyForPath(pathname)
  // The selector follows the page being navigated to, so it moves the moment a tab is clicked.
  const { pendingPath } = usePageTransition()
  const selectedKey = pendingPath ? keyForPath(pendingPath) ?? activeKey : activeKey
  const trackRef = useRef<HTMLDivElement | null>(null)
  const itemRefs = useRef<Partial<Record<NavKey, HTMLAnchorElement | null>>>({})
  const [pill, setPill] = useState<(Edges & { dir: number; move: number }) | null>(null)
  const [ghost, setGhost] = useState<(Edges & { visible: boolean }) | null>(null)

  const edgesOf = useCallback((key: NavKey): Edges | null => {
    const item = itemRefs.current[key]
    const track = trackRef.current
    if (!item || !track) return null
    const box = item.getBoundingClientRect()
    const bounds = track.getBoundingClientRect()
    return { left: box.left - bounds.left, right: bounds.right - box.right }
  }, [])

  useLayoutEffect(() => {
    if (!selectedKey) { setPill(null); return }
    const next = edgesOf(selectedKey)
    if (!next) return
    setPill((previous) => {
      if (!previous) return { ...next, dir: 0, move: 0 }
      if (Math.abs(previous.left - next.left) < 1) return { ...previous, ...next }
      return { ...next, dir: next.left > previous.left ? 1 : -1, move: previous.move + 1 }
    })
  }, [selectedKey, edgesOf])

  // Stay aligned when fonts load or the window resizes. Registered once and only acts when the pill is actually
  // misaligned, so it never cancels the liquid transition that runs after a tab click.
  const selectedRef = useRef(selectedKey)
  selectedRef.current = selectedKey
  useEffect(() => {
    const sync = () => {
      const key = selectedRef.current
      const edges = key ? edgesOf(key) : null
      if (!edges) return
      setPill((previous) => (previous && (Math.abs(previous.left - edges.left) > 1 || Math.abs(previous.right - edges.right) > 1)
        ? { ...previous, ...edges, dir: 0 } : previous))
    }
    window.addEventListener("resize", sync)
    void document.fonts?.ready.then(sync)
    return () => window.removeEventListener("resize", sync)
  }, [edgesOf])

  const showGhost = (key: NavKey) => {
    const edges = edgesOf(key)
    if (edges) setGhost({ ...edges, visible: key !== selectedKey })
  }
  // Liquid motion: the leading edge reaches the new tab first, then the trailing edge catches up.
  const pillTransition = !pill || pill.dir === 0 ? "none"
    : pill.dir > 0 ? `right 520ms ${LIQUID_EASE} 0ms, left 560ms ${LIQUID_EASE} 140ms`
    : `left 520ms ${LIQUID_EASE} 0ms, right 560ms ${LIQUID_EASE} 140ms`

  const navItems: { key: NavKey; label: string; href: string; icon: typeof Home }[] = [
    { key: "home", label: "Home", href: "/", icon: Home },
    { key: "plans", label: "Training Plans", href: "/training-plans", icon: CalendarDays },
    { key: "video", label: "Video Analysis", href: "/video-analysis", icon: Video },
  ]

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    localStorage.removeItem("swimgpt_user_key")
    localStorage.removeItem("swimgpt_onboarding")
    localStorage.removeItem("swimgpt_coaches")
    router.push("/")
  }

  const handleHomeClick = (event: React.MouseEvent) => {
    if (pathname === "/") {
      event.preventDefault()
      window.scrollTo({ top: 0, behavior: "smooth" })
    }
  }

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 transition-all duration-300",
        scrolled
          ? "border-b border-white/8 bg-[oklch(0.12_0.015_240/0.78)] shadow-[0_10px_40px_rgba(0,0,0,0.35)] backdrop-blur-xl"
          : "border-b border-transparent bg-transparent",
      )}
    >
      <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8" aria-label="Main">
        <Link href="/" onClick={handleHomeClick} className="flex items-center gap-2.5">
          <span className="relative">
            <span className="absolute inset-0 rounded-full bg-accent/20 blur-xl animate-pulse" />
            <span className="relative flex rounded-xl bg-gradient-to-br from-accent via-accent-foreground to-primary p-2">
              <Waves className="h-5 w-5 text-primary-foreground" />
            </span>
          </span>
          <span className="text-lg font-bold tracking-tight text-white">
            Swim<span className="text-accent">GPT</span>
          </span>
        </Link>

        <div ref={trackRef} onMouseLeave={() => setGhost((current) => (current ? { ...current, visible: false } : current))}
          className="relative hidden items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] p-1 backdrop-blur-md md:flex">
          {ghost && <span aria-hidden className="nav-ghost" style={{ left: ghost.left, right: ghost.right, opacity: ghost.visible ? 1 : 0 }} />}
          {pill && (
            <span aria-hidden className="nav-pill" style={{ left: pill.left, right: pill.right, transition: pillTransition } as CSSProperties}>
              <span key={pill.move} className={cn("absolute inset-0", pill.move > 0 && "nav-pill-moving")}>
                <span className="nav-pill-fill" />
                <span className="nav-pill-ripple" />
              </span>
            </span>
          )}
          {navItems.map((item) => (
            <Link
              key={item.key}
              ref={(element) => { itemRefs.current[item.key] = element }}
              href={item.href}
              onClick={item.key === "home" ? handleHomeClick : undefined}
              onMouseEnter={() => showGhost(item.key)}
              aria-current={activeKey === item.key ? "page" : undefined}
              className={cn(
                "relative z-10 rounded-full px-4 py-1.5 text-sm font-medium transition-colors duration-500",
                selectedKey === item.key ? "text-slate-950" : "text-slate-300 hover:text-white",
              )}
            >
              {item.label}
            </Link>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <div className={cn("hidden items-center gap-2 transition-opacity md:flex", authReady ? "opacity-100" : "opacity-0")}>
            {user ? (
              <>
                <Button asChild size="sm" variant="ghost" className="text-slate-200 hover:bg-white/[0.06] hover:text-white">
                  <Link href="/dashboard">
                    <LayoutDashboard className="mr-1.5 h-4 w-4" />
                    Dashboard
                  </Link>
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label="Account menu"
                      className="flex h-9 w-9 items-center justify-center rounded-full border border-accent/40 bg-accent/15 text-xs font-semibold text-accent transition-colors hover:bg-accent/25"
                    >
                      {getInitials(user)}
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuLabel className="font-normal">
                      <p className="text-sm font-medium">{user.user_metadata?.full_name || "Swimmer"}</p>
                      <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem asChild>
                      <Link href="/dashboard">
                        <LayoutDashboard className="h-4 w-4" />
                        Training hub
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={handleSignOut}>
                      <LogOut className="h-4 w-4" />
                      Sign out
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            ) : (
              <>
                <Button asChild size="sm" variant="ghost" className="text-slate-200 hover:bg-white/[0.06] hover:text-white">
                  <Link href="/auth">Log in</Link>
                </Button>
                <Button
                  asChild
                  size="sm"
                  className="rounded-full bg-accent px-4 text-accent-foreground shadow-[0_8px_24px_rgba(87,229,234,0.3)] hover:bg-accent/90"
                >
                  <Link href="/auth?mode=signup">Get started</Link>
                </Button>
              </>
            )}
          </div>

          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="text-white hover:bg-white/10 md:hidden" aria-label="Open menu">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-72 border-white/10 bg-background">
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  <span className="flex rounded-lg bg-gradient-to-br from-accent via-accent-foreground to-primary p-1.5">
                    <Waves className="h-4 w-4 text-primary-foreground" />
                  </span>
                  SwimGPT
                </SheetTitle>
              </SheetHeader>
              <div className="flex flex-col gap-1 px-4">
                {navItems.map((item) => (
                  <SheetClose asChild key={item.key}>
                    <Link
                      href={item.href}
                      aria-current={activeKey === item.key ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                        activeKey === item.key ? "bg-accent text-accent-foreground" : "text-slate-300 hover:bg-white/[0.06]",
                      )}
                    >
                      <item.icon className="h-4 w-4" />
                      {item.label}
                    </Link>
                  </SheetClose>
                ))}
              </div>
              <div className="mt-auto flex flex-col gap-2 border-t border-white/8 p-4">
                {user ? (
                  <>
                    <p className="truncate px-1 text-xs text-muted-foreground">Signed in as {user.email}</p>
                    <SheetClose asChild>
                      <Button asChild>
                        <Link href="/dashboard">Open training hub</Link>
                      </Button>
                    </SheetClose>
                    <SheetClose asChild>
                      <Button variant="outline" onClick={handleSignOut}>
                        <LogOut className="mr-2 h-4 w-4" />
                        Sign out
                      </Button>
                    </SheetClose>
                  </>
                ) : (
                  <>
                    <SheetClose asChild>
                      <Button asChild className="bg-accent text-accent-foreground hover:bg-accent/90">
                        <Link href="/auth?mode=signup">Get started</Link>
                      </Button>
                    </SheetClose>
                    <SheetClose asChild>
                      <Button asChild variant="outline">
                        <Link href="/auth">Log in</Link>
                      </Button>
                    </SheetClose>
                  </>
                )}
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </nav>
    </header>
  )
}
