// @template full
/* LAVENDER + SUNFLOWER FIELD — a denser lavender field with sunflowers scattered through it, at golden hour.
   Builds on lavender-field.js. Two kinds of plant share one attribute layout:
     seed = (x world, z world, role, height)   height >= 10 flags a sunflower (real height = seed.w - 10)
     role for lavender  : height fraction along the stalk (0..1)
     role for sunflower : [0,1) stem point · [1,2) petal, angle = (role-1)·2π · [2,3) disc point, radius = sqrt(role-2)
   Sunflowers are stiffer (less sway) and taller; their dark disc is a dim red-brown that reads as dark because the
   petals around it are so much brighter — additive blending cannot paint darkness, only contrast.
   Knobs: uWind, uHorizon, uSun, plus SUNFLOWER_SHARE / DENSITY below. */

/* ── 1. CONFIG ─────────────────────────────────────────────────────────────── */
const SUNFLOWER_SHARE = 0.16;    // fraction of the particle budget spent on sunflowers (each costs ~40 particles)
const CONFIG = {
  count: 60000,
  backgroundRatio: 0,
  maxPointSize: 72,
  sizeScale: 1.0,
  twinkleSpeed: 0.6,
  breath: 0,
  intro: { duration: 3.2, propagation: 1.2 },
  lens:  { enabled: true, radius: 0.28, magnification: 1.18, illumination: 0.35 },
  scroll:{ drift: 0.08, scatter: 0.0, shrink: 0.08 },
  post:  { bloom: 0.42, threshold: 0.7, exposure: 1.5, grain: 0.035, vignette: 0.32 },
  palette: { cool: [0.42, 0.26, 0.90], warm: [0.90, 0.62, 1.00] },
  clearColor: [0.02, 0.02, 0.03],
  subject: { uWind: 1.0, uHorizon: 0.12, uSun: [0.42, 0.20] },
};

/* ── 2. SUBJECT ─────────────────────────────────────────────────────────────── */
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) * 0.9;
const CAM_H = 0.78, HORIZON = 0.12, Z_NEAR = 0.75, Z_FAR = 7.0;

function generateSubject(N) {
  const seed = new Float32Array(N * 4), dna = new Float32Array(N * 4), scatter = new Float32Array(N * 4);
  const MOTES = Math.floor(N * 0.02);
  const sunflowerBudget = Math.floor((N - MOTES) * SUNFLOWER_SHARE);
  let i = 0;
  const put = (xw, zw, role, H, size, bright, mix) => {
    seed[i * 4] = xw; seed[i * 4 + 1] = zw; seed[i * 4 + 2] = role; seed[i * 4 + 3] = H;
    dna[i * 4] = size; dna[i * 4 + 1] = bright; dna[i * 4 + 2] = mix; dna[i * 4 + 3] = Math.random() * 6.2832;
    scatter[i * 4] = xw / zw; scatter[i * 4 + 1] = -CAM_H / zw + HORIZON;   // grow up from the ground during the intro
    scatter[i * 4 + 2] = Math.random(); scatter[i * 4 + 3] = 0;
    i++;
  };
  const depth = () => Z_NEAR + (Z_FAR - Z_NEAR) * Math.pow(Math.random(), 1.5);   // biased near: screen density falls with z³

  // Sunflowers: 6 stem + 22 outer petals + 14 mid petals + 10 inner petals + 16 disc points = 68 particles each.
  // Three petal rings so the head reads as a filled disc at a distance, not a dotted circle.
  while (i < sunflowerBudget - 68) {
    const zw = depth(), xw = (Math.random() * 2 - 1) * 1.8 * zw, H = 10 + 0.70 + Math.random() * 0.22;
    for (let k = 0; k < 6; k++)  put(xw, zw, 0.08 + k * 0.155 + Math.random() * 0.03, H, 2.6 + Math.random() * 1.2, 0.75, 0);
    for (let k = 0; k < 22; k++) put(xw, zw, 1 + (k + Math.random() * 0.3) / 22, H, 6.5 + Math.random() * 2.5, 0.9 + Math.random() * 0.1, 0);
    for (let k = 0; k < 14; k++) put(xw, zw, 1 + (k + 0.5 + Math.random() * 0.3) / 14 + 0.0001, H, 5.5 + Math.random() * 2, 0.85, 0.5);   // mid ring: mix=0.5
    for (let k = 0; k < 10; k++) put(xw, zw, 1 + (k + 0.25 + Math.random() * 0.3) / 10 + 0.0002, H, 5.0 + Math.random() * 2, 0.8, 1);    // inner ring: mix=1
    for (let k = 0; k < 16; k++) put(xw, zw, 2 + Math.random(), H, 4.5 + Math.random() * 2.5, 0.55, 0);
  }
  // Lavender: 3 stem + 7 florets = 10 particles per stalk.
  while (i < N - MOTES - 10) {
    const zw = depth(), xw = (Math.random() * 2 - 1) * 1.8 * zw, H = 0.42 + Math.random() * 0.25, hue = Math.random();
    for (let k = 0; k < 3; k++)  put(xw, zw, 0.12 + k * 0.17 + Math.random() * 0.04, H, 1.6 + Math.random() * 1.2, 0.5, 0);
    for (let k = 0; k < 7; k++)  put(xw + gauss() * 0.015, zw, 0.60 + (k / 6) * 0.40 + (Math.random() - 0.5) * 0.04, H,
                                     3.0 + Math.random() * 4.0, 0.65 + Math.random() * 0.35, Math.min(1, Math.max(0, hue * 0.7 + Math.random() * 0.3)));
  }
  for (; i < N; ) {                                                     // pollen motes (seed.w = -1)
    const x = (Math.random() * 2 - 1) * 2.2, y = Math.random() * 1.3 - 0.75;
    seed[i * 4] = x; seed[i * 4 + 1] = y; seed[i * 4 + 2] = Math.random(); seed[i * 4 + 3] = -1;
    dna[i * 4] = 3 + Math.random() * 7; dna[i * 4 + 1] = 0.2 + Math.random() * 0.3; dna[i * 4 + 2] = 0; dna[i * 4 + 3] = Math.random() * 6.2832;
    scatter[i * 4] = x; scatter[i * 4 + 1] = y; scatter[i * 4 + 2] = Math.random(); scatter[i * 4 + 3] = 0;
    i++;
  }
  return { seed, dna, scatter };
}

