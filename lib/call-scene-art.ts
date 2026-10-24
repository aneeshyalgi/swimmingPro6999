import { SWIMMER } from "@/lib/call-scene-shaders"

/*
 * More of the scenes behind the coach chat and the voice call, as GLSL ES 1.00 `vec3 scene(vec2 fc)` shaders like the
 * first ones (lib/call-scene-shaders.ts), with smoother (gradient) noise. Each moves on its own and answers the coach:
 * `voice()` stirs it.
 *
 * `p` is a pixel's place with the screen's middle at 0 and its height running from -0.5 to 0.5, so every scene is
 * composed around the middle and holds on a phone (narrow) as well as a wide screen.
 */

/** Gradient noise, cells, a caustic net and the finishing touches these scenes share. */
const HELPERS = /* glsl */ `
vec2 grad2(vec2 i) { float a = hash12(i) * TAU; return vec2(cos(a), sin(a)); }
float gnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = dot(grad2(i), f);
  float b = dot(grad2(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0));
  float c = dot(grad2(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0));
  float d = dot(grad2(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0));
  return clamp(0.5 + 0.75 * mix(mix(a, b, u.x), mix(c, d, u.x), u.y), 0.0, 1.0);
}
float gfbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 6; i++) { v += a * gnoise(p); p = OCTAVE * p * 2.03 + 1.7; a *= 0.5; }
  return v / 0.984;
}
float gfbm4(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * gnoise(p); p = OCTAVE * p * 2.03 + 1.7; a *= 0.5; }
  return v / 0.9375;
}
// The nearest cell point (x), the second nearest (y) and the nearest cell's own random number (z).
vec3 cells(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float d1 = 8.0;
  float d2 = 8.0;
  float id = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      float d = length(g + hash22(i + g) - f);
      if (d < d1) { d2 = d1; d1 = d; id = hash12(i + g + 17.3); }
      else if (d < d2) { d2 = d; }
    }
  }
  return vec3(d1, d2, id);
}
// Sunlight focused by moving ripples into a bright net on whatever lies under the water (repeats every 1 in uv).
float causticNet(vec2 uv, float t) {
  vec2 base = mod(uv * TAU, TAU);
  // The pattern's own offset of -250, wrapped to a turn for the angles (kept small, so precise) and kept for the scale.
  vec2 p = base - 4.9557;
  vec2 m = base - 250.0;
  vec2 i = p;
  float c = 1.0;
  for (int n = 0; n < 4; n++) {
    float tt = t * (1.0 - 3.5 / float(n + 1));
    i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1.0 / length(vec2(m.x * 0.005 / sin(i.x + tt), m.y * 0.005 / cos(i.y + tt)));
  }
  c = 1.17 - pow(c / 4.0, 1.4);
  return pow(abs(c), 8.0);
}
vec3 aces(vec3 x) { return clamp(x * (2.51 * x + 0.03) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
float band(float x, float a, float b, float soft) { return smoothstep(a - soft, a + soft, x) * (1.0 - smoothstep(b - soft, b + soft, x)); }
float vignette(vec2 fc, float strength) {
  vec2 v = fc / uRes - 0.5;
  v.x *= mix(1.0, uRes.x / uRes.y, 0.5);
  return 1.0 - strength * smoothstep(0.25, 0.9, length(v) * 1.25);
}
vec2 seg2(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return vec2(length(pa - ba * h), h);
}
`

/** Underwater, looking up: the whole sky squeezed into a rippling circle in the surface, light falling in shafts,
 *  bubbles rising, and now and then a swimmer gliding across overhead. */
