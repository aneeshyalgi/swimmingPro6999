import { useId } from "react"
import { cn } from "@/lib/utils"

/**
 * Illustrated portraits of the five SwimGPT coaches (fictional characters, not likenesses of the people whose
 * methods inspired the programs). Pure SVG, so they stay sharp from a 28px chip to a full profile header.
 */

type HairStyle = "quiff" | "sidepart" | "fade" | "receding" | "curls"
type Beard = "full" | "boxed" | "goatee" | "stubble" | null
type Outfit = "polo" | "quarterzip" | "tee" | "jacket" | "hoodie"
type Prop = "whistle" | "stopwatch" | "headphones" | null

type Look = {
  bg: [string, string, string]      // light, mid, deep
  skin: [string, string, string]    // light, base, shadow
  lip: string
  iris: string
  hair: [string, string]            // base, highlight
  hairStyle: HairStyle
  beard: Beard
  glasses?: boolean
  lines?: boolean                   // a few years of pool deck
  outfit: Outfit
  shirt: [string, string]           // base, shade
  trim: string
  prop: Prop
}

const LOOKS: Record<string, Look> = {
  brad: {
    bg: ["#cffafe", "#22d3ee", "#073b4c"], skin: ["#f7d6bb", "#e9b792", "#c48663"], lip: "#9a5a48", iris: "#3b2a1a",
    hair: ["#3a2417", "#7a4e2c"], hairStyle: "quiff", beard: "full",
    outfit: "polo", shirt: ["#141b26", "#0a0f17"], trim: "#22d3ee", prop: "whistle",
  },
  pete: {
    bg: ["#fef3c7", "#fbbf24", "#4a2a06"], skin: ["#fce3d1", "#f1c4a5", "#d49b7b"], lip: "#b0685a", iris: "#3c6e91",
    hair: ["#a8793f", "#e2bd80"], hairStyle: "sidepart", beard: null, glasses: true,
    outfit: "quarterzip", shirt: ["#1d3557", "#12233d"], trim: "#fbbf24", prop: "stopwatch",
  },
  timothy: {
    bg: ["#fce7f3", "#f472b6", "#4a0d2c"], skin: ["#9a6644", "#7a4b2f", "#52301c"], lip: "#4a2618", iris: "#1f130b",
    hair: ["#0f0d0c", "#3a3330"], hairStyle: "fade", beard: "boxed",
    outfit: "tee", shirt: ["#1c2230", "#0e121b"], trim: "#f472b6", prop: "headphones",
  },
  robert: {
    bg: ["#ede9fe", "#a78bfa", "#24124a"], skin: ["#ecc6a2", "#d6a57f", "#ad7a59"], lip: "#8f5444", iris: "#45372a",
    hair: ["#8b9099", "#dfe3e8"], hairStyle: "receding", beard: "goatee", lines: true,
    outfit: "jacket", shirt: ["#2e2a78", "#1b1847"], trim: "#a78bfa", prop: null,
  },
  tony: {
    bg: ["#d1fae5", "#34d399", "#053b2c"], skin: ["#c98e62", "#aa7149", "#7b4e31"], lip: "#6e3b26", iris: "#26170e",
    hair: ["#16100c", "#46362a"], hairStyle: "curls", beard: "stubble",
    outfit: "hoodie", shirt: ["#0f2e27", "#08201b"], trim: "#34d399", prop: null,
  },
}

/** Catalog key from a coach name or key ("Coach Brad" → "brad"). */
export const coachLookKey = (name: string) => name.replace(/^coach\s+/i, "").trim().toLowerCase()

const FACE = "M60 24 C 75 24, 84.5 35, 84.5 50 C 84.5 62, 80 72, 72.5 78.5 C 68.5 82, 64 83.5, 60 83.5 C 56 83.5, 51.5 82, 47.5 78.5 C 40 72, 35.5 62, 35.5 50 C 35.5 35, 45 24, 60 24 Z"
const BEARD = "M36 52 C 36 70, 46 85.5, 60 86 C 74 85.5, 84 70, 84 52 C 82.5 60, 79 64.5, 74.5 66 C 71 72, 66.5 76.5, 60 76.5 C 53.5 76.5, 49 72, 45.5 66 C 41 64.5, 37.5 60, 36 52 Z"
const MOUSTACHE = "M51 69.6 C 54 66.4, 58 66.6, 60 68 C 62 66.6, 66 66.4, 69 69.6 C 66 69.1, 63 69.6, 60 70.3 C 57 69.6, 54 69.1, 51 69.6 Z"

