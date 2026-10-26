import { z } from "zod"
import { apiRequest } from "@/lib/api"

export {
  OPEN_TOKEN_STORE, TOKENS_CHANGED, TOKENS_NEEDED, TokensNeeded, openTokenStore, tokensChanged, tokensNeeded, type Shortfall,
} from "@/lib/token-events"

/**
 * Tokens (backend/app/tokens.py): every AI feature costs tokens. A subscription comes with a month's tokens, renewed every
 * month (what's left doesn't carry over); tokens bought in the dashboard's token store come on top and last two months.
 * Before the backend has its token tables, GET /api/tokens says `available: false` and everything is free, as before.
 */

const tokensSchema = z.discriminatedUnion("available", [
  z.object({ available: z.literal(false) }),
  z.object({
    available: z.literal(true),
    balance: z.number(),
    monthly: z.object({ tokens: z.number(), remaining: z.number(), renews_at: z.string().nullable() }),
    /** Bought (or given) tokens still to spend, the soonest to expire first. */
    bought: z.array(z.object({ tokens: z.number(), remaining: z.number(), expires_at: z.string().nullable(), gift: z.boolean() })),
    recent: z.array(z.object({ action: z.string().nullable(), label: z.string(), tokens: z.number(), at: z.string().nullable(), returned: z.boolean() })),
    costs: z.array(z.object({ action: z.string(), label: z.string(), tokens: z.number() })),
    packs: z.array(z.object({ id: z.string(), tokens: z.number(), amount: z.number(), currency: z.string() })),
    monthly_tokens: z.number(),
    bought_months: z.number(),
  }),
])
export type Tokens = z.infer<typeof tokensSchema>
export type TokenBalance = Extract<Tokens, { available: true }>
export type TokenPack = TokenBalance["packs"][number]

/** The signed-in athlete's tokens. */
export const fetchTokens = (signal?: AbortSignal) => apiRequest("/tokens", tokensSchema, { signal })

/** Opens Stripe's checkout for a token pack. `startNow`: the buyer ticked the box to have the tokens added straight away
 *  (components/legal/start-now-consent.tsx). */
export async function buyTokens(pack: string, startNow: boolean) {
  const { checkout_url } = await apiRequest("/tokens/checkout", z.object({ checkout_url: z.string() }), { body: { pack, start_now: startNow } })
  window.location.assign(checkout_url)
}

/** Back from paying: confirms the purchase with Stripe and adds its tokens (once). */
export const verifyTokens = (sessionId: string) =>
  apiRequest(`/tokens/verify/${encodeURIComponent(sessionId)}`, z.object({ paid: z.boolean(), added: z.boolean(), tokens: z.number() }))

export const tokenCount = (count: number) => `${count.toLocaleString()} token${count === 1 ? "" : "s"}`

/** "25 Nov", in the athlete's own time zone. */
export const shortDay = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : ""
