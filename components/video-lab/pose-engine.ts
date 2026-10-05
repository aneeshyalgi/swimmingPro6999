import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision"

export type PosePoint = { x: number; y: number; z?: number; visibility?: number }
export type Point = { x: number; y: number }
export type Layers = { skeleton: boolean; angles: boolean; trails: boolean; grid: boolean }

/** Per-frame measurements taken from the tracked pose (angles in degrees, lengths as a share of body length). */
export type FrameMetrics = {
  t: number
  elbowL: number | null; elbowR: number | null
  kneeL: number | null; kneeR: number | null
  hip: number | null
  bodyTilt: number | null
  ankleDepth: number | null
  wristAxis: number | null
  confidence: number
}

/** What the clip measured overall; sent to the coach and shown in the brief. */
export type ClipSummary = {
  frames: number
  swimming_frames: number
  seconds_covered: number
  tracking_percent: number
  elbow_catch_deg: number | null
  elbow_median_deg: number | null
  knee_median_deg: number | null
  hip_median_deg: number | null
  body_tilt_deg: number | null
  kick_depth_percent: number | null
  stroke_rate_per_min: number | null
}

export const CONNECTIONS = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24], [23, 25], [25, 27],
  [24, 26], [26, 28], [27, 31], [28, 32],
] as const
const KEY_JOINTS = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]
const VISIBLE = 0.35

let landmarkerPromise: Promise<PoseLandmarker> | null = null

export function getPoseLandmarker() {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm")
      const options = {
        baseOptions: { modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task" },
        runningMode: "VIDEO" as const, numPoses: 1,
        minPoseDetectionConfidence: 0.55, minPosePresenceConfidence: 0.55, minTrackingConfidence: 0.55,
      }
      try {
        return await PoseLandmarker.createFromOptions(vision, { ...options, baseOptions: { ...options.baseOptions, delegate: "GPU" } })
      } catch (gpuError) {
        console.warn("GPU pose delegate unavailable; using CPU.", gpuError)
        return PoseLandmarker.createFromOptions(vision, { ...options, baseOptions: { ...options.baseOptions, delegate: "CPU" } })
      }
    })()
    landmarkerPromise.catch(() => { landmarkerPromise = null })
  }
  return landmarkerPromise
}

let lastTimestamp = 0
/** Runs the landmarker on one frame (timestamps are forced to increase, as VIDEO mode requires). */
export function detectPose(landmarker: PoseLandmarker, source: HTMLCanvasElement): PosePoint[] | null {
  const original = console.error
  console.error = (...args: unknown[]) => {
    if (!args.some((arg) => typeof arg === "string" && arg.includes("XNNPACK"))) original(...args)
  }
  try {
    lastTimestamp = Math.max(performance.now(), lastTimestamp + 1)
    const result = landmarker.detectForVideo(source, lastTimestamp)
    return result.landmarks[0]?.length ? result.landmarks[0] : null
  } finally {
    console.error = original
  }
}

/** Exponential smoothing so the overlay glides instead of jittering. */
export function smoothPose(previous: PosePoint[] | null, next: PosePoint[], amount = 0.55): PosePoint[] {
  if (!previous) return next
  return next.map((point, index) => {
    const before = previous[index]
    if (!before) return point
    return {
      ...point,
      x: before.x * amount + point.x * (1 - amount),
      y: before.y * amount + point.y * (1 - amount),
      visibility: Math.max((before.visibility ?? 0) * 0.85, point.visibility ?? 0),
    }
  })
}

const visible = (point?: PosePoint) => !!point && (point.visibility ?? 1) >= VISIBLE
const toPixels = (point: PosePoint, width: number, height: number): Point => ({ x: point.x * width, y: point.y * height })
const middle = (a: PosePoint, b: PosePoint): PosePoint => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, visibility: Math.min(a.visibility ?? 1, b.visibility ?? 1) })

