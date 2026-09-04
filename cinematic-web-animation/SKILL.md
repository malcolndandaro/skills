---
name: cinematic-web-animation
description: >
  Build beautiful, cinematic, GPU-driven web animations and generative art scenes as zero-dependency single-file
  WebGL2 (or CSS when that is cheaper): particle galaxies, nebulae, auroras, starfields, flow fields, fireflies, snow,
  flower fields, oceans, globes, DNA helices, black holes, text/logo morphs, liquid gradients, smoke — with HDR bloom,
  film grain, pointer/scroll interaction, a propagated intro and prefers-reduced-motion built in. Use this whenever the
  user wants an animated hero or background, "make the landing page feel alive / premium / like the OpenAI or Apple
  site", particles, shaders, WebGL, canvas art, generative or algorithmic visuals on a web page, an animated section
  for a product/marketing site, or asks how a site's animation works (audit) — even if they never say "animation",
  "WebGL" or "shader". Also use it for a "3D-ish" scene (planet, helix, wave surface) that does not need real meshes.
---

# Cinematic web animation

This skill produces the kind of hero a design-led company ships: a WebGL2 scene of tens of thousands of points, all
motion computed on the GPU as a pure function of time, an HDR bloom pyramid, ACES tone mapping, grain, a lens that
follows the pointer, a reveal that propagates through the scene, and a calm state for people who prefer reduced motion.
It ships as one HTML file with no dependencies (~10 KB of code), or as a React/Vue component. The reference was a
reverse-engineering of the openai.com GPT-6 Astra hero; every line here is written from scratch.

The subject is pluggable. The same engine draws a galaxy, a lavender field at sunset, a black hole or a word made of
light — 17 ready subjects live in `assets/subjects/`, and inventing a new one is answering five questions.

## Three ideas that make it work

1. **Cheapest layer that can produce the effect.** Text reveals are CSS keyframes. Scroll effects are CSS
   scroll-timelines. Only thousands of points, light that adds up, or pixels that only a shader can make justify WebGL.
   In the reference page exactly *one* element uses WebGL.
2. **Motion is a pure function of time in the vertex shader.** Each particle carries immutable "DNA" (a few floats);
   the CPU uploads nothing per frame but ~30 uniforms. No integration, no drift, no state to resynchronise. Pause,
   rewind, slow motion and deterministic capture are just a different `uTime`. 80k particles cost about what 8k cost.
3. **Light adds; restraint wins.** Additive blending means the bright core is hundreds of tiny stars overlapping, not
   one big sprite. Fewer particles in the core look better. Darkness is where there are no particles. Most particles
   should be tiny and dim; a handful can be big.

## Workflow

1. **Pin down the brief** in one line each: subject (what), mood (palette words: dusk, neon, arctic…), where it lives
   (full-screen hero, section background, artifact), stack (single HTML, React/Next, Vue), interactions wanted
   (pointer lens, click pulse, scroll drift, morph on scroll), and whether text sits on top. Make reasonable calls
   yourself; ask only if the answer changes the template you would pick.
2. **Choose the layer** with the decision tree below. If the answer is not WebGL, do the CSS thing and stop.
3. **Pick the closest subject** from `references/subjects.md` (the "user says… → start from" table) and the template
   it uses. Compose a page: `python scripts/compose.py <subject> out.html --title "…" --heading "Left|Right"`
   (run from the skill folder), or copy `assets/template-full.html` and paste the subject's two sections over the
   SUBJECT BLOCK. For a new subject, answer the five questions in `subjects.md` § Inventing a new subject.
4. **Adapt**: palette, `CONFIG` numbers, the field (sky/background), the heading/content, the interactions. Keep the
   engine section untouched unless you are adding a capability.
5. **Verify in a browser** before delivering (§ Verify). Shader errors only show up at runtime.
6. **Deliver** the file (or component), plus the 5–8 knobs the user is most likely to want, in plain words.

## Which layer? (decide before writing any WebGL)

```
DOM element, simple property (opacity, transform, colour, clip, blur)?
   → CSS @keyframes / transition. Runs on the compositor, works before hydration. Headline reveals live here.
Driven by scroll position?
   → CSS animation-timeline: view() / scroll(). No JS, no jank. Fallback: IntersectionObserver + class.
Enter/exit tied to a component lifecycle (must animate before unmount)?
   → Motion / AnimatePresence (or the framework's transition primitive).
Designer-made vector illustration with states?
   → Rive / Lottie.
Thousands of elements, light that adds, or pixels only a shader can make?
   → WebGL2. This skill. Points → template-full (or -minimal). Continuous field (aurora, gradient, smoke) → template-field.
Meshes, models, orbiting camera, lighting?
   → three.js (see references/integration.md for the port).
```

## The engine contract (what you edit)

`assets/template-full.html` has three sections. **1. CONFIG** — counts, intro, lens, scroll, post (bloom, threshold,
exposure, grain, vignette), palette, `subject` uniforms. **2. SUBJECT** — `generateSubject(N)` fills three vec4
attributes per particle once (`seed` = subject-specific, `dna` = size/brightness/colour-mix/phase, `scatter` =
intro start + jitter), and `SUBJECT_GLSL` defines:

```glsl
void subject(float t, vec4 seed, vec4 dna, vec4 scatter, inout Particle o)
// o.pos (scene units, y in -1..1), o.depth 0..1, o.emphasis, o.reveal 0..1, o.color, o.size, o.cross — all pre-filled with defaults
```
plus optional `FIELD_GLSL` with `vec3 field(vec2 uv, vec2 p, float t)` drawn behind the particles (sky, clouds).
**3. ENGINE** — `createScene(canvas, opts)` → `{ config, stats, replayIntro, rebuild, setReducedMotion, step, destroy }`.
`config` is live: change `scene.config.post.bloom` from a slider and it applies next frame. `step(1/60)` advances
deterministically (tests, poster frames). The noise helpers `hash21 / vnoise / fbm` exist inside field shaders;
subject shaders declare their own (copy from `flow-field.js` or the cookbook).

