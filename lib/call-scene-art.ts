import { BIRD, TOON } from "@/lib/call-scene-shaders"

/*
 * More of the scenes behind the coach chat and the voice call, as GLSL ES 1.00 `vec3 scene(vec2 fc)` shaders like the
 * first ones (lib/call-scene-shaders.ts): illustrated rather than realistic, in flat shapes and clean lines (TOON), and
 * each moving on its own and answering the coach: `voice()` stirs it.
 *
 * `p` is a pixel's place with the screen's middle at 0 and its height running from -0.5 to 0.5, so every scene is
 * composed around the middle and holds on a phone (narrow) as well as a wide screen.
 */

/** Gradient noise and the finishing touches the paper and ink scenes share. */
const HELPERS = /* glsl */ `
vec2 grad2(vec2 i) { float a = hash12(i) * TAU; return vec2(cos(a), sin(a)); }
float gnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = dot(grad2(i), f);
  float b = dot(grad2(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0));
  float c = dot(grad2(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0));
  float d = dot(grad2(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0));
  return clamp(0.5 + 0.75 * mix(mix(a, b, u.x), mix(c, d, u.x), u.y), 0.0, 1.0);
}
float band(float x, float a, float b, float soft) { return smoothstep(a - soft, a + soft, x) * (1.0 - smoothstep(b - soft, b + soft, x)); }
float vignette(vec2 fc, float strength) {
  vec2 v = fc / uRes - 0.5;
  v.x *= mix(1.0, uRes.x / uRes.y, 0.5);
  return 1.0 - strength * smoothstep(0.25, 0.9, length(v) * 1.25);
}
`

/** Underwater, looking up, drawn like a picture book: a circle of sky in the surface with clouds drifting through it and
 *  a sun turning its rays, its edge wobbling, rings of light spreading out across the water, a lane rope bobbing,
 *  and bubbles rising. */
const SNELLS_WINDOW = /* glsl */ `${TOON}
vec3 scene(vec2 fc) {
  vec2 p = (fc - 0.5 * uRes) / uRes.y;
  PX = 1.0 / uRes.y;
  float aspect = uRes.x / uRes.y;
  float t = uTime;
  float v = voice();
  float R = min(0.3, aspect * 0.4);
  vec2 c = vec2(0.0, 0.12);
  vec2 d = p - c;
  float r = length(d);
  float ang = atan(d.y, d.x);
  // The water: rings of flat colour spreading out from the window, deepening as they go.
  float ripple = (r - R) * 7.0 - t * 0.35;
  float ring = floor(ripple);
  vec3 col = mix(vec3(0.05, 0.42, 0.6), vec3(0.02, 0.13, 0.3), clamp((r - R) * 1.6, 0.0, 1.0));
  col *= 0.94 + 0.06 * mod(ring, 2.0);
  col = mix(col, col + vec3(0.06, 0.12, 0.14), outline((fract(ripple) - 0.5) / 7.0, 0.0012) * exp(-(r - R) * 2.0));
  // Wedges of light falling out from the window, turning slowly.
  float wedge = fract(ang / TAU * 11.0 + t * 0.01 + 0.08 * sin(t * 0.3));
  float wedges = (1.0 - smoothstep(0.18, 0.18 + PX * 40.0, abs(wedge - 0.5))) * exp(-(r - R) * 2.4) * step(R, r);
  col += vec3(0.6, 0.95, 1.0) * wedges * (0.08 + v * 0.08);

  // The window: its edge wobbling with the surface.
  float edge = R + 0.007 * sin(ang * 7.0 + t * 1.6) + 0.004 * sin(ang * 13.0 - t * 2.3) + 0.004 * v * sin(ang * 21.0 + t * 7.0);
  float inWindow = fill(r - edge);
  vec3 sky = mix(vec3(0.52, 0.8, 1.0), vec3(0.8, 0.93, 1.0), smoothstep(0.55, 0.57, r / R));
  // The sun with its rays turning (each ray's edge measured round the circle, so it's smooth), and clouds drifting
  // through in front of it.
  vec2 sun = d - vec2(-0.35, 0.32) * R;
  float sunR = length(sun);
  float turn = fract(atan(sun.y, sun.x) / TAU * 12.0 + t * 0.05);
  float rays = fill((abs(turn - 0.5) - 0.25) * TAU / 12.0 * sunR) * fill(sunR - R * 0.32);
  sky = mix(sky, vec3(1.0, 0.95, 0.7), rays * 0.35);
  sky = mix(sky, vec3(1.0, 0.86, 0.35), fill(sunR - R * 0.14));
  vec2 cl = d / R;
  sky = mix(sky, vec3(1.0), fill(cloud(cl - vec2(mod(t * 0.03 + 0.4, 3.2) - 1.6, 0.25), 0.7) * R));
  sky = mix(sky, vec3(1.0), fill(cloud(cl - vec2(mod(t * 0.02 + 1.6, 3.2) - 1.6, -0.35), 0.5) * R));
  // Trees on the bank, leaning in round the rim.
  float grove = smoothstep(0.15, 0.35, sin(ang * 3.0 + 1.0));
  float crowns = 0.5 + 0.5 * abs(sin(ang * 22.0));
  float trees = 1.0 - grove * (0.07 + 0.05 * crowns);
  sky = mix(sky, vec3(0.13, 0.42, 0.4), fill(trees * R - r) * step(0.01, grove));
  col = mix(col, sky, inWindow);
  col = mix(col, vec3(1.0), outline(r - edge, 0.003));
  col += vec3(0.7, 0.95, 1.0) * exp(-max(r - edge, 0.0) / 0.03) * (1.0 - inWindow) * 0.25;

  // The lane rope across the surface, its floats bobbing.
  vec2 ld = normalize(vec2(1.0, -0.18));
  vec2 lp = p - c - vec2(0.0, -0.15) * (R / 0.3);
  float along = dot(lp, ld);
  float across = dot(lp, vec2(-ld.y, ld.x)) - 0.004 * sin(along * 9.0 - t * 1.4);
  float gap = 0.034;
  float cell = floor(along / gap + 0.5);
  float la = along - cell * gap;
  float floatD = length(vec2(max(abs(la) - 0.007, 0.0), across)) - 0.008;
  vec3 tone = mod(cell, 4.0) < 2.0 ? vec3(0.2, 0.45, 1.0) : vec3(0.97, 0.97, 1.0);
  tone *= mix(0.7, 1.0, inWindow) * (0.85 + 0.25 * smoothstep(-0.006, 0.006, across));
  col = mix(col, vec3(0.02, 0.1, 0.2), outline(across, 0.0012) * (1.0 - fill(floatD)));
  col = mix(col, tone, fill(floatD));

  // Bubbles rising toward the window, evenly up the stream, so a pixel only draws the nearest.
  float wideK = min(1.0, aspect / 0.9);
  float rise = (p.y + 0.62) / 0.6;
  float slot = floor((rise - t * 0.05) * 12.0 + 0.5);
  float at = slot / 12.0 + t * 0.05;
  float h = hash11(mod(slot, 64.0) + 1.0);
  vec2 bp = vec2((0.24 + 0.04 * sin(slot * 1.7 + at * 4.0)) * wideK + 0.012 * sin(t * 2.3 + slot), -0.62 + at * 0.6);
  vec2 b = bubble(p - bp, mix(0.024, 0.006, clamp(at, 0.0, 1.0)) * (0.7 + 0.6 * h)) * step(0.0, at) * step(at, 1.0);
  col = mix(col, vec3(0.88, 1.0, 1.0), clamp(b.x * 0.8 + b.y, 0.0, 1.0));
  return col;
}
`

/** An island from the air, drawn like a cartoon map: sand, turquoise shallows and a white reef in flat bands, waves
 *  lapping the beach, palms swaying, a jetty, a sea turtle paddling round the lagoon, a shoal of little fish swirling
 *  the other way, a manta ray gliding through the deep, a boat crossing and clouds drifting over with their shadows. */
