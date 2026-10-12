import Link from "next/link"
import { INSTAGRAM, OPERATOR, type OperatorField } from "@/lib/legal"

const filled = (field: OperatorField) => OPERATOR[field].trim() !== ""

/** SwimGPT's Instagram account. */
export function InstagramLink() {
  return <a href={INSTAGRAM.url} target="_blank" rel="noreferrer">{INSTAGRAM.handle}</a>
}

/** Name and postal address, as a block (the Legal notice); until they're filled in, SwimGPT and its email (or, without
 * one, its Instagram). */
export function OperatorAddress() {
  if (!filled("name") || !filled("street") || !filled("postcodeCity")) {
    return <p>SwimGPT<br />{filled("email") ? <>Email: <a href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</a></> : <>Instagram: <InstagramLink /></>}</p>
  }
  return (
    <address className="not-italic">
      {OPERATOR.name}<br />
      {OPERATOR.representative && <>Represented by {OPERATOR.representative}<br /></>}
      {OPERATOR.street}<br />
      {OPERATOR.postcodeCity}<br />
      {OPERATOR.country}
    </address>
  )
}

/** Email and phone once they're filled in (the Legal notice). Customer service is by email only (Terms, "Customer
 * service"), so Instagram is named as not a channel for requests; without an email, it's how to reach us. */
export function OperatorContact() {
  if (!filled("email")) return <p>{filled("phone") && <>Phone: {OPERATOR.phone}<br /></>}Instagram: <InstagramLink /></p>
  return (
    <>
      <p>
        Email: <a href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</a>
        {filled("phone") && <><br />Phone: {OPERATOR.phone}</>}
      </p>
      <p>We handle all customer service by email. Requests sent through Instagram (<InstagramLink />), other social media or any other channel are not handled.</p>
    </>
  )
}

/*
 * The Privacy Policy and Terms show the operator's details once they're filled in, and until then nothing: they point to
 * the Legal notice, which lists them.
 */

/** Name, address, email and phone, whichever are filled in; nothing if none is. */
export function OperatorDetails() {
  if (!filled("name") && !filled("email")) return null
  return (
    <p>
      {filled("name") && <>{OPERATOR.name}<br /></>}
      {filled("representative") && <>Represented by {OPERATOR.representative}<br /></>}
      {filled("street") && <>{OPERATOR.street}<br /></>}
      {filled("postcodeCity") && <>{OPERATOR.postcodeCity}, {OPERATOR.country}<br /></>}
      {filled("email") && <>Email: <a href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</a><br /></>}
      {filled("phone") && <>Phone: {OPERATOR.phone}</>}
    </p>
  )
}

/** The operator in one line ("name, street, city, country, email: …, phone: …"), or "" until it's filled in. */
export function operatorLine() {
  if (!filled("name") || !filled("street") || !filled("postcodeCity")) return ""
  return [OPERATOR.name, OPERATOR.street, OPERATOR.postcodeCity, OPERATOR.country,
    filled("email") && `email: ${OPERATOR.email}`, filled("phone") && `phone: ${OPERATOR.phone}`].filter(Boolean).join(", ")
}

/** "email us at …", or until the email is filled in, "contact us using the details in our Legal notice". */
export function ContactUs() {
  return filled("email")
    ? <>email us at <a href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</a></>
    : <>contact us using the details in our <Link href="/legal-notice">Legal notice</Link></>
}
