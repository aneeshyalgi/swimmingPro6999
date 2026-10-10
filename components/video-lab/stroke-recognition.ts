import { detectStill, getStillPoseLandmarker, type PosePoint } from "@/components/video-lab/pose-engine"

/*
 * Recognises the stroke in a clip, so the athlete doesn't have to pick it.
 *
 * The clip is sampled on its own hidden video element (the visible player is left alone): 20 evenly spaced frames go
 * through the pose model, and 12 of them, spread across the clip, are also kept as small stills. The backend's vision
 * model names the stroke from the stills plus the body-tracking evidence. The evidence matters: underwater and side-on,
 * backstroke looks like freestyle and butterfly like breaststroke in stills, but the body tells them apart (which way the
 * chest faces and bent knees point, and how often both knees are deeply bent at once, as in a frog kick). Hand positions
 * aren't used: side-on, the far arm is hidden and the pose model only guesses where it is.
 */

/** The recognised stroke (null when none could be seen), and the runner-up when the answer is only a best guess. */
export type StrokeGuess = { stroke: string | null; confidence: number; reason: string; alternative: string | null }

/** Body tracking over the frames where the swimmer lies in the water (see stroke_detection.py for how it's read). */
export type StrokeEvidence = {
  frames: number
  chest_up: number; chest_down: number
  knees_bending_up: number; knees_bending_down: number
  both_knees_bent: number
}

type Pose = { image: PosePoint[]; world: PosePoint[] }

const POSE_FRAMES = 20
const STILLS = 12
/** The pose frames that are also sent as stills: the ones nearest to 12 evenly spaced points in the clip. */
const STILL_FRAMES = new Set(Array.from({ length: STILLS }, (_, index) => Math.floor(((index + 0.5) * POSE_FRAMES) / STILLS)))
const STILL_SIZE = 640
const POSE_SIZE = 1280
const VISIBLE = 0.5
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"

type Vec = { x: number; y: number; z: number }
const vec = (point: PosePoint): Vec => ({ x: point.x, y: point.y, z: point.z ?? 0 })
const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
const mid = (a: Vec, b: Vec): Vec => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 })
const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y + a.z * b.z
const cross = (a: Vec, b: Vec): Vec => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x })
const length = (a: Vec) => Math.hypot(a.x, a.y, a.z)
const angle = (a: Vec, b: Vec, c: Vec) => {
  const u = sub(a, b), v = sub(c, b)
  return (Math.acos(Math.max(-1, Math.min(1, dot(u, v) / (length(u) * length(v) || 1)))) * 180) / Math.PI
}

/** Reads the stroke-defining body cues from the poses of a clip (frames where the body isn't lying flat are skipped). */
export function strokeEvidence(poses: Pose[], width: number, height: number): StrokeEvidence {
  let frames = 0, chestUp = 0, chestDown = 0, kneesUp = 0, kneesDown = 0, bothBent = 0
  for (const { image, world } of poses) {
    const px = image.map((point) => ({ x: point.x * width, y: point.y * height, z: 0, visibility: point.visibility ?? 0 }))
    const shoulders2d = mid(px[11], px[12]), ankles2d = mid(px[27], px[28])
    let tilt = Math.abs((Math.atan2(ankles2d.y - shoulders2d.y, ankles2d.x - shoulders2d.x) * 180) / Math.PI)
    if (tilt > 90) tilt = 180 - tilt
    if (tilt > 40 || Math.hypot(ankles2d.x - shoulders2d.x, ankles2d.y - shoulders2d.y) < 30) continue
    frames++
    // Which way the chest faces: the normal of the shoulders-hips plane, from the 3D landmarks (y points down).
    const w = world.map(vec)
    const normal = cross(sub(w[12], w[11]), sub(mid(w[23], w[24]), mid(w[11], w[12])))
    const up = -normal.y / (length(normal) || 1)
    if (up > 0.3) chestUp++
    else if (up < -0.3) chestDown++
    // Which way a bent knee points in the frame: above the hip-ankle line on the back, below it face down.
    for (const [hip, knee, ankle] of [[23, 25, 27], [24, 26, 28]]) {
      const h = px[hip], k = px[knee], a = px[ankle]
      if (h.visibility < VISIBLE || k.visibility < VISIBLE || a.visibility < VISIBLE || angle(h, k, a) > 168) continue
      const t = ((k.x - h.x) * (a.x - h.x) + (k.y - h.y) * (a.y - h.y)) / ((a.x - h.x) ** 2 + (a.y - h.y) ** 2 || 1)
      if (k.y < h.y + t * (a.y - h.y)) kneesUp++
      else kneesDown++
    }
    // Both knees deeply bent at once (3D angles): the frog kick does this; flutter and dolphin kicks rarely.
    if (Math.max(angle(w[23], w[25], w[27]), angle(w[24], w[26], w[28])) < 130) bothBent++
  }
  return { frames, chest_up: chestUp, chest_down: chestDown, knees_bending_up: kneesUp, knees_bending_down: kneesDown, both_knees_bent: bothBent }
}

