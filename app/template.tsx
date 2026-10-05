import type { ReactNode } from "react"
import { PageEnter } from "@/components/page-transition"

/** Re-mounted on every navigation, so each page glides in (after the dive transition when one is playing). */
export default function Template({ children }: { children: ReactNode }) {
  return <PageEnter>{children}</PageEnter>
}
