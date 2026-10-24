import { redirect } from "next/navigation"

/** Coach chat opens full screen over the dashboard (?coach=chat); links to this old page land there. */
export default async function CoachChatPage({ searchParams }: { searchParams: Promise<{ call?: string }> }) {
  const { call } = await searchParams
  redirect(call === "1" ? "/dashboard?coach=call" : "/dashboard?coach=chat")
}
