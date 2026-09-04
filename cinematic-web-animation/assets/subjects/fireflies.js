// @template full
/* FIREFLIES — a few hundred large, soft lights wandering over a dark forest floor, each blinking on its own rhythm.
   Lesson: the beauty is in restraint. 900 particles, big sprites, strong bloom, low threshold, and most of the time
   each firefly is nearly off. pow(sin, 6) turns a sine into a short flash with a long dark gap.
   Knobs: uDrift (wander speed), uBlink (flash rate multiplier). */

/* ── 1. CONFIG ─────────────────────────────────────────────────────────────── */
const CONFIG = {
  count: 900,
  backgroundRatio: 0,
  maxPointSize: 96,
  sizeScale: 2.6,              // the sprite's visible core is ~⅓ of the point; big soft lights need big points
  twinkleSpeed: 0,             // blinking is done by the subject
  breath: 0,
  intro: { duration: 2.5, propagation: 0.5 },
  lens:  { enabled: true, radius: 0.35, magnification: 1.15, illumination: 0.8 },
  scroll:{ drift: 0.1, scatter: 0.02, shrink: 0.05 },
  post:  { bloom: 0.9, threshold: 0.5, exposure: 1.8, grain: 0.04, vignette: 0.4 },
  palette: { cool: [1.00, 0.85, 0.35], warm: [0.75, 1.00, 0.40] },   // amber -> green-yellow
  clearColor: [0.01, 0.02, 0.012],
  subject: { uDrift: 1.0, uBlink: 1.0 },
};

/* ── 2. SUBJECT ─────────────────────────────────────────────────────────────── */
function generateSubject(N) {
  const seed = new Float32Array(N * 4), dna = new Float32Array(N * 4), scatter = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    const x = (Math.random() * 2 - 1) * 2.0, y = (Math.random() * 2 - 1) * 1.1;
    seed[i * 4] = x; seed[i * 4 + 1] = y;
    seed[i * 4 + 2] = 0.35 + Math.random() * 0.9;        // blink rate (Hz-ish)
    seed[i * 4 + 3] = Math.random() * 6.2832;            // blink phase
    dna[i * 4]     = 4 + Math.pow(Math.random(), 1.5) * 12;   // large soft sprites
    dna[i * 4 + 1] = 0.5 + Math.random() * 0.5;
    dna[i * 4 + 2] = Math.random();
    dna[i * 4 + 3] = Math.random() * 6.2832;
    scatter[i * 4] = x; scatter[i * 4 + 1] = y; scatter[i * 4 + 2] = Math.random(); scatter[i * 4 + 3] = 0;
  }
  return { seed, dna, scatter };
}

const SUBJECT_GLSL = /* glsl */`
uniform float uDrift, uBlink;
void subject(float t, vec4 seed, vec4 dna, vec4 scatter, inout Particle o) {
  float ph = dna.w, td = t * uDrift;
  o.pos = seed.xy + vec2(sin(td * 0.31 + ph) * 0.08 + sin(td * 0.13 + ph * 2.1) * 0.15,
                         sin(td * 0.27 + ph * 1.3) * 0.06 + sin(td * 0.09 + ph) * 0.10);
  float blink = pow(0.5 + 0.5 * sin(t * seed.z * uBlink * 3.0 + seed.w), 6.0);   // short flash, long pause
  o.emphasis = 0.06 + blink;                             // faint ember between flashes
  o.cross = 0.0;
  o.depth = 0.0;
}`;

// Forest night: floor -> sky gradient, faint moon, low fog.
const FIELD_GLSL = /* glsl */`
vec3 field(vec2 uv, vec2 p, float t) {
  vec3 col = mix(vec3(0.010, 0.020, 0.012), vec3(0.015, 0.03, 0.06), uv.y);
  float moon = exp(-length((p - vec2(0.9, 0.7)) * vec2(1.0, 1.3)) * 2.2);
  col += vec3(0.35, 0.45, 0.6) * moon * 0.22;
  float fog = fbm(vec2(p.x * 1.5 + t * 0.02, uv.y * 3.0)) * smoothstep(0.6, 0.0, uv.y);
  col += vec3(0.06, 0.10, 0.07) * fog;
  return col;
}`;
