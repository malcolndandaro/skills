// @template full
/* GLOBE — a rotating sphere of points with noise-carved "continents", an equatorial ring, and a faint star layer.
   Shows the 3-D pattern: keep unit-sphere coordinates in the seed, rotate + tilt in the shader, project with a
   pinhole camera (divide by depth), dim the far hemisphere so the sphere reads as solid.
   Knobs: uSpin, uTilt, uLand (0 = uniform sphere, 1 = continents), RING (true/false). */

/* ── 1. CONFIG ─────────────────────────────────────────────────────────────── */
const RING = true;
const CONFIG = {
  count: 22000,
  backgroundRatio: 0.15,
  maxPointSize: 48,
  sizeScale: 1.4,
  twinkleSpeed: 1.2,
  breath: 0.01,
  intro: { duration: 3.0, propagation: 1.0 },
  lens:  { enabled: true, radius: 0.3, magnification: 1.3, illumination: 0.5 },
  scroll:{ drift: 0.15, scatter: 0.05, shrink: 0.1 },
  post:  { bloom: 0.55, threshold: 0.75, exposure: 3.0, grain: 0.03, vignette: 0.3 },
  palette: { cool: [0.35, 0.70, 1.00], warm: [1.00, 0.75, 0.45] },
  clearColor: [0.006, 0.008, 0.016],
  subject: { uSpin: 0.15, uTilt: 0.42, uLand: 1.0 },
};

/* ── 2. SUBJECT ─────────────────────────────────────────────────────────────── */
function generateSubject(N) {
  const seed = new Float32Array(N * 4), dna = new Float32Array(N * 4), scatter = new Float32Array(N * 4);
  const ringCount = RING ? Math.floor(N * 0.28) : 0, sphereCount = N - ringCount;
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < N; i++) {
    let x, y, z, w;
    if (i < sphereCount) {                                            // Fibonacci sphere: even spacing, no clumping at the poles
      y = 1 - (i / (sphereCount - 1)) * 2; const r = Math.sqrt(1 - y * y), th = golden * i;
      x = Math.cos(th) * r; z = Math.sin(th) * r; w = 0;
    } else {                                                          // ring in the equatorial plane
      const a = Math.random() * 6.2832, r = 1.35 + Math.pow(Math.random(), 0.7) * 0.6;
      x = Math.cos(a) * r; y = (Math.random() - 0.5) * 0.01; z = Math.sin(a) * r; w = 1;
    }
    seed[i * 4] = x; seed[i * 4 + 1] = y; seed[i * 4 + 2] = z; seed[i * 4 + 3] = w;
    dna[i * 4]     = w ? 0.8 + Math.random() * 1.4 : 1.0 + Math.pow(Math.random(), 3.0) * 2.5;
    dna[i * 4 + 1] = 0.5 + Math.random() * 0.5;
    dna[i * 4 + 2] = w ? 0.6 + Math.random() * 0.4 : (Math.random() < 0.15 ? Math.random() : 0);
    dna[i * 4 + 3] = Math.random() * 6.2832;
    const a = Math.random() * 6.2832, d = 0.5 + Math.random() * 1.6;
    scatter[i * 4] = Math.cos(a) * d; scatter[i * 4 + 1] = Math.sin(a) * d; scatter[i * 4 + 2] = Math.random(); scatter[i * 4 + 3] = 0;
  }
  return { seed, dna, scatter };
}

const SUBJECT_GLSL = /* glsl */`
uniform float uSpin, uTilt, uLand;
// compact 3-D value noise for the continents
float hash3(vec3 p){ p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise3(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash3(i), hash3(i + vec3(1,0,0)), f.x), mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), f.x), mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), f.x), f.y), f.z); }
mat3 rotY(float a){ float c = cos(a), s = sin(a); return mat3(c, 0, -s, 0, 1, 0, s, 0, c); }
mat3 rotX(float a){ float c = cos(a), s = sin(a); return mat3(1, 0, 0, 0, c, s, 0, -s, c); }

void subject(float t, vec4 seed, vec4 dna, vec4 scatter, inout Particle o) {
  vec3 p = seed.xyz;
  float land = 1.0;
  if (seed.w < 0.5 && uLand > 0.0) {                                  // continents: threshold a couple of noise octaves on the unit sphere
    float n = vnoise3(p * 2.2) * 0.65 + vnoise3(p * 5.1) * 0.35;
    land = mix(1.0, mix(0.18, 1.0, smoothstep(0.48, 0.55, n)), uLand);
  }
  p = rotX(uTilt) * rotY(t * uSpin) * p;                              // spin about the axis, then tilt the axis toward the viewer
  float depth = p.z + 3.2;                                            // camera on +z, 3.2 units away
  o.pos = p.xy * 1.75 / depth;
  o.size = 3.2 / depth;
  o.depth = smoothstep(1.0, -1.0, p.z);
  float front = smoothstep(-0.9, 0.7, p.z);                           // far hemisphere fades so the ball reads as solid
  o.emphasis = mix(0.12, 1.0, front) * land;
  o.reveal = 1.0 - (p.y + 1.0) * 0.5;                                 // reveal from the north pole down
  o.cross = 0.0;
}`;

const FIELD_GLSL = null;
