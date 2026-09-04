// @template full
/* BLACK HOLE — an accretion disk seen almost edge-on, with the far side lensed up over the shadow, a thin photon ring,
   Keplerian rotation (inner orbits far faster) and Doppler beaming (the side coming toward you is brighter).
   The shadow is simply the region where no particles exist; additive light never paints darkness, so emptiness is the tool.
   The "lensing" is a cheap visual approximation (the back half of the disk is lifted), not physics — it reads right.
   Knobs: uSpin, uTilt (disk squash), uBeam (asymmetry), uLift (how far the back arcs over). */

/* ── 1. CONFIG ─────────────────────────────────────────────────────────────── */
const CONFIG = {
  count: 32000,
  backgroundRatio: 0.25,
  maxPointSize: 64,
  sizeScale: 1.0,
  twinkleSpeed: 0.8,
  breath: 0,
  intro: { duration: 3.5, propagation: 1.2 },
  lens:  { enabled: true, radius: 0.3, magnification: 1.25, illumination: 0.4 },
  scroll:{ drift: 0.1, scatter: 0.03, shrink: 0.1 },
  post:  { bloom: 0.8, threshold: 0.6, exposure: 2.2, grain: 0.035, vignette: 0.35 },
  palette: { cool: [1.00, 0.92, 0.75], warm: [1.00, 0.45, 0.12] },   // hot inner -> orange outer
  clearColor: [0.004, 0.004, 0.008],
  subject: { uSpin: 0.35, uTilt: 0.26, uBeam: 0.6, uLift: 0.5 },
};

/* ── 2. SUBJECT ─────────────────────────────────────────────────────────────── */
function generateSubject(N) {
  const seed = new Float32Array(N * 4), dna = new Float32Array(N * 4), scatter = new Float32Array(N * 4);
  const R_IN = 0.30, R_OUT = 1.15;
  for (let i = 0; i < N; i++) {
    const photon = i % 14 === 0;                                        // ~7% form the photon ring
    const r = photon ? R_IN - 0.01 + Math.random() * 0.012 : R_IN + (R_OUT - R_IN) * Math.pow(Math.random(), 1.7);   // dense near the edge
    seed[i * 4] = r; seed[i * 4 + 1] = Math.random() * 6.2832; seed[i * 4 + 2] = photon ? 1 : 0; seed[i * 4 + 3] = Math.random();
    dna[i * 4]     = photon ? 1.2 + Math.random() * 1.2 : 0.9 + Math.pow(Math.random(), 3.0) * 4.5;
    dna[i * 4 + 1] = 0.5 + Math.random() * 0.5;
    dna[i * 4 + 2] = photon ? 0 : Math.min(1, (r - R_IN) / (R_OUT - R_IN) * 1.3);   // colour by radius: hot inside, cooler outside
    dna[i * 4 + 3] = Math.random() * 6.2832;
    const a = Math.random() * 6.2832, d = 0.4 + Math.random() * 1.8;
    scatter[i * 4] = Math.cos(a) * d; scatter[i * 4 + 1] = Math.sin(a) * d; scatter[i * 4 + 2] = Math.random(); scatter[i * 4 + 3] = 0;
  }
  return { seed, dna, scatter };
}

const SUBJECT_GLSL = /* glsl */`
uniform float uSpin, uTilt, uBeam, uLift;
void subject(float t, vec4 seed, vec4 dna, vec4 scatter, inout Particle o) {
  float r = seed.x;
  float ang = seed.y + t * uSpin / (0.04 + r * r * 1.4);              // Keplerian: the inner edge whips around
  float c = cos(ang), s = sin(ang);
  if (seed.z > 0.5) {                                                  // photon ring: a thin bright circle, not tilted
    o.pos = vec2(c, s) * r * 1.02;
    o.color = vec3(1.0, 0.95, 0.85); o.emphasis = 1.6; o.reveal = 0.0; o.cross = 0.0;
    return;
  }
  float behind = smoothstep(0.15, -0.35, s);                           // s < 0 = the half of the disk behind the hole
  float y = s * r * uTilt;
  y = mix(y, abs(y) + uLift * smoothstep(1.15, 0.30, r), behind);      // lensing: the back half arcs up over the shadow
  o.pos = vec2(c * r, y);
  float heat = exp(-(r - 0.30) * 4.0);
  o.emphasis = (0.35 + 2.0 * heat) * (1.0 + uBeam * c);                // hot inner edge + Doppler beaming (left side approaches)
  o.color = mix(o.color, vec3(0.55, 0.12, 0.05), smoothstep(0.7, 1.15, r));   // dull red at the rim
  o.depth = behind * 0.4;
  o.reveal = (r - 0.3) / 0.85;
  o.cross = 0.0;
}`;

const FIELD_GLSL = null;
