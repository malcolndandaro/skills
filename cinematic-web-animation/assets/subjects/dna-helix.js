// @template full
/* DNA HELIX — two strands winding around a vertical axis with rungs between them, rotating and slightly tilted.
   Pattern: parametric 3-D curve in the seed (u along the axis, which strand, or rung fraction), rotation folded into
   the angle, pinhole projection. Rungs sit at snapped u values so they read as discrete base pairs.
   Knobs: uSpin, uTurns (how many twists are visible), uRadius. */

/* ── 1. CONFIG ─────────────────────────────────────────────────────────────── */
const CONFIG = {
  count: 14000,
  backgroundRatio: 0.12,
  maxPointSize: 48,
  sizeScale: 1.6,
  twinkleSpeed: 1.5,
  breath: 0,
  intro: { duration: 3.0, propagation: 1.0 },
  lens:  { enabled: true, radius: 0.3, magnification: 1.3, illumination: 0.5 },
  scroll:{ drift: 0.2, scatter: 0.05, shrink: 0.1 },
  post:  { bloom: 0.65, threshold: 0.7, exposure: 2.8, grain: 0.03, vignette: 0.3 },
  palette: { cool: [0.45, 0.75, 1.00], warm: [1.00, 0.55, 0.65] },   // strands cool, rungs warm
  clearColor: [0.006, 0.008, 0.016],
  subject: { uSpin: 0.45, uTurns: 1.6, uRadius: 0.42 },
};

/* ── 2. SUBJECT ─────────────────────────────────────────────────────────────── */
function generateSubject(N) {
  const seed = new Float32Array(N * 4), dna = new Float32Array(N * 4), scatter = new Float32Array(N * 4);
  const RUNGS_PER_UNIT = 11;
  for (let i = 0; i < N; i++) {
    const rung = i % 5 < 2;                                             // 40% of the particles form rungs
    let u = (Math.random() * 2 - 1) * 1.25;
    if (rung) u = Math.round(u * RUNGS_PER_UNIT) / RUNGS_PER_UNIT;      // snap rungs to discrete base pairs
    seed[i * 4] = u;
    seed[i * 4 + 1] = rung ? Math.random() : (i % 2);                   // rung: fraction across; strand: which one
    seed[i * 4 + 2] = rung ? 1 : 0;
    seed[i * 4 + 3] = Math.random();
    dna[i * 4]     = rung ? 1.0 + Math.random() * 1.6 : 1.4 + Math.pow(Math.random(), 2.0) * 3.0;
    dna[i * 4 + 1] = 0.5 + Math.random() * 0.5;
    dna[i * 4 + 2] = rung ? 0.75 + Math.random() * 0.25 : Math.random() * 0.15;
    dna[i * 4 + 3] = Math.random() * 6.2832;
    const a = Math.random() * 6.2832, d = 0.5 + Math.random() * 1.5;
    scatter[i * 4] = Math.cos(a) * d; scatter[i * 4 + 1] = Math.sin(a) * d; scatter[i * 4 + 2] = Math.random(); scatter[i * 4 + 3] = 0;
  }
  return { seed, dna, scatter };
}

const SUBJECT_GLSL = /* glsl */`
uniform float uSpin, uTurns, uRadius;
void subject(float t, vec4 seed, vec4 dna, vec4 scatter, inout Particle o) {
  float u = seed.x;
  float a = u * uTurns * 6.2832 + t * uSpin;                           // helix angle at this height, rotating over time
  vec3 p;
  if (seed.z > 0.5) {                                                  // rung: between the two strands (angle a and a + π)
    float f = seed.y * 2.0 - 1.0;
    p = vec3(cos(a) * uRadius * f, u, sin(a) * uRadius * f);
  } else {
    float sa = a + seed.y * 3.14159;
    p = vec3(cos(sa) * uRadius, u, sin(sa) * uRadius);
  }
  float ct = cos(0.22), st = sin(0.22);                                // slight tilt toward the viewer
  p = vec3(p.x, p.y * ct - p.z * st, p.y * st + p.z * ct);
  float depth = p.z + 3.0;
  o.pos = p.xy * 2.1 / depth;
  o.size = 3.0 / depth;
  o.depth = smoothstep(0.6, -0.6, p.z);
  o.emphasis = mix(0.3, 1.0, smoothstep(-0.5, 0.5, p.z));              // near side brighter
  o.reveal = (u + 1.25) / 2.5;                                         // intro builds from the bottom up
  o.cross = 0.0;
}`;

const FIELD_GLSL = null;