/** Interior angle at b (degrees), measured in pixel space so the video's aspect ratio doesn't distort it. */
export function jointAngle(a: PosePoint, b: PosePoint, c: PosePoint, width: number, height: number): number {
  const A = toPixels(a, width, height), B = toPixels(b, width, height), C = toPixels(c, width, height)
  const v1 = { x: A.x - B.x, y: A.y - B.y }, v2 = { x: C.x - B.x, y: C.y - B.y }
  const cos = (v1.x * v2.x + v1.y * v2.y) / (Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y) || 1)
  return (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI
}

const angleOrNull = (pose: PosePoint[], a: number, b: number, c: number, width: number, height: number) =>
  visible(pose[a]) && visible(pose[b]) && visible(pose[c]) ? jointAngle(pose[a], pose[b], pose[c], width, height) : null

export function measure(pose: PosePoint[], width: number, height: number, t: number): FrameMetrics {
  const confidence = KEY_JOINTS.reduce((sum, index) => sum + (pose[index]?.visibility ?? 0), 0) / KEY_JOINTS.length
  const shoulders = middle(pose[11], pose[12]), hips = middle(pose[23], pose[24]), ankles = middle(pose[27], pose[28])
  const S = toPixels(shoulders, width, height), H = toPixels(hips, width, height), A = toPixels(ankles, width, height)
  const bodyLength = Math.hypot(A.x - S.x, A.y - S.y)
  const lineVisible = visible(shoulders) && visible(ankles) && bodyLength > 20
  let bodyTilt: number | null = null
  if (lineVisible) {
    const degrees = Math.abs((Math.atan2(A.y - S.y, A.x - S.x) * 180) / Math.PI)
    bodyTilt = degrees > 90 ? 180 - degrees : degrees
  }
  // Wrist position along the body axis (head = negative); it cycles once per arm stroke.
  const wrist = (pose[15]?.visibility ?? 0) >= (pose[16]?.visibility ?? 0) ? pose[15] : pose[16]
  let wristAxis: number | null = null
  if (lineVisible && visible(wrist)) {
    const unit = { x: (H.x - S.x) / (Math.hypot(H.x - S.x, H.y - S.y) || 1), y: (H.y - S.y) / (Math.hypot(H.x - S.x, H.y - S.y) || 1) }
    const W = toPixels(wrist, width, height)
    wristAxis = ((W.x - S.x) * unit.x + (W.y - S.y) * unit.y) / bodyLength
  }
  return {
    t,
    elbowL: angleOrNull(pose, 11, 13, 15, width, height), elbowR: angleOrNull(pose, 12, 14, 16, width, height),
    kneeL: angleOrNull(pose, 23, 25, 27, width, height), kneeR: angleOrNull(pose, 24, 26, 28, width, height),
    hip: angleOrNull(pose, 11, 23, 25, width, height) ?? angleOrNull(pose, 12, 24, 26, width, height),
    bodyTilt,
    ankleDepth: lineVisible ? (A.y - H.y) / bodyLength : null,
    wristAxis,
    confidence,
  }
}

const values = (samples: FrameMetrics[], pick: (sample: FrameMetrics) => number | null) =>
  samples.map(pick).filter((value): value is number => value !== null && Number.isFinite(value))
const quantile = (list: number[], q: number) => {
  if (!list.length) return null
  const sorted = [...list].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))]
}
const round = (value: number | null, digits = 0) => (value === null ? null : Number(value.toFixed(digits)))

