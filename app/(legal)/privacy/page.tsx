import type { Metadata } from "next"
import Link from "next/link"
import { LegalDocument, type LegalSection } from "@/components/legal/legal-document"
import { ContactUs, OperatorDetails } from "@/components/legal/operator"
import { OPERATOR } from "@/lib/legal"

export const metadata: Metadata = {
  title: "Privacy Policy · SwimGPT",
  description: "How SwimGPT handles your personal data: what we collect, why, who helps us, how long we keep it and your rights.",
}

const external = { target: "_blank", rel: "noreferrer" }

const sections: LegalSection[] = [
  {
    id: "controller",
    title: "Who is responsible",
    body: (
      <>
        <p>The controller responsible for processing your personal data under the EU General Data Protection Regulation (GDPR) is the operator of SwimGPT named in our <Link href="/legal-notice">Legal notice</Link>, which also lists how to reach us.</p>
        <OperatorDetails />
        <p>We are not required to appoint a data protection officer (Art. 37 GDPR, § 38 BDSG). For any question about your data, <ContactUs />.</p>
        <p>This policy covers our website <strong>swim-gpt.com</strong> and the SwimGPT app (together &ldquo;SwimGPT&rdquo;).</p>
      </>
    ),
  },
  {
    id: "overview",
    title: "Overview",
    body: (
      <>
        <div className="lg-table">
          <table>
            <thead><tr><th>What</th><th>Why</th><th>Legal basis (GDPR)</th></tr></thead>
            <tbody>
              <tr><td>Technical data when you visit (IP address, browser)</td><td>Deliver the site securely</td><td>Art. 6(1)(f)</td></tr>
              <tr><td>Anonymous page statistics</td><td>Improve SwimGPT</td><td>Art. 6(1)(f)</td></tr>
              <tr><td>Account (name, email, password)</td><td>Your account and sign-in</td><td>Art. 6(1)(b)</td></tr>
              <tr><td>Swimming profile and training data</td><td>Build and adapt your plan</td><td>Art. 6(1)(b)</td></tr>
              <tr><td>Mind and Nutrition answers, check-ins</td><td>Tailor mental and nutrition guidance</td><td>Art. 9(2)(a), 6(1)(a): your consent</td></tr>
              <tr><td>A parent or guardian&apos;s consent (under 16)</td><td>Prove that they agreed</td><td>Art. 6(1)(c), 7(1), 8</td></tr>
              <tr><td>Chats, voice and video frames</td><td>AI coaching answers</td><td>Art. 6(1)(b)</td></tr>
              <tr><td>Survey answers, if you take part</td><td>Improve SwimGPT</td><td>Art. 6(1)(f); emails about your answers or new surveys: 6(1)(a)</td></tr>
              <tr><td>Payment data</td><td>Subscriptions and purchases, bookkeeping</td><td>Art. 6(1)(b) and (c)</td></tr>
            </tbody>
          </table>
        </div>
        <p>We never sell your data, show you advertising or use advertising or tracking cookies.</p>
      </>
    ),
  },
  {
    id: "hosting",
    title: "Visiting SwimGPT",
    body: (
      <>
        <p>Every time you open a page or the app talks to our server, the servers automatically log: your IP address, the date and time, the page or address requested, the referring page, your browser and operating system, the amount of data sent and whether the request succeeded.</p>
        <p>We need this to deliver SwimGPT, keep it stable and secure and detect attacks. The legal basis is our legitimate interest in a secure, working service (Art. 6(1)(f) GDPR). The logs are deleted after a short time, at the latest after 30 days, unless we need them to investigate a specific security incident.</p>
        <p>The website and app are hosted by <strong>Vercel Inc.</strong> (USA). Our app server runs at <strong>Render Services, Inc.</strong> (USA). Both process the data for us under data processing agreements (Art. 28 GDPR). For transfers to the USA, see <a href="#transfers">Transfers outside the EU</a>.</p>
      </>
    ),
  },
  {
    id: "analytics",
    title: "Page statistics",
    body: (
      <>
        <p>To see which pages are used, we use <strong>Vercel Web Analytics</strong>. It records the page visited, the referring page, your country (worked out from your IP address, which is not stored), and your browser, operating system and device type. It uses no cookies and stores nothing on your device. Visits aren&apos;t linked across days: a visitor is recognised only by a code derived from the request that is discarded after 24 hours.</p>
        <p>We only see totals, never individual people. The legal basis is our legitimate interest in understanding and improving SwimGPT (Art. 6(1)(f) GDPR). Because nothing is stored on or read from your device, § 25 TDDDG doesn&apos;t apply. You can object at any time (see <a href="#rights">Your rights</a>).</p>
      </>
    ),
  },
  {
    id: "device",
    title: "Cookies and storage on your device",
    body: (
      <>
        <p>SwimGPT sets no cookies. In your browser&apos;s local storage the app keeps:</p>
        <ul>
          <li>your sign-in session, so you stay signed in;</li>
          <li>your unfinished onboarding answers, so you can continue later;</li>
          <li>your unfinished survey answers, so you can continue later (see <a href="#survey">Feedback survey</a>);</li>
          <li>your coach chat history (your conversations are saved on your device, not on our servers);</li>
          <li>your chosen coach and a few app settings, and a note of checkouts in progress;</li>
          <li>a random visitor ID and whether you&apos;ve used the free video analysis (see <a href="#video-limit">Free video analysis</a>).</li>
        </ul>
        <p>This storage is strictly necessary to provide the service you ask for (§ 25(2) no. 2 TDDDG); using the data is based on Art. 6(1)(b) GDPR, or Art. 6(1)(f) GDPR for the free-analysis note. You can delete it at any time in your browser settings. You will then be signed out and lose any chats saved on that device.</p>
      </>
    ),
  },
  {
    id: "account",
    title: "Your account",
    body: (
      <>
        <p>When you sign up we process your name, email address and password (stored only as a secure hash), when you signed up and signed in, the IP address of sign-in requests, and the version of our Terms and this policy you accepted.</p>
        <p>We use this to create and run your account, sign you in and send you account emails such as the email confirmation and password resets. The legal basis is our contract with you (Art. 6(1)(b) GDPR); keeping proof of what you accepted is based on our legal obligations and legitimate interest (Art. 6(1)(c) and (f) GDPR).</p>
        <p>Sign-in, the database and file storage are provided by <strong>Supabase, Inc.</strong> (USA) as our processor{OPERATOR.databaseRegion && <>; our database is located in {OPERATOR.databaseRegion}</>}. We keep your account data for as long as your account exists (see <a href="#retention">How long we keep data</a>).</p>
      </>
    ),
  },
  {
    id: "training",
    title: "Your swimming profile and training",
    body: (
      <>
        <p>During onboarding you tell us your age, gender, country, height (optional), weight, years of swimming, your events, personal bests and goal times, the kind of swimmer you are, how often and how long you can train, your facilities, your coaching situation and the coach you choose.</p>
        <p>While you use SwimGPT we also keep your season plan, swim and gym weeks, the workouts you create or change, what you complete, your races, splits and meets, and your pace calculations.</p>
        <p>We use this to create your plan, adapt it to your progress and show you your training. The legal basis is our contract with you (Art. 6(1)(b) GDPR). Without this information we can&apos;t create your plan. If you add other swimmers (for example in the pace calculator), please only do so if you&apos;re allowed to share their details; we process them only to provide that feature for you.</p>
      </>
    ),
  },
  {
    id: "health",
    title: "Health information (Mind and Nutrition)",
    body: (
      <>
        <p>In <strong>Mind</strong> you can rate your confidence, focus, calm, motivation and how you bounce back, and tell us how you sleep, your stress level, your mood, how you handle setbacks and which mental tools you use. You can also check in on your mood each day (we keep the last 14 check-ins). In <strong>Nutrition</strong> you can tell us your goal, meals per day and foods you avoid, such as dairy, gluten, nuts, eggs, seafood or soy, which can reveal intolerances, allergies or beliefs, and log your water (we keep the last 7 days). Daily session check-ins (effort, energy, soreness, sleep quality and notes) also count as health information.</p>
        <p>This is special category data under Art. 9 GDPR. We use it only to tailor your mental skills, nutrition guidance and training load, and only with your <strong>explicit consent</strong> (Art. 9(2)(a) and 6(1)(a) GDPR), which we ask for the first time you open Mind or Nutrition. For athletes under 16, a parent or guardian gives this consent (see <a href="#children">Children and teenagers</a>). Mind and Nutrition guidance is chosen from fixed, reviewed text, not written by AI. Daily session check-ins can be taken into account when your coach answers you or plans your training (see <a href="#ai">AI coaching</a>).</p>
        <p><strong>You can withdraw your consent at any time</strong>, in Mind or Nutrition or by email. We then stop using this information and delete your Mind and Nutrition answers, check-ins and water log. Withdrawing doesn&apos;t affect anything done before (Art. 7(3) GDPR). Giving this consent is voluntary: everything else in SwimGPT works without it.</p>
      </>
    ),
  },
  {
    id: "children",
    title: "Children and teenagers",
    body: (
      <>
        <p>You must be at least 13 to use SwimGPT. If you are under 16, a parent or guardian must agree when you sign up: to you using SwimGPT, to us processing your data as described in this policy (including Mind and Nutrition, if you use them), and to any paid plan.</p>
        <p>We keep the parent or guardian&apos;s name and email address and when they agreed, to be able to prove the consent and contact them if needed (Art. 6(1)(c), 7(1) and 8 GDPR). Parents and guardians can exercise their child&apos;s rights and withdraw their consent at any time by emailing us. If we learn that someone under 13 is using SwimGPT, we will delete their account.</p>
      </>
    ),
  },
  {
    id: "ai",
    title: "AI coaching",
    body: (
      <>
        <p>SwimGPT&apos;s coaches are AI. You are always talking to an AI system, never to a person. To create your content, we send the necessary data to <strong>OpenAI</strong> (OpenAI Ireland Ltd., Ireland, and OpenAI, L.L.C., USA), which processes it for us as our processor:</p>
        <ul>
          <li><strong>Plans, weeks and workouts:</strong> your swimming profile and training data, and your daily session check-ins if you agreed to their use.</li>
          <li><strong>Coach chat:</strong> your message, your recent conversation (up to 20 messages) and your profile and training context. Chats are saved on your device, not on our servers.</li>
          <li><strong>Voice conversations:</strong> your recorded speech, so OpenAI can turn it into text, and your coach&apos;s reply, which OpenAI turns into an AI voice. We don&apos;t keep the recordings.</li>
          <li><strong>Video analysis:</strong> your clip stays on your device. Body tracking runs in your browser, and only a few still frames and the tracking measurements are sent to recognise your stroke. We don&apos;t keep the clip or the frames.</li>
        </ul>
        <p>Under OpenAI&apos;s terms for API customers, OpenAI doesn&apos;t use this data to train its models and keeps it for up to 30 days to detect abuse, then deletes it. The legal basis is our contract with you (Art. 6(1)(b) GDPR) and, for health information, your consent (Art. 9(2)(a) GDPR). Only film other people if they agree (for children, their parents).</p>
        <p>Choosing a coach for you and adapting your plan is an automated evaluation of your data (profiling), but it never leads to decisions with legal effects on you or that similarly significantly affect you (Art. 22 GDPR). AI can make mistakes; please see our <Link href="/terms#ai">Terms</Link>.</p>
      </>
    ),
  },
  {
    id: "video-limit",
    title: "Free video analysis",
    body: (
      <>
        <p>Everyone can analyse one video for free. To stop the same person taking several, we note that the free analysis was used: by a random visitor ID kept in your browser, by your account if you are signed in, and by a scrambled code (a keyed hash) made from your IP address and browser that can&apos;t be turned back into them. We keep the network code for 30 days; the visitor ID and account notes for as long as we offer the free analysis.</p>
        <p>The legal basis is our legitimate interest in preventing abuse of a free offer (Art. 6(1)(f) GDPR); keeping the visitor ID in your browser is necessary for the free analysis you ask for (§ 25(2) no. 2 TDDDG). These notes are stored with Supabase.</p>
      </>
    ),
  },
  {
    id: "payments",
    title: "Payments",
    body: (
      <>
        <p>When you subscribe, buy a training plan or pay for a coach change, you pay on Stripe&apos;s secure checkout page. Stripe processes your name, email address, billing country or address, payment details (such as your card or your Stripe Link account) and the transaction. Stripe may also use device and connection data to prevent fraud.</p>
        <p>From Stripe we receive confirmation of the payment, the plan, amount, status and renewal dates, and Stripe&apos;s customer and subscription references, but never your full card details. The legal bases are our contract with you (Art. 6(1)(b) GDPR), our legal duties to keep accounting records (Art. 6(1)(c) GDPR) and preventing fraud (Art. 6(1)(f) GDPR).</p>
        <p>Payments are provided by <strong>Stripe Payments Europe, Ltd.</strong> (Ireland). For some purposes, such as preventing fraud and meeting its own legal duties, Stripe is a separate controller; see <a href="https://stripe.com/privacy" {...external}>Stripe&apos;s privacy policy</a>. If you choose Stripe Link, Link saves your payment details for future purchases under Stripe&apos;s terms. We keep payment and invoice records for 10 years, as German tax and commercial law requires (§ 147 AO, § 257 HGB).</p>
      </>
    ),
  },
  {
    id: "store",
    title: "Training plan store",
    body: (
      <p>For each purchase we keep the plan, price, currency, date, payment status and Stripe&apos;s payment reference. You read your plans in the app. The legal bases are our contract with you (Art. 6(1)(b) GDPR) and our accounting duties (Art. 6(1)(c) GDPR). We keep the purchase record for as long as you have access to the plan, and the payment record for 10 years.</p>
    ),
  },
  {
    id: "emails",
    title: "Emails we send",
    body: (
      <p>You receive account emails (confirming your email address, resetting your password), sent through Supabase. They are part of providing SwimGPT (Art. 6(1)(b) GDPR). If you agree in our feedback survey, we also email you now and then to ask for your feedback, for example when there&apos;s a new survey (see <a href="#survey">Feedback survey</a>). We don&apos;t send newsletters or other marketing emails; if we ever want to, we will ask you first.</p>
    ),
  },
  {
    id: "contact",
    title: "When you contact us",
    body: (
      <p>When you email us, we process your email address, your name and what you write, to answer you. The legal basis is our contract with you or steps before one (Art. 6(1)(b) GDPR), otherwise our legitimate interest in answering enquiries (Art. 6(1)(f) GDPR). We delete your message once your request is dealt with, unless we must keep it by law.</p>
    ),
  },
  {
    id: "survey",
    title: "Feedback survey",
    body: (
      <>
        <p>In your dashboard we may ask you to rate SwimGPT and answer a few questions about it. If you take part, we keep your answers with your account: your rating, how often you use SwimGPT and how your training has changed, the features you use and your rating of each, what you like, what we should improve and build next, how likely you are to recommend SwimGPT, anything you write in your own words, whether we may contact you about your answers, and whether we may email you when there&apos;s a new survey, with when you last chose.</p>
        <p>We use them only to improve SwimGPT. The legal basis is our legitimate interest in learning what works for our athletes and improving SwimGPT (Art. 6(1)(f) GDPR). Taking part is voluntary: you can skip the survey, and nothing in SwimGPT depends on it. Please don&apos;t include health information in what you write. If you allow us to contact you about your answers, we may email you about them (Art. 6(1)(a) GDPR); you can withdraw this at any time by email.</p>
        <p>If you allow us to email you when there&apos;s a new survey, we email you now and then to ask for your feedback (Art. 6(1)(a) GDPR). You can withdraw this at any time: on the survey page, with the link in each of these emails, or by emailing us.</p>
        <p>Until you send them, unfinished answers stay in your browser (see <a href="#device">Cookies and storage on your device</a>). We keep your answers until you delete your account, and delete them sooner if you ask us to.</p>
      </>
    ),
  },
  {
    id: "other-providers",
    title: "Content from other providers",
    body: (
      <>
        <ul>
          <li><strong>Country flags</strong> in the country list during onboarding are loaded from <strong>flagcdn.com</strong>, which receives your IP address and browser details.</li>
          <li><strong>Video analysis:</strong> when you start an analysis, your browser downloads the body-tracking engine (MediaPipe) from <strong>jsDelivr</strong> (cdn.jsdelivr.net) and its model file from <strong>Google Cloud Storage</strong> (Google LLC, USA). These providers receive your IP address and browser details.</li>
        </ul>
        <p>The legal basis is our legitimate interest in showing these quickly and reliably (Art. 6(1)(f) GDPR), and for video analysis our contract with you (Art. 6(1)(b) GDPR). Links to other websites, such as findahelpline.com in Mind, only take you there when you click them; their privacy policies then apply.</p>
      </>
    ),
  },
  {
    id: "recipients",
    title: "Who receives your data",
    body: (
      <>
        <div className="lg-table">
          <table>
            <thead><tr><th>Provider</th><th>What for</th><th>Where</th></tr></thead>
            <tbody>
              <tr><td><a href="https://vercel.com/legal/privacy-policy" {...external}>Vercel Inc.</a></td><td>Hosting the website and app, page statistics</td><td>USA</td></tr>
              <tr><td><a href="https://render.com/privacy" {...external}>Render Services, Inc.</a></td><td>Hosting our app server</td><td>USA</td></tr>
              <tr><td><a href="https://supabase.com/privacy" {...external}>Supabase, Inc.</a></td><td>Sign-in, database, file storage</td><td>USA{OPERATOR.databaseRegion && <>; database in {OPERATOR.databaseRegion}</>}</td></tr>
              <tr><td><a href="https://openai.com/policies/privacy-policy" {...external}>OpenAI</a></td><td>AI coaching, voice, video analysis</td><td>Ireland, USA</td></tr>
              <tr><td><a href="https://stripe.com/privacy" {...external}>Stripe Payments Europe, Ltd.</a></td><td>Payments</td><td>Ireland, USA</td></tr>
            </tbody>
          </table>
        </div>
        <p>These providers process data only on our instructions under data processing agreements (Art. 28 GDPR), except where stated (Stripe, see <a href="#payments">Payments</a>). We also pass on data where the law requires it, for example to authorities, and to our tax advisers, who are bound to confidentiality.</p>
      </>
    ),
  },
  {
    id: "transfers",
    title: "Transfers outside the EU",
    body: (
      <p>Where a provider processes data in the USA and is certified under the EU-U.S. Data Privacy Framework, the transfer is based on the European Commission&apos;s adequacy decision of 10 July 2023 (Art. 45 GDPR). Otherwise it is based on the Standard Contractual Clauses adopted by the European Commission (Art. 46(2)(c) GDPR); you can ask us for a copy. Data in the USA may be accessed by US authorities.</p>
    ),
  },
  {
    id: "retention",
    title: "How long we keep data",
    body: (
      <div className="lg-table">
        <table>
          <thead><tr><th>Data</th><th>How long</th></tr></thead>
          <tbody>
            <tr><td>Account, swimming profile and training data</td><td>Until you delete your account; deleted within 30 days of your request</td></tr>
            <tr><td>Mind and Nutrition answers and check-ins</td><td>Until you withdraw consent or delete your account; mood check-ins only the last 14, water log the last 7 days</td></tr>
            <tr><td>Feedback survey answers</td><td>Until you delete your account, or sooner if you ask us</td></tr>
            <tr><td>A parent or guardian&apos;s consent</td><td>While the account exists and 3 years after, to be able to prove it (§ 195 BGB)</td></tr>
            <tr><td>Server logs</td><td>At most 30 days</td></tr>
            <tr><td>Free video analysis: network code / visitor ID and account notes</td><td>30 days / as long as we offer the free analysis</td></tr>
            <tr><td>Data sent to OpenAI</td><td>Up to 30 days at OpenAI</td></tr>
            <tr><td>Payment and invoice records</td><td>10 years (§ 147 AO, § 257 HGB)</td></tr>
            <tr><td>Emails with us</td><td>Until your request is dealt with, unless we must keep them by law</td></tr>
            <tr><td>Chats and data in your browser</td><td>On your device until you delete them</td></tr>
          </tbody>
        </table>
      </div>
    ),
  },
  {
    id: "security",
    title: "Security",
    body: (
      <p>All connections to SwimGPT are encrypted (HTTPS/TLS). Passwords are stored only as secure hashes, access to our database is restricted, and card details are handled only by Stripe, which is certified to the PCI DSS standard. We review our safeguards as SwimGPT develops. No system is completely secure, but we work to protect your data and will inform you and the authorities of any breach as the law requires.</p>
    ),
  },
  {
    id: "rights",
    title: "Your rights",
    body: (
      <>
        <p>You have the right to:</p>
        <ul>
          <li><strong>access</strong> your data and get a copy (Art. 15 GDPR);</li>
          <li>have incorrect data <strong>corrected</strong> (Art. 16 GDPR);</li>
          <li>have your data <strong>deleted</strong> (Art. 17 GDPR);</li>
          <li><strong>restrict</strong> how we use it (Art. 18 GDPR);</li>
          <li>receive the data you gave us in a common, machine-readable format, or have it sent to someone else (<strong>data portability</strong>, Art. 20 GDPR);</li>
          <li><strong>withdraw any consent</strong> at any time, with effect for the future (Art. 7(3) GDPR);</li>
          <li><strong>complain</strong> to a data protection authority (Art. 77 GDPR), in particular in the EU country where you live or work. The authority responsible for us is the one for the German federal state we are based in; you can find all German authorities <a href="https://www.bfdi.bund.de/DE/Service/Anschriften/Laender/Laender-node.html" {...external}>here</a> and all EU authorities <a href="https://www.edpb.europa.eu/about-edpb/about-edpb/members_en" {...external}>here</a>.</li>
        </ul>
        <div className="lg-boxed">
          <p><strong>Your right to object (Art. 21 GDPR)</strong></p>
          <p>Where we use your data on the basis of our legitimate interests (Art. 6(1)(f) GDPR), you can object at any time for reasons arising from your particular situation. We will then stop, unless we can show compelling legitimate grounds that override your interests, rights and freedoms, or we need the data to establish, exercise or defend legal claims.</p>
        </div>
        <p>To use any of these rights, <ContactUs />. It&apos;s free. We answer within one month (Art. 12(3) GDPR) and may ask you to confirm your identity first. You can also ask us to delete your whole account this way.</p>
      </>
    ),
  },
  {
    id: "changes",
    title: "Changes to this policy",
    body: (
      <p>We update this policy when SwimGPT or the law changes. The current version is always here. We will tell you about important changes in the app or by email, and where a change needs your consent, we will ask for it.</p>
    ),
  },
]

export default function PrivacyPage() {
  return (
    <LegalDocument title="Privacy Policy" sections={sections} />
  )
}
