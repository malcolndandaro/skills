// @template full
/* FLOW FIELD — thousands of glowing strokes streaming along a curl-noise field.
   Two stateless tricks:
   1. Loop instead of state. A flow field normally needs integration (state), which "pure function of time" forbids.
      Each stream lives on a loop: life = fract(t / uLife + offset). Its position is its start point integrated along
      the field for a distance proportional to life (12 fixed steps in the shader). It fades in and out with sin(π·life),
      so the jump back to the start is invisible.
   2. Trails are time-offset copies. A single point shows no direction in a still frame, so each stream is TAIL
      particles with the same start and life offsets spaced by a small δ: they line up along the path, and the head
      is the brightest. This "sample the same motion at t, t-δ, t-2δ…" pattern gives trails to any moving subject.
   Knobs: uScale (feature size), uSpeed (how fast the field itself evolves), uLength (stroke length), uLife (seconds per loop), TAIL. */

/* ── 1. CONFIG ─────────────────────────────────────────────────────────────── */
const TAIL = 7;                                                         // particles per stream
const CONFIG = {
  count: 21000,                                                         // = 3000 streams × 7
  backgroundRatio: 0,
  maxPointSize: 48,
  sizeScale: 1.6,
  twinkleSpeed: 0,
  breath: 0,
  intro: { duration: 2.5, propagation: 0.8 },
  lens:  { enabled: true, radius: 0.3, magnification: 1.3, illumination: 0.5 },
  scroll:{ drift: 0.1, scatter: 0.05, shrink: 0.1 },
  post:  { bloom: 0.6, threshold: 0.65, exposure: 2.8, grain: 0.03, vignette: 0.3 },
  palette: { cool: [0.20, 0.60, 1.00], warm: [1.00, 0.45, 0.20] },
  clearColor: [0.01, 0.012, 0.02],
  subject: { uScale: 1.4, uSpeed: 0.6, uLength: 0.9, uLife: 7.0 },
};

/* ── 2. SUBJECT ─────────────────────────────────────────────────────────────── */
function generateSubject(N) {
  const seed = new Float32Array(N * 4), dna = new Float32Array(N * 4), scatter = new Float32Array(N * 4);
  for (let i = 0; i < N; i += TAIL) {
    const x = (Math.random() * 2 - 1) * 2.0, y = (Math.random() * 2 - 1) * 1.2, life0 = Math.random(), mixc = Math.random();
    for (let k = 0; k < TAIL && i + k < N; k++) {
      const j = i + k, head = 1 - k / TAIL;                              // k = 0 is the head of the stroke
      seed[j * 4] = x; seed[j * 4 + 1] = y; seed[j * 4 + 2] = life0 - k * 0.006; seed[j * 4 + 3] = head;
      dna[j * 4]     = 1.2 + head * 2.4;                                 // head biggest, tail thinnest
      dna[j * 4 + 1] = 0.35 + head * 0.65;
      dna[j * 4 + 2] = mixc;
      dna[j * 4 + 3] = Math.random() * 6.2832;
      scatter[j * 4] = x; scatter[j * 4 + 1] = y; scatter[j * 4 + 2] = Math.random(); scatter[j * 4 + 3] = 0;
    }
  }
  return { seed, dna, scatter };
}

const SUBJECT_GLSL = /* glsl */`
uniform float uScale, uSpeed, uLength, uLife;
float hash21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1, 0)), f.x), mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), f.x), f.y); }
float fbm3(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 3; i++) { v += a * vnoise(p); p = p * 2.03 + 11.7; a *= 0.5; } return v; }
// Curl of a scalar potential is divergence-free: particles swirl instead of piling up.
vec2 curl(vec2 p){ float e = 0.03;
  float dy = fbm3(p + vec2(0.0, e)) - fbm3(p - vec2(0.0, e));
  float dx = fbm3(p + vec2(e, 0.0)) - fbm3(p - vec2(e, 0.0));
  return normalize(vec2(dy, -dx) + 1e-6); }

void subject(float t, vec4 seed, vec4 dna, vec4 scatter, inout Particle o) {
  float life = fract(t / uLife + seed.z);                // 0..1 along this stream's loop (tail copies lag by a small δ)
  vec2 p = seed.xy;
  float h = life * uLength / 12.0;
  vec2 drift = vec2(t * uSpeed * 0.05, -t * uSpeed * 0.03);   // the field itself slowly evolves
  for (int i = 0; i < 12; i++) p += curl(p * uScale + drift) * h;
  o.pos = p;
  o.emphasis = sin(life * 3.14159) * seed.w;             // fade in / out; head brightest
  o.cross = 0.0;
}`;

const FIELD_GLSL = null;