const throwIfAborted = (signal: AbortSignal) => { if (signal.aborted) throw new DOMException("Stroke recognition cancelled.", "AbortError") }

/** Resolves when `event` fires on the video, or after `ms` (seeking can stall without one). */
const once = (video: HTMLVideoElement, event: string, ms: number) => new Promise<void>((resolve) => {
  const done = () => { video.removeEventListener(event, done); window.clearTimeout(timer); resolve() }
  const timer = window.setTimeout(done, ms)
  video.addEventListener(event, done)
})

/**
 * A hidden copy of the clip to sample from, with a known size and duration (recordings can report an infinite one).
 * Only the metadata is awaited: a paused, unseen video needn't decode a frame until it's seeked to one.
 */
async function openClip(url: string, signal: AbortSignal) {
  const video = document.createElement("video")
  video.muted = true
  video.playsInline = true
  video.preload = "auto"
  video.setAttribute("aria-hidden", "true")
  video.style.cssText = "position:fixed;left:-10000px;top:0;width:2px;height:2px;opacity:0;pointer-events:none"
  document.body.appendChild(video)
  video.src = url
  if (video.readyState < 1) await once(video, "loadedmetadata", 15_000)
  throwIfAborted(signal)
  if (video.readyState < 1 || !video.videoWidth) throw new Error("The clip couldn't be read.")
  if (!Number.isFinite(video.duration)) {
    video.currentTime = 1e7
    await once(video, "seeked", 4000)
  }
  if (!Number.isFinite(video.duration) || video.duration <= 0) throw new Error("The clip's length is unknown.")
  return video
}

/**
 * Samples the clip, measures the body and asks the backend which stroke it is. Throws if recognition can't run.
 * `headers` say who is asking (see video-access.ts): only someone who may still analyse gets an answer.
 */
export async function recognizeStroke(url: string, signal: AbortSignal, headers: Record<string, string> = {}): Promise<StrokeGuess> {
  // The pose model loads while the clip opens. Without it (it can fail to load), the stills alone still give a
  // reasonable guess.
  const loading = getStillPoseLandmarker().catch((failure) => { console.warn("Pose model unavailable for stroke recognition:", failure); return null })
  const video = await openClip(url, signal)
  try {
    const landmarker = await loading
    throwIfAborted(signal)
    const fit = (size: number) => Math.min(1, size / Math.max(video.videoWidth, video.videoHeight))
    const poseCanvas = document.createElement("canvas")
    poseCanvas.width = Math.round(video.videoWidth * fit(POSE_SIZE))
    poseCanvas.height = Math.round(video.videoHeight * fit(POSE_SIZE))
    const stillCanvas = document.createElement("canvas")
    stillCanvas.width = Math.round(video.videoWidth * fit(STILL_SIZE))
    stillCanvas.height = Math.round(video.videoHeight * fit(STILL_SIZE))
    const frames: { time: number; image: string }[] = []
    const poses: Pose[] = []
    for (let index = 0; index < POSE_FRAMES; index++) {
      video.currentTime = Math.min(video.duration - 0.01, ((index + 0.5) / POSE_FRAMES) * video.duration)
      await once(video, "seeked", 2500)
      throwIfAborted(signal)
      if (video.readyState < 2) continue // this frame didn't decode in time
      if (STILL_FRAMES.has(index)) {
        stillCanvas.getContext("2d")?.drawImage(video, 0, 0, stillCanvas.width, stillCanvas.height)
        frames.push({ time: Number(video.currentTime.toFixed(2)), image: stillCanvas.toDataURL("image/jpeg", 0.8) })
      }
      if (landmarker) {
        poseCanvas.getContext("2d")?.drawImage(video, 0, 0, poseCanvas.width, poseCanvas.height)
        try {
          const pose = detectStill(landmarker, poseCanvas)
          if (pose) poses.push(pose)
        } catch (failure) { console.warn("Pose detection failed on a sampled frame:", failure) }
      }
    }
    if (!frames.length) throw new Error("The clip couldn't be decoded.")
    const response = await fetch(`${API_URL}/api/video-analysis/stroke`, {
      method: "POST", headers: { "Content-Type": "application/json", ...headers }, signal,
      body: JSON.stringify({
        frames, duration_seconds: Number(video.duration.toFixed(2)),
        evidence: landmarker ? strokeEvidence(poses, poseCanvas.width, poseCanvas.height) : null,
      }),
    })
    if (!response.ok) throw new Error(`Stroke recognition failed (${response.status}).`)
    const guess = (await response.json()) as Partial<StrokeGuess>
    return { stroke: guess.stroke ?? null, confidence: Number(guess.confidence) || 0, reason: guess.reason ?? "", alternative: guess.alternative ?? null }
  } finally {
    video.removeAttribute("src")
    video.load()
    video.remove()
  }
}