/** Strokes per minute from the wrist's cycle along the body, or null when the sampling can't support it. */
export function strokeRate(samples: FrameMetrics[]): number | null {
  const series = samples.filter((sample) => sample.wristAxis !== null).map((sample) => ({ t: sample.t, v: sample.wristAxis as number }))
  if (series.length < 12) return null
  const span = series[series.length - 1].t - series[0].t
  if (span <= 0 || series.length / span < 3) return null // needs at least ~3 samples per second
  const smooth = series.map((point, index) => {
    const window = series.slice(Math.max(0, index - 1), index + 2)
    return { t: point.t, v: window.reduce((sum, item) => sum + item.v, 0) / window.length }
  })
  const mean = smooth.reduce((sum, point) => sum + point.v, 0) / smooth.length
  const sd = Math.sqrt(smooth.reduce((sum, point) => sum + (point.v - mean) ** 2, 0) / smooth.length)
  if (sd < 0.03) return null
  const peaks: number[] = []
  for (let index = 1; index < smooth.length - 1; index++) {
    const point = smooth[index]
    if (point.v > smooth[index - 1].v && point.v >= smooth[index + 1].v && point.v > mean + 0.25 * sd && (!peaks.length || point.t - peaks[peaks.length - 1] >= 0.4)) peaks.push(point.t)
  }
  if (peaks.length < 3) return null
  const rate = ((peaks.length - 1) / (peaks[peaks.length - 1] - peaks[0])) * 60
  return rate >= 15 && rate <= 90 ? Math.round(rate) : null
}

/**
 * Summary of a scan. `totalFrames` is every frame examined (tracking is reported against it). With `horizontalOnly`
 * (side-on / underwater clips) only frames where the body is roughly horizontal count, so people standing on deck,
 * presenters or other non-swimming poses never pollute the numbers.
 */
export function summarize(samples: FrameMetrics[], totalFrames = samples.length, horizontalOnly = false): ClipSummary {
  const tracked = samples.filter((sample) => sample.confidence >= 0.4 && (!horizontalOnly || (sample.bodyTilt !== null && sample.bodyTilt <= 40)))
  const elbows = [...values(tracked, (s) => s.elbowL), ...values(tracked, (s) => s.elbowR)]
  const knees = [...values(tracked, (s) => s.kneeL), ...values(tracked, (s) => s.kneeR)]
  const depth = values(tracked, (s) => s.ankleDepth)
  const kick = depth.length >= 6 ? (quantile(depth, 0.9)! - quantile(depth, 0.1)!) * 100 : null
  return {
    frames: totalFrames,
    swimming_frames: tracked.length,
    seconds_covered: round(samples.length ? samples[samples.length - 1].t - samples[0].t : 0, 1) ?? 0,
    tracking_percent: Math.round((totalFrames ? tracked.length / totalFrames : 0) * 100),
    elbow_catch_deg: round(quantile(elbows, 0.15)),
    elbow_median_deg: round(quantile(elbows, 0.5)),
    knee_median_deg: round(quantile(knees, 0.5)),
    hip_median_deg: round(quantile(values(tracked, (s) => s.hip), 0.5)),
    body_tilt_deg: round(quantile(values(tracked, (s) => s.bodyTilt), 0.5), 1),
    kick_depth_percent: round(kick, 1),
    stroke_rate_per_min: strokeRate(tracked),
  }
}

// ---------------------------------------------------------------- HUD drawing
function label(context: CanvasRenderingContext2D, text: string, x: number, y: number, scale: number, color: string) {
  context.save()
  context.font = `600 ${Math.round(scale * 0.018)}px ui-monospace, SFMono-Regular, Menlo, monospace`
  const width = context.measureText(text).width + scale * 0.016
  const height = scale * 0.03
  context.fillStyle = "rgba(3, 12, 18, 0.82)"
  context.strokeStyle = color
  context.lineWidth = Math.max(1, scale * 0.0015)
  context.beginPath()
  context.roundRect(x - width / 2, y - height / 2, width, height, height / 2)
  context.fill()
  context.stroke()
  context.fillStyle = "#ecfeff"
  context.textAlign = "center"
  context.textBaseline = "middle"
  context.fillText(text, x, y + scale * 0.001)
  context.restore()
}

