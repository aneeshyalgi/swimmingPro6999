/*
 * The live coach's hands (see coach-live-avatar.tsx), in the same flat-gradient style as the coach portraits.
 *
 * Each shape is drawn in its own small coordinate system: the wrist centre at (0, 0), the fingers pointing along +y
 * and the thumb on the +x side. The avatar places a hand at the end of each forearm and rotates it with the wrist;
 * the palm reaches back past the wrist so the forearm always covers the joint.
 *
 * Fingers and thumbs are generated from a few measurements (base, angle, length, width) so the proportions stay
 * consistent: a palm about 9.5 long and 11.5 wide, the middle finger about as long as the palm. Each layer of a hand
 * is painted twice, first as a slightly larger silhouette in the skin's shadow colour and then filled, which gives one
 * soft edge around the whole shape rather than an outline around every part.
 */

export type HandShape = "relaxed" | "open" | "wave" | "flat" | "point" | "fist"
export const HAND_SHAPES: HandShape[] = ["relaxed", "open", "wave", "flat", "point", "fist"]

type Skin = [string, string, string] // light, base, shadow
/** A finger or thumb: where its base sits, its direction (degrees from the hand's axis, + toward the thumb), size. */
type Digit = { x: number; y: number; angle: number; length: number; width: number; taper?: number; curled?: boolean }
type Spec = {
  /** "palm": the palm faces the viewer (creases); "back": the back of the hand does (knuckles and nails). */
  view: "palm" | "back"
  /** Index → little finger. A curled finger is folded toward the palm: a short rounded knuckle, no nail. */
  fingers: Digit[]
  thumb: Digit
  /** Where the thumb sits: joined to the palm, tucked behind the hand's edge, or folded over the fingers. */
  thumbLayer: "palm" | "behind" | "front"
  /** Fingers spread apart, so they need no seams between them. */
  spread?: boolean
}

const PALM = "M -4.5 -3.5 L 4.5 -3.5 C 5.1 -0.4, 5.6 3, 5.55 6.6 C 5.5 8.4, 4.5 9.3, 2.9 9.3 L -3.2 9.3 C -4.9 9.3, -5.8 8.5, -5.9 6.8 C -6 3.5, -5.3 0, -4.5 -3.5 Z"

// Finger bases along the knuckle line, shared by every shape so they all line up when one blends into another.
const INDEX = { x: 3.45, y: 8.8, width: 2.7 }
const MIDDLE = { x: 0.85, y: 9.2, width: 2.75 }
const RING = { x: -1.75, y: 9, width: 2.65 }
const LITTLE = { x: -4.25, y: 8.2, width: 2.3 }

const SPECS: Record<Exclude<HandShape, "wave">, Spec> = {
  // Palm up and toward the listener, fingers relaxed apart: explaining, presenting, shrugging.
  open: {
    view: "palm",
    spread: true,
    fingers: [
      { ...INDEX, angle: 9, length: 8.2 },
      { ...MIDDLE, angle: 2, length: 9 },
      { ...RING, angle: -5, length: 8.3 },
      { ...LITTLE, angle: -13, length: 6.6 },
    ],
    thumb: { x: 4.2, y: 1.5, angle: 48, length: 7.6, width: 3.15, taper: 0.82 },
    thumbLayer: "palm",
  },
  // Back of the hand, fingers together: a hand laid on the chest.
  flat: {
    view: "back",
    fingers: [
      { ...INDEX, angle: 3, length: 8 },
      { ...MIDDLE, angle: 0, length: 8.8 },
      { ...RING, angle: -2, length: 8.1 },
      { ...LITTLE, angle: -5, length: 6.4 },
    ],
    thumb: { x: 4.4, y: 2, angle: 24, length: 7.2, width: 3 },
    thumbLayer: "behind",
  },
  // A loose, resting hand: fingers together and softly curled, thumb alongside.
  relaxed: {
    view: "back",
    fingers: [
      { ...INDEX, angle: -1, length: 7.9 },
      { ...MIDDLE, angle: -3, length: 8.5 },
      { ...RING, angle: -4, length: 7.9 },
      { ...LITTLE, angle: -6, length: 6.3 },
    ],
    thumb: { x: 4.4, y: 2.2, angle: 14, length: 7, width: 3 },
    thumbLayer: "behind",
  },
  // Index finger out, the others folded, the thumb pressed along their side.
  point: {
    view: "back",
    fingers: [
      { ...INDEX, angle: 3, length: 9.4 },
      { ...MIDDLE, angle: -4, length: 4.6, taper: 0.96, curled: true },
      { ...RING, angle: -6, length: 4.3, taper: 0.96, curled: true },
      { ...LITTLE, angle: -9, length: 3.6, taper: 0.96, curled: true },
    ],
    thumb: { x: 4.6, y: 2.4, angle: 10, length: 7.2, width: 3 },
    thumbLayer: "behind",
  },
  // A loose fist, thumb tucked along its side: the hand slipped under the other arm when the arms are folded.
  fist: {
    view: "back",
    fingers: [
      { ...INDEX, angle: -2, length: 4.8, taper: 0.96, curled: true },
      { ...MIDDLE, angle: -4, length: 5, taper: 0.96, curled: true },
      { ...RING, angle: -6, length: 4.6, taper: 0.96, curled: true },
      { ...LITTLE, angle: -9, length: 3.8, taper: 0.96, curled: true },
    ],
    thumb: { x: 4.6, y: 2.4, angle: 4, length: 7.2, width: 3 },
    thumbLayer: "behind",
  },
}