const SNELLS_WINDOW = /* glsl */ `${HELPERS}${SWIMMER}
vec3 scene(vec2 fc) {
  vec2 p = (fc - 0.5 * uRes) / uRes.y;
  float aspect = uRes.x / uRes.y;
  float px = 1.0 / uRes.y;
  float t = uTime;
  float v = voice();
  float R = min(0.38, aspect * 0.62);
  float k = R / 0.38;
  vec2 c = vec2(0.0, 0.15);

  // Ripples running across the surface bend everything seen through it; the coach's voice stirs them up.
  vec2 s1 = p * 4.0 / k;
  vec2 w = (vec2(gnoise(s1 + vec2(3.1 + t * 0.11, t * 0.07)), gnoise(s1 + vec2(11.7 - t * 0.08, t * 0.1))) - 0.5) * 0.6;
  w += 0.3 * (vec2(gnoise(p * 9.0 / k + vec2(1.3, t * 0.25)), gnoise(p * 9.0 / k + vec2(7.9 - t * 0.22, 0.0))) - 0.5);
  w += 0.16 * vec2(sin(dot(p, vec2(23.0, 9.0)) / k - t * 1.7), sin(dot(p, vec2(-11.0, 21.0)) / k - t * 1.4));
  w += 0.07 * vec2(sin(dot(p, vec2(-41.0, 30.0)) / k - t * 2.3), sin(dot(p, vec2(37.0, 44.0)) / k - t * 2.1));
  vec2 q = p + w * 0.018 * k * (1.0 + v * 0.9);
  vec2 d = (q - c) / R;
  float r = length(d);
  float ang = atan(d.y, d.x);

  // The sky: deep blue overhead in the middle, the horizon squeezed bright and warm against the rim.
  float hz = pow(clamp(r, 0.0, 1.0), 2.2);
  vec3 sky = mix(vec3(0.03, 0.26, 0.70), vec3(0.22, 0.58, 0.94), smoothstep(0.0, 0.7, hz));
  sky = mix(sky, vec3(0.72, 0.90, 1.0), smoothstep(0.55, 0.95, hz));
  sky = mix(sky, vec3(0.98, 0.86, 0.70), smoothstep(0.86, 1.0, r) * 0.45);
  float cloud = gfbm4(d * 2.0 + vec2(4.0 + t * 0.018, 1.0 + t * 0.006));
  sky = mix(sky, vec3(0.92, 0.96, 1.0), smoothstep(0.56, 0.8, cloud) * 0.5 * (1.0 - hz * 0.7));
  // Trees on the shore, seen from below through the rim, stirring in the wind.
  float grove = smoothstep(0.38, 0.56, gnoise(vec2(ang * 1.4 + 2.0, 0.0)));
  float leaves = gfbm4(vec2(ang * 22.0 + 0.04 * sin(t * 0.9 + ang * 3.0), r * 30.0));
  float treeline = 0.99 - grove * (0.06 + 0.07 * gnoise(vec2(ang * 6.0, 3.0)) + 0.04 * (leaves - 0.5));
  sky = mix(sky, mix(vec3(0.02, 0.12, 0.15), vec3(0.07, 0.25, 0.25), leaves), smoothstep(treeline - 0.012, treeline + 0.006, r));
  // The sun, high and to one side: a burst of light, turning slowly, broken into glints by the ripples.
  vec2 sp = vec2(-0.34, 0.30);
  float sd = length(d - sp);
  float sa = atan(d.y - sp.y, d.x - sp.x);
  float burst = pow(gnoise(vec2(sa * 5.0 + t * 0.05, 0.5)), 3.0) * 1.3 + pow(gnoise(vec2(sa * 13.0 - t * 0.08, 3.0)), 6.0);
  float glints = pow(gnoise(q * 70.0 / k + vec2(t * 0.9, -t * 0.7)), 12.0) * 24.0 * exp(-sd * 11.0);
  sky += vec3(1.0, 0.95, 0.82) * ((1.0 - smoothstep(0.055, 0.07, sd)) * 3.0 + exp(-sd * 9.0) * 0.9 + burst * exp(-sd * 2.8) * 0.3 + glints * (1.0 + v));

  // Beyond the rim the surface is a mirror of the deep: dark blue, mottled, crinkling where it catches the light.
  float out1 = max(r - 1.0, 0.0);
  float mottle = gfbm4(q * 3.5 / k + vec2(9.0 + t * 0.03, -t * 0.02));
  vec3 mirror = mix(vec3(0.02, 0.30, 0.46), vec3(0.006, 0.05, 0.11), smoothstep(0.0, 1.4, out1));
  mirror *= 0.8 + 0.45 * mottle;
  float crinkle = pow(1.0 - abs(2.0 * gnoise(q * 18.0 / k + vec2(t * 0.35, t * 0.2)) - 1.0), 22.0);
  mirror += vec3(0.6, 0.9, 1.0) * crinkle * exp(-out1 * 14.0) * (0.35 + v * 0.4);

  // The rim: a bright ring, with the colours split apart at its edge.
  vec3 m = vec3(1.0) - smoothstep(vec3(0.986), vec3(1.0), r * vec3(1.0, 1.01, 1.022));
  vec3 col = sky * m + mirror * (vec3(1.0) - m);
  col += vec3(0.7, 0.93, 1.0) * exp(-abs(r - 0.994) * 90.0) * (0.45 + v * 0.3);

  // A swimmer glides across overhead every so often: a silhouette against the sky, faint against the mirror.
  float lap = mod(t, 23.0);
  float travel = 0.5 * aspect + 0.45 * k;
  vec2 body = (q - vec2(mix(-travel, travel, lap / 11.0), c.y + 0.05 * k)) / (0.7 * k);
  if (lap < 11.0 && abs(body.x) < 0.4 && abs(body.y) < 0.3) {
    float sw = swimmer(body, t);
    float shape = 1.0 - smoothstep(-0.006, 0.006 + px / (0.7 * k), sw);
    float lit = 1.0 - smoothstep(0.97, 1.03, r);
    col = mix(col, mix(vec3(0.004, 0.03, 0.06), vec3(0.01, 0.07, 0.13), 0.3 + 0.7 * lit) * (0.6 + 0.4 * lit), shape * (0.55 + 0.4 * lit));
    // Light caught along their edges, from the sky behind them.
    col += vec3(0.6, 0.85, 1.0) * exp(-abs(sw) / 0.006) * lit * 0.25 * (1.0 - shape);
  }

  // Light falls from the window in shafts that sway and flicker, through water that thickens to blue below.
  vec2 fromC = p - c;
  float ra = atan(fromC.y, fromC.x) + 0.04 * sin(t * 0.21);
  float shafts = pow(gnoise(vec2(ra * 5.0, t * 0.09)), 2.0) * 0.7 + pow(gnoise(vec2(ra * 14.0, 4.0 + t * 0.17)), 3.0) * 0.5;
  float away = length(fromC / R);
  float reach = exp(-out1 * 0.8) * smoothstep(0.98, 1.2, away);
  col += vec3(0.30, 0.75, 1.0) * shafts * reach * (0.42 + v * 0.35);
  col = mix(col, vec3(0.01, 0.16, 0.28), (1.0 - smoothstep(-0.5, 0.15, p.y)) * 0.3 * smoothstep(1.0, 1.25, away));

  // A lane rope floats across the surface, rising and falling with the ripples; its floats glow in the window.
  vec2 ld = normalize(vec2(1.0, -0.2));
  vec2 ln = vec2(-ld.y, ld.x);
  vec2 lo = c + vec2(0.0, -0.17) * k;
  float along = dot(q - lo, ld);
  float across = dot(q - lo, ln) - 0.005 * k * sin(along * 7.0 / k - t * 1.1) - 0.002 * k * sin(t * 0.7);
  float gap = 0.04 * k;
  float cell = floor(along / gap + 0.5);
  float la = along - cell * gap;
  float halfLen = 0.017 * k;
  float rad = 0.011 * k;
  float fd = length(vec2(max(abs(la) - (halfLen - rad), 0.0), across)) - rad;
  float floatMask = 1.0 - smoothstep(-1.5 * px, 0.0, fd);
  float lit = 1.0 - smoothstep(0.96, 1.04, length((q - c) / R));
  vec3 tone = mod(cell, 4.0) < 2.0 ? vec3(0.10, 0.38, 1.0) : vec3(0.92, 0.96, 1.0);
  float roundness = 1.0 - pow(clamp(abs(across) / rad, 0.0, 1.0), 2.0);
  float ridges = 0.86 + 0.14 * sin(la / halfLen * 9.0 + cell * 1.7 + t * 0.6);
  vec3 floatCol = mix(vec3(0.005, 0.03, 0.06) + tone * 0.05, tone * (0.55 + 0.65 * roundness), lit) * ridges;
  float rope = (1.0 - smoothstep(0.0016 * k, 0.0016 * k + 1.5 * px, abs(across))) * (1.0 - floatMask);
  col = mix(col, floatCol, floatMask);
  col = mix(col, vec3(0.01, 0.05, 0.08), rope * 0.8);

  // Specks drifting up through the water, catching the light.
  vec2 gp = (p + vec2(0.006 * sin(t * 0.3), -t * 0.008)) * 34.0;
  vec2 gi = floor(gp);
  float gh = hash12(gi);
  if (gh < 0.2) {
    vec2 go = hash22(gi * 1.3) - 0.5;
    float gd = length(fract(gp) - 0.5 - go * 0.6) / 34.0;
    float gr = (0.7 + gh * 4.0) * px * max(uScale, 0.8);
    col += vec3(0.6, 0.9, 1.0) * exp(-gd * gd / (gr * gr)) * (0.15 + 0.5 * reach + 0.3 * lit) * (0.6 + 0.4 * sin(t * 1.7 + gh * 90.0));
  }

  // A stream of bubbles rising toward the window, wobbling, smaller as they go up and away. They're evenly spaced up
  // the stream, so a pixel only looks at the nearest three.
  float wideK = min(1.0, aspect / 0.9);
  float rise = (p.y + 0.66) / 0.64;
  if (abs(p.x - 0.2 * wideK) < 0.12 && rise > -0.1 && rise < 1.1) {
    float slot = floor((rise - fract(t * 0.045)) * 14.0 + 0.5);
    for (int j = -1; j <= 1; j++) {
      float fi = slot + float(j);
      float at = fi / 14.0 + fract(t * 0.045);
      float h = hash11(mod(fi, 64.0) * 3.7 + 1.0);
      float wob = 0.012 * sin(t * (2.2 + h * 2.0) + fi * 2.1) * (1.0 - at);
      vec2 bp = vec2((0.2 + 0.05 * sin(fi * 1.7 + at * 4.0) + (h - 0.5) * 0.06) * wideK + wob, -0.66 + at * 0.64);
      float br = mix(0.032, 0.006, at) * (0.6 + 0.8 * h) * smoothstep(0.0, 0.06, at) * (1.0 - smoothstep(0.9, 1.0, at));
      vec2 bv = p - bp;
      float dist = length(bv * vec2(1.0, 1.12 + 0.12 * sin(t * 6.0 + fi)));
      float disc = 1.0 - smoothstep(br - 1.5 * px, br, dist);
      float rim = disc * smoothstep(br * 0.6, br, dist);
      vec2 hl = bv - vec2(-0.35, 0.4) * br;
      float spec = exp(-dot(hl, hl) / (br * br * 0.035 + 1e-7));
      col = mix(col, col * 1.06 + vec3(0.02, 0.05, 0.07), disc * 0.6);
      col += vec3(0.6, 0.9, 1.0) * rim * 0.5 + vec3(1.0) * spec * disc * 0.85;
    }
  }

  col *= vignette(fc, 0.55);
  return aces(col * 1.1);
}
`

/** From the air: an island's trees and beach, reef shallows netted with sunlight, surf breaking on the reef, a boat
 *  crossing the blue beyond, and a manta ray gliding through the lagoon. */