function angleArc(context: CanvasRenderingContext2D, pose: PosePoint[], a: number, b: number, c: number, width: number, height: number, scale: number, color: string) {
  if (!visible(pose[a]) || !visible(pose[b]) || !visible(pose[c])) return
  const A = toPixels(pose[a], width, height), B = toPixels(pose[b], width, height), C = toPixels(pose[c], width, height)
  const start = Math.atan2(A.y - B.y, A.x - B.x)
  const end = Math.atan2(C.y - B.y, C.x - B.x)
  let delta = end - start
  while (delta > Math.PI) delta -= Math.PI * 2
  while (delta < -Math.PI) delta += Math.PI * 2
  const radius = scale * 0.038
  context.save()
  context.beginPath()
  context.moveTo(B.x, B.y)
  context.arc(B.x, B.y, radius, start, start + delta, delta < 0)
  context.closePath()
  context.fillStyle = color.replace("1)", "0.18)")
  context.fill()
  context.beginPath()
  context.arc(B.x, B.y, radius, start, start + delta, delta < 0)
  context.strokeStyle = color
  context.lineWidth = Math.max(1.5, scale * 0.003)
  context.stroke()
  context.restore()
  const mid = start + delta / 2
  label(context, `${Math.round(jointAngle(pose[a], pose[b], pose[c], width, height))}°`, B.x + Math.cos(mid) * radius * 2.1, B.y + Math.sin(mid) * radius * 2.1, scale, color)
}

