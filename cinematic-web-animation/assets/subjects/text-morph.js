// @template full
/* TEXT / SHAPE MORPH — particles that assemble into a word, then flow into another word (or logo).
   Targets are baked into the attributes at generation time: seed.xy = position in shape A, seed.zw = position in shape B.
   The shader only interpolates, with a per-particle delay so the change sweeps across instead of snapping.
   pointsFromText() rasterises text on an offscreen 2-D canvas and samples the opaque pixels — the same trick works for
   any image or SVG: draw it, read the pixels, sample. For images load them first, then call createScene.
   Knobs: TEXT_A / TEXT_B / FONT, CONFIG.subject.uMorph (-1 = auto-cycle, else 0..1 driven by scroll or a slider). */

/* ── 1. CONFIG ─────────────────────────────────────────────────────────────── */
const TEXT_A = 'HELLO', TEXT_B = 'WORLD';
const FONT = '900 190px system-ui, "Segoe UI", Helvetica, Arial, sans-serif';

const CONFIG = {
  count: 14000,
  backgroundRatio: 0.1,
  maxPointSize: 48,
  sizeScale: 1.0,
  twinkleSpeed: 1.8,
  breath: 0,
  intro: { duration: 2.6, propagation: 1.0 },
  lens:  { enabled: true, radius: 0.3, magnification: 1.35, illumination: 0.6 },
  scroll:{ drift: 0.1, scatter: 0.15, shrink: 0.1 },
  post:  { bloom: 0.5, threshold: 0.8, exposure: 2.4, grain: 0.03, vignette: 0.3 },
  palette: { cool: [0.65, 0.80, 1.00], warm: [1.00, 0.70, 0.45] },
  clearColor: [0.008, 0.01, 0.02],
  subject: { uMorph: -1 },
};

/* ── 2. SUBJECT ─────────────────────────────────────────────────────────────── */
// Rasterise text and return `count` sample points in scene units (x/y, centred, height ≈ textHeight).
function pointsFromText(text, count, textHeight = 0.55) {
  const W = 1400, H = 280;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.font = FONT; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, W / 2, H / 2 + 8, W * 0.94);
  const px = g.getImageData(0, 0, W, H).data, cells = [];
  for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) if (px[(y * W + x) * 4 + 3] > 120) cells.push(x, y);
  const fit = Math.min(1, (innerWidth / innerHeight) / 2.6);             // shrink on narrow screens
  const s = textHeight * fit / H, out = new Float32Array(count * 2), n = cells.length / 2;
  for (let i = 0; i < count; i++) {
    const k = Math.floor(Math.random() * n);
    out[i * 2] = (cells[k * 2] + Math.random() * 2 - W / 2) * s;
    out[i * 2 + 1] = -(cells[k * 2 + 1] + Math.random() * 2 - H / 2) * s;
  }
  return out;
}

function generateSubject(N) {
  const seed = new Float32Array(N * 4), dna = new Float32Array(N * 4), scatter = new Float32Array(N * 4);
  const A = pointsFromText(TEXT_A, N), B = pointsFromText(TEXT_B, N);
  for (let i = 0; i < N; i++) {
    seed[i * 4] = A[i * 2]; seed[i * 4 + 1] = A[i * 2 + 1]; seed[i * 4 + 2] = B[i * 2]; seed[i * 4 + 3] = B[i * 2 + 1];
    dna[i * 4]     = 1.2 + Math.pow(Math.random(), 3.0) * 3.5;
    dna[i * 4 + 1] = 0.5 + Math.random() * 0.5;
    dna[i * 4 + 2] = Math.random() < 0.3 ? Math.random() : 0;
    dna[i * 4 + 3] = Math.random() * 6.2832;
    const a = Math.random() * 6.2832, d = 0.6 + Math.random() * 1.4;
    scatter[i * 4] = Math.cos(a) * d; scatter[i * 4 + 1] = Math.sin(a) * d;     // intro: gather from a wide cloud
    scatter[i * 4 + 2] = Math.random(); scatter[i * 4 + 3] = 0;
  }
  return { seed, dna, scatter };
}

const SUBJECT_GLSL = /* glsl */`
uniform float uMorph;
void subject(float t, vec4 seed, vec4 dna, vec4 scatter, inout Particle o) {
  // Global morph 0..1. Auto mode dwells on each word: a slow sine pushed through smoothstep.
  float m = uMorph < 0.0 ? smoothstep(0.25, 0.75, 0.5 + 0.5 * sin(t * 0.45)) : uMorph;
  float delay = scatter.z * 0.4;                                   // each particle starts moving at a different moment
  float mm = smoothstep(0.0, 1.0, clamp((m - delay) / 0.6, 0.0, 1.0));
  vec2 p = mix(seed.xy, seed.zw, mm);
  p.y += sin(mm * 3.14159) * 0.25 * (scatter.z - 0.5);             // arc outward while travelling
  p += vec2(sin(t * 1.3 + dna.w), cos(t * 1.1 + dna.w * 1.7)) * 0.004;   // idle shimmer
  o.pos = p;
  o.reveal = (seed.x + 1.4) / 2.8;                                  // intro sweeps left to right
  o.cross = 0.0;
}`;

const FIELD_GLSL = null;
