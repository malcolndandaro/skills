// @template field
/* AURORA — three curtains of light over a starry sky. A field subject: one fullscreen fragment shader, no particles.
   Each curtain is a horizontal fbm ribbon with a crisp lower edge and a long soft fade upward, multiplied by
   near-vertical striations (fbm stretched in y) so it reads as rays, not blobs. Green low, violet high, like the real thing.
   Knobs: uSpeed, uIntensity. Runs well at resolutionScale 0.6–0.75 because everything is smooth. */

/* 1 ─ CONFIG ---------------------------------------------------------------------- */
const CONFIG = {
  resolutionScale: 0.7,
  post: { exposure: 1.0, grain: 0.035, vignette: 0.3 },
  subject: { uSpeed: 1.0, uIntensity: 1.0 },
};

/* 2 ─ FIELD ---------------------------------------------------------------------- */
const FIELD_GLSL = /* glsl */`
uniform float uSpeed, uIntensity;

vec3 field(vec2 uv, vec2 p, float t) {
  t *= uSpeed;
  vec3 col = mix(vec3(0.02, 0.03, 0.09), vec3(0.004, 0.006, 0.025), uv.y);      // horizon glow -> zenith

  // Stars: hashed grid, a few cells lit, individual twinkle.
  vec2 g = p * 70.0; vec2 cell = floor(g); vec2 f = fract(g) - 0.5;
  float h = hash21(cell);
  vec2 sp = (vec2(hash21(cell + 7.0), hash21(cell + 13.0)) - 0.5) * 0.7;
  float star = smoothstep(0.12, 0.0, length(f - sp)) * step(0.93, h);
  col += star * (0.55 + 0.45 * sin(t * 2.0 + h * 40.0)) * 0.7 * smoothstep(0.2, 0.7, uv.y);

  // Curtains.
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float x = p.x * (1.0 + fi * 0.2) + fi * 4.7;
    float base = 0.26 + fi * 0.12 + fbm(vec2(x * 0.8 + t * 0.05, fi * 3.0 + t * 0.03)) * 0.35;   // where it touches down
    float y = uv.y - base;
    float height = 0.25 + fbm(vec2(x * 1.6 - t * 0.04, fi + 9.0)) * 0.35;                       // how far up it reaches
    float body = smoothstep(0.0, 0.03, y) * pow(smoothstep(height, 0.0, y), 1.5);              // crisp bottom, long fade up
    float rays = pow(fbm(vec2(x * 7.0 + t * 0.12, y * 0.6)), 2.2) * 2.2;                        // vertical striations
    float glow = body * (0.35 + rays) * uIntensity;
    vec3 c = mix(vec3(0.05, 0.90, 0.45), vec3(0.50, 0.20, 0.95), smoothstep(0.0, height, y));   // green low, violet high
    col += c * glow * (0.5 - fi * 0.12);
  }
  return col;
}`;