const LAGOON = /* glsl */ `${TOON}
float taper(vec2 p, vec2 a, vec2 b, float ra, float rb) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - mix(ra, rb, h);
}
float triangle(vec2 p, vec2 p0, vec2 p1, vec2 p2) {
  vec2 e0 = p1 - p0;
  vec2 e1 = p2 - p1;
  vec2 e2 = p0 - p2;
  vec2 v0 = p - p0;
  vec2 v1 = p - p1;
  vec2 v2 = p - p2;
  vec2 q0 = v0 - e0 * clamp(dot(v0, e0) / dot(e0, e0), 0.0, 1.0);
  vec2 q1 = v1 - e1 * clamp(dot(v1, e1) / dot(e1, e1), 0.0, 1.0);
  vec2 q2 = v2 - e2 * clamp(dot(v2, e2) / dot(e2, e2), 0.0, 1.0);
  float s = sign(e0.x * e2.y - e0.y * e2.x);
  vec2 d = min(min(vec2(dot(q0, q0), s * (v0.x * e0.y - v0.y * e0.x)), vec2(dot(q1, q1), s * (v1.x * e1.y - v1.y * e1.x))),
               vec2(dot(q2, q2), s * (v2.x * e2.y - v2.y * e2.x)));
  return -sqrt(d.x) * sign(d.y);
}
// The coast's distance from the island's middle in direction a.
float shoreAt(float a) { return 0.17 + 0.035 * sin(a * 3.0 + 1.0) + 0.02 * sin(a * 5.0 + 2.0) + 0.01 * sin(a * 9.0); }
// How far p is outside the island.
float coast(vec2 p) { return length(p * vec2(0.85, 1.0)) - shoreAt(atan(p.y, p.x)); }
// A point "out" beyond the coast in direction a: a path round the lagoon.
vec2 roundIsland(float a, float out_) { return vec2(cos(a) / 0.85, sin(a)) * (shoreAt(a) + out_); }
// A cloud seen from above, about s across: puffs bunched together, round on every side.
float puff(vec2 p, float s) {
  float d = length(p - vec2(-0.22, -0.02) * s) - 0.17 * s;
  d = smin(d, length(p - vec2(0.0, 0.07) * s) - 0.2 * s, 0.08 * s);
  d = smin(d, length(p - vec2(0.24, 0.0) * s) - 0.16 * s, 0.08 * s);
  return smin(d, length(p - vec2(0.03, -0.09) * s) - 0.17 * s, 0.08 * s);
}
// A sea turtle from above, nose toward +x, about a unit long, paddling: x how far q is outside it, y its shell, z the
// plates on its shell (each below 0 inside).
vec3 turtle(vec2 q, float t) {
  float stroke = sin(t * 2.0);
  vec2 s = vec2(q.x, abs(q.y));
  float shell = (length(q / vec2(0.37, 0.3)) - 1.0) * 0.3;
  float head = length((q - vec2(0.44 + 0.015 * sin(t * 1.2), 0.0)) / vec2(1.0, 0.82)) - 0.09;
  // The front flippers sweep back together in long strokes; the back ones steer.
  float a1 = 1.85 + 0.6 * stroke;
  vec2 base1 = vec2(0.17, 0.2);
  vec2 mid1 = base1 + vec2(cos(a1 - 0.2), sin(a1 - 0.2)) * 0.2;
  vec2 tip1 = mid1 + vec2(cos(a1 + 0.25), sin(a1 + 0.25)) * 0.24;
  float front = min(taper(s, base1, mid1, 0.055, 0.075), taper(s, mid1, tip1, 0.075, 0.02));
  float a2 = 2.55 + 0.25 * sin(t * 2.0 + 1.2);
  vec2 base2 = vec2(-0.27, 0.14);
  float back = taper(s, base2, base2 + vec2(cos(a2), sin(a2)) * 0.17, 0.05, 0.022);
  float tail = taper(q, vec2(-0.33, 0.0), vec2(-0.45, 0.02 * sin(t * 2.0)), 0.03, 0.006);
  float body = min(min(shell, head), min(min(front, back), tail));
  float plates = min(length((q - vec2(0.16, 0.0)) / vec2(0.1, 0.085)), length((q - vec2(-0.02, 0.0)) / vec2(0.1, 0.085)));
  plates = min(plates, length((q - vec2(-0.19, 0.0)) / vec2(0.09, 0.08)));
  plates = min(plates, min(length((s - vec2(0.07, 0.165)) / vec2(0.085, 0.07)), length((s - vec2(-0.11, 0.165)) / vec2(0.085, 0.07))));
  return vec3(body, shell, (plates - 1.0) * 0.07);
}
// A manta ray from above, nose toward +x, about a unit across its wings, which beat slowly, the tips curling: x how
// far q is outside it, y the pale crescents on its shoulders, z how far its wingtips are lifted (darker as they rise).
vec3 manta(vec2 q, float t) {
  float beat = sin(t * 1.3);
  float span = 0.5 * (0.9 + 0.1 * cos(t * 2.6));
  float u = clamp(abs(q.y) / span, 0.0, 1.0);
  // The leading edge bulges forward; the trailing edge sweeps back to the tips, which trail behind as they beat.
  float lead = 0.24 - 0.3 * pow(u, 1.5) - 0.05 * beat * u * u;
  float trail = -0.19 + 0.13 * pow(u, 0.7) - 0.05 * beat * u * u;
  float wing = max(max(q.x - lead, trail - q.x) * 0.8, abs(q.y) - span);
  float body = (length(q / vec2(0.27, 0.11)) - 1.0) * 0.1;
  vec2 s = vec2(q.x, abs(q.y));
  float horns = taper(s, vec2(0.2, 0.07), vec2(0.3, 0.055), 0.03, 0.014);
  float tail = taper(q, vec2(-0.2, 0.0), vec2(-0.75, 0.04 * sin(t * 1.3 - 1.0)), 0.016, 0.003);
  float d = min(min(smin(wing, body, 0.05), horns), tail);
  float shoulder = max(length((s - vec2(0.02, 0.1)) / vec2(0.1, 0.06)) - 1.0, -(length((s - vec2(0.06, 0.08)) / vec2(0.1, 0.06)) - 1.0)) * 0.06;
  return vec3(d, shoulder, u * u * beat);
}
vec3 scene(vec2 fc) {
  vec2 p = (fc - 0.5 * uRes) / uRes.y;
  PX = 1.0 / uRes.y;
  float aspect = uRes.x / uRes.y;
  float wide = min(aspect, 1.6);
  float t = uTime;
  float v = voice();
  // The island sits left of middle on a wide screen and in the middle of a phone, smaller there so all of it shows.
  float side = smoothstep(0.6, 1.2, aspect);
  float k = clamp(aspect * 1.4, 0.62, 1.0);
  vec2 isleAt = vec2(-0.2 * min(aspect, 1.4) * side, 0.06);
  vec2 isle = (p - isleAt) / k;
  float d = coast(isle) * k;
  float a = atan(isle.y, isle.x);
  // The water in flat bands: the deep, the reef with surf breaking white on it, the lagoon, the shallows.
  vec3 col = mix(vec3(0.1, 0.42, 0.78), vec3(0.06, 0.3, 0.66), smoothstep(0.3, 0.7, d));
  float reef = 0.16 + 0.015 * sin(a * 6.0 + 2.0);
  vec3 lagoonWater = vec3(0.13, 0.68, 0.82);
  // The manta, gliding in a slow loop through the deep (out past the reef), seen through the blue.
  float loop = t * 0.07;
  vec2 mantaHome = mix(vec2(0.0, -0.37), vec2(0.33 * wide, -0.06), side);
  vec2 mantaReach = mix(vec2(0.13, 0.07), vec2(0.18 * wide, 0.25), side);
  vec2 mAt = mantaHome + mantaReach * vec2(cos(loop), sin(loop));
  vec2 mDir = normalize(mantaReach * vec2(-sin(loop), cos(loop)));
  float mSize = 0.2 * k;
  vec2 mq = vec2(dot(p - mAt, mDir), dot(p - mAt, vec2(-mDir.y, mDir.x))) / mSize;
  vec3 ray = manta(mq, t);
  vec3 mantaCol = mix(vec3(0.1, 0.17, 0.34), vec3(0.04, 0.08, 0.2), clamp(ray.z, 0.0, 1.0) * 0.6);
  mantaCol = mix(mantaCol, vec3(0.55, 0.68, 0.82), fill(ray.y * mSize) * 0.5);
  float deep = smoothstep(reef + 0.01, reef + 0.05, d);
  col = mix(col, mix(vec3(0.04, 0.1, 0.24), col, 0.3), fill(ray.x * mSize - PX * 1.2) * deep);
  col = mix(col, mix(mantaCol, col, 0.25), fill(ray.x * mSize) * deep);
  col = mix(col, lagoonWater, fill(d - reef));
  col = mix(col, vec3(0.33, 0.86, 0.84), fill(d - 0.075 - 0.008 * sin(a * 8.0)));
  float surf = outline(d - reef - 0.004 * sin(a * 30.0 - t * 2.0), 0.0035) * step(0.45, fract(a * 4.0 + t * 0.05 + 0.3 * sin(a * 2.0)));
  // Little waves on the deep water: arched strokes drifting toward the island.
  vec2 wq = p * vec2(9.0, 14.0) + vec2(t * 0.15, 0.0);
  vec2 wid = floor(wq);
  vec2 wf = fract(wq) - 0.5;
  float wx = wf.x / 0.3;
  float wave = outline((wf.y - 0.06 * (1.0 - wx * wx)) / 14.0, 0.0012) * step(abs(wx), 1.0) * step(hash12(wid), 0.35) * step(reef + 0.05, d);
  col = mix(col, vec3(0.75, 0.93, 1.0), wave * 0.7);

  // The turtle, paddling slowly round the lagoon, its shadow on the sand below it.
  float tA = t * 0.045 + 1.0;
  vec2 tAt = roundIsland(tA, 0.115);
  vec2 tDir = normalize(roundIsland(tA + 0.02, 0.115) - tAt);
  float tSize = 0.115;
  vec2 tq = vec2(dot(isle - tAt, tDir), dot(isle - tAt, vec2(-tDir.y, tDir.x))) / tSize;
  vec2 sunOff = vec2(0.012, -0.016) / tSize;
  vec3 shadowT = turtle(tq - vec2(dot(sunOff, tDir), dot(sunOff, vec2(-tDir.y, tDir.x))), t);
  col = mix(col, col * 0.78, fill(shadowT.x * tSize * k - 0.003));
  vec3 tt = turtle(tq, t);
  vec3 skinT = vec3(0.42, 0.66, 0.42);
  vec3 shellT = mix(vec3(0.4, 0.32, 0.16), vec3(0.62, 0.52, 0.26), fill(tt.z * tSize * k));
  vec3 turtleCol = mix(skinT, shellT, fill(tt.y * tSize * k));
  turtleCol = mix(turtleCol, vec3(0.05, 0.1, 0.06), fill(length(vec2(tq.x - 0.48, abs(tq.y) - 0.045)) * tSize * k - tSize * k * 0.014));
  turtleCol = mix(turtleCol, lagoonWater, 0.18);
  col = mix(col, vec3(0.1, 0.25, 0.2), fill(tt.x * tSize * k - PX * 1.3));
  col = mix(col, turtleCol, fill(tt.x * tSize * k));

  // A shoal of little fish swirling round the lagoon the other way, turning together; each pixel draws the nearest.
  float sA = -t * 0.08 + 3.6;
  vec2 shoalAt = roundIsland(sA, 0.105);
  vec2 shoalDir = normalize(roundIsland(sA - 0.02, 0.105) - shoalAt);
  vec2 shoalSide = vec2(-shoalDir.y, shoalDir.x);
  float bestF = 1e3;
  vec2 fAt = shoalAt;
  vec2 fDir = shoalDir;
  float fSeed = 0.0;
  for (int i = 0; i < 12; i++) {
    float fi = float(i);
    float h1 = hash11(fi * 1.7 + 3.0);
    float h2 = hash11(fi * 2.9 + 1.0);
    float spin = t * (0.7 + h1 * 0.5) + fi * 2.4;
    float rad = 0.014 + 0.03 * h2;
    vec2 off = vec2(cos(spin), sin(spin)) * rad;
    vec2 at = shoalAt + shoalDir * off.x * 1.9 + shoalSide * off.y;
    vec2 swirl = (shoalDir * -sin(spin) * 1.9 + shoalSide * cos(spin)) * rad * (0.7 + h1 * 0.5);
    float dist = length(isle - at);
    float pick = step(dist, bestF);
    bestF = mix(bestF, dist, pick);
    fAt = mix(fAt, at, pick);
    fDir = mix(fDir, normalize(shoalDir * 0.06 + swirl), pick);
    fSeed = mix(fSeed, fi, pick);
  }
  vec2 fq = vec2(dot(isle - fAt, fDir), dot(isle - fAt, vec2(-fDir.y, fDir.x))) / 0.027;
  fq.y -= 0.1 * sin(t * 12.0 + fSeed * 3.0) * clamp(-fq.x, 0.0, 1.0);
  float fishBody = (length(fq / vec2(0.5, 0.2)) - 1.0) * 0.2;
  vec2 tq2 = vec2(-fq.x - 0.42, abs(fq.y));
  float fishTail = max(max(tq2.y - 0.03 - tq2.x * 0.9, -tq2.x), tq2.x - 0.22);
  float fishD = min(fishBody, fishTail) * 0.027 * k;
  float glint = pow(0.5 + 0.5 * sin(t * 2.5 + fSeed * 4.1), 10.0);
  vec3 fishCol = mix(vec3(0.75, 0.88, 0.95), vec3(1.0), glint);
  fishCol = mix(fishCol, vec3(0.35, 0.55, 0.7), (1.0 - smoothstep(0.04, 0.08, abs(fq.y))) * 0.7);
  col = mix(col, vec3(0.1, 0.4, 0.5), fill(fishD - PX * 1.0) * 0.6);
  col = mix(col, mix(fishCol, lagoonWater, 0.15), fill(fishD));

  col = mix(col, vec3(0.95, 1.0, 1.0), surf * 0.9);
  // The beach, the wet sand where the waves lap it, and the island's green.
  float lap = 0.024 + 0.006 * sin(t * 1.3 + a * 2.0);
  col = mix(col, vec3(0.99, 0.91, 0.7), fill(d - 0.03));
  col = mix(col, vec3(0.93, 0.8, 0.58), fill(d - lap) * (1.0 - fill(d + 0.004)));
  col = mix(col, vec3(1.0), outline(d - lap - 0.002, 0.002));
  col = mix(col, vec3(0.3, 0.72, 0.42), fill(d + 0.012));
  col = mix(col, vec3(0.24, 0.62, 0.36), fill(d + 0.06 + 0.01 * sin(a * 5.0)));
  // Palms from above: crowns of leaves swaying, one to a patch of the island.
  vec2 pq = isle / 0.055;
  vec2 pid = floor(pq);
  vec2 pc = (pid + 0.5 + (hash22(pid + 5.0) - 0.5) * 0.15) * 0.055;
  vec2 pl = isle - pc;
  float sway = 0.15 * sin(t * 0.9 + pid.x * 2.0 + pid.y);
  float leafA = atan(pl.y, pl.x) + sway;
  float crown = length(pl) - 0.022 * (0.5 + 0.5 * abs(cos(leafA * 3.0)));
  float hasPalm = step(coast(pc), -0.035) * step(hash12(pid), 0.75);
  col = mix(col, vec3(0.12, 0.42, 0.24), fill(length(pl - vec2(0.004, -0.004)) - 0.02) * hasPalm * 0.45);
  col = mix(col, vec3(0.2, 0.62, 0.3), fill(crown) * hasPalm);
  col = mix(col, vec3(0.45, 0.32, 0.18), fill(length(pl) - 0.004) * hasPalm);
  // A wooden jetty running out into the lagoon.
  vec2 jq = rot(-0.5) * (isle - vec2(0.15, -0.12));
  float jetty = sdBox(jq, vec2(0.06, 0.009));
  col = mix(col, vec3(0.45, 0.3, 0.18), fill(jetty + 0.002));
  col = mix(col, vec3(0.65, 0.46, 0.28), fill(jetty + 0.0035) * step(0.25, fract(jq.x / 0.012)));
  // A boat crossing the deep water with its wake opening behind it.
  float trip = mod(t * 0.025 + 0.2, 1.0);
  vec2 boat = vec2(mix(-0.6, 0.6, trip) * max(aspect, 1.0) + 0.1, -0.3 + 0.08 * trip);
  vec2 bdir = normalize(vec2(1.0, 0.13));
  vec2 bl = vec2(dot(p - boat, bdir), dot(p - boat, vec2(-bdir.y, bdir.x)));
  float back = -bl.x;
  float wake = outline(abs(bl.y) - back * 0.3, 0.0018) * step(0.0, back) * (1.0 - smoothstep(0.0, 0.25, back));
  col = mix(col, vec3(0.92, 0.98, 1.0), wake * 0.8);
  float hull = max(length(bl * vec2(1.0, 2.4)) - 0.022, -bl.x - 0.016);
  col = mix(col, vec3(1.0), fill(hull));
  col = mix(col, vec3(0.95, 0.4, 0.3), fill(length(bl - vec2(-0.002, 0.0)) - 0.006));
  // Clouds floating over, seen from above (shaded on the side away from the sun), their shadows falling on everything
  // below.
  for (int i = 0; i < 2; i++) {
    float fi = float(i);
    float span = 1.2 * max(aspect, 1.0) + 0.6;
    vec2 at = vec2(mod(t * (0.018 + fi * 0.008) + fi * 0.9, span) - span * 0.5, 0.22 - fi * 0.42);
    float s = 0.36 - fi * 0.08;
    col *= 1.0 - 0.12 * fill(puff(p - at - vec2(0.05, -0.07), s));
    col = mix(col, vec3(0.84, 0.9, 0.97), fill(puff(p - at, s)) * 0.94);
    col = mix(col, vec3(1.0), fill(puff(p - at - vec2(-0.03, 0.03) * s, s * 0.9)) * 0.94);
  }
  return col * (0.96 + v * 0.06);
}
`

