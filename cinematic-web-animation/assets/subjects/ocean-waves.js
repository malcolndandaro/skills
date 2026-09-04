// @template full
/* OCEAN WAVES — a point-cloud sea: a sum of travelling sine waves evaluated per particle, crests brightening to foam,
   specular glints, and aerial perspective toward a dusk horizon. Random placement (not a grid) avoids moiré.
   Same skeleton = terrain, dunes, a cloth, a data surface: replace the height function.
   Knobs: uAmp (wave height), uSpeed. */

/* ── 1. CONFIG ─────────────────────────────────────────────────────────────── */
const CONFIG = {
  count: 40000,
  backgroundRatio: 0.08,
  maxPointSize: 48,
  sizeScale: 1.0,
  twinkleSpeed: 0.3,
  breath: 0,
  intro: { duration: 3.0, propagation: 1.0 },
  lens:  { enabled: true, radius: 0.3, magnification: 1.2, illumination: 0.5 },
  scroll:{ drift: 0.1, scatter: 0.0, shrink: 0.05 },
  post:  { bloom: 0.5, threshold: 0.75, exposure: 2.7, grain: 0.03, vignette: 0.3 },
  palette: { cool: [0.10, 0.45, 0.85], warm: [0.55, 0.95, 1.00] },
  clearColor: [0.004, 0.008, 0.02],
  subject: { uAmp: 1.0, uSpeed: 1.0 },
};

/* ── 2. SUBJECT ─────────────────────────────────────────────────────────────── */
const Z_NEAR = 0.8, Z_FAR = 7.0, CAM_H = 1.2, HORIZON = 0.35;

function generateSubject(N) {
  const seed = new Float32Array(N * 4), dna = new Float32Array(N * 4), scatter = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    const z = Z_NEAR + (Z_FAR - Z_NEAR) * Math.pow(Math.random(), 1.3);   // biased near
    const x = (Math.random() * 2 - 1) * 1.9 * z;
    seed[i * 4] = x; seed[i * 4 + 1] = z; seed[i * 4 + 2] = Math.random(); seed[i * 4 + 3] = Math.random();
    dna[i * 4]     = 1.4 + Math.pow(Math.random(), 2.0) * 3.0;
    dna[i * 4 + 1] = 0.5 + Math.random() * 0.5;
    dna[i * 4 + 2] = Math.random() * 0.5;
    dna[i * 4 + 3] = Math.random() * 6.2832;
    scatter[i * 4] = x / z; scatter[i * 4 + 1] = (-0.6 - CAM_H) / z + HORIZON;   // rise from below the surface
    scatter[i * 4 + 2] = Math.random(); scatter[i * 4 + 3] = 0;
  }
  return { seed, dna, scatter };
}

const SUBJECT_GLSL = /* glsl */`
uniform float uAmp, uSpeed;
const float CAM_H = 1.2, HORIZON = 0.35;
void subject(float t, vec4 seed, vec4 dna, vec4 scatter, inout Particle o) {
  float x = seed.x, z = seed.y; t *= uSpeed;
  float h = sin(x * 1.3 + t * 0.9) * 0.08 + sin(z * 1.7 - t * 0.7) * 0.06
          + sin((x + z) * 0.8 + t * 0.5) * 0.10 + sin(x * 3.1 - z * 2.2 + t * 1.6) * 0.03;   // four travelling waves
  h *= uAmp;
  o.pos = vec2(x / z, (h - CAM_H) / z + HORIZON);                      // camera above the water looking at the horizon
  float far = smoothstep(1.0, 7.0, z);
  float crest = smoothstep(0.08, 0.22, h);                             // crests turn to foam
  float glint = pow(0.5 + 0.5 * sin(t * 3.0 + seed.z * 6.2832 + x * 2.0), 14.0) * (1.0 - far);   // specular sparkle
  o.color = mix(o.color, vec3(0.90, 0.98, 1.00), crest);
  o.color = mix(o.color, vec3(0.35, 0.40, 0.55), far * 0.6);           // haze
  o.emphasis = (0.35 + crest * 1.2 + glint * 0.9) * mix(1.0, 0.5, far);
  o.size = clamp(2.0 / z, 0.4, 2.0);
  o.depth = far * 0.5;
  o.reveal = (z - 0.8) / 6.2;
  o.cross = 0.0;
}`;

const FIELD_GLSL = /* glsl */`
vec3 field(vec2 uv, vec2 p, float t) {
  float y = p.y - 0.35;
  vec3 sky = mix(vec3(0.10, 0.12, 0.22), vec3(0.02, 0.03, 0.08), smoothstep(0.0, 0.9, y));
  sky += vec3(0.30, 0.25, 0.30) * exp(-abs(y) * 6.0) * 0.5 * step(0.0, y);   // dusk glow on the horizon
  vec3 sea = vec3(0.006, 0.012, 0.03);
  return y > 0.0 ? sky : sea;
}`;
