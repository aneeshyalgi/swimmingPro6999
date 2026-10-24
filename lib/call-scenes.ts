import { COMMON, MAIN, SCENE_SHADERS } from "@/lib/call-scene-shaders"
import { ART_SHADERS } from "@/lib/call-scene-art"

/*
 * The scenes behind the coach chat and the voice call: backgrounds we made (athletes pick one; they can't add their
 * own). One pick serves both. Midnight is each one's original CSS backdrop; every other scene is drawn with WebGL every
 * frame and moves with the coach.
 */

const SHADERS = { ...SCENE_SHADERS, ...ART_SHADERS }
export type SceneId = keyof typeof SHADERS
export type Scene = {
  id: SceneId
  name: string
  mood: string
  /** A CSS gradient in the scene's colours: its tile before the live picture is ready, and the dot on the button. */
  swatch: string
}

export const DEFAULT_SCENE: SceneId = "midnight"

// In the picker's order: the pool, then wild water, then dreamier ones. Every scene is drawn as an illustration, in flat
// shapes and clean lines, rather than trying to look real.
export const SCENES: readonly Scene[] = [
  { id: "midnight", name: "Midnight", mood: "The original look, calm and dark",
    swatch: "radial-gradient(circle at 30% 25%, #2dd4bf55, transparent 60%), radial-gradient(circle at 75% 80%, #6366f155, transparent 60%), #05090e" },
  { id: "deep-end", name: "Deep End", mood: "Underwater, light wriggling on the floor",
    swatch: "linear-gradient(180deg, #c8fbf5 0 18%, #3fc4cf 18%, #1786a6 62%, #2bb5c8 64%, #1d9cb8)" },
  { id: "snells-window", name: "Snell's Window", mood: "A circle of sky in the surface",
    swatch: "radial-gradient(circle at 50% 40%, #d6efff 0 24%, #ffffff 25% 26%, #2a8bb8 27%, #0b4f7c 62%, #06264a)" },
  { id: "night-swim", name: "Night Swim", mood: "A glowing pool under string lights",
    swatch: "linear-gradient(180deg, #0a1030, #2b2160 42%, #0e1430 50%, #19c3cf 54%, #0a8fa8 88%, #101828)" },
  { id: "infinity-edge", name: "Infinity Edge", mood: "A striped sunset past the pool's edge",
    swatch: "linear-gradient(180deg, #3a2a6a 0 15%, #7a3f7f 15% 30%, #f06c6c 30% 44%, #ffa45c 44% 55%, #4c5f8f 55% 72%, #1d8fa0 72%)" },
  { id: "open-water", name: "Open Water", mood: "A sunny sea and leaping dolphins",
    swatch: "linear-gradient(180deg, #4aa3f2, #bfe6ff 52%, #5ac0e6 53%, #1f6fc0)" },
  { id: "lagoon", name: "Lagoon", mood: "A turtle, fish and a manta round an island",
    swatch: "radial-gradient(circle at 35% 45%, #4cb36a 0 14%, #f5e2b0 15% 19%, #56dcd2 20% 30%, #1fa9cf 31% 40%, #1663bf 41%)" },
  { id: "northern-lights", name: "Northern Lights", mood: "Aurora ribbons over the mountains",
    swatch: "linear-gradient(180deg, #0a1030, #3cf0a0 28%, #2a2a6a 42%, #3a4a7a 55%, #0a0e20 62%, #142040)" },
  { id: "rainfall", name: "Rainfall", mood: "Rain on a koi pond",
    swatch: "radial-gradient(circle at 30% 35%, #4caf50 0 9%, transparent 10%), radial-gradient(circle at 68% 62%, #ff7a2f 0 6%, transparent 7%), #0a2a30" },
  { id: "paper-tide", name: "Paper Tide", mood: "Cut-paper waves rolling at dusk",
    swatch: "linear-gradient(180deg, #241c48, #b5638a 30%, #f5b27a 44%, #7d8cc2 52%, #18486a 72%, #030b18)" },
  { id: "nebula", name: "Cosmos", mood: "Planets in your coach's colours",
    swatch: "radial-gradient(circle at 72% 72%, #29c6e6 0 26%, transparent 27%), radial-gradient(circle at 20% 22%, #ff9f80 0 8%, transparent 9%), linear-gradient(135deg, #3a1d5c, #120a2a)" },
  { id: "liquid-silk", name: "Liquid Silk", mood: "Silk ribbons over a wash of colour",
    swatch: "linear-gradient(135deg, #6a3a8a, #2a6fa0 50%, #22a0a8)" },
  { id: "marbled", name: "Marbled", mood: "Ink blooming in your coach's colours",
    swatch: "linear-gradient(135deg, #0a0f1e, #1fb8d4 25%, #d8cdb5 40%, #b07b2a 55%, #0e7fa8 70%, #070b16)" },
  { id: "neon-lanes", name: "Neon Lanes", mood: "A retro sunset and lanes racing in",
    swatch: "linear-gradient(180deg, #120428, #ff3d8b 45%, #ffcf4a 52%, #2a0640 58%, #0a0218)" },
  { id: "contours", name: "Contours", mood: "A map of the deep in your coach's colours",
    swatch: "repeating-radial-gradient(circle at 60% 45%, #123a5a 0 6%, #1b5577 6% 12%)" },
]