const round = (value: number) => Math.round(value * 100) / 100
const toRadians = (degrees: number) => (degrees * Math.PI) / 180
/** Unit vectors along a digit and across it (toward +x when it points straight down the hand). */
const axes = (angle: number) => {
  const a = toRadians(angle)
  return { along: [Math.sin(a), Math.cos(a)], across: [Math.cos(a), -Math.sin(a)] }
}
const tipRadius = (digit: Digit) => (digit.width * (digit.taper ?? 0.86)) / 2

/** A tapered capsule from the digit's base (reaching back into the palm, so no joint ever shows) to a round tip. */
function digitPath(digit: Digit) {
  const { x, y, angle, length, width } = digit
  const { along, across } = axes(angle)
  const base = width / 2
  const tip = tipRadius(digit)
  const back = 1.8
  const bx = x - along[0] * back, by = y - along[1] * back
  const tx = x + along[0] * (length - tip), ty = y + along[1] * (length - tip)
  const point = (cx: number, cy: number, side: number, r: number) => `${round(cx + across[0] * side * r)} ${round(cy + across[1] * side * r)}`
  return `M${point(bx, by, -1, base)} L${point(tx, ty, -1, tip)} A${round(tip)} ${round(tip)} 0 0 0 ${point(tx, ty, 1, tip)} L${point(bx, by, 1, base)} Z`
}

/** A point `distance` along a digit from its base, offset `side` across it. */
function along(digit: Pick<Digit, "x" | "y" | "angle">, distance: number, side = 0) {
  const { along: a, across: c } = axes(digit.angle)
  return [round(digit.x + a[0] * distance + c[0] * side), round(digit.y + a[1] * distance + c[1] * side)] as const
}

const hex = (color: string) => [1, 3, 5].map((index) => Number.parseInt(color.slice(index, index + 2), 16))
/** Blend two #rrggbb colours: t = 0 gives `a`, t = 1 gives `b`. */
export function mix(a: string, b: string, t: number) {
  const from = hex(a), to = hex(b)
  return `#${from.map((value, index) => Math.round(value + (to[index] - value) * t).toString(16).padStart(2, "0")).join("")}`
}

/** Gradients for hands and bare arms; render inside the avatar's <defs>. */
export function HandDefs({ id, skin }: { id: string; skin: Skin }) {
  const [light, base, shadow] = skin
  return (
    <>
      {/* Across the hand: the little-finger side in shade, the thumb side catching the light. */}
      <linearGradient id={`${id}-hand`} gradientUnits="userSpaceOnUse" x1="-6.5" y1="0" x2="6.5" y2="0">
        <stop offset="0" stopColor={mix(base, shadow, 0.55)} />
        <stop offset="0.32" stopColor={base} />
        <stop offset="0.72" stopColor={mix(base, light, 0.75)} />
        <stop offset="1" stopColor={mix(base, light, 0.35)} />
      </linearGradient>
      {/* Fingertips a touch deeper than the palm, so the hand reads as rounded. */}
      <linearGradient id={`${id}-hand-depth`} gradientUnits="userSpaceOnUse" x1="0" y1="7" x2="0" y2="18.5">
        <stop offset="0" stopColor={shadow} stopOpacity="0" />
        <stop offset="1" stopColor={shadow} stopOpacity="0.2" />
      </linearGradient>
      {/* Bare forearms and upper arms, lit the same way so they meet the hand without a seam. */}
      <linearGradient id={`${id}-arm`} gradientUnits="userSpaceOnUse" x1="0.5" y1="0" x2="18.5" y2="0">
        <stop offset="0" stopColor={mix(base, shadow, 0.5)} />
        <stop offset="0.3" stopColor={base} />
        <stop offset="0.7" stopColor={mix(base, light, 0.6)} />
        <stop offset="1" stopColor={mix(base, light, 0.25)} />
      </linearGradient>
    </>
  )
}

/** Paints shapes as one: a slightly larger silhouette in the edge colour, then the fill on top. */
function Silhouette({ paths, fill, depth, edge }: { paths: string[]; fill: string; depth?: string; edge: string }) {
  return (
    <>
      <g fill={edge} stroke={edge} strokeWidth="0.8" strokeLinejoin="round">{paths.map((d, index) => <path key={index} d={d} />)}</g>
      <g fill={fill}>{paths.map((d, index) => <path key={index} d={d} />)}</g>
      {depth && <g fill={depth}>{paths.map((d, index) => <path key={index} d={d} />)}</g>}
    </>
  )
}

