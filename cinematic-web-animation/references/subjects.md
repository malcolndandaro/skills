# Subject catalog

Every subject is a drop-in file in `assets/subjects/` (sections 1–2 of a template), and a ready-to-open page in
`assets/examples/`. Compose a fresh page with `python scripts/compose.py <name> out.html --title "…" --heading "Left|Right"`,
or open the subject file and paste its contents over the SUBJECT BLOCK of the template.

Templates: **full** = particles + optional field + bloom/composite/interaction (`template-full.html`) ·
**field** = one fullscreen fragment shader (`template-field.html`) · **minimal** = particles only (`template-minimal.html`).

| Subject | Template | Looks like | Technique it demonstrates | Main knobs |
|---|---|---|---|---|
| `galaxy` | full | spiral / barred / elliptical / globular galaxy, the reference hero | log-spiral distribution, differential rotation, propagated intro from the core | `VARIANT`, `ARMS`, `TWIST`, `SPREAD`, `uSpin`, `uCore` |
| `nebula` | full | slow domain-warped clouds in two colours with a sparse star layer | field pass + particles together, domain warping | `uNebulaA/B`, `uDrift`, `uScale` |
| `starfield-warp` | full | flying through a 3-D star cloud (drift → hyperspace) | wrapping depth `fract(z0 - t·v)`, perspective divide | `uSpeed`, `uSpread` |
| `flow-field` | full | thousands of glowing strokes streaming along curl noise | stateless flow: life loop + fixed-step integration in the shader | `uScale`, `uSpeed`, `uLength`, `uLife` |
| `fireflies` | full | a few hundred big soft lights blinking over a dark forest | restraint: few particles, strong bloom, `pow(sin)` flashes | `uDrift`, `uBlink`, `post.bloom` |
| `snow` | full | flakes at three depths with sway and side wind, winter night | wrapping fall `fract()` + `mod()`, parallax by depth | `uFall`, `uWind` |
| `lavender-field` | full | lavender rows swaying in wind under a sunset, pollen motes | pinhole camera on a ground plane, multi-particle plants sharing a seed, per-particle colour, grow-from-ground intro | `uWind`, `uHorizon`, `uSun` |
| `lavender-sunflower-field` | full | denser field with sunflowers (petal rings + dark discs) | two plant kinds in one attribute layout, "dark by contrast" under additive blending | `SUNFLOWER_SHARE`, `uWind` |
| `ocean-waves` | full | a point-cloud sea with foam crests and glints toward a dusk horizon | height function on a ground plane; swap it for terrain, dunes, a data surface | `uAmp`, `uSpeed` |
| `text-morph` | full | particles assemble a word and flow into another | targets baked into attributes from a rasterised canvas, delayed per-particle morph | `TEXT_A/B`, `FONT`, `uMorph` |
| `globe` | full | rotating sphere with noise continents and a ring | Fibonacci sphere, rotate/tilt/project, far-side dimming | `uSpin`, `uTilt`, `uLand`, `RING` |
| `dna-helix` | full | two strands + rungs, rotating, slightly tilted | parametric 3-D curve, snapped rungs | `uSpin`, `uTurns`, `uRadius` |
| `black-hole` | full | edge-on accretion disk, lensed back half, photon ring, Doppler beaming | emptiness as shadow, Keplerian rotation, hot→cool colour by radius | `uSpin`, `uTilt`, `uBeam`, `uLift` |
| `path-trails` | full | a Lorenz attractor with comets of light running along it | precomputed path + travelling brightness `f(s, t)` | `uSpin`, `uPulseCount`, `uPulseSpeed` |
| `aurora` | field | three curtains of green→violet light over stars | ribbons with crisp bottom / soft top, vertical striations | `uSpeed`, `uIntensity` |
| `liquid-gradient` | field | glossy brand-coloured blobs melting together (light backgrounds OK) | domain-warped fbm colour zones, no additive blending | `uColorA..D`, `uSpeed`, `uScale` |
| `smoke-ink` | field | a rising, curling plume | warped fbm born low, dissolving high | `uSpeed`, `uScale`, `uTint` |

## Mapping requests to subjects

