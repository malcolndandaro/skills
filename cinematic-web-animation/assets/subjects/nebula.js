// @template full
/* NEBULA — domain-warped fbm clouds in two colours (field pass) with a sparse star layer on top.
   The clouds evolve very slowly; the stars only twinkle and drift a few pixels. Slowness is what makes it feel vast.
   Knobs: CONFIG.subject.uNebulaA / uNebulaB (cloud colours), uDrift (evolution speed), uScale (cloud size).
   Cost note: the field runs 4 fbm evaluations per pixel at full resolution. On weak GPUs lower CONFIG.count is
   irrelevant — instead port this field() to template-field.html and use resolutionScale 0.5. */

/* ── 1. CONFIG ─────────────────────────────────────────────────────────────── */
const CONFIG = {
  count: 4500,
  backgroundRatio: 0.7,        // most of the stars come from the engine's tiny background layer
  maxPointSize: 64,
  sizeScale: 1.0,
  twinkleSpeed: 1.4,
  breath: 0,
  intro: { duration: 4.0, propagation: 0.5 },
  lens:  { enabled: true, radius: 0.3, magnification: 1.25, illumination: 0.5 },
  scroll:{ drift: 0.15, scatter: 0.03, shrink: 0.1 },
  post:  { bloom: 0.6, threshold: 0.65, exposure: 1.6, grain: 0.04, vignette: 0.35 },
  palette: { cool: [0.75, 0.85, 1.00], warm: [1.00, 0.72, 0.50] },
  clearColor: [0, 0, 0],
  subject: { uNebulaA: [0.05, 0.45, 0.62], uNebulaB: [0.62, 0.10, 0.45], uDrift: 1.0, uScale: 1.1 },
};

/* ── 2. SUBJECT ─────────────────────────────────────────────────────────────── */
function generateSubject(N) {
  const seed = new Float32Array(N * 4), dna = new Float32Array(N * 4), scatter = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    const x = (Math.random() * 2 - 1) * 2.0, y = (Math.random() * 2 - 1) * 1.15;
    seed[i * 4] = x; seed[i * 4 + 1] = y; seed[i * 4 + 2] = Math.random() * 6.2832; seed[i * 4 + 3] = 0;
    dna[i * 4]     = 0.8 + Math.pow(Math.random(), 4.0) * 9;          // a handful of big bright stars
    dna[i * 4 + 1] = 0.3 + Math.random() * 0.7;
    dna[i * 4 + 2] = Math.random() < 0.35 ? Math.random() : 0;
    dna[i * 4 + 3] = Math.random() * 6.2832;
    scatter[i * 4] = x; scatter[i * 4 + 1] = y;                         // no fly-in: the intro is a pure fade
    scatter[i * 4 + 2] = Math.random(); scatter[i * 4 + 3] = 0;
  }
  return { seed, dna, scatter };
}

const SUBJECT_GLSL = /* glsl */`
void subject(float t, vec4 seed, vec4 dna, vec4 scatter, inout Particle o) {
  o.pos = seed.xy + vec2(sin(t * 0.05 + seed.z), cos(t * 0.04 + seed.z * 1.3)) * 0.006;   // almost still
}`;

const FIELD_GLSL = /* glsl */`
uniform vec3 uNebulaA, uNebulaB; uniform float uDrift, uScale;
vec3 field(vec2 uv, vec2 p, float t) {
  t *= uDrift * 0.02;
  vec2 q = p * uScale;
  // Domain warping: two layers of fbm displace where the final fbm is sampled. This is what makes wisps and filaments.
  vec2 w1 = vec2(fbm(q + vec2(0.0, t)), fbm(q + vec2(5.2, 1.3) - t * 0.7));
  vec2 w2 = vec2(fbm(q + 4.0 * w1 + vec2(1.7, 9.2) + t * 0.5), fbm(q + 4.0 * w1 + vec2(8.3, 2.8) - t * 0.6));
  float n = fbm(q + 3.0 * w2);
  vec3 col = vec3(0.004, 0.006, 0.014);
  col += uNebulaA * smoothstep(0.35, 0.75, n) * 0.55 * (0.5 + w2.x);
  col += uNebulaB * smoothstep(0.55, 0.90, n) * 0.60 * (0.5 + w1.y);
  col += vec3(0.6, 0.7, 1.0) * pow(smoothstep(0.70, 0.95, n), 2.0) * 0.5;   // bright filament cores
  return col;
}`;