## Taste: what separates "premium" from "screensaver"

- **Slow.** Cinematic means slow: full rotation in minutes, twinkle at 1–2 Hz, drift of a few pixels. If it looks
  dynamic in a screenshot, it is too fast.
- **Two-tone palette, not a rainbow.** A cool base and a warm minority (`dna.z` mostly 0). Aerial haze toward the sky
  colour for depth.
- **Size hierarchy.** 80% of particles at 1–3 px, a few at 6–10 px with a diffraction cross. Uniform sizes read as dots.
- **Differential motion.** Nothing rotates as a rigid disc; speed falls with radius. Stalks bend at the tip, not the base.
- **Breathing.** A 2% slow pulse of the whole scene removes the mechanical feel. Gusts, not constant wind.
- **Propagated reveal**, not a global fade: the scene lights up from somewhere (core, ground, left edge, along the path).
- **HDR + soft-knee bloom, ACES, then raise exposure** (ACES crushes the lows — the arms of the galaxy vanish until you
  push exposure to ~3). Vignette for focus and text contrast. Grain at 0.03. Dither always (OLED banding).
- **To see the structure while tuning**: bloom 0, core 0, exposure up. Then add the glow back.
- **Interaction should feel like mass**: pointer smoothed with `1 - pow(0.001, dt)`, pulses that decay, scroll that
  settles. Never `x += (target - x) * 0.1` (framerate-dependent).
- **Text over the scene**: `mix-blend-mode: screen` on the headline, letters rising with blur, timed to land as the
  reveal reaches the middle. The vignette guarantees contrast at the edges where text sits.

## Non-negotiables (already in the templates — keep them when you change things)

`pointer-events:none` + `aria-hidden` on the canvas · DPR capped at 2 · `depth:false, antialias:false` · buffers
`STATIC_DRAW`, zero uploads per frame · uniform locations cached · `dt` clamped to 1/30 · pause when hidden or
off-screen · `prefers-reduced-motion` produces a calm composed state (clock frozen, lens/pulse off, intro complete,
grain reduced) and reacts live · static CSS fallback when WebGL2 is missing or the context is lost, rebuild on restore ·
`destroy()` frees everything (SPA route changes). Details and the production checklist: `references/performance-a11y.md`.

## Verify (never skip — shader bugs are silent until runtime)

Open the page in a browser (`python -m http.server` in the folder, or the Browser tool). Check: no console errors
(shader compile errors throw with numbered source); the intro completes and the subject is recognisable; press `h`
for the fps/points HUD (expect 60+ fps on a laptop GPU with ~30k points; if not, lower `count` or DPR); press `r` to
see the reduced-motion state; resize the window (no stretch, no blank); move the pointer (lens), click (pulse), scroll
(drift). In an environment that throttles `requestAnimationFrame` (embedded previews), drive it deterministically:
`for (let i = 0; i < 300; i++) sceneApi.step(1/60)` then screenshot. Field-template pages have no API; they render on
the first frame.

Common failures and fixes: nothing visible → intro not complete (wait 3 s / `step`) or points off-screen (aspect:
x is divided by aspect, so fill `±1.8` for 16:9) · white blob in the centre → too many particles near r=0, lower the
bulge share or `uCore` · flat and dull → no HDR float ext, or exposure not raised after ACES · flicker at edges of
glow → threshold without soft knee · shrunk on Retina → `uPixelRatio` missing · runaway speed on 120 Hz → fixed lerp.

## Deliverables and what to tell the user

Default: one `.html` file, opened locally to confirm, with the debug HUD/hint removed unless they want it. For frameworks
follow `references/integration.md`. In the message: what the scene is, the 5–8 knobs in `CONFIG` they will want
(count, palette, bloom, exposure, spin/wind speed, intro duration, lens), how reduced motion behaves, and the rough
cost (points, passes, expected fps). If they pointed at a live site, include the audit findings (`references/audit.md`).

## Files

- `assets/template-full.html` — the engine: particles + optional field + bloom pyramid + composite + interaction + a11y
- `assets/template-minimal.html` — 150-line points-only version (learning, embedded widgets, the 80/20)
- `assets/template-field.html` — one fullscreen fragment shader with the same composite (aurora, gradients, smoke)
- `assets/subjects/*.js` — 17 drop-in subjects (galaxy, nebula, starfield-warp, flow-field, fireflies, snow,
  lavender-field, lavender-sunflower-field, ocean-waves, text-morph, globe, dna-helix, black-hole, path-trails, aurora,
  liquid-gradient, smoke-ink); `assets/examples/*.html` — each composed and ready to open (`examples/index.html` is a gallery)
- `scripts/compose.py` — template + subject → page; `scripts/build_examples.py` — regenerate all examples
- `references/subjects.md` — catalog, request→subject mapping, how to invent a subject
- `references/shader-cookbook.md` — sprites, noise, curl, 3-D helpers, easing, colour, post, palettes
- `references/interaction.md` — propagated intro, lens, pulse, scroll (both kinds), text choreography, morphs
- `references/integration.md` — React/Next/Vue, artifacts, three.js port, Canvas 2D fallback, stills/video export
- `references/performance-a11y.md` — budget table, reduced motion, fallbacks, production checklist
- `references/audit.md` — console recipes to reverse-engineer any site's animation stack
