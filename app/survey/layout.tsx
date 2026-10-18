import type { ReactNode } from "react"
import type { Metadata } from "next"

// The survey is only for signed-in athletes, so search engines are kept away from it.
export const metadata: Metadata = {
  title: "Rate SwimGPT · SwimGPT",
  robots: { index: false, follow: false },
}

export default function SurveyLayout({ children }: { children: ReactNode }) {
  return children
}
