/*
 * The voice call's scenes, as WebGL (GLSL ES 1.00) fragment shaders. Each scene is a `vec3 scene(vec2 fc)` that returns
 * the colour of the pixel at `fc` (drawing-buffer pixels, origin bottom left); COMMON comes before it and MAIN after.
 *
 * Every scene answers the call: `voice()` is how loud it is (the coach's voice counts fully, the athlete's a little),
 * and uA / uB are the coach's own colours. MAIN reveals a scene inside (or outside) a growing circle, with a liquid
 * wavefront, when the athlete switches scenes. Scenes may use dFdx / dFdy (OES_standard_derivatives, which nearly every
 * browser has; where it's missing, a scene that uses them fails to compile and can't be picked).
 *
 * The scenes are illustrations, not attempts to look real: flat shapes, clean edges and a few colours (TOON draws them).
 * Some GPU drivers (Direct3D's, under ANGLE on Windows) take many seconds to prepare a shader whose loops hold branches
 * or calls with loops of their own, so the scenes draw every repeated thing either written out or with branch-free
 * loops, and pick the nearest of a few things rather than drawing them all.
 */

export const COMMON = /* glsl */ `#extension GL_OES_standard_derivatives : enable
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 uRes;
uniform float uTime;
uniform float uLevel;
uniform float uSpeak;
uniform vec3 uA;
uniform vec3 uB;
uniform vec4 uClip;
uniform float uScale;

#define PI 3.14159265
#define TAU 6.28318531

float hash12(vec2 p) {
  p = fract(p * vec2(0.3183099, 0.3678794)) + 0.1;
  p *= 17.0;
  return fract(p.x * p.y * (p.x + p.y));
}
vec2 hash22(vec2 p) { return vec2(hash12(p), hash12(p + vec2(37.7, 11.3))); }
float hash11(float x) { return hash12(vec2(x, x * 0.37 + 4.1)); }

float noise(vec2 p) {
  vec2 i = floor(p);
  // (Not fract: some GPUs round it apart from floor right on a cell's edge, leaving a line of wrong pixels there.)
  vec2 f = p - i;
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

const mat2 OCTAVE = mat2(0.8, 0.6, -0.6, 0.8);
float fbm3(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) { v += a * noise(p); p = OCTAVE * p * 2.02 + 3.17; a *= 0.5; }
  return v / 0.875;
}
mat2 rot(float a) { float c = cos(a); float s = sin(a); return mat2(c, s, -s, c); }
float voice() { return clamp(uLevel, 0.0, 1.0) * (0.3 + 0.7 * uSpeak); }
float segment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0));
}

// A sky of twinkling stars: three layers, with this density of the cells lit. Stars stay a pixel or two at any size.
vec3 stars(vec2 p, float t, float density) {
  vec3 acc = vec3(0.0);
  for (int L = 0; L < 3; L++) {
    float fl = float(L);
    float sc = 30.0 + fl * 24.0;
    vec2 q = p * sc + vec2(fl * 17.3, fl * 5.1);
    vec2 id = floor(q);
    float h = hash12(id + fl * 31.7);
    if (h > density) continue;
    vec2 o = (hash22(id * 1.7 + fl) - 0.5) * 0.7;
    float d = length(fract(q) - 0.5 - o) / sc * uRes.y;
    float r = max(0.75, (0.55 + 0.9 * fract(h * 13.0)) * uScale);
    float twinkle = 0.55 + 0.45 * sin(t * (0.8 + 2.5 * fract(h * 7.0)) + h * 60.0);
    vec3 tint = mix(vec3(0.72, 0.84, 1.0), vec3(1.0, 0.88, 0.74), fract(h * 5.7));
    acc += tint * exp(-d * d / (r * r)) * twinkle * (0.45 + 0.75 * fract(h * 3.3)) * (1.0 - fl * 0.22);
  }
  return acc;
}
`

export const MAIN = /* glsl */ `
void main() {
  vec2 fc = gl_FragCoord.xy;
  float edge = 0.0;
  if (uClip.w != 0.0) {
    vec2 d = fc - uClip.xy;
    float dist = length(d);
    float inside = uClip.w * (uClip.z - dist);
    if (inside < 0.0) discard;
    edge = exp(-inside / (uRes.y * 0.045 + uClip.z * 0.04));
    // A liquid wavefront: the scene bends as it sweeps in.
    fc -= d / max(dist, 1.0) * edge * uRes.y * 0.04 * uClip.w;
  }
  vec3 col = scene(fc);
  if (uClip.w != 0.0) {
    vec3 glow = mix(vec3(0.74, 0.96, 1.0), mix(uA, uB, 0.5), 0.4);
    col = col * (1.0 + edge * 0.5) + glow * (pow(edge, 3.0) * 0.5 + pow(edge, 16.0) * 0.95);
  }
  // A whisper of noise so the dark gradients never band.
  col += (hash12(gl_FragCoord.xy + fract(uTime * 3.7) * 113.0) - 0.5) / 128.0;
  gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
}
`

/**
 * Flat, illustrated drawing for the scenes: shapes filled and outlined from their signed distances with edges a pixel
 * soft, cartoon clouds, bubbles and twinkles, and cel-shaded caustics. PX is a pixel in the scene's units: a scene
 * that uses these sets it before drawing.
 */
export const TOON = /* glsl */ `
float PX;
float fill(float d) { return 1.0 - smoothstep(-PX, PX, d); }
float outline(float d, float w) { return 1.0 - smoothstep(w - PX, w + PX, abs(d)); }
float sdBox(vec2 p, vec2 b) {
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}
float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}
// A puffy cartoon cloud about s across, flat along the bottom.
float cloud(vec2 p, float s) {
  float d = length(p - vec2(-0.32, -0.02) * s) - 0.2 * s;
  d = smin(d, length(p - vec2(-0.05, 0.08) * s) - 0.27 * s, 0.06 * s);
  d = smin(d, length(p - vec2(0.27, 0.0) * s) - 0.19 * s, 0.06 * s);
  return max(d, -(p.y + 0.12 * s));
}
// A palm's crown seen from the side, about 0.34 across: a star of leaves drooping under their weight, the lower ones
// most, turned a little by sway. How far q is outside it.
float palmCrown(vec2 q, float sway) {
  q.y += 2.6 * q.x * q.x + 1.6 * max(-q.y, 0.0) * abs(q.x);
  float a = atan(q.y, q.x + 1e-5) + sway;
  float reach = 0.17 * (0.18 + 0.82 * pow(abs(cos(a * 4.0 + 0.4)), 2.5)) * (0.85 + 0.15 * step(q.y, 0.0));
  return (length(q) - reach) * 0.6;
}
// A cartoon bubble of radius r: x is its ring, y its glint.
vec2 bubble(vec2 p, float r) {
  float d = length(p) - r;
  return vec2(outline(d, max(r * 0.12, PX * 0.8)) + fill(d) * 0.12, fill(length(p - vec2(-0.35, 0.38) * r) - r * 0.22));
}
// A four-pointed twinkle, s across.
float twinkle(vec2 p, float s) {
  vec2 a = abs(p) / s;
  return fill((pow(pow(a.x, 0.6) + pow(a.y, 0.6), 1.667) - 0.5) * s);
}
// Cel-shaded caustics: the bright wiggly lines sunlight draws through ripples, like Wind Waker's water, in cells of
// about 1. w is the lines' width and aa a pixel, both in cells.
float toonCaustic(vec2 p, float t, float w, float aa) {
  p += 0.16 * vec2(sin(p.y * 2.3 + t * 0.7), sin(p.x * 2.1 - t * 0.6));
  vec2 n = floor(p);
  vec2 f = p - n;
  float f1 = 8.0;
  float f2 = 8.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 h = hash22(n + g);
      float d = length(g + 0.5 + 0.38 * sin(t * (0.5 + 0.5 * h.yx) + TAU * h) - f);
      if (d < f1) { f2 = f1; f1 = d; }
      else if (d < f2) { f2 = d; }
    }
  }
  return 1.0 - smoothstep(w - aa, w + aa, f2 - f1);
}
`