/** Waves cut from paper and layered at dusk, rolling past one another, with a paper boat riding them and gulls going
 *  over against the sun. */
const PAPER_TIDE = /* glsl */ `${HELPERS}${BIRD}
// The top of paper layer k (0 at the back, 6 in front) at x: each layer slides along at its own pace and bobs.
float edge(float x, float k, float t, float lift) {
  float base = 0.05 - k * 0.068 + 0.005 * sin(t * 0.7 + k * 1.3);
  float amp = (0.026 + k * 0.006) * lift;
  float f = 1.6 + k * 0.4;
  float u = x + t * (0.012 + k * 0.009);
  return base + amp * sin(u * f * 3.0 + k * 1.9) + amp * 0.55 * sin(u * f * 6.7 + k * 4.3 - t * 0.25)
    + amp * 0.25 * sin(u * f * 13.0 + k * 2.2 + t * 0.4) + 0.006 * (gnoise(vec2(u * 4.0, k * 3.3)) - 0.5);
}
vec3 layerColour(float k) {
  vec3 back = vec3(0.52, 0.56, 0.78);
  vec3 mid = vec3(0.11, 0.40, 0.56);
  vec3 front = vec3(0.015, 0.05, 0.13);
  return k < 3.0 ? mix(back, mid, k / 3.0) : mix(mid, front, (k - 3.0) / 3.0);
}
// A boat folded from paper, upright at the origin with its keel at y = 0: the hull and the peak in the middle. x: how
// the light falls on the fold here (lit 1, shaded less), y: how far outside the boat q is.
vec2 paperBoat(vec2 q) {
  float hullTop = 0.026;
  float halfWide = mix(0.026, 0.05, clamp(q.y / hullTop, 0.0, 1.0));
  float hull = max(max(-q.y, q.y - hullTop), (abs(q.x) - halfWide) * 0.8);
  float peak = max(hullTop - q.y, (abs(q.x) - (0.07 - q.y) * 0.5) * 0.9);
  float lit = q.x < 0.0 ? 1.0 : 0.55;
  if (peak < hull) lit = q.x < 0.0 ? 0.9 : 0.62;
  else if (q.y > hullTop - 0.007) lit *= 0.9;
  return vec2(lit, min(hull, peak));
}
// A paper cloud drifting across, with the shadow it casts on the sky.
vec3 paperCloud(vec3 col, vec2 p, float i, float aspect, float t, float px) {
  float span = 1.3 * max(aspect, 1.0) + 0.4;
  float cx = mod((i - 1.0) * 0.32 * min(aspect, 1.3) + 0.05 + t * (0.006 + i * 0.002) + span * 0.5, span) - span * 0.5;
  vec2 cq = p - vec2(cx, 0.27 + 0.05 * sin(i * 2.3));
  float puff = min(min(length(cq - vec2(-0.05, 0.0)) - 0.035, length(cq - vec2(0.0, 0.012)) - 0.045), length(cq - vec2(0.055, 0.0)) - 0.03);
  puff = max(puff, -cq.y - 0.012);
  col *= 1.0 - 0.22 * exp(-max(puff + 0.004, 0.0) / 0.01) * step(0.0, puff) * step(cq.y, 0.0);
  return mix(col, vec3(0.99, 0.84, 0.76) * (0.92 + 0.08 * smoothstep(-0.01, 0.04, cq.y)), 1.0 - smoothstep(-px, px, puff));
}
// Where paper gull i is, crossing in front of the sun.
vec2 paperGullAt(float i, vec2 sunAt, float flight, float t) {
  float gx = mod(sunAt.x - 0.16 - i * 0.075 + t * 0.022 + flight * 0.5, flight) - flight * 0.5;
  return vec2(gx, sunAt.y + 0.13 + 0.035 * sin(i * 2.4) + 0.008 * sin(t * 0.9 + i));
}
vec3 scene(vec2 fc) {
  vec2 p = (fc - 0.5 * uRes) / uRes.y;
  float aspect = uRes.x / uRes.y;
  float px = 1.0 / uRes.y;
  float t = uTime;
  float v = voice();
  float wide = max(1.2, min(aspect, 1.6));
  float x = p.x / wide * 1.3;
  float lift = 1.0 + v * 0.35;
  float fibre = (gnoise(p * vec2(70.0, 420.0)) - 0.5) * 0.035 + (gnoise(p * 300.0) - 0.5) * 0.02;

  // The sky, a sun breathing softly and paper clouds drifting by.
  vec3 col = mix(vec3(0.96, 0.55, 0.42), vec3(0.98, 0.78, 0.56), smoothstep(0.0, 0.12, p.y));
  col = mix(col, vec3(0.62, 0.36, 0.55), smoothstep(0.1, 0.28, p.y));
  col = mix(col, vec3(0.16, 0.14, 0.33), smoothstep(0.24, 0.52, p.y));
  vec2 sunAt = vec2(0.17 * min(aspect, 1.0), 0.12);
  float sun = length(p - sunAt) - 0.11;
  col += vec3(1.0, 0.6, 0.4) * exp(-max(sun, 0.0) / 0.05) * (0.08 + 0.04 * sin(t * 0.8) + v * 0.12) * step(0.0, sun);
  col *= 1.0 - 0.25 * exp(-max(sun, 0.0) / 0.012) * step(0.0, sun);
  vec3 sunCol = mix(vec3(1.0, 0.62, 0.38), vec3(1.0, 0.86, 0.55), smoothstep(-0.1, 0.1, p.y - sunAt.y));
  col = mix(col, sunCol, 1.0 - smoothstep(-px, px, sun));
  col = paperCloud(paperCloud(paperCloud(col, p, 0.0, aspect, t, px), p, 1.0, aspect, t, px), p, 2.0, aspect, t, px);
  // Stars pricked through the paper high up, twinkling.
  vec2 sq = p * 30.0;
  vec2 sid = floor(sq);
  float sh = hash12(sid);
  vec2 so = (sq - sid - 0.5 - (hash22(sid + 3.0) - 0.5) * 0.6) / 30.0;
  float shine = 0.5 + 0.5 * sin(t * (1.0 + sh * 3.0) + sh * 40.0);
  col = mix(col, vec3(1.0, 0.95, 0.85), (1.0 - smoothstep(0.0012, 0.0012 + px, length(so))) * step(sh, 0.12) * shine * smoothstep(0.3, 0.5, p.y));
  // Three gulls folded from paper, beating their wings as they cross in front of the sun.
  float flight = 1.2 * max(aspect, 1.0) + 0.3;
  vec2 g0 = paperGullAt(0.0, sunAt, flight, t);
  vec2 g1 = paperGullAt(1.0, sunAt, flight, t);
  vec2 g2 = paperGullAt(2.0, sunAt, flight, t);
  float n1 = step(length(p - g1), length(p - g0));
  vec3 g = mix(vec3(g0, 0.0), vec3(g1, 1.0), n1);
  float n2 = step(length(p - g2), length(p - g.xy));
  g = mix(g, vec3(g2, 2.0), n2);
  float gs = 0.02 - g.z * 0.003;
  float gull = flyingBird((p - g.xy) / gs, t, g.z) * gs;
  col = mix(col, vec3(0.20, 0.13, 0.28), 1.0 - smoothstep(-px, px, gull));

  // The waves: a pixel belongs to the nearest layer it lies under.
  float layer = -1.0;
  float top = 0.0;
  for (int i = 0; i < 7; i++) {
    float k = float(i);
    float e = edge(x, k, t, lift);
    if (p.y < e) { layer = k; top = e; }
  }
  // The paper boat rides layer 3, rocking as the wave runs under it.
  float bx = -0.14;
  float slope = (edge(bx + 0.01, 3.0, t, lift) - edge(bx - 0.01, 3.0, t, lift)) / 0.02 * 1.3 / wide;
  float bs = 1.6 * clamp(aspect * 1.6, 0.75, 1.0);
  vec2 keel = vec2(bx * wide / 1.3, edge(bx, 3.0, t, lift) - 0.01 * bs);
  vec2 bq = rot(atan(slope) * 0.9) * (p - keel) / bs;
  vec2 boat = paperBoat(bq);
  if (layer >= 0.0) {
    vec3 paper = layerColour(layer);
    // Light along the top of the cut, and the shade of the layer in front of it.
    paper *= 1.0 + 0.3 * exp(-(top - p.y) / 0.006);
    paper += vec3(1.0, 0.7, 0.5) * exp(-(top - p.y) / 0.003) * 0.14 * (1.0 - layer / 7.0);
    if (layer < 6.0) {
      float below = p.y - edge(x, layer + 1.0, t, lift);
      paper *= 1.0 - 0.62 * exp(-max(below, 0.0) / 0.024);
    }
    // Foam: small round holes along some crests, riding with them.
    float along = (x + t * (0.012 + layer * 0.009)) * 60.0;
    float hole = length(vec2(fract(along) - 0.5, (top - p.y) * 60.0 - 1.2)) - 0.22 * hash12(vec2(floor(along), layer));
    paper = mix(paper, vec3(0.95, 0.93, 0.88), (1.0 - smoothstep(-0.04, 0.04, hole)) * step(0.55, hash12(vec2(floor(along) + 3.0, layer))) * step(layer, 4.0));
    col = paper;
  }
  if (layer < 3.0) {
    // The boat over everything behind its wave, with a soft shadow on the layer behind.
    float shadow = 1.0 - smoothstep(-0.004, 0.006, paperBoat(bq - vec2(0.006, -0.004)).y);
    float inside = 1.0 - smoothstep(-px, px, boat.y);
    col *= 1.0 - 0.3 * shadow * (1.0 - inside);
    col = mix(col, vec3(0.97, 0.93, 0.86) * mix(vec3(0.62, 0.55, 0.7), vec3(1.0, 0.92, 0.84), boat.x), inside);
  }
  col *= 1.0 + fibre;
  col *= vignette(fc, 0.45);
  return col;
}
`

