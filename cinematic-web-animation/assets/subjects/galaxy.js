// @template full
/* GALAXY — the reference subject (a from-scratch recreation of the openai.com GPT-6 Astra hero technique).
   VARIANT: 'spiral' (default) | 'barred' | 'elliptical' | 'globular'
   Knobs: ARMS, TWIST (how tightly the arms wind), SPREAD (arm thickness), CONFIG.subject.uSpin / uCore / uEdgeFade.
   Tuning lessons that cost time:
     • sqrt(random) for the radius → uniform density per AREA. Plain random() piles everything into the centre.
     • Keep the bulge under ~5% of the particles. Under additive blending, more turns the core into a white disc.
     • Fade brightness only at the outer rim. An aggressive falloff erases exactly the arms you want to show.
     • To see the raw structure while tuning, set post.bloom = 0 and subject.uCore = 0 and raise exposure. */

/* ── 1. CONFIG ─────────────────────────────────────────────────────────────── */
const VARIANT = 'spiral';
const ARMS = 3, TWIST = 5.0, SPREAD = 0.12;

const CONFIG = {
  count: 24000,
  backgroundRatio: 0.09,
  maxPointSize: 96,
  sizeScale: 1.0,
  twinkleSpeed: 2.2,
  breath: 0.02,
  intro: { duration: 3.2, propagation: 1.4 },
  lens:  { enabled: true, radius: 0.34, magnification: 1.5, illumination: 0.6 },
  scroll:{ drift: 0.22, scatter: 0.08, shrink: 0.25 },
  post:  { bloom: 0.45, threshold: 0.9, exposure: 3.0, grain: 0.03, vignette: 0.25 },
  palette: { cool: [0.70, 0.83, 1.00], warm: [1.00, 0.60, 0.34] },
  clearColor: [0.008, 0.011, 0.02],
  subject: { uSpin: VARIANT === 'elliptical' || VARIANT === 'globular' ? 0.06 : 0.22, uCore: 0.15, uEdgeFade: 1.0 },
};

/* ── 2. SUBJECT ─────────────────────────────────────────────────────────────── */
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) * 0.9;

function generateSubject(N) {
  const seed = new Float32Array(N * 4), dna = new Float32Array(N * 4), scatter = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    let r, ang, axis = 1.0;
    if (VARIANT === 'elliptical') {
      r = Math.pow(Math.random(), 0.9); ang = Math.random() * 6.2832; axis = 0.62;
    } else if (VARIANT === 'globular') {
      r = Math.pow(Math.random(), 1.6) * 0.75; ang = Math.random() * 6.2832;
    } else {
      const bulge = i % 26 === 0;                                    // ~4% in the bulge
      r = bulge ? Math.pow(Math.random(), 2) * 0.12 : Math.sqrt(Math.random());
      const arm = (i % ARMS) * (Math.PI * 2 / ARMS);
      const spread = bulge ? 3.2 : SPREAD * (0.45 + (1 - r));         // arms thin out toward the tip
      if (VARIANT === 'barred' && !bulge && r < 0.32) {
        ang = (i % 2) * Math.PI + gauss() * 0.10;                      // the bar: two opposite directions, tight spread
      } else {
        const r0 = VARIANT === 'barred' ? Math.max(0, r - 0.32) : r;
        ang = arm + r0 * TWIST + gauss() * spread;                     // logarithmic spiral
        if (VARIANT === 'barred') ang += (i % 2) * Math.PI - (i % ARMS) * (Math.PI * 2 / ARMS);   // arms leave from the bar ends
      }
    }
    seed[i * 4] = r; seed[i * 4 + 1] = ang; seed[i * 4 + 2] = axis; seed[i * 4 + 3] = 0;
    dna[i * 4]     = 0.9 + Math.pow(Math.random(), 3.6) * 7;           // few big stars, many tiny ones
    dna[i * 4 + 1] = 0.45 + Math.random() * 0.85;
    dna[i * 4 + 2] = Math.random() < 0.32 ? Math.pow(Math.random(), 0.7) : 0;   // mostly cool, some warm
    dna[i * 4 + 3] = Math.random() * 6.2832;
    const a = Math.random() * 6.2832, d = (0.25 + Math.random() * 1.1) * 1.7;   // intro starts as a wide dispersed cloud
    scatter[i * 4] = Math.cos(a) * d; scatter[i * 4 + 1] = Math.sin(a) * d;
    scatter[i * 4 + 2] = Math.random(); scatter[i * 4 + 3] = 0;
  }
  return { seed, dna, scatter };
}

const SUBJECT_GLSL = /* glsl */`
uniform float uSpin, uCore, uEdgeFade;
void subject(float t, vec4 seed, vec4 dna, vec4 scatter, inout Particle o) {
  float r   = seed.x;
  float ang = seed.y + t * uSpin / (0.28 + r * 1.6);    // differential rotation: the core spins faster than the rim
  o.pos   = vec2(cos(ang), sin(ang) * seed.z) * r * 1.02;
  o.depth = r * 0.18;
  float core = 1.0 + uCore * exp(-r * 9.0);              // brighter core, not more stars
  o.emphasis = pow(core, 0.75) * mix(1.0, 0.55, smoothstep(0.70, 1.20, r * uEdgeFade));
  o.reveal = r;                                          // the intro lights up from the centre outward
}`;

const FIELD_GLSL = null;