/** A bird in flight seen from in front, for the scenes with birds crossing their skies. */
export const BIRD = /* glsl */ `
float bone(vec2 p, vec2 a, vec2 b, float ra, float rb) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - mix(ra, rb, h);
}
// A bird about 2 wide: wings in two joints that flap in bursts with glides between, the outer half trailing the inner,
// its body bobbing against each beat. How far q is outside it (in its own units).
float flyingBird(vec2 q, float t, float seed) {
  float flap = smoothstep(-0.3, 0.3, sin(t * 0.5 + seed * 2.3));
  float phase = t * 6.5 + seed * 4.0;
  q.y += 0.08 * sin(phase) * flap;
  q.x = abs(q.x);
  float a1 = 0.2 + 0.65 * sin(phase) * flap;
  float a2 = a1 - 0.35 - 0.6 * sin(phase - 1.2) * flap;
  vec2 shoulder = vec2(0.06, 0.0);
  vec2 wrist = shoulder + 0.45 * vec2(cos(a1), sin(a1));
  vec2 tip = wrist + 0.5 * vec2(cos(a2), sin(a2));
  float wings = min(bone(q, shoulder, wrist, 0.1, 0.075), bone(q, wrist, tip, 0.075, 0.015));
  float body = (length(q / vec2(0.1, 0.15)) - 1.0) * 0.1;
  return min(wings, min(body, length(q - vec2(0.0, 0.13)) - 0.07));
}
`

/** The call's original backdrop (it stays CSS on the call; this is its picture in the scene picker). */
const MIDNIGHT = /* glsl */ `
vec3 scene(vec2 fc) {
  vec2 uv = fc / uRes;
  vec2 p = (fc - 0.5 * uRes) / uRes.y;
  float aspect = uRes.x / uRes.y;
  float t = uTime;
  vec3 col = mix(vec3(0.012, 0.024, 0.039), vec3(0.020, 0.035, 0.055), uv.y);
  col += uB * 0.22 * (1.0 - smoothstep(0.0, 1.0, length((uv - vec2(0.5, 0.58)) / vec2(0.7, 0.55))));
  col += uA * 0.14 * (1.0 - smoothstep(0.0, 1.0, length((uv - vec2(0.5, -0.2)) / vec2(0.9, 0.7))));
  float m = max(aspect, 1.0);
  vec2 a = vec2(-0.5 * aspect + 0.1 * sin(t * 0.39), 0.42 + 0.07 * cos(t * 0.33));
  vec2 b = vec2(0.5 * aspect + 0.09 * cos(t * 0.31), -0.45 + 0.08 * sin(t * 0.29));
  col += uA * 0.26 * exp(-pow(length(p - a) / (0.45 * m), 2.0));
  col += uB * 0.24 * exp(-pow(length(p - b) / (0.42 * m), 2.0));
  col += stars(p + vec2(t * 0.004, t * 0.008), t, 0.12) * 0.5 * smoothstep(0.15, 0.6, length(p * vec2(1.0, 1.2)));
  return col;
}
`

/** Underwater in the pool, drawn like a cartoon: the bright wobbling surface overhead, flat beams of light swaying
 *  down, cel-shaded caustics wriggling on the floor, and bubbles rising. */
const DEEP_END = /* glsl */ `${TOON}
vec3 scene(vec2 fc) {
  vec2 p = (fc - 0.5 * uRes) / uRes.y;
  PX = 1.0 / uRes.y;
  float aspect = uRes.x / uRes.y;
  float t = uTime;
  float v = voice();
  // The water: bright just under the surface, deepening to blue at the floor.
  vec3 col = mix(vec3(0.03, 0.30, 0.52), vec3(0.08, 0.62, 0.74), smoothstep(-0.3, 0.32, p.y));
  col = mix(col, vec3(0.32, 0.86, 0.86), smoothstep(0.18, 0.34, p.y) * 0.6);

  // The floor running away from us: flat tiles of light, the lane line, and caustics wriggling across it.
  float far = -0.1;
  if (p.y < far) {
    float z = 0.2 / (far - p.y);
    vec2 g = vec2(p.x * z, z);
    vec3 floorCol = mix(vec3(0.16, 0.66, 0.76), vec3(0.06, 0.42, 0.62), smoothstep(1.0, 5.0, z));
    float lane = fill(abs(g.x) - 0.07 - z * PX * 1.5);
    floorCol = mix(floorCol, vec3(0.05, 0.27, 0.5), lane * (1.0 - smoothstep(4.0, 9.0, z) * 0.7));
    float aa = (z * z / 0.2 + z) * PX * 3.2;
    float c = toonCaustic(g * 3.2, t * 0.9, (0.035 + v * 0.02) * clamp(z * 0.8, 0.5, 1.6), aa);
    floorCol += vec3(0.75, 1.0, 1.0) * c * (0.55 - smoothstep(2.0, 8.0, z) * 0.4);
    col = mix(floorCol, col, smoothstep(2.5, 9.0, z));
  }

  // The surface overhead: a bright band with its edge wobbling, caustics dancing in it.
  float wave = 0.335 + 0.011 * sin(p.x * 9.0 + t * 1.4) + 0.006 * sin(p.x * 17.0 - t * 2.1) + 0.004 * v * sin(p.x * 31.0 + t * 6.0);
  float above = fill(wave - p.y);
  vec3 surface = mix(vec3(0.55, 0.94, 0.92), vec3(0.86, 1.0, 0.98), smoothstep(wave, wave + 0.15, p.y));
  surface += vec3(1.0) * toonCaustic(vec2(p.x * 7.0, (p.y - wave) * 16.0 + t * 0.2), t * 0.8, 0.06, PX * 16.0) * 0.45;
  col = mix(col, surface, above);
  col = mix(col, vec3(1.0), outline(p.y - wave + 0.004, 0.0025) * 0.9);

  // Beams of light from up to the left: flat, see-through, swaying.
  vec2 source = vec2(-0.25 * aspect, 0.9);
  vec2 ray = p - source;
  float ang = atan(ray.x, -ray.y);
  float beams = 0.0;
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float centre = -0.08 + fi * 0.13 * min(aspect, 1.6) + 0.025 * sin(t * (0.3 + fi * 0.07) + fi * 2.0);
    float width = 0.018 + 0.012 * hash11(fi + 3.0);
    beams += (1.0 - smoothstep(width - PX * 3.0, width + PX * 3.0, abs(ang - centre))) * (0.5 + 0.5 * hash11(fi + 9.0));
  }
  col += vec3(0.85, 1.0, 1.0) * beams * (0.07 + v * 0.06) * smoothstep(-0.45, 0.3, p.y) * (1.0 - above);

  // Bubbles rising all through the water.
  for (int l = 0; l < 2; l++) {
    float fl = float(l);
    float sc = 6.0 + fl * 5.0;
    vec2 q = p * sc;
    q.y -= t * (0.6 - fl * 0.2);
    vec2 id = floor(q);
    float h = hash12(id + fl * 13.0);
    if (h < 0.18) {
      vec2 c = (hash22(id + 7.0) - 0.5) * 0.4 + vec2(0.12 * sin(t * 1.7 + h * 60.0), 0.0);
      vec2 b = bubble((fract(q) - 0.5 - c) / sc, (0.06 + 0.1 * fract(h * 37.0)) / sc) * (1.0 - above);
      col = mix(col, vec3(0.85, 1.0, 1.0), clamp(b.x * (0.7 - fl * 0.25) + b.y * (1.0 - fl * 0.4), 0.0, 1.0));
    }
  }
  return col;
}
`

/** A bright day at sea, drawn like a cartoon: puffy clouds drifting, the sun, a little island, wave marks glinting, a
 *  buoy bobbing, gulls wheeling overhead, and a pod of dolphins: fins cutting the water as they cruise, then leaping
 *  clear in turn, arching over and splashing back in. */