/** An infinity pool at sunset, drawn in flat bands of colour: a big sun sinking behind stripes, pink clouds drifting,
 *  birds, the sun's reflection broken into shimmering dashes on the sea, the pool mirroring the sky, and a palm. */
const INFINITY_EDGE = /* glsl */ `${TOON}${BIRD}
// A long thin cloud, drifting.
float streak(vec2 p, float i, float horizon, float wide, float t) {
  float span = 1.4 * wide + 0.6;
  vec2 at = vec2(mod(t * (0.008 + i * 0.004) + i * 0.7 * wide, span) - span * 0.5, horizon + 0.12 + i * 0.07);
  return fill(sdBox(p - at, vec2(0.12 - i * 0.02, 0.0)) - 0.012 - 0.004 * sin((p.x - at.x) * 40.0));
}
// Where bird i of a loose V is, crossing the sky.
vec2 birdAt(float i, float horizon, float aspect, float t) {
  float span = aspect + 0.4;
  return vec2(mod(-t * 0.02 + i * 0.045 + span * 0.5, span) - span * 0.5,
              horizon + 0.25 + abs(i - 2.0) * 0.022 + 0.006 * sin(t * 0.7 + i * 1.3));
}
// The sky in flat bands, the sun with stripes cut through its lower half, clouds and an island.
vec3 sky(vec2 p, float horizon, vec2 sun, float wide, float t) {
  float h = p.y - horizon;
  float k = floor(clamp(h / 0.42, 0.0, 0.999) * 6.0) / 5.0;
  vec3 c = mix(vec3(1.0, 0.62, 0.36), vec3(0.98, 0.42, 0.42), smoothstep(0.0, 0.4, k));
  c = mix(c, vec3(0.62, 0.3, 0.55), smoothstep(0.35, 0.7, k));
  c = mix(c, vec3(0.22, 0.16, 0.42), smoothstep(0.65, 1.0, k));
  float sd = length(p - sun);
  c = mix(c, mix(c, vec3(1.0, 0.8, 0.5), 0.35), fill(sd - 0.2));
  c = mix(c, mix(c, vec3(1.0, 0.85, 0.55), 0.35), fill(sd - 0.15));
  float below = sun.y - p.y;
  float cut = step(0.0, below) * step(0.82 - below * 5.0, fract(below * 30.0 - t * 0.15));
  c = mix(c, mix(vec3(1.0, 0.9, 0.55), vec3(1.0, 0.6, 0.4), 1.0 - smoothstep(-0.1, 0.1, -below)), fill(sd - 0.11) * (1.0 - cut));
  // Long pink clouds drifting.
  c = mix(c, vec3(1.0, 0.7, 0.72), streak(p, 0.0, horizon, wide, t));
  c = mix(c, vec3(0.88, 0.58, 0.69), streak(p, 1.0, horizon, wide, t));
  c = mix(c, vec3(0.75, 0.45, 0.65), streak(p, 2.0, horizon, wide, t));
  // An island on the horizon with its palm, its fronds stirring.
  vec2 isl = p - vec2(-0.35 * wide, horizon);
  float hill = length(isl * vec2(1.0, 2.4)) - 0.07;
  float trunk = segment(isl, vec2(0.0, 0.02), vec2(0.012, 0.075)) - 0.002;
  float fronds = palmCrown((isl - vec2(0.012, 0.077)) / 0.18, 0.06 * sin(t * 0.9 + 1.0)) * 0.18;
  c = mix(c, vec3(0.3, 0.14, 0.32), fill(min(max(min(hill, trunk), -h), fronds)));
  return c;
}
vec3 scene(vec2 fc) {
  vec2 p = (fc - 0.5 * uRes) / uRes.y;
  PX = 1.0 / uRes.y;
  float aspect = uRes.x / uRes.y;
  float wide = min(aspect, 1.6);
  float t = uTime;
  float v = voice();
  float horizon = 0.06;
  float lip = -0.12;
  vec2 sun = vec2(0.12 * wide, horizon + 0.03 + 0.006 * sin(t * 0.2));
  // The sky is looked up once: straight up, or mirrored in the sea or the pool.
  float down = horizon - p.y;
  vec2 at = p;
  if (p.y < horizon) at = vec2(p.x, horizon + down * (p.y > lip ? 1.6 : 1.0) + 0.003 * sin(p.y * 220.0 + t * 1.5));
  vec3 col = sky(at, horizon, sun, wide, t);
  if (p.y < horizon) {
    float z = 1.0 / max(down, 0.002);
    if (p.y > lip) {
      // The sea: darker than its sky, with the sun's road broken into dashes that shimmer.
      col = mix(col, vec3(0.25, 0.12, 0.35), 0.45);
      float row = floor(down * 90.0);
      float half_ = (0.03 + down * 0.6) * (0.6 + 0.4 * sin(t * 2.0 + row * 1.7)) * (1.0 + v * 0.4);
      float dash = fill(abs(p.x - sun.x + 0.01 * sin(row * 3.1 + t)) - half_) * step(0.35, fract(down * 90.0));
      col = mix(col, vec3(1.0, 0.82, 0.5), dash);
    } else {
      // The pool: the sky mirrored, tinted teal, ripple lines drifting across, and its bright edge.
      col = mix(col, vec3(0.08, 0.55, 0.66), 0.55);
      float wave = fract((lip - p.y) * 18.0 - t * 0.2);
      col = mix(col, vec3(0.75, 0.98, 1.0), outline((wave - 0.5) / 18.0, 0.0015) * step(0.5, fract(p.x * 3.0 + hash11(floor((lip - p.y) * 18.0)) * 7.0 + t * 0.03)) * 0.5);
      col = mix(col, vec3(1.0, 0.9, 0.75), outline(p.y - lip, 0.0018));
    }
  }
  // Birds crossing in a loose V, flapping and gliding; each pixel draws the nearest.
  vec2 bAt = birdAt(0.0, horizon, aspect, t);
  float bSeed = 0.0;
  for (int i = 1; i < 5; i++) {
    vec2 at = birdAt(float(i), horizon, aspect, t);
    float pick = step(length(p - at), length(p - bAt));
    bAt = mix(bAt, at, pick);
    bSeed = mix(bSeed, float(i), pick);
  }
  float birdD = flyingBird((p - bAt) / 0.017, t, bSeed) * 0.017;
  col = mix(col, vec3(0.2, 0.1, 0.25), fill(birdD) * step(horizon, p.y));
  // A palm leaning in from the right, in silhouette: a trunk curving up out of the corner and a star of drooping leaves
  // that stir. Smaller on a narrow screen, its crown kept clear of the sun.
  float ps = clamp(aspect * 1.2, 0.55, 1.0);
  vec2 right = vec2(0.5 * aspect, 0.0);
  vec2 base = right + vec2(0.16 * ps, -0.5);
  vec2 bend = right + vec2(-0.04 * ps, -0.06);
  vec2 crown = right + vec2(-0.13 * ps, 0.28 + 0.1 * (1.0 - ps));
  float trunk = min(segment(p, base, bend) - 0.014 * ps, segment(p, bend, crown) - 0.01 * ps);
  float fronds = palmCrown((p - crown) / ps, 0.05 * sin(t * 0.9)) * ps;
  col = mix(col, vec3(0.16, 0.07, 0.2), fill(min(trunk, fronds)));
  return col;
}
`

/** A pool at night, drawn like a storybook: a big moon, stars, hills and a pool house with its windows lit, string
 *  lights swaying, the pool glowing with caustics wriggling, a float ring drifting, palms swaying either side, and
 *  fireflies. */
