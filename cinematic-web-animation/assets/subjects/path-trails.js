// @template full
/* PATH TRAILS — a Lorenz attractor drawn as a static point path, with bright "comets" of light running along it.
   General pattern for any curve (Lissajous, knots, a logo outline, a route on a map, a data line):
   integrate or sample the curve ONCE on the CPU, store position + arc-length parameter s in the seed, and let the
   shader animate brightness as a function of (s, t). The geometry never changes; only light travels.
   Knobs: uSpin (rotation), uPulseCount (comets on screen), uPulseSpeed. */

/* ── 1. CONFIG ─────────────────────────────────────────────────────────────── */
const CONFIG = {
  count: 24000,
  backgroundRatio: 0.1,
  maxPointSize: 48,
  sizeScale: 1.4,
  twinkleSpeed: 0,
  breath: 0,
  intro: { duration: 3.0, propagation: 1.2 },
  lens:  { enabled: true, radius: 0.3, magnification: 1.3, illumination: 0.5 },
  scroll:{ drift: 0.1, scatter: 0.03, shrink: 0.1 },
  post:  { bloom: 0.7, threshold: 0.65, exposure: 2.8, grain: 0.03, vignette: 0.3 },
  palette: { cool: [0.30, 0.70, 1.00], warm: [1.00, 0.50, 0.80] },
  clearColor: [0.006, 0.006, 0.014],
  subject: { uSpin: 0.2, uPulseCount: 6.0, uPulseSpeed: 0.35 },
};

/* ── 2. SUBJECT ─────────────────────────────────────────────────────────────── */
function generateSubject(N) {
  const seed = new Float32Array(N * 4), dna = new Float32Array(N * 4), scatter = new Float32Array(N * 4);
  // Lorenz system, integrated once. Skip the transient, then keep N samples.
  let x = 0.1, y = 0, z = 0; const dt = 0.004, SIGMA = 10, RHO = 28, BETA = 8 / 3;
  const stepLorenz = () => { const dx = SIGMA * (y - x), dy = x * (RHO - z) - y, dz = x * y - BETA * z; x += dx * dt; y += dy * dt; z += dz * dt; };
  for (let i = 0; i < 2000; i++) stepLorenz();
  for (let i = 0; i < N; i++) {
    stepLorenz();
    seed[i * 4] = x / 24; seed[i * 4 + 1] = (z - 26) / 26; seed[i * 4 + 2] = y / 28; seed[i * 4 + 3] = i / N;   // fit to ±1, wings facing the camera
    dna[i * 4]     = 1.0 + Math.pow(Math.random(), 2.5) * 2.2;
    dna[i * 4 + 1] = 0.5 + Math.random() * 0.5;
    dna[i * 4 + 2] = (i / N);                                             // colour drifts along the path
    dna[i * 4 + 3] = Math.random() * 6.2832;
    const a = Math.random() * 6.2832, d = 0.4 + Math.random() * 1.6;
    scatter[i * 4] = Math.cos(a) * d; scatter[i * 4 + 1] = Math.sin(a) * d; scatter[i * 4 + 2] = Math.random(); scatter[i * 4 + 3] = 0;
  }
  return { seed, dna, scatter };
}

const SUBJECT_GLSL = /* glsl */`
uniform float uSpin, uPulseCount, uPulseSpeed;
void subject(float t, vec4 seed, vec4 dna, vec4 scatter, inout Particle o) {
  vec3 p = seed.xyz;
  float c = cos(t * uSpin), s = sin(t * uSpin);
  p = vec3(p.x * c - p.z * s, p.y, p.x * s + p.z * c);                  // slow turntable
  float ct = cos(0.25), st = sin(0.25);
  p = vec3(p.x, p.y * ct - p.z * st, p.y * st + p.z * ct);              // slight tilt
  float depth = p.z + 3.2;
  o.pos = p.xy * 2.9 / depth;
  o.size = 3.4 / depth;
  o.depth = smoothstep(1.0, -1.0, p.z);
  float pulse = pow(0.5 + 0.5 * sin((seed.w * uPulseCount - t * uPulseSpeed) * 6.2832), 14.0);   // comets along the arc length
  o.emphasis = (0.18 + pulse * 2.5) * mix(0.5, 1.0, smoothstep(-1.0, 1.0, p.z));
  o.reveal = seed.w;                                                    // the intro traces the path
  o.cross = 0.0;
}`;

const FIELD_GLSL = null;