const OPEN_WATER = /* glsl */ `${TOON}
float taper(vec2 p, vec2 a, vec2 b, float ra, float rb) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - mix(ra, rb, h);
}
// A dolphin from the side, nose toward +x, about a unit long, arched by flex, its tail beating by beat: how far q is
// outside it. parts: x its pale belly, y its flipper, z the shine along its back (each below 0 inside).
float dolphin(vec2 q, float flex, float beat, out vec3 parts) {
  q.y += flex * q.x * q.x;
  float tail = max(-q.x - 0.1, 0.0);
  q.y -= beat * tail * tail * 1.8;
  float d = (length((q - vec2(0.02, 0.0)) / vec2(0.36, 0.105)) - 1.0) * 0.1;
  d = smin(d, length(q - vec2(0.29, 0.022)) - 0.074, 0.05);
  d = smin(d, taper(q, vec2(0.33, -0.012), vec2(0.5, -0.03), 0.04, 0.019), 0.03);
  d = smin(d, taper(q, vec2(-0.14, 0.0), vec2(-0.5, 0.004), 0.085, 0.021), 0.05);
  // The flukes, swept back, and the fin on its back, curving back too.
  float flukes = min(taper(q, vec2(-0.49, 0.004), vec2(-0.63, 0.085), 0.027, 0.007), taper(q, vec2(-0.49, 0.004), vec2(-0.63, -0.075), 0.027, 0.007));
  d = smin(d, flukes, 0.02);
  float fin = min(taper(q, vec2(0.05, 0.08), vec2(-0.06, 0.17), 0.045, 0.02), taper(q, vec2(-0.06, 0.17), vec2(-0.135, 0.205), 0.02, 0.005));
  d = smin(d, fin, 0.025);
  parts.x = q.y - (-0.024 - 0.055 * clamp(0.42 - q.x, 0.0, 0.85));
  parts.y = taper(q, vec2(0.17, -0.06), vec2(0.06, -0.165), 0.032, 0.009);
  parts.z = taper(q, vec2(0.24, 0.072), vec2(-0.12, 0.074), 0.012, 0.004);
  return d;
}
// Water thrown up where something broke the surface at "at", age seconds ago: a crown of sheets rising and falling, and
// drops flying out on arcs and dropping back.
float splash(vec2 p, vec2 at, float age, float size, float seed) {
  float s = 0.0;
  for (int i = 0; i < 8; i++) {
    float fi = float(i);
    float h1 = hash11(fi * 3.7 + seed);
    float h2 = hash11(fi * 1.9 + seed + 4.0);
    vec2 vel = vec2((h1 - 0.5) * 1.5, 1.1 + h2 * 1.1) * size * 2.3;
    vec2 pos = at + vel * age - vec2(0.0, 6.5 * size * age * age);
    float r = size * (0.02 + 0.02 * h2) * (1.0 - age);
    s = max(s, fill(length(p - pos) - r) * step(at.y, pos.y));
  }
  float rise = sin(PI * clamp(age / 0.6, 0.0, 1.0));
  vec2 q = (p - at) / size;
  float crown = min(min(taper(q, vec2(-0.07, 0.0), vec2(-0.16, 0.3 * rise), 0.06, 0.012), taper(q, vec2(0.07, 0.0), vec2(0.17, 0.26 * rise), 0.06, 0.012)),
    taper(q, vec2(0.0, 0.0), vec2(0.01, 0.4 * rise), 0.07, 0.014));
  s = max(s, fill(crown * size) * step(at.y - 0.002, p.y) * step(0.02, rise));
  return s * step(0.0, age) * step(age, 0.95);
}
// Rings spreading on the water from "at" after a splash, seen low across the sea: ellipses 3.6 times wider than deep,
// their lines measured on the screen so they're as fine at the ends as at the sides, fading as they spread.
float rings(vec2 p, vec2 at, float age, float size) {
  vec2 e = p - at;
  float across = length(e * vec2(1.0, 3.6));
  float grad = max(length(e * vec2(1.0, 12.96)) / max(across, 1e-5), 1.0);
  float r = 0.0;
  for (int j = 0; j < 3; j++) {
    float a = age - float(j) * 0.3;
    float rad = size * (0.14 + max(a, 0.0) * 0.42);
    r = max(r, outline((across - rad) / grad, max(size * 0.01, PX * 0.7)) * step(0.0, a) * (1.0 - smoothstep(0.3, 2.0, a)));
  }
  return r;
}
// Where one of the pod is at time t. It crosses the sea from left to right (W across, starting "offset" seconds into
// the clock), cruising at "cruise" a second just under the surface, its fin cutting through every few seconds, and
// leaping clear twice, either side of the middle about "spread" from it (a little different each crossing): diving to
// build speed, then flying "reach" in the air. A crossing takes as long as that needs, then it waits off to the right
// for "rest" seconds and starts again. shift moves its whole path along. pose: where it is (xy), how it is turned (z)
// and how arched (w); motion: x its tail beat, y how far through a leap (0-1, or -1 cruising); events: where it last
// left the water and how long ago, then where it last went back in and how long ago.
void podState(float t, float size, float rest, float offset, float cruise, float reach, float spread, float W,
              float shift, float waterY, out vec4 pose, out vec2 motion, out vec4 events) {
  float air = 1.5;
  float period = (W - 2.0 * reach) / cruise + 2.0 * air + rest;
  float height = size * 1.05;
  float crossing = floor((t - offset) / period);
  float tau = t - offset - crossing * period;
  // Far enough apart that the second leap starts after the first has landed.
  float apart = max(spread * (0.85 + 0.3 * hash11(crossing * 7.31 + 2.0)), reach * 0.55);
  float a1 = -apart - reach * 0.5;
  float a2 = apart - reach * 0.5;
  float t1 = (a1 + W * 0.5) / cruise;
  float t2 = t1 + air + (a2 - a1 - reach) / cruise;
  float k1 = clamp((tau - t1) / air, 0.0, 1.0);
  float k2 = clamp((tau - t2) / air, 0.0, 1.0);
  float x = -W * 0.5 + cruise * (tau - air * (k1 + k2)) + reach * (k1 + k2);
  float in1 = step(t1, tau) * step(tau, t1 + air);
  float in2 = step(t2, tau) * step(tau, t2 + air);
  float inAir = max(in1, in2);
  float k = mix(k1, k2, in2);
  float swim = tau / 2.6 * TAU;
  float dive = max(smoothstep(t1 - 1.6, t1 - 0.2, tau) * (1.0 - step(t1, tau)), smoothstep(t2 - 1.6, t2 - 0.2, tau) * (1.0 - step(t2, tau)));
  // Under the water it never jumps from one pose to the next: in the last moments before a leap it rises from its dive
  // to the surface at the angle it leaves at, and after one it carries on down the way it went in, slowing, then levels
  // out (since: how long since it last went back in).
  float launch = max(smoothstep(t1 - 0.45, t1, tau) * (1.0 - step(t1, tau)), smoothstep(t2 - 0.45, t2, tau) * (1.0 - step(t2, tau)));
  float since = mix(mix(9.0, tau - t1 - air, step(t1 + air, tau)), tau - t2 - air, step(t2 + air, tau));
  float level = smoothstep(0.0, 0.8, since);
  float steep = atan(height * 4.0, reach);
  float plunge = waterY - size * (0.03 + 0.55 * (1.0 - exp(-since * 5.1)));
  float under = mix(plunge, waterY - size * (0.21 + 0.07 * cos(swim) + 0.22 * dive), smoothstep(0.15, 1.0, since));
  under = mix(under, waterY - size * 0.03, launch);
  float turned = mix(mix(-steep, 0.12 * sin(swim) + 0.55 * dive, level), steep, launch);
  float beat = mix(0.08 * sin(t * 4.5 + offset * 2.0) * (1.0 + dive * 2.0) * level, 0.35 * sin(t * 11.0), launch);
  float arc = waterY + height * 4.0 * k * (1.0 - k) - size * 0.03;
  pose.xy = vec2(x + shift, mix(under, arc, inAir));
  pose.z = mix(turned, atan(height * 4.0 * (1.0 - 2.0 * k), reach), inAir);
  pose.w = mix(mix(mix(0.34, 0.04, level), 0.34, launch), 0.34, inAir);
  motion.x = mix(beat, 0.35 * sin(t * 11.0) * (1.0 - smoothstep(0.0, 0.3, k)), inAir);
  motion.y = mix(-1.0, k, inAir);
  // The latest leap: where it left the water and how long ago, and where it went back in and how long ago.
  float second = step(t2, tau);
  float outAt = mix(a1, a2, second);
  float outAge = mix(tau - t1 + period * (1.0 - step(t1, tau)), tau - t2, second);
  events = vec4(outAt + shift, outAge, outAt + reach + shift, outAge - air);
}
// One dolphin of the pod (size big, its waterline at waterY): the dark shape it makes under the water, the drips it
// sheds in the air and the wake its fin leaves cutting the surface. shape: where p is in its own frame (xy), how far
// outside it p is (z) and its belly, flipper and shine (as dolphin() gives them).
vec3 dolphinWater(vec3 col, vec2 p, vec4 pose, vec2 motion, float size, float reach, float waterY, out vec3 shape, out vec3 parts) {
  vec2 q = rot(-pose.z) * (p - pose.xy) / size;
  // Its shape is only worked out close to it; further off, a circle round it stands in.
  float d = (length(q) - 0.72) * size;
  parts = vec3(1.0);
  if (d < size * 0.05) d = dolphin(q, pose.w, motion.x, parts) * size;
  shape = vec3(q, d);
  float dry = smoothstep(waterY - PX, waterY + PX, p.y);
  col = mix(col, mix(col, vec3(0.04, 0.24, 0.5), 0.5), fill(d) * (1.0 - dry));
  // Drips shed from its tail in the air, trailing behind and falling.
  float k = motion.y;
  float trail = (1.0 - fract(k * 5.0)) * 0.3;
  vec2 drop = pose.xy + rot(pose.z) * vec2(-0.56, 0.0) * size + vec2(-reach * 0.25 * trail, -6.0 * size * trail * trail);
  float drip = fill(length((p - drop) * vec2(1.0, 0.75)) - size * 0.017) + fill(length(p - drop - vec2(-0.02, -0.04) * size) - size * 0.011);
  col = mix(col, vec3(0.92, 0.98, 1.0), clamp(drip, 0.0, 1.0) * step(0.12, k) * step(waterY, drop.y));
  // Where its fin cuts the surface while cruising: foam at the fin and a wake of white trailing behind.
  vec2 finTip = pose.xy + rot(pose.z) * vec2(-0.1, 0.19) * size;
  float cut = smoothstep(waterY - size * 0.04, waterY + size * 0.06, finTip.y) * step(k, -0.5);
  float back = finTip.x - p.x;
  float wake = outline(abs(p.y - waterY) - back * 0.05 - size * 0.012, max(size * 0.007, PX * 0.6)) * step(0.0, back) * (1.0 - smoothstep(0.0, size * 1.4, back));
  col = mix(col, vec3(0.93, 0.98, 1.0), wake * cut * 0.85);
  return mix(col, vec3(0.95, 0.99, 1.0), fill(length((p - vec2(finTip.x + size * 0.04, waterY)) * vec2(1.0, 2.6)) - size * 0.05) * cut);
}
// A dolphin above the water, drawn in full: outlined, with a pale belly, a flipper, a shine along its back and a
// bright eye. Only where it's out of the water (above waterY).
vec3 dolphinSkin(vec3 col, vec2 p, vec3 shape, vec3 parts, float size, float waterY) {
  vec2 q = shape.xy;
  float d = shape.z;
  float dry = smoothstep(waterY - PX, waterY + PX, p.y);
  float edge = max(size * 0.014, PX * 1.3);
  vec3 skin = mix(vec3(0.3, 0.53, 0.8), vec3(0.45, 0.68, 0.93), smoothstep(-0.05, 0.09, q.y));
  skin = mix(skin, vec3(0.88, 0.95, 1.0), fill(parts.x * size));
  skin = mix(skin, vec3(0.86, 0.95, 1.0), fill(parts.z * size) * 0.75);
  skin = mix(skin, vec3(0.06, 0.16, 0.3), fill(parts.y * size - edge * 0.7));
  skin = mix(skin, vec3(0.24, 0.44, 0.72), fill(parts.y * size));
  skin = mix(skin, vec3(0.04, 0.08, 0.16), fill(length(q - vec2(0.335, 0.014)) * size - size * 0.014));
  skin = mix(skin, vec3(1.0), fill(length(q - vec2(0.341, 0.02)) * size - size * 0.0045));
  skin = mix(skin, vec3(0.1, 0.22, 0.38), fill(taper(q, vec2(0.38, -0.024), vec2(0.485, -0.035), 0.0035, 0.0025) * size));
  col = mix(col, vec3(0.06, 0.16, 0.3), fill(d - edge) * dry);
  return mix(col, skin, fill(d) * dry);
}
// The splash (where, how long ago, how big) nearer p of two, counting only ones under a second old.
vec4 nearer(vec4 best, inout float bestD, vec4 other, vec2 p) {
  float d = length(p - other.xy) + step(0.48, abs(other.z - 0.475)) * 9.0;
  float take = step(d, bestD);
  bestD = mix(bestD, d, take);
  return mix(best, other, take);
}
// A gull seen from in front as it flies across, s across: wings in two joints that flap (with glides between bursts),
// the outer half trailing the inner, dark tips, a yellow beak; it bobs against its wingbeat.
vec3 gull(vec3 col, vec2 p, vec2 at, float s, float t, float seed) {
  float flap = smoothstep(-0.3, 0.3, sin(t * 0.45 + seed * 3.0));
  float phase = t * 7.0 + seed * 5.0;
  at.y -= 0.06 * s * sin(phase) * flap;
  vec2 q = (p - at) / s;
  q.x = abs(q.x);
  float a1 = 0.18 + 0.6 * sin(phase) * flap;
  float a2 = a1 - 0.3 - 0.55 * sin(phase - 1.2) * flap;
  vec2 shoulder = vec2(0.05, 0.02);
  vec2 wrist = shoulder + 0.36 * vec2(cos(a1), sin(a1));
  vec2 tip = wrist + 0.42 * vec2(cos(a2), sin(a2));
  float inner = taper(q, shoulder, wrist, 0.1, 0.07);
  float outer = taper(q, wrist, tip, 0.07, 0.018);
  float body = length(q / vec2(0.1, 0.14)) * 0.1 - 0.1;
  float head = length(q - vec2(0.0, 0.12)) - 0.07;
  float bird = min(min(inner, outer), min(body, head));
  vec2 b = vec2(q.x, q.y - 0.08);
  float beak = max(abs(b.x) - 0.022 * (1.0 + b.y / 0.04), max(b.y, -b.y - 0.045));
  float px = PX / s;
  col = mix(col, vec3(0.22, 0.3, 0.42), 1.0 - smoothstep(-px, px, bird - 0.03));
  vec3 feathers = mix(vec3(0.97, 0.98, 1.0), vec3(0.75, 0.8, 0.88), smoothstep(0.0, 0.05, q.y - (wrist.y - 0.02)) * step(shoulder.x + 0.05, q.x));
  feathers = mix(feathers, vec3(0.12, 0.14, 0.2), 1.0 - smoothstep(-px, px, length(q - tip) - 0.13));
  col = mix(col, feathers, 1.0 - smoothstep(-px, px, bird));
  col = mix(col, vec3(1.0, 0.75, 0.2), 1.0 - smoothstep(-px, px, beak));
  return mix(col, vec3(0.1, 0.12, 0.18), 1.0 - smoothstep(-px, px, length(q - vec2(0.03, 0.135)) - 0.014));
}
// A cloud drifting across in two tones: the sky's colour with it laid over.
vec3 drifting(vec3 col, vec2 p, float i, float wide, float aspect, float t) {
  float drift = max(1.4 * wide, aspect) + 0.6;
  vec2 at = vec2(mod((i - 1.0) * 0.55 * wide + t * (0.012 + i * 0.004) + drift * 0.5, drift) - drift * 0.5, 0.13 + 0.12 * fract(i * 0.618 + 0.2));
  float s = 0.28 - i * 0.05;
  col = mix(col, vec3(0.8, 0.88, 0.97), fill(cloud(p - at + vec2(0.0, 0.015 * s), s)));
  return mix(col, vec3(1.0), fill(cloud(p - at, s) + 0.02 * s));
}
vec3 scene(vec2 fc) {
  vec2 p = (fc - 0.5 * uRes) / uRes.y;
  PX = 1.0 / uRes.y;
  float aspect = uRes.x / uRes.y;
  float wide = min(aspect, 1.7);
  float t = uTime;
  float v = voice();
  float hor = -0.04;
  vec3 col;
  if (p.y > hor) {
    // The sky, the sun with its rings of glow, clouds drifting by in two tones.
    col = mix(vec3(0.74, 0.91, 1.0), vec3(0.27, 0.62, 0.95), smoothstep(hor, 0.5, p.y));
    vec2 sun = vec2(0.3 * wide, 0.3);
    float sd = length(p - sun);
    col = mix(col, mix(col, vec3(1.0, 0.97, 0.8), 0.25), fill(sd - 0.16 - 0.006 * sin(t * 1.5)));
    col = mix(col, mix(col, vec3(1.0, 0.95, 0.7), 0.4), fill(sd - 0.11 - 0.004 * sin(t * 1.5 + 1.0)));
    col = mix(col, vec3(1.0, 0.9, 0.45), fill(sd - 0.07));
    col = drifting(drifting(drifting(col, p, 0.0, wide, aspect, t), p, 1.0, wide, aspect, t), p, 2.0, wide, aspect, t);
    // A little island on the horizon with its palm.
    vec2 isl = p - vec2(-0.32 * wide, hor);
    float hill = length(isl / vec2(1.0, 0.45)) * 0.45 - 0.045;
    float trunk = segment(isl, vec2(0.005, 0.015), vec2(0.02, 0.086)) - 0.0028;
    float leaves = palmCrown((isl - vec2(0.02, 0.088)) / 0.2, 0.07 * sin(t * 1.3)) * 0.2;
    col = mix(col, vec3(0.18, 0.62, 0.55), fill(min(min(hill, trunk), leaves)));
  } else {
    // The sea: lighter at the horizon, deeper close to us.
    float down = hor - p.y;
    float z = 0.5 / down;
    col = mix(vec3(0.33, 0.72, 0.9), vec3(0.08, 0.42, 0.75), smoothstep(0.0, 0.45, down));
    // Wave marks: little arched strokes in rows, drifting and bobbing, smaller with distance.
    float row = floor(z * 1.5);
    float rz = (row + 0.5) / 1.5;
    float ry = hor - 0.5 / rz;
    float across = p.x * rz * 1.2 + t * 0.05 * (mod(row, 2.0) < 1.0 ? 1.0 : -1.0) + hash11(row) * 5.0;
    float cell = floor(across);
    float w = (fract(across) - 0.5) / 0.18;
    float archY = ry + 0.004 * sin(t * 1.8 + cell * 2.0 + row) + (0.014 / rz) * (1.0 - w * w);
    float mark = outline(p.y - archY, max(0.005 / rz, PX * 0.7)) * (1.0 - smoothstep(0.75, 1.0, abs(w)))
      * step(hash12(vec2(cell, row)), 0.6) * (1.0 - smoothstep(5.0, 30.0, z));
    col = mix(col, vec3(0.9, 0.97, 1.0), mark * 0.9);
    // The sun's path: twinkles flashing on the water under it.
    vec2 sq = vec2(p.x * rz * 4.0, row);
    vec2 sid = floor(sq);
    float flash = pow(0.5 + 0.5 * sin(t * (2.0 + 2.0 * hash12(sid)) + hash12(sid + 4.0) * 30.0), 6.0);
    float onPath = 1.0 - smoothstep(0.02, 0.06 + down * 0.25, abs(p.x - 0.3 * wide));
    vec2 sl = vec2((fract(sq.x) - 0.5) / (rz * 4.0), p.y - ry);
    col = mix(col, mix(col, vec3(0.75, 0.93, 1.0), 0.35), onPath);
    col = mix(col, vec3(1.0, 0.97, 0.8), twinkle(sl, max((0.02 + v * 0.01) / rz, PX * 4.0)) * flash * onPath);
    col = mix(col, vec3(0.96, 0.99, 1.0), outline(p.y - hor + 0.002, 0.0015) * 0.6);
    // A buoy bobbing on the left, red and white, with its ripple.
    vec2 buoy = p - vec2(-0.5 * wide + mix(0.05, 0.12, smoothstep(0.6, 1.2, aspect)), hor - 0.12 + 0.008 * sin(t * 1.4));
    float body = sdBox(buoy - vec2(0.0, 0.03), vec2(0.02, 0.03)) - 0.008;
    float stripe = step(0.5, fract(buoy.y / 0.024));
    col = mix(col, vec3(0.95, 0.97, 1.0), outline(length(buoy * vec2(0.45, 1.6)) - 0.02, 0.0025) * (0.6 + 0.4 * sin(t * 1.4)));
    col = mix(col, mix(vec3(0.95, 0.25, 0.25), vec3(1.0), stripe), fill(body) * step(-0.004, buoy.y));
    col = mix(col, vec3(1.0, 0.85, 0.3), fill(length(buoy - vec2(0.0, 0.075)) - 0.008));
  }
  // The pod, far to near: a small one far out, and a pair close in that leap side by side. On a narrow screen they're
  // smaller and leap shorter, so a leap stays in view.
  float k = clamp(aspect * 1.3, 0.62, 1.0);
  float W = aspect + 0.5 * k;
  float reachC = min(0.24 * k, 0.4 * aspect);
  float reachAB = min(0.5 * k, 0.48 * aspect);
  float sA = 0.2 * k;
  float sB = 0.15 * k;
  float sC = 0.085 * k;
  vec4 poseC; vec2 motionC; vec4 eventsC;
  vec4 poseB; vec2 motionB; vec4 eventsB;
  vec4 poseA; vec2 motionA; vec4 eventsA;
  float wC = hor - 0.075;
  float wB = hor - 0.15;
  float wA = hor - 0.235;
  podState(t, sC, 4.0, 21.0, 0.05 * k, reachC, 0.275 * aspect, W, 0.0, wC, poseC, motionC, eventsC);
  podState(t, sB, 2.5, 0.3, 0.07 * k, reachAB, 0.225 * aspect, W, 0.1 * k * smoothstep(0.6, 1.2, aspect), wB, poseB, motionB, eventsB);
  podState(t, sA, 2.5, 0.0, 0.07 * k, reachAB, 0.225 * aspect, W, 0.0, wA, poseA, motionA, eventsA);
  vec3 shapeA; vec3 partsA;
  vec3 shapeB; vec3 partsB;
  vec3 shapeC; vec3 partsC;
  col = dolphinWater(col, p, poseC, motionC, sC, reachC, wC, shapeC, partsC);
  col = dolphinWater(col, p, poseB, motionB, sB, reachAB, wB, shapeB, partsB);
  col = dolphinWater(col, p, poseA, motionA, sA, reachAB, wA, shapeA, partsA);
  // Each pixel shades only the nearest dolphin over it (the near pair in front of the far one), with its outline.
  float onB = step(shapeB.z, 0.014 * sB + PX * 1.5);
  float onA = step(shapeA.z, 0.014 * sA + PX * 1.5);
  vec3 shape = mix(mix(shapeC, shapeB, onB), shapeA, onA);
  vec3 parts = mix(mix(partsC, partsB, onB), partsA, onA);
  float size = mix(mix(sC, sB, onB), sA, onA);
  float waterY = mix(mix(wC, wB, onB), wA, onA);
  col = dolphinSkin(col, p, shape, parts, size, waterY);
  // Rings spreading where each broke the surface, and the splash nearest this pixel (its crown and flying drops).
  float ring = max(max(rings(p, vec2(eventsA.x, wA), eventsA.y, sA), rings(p, vec2(eventsA.z, wA), eventsA.w, sA * 1.2)),
               max(max(rings(p, vec2(eventsB.x, wB), eventsB.y, sB), rings(p, vec2(eventsB.z, wB), eventsB.w, sB * 1.2)),
                   max(rings(p, vec2(eventsC.x, wC), eventsC.y, sC), rings(p, vec2(eventsC.z, wC), eventsC.w, sC * 1.2))));
  col = mix(col, vec3(0.9, 0.97, 1.0), ring * 0.8 * step(p.y, hor));
  vec4 best = vec4(eventsA.x, wA, eventsA.y, sA);
  float bestD = length(p - best.xy) + step(0.48, abs(best.z - 0.475)) * 9.0;
  best = nearer(best, bestD, vec4(eventsA.z, wA, eventsA.w, sA * 1.2), p);
  best = nearer(best, bestD, vec4(eventsB.x, wB, eventsB.y, sB), p);
  best = nearer(best, bestD, vec4(eventsB.z, wB, eventsB.w, sB * 1.2), p);
  best = nearer(best, bestD, vec4(eventsC.x, wC, eventsC.y, sC), p);
  best = nearer(best, bestD, vec4(eventsC.z, wC, eventsC.w, sC * 1.2), p);
  col = mix(col, vec3(1.0), splash(p, best.xy, best.z, best.w, best.x * 13.0));
  // Gulls wheeling over: two close, one far, drifting across on the breeze.
  float sky = 1.6 * max(aspect, 0.8) + 0.6;
  vec2 g1 = vec2(mod(t * 0.035 + 0.2, sky) - sky * 0.5, 0.33 + 0.03 * sin(t * 0.4));
  vec2 g2 = vec2(mod(t * 0.03 + 0.9, sky) - sky * 0.5, 0.25 + 0.025 * sin(t * 0.33 + 2.0));
  vec2 g3 = vec2(mod(-t * 0.018 + 1.4, sky) - sky * 0.5, 0.18 + 0.01 * sin(t * 0.5));
  // Each pixel draws the gull nearest it.
  float n2 = step(length(p - g2) / 0.085, length(p - g1) / 0.11);
  vec3 g = mix(vec3(g1, 0.11), vec3(g2, 0.085), n2);
  float seed = n2;
  float n3 = step(length(p - g3) / 0.05, length(p - g.xy) / g.z);
  g = mix(g, vec3(g3, 0.05), n3);
  seed = mix(seed, 2.0, n3);
  return gull(col, p, g.xy, g.z, t, seed);
}
`