const NIGHT_SWIM = /* glsl */ `${TOON}
// A palm in silhouette: a curved trunk and a star of drooping leaves, stirring.
float palm(vec2 p, vec2 base, vec2 lean, float size, float t) {
  vec2 crown = base + lean;
  vec2 bend = base + vec2(lean.x * 0.25, lean.y * 0.5);
  float trunk = min(segment(p, base, bend) - 0.016 * size, segment(p, bend, crown) - 0.011 * size);
  vec2 q = (p - crown) / size;
  q.y += 2.6 * q.x * q.x;
  float a = atan(q.y, q.x) + 0.06 * sin(t * 0.8 + base.x * 3.0);
  float reach = 0.17 * (0.18 + 0.82 * pow(abs(cos(a * 4.0 + 0.4)), 2.5)) * (0.85 + 0.15 * step(q.y, 0.0));
  return min(trunk, (length(q) - reach) * 0.6 * size);
}
vec3 scene(vec2 fc) {
  vec2 p = (fc - 0.5 * uRes) / uRes.y;
  PX = 1.0 / uRes.y;
  float aspect = uRes.x / uRes.y;
  float wide = min(aspect, 1.6);
  float t = uTime;
  float v = voice();
  float horizon = 0.04;
  // The sky: deep blue fading to violet low down, stars, the moon in its rings of glow.
  vec3 col = mix(vec3(0.2, 0.15, 0.4), vec3(0.04, 0.06, 0.18), smoothstep(horizon, 0.5, p.y));
  vec2 sq = p * 42.0;
  vec2 sid = floor(sq);
  float sh = hash12(sid);
  vec2 so = (fract(sq) - 0.5 - (hash22(sid + 3.0) - 0.5) * 0.6) / 42.0;
  float shine = 0.5 + 0.5 * sin(t * (1.0 + sh * 4.0) + sh * 50.0);
  col += vec3(0.85, 0.9, 1.0) * fill(length(so) - PX * (0.6 + sh * 1.2)) * step(sh, 0.14) * shine;
  col += vec3(1.0, 0.95, 0.8) * twinkle((fract(sq) - 0.5) / 42.0, 0.012 * shine) * step(sh, 0.02);
  vec2 moon = p - vec2(-0.48 * smoothstep(0.5, 1.6, wide), 0.27);
  col = mix(col, mix(col, vec3(0.5, 0.55, 0.85), 0.25), fill(length(moon) - 0.12));
  col = mix(col, mix(col, vec3(0.6, 0.65, 0.9), 0.25), fill(length(moon) - 0.09));
  vec3 moonCol = mix(vec3(0.95, 0.93, 0.8), vec3(0.85, 0.82, 0.7), fill(min(length(moon - vec2(0.015, 0.01)) - 0.012, length(moon - vec2(-0.02, -0.018)) - 0.008)));
  col = mix(col, moonCol, fill(length(moon) - 0.06));
  // Hills, then the pool house with its windows lit, and a hedge.
  col = mix(col, vec3(0.12, 0.12, 0.3), fill(p.y - horizon - 0.07 - 0.04 * sin(p.x * 3.0 + 1.0) - 0.02 * sin(p.x * 7.0)));
  col = mix(col, vec3(0.08, 0.09, 0.22), fill(p.y - horizon - 0.035 - 0.025 * sin(p.x * 4.5 + 2.5)));
  vec2 hq = p - vec2(mix(0.02, 0.448, smoothstep(0.5, 1.6, wide)), horizon);
  float house = min(sdBox(hq - vec2(0.0, 0.05), vec2(0.09, 0.05)), max(abs(hq.x) * 0.5 + hq.y - 0.14, -hq.y + 0.09));
  col = mix(col, vec3(0.05, 0.06, 0.16), fill(house));
  vec2 wq = vec2(abs(hq.x) - 0.045, hq.y - 0.055);
  float glowOn = 0.9 + 0.1 * sin(t * 0.7);
  col = mix(col, vec3(1.0, 0.78, 0.4) * glowOn, fill(sdBox(wq, vec2(0.018, 0.016))));
  col = mix(col, vec3(0.05, 0.06, 0.16), fill(min(abs(wq.x) - 0.0015, abs(wq.y) - 0.0015)) * fill(sdBox(wq, vec2(0.018, 0.016))));
  col += vec3(1.0, 0.65, 0.3) * exp(-length(wq) / 0.04) * 0.12 * step(hq.y, 0.2);
  col = mix(col, vec3(0.04, 0.1, 0.12), fill(p.y - horizon - 0.012 - 0.006 * sin(p.x * 60.0)));

  // The ground in perspective: the glowing pool and the deck round it.
  if (p.y < horizon) {
    float z = 0.36 / (horizon - p.y);
    vec2 g = vec2(p.x * z, z);
    float inX = 0.85 - abs(g.x);
    float inZ = min(g.y - 0.8, 5.2 - g.y);
    float inside = min(inX, inZ) / z;
    vec3 deck = mix(vec3(0.1, 0.12, 0.2), vec3(0.06, 0.07, 0.14), smoothstep(1.0, 5.0, z));
    deck += vec3(0.0, 0.3, 0.32) * exp(min(inX, inZ) * 2.5) * 0.25;
    vec2 tile = abs(fract(g * vec2(2.0, 1.5)) - 0.5);
    deck *= 1.0 - 0.25 * (1.0 - smoothstep(0.0, 0.03 * z, 0.5 - max(tile.x, tile.y)));
    vec3 water = mix(vec3(0.0, 0.58, 0.66), vec3(0.02, 0.32, 0.5), smoothstep(1.0, 5.0, g.y));
    water *= 0.8 + 0.2 * smoothstep(0.0, 0.3, min(inX, inZ));
    float aa = (z * z / 0.36 + z) * PX * 3.6;
    water += vec3(0.6, 1.0, 1.0) * toonCaustic(g * 3.6, t * 0.8, 0.035 + v * 0.02, aa) * 0.38;
    water += vec3(0.5, 1.0, 1.0) * exp(-length(vec2(g.x, (g.y - 5.0) * 1.5)) * 1.4) * 0.35;
    // A float ring drifting round the pool, bobbing.
    vec2 ringAt = vec2((-0.42 + 0.12 * sin(t * 0.13)) * min(1.0, aspect / 1.6), 1.9 + 0.5 * sin(t * 0.09));
    vec2 rq = g - ringAt;
    float rr = length(rq);
    float ring = abs(rr - 0.17) - 0.065 - 0.006 * sin(t * 2.0);
    vec3 ringCol = mix(vec3(1.0, 0.45, 0.65), vec3(1.0), step(0.5, fract(atan(rq.y, rq.x) / TAU * 8.0)));
    ringCol *= 0.8 + 0.3 * smoothstep(-0.05, 0.05, rq.y);
    water = mix(water, vec3(0.0, 0.3, 0.42), fill((abs(length(rq - vec2(0.03, -0.06)) - 0.17) - 0.07) / z) * 0.5);
    water = mix(water, ringCol, fill(ring / z));
    col = mix(deck, water, fill(-inside));
    col = mix(col, vec3(0.8, 0.95, 1.0), outline(inside + 0.004, 0.003));
    col = mix(col, vec3(0.06, 0.07, 0.15), smoothstep(4.0, 8.0, z) * 0.5);
  }
  // String lights sagging across the top, swaying, their bulbs in warm colours.
  float span = 0.5 * aspect + 0.1;
  float sway = 0.006 * sin(t * 0.7);
  float sx = clamp(p.x / span, -1.0, 1.0);
  float wireY = 0.45 - (0.07 + sway) * (1.0 - sx * sx);
  col = mix(col, vec3(0.03, 0.03, 0.08), outline(p.y - wireY, 0.0012) * step(abs(p.x), span));
  float bx = (floor(p.x / 0.055) + 0.5) * 0.055;
  float bsx = clamp(bx / span, -1.0, 1.0);
  vec2 bulb = vec2(bx, 0.45 - (0.07 + sway) * (1.0 - bsx * bsx) - 0.012);
  float k = mod(floor(p.x / 0.055), 3.0);
  vec3 bulbCol = k < 1.0 ? vec3(1.0, 0.78, 0.4) : k < 2.0 ? vec3(1.0, 0.5, 0.55) : vec3(0.55, 0.9, 1.0);
  float glow = (0.75 + 0.25 * sin(t * 2.0 + bx * 30.0)) * step(abs(bx), span);
  col += bulbCol * exp(-length(p - bulb) / 0.02) * 0.25 * glow;
  col = mix(col, bulbCol, fill(length((p - bulb) * vec2(1.0, 0.8)) - 0.007) * step(abs(bx), span));
  // Fireflies drifting over the garden.
  vec2 fq = (p + vec2(sin(t * 0.2) * 0.05, cos(t * 0.17) * 0.03)) * 9.0;
  vec2 fid = floor(fq);
  float fh = hash12(fid + 7.0);
  vec2 fo = (fract(fq) - 0.5 - 0.2 * vec2(sin(t * (0.6 + fh) + fh * 9.0), cos(t * (0.5 + fh) + fh * 7.0))) / 9.0;
  float band_ = (1.0 - smoothstep(0.12, 0.2, p.y)) * smoothstep(-0.25, -0.17, p.y);
  float blink = pow(0.5 + 0.5 * sin(t * (0.8 + fh) + fh * 30.0), 3.0) * step(fh, 0.25) * band_;
  col += vec3(0.9, 1.0, 0.45) * (fill(length(fo) - 0.003) + exp(-length(fo) / 0.008) * 0.25) * blink;
  // Palms framing it, one each side, their crowns up in the sky however narrow the screen.
  float ps = clamp(aspect * 1.2, 0.55, 1.0);
  float palms = min(palm(p, vec2(-0.5 * aspect - 0.03, -0.5), vec2(0.13 * ps, 0.78), ps, t),
                    palm(p, vec2(0.5 * aspect + 0.03, -0.5), vec2(-0.11 * ps, 0.66 + 0.1 * (1.0 - ps)), 0.85 * ps, t + 2.0));
  col = mix(col, vec3(0.02, 0.03, 0.08), fill(palms));
  return col;
}
`

/** A marbling bath in the coach's colours: drops of ink land and bloom into rings, pushing the older ink aside, and the
 *  whole bath drifts slowly through eddies that stir it, veined with gold. */