| The user says… | Start from | Change |
|---|---|---|
| "particles", "stars", "space", "cosmic", "like the OpenAI page" | `galaxy` | palette, `VARIANT` |
| "clouds", "mist", "dreamy", "gas" | `nebula` (dark) or `liquid-gradient` (light) | colours, `uScale` |
| "hyperspace", "speed", "tunnel", "we're moving" | `starfield-warp` | `uSpeed` 0.2+, warm palette |
| "wind", "streams", "currents", "data flowing", "magnetic" | `flow-field` | palette, `uLength` |
| "magical", "fairy lights", "bokeh", "lanterns" | `fireflies` | ring sprite for bokeh (cookbook), colour |
| "rain" | `snow` | tiny size, `uFall` ×4, no sway, streak sprite, blue-grey |
| "embers", "sparks", "rising" | `snow` | flip the fall direction, ember palette, twinkle up |
| "petals", "sakura", "confetti", "leaves" | `snow` | petal/disc sprite, pink or random hues, gentle sway |
| "bubbles", "underwater" | `snow` + `liquid-gradient` blues | rising, ring sprite, slow |
| "field", "meadow", "wheat", "grass", "flowers" | `lavender-field` | plant colours/heights, sky colours |
| "sunflowers", "poppies", "tulips" | `lavender-sunflower-field` | petal colours, disc colour, `SUNFLOWER_SHARE` |
| "ocean", "waves", "water", "terrain", "mountains", "surface plot" | `ocean-waves` | the height function, palette |
| "logo", "our name", "word", "assemble", "morph into" | `text-morph` | `TEXT_A/B`; for a logo draw the image on the canvas instead of text |
| "globe", "planet", "world", "network of points on Earth" | `globe` | `uLand`, `RING`, palette |
| "DNA", "helix", "biotech", "spiral staircase" | `dna-helix` | `uTurns`, colours |
| "black hole", "portal", "vortex", "singularity" | `black-hole` | `uTilt`, `uLift` |
| "attractor", "math", "signal", "route", "trace a line" | `path-trails` | replace the Lorenz integration with any sampled curve |
| "northern lights" | `aurora` | `uIntensity`, colours in the mix |
| "mesh gradient", "Apple-like blobs", "hero for a light site" | `liquid-gradient` | the four colours |
| "smoke", "ink", "incense", "steam" | `smoke-ink` | `uTint`, invert for ink on white |
| "constellation", "network graph", "nodes and lines" | `globe` or `path-trails` | lines need a second GL_LINES draw with CPU-static positions; keep the points animated by brightness only |
| "matrix rain", "code", "glyphs" | `snow` + a glyph atlas (cookbook) | columns snap x to a grid, green palette |
| "heartbeat", "waveform", "audio" | `ocean-waves` restricted to one row | height = the signal, drive through a `subject` uniform per frame |

## Inventing a new subject

Answer five questions, in this order; each maps to one place in the file.

1. **Distribution** — where do particles start, and what immutable numbers does each one need? (→ `generateSubject`,
   `seed`). Think in the coordinate system that makes the motion simplest: polar for anything that spins, a ground
   plane for anything that grows, unit sphere for anything round, arc length for anything along a curve.
2. **Motion as a function of time** — where is this particle at time t, given only its seed? (→ `subject()`). If you
   catch yourself wanting "the position from the last frame", use a loop trick: `fract(t/L + offset)` for cycles,
   fixed-step integration from the start point for flows, precomputed paths for anything else.
3. **Colour and light rule** — what makes some particles brighter or warmer? (→ `o.color`, `o.emphasis`). One rule,
   applied consistently, reads as physical: brightness by radius, heat by orbit, foam by height, front side by depth.
4. **Reveal order** — how should it come alive? (→ `o.reveal`). Core outward, ground upward, left to right, along the path.
5. **Background** — is there a sky, a fog, a gradient behind it? (→ `FIELD_GLSL`), or is darkness the background?

Then set `CONFIG` from the closest catalog entry and tune in the browser with the diagnostic order in
`performance-a11y.md`. Sizes: keep 80% of particles at 1–3 px and let a few be big; big everywhere reads as bubbles.

## Combining subjects

Two populations in one draw call: put a kind flag in the seed (`seed.w < 0` for motes, `seed.w >= 10` for sunflowers)
and branch in `subject()`. Branching on a per-particle attribute is cheap on GPUs when both branches are short. Two
different sprites → branch in the fragment shader on a varying, or use the atlas. A field behind particles → `FIELD_GLSL`.
Two scenes with different post settings → two canvases, not one.
