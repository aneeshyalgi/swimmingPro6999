import { z } from "zod"

/**
 * How the AI features tell the dashboard about tokens (lib/tokens.ts): a request refused for want of them, something that
 * spent them, or a wish to open the token store. Kept apart from lib/tokens.ts so the request helpers (lib/api.ts,
 * lib/training.ts...) can use it without importing what imports them.
 */

/** A request was refused for want of tokens (the dashboard offers the token store). */
export const TOKENS_NEEDED = "swimgpt:tokens-needed"
/** Something that costs tokens has run (the balance shown refreshes). */
export const TOKENS_CHANGED = "swimgpt:tokens-changed"
/** Asked to open the token store (from a chat message that wasn't answered, say). */
export const OPEN_TOKEN_STORE = "swimgpt:open-token-store"

export type Shortfall = { needed: number; balance: number; renewsAt: string | null; message: string }

/** An AI request refused because the athlete hasn't enough tokens. Its message is the API's, for the athlete. */
export class TokensNeeded extends Error {
  shortfall: Shortfall
  constructor(shortfall: Shortfall) {
    super(shortfall.message)
    this.name = "TokensNeeded"
    this.shortfall = shortfall
  }
}

const shortfallSchema = z.object({
  detail: z.string(),
  tokens: z.object({ needed: z.number(), balance: z.number(), renews_at: z.string().nullable() }),
})

const announce = (name: string, detail?: unknown) => {
  if (typeof window !== "undefined") window.dispatchEvent(detail === undefined ? new Event(name) : new CustomEvent(name, { detail }))
}

/** The refusal in a failed API response (its status and parsed body), or null when it's any other error. The dashboard is
 *  told straight away, so it can offer the token store. */
export function tokensNeeded(status: number, body: unknown): TokensNeeded | null {
  if (status !== 429) return null
  const parsed = shortfallSchema.safeParse(body)
  if (!parsed.success) return null
  const { detail, tokens } = parsed.data
  const shortfall: Shortfall = { needed: tokens.needed, balance: tokens.balance, renewsAt: tokens.renews_at, message: detail }
  announce(TOKENS_NEEDED, shortfall)
  return new TokensNeeded(shortfall)
}

/** The same, from a response's text (which may not be JSON at all). */
export function tokensNeededIn(status: number, text: string): TokensNeeded | null {
  if (status !== 429) return null
  try {
    return tokensNeeded(status, JSON.parse(text))
  } catch {
    return null
  }
}

export const tokensChanged = () => announce(TOKENS_CHANGED)
export const openTokenStore = () => announce(OPEN_TOKEN_STORE)