const MARBLED = /* glsl */ `${HELPERS}
vec3 inks(float m) {
  if (m < 1.0) return vec3(0.02, 0.025, 0.05);
  if (m < 2.0) return uA * 0.8;
  if (m < 3.0) return vec3(0.78, 0.74, 0.66);
  if (m < 4.0) return vec3(0.03, 0.15, 0.20);
  if (m < 5.0) return uB * 0.75;
  if (m < 6.0) return vec3(0.55, 0.40, 0.18);
  return vec3(0.10, 0.12, 0.18);
}
// Turns what's round c (by strength radians in the middle, fading out by radius). J (how a step across the screen
// moves q) is carried through: the turn, and the shear between the faster-turning middle and the slower edge.
vec2 swirl(vec2 q, vec2 c, float strength, float radius, inout mat2 J) {
  vec2 d = q - c;
  float turn = strength * exp(-dot(d, d) / (radius * radius));
  vec2 slope = d * (-2.0 * turn / (radius * radius));
  vec2 side = vec2(-d.y, d.x);
  J = rot(turn) * mat2(1.0 + side.x * slope.x, side.y * slope.x, side.x * slope.y, 1.0 + side.y * slope.y) * J;
  return c + rot(turn) * d;
}
// Which ink is at p: floor() picks it and fract() is how far across its band. The combed stripes give their own value;
// a drop gives 100 + 4 per drop + its ring (0 in the middle, 2 outside), so the rings run on from one to the next.
// rim: how far p is from the nearest drop's edge on the screen (below 0 inside it). rate: how fast the value changes
// across the screen here. Both come from J, how a step across the screen moves the point looked up, carried through
// every stir, push and comb (all smooth), so they're exact and change smoothly from one pixel to the next.
float marble(vec2 p, float t, float v, out float rim, out float rate) {
  // The bath's eddies stir and settle; the coach's voice stirs them harder.
  float stir = 1.0 + 0.5 * v;
  mat2 J = mat2(1.0);
  vec2 q = swirl(p, vec2(-0.42, 0.12), 2.2 * sin(t * 0.05 + 1.0) * stir, 0.32, J);
  q = swirl(q, vec2(0.36, -0.16), -1.9 * sin(t * 0.043 + 2.5) * stir, 0.36, J);
  q = swirl(q, vec2(0.04, 0.3), 1.6 * sin(t * 0.037 + 4.0) * stir, 0.26, J);
  // Everything in the bath drifts slowly left.
  vec2 b = q + vec2(t * 0.04, 0.0);
  float aspect = uRes.x / uRes.y;
  // The drops, newest first: one lands every six seconds, spreads, and pushed what was there outward as it spread.
  float now = floor(t / 6.0);
  float found = -1.0;
  rim = 1e3;
  rate = 0.0;
  for (int i = 0; i < 8; i++) {
    float k = now - float(i);
    float age = t - k * 6.0;
    vec2 land = vec2(mix(-0.1, 0.32, hash11(k * 1.7)) * aspect, mix(-0.36, 0.36, hash11(k * 2.3 + 1.0)));
    vec2 c = land + vec2(k * 0.24, 0.0);
    float grow = clamp(age / 3.2, 0.0, 1.0);
    float r = mix(0.07, 0.17, hash11(k * 3.1 + 2.0)) * (1.0 - pow(1.0 - grow, 3.0)) * (1.0 - smoothstep(42.0, 48.0, age));
    vec2 d = b - c;
    float dist2 = dot(d, d);
    float r2 = r * r;
    // Weighed rather than branched (the D3D compiler is very slow with matrices in branches): once a drop is found
    // nothing changes; inside this one, it's found; outside, what it pushed outward is squeezed into the ring round it,
    // by 1/g across the ring and g along it.
    float alive = step(found, 0.0);
    float inside = alive * (1.0 - step(r2, dist2));
    float push = alive - inside;
    float dist = sqrt(dist2);
    rim = mix(rim, min(rim, (dist - r) / max(length(d / max(dist, 1e-6) * J), 1e-4)), alive);
    found = mix(found, 100.0 + mod(k, 40.0) * 4.0 + 3.0 * dist2 / max(r2, 1e-8), inside);
    rate = mix(rate, length(d * (6.0 * inside / max(r2, 1e-8)) * J), inside);
    float g = sqrt(max(1.0 - r2 / max(dist2, 1e-6), 0.0));
    float gJ = mix(1.0, max(g, 1e-3), push);
    float squeeze = push * r2 / (max(dist2 * dist2, 1e-12) * gJ);
    J = mat2(gJ + squeeze * d.x * d.x, squeeze * d.x * d.y, squeeze * d.x * d.y, gJ + squeeze * d.y * d.y) * J;
    b = mix(b, c + d * g, push);
  }
  if (found > 0.0) return found;
  // Before them: stripes raked across and back, then combed.
  b *= 1.3;
  J *= 1.3;
  J = mat2(1.0, 0.0, 0.98 * cos(b.y * 28.0), 1.0) * J;
  b.x += 0.035 * sin(b.y * 28.0);
  J = mat2(1.0, 0.44 * cos(b.x * 8.0 + 1.3), 0.0, 1.0) * J;
  b.y += 0.055 * sin(b.x * 8.0 + 1.3);
  b += (vec2(gnoise(b * 2.5), gnoise(b * 2.5 + 5.0)) - 0.5) * 0.07;
  rate = length(vec2(0.0, 11.0) * J);
  return b.y * 11.0;
}
vec3 inkAt(float m) {
  if (m < 99.5) return inks(mod(m, 7.0));
  float k = floor((m - 100.0) / 4.0);
  float ring = m - 100.0 - k * 4.0;
  return inks(mod(k * 3.0 + ring * 2.0 + 1.0, 7.0));
}
vec3 scene(vec2 fc) {
  vec2 p = (fc - 0.5 * uRes) / uRes.y;
  float t = uTime;
  float vo = voice();
  float rim;
  float rate;
  float v = marble(p, t, vo, rim, rate);
  // How fast the bands change here (in bands a pixel): squeezed thinner than a pixel, they blend. A drop's own edge is
  // drawn by its distance.
  float dv = min(rate / uRes.y, 1.0);
  float f = fract(v);
  float idx = floor(v);
  vec3 col = inkAt(idx);
  col *= 0.86 + 0.24 * smoothstep(0.0, 1.0, f) * (0.8 + 0.2 * gnoise(p * 300.0));
  // The middle of a drop has no edge.
  float edgeDist = idx > 99.5 && mod(idx - 100.0, 4.0) < 0.5 ? 1.0 - f : min(f, 1.0 - f);
  float vein = 1.0 - smoothstep(0.0, max(0.025, dv * 1.2), edgeDist);
  // rim is a distance on the screen: its lines are drawn a pixel or so wide.
  float rimWidth = 1.2 / uRes.y;
  vein = max(vein, 1.0 - smoothstep(rimWidth * 0.6, rimWidth * 1.6, abs(rim)));
  col = mix(col, vec3(0.01, 0.01, 0.02), vein * 0.85);
  float sheen = 0.55 + 0.8 * pow(gnoise(p * 14.0 + vec2(2.0 + t * 0.05, 0.0)), 2.0);
  float gold = band(edgeDist, max(0.025, dv * 1.2), max(0.05, dv * 2.4), max(0.008, dv));
  gold = max(gold, band(abs(rim), rimWidth * 1.6, rimWidth * 3.2, rimWidth * 0.5));
  col = mix(col, vec3(0.98, 0.79, 0.42) * sheen * (1.0 + vo * 0.5), gold * 0.6);
  // Squeezed past what a pixel can show: the average of the inks.
  vec3 average = (inks(0.5) + inks(1.5) + inks(2.5) + inks(3.5) + inks(4.5) + inks(5.5) + inks(6.5)) / 7.0;
  col = mix(col, average * 0.8, smoothstep(0.35, 0.9, dv));
  col *= 1.0 + (gnoise(p * vec2(80.0, 500.0)) - 0.5) * 0.04 + (gnoise(p * 320.0) - 0.5) * 0.03;
  col *= vignette(fc, 0.5);
  return col;
}
`

/** Rain on a koi pond, seen from above like a picture book: drops ringing out across the dark water, koi gliding in
 *  long loops beneath it (their fins flowing, their shadows on the bottom, rising now and then to kiss the surface), and
 *  lily pads drifting with a flower. */
