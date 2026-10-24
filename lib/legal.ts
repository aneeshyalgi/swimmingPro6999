/**
 * Who runs SwimGPT, as the Legal notice, Privacy Policy and Terms must name them. German law (§ 5 DDG, Art. 13 GDPR)
 * requires a real name, a postal address where legal mail can be delivered (a business address service is fine, a PO
 * box is not) and an email address, plus a second quick way to reach you (a phone number). Until the name and address
 * are filled in, the Legal notice shows SwimGPT and its email instead; each detail appears once it's filled in.
 */
export const OPERATOR = {
  name: "", //              your full legal name, or your company's name (e.g. "SwimGPT UG (haftungsbeschränkt)")
  representative: "", //    company only: the managing director(s); leave empty if you run SwimGPT yourself
  street: "", //            street and house number
  postcodeCity: "", //      e.g. "10115 Berlin"
  country: "Germany",
  email: "support@swim-gpt.com", // used for privacy requests and withdrawals too
  phone: "", //             a second quick way to reach you
  register: "", //          company only: e.g. "Amtsgericht Berlin-Charlottenburg, HRB 123456"
  vatId: "", //             if you have one: e.g. "DE123456789"
  // Where Supabase stores the database (Supabase dashboard → Project Settings → General → Region),
  // e.g. "the EU (Frankfurt, Germany)".
  databaseRegion: "",
}

export type OperatorField = keyof typeof OPERATOR

/** SwimGPT on Instagram. Customer service is by email only (Terms, "Customer service"): the Legal notice says requests sent
 * here aren't handled, and gives Instagram as the way to reach us only while there's no email. */
export const INSTAGRAM = { handle: "@swim.gpt", url: "https://www.instagram.com/swim.gpt/" }

/** The version of the Terms and Privacy Policy (backend/app/consents.py keeps it with every consent). */
export const LEGAL_VERSION = "2026-10-19"
export const LEGAL_UPDATED = "19 October 2026"
export const SITE = "swim-gpt.com"
/** From this age athletes may use SwimGPT; below PARENTAL_CONSENT_AGE a parent or guardian must agree. */
export const MINIMUM_AGE = 13
export const PARENTAL_CONSENT_AGE = 16