/** The northern lights drawn like a poster: ribbons of aurora flowing over layered mountains that fade into the
 *  distance, a pine shore with a lit cabin, and all of it mirrored in a still lake that ripples now and then. */
const NORTHERN_LIGHTS = /* glsl */ `${TOON}
// A mountain range's height at x: sharp peaks and gentler shoulders.
float range(float x, float seed, float height) {
  float a = 1.0 - abs(sin(x * 2.2 + seed));
  float b = 1.0 - abs(sin(x * 4.7 + seed * 2.3));
  return height * (0.55 * a * a + 0.3 * b * b + 0.15 * sin(x * 9.0 + seed * 5.0) * 0.5);
}
// A ribbon of aurora: bright along its lower edge, fading up, in curtains that shimmer.
vec3 ribbon(vec2 p, float base, float speed, float seed, float t, float v) {
  float x = p.x;
  float edge = base + 0.07 * sin(x * 2.1 + t * speed + seed) + 0.03 * sin(x * 5.3 - t * speed * 1.4 + seed * 2.0);
  float up = p.y - edge;
  float body = smoothstep(-0.03, 0.004, up) * exp(-max(up, 0.0) * (7.0 - v * 2.5)) + exp(-abs(up) / 0.004) * 0.6;
  float curtains = 0.65 + 0.35 * sin(x * 38.0 + sin(x * 3.0 + t * 0.4 + seed) * 4.0 + t * 0.6);
  vec3 c = mix(vec3(0.25, 1.0, 0.6), vec3(0.6, 0.4, 1.0), smoothstep(0.0, 0.18, up));
  c = mix(c, vec3(1.0, 0.45, 0.75), smoothstep(0.12, 0.3, up) * 0.6);
  return c * body * curtains * (0.75 + 0.25 * sin(x * 1.3 - t * 0.9 + seed));
}
vec3 world(vec2 p, float t, float v, float wide) {
  // The sky, its stars and the aurora.
  vec3 col = mix(vec3(0.1, 0.17, 0.33), vec3(0.02, 0.03, 0.1), smoothstep(-0.05, 0.5, p.y));
  vec2 sq = p * 50.0;
  vec2 sid = floor(sq);
  float sh = hash12(sid);
  vec2 so = (fract(sq) - 0.5 - (hash22(sid + 3.0) - 0.5) * 0.6) / 50.0;
  float shine = 0.55 + 0.45 * sin(t * (1.0 + sh * 5.0) + sh * 40.0);
  col += vec3(0.8, 0.9, 1.0) * fill(length(so) - PX * (0.5 + sh * 1.3)) * step(sh, 0.14) * shine;
  col += ribbon(p, 0.16, 0.25, 0.0, t, v) * 0.9;
  col += ribbon(p, 0.27, 0.18, 2.4, t, v) * 0.55;
  // Three ranges of mountains, nearer ones darker, the far ones hazy blue with snow on their peaks. A narrow screen
  // shows fewer of them rather than squeezing them thin.
  float x = p.x * 1.6 / max(wide, 0.9);
  vec3 haze = vec3(0.16, 0.24, 0.42);
  float r1 = range(x + 0.3, 1.0, 0.24);
  col = mix(col, mix(haze, vec3(0.3, 0.36, 0.55), 0.3), fill(p.y - r1));
  float snowline = 0.12 + 0.008 * sin(x * 31.0) + 0.005 * sin(x * 67.0 + 1.0);
  col = mix(col, vec3(0.6, 0.68, 0.88), fill(p.y - r1) * fill(snowline - p.y));
  float r2 = -0.02 + range(x * 1.3 + 2.0, 4.0, 0.2);
  col = mix(col, vec3(0.13, 0.18, 0.33), fill(p.y - r2));
  float r3 = -0.05 + range(x * 1.7 + 5.0, 7.0, 0.12);
  col = mix(col, vec3(0.08, 0.12, 0.24), fill(p.y - r3));
  // The near shore: a dark band of pines, and a cabin with its window lit.
  float shore = -0.085 + 0.012 * sin(x * 3.0 + 1.0);
  float cell = floor(p.x / 0.022);
  float lx = (fract(p.x / 0.022) - 0.5) * 0.022;
  float tall = 0.03 + 0.03 * hash11(cell);
  float pine = max(abs(lx) - (shore + tall - p.y) * 0.28, p.y - shore - tall);
  vec3 dark = vec3(0.03, 0.05, 0.11);
  col = mix(col, dark, fill(min(p.y - shore, pine)));
  vec2 cabin = p - vec2(-0.22 * wide, shore + 0.004);
  float house = sdBox(cabin - vec2(0.0, 0.013), vec2(0.02, 0.013));
  float roof = max(abs(cabin.x) * 0.75 + cabin.y - 0.04, -cabin.y + 0.022);
  col = mix(col, dark, fill(min(house, roof)));
  float window = sdBox(cabin - vec2(0.006, 0.012), vec2(0.005, 0.0045));
  col = mix(col, vec3(1.0, 0.75, 0.35), fill(window));
  col += vec3(1.0, 0.6, 0.25) * exp(-length(cabin - vec2(0.006, 0.012)) / 0.02) * 0.25;
  return col;
}
vec3 scene(vec2 fc) {
  vec2 p = (fc - 0.5 * uRes) / uRes.y;
  PX = 1.0 / uRes.y;
  float aspect = uRes.x / uRes.y;
  float t = uTime;
  float v = voice();
  float wide = min(aspect, 1.6);
  float lake = -0.095;
  // Below the shore the lake mirrors everything, a ripple running through it now and then.
  float below = step(p.y, lake);
  float wobble = 0.004 * sin((lake - p.y) * 160.0 - t * 2.0) * smoothstep(0.0, 0.2, lake - p.y);
  vec2 at = mix(p, vec2(p.x + wobble, 2.0 * lake - p.y), below);
  vec3 col = world(at, t, v, wide);
  if (below > 0.5) {
    col = mix(col * 0.55, vec3(0.03, 0.06, 0.14), smoothstep(0.0, 0.45, lake - p.y) * 0.6);
    // Bright ripple lines catching the aurora.
    float rowAt = (lake - p.y) * 30.0;
    float row = floor(rowAt);
    float dash = step(0.55, fract(p.x * (2.0 + 6.0 * hash11(row)) + t * 0.04 * (hash11(row + 3.0) - 0.5) + hash11(row + 7.0)));
    float lines = outline((fract(rowAt) - 0.5) / 30.0, 0.0012) * dash * 0.22;
    col += vec3(0.45, 0.95, 0.8) * lines * smoothstep(0.0, 0.06, lake - p.y);
    col = mix(col, vec3(0.7, 0.85, 1.0), outline(p.y - lake + 0.0015, 0.001) * 0.4);
  }
  return col;
}
`