export const sceneById = (id: SceneId) => SCENES.find((scene) => scene.id === id) ?? SCENES[0]
/** Whether the scene is drawn with WebGL (Midnight is the chat's and the call's own CSS backdrop). */
export const drawnScene = (id: SceneId) => id !== DEFAULT_SCENE

// The scene picked on this device, for the chat and the call. A convenience: without storage they open on Midnight.
const SCENE_KEY = "swimgpt_call_scene"
/** Sent on window (with the scene as its detail) when a scene is picked, so a chat open under a call keeps up. */
export const SCENE_PICKED = "swimgpt:scene-picked"
export function savedScene(): SceneId {
  try {
    const saved = window.localStorage.getItem(SCENE_KEY)
    return SCENES.some((scene) => scene.id === saved) ? (saved as SceneId) : DEFAULT_SCENE
  } catch {
    return DEFAULT_SCENE
  }
}
export function saveScene(id: SceneId) {
  try { window.localStorage.setItem(SCENE_KEY, id) } catch { /* private mode or full */ }
  window.dispatchEvent(new CustomEvent<SceneId>(SCENE_PICKED, { detail: id }))
}

export type Rgb = [number, number, number]
export const rgb = (hex: string): Rgb => {
  const value = Number.parseInt(hex.replace("#", ""), 16)
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255]
}

/** What moves a frame: seconds into the call, the voice (0-1), how much of it is the coach's (0-1), their colours. */
export type SceneFrame = { time: number; level: number; speak: number; a: Rgb; b: Rgb; scale: number }
/** A scene drawn only inside (or outside) a circle, in drawing-buffer pixels from the bottom left. */
export type SceneClip = { x: number; y: number; radius: number; keep: "inside" | "outside" }

type Program = { program: WebGLProgram; uniforms: Record<string, WebGLUniformLocation | null> }
type Compiling = { program: WebGLProgram; vertex: WebGLShader; fragment: WebGLShader }
type ParallelCompile = { COMPLETION_STATUS_KHR: number }

const UNIFORMS = ["uRes", "uTime", "uLevel", "uSpeak", "uA", "uB", "uClip", "uScale"]
const VERTEX = "attribute vec2 aPos; void main() { gl_Position = vec4(aPos, 0.0, 1.0); }"

/**
 * Draws scenes into one WebGL canvas. Each scene's program is compiled the first time it's needed: in the background
 * where the browser can (`background`), so a long compile never holds the page up.
 */
export class SceneRenderer {
  private programs = new Map<SceneId, Program | Compiling | null>()
  private parallel: ParallelCompile | null

  private constructor(private gl: WebGLRenderingContext, private buffer: WebGLBuffer) {
    this.parallel = gl.getExtension("KHR_parallel_shader_compile") as ParallelCompile | null
  }

  /** null when the browser has no WebGL (the call keeps its own backdrop). */
  static create(canvas: HTMLCanvasElement): SceneRenderer | null {
    let gl: WebGLRenderingContext | null = null
    try {
      gl = canvas.getContext("webgl", { alpha: true, antialias: false, depth: false, stencil: false, premultipliedAlpha: true, preserveDrawingBuffer: false })
    } catch {
      gl = null
    }
    if (!gl || gl.isContextLost()) return null
    // Lets the scenes that measure how fast they change from pixel to pixel (dFdx) keep their edges crisp.
    gl.getExtension("OES_standard_derivatives")
    const buffer = gl.createBuffer()
    if (!buffer) return null
    // One triangle that covers the whole canvas.
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    return new SceneRenderer(gl, buffer)
  }