/** Draws the full HUD: scan grid, hand-path trails, glowing skeleton, joint angles, body line and target brackets. */
export function drawHud(context: CanvasRenderingContext2D, pose: PosePoint[] | null, trails: Point[][], layers: Layers, pulse: number) {
  const { width, height } = context.canvas
  const scale = Math.max(width, height)
  context.clearRect(0, 0, width, height)
  context.lineCap = "round"
  context.lineJoin = "round"

  if (layers.grid) {
    context.save()
    context.strokeStyle = "rgba(103, 232, 249, 0.08)"
    context.lineWidth = 1
    for (let x = 0; x <= width; x += width / 16) { context.beginPath(); context.moveTo(x, 0); context.lineTo(x, height); context.stroke() }
    for (let y = 0; y <= height; y += height / 9) { context.beginPath(); context.moveTo(0, y); context.lineTo(width, y); context.stroke() }
    context.restore()
  }

  if (layers.trails) {
    trails.forEach((trail, side) => {
      for (let index = 1; index < trail.length; index++) {
        const alpha = index / trail.length
        context.beginPath()
        context.moveTo(trail[index - 1].x * width, trail[index - 1].y * height)
        context.lineTo(trail[index].x * width, trail[index].y * height)
        context.strokeStyle = side === 0 ? `rgba(103, 232, 249, ${alpha * 0.9})` : `rgba(196, 181, 253, ${alpha * 0.9})`
        context.lineWidth = Math.max(1, scale * 0.006 * alpha)
        context.stroke()
      }
    })
  }
  if (!pose) return

  if (layers.skeleton) {
    const line = context.createLinearGradient(0, 0, width, height)
    line.addColorStop(0, "#d9fbff"); line.addColorStop(0.4, "#67e8f9"); line.addColorStop(0.75, "#38bdf8"); line.addColorStop(1, "#a78bfa")
    context.save()
    context.strokeStyle = "rgba(34, 211, 238, 0.32)"
    context.shadowColor = "rgba(34, 211, 238, 0.95)"
    context.shadowBlur = scale * 0.025
    context.lineWidth = scale * 0.014
    CONNECTIONS.forEach(([a, b]) => {
      if (!visible(pose[a]) || !visible(pose[b])) return
      context.beginPath(); context.moveTo(pose[a].x * width, pose[a].y * height); context.lineTo(pose[b].x * width, pose[b].y * height); context.stroke()
    })
    context.restore()
    context.strokeStyle = line
    context.lineWidth = scale * 0.0045
    CONNECTIONS.forEach(([a, b]) => {
      if (!visible(pose[a]) || !visible(pose[b])) return
      context.beginPath(); context.moveTo(pose[a].x * width, pose[a].y * height); context.lineTo(pose[b].x * width, pose[b].y * height); context.stroke()
    })
    KEY_JOINTS.concat([0]).forEach((index) => {
      const point = pose[index]
      if (!visible(point)) return
      const x = point.x * width, y = point.y * height, radius = scale * 0.008
      const joint = context.createRadialGradient(x - radius * 0.35, y - radius * 0.35, 0, x, y, radius)
      joint.addColorStop(0, "#ffffff"); joint.addColorStop(0.45, "#a5f3fc"); joint.addColorStop(1, "#22d3ee")
      context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2); context.fillStyle = joint; context.fill()
      context.beginPath(); context.arc(x, y, radius * (1.8 + pulse * 0.35), 0, Math.PI * 2)
      context.strokeStyle = `rgba(103, 232, 249, ${0.25 + pulse * 0.25})`; context.lineWidth = scale * 0.0015; context.stroke()
    })
  }

  // Body line: shoulders to ankles, with its tilt from horizontal.
  const shoulders = middle(pose[11], pose[12]), ankles = middle(pose[27], pose[28])
  if (layers.angles && visible(shoulders) && visible(ankles)) {
    const S = toPixels(shoulders, width, height), A = toPixels(ankles, width, height)
    context.save()
    context.setLineDash([scale * 0.012, scale * 0.01])
    context.strokeStyle = "rgba(250, 204, 21, 0.75)"
    context.lineWidth = Math.max(1, scale * 0.0025)
    context.beginPath(); context.moveTo(S.x, S.y); context.lineTo(A.x, A.y); context.stroke()
    context.restore()
    const degrees = Math.abs((Math.atan2(A.y - S.y, A.x - S.x) * 180) / Math.PI)
    label(context, `line ${(degrees > 90 ? 180 - degrees : degrees).toFixed(0)}°`, (S.x + A.x) / 2, (S.y + A.y) / 2 - scale * 0.03, scale, "rgba(250, 204, 21, 1)")
  }

  if (layers.angles) {
    angleArc(context, pose, 11, 13, 15, width, height, scale, "rgba(103, 232, 249, 1)")
    angleArc(context, pose, 12, 14, 16, width, height, scale, "rgba(196, 181, 253, 1)")
    angleArc(context, pose, 23, 25, 27, width, height, scale, "rgba(52, 211, 153, 1)")
    angleArc(context, pose, 24, 26, 28, width, height, scale, "rgba(52, 211, 153, 1)")
  }

  // Target brackets around the tracked body.
  const seen = pose.filter((point) => visible(point))
  if (seen.length > 4) {
    const minX = Math.min(...seen.map((p) => p.x)), maxX = Math.max(...seen.map((p) => p.x))
    const minY = Math.min(...seen.map((p) => p.y)), maxY = Math.max(...seen.map((p) => p.y))
    const left = Math.max(0, (minX - 0.03) * width), right = Math.min(width, (maxX + 0.03) * width)
    const top = Math.max(0, (minY - 0.05) * height), bottom = Math.min(height, (maxY + 0.05) * height)
    const corner = Math.min(scale * 0.05, 40)
    context.save()
    context.strokeStyle = `rgba(165, 243, 252, ${0.4 + pulse * 0.3})`
    context.lineWidth = Math.max(1.5, scale * 0.0022)
    ;[[left, top, 1, 1], [right, top, -1, 1], [left, bottom, 1, -1], [right, bottom, -1, -1]].forEach(([x, y, dx, dy]) => {
      context.beginPath(); context.moveTo(x + dx * corner, y); context.lineTo(x, y); context.lineTo(x, y + dy * corner); context.stroke()
    })
    context.restore()
  }
}
