# Shader cookbook

GLSL ES 3.00 snippets that the templates and subjects are built from. Everything is written from scratch and free to
copy. Contents: sprites · noise · curl · 3-D helpers · easing and progress · colour · post-processing · palettes.

## Sprites (fragment shader, `gl_PointCoord` runs 0..1 inside the point)

```glsl
vec2 d = gl_PointCoord - 0.5; float dist = length(d);
if (dist > 0.5) discard;                                                   // square -> disc

// soft ball with exponential-looking falloff (the default star)
float core = pow(smoothstep(0.5, 0.0, dist), 3.5);
float halo = smoothstep(0.5, 0.0, dist) * 0.22;
// diffraction cross (only for big bright particles: pass a per-particle strength)
float cross = (max(0.0, 1.0 - abs(d.x) * 30.0) + max(0.0, 1.0 - abs(d.y) * 30.0)) * smoothstep(0.5, 0.04, dist) * vCross;
// ring (bubbles, bokeh)
float ring = smoothstep(0.02, 0.0, abs(dist - 0.38)) + core * 0.15;
// hard disc with antialiased edge (confetti, dots)
float disc = 1.0 - smoothstep(0.42, 0.48, dist);
// diamond / 4-point star
float diamond = max(0.0, 1.0 - (abs(d.x) + abs(d.y)) * 2.2);
// elongated streak (rain): stretch one axis before measuring
float streak = pow(smoothstep(0.5, 0.0, length(d * vec2(6.0, 1.0))), 2.0);
// petal / leaf: offset disc so the point's origin is at the stem
float petal = pow(smoothstep(0.5, 0.0, length(d * vec2(2.0, 1.0) + vec2(0.0, 0.2))), 2.0);

float a = (core + halo + cross) * vAlpha;
fragColor = vec4(vColor * a, a);                                           // premultiplied for additive blending
```
A texture atlas only pays off when particles need *different pictures* (icons, glyphs, logos): pass an index per
particle and offset the UV into the atlas.

## Noise (2-D value noise + fbm; cheap and good enough for anything smooth)

```glsl
float hash21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1, 0)), f.x), mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p){ float v = 0.0, a = 0.5; mat2 R = mat2(0.8, 0.6, -0.6, 0.8);   // rotate each octave: kills grid artefacts
  for (int i = 0; i < 5; i++) { v += a * vnoise(p); p = R * p * 2.02 + 17.3; a *= 0.5; } return v; }
```
Domain warping (wisps, filaments, marble): `fbm(p + k * vec2(fbm(p + a), fbm(p + b)))`. Two levels of warping is the
sweet spot; three is mud. Ridged noise (mountain ridges, lightning): `1.0 - abs(2.0 * vnoise(p) - 1.0)`.

3-D value noise (continents on a sphere, volumetric-looking fields): see `assets/subjects/globe.js` (`hash3`, `vnoise3`).
When you need proper gradient noise (simplex), the standard MIT-licensed `snoise` from Ashima / Stefan Gustavson is the
reference; value noise is usually enough for backgrounds.

## Curl noise (divergence-free flow: particles swirl, never pile up)

```glsl
vec2 curl(vec2 p){ float e = 0.03;
  float dy = fbm3(p + vec2(0.0, e)) - fbm3(p - vec2(0.0, e));
  float dx = fbm3(p + vec2(e, 0.0)) - fbm3(p - vec2(e, 0.0));
  return normalize(vec2(dy, -dx) + 1e-6); }
```
Stateless integration for a stroke of length L: `for 12 steps: p += curl(p * scale + drift) * (life * L / 12.0)`.
See `assets/subjects/flow-field.js`.

## 3-D helpers (points on spheres, helices, paths, terrains)

```glsl
mat3 rotY(float a){ float c = cos(a), s = sin(a); return mat3(c, 0, -s, 0, 1, 0, s, 0, c); }
mat3 rotX(float a){ float c = cos(a), s = sin(a); return mat3(1, 0, 0, 0, c, s, 0, -s, c); }
// pinhole camera on +z looking at the origin, `dist` units away
float depth = p.z + dist;            // never let depth reach 0
o.pos  = p.xy * focal / depth;       // focal ≈ 1.7–2.2 for a natural look
o.size = k / depth;                  // perspective size
o.emphasis = mix(0.15, 1.0, smoothstep(-0.9, 0.7, p.z));   // dim the far hemisphere so a sphere reads as solid
```
Ground plane seen from a camera at height H looking at the horizon (fields, oceans, roads):
`screen = vec2(xw / zw, (yw - H) / zw + horizon)` — `zw` from 0.75 to ~8, sample z biased *near* (screen density falls
with z³), x range `±1.8·zw` fills a 16:9 frame.