const RAINFALL = /* glsl */ `${TOON}
float taper(vec2 p, vec2 a, vec2 b, float ra, float rb) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - mix(ra, rb, h);
}
// How far round its loop koi i has swum by time t (x, only ever forward) and how hard it's pushing (y, 0-1): cruising
// slowly, with a burst every ten seconds or so, at a moment that changes each time.
vec2 koiSwim(float i, float t) {
  float every = 9.0 + 2.3 * i;
  float n = floor(t / every);
  float start = hash11(n * 3.7 + i * 11.0) * (every - 2.4);
  float k = clamp((t - n * every - start) / 2.4, 0.0, 1.0);
  return vec2(t * 0.09 + (n + k * k * (3.0 - 2.0 * k)) * 0.3, 4.0 * k * (1.0 - k));
}
// Where koi i is when it's s round its loop (xy), and which way and how fast the loop runs there (zw, per unit of s):
// koi 0 and 1 circle ovals, koi 2 swims figures of eight. shape: the loop's middle (xy) and reach (zw: the long way,
// which points along tilt, and across). Lap by lap the loop turns, swells and drifts a little (calm scales that down on
// a narrow screen, where there's less room).
vec4 koiPose(float i, float s, vec4 shape, float tilt, float calm) {
  float swell = 1.0 + 0.08 * calm * sin(0.23 * s + i * 2.0);
  float swellRate = 0.0184 * calm * cos(0.23 * s + i * 2.0);
  bool eight = i > 1.5;
  vec2 q = (eight ? vec2(sin(s), sin(2.0 * s)) : vec2(cos(s), sin(s))) * shape.zw;
  vec2 qRate = (eight ? vec2(cos(s), 2.0 * cos(2.0 * s)) : vec2(-sin(s), cos(s))) * shape.zw;
  float turn = tilt + 0.12 * calm * sin(0.17 * s + i * 1.9);
  float turnRate = 0.0204 * calm * cos(0.17 * s + i * 1.9);
  mat2 r = rot(turn);
  vec2 drift = 0.03 * calm * vec2(sin(0.11 * s + i), cos(0.13 * s + i * 2.0));
  vec2 driftRate = 0.03 * calm * vec2(0.11 * cos(0.11 * s + i), -0.13 * sin(0.13 * s + i * 2.0));
  vec2 at = shape.xy + drift + r * q * swell;
  vec2 rate = driftRate + r * (qRate * swell + q * swellRate) + turnRate * (r * vec2(-q.y, q.x)) * swell;
  return vec4(at, rate);
}
// How sharply koi i's loop (reach: shape.zw, as koiPose takes it) bends when it's s round it: 1 over the radius of the
// turn there, above 0 turning left as s grows. The loop's slow turning, swelling and drifting barely change it.
float koiBend(float i, float s, vec2 reach) {
  vec2 v = i > 1.5 ? vec2(cos(s), 2.0 * cos(2.0 * s)) * reach : vec2(-sin(s), cos(s)) * reach;
  vec2 a = i > 1.5 ? vec2(-sin(s), -4.0 * sin(2.0 * s)) * reach : vec2(-cos(s), -sin(s)) * reach;
  float v2 = dot(v, v);
  return (v.x * a.y - v.y * a.x) / (v2 * sqrt(v2));
}
// A koi from above, nose toward +x at about 0.5, its fan tail reaching back past -0.85. Its spine follows an arc of
// curvature c, as its path does (bending c1 more for each unit along it), with a swimming wave on top: phi its phase, amp
// its size at the tail. fin: the front fins' sculling (x), how far they fold back for a burst (y) and how far the one on
// the inside of a turn flares out to steer (z). Returns how far q is outside its body (x) and its fins (y), and where q
// is on it straightened out (zw); tail: where q is on the tail fan (xy: across it and back along it) and how far q is
// outside the tail fan (z) and the front fins (w).
vec4 koiShape(vec2 q, float c, float c1, float phi, float amp, vec3 fin, out vec4 tail) {
  // Straighten the arc: how far along it q is and how far to the side, exactly, so the body never stretches as it bends.
  float sr = c < 0.0 ? -1.0 : 1.0;
  float R = sr / max(abs(c), 1e-3);
  vec2 a = vec2(R * atan(q.x * sr, (R - q.y) * sr), R - sr * length(vec2(q.x, q.y - R)));
  // Then the swimming wave, running back down the body and growing toward the tail, and the change in bend along it.
  float back = clamp((0.3 - a.x) / 1.25, 0.0, 1.0);
  float env = 0.1 + 0.9 * back * back;
  float wave = phi + 4.8 * a.x;
  float y = c1 * a.x * a.x * a.x / 6.0 + amp * env * sin(wave);
  float slope = c1 * a.x * a.x * 0.5 + amp * (env * 4.8 * cos(wave) - 1.44 * back * sin(wave));
  vec2 b = vec2(a.x, (a.y - y) * inversesqrt(1.0 + slope * slope));
  float body = (length((b - vec2(0.08, 0.0)) / vec2(0.43, 0.125)) - 1.0) * 0.12;
  body = smin(body, taper(b, vec2(-0.12, 0.0), vec2(-0.5, 0.0), 0.095, 0.03), 0.06);
  // The tail: a stiff forked fan, set at the angle the body has where it joins it and trailing behind its swing, its
  // edges rippling.
  float join = -0.46;
  float backJ = (0.3 - join) / 1.25;
  float envJ = 0.1 + 0.9 * backJ * backJ;
  float waveJ = phi + 4.8 * join;
  float yJ = c1 * join * join * join / 6.0 + amp * envJ * sin(waveJ);
  float slopeJ = c1 * join * join * 0.5 + amp * (envJ * 4.8 * cos(waveJ) - 1.44 * backJ * sin(waveJ));
  vec2 f = rot(-2.0 * amp * cos(waveJ) - atan(slopeJ)) * (a - vec2(join, yJ));
  float along = -f.x;
  f.y += 0.03 * sin(phi - 2.0 - along * 7.0) * along;
  float hw = 0.03 + along * 0.62;
  float r = clamp(abs(f.y) / hw, 0.0, 1.0);
  float fan = max(abs(f.y) - hw, max(-along, along - (0.24 + 0.2 * r * r)));
  // The front fins scull slowly, fold back for a burst and flare on the inside of a turn; the back pair; the ridge
  // along its back.
  vec2 s = vec2(b.x, abs(b.y));
  float a1 = 2.35 + 0.25 * sin(fin.x + sign(b.y) * 0.7) + 0.45 * fin.y - 0.5 * fin.z * step(0.0, b.y * c);
  vec2 base1 = vec2(0.2, 0.1);
  float pec = taper(s, base1, base1 + vec2(cos(a1), sin(a1)) * 0.22, 0.035, 0.07);
  vec2 base2 = vec2(-0.12, 0.07);
  float pel = taper(s, base2, base2 + vec2(-0.104, 0.062), 0.02, 0.04);
  float dorsal = max(abs(b.y) - 0.016, abs(b.x + 0.06) - 0.26);
  tail = vec4(f.y, along, fan, pec);
  return vec4(body, min(min(fan, pec), min(pel, dorsal)), b);
}
// A soft shadow needs only the koi's outline, roughly: its body, bent and swimming, and its tail fan.
float koiShadow(vec2 q, float c, float phi, float amp) {
  float sr = c < 0.0 ? -1.0 : 1.0;
  float R = sr / max(abs(c), 1e-3);
  vec2 a = vec2(R * atan(q.x * sr, (R - q.y) * sr), R - sr * length(vec2(q.x, q.y - R)));
  float back = clamp((0.3 - a.x) / 1.25, 0.0, 1.0);
  vec2 b = vec2(a.x, a.y - amp * (0.1 + 0.9 * back * back) * sin(phi + 4.8 * a.x));
  float body = smin((length((b - vec2(0.08, 0.0)) / vec2(0.43, 0.125)) - 1.0) * 0.12, taper(b, vec2(-0.12, 0.0), vec2(-0.5, 0.0), 0.095, 0.03), 0.06);
  float along = -0.46 - b.x;
  return min(body, max(abs(b.y) - 0.03 - along * 0.62, max(-along, along - 0.3)));
}
// A koi's colours where (along, across) on it: kohaku (red on white), sanke (red and black on white) or ogon (gold).
// aa is a pixel's size in the koi's own units: the patches' edges are softened over about that.
vec3 koiSkin(vec2 b, float kind, float t, float aa) {
  float blotch = noise(b * 6.5 + kind * 17.0) + 0.25 * noise(b * 14.0 + kind * 3.0);
  float soft = 0.01 + 5.0 * aa;
  float red = smoothstep(0.65 - soft, 0.65 + soft, blotch) * smoothstep(-0.44, -0.4, b.x);
  float black = smoothstep(0.68 - soft * 1.7, 0.68 + soft * 1.7, noise(b * 11.0 + 40.0 + kind)) * step(0.5, kind) * step(kind, 1.5);
  vec3 skin = mix(vec3(0.98, 0.96, 0.92), vec3(0.97, 0.36, 0.16), red);
  skin = mix(skin, vec3(0.08, 0.08, 0.1), black);
  // Ogon: all gold, shining along its back.
  vec3 gold = mix(vec3(0.95, 0.62, 0.18), vec3(1.0, 0.86, 0.45), 0.5 + 0.5 * sin(b.x * 6.0 - t * 0.8));
  skin = mix(skin, gold, step(1.5, kind));
  // A paler stripe of light down the spine.
  return mix(skin, skin + 0.12, 1.0 - smoothstep(0.0, 0.03, abs(b.y)));
}
// A drop's rings, if one landed in this cell lately: brightness of the ring under p.
float rings(vec2 p, vec2 cell, float t, float rate) {
  float clock = t * rate + hash12(cell * 1.3);
  float age = fract(clock);
  vec2 at = (cell + 0.2 + 0.6 * hash22(cell + floor(clock) * 7.3)) / 4.0;
  float r = length(p - at);
  float grow = age * 0.16;
  float fade = (1.0 - age) * (1.0 - age);
  return (outline(r - grow, 0.0016) + outline(r - grow * 0.6, 0.0012) * 0.6) * fade + fill(r - 0.004 * (1.0 - age * 8.0)) * step(age, 0.1);
}
// When koi i last rose (or next rises) to kiss the surface, every twelve seconds or so.
float kissTime(float i, float t) { return floor((t + i * 4.1) / 12.0 + 0.5) * 12.0 - i * 4.1; }
// The rings where koi i last kissed the surface, spreading from where its nose was then (shape, tilt and calm: its loop,
// as koiPose takes them; L its length).
float kissRings(vec2 p, float i, float t, vec4 shape, float tilt, float calm, float L) {
  float kissAt = kissTime(i, t);
  float way = i > 0.5 && i < 1.5 ? -1.0 : 1.0;
  vec4 then = koiPose(i, koiSwim(i, kissAt).x * way + i * 1.7, shape, tilt, calm);
  float age = t - kissAt;
  float r = length(p - then.xy - normalize(then.zw) * way * 0.53 * L);
  return (outline(r - age * 0.07, 0.0016) + outline(r - age * 0.045, 0.0012) * 0.7) * step(0.0, age) * (1.0 - smoothstep(0.5, 3.0, age));
}
// Koi i, L long, swimming its loop (shape, tilt and calm, as koiPose takes them), laid over col: its shadow on the
// bottom, then the fish.
vec3 drawKoi(vec3 col, vec2 p, float i, float t, vec4 shape, float tilt, float calm, float L) {
  float way = i > 0.5 && i < 1.5 ? -1.0 : 1.0;
  vec2 swim = koiSwim(i, t);
  float s = swim.x * way + i * 1.7;
  vec4 pose = koiPose(i, s, shape, tilt, calm);
  vec2 at = pose.xy;
  vec2 h = normalize(pose.zw) * way;
  // Now and then it rises to kiss the surface: nearer, it looks a touch bigger and brighter, and its shadow on the
  // bottom falls further off and softer.
  float kissAt = kissTime(i, t);
  float rise = exp(-(t - kissAt) * (t - kissAt) / 2.0);
  L *= 1.0 + 0.07 * rise;
  // Only near it is it worth working out: bent into a turn, its tail swings out up to about 0.8 of its length from its
  // middle line, and its shadow falls up to 0.14 away.
  if (segment(p, at + h * 0.55 * L, at - h * 0.95 * L) < 0.8 * L + 0.15) {
    // How its path bends round its body (in its own lengths), and how that changes along it.
    float swell = 1.0 + 0.08 * calm * sin(0.23 * s + i * 2.0);
    float c = clamp(way * koiBend(i, s, shape.zw) / swell * L, -1.6, 1.6);
    float c1 = (koiBend(i, s + 0.05, shape.zw) - koiBend(i, s - 0.05, shape.zw)) / 0.1 / length(pose.zw) / swell * L * L;
    c1 = clamp(c1, -2.0, 2.0);
    // Its tail beats with how far it swims (so faster in a burst), and harder while it pushes.
    float phi = 3.2 * t + 34.0 * swim.x + i * 2.0;
    float amp = mix(0.055, 0.1, swim.y);
    vec3 fin = vec3(2.1 * t + i * 2.0, swim.y, min(abs(c), 1.0));
    vec2 side = vec2(-h.y, h.x);
    vec2 local = vec2(dot(p - at, h), dot(p - at, side)) / L;
    vec2 off = vec2(0.05, -0.08) * mix(0.9, 1.4, rise);
    float shade = koiShadow(local - vec2(dot(off, h), dot(off, side)) / L, c, phi, amp);
    float soft = 0.005 + 0.008 * mix(0.9, 1.4, rise);
    col *= 1.0 - 0.42 * mix(1.0, 0.7, rise) * (1.0 - smoothstep(-soft, soft, shade * L));
    vec4 tail;
    vec4 fish = koiShape(local, c, c1, phi, amp, fin, tail);
    // The fins' ribs fan out from where each joins the body.
    float rays = 0.5 + 0.5 * sin(tail.z < tail.w ? atan(tail.x, tail.y + 0.05) * 30.0 : atan(abs(fish.w) - 0.1, fish.z - 0.2) * 34.0);
    vec3 skin = koiSkin(fish.zw, i, t, PX / L);
    // Light catching its back as it nears the surface.
    skin += 0.14 * rise * (1.0 - smoothstep(0.0, 0.06, abs(fish.w - 0.015))) * step(fish.z, 0.42);
    vec3 finCol = mix(skin, vec3(1.0), 0.35);
    vec3 tint = mix(vec3(0.02, 0.14, 0.18), col, 0.5);
    float murk = mix(0.36, 0.1, rise);
    col = mix(col, mix(finCol * (0.85 + 0.15 * rays), tint, murk), fill(fish.y * L) * 0.6);
    col = mix(col, mix(skin * 0.55, tint, murk), fill(fish.x * L - PX * 1.2));
    col = mix(col, mix(skin, tint, murk), fill(fish.x * L));
    // Its eyes.
    vec2 eye = vec2(fish.z - 0.36, abs(fish.w) - 0.068);
    col = mix(col, mix(vec3(0.05, 0.05, 0.08), tint, murk), fill(length(eye) * L - L * 0.018));
  }
  return col;
}
vec3 scene(vec2 fc) {
  vec2 p = (fc - 0.5 * uRes) / uRes.y;
  PX = 1.0 / uRes.y;
  float aspect = uRes.x / uRes.y;
  float wide = min(aspect, 1.6);
  float t = uTime;
  float v = voice();
  // The pond: dark and still in the middle, mossy toward the edges, light wavering on the bottom.
  vec3 col = mix(vec3(0.04, 0.22, 0.26), vec3(0.02, 0.1, 0.14), smoothstep(0.1, 0.8, length(p * vec2(0.7, 1.0))));
  col *= 0.94 + 0.06 * sin(p.x * 5.0 + sin(p.y * 4.0 + t * 0.2) * 1.5);
  // The koi: two circling ovals (one each way) and one swimming figures of eight across the middle, their loops lying
  // along the screen's longer side. Drawn from the bottom up, so where they cross the higher one is whole and its
  // shadow falls on the one below.
  float side = smoothstep(0.7, 1.2, aspect);
  float k = wide / 1.6;
  float narrow = clamp(aspect / 0.46, 1.0, 1.5);
  float L = 0.2 * clamp(0.4 + aspect * 0.5, 0.6, 1.0);
  float calm = mix(0.4, 1.0, side);
  vec4 loop0 = mix(vec4(-0.045 * narrow, 0.08, 0.33, 0.165 * narrow), vec4(-0.22 * k, 0.08, 0.45 * k, 0.28), side);
  vec4 loop1 = mix(vec4(0.045 * narrow, -0.08, 0.33, 0.16 * narrow), vec4(0.24 * k, -0.1, 0.42 * k, 0.27), side);
  vec4 loop2 = mix(vec4(0.0, 0.0, 0.38, 0.0), vec4(0.0, 0.02, 0.6 * k, 0.0), side);
  // A figure of eight a third as wide as it is long turns most gently.
  loop2.w = loop2.z / 3.0;
  float tilt0 = mix(1.6008, 0.1, side);
  float tilt1 = mix(1.5408, -0.12, side);
  float tilt2 = mix(1.5708, 0.05, side);
  // (One loop rather than three calls: the D3D compiler then builds the koi once instead of three times, twice as fast.)
  for (int j = 0; j < 3; j++) {
    float i = 2.0 - float(j);
    vec4 shape = i < 0.5 ? loop0 : (i < 1.5 ? loop1 : loop2);
    float tilt = i < 0.5 ? tilt0 : (i < 1.5 ? tilt1 : tilt2);
    col = drawKoi(col, p, i, t, shape, tilt, calm, L * (i < 0.5 ? 1.0 : (i < 1.5 ? 0.92 : 1.06)));
  }
  // Rings where each kissed the surface.
  float kiss = max(max(kissRings(p, 0.0, t, loop0, tilt0, calm, L), kissRings(p, 1.0, t, loop1, tilt1, calm, L * 0.92)),
                   kissRings(p, 2.0, t, loop2, tilt2, calm, L * 1.06));
  col = mix(col, vec3(0.8, 0.95, 0.97), kiss * 0.7);
  // The rings of raindrops landing all over the pond (more while the coach speaks).
  vec2 rq = p * 4.0;
  vec2 home = floor(rq - 0.5);
  float rate = 0.35 + v * 0.3;
  float ring = rings(p, home, t, rate) + rings(p, home + vec2(1.0, 0.0), t, rate) + rings(p, home + vec2(0.0, 1.0), t, rate) + rings(p, home + vec2(1.0, 1.0), t, rate);
  col = mix(col, vec3(0.75, 0.92, 0.95), clamp(ring, 0.0, 1.0) * 0.6);
  // Raindrops falling past, short slanting dashes.
  vec2 dq = vec2((p.x + p.y * 0.15) * 26.0, p.y * 4.0 + t * 2.4);
  vec2 did = floor(dq);
  vec2 df = fract(dq) - vec2(0.5, 0.0);
  float drop = step(hash12(did), 0.12 + v * 0.06) * fill((abs(df.x) - 0.04) / 26.0) * step(df.y, 0.25) * (df.y / 0.25);
  col = mix(col, vec3(0.8, 0.92, 1.0), drop * 0.45);
  // Lily pads drifting and turning, a shadow under each, one with a flower.
  float bestPad = 1e3;
  vec2 pc = vec2(0.0);
  float pr = 0.05;
  float pid = 0.0;
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    vec2 at = vec2((hash11(fi * 3.3) - 0.5) * 1.5 * min(aspect, 1.6), (hash11(fi * 5.1 + 1.0) - 0.5) * 0.8) + 0.02 * vec2(sin(t * 0.15 + fi), cos(t * 0.12 + fi * 2.0));
    float rr = 0.04 + 0.03 * hash11(fi + 7.0);
    float d = length(p - at) - rr;
    float pick = step(d, bestPad);
    bestPad = mix(bestPad, d, pick);
    pc = mix(pc, at, pick);
    pr = mix(pr, rr, pick);
    pid = mix(pid, fi, pick);
  }
  vec2 pl = p - pc;
  float twist = atan(pl.y, pl.x) - (t * 0.05 + pid);
  float notch = abs(fract(twist / TAU) - 0.5) * TAU;
  float pad = max(length(pl) - pr, (0.25 - notch) * length(pl));
  col = mix(col, col * 0.55, fill(length(pl - vec2(0.008, -0.01)) - pr) * 0.6);
  vec3 leaf = mix(vec3(0.28, 0.62, 0.3), vec3(0.4, 0.75, 0.35), 0.5 + 0.5 * sin(atan(pl.y, pl.x) * 9.0));
  col = mix(col, leaf, fill(pad));
  col = mix(col, vec3(0.2, 0.48, 0.25), outline(length(pl) - pr * 0.5, 0.0012) * fill(pad) * 0.5);
  // The flower: pink petals round a yellow heart, on the biggest pad.
  float flower = step(abs(pid - 2.0), 0.5);
  float petals = length(pl) - 0.028 * (0.6 + 0.4 * abs(cos(atan(pl.y, pl.x) * 3.0 + t * 0.1)));
  col = mix(col, vec3(1.0, 0.6, 0.75), fill(petals) * flower);
  col = mix(col, vec3(1.0, 0.85, 0.3), fill(length(pl) - 0.008) * flower);
  return col;
}
`