const LAGOON = /* glsl */ `${HELPERS}
float shore(vec2 p) {
  vec2 q = rot(0.6) * p;
  return q.x + 0.28 * (gfbm4(p * 1.0 + 2.0) - 0.5) + 0.05 * (gnoise(p * 4.5) - 0.5);
}
// A manta ray from above, nose toward +x: 1 inside it, 0 outside, its wings beating. Its wings sweep back to points,
// their trailing edges curving in.
float manta(vec2 l, float flap) {
  float r = abs(l.y) / (0.06 * (0.9 + 0.1 * cos(flap)));
  float bend = 0.006 * sin(flap) * r * r;
  float lead = 0.022 - 0.036 * pow(r, 1.25) + bend;
  float trail = mix(-0.02, -0.014, r) + 0.009 * sin(PI * r) + bend;
  float wing = smoothstep(-0.0015, 0.0015, lead - l.x) * smoothstep(-0.0015, 0.0015, l.x - trail) * step(r, 1.0);
  // The horns in front, and the long thin tail.
  float horns = 1.0 - smoothstep(0.0015, 0.003, length(vec2(l.x - 0.025, abs(l.y) - 0.008)) - 0.0015);
  float tail = (1.0 - smoothstep(0.0006, 0.0016, abs(l.y))) * step(-0.07, l.x) * step(l.x, -0.015);
  return max(max(wing, horns), tail * 0.7);
}
vec3 scene(vec2 fc) {
  vec2 p = (fc - 0.5 * uRes) / uRes.y;
  float aspect = uRes.x / uRes.y;
  float px = 1.0 / uRes.y;
  float t = uTime;
  float v = voice();
  float s = shore(p);
  float depth = s + 0.24;             // below 0: dry land
  float dd = max(depth, 0.0);
  vec2 n = vec2(cos(0.6), -sin(0.6));  // across the shore, out to sea
  vec2 tng = vec2(-n.y, n.x);          // along it
  float across = dot(p, n);
  // Sand, grainy where it can be seen (on the beach and through the shallows).
  float grain = dd < 0.5 ? gnoise(p * 160.0) * 0.35 + gnoise(p * 38.0) * 0.35 + gfbm4(p * 6.0) * 0.3 : 0.5;
  vec3 sand = mix(vec3(0.84, 0.78, 0.62), vec3(0.97, 0.93, 0.80), grain);
  vec3 col;

  // The manta's path: along the lagoon, parallel to the beach, coming round every forty seconds.
  float run = mod(t, 40.0) / 40.0;
  float span = 0.7 * max(aspect, 1.0) + 0.3;
  vec2 heading = normalize(tng + n * 0.18 * cos(run * TAU * 1.5));
  vec2 mAt = n * (-0.075 + 0.025 * sin(run * TAU * 1.5)) + tng * mix(-span, span, run);
  vec2 rel = p - mAt;
  float flap = t * 2.1;

  if (depth > -0.03) {
    // The floor: sand rippled in the shallows, coral heads further out, each in a ring of pale sand.
    vec3 floorCol = sand;
    if (dd < 0.22) {
      float ripple = gnoise(vec2(across * 230.0, dot(p, tng) * 28.0) + gnoise(p * 9.0) * 2.0) - 0.5;
      floorCol *= 1.0 + 0.16 * ripple * band(dd, 0.01, 0.18, 0.04);
    }
    if (dd > 0.03 && dd < 0.34) {
      vec3 cr = cells(p * 14.0 + (vec2(gnoise(p * 5.0), gnoise(p * 5.0 + 3.0)) - 0.5) * 1.6);
      float zone = band(dd, 0.07, 0.30, 0.04) * smoothstep(0.42, 0.72, gfbm4(p * 2.6 + 7.0)) * step(cr.z, 0.8);
      float r = cr.x * (0.8 + 0.6 * cr.z) + (gnoise(p * 90.0) - 0.5) * 0.12;
      floorCol *= 1.0 + 0.12 * zone * band(r, 0.28, 0.42, 0.04);
      vec3 coralCol = mix(vec3(0.20, 0.17, 0.10), vec3(0.40, 0.30, 0.18), cr.z) * (0.75 + 0.45 * gnoise(p * 120.0));
      floorCol = mix(floorCol, coralCol, zone * (1.0 - smoothstep(0.16, 0.28, r)));
    }
    // Sunlight netted across the floor by the moving surface: strongest in the shallows.
    if (dd < 0.4) {
      float net = causticNet(p * 5.0 + vec2(0.0, 0.3), t * 0.45);
      floorCol *= 0.82 + net * 0.9 * (1.0 - smoothstep(0.02, 0.4, dd)) * (1.0 + v * 0.6);
    } else {
      floorCol *= 0.9;
    }
    // The manta's shadow on the sand, offset from it by the high sun.
    vec2 sh = rel - vec2(0.022, -0.018);
    if (dot(sh, sh) < 0.01) floorCol *= 1.0 - 0.32 * manta(vec2(dot(sh, heading), dot(sh, vec2(-heading.y, heading.x))), flap - 0.3) * (1.0 - smoothstep(0.1, 0.35, dd));

    // Water: red goes first, then green, so the shallows are turquoise and the deep is blue.
    vec3 absorb = exp(-dd * vec3(11.0, 3.6, 2.4));
    vec3 waterBody = mix(vec3(0.04, 0.58, 0.68), vec3(0.03, 0.22, 0.52), smoothstep(0.22, 0.6, dd));
    waterBody = mix(waterBody, vec3(0.015, 0.09, 0.30), smoothstep(0.55, 1.3, dd));
    col = floorCol * absorb + waterBody * (1.0 - absorb);
    // The manta itself, gliding a little above the floor.
    if (dot(rel, rel) < 0.01) {
      float ray = manta(vec2(dot(rel, heading), dot(rel, vec2(-heading.y, heading.x))), flap);
      col = mix(col, mix(col * vec3(0.2, 0.32, 0.38), vec3(0.04, 0.12, 0.17), 0.3), ray * 0.75);
    }

    // Swells rolling in across the deep water, and the sun glittering on them.
    float swell = sin(across * 48.0 + gnoise(p * 3.0) * 5.0 + t * 1.1);
    col *= 1.0 + 0.07 * swell * smoothstep(0.42, 0.7, dd);
    col *= 1.0 + (gnoise(p * 26.0 + 3.0 + t * 0.05) - gnoise(p * 26.0 + vec2(0.06, 3.0) + t * 0.05)) * 0.1 * smoothstep(0.0, 0.3, dd);
    float glitter = pow(gnoise(p * 120.0 + vec2(t * 0.7, -t * 0.5)), 22.0) * smoothstep(0.35, 0.6, dd) * smoothstep(0.2, 1.0, swell);
    col += vec3(1.0, 0.98, 0.9) * glitter * (6.0 + v * 8.0);

    // Surf breaking on the reef: each wave a white line that runs in and fades, foam drifting in behind it.
    float crest = 0.38;
    float surf = 0.0;
    float trail = 0.0;
    if (abs(dd - 0.33) < 0.12) {
      for (int i = 0; i < 2; i++) {
        float fi = float(i);
        float phase = fract(t * 0.11 + fi * 0.5 + (gnoise(p * 1.6 + fi * 9.0) - 0.5) * 0.25);
        float at = crest + 0.015 - phase * 0.075 + (gnoise(p * 3.0 + fi * 5.0) - 0.5) * 0.025;
        float broken = smoothstep(0.35, 0.68, gfbm4(p * 7.0 + fi * 11.0 + tng * phase * 0.4));
        float width = (0.006 + 0.012 * (1.0 - phase)) * (0.5 + broken);
        surf += (1.0 - smoothstep(width * 0.25, width, abs(dd - at))) * broken * (1.0 - phase) * smoothstep(0.0, 0.08, phase);
      }
      trail = band(dd, crest - 0.1, crest + 0.01, 0.02)
        * smoothstep(0.55, 0.85, gnoise(p * 60.0 + gnoise(p * 8.0) * 3.0 + n * t * 0.25)) * 0.5;
    }
    col = mix(col, vec3(0.95, 0.99, 1.0), clamp(surf + trail, 0.0, 1.0));

    // The swash: the water's edge sliding up the beach and back, darkening the sand it wets.
    float reach = 0.006 + 0.007 * gnoise(p * 12.0) + 0.006 * sin(t * 0.55 + dot(p, tng) * 4.0);
    float wet = smoothstep(-0.03, reach - 0.02, depth) * (1.0 - smoothstep(reach - 0.002, reach + 0.003, depth));
    col = mix(col, col * vec3(0.78, 0.8, 0.82), wet * 0.6);
    float swash = 1.0 - smoothstep(0.0, 0.0025 + 0.003 * gnoise(p * 40.0 + t * 0.3), abs(depth - reach));
    col = mix(col, vec3(1.0), swash * 0.85);
  }
  if (depth < 0.004) {
    // The beach, and the island's trees behind it, their crowns stirring.
    vec3 dry = mix(vec3(0.89, 0.79, 0.60), vec3(0.99, 0.94, 0.81), grain) * (0.95 + 0.1 * gfbm4(p * 3.0));
    float woods = -0.15 - 0.035 * gfbm4(p * 7.0) - 0.01 * gnoise(p * 40.0);
    vec3 land = dry;
    if (depth < woods + 0.006) {
      vec2 cw = p * 30.0 + (vec2(gnoise(p * 6.0), gnoise(p * 6.0 + 4.0)) - 0.5) * 3.0;
      cw += 0.05 * vec2(sin(t * 0.9 + p.y * 30.0), cos(t * 0.8 + p.x * 30.0));
      vec3 canopy = cells(cw);
      float crown = 1.0 - smoothstep(0.0, 0.75, canopy.x);
      float bump = gfbm4(cw * 0.9);
      float sunlit = clamp(0.55 + (gfbm4(cw * 0.9 + vec2(-0.08, 0.08)) - bump) * 6.0, 0.0, 1.0);
      vec3 leafCol = mix(vec3(0.12, 0.30, 0.10), vec3(0.32, 0.50, 0.18), canopy.z * 0.7 + sunlit * 0.3);
      vec3 trees = mix(vec3(0.03, 0.12, 0.05), leafCol, crown * (0.5 + 0.5 * sunlit)) * (0.85 + 0.25 * gnoise(p * 90.0));
      land = mix(trees, dry, smoothstep(woods - 0.003, woods + 0.003, depth));
    }
    land *= 1.0 - 0.25 * exp(-max(depth - woods, 0.0) / 0.01) * step(woods, depth);
    land = mix(land, sand * 0.88, smoothstep(-0.03, 0.0, depth));
    col = depth > -0.03 ? mix(land, col, smoothstep(-0.002, 0.004, depth)) : land;
  }

  // A boat crossing the deep water, its wake opening behind it.
  vec2 bdir = -tng;
  float voyage = mod(t + 12.0, 36.0) / 36.0;
  vec2 bo = n * 0.36 + tng * mix(0.8, -0.8, voyage);
  vec2 bl = vec2(dot(p - bo, bdir), dot(p - bo, vec2(-bdir.y, bdir.x)));
  if (bl.x < 0.02 && bl.x > -0.6 && abs(bl.y) < 0.2) {
    float hull = length(vec2(max(abs(bl.x) - 0.011, 0.0), bl.y)) - 0.004;
    float wake = 0.0;
    if (bl.x < 0.0) {
      float back = -bl.x;
      wake = (1.0 - smoothstep(0.0, 0.004 + back * 0.06, abs(abs(bl.y) - back * 0.28))) * exp(-back * 18.0) * 0.8;
      wake += (1.0 - smoothstep(0.0, 0.006 + back * 0.05, abs(bl.y))) * exp(-back * 22.0);
      wake *= 0.45 + 0.55 * gnoise(p * 160.0 + bdir * t * 0.6);
    }
    float open = smoothstep(0.3, 0.45, dd);
    col = mix(col, vec3(0.92, 0.97, 1.0), clamp(wake, 0.0, 1.0) * 0.75 * open);
    col = mix(col, col * 0.6, (1.0 - smoothstep(0.0, 0.007, hull - 0.002)) * 0.5 * open);
    col = mix(col, vec3(1.0, 0.99, 0.96), (1.0 - smoothstep(-px, px, hull)) * open);
  }

  // Shadows of clouds drifting over.
  col *= 1.0 - 0.26 * smoothstep(0.58, 0.76, gfbm4(p * 1.4 + vec2(12.0 - t * 0.012, 3.0 + t * 0.006)));
  col *= vignette(fc, 0.35);
  return aces(col * 1.05);
}
`