## Easing and progress

```glsl
float easeOutCubic(float x){ return 1.0 - pow(1.0 - x, 3.0); }
float easeInOut(float x){ return x * x * (3.0 - 2.0 * x); }            // smoothstep(0,1,x)
// propagated progress: reveal 0..1 per particle, soft > 0 spreads the wave
float p = clamp(g * (1.0 + soft) - reveal * soft, 0.0, 1.0);
// dwell at both ends of an oscillation (morphs): smoothstep(0.25, 0.75, 0.5 + 0.5 * sin(t * w))
// short flash, long pause (fireflies, glints): pow(0.5 + 0.5 * sin(t * w + phase), 6.0..14.0)
// loop without a visible reset: life = fract(t / L + offset); alpha *= sin(life * 3.14159)
```

## Colour

- **Two-tone per-particle mix** `mix(cool, warm, dna.z)` with most particles at 0 and a minority warm: this alone
  reads as "photographic". Fully random hues read as confetti.
- **Cosine palette** (Inigo Quilez): `a + b * cos(6.2832 * (c * t + d))` — one line, infinite smooth palettes.
  Space: `a=(.5,.5,.5) b=(.5,.5,.5) c=(1,1,1) d=(0,.1,.2)`. Fire: `d=(0,.15,.3)` with `c=(1,.7,.4)`.
- **Aerial perspective**: `color = mix(color, hazeColor, far * 0.5)` — far things go toward the sky colour; this is
  what makes depth believable without any fog volume.
- **Additive means you cannot paint dark.** Darkness is the absence of particles (black hole shadow) or *contrast*
  (a dim red-brown disc surrounded by bright yellow petals reads as dark).
- Work in linear RGB inside the shader; the tone map + display gamma is handled by ACES + the `RGBA8` swap chain.

## Post-processing

```glsl
// luminance cut with soft knee (no flicker at the threshold)
float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
float knee = thr * 0.6 + 1e-4, soft = clamp(lum - thr + knee, 0.0, 2.0 * knee); soft = soft * soft / (4.0 * knee);
float w = max(soft, lum - thr) / max(lum, 1e-4);
// ACES (Narkowicz fit) — after this, re-tune exposure upward (≈ ×2–3)
c = clamp((c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14), 0.0, 1.0);
// Reinhard (softer, keeps more of the lows): c = c / (1.0 + c);
// vignette
c *= mix(1.0, smoothstep(1.15, 0.30, length(uv - 0.5) * 1.55), amount);
// animated grain (film) and static dither (banding) — the dither is not optional on OLED
c += (hash21(uv * res + t * 60.0) - 0.5) * grain;
c += (hash21(uv * 1024.0) - 0.5) / 255.0;
// cheap chromatic aberration at the edges (use sparingly)
vec2 off = (uv - 0.5) * 0.006; c.r = texture(src, uv + off).r; c.b = texture(src, uv - off).b;
```
Bloom pyramid: cut → 5 levels of ½ downsample (9-tap tent) → additive upsample with radius 2. The upsample being
*additive* across levels is what gives the wide, soft halo; a single blurred layer looks like a smear.

## Palettes (linear RGB, cool → warm)

| Mood | cool | warm | clear colour |
|---|---|---|---|
| Deep space (default) | `0.70 0.83 1.00` | `1.00 0.60 0.34` | `0.008 0.011 0.02` |
| Ember / forge | `1.00 0.55 0.20` | `1.00 0.90 0.60` | `0.02 0.008 0.004` |
| Arctic | `0.60 0.85 1.00` | `0.95 0.98 1.00` | `0.01 0.02 0.04` |
| Neon night | `0.20 0.90 1.00` | `1.00 0.20 0.70` | `0.01 0.005 0.02` |
| Sakura | `1.00 0.70 0.85` | `1.00 0.95 0.90` | `0.03 0.015 0.03` |
| Lavender dusk | `0.42 0.26 0.90` | `0.90 0.62 1.00` | sky field |
| Gold leaf | `1.00 0.80 0.35` | `1.00 0.95 0.80` | `0.02 0.015 0.01` |
| Monochrome brand | brand colour | white | near-black tint of brand |

For a **light background** you cannot use the additive particle pipeline at all — use `template-field.html`
(liquid-gradient) or draw particles in dark ink with normal alpha blending (`gl.blendFunc(ONE, ONE_MINUS_SRC_ALPHA)`) and
no bloom.