const SUBJECT_GLSL = /* glsl */`
uniform float uWind, uHorizon;
const float CAM_H = 0.78;
float hash1(float n) { return fract(sin(n) * 43758.5453); }

void subject(float t, vec4 seed, vec4 dna, vec4 scatter, inout Particle o) {
  o.cross = 0.0;
  if (seed.w < 0.0) {                                   // pollen mote
    float ph = dna.w;
    o.pos = seed.xy + vec2(sin(t * 0.23 + ph) * 0.06 + sin(t * 0.07 + ph * 0.5) * 0.12,
                           sin(t * 0.17 + ph * 1.7) * 0.05 + sin(t * 0.11 + ph) * 0.08);
    o.color = vec3(1.0, 0.82, 0.50); o.emphasis = 0.45; o.reveal = 1.0;
    return;
  }
  float xw = seed.x, zw = seed.y, role = seed.z, H = seed.w;
  float sunflower = step(10.0, H);
  H -= sunflower * 10.0;
  float far = smoothstep(1.5, 7.0, zw);

  float gust = sin(t * 0.37) * 0.5 + sin(t * 0.13 + 1.7) * 0.5;
  float wind = sin(t * 0.9 + xw * 0.5 + zw * 0.35) * 0.55 + sin(t * 1.9 + xw * 1.4 - zw * 0.2) * 0.25 + gust * 0.35;
  float stiffness = mix(1.0, 0.35, sunflower);          // sunflowers barely sway
  float hf = min(role, 1.0);                            // petals/disc sit at the top of the stalk
  float lean = wind * uWind * hf * hf * 0.16 * stiffness;
  float yw = hf * H - abs(lean) * 0.35;
  vec2 off = vec2(0.0);
  vec3 color = o.color;
  float emphasis = 1.0;

  if (sunflower > 0.5) {
    float R = 0.11 * (0.85 + 0.3 * hash1(xw * 7.1 + zw));            // head radius, slightly different per plant
    if (role >= 2.0) {                                                // dark disc (dim red-brown; dark only by contrast)
      float rf = role - 2.0, a = rf * 44.0;
      off = vec2(cos(a), sin(a)) * sqrt(rf) * R * 0.40;
      color = vec3(0.42, 0.17, 0.05); emphasis = 0.38;
    } else if (role >= 1.0) {                                         // petals: three rings, dna.z = 0 outer, 0.5 mid, 1 inner
      float a = (role - 1.0) * 6.2832;
      float ring = mix(1.0, 0.5, dna.z);
      off = vec2(cos(a), sin(a)) * R * ring;
      color = mix(vec3(1.0, 0.80, 0.14), vec3(1.0, 0.55, 0.08), dna.z);
      emphasis = 1.0;
    } else {                                                          // stem
      color = vec3(0.20, 0.45, 0.16); emphasis = 0.55;
    }
    lean += sin(t * 0.7 + hash1(xw * 3.3) * 6.2832) * 0.01 * hf;      // slow nod of the heavy head
  } else {
    float flower = step(0.6, role);
    color = mix(vec3(0.20, 0.42, 0.18), color, flower);
    emphasis = mix(0.3, 1.0, flower);
    lean += sin(t * 3.1 + hash1(xw * 13.0) * 6.2832) * 0.008 * hf * flower;
  }

  o.pos = vec2((xw + lean + off.x) / zw, (yw + off.y - CAM_H) / zw + uHorizon);
  o.color = mix(color, vec3(0.62, 0.42, 0.72), far * 0.45);
  o.size  = clamp(2.2 / zw, 0.45, 2.4);
  o.depth = far * 0.3;
  o.emphasis = emphasis * mix(1.0, 0.7, far);
  o.reveal = (zw - 0.75) / 6.25;
}`;

const FIELD_GLSL = /* glsl */`
uniform float uHorizon; uniform vec2 uSun;
vec3 field(vec2 uv, vec2 p, float t) {
  float y = p.y - uHorizon;
  float sk = clamp(y / (1.0 - uHorizon), 0.0, 1.0);
  vec3 sky = mix(vec3(0.70, 0.36, 0.22), vec3(0.36, 0.20, 0.30), smoothstep(0.0, 0.25, sk));   // golden band -> mauve
  sky = mix(sky, vec3(0.08, 0.07, 0.20), smoothstep(0.2, 1.0, sk));
  float d = length((p - uSun) * vec2(1.0, 1.4));
  sky += vec3(1.0, 0.78, 0.45) * exp(-d * 3.2) * 0.6 + vec3(1.0, 0.65, 0.30) * exp(-d * d * 60.0) * 1.6;
  vec3 soil = mix(vec3(0.035, 0.030, 0.026), vec3(0.010, 0.010, 0.008), smoothstep(0.0, -1.0, y));
  vec3 col = y > 0.0 ? sky : soil;
  col = mix(col, vec3(0.85, 0.55, 0.40), exp(-abs(y) * 9.0) * 0.30 * step(0.0, y));
  return col;
}`;