  get lost() { return this.gl.isContextLost() }
  /** Whether scenes compile in the background here (so starting several at once doesn't stall the page). */
  get background() { return this.parallel !== null }

  /** Starts compiling the scene if it hasn't yet. true: ready to draw; false: this device can't draw it; null: still
   *  compiling in the background. */
  prepare(id: SceneId): boolean | null {
    if (!this.programs.has(id)) this.programs.set(id, this.start(id))
    const entry = this.programs.get(id)
    if (entry && "vertex" in entry) {
      if (this.parallel && !this.gl.getProgramParameter(entry.program, this.parallel.COMPLETION_STATUS_KHR) && !this.gl.isContextLost()) return null
      this.programs.set(id, this.finish(id, entry))
    }
    return this.programs.get(id) !== null
  }
  /** Whether the scene is compiled and ready to draw. */
  prepared(id: SceneId) {
    const entry = this.programs.get(id)
    return !!entry && !("vertex" in entry)
  }

  size(width: number, height: number) {
    const canvas = this.gl.canvas as HTMLCanvasElement
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height }
    this.gl.viewport(0, 0, width, height)
  }

  clear() {
    this.gl.clearColor(0, 0, 0, 0)
    this.gl.clear(this.gl.COLOR_BUFFER_BIT)
  }

  /** Draws the scene; false when it isn't ready (still compiling, or can't be drawn here). */
  draw(id: SceneId, frame: SceneFrame, clip: SceneClip | null = null): boolean {
    const gl = this.gl
    if (!this.prepare(id)) return false
    const { program, uniforms } = this.programs.get(id) as Program
    gl.useProgram(program)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer)
    const position = gl.getAttribLocation(program, "aPos")
    gl.enableVertexAttribArray(position)
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
    gl.uniform2f(uniforms.uRes, gl.drawingBufferWidth, gl.drawingBufferHeight)
    gl.uniform1f(uniforms.uTime, frame.time)
    gl.uniform1f(uniforms.uLevel, frame.level)
    gl.uniform1f(uniforms.uSpeak, frame.speak)
    gl.uniform3f(uniforms.uA, ...frame.a)
    gl.uniform3f(uniforms.uB, ...frame.b)
    gl.uniform1f(uniforms.uScale, frame.scale)
    gl.uniform4f(uniforms.uClip, clip?.x ?? 0, clip?.y ?? 0, clip?.radius ?? 0, clip ? (clip.keep === "inside" ? 1 : -1) : 0)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    return true
  }

  /** `release`: also give the context back to the browser. Not while the canvas stays on the page: its next
   *  getContext would return the lost context (React runs an effect's cleanup and then the effect again in development). */
  dispose(release = true) {
    const gl = this.gl
    for (const entry of this.programs.values()) if (entry) gl.deleteProgram(entry.program)
    this.programs.clear()
    gl.deleteBuffer(this.buffer)
    if (release) gl.getExtension("WEBGL_lose_context")?.loseContext()
  }

  private start(id: SceneId): Compiling | null {
    const gl = this.gl
    const vertex = gl.createShader(gl.VERTEX_SHADER)
    const fragment = gl.createShader(gl.FRAGMENT_SHADER)
    const program = gl.createProgram()
    if (!vertex || !fragment || !program) {
      console.warn(`The ${id} call scene can't be drawn here: no shader`)
      return null
    }
    gl.shaderSource(vertex, VERTEX)
    gl.compileShader(vertex)
    gl.shaderSource(fragment, `${COMMON}\n${SHADERS[id]}\n${MAIN}`)
    gl.compileShader(fragment)
    gl.attachShader(program, vertex)
    gl.attachShader(program, fragment)
    gl.linkProgram(program)
    return { program, vertex, fragment }
  }

  private finish(id: SceneId, { program, vertex, fragment }: Compiling): Program | null {
    const gl = this.gl
    const linked = gl.getProgramParameter(program, gl.LINK_STATUS) || gl.isContextLost()
    if (!linked) {
      const log = [vertex, fragment].map((shader) => gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? "" : gl.getShaderInfoLog(shader)).join(" ").trim()
      console.warn(`The ${id} call scene can't be drawn here:`, log || gl.getProgramInfoLog(program))
    }
    gl.deleteShader(vertex)
    gl.deleteShader(fragment)
    if (!linked) {
      gl.deleteProgram(program)
      return null
    }
    return { program, uniforms: Object.fromEntries(UNIFORMS.map((uniform) => [uniform, gl.getUniformLocation(program, uniform)])) }
  }
}
