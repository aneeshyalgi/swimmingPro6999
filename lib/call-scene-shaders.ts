/*
 * The voice call's scenes, as WebGL (GLSL ES 1.00) fragment shaders. Each scene is a `vec3 scene(vec2 fc)` that returns
 * the colour of the pixel at `fc` (drawing-buffer pixels, origin bottom left); COMMON comes before it and MAIN after.
 *
 * Every scene answers the call: `voice()` is how loud it is (the coach's voice counts fully, the athlete's a little),
 * and uA / uB are the coach's own colours. MAIN reveals a scene inside (or outside) a growing circle, with a liquid
 * wavefront, when the athlete switches scenes. Scenes may use dFdx / dFdy (OES_standard_derivatives, which nearly every
 * browser has; where it's missing, a scene that uses them fails to compile and can't be picked).
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
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

const mat2 OCTAVE = mat2(0.8, 0.6, -0.6, 0.8);
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = OCTAVE * p * 2.02 + 3.17; a *= 0.5; }
  return v / 0.97;
}
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

// A few brighter stars with soft diffraction spikes.
vec3 brightStars(vec2 p, float t, float density) {
  vec2 q = p * 6.0;
  vec2 id = floor(q);
  float h = hash12(id + 71.0);
  if (h > density) return vec3(0.0);
  vec2 o = (hash22(id + 5.0) - 0.5) * 0.6;
  vec2 d = (fract(q) - 0.5 - o) / 6.0 * uRes.y;
  float r2 = dot(d, d);
  float s = uScale;
  float pulse = 0.65 + 0.35 * sin(t * (0.6 + h * 2.0) + h * 30.0);
  float core = exp(-r2 / (2.5 * s * s + 0.6));
  float spikes = exp(-abs(d.x) / (0.55 * s + 0.25)) * exp(-abs(d.y) / (16.0 * s)) + exp(-abs(d.y) / (0.55 * s + 0.25)) * exp(-abs(d.x) / (16.0 * s));
  float halo = exp(-sqrt(r2) / (9.0 * s)) * 0.12;
  vec3 tint = mix(vec3(0.72, 0.85, 1.0), vec3(1.0, 0.86, 0.7), fract(h * 9.0));
  return tint * (core * 1.4 + spikes * 0.45 + halo) * pulse;
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

/** A swimmer seen from above or below, head toward +x, swimming freestyle (body lengths are about 0.46). */
export const SWIMMER = /* glsl */ `
// An arm: pulled back under the body, then swung wide and forward through the air.
float arm(vec2 p, float side, float phase) {
  float pull = step(phase, 0.5);
  float u = fract(phase * 2.0);
  vec2 hand = mix(vec2(mix(-0.05, 0.26, u), side * (0.03 + 0.11 * sin(u * PI))),
                  vec2(mix(0.26, -0.05, u), side * (0.035 - 0.022 * sin(u * PI))), pull);
  vec2 shoulder = vec2(0.06, side * 0.036);
  vec2 elbow = (shoulder + hand) * 0.5 + vec2(0.0, side * 0.025 * (1.0 - abs(hand.x - 0.1) / 0.16));
  return min(segment(p, shoulder, elbow) - 0.014, segment(p, elbow, hand) - 0.011);
}
// How far p is outside the swimmer.
float swimmer(vec2 p, float t) {
  // The torso, broad at the shoulders and narrower at the hips, and the head.
  float d = segment(p, vec2(-0.05, 0.0), vec2(0.06, 0.0)) - mix(0.03, 0.044, smoothstep(-0.05, 0.05, p.x));
  d = min(d, length((p - vec2(0.112, 0.0)) * vec2(1.0, 1.15)) - 0.02);
  // The legs, kicking: the feet flick in and out a little.
  float taper = mix(0.019, 0.008, clamp((-p.x - 0.05) / 0.15, 0.0, 1.0));
  d = min(d, segment(p, vec2(-0.05, 0.014), vec2(-0.2, 0.013 + 0.006 * sin(t * 9.0 + 1.6))) - taper);
  d = min(d, segment(p, vec2(-0.05, -0.014), vec2(-0.2, -0.013 - 0.006 * sin(t * 9.0 - 1.6))) - taper);
  float stroke = fract(t * 0.42);
  return min(d, min(arm(p, 1.0, stroke), arm(p, -1.0, fract(stroke + 0.5))));
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

/** Underwater in the pool: sunlight caustics on the tiles, the lane line running away, rays, rising bubbles and specks
 *  drifting, and now and then a swimmer gliding past off a turn, dolphin-kicking, their shadow sweeping the floor. */
const DEEP_END = /* glsl */ `${SWIMMER}
// A swimmer from the side, head toward +x, arms stretched out in front, legs together beating a dolphin kick: how far
// p is outside them (body lengths about 0.47).
float sideSwimmer(vec2 p, float t) {
  float kick = t * 7.0;
  // The kick runs down the body as a wave, growing toward the feet.
  float wave = 0.022 * sin(kick - p.x * 9.0) * smoothstep(0.04, -0.2, p.x);
  vec2 q = vec2(p.x, p.y - wave);
  float d = segment(q, vec2(0.06, 0.012), vec2(0.27, 0.004)) - 0.011;
  d = min(d, length((q - vec2(0.11, 0.016)) * vec2(1.0, 1.1)) - 0.021);
  d = min(d, segment(q, vec2(-0.05, 0.0), vec2(0.07, 0.006)) - mix(0.026, 0.032, smoothstep(-0.05, 0.05, q.x)));
  d = min(d, segment(q, vec2(-0.05, 0.0), vec2(-0.2, 0.0)) - mix(0.019, 0.008, clamp((-q.x - 0.05) / 0.15, 0.0, 1.0)));
  // The feet, pointed, flicking at the end of the kick.
  float flick = 0.012 * sin(kick - 2.2);
  return min(d, segment(q, vec2(-0.2, 0.0), vec2(-0.235, flick)) - 0.006);
}
float causticCell(vec2 p, float t) {
  vec2 n = floor(p);
  vec2 f = fract(p);
  float f1 = 8.0;
  float f2 = 8.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 h = hash22(n + g);
      vec2 o = 0.5 + 0.42 * sin(t * (0.55 + 0.6 * h.yx) + TAU * h);
      float d = length(g + o - f);
      if (d < f1) { f2 = f1; f1 = d; }
      else if (d < f2) { f2 = d; }
    }
  }
  float e = f2 - f1;
  return pow(clamp(1.0 - e * 1.8, 0.0, 1.0), 7.0) + 0.16 * pow(clamp(1.0 - e, 0.0, 1.0), 3.0);
}
float caustics(vec2 p, float t) {
  p += (vec2(noise(p * 0.7 + vec2(t * 0.11, 0.0)), noise(p * 0.7 + vec2(5.3, -t * 0.09))) - 0.5) * 1.1;
  float a = causticCell(p, t);
  float b = causticCell(p * 1.31 + vec2(4.7, 1.9), t * 1.17 + 2.0);
  return a * 0.7 + b * 0.5 + a * b * 2.2;
}
float bubbles(vec2 p, float t, float sc, float speed, float seed) {
  vec2 q = p * sc;
  q.y -= t * speed;
  vec2 id = floor(q);
  float h = hash12(id + seed);
  if (h > 0.15) return 0.0;
  vec2 c = (hash22(id + seed + 7.0) - 0.5) * 0.3;
  c.x += 0.1 * sin(t * 1.9 + h * 90.0);
  float r = 0.08 + 0.12 * fract(h * 37.0);
  vec2 f = fract(q) - 0.5 - c;
  float d = length(f);
  float rim = smoothstep(r, r * 0.8, d) * smoothstep(r * 0.5, r * 0.88, d);
  float spec = smoothstep(r * 0.34, r * 0.04, length(f - vec2(-0.3, 0.32) * r));
  return rim * 0.75 + smoothstep(r, r * 0.6, d) * 0.1 + spec;
}
vec3 scene(vec2 fc) {
  vec2 p = (fc - 0.5 * uRes) / uRes.y;
  float t = uTime;
  float v = voice();
  float hor = 0.05;
  // A swimmer glides past every nineteen seconds, about three metres away: on screen a body a third of the height long.
  float aspect = uRes.x / uRes.y;
  float lap = mod(t, 19.0);
  float glide = 0.5 * aspect + 0.25;
  vec2 swimAt = vec2(mix(-glide, glide, lap / 9.0), 0.14 + 0.012 * sin(lap * 0.9));
  float swimOn = step(lap, 9.0);
  float swimScale = 0.75;
  vec3 haze = mix(vec3(0.01, 0.12, 0.19), vec3(0.03, 0.26, 0.36), smoothstep(-0.25, 0.45, p.y));
  vec3 col;
  if (p.y < hor) {
    float z = 0.34 / (hor - p.y);
    vec2 f = vec2(p.x * z, z + 3.0);
    float fp = z * z / 0.34 / uRes.y;
    // Tiles, and the lane lines on the floor
    vec3 floorCol = vec3(0.17, 0.56, 0.66);
    vec2 g = abs(fract(f * 2.4) - 0.5);
    float grout = smoothstep(0.462 - fp * 2.4, 0.475, max(g.x, g.y)) * (1.0 - smoothstep(0.04, 0.18, fp * 2.4));
    floorCol *= 1.0 - grout * 0.32;
    float aa = fp * 1.4 + 0.004;
    float lane = 1.0 - smoothstep(0.15, 0.15 + aa, abs(f.x));
    lane = max(lane, 1.0 - smoothstep(0.13, 0.13 + aa, abs(abs(f.x) - 2.5)));
    floorCol = mix(floorCol, vec3(0.015, 0.05, 0.13), lane * 0.88);
    // Sunlight through the surface, blocked where the swimmer's shadow falls
    float c = caustics(f * 1.3, t * 0.8);
    vec2 sh = vec2(f.x - swimAt.x * 3.0, z - 3.0) / 4.4;
    float shadow = 0.0;
    if (swimOn > 0.5 && abs(sh.x) < 0.4 && abs(sh.y) < 0.3) shadow = 1.0 - smoothstep(-0.03, 0.07, swimmer(sh, t));
    c *= 1.0 - shadow * 0.85;
    floorCol *= (0.3 + c * (1.0 + v * 1.1)) * (1.0 - shadow * 0.25);
    floorCol += vec3(0.5, 0.95, 1.0) * c * 0.16 * (1.0 + v);
    col = mix(floorCol, haze, 1.0 - exp(-z * 0.2));
  } else {
    // The surface overhead, seen from below, and the swimmer on it in silhouette
    float z = 0.28 / (p.y - hor);
    vec2 s = vec2(p.x * z, z);
    float ripple = noise(s * 1.4 + vec2(t * 0.25, t * 0.1)) * 0.65 + noise(s * 3.1 - vec2(t * 0.3, -t * 0.2)) * 0.35;
    vec3 surf = mix(vec3(0.06, 0.36, 0.46), vec3(0.62, 0.94, 1.0), smoothstep(0.4, 0.9, ripple));
    surf += vec3(0.8, 1.0, 1.0) * caustics(s * 0.9, t * 0.9) * 0.3;
    col = mix(surf, haze, 1.0 - exp(-z * 0.32));
  }
  // Light shafts slanting down from the surface, swaying
  float s = p.x + p.y * 0.42 + 0.03 * sin(t * 0.17);
  float rays = pow(noise(vec2(s * 6.0, t * 0.12)), 3.0) * 0.7 + pow(noise(vec2(s * 15.0 + 7.0, t * 0.2)), 4.0) * 0.5;
  col += vec3(0.42, 0.85, 0.95) * rays * smoothstep(-0.55, 0.45, p.y) * (0.24 + v * 0.3);
  // The swimmer gliding past, softened and blued by three metres of water, a trail of bubbles rising behind them.
  vec2 body = (p - swimAt) / swimScale;
  if (swimOn > 0.5 && abs(body.x) < 0.4 && abs(body.y) < 0.15) {
    float sw = sideSwimmer(body, t);
    float shape = 1.0 - smoothstep(-0.006, 0.01, sw);
    col = mix(col, mix(vec3(0.0, 0.05, 0.09), haze, 0.35), shape * 0.92);
    col += vec3(0.5, 0.9, 1.0) * exp(-abs(sw) / 0.006) * step(0.0, body.y) * 0.18;
  }
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float age = fract(lap * 0.9 - fi / 6.0);
    vec2 at = swimAt + vec2(0.07 * swimScale - age * 0.15, 0.02 + age * 0.22) + vec2(0.01 * sin(t * 5.0 + fi * 2.0), 0.0);
    float br = (0.004 + 0.003 * hash11(fi)) * (1.0 + age);
    float bd = length(p - at);
    float bub = (1.0 - smoothstep(br * 0.6, br, bd)) * smoothstep(br * 0.3, br * 0.9, bd) + exp(-dot(p - at + br * 0.3, p - at + br * 0.3) / (br * br * 0.05)) * 0.8;
    col += vec3(0.7, 0.95, 1.0) * bub * 0.6 * swimOn * step(lap, 9.0 + age * 2.0) * smoothstep(0.0, 0.1, age);
  }
  // Specks drifting in the water, near ones bigger and quicker
  for (int i = 0; i < 2; i++) {
    float fi = float(i);
    float sc = 22.0 - fi * 10.0;
    vec2 q = (p + vec2(t * (0.004 + fi * 0.004), t * (0.006 + fi * 0.006))) * sc;
    vec2 id = floor(q);
    float h = hash12(id + fi * 17.0);
    if (h < 0.25) {
      vec2 o = hash22(id * 1.3 + fi) - 0.5;
      float d = length(fract(q) - 0.5 - o * 0.6) / sc * uRes.y;
      float r = (0.7 + h * 3.0 + fi) * uScale;
      col += vec3(0.6, 0.9, 1.0) * exp(-d * d / (r * r)) * (0.12 + 0.1 * fi) * (0.6 + 0.4 * sin(t * 1.3 + h * 70.0));
    }
  }
  // Bubbles rising
  float b = bubbles(p, t, 4.5, 0.85, 1.0) + bubbles(p, t, 8.0, 0.62, 9.0) * 0.7 + bubbles(p, t, 13.0, 0.42, 23.0) * 0.45;
  col += vec3(0.72, 0.96, 1.0) * b * 0.5;
  return col;
}
`

/** The 50 m pool on finals night: a 100 m race in white water, off our end, to the far wall and home again, under
 *  floodlights, beams sweeping the haze and the crowd's flashes building as the swimmers come home. */
const FINALS_NIGHT = /* glsl */ `
vec3 flood(vec2 p, vec2 c, float s) {
  vec2 d = p - c;
  float r = length(d);
  vec3 col = vec3(0.9, 0.95, 1.0) * exp(-r * r / (s * s * 0.025)) * 1.7;
  col += vec3(0.5, 0.66, 1.0) * exp(-r / (s * 1.2)) * 0.3;
  col += vec3(0.3, 0.5, 1.0) * exp(-r / (s * 5.0)) * 0.07;
  col += vec3(0.35, 0.58, 1.0) * exp(-abs(d.y) / (s * 0.06)) * exp(-abs(d.x) / (s * 12.0)) * 0.42;
  col += vec3(0.8, 0.9, 1.0) * exp(-abs(d.x) / (s * 0.05)) * exp(-abs(d.y) / (s * 1.7)) * 0.2;
  // A beam down through the haze
  float below = max(c.y - p.y, 0.0);
  col += vec3(0.3, 0.45, 0.85) * exp(-abs(d.x) / (s * 0.6 + below * 0.22)) * exp(-below * 3.2) * step(0.0, c.y - p.y) * 0.08;
  return col;
}
float lightX(float i) { return (i - 3.0) * 0.34 + 0.05 * sin(i * 2.7); }
vec3 scene(vec2 fc) {
  vec2 p = (fc - 0.5 * uRes) / uRes.y;
  float t = uTime;
  float v = voice();
  float hor = 0.07;
  // The race: off the blocks at our end every 54 seconds, a length out and a length back, the crowd louder (more
  // flashes) as they come home.
  float race = mod(t, 54.0);
  float finish = smoothstep(38.0, 46.0, race) * (1.0 - smoothstep(49.0, 53.0, race));
  vec3 col;
  if (p.y >= hor) {
    float h = p.y - hor;
    col = mix(vec3(0.022, 0.04, 0.085), vec3(0.006, 0.01, 0.028), smoothstep(0.0, 0.45, h));
    // Beams from the roof sweeping slowly across the haze.
    for (int j = 0; j < 2; j++) {
      float fj = float(j);
      vec2 from = vec2((fj - 0.5) * 1.1, 0.55);
      vec2 d = p - from;
      float ang = atan(d.x, -d.y);
      float aim = 0.55 * sin(t * (0.21 + fj * 0.05) + fj * 2.6) - (fj - 0.5) * 0.5;
      col += mix(vec3(0.35, 0.55, 1.0), mix(uA, uB, fj), 0.35) * exp(-pow((ang - aim) / 0.05, 2.0)) * exp(-length(d) * 1.8) * (0.16 + v * 0.1);
    }
    col += vec3(0.1, 0.2, 0.4) * exp(-h * 9.0) * 0.6;
    // The stands in tiers, and the crowd's phones and camera flashes
    float stands = smoothstep(0.012, 0.022, h) * (1.0 - smoothstep(0.2, 0.29, h));
    float tiers = 0.7 + 0.3 * smoothstep(0.15, 0.6, abs(fract(h * 30.0) - 0.5) * 2.0);
    col += vec3(0.03, 0.05, 0.09) * stands * tiers;
    vec2 q = vec2(p.x, h) * 150.0;
    vec2 id = floor(q);
    vec2 f = fract(q) - 0.5;
    float hh = hash12(id);
    float glow = smoothstep(0.9, 1.0, hh) * (0.45 + 0.55 * sin(t * (1.0 + 4.0 * fract(hh * 9.0)) + hh * 40.0)) * 0.45;
    float flash = step(0.988 - finish * 0.03, hh) * exp(-fract(t * (0.21 + finish * 0.5) + hh * 17.0) * 24.0) * 3.5;
    vec3 tint = mix(vec3(1.0, 0.88, 0.72), vec3(0.75, 0.85, 1.0), fract(hh * 23.0));
    col += tint * exp(-dot(f, f) * 14.0) * (glow + flash) * stands;
    // The far end: the deck lit along the wall
    col += vec3(0.55, 0.75, 1.0) * exp(-h / 0.004) * 0.8;
    // Floodlights in the roof, a nearer row and a farther one
    for (int i = 0; i < 7; i++) {
      float fi = float(i);
      col += flood(p, vec2(lightX(fi), 0.42 + 0.02 * cos(fi * 1.7)), 0.036 + 0.008 * hash11(fi + 4.0));
      col += flood(p, vec2(lightX(fi) * 0.62 + 0.1, 0.3), 0.018) * 0.55;
    }
    return col;
  }
  float camH = 0.5;
  float z = camH / (hor - p.y);
  float x = p.x * z;
  float down = hor - p.y;
  // Ripples on the surface: long swells and a finer chop
  float e = 0.04;
  float n1 = noise(vec2(x * 1.6, z * 0.9 - t * 0.6));
  float n1x = noise(vec2((x + e) * 1.6, z * 0.9 - t * 0.6));
  float n2 = noise(vec2(x * 4.1 + t * 0.3, z * 2.3 - t * 0.9));
  float n2x = noise(vec2((x + e) * 4.1 + t * 0.3, z * 2.3 - t * 0.9));
  float swell = (n1x - n1) / e;
  float slope = swell * 0.6 + (n2x - n2) / e * 0.4;
  // The lit pool below the surface, its black lane lines wavering
  float bx = x + swell * 0.035;
  vec3 pool = vec3(0.0, 0.43, 0.6) * (1.0 + 0.3 * v);
  float shimmer = noise(vec2(bx * 2.2, z * 1.6 - t * 0.5)) * noise(vec2(bx * 3.7 + 3.0, z * 2.9 + t * 0.4));
  pool *= 0.7 + 0.75 * pow(shimmer * 2.2, 2.0);
  float ld = abs(fract(bx / 2.5 + 0.5) - 0.5) * 2.5;
  float lane = 1.0 - smoothstep(0.12, 0.12 + z / uRes.y * 2.0 + 0.015, ld);
  pool = mix(pool, vec3(0.0, 0.04, 0.1), lane * 0.85 * (1.0 - smoothstep(8.0, 30.0, z)));
  pool *= exp(-z * 0.03);
  // The roof lights in the water, stretched and broken by the ripples
  float cosT = camH / sqrt(z * z + camH * camH);
  float fres = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);
  vec3 env = vec3(0.01, 0.022, 0.045) + vec3(0.06, 0.12, 0.22) * exp(-down * 8.0);
  vec3 streaks = vec3(0.0);
  for (int i = 0; i < 7; i++) {
    float fi = float(i);
    float dx = p.x - lightX(fi) + slope * 0.01 * (1.0 + down * 3.0);
    float w = 0.005 + down * 0.05;
    float glint = smoothstep(0.5, 0.95, noise(vec2(x * 3.0 + fi * 7.0, z * 4.0 - t * (1.6 + v))));
    streaks += vec3(0.62, 0.78, 1.0) * exp(-dx * dx / (w * w)) * (0.22 + glint * 1.8) * exp(-down * 2.4);
  }
  vec3 col2 = pool * (1.0 - fres) + env * fres + streaks * max(fres, 0.4);
  // The swimmers in the middle three lanes: white water fizzing round each, a burst with every stroke, and the wake
  // opening behind them in a V that catches the lights.
  float foam = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float pace = 1.95 + 0.14 * hash11(fi + floor(t / 54.0) * 3.0);
    float swum = max(race - 0.6, 0.0) * pace;
    float heading = swum < 47.0 ? 1.0 : -1.0;
    float zs = 2.5 + (swum < 47.0 ? swum : max(94.0 - swum, 0.0));
    vec2 d = vec2(x - (fi - 1.0) * 2.5, z - zs);
    float back = -d.y * heading;
    float fizz = smoothstep(0.45, 0.8, noise(vec2(x * 9.0 + fi * 7.0, z * 4.0 - heading * t * 6.0)));
    float patch = exp(-d.x * d.x / 0.05) * smoothstep(-0.6, -0.1, back) * exp(-max(back, 0.0) * 0.9);
    float burst = exp(-pow(back + 0.35, 2.0) / 0.08 - d.x * d.x / 0.12) * pow(0.5 + 0.5 * sin(t * 5.5 + fi * 2.1), 4.0);
    float arm = abs(abs(d.x) - back * 0.36);
    // (The lane ropes calm the wake before it reaches the next lane.)
    float vee = exp(-arm * arm / (0.003 + back * 0.002)) * step(0.0, back) * exp(-back * 0.22) * (1.0 - smoothstep(0.85, 1.2, abs(d.x)))
      * (0.5 + 0.5 * noise(vec2(z * 3.0, t)));
    foam += (patch * fizz * 1.3 + burst * fizz + vee * 0.55) * step(swum, 94.0) * smoothstep(0.0, 0.6, race);
  }
  col2 = mix(col2, vec3(0.88, 0.95, 1.0), clamp(foam, 0.0, 0.95));
  // Lane ropes: floats in blue and white, ours in yellow, red for the last five metres
  float lw = 2.5;
  float u = x / lw - 0.5;
  float ropeIdx = floor(u + 0.5);
  float d = abs(u - ropeIdx) * lw;
  float px = z / uRes.y;
  float rad = 0.06;
  float rope = 1.0 - smoothstep(rad - px, rad + px, d);
  float pz = z / 0.11;
  float along = z * z / camH / uRes.y / 0.11;
  float bead = mix(smoothstep(0.5, 0.25, abs(fract(pz) - 0.5)), 0.75, smoothstep(0.2, 0.6, along));
  float ours = step(abs(ropeIdx + 0.5), 0.6);
  vec3 floatCol = mod(floor(pz), 6.0) < 3.0 ? mix(vec3(0.06, 0.3, 1.0), vec3(1.0, 0.76, 0.1), ours) : vec3(0.9, 0.94, 1.0);
  floatCol = (z < 5.0 || z > 45.0) ? vec3(1.0, 0.14, 0.16) : floatCol;
  floatCol *= (0.3 + 0.75 * bead) * (0.55 + 0.45 * exp(-z * 0.04));
  col2 = mix(col2, floatCol + streaks * 0.3, rope * (0.45 + 0.55 * bead));
  // Haze toward the far wall
  col2 = mix(col2, vec3(0.06, 0.14, 0.26), smoothstep(15.0, 50.0, z) * 0.55);
  return col2;
}
`

/** Open water at golden hour: the sun on the horizon throwing shafts up through the cloud, a glittering path with
 *  dolphins leaping through it now and then, swells, marker buoys and gulls. */
const OPEN_WATER = /* glsl */ `
vec3 sky(vec2 p, float hor) {
  float k = clamp(max(p.y - hor, 0.0) / 0.55, 0.0, 1.0);
  vec3 col = mix(vec3(1.0, 0.58, 0.26), vec3(0.95, 0.38, 0.36), smoothstep(0.0, 0.2, k));
  col = mix(col, vec3(0.45, 0.17, 0.4), smoothstep(0.14, 0.55, k));
  return mix(col, vec3(0.07, 0.05, 0.17), smoothstep(0.5, 1.0, k));
}
vec2 sunAt(float hor) { return vec2(min(0.42, 0.35 * uRes.x / uRes.y), hor + 0.032); }
float gull(vec2 p, vec2 c, float s, float flap) {
  vec2 l = (p - c) / s;
  l.x = abs(l.x);
  vec2 a = vec2(0.5, 0.22 * flap);
  vec2 b = vec2(1.0, -0.05 + 0.3 * flap);
  return smoothstep(0.1, 0.03, min(segment(l, vec2(0.0), a), segment(l, a, b)));
}
// A dolphin from the side, head toward +x, about a unit long: how far q is outside it.
float dolphin(vec2 q) {
  vec2 b = vec2(q.x, q.y + 0.25 * q.x * q.x);
  float d = (length(b / vec2(0.34, 0.085)) - 1.0) * 0.085;
  d = min(d, segment(q, vec2(0.28, 0.0), vec2(0.5, -0.035)) - 0.022);
  d = min(d, segment(q, vec2(-0.18, -0.01), vec2(-0.46, -0.05)) - mix(0.05, 0.012, clamp((-q.x - 0.18) / 0.28, 0.0, 1.0)));
  d = min(d, segment(q, vec2(-0.46, -0.05), vec2(-0.57, 0.0)) - 0.012);
  d = min(d, segment(q, vec2(-0.46, -0.05), vec2(-0.55, -0.11)) - 0.012);
  return min(d, segment(q, vec2(0.02, 0.07), vec2(-0.1, 0.17)) - mix(0.03, 0.006, clamp((q.y - 0.07) / 0.1, 0.0, 1.0)));
}
vec3 buoy(vec3 col, vec2 p, vec2 b, float size, float sunSide) {
  vec2 l = (p - b) / size;
  float body = smoothstep(1.0, 0.92, length(l * vec2(2.3, 1.45))) * step(-0.18, l.y);
  float shade = 0.4 + 0.6 * smoothstep(-0.45, 0.45, l.x * sunSide) + 0.3 * smoothstep(0.2, 0.8, l.y);
  col = mix(col, vec3(1.0, 0.36, 0.06) * shade, body);
  // Its reflection, shaken by the swell
  vec2 m = vec2(l.x + 0.12 * sin(l.y * 18.0 + uTime * 3.0), -l.y - 0.36);
  float refl = smoothstep(1.0, 0.7, length(m * vec2(2.3, 1.0))) * step(l.y, -0.18);
  return mix(col, vec3(0.9, 0.3, 0.08), refl * 0.35);
}
vec3 scene(vec2 fc) {
  vec2 p = (fc - 0.5 * uRes) / uRes.y;
  float t = uTime;
  float v = voice();
  float aspect = uRes.x / uRes.y;
  float hor = -0.02;
  vec2 sun = sunAt(hor);
  vec3 col;
  if (p.y > hor) {
    col = sky(p, hor);
    float d = length(p - sun);
    col += vec3(1.0, 0.55, 0.25) * exp(-d * 4.0) * 0.45 * (1.0 + v * 0.5);
    col += vec3(1.0, 0.75, 0.45) * exp(-d * 16.0) * 0.6;
    // Shafts of light fanning up from the sun through the gaps in the cloud, turning slowly.
    vec2 ds = p - sun;
    float ang = atan(ds.x, ds.y);
    float shafts = pow(noise(vec2(ang * 9.0, t * 0.05)), 3.0) * 0.8 + pow(noise(vec2(ang * 23.0 + 4.0, t * 0.08)), 4.0) * 0.4;
    col += vec3(1.0, 0.62, 0.35) * shafts * exp(-d * 3.6) * smoothstep(0.0, 0.08, p.y - hor) * 0.16 * (1.0 + v * 0.8);
    vec3 disc = mix(vec3(1.0, 0.97, 0.86), vec3(1.0, 0.72, 0.42), smoothstep(sun.y + 0.03, sun.y - 0.045, p.y));
    col = mix(col, disc, smoothstep(0.047, 0.043, d));
    // Clouds lit from below: soft banks higher up, thin streaks near the horizon
    float band = smoothstep(0.05, 0.13, p.y - hor) * (1.0 - smoothstep(0.32, 0.5, p.y - hor));
    float cl = smoothstep(0.46, 0.72, fbm(vec2(p.x * 1.3 + t * 0.008, (p.y - hor) * 9.0 + 3.0))) * band;
    float streak = smoothstep(0.55, 0.75, fbm3(vec2(p.x * 0.8 - t * 0.005, (p.y - hor) * 40.0))) * smoothstep(0.012, 0.03, p.y - hor) * (1.0 - smoothstep(0.05, 0.09, p.y - hor));
    vec3 cloud = mix(vec3(0.3, 0.1, 0.27), vec3(1.0, 0.58, 0.4), exp(-d * 2.2) * 0.9 + 0.1);
    col = mix(col, cloud, cl * 0.9);
    col = mix(col, mix(vec3(0.55, 0.2, 0.3), vec3(1.0, 0.7, 0.45), exp(-d * 3.0)), streak * 0.6);
    col += stars(p, t, 0.08) * smoothstep(0.26, 0.5, p.y - hor) * 0.6;
    // Gulls crossing
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      float x = mod(t * (0.018 + fi * 0.004) + fi * 0.9, 2.6) - 1.3;
      vec2 c = vec2(x * max(aspect, 1.0), hor + 0.24 + fi * 0.05 + 0.02 * sin(t * 0.3 + fi * 2.0));
      col = mix(col, vec3(0.1, 0.04, 0.12), gull(p, c, 0.012 + fi * 0.003, sin(t * (5.5 + fi) + fi)) * 0.85);
    }
    return col;
  }
  float camH = 2.0;
  float down = hor - p.y;
  float z = camH / down;
  float x = p.x * z;
  vec2 q = vec2(x * 0.25, z * 0.5);
  vec2 drift = vec2(t * 0.03, -t * 0.18);
  float e = 0.02;
  float h0 = fbm3(q + drift);
  float h1 = fbm3(q + vec2(e, 0.0) + drift);
  float h2 = fbm3(q + vec2(0.0, e) + drift);
  vec2 slope = vec2(h1 - h0, h2 - h0) / e;
  vec3 refl = sky(vec2(p.x + slope.x * 0.02, hor + down + slope.y * 0.02), hor);
  float fres = 0.15 + 0.85 * pow(1.0 - clamp(down * 1.8, 0.0, 1.0), 4.0);
  col = mix(vec3(0.05, 0.035, 0.11), refl * 0.8, fres);
  // The sun's glitter path
  float dx = p.x - sun.x - slope.x * 0.012;
  float w = 0.015 + down * 0.5;
  float path = exp(-dx * dx / (w * w));
  float sparkle = pow(noise(vec2(x * 3.0, z * 5.0 - t * 1.3)) * noise(vec2(x * 7.0 + 3.1, z * 11.0 + t * 1.7)), 3.0) * 16.0;
  col += vec3(1.0, 0.68, 0.38) * path * (0.16 + sparkle * (0.8 + v * 1.2)) * (1.0 - down * 0.6);
  col += vec3(1.0, 0.6, 0.4) * smoothstep(0.62, 0.8, h0) * 0.12 * (1.0 - smoothstep(0.0, 0.4, down));
  col += refl * 0.12 * smoothstep(0.5, 0.75, h0) * smoothstep(0.05, 0.4, down);
  // Two marker buoys bobbing far out, lit from the sun's side
  float edgeX = 0.5 * aspect;
  vec2 b1 = vec2(-0.78 * edgeX, hor - camH / 42.0 + 0.0022 * sin(t * 1.4));
  vec2 b2 = vec2(0.6 * edgeX + 0.1, hor - camH / 70.0 + 0.0015 * sin(t * 1.2 + 2.0));
  col = buoy(col, p, b1, 1.6 / 42.0, sign(sun.x - b1.x));
  col = buoy(col, p, b2, 1.6 / 70.0, sign(sun.x - b2.x));
  // A pod of dolphins leaping through the sun's path every thirteen seconds, dark against the glitter, rimmed with
  // light. Each pixel draws the dolphin nearest it.
  float base = hor - 0.06;
  if (abs(p.x - sun.x + 0.07) < 0.22 && p.y > base - 0.02 && p.y < base + 0.1) {
    float best = 1e3;
    float tau = -1.0;
    vec2 from = vec2(0.0);
    float size = 0.08;
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      float ti = (mod(t + fi * 0.45, 13.0) - fi * 0.15) / 1.6;
      vec2 fromI = vec2(sun.x - 0.17 + fi * 0.06, base - fi * 0.008);
      float sizeI = 0.08 - fi * 0.009;
      float k = clamp(ti, 0.0, 1.0);
      float near = length(p - fromI - vec2(k * 0.2, 0.06 * sin(PI * k)) * (sizeI / 0.08));
      if (ti > -0.2 && ti < 1.3 && near < best) { best = near; tau = ti; from = fromI; size = sizeI; }
    }
    if (tau > -0.2) {
      float k = clamp(tau, 0.0, 1.0);
      float scale = size / 0.08;
      vec2 c = from + vec2(k * 0.2, 0.06 * sin(PI * k)) * scale;
      float angle = atan(0.06 * PI * cos(PI * k), 0.2);
      float dd = dolphin(rot(-angle) * (p - c) / size) * size;
      float above = smoothstep(from.y - 0.001, from.y + 0.002, p.y);
      float leaping = step(0.0, tau) * step(tau, 1.0) * above;
      float shape = (1.0 - smoothstep(-0.0008, 0.0008, dd)) * leaping;
      col = mix(col, vec3(0.06, 0.03, 0.08), shape * 0.95);
      col += vec3(1.0, 0.65, 0.35) * exp(-abs(dd) / 0.0012) * (1.0 - shape) * leaping * 0.5;
      // Spray where it breaks the surface and where it goes back in.
      vec2 out_ = (p - from - vec2(0.0, 0.004)) / vec2(0.016, 0.011);
      vec2 in_ = (p - from - vec2(0.2 * scale, 0.004)) / vec2(0.016, 0.012);
      float spray = exp(-dot(out_, out_)) * exp(-max(tau, 0.0) * 4.0) * step(-0.05, tau)
        + exp(-dot(in_, in_)) * smoothstep(0.85, 1.0, tau) * exp(-max(tau - 1.0, 0.0) * 6.0);
      col += vec3(1.0, 0.85, 0.65) * spray * (0.4 + smoothstep(0.55, 0.85, noise(p * 900.0 + t * 3.0)) * 1.2) * above;
    }
  }
  return col;
}
`

/** A bioluminescent shore at night: the Milky Way overhead with meteors falling, waves that glow blue as they break
 *  and peel along, and now and then a swimmer cutting a glowing trail through the water. */
const GLOW_TIDE = /* glsl */ `
vec3 night(vec2 p, float t) {
  vec3 col = mix(vec3(0.01, 0.022, 0.06), vec3(0.002, 0.004, 0.016), smoothstep(0.0, 0.5, p.y));
  vec2 r = rot(-0.45) * p;
  float band = exp(-pow((r.y - 0.16) / 0.13, 2.0));
  float dust = fbm(r * vec2(3.5, 9.0) + 2.0);
  float rift = smoothstep(0.45, 0.65, fbm(r * vec2(5.0, 14.0) + 9.0)) * exp(-pow((r.y - 0.15) / 0.045, 2.0));
  col += vec3(0.3, 0.32, 0.52) * band * dust * 0.55 * (1.0 - rift * 0.85);
  col += vec3(0.6, 0.42, 0.5) * band * pow(dust, 3.0) * 0.42;
  col += stars(p, t, 0.1 + band * 0.25);
  return col;
}
vec3 scene(vec2 fc) {
  vec2 p = (fc - 0.5 * uRes) / uRes.y;
  float t = uTime;
  float v = voice();
  float hor = 0.08;
  if (p.y > hor) {
    vec3 col = night(p, t) + brightStars(p, t, 0.12) * 0.7;
    // Meteors: a few each minute, falling from the same corner of the sky.
    for (int i = 0; i < 2; i++) {
      float fi = float(i);
      float cycle = floor((t + fi * 4.3) / 9.0);
      float m = mod(t + fi * 4.3, 9.0);
      if (m < 0.7 && hash11(cycle + fi * 7.0) < 0.75) {
        vec2 a = vec2((hash11(cycle * 1.3 + fi) - 0.2) * uRes.x / uRes.y * 0.6, 0.22 + 0.2 * hash11(cycle + 5.0 + fi));
        vec2 dir = normalize(vec2(-0.6 - 0.3 * hash11(cycle + 2.0), -0.5));
        vec2 head = a + dir * m * 0.55;
        float along = dot(p - head, -dir);
        float trail = exp(-pow(segment(p, head, head - dir * 0.14) / (0.0013 + 0.0006 * uScale), 2.0)) * smoothstep(0.14, 0.0, along);
        col += vec3(0.75, 0.92, 1.0) * trail * sin(m / 0.7 * PI) * 1.2;
      }
    }
    float ridge = hor + 0.055 * smoothstep(0.05, 0.6, p.x) * (0.55 + 0.45 * fbm3(vec2(p.x * 4.0, 2.0)));
    col = mix(col, vec3(0.004, 0.007, 0.018), smoothstep(ridge + 0.002, ridge - 0.002, p.y));
    col += vec3(0.04, 0.3, 0.45) * exp(-(p.y - hor) * 45.0) * 0.35;
    return col;
  }
  float camH = 0.35;
  float down = hor - p.y;
  float z = camH / down;
  float x = p.x * z;
  vec3 col = vec3(0.003, 0.01, 0.028) + night(vec2(p.x, hor + down), t) * 0.28;
  col += vec3(0.015, 0.04, 0.09) * noise(vec2(x * 1.2, z * 2.5 - t * 0.3)) * smoothstep(0.0, 0.3, down);
  // Waves rolling in, their crests bending, glowing where they break into foam
  float bend = 0.6 * fbm3(vec2(x * 0.22, t * 0.03)) + 0.22 * noise(vec2(x * 1.4, t * 0.1));
  float phase = z * 1.05 + t * 0.32 + bend;
  float n = floor(phase);
  float fr = fract(phase);
  float crest = exp(-fr * 16.0) + exp(-(1.0 - fr) * 70.0) * 0.5;
  float band = exp(-fr * 6.0);
  float foam = fbm3(vec2(x * 3.2 + n * 7.1, fr * 4.0 + n * 3.3 + t * 0.2));
  float lace = smoothstep(0.5, 0.78, foam) * band;
  float broken = smoothstep(0.32, 0.62, noise(vec2(x * 2.2 + n * 13.1, n * 3.7 + t * 0.1)));
  broken *= 0.35 + 0.65 * smoothstep(0.3, 0.7, noise(vec2(x * 7.0 + n * 5.0, t * 0.2)));
  // Each wave breaks first at one end and peels along its length.
  float peel = fract(x * 0.06 - t * 0.09 + n * 0.37);
  broken *= 0.45 + 0.9 * exp(-peel * 5.0) + 0.3 * smoothstep(0.9, 1.0, peel);
  float near = smoothstep(24.0, 1.0, z);
  float glow = (crest * (0.35 + foam) + lace * 0.9 + band * foam * 0.25) * broken * near;
  col += vec3(0.1, 0.85, 1.0) * glow * (1.2 + v * 0.9) + vec3(0.05, 0.35, 1.0) * glow * glow * 0.4;
  col += vec3(0.0, 0.32, 0.85) * band * broken * near * 0.28;
  // A swimmer crossing beyond the break every so often: the plankton lights up round them and in their wake.
  float swimCycle = mod(t, 21.0);
  vec2 swimmer = vec2(mix(-6.0, 6.0, swimCycle / 16.0), 3.4);
  if (swimCycle < 16.0) {
    vec2 sd = vec2(x - swimmer.x, z - swimmer.y);
    float behind = -sd.x;
    float body = exp(-sd.x * sd.x / 0.4 - sd.y * sd.y / 0.12);
    float wake = exp(-sd.y * sd.y / (0.06 + max(behind, 0.0) * 0.03)) * exp(-max(behind, 0.0) * 0.3) * step(0.0, behind);
    float stroke = pow(0.5 + 0.5 * sin(t * 5.0), 6.0) * exp(-pow(sd.x - 0.8, 2.0) / 0.2 - sd.y * sd.y / 0.15);
    float twinkle = 0.55 + 0.45 * noise(vec2(x * 6.0 - t * 2.0, z * 8.0));
    col += vec3(0.15, 0.9, 1.0) * (body * 1.2 + wake * 0.9 + stroke * 2.0) * twinkle * (1.0 + v * 0.8);
  }
  // Plankton sparking in the water, more as the coach speaks
  vec2 q = p * 95.0;
  vec2 id = floor(q);
  float hh = hash12(id + n * 7.0);
  float spark = smoothstep(0.93 - v * 0.14, 1.0, hh) * exp(-dot(fract(q) - 0.5, fract(q) - 0.5) * 22.0);
  spark *= (0.5 + 0.5 * sin(t * 5.0 + hh * 80.0)) * near * (0.25 + crest * 2.2 + v * 1.6);
  col += vec3(0.55, 1.0, 1.0) * spark;
  // The wash sliding up the beach, its edge glowing, and the wet sand mirroring it
  float reach = 1.55 + 0.3 * sin(t * 0.42) + 0.3 * fbm3(vec2(x * 1.3, t * 0.08));
  float edgeGlow = exp(-abs(z - reach) * 18.0) * (0.5 + 0.5 * noise(vec2(x * 5.0, t * 0.3)));
  float sheet = smoothstep(reach, reach + 0.25, z) * smoothstep(reach + 2.2, reach + 0.6, z);
  float lacework = smoothstep(0.5, 0.8, fbm(vec2(x * 5.0, z * 7.0 - t * 0.25)));
  col += vec3(0.12, 0.85, 1.0) * (edgeGlow * 0.95 + sheet * lacework * 0.55) * (1.0 + v * 0.8);
  float sand = smoothstep(reach, reach - 0.15, z);
  vec3 wet = vec3(0.01, 0.014, 0.028) + vec3(0.0, 0.2, 0.36) * exp(-(reach - z) * 2.2) * 0.45;
  col = mix(col, wet + col * 0.2, sand);
  return col;
}
`

/** The northern lights over mountains, folding and pulsing as they ripple along, mirrored in a still lake lined with
 *  pines. */
const NORTHERN_LIGHTS = /* glsl */ `
vec3 auroraSky(vec2 p, float t, float v) {
  vec3 col = mix(vec3(0.008, 0.02, 0.05), vec3(0.002, 0.004, 0.015), smoothstep(-0.1, 0.5, p.y));
  col += stars(p, t, 0.14) * 0.8 + brightStars(p, t, 0.08) * 0.5;
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float x = p.x * (0.8 + fi * 0.18) + fi * 2.3 + t * 0.008 * (1.0 + fi);
    float edge = 0.04 + fi * 0.055 + 0.14 * (fbm3(vec2(x * 1.1, fi * 3.1 + t * 0.03)) - 0.5) + 0.05 * sin(x * 2.2 + t * 0.15 + fi);
    // Folds running along the curtain, and bright pulses chasing after them.
    edge += 0.022 * sin(x * 7.0 - t * 0.9 + fi * 1.3) * (0.5 + 0.5 * sin(x * 1.3 + t * 0.2 + fi));
    float pulse = 0.7 + 0.8 * pow(0.5 + 0.5 * sin(x * 2.6 - t * (1.1 + v * 0.8) + fi * 2.0), 6.0);
    float y = p.y - edge;
    float curtain = smoothstep(-0.01, 0.006, y) * exp(-max(y, 0.0) * (4.0 + fi * 1.5));
    float rim = exp(-abs(y) / 0.012) * smoothstep(-0.012, 0.0, y);
    float rays = 0.25 + 0.8 * pow(noise(vec2(x * 64.0, t * (0.25 + v * 0.8) + fi * 5.0)), 1.6);
    rays *= 0.45 + 0.55 * noise(vec2(x * 9.0 - t * 0.12, fi * 2.0));
    vec3 c = mix(vec3(0.15, 1.0, 0.52), vec3(0.55, 0.3, 1.0), smoothstep(0.03, 0.25, y));
    c = mix(c, vec3(1.0, 0.3, 0.62), smoothstep(0.2, 0.4, y) * 0.5);
    acc += c * (curtain + rim * 0.9) * rays * (0.68 - fi * 0.11) * pulse;
  }
  col += acc * (0.85 + v * 0.7);
  // Now and then, a shooting star
  float cycle = floor(t / 11.0);
  float m = fract(t / 11.0) * 11.0;
  if (m < 0.9) {
    vec2 a = vec2((hash11(cycle) - 0.5) * uRes.x / uRes.y, 0.28 + 0.15 * hash11(cycle + 3.0));
    vec2 dir = normalize(vec2(-0.85, -0.38));
    vec2 head = a + dir * m * 0.5;
    float along = dot(p - head, -dir);
    float trail = exp(-pow(segment(p, head, head - dir * 0.12) / (0.0015 + 0.0006 * uScale), 2.0)) * smoothstep(0.12, 0.0, along);
    col += vec3(0.85, 0.95, 1.0) * trail * sin(m / 0.9 * PI);
  }
  return col;
}
float peaks(float x) {
  float r = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    r += a * (1.0 - abs(noise(vec2(x, 0.5 + float(i) * 3.0)) * 2.0 - 1.0));
    x *= 2.1;
    a *= 0.5;
  }
  return r;
}
vec3 land(vec2 p, float t, float v, float hor) {
  vec3 col = auroraSky(p, t, v);
  // A snowy range catching the aurora on its slopes, a darker one in front
  float x = p.x * 1.5 + 3.0;
  float r = peaks(x);
  float ridge = hor + 0.02 + 0.42 * r * r * r;
  float lean = (peaks(x + 0.02) - r) / 0.02;
  float snow = smoothstep(ridge - 0.08, ridge - 0.004, p.y) * smoothstep(0.06, 0.12, ridge - hor);
  float face = clamp(0.5 - lean * 0.3, 0.0, 1.0);
  vec3 rock = vec3(0.014, 0.026, 0.055) + vec3(0.08, 0.22, 0.17) * snow * face * (0.55 + 0.45 * noise(vec2(p.x * 70.0, p.y * 25.0)));
  col = mix(col, rock, smoothstep(ridge + 0.0015, ridge - 0.0015, p.y));
  float front = hor + 0.012 + 0.04 * peaks(p.x * 2.6 + 11.0);
  col = mix(col, vec3(0.006, 0.012, 0.026), smoothstep(front + 0.0015, front - 0.0015, p.y));
  // Pines along the shore
  float cell = 0.018;
  float cx = floor(p.x / cell);
  float top = hor + 0.012 + 0.045 * hash11(cx) * (0.5 + 0.5 * noise(vec2(cx * 0.15, 3.0)));
  float lx = (fract(p.x / cell) - 0.5) * cell;
  float tree = step(p.y, top) * smoothstep(0.0015, 0.0, abs(lx) - (top - p.y) * 0.3);
  return mix(col, vec3(0.002, 0.005, 0.01), tree);
}
vec3 scene(vec2 fc) {
  vec2 p = (fc - 0.5 * uRes) / uRes.y;
  float t = uTime;
  float v = voice();
  float hor = -0.06;
  if (p.y >= hor) return land(p, t, v, hor);
  // The lake: a mirror, broken by slow ripples
  float down = hor - p.y;
  float z = 0.3 / down;
  float rip = noise(vec2(p.x * z * 0.8, z * 6.0 - t * 0.4)) - 0.5;
  vec2 m = vec2(p.x + rip * 0.006, hor + down + rip * 0.012 * (0.3 + down * 4.0));
  vec3 col = land(m, t, v, hor) * 0.6 + vec3(0.0, 0.008, 0.02);
  col += vec3(0.1, 0.25, 0.2) * smoothstep(0.82, 0.98, noise(vec2(p.x * z * 1.5, z * 14.0 - t))) * 0.12;
  return col * (1.0 - smoothstep(0.0, 0.5, down) * 0.35);
}
`

/** Deep space: a nebula in the coach's own colours, its gas slowly churning, dark dust lanes, stars drifting past at
 *  different depths, a heart that beats, and a comet now and then. */
const NEBULA = /* glsl */ `
vec3 scene(vec2 fc) {
  vec2 p = (fc - 0.5 * uRes) / uRes.y;
  float t = uTime;
  float v = voice();
  float s = t * 0.024;
  vec2 q = rot(s * 0.6) * p * 1.55 + vec2(s * 0.4, 0.0);
  vec2 w1 = vec2(fbm(q + vec2(0.0, s)), fbm(q + vec2(5.2, 1.3) - s));
  vec2 w2 = vec2(fbm(q + 3.0 * w1 + vec2(1.7, 9.2) + s * 0.7), fbm(q + 3.0 * w1 + vec2(8.3, 2.8)));
  float f = fbm(q + 3.4 * w2);
  float aspect = uRes.x / uRes.y;
  vec3 hot = mix(uA, vec3(1.0, 0.35, 0.65), 0.4);
  vec3 cool = mix(uB, vec3(0.3, 0.2, 0.95), 0.35);
  vec3 col = vec3(0.006, 0.005, 0.02);
  // Regions of the cloud glow in different gases: the coach's colours, a magenta and a warm amber
  vec3 tint = mix(cool, hot, smoothstep(0.3, 0.7, w2.x));
  tint = mix(tint, vec3(1.0, 0.25, 0.7), smoothstep(0.55, 0.8, w1.y) * 0.55);
  tint = mix(tint, vec3(1.0, 0.62, 0.32), smoothstep(0.62, 0.85, w2.y) * 0.4);
  float glow = pow(smoothstep(0.3, 0.9, f), 2.0);
  col += tint * glow * 1.6;
  col += tint * smoothstep(0.15, 0.7, f) * 0.12;
  col += vec3(1.0, 0.9, 0.97) * pow(smoothstep(0.72, 1.0, f), 4.0) * 0.45;
  float dust = smoothstep(0.5, 0.72, fbm(q * 2.4 + w1 * 1.5 + 11.0));
  col *= 1.0 - dust * 0.8;
  // A glowing heart off to one side
  vec2 heart = vec2(0.34 * min(aspect, 1.2), 0.16);
  float beat = 1.0 + 0.25 * pow(0.5 + 0.5 * sin(t * 0.9), 8.0);
  col += hot * 0.3 * exp(-length(p - heart) * 3.2) * (0.5 + f) * beat;
  col += vec3(1.0, 0.9, 0.95) * exp(-length(p - heart) * 40.0) * 0.5 * beat;
  col *= 1.0 + v * 0.6;
  // Stars drifting past: the nearer, the quicker.
  col += stars(p + vec2(t * 0.003, t * 0.001), t, 0.12) * 0.9 + brightStars(p + vec2(t * 0.007, t * 0.002), t, 0.16);
  // A comet crossing slowly every twenty-five seconds, its tail streaming away from the heart.
  float pass = mod(t, 25.0) / 25.0;
  vec2 comet = vec2(mix(-0.75, 0.35, pass) * aspect, mix(0.42, -0.1, pass));
  vec2 tail = normalize(comet - heart);
  vec2 cr = p - comet;
  float along = dot(cr, tail);
  float side = dot(cr, vec2(-tail.y, tail.x)) - along * along * 0.6;
  float glowTail = exp(-side * side / (0.00002 + max(along, 0.0) * 0.0006)) * step(0.0, along) * exp(-max(along, 0.0) * 7.0);
  float head = exp(-dot(cr, cr) / 0.00002);
  float shown = smoothstep(0.0, 0.1, pass) * (1.0 - smoothstep(0.85, 1.0, pass));
  col += (vec3(0.75, 0.9, 1.0) * glowTail * 0.55 + vec3(1.0) * head * 1.5) * shown;
  return col;
}
`

/** Iridescent silk folding in slow motion, tinted with the coach's colours, a glint of light sliding across it. */
const LIQUID_SILK = /* glsl */ `
// Satin drapes: long folds running on a diagonal, gathered and loosened along their length.
float folds(vec2 p, float t) {
  vec2 d = normalize(vec2(0.5, 1.0));
  float u = dot(p, d);
  float w = dot(p, vec2(-d.y, d.x));
  float warp = 1.4 * fbm3(vec2(w * 1.2 + t * 0.05, u * 0.6 - t * 0.04)) + 0.35 * sin(w * 2.0 + t * 0.2);
  float h = sin(u * 6.0 + warp * 3.0 + t * 0.15);
  h += 0.45 * sin(u * 13.0 + warp * 5.0 - t * 0.12 + 1.7);
  h += 0.2 * sin(u * 23.0 + warp * 8.0 + t * 0.1);
  return h * 0.35;
}
vec3 scene(vec2 fc) {
  vec2 p = (fc - 0.5 * uRes) / uRes.y;
  float v = voice();
  float t = uTime * (1.0 + v * 0.35);
  float e = 1.5 / uRes.y;
  float h = folds(p, t);
  vec2 g = vec2(folds(p + vec2(e, 0.0), t) - h, folds(p + vec2(0.0, e), t) - h) / e;
  vec3 n = normalize(vec3(-g * 0.2, 1.0));
  // A key light from the upper left, a coloured rim light from the lower right
  vec3 key = normalize(vec3(-0.35, 0.75, 0.55));
  vec3 rimL = normalize(vec3(0.7, -0.3, 0.6));
  vec3 view = vec3(0.0, 0.0, 1.0);
  float d1 = max(dot(n, key), 0.0);
  float d2 = max(dot(n, rimL), 0.0);
  float s1 = pow(max(dot(n, normalize(key + view)), 0.0), 26.0);
  float s2 = pow(max(dot(n, normalize(rimL + view)), 0.0), 18.0);
  // The cloth drifts between the coach's colours and a deep violet
  float k = 0.5 + 0.5 * sin(dot(p, vec2(1.3, 0.7)) * 1.5 + uTime * 0.05);
  vec3 cloth = mix(mix(uA, uB, k), vec3(0.32, 0.12, 0.55), 0.4);
  vec3 col = cloth * (0.06 + 0.85 * pow(d1, 2.5)) + mix(uB, vec3(1.0, 0.4, 0.8), 0.4) * pow(d2, 3.0) * 0.45;
  col += vec3(1.0, 0.97, 0.92) * s1 * (0.85 + v * 0.7) + mix(uA, vec3(1.0), 0.5) * s2 * 0.5;
  // An iridescent sheen where the folds turn away
  float fres = pow(1.0 - n.z, 2.0);
  col += (0.5 + 0.5 * cos(TAU * (h * 0.8 + fres * 3.0 + vec3(0.0, 0.33, 0.67)))) * fres * 1.1;
  // A light swinging slowly past: its glint slides across the folds.
  float swing = uTime * 0.23;
  vec3 glint = normalize(vec3(cos(swing) * 0.8, sin(swing * 0.7) * 0.6, 0.55) + view);
  col += mix(vec3(1.0), uA, 0.25) * pow(max(dot(n, glint), 0.0), 90.0) * (0.6 + v * 0.8);
  col *= 0.55 + 0.45 * smoothstep(-0.5, 0.5, h);
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
      float trail = exp(-pow(segment(p, head, head - dir * 0.12) / (0.0014 + 0.0006 * uScale), 2.0)) * smoothstep(0.12, 0.0, dot(p - head, -dir));
      col += vec3(1.0, 0.55, 0.9) * trail * sin(shot / 0.6 * PI) * 1.3;
    }
    // The sun, cut by bars that sink toward the horizon
    vec2 c = vec2(0.0, hor + 0.15);
    float d = length(p - c);
    float r = 0.24;
    vec3 sunCol = mix(vec3(1.0, 0.22, 0.6), vec3(1.0, 0.86, 0.3), smoothstep(c.y - r, c.y + r * 0.7, p.y));
    float bars = p.y < c.y ? step(0.38 + (c.y - p.y) / r * 0.55, fract((p.y - t * 0.03) * 38.0)) : 0.0;
    float disc = smoothstep(r + 0.002, r - 0.002, d) * (1.0 - bars);
    col += vec3(1.0, 0.3, 0.55) * exp(-max(d - r, 0.0) * 9.0) * 0.35 * (1.0 + v * 0.6);
    col = mix(col, sunCol, disc);
    // Mountains on either side, edged in neon
    float side = smoothstep(0.1, 0.42, abs(p.x));
    float peak = 1.0 - abs(noise(vec2(p.x * 5.0, 1.0)) * 2.0 - 1.0);
    float ridge = hor + side * (0.05 + 0.14 * peak * peak);
    float m = smoothstep(ridge + 0.0015, ridge - 0.0015, p.y);
    vec3 rock = vec3(0.07, 0.01, 0.12) + vec3(0.5, 0.05, 0.6) * smoothstep(0.75, 1.0, noise(vec2(p.x * 40.0, p.y * 40.0))) * 0.15;
    col = mix(col, rock, m * step(0.001, side));
    col += vec3(1.0, 0.2, 0.85) * exp(-abs(p.y - ridge) / (0.0025 + 0.001 * uScale)) * side * 0.8;
    col += vec3(1.0, 0.55, 0.85) * exp(-h / 0.006) * 0.8;
    return col;
  }
  float down = hor - p.y;
  float z = 0.25 / down;
  float x = p.x * z;
  float px = z / uRes.y;
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
  "finals-night": FINALS_NIGHT,
  "open-water": OPEN_WATER,
  "glow-tide": GLOW_TIDE,
  "northern-lights": NORTHERN_LIGHTS,
  nebula: NEBULA,
  "liquid-silk": LIQUID_SILK,
  "neon-lanes": NEON_LANES,
} as const
