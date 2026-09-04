// @template full
/* LAVENDER FIELD AT DUSK
   Rows of lavender stalks in perspective, swaying in a gusty wind, under a sunset sky (field pass),
   with golden pollen motes drifting in the light. Shows how the particle engine handles a non-space
   subject: a pinhole camera in the vertex shader, per-particle colour, stalks built from several
   particles that share one seed, and an intro that "grows" the flowers up from the ground.
   Knobs: CONFIG.subject.uWind (sway), uHorizon (camera tilt), uSun (sun position in scene units).
   Why the soil is almost black: the particles blend additively, so the lavender only glows against
   a dark ground. A bright ground would swallow it. */

/* ── 1. CONFIG ─────────────────────────────────────────────────────────────── */
const CONFIG = {
  count: 42000,
  backgroundRatio: 0,          // no star layer: it is daytime
  maxPointSize: 64,
  sizeScale: 1.0,
  twinkleSpeed: 0.6,           // barely-there shimmer, reads as light on petals
  breath: 0,
  intro: { duration: 3.0, propagation: 1.2 },
  lens:  { enabled: true, radius: 0.28, magnification: 1.18, illumination: 0.35 },   // the pointer parts the flowers
  scroll:{ drift: 0.08, scatter: 0.0, shrink: 0.08 },
  post:  { bloom: 0.4, threshold: 0.7, exposure: 1.5, grain: 0.035, vignette: 0.32 },
  palette: { cool: [0.42, 0.26, 0.90], warm: [0.90, 0.62, 1.00] },   // deep violet -> pale lilac
  clearColor: [0.02, 0.02, 0.03],
  subject: { uWind: 1.0, uHorizon: 0.12, uSun: [0.42, 0.20] },
};

/* ── 2. SUBJECT ─────────────────────────────────────────────────────────────── */
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) * 0.9;
const CAM_H = 0.78, HORIZON = 0.12, Z_NEAR = 0.75, Z_FAR = 8.0;   // keep HORIZON in sync with CONFIG.subject.uHorizon

function generateSubject(N) {
  const seed = new Float32Array(N * 4), dna = new Float32Array(N * 4), scatter = new Float32Array(N * 4);
  const MOTES = Math.floor(N * 0.025), PER_STALK = 8;
  let i = 0;
  while (i < N - MOTES) {
    // One stalk = 8 particles sharing x/z: 2 stem points low, 6 floret points on top.
    // Depth biased toward the camera: screen density falls with z³, so near rows need far more stalks per world area.
    const zw = Z_NEAR + (Z_FAR - Z_NEAR) * Math.pow(Math.random(), 1.5);
    const xw = (Math.random() * 2 - 1) * 1.8 * zw;                      // fills the frustum at this depth (up to a 16:9 screen)
    const H = 0.45 + Math.random() * 0.25;                              // stalk height (world units)
    const hue = Math.random();                                          // per-stalk colour tendency
    const n = Math.min(PER_STALK, N - MOTES - i);
    for (let k = 0; k < n; k++, i++) {
      const flower = k >= 2;
      const hf = flower ? 0.62 + ((k - 2) / 5) * 0.38 + (Math.random() - 0.5) * 0.04   // height fraction along the stalk
                        : 0.15 + k * 0.28 + Math.random() * 0.05;
      seed[i * 4]     = xw + (flower ? gauss() * 0.015 : 0);
      seed[i * 4 + 1] = zw;
      seed[i * 4 + 2] = hf;
      seed[i * 4 + 3] = H;
      dna[i * 4]      = flower ? 3.0 + Math.random() * 4.0 : 1.6 + Math.random() * 1.2;
      dna[i * 4 + 1]  = flower ? 0.65 + Math.random() * 0.35 : 0.5;
      dna[i * 4 + 2]  = Math.min(1, Math.max(0, hue * 0.7 + Math.random() * 0.3));
      dna[i * 4 + 3]  = Math.random() * 6.2832;
      // Intro start = the ground point under the stalk (same projection as the shader) -> flowers grow upward.
      scatter[i * 4] = xw / zw; scatter[i * 4 + 1] = -CAM_H / zw + HORIZON;
      scatter[i * 4 + 2] = Math.random(); scatter[i * 4 + 3] = 0;
    }
  }
  for (; i < N; i++) {                                                  // pollen motes: seed.w = -1 flags them
    seed[i * 4] = (Math.random() * 2 - 1) * 2.2; seed[i * 4 + 1] = Math.random() * 1.3 - 0.75;
    seed[i * 4 + 2] = Math.random(); seed[i * 4 + 3] = -1;
    dna[i * 4] = 3 + Math.random() * 7; dna[i * 4 + 1] = 0.2 + Math.random() * 0.3; dna[i * 4 + 2] = 0; dna[i * 4 + 3] = Math.random() * 6.2832;
    scatter[i * 4] = seed[i * 4]; scatter[i * 4 + 1] = seed[i * 4 + 1]; scatter[i * 4 + 2] = Math.random(); scatter[i * 4 + 3] = 0;
  }
  return { seed, dna, scatter };
}