/** A topographic map in the coach's colours, slowly changing shape: contour lines flowing over terraced depths, a beam
 *  sweeping round lighting the lines it passes, and pings spreading. */
const CONTOURS = /* glsl */ `${TOON}
float height(vec2 p, float t) {
  vec2 w = p + 0.25 * vec2(sin(p.y * 2.2 + t * 0.07), cos(p.x * 1.9 - t * 0.06));
  return fbm3(w * 1.6 + vec2(t * 0.015, -t * 0.01)) + 0.35 * sin(w.x * 1.3 + 1.0) * cos(w.y * 1.7 - 0.5);
}
vec3 scene(vec2 fc) {
  vec2 p = (fc - 0.5 * uRes) / uRes.y;
  PX = 1.0 / uRes.y;
  float aspect = uRes.x / uRes.y;
  float t = uTime;
  float v = voice();
  float h = height(p, t);
  float level = h * 22.0;
  float band = floor(level);
  float f = fract(level);
  // Terraces: each band a flat step of colour, from the deep to the coach's colours on the heights.
  float k = clamp(band / 22.0, 0.0, 1.0);
  vec3 deep = vec3(0.02, 0.03, 0.1);
  vec3 col = mix(deep, mix(uB, vec3(0.25, 0.12, 0.55), 0.55) * 0.45, smoothstep(0.15, 0.5, k));
  col = mix(col, mix(uA, vec3(1.0, 0.8, 0.5), 0.25) * 0.55, smoothstep(0.5, 0.85, k));
  // Each terrace a touch lighter than the one below it, so they read as steps.
  col *= 0.86 + 0.14 * mod(band, 2.0);
  // The lines between terraces, one in five drawn heavier.
  float width = fwidth(level);
  float line = 1.0 - smoothstep(0.0, width * 1.4, min(f, 1.0 - f));
  float major = step(mod(band + 0.5, 5.0), 1.0);
  vec3 ink = mix(vec3(0.75, 0.95, 1.0), uA, 0.3);
  // The beam: lights the lines it passes, fading behind it.
  vec2 centre = vec2(0.25 * min(aspect, 1.6) * smoothstep(0.7, 1.2, aspect), 0.0);
  vec2 rel = p - centre;
  float behind = mod(t * (0.7 + v * 0.5) - atan(rel.y, rel.x), TAU);
  float lit = exp(-behind * 1.5);
  col += ink * line * (0.22 + 0.25 * major + lit * 0.8);
  col = mix(col, col + ink * 0.08, lit * (1.0 - smoothstep(0.6, 0.9, length(rel))));
  col += ink * outline(min(behind, TAU - behind) * length(rel), 0.0012) * (1.0 - smoothstep(0.6, 0.9, length(rel))) * 0.6;
  // Pings spreading from the centre every three seconds.
  float ping = fract(t / 3.0);
  col += ink * outline(length(rel) - ping * 0.8, 0.002) * (1.0 - ping) * (0.5 + v * 0.5);
  col = mix(col, vec3(1.0), fill(length(rel) - 0.008));
  col += ink * exp(-length(rel) / 0.03) * (0.3 + 0.2 * sin(t * 4.0));
  // The chart's grid of small crosses.
  vec2 go = fract(p * 6.0) - 0.5;
  float mark = fill(min(abs(go.x), abs(go.y)) / 6.0 - 0.0008) * step(max(abs(go.x), abs(go.y)), 0.06);
  col += ink * mark * 0.25;
  return col;
}
`

export const ART_SHADERS = {
  "snells-window": SNELLS_WINDOW,
  lagoon: LAGOON,
  "paper-tide": PAPER_TIDE,
  "infinity-edge": INFINITY_EDGE,
  "night-swim": NIGHT_SWIM,
  marbled: MARBLED,
  rainfall: RAINFALL,
  contours: CONTOURS,
} as const