/** Space drawn like a poster: a ringed planet banded in the coach's colours turning slowly, a moon orbiting it, a
 *  little cratered world, soft clouds of nebula, twinkling stars and a comet now and then. */
const NEBULA = /* glsl */ `${TOON}
// The colour of the planet's nth band.
vec3 bandColour(float n) {
  float m = mod(n, 3.0);
  return m < 1.0 ? uA : m < 2.0 ? mix(uA, uB, 0.5) : mix(uB, vec3(1.0, 0.9, 0.8), 0.3);
}
vec3 scene(vec2 fc) {
  vec2 p = (fc - 0.5 * uRes) / uRes.y;
  PX = 1.0 / uRes.y;
  float aspect = uRes.x / uRes.y;
  float wide = min(aspect, 1.6);
  float t = uTime;
  float v = voice();
  // Deep space, and nebula in soft flat steps of the coach's colours.
  vec3 col = mix(vec3(0.05, 0.03, 0.13), vec3(0.01, 0.01, 0.05), length(p * vec2(0.7, 1.0)));
  float cloud = fbm3(p * 2.2 + vec2(t * 0.01, -t * 0.006) + 3.0);
  vec3 tintA = mix(vec3(0.42, 0.2, 0.85), uA, 0.3) * 0.42;
  vec3 tintB = mix(vec3(0.9, 0.28, 0.65), uB, 0.25) * 0.45;
  col = mix(col, tintA, smoothstep(0.48, 0.5, cloud) * 0.7);
  col = mix(col, tintB, smoothstep(0.6, 0.62, cloud) * 0.7);
  col = mix(col, mix(tintB, vec3(1.0, 0.85, 0.95), 0.35), smoothstep(0.7, 0.72, cloud) * 0.6);
  // Stars: dots, and now and then a bright four-pointed one.
  vec2 sq = p * 40.0;
  vec2 sid = floor(sq);
  float sh = hash12(sid);
  vec2 so = (fract(sq) - 0.5 - (hash22(sid + 3.0) - 0.5) * 0.6) / 40.0;
  float shine = 0.55 + 0.45 * sin(t * (0.8 + sh * 4.0) + sh * 50.0);
  col += vec3(0.85, 0.9, 1.0) * fill(length(so) - PX * (0.6 + sh * 1.4)) * step(sh, 0.16) * shine;
  vec2 middle = (fract(sq) - 0.5) / 40.0;
  col += vec3(1.0, 0.95, 0.85) * twinkle(middle, 0.014 * (0.6 + 0.4 * shine) * (1.0 + v * 0.5)) * step(sh, 0.025);
  // A comet crossing every twenty seconds, in from beyond one edge and out past the other.
  float pass = mod(t, 20.0) / 20.0;
  float edgeX = 0.5 * aspect + 0.3;
  vec2 from = vec2(-edgeX, 0.42);
  vec2 to = vec2(edgeX, 0.02);
  vec2 head = mix(from, to, pass);
  vec2 dir = normalize(from - to);
  vec2 cr = p - head;
  float along = dot(cr, dir);
  float tailWidth = 0.004 * clamp(along / 0.2, 0.0, 1.0) + 0.001;
  float tail = fill(abs(dot(cr, vec2(-dir.y, dir.x))) - tailWidth) * step(0.0, along) * (1.0 - smoothstep(0.0, 0.22, along));
  col = mix(col, vec3(0.75, 0.9, 1.0), tail * 0.7);
  col = mix(col, vec3(1.0), fill(length(cr) - 0.005));

  // The ringed planet, low on the right (nearer the middle of a narrow screen, and smaller): bands turning, a shadow
  // over its far side, rings behind it and across its front.
  float side = smoothstep(0.6, 1.2, aspect);
  float S = mix(0.7, 1.0, side);
  vec2 planet = vec2(mix(0.08, 0.36 * wide, side), -0.2);
  float radius = 0.24;
  vec2 pp = (p - planet) / S;
  vec2 rp = rot(-0.35) * pp;
  // The rings: an ellipse 3.6 times flatter than wide, its edges and grooves measured on the screen so they stay smooth
  // where it's flattest. Shaded at the back, brightening round to the front.
  float ringR = length(rp * vec2(1.0, 3.6));
  float grad = max(length(rp * vec2(1.0, 12.96)) / max(ringR, 1e-4), 1.0) / S;
  float ring = fill((abs(ringR - 0.4) - 0.07) / grad);
  float grooveAA = 18.0 * grad * PX;
  ring *= 0.7 + 0.3 * smoothstep(-grooveAA, grooveAA, 0.25 - abs(fract(ringR * 18.0) - 0.5));
  vec3 ringCol = mix(vec3(0.95, 0.85, 0.7), mix(uA, vec3(1.0), 0.5), 0.35);
  ringCol *= mix(0.75, 1.0, smoothstep(-0.06, 0.06, -rp.y));
  col = mix(col, ringCol, ring);
  float body = (length(pp) - radius) * S;
  float lat = pp.y / radius + 0.25 * pp.x / radius;
  float bands = lat * 4.0 + 0.4 * sin(pp.x * 8.0 + t * 0.4 + lat * 3.0);
  float band = floor(bands);
  vec3 bandCol = mix(bandColour(band), bandColour(band + 1.0), smoothstep(1.0 - fwidth(bands), 1.0, fract(bands)));
  bandCol *= 0.85 + 0.15 * (1.0 + v);
  float lit = fill((length(pp - vec2(-0.08, 0.06)) - radius * 1.02) * S);
  bandCol = mix(bandCol * 0.45, bandCol, lit);
  bandCol = mix(bandCol, bandCol + 0.25, outline((length(pp - vec2(-0.01, 0.01)) - radius + 0.012) * S, 0.006 * S) * lit);
  col = mix(col, bandCol, fill(body));
  float front = ring * step(rp.y, 0.0);
  col = mix(col, ringCol, front);
  col = mix(col, ringCol * 0.55, front * fill((length(pp - vec2(0.02, -0.03)) - radius) * S) * 0.4);
  // Its moon, orbiting: in front on one side, hidden behind on the other.
  float orbit = t * 0.25;
  vec2 moonAt = planet + rot(-0.35) * vec2(cos(orbit) * 0.42, sin(orbit) * 0.42 / 3.6) * S;
  float inFront = step(0.0, sin(orbit) * -1.0);
  float moon = length(p - moonAt) - 0.028 * S;
  float shown = max(inFront, 1.0 - fill(body));
  vec3 moonCol = mix(vec3(0.45, 0.42, 0.55), vec3(0.88, 0.86, 0.95), fill(length(p - moonAt - vec2(-0.008, 0.008) * S) - 0.026 * S));
  col = mix(col, moonCol, fill(moon) * shown);
  // A little cratered world, up on the left.
  vec2 small = p - vec2(mix(-0.11, -0.4 * wide, side), 0.27);
  float sb = length(small) - 0.06;
  vec3 smallCol = mix(vec3(0.95, 0.55, 0.45), vec3(1.0, 0.75, 0.6), fill(length(small - vec2(-0.015, 0.015)) - 0.058));
  float craters = min(min(length(small - vec2(0.02, 0.01)) - 0.012, length(small - vec2(-0.02, -0.022)) - 0.008), length(small - vec2(-0.012, 0.03)) - 0.006);
  smallCol = mix(smallCol, smallCol * 0.75, fill(craters));
  col += vec3(1.0, 0.6, 0.5) * fill(sb - 0.02) * 0.06;
  col = mix(col, smallCol, fill(sb));
  return col;
}
`

