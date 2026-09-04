// @template full
/* STARFIELD / WARP — flying forward through a 3-D star cloud. Depth is a phase that wraps: z = fract(z0 - t·speed),
   so every star is a pure function of time, and when one passes the camera it re-appears at the far end with no state.
   Knobs: uSpeed (0.02 = slow drift, 0.3 = hyperspace), uSpread (how wide the tunnel is). */

/* ── 1. CONFIG ─────────────────────────────────────────────────────────────── */
const CONFIG = {
  count: 9000,
  backgroundRatio: 0,
  maxPointSize: 64,
  sizeScale: 1.0,
  twinkleSpeed: 1.0,
  breath: 0,
  intro: { duration: 2.0, propagation: 0.3 },
  lens:  { enabled: true, radius: 0.3, magnification: 1.4, illumination: 0.5 },
  scroll:{ drift: 0.05, scatter: 0.0, shrink: 0.0 },
  post:  { bloom: 0.5, threshold: 0.75, exposure: 2.4, grain: 0.03, vignette: 0.3 },
  palette: { cool: [0.75, 0.85, 1.00], warm: [1.00, 0.80, 0.60] },
  clearColor: [0.004, 0.005, 0.012],
  subject: { uSpeed: 0.06, uSpread: 1.0 },
};

/* ── 2. SUBJECT ─────────────────────────────────────────────────────────────── */
function generateSubject(N) {
  const seed = new Float32Array(N * 4), dna = new Float32Array(N * 4), scatter = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    const x = (Math.random() * 2 - 1) * 1.6, y = (Math.random() * 2 - 1) * 1.6;
    seed[i * 4] = x; seed[i * 4 + 1] = y; seed[i * 4 + 2] = Math.random(); seed[i * 4 + 3] = Math.random();
    dna[i * 4]     = 1.0 + Math.pow(Math.random(), 3.0) * 3.5;
    dna[i * 4 + 1] = 0.4 + Math.random() * 0.6;
    dna[i * 4 + 2] = Math.random() < 0.25 ? Math.random() : 0;
    dna[i * 4 + 3] = Math.random() * 6.2832;
    scatter[i * 4] = x * 0.3; scatter[i * 4 + 1] = y * 0.3;             // intro: burst outward from the centre
    scatter[i * 4 + 2] = Math.random(); scatter[i * 4 + 3] = 0;
  }
  return { seed, dna, scatter };
}

const SUBJECT_GLSL = /* glsl */`
uniform float uSpeed, uSpread;
void subject(float t, vec4 seed, vec4 dna, vec4 scatter, inout Particle o) {
  float z = fract(seed.z - t * uSpeed);                 // 1 = far away, 0 = at the camera
  float zz = mix(0.06, 1.0, z);
  o.pos = seed.xy * uSpread * 0.35 / zz;                // perspective: divide by depth
  o.size = mix(3.0, 0.35, z);                           // grows as it approaches
  o.depth = z;
  o.emphasis = smoothstep(1.0, 0.8, z) * smoothstep(0.0, 0.08, z) * (0.6 + 0.4 * seed.w);   // fade in far, fade out at the lens
  o.reveal = 1.0 - length(seed.xy) / 2.3;
}`;

const FIELD_GLSL = null;
