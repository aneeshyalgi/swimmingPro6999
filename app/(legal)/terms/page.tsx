import type { Metadata } from "next"
import Link from "next/link"
import { LegalDocument, type LegalSection } from "@/components/legal/legal-document"
import { ContactUs, OperatorDetails, operatorLine } from "@/components/legal/operator"
import { OPERATOR } from "@/lib/legal"

// The operator in the withdrawal notice and form, once filled in (lib/legal.ts); until then the Legal notice has it.
const operator = operatorLine()
// Where customer service is reached: the email in lib/legal.ts, or until it's filled in, the Legal notice.
const supportEmail = OPERATOR.email
  ? <a href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</a>
  : <>the email address in our <Link href="/legal-notice">Legal notice</Link></>

export const metadata: Metadata = {
  title: "Terms of Service · SwimGPT",
  description: "The terms for using SwimGPT: subscriptions, cancellation, your right of withdrawal, AI coaching and safety.",
}

const sections: LegalSection[] = [
  {
    id: "scope",
    title: "Who we are and what these Terms cover",
    summary: "These Terms are the agreement between you and the operator of SwimGPT whenever you use the website or the app.",
    body: (
      <>
        <p>These Terms of Service apply to your use of the website swim-gpt.com and the SwimGPT app (together &ldquo;SwimGPT&rdquo;), provided by the operator named in our <Link href="/legal-notice">Legal notice</Link> (&ldquo;we&rdquo;, &ldquo;us&rdquo;).</p>
        <OperatorDetails />
        <p>You are a <strong>consumer</strong> if you use SwimGPT for purposes outside your trade, business or profession (§ 13 BGB), and a <strong>business</strong> otherwise (§ 14 BGB). Different terms of yours don&apos;t apply unless we agree to them in writing. The contract language is English.</p>
        <p>The current Terms are always available at swim-gpt.com/terms, where you can read, print or save them. We store the version you accepted.</p>
      </>
    ),
  },
  {
    id: "service",
    title: "What SwimGPT offers",
    summary: "AI swim coaching: a season plan, swim and gym weeks, coach chat and voice conversations, video feedback and more.",
    body: (
      <>
        <p>SwimGPT is an AI coaching service for swimmers. With a subscription you get your personalised season plan, swim and gym weeks, the workout library and calendar, race planning and pacing, progress tracking, Mind and Nutrition guidance, chats and voice conversations with your AI coach, and video stroke analysis, as described in the app when you subscribe.</p>
        <p>Without a subscription you can create an account, complete onboarding, see a preview of your plan and analyse one video for free. Training plans in our store are sold separately. What exactly is included is shown on the payment screen and in the app.</p>
      </>
    ),
  },
  {
    id: "eligibility",
    title: "Who can use SwimGPT",
    summary: "You must be at least 13. Under 16, a parent or guardian must agree. Under 18, they must also agree to paid plans and purchases.",
    body: (
      <>
        <p>You must be at least <strong>13 years old</strong> to use SwimGPT. If you are under 16, a parent or guardian must agree when you sign up. If you are under 18, you may only start a paid plan or make a purchase with the consent of a parent or guardian.</p>
        <p>Each account is for one person. Please give accurate information, keep your password to yourself and tell us straight away if you think someone else is using your account. You are responsible for what happens in your account where you are at fault.</p>
      </>
    ),
  },
  {
    id: "safety",
    title: "Your health and safety",
    summary: "SwimGPT gives training guidance, not medical advice. Check with a doctor before you start, and stop if something feels wrong.",
    body: (
      <>
        <p>SwimGPT provides training information. It is <strong>not medical advice</strong> and doesn&apos;t replace a doctor, physiotherapist, dietitian or a qualified coach on the pool deck. Talk to a doctor before you start a training programme, especially if you have an illness, injury, heart or breathing problems, are pregnant or take medication.</p>
        <ul>
          <li>Listen to your body. Stop at once and get help if you feel pain, dizziness, chest pain or unusual shortness of breath.</li>
          <li>Train where lifeguards or other qualified people are present, and never alone in open water. Swimmers under 18 should train under the supervision of a qualified coach or responsible adult.</li>
          <li>Never practise breath-holding or hypoxic training on your own: it can cause blackouts in the water.</li>
          <li>Nutrition guidance is general. It isn&apos;t made for medical diets, allergies or eating disorders; always check food labels and ask a professional.</li>
          <li>If you are struggling with how you feel, please talk to someone you trust or a professional. SwimGPT can&apos;t help in an emergency: call your local emergency number (112 in the EU).</li>
        </ul>
        <p>You decide whether and how to follow any suggestion. Adapt it to your ability, health and surroundings.</p>
      </>
    ),
  },
  {
    id: "ai",
    title: "AI coaches and AI-generated content",
    summary: "Your coaches are AI characters. What they create can be wrong or unsuitable, so use your own judgement.",
    body: (
      <>
        <p>Plans, sessions, chat answers, coach voices and video feedback are created automatically by AI models. They can contain mistakes or suggestions that don&apos;t suit you, so check that they make sense before you follow them. We don&apos;t promise any particular result, such as times, places or qualifications.</p>
        <p>Coach Brad, Coach Pete, Coach Timothy, Coach Robert and Coach Tony are <strong>fictional AI characters</strong>. Where a coach&apos;s programme is described as inspired by a real person or training method, this only describes publicly known approaches to training. <strong>Those people are not affiliated with SwimGPT, have not created, reviewed or endorsed SwimGPT or its content, and are not involved in your coaching.</strong></p>
      </>
    ),
  },
  {
    id: "free",
    title: "Free features",
    summary: "Some things are free, like one video analysis. We may change or end free features.",
    body: (
      <p>Free features, such as one free video analysis per person, are a voluntary extra with no right to keep them. We may change or end them with reasonable notice. Please don&apos;t try to get more than your share, for example with extra accounts or by clearing your browser.</p>
    ),
  },
  {
    id: "subscriptions",
    title: "Subscriptions, prices and renewal",
    summary: "Choose monthly or yearly. You pay in advance and your plan renews automatically until you cancel.",
    body: (
      <>
        <h3>Plans and prices</h3>
        <p>You can pay monthly or yearly. The price that applies is the one shown on the payment screen and on the checkout page before you order. Prices are final prices.</p>
        <h3>How you subscribe</h3>
        <ol>
          <li>On the payment screen, choose monthly or yearly, tick the box asking for your plan to start straight away, and select &ldquo;Start my plan&rdquo;.</li>
          <li>You are taken to the secure checkout page of our payment provider Stripe, which shows the plan, the price and how it renews.</li>
          <li>Enter your payment details. You can correct your entries at any time before ordering, or go back with the back link.</li>
          <li>By clicking the payment button (&ldquo;Subscribe&rdquo;), you make a binding offer to subscribe.</li>
          <li>The contract is concluded when we accept your offer by confirming your payment; your dashboard then opens.</li>
        </ol>
        <h3>Payment</h3>
        <p>You pay through Stripe with one of the payment methods offered at checkout, in advance at the start of each billing period.</p>
        <h3>Renewal</h3>
        <ul>
          <li><strong>Monthly:</strong> your plan renews every month until you cancel.</li>
          <li><strong>Yearly:</strong> the first term is 12 months. Unless you cancel before it ends, your plan then continues for an indefinite period and is billed yearly in advance. From then on you can cancel at any time with one month&apos;s notice, and we refund the part of any payment that covers the time after your cancellation takes effect.</li>
        </ul>
        <h3>Failed payments</h3>
        <p>If a payment fails, Stripe will try again. If a payment fails or is reversed, for example through a chargeback, we may pause your access until the amount has been paid. If it remains unpaid after a reminder, we may end the subscription.</p>
        <h3>Price changes</h3>
        <p>We will only raise the price of your existing subscription with your express consent. If you don&apos;t agree, your subscription continues at the old price, and we may end it at the end of a billing period with at least one month&apos;s notice.</p>
        <h3>Changing coach</h3>
        <p>Changing your coach from the dashboard can cost a one-time fee, which is shown before you pay. It is not refunded once the switch is complete (see <a href="#withdrawal">Your right of withdrawal</a>).</p>
      </>
    ),
  },
  {
    id: "cancellation",
    title: "Cancelling",
    summary: "Cancel any time in your account. You keep access until the end of the period you've paid for.",
    body: (
      <>
        <p>You can cancel your subscription at any time in the app (Subscription → Cancel subscription), or by email{OPERATOR.email ? <> to <a href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</a></> : <> (see our <Link href="/legal-notice">Legal notice</Link>)</>}. The cancellation takes effect at the end of the current billing period (for a yearly plan after its first term, see <a href="#subscriptions">Renewal</a>). Until then you keep full access, and you can change your mind. We confirm your cancellation in the app, or by reply if you cancelled by email.</p>
        <p>Payments already made are not refunded, except under your statutory rights (in particular your <a href="#withdrawal">right of withdrawal</a>) or as described for yearly plans above.</p>
        <p>We may end a subscription with at least one month&apos;s notice to the end of a billing period, for example if we stop offering SwimGPT, and refund any amount you&apos;ve paid for the time after. Both of us may end the contract without notice for good cause (§ 314 BGB), for example if you seriously breach these Terms.</p>
      </>
    ),
  },
  {
    id: "withdrawal",
    title: "Your right of withdrawal",
    summary: "As a consumer you can withdraw within 14 days, but what you've already received is not refunded: the days of your subscription you've had, and a coach switch once it's complete. After the 14 days, payments are refunded only where these Terms or the law require it.",
    body: (
      <>
        <p>If you are a consumer, you have the following statutory right of withdrawal:</p>
        <div className="lg-boxed">
          <p><strong>Right of withdrawal</strong></p>
          <p>You have the right to withdraw from this contract within 14 days without giving any reason. The withdrawal period will expire after 14 days from the day of the conclusion of the contract.</p>
          <p>To exercise the right of withdrawal, you must inform us ({operator || <>using the contact details in our <Link href="/legal-notice">Legal notice</Link></>}) of your decision to withdraw from this contract by an unequivocal statement (e.g. a letter sent by post or an email). You may use the model withdrawal form below, but it is not obligatory.</p>
          <p>To meet the withdrawal deadline, it is sufficient for you to send your communication concerning your exercise of the right of withdrawal before the withdrawal period has expired.</p>
          <p><strong>Effects of withdrawal</strong></p>
          <p>If you withdraw from this contract, we shall reimburse to you all payments received from you, including the costs of delivery (with the exception of the supplementary costs resulting from your choice of a type of delivery other than the least expensive type of standard delivery offered by us), without undue delay and in any event not later than 14 days from the day on which we are informed about your decision to withdraw from this contract. We will carry out such reimbursement using the same means of payment as you used for the initial transaction, unless you have expressly agreed otherwise; in any event, you will not incur any fees as a result of such reimbursement.</p>
          <p>If you requested to begin the performance of services during the withdrawal period, you shall pay us an amount which is in proportion to what has been provided until you have communicated us your withdrawal from this contract, in comparison with the full coverage of the contract.</p>
        </div>
        <p><strong>Your subscription.</strong> When you start your subscription, you ask us at checkout to provide it straight away, before the withdrawal period ends, and we begin at once. From that moment, everything SwimGPT provides is a service you have received, including workout and season plan generation, coach chat and live voice calls, nutrition and mental performance support, performance tracking and every other feature of your subscription. If you withdraw within the 14 days, you pay for your subscription up to and including the day we receive your withdrawal, calculated per day from the price of your billing period, and only the remainder is refunded. Cancelling your subscription is not a withdrawal: it only ends your subscription for the future, as described under <a href="#cancellation">Cancelling</a>. Once the withdrawal period has ended, payments are not refunded, except in the cases described under <a href="#cancellation">Cancelling</a>.</p>
        <p><strong>Coach switches.</strong> A coach switch is carried out straight away, as you ask at checkout, and is complete once your season plan has been rebuilt with your new coach. From then on, your right of withdrawal has ended and the payment for the switch is not refunded (§ 356(4) BGB).</p>
        <p><strong>Training plans.</strong> A training plan from our store (digital content not supplied on a tangible medium) is unlocked in your account as soon as your payment is confirmed. Your right of withdrawal ends at that moment, even if you never open the plan, provided you expressly agreed at checkout that we unlock it before the withdrawal period ends, confirmed that you know you thereby lose your right of withdrawal, and we have sent you a confirmation of this (§ 356(5) BGB). Once it has ended, the plan is not refunded.</p>
        <p><strong>Business customers.</strong> If you use SwimGPT for purposes of your trade, business or profession, you have no right of withdrawal, and payments are not refunded except where the law requires it.</p>
        <div className="lg-boxed">
          <p><strong>Model withdrawal form</strong></p>
          <p>(Complete and return this form only if you wish to withdraw from the contract.)</p>
          <p>To {operator || <>SwimGPT (name, postal address and email: see our <Link href="/legal-notice">Legal notice</Link>)</>}:</p>
          <p>I/We (*) hereby give notice that I/We (*) withdraw from my/our (*) contract for the provision of the following service (*) / the supply of the following digital content (*):</p>
          <p>Ordered on (*) / received on (*):<br />Name of consumer(s):<br />Address of consumer(s):<br />Signature of consumer(s) (only if this form is notified on paper):<br />Date:</p>
          <p>(*) Delete as appropriate.</p>
        </div>
      </>
    ),
  },
  {
    id: "store",
    title: "Training plans from our store",
    summary: "Training plans you buy are yours to read in the app, for your own personal use.",
    body: (
      <>
        <p>Training plans are one-time purchases at the price shown before you pay. You order them the same way as a subscription, using the payment button (&ldquo;Pay&rdquo;) on the checkout page. You can read a plan you&apos;ve bought in the SwimGPT reader for as long as we offer SwimGPT; if we ever stop, we will tell you in good time. Your right of withdrawal for a plan ends once it is unlocked, as described under <a href="#withdrawal">Your right of withdrawal</a>.</p>
        <p>You receive a personal, non-transferable right to read the plan for your own training. You may not copy, share, publish or resell it, in whole or in part.</p>
      </>
    ),
  },
  {
    id: "conduct",
    title: "Your content and fair use",
    summary: "Use SwimGPT fairly, and only share content you're allowed to share.",
    body: (
      <>
        <p>What you put into SwimGPT, such as messages, voice recordings, videos, workouts and notes, stays yours. You allow us to use it only as far as needed to provide SwimGPT to you. Only film or upload other people if they agree (for children, their parents).</p>
        <p>You may not use SwimGPT to:</p>
        <ul>
          <li>share content that is illegal, hurtful, discriminatory or infringes the rights of others;</li>
          <li>get the AI to produce harmful or dangerous content;</li>
          <li>get around limits or payments, for example with several free accounts;</li>
          <li>access SwimGPT automatically (bots, scraping), overload or attack it, or test its security without our permission;</li>
          <li>copy, decompile or reverse engineer SwimGPT, except where the law allows (§ 69e UrhG);</li>
          <li>share or resell your account.</li>
        </ul>
        <p>If you break these rules, we may remove content, warn you, suspend your account or, in serious cases, end the contract. We take your interests into account and, where reasonable, give you a chance to explain first.</p>
      </>
    ),
  },
  {
    id: "ip",
    title: "Our rights in SwimGPT",
    summary: "SwimGPT, its content and its brand belong to us or the people we license them from.",
    body: (
      <p>The SwimGPT software, design, texts, coach characters, training programmes and plans are protected and belong to us or our licensors. During your contract you may use SwimGPT for your own personal training; this right is non-exclusive and can&apos;t be transferred or sub-licensed. You may use the plans and workouts created for you for your own training. You don&apos;t receive any rights to our name or logo.</p>
    ),
  },
  {
    id: "availability",
    title: "Availability and changes to SwimGPT",
    summary: "We work to keep SwimGPT running and improving. There may be short interruptions.",
    body: (
      <>
        <p>We aim to keep SwimGPT available around the clock, but maintenance, updates and outages at our providers can cause interruptions. We provide the updates needed to keep SwimGPT working as agreed (§ 327f BGB).</p>
        <p>We may change SwimGPT where there is a valid reason, such as technical development, new features, security or legal requirements, at no extra cost to you, and we will tell you clearly about the change. If a change affects your access or use more than slightly, we will tell you in advance, and you may end the contract free of charge within 30 days (§ 327r BGB).</p>
      </>
    ),
  },
  {
    id: "warranty",
    title: "If something doesn't work",
    summary: "If SwimGPT doesn't work as it should, you have your statutory rights.",
    body: (
      <p>If you are a consumer, the statutory rights for digital products apply (§§ 327 ff. BGB). If you are a business, the statutory rules apply as far as they can't be limited by agreement. If something doesn&apos;t work, please <ContactUs /> so we can fix it.</p>
    ),
  },
  {
    id: "support",
    title: "Customer service",
    summary: `All customer service is by email${OPERATOR.email ? ` to ${OPERATOR.email}` : ""}. We don't handle requests sent through Instagram or any other channel.`,
    body: (
      <>
        <p>We provide customer service exclusively by email. Please send every request, question and complaint to {supportEmail}, where possible from the email address of your SwimGPT account. This covers everything, including your account, payments, subscriptions, cancellations, withdrawals, refunds, technical problems and questions about your data. Email lets us identify your account, keep a record of your request and answer it reliably.</p>
        <p>Instagram, other social media and any other channel are not customer service channels. We do not monitor them for requests, and requests sent through them are not handled. Messages to your AI coach in the app are answered by the AI and are not passed on to us as requests.</p>
        <p>This does not limit your statutory rights. In particular, you can always cancel your subscription in the app, and exercise your right of withdrawal as described under <a href="#withdrawal">Your right of withdrawal</a>.</p>
      </>
    ),
  },
  {
    id: "liability",
    title: "Liability",
    summary: "We are fully liable for intent, gross negligence and harm to life, body or health. Otherwise our liability is limited as German law allows.",
    body: (
      <>
        <p>We are liable without limitation for intent and gross negligence, for injury to life, body or health, under the Product Liability Act and where we have given a guarantee.</p>
        <p>For slight negligence we are only liable for breaching an essential contractual obligation, meaning an obligation that makes the proper performance of the contract possible in the first place and on which you can regularly rely. In that case our liability is limited to the damage that is foreseeable and typical for this kind of contract. Otherwise, liability for slight negligence is excluded.</p>
        <p>These rules also apply to our employees, representatives and agents. AI-generated suggestions don&apos;t replace your own judgement (see <a href="#safety">Your health and safety</a>); this doesn&apos;t limit our liability for injury to life, body or health.</p>
      </>
    ),
  },
  {
    id: "account-end",
    title: "Deleting your account",
    summary: "You can ask us to delete your account at any time.",
    body: (
      <p>To delete your account, <ContactUs />. Please cancel any running subscription first, or tell us to cancel it for you. We then delete your data as described in our <Link href="/privacy">Privacy Policy</Link>, except what we must keep by law. Payments already made are not refunded, except under your statutory rights.</p>
    ),
  },
  {
    id: "changes",
    title: "Changes to these Terms",
    summary: "If we want to change these Terms for your existing plan, we ask you first.",
    body: (
      <p>New versions of these Terms apply to new contracts. We change the Terms of your existing contract only with your consent: we will send you the changes at least 30 days before they are meant to apply and ask whether you agree. If you don&apos;t agree, your current Terms continue to apply, and we may end the contract as described in <a href="#cancellation">Cancelling</a>.</p>
    ),
  },
  {
    id: "law",
    title: "Applicable law and disputes",
    summary: "German law applies, but you keep the consumer protection of the country you live in.",
    body: (
      <>
        <p>German law applies, excluding the UN Convention on Contracts for the International Sale of Goods. If you are a consumer, you also keep the protection of the mandatory rules of the country where you normally live.</p>
        <p>If you are a merchant, a legal entity under public law or a special fund under public law, the courts at our place of business have exclusive jurisdiction.</p>
        <p>We are neither obliged nor willing to take part in dispute resolution proceedings before a consumer arbitration board (§ 36 VSBG).</p>
      </>
    ),
  },
  {
    id: "final",
    title: "Final provisions",
    summary: "If one part of these Terms is invalid, the rest still applies.",
    body: (
      <p>If any provision of these Terms is or becomes invalid, the rest remain valid; the statutory rules apply in place of the invalid provision (§ 306 BGB). We may transfer this contract to another company only if we tell you in advance, and you may then end the contract free of charge.</p>
    ),
  },
]

export default function TermsPage() {
  return (
    <LegalDocument
      current="/terms"
      eyebrow="Terms of Service"
      title="The deal, in plain words"
      lead="What you get with SwimGPT, how subscriptions, renewal and cancelling work, your 14-day right of withdrawal, and how to train safely with an AI coach."
      readMinutes={13}
      highlights={[
        { icon: "cancel", text: "Cancel any time in your account. You keep access until the period ends." },
        { icon: "renew", text: "Plans renew automatically until you cancel. No hidden fees." },
        { icon: "scale", text: "Consumers can withdraw within 14 days without giving a reason." },
        { icon: "ai", text: "Your coach is AI. Train safely and use your own judgement." },
      ]}
      sections={sections}
    />
  )
}
