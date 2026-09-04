// @template full
/* SNOW — flakes falling at three depths with parallax, gentle sway and a slow side wind, over a winter night.
   Wrapping pattern: y = top - fract(phase + t·speed)·range and x wraps with mod(), so nothing ever needs resetting.
   The same skeleton gives rain (tiny, fast, no sway), embers (rising: flip the sign), petals, ash, dust.
   Knobs: uFall (speed), uWind (drift). */

/* ── 1. CONFIG ─────────────────────────────────────────────────────────────── */
const CONFIG = {
  count: 6000,
  backgroundRatio: 0,
  maxPointSize: 48,
  sizeScale: 2.2,              // soft flakes need big points; the sprite core is ~⅓ of the point
  twinkleSpeed: 0.5,
  breath: 0,
  intro: { duration: 2.0, propagation: 0.2 },
  lens:  { enabled: true, radius: 0.3, magnification: 1.2, illumination: 0.3 },
  scroll:{ drift: 0.05, scatter: 0.0, shrink: 0.0 },
  post:  { bloom: 0.35, threshold: 0.8, exposure: 1.6, grain: 0.03, vignette: 0.3 },
  palette: { cool: [0.85, 0.92, 1.00], warm: [1.00, 1.00, 1.00] },
  clearColor: [0.02, 0.03, 0.06],
  subject: { uFall: 1.0, uWind: 0.3 },
};

/* ── 2. SUBJECT ─────────────────────────────────────────────────────────────── */
function generateSubject(N) {
  const seed = new Float32Array(N * 4), dna = new Float32Array(N * 4), scatter = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    const depth = Math.pow(Math.random(), 0.6);                         // 0 near … 1 far, more far flakes
    seed[i * 4] = (Math.random() * 2 - 1) * 2.2; seed[i * 4 + 1] = Math.random(); seed[i * 4 + 2] = depth; seed[i * 4 + 3] = Math.random();
    dna[i * 4]     = 2.0 + Math.random() * 4.0;
    dna[i * 4 + 1] = 0.5 + Math.random() * 0.5;
    dna[i * 4 + 2] = Math.random();
    dna[i * 4 + 3] = Math.random() * 6.2832;
    scatter[i * 4] = seed[i * 4]; scatter[i * 4 + 1] = 1.2; scatter[i * 4 + 2] = Math.random(); scatter[i * 4 + 3] = 0;
  }
  return { seed, dna, scatter };
}

const SUBJECT_GLSL = /* glsl */`
uniform float uFall, uWind;
void subject(float t, vec4 seed, vec4 dna, vec4 scatter, inout Particle o) {
  float depth = seed.z;
  float speed = mix(0.14, 0.05, depth) * uFall;                       // near flakes fall faster (parallax)
  float y = 1.15 - fract(seed.y + t * speed) * 2.3;
  float x = seed.x + sin(t * 0.6 + seed.w * 6.2832) * mix(0.06, 0.02, depth) + t * uWind * mix(0.05, 0.02, depth);
  x = mod(x + 2.2, 4.4) - 2.2;                                          // wrap horizontally
  o.pos = vec2(x, y);
  o.size = mix(1.6, 0.4, depth);
  o.depth = depth;
  o.emphasis = mix(1.0, 0.35, depth);
  o.reveal = seed.y;
  o.cross = 0.0;
}`;

// Winter night: dark blue sky, faint moon, ground fog.
const FIELD_GLSL = /* glsl */`
vec3 field(vec2 uv, vec2 p, float t) {
  vec3 col = mix(vec3(0.05, 0.07, 0.12), vec3(0.015, 0.02, 0.05), uv.y);
  col += vec3(0.5, 0.6, 0.8) * exp(-length((p - vec2(-0.8, 0.65)) * vec2(1.0, 1.2)) * 2.5) * 0.25;   // moon glow
  col += vec3(0.10, 0.12, 0.16) * fbm(vec2(p.x * 1.2 + t * 0.03, uv.y * 4.0)) * smoothstep(0.45, 0.0, uv.y);   // fog
  return col;
}`;