/** Ribbons of silk drifting over a flowing wash of colour: a soft mesh gradient in the coach's colours, and see-through
 *  ribbons rippling across it, each with a shadow and a bright edge. */
const LIQUID_SILK = /* glsl */ `${TOON}
// A ribbon across the screen: where p is across its width (0 to 1 inside), wobbling along its length.
float ribbonAt(vec2 p, float tilt, float off, float width, float t, float seed) {
  vec2 q = rot(tilt) * p;
  float centre = off + 0.06 * sin(q.x * 2.4 + t * 0.35 + seed) + 0.03 * sin(q.x * 5.1 - t * 0.5 + seed * 2.0);
  float w = width * (0.75 + 0.25 * sin(q.x * 1.7 + t * 0.3 + seed * 3.0));
  return (q.y - centre) / w + 0.5;
}
vec3 scene(vec2 fc) {
  vec2 p = (fc - 0.5 * uRes) / uRes.y;
  PX = 1.0 / uRes.y;
  float t = uTime;
  float v = voice();
  // The wash: four pools of colour wandering, blended where they meet.
  vec3 c1 = uA;
  vec3 c2 = mix(uB, vec3(0.35, 0.2, 0.8), 0.45);
  vec3 c3 = vec3(0.95, 0.4, 0.7);
  vec3 c4 = vec3(0.08, 0.06, 0.22);
  float s = t * (0.12 + v * 0.06);
  vec2 a1 = vec2(sin(s * 0.9) * 0.6, cos(s * 0.7) * 0.3);
  vec2 a2 = vec2(cos(s * 0.6 + 2.0) * 0.6, sin(s * 0.8 + 1.0) * 0.35);
  vec2 a3 = vec2(sin(s * 0.5 + 4.0) * 0.5, cos(s * 1.1 + 3.0) * 0.3);
  vec2 a4 = vec2(cos(s * 0.4 + 5.0) * 0.7, sin(s * 0.6) * 0.4);
  vec2 wp = p + 0.08 * vec2(sin(p.y * 3.0 + s * 2.0), cos(p.x * 2.5 - s * 1.6));
  float w1 = 1.0 / (0.02 + dot(wp - a1, wp - a1));
  float w2 = 1.0 / (0.02 + dot(wp - a2, wp - a2));
  float w3 = 0.6 / (0.02 + dot(wp - a3, wp - a3));
  float w4 = 1.4 / (0.02 + dot(wp - a4, wp - a4));
  vec3 col = (c1 * w1 + c2 * w2 + c3 * w3 + c4 * w4) / (w1 + w2 + w3 + w4);
  col *= 0.7;
  // Three ribbons, back to front: a shadow under each, the ribbon see-through, its edges catching the light.
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float r = ribbonAt(p, -0.45 + fi * 0.32, -0.18 + fi * 0.17, 0.11 + fi * 0.02, t, fi * 2.7);
    float rs = ribbonAt(p + vec2(0.012, -0.018), -0.45 + fi * 0.32, -0.18 + fi * 0.17, 0.11 + fi * 0.02, t, fi * 2.7);
    float widthPx = 0.11 / PX;
    float inside = smoothstep(0.0, 1.5 / widthPx, r) * (1.0 - smoothstep(1.0 - 1.5 / widthPx, 1.0, r));
    float shadow = smoothstep(-0.1, 0.1, rs) * (1.0 - smoothstep(0.9, 1.1, rs));
    col *= 1.0 - shadow * 0.3;
    vec3 silk = mix(mix(uA, vec3(1.0), 0.35), mix(uB, vec3(1.0, 0.6, 0.85), 0.5), r);
    silk *= 0.75 + 0.35 * sin(r * PI);
    col = mix(col, silk, inside * 0.55);
    float across = clamp(r, 0.0, 1.0);
    col += vec3(1.0) * inside * (exp(-across / 0.04) + exp(-(1.0 - across) / 0.04)) * 0.35 * (1.0 + v);
    // A sheen sliding along it.
    float sweep = fract(dot(p, vec2(0.6, 0.3)) * 0.8 - t * 0.05 + fi * 0.33) - 0.5;
    col += vec3(1.0) * inside * exp(-sweep * sweep / 0.004) * 0.15;
  }
  // A fine still grain, like the weave of the silk.
  col *= 1.0 + (hash12(fc) - 0.5) * 0.025;
  return col;
}
`