/** Waves cut from paper and layered at dusk, rolling past one another, with a paper boat riding them and gulls going
 *  over against the sun. */
const PAPER_TIDE = /* glsl */ `${HELPERS}
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
vec3 scene(vec2 fc) {
  vec2 p = (fc - 0.5 * uRes) / uRes.y;
  float aspect = uRes.x / uRes.y;
  float px = 1.0 / uRes.y;
  float t = uTime;
  float v = voice();
  float wide = max(0.8, min(aspect, 1.6));
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
  float cloudsWide = 1.3 * max(aspect, 1.0) + 0.4;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float cx = mod((fi - 1.0) * 0.32 * min(aspect, 1.3) + 0.05 + t * (0.006 + fi * 0.002) + cloudsWide * 0.5, cloudsWide) - cloudsWide * 0.5;
    vec2 cq = p - vec2(cx, 0.27 + 0.05 * sin(fi * 2.3));
    float puff = min(min(length(cq - vec2(-0.05, 0.0)) - 0.035, length(cq - vec2(0.0, 0.012)) - 0.045), length(cq - vec2(0.055, 0.0)) - 0.03);
    puff = max(puff, -cq.y - 0.012);
    col *= 1.0 - 0.22 * exp(-max(puff + 0.004, 0.0) / 0.01) * step(0.0, puff) * step(cq.y, 0.0);
    col = mix(col, vec3(0.99, 0.84, 0.76) * (0.92 + 0.08 * smoothstep(-0.01, 0.04, cq.y)), 1.0 - smoothstep(-px, px, puff));
  }
  col += stars(p * 0.6, t, 0.1) * smoothstep(0.3, 0.5, p.y) * 0.5;
  // Three gulls folded from paper, beating their wings as they cross in front of the sun.
  float flight = 1.2 * max(aspect, 1.0) + 0.3;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float gx = mod(sunAt.x - 0.16 - fi * 0.075 + t * 0.022 + flight * 0.5, flight) - flight * 0.5;
    vec2 bAt = vec2(gx, sunAt.y + 0.13 + 0.035 * sin(fi * 2.4) + 0.008 * sin(t * 0.9 + fi));
    float s = 0.018 - fi * 0.003;
    vec2 bq = (p - bAt) / s;
    float beat = sin(t * (3.2 + fi * 0.4) + fi * 2.0);
    float wing = abs(bq.y - (0.55 * beat * pow(abs(bq.x), 0.75) - 0.3 * beat)) - 0.13 * (1.0 - abs(bq.x));
    col = mix(col, vec3(0.20, 0.13, 0.28), (1.0 - smoothstep(0.0, 0.08, wing)) * step(abs(bq.x), 1.0));
  }

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
  float slope = (edge(bx + 0.01, 3.0, t, lift) - edge(bx - 0.01, 3.0, t, lift)) / 0.02;
  vec2 keel = vec2(bx * wide / 1.3, edge(bx, 3.0, t, lift) - 0.016);
  vec2 bq = rot(atan(slope) * 0.8) * (p - keel) / 1.6;
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

/** An infinity pool at sunset: its far edge spills into the sea, swells roll in under a glittering road of light, a
 *  sailboat creeps along the horizon, and birds cross the sky. */
const INFINITY_EDGE = /* glsl */ `${HELPERS}
float island(float x, float aspect) {
  float at = (x + 0.36 * min(aspect, 1.5)) / 0.16;
  float body = 1.0 - smoothstep(0.0, 1.0, abs(at));
  float peak = exp(-pow((at + 0.25) * 2.2, 2.0)) * 0.045 + exp(-pow((at - 0.45) * 3.0, 2.0)) * 0.025;
  return max(0.0, (peak + 0.008 * body) * body * (0.85 + 0.3 * gnoise(vec2(x * 40.0, 2.0))));
}
// A sailboat on the horizon (base at the origin, in screen units): 1 inside its sails and hull.
float sailboat(vec2 q) {
  float hull = step(abs(q.x), 0.012 - q.y * 0.6) * step(-0.004, q.y) * step(q.y, 0.0012);
  float main = step(0.0016, q.y) * step(q.y, 0.03) * step(-0.0005, q.x) * step(q.x, (0.03 - q.y) * 0.33);
  float jib = step(0.0016, q.y) * step(q.y, 0.024) * step(q.x, -0.0015) * step(-(0.024 - q.y) * 0.3 - 0.0015, q.x);
  return max(hull, max(main, jib));
}
vec3 sky(vec2 p, float horizon, vec2 sun, float aspect, float t) {
  float h = max(p.y - horizon, 0.0);
  vec3 c = mix(vec3(1.0, 0.70, 0.36), vec3(0.98, 0.46, 0.28), smoothstep(0.0, 0.05, h));
  c = mix(c, vec3(0.44, 0.25, 0.36), smoothstep(0.04, 0.1, h));
  c = mix(c, vec3(0.12, 0.20, 0.34), smoothstep(0.08, 0.2, h));
  c = mix(c, vec3(0.025, 0.055, 0.13), smoothstep(0.2, 0.45, h));
  // Long thin clouds lit from below, drifting.
  float streak = gfbm4(vec2(p.x * 1.4 + t * 0.006, h * 14.0) + vec2(3.0, 1.0));
  float cloud = smoothstep(0.55, 0.78, streak) * band(h, 0.03, 0.28, 0.04);
  c = mix(c, mix(vec3(1.0, 0.6, 0.4), vec3(0.42, 0.30, 0.42), smoothstep(0.04, 0.24, h)), cloud * 0.7);
  float sd = length(p - sun);
  c += vec3(1.0, 0.45, 0.16) * exp(-sd * 7.0) * 0.55 + vec3(1.0, 0.62, 0.28) * exp(-sd * 26.0) * 0.45;
  c = mix(c, mix(vec3(1.15, 0.62, 0.24), vec3(1.05, 0.40, 0.16), smoothstep(-0.03, 0.03, sun.y - p.y)), 1.0 - smoothstep(0.039, 0.042, sd));
  // A low island on the horizon, and a sailboat creeping along it, both in silhouette.
  float isl = island(p.x, aspect);
  c = mix(c, vec3(0.20, 0.08, 0.20), step(h, isl) * step(0.0005, isl));
  float sailRange = 1.2 * max(aspect, 1.0);
  float sailX = mod(t * 0.01 + 0.5, sailRange) - sailRange * 0.5;
  c = mix(c, vec3(0.16, 0.06, 0.16), sailboat(vec2(p.x - sailX, p.y - horizon - 0.001)));
  return c;
}
vec3 scene(vec2 fc) {
  vec2 p = (fc - 0.5 * uRes) / uRes.y;
  float aspect = uRes.x / uRes.y;
  float px = 1.0 / uRes.y;
  float t = uTime;
  float v = voice();
  float horizon = 0.12;
  float lip = -0.05;
  vec2 sun = vec2(0.18 * min(aspect, 1.0), horizon + 0.012);
  float dist = horizon - p.y;
  float z = 1.0 / max(dist, 0.002);
  // Where the sky is seen from here: straight up (the air shimmering just above the horizon), or in the water.
  vec2 at = p + vec2((gnoise(vec2(p.y * 300.0, t * 2.0)) - 0.5) * 0.002 * exp(-abs(dist) * 60.0), 0.0);
  float swell = 0.0;
  float ripple = 0.0;
  float near = 1.0 - smoothstep(-0.5, lip, p.y);
  if (p.y <= horizon && p.y > lip) {
    swell = gnoise(vec2(p.x * z * 1.2, z * 1.6 + t * 0.5)) * 0.65 + gnoise(vec2(p.x * z * 3.5 - t * 0.1, z * 5.0 + t * 0.9)) * 0.35;
    at = vec2(p.x, horizon + dist * 1.4 + (swell - 0.5) * 0.06 * min(dist * 8.0, 1.0));
  } else if (p.y <= lip) {
    ripple = (gnoise(vec2(p.x * z * 2.5 + t * 0.06, z * 6.0 - t * 0.35)) - 0.5) * 0.7 + (gnoise(vec2(p.x * z * 9.0 - t * 0.1, z * 22.0 - t * 0.8)) - 0.5) * 0.3;
    ripple *= 1.0 + v * 0.8;
    at = vec2(p.x + ripple * 0.004, horizon + dist + ripple * 0.02 * near);
  }
  vec3 seen = sky(at, horizon, sun, aspect, t);
  vec3 col;
  if (p.y > horizon) {
    col = seen;
    // Birds crossing the sky in a loose line, wings beating slowly.
    float flock = 1.2 * max(aspect, 1.0) + 0.4;
    for (int i = 0; i < 5; i++) {
      float fi = float(i);
      float bx = mod(-t * 0.016 + fi * 0.045 + 0.4, flock) - flock * 0.5;
      vec2 bAt = vec2(bx, horizon + 0.2 + fi * 0.012 + 0.01 * sin(fi * 2.7) + 0.004 * sin(t * 0.6 + fi));
      vec2 bq = (p - bAt) / (0.009 - fi * 0.0007);
      float beat = sin(t * 2.6 + fi * 1.3);
      float wing = abs(bq.y - (0.5 * beat * pow(abs(bq.x), 0.8) - 0.25 * beat)) - 0.16 * (1.0 - abs(bq.x));
      col = mix(col, vec3(0.12, 0.06, 0.14), (1.0 - smoothstep(0.0, 0.12, wing)) * step(abs(bq.x), 1.0) * 0.9);
    }
  } else if (p.y > lip) {
    // The sea: swells rolling in with the sky in them, and the sun's road glittering across.
    vec3 sea = mix(vec3(0.05, 0.04, 0.12), seen * 0.75, 0.45 + 0.25 * swell);
    sea = mix(seen * 0.9, sea, smoothstep(0.0, 0.03, dist));
    float road = exp(-pow((p.x - sun.x) / (0.012 + dist * 0.55), 2.0));
    float glint = pow(gnoise(vec2(p.x * z * 5.0, z * 22.0 + t * 2.2)), 5.0) * 5.0 + pow(gnoise(vec2(p.x * z * 11.0 - t * 0.5, z * 40.0 + t * 3.0)), 9.0) * 12.0;
    col = sea + vec3(1.0, 0.62, 0.30) * road * (0.3 + glint * (1.0 + v * 1.2)) * 0.9;
  } else {
    // The pool: calm water mirroring the sky, turning clear over its tiles close by, sunlight netted on the floor.
    vec2 tile = vec2(p.x * z, z) * 22.0;
    vec2 tg = abs(fract(tile) - 0.5);
    float grout = smoothstep(0.42, 0.49, max(tg.x, tg.y));
    vec3 floorCol = mix(vec3(0.05, 0.45, 0.55), vec3(0.03, 0.30, 0.40), grout * 0.6) * (0.92 + 0.08 * hash12(floor(tile)));
    floorCol *= 0.75 + causticNet(vec2(p.x * z, z) * 0.9, t * 0.5) * 0.9 * near;
    vec3 body = mix(vec3(0.01, 0.09, 0.14), floorCol, pow(near, 1.5));
    float fres = mix(0.95, 0.35, pow(near, 1.4));
    col = mix(body, seen, fres);
    col += vec3(1.0, 0.65, 0.35) * exp(-pow((p.x - sun.x + ripple * 0.01) / (0.01 + (lip - p.y) * 0.06), 2.0)) * (1.0 - near * 0.7) * 0.6;
    // The lip: a fine bright line where the water slips over the edge, glinting as it goes.
    float spill = 0.75 + 0.5 * pow(gnoise(vec2(p.x * 90.0 + t * 0.4, t * 0.6)), 3.0);
    col += vec3(1.0, 0.8, 0.62) * exp(-abs(p.y - lip + 0.0015) / (1.2 * px)) * 0.6 * spill;
    col *= 1.0 - 0.3 * exp(-(lip - p.y) / 0.004);
  }
  col *= vignette(fc, 0.5);
  return aces(col * 1.1);
}
`

/** A pool at night, lit from below: glowing water with a swimmer doing laps, palms swaying over it, lanterns, a
 *  string of lights, fireflies and the stars. */
const NIGHT_SWIM = /* glsl */ `${HELPERS}${SWIMMER}
// A palm in silhouette, its fronds stirring in the breeze: how far p is outside it.
float palm(vec2 p, vec2 base, float height, float lean, float size, float seed, float t) {
  float d = 1e3;
  vec2 crown = base + vec2(lean, height);
  float up = clamp((p.y - base.y) / height, 0.0, 1.0);
  if (abs(p.x - base.x - lean * up * up) < 0.04 * size && p.y < crown.y + 0.02) {
    vec2 prev = base;
    for (int i = 1; i <= 6; i++) {
      float u = float(i) / 6.0;
      vec2 at = base + vec2(lean * u * u, height * u);
      d = min(d, segment(p, prev, at) - mix(0.016, 0.007, u) * size);
      prev = at;
    }
  }
  if (length(p - crown) < 0.26 * size) {
    d = min(d, length(p - crown) - 0.014 * size);
    for (int f = 0; f < 10; f++) {
      float ff = float(f);
      float a = ff / 10.0 * TAU + seed + 0.07 * sin(t * 0.9 + ff * 1.7);
      vec2 dir = normalize(vec2(cos(a), sin(a) * 0.5 + 0.3));
      float len = (0.16 + 0.06 * hash11(ff + seed * 10.0)) * size;
      float droop = 0.12 * size * (0.5 + 0.5 * abs(dir.x)) * (1.0 + 0.12 * sin(t * 1.3 + ff * 2.3));
      vec2 q0 = crown;
      for (int s = 1; s <= 5; s++) {
        float u1 = float(s) / 5.0;
        vec2 q1 = crown + dir * len * u1 - vec2(0.0, droop * u1 * u1);
        vec2 sg = seg2(p, q0, q1);
        float u = (float(s) - 1.0 + sg.y) / 5.0;
        float leaflets = 0.3 + 0.7 * (1.0 - fract(u * 26.0 + ff * 0.37));
        d = min(d, sg.x - 0.016 * size * (1.0 - u * 0.8) * leaflets);
        q0 = q1;
      }
    }
  }
  return d;
}
vec3 scene(vec2 fc) {
  vec2 p = (fc - 0.5 * uRes) / uRes.y;
  float aspect = uRes.x / uRes.y;
  float px = 1.0 / uRes.y;
  float t = uTime;
  float v = voice();
  float horizon = 0.14;
  float camH = 0.42;
  float wide = min(aspect, 1.6);
  vec3 col;
  if (p.y >= horizon) {
    // The night sky, a moon and twinkling stars, and now and then a shooting star.
    col = mix(vec3(0.05, 0.10, 0.22), vec3(0.012, 0.025, 0.07), smoothstep(horizon, 0.5, p.y));
    col += stars(p, t, 0.16) * 0.8 + brightStars(p, t, 0.07) * 0.5;
    vec2 moonAt = vec2(-0.16 * wide, 0.42);
    float md = length(p - moonAt);
    col += vec3(0.6, 0.7, 0.9) * exp(-md * 9.0) * 0.18;
    col = mix(col, vec3(0.92, 0.94, 0.88) * (0.9 + 0.1 * gnoise(p * 60.0)), 1.0 - smoothstep(0.022, 0.024, md));
    float cycle = floor(t / 13.0);
    float m = mod(t, 13.0);
    if (m < 0.8) {
      vec2 a = vec2((hash11(cycle) - 0.3) * wide * 0.8, 0.3 + 0.15 * hash11(cycle + 3.0));
      vec2 dir = normalize(vec2(-0.85, -0.42));
      vec2 head = a + dir * m * 0.45;
      float along = dot(p - head, -dir);
      float trail = exp(-pow(segment(p, head, head - dir * 0.1) / (0.0015 + 0.0006 * uScale), 2.0)) * smoothstep(0.1, 0.0, along);
      col += vec3(0.85, 0.95, 1.0) * trail * sin(m / 0.8 * PI);
    }
    // The garden wall at the far end, with lanterns flickering along it.
    float hedge = horizon + 0.04 + 0.012 * gfbm4(vec2(p.x * 9.0, 1.0));
    if (p.y < hedge) {
      col = mix(vec3(0.01, 0.025, 0.03), vec3(0.03, 0.06, 0.07), gnoise(p * 80.0));
      col += vec3(0.0, 0.5, 0.55) * exp(-(p.y - horizon) / 0.02) * 0.12;
    }
    for (int i = 0; i < 5; i++) {
      float fi = float(i);
      vec2 lan = vec2((fi - 2.0) * 0.32 * wide, horizon + 0.03);
      float ld = length((p - lan) * vec2(1.0, 0.8));
      float flicker = 0.8 + 0.2 * gnoise(vec2(t * 4.0, fi * 7.0)) + 0.1 * sin(t * 13.0 + fi * 3.0);
      col += vec3(1.0, 0.68, 0.32) * (exp(-ld * 90.0) * 1.2 + exp(-ld * 25.0) * 0.15) * flicker;
    }
  } else {
    // The ground in perspective: the pool, its stone edge, and the wet deck around it.
    float z = camH / (horizon - p.y);
    vec2 g = vec2(p.x * z, z);
    float poolW = 0.9;
    float nearZ = 0.9;
    float farZ = 7.0;
    float inX = poolW - abs(g.x);
    float inZ = min(g.y - nearZ, farZ - g.y);
    float inside = min(inX, inZ);
    // The underwater lights along the far wall and the sides.
    float glow = 0.0;
    for (int i = 0; i < 3; i++) {
      vec2 l = vec2((float(i) - 1.0) * 0.55, farZ - 0.05);
      glow += 1.3 / (1.0 + dot(g - l, g - l) * 10.0);
    }
    for (int i = 0; i < 4; i++) {
      float lz = nearZ + 1.2 + float(i) * 1.5;
      glow += 0.5 / (1.0 + dot(g - vec2(-poolW, lz), g - vec2(-poolW, lz)) * 9.0) + 0.5 / (1.0 + dot(g - vec2(poolW, lz), g - vec2(poolW, lz)) * 9.0);
    }
    glow *= 1.0 + v * 0.35;
    if (inside > 0.0) {
      // The water: lit from inside, its floor striped with lanes and netted with moving light.
      vec2 w = g + (vec2(gnoise(g * 2.0 + t * 0.15), gnoise(g * 2.0 + 5.0 - t * 0.12)) - 0.5) * 0.02;
      float lanes = 1.0 - smoothstep(0.02, 0.03, abs(fract(w.x / 0.36 + 0.5) - 0.5) * 0.36);
      lanes *= step(nearZ + 0.4, w.y) * step(w.y, farZ - 0.4);
      float net = causticNet(w * 0.55, t * 0.55);
      vec3 water = vec3(0.0, 0.62, 0.70) * (0.22 + glow * 0.9);
      water *= 1.0 - lanes * 0.55;
      water += vec3(0.4, 1.0, 1.0) * net * (0.16 + glow * 0.3) * (1.0 + v * 0.5);
      // A swimmer doing laps, a dark shape under the lit water.
      float lapLength = farZ - nearZ - 1.2;
      float leg = mod(t * 0.32, lapLength * 2.0);
      float headTo = leg < lapLength ? 1.0 : -1.0;
      float sz = nearZ + 0.6 + (leg < lapLength ? leg : lapLength * 2.0 - leg);
      vec2 local = vec2((w.y - sz) * headTo, w.x - 0.18) / 1.15;
      if (abs(local.x) < 0.35 && abs(local.y) < 0.25) {
        float sw = swimmer(local, t);
        water *= 1.0 - 0.7 * (1.0 - smoothstep(-0.015, 0.025, sw));
        // Their wake: the water churned bright around them.
        water += vec3(0.5, 1.0, 1.0) * exp(-max(sw, 0.0) / 0.03) * 0.08 * (0.5 + 0.5 * gnoise(local * 30.0 + t * 3.0));
      }
      // The surface mirrors the night (and the lights strung over it) more and more toward the far end.
      float fres = clamp(0.08 + (z - 1.0) * 0.05, 0.0, 0.55);
      water = mix(water, vec3(0.02, 0.05, 0.12), fres * 0.6);
      float wob = gnoise(vec2(g.x * 14.0 + t * 0.4, g.y * 3.0 - t * 0.6));
      water += vec3(1.0, 0.75, 0.4) * pow(wob, 12.0) * 3.0 * smoothstep(3.0, 6.0, z);
      water *= 1.0 - 0.6 * exp(-inside / 0.03);
      col = water;
    } else {
      // The coping, lit by the pool, then the deck's big wet slabs, the light rippling across them.
      float coping = 1.0 - smoothstep(0.12, 0.14, -inside);
      vec2 slab = g / 0.55;
      vec2 sf = abs(fract(slab) - 0.5);
      float joint = smoothstep(0.47, 0.49, max(sf.x, sf.y));
      vec3 deck = mix(vec3(0.05, 0.06, 0.07), vec3(0.09, 0.10, 0.11), hash12(floor(slab))) * (1.0 - joint * 0.5);
      deck += vec3(0.0, 0.45, 0.5) * exp(inside / 0.25) * 0.35 * (0.5 + 0.5 * glow);
      deck += vec3(0.0, 0.5, 0.55) * pow(gnoise(g * 3.0 + vec2(t * 0.2, -t * 0.15)), 4.0) * exp(inside / 0.4) * 0.25;
      vec3 stone = mix(vec3(0.5, 0.55, 0.55), vec3(0.75, 0.8, 0.78), gnoise(g * 20.0)) * (0.35 + glow * 0.4);
      col = mix(deck, stone, coping);
    }
    col = mix(col, vec3(0.02, 0.04, 0.08), smoothstep(5.0, 9.0, z) * 0.6);
  }
  // Fireflies drifting over the garden.
  for (int i = 0; i < 7; i++) {
    float fi = float(i);
    vec2 at = vec2((hash11(fi * 2.3) - 0.5) * 1.6 * wide, horizon - 0.06 + 0.16 * hash11(fi + 7.0));
    at += vec2(sin(t * (0.21 + 0.05 * fi) + fi * 2.0), cos(t * (0.17 + 0.04 * fi) + fi)) * vec2(0.08, 0.04);
    float blink = pow(0.5 + 0.5 * sin(t * (0.9 + 0.3 * hash11(fi + 3.0)) + fi * 4.0), 3.0);
    float fd = length(p - at);
    col += vec3(0.85, 1.0, 0.45) * (exp(-fd * 700.0) * 1.4 + exp(-fd * 90.0) * 0.12) * blink;
  }
  // A string of lights sagging across the top, swaying a little.
  float span = 0.6 * wide;
  float sway = 0.005 * sin(t * 0.7);
  float sx = clamp(p.x / span, -1.0, 1.0);
  float wireY = 0.37 - (0.07 + sway) * (1.0 - sx * sx);
  col = mix(col, vec3(0.02), (1.0 - smoothstep(0.0, 1.2 * px, abs(p.y - wireY))) * step(abs(p.x), span) * 0.8);
  float bulbX = (floor(p.x / 0.06) + 0.5) * 0.06;
  float bsx = clamp(bulbX / span, -1.0, 1.0);
  vec2 bulb = vec2(bulbX, 0.37 - (0.07 + sway) * (1.0 - bsx * bsx) - 0.01);
  float bd = length(p - bulb);
  float twinkle = 0.85 + 0.15 * sin(t * 2.0 + bulbX * 40.0);
  col += vec3(1.0, 0.72, 0.38) * (exp(-bd * 160.0) * 1.5 + exp(-bd * 40.0) * 0.18) * step(abs(bulbX), span) * twinkle;
  // Palms framing the scene, one each side.
  float ps = clamp(aspect * 0.9, 0.5, 1.0);
  float left = step(p.x, 0.0);
  float palms = palm(p, mix(vec2(0.5 * aspect + 0.06 * ps, -0.55), vec2(-0.5 * aspect - 0.02 * ps, -0.6), left), mix(0.82, 0.95, left),
    mix(-0.14, 0.12, left) * ps, mix(0.95, 1.15, left) * ps, mix(1.7, 0.3, left), t + 2.0 * (1.0 - left));
  col = mix(col, vec3(0.004, 0.01, 0.018), 1.0 - smoothstep(-px, px, palms));
  col *= vignette(fc, 0.55);
  return aces(col * 1.2);
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
vec2 swirl(vec2 q, vec2 c, float strength, float radius) {
  vec2 d = q - c;
  return c + rot(strength * exp(-dot(d, d) / (radius * radius))) * d;
}
// Which ink is at p: floor() picks it and fract() is how far across its band. The combed stripes give their own value;
// a drop gives 100 + 4 per drop + its ring (0 in the middle, 2 outside), so the rings run on from one to the next.
// rim: how far p is from the nearest drop's edge (below 0 inside it).
float marble(vec2 p, float t, float v, out float rim) {
  // The bath's eddies stir and settle; the coach's voice stirs them harder.
  float stir = 1.0 + 0.5 * v;
  vec2 q = swirl(p, vec2(-0.42, 0.12), 2.2 * sin(t * 0.05 + 1.0) * stir, 0.32);
  q = swirl(q, vec2(0.36, -0.16), -1.9 * sin(t * 0.043 + 2.5) * stir, 0.36);
  q = swirl(q, vec2(0.04, 0.3), 1.6 * sin(t * 0.037 + 4.0) * stir, 0.26);
  // Everything in the bath drifts slowly left.
  vec2 b = q + vec2(t * 0.04, 0.0);
  float aspect = uRes.x / uRes.y;
  // The drops, newest first: one lands every six seconds, spreads, and pushed what was there outward as it spread.
  float now = floor(t / 6.0);
  float found = -1.0;
  rim = 1e3;
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
    if (found < 0.0) {
      rim = min(rim, sqrt(dist2) - r);
      if (dist2 < r2) found = 100.0 + mod(k, 40.0) * 4.0 + 3.0 * dist2 / r2;
      else b = c + d * sqrt(1.0 - r2 / max(dist2, 1e-6));
    }
  }
  if (found > 0.0) return found;
  // Before them: stripes raked across and back, then combed.
  b *= 1.3;
  b.x += 0.035 * sin(b.y * 28.0);
  b.y += 0.055 * sin(b.x * 8.0 + 1.3);
  b += (vec2(gnoise(b * 2.5), gnoise(b * 2.5 + 5.0)) - 0.5) * 0.07;
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
  float v = marble(p, t, vo, rim);
  // How fast the bands change here (in bands a pixel): squeezed thinner than a pixel, they blend. Across a drop's
  // edge the value jumps, so there the edge is drawn by its distance instead.
  float dv = length(vec2(dFdx(v), dFdy(v)));
  float jump = step(4.0, dv);
  dv = min(dv, 1.0);
  float f = fract(v);
  float idx = floor(v);
  vec3 col = inkAt(idx);
  col *= 0.86 + 0.24 * smoothstep(0.0, 1.0, f) * (0.8 + 0.2 * gnoise(p * 300.0));
  // The middle of a drop has no edge.
  float edgeDist = idx > 99.5 && mod(idx - 100.0, 4.0) < 0.5 ? 1.0 - f : min(f, 1.0 - f);
  float vein = (1.0 - smoothstep(0.0, max(0.025, dv * 1.2), edgeDist)) * (1.0 - jump);
  float rimWidth = abs(dFdx(rim)) + abs(dFdy(rim));
  vein = max(vein, 1.0 - smoothstep(rimWidth * 0.6, rimWidth * 1.6, abs(rim)));
  col = mix(col, vec3(0.01, 0.01, 0.02), vein * 0.85);
  float sheen = 0.55 + 0.8 * pow(gnoise(p * 14.0 + vec2(2.0 + t * 0.05, 0.0)), 2.0);
  float gold = band(edgeDist, max(0.025, dv * 1.2), max(0.05, dv * 2.4), max(0.008, dv)) * (1.0 - jump);
  gold = max(gold, band(abs(rim), rimWidth * 1.6, rimWidth * 3.2, rimWidth * 0.5));
  col = mix(col, vec3(0.98, 0.79, 0.42) * sheen * (1.0 + vo * 0.5), gold * 0.6);
  // Squeezed past what a pixel can show: the average of the inks.
  vec3 average = (inks(0.5) + inks(1.5) + inks(2.5) + inks(3.5) + inks(4.5) + inks(5.5) + inks(6.5)) / 7.0;
  col = mix(col, average * 0.8, smoothstep(0.35, 0.9, dv) * (1.0 - jump));
  col *= 1.0 + (gnoise(p * vec2(80.0, 500.0)) - 0.5) * 0.04 + (gnoise(p * 320.0) - 0.5) * 0.03;
  col *= vignette(fc, 0.5);
  return col;
}
`

/** Rain on a still pool at dusk: drops falling, landing and ringing out through the reflection of a lamp, and now and
 *  then lightning glowing far off in the clouds. */
const RAINFALL = /* glsl */ `${HELPERS}
vec3 skyAt(vec2 p, float horizon, float wide, float t, float flash) {
  float h = p.y - horizon;
  vec3 c = mix(vec3(0.10, 0.19, 0.28), vec3(0.015, 0.04, 0.09), smoothstep(0.0, 0.45, h));
  c += vec3(0.95, 0.60, 0.34) * exp(-abs(h) * 28.0) * 0.14;
  // Low cloud drifting over, lit from inside when lightning flickers somewhere behind it.
  float cloud = gfbm4(vec2(p.x * 1.2 + t * 0.01, h * 5.0) + 4.0);
  c = mix(c, vec3(0.75, 0.82, 0.9), smoothstep(0.6, 0.8, cloud) * 0.05);
  c += vec3(0.55, 0.62, 0.85) * flash * smoothstep(0.35, 0.75, cloud) * exp(-length(p - vec2(0.3 * wide, horizon + 0.2)) * 2.5) * 0.3;
  // The far shore: a low dark line of trees, with lights along it.
  float shoreTop = 0.014 + 0.022 * gfbm4(vec2(p.x * 5.0, 1.0));
  if (h < shoreTop) c = mix(vec3(0.008, 0.016, 0.024), vec3(0.03, 0.05, 0.06), smoothstep(-0.01, shoreTop, h) * 0.4);
  for (int i = 0; i < 8; i++) {
    float fi = float(i);
    vec2 at = vec2((hash11(fi * 3.1) - 0.5) * 1.9 * wide, horizon + 0.006 + 0.008 * hash11(fi + 5.0));
    float d = length(p - at);
    float twinkle = 0.75 + 0.25 * sin(t * (1.5 + hash11(fi + 2.0) * 2.0) + fi * 4.0);
    c += mix(vec3(1.0, 0.74, 0.44), vec3(0.62, 0.85, 1.0), step(0.65, hash11(fi + 9.0))) * (exp(-d * 300.0) * 0.9 + exp(-d * 45.0) * 0.05) * twinkle;
  }
  // A lamp on a post at the water's edge.
  vec2 lamp = vec2(-0.17 * wide, horizon + 0.11);
  float ld = length(p - lamp);
  float hum = 0.95 + 0.05 * sin(t * 7.0) * sin(t * 2.3);
  c += vec3(1.0, 0.70, 0.38) * (exp(-ld * 70.0) * 1.6 + exp(-ld * 14.0) * 0.16 + exp(-ld * 4.0) * 0.04) * hum;
  float post = step(abs(p.x - lamp.x), 0.0022) * step(horizon - 0.01, p.y) * step(p.y, lamp.y - 0.01);
  c = mix(c, vec3(0.01, 0.015, 0.02), post);
  return c;
}
vec3 scene(vec2 fc) {
  vec2 p = (fc - 0.5 * uRes) / uRes.y;
  float aspect = uRes.x / uRes.y;
  float px = 1.0 / uRes.y;
  float t = uTime;
  float v = voice();
  float wide = max(0.9, min(aspect, 1.6));
  float horizon = 0.16;
  // Lightning, far off: a soft double flicker every so often.
  float storm = mod(t, 17.0);
  float flash = exp(-pow((storm - 3.0) / 0.06, 2.0)) + 0.6 * exp(-pow((storm - 3.25) / 0.09, 2.0));
  vec3 col;
  vec2 at = p;
  float down = horizon - p.y;
  float z = 0.12 / max(down, 1e-4);
  vec2 g = vec2(p.x * z, z);
  vec2 tilt = vec2(0.0);
  if (p.y < horizon) {
    // The water in perspective: how the raindrops' rings tilt its surface here. Each drop lands somewhere new each
    // time round; a pixel only looks at the four nearest cells.
    vec2 home = floor(g / 0.6 - 0.5);
    for (int y = 0; y <= 1; y++) {
      for (int x = 0; x <= 1; x++) {
        vec2 id = home + vec2(float(x), float(y));
        for (int k = 0; k < 2; k++) {
          float fk = float(k);
          float clock = t * (0.42 + 0.1 * hash12(id + fk * 5.3)) + hash12(id * 1.3 + fk * 9.1);
          float age = fract(clock);
          vec2 drop = (id + hash22(id * 1.7 + fk * 13.1 + floor(clock) * 0.37)) * 0.6;
          vec2 dv = g - drop;
          float r = length(dv);
          float off = r - (0.02 + age * 0.3);
          float packet = exp(-off * off / 0.0025) * (1.0 - age) * (1.0 - age);
          tilt += cos(off * 80.0) * packet * dv / max(r, 0.0001);
          // Just landed: a tight bright ring.
          tilt += cos(r * 160.0) * exp(-r * r / 0.0006) * (1.0 - smoothstep(0.0, 0.1, age)) * dv / max(r, 0.0001) * 0.7;
        }
      }
    }
    // Wind lines too, stretched across: they draw the lamp's reflection out into a long column.
    vec2 wind = g * vec2(6.0, 34.0) + vec2(t * 0.2, -t * 0.6);
    tilt += (vec2(gnoise(wind), gnoise(wind + 3.0)) - 0.5) * 0.45;
    // Calmer close to the far shore, so its reflection stays whole.
    tilt *= smoothstep(0.0, 0.06, down) * (1.0 + v * 0.5);
    at = vec2(p.x + tilt.x * 0.006, horizon + down * 0.95 + tilt.y * 0.02 * min(1.0, 0.5 + down * 4.0));
  }
  vec3 seen = skyAt(at, horizon, wide, t, flash);
  if (p.y >= horizon) {
    col = seen;
  } else {
    float fres = mix(0.95, 0.45, smoothstep(0.0, 0.5, down));
    col = mix(vec3(0.004, 0.018, 0.03), seen, fres);
    // Each ring's crests catch the last light of the sky; its troughs fall dark.
    col += vec3(0.34, 0.5, 0.62) * max(tilt.y, 0.0) * 0.22 * exp(-z * 0.12) * (1.0 + flash);
    col *= 1.0 + min(tilt.y, 0.0) * 0.25;
  }
  // Rain falling: two layers, the nearer longer and quicker, slanting a little in the wind.
  for (int l = 0; l < 2; l++) {
    float fl = float(l);
    vec2 rq = vec2((p.x + p.y * 0.08) * (70.0 - fl * 30.0), (p.y + t * (1.1 + fl * 0.7)) * (17.0 - fl * 7.0));
    vec2 cell = floor(rq);
    float h = hash12(cell + fl * 31.0);
    vec2 f = fract(rq) - vec2(0.2 + 0.6 * hash12(cell + 7.0), 0.0);
    float len = 0.35 + 0.3 * h;
    float streak = step(h, 0.16 + v * 0.08) * (1.0 - smoothstep(0.0, 0.08 + fl * 0.04, abs(f.x))) * step(0.0, f.y) * (1.0 - f.y / len) * step(f.y, len);
    col += vec3(0.62, 0.72, 0.85) * streak * (0.07 + fl * 0.06) * (1.0 + flash * 2.0);
  }
  col += vec3(0.4, 0.45, 0.6) * flash * 0.03;
  col *= vignette(fc, 0.55);
  return aces(col * 1.3);
}
`

/** A chart of the water's depth drifting under a boat whose sonar sweeps it: contour lines lighting up as the beam
 *  passes, pings spreading, echoes off things in the deep, and the coastline creeping with the tide. */
const CONTOURS = /* glsl */ `${HELPERS}
float terrain(vec2 p) {
  vec2 w = p + (vec2(gnoise(p * 0.8 + 1.0), gnoise(p * 0.8 + 6.0)) - 0.5) * 0.6;
  return gfbm(w * 1.5 + vec2(3.0, 1.0)) * 0.85 + 0.2 * gnoise(p * 0.5);
}
vec3 scene(vec2 fc) {
  vec2 p = (fc - 0.5 * uRes) / uRes.y;
  float aspect = uRes.x / uRes.y;
  float px = 1.0 / uRes.y;
  float t = uTime;
  float v = voice();
  // The chart drifts under the boat as it goes.
  vec2 heading = normalize(vec2(0.8, 0.35));
  vec2 u = p + heading * t * 0.008;
  float h = terrain(u);
  vec2 slope = vec2(dFdx(h), dFdy(h)) / px;
  float steep = max(length(slope) * px, 1e-5);
  float sea = 0.6 + 0.012 * sin(t * 0.13);
  vec3 col;
  float shade = clamp(0.6 + dot(normalize(vec3(-slope * 0.35, 1.0)), normalize(vec3(-0.6, 0.6, 0.5))) * 0.6, 0.0, 1.4);
  float interval = 0.022;
  float level = h / interval;
  float dc = abs(fract(level + 0.5) - 0.5) * interval;
  float line = 1.0 - smoothstep(steep * 0.6, steep * 1.6, dc);
  float major = step(mod(floor(level + 0.5), 5.0), 0.5);

  // The sonar: a beam turning round the boat, lighting what it passes, which then fades.
  vec2 boat = vec2(min(0.3 * aspect, 0.42), 0.12);
  vec2 rel = p - boat;
  float range = 0.62;
  float dist = length(rel);
  float turn = t * (0.9 + v * 0.5);
  float behind = mod(turn - atan(rel.y, rel.x), TAU);
  float swept = exp(-behind * 1.4) * (1.0 - smoothstep(range * 0.7, range, dist));
  vec3 ink = mix(vec3(0.3, 0.85, 1.0), mix(uA, uB, 0.4) * 1.2, 0.35);
  if (h < sea) {
    float depth = sea - h;
    float step_ = floor(depth / interval);
    vec3 shallow = vec3(0.04, 0.30, 0.38);
    vec3 deep = vec3(0.008, 0.035, 0.09);
    col = mix(shallow, deep, smoothstep(0.0, 0.32, step_ * interval));
    col *= 0.85 + 0.25 * shade;
    col += ink * line * (0.16 + 0.42 * major) * (1.0 + swept * 3.0);
    col += ink * 0.1 * swept * (1.0 - smoothstep(0.0, 0.3, depth));
  } else {
    float elev = h - sea;
    col = mix(vec3(0.07, 0.08, 0.09), vec3(0.13, 0.14, 0.14), smoothstep(0.0, 0.25, elev)) * (0.55 + 0.6 * shade);
    col += vec3(0.6, 0.6, 0.55) * line * (0.06 + 0.12 * major);
    col *= 1.0 + (gnoise(u * 220.0) - 0.5) * 0.08;
  }
  // The coastline, bright, and the surf along it as the tide works.
  float coast = 1.0 - smoothstep(steep * 1.0, steep * 2.4, abs(h - sea));
  col = mix(col, vec3(0.75, 0.97, 1.0), coast * 0.9);
  col += vec3(0.4, 0.8, 1.0) * exp(-max(sea - h, 0.0) / (steep * 6.0)) * step(h, sea) * 0.12 * (0.6 + 0.4 * sin(t * 1.3 + h * 300.0));

  // The beam itself, and the pings it sends out, spreading.
  float edge = exp(-pow(min(behind, TAU - behind) * dist / 0.004, 2.0)) * (1.0 - smoothstep(range * 0.7, range, dist));
  col += ink * edge * 0.7 + ink * swept * 0.1;
  float ping = fract(t / 3.0);
  col += ink * exp(-pow((dist - ping * range) / 0.004, 2.0)) * (1.0 - ping) * (0.35 + v * 0.4);
  // Echoes: things in the deep that glow as the beam finds them, then fade.
  vec2 cell = floor(u * 9.0);
  vec2 echoAt = (cell + 0.2 + 0.6 * hash22(cell + 41.0)) / 9.0;
  float echo = step(hash12(cell + 3.0), 0.12) * step(h, sea - 0.04);
  vec2 echoRel = echoAt - heading * t * 0.008 - boat;
  float echoBehind = mod(turn - atan(echoRel.y, echoRel.x), TAU);
  float found = exp(-echoBehind * 0.9) * (1.0 - smoothstep(range * 0.7, range, length(echoRel)));
  float blip = exp(-pow(length(u - echoAt) / 0.0035, 2.0)) * 1.4 + exp(-length(u - echoAt) / 0.012) * 0.25;
  col += vec3(0.6, 1.0, 0.9) * blip * echo * found;
  // The boat, and its track behind it, dashed, the dashes going with the chart.
  vec2 back = -heading;
  float alongTrack = dot(rel, back);
  float acrossTrack = dot(rel, vec2(-back.y, back.x));
  float dash = step(0.5, fract(alongTrack * 40.0 - t * 0.32));
  float track = (1.0 - smoothstep(0.6 * px, 1.6 * px, abs(acrossTrack))) * step(0.012, alongTrack) * dash * exp(-alongTrack * 2.5);
  col += vec3(0.85, 0.95, 1.0) * track * 0.5;
  float hull = length(vec2(dot(rel, heading) * 0.55, dot(rel, vec2(-heading.y, heading.x)))) - 0.006;
  col = mix(col, vec3(0.9, 0.98, 1.0), 1.0 - smoothstep(-px, px, hull));
  col += ink * exp(-max(hull, 0.0) / 0.01) * (0.25 + 0.15 * sin(t * 4.0));

  // The chart's grid, with a mark at each crossing, drifting with it.
  vec2 gp = u / 0.1;
  vec2 gf = abs(fract(gp) - 0.5) * 0.1;
  float grid = 1.0 - smoothstep(0.4 * px, 1.4 * px, min(gf.x, gf.y));
  col += vec3(0.5, 0.8, 1.0) * grid * 0.07;
  vec2 cross_ = abs(fract(gp + 0.5) - 0.5) * 0.1;
  float mark = (1.0 - smoothstep(0.5 * px, 1.5 * px, min(cross_.x, cross_.y))) * step(max(cross_.x, cross_.y), 0.008);
  col += vec3(0.7, 0.95, 1.0) * mark * 0.35;
  col *= vignette(fc, 0.55);
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
