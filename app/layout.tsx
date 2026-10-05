import type React from "react"
import type { Metadata } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import { Analytics } from "@vercel/analytics/next"
import { PageTransitionProvider } from "@/components/page-transition"
import "./globals.css"

const _geist = Geist({ subsets: ["latin"] })
const _geistMono = Geist_Mono({ subsets: ["latin"] })

export const metadata: Metadata = {
  title: "SwimGPT - AI High-Performance Swim Coach",
  description:
    "The world's first AI-powered high-performance swim coaching platform. Your entire Olympic coaching team in one app.",
  generator: "v0.app",
  icons: {
    icon: "/icon.jpg",
    apple: "/icon.jpg",
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className={`font-sans antialiased`}>
        <PageTransitionProvider>{children}</PageTransitionProvider>
        <Analytics />
      </body>
    </html>
  )
}
