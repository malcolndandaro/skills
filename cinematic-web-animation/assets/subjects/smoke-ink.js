// @template field
/* SMOKE / INK — rising, curling volume: domain-warped fbm that is born low and dissolves high.
   Monochrome by default (uTint). For ink in water, set uTint dark on a light background by inverting: 1.0 - result.
   Knobs: uSpeed, uScale, uTint. */

/* 1 ─ CONFIG ---------------------------------------------------------------------- */
const CONFIG = {
  resolutionScale: 0.6,
  post: { exposure: 1.0, grain: 0.04, vignette: 0.35 },
  subject: { uSpeed: 1.0, uScale: 1.3, uTint: [0.75, 0.78, 0.85] },
};

/* 2 ─ FIELD ---------------------------------------------------------------------- */
const FIELD_GLSL = /* glsl */`
uniform float uSpeed, uScale; uniform vec3 uTint;

vec3 field(vec2 uv, vec2 p, float t) {
  t *= uSpeed * 0.1;
  vec2 q = p * uScale; q.y -= t * 1.2;                                              // everything rises
  vec2 w = vec2(fbm(q + vec2(t * 0.5, 0.0)), fbm(q + vec2(7.3, 2.1) - t * 0.4));    // warp: curls and tongues
  float n = fbm(q + 2.2 * (w - 0.5) + vec2(0.0, -t * 0.6));
  float d = smoothstep(0.35, 0.80, n);
  d *= smoothstep(-1.1, -0.2, p.y) * smoothstep(1.2, 0.1, p.y);                     // born near the bottom, gone near the top
  d *= smoothstep(1.6, 0.2, abs(p.x) - 0.3 * w.y);                                  // a plume, not a wall
  return vec3(0.01) + uTint * d * (0.55 + 0.45 * w.x);
}`;
