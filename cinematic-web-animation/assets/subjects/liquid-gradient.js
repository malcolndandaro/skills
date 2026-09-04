// @template field
/* LIQUID GRADIENT — slow, glossy, brand-coloured blobs melting into each other (the "mesh gradient" look).
   The right tool for LIGHT backgrounds and product pages: no additive blending, so pastels and whites work.
   Domain-warped fbm decides where each colour lives; a faint sheen adds the glossy feel.
   Knobs: uColorA..D (four brand colours, linear RGB 0..1), uSpeed, uScale. Very cheap at resolutionScale 0.5. */

/* 1 ─ CONFIG ---------------------------------------------------------------------- */
const CONFIG = {
  resolutionScale: 0.5,
  post: { exposure: 1.0, grain: 0.03, vignette: 0.12 },
  subject: {
    uColorA: [0.42, 0.18, 0.84],   // violet
    uColorB: [0.13, 0.55, 0.95],   // azure
    uColorC: [0.98, 0.45, 0.55],   // coral
    uColorD: [0.98, 0.78, 0.35],   // amber
    uSpeed: 1.0, uScale: 0.9,
  },
};

/* 2 ─ FIELD ---------------------------------------------------------------------- */
const FIELD_GLSL = /* glsl */`
uniform vec3 uColorA, uColorB, uColorC, uColorD; uniform float uSpeed, uScale;

vec3 field(vec2 uv, vec2 p, float t) {
  t *= uSpeed * 0.08;
  vec2 q = p * uScale;
  vec2 w = vec2(fbm(q + vec2(t, -t * 0.7)), fbm(q + vec2(3.1 - t * 0.6, 1.7 + t)));   // warp field
  vec2 r = q + 2.5 * (w - 0.5);
  float n1 = fbm(r + t * 0.5);
  float n2 = fbm(r * 1.7 - vec2(t, 0.0) + 7.0);
  float n3 = fbm(r * 0.8 + 3.0 * w);
  vec3 col = mix(uColorA, uColorB, smoothstep(0.25, 0.75, n1));
  col = mix(col, uColorC, smoothstep(0.45, 0.85, n2) * 0.85);
  col = mix(col, uColorD, smoothstep(0.60, 0.95, n3) * 0.75);
  col += 0.10 * smoothstep(0.55, 0.80, n1) * (1.0 - uv.y * 0.5);                    // soft sheen toward the top
  return col;
}`;