/** Retro neon: a striped sunset behind the coach, wireframe mountains, shooting stars, and a glowing lane grid racing
 *  in with light trails streaking away down it. */
const NEON_LANES = /* glsl */ `
vec3 scene(vec2 fc) {
  vec2 p = (fc - 0.5 * uRes) / uRes.y;
  float t = uTime;
  float v = voice();
  float hor = 0.03;
  vec3 col;
  if (p.y >= hor) {
    float h = p.y - hor;
    col = mix(vec3(1.0, 0.24, 0.52), vec3(0.42, 0.06, 0.4), smoothstep(0.0, 0.18, h));
    col = mix(col, vec3(0.05, 0.015, 0.12), smoothstep(0.14, 0.5, h));
    col += stars(p, t, 0.1) * smoothstep(0.15, 0.4, h);
    // A shooting star every few seconds, pink-hot.
    float cycle = floor(t / 5.0);
    float shot = mod(t, 5.0);
    if (shot < 0.6) {
      vec2 a = vec2((hash11(cycle) - 0.5) * uRes.x / uRes.y * 0.9, 0.3 + 0.15 * hash11(cycle + 3.0));
      vec2 dir = normalize(vec2(hash11(cycle + 1.0) < 0.5 ? -0.9 : 0.9, -0.35));
      vec2 head = a + dir * shot * 0.6;
      float trail = exp(-pow(segment(p, head, head - dir * 0.12) / (0.0014 + 0.0006 * uScale), 2.0)) * (1.0 - smoothstep(0.0, 0.12, dot(p - head, -dir)));
      col += vec3(1.0, 0.55, 0.9) * trail * sin(shot / 0.6 * PI) * 1.3;
    }
    // The sun, cut by bars that sink toward the horizon (smaller on a narrow screen)
    vec2 c = vec2(0.0, hor + 0.15);
    float d = length(p - c);
    float r = 0.24 * min(1.0, uRes.x / uRes.y * 1.4);
    vec3 sunCol = mix(vec3(1.0, 0.22, 0.6), vec3(1.0, 0.86, 0.3), smoothstep(c.y - r, c.y + r * 0.7, p.y));
    float bars = p.y < c.y ? step(0.38 + (c.y - p.y) / r * 0.55, fract((p.y - t * 0.03) * 38.0)) : 0.0;
    float disc = (1.0 - smoothstep(r - 0.002, r + 0.002, d)) * (1.0 - bars);
    col += vec3(1.0, 0.3, 0.55) * exp(-max(d - r, 0.0) * 9.0) * 0.35 * (1.0 + v * 0.6);
    col = mix(col, sunCol, disc);
    // Mountains on either side, edged in neon
    float side = smoothstep(0.1, 0.42, abs(p.x));
    float peak = 1.0 - abs(noise(vec2(p.x * 5.0, 1.0)) * 2.0 - 1.0);
    float ridge = hor + side * (0.05 + 0.14 * peak * peak);
    float m = 1.0 - smoothstep(ridge - 0.0015, ridge + 0.0015, p.y);
    vec3 rock = vec3(0.07, 0.01, 0.12) + vec3(0.5, 0.05, 0.6) * smoothstep(0.75, 1.0, noise(vec2(p.x * 40.0, p.y * 40.0))) * 0.15;
    col = mix(col, rock, m * step(0.001, side));
    col += vec3(1.0, 0.2, 0.85) * exp(-abs(p.y - ridge) / (0.0025 + 0.001 * uScale)) * side * 0.8;
    col += vec3(1.0, 0.55, 0.85) * exp(-h / 0.006) * 0.8;
    return col;
  }
  float down = hor - p.y;
  float z = 0.25 / down;
  // On a narrow screen the lanes sit closer, so they run down the floor rather than straight off its sides.
  float narrow = clamp(uRes.x / uRes.y, 0.5, 1.0);
  float x = p.x * z / narrow;
  float px = z / narrow / uRes.y;
  float pz = z * z / 0.25 / uRes.y;
  col = vec3(0.04, 0.0, 0.07) + vec3(0.22, 0.02, 0.2) * exp(-down * 7.0);
  // The grid racing toward you
  float gz = abs(fract(z - t * 1.4) - 0.5);
  float gx = abs(fract(x) - 0.5);
  float lineZ = exp(-gz / (0.012 + pz * 1.5));
  float lineX = exp(-gx / (0.012 + px * 1.6));
  float fade = exp(-z * 0.04);
  // The lines either side of the middle lane are cyan, the rest of the grid pink
  float ours = 1.0 - step(0.25, abs(abs(x) - 0.5));
  vec3 pink = vec3(1.0, 0.18, 0.75);
  col += pink * (lineZ * 0.7 + lineX * 0.5 * (1.0 - ours)) * fade * (0.8 + v * 0.9);
  col += vec3(0.2, 0.95, 1.0) * lineX * ours * (0.85 + 0.25 * sin(z * 2.0 - t * 6.0)) * (0.9 + v * 0.8);
  // Light trails racing away down the outer lanes, each a white-hot head with its colour streaming behind.
  for (int j = 0; j < 2; j++) {
    float fj = float(j);
    float lx = fj < 0.5 ? -1.5 : 1.5;
    float headZ = mod(t * (7.0 + fj * 2.0) + fj * 23.0, 70.0) + 1.0;
    float behind = headZ - z;
    float lane = exp(-abs(x - lx) / (0.035 + px * 2.0));
    float halo = exp(-abs(x - lx) / (0.25 + px * 4.0)) * 0.25;
    float trail = (lane + halo) * step(0.0, behind) * exp(-behind * 0.1) * step(behind, 30.0);
    float head = (lane + halo) * exp(-abs(behind) / (0.1 + pz * 2.5));
    vec3 hue = fj < 0.5 ? vec3(0.2, 0.95, 1.0) : vec3(1.0, 0.3, 0.85);
    col += (hue * trail * 1.2 + vec3(1.0) * head * 2.5) * fade * (1.0 + v * 0.6);
  }
  // The sun reflected in the floor
  col += vec3(1.0, 0.35, 0.6) * exp(-p.x * p.x / 0.02) * exp(-down * 5.0) * 0.35;
  col = mix(col, vec3(0.45, 0.06, 0.4), exp(-down * 60.0) * 0.6);
  return col;
}
`

export const SCENE_SHADERS = {
  midnight: MIDNIGHT,
  "deep-end": DEEP_END,
  "open-water": OPEN_WATER,
  "northern-lights": NORTHERN_LIGHTS,
  nebula: NEBULA,
  "liquid-silk": LIQUID_SILK,
  "neon-lanes": NEON_LANES,
} as const