export function CoachAvatar({ name, className, shape = "squircle", title }: {
  name: string
  className?: string
  shape?: "squircle" | "circle"
  title?: string
}) {
  const raw = useId()
  const id = `ca${raw.replace(/[^a-zA-Z0-9]/g, "")}`
  const key = coachLookKey(name)
  const look = LOOKS[key]
  const label = title ?? `${name} avatar`
  const rounded = shape === "circle" ? "rounded-full" : "rounded-[28%]"

  if (!look) {
    return (
      <span role="img" aria-label={label} className={cn("grid place-items-center overflow-hidden bg-gradient-to-br from-accent to-sky-600 font-bold text-slate-950", rounded, className)}>
        {key.charAt(0).toUpperCase()}
      </span>
    )
  }
  const [bgLight, bgMid, bgDeep] = look.bg
  const [skinLight, skinBase, skinShadow] = look.skin
  const [hairBase, hairLight] = look.hair
  const [shirt, shirtShade] = look.shirt
  const ref = (name: string) => `url(#${id}-${name})`

  return (
    <span role="img" aria-label={label} className={cn("relative block shrink-0 overflow-hidden", rounded, className)}>
      <svg viewBox="0 0 120 120" className="block h-full w-full" aria-hidden>
        <defs>
          <radialGradient id={`${id}-bg`} cx="0.32" cy="0.2" r="0.95">
            <stop offset="0" stopColor={bgLight} />
            <stop offset="0.42" stopColor={bgMid} />
            <stop offset="1" stopColor={bgDeep} />
          </radialGradient>
          <linearGradient id={`${id}-skin`} x1="0.1" y1="0.15" x2="0.9" y2="0.85">
            <stop offset="0" stopColor={skinLight} />
            <stop offset="0.55" stopColor={skinBase} />
            <stop offset="1" stopColor={skinShadow} />
          </linearGradient>
          <linearGradient id={`${id}-neck`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={skinShadow} />
            <stop offset="1" stopColor={skinBase} />
          </linearGradient>
          <linearGradient id={`${id}-hair`} x1="0.2" y1="0" x2="0.8" y2="1">
            <stop offset="0" stopColor={hairLight} />
            <stop offset="0.45" stopColor={hairBase} />
            <stop offset="1" stopColor={hairBase} />
          </linearGradient>
          <linearGradient id={`${id}-fade`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={hairBase} />
            <stop offset="0.55" stopColor={hairBase} stopOpacity="0.9" />
            <stop offset="1" stopColor={hairBase} stopOpacity="0.35" />
          </linearGradient>
          <linearGradient id={`${id}-shirt`} x1="0.2" y1="0" x2="0.8" y2="1">
            <stop offset="0" stopColor={shirt} />
            <stop offset="1" stopColor={shirtShade} />
          </linearGradient>
          <linearGradient id={`${id}-rim`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor={bgLight} stopOpacity="0.95" />
            <stop offset="0.4" stopColor={bgLight} stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`${id}-gloss`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0.22" />
            <stop offset="0.45" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <radialGradient id={`${id}-vignette`} cx="0.5" cy="0.45" r="0.75">
            <stop offset="0.6" stopColor="#000" stopOpacity="0" />
            <stop offset="1" stopColor="#000" stopOpacity="0.35" />
          </radialGradient>
          <clipPath id={`${id}-face`}><path d={FACE} /></clipPath>
        </defs>

        {/* Backdrop: lit pool water */}
        <rect width="120" height="120" fill={ref("bg")} />
        {[22, 36, 50, 64].map((radius) => (
          <circle key={radius} cx="100" cy="104" r={radius} fill="none" stroke="#fff" strokeOpacity={0.1 - radius / 900} strokeWidth="1.2" />
        ))}
        <path d="M-10 40 C 20 30, 40 48, 70 36 S 110 30, 130 38" fill="none" stroke="#fff" strokeOpacity="0.12" strokeWidth="1.4" />
        <path d="M-10 52 C 22 42, 42 60, 72 48 S 112 42, 130 50" fill="none" stroke="#fff" strokeOpacity="0.07" strokeWidth="1.2" />

        {/* Hood rolled behind the neck */}
        {look.outfit === "hoodie" && <path d="M36 96 C 34 84, 46 79, 60 81 C 74 79, 86 84, 84 96 C 76 91, 44 91, 36 96 Z" fill={shirtShade} />}

        {/* Shoulders */}
        <path d="M6 124 C 7 104, 21 94, 43 90 C 49 89, 54 92, 60 92 C 66 92, 71 89, 77 90 C 99 94, 113 104, 114 124 Z" fill={ref("shirt")} />
        <path d="M14 104 C 22 96, 32 92.5, 43 90.5" fill="none" stroke="#fff" strokeOpacity="0.12" strokeWidth="1.5" strokeLinecap="round" />

        {look.prop === "headphones" && <path d="M40 95 C 39 81, 81 81, 80 95" fill="none" stroke="#0a0a0d" strokeWidth="4" strokeLinecap="round" />}

        {/* Neck */}
        <path d="M49 70 L49 90 C 54 95.5, 66 95.5, 71 90 L71 70 Z" fill={ref("neck")} />
        <path d="M49 76 C 54 84, 66 84, 71 76 L71 82.5 C 66 88.5, 54 88.5, 49 82.5 Z" fill={skinShadow} opacity="0.55" />

        <Outfit look={look} />
        <PropShape prop={look.prop} trim={look.trim} />

        {/* Ears */}
        <path d="M36.8 49.5 C 30.6 47.5, 29.6 58.5, 34 62 C 35.6 63.4, 37.2 62.4, 37.8 60 Z" fill={skinBase} />
        <path d="M35.4 52 C 33.4 52.5, 33.4 57.5, 35.6 59" fill="none" stroke={skinShadow} strokeWidth="1.1" strokeLinecap="round" />
        <path d="M83.2 49.5 C 89.4 47.5, 90.4 58.5, 86 62 C 84.4 63.4, 82.8 62.4, 82.2 60 Z" fill={skinShadow} />
        <path d="M84.6 52 C 86.6 52.5, 86.6 57.5, 84.4 59" fill="none" stroke={skinShadow} strokeOpacity="0.6" strokeWidth="1.1" strokeLinecap="round" />

        {/* Face */}
        <path d={FACE} fill={ref("skin")} />
        <g clipPath={ref("face")}>
          <path d="M73 27 C 83 33, 86 46, 85.5 52 C 85 64, 80 74, 70 81.5 C 77 70, 80 58, 79 46 C 78 38, 76 32, 73 27 Z" fill={skinShadow} opacity="0.45" />
          <ellipse cx="51" cy="36" rx="11" ry="5.5" fill="#fff" opacity="0.13" />
          <ellipse cx="47" cy="63" rx="5" ry="3" fill="#ff7a6b" opacity="0.1" />
          <ellipse cx="73" cy="63" rx="5" ry="3" fill="#ff7a6b" opacity="0.08" />
        </g>
        {look.lines && (
          <g fill="none" stroke={skinShadow} strokeLinecap="round" opacity="0.5" strokeWidth="0.9">
            <path d="M50 36.5 C 55 35, 65 35, 70 36.5" />
            <path d="M52 39.5 C 56 38.4, 64 38.4, 68 39.5" />
            <path d="M48.6 63.5 C 46.6 66.5, 47 70, 49.2 72.4" />
            <path d="M71.4 63.5 C 73.4 66.5, 73 70, 70.8 72.4" />
          </g>
        )}

        <BeardShape beard={look.beard} hair={hairBase} />

        {/* Eyes */}
        {[50, 70].map((cx) => (
          <g key={cx}>
            <path d={`M${cx - 5.6} 54 C ${cx - 3.6} 50.6, ${cx + 3.6} 50.6, ${cx + 5.6} 54 C ${cx + 3.6} 56.6, ${cx - 3.6} 56.6, ${cx - 5.6} 54 Z`} fill="#f8f4ef" />
            <circle cx={cx + 0.3} cy="53.8" r="2.65" fill={look.iris} />
            <circle cx={cx + 0.3} cy="53.8" r="1.25" fill="#0b0705" />
            <circle cx={cx + 1.2} cy="52.9" r="0.85" fill="#fff" />
            <path d={`M${cx - 5.8} 53.8 C ${cx - 3.6} 50.2, ${cx + 3.6} 50.2, ${cx + 5.8} 53.8`} fill="none" stroke="#2a1a12" strokeWidth="1.15" strokeLinecap="round" />
          </g>
        ))}
        {/* Brows */}
        <path d="M43.6 47.4 C 46.8 45.2, 51.6 44.9, 55.2 46.4" fill="none" stroke={look.hairStyle === "receding" ? "#6b6f76" : hairBase} strokeWidth="2.5" strokeLinecap="round" />
        <path d="M64.8 46.4 C 68.4 44.9, 73.2 45.2, 76.4 47.4" fill="none" stroke={look.hairStyle === "receding" ? "#6b6f76" : hairBase} strokeWidth="2.5" strokeLinecap="round" />
        {/* Nose */}
        <ellipse cx="61.5" cy="62.2" rx="3.4" ry="2" fill={skinShadow} opacity="0.35" />
        <path d="M60.6 54 C 60.2 58.8, 57.6 62.2, 57.9 64 C 59.1 65.3, 61.6 65.3, 63.1 64.3" fill="none" stroke={skinShadow} strokeWidth="1.35" strokeLinecap="round" />
        {/* Mouth */}
        {(look.beard === "full" || look.beard === "boxed" || look.beard === "goatee") && <path d={MOUSTACHE} fill={hairBase} opacity={look.beard === "goatee" ? 0.85 : 0.95} />}
        {look.beard === "stubble" && <path d={MOUSTACHE} fill={hairBase} opacity="0.3" />}
        <path d="M53.6 71 C 56.6 73.8, 63.4 73.8, 66.4 71" fill="none" stroke={look.lip} strokeWidth="1.8" strokeLinecap="round" />
        <path d="M56.2 74.2 C 58.6 75.2, 61.4 75.2, 63.8 74.2" fill="none" stroke="#fff" strokeOpacity="0.25" strokeWidth="1" strokeLinecap="round" />

        <HairShape style={look.hairStyle} fill={ref("hair")} fade={ref("fade")} base={hairBase} light={hairLight} />
        {look.glasses && <Glasses />}

        {/* Rim light from the water, gloss and vignette */}
        <path d={FACE} fill="none" stroke={ref("rim")} strokeOpacity="0.55" strokeWidth="0.9" />
        <rect width="120" height="120" fill={ref("vignette")} />
        <rect width="120" height="120" fill={ref("gloss")} />
      </svg>
      <span aria-hidden className={cn("pointer-events-none absolute inset-0 ring-1 ring-inset ring-white/15", rounded)} />
    </span>
  )
}

function Outfit({ look }: { look: Look }) {
  const { outfit, trim, shirt, shirtShade } = { outfit: look.outfit, trim: look.trim, shirt: look.shirt[0], shirtShade: look.shirt[1] }
  const skinShadow = look.skin[2]
  if (outfit === "polo") {
    return (
      <g>
        <path d="M50.5 89.5 L60 101.5 L69.5 89.5 Z" fill={skinShadow} />
        <path d="M48 87.5 L60 101.5 L53.5 106 L42.5 93 Z" fill={shirt} stroke={trim} strokeWidth="1.1" strokeLinejoin="round" />
        <path d="M72 87.5 L60 101.5 L66.5 106 L77.5 93 Z" fill={shirt} stroke={trim} strokeWidth="1.1" strokeLinejoin="round" />
        <circle cx="60" cy="108.5" r="1.1" fill={trim} opacity="0.8" />
        <circle cx="60" cy="114" r="1.1" fill={trim} opacity="0.8" />
      </g>
    )
  }
  if (outfit === "quarterzip") {
    return (
      <g>
        <path d="M46.5 83 C 52 89.5, 68 89.5, 73.5 83 L75.5 94 C 68 99.5, 52 99.5, 44.5 94 Z" fill={shirtShade} />
        <path d="M46.5 83 C 52 89.5, 68 89.5, 73.5 83" fill="none" stroke={trim} strokeWidth="1.3" />
        <path d="M60 88.5 L60 124" stroke="#cbd5e1" strokeOpacity="0.55" strokeWidth="1.2" />
        <rect x="58.4" y="96" width="3.2" height="6" rx="1.2" fill="#e2e8f0" />
      </g>
    )
  }
  if (outfit === "tee") {
    return (
      <g>
        <path d="M48.5 87.5 C 53.5 95.5, 66.5 95.5, 71.5 87.5" fill="none" stroke={trim} strokeWidth="2.6" strokeLinecap="round" />
        <path d="M30 100 C 36 97, 42 95, 46 94" fill="none" stroke="#000" strokeOpacity="0.25" strokeWidth="1.4" strokeLinecap="round" />
        <path d="M90 100 C 84 97, 78 95, 74 94" fill="none" stroke="#000" strokeOpacity="0.25" strokeWidth="1.4" strokeLinecap="round" />
      </g>
    )
  }
  if (outfit === "jacket") {
    return (
      <g>
        <path d="M45.5 79 L47.5 96 C 53.5 100.5, 66.5 100.5, 72.5 96 L74.5 79 C 68 85.5, 52 85.5, 45.5 79 Z" fill={shirt} />
        <path d="M45.5 79 C 52 85.5, 68 85.5, 74.5 79" fill="none" stroke={trim} strokeWidth="1.4" />
        <path d="M60 85 L60 124" stroke="#e2e8f0" strokeOpacity="0.5" strokeWidth="1.2" />
        <path d="M24 108 L44 108" stroke={trim} strokeOpacity="0.55" strokeWidth="2" strokeLinecap="round" />
        <path d="M76 108 L96 108" stroke={trim} strokeOpacity="0.55" strokeWidth="2" strokeLinecap="round" />
        <circle cx="76" cy="101" r="2.6" fill="none" stroke={trim} strokeWidth="1.1" />
      </g>
    )
  }
  // hoodie
  return (
    <g>
      <path d="M60 92 L60 124" stroke="#e2e8f0" strokeOpacity="0.45" strokeWidth="1.2" />
      <path d="M53 93 C 52.5 99, 52 103, 51.5 107" fill="none" stroke={trim} strokeWidth="1.2" strokeLinecap="round" />
      <path d="M67 93 C 67.5 99, 68 103, 68.5 107" fill="none" stroke={trim} strokeWidth="1.2" strokeLinecap="round" />
      <rect x="50.4" y="106.5" width="2.2" height="3.6" rx="1" fill={trim} />
      <rect x="67.4" y="106.5" width="2.2" height="3.6" rx="1" fill={trim} />
    </g>
  )
}

function PropShape({ prop, trim }: { prop: Prop; trim: string }) {
  if (prop === "whistle") {
    return (
      <g>
        <path d="M51 90 C 52 100, 55 107, 58 111.5" fill="none" stroke={trim} strokeWidth="1.5" />
        <path d="M69 90 C 68 100, 65 107, 62 111.5" fill="none" stroke={trim} strokeWidth="1.5" />
        <rect x="54" y="110.5" width="12" height="6.4" rx="3.2" fill="#e5e7eb" />
        <rect x="63.5" y="111.6" width="5" height="3" rx="1.2" fill="#cbd5e1" />
        <circle cx="57.6" cy="113.7" r="1.4" fill="#94a3b8" />
        <path d="M55.5 111.8 C 58 111, 61 111, 64 111.8" fill="none" stroke="#fff" strokeWidth="0.8" strokeLinecap="round" />
      </g>
    )
  }
  if (prop === "stopwatch") {
    return (
      <g>
        <path d="M52 92 C 53 101, 56 106, 58.5 109" fill="none" stroke="#0f172a" strokeOpacity="0.8" strokeWidth="1.3" />
        <path d="M68 92 C 67 101, 64 106, 61.5 109" fill="none" stroke="#0f172a" strokeOpacity="0.8" strokeWidth="1.3" />
        <rect x="58.6" y="107" width="2.8" height="2.6" rx="0.6" fill="#cbd5e1" />
        <circle cx="60" cy="115.5" r="6.4" fill="#f8fafc" stroke="#94a3b8" strokeWidth="1.2" />
        <circle cx="60" cy="115.5" r="4.6" fill="none" stroke={trim} strokeWidth="0.9" />
        <path d="M60 115.5 L60 112.2 M60 115.5 L62.4 116.6" stroke="#0f172a" strokeWidth="0.9" strokeLinecap="round" />
      </g>
    )
  }
  if (prop === "headphones") {
    return (
      <g>
        {[41, 79].map((cx, index) => (
          <g key={cx} transform={`rotate(${index ? 18 : -18} ${cx} 97)`}>
            <rect x={cx - 7} y="89" width="14" height="16" rx="6.5" fill="#101014" />
            <rect x={cx - 5} y="91" width="10" height="12" rx="4.8" fill="#1d1d24" />
            <rect x={cx - 7} y="89" width="14" height="16" rx="6.5" fill="none" stroke={trim} strokeWidth="1.3" />
            <path d={`M${cx - 4} 92 C ${cx - 2} 90.8, ${cx + 1} 90.8, ${cx + 3} 91.6`} fill="none" stroke="#fff" strokeOpacity="0.4" strokeWidth="0.9" strokeLinecap="round" />
          </g>
        ))}
      </g>
    )
  }
  return null
}

function BeardShape({ beard, hair }: { beard: Beard; hair: string }) {
  if (beard === "full") {
    return (
      <g>
        <path d={BEARD} fill={hair} opacity="0.94" />
        <path d="M44 74 C 48 80, 54 83.5, 60 84 C 66 83.5, 72 80, 76 74" fill="none" stroke="#fff" strokeOpacity="0.1" strokeWidth="1.2" strokeLinecap="round" />
      </g>
    )
  }
  if (beard === "boxed") {
    return <path d="M38 58 C 39 71, 47 84.5, 60 85 C 73 84.5, 81 71, 82 58 C 80.5 63.5, 78 66.5, 74.5 67.2 C 71 72.5, 66.5 76.4, 60 76.4 C 53.5 76.4, 49 72.5, 45.5 67.2 C 42 66.5, 39.5 63.5, 38 58 Z" fill={hair} opacity="0.92" />
  }
  if (beard === "goatee") {
    return (
      <g>
        <path d={BEARD} fill={hair} opacity="0.18" />
        <path d="M52.2 75 C 54.5 78, 65.5 78, 67.8 75 C 68.8 80.5, 65.5 85.6, 60 85.9 C 54.5 85.6, 51.2 80.5, 52.2 75 Z" fill={hair} opacity="0.95" />
      </g>
    )
  }
  if (beard === "stubble") return <path d={BEARD} fill={hair} opacity="0.26" />
  return null
}

function HairShape({ style, fill, fade, base, light }: { style: HairStyle; fill: string; fade: string; base: string; light: string }) {
  if (style === "quiff") {
    return (
      <g>
        <path d="M35.5 53 C 33 35, 42 21, 56 18.5 C 70 16.5, 86.5 24, 85 51 C 83.5 42.5, 81 37.5, 77 35 C 70 31.5, 58 33, 50 30.5 C 44.5 34.5, 39.5 41.5, 35.5 53 Z" fill={fill} />
        <path d="M42.5 32 C 41 19, 50 10.5, 62 10.5 C 73 10.5, 81.5 16, 83 27.5 C 77.5 23, 70 21, 61 22 C 53 22.8, 46.5 26.5, 42.5 32 Z" fill={fill} />
        <g fill="none" stroke={light} strokeLinecap="round" strokeWidth="1.1" opacity="0.7">
          <path d="M48 21 C 54 14.5, 64 12.5, 74 15" />
          <path d="M52 24.5 C 59 19, 69 18, 78 21" />
          <path d="M46 28.5 C 51 25, 56 24, 61 24" />
        </g>
        <path d="M36 50 L36.8 60 L38.6 60 L38.4 47 Z" fill={base} />
        <path d="M84 50 L83.2 60 L81.4 60 L81.6 47 Z" fill={base} />
      </g>
    )
  }
  if (style === "sidepart") {
    return (
      <g>
        <path d="M35 55 C 32 33, 44 19, 61 19 C 78 19, 88.5 32, 85.6 54 C 84 44.5, 81.5 38.5, 77 35.5 C 70 31.5, 57 31, 48 33.5 C 42 35.5, 37.5 42.5, 35 55 Z" fill={fill} />
        <path d="M48 33.5 C 55 24.5, 71 22.5, 81 31 C 73 28.8, 63 29.6, 55 34.5 Z" fill={light} opacity="0.55" />
        <path d="M49.5 20.5 C 47.8 25, 47.4 29.5, 48 33.5" fill="none" stroke="#000" strokeOpacity="0.3" strokeWidth="1.2" strokeLinecap="round" />
        <g fill="none" stroke={light} strokeLinecap="round" strokeWidth="1" opacity="0.75">
          <path d="M55 23 C 63 20.5, 72 21.5, 79 26" />
          <path d="M41 33 C 42 28, 44.5 24.5, 48 22.5" />
        </g>
      </g>
    )
  }
  if (style === "fade") {
    return (
      <g>
        <path d="M35.8 49 C 35 31, 46 22, 60 22 C 74 22, 85 31, 84.2 49 C 81.5 39.5, 74.5 32.6, 60 32.2 C 45.5 32.6, 38.5 39.5, 35.8 49 Z" fill={fade} />
        <path d="M39 37 C 44 31.5, 52 29, 60 29 C 68 29, 76 31.5, 81 37" fill="none" stroke={light} strokeOpacity="0.35" strokeWidth="0.9" strokeDasharray="0.6 1.6" strokeLinecap="round" />
        <path d="M42 33 C 47 32.4, 52 32.2, 60 32.2 C 68 32.2, 73 32.4, 78 33" fill="none" stroke={base} strokeWidth="0.9" />
      </g>
    )
  }
  if (style === "receding") {
    return (
      <g>
        <path d="M35.5 57 C 33 41, 37.5 30, 46.5 25.5 C 43.5 31.5, 42 38, 41 44.5 C 39 48.5, 37 52.5, 35.5 57 Z" fill={fill} />
        <path d="M84.5 57 C 87 41, 82.5 30, 73.5 25.5 C 76.5 31.5, 78 38, 79 44.5 C 81 48.5, 83 52.5, 84.5 57 Z" fill={fill} />
        <path d="M45.5 26.5 C 51.5 20.5, 68.5 20.5, 74.5 26.5 C 70.5 30.5, 66 29.4, 60 30.4 C 54 29.4, 49.5 30.5, 45.5 26.5 Z" fill={fill} />
        <g fill="none" stroke={light} strokeLinecap="round" strokeWidth="0.9" opacity="0.8">
          <path d="M50 25 C 55 22.5, 65 22.5, 70 25" />
          <path d="M38.5 48 C 38.5 41, 40.5 35, 44 30" />
          <path d="M81.5 48 C 81.5 41, 79.5 35, 76 30" />
        </g>
      </g>
    )
  }
  // curls: a crown of tight coils
  const coils: { x: number; y: number; r: number }[] = []
  for (let index = 0; index <= 12; index++) {
    const angle = Math.PI * (1.08 + (index / 12) * 0.84)
    coils.push({ x: 60 + Math.cos(angle) * 25.5, y: 47 + Math.sin(angle) * 25.5, r: 5.6 + (index % 3) * 0.5 })
  }
  for (let index = 0; index <= 7; index++) {
    const angle = Math.PI * (1.18 + (index / 7) * 0.64)
    coils.push({ x: 60 + Math.cos(angle) * 18, y: 45 + Math.sin(angle) * 17, r: 5.4 })
  }
  return (
    <g>
      <path d="M35 51 C 34 30, 46 20, 60 20 C 74 20, 86 30, 85 51 C 82 40.5, 74 35, 60 35 C 46 35, 38 40.5, 35 51 Z" fill={base} />
      {coils.map((coil, index) => (
        <g key={index}>
          <circle cx={coil.x} cy={coil.y} r={coil.r} fill={fill} />
          <path d={`M${coil.x - coil.r * 0.55} ${coil.y - coil.r * 0.1} a ${coil.r * 0.55} ${coil.r * 0.55} 0 0 1 ${coil.r * 0.9} -${coil.r * 0.35}`} fill="none" stroke={light} strokeOpacity="0.55" strokeWidth="0.9" strokeLinecap="round" />
        </g>
      ))}
    </g>
  )
}

function Glasses() {
  return (
    <g>
      {[50, 70].map((cx) => (
        <g key={cx}>
          <circle cx={cx} cy="54" r="7" fill="#e0f2fe" fillOpacity="0.1" stroke="#1f2937" strokeWidth="1.7" />
          <path d={`M${cx - 4} 50 L${cx - 1} 47.6`} stroke="#fff" strokeOpacity="0.55" strokeWidth="1" strokeLinecap="round" />
        </g>
      ))}
      <path d="M56.9 53 C 58.5 51.6, 61.5 51.6, 63.1 53" fill="none" stroke="#1f2937" strokeWidth="1.5" />
      <path d="M43 52.6 L36.4 51.2 M77 52.6 L83.6 51.2" stroke="#1f2937" strokeWidth="1.5" strokeLinecap="round" />
    </g>
  )
}