/** One hand shape, in hand coordinates (wrist at the origin, fingers along +y, thumb toward +x). */
export function Hand({ shape, id, skin }: { shape: HandShape; id: string; skin: Skin }) {
  // A wave shows the palm with the thumb toward the body: the open hand, mirrored.
  if (shape === "wave") return <g transform="scale(-1 1)"><Hand shape="open" id={id} skin={skin} /></g>
  const spec = SPECS[shape]
  const [light, , shadow] = skin
  const fill = `url(#${id}-hand)`
  const depth = `url(#${id}-hand-depth)`
  const crease = mix(shadow, "#000000", 0.18)
  const shine = mix(light, "#ffffff", 0.3)
  const thumb = digitPath(spec.thumb)
  const body = [PALM, ...spec.fingers.map(digitPath), ...(spec.thumbLayer === "palm" ? [thumb] : [])]
  const fingers = spec.fingers
  const nail = (digit: Digit, key: string) => {
    const tip = tipRadius(digit)
    const [nx, ny] = along(digit, digit.length - tip * 1.15)
    return <ellipse key={key} cx={nx} cy={ny} rx={round(tip * 0.5)} ry={round(tip * 0.78)} transform={`rotate(${-digit.angle} ${nx} ${ny})`} fill={shine} fillOpacity="0.38" />
  }

  return (
    <g>
      {spec.thumbLayer === "behind" && <Silhouette paths={[thumb]} fill={fill} depth={depth} edge={shadow} />}
      <Silhouette paths={body} fill={fill} depth={depth} edge={shadow} />

      <g fill="none" stroke={crease} strokeLinecap="round">
        {/* Seams where fingers lie together, as far as the shorter of the two reaches */}
        {!spec.spread && fingers.slice(0, -1).map((finger, index) => {
          const next = fingers[index + 1]
          const mid = { x: (finger.x + next.x) / 2, y: (finger.y + next.y) / 2, angle: (finger.angle + next.angle) / 2 }
          const [x1, y1] = along(mid, 0.5)
          const [x2, y2] = along(mid, Math.min(finger.length, next.length) - (finger.curled || next.curled ? 0.9 : 1.6))
          return <path key={index} d={`M${x1} ${y1} L${x2} ${y2}`} strokeOpacity="0.5" strokeWidth="0.48" />
        })}
        {/* Palm side: the life line round the thumb pad, the heart line, and a joint crease on each finger */}
        {spec.view === "palm" && (
          <>
            <path d="M 3.2 8.2 C 1.6 6.5, 1.2 3.6, 2.2 0.7" strokeOpacity="0.32" strokeWidth="0.5" />
            <path d="M -5.2 6.6 C -2.9 5.8, 0.1 6.2, 2.5 7.6" strokeOpacity="0.28" strokeWidth="0.45" />
            {fingers.map((finger, index) => {
              const [x1, y1] = along(finger, finger.length * 0.48, -finger.width * 0.3)
              const [x2, y2] = along(finger, finger.length * 0.48, finger.width * 0.3)
              return <path key={`j${index}`} d={`M${x1} ${y1} L${x2} ${y2}`} strokeOpacity="0.26" strokeWidth="0.4" />
            })}
          </>
        )}
      </g>

      {/* Back of the hand: knuckles catching the light, and nails on the fingers that are out */}
      {spec.view === "back" && (
        <g>
          {fingers.map((finger, index) => {
            const [x1, y1] = along(finger, 0.6, -finger.width * 0.3)
            const [cx, cy] = along(finger, -0.2)
            const [x2, y2] = along(finger, 0.6, finger.width * 0.3)
            return <path key={`k${index}`} d={`M${x1} ${y1} Q${cx} ${cy} ${x2} ${y2}`} fill="none" stroke={shine} strokeOpacity="0.5" strokeWidth="0.5" strokeLinecap="round" />
          })}
          {fingers.filter((finger) => !finger.curled).map((finger, index) => nail(finger, `n${index}`))}
          {/* A folded finger turns away from the viewer: a crease at the bend and shade beyond it */}
          {fingers.filter((finger) => finger.curled).map((finger, index) => {
            const tip = tipRadius(finger)
            const [x1, y1] = along(finger, finger.length - tip - 0.5, -finger.width * 0.36)
            const [cx, cy] = along(finger, finger.length - tip + 0.2)
            const [x2, y2] = along(finger, finger.length - tip - 0.5, finger.width * 0.36)
            const [sx, sy] = along(finger, finger.length - tip * 0.55)
            return (
              <g key={`f${index}`}>
                <ellipse cx={sx} cy={sy} rx={round(tip * 0.95)} ry={round(tip * 0.62)} transform={`rotate(${-finger.angle} ${sx} ${sy})`} fill={shadow} fillOpacity="0.22" />
                <path d={`M${x1} ${y1} Q${cx} ${cy} ${x2} ${y2}`} fill="none" stroke={crease} strokeOpacity="0.42" strokeWidth="0.45" strokeLinecap="round" />
              </g>
            )
          })}
        </g>
      )}

      {/* A thumb folded over the fingers sits in front of them, with its own edge and nail */}
      {spec.thumbLayer === "front" && <Silhouette paths={[thumb]} fill={fill} depth={depth} edge={shadow} />}
      {spec.thumbLayer === "front" && nail(spec.thumb, "thumb")}
    </g>
  )
}