const SUBJECT_GLSL = /* glsl */`
uniform float uWind, uHorizon;
const float CAM_H = 0.78;
float hash1(float n) { return fract(sin(n) * 43758.5453); }

void subject(float t, vec4 seed, vec4 dna, vec4 scatter, inout Particle o) {
  o.cross = 0.0;                                        // petals and pollen do not have diffraction spikes
  if (seed.w < 0.0) {                                   // pollen mote: slow drift in screen space
    float ph = dna.w;
    o.pos = seed.xy + vec2(sin(t * 0.23 + ph) * 0.06 + sin(t * 0.07 + ph * 0.5) * 0.12,
                           sin(t * 0.17 + ph * 1.7) * 0.05 + sin(t * 0.11 + ph) * 0.08);
    o.color = vec3(1.0, 0.82, 0.50); o.emphasis = 0.45; o.reveal = 1.0;
    return;
  }
  float xw = seed.x, zw = seed.y, hf = seed.z, H = seed.w;
  float flower = step(0.62, hf);

  // Wind: two travelling waves plus slow gusts; the tip moves most (hf²), the base not at all.
  float gust = sin(t * 0.37) * 0.5 + sin(t * 0.13 + 1.7) * 0.5;
  float wind = sin(t * 0.9 + xw * 0.5 + zw * 0.35) * 0.55 + sin(t * 1.9 + xw * 1.4 - zw * 0.2) * 0.25 + gust * 0.35;
  float lean = wind * uWind * hf * hf * 0.16;
  lean += sin(t * 3.1 + hash1(xw * 13.0) * 6.2832) * 0.008 * hf * flower;   // per-stalk flutter of the flower head
  float yw = hf * H - abs(lean) * 0.35;                 // bending shortens the stalk slightly

  o.pos = vec2((xw + lean) / zw, (yw - CAM_H) / zw + uHorizon);   // pinhole camera at height CAM_H looking at the horizon

  float far = smoothstep(1.5, 8.0, zw);
  vec3 stem = vec3(0.20, 0.42, 0.18);
  o.color = mix(stem, o.color, flower);
  o.color = mix(o.color, vec3(0.62, 0.42, 0.72), far * 0.5);        // aerial haze: far rows melt into a violet carpet
  o.size  = clamp(2.2 / zw, 0.45, 2.4);                              // perspective, with a floor so far rows stay visible
  o.depth = far * 0.3;
  o.emphasis = mix(0.3, 1.0, flower) * mix(1.0, 0.7, far);
  o.reveal = (zw - 0.75) / 7.25;                                      // near rows grow first
}`;

// Sky + soil + sun, drawn before the particles.
const FIELD_GLSL = /* glsl */`
uniform float uHorizon; uniform vec2 uSun;
vec3 field(vec2 uv, vec2 p, float t) {
  float y = p.y - uHorizon;                                           // 0 at the horizon
  float sk = clamp(y / (1.0 - uHorizon), 0.0, 1.0);
  vec3 sky = mix(vec3(0.62, 0.30, 0.24), vec3(0.32, 0.17, 0.30), smoothstep(0.0, 0.25, sk));   // orange band -> mauve
  sky = mix(sky, vec3(0.07, 0.06, 0.20), smoothstep(0.2, 1.0, sk));                            // -> deep blue zenith
  float d = length((p - uSun) * vec2(1.0, 1.4));
  sky += vec3(1.0, 0.75, 0.45) * exp(-d * 3.2) * 0.55 + vec3(1.0, 0.62, 0.30) * exp(-d * d * 60.0) * 1.6;   // glow + sun disc
  vec3 soil = mix(vec3(0.035, 0.030, 0.028), vec3(0.010, 0.010, 0.008), smoothstep(0.0, -1.0, y));  // near-black earth
  vec3 col = y > 0.0 ? sky : soil;
  col = mix(col, vec3(0.80, 0.48, 0.42), exp(-abs(y) * 9.0) * 0.30 * step(0.0, y));   // haze band just above the horizon
  return col;
}`;
